use crate::connector_control::ConnectorKind;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use serde::Serialize;
use std::collections::BTreeSet;
use thiserror::Error;

const MAX_BATCH_ITEMS: usize = 10_000;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const LEASE_MINUTES: u8 = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefreshTarget {
    pub connector_kind: ConnectorKind,
    pub connection_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefreshOutcome {
    Succeeded { changed_count: u64 },
    NoChanges,
    FailedRetryable { error_code: String },
    NeedsAction { error_code: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RefreshBatchStatus {
    Active,
    Complete,
    Partial,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RefreshItemStatus {
    Pending,
    Running,
    Succeeded,
    NoChanges,
    SkippedManual,
    FailedRetryable,
    NeedsAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorRefreshBatchDto {
    pub batch_id: String,
    pub household_id: String,
    pub status: RefreshBatchStatus,
    pub total_count: u64,
    pub terminal_count: u64,
    pub succeeded_count: u64,
    pub no_changes_count: u64,
    pub skipped_manual_count: u64,
    pub failed_count: u64,
    pub changed_count: u64,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorRefreshItemDto {
    pub item_id: String,
    pub connector_kind: ConnectorKind,
    pub connection_key: String,
    pub status: RefreshItemStatus,
    pub attempt_generation: u64,
    pub lease_token: Option<String>,
    pub lease_expires_at: Option<String>,
    pub changed_count: u64,
    pub last_error_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedConnectorRefreshBatchDto {
    #[serde(flatten)]
    pub batch: ConnectorRefreshBatchDto,
    pub items: Vec<ConnectorRefreshItemDto>,
}

impl std::ops::Deref for LoadedConnectorRefreshBatchDto {
    type Target = ConnectorRefreshBatchDto;

    fn deref(&self) -> &Self::Target {
        &self.batch
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorRefreshClaimDto {
    pub batch_id: String,
    pub item_id: String,
    pub connector_kind: ConnectorKind,
    pub connection_key: String,
    pub attempt_generation: u64,
    pub lease_token: String,
    pub lease_expires_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ConnectorRefreshError {
    #[error("connector refresh input is invalid")]
    InvalidInput,
    #[error("connector refresh batch item limit exceeded")]
    BatchLimitExceeded,
    #[error("an active connector refresh batch already exists")]
    ActiveBatchExists,
    #[error("connector refresh batch was not found")]
    NotFound,
    #[error("connector refresh lease is stale")]
    StaleLease,
    #[error("connector refresh database is unavailable")]
    Database,
}

impl ConnectorRefreshError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidInput => "CONNECTOR_REFRESH_INVALID_INPUT",
            Self::BatchLimitExceeded => "CONNECTOR_BATCH_LIMIT_EXCEEDED",
            Self::ActiveBatchExists => "CONNECTOR_REFRESH_ACTIVE_BATCH_EXISTS",
            Self::NotFound => "CONNECTOR_REFRESH_NOT_FOUND",
            Self::StaleLease => "CONNECTOR_REFRESH_STALE_LEASE",
            Self::Database => "CONNECTOR_REFRESH_DATABASE_UNAVAILABLE",
        }
    }
}

pub fn create_batch(
    connection: &Connection,
    household_id: &str,
    targets: &[RefreshTarget],
) -> Result<ConnectorRefreshBatchDto, ConnectorRefreshError> {
    validate_identifier(household_id, 128)?;
    if targets.is_empty() {
        return Err(ConnectorRefreshError::InvalidInput);
    }
    if targets.len() > MAX_BATCH_ITEMS {
        return Err(ConnectorRefreshError::BatchLimitExceeded);
    }
    let mut snapshot = BTreeSet::new();
    for target in targets {
        validate_connection_key(target.connector_kind, &target.connection_key)?;
        if !snapshot.insert((target.connector_kind, target.connection_key.clone())) {
            return Err(ConnectorRefreshError::InvalidInput);
        }
    }

    let transaction = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(database_error)?;
    ensure_household(&transaction, household_id)?;
    let manual_count = snapshot
        .iter()
        .filter(|(kind, _)| *kind == ConnectorKind::ManualImport)
        .count();
    let is_terminal = manual_count == snapshot.len();
    if !is_terminal && active_batch_exists(&transaction, household_id)? {
        return Err(ConnectorRefreshError::ActiveBatchExists);
    }
    let now = sqlite_now(&transaction)?;
    let batch_id = random_id(&transaction)?;
    transaction
        .execute(
            "INSERT INTO connector_refresh_batches
               (batch_id,household_id,status,total_count,terminal_count,skipped_manual_count,
                created_at,updated_at,completed_at)
             VALUES(?1,?2,?3,?4,?5,?5,?6,?6,?7)",
            params![
                batch_id,
                household_id,
                if is_terminal { "COMPLETE" } else { "ACTIVE" },
                snapshot.len() as u64,
                manual_count as u64,
                now,
                is_terminal.then_some(now.as_str()),
            ],
        )
        .map_err(database_error)?;
    for (connector_kind, connection_key) in snapshot {
        let manual = connector_kind == ConnectorKind::ManualImport;
        transaction
            .execute(
                "INSERT INTO connector_refresh_batch_items
                   (batch_id,item_id,connector_kind,connection_key,status,created_at,updated_at,
                    completed_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?6,?7)",
                params![
                    batch_id,
                    random_id(&transaction)?,
                    connector_kind_sql(connector_kind),
                    connection_key,
                    if manual { "SKIPPED_MANUAL" } else { "PENDING" },
                    now,
                    manual.then_some(now.as_str()),
                ],
            )
            .map_err(database_error)?;
    }
    let batch = load_batch_row(&transaction, household_id, &batch_id)?;
    transaction.commit().map_err(database_error)?;
    Ok(batch)
}

pub fn load_batch(
    connection: &Connection,
    household_id: &str,
    batch_id: &str,
) -> Result<LoadedConnectorRefreshBatchDto, ConnectorRefreshError> {
    validate_identifier(household_id, 128)?;
    validate_identifier(batch_id, 64)?;
    let batch = load_batch_row(connection, household_id, batch_id)?;
    let mut statement = connection
        .prepare(
            "SELECT item_id,connector_kind,connection_key,status,attempt_generation,
                    lease_token,lease_expires_at,changed_count,last_error_code,
                    created_at,updated_at,started_at,completed_at
             FROM connector_refresh_batch_items WHERE batch_id=?1
             ORDER BY CASE connector_kind
               WHEN 'GOOGLE_DRIVE' THEN 0 WHEN 'GMAIL' THEN 1
               WHEN 'WATCHED_FOLDER' THEN 2 ELSE 3 END,connection_key,item_id",
        )
        .map_err(database_error)?;
    let items = statement
        .query_map([batch_id], item_from_row)
        .map_err(database_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(database_error)?;
    Ok(LoadedConnectorRefreshBatchDto { batch, items })
}

pub fn claim_next(
    connection: &Connection,
    household_id: &str,
    batch_id: &str,
) -> Result<Option<ConnectorRefreshClaimDto>, ConnectorRefreshError> {
    validate_identifier(household_id, 128)?;
    validate_identifier(batch_id, 64)?;
    let transaction = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(database_error)?;
    ensure_active_batch(&transaction, household_id, batch_id)?;
    let item_id = transaction
        .query_row(
            "SELECT item_id FROM connector_refresh_batch_items
             WHERE batch_id=?1 AND status='PENDING'
             ORDER BY CASE connector_kind
               WHEN 'GOOGLE_DRIVE' THEN 0 WHEN 'GMAIL' THEN 1
               WHEN 'WATCHED_FOLDER' THEN 2 ELSE 3 END,connection_key,item_id LIMIT 1",
            [batch_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?;
    let Some(item_id) = item_id else {
        transaction.commit().map_err(database_error)?;
        return Ok(None);
    };
    let changed = transaction
        .execute(
            "UPDATE connector_refresh_batch_items SET
               status='RUNNING',attempt_generation=attempt_generation+1,
               lease_token=lower(hex(randomblob(32))),
               lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?3),
               started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE batch_id=?1 AND item_id=?2 AND status='PENDING'
               AND attempt_generation<9007199254740991",
            params![batch_id, item_id, format!("+{LEASE_MINUTES} minutes")],
        )
        .map_err(database_error)?;
    if changed != 1 {
        return Err(ConnectorRefreshError::StaleLease);
    }
    let claim = transaction
        .query_row(
            "SELECT i.batch_id,i.item_id,i.connector_kind,i.connection_key,
                    i.attempt_generation,i.lease_token,i.lease_expires_at
             FROM connector_refresh_batch_items i
             JOIN connector_refresh_batches b ON b.batch_id=i.batch_id
             WHERE i.batch_id=?1 AND i.item_id=?2 AND b.household_id=?3",
            params![batch_id, item_id, household_id],
            |row| {
                let kind: String = row.get(2)?;
                Ok(ConnectorRefreshClaimDto {
                    batch_id: row.get(0)?,
                    item_id: row.get(1)?,
                    connector_kind: connector_kind_from_sql(&kind)?,
                    connection_key: row.get(3)?,
                    attempt_generation: row.get(4)?,
                    lease_token: row.get(5)?,
                    lease_expires_at: row.get(6)?,
                })
            },
        )
        .map_err(database_error)?;
    transaction.commit().map_err(database_error)?;
    Ok(Some(claim))
}

pub fn heartbeat_item(
    connection: &Connection,
    household_id: &str,
    batch_id: &str,
    item_id: &str,
    lease_token: &str,
    attempt_generation: u64,
) -> Result<(), ConnectorRefreshError> {
    validate_lease_identity(
        household_id,
        batch_id,
        item_id,
        lease_token,
        attempt_generation,
    )?;
    let changed = connection
        .execute(
            "UPDATE connector_refresh_batch_items SET
               lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?6),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE batch_id=?2 AND item_id=?3 AND status='RUNNING'
               AND lease_token=?4 AND attempt_generation=?5
               AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
               AND EXISTS(SELECT 1 FROM connector_refresh_batches b
                 WHERE b.batch_id=?2 AND b.household_id=?1 AND b.status='ACTIVE')",
            params![
                household_id,
                batch_id,
                item_id,
                lease_token,
                attempt_generation,
                format!("+{LEASE_MINUTES} minutes"),
            ],
        )
        .map_err(database_error)?;
    if changed == 1 {
        Ok(())
    } else {
        Err(ConnectorRefreshError::StaleLease)
    }
}

pub fn complete_item(
    connection: &Connection,
    household_id: &str,
    batch_id: &str,
    item_id: &str,
    lease_token: &str,
    attempt_generation: u64,
    outcome: &RefreshOutcome,
) -> Result<ConnectorRefreshBatchDto, ConnectorRefreshError> {
    validate_lease_identity(
        household_id,
        batch_id,
        item_id,
        lease_token,
        attempt_generation,
    )?;
    let (item_status, changed_count, error_code) = outcome_values(outcome)?;
    let transaction = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(database_error)?;
    let changed = transaction
        .execute(
            "UPDATE connector_refresh_batch_items SET status=?6,changed_count=?7,
               last_error_code=?8,lease_token=NULL,lease_expires_at=NULL,
               completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE batch_id=?2 AND item_id=?3 AND status='RUNNING'
               AND lease_token=?4 AND attempt_generation=?5
               AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
               AND EXISTS(SELECT 1 FROM connector_refresh_batches b
                 WHERE b.batch_id=?2 AND b.household_id=?1 AND b.status='ACTIVE')",
            params![
                household_id,
                batch_id,
                item_id,
                lease_token,
                attempt_generation,
                item_status,
                changed_count,
                error_code,
            ],
        )
        .map_err(database_error)?;
    if changed != 1 {
        return Err(ConnectorRefreshError::StaleLease);
    }

    let counts: (u64, u64, u64, u64, u64, u64, u64) = transaction
        .query_row(
            "SELECT count(*),
                    COALESCE(sum(status IN ('SUCCEEDED','NO_CHANGES','SKIPPED_MANUAL',
                                           'FAILED_RETRYABLE','NEEDS_ACTION')),0),
                    COALESCE(sum(status='SUCCEEDED'),0),
                    COALESCE(sum(status='NO_CHANGES'),0),
                    COALESCE(sum(status='SKIPPED_MANUAL'),0),
                    COALESCE(sum(status IN ('FAILED_RETRYABLE','NEEDS_ACTION')),0),
                    COALESCE(sum(changed_count),0)
             FROM connector_refresh_batch_items WHERE batch_id=?1",
            [batch_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .map_err(database_error)?;
    let (total, terminal, succeeded, no_changes, skipped, failed, changed_total) = counts;
    let terminal_status = if terminal != total {
        None
    } else if failed == 0 {
        Some("COMPLETE")
    } else if succeeded + no_changes > 0 {
        Some("PARTIAL")
    } else {
        Some("FAILED")
    };
    transaction
        .execute(
            "UPDATE connector_refresh_batches SET status=COALESCE(?2,'ACTIVE'),
               terminal_count=?3,succeeded_count=?4,no_changes_count=?5,
               skipped_manual_count=?6,failed_count=?7,changed_count=?8,
               completed_at=CASE WHEN ?2 IS NULL THEN NULL
                 ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE batch_id=?1 AND household_id=?9 AND status='ACTIVE'",
            params![
                batch_id,
                terminal_status,
                terminal,
                succeeded,
                no_changes,
                skipped,
                failed,
                changed_total,
                household_id,
            ],
        )
        .map_err(database_error)?;
    let batch = load_batch_row(&transaction, household_id, batch_id)?;
    transaction.commit().map_err(database_error)?;
    Ok(batch)
}

pub fn recover_expired(
    connection: &Connection,
    household_id: &str,
    batch_id: &str,
) -> Result<u64, ConnectorRefreshError> {
    validate_identifier(household_id, 128)?;
    validate_identifier(batch_id, 64)?;
    let transaction = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(database_error)?;
    ensure_active_batch(&transaction, household_id, batch_id)?;
    let changed = transaction
        .execute(
            "UPDATE connector_refresh_batch_items SET status='PENDING',lease_token=NULL,
               lease_expires_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE batch_id=?1 AND status='RUNNING'
               AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            [batch_id],
        )
        .map_err(database_error)?;
    transaction.commit().map_err(database_error)?;
    u64::try_from(changed).map_err(|_| ConnectorRefreshError::Database)
}

pub fn retain_batches(
    connection: &Connection,
    household_id: &str,
) -> Result<u64, ConnectorRefreshError> {
    validate_identifier(household_id, 128)?;
    let transaction = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(database_error)?;
    ensure_household(&transaction, household_id)?;
    let changed = transaction
        .execute(
            "DELETE FROM connector_refresh_batches
             WHERE household_id=?1 AND status!='ACTIVE' AND (
               completed_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')
               OR batch_id IN (
                 SELECT batch_id FROM connector_refresh_batches
                 WHERE household_id=?1 AND status!='ACTIVE'
                 ORDER BY completed_at DESC,batch_id DESC LIMIT -1 OFFSET 100
               )
             )",
            [household_id],
        )
        .map_err(database_error)?;
    transaction.commit().map_err(database_error)?;
    u64::try_from(changed).map_err(|_| ConnectorRefreshError::Database)
}

fn load_batch_row(
    connection: &Connection,
    household_id: &str,
    batch_id: &str,
) -> Result<ConnectorRefreshBatchDto, ConnectorRefreshError> {
    connection
        .query_row(
            "SELECT batch_id,household_id,status,total_count,terminal_count,succeeded_count,
                    no_changes_count,skipped_manual_count,failed_count,changed_count,
                    created_at,updated_at,completed_at
             FROM connector_refresh_batches WHERE batch_id=?1 AND household_id=?2",
            params![batch_id, household_id],
            batch_from_row,
        )
        .optional()
        .map_err(database_error)?
        .ok_or(ConnectorRefreshError::NotFound)
}

fn batch_from_row(row: &Row<'_>) -> rusqlite::Result<ConnectorRefreshBatchDto> {
    let status: String = row.get(2)?;
    Ok(ConnectorRefreshBatchDto {
        batch_id: row.get(0)?,
        household_id: row.get(1)?,
        status: batch_status_from_sql(&status)?,
        total_count: row.get(3)?,
        terminal_count: row.get(4)?,
        succeeded_count: row.get(5)?,
        no_changes_count: row.get(6)?,
        skipped_manual_count: row.get(7)?,
        failed_count: row.get(8)?,
        changed_count: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        completed_at: row.get(12)?,
    })
}

fn item_from_row(row: &Row<'_>) -> rusqlite::Result<ConnectorRefreshItemDto> {
    let kind: String = row.get(1)?;
    let status: String = row.get(3)?;
    Ok(ConnectorRefreshItemDto {
        item_id: row.get(0)?,
        connector_kind: connector_kind_from_sql(&kind)?,
        connection_key: row.get(2)?,
        status: item_status_from_sql(&status)?,
        attempt_generation: row.get(4)?,
        lease_token: row.get(5)?,
        lease_expires_at: row.get(6)?,
        changed_count: row.get(7)?,
        last_error_code: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        started_at: row.get(11)?,
        completed_at: row.get(12)?,
    })
}

fn outcome_values(
    outcome: &RefreshOutcome,
) -> Result<(&'static str, u64, Option<&str>), ConnectorRefreshError> {
    match outcome {
        RefreshOutcome::Succeeded { changed_count }
            if *changed_count > 0 && *changed_count <= MAX_SAFE_INTEGER =>
        {
            Ok(("SUCCEEDED", *changed_count, None))
        }
        RefreshOutcome::Succeeded { .. } => Err(ConnectorRefreshError::InvalidInput),
        RefreshOutcome::NoChanges => Ok(("NO_CHANGES", 0, None)),
        RefreshOutcome::FailedRetryable { error_code } => {
            validate_error_code(error_code)?;
            Ok(("FAILED_RETRYABLE", 0, Some(error_code)))
        }
        RefreshOutcome::NeedsAction { error_code } => {
            validate_error_code(error_code)?;
            Ok(("NEEDS_ACTION", 0, Some(error_code)))
        }
    }
}

fn validate_lease_identity(
    household_id: &str,
    batch_id: &str,
    item_id: &str,
    lease_token: &str,
    attempt_generation: u64,
) -> Result<(), ConnectorRefreshError> {
    validate_identifier(household_id, 128)?;
    validate_identifier(batch_id, 64)?;
    validate_identifier(item_id, 64)?;
    if attempt_generation == 0
        || attempt_generation > MAX_SAFE_INTEGER
        || lease_token.len() != 64
        || !lease_token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ConnectorRefreshError::InvalidInput);
    }
    Ok(())
}

fn validate_identifier(value: &str, maximum: usize) -> Result<(), ConnectorRefreshError> {
    if value.is_empty()
        || value.len() > maximum
        || value.trim() != value
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(ConnectorRefreshError::InvalidInput);
    }
    Ok(())
}

fn validate_connection_key(
    kind: ConnectorKind,
    connection_key: &str,
) -> Result<(), ConnectorRefreshError> {
    if connection_key.is_empty()
        || connection_key.len() > 128
        || connection_key.trim() != connection_key
        || connection_key
            .bytes()
            .any(|byte| !byte.is_ascii_graphic() || byte == b'/')
        || (kind == ConnectorKind::ManualImport && connection_key != "manual-import")
    {
        return Err(ConnectorRefreshError::InvalidInput);
    }
    Ok(())
}

fn validate_error_code(error_code: &str) -> Result<(), ConnectorRefreshError> {
    if error_code.is_empty()
        || error_code.len() > 64
        || !error_code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(ConnectorRefreshError::InvalidInput);
    }
    Ok(())
}

fn ensure_household(
    connection: &Connection,
    household_id: &str,
) -> Result<(), ConnectorRefreshError> {
    let exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM households WHERE id=?1)",
            [household_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(database_error)?;
    if exists {
        Ok(())
    } else {
        Err(ConnectorRefreshError::InvalidInput)
    }
}

fn active_batch_exists(
    connection: &Connection,
    household_id: &str,
) -> Result<bool, ConnectorRefreshError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM connector_refresh_batches
             WHERE household_id=?1 AND status='ACTIVE')",
            [household_id],
            |row| row.get(0),
        )
        .map_err(database_error)
}

fn ensure_active_batch(
    connection: &Connection,
    household_id: &str,
    batch_id: &str,
) -> Result<(), ConnectorRefreshError> {
    let active = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM connector_refresh_batches
             WHERE batch_id=?1 AND household_id=?2 AND status='ACTIVE')",
            params![batch_id, household_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(database_error)?;
    if active {
        Ok(())
    } else {
        Err(ConnectorRefreshError::NotFound)
    }
}

fn sqlite_now(connection: &Connection) -> Result<String, ConnectorRefreshError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
            row.get(0)
        })
        .map_err(database_error)
}

