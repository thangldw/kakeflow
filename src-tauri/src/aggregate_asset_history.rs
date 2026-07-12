use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fmt;

const MAX_ID_LEN: usize = 64;
const MAX_JPY: i64 = 9_000_000_000_000_000;
const DEFAULT_LIST_LIMIT: u32 = 240;
const MAX_LIST_LIMIT: u32 = 1_200;
const MAX_IMPORT_ROWS: usize = 1_200;

#[derive(Debug)]
pub enum AggregateAssetHistoryError {
    InvalidInput(&'static str),
    NotFound,
    Conflict,
    Unavailable,
}

impl AggregateAssetHistoryError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput(message) => message,
            Self::NotFound => "The aggregate asset source was not found",
            Self::Conflict => "Aggregate asset history conflicts with existing source data",
            Self::Unavailable => "Aggregate asset history is temporarily unavailable",
        }
    }
}

impl fmt::Display for AggregateAssetHistoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.public_message())
    }
}

fn db_error(error: rusqlite::Error) -> AggregateAssetHistoryError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == ErrorCode::ConstraintViolation =>
        {
            AggregateAssetHistoryError::Conflict
        }
        _ => AggregateAssetHistoryError::Unavailable,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAggregateAssetSnapshotInput {
    pub id: String,
    pub household_id: String,
    pub source_document_id: String,
    pub source_row: u32,
    pub as_of: String,
    pub total_assets_jpy: i64,
    pub components: Vec<ImportAggregateAssetComponentInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAggregateAssetComponentInput {
    pub asset_class: String,
    pub official_header: String,
    pub value_jpy: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAggregateAssetHistoryInput {
    pub household_id: String,
    pub snapshots: Vec<ImportAggregateAssetSnapshotInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAggregateAssetHistoryInput {
    pub household_id: String,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AggregateAssetComponentDto {
    pub asset_class: String,
    pub official_header: String,
    pub value_jpy: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AggregateAssetSnapshotDto {
    pub id: String,
    pub household_id: String,
    pub source_document_id: String,
    pub source_row: u32,
    pub as_of: String,
    pub total_assets_jpy: i64,
    pub components: Vec<AggregateAssetComponentDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportAggregateAssetSnapshotResultDto {
    pub reused_existing: bool,
    pub snapshot: AggregateAssetSnapshotDto,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportAggregateAssetHistoryResultDto {
    pub created_count: u32,
    pub reused_count: u32,
    pub snapshots: Vec<AggregateAssetSnapshotDto>,
}

pub fn import_snapshot(
    connection: &Connection,
    input: &ImportAggregateAssetSnapshotInput,
) -> Result<ImportAggregateAssetSnapshotResultDto, AggregateAssetHistoryError> {
    let result = import_history(
        connection,
        &ImportAggregateAssetHistoryInput {
            household_id: input.household_id.clone(),
            snapshots: vec![input.clone()],
        },
    )?;
    Ok(ImportAggregateAssetSnapshotResultDto {
        reused_existing: result.reused_count == 1,
        snapshot: result
            .snapshots
            .into_iter()
            .next()
            .ok_or(AggregateAssetHistoryError::Unavailable)?,
    })
}

pub fn import_history(
    connection: &Connection,
    input: &ImportAggregateAssetHistoryInput,
) -> Result<ImportAggregateAssetHistoryResultDto, AggregateAssetHistoryError> {
    validate_id(&input.household_id)?;
    if input.snapshots.is_empty() || input.snapshots.len() > MAX_IMPORT_ROWS {
        return Err(AggregateAssetHistoryError::InvalidInput(
            "Aggregate asset import row count is invalid",
        ));
    }
    let mut dates = BTreeSet::new();
    let mut source_rows = BTreeSet::new();
    for snapshot in &input.snapshots {
        validate_import(snapshot)?;
        if snapshot.household_id != input.household_id {
            return Err(AggregateAssetHistoryError::InvalidInput(
                "Aggregate asset batch household is invalid",
            ));
        }
        if !dates.insert(snapshot.as_of.as_str()) {
            return Err(AggregateAssetHistoryError::InvalidInput(
                "Aggregate asset batch contains a duplicate date",
            ));
        }
        if !source_rows.insert((snapshot.source_document_id.as_str(), snapshot.source_row)) {
            return Err(AggregateAssetHistoryError::InvalidInput(
                "Aggregate asset batch contains duplicate provenance",
            ));
        }
    }

    let transaction = connection.unchecked_transaction().map_err(db_error)?;
    // Resolve every source before writing the first snapshot. This makes a
    // missing or cross-household row a batch-level failure, not a partial import.
    for snapshot in &input.snapshots {
        let source_exists = transaction
            .query_row(
                "SELECT EXISTS(
                SELECT 1 FROM source_documents document
                JOIN source_records record ON record.source_document_id = document.id
                WHERE document.id = ?1 AND document.household_id = ?2 AND record.row_number = ?3
            )",
                params![
                    snapshot.source_document_id,
                    input.household_id,
                    snapshot.source_row
                ],
                |row| row.get::<_, bool>(0),
            )
            .map_err(db_error)?;
        if !source_exists {
            return Err(AggregateAssetHistoryError::NotFound);
        }
    }

    let mut created_count = 0_u32;
    let mut reused_count = 0_u32;
    let mut snapshots = Vec::with_capacity(input.snapshots.len());
    for snapshot in &input.snapshots {
        let (reused, stored) = import_one(&transaction, snapshot)?;
        if reused {
            reused_count += 1;
        } else {
            created_count += 1;
        }
        snapshots.push(stored);
    }
    transaction.commit().map_err(db_error)?;
    Ok(ImportAggregateAssetHistoryResultDto {
        created_count,
        reused_count,
        snapshots,
    })
}

fn import_one(
    connection: &Connection,
    input: &ImportAggregateAssetSnapshotInput,
) -> Result<(bool, AggregateAssetSnapshotDto), AggregateAssetHistoryError> {
    let existing_id = connection
        .query_row(
            "SELECT id FROM aggregate_asset_snapshots
             WHERE household_id = ?1
               AND (as_of = ?3 OR (source_document_id = ?2 AND source_row = ?4))
             ORDER BY CASE WHEN as_of = ?3 AND source_row = ?4 THEN 0 ELSE 1 END, id
             LIMIT 1",
            params![
                input.household_id,
                input.source_document_id,
                input.as_of,
                input.source_row
            ],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(db_error)?;
    if let Some(id) = existing_id {
        let existing = get_snapshot(connection, &input.household_id, &id)?;
        if matches_import(&existing, input) {
            return Ok((true, existing));
        }
        return Err(AggregateAssetHistoryError::Conflict);
    }

    connection
        .execute(
            "INSERT INTO aggregate_asset_snapshots
             (id, household_id, source_document_id, source_row, as_of, total_assets_jpy)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                input.id,
                input.household_id,
                input.source_document_id,
                input.source_row,
                input.as_of,
                input.total_assets_jpy
            ],
        )
        .map_err(db_error)?;
    for component in &input.components {
        connection
            .execute(
                "INSERT INTO aggregate_asset_components
                 (aggregate_asset_snapshot_id, asset_class, official_header, value_jpy)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    input.id,
                    component.asset_class,
                    component.official_header,
                    component.value_jpy
                ],
            )
            .map_err(db_error)?;
    }
    Ok((
        false,
        get_snapshot(connection, &input.household_id, &input.id)?,
    ))
}

pub fn list_snapshots(
    connection: &Connection,
    input: &ListAggregateAssetHistoryInput,
) -> Result<Vec<AggregateAssetSnapshotDto>, AggregateAssetHistoryError> {
    validate_id(&input.household_id)?;
    for date in [&input.date_from, &input.date_to].into_iter().flatten() {
        validate_date(date)?;
    }
    if input
        .date_from
        .as_ref()
        .zip(input.date_to.as_ref())
        .is_some_and(|(from, to)| from > to)
    {
        return Err(AggregateAssetHistoryError::InvalidInput(
            "Aggregate asset date range is invalid",
        ));
    }
    let limit = input.limit.unwrap_or(DEFAULT_LIST_LIMIT);
    if limit == 0 || limit > MAX_LIST_LIMIT {
        return Err(AggregateAssetHistoryError::InvalidInput(
            "Aggregate asset list limit is invalid",
        ));
    }
    let mut statement = connection
        .prepare(
            "SELECT id, household_id, source_document_id, source_row, as_of, total_assets_jpy
             FROM aggregate_asset_snapshots
             WHERE household_id = ?1
               AND (?2 IS NULL OR as_of >= ?2)
               AND (?3 IS NULL OR as_of <= ?3)
             ORDER BY as_of DESC, id DESC LIMIT ?4",
        )
        .map_err(db_error)?;
    let summaries = statement
        .query_map(
            params![input.household_id, input.date_from, input.date_to, limit],
            read_snapshot_without_components,
        )
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    summaries
        .into_iter()
        .map(|mut snapshot| {
            snapshot.components = query_components(connection, &snapshot.id)?;
            Ok(snapshot)
        })
        .collect()
}

fn get_snapshot(
    connection: &Connection,
    household_id: &str,
    id: &str,
) -> Result<AggregateAssetSnapshotDto, AggregateAssetHistoryError> {
    let mut snapshot = connection
        .query_row(
            "SELECT id, household_id, source_document_id, source_row, as_of, total_assets_jpy
             FROM aggregate_asset_snapshots WHERE household_id = ?1 AND id = ?2",
            params![household_id, id],
            read_snapshot_without_components,
        )
        .optional()
        .map_err(db_error)?
        .ok_or(AggregateAssetHistoryError::NotFound)?;
    snapshot.components = query_components(connection, id)?;
    Ok(snapshot)
}

fn read_snapshot_without_components(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AggregateAssetSnapshotDto> {
    Ok(AggregateAssetSnapshotDto {
        id: row.get(0)?,
        household_id: row.get(1)?,
        source_document_id: row.get(2)?,
        source_row: row.get(3)?,
        as_of: row.get(4)?,
        total_assets_jpy: row.get(5)?,
        components: Vec::new(),
    })
}

fn query_components(
    connection: &Connection,
    snapshot_id: &str,
) -> Result<Vec<AggregateAssetComponentDto>, AggregateAssetHistoryError> {
    let mut statement = connection
        .prepare(
            "SELECT asset_class, official_header, value_jpy
             FROM aggregate_asset_components
             WHERE aggregate_asset_snapshot_id = ?1 ORDER BY asset_class",
        )
        .map_err(db_error)?;
    let components = statement
        .query_map([snapshot_id], |row| {
            Ok(AggregateAssetComponentDto {
                asset_class: row.get(0)?,
                official_header: row.get(1)?,
                value_jpy: row.get(2)?,
            })
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    Ok(components)
}

fn matches_import(
    existing: &AggregateAssetSnapshotDto,
    input: &ImportAggregateAssetSnapshotInput,
) -> bool {
    let mut expected = input
        .components
        .iter()
        .map(|component| AggregateAssetComponentDto {
            asset_class: component.asset_class.clone(),
            official_header: component.official_header.clone(),
            value_jpy: component.value_jpy,
        })
        .collect::<Vec<_>>();
    expected.sort_by(|left, right| left.asset_class.cmp(&right.asset_class));
    existing.as_of == input.as_of
        && existing.total_assets_jpy == input.total_assets_jpy
        && existing.components == expected
}

fn validate_import(
    input: &ImportAggregateAssetSnapshotInput,
) -> Result<(), AggregateAssetHistoryError> {
    for id in [&input.id, &input.household_id, &input.source_document_id] {
        validate_id(id)?;
    }
    if input.source_row == 0 {
        return Err(AggregateAssetHistoryError::InvalidInput(
            "Aggregate asset source row is invalid",
        ));
    }
    validate_date(&input.as_of)?;
    validate_jpy(input.total_assets_jpy)?;
    if input.components.len() > 10 {
        return Err(AggregateAssetHistoryError::InvalidInput(
            "Aggregate asset component count is invalid",
        ));
    }
    let mut classes = BTreeSet::new();
    for component in &input.components {
        if !classes.insert(component.asset_class.as_str()) {
            return Err(AggregateAssetHistoryError::InvalidInput(
                "Aggregate asset component is duplicated",
            ));
        }
        if official_header(&component.asset_class) != Some(component.official_header.as_str()) {
            return Err(AggregateAssetHistoryError::InvalidInput(
                "Aggregate asset class header is invalid",
            ));
        }
        validate_jpy(component.value_jpy)?;
    }
    Ok(())
}

fn official_header(asset_class: &str) -> Option<&'static str> {
    match asset_class {
        "DEPOSITS_CASH_CRYPTO" => Some("預金・現金・暗号資産(円)"),
        "LISTED_STOCKS" => Some("株式(現物)(円)"),
        "INVESTMENT_TRUSTS" => Some("投資信託(円)"),
        "BONDS" => Some("債券(円)"),
        "FX" => Some("FX(円)"),
        "INSURANCE" => Some("保険(円)"),
        "REAL_ESTATE" => Some("不動産(円)"),
        "PENSIONS" => Some("年金(円)"),
        "POINTS" => Some("ポイント(円)"),
        "OTHER_ASSETS" => Some("その他の資産(円)"),
        _ => None,
    }
}

fn validate_id(value: &str) -> Result<(), AggregateAssetHistoryError> {
    if value.is_empty()
        || value.len() > MAX_ID_LEN
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Err(AggregateAssetHistoryError::InvalidInput(
            "Aggregate asset identifier is invalid",
        ))
    } else {
        Ok(())
    }
}

fn validate_jpy(value: i64) -> Result<(), AggregateAssetHistoryError> {
    if !(0..=MAX_JPY).contains(&value) {
        Err(AggregateAssetHistoryError::InvalidInput(
            "Aggregate asset amount is invalid",
        ))
    } else {
        Ok(())
    }
}

fn validate_date(value: &str) -> Result<(), AggregateAssetHistoryError> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return Err(AggregateAssetHistoryError::InvalidInput(
            "Aggregate asset date is invalid",
        ));
    }
    let parse = |range: std::ops::Range<usize>| {
        value[range].parse::<u32>().map_err(|_| {
            AggregateAssetHistoryError::InvalidInput("Aggregate asset date is invalid")
        })
    };
    let year = parse(0..4)?;
    let month = parse(5..7)?;
    let day = parse(8..10)?;
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    if year == 0 || day == 0 || day > max_day {
        Err(AggregateAssetHistoryError::InvalidInput(
            "Aggregate asset date is invalid",
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE households(id TEXT PRIMARY KEY) STRICT; CREATE TABLE source_documents(id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id)) STRICT; CREATE TABLE source_records(id TEXT PRIMARY KEY, source_document_id TEXT NOT NULL REFERENCES source_documents(id), row_number INTEGER NOT NULL, UNIQUE(source_document_id,row_number)) STRICT;").unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0021_aggregate_asset_history.sql"
            ))
            .unwrap();
        connection
            .execute("INSERT INTO households VALUES ('home'),('other')", [])
            .unwrap();
        connection
            .execute(
                "INSERT INTO source_documents VALUES ('document','home'),('repeat-document','home'),('other-document','other')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO source_records VALUES ('record','document',2),('record-3','document',3),('repeat-record','repeat-document',9),('repeat-record-10','repeat-document',10),('other-record','other-document',2)",
                [],
            )
            .unwrap();
        connection
    }

    fn input() -> ImportAggregateAssetSnapshotInput {
        ImportAggregateAssetSnapshotInput {
            id: "snapshot".into(),
            household_id: "home".into(),
            source_document_id: "document".into(),
            source_row: 2,
            as_of: "2026-07-31".into(),
            total_assets_jpy: 8_700_000,
            components: vec![
                ImportAggregateAssetComponentInput {
                    asset_class: "LISTED_STOCKS".into(),
                    official_header: "株式(現物)(円)".into(),
                    value_jpy: 3_100_000,
                },
                ImportAggregateAssetComponentInput {
                    asset_class: "DEPOSITS_CASH_CRYPTO".into(),
                    official_header: "預金・現金・暗号資産(円)".into(),
                    value_jpy: 2_100_000,
                },
            ],
        }
    }

    #[test]
    fn imports_lists_and_reuses_the_same_source_snapshot() {
        let connection = database();
        let first = import_snapshot(&connection, &input()).unwrap();
        assert!(!first.reused_existing);
        assert_eq!(
            first.snapshot.components[0].asset_class,
            "DEPOSITS_CASH_CRYPTO"
        );

        let mut repeated = input();
        repeated.id = "another-id".into();
        repeated.components.reverse();
        let second = import_snapshot(&connection, &repeated).unwrap();
        assert!(second.reused_existing);
        assert_eq!(second.snapshot.id, "snapshot");

        let listed = list_snapshots(
            &connection,
            &ListAggregateAssetHistoryInput {
                household_id: "home".into(),
                date_from: Some("2026-07-01".into()),
                date_to: Some("2026-07-31".into()),
                limit: None,
            },
        )
        .unwrap();
        assert_eq!(listed, vec![first.snapshot]);
    }

    #[test]
    fn conflicting_same_source_date_is_rejected_atomically() {
        let connection = database();
        import_snapshot(&connection, &input()).unwrap();
        let mut changed = input();
        changed.id = "changed".into();
        changed.total_assets_jpy += 1;
        assert!(matches!(
            import_snapshot(&connection, &changed),
            Err(AggregateAssetHistoryError::Conflict)
        ));
        let count: i64 = connection
            .query_row(
                "SELECT count(*) FROM aggregate_asset_snapshots",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn overlapping_export_reuses_identical_household_date_and_rejects_changes() {
        let connection = database();
        let first = import_snapshot(&connection, &input()).unwrap();
        let mut repeated = input();
        repeated.id = "overlap".into();
        repeated.source_document_id = "repeat-document".into();
        repeated.source_row = 9;
        let reused = import_snapshot(&connection, &repeated).unwrap();
        assert!(reused.reused_existing);
        assert_eq!(reused.snapshot.source_document_id, "document");
        assert_eq!(reused.snapshot.source_row, 2);
        assert_eq!(reused.snapshot, first.snapshot);

        repeated.total_assets_jpy += 1;
        assert!(matches!(
            import_snapshot(&connection, &repeated),
            Err(AggregateAssetHistoryError::Conflict)
        ));
    }

    #[test]
    fn batch_conflict_on_second_row_rolls_back_the_first_new_snapshot() {
        let connection = database();
        import_snapshot(&connection, &input()).unwrap();

        let mut first_new = input();
        first_new.id = "june".into();
        first_new.source_row = 3;
        first_new.as_of = "2026-06-30".into();
        first_new.total_assets_jpy = 8_600_000;
        let mut conflicting = input();
        conflicting.id = "conflict".into();
        conflicting.source_document_id = "repeat-document".into();
        conflicting.source_row = 9;
        conflicting.total_assets_jpy += 1;

        let result = import_history(
            &connection,
            &ImportAggregateAssetHistoryInput {
                household_id: "home".into(),
                snapshots: vec![first_new, conflicting],
            },
        );
        assert!(matches!(result, Err(AggregateAssetHistoryError::Conflict)));
        let dates = list_snapshots(
            &connection,
            &ListAggregateAssetHistoryInput {
                household_id: "home".into(),
                date_from: None,
                date_to: None,
                limit: None,
            },
        )
        .unwrap()
        .into_iter()
        .map(|snapshot| snapshot.as_of)
        .collect::<Vec<_>>();
        assert_eq!(dates, vec!["2026-07-31"]);
    }

    #[test]
    fn batch_reuses_an_overlap_and_creates_a_new_date_atomically() {
        let connection = database();
        let existing = import_snapshot(&connection, &input()).unwrap().snapshot;
        let mut overlap = input();
        overlap.id = "overlap".into();
        overlap.source_document_id = "repeat-document".into();
        overlap.source_row = 9;
        let mut new_date = input();
        new_date.id = "august".into();
        new_date.source_document_id = "repeat-document".into();
        new_date.source_row = 10;
        new_date.as_of = "2026-08-31".into();
        new_date.total_assets_jpy = 8_800_000;

        let result = import_history(
            &connection,
            &ImportAggregateAssetHistoryInput {
                household_id: "home".into(),
                snapshots: vec![overlap, new_date],
            },
        )
        .unwrap();
        assert_eq!(result.created_count, 1);
        assert_eq!(result.reused_count, 1);
        assert_eq!(result.snapshots[0], existing);
        assert_eq!(result.snapshots[1].as_of, "2026-08-31");
    }

    #[test]
    fn enforces_household_document_and_source_row_ownership() {
        let connection = database();
        let mut wrong = input();
        wrong.source_document_id = "other-document".into();
        assert!(matches!(
            import_snapshot(&connection, &wrong),
            Err(AggregateAssetHistoryError::NotFound)
        ));
        let direct = connection.execute(
            "INSERT INTO aggregate_asset_snapshots(id,household_id,source_document_id,source_row,as_of,total_assets_jpy) VALUES('bad','home','other-document',2,'2026-07-31',1)",
            [],
        );
        assert!(direct.is_err());
        import_snapshot(&connection, &input()).unwrap();
        let direct_update = connection.execute(
            "UPDATE aggregate_asset_snapshots SET source_document_id='other-document' WHERE id='snapshot'",
            [],
        );
        assert!(direct_update.is_err());
    }

    #[test]
    fn validates_dates_components_ranges_and_query_bounds() {
        let connection = database();
        let mut invalid = input();
        invalid.as_of = "2026-02-29".into();
        assert!(matches!(
            import_snapshot(&connection, &invalid),
            Err(AggregateAssetHistoryError::InvalidInput(_))
        ));
        let mut invalid = input();
        invalid.components[0].official_header = "株式(円)".into();
        assert!(matches!(
            import_snapshot(&connection, &invalid),
            Err(AggregateAssetHistoryError::InvalidInput(_))
        ));
        let mut invalid = input();
        invalid.total_assets_jpy = -1;
        assert!(matches!(
            import_snapshot(&connection, &invalid),
            Err(AggregateAssetHistoryError::InvalidInput(_))
        ));
        let mut invalid = input();
        invalid.components[0].value_jpy = -1;
        assert!(matches!(
            import_snapshot(&connection, &invalid),
            Err(AggregateAssetHistoryError::InvalidInput(_))
        ));
        let invalid_range = list_snapshots(
            &connection,
            &ListAggregateAssetHistoryInput {
                household_id: "home".into(),
                date_from: Some("2026-08-01".into()),
                date_to: Some("2026-07-01".into()),
                limit: Some(1),
            },
        );
        assert!(matches!(
            invalid_range,
            Err(AggregateAssetHistoryError::InvalidInput(_))
        ));
    }

    #[test]
    fn migration_has_no_account_or_ledger_linkage() {
        let connection = database();
        let columns = connection
            .prepare("PRAGMA table_info(aggregate_asset_snapshots)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(!columns.iter().any(|column| column == "account_id"));
        assert!(!columns.iter().any(|column| column == "transaction_id"));
    }
}
