use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fmt;

const MAX_ID_LEN: usize = 64;
const MAX_NAME_LEN: usize = 240;
const MAX_ROWS: usize = 100_000;
const MAX_JPY: i64 = 9_000_000_000_000_000;

#[derive(Debug)]
pub enum PortfolioError {
    InvalidInput(&'static str),
    NotFound,
    Conflict,
    Unavailable,
}

impl PortfolioError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput(message) => message,
            Self::NotFound => "The requested portfolio record was not found",
            Self::Conflict => "The portfolio snapshot already exists",
            Self::Unavailable => "Portfolio data is temporarily unavailable",
        }
    }
}

impl fmt::Display for PortfolioError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.public_message())
    }
}

fn db_error(error: rusqlite::Error) -> PortfolioError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == ErrorCode::ConstraintViolation =>
        {
            PortfolioError::Conflict
        }
        _ => PortfolioError::Unavailable,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPortfolioSnapshotInput {
    pub id: String,
    pub household_id: String,
    pub account_id: String,
    pub source_document_id: String,
    pub as_of: String,
    pub market_value_jpy: i64,
    pub cash_value_jpy: i64,
    pub unrealized_pnl_jpy: Option<i64>,
    pub realized_pnl_jpy: Option<i64>,
    pub asset_classes: Vec<ImportAssetClassInput>,
    pub positions: Vec<ImportPositionInput>,
    pub fx_rates: Vec<ImportFxRateInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAssetClassInput {
    pub id: String,
    pub name: String,
    pub market_value_jpy: i64,
    pub unrealized_pnl_jpy: Option<i64>,
    pub source_row: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPositionInput {
    pub id: String,
    pub product_type: String,
    pub account_type: String,
    pub instrument_code: String,
    pub instrument_name: String,
    pub quantity: Option<f64>,
    pub average_cost: Option<f64>,
    pub market_price: Option<f64>,
    pub market_value_jpy: Option<i64>,
    pub unrealized_pnl_jpy: Option<i64>,
    pub realized_pnl_jpy: Option<i64>,
    pub currency: String,
    pub source_row: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFxRateInput {
    pub id: String,
    pub base_currency: String,
    pub rate: f64,
    pub source_row: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSnapshotSummaryDto {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub source_document_id: String,
    pub as_of: String,
    pub market_value_jpy: i64,
    pub cash_value_jpy: i64,
    pub unrealized_pnl_jpy: Option<i64>,
    pub realized_pnl_jpy: Option<i64>,
    pub position_count: u32,
    pub fx_rate_count: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSnapshotDetailDto {
    #[serde(flatten)]
    pub summary: PortfolioSnapshotSummaryDto,
    pub asset_classes: Vec<AssetClassDto>,
    pub positions: Vec<PositionSnapshotDto>,
    pub fx_rates: Vec<FxRateSnapshotDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetClassDto {
    pub id: String,
    pub name: String,
    pub market_value_jpy: i64,
    pub unrealized_pnl_jpy: Option<i64>,
    pub source_row: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PositionSnapshotDto {
    pub id: String,
    pub product_type: String,
    pub account_type: String,
    pub instrument_code: String,
    pub instrument_name: String,
    pub quantity: Option<f64>,
    pub average_cost: Option<f64>,
    pub market_price: Option<f64>,
    pub market_value_jpy: Option<i64>,
    pub unrealized_pnl_jpy: Option<i64>,
    pub realized_pnl_jpy: Option<i64>,
    pub currency: String,
    pub source_row: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FxRateSnapshotDto {
    pub id: String,
    pub base_currency: String,
    pub quote_currency: String,
    pub rate: f64,
    pub source_row: u32,
}

pub fn import_snapshot(
    connection: &Connection,
    input: &ImportPortfolioSnapshotInput,
) -> Result<PortfolioSnapshotDetailDto, PortfolioError> {
    validate_import(input)?;
    let transaction = connection.unchecked_transaction().map_err(db_error)?;
    let account_valid = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1 AND household_id = ?2 AND account_kind = 'ASSET' AND account_subtype = 'SECURITIES' AND is_archived = 0)",
        params![input.account_id, input.household_id], |row| row.get::<_, bool>(0),
    ).map_err(db_error)?;
    let document_valid = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM source_documents WHERE id = ?1 AND household_id = ?2)",
            params![input.source_document_id, input.household_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(db_error)?;
    if !account_valid || !document_valid {
        return Err(PortfolioError::NotFound);
    }

    transaction.execute(
        "INSERT INTO portfolio_snapshots (id, household_id, account_id, source_document_id, as_of, market_value_jpy, cash_value_jpy, unrealized_pnl_jpy, realized_pnl_jpy) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![input.id, input.household_id, input.account_id, input.source_document_id, input.as_of, input.market_value_jpy, input.cash_value_jpy, input.unrealized_pnl_jpy, input.realized_pnl_jpy],
    ).map_err(db_error)?;
    for item in &input.asset_classes {
        transaction.execute(
            "INSERT INTO portfolio_asset_classes (id, portfolio_snapshot_id, name, market_value_jpy, unrealized_pnl_jpy, source_row) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![item.id, input.id, item.name.trim(), item.market_value_jpy, item.unrealized_pnl_jpy, item.source_row],
        ).map_err(db_error)?;
    }
    for item in &input.positions {
        transaction.execute(
            "INSERT INTO position_snapshots (id, portfolio_snapshot_id, product_type, account_type, instrument_code, instrument_name, quantity, average_cost, market_price, market_value_jpy, unrealized_pnl_jpy, realized_pnl_jpy, currency, source_row) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![item.id, input.id, item.product_type.trim(), item.account_type.trim(), item.instrument_code.trim(), item.instrument_name.trim(), item.quantity, item.average_cost, item.market_price, item.market_value_jpy, item.unrealized_pnl_jpy, item.realized_pnl_jpy, item.currency, item.source_row],
        ).map_err(db_error)?;
    }
    for item in &input.fx_rates {
        transaction.execute(
            "INSERT INTO portfolio_fx_rates (id, portfolio_snapshot_id, base_currency, quote_currency, rate, source_row) VALUES (?1, ?2, ?3, 'JPY', ?4, ?5)",
            params![item.id, input.id, item.base_currency, item.rate, item.source_row],
        ).map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)?;
    get_snapshot(connection, &input.household_id, &input.id)
}

pub fn list_snapshots(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<PortfolioSnapshotSummaryDto>, PortfolioError> {
    validate_id(household_id)?;
    let mut statement = connection.prepare(
        "SELECT p.id, p.account_id, a.name, p.source_document_id, p.as_of, p.market_value_jpy, p.cash_value_jpy, p.unrealized_pnl_jpy, p.realized_pnl_jpy, (SELECT count(*) FROM position_snapshots x WHERE x.portfolio_snapshot_id = p.id), (SELECT count(*) FROM portfolio_fx_rates x WHERE x.portfolio_snapshot_id = p.id) FROM portfolio_snapshots p JOIN accounts a ON a.id = p.account_id WHERE p.household_id = ?1 ORDER BY p.as_of DESC, p.id DESC"
    ).map_err(db_error)?;
    let rows = statement
        .query_map([household_id], read_summary)
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

pub fn get_snapshot(
    connection: &Connection,
    household_id: &str,
    snapshot_id: &str,
) -> Result<PortfolioSnapshotDetailDto, PortfolioError> {
    validate_id(household_id)?;
    validate_id(snapshot_id)?;
    let summary = connection.query_row(
        "SELECT p.id, p.account_id, a.name, p.source_document_id, p.as_of, p.market_value_jpy, p.cash_value_jpy, p.unrealized_pnl_jpy, p.realized_pnl_jpy, (SELECT count(*) FROM position_snapshots x WHERE x.portfolio_snapshot_id = p.id), (SELECT count(*) FROM portfolio_fx_rates x WHERE x.portfolio_snapshot_id = p.id) FROM portfolio_snapshots p JOIN accounts a ON a.id = p.account_id WHERE p.household_id = ?1 AND p.id = ?2",
        params![household_id, snapshot_id], read_summary,
    ).optional().map_err(db_error)?.ok_or(PortfolioError::NotFound)?;
    let asset_classes = query_asset_classes(connection, snapshot_id)?;
    let positions = query_positions(connection, snapshot_id)?;
    let fx_rates = query_fx_rates(connection, snapshot_id)?;
    Ok(PortfolioSnapshotDetailDto {
        summary,
        asset_classes,
        positions,
        fx_rates,
    })
}

fn read_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<PortfolioSnapshotSummaryDto> {
    Ok(PortfolioSnapshotSummaryDto {
        id: row.get(0)?,
        account_id: row.get(1)?,
        account_name: row.get(2)?,
        source_document_id: row.get(3)?,
        as_of: row.get(4)?,
        market_value_jpy: row.get(5)?,
        cash_value_jpy: row.get(6)?,
        unrealized_pnl_jpy: row.get(7)?,
        realized_pnl_jpy: row.get(8)?,
        position_count: row.get(9)?,
        fx_rate_count: row.get(10)?,
    })
}

fn query_asset_classes(
    connection: &Connection,
    id: &str,
) -> Result<Vec<AssetClassDto>, PortfolioError> {
    let mut statement = connection.prepare("SELECT id, name, market_value_jpy, unrealized_pnl_jpy, source_row FROM portfolio_asset_classes WHERE portfolio_snapshot_id = ?1 ORDER BY market_value_jpy DESC, name").map_err(db_error)?;
    let rows = statement
        .query_map([id], |row| {
            Ok(AssetClassDto {
                id: row.get(0)?,
                name: row.get(1)?,
                market_value_jpy: row.get(2)?,
                unrealized_pnl_jpy: row.get(3)?,
                source_row: row.get(4)?,
            })
        })
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

fn query_positions(
    connection: &Connection,
    id: &str,
) -> Result<Vec<PositionSnapshotDto>, PortfolioError> {
    let mut statement = connection.prepare("SELECT id, product_type, account_type, instrument_code, instrument_name, quantity, average_cost, market_price, market_value_jpy, unrealized_pnl_jpy, realized_pnl_jpy, currency, source_row FROM position_snapshots WHERE portfolio_snapshot_id = ?1 ORDER BY market_value_jpy DESC NULLS LAST, instrument_name").map_err(db_error)?;
    let rows = statement
        .query_map([id], |row| {
            Ok(PositionSnapshotDto {
                id: row.get(0)?,
                product_type: row.get(1)?,
                account_type: row.get(2)?,
                instrument_code: row.get(3)?,
                instrument_name: row.get(4)?,
                quantity: row.get(5)?,
                average_cost: row.get(6)?,
                market_price: row.get(7)?,
                market_value_jpy: row.get(8)?,
                unrealized_pnl_jpy: row.get(9)?,
                realized_pnl_jpy: row.get(10)?,
                currency: row.get(11)?,
                source_row: row.get(12)?,
            })
        })
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

fn query_fx_rates(
    connection: &Connection,
    id: &str,
) -> Result<Vec<FxRateSnapshotDto>, PortfolioError> {
    let mut statement = connection.prepare("SELECT id, base_currency, quote_currency, rate, source_row FROM portfolio_fx_rates WHERE portfolio_snapshot_id = ?1 ORDER BY base_currency").map_err(db_error)?;
    let rows = statement
        .query_map([id], |row| {
            Ok(FxRateSnapshotDto {
                id: row.get(0)?,
                base_currency: row.get(1)?,
                quote_currency: row.get(2)?,
                rate: row.get(3)?,
                source_row: row.get(4)?,
            })
        })
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

fn validate_import(input: &ImportPortfolioSnapshotInput) -> Result<(), PortfolioError> {
    for id in [
        &input.id,
        &input.household_id,
        &input.account_id,
        &input.source_document_id,
    ] {
        validate_id(id)?;
    }
    if input.as_of.len() < 10
        || input.as_of.len() > 40
        || !input
            .as_of
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_digit)
    {
        return Err(PortfolioError::InvalidInput(
            "Portfolio snapshot date is invalid",
        ));
    }
    validate_jpy(input.market_value_jpy, false)?;
    validate_jpy(input.cash_value_jpy, false)?;
    if input.asset_classes.len() > MAX_ROWS
        || input.positions.len() > MAX_ROWS
        || input.fx_rates.len() > MAX_ROWS
    {
        return Err(PortfolioError::InvalidInput(
            "Portfolio snapshot has too many rows",
        ));
    }
    for item in &input.asset_classes {
        validate_id(&item.id)?;
        validate_text(&item.name)?;
        validate_jpy(item.market_value_jpy, false)?;
        validate_row(item.source_row)?;
        if let Some(value) = item.unrealized_pnl_jpy {
            validate_jpy(value, true)?;
        }
    }
    for item in &input.positions {
        validate_id(&item.id)?;
        validate_text(&item.instrument_name)?;
        validate_text_allow_empty(&item.product_type)?;
        validate_text_allow_empty(&item.account_type)?;
        validate_text_allow_empty(&item.instrument_code)?;
        validate_currency(&item.currency)?;
        validate_row(item.source_row)?;
        for value in [item.quantity, item.average_cost, item.market_price]
            .into_iter()
            .flatten()
        {
            if !value.is_finite() || value < 0.0 {
                return Err(PortfolioError::InvalidInput(
                    "Portfolio decimal value is invalid",
                ));
            }
        }
        for value in [item.market_value_jpy].into_iter().flatten() {
            validate_jpy(value, false)?;
        }
        for value in [item.unrealized_pnl_jpy, item.realized_pnl_jpy]
            .into_iter()
            .flatten()
        {
            validate_jpy(value, true)?;
        }
    }
    for item in &input.fx_rates {
        validate_id(&item.id)?;
        validate_currency(&item.base_currency)?;
        validate_row(item.source_row)?;
        if !item.rate.is_finite() || item.rate <= 0.0 {
            return Err(PortfolioError::InvalidInput("Portfolio FX rate is invalid"));
        }
    }
    for value in [input.unrealized_pnl_jpy, input.realized_pnl_jpy]
        .into_iter()
        .flatten()
    {
        validate_jpy(value, true)?;
    }
    Ok(())
}

fn validate_id(value: &str) -> Result<(), PortfolioError> {
    if value.is_empty()
        || value.len() > MAX_ID_LEN
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Err(PortfolioError::InvalidInput(
            "Portfolio identifier is invalid",
        ))
    } else {
        Ok(())
    }
}
fn validate_text(value: &str) -> Result<(), PortfolioError> {
    if value.trim().is_empty() || value.len() > MAX_NAME_LEN {
        Err(PortfolioError::InvalidInput("Portfolio text is invalid"))
    } else {
        Ok(())
    }
}
fn validate_text_allow_empty(value: &str) -> Result<(), PortfolioError> {
    if value.len() > MAX_NAME_LEN {
        Err(PortfolioError::InvalidInput("Portfolio text is invalid"))
    } else {
        Ok(())
    }
}
fn validate_currency(value: &str) -> Result<(), PortfolioError> {
    if value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_uppercase()) {
        Ok(())
    } else {
        Err(PortfolioError::InvalidInput(
            "Portfolio currency is invalid",
        ))
    }
}
fn validate_row(value: u32) -> Result<(), PortfolioError> {
    if value == 0 {
        Err(PortfolioError::InvalidInput(
            "Portfolio source row is invalid",
        ))
    } else {
        Ok(())
    }
}
fn validate_jpy(value: i64, signed: bool) -> Result<(), PortfolioError> {
    if value.unsigned_abs() > MAX_JPY as u64 || (!signed && value < 0) {
        Err(PortfolioError::InvalidInput("Portfolio amount is invalid"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE households(id TEXT PRIMARY KEY) STRICT; CREATE TABLE accounts(id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), name TEXT NOT NULL, account_kind TEXT NOT NULL, account_subtype TEXT NOT NULL, is_archived INTEGER NOT NULL) STRICT; CREATE TABLE source_documents(id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id)) STRICT;").unwrap();
        connection
            .execute_batch(include_str!("../migrations/0010_portfolio_snapshots.sql"))
            .unwrap();
        connection
            .execute("INSERT INTO households VALUES ('home')", [])
            .unwrap();
        connection.execute("INSERT INTO accounts VALUES ('broker', 'home', 'Brokerage', 'ASSET', 'SECURITIES', 0)", []).unwrap();
        connection
            .execute(
                "INSERT INTO source_documents VALUES ('document', 'home')",
                [],
            )
            .unwrap();
        connection
    }

    fn input() -> ImportPortfolioSnapshotInput {
        ImportPortfolioSnapshotInput {
            id: "snapshot".into(),
            household_id: "home".into(),
            account_id: "broker".into(),
            source_document_id: "document".into(),
            as_of: "2026-07-12T14:47:56+09:00".into(),
            market_value_jpy: 1_750_000,
            cash_value_jpy: 250_000,
            unrealized_pnl_jpy: Some(125_000),
            realized_pnl_jpy: Some(10_000),
            asset_classes: vec![ImportAssetClassInput {
                id: "class-stock".into(),
                name: "Stocks".into(),
                market_value_jpy: 1_500_000,
                unrealized_pnl_jpy: Some(125_000),
                source_row: 3,
            }],
            positions: vec![ImportPositionInput {
                id: "position-aapl".into(),
                product_type: "US stock".into(),
                account_type: "Taxable".into(),
                instrument_code: "AAPL".into(),
                instrument_name: "Apple Inc.".into(),
                quantity: Some(10.0),
                average_cost: Some(180.0),
                market_price: Some(200.0),
                market_value_jpy: Some(300_000),
                unrealized_pnl_jpy: Some(30_000),
                realized_pnl_jpy: None,
                currency: "USD".into(),
                source_row: 8,
            }],
            fx_rates: vec![ImportFxRateInput {
                id: "fx-usd".into(),
                base_currency: "USD".into(),
                rate: 150.25,
                source_row: 12,
            }],
        }
    }

    #[test]
    fn imports_and_reads_a_complete_snapshot_atomically() {
        let connection = database();
        let result = import_snapshot(&connection, &input()).unwrap();
        assert_eq!(result.summary.market_value_jpy, 1_750_000);
        assert_eq!(result.summary.position_count, 1);
        assert_eq!(result.positions[0].instrument_code, "AAPL");
        assert_eq!(result.fx_rates[0].rate, 150.25);
        assert_eq!(list_snapshots(&connection, "home").unwrap().len(), 1);
    }

    #[test]
    fn rejects_wrong_account_scope_without_partial_rows() {
        let connection = database();
        let mut value = input();
        value.account_id = "missing".into();
        assert!(matches!(
            import_snapshot(&connection, &value),
            Err(PortfolioError::NotFound)
        ));
        let count: i64 = connection
            .query_row("SELECT count(*) FROM portfolio_snapshots", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn rejects_non_finite_values_before_sqlite() {
        let connection = database();
        let mut value = input();
        value.fx_rates[0].rate = f64::NAN;
        assert!(matches!(
            import_snapshot(&connection, &value),
            Err(PortfolioError::InvalidInput(_))
        ));
    }
}