fn random_id(connection: &Connection) -> Result<String, ConnectorRefreshError> {
    connection
        .query_row("SELECT lower(hex(randomblob(32)))", [], |row| row.get(0))
        .map_err(database_error)
}

fn connector_kind_sql(kind: ConnectorKind) -> &'static str {
    match kind {
        ConnectorKind::GoogleDrive => "GOOGLE_DRIVE",
        ConnectorKind::Gmail => "GMAIL",
        ConnectorKind::WatchedFolder => "WATCHED_FOLDER",
        ConnectorKind::ManualImport => "MANUAL_IMPORT",
    }
}

fn connector_kind_from_sql(value: &str) -> rusqlite::Result<ConnectorKind> {
    match value {
        "GOOGLE_DRIVE" => Ok(ConnectorKind::GoogleDrive),
        "GMAIL" => Ok(ConnectorKind::Gmail),
        "WATCHED_FOLDER" => Ok(ConnectorKind::WatchedFolder),
        "MANUAL_IMPORT" => Ok(ConnectorKind::ManualImport),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn batch_status_from_sql(value: &str) -> rusqlite::Result<RefreshBatchStatus> {
    match value {
        "ACTIVE" => Ok(RefreshBatchStatus::Active),
        "COMPLETE" => Ok(RefreshBatchStatus::Complete),
        "PARTIAL" => Ok(RefreshBatchStatus::Partial),
        "FAILED" => Ok(RefreshBatchStatus::Failed),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn item_status_from_sql(value: &str) -> rusqlite::Result<RefreshItemStatus> {
    match value {
        "PENDING" => Ok(RefreshItemStatus::Pending),
        "RUNNING" => Ok(RefreshItemStatus::Running),
        "SUCCEEDED" => Ok(RefreshItemStatus::Succeeded),
        "NO_CHANGES" => Ok(RefreshItemStatus::NoChanges),
        "SKIPPED_MANUAL" => Ok(RefreshItemStatus::SkippedManual),
        "FAILED_RETRYABLE" => Ok(RefreshItemStatus::FailedRetryable),
        "NEEDS_ACTION" => Ok(RefreshItemStatus::NeedsAction),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn database_error(_: rusqlite::Error) -> ConnectorRefreshError {
    ConnectorRefreshError::Database
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{connector_control::ConnectorKind, persistence::AppState};
    use rusqlite::{params, Connection};

    const TEST_KEY: &[u8] = b"connector-refresh-test-key-material-32";

    fn with_database(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(TEST_KEY).expect("migrate refresh database");
        state
            .with_connection(|connection| {
                connection
                    .execute_batch(
                        "INSERT INTO households(id,name) VALUES
                           ('family','Family'),('other','Other'),('third','Third'),
                           ('fourth','Fourth'),('fifth','Fifth');",
                    )
                    .expect("seed households");
                test(connection);
                Ok(())
            })
            .expect("run refresh test");
    }

    fn target(connector_kind: ConnectorKind, connection_key: impl Into<String>) -> RefreshTarget {
        RefreshTarget {
            connector_kind,
            connection_key: connection_key.into(),
        }
    }

    fn claim_and_complete(
        connection: &Connection,
        household_id: &str,
        batch_id: &str,
        outcome: RefreshOutcome,
    ) -> ConnectorRefreshBatchDto {
        let claim = claim_next(connection, household_id, batch_id)
            .expect("claim item")
            .expect("pending item");
        complete_item(
            connection,
            household_id,
            batch_id,
            &claim.item_id,
            &claim.lease_token,
            claim.attempt_generation,
            &outcome,
        )
        .expect("complete item")
    }

    #[test]
    fn snapshot_is_unique_deterministic_and_manual_is_explicitly_terminal() {
        with_database(|connection| {
            let batch = create_batch(
                connection,
                "family",
                &[
                    target(ConnectorKind::ManualImport, "manual-import"),
                    target(ConnectorKind::WatchedFolder, "folder-z"),
                    target(ConnectorKind::GoogleDrive, "drive-z"),
                    target(ConnectorKind::Gmail, "gmail-a"),
                    target(ConnectorKind::GoogleDrive, "drive-a"),
                ],
            )
            .expect("create deterministic snapshot");
            assert_eq!(batch.status, RefreshBatchStatus::Active);
            assert_eq!(batch.total_count, 5);
            assert_eq!(batch.skipped_manual_count, 1);

            let loaded = load_batch(connection, "family", &batch.batch_id).expect("load batch");
            assert_eq!(
                loaded
                    .items
                    .iter()
                    .map(|item| (item.connector_kind, item.connection_key.as_str()))
                    .collect::<Vec<_>>(),
                vec![
                    (ConnectorKind::GoogleDrive, "drive-a"),
                    (ConnectorKind::GoogleDrive, "drive-z"),
                    (ConnectorKind::Gmail, "gmail-a"),
                    (ConnectorKind::WatchedFolder, "folder-z"),
                    (ConnectorKind::ManualImport, "manual-import"),
                ]
            );
            assert_eq!(
                loaded.items.last().unwrap().status,
                RefreshItemStatus::SkippedManual
            );

            assert!(matches!(
                create_batch(
                    connection,
                    "other",
                    &[
                        target(ConnectorKind::Gmail, "same"),
                        target(ConnectorKind::Gmail, "same"),
                    ],
                ),
                Err(ConnectorRefreshError::InvalidInput)
            ));
            assert_eq!(
                connection
                    .query_row(
                        "SELECT count(*) FROM connector_refresh_batches WHERE household_id='other'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                0
            );
        });
    }

    #[test]
    fn batch_limit_accepts_exactly_10000_and_rejects_10001_without_rows() {
        with_database(|connection| {
            let maximum = (0..10_000)
                .map(|index| target(ConnectorKind::GoogleDrive, format!("drive-{index:05}")))
                .collect::<Vec<_>>();
            let accepted = create_batch(connection, "family", &maximum).expect("10,000 items");
            assert_eq!(accepted.total_count, 10_000);
            assert_eq!(
                connection
                    .query_row(
                        "SELECT count(*) FROM connector_refresh_batch_items WHERE batch_id=?1",
                        [&accepted.batch_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                10_000
            );

            let excessive = (0..10_001)
                .map(|index| target(ConnectorKind::Gmail, format!("gmail-{index:05}")))
                .collect::<Vec<_>>();
            let error = create_batch(connection, "other", &excessive).unwrap_err();
            assert_eq!(error, ConnectorRefreshError::BatchLimitExceeded);
            assert_eq!(error.code(), "CONNECTOR_BATCH_LIMIT_EXCEEDED");
            assert_eq!(
                connection
                    .query_row(
                        "SELECT count(*) FROM connector_refresh_batches WHERE household_id='other'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                0
            );
        });
    }

    #[test]
    fn only_one_active_batch_exists_per_household() {
        with_database(|connection| {
            create_batch(
                connection,
                "family",
                &[target(ConnectorKind::GoogleDrive, "drive")],
            )
            .unwrap();
            let error = create_batch(
                connection,
                "family",
                &[target(ConnectorKind::Gmail, "gmail")],
            )
            .unwrap_err();
            assert_eq!(error, ConnectorRefreshError::ActiveBatchExists);
            assert_eq!(
                connection
                    .query_row(
                        "SELECT count(*) FROM connector_refresh_batches WHERE household_id='family'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                1
            );
        });
    }

    #[test]
    fn schema_excludes_provider_material_and_bounds_public_error_codes_and_leases() {
        with_database(|connection| {
            for table in [
                "connector_refresh_batches",
                "connector_refresh_batch_items",
                "connector_runtime_observations",
            ] {
                let mut statement = connection
                    .prepare(&format!("PRAGMA table_info({table})"))
                    .unwrap();
                let columns = statement
                    .query_map([], |row| row.get::<_, String>(1))
                    .unwrap()
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .unwrap();
                for forbidden in [
                    "provider_token",
                    "refresh_token",
                    "provider_cursor",
                    "raw_response",
                    "content",
                    "path",
                ] {
                    assert!(
                        columns.iter().all(|column| !column.contains(forbidden)),
                        "{table} must not persist {forbidden}"
                    );
                }
            }
            assert!(connection
                .execute(
                    "INSERT INTO connector_runtime_observations
                       (household_id,connector_kind,connection_key,last_error_code)
                     VALUES('family','GMAIL','gmail','network timeout')",
                    [],
                )
                .is_err());

            let batch = create_batch(
                connection,
                "family",
                &[target(ConnectorKind::Gmail, "gmail")],
            )
            .unwrap();
            assert!(connection
                .execute(
                    "UPDATE connector_refresh_batch_items
                     SET status='RUNNING',attempt_generation=1,lease_token=?2,
                         lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'),
                         started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE batch_id=?1",
                    params![batch.batch_id, "A".repeat(64)],
                )
                .is_err());
            assert!(connection
                .execute(
                    "UPDATE connector_refresh_batch_items
                     SET status='SUCCEEDED',attempt_generation=1,changed_count=0,
                         started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                         completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE batch_id=?1",
                    [&batch.batch_id],
                )
                .is_err());
        });
    }

    #[test]
    fn claims_are_ordered_and_heartbeat_completion_and_recovery_are_generation_fenced() {
        with_database(|connection| {
            let batch = create_batch(
                connection,
                "family",
                &[
                    target(ConnectorKind::Gmail, "gmail"),
                    target(ConnectorKind::GoogleDrive, "drive"),
                ],
            )
            .unwrap();
            let first = claim_next(connection, "family", &batch.batch_id)
                .unwrap()
                .unwrap();
            assert_eq!(first.connector_kind, ConnectorKind::GoogleDrive);
            assert_eq!(first.connection_key, "drive");
            assert_eq!(first.attempt_generation, 1);
            assert_eq!(first.lease_token.len(), 64);
            assert!(first
                .lease_token
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
            assert!(connection
                .query_row(
                    "SELECT julianday(lease_expires_at)-julianday('now')
                           BETWEEN 4.9/1440.0 AND 5.1/1440.0
                     FROM connector_refresh_batch_items WHERE item_id=?1",
                    [&first.item_id],
                    |row| row.get::<_, bool>(0),
                )
                .unwrap());

            heartbeat_item(
                connection,
                "family",
                &batch.batch_id,
                &first.item_id,
                &first.lease_token,
                first.attempt_generation,
            )
            .expect("current generation heartbeat");
            for (wrong_batch, wrong_item, wrong_token, wrong_generation) in [
                (
                    "f".repeat(64),
                    first.item_id.clone(),
                    first.lease_token.clone(),
                    first.attempt_generation,
                ),
                (
                    batch.batch_id.clone(),
                    "e".repeat(64),
                    first.lease_token.clone(),
                    first.attempt_generation,
                ),
                (
                    batch.batch_id.clone(),
                    first.item_id.clone(),
                    "d".repeat(64),
                    first.attempt_generation,
                ),
                (
                    batch.batch_id.clone(),
                    first.item_id.clone(),
                    first.lease_token.clone(),
                    first.attempt_generation + 1,
                ),
            ] {
                assert_eq!(
                    heartbeat_item(
                        connection,
                        "family",
                        &wrong_batch,
                        &wrong_item,
                        &wrong_token,
                        wrong_generation,
                    )
                    .unwrap_err(),
                    ConnectorRefreshError::StaleLease
                );
            }
            for (wrong_batch, wrong_item, token, generation) in [
                (
                    "f".repeat(64),
                    first.item_id.clone(),
                    first.lease_token.clone(),
                    first.attempt_generation,
                ),
                (
                    batch.batch_id.clone(),
                    "e".repeat(64),
                    first.lease_token.clone(),
                    first.attempt_generation,
                ),
                (
                    batch.batch_id.clone(),
                    first.item_id.clone(),
                    "f".repeat(64),
                    first.attempt_generation,
                ),
                (
                    batch.batch_id.clone(),
                    first.item_id.clone(),
                    first.lease_token.clone(),
                    first.attempt_generation + 1,
                ),
            ] {
                assert_eq!(
                    complete_item(
                        connection,
                        "family",
                        &wrong_batch,
                        &wrong_item,
                        &token,
                        generation,
                        &RefreshOutcome::Succeeded { changed_count: 1 },
                    )
                    .unwrap_err(),
                    ConnectorRefreshError::StaleLease
                );
            }

            connection
                .execute(
                    "UPDATE connector_refresh_batch_items
                     SET lease_expires_at='2000-01-01T00:00:00.000Z'
                     WHERE batch_id=?1 AND item_id=?2",
                    params![batch.batch_id, first.item_id],
                )
                .unwrap();
            assert_eq!(
                recover_expired(connection, "family", &batch.batch_id).unwrap(),
                1
            );
            let recovered = load_batch(connection, "family", &batch.batch_id).unwrap();
            assert_eq!(recovered.items[0].status, RefreshItemStatus::Pending);
            assert!(recovered.items[0].lease_token.is_none());
            assert_eq!(recovered.items[0].attempt_generation, 1);

            let replacement = claim_next(connection, "family", &batch.batch_id)
                .unwrap()
                .unwrap();
            assert_eq!(replacement.item_id, first.item_id);
            assert_eq!(replacement.attempt_generation, 2);
            assert_ne!(replacement.lease_token, first.lease_token);
            assert_eq!(
                complete_item(
                    connection,
                    "family",
                    &batch.batch_id,
                    &first.item_id,
                    &first.lease_token,
                    first.attempt_generation,
                    &RefreshOutcome::Succeeded { changed_count: 1 },
                )
                .unwrap_err(),
                ConnectorRefreshError::StaleLease
            );
        });
    }

    #[test]
    fn terminal_batches_distinguish_partial_failed_and_no_change_success() {
        with_database(|connection| {
            let partial = create_batch(
                connection,
                "family",
                &[
                    target(ConnectorKind::GoogleDrive, "drive"),
                    target(ConnectorKind::Gmail, "gmail"),
                ],
            )
            .unwrap();
            let intermediate = claim_and_complete(
                connection,
                "family",
                &partial.batch_id,
                RefreshOutcome::Succeeded { changed_count: 3 },
            );
            assert_eq!(intermediate.status, RefreshBatchStatus::Active);
            let partial_result = claim_and_complete(
                connection,
                "family",
                &partial.batch_id,
                RefreshOutcome::FailedRetryable {
                    error_code: "NETWORK_TIMEOUT".into(),
                },
            );
            assert_eq!(partial_result.status, RefreshBatchStatus::Partial);
            assert_eq!(partial_result.succeeded_count, 1);
            assert_eq!(partial_result.changed_count, 3);
            assert_eq!(partial_result.failed_count, 1);

            let failed = create_batch(
                connection,
                "other",
                &[
                    target(ConnectorKind::GoogleDrive, "drive"),
                    target(ConnectorKind::Gmail, "gmail"),
                ],
            )
            .unwrap();
            claim_and_complete(
                connection,
                "other",
                &failed.batch_id,
                RefreshOutcome::NeedsAction {
                    error_code: "AUTH_REQUIRED".into(),
                },
            );
            let failed_result = claim_and_complete(
                connection,
                "other",
                &failed.batch_id,
                RefreshOutcome::FailedRetryable {
                    error_code: "NETWORK_TIMEOUT".into(),
                },
            );
            assert_eq!(failed_result.status, RefreshBatchStatus::Failed);
            assert_eq!(failed_result.failed_count, 2);

            let no_change = create_batch(
                connection,
                "third",
                &[
                    target(ConnectorKind::ManualImport, "manual-import"),
                    target(ConnectorKind::WatchedFolder, "folder"),
                ],
            )
            .unwrap();
            let complete = claim_and_complete(
                connection,
                "third",
                &no_change.batch_id,
                RefreshOutcome::NoChanges,
            );
            assert_eq!(complete.status, RefreshBatchStatus::Complete);
            assert_eq!(complete.no_changes_count, 1);
            assert_eq!(complete.skipped_manual_count, 1);
            assert_eq!(complete.failed_count, 0);
        });
    }

    #[test]
    fn terminal_batch_update_failure_rolls_back_item_completion() {
        with_database(|connection| {
            let batch = create_batch(
                connection,
                "family",
                &[target(ConnectorKind::GoogleDrive, "drive")],
            )
            .unwrap();
            let claim = claim_next(connection, "family", &batch.batch_id)
                .unwrap()
                .unwrap();
            connection
                .execute_batch(
                    "CREATE TRIGGER fail_refresh_batch_terminal_update
                     BEFORE UPDATE OF status ON connector_refresh_batches
                     WHEN NEW.status!='ACTIVE'
                     BEGIN SELECT RAISE(ABORT,'injected batch update failure'); END;",
                )
                .unwrap();

            assert!(matches!(
                complete_item(
                    connection,
                    "family",
                    &batch.batch_id,
                    &claim.item_id,
                    &claim.lease_token,
                    claim.attempt_generation,
                    &RefreshOutcome::Succeeded { changed_count: 7 },
                ),
                Err(ConnectorRefreshError::Database)
            ));
            let item: (String, Option<String>, i64) = connection
                .query_row(
                    "SELECT status,lease_token,changed_count
                     FROM connector_refresh_batch_items WHERE item_id=?1",
                    [&claim.item_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
            assert_eq!(item, ("RUNNING".into(), Some(claim.lease_token), 0));
            assert_eq!(
                connection
                    .query_row(
                        "SELECT status FROM connector_refresh_batches WHERE batch_id=?1",
                        [&batch.batch_id],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap(),
                "ACTIVE"
            );
        });
    }

    #[test]
    fn snapshot_insert_failure_rolls_back_batch_and_every_item() {
        with_database(|connection| {
            connection
                .execute_batch(
                    "CREATE TRIGGER fail_second_refresh_item
                     BEFORE INSERT ON connector_refresh_batch_items
                     WHEN NEW.connection_key='gmail'
                     BEGIN SELECT RAISE(ABORT,'injected item insert failure'); END;",
                )
                .unwrap();
            assert_eq!(
                create_batch(
                    connection,
                    "family",
                    &[
                        target(ConnectorKind::GoogleDrive, "drive"),
                        target(ConnectorKind::Gmail, "gmail"),
                    ],
                )
                .unwrap_err(),
                ConnectorRefreshError::Database
            );
            assert_eq!(
                connection
                    .query_row(
                        "SELECT count(*) FROM connector_refresh_batches",
                        [],
                        |row| { row.get::<_, i64>(0) }
                    )
                    .unwrap(),
                0
            );
            assert_eq!(
                connection
                    .query_row(
                        "SELECT count(*) FROM connector_refresh_batch_items",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                0
            );
        });
    }

    #[test]
    fn refresh_transitions_never_advance_provider_state() {
        with_database(|connection| {
            connection
                .execute(
                    "INSERT INTO google_drive_connections
                       (id,household_id,client_id_fingerprint,status,start_page_token,change_page_token)
                     VALUES('drive','family',?1,'AUTHORIZING','start-secret','current-secret')",
                    ["a".repeat(64)],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO gmail_connections
                       (id,household_id,client_id_fingerprint,status,start_history_id,history_id)
                     VALUES('gmail','family',?1,'AUTHORIZING','100','200')",
                    ["b".repeat(64)],
                )
                .unwrap();
            let before: (String, String, String, String) = connection
                .query_row(
                    "SELECT d.start_page_token,d.change_page_token,g.start_history_id,g.history_id
                     FROM google_drive_connections d,gmail_connections g
                     WHERE d.id='drive' AND g.id='gmail'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .unwrap();
            let batch = create_batch(
                connection,
                "family",
                &[
                    target(ConnectorKind::GoogleDrive, "drive"),
                    target(ConnectorKind::Gmail, "gmail"),
                ],
            )
            .unwrap();
            claim_and_complete(
                connection,
                "family",
                &batch.batch_id,
                RefreshOutcome::Succeeded { changed_count: 1 },
            );
            let running = claim_next(connection, "family", &batch.batch_id)
                .unwrap()
                .unwrap();
            connection
                .execute(
                    "UPDATE connector_refresh_batch_items
                     SET lease_expires_at='2000-01-01T00:00:00.000Z'
                     WHERE item_id=?1",
                    [&running.item_id],
                )
                .unwrap();
            recover_expired(connection, "family", &batch.batch_id).unwrap();
            let after: (String, String, String, String) = connection
                .query_row(
                    "SELECT d.start_page_token,d.change_page_token,g.start_history_id,g.history_id
                     FROM google_drive_connections d,gmail_connections g
                     WHERE d.id='drive' AND g.id='gmail'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .unwrap();
            assert_eq!(after, before);
        });
    }

    #[test]
    fn retention_enforces_age_and_latest_100_without_deleting_active_batches() {
        with_database(|connection| {
            connection
                .execute_batch(
                    "INSERT INTO connector_refresh_batches
                       (batch_id,household_id,status,total_count,completed_at,created_at,updated_at)
                     VALUES('active','family','ACTIVE',1,NULL,
                            strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days'),
                            strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')),
                           ('too-old','family','COMPLETE',0,
                            strftime('%Y-%m-%dT%H:%M:%fZ','now','-31 days'),
                            strftime('%Y-%m-%dT%H:%M:%fZ','now','-31 days'),
                            strftime('%Y-%m-%dT%H:%M:%fZ','now','-31 days'));",
                )
                .unwrap();
            for index in 0..101 {
                connection
                    .execute(
                        "INSERT INTO connector_refresh_batches
                           (batch_id,household_id,status,total_count,created_at,updated_at,completed_at)
                         VALUES(?1,'family','COMPLETE',0,
                                strftime('%Y-%m-%dT%H:%M:%fZ','now',?2),
                                strftime('%Y-%m-%dT%H:%M:%fZ','now',?2),
                                strftime('%Y-%m-%dT%H:%M:%fZ','now',?2))",
                        params![format!("recent-{index:03}"), format!("-{index} seconds")],
                    )
                    .unwrap();
            }

            assert_eq!(retain_batches(connection, "family").unwrap(), 2);
            assert_eq!(
                connection
                    .query_row(
                        "SELECT count(*) FROM connector_refresh_batches
                         WHERE household_id='family' AND status!='ACTIVE'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                100
            );
            assert_eq!(
                connection
                    .query_row(
                        "SELECT count(*) FROM connector_refresh_batches WHERE batch_id='active'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                1
            );
        });
    }
}
