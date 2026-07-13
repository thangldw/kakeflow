//! Durable, metadata-only orchestration for files discovered in watched folders.
//!
//! Discovery is intentionally separate from ingestion: rows in this table do
//! not contain file bytes or native paths and no transition posts ledger data.

use crate::watched_folders::WatchedFileMetadataDto;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

const MAX_CLAIM_ITEMS: usize = 25;
const MAX_LIST_ITEMS: u16 = 500;
const DEFAULT_LIST_ITEMS: u16 = 100;
const MAX_ATTEMPTS: i64 = 5;
const MAX_ERROR_CODE_LEN: usize = 64;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum WatchedFileInboxError {
    #[error("invalid watched-file Inbox input")]
    InvalidInput,
    #[error("watched-file Inbox item was not found")]
    NotFound,
    #[error("watched-file Inbox state conflict")]
    Conflict,
    #[error("watched-file Inbox lease is stale")]
    StaleLease,
    #[error("watched-file Inbox retry limit was reached")]
    RetryLimit,
    #[error("watched-file Inbox database operation failed")]
    Database,
}

impl WatchedFileInboxError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput => "Watched-file Inbox input is invalid",
            Self::NotFound => "Watched-file Inbox item was not found",
            Self::Conflict => "Watched-file Inbox item changed; refresh and try again",
            Self::StaleLease => {
                "Watched-file Inbox processing lease expired; refresh and try again"
            }
            Self::RetryLimit => "Watched-file Inbox retry limit was reached",
            Self::Database => "Watched-file Inbox is temporarily unavailable",
        }
    }
}

impl From<rusqlite::Error> for WatchedFileInboxError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Database
    }
}

pub type Result<T> = std::result::Result<T, WatchedFileInboxError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFileInboxItemDto {
    pub id: String,
    pub household_id: String,
    pub watched_folder_id: String,
    pub watched_folder_label: String,
    pub relative_path: String,
    pub file_name: String,
    pub media_type: String,
    pub byte_size: u64,
    pub modified_unix_ms: Option<u64>,
    pub fingerprint: String,
    pub state: String,
    pub attempt_count: u8,
    pub import_run_id: Option<String>,
    pub last_error_code: Option<String>,
    pub discovered_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFileInboxCountsDto {
    pub discovered: u64,
    pub processing: u64,
    pub ready: u64,
    pub needs_mapping: u64,
    pub staged: u64,
    pub failed: u64,
    pub ignored: u64,
    pub removed: u64,
    pub actionable: u64,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFileInboxClaimDto {
    pub lease_token: String,
    pub lease_expires_at: String,
    pub items: Vec<WatchedFileInboxItemDto>,
}

pub fn reconcile_scan(
    connection: &Connection,
    household_id: &str,
    watched_folder_id: &str,
    files: &[WatchedFileMetadataDto],
) -> Result<()> {
    if !valid_identifier(household_id) || !valid_identifier(watched_folder_id) {
        return Err(WatchedFileInboxError::InvalidInput);
    }
    let mut normalized = Vec::with_capacity(files.len());
    let mut seen_paths = BTreeSet::new();
    for file in files {
        validate_metadata(file)?;
        if !seen_paths.insert(file.relative_path.clone()) {
            return Err(WatchedFileInboxError::InvalidInput);
        }
        normalized.push((file, metadata_fingerprint(file)));
    }

    let transaction = connection.unchecked_transaction()?;
    require_enabled_folder(&transaction, household_id, watched_folder_id)?;

    let existing_paths = {
        let mut statement = transaction.prepare(
            "SELECT DISTINCT relative_path FROM watched_file_inbox
             WHERE household_id=?1 AND watched_folder_id=?2 AND state!='STAGED'",
        )?;
        let paths = statement
            .query_map(params![household_id, watched_folder_id], |row| row.get(0))?
            .collect::<std::result::Result<Vec<String>, _>>()?;
        paths
    };

    for path in existing_paths {
        if !seen_paths.contains(&path) {
            transaction.execute(
                "UPDATE watched_file_inbox
                 SET state='REMOVED', lease_token=NULL, lease_expires_at=NULL,
                     processing_origin_state=NULL, last_error_code=NULL,
                     import_run_id=NULL,
                     updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE household_id=?1 AND watched_folder_id=?2
                   AND relative_path=?3 AND state NOT IN ('REMOVED','STAGED')",
                params![household_id, watched_folder_id, path],
            )?;
        }
    }

    for (file, fingerprint) in normalized {
        // A changed fingerprint is a new immutable generation. Older active
        // generations remain auditable but are marked removed from the folder.
        transaction.execute(
            "UPDATE watched_file_inbox
             SET state='REMOVED', lease_token=NULL, lease_expires_at=NULL,
                 processing_origin_state=NULL, last_error_code=NULL,
                 import_run_id=NULL,
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE household_id=?1 AND watched_folder_id=?2 AND relative_path=?3
               AND fingerprint!=?4 AND state NOT IN ('REMOVED','STAGED')",
            params![
                household_id,
                watched_folder_id,
                file.relative_path,
                fingerprint
            ],
        )?;
        let id = generation_id(watched_folder_id, &file.relative_path, &fingerprint);
        let byte_size =
            i64::try_from(file.byte_size).map_err(|_| WatchedFileInboxError::InvalidInput)?;
        let modified = file
            .modified_unix_ms
            .map(i64::try_from)
            .transpose()
            .map_err(|_| WatchedFileInboxError::InvalidInput)?;
        transaction.execute(
            "INSERT INTO watched_file_inbox (
                 id, household_id, watched_folder_id, relative_path, file_name,
                 media_type, byte_size, modified_unix_ms, fingerprint, state
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'DISCOVERED')
             ON CONFLICT(watched_folder_id,relative_path,fingerprint) DO UPDATE SET
                 file_name=excluded.file_name,
                 media_type=excluded.media_type,
                 byte_size=excluded.byte_size,
                 modified_unix_ms=excluded.modified_unix_ms,
                 state=CASE
                    WHEN watched_file_inbox.state='REMOVED' THEN 'DISCOVERED'
                    ELSE watched_file_inbox.state END,
                 updated_at=CASE
                    WHEN watched_file_inbox.state='REMOVED'
                    THEN strftime('%Y-%m-%dT%H:%M:%fZ','now')
                    ELSE watched_file_inbox.updated_at END",
            params![
                id,
                household_id,
                watched_folder_id,
                file.relative_path,
                file.file_name,
                file.media_type,
                byte_size,
                modified,
                fingerprint
            ],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

pub fn list(
    connection: &Connection,
    household_id: &str,
    state: Option<&str>,
    limit: Option<u16>,
) -> Result<Vec<WatchedFileInboxItemDto>> {
    if !valid_identifier(household_id) || state.is_some_and(|value| !valid_state(value)) {
        return Err(WatchedFileInboxError::InvalidInput);
    }
    let limit = limit.unwrap_or(DEFAULT_LIST_ITEMS);
    if limit == 0 || limit > MAX_LIST_ITEMS {
        return Err(WatchedFileInboxError::InvalidInput);
    }
    recover_expired_leases(connection, household_id)?;
    let mut statement = connection.prepare(
        "SELECT i.id,i.household_id,i.watched_folder_id,wf.label,i.relative_path,
                i.file_name,i.media_type,i.byte_size,i.modified_unix_ms,i.fingerprint,
                i.state,i.attempt_count,i.import_run_id,i.last_error_code,
                i.discovered_at,i.updated_at
         FROM watched_file_inbox i JOIN watched_folders wf ON wf.id=i.watched_folder_id
         WHERE i.household_id=?1 AND (?2 IS NULL OR i.state=?2)
         ORDER BY CASE i.state
             WHEN 'FAILED' THEN 0 WHEN 'NEEDS_MAPPING' THEN 1 WHEN 'READY' THEN 2
             WHEN 'DISCOVERED' THEN 3 WHEN 'PROCESSING' THEN 4 WHEN 'STAGED' THEN 5
             WHEN 'IGNORED' THEN 6 ELSE 7 END,
             i.updated_at DESC,i.id LIMIT ?3",
    )?;
    let rows = statement.query_map(
        params![household_id, state, i64::from(limit)],
        item_from_row,
    )?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

pub fn counts(connection: &Connection, household_id: &str) -> Result<WatchedFileInboxCountsDto> {
    if !valid_identifier(household_id) {
        return Err(WatchedFileInboxError::InvalidInput);
    }
    recover_expired_leases(connection, household_id)?;
    connection
        .query_row(
            "SELECT
               COALESCE(SUM(state='DISCOVERED'),0), COALESCE(SUM(state='PROCESSING'),0),
               COALESCE(SUM(state='READY'),0), COALESCE(SUM(state='NEEDS_MAPPING'),0),
               COALESCE(SUM(state='STAGED'),0), COALESCE(SUM(state='FAILED'),0),
               COALESCE(SUM(state='IGNORED'),0), COALESCE(SUM(state='REMOVED'),0),
               COALESCE(SUM(state IN ('DISCOVERED','READY','NEEDS_MAPPING','FAILED')),0),
               count(*) FROM watched_file_inbox WHERE household_id=?1",
            [household_id],
            |row| {
                Ok(WatchedFileInboxCountsDto {
                    discovered: row.get(0)?,
                    processing: row.get(1)?,
                    ready: row.get(2)?,
                    needs_mapping: row.get(3)?,
                    staged: row.get(4)?,
                    failed: row.get(5)?,
                    ignored: row.get(6)?,
                    removed: row.get(7)?,
                    actionable: row.get(8)?,
                    total: row.get(9)?,
                })
            },
        )
        .map_err(Into::into)
}

pub fn claim(
    connection: &Connection,
    household_id: &str,
    item_ids: &[String],
) -> Result<WatchedFileInboxClaimDto> {
    if !valid_identifier(household_id)
        || item_ids.is_empty()
        || item_ids.len() > MAX_CLAIM_ITEMS
        || item_ids.iter().any(|id| !canonical_hash(id))
        || item_ids.iter().collect::<BTreeSet<_>>().len() != item_ids.len()
    {
        return Err(WatchedFileInboxError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    recover_expired_leases_in(&transaction, household_id)?;
    for id in item_ids {
        let row = transaction
            .query_row(
                "SELECT state,attempt_count FROM watched_file_inbox
                 WHERE id=?1 AND household_id=?2",
                params![id, household_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let Some((state, attempt_count)) = row else {
            return Err(WatchedFileInboxError::NotFound);
        };
        if !matches!(state.as_str(), "DISCOVERED" | "READY" | "NEEDS_MAPPING") {
            return Err(WatchedFileInboxError::Conflict);
        }
        if state == "DISCOVERED" && attempt_count >= MAX_ATTEMPTS {
            return Err(WatchedFileInboxError::RetryLimit);
        }
    }
    let lease_token = lease_token(household_id, item_ids);
    for id in item_ids {
        let changed = transaction.execute(
            "UPDATE watched_file_inbox SET
                 processing_origin_state=state,
                 state='PROCESSING',
                 attempt_count=attempt_count+CASE WHEN state='DISCOVERED' THEN 1 ELSE 0 END,
                 lease_token=?1,
                 lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'),
                 last_error_code=NULL,
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id=?2 AND household_id=?3
               AND state IN ('DISCOVERED','READY','NEEDS_MAPPING')",
            params![lease_token, id, household_id],
        )?;
        if changed != 1 {
            return Err(WatchedFileInboxError::Conflict);
        }
    }
    let lease_expires_at: String = transaction.query_row(
        "SELECT lease_expires_at FROM watched_file_inbox WHERE id=?1",
        [&item_ids[0]],
        |row| row.get(0),
    )?;
    let items = load_items_by_ids(&transaction, household_id, item_ids)?;
    transaction.commit()?;
    Ok(WatchedFileInboxClaimDto {
        lease_token,
        lease_expires_at,
        items,
    })
}

pub fn mark_ready(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
    token: &str,
) -> Result<WatchedFileInboxItemDto> {
    complete_lease(
        connection,
        household_id,
        item_id,
        token,
        "READY",
        None,
        None,
    )
}

pub fn mark_needs_mapping(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
    token: &str,
) -> Result<WatchedFileInboxItemDto> {
    complete_lease(
        connection,
        household_id,
        item_id,
        token,
        "NEEDS_MAPPING",
        None,
        None,
    )
}

pub fn mark_failed(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
    token: &str,
    error_code: &str,
) -> Result<WatchedFileInboxItemDto> {
    if !valid_error_code(error_code) {
        return Err(WatchedFileInboxError::InvalidInput);
    }
    complete_lease(
        connection,
        household_id,
        item_id,
        token,
        "FAILED",
        None,
        Some(error_code),
    )
}

pub fn mark_staged(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
    token: &str,
    import_run_id: &str,
) -> Result<WatchedFileInboxItemDto> {
    if !valid_identifier(import_run_id) {
        return Err(WatchedFileInboxError::InvalidInput);
    }
    complete_lease(
        connection,
        household_id,
        item_id,
        token,
        "STAGED",
        Some(import_run_id),
        None,
    )
}

pub fn ignore(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
) -> Result<WatchedFileInboxItemDto> {
    user_transition(
        connection,
        household_id,
        item_id,
        "IGNORED",
        &["DISCOVERED", "READY", "NEEDS_MAPPING", "FAILED"],
        false,
    )
}

pub fn retry(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
) -> Result<WatchedFileInboxItemDto> {
    if !valid_identifier(household_id) || !canonical_hash(item_id) {
        return Err(WatchedFileInboxError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    let current = transaction
        .query_row(
            "SELECT i.state,ir.status FROM watched_file_inbox i
             LEFT JOIN import_runs ir ON ir.id=i.import_run_id
             WHERE i.id=?1 AND i.household_id=?2",
            params![item_id, household_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?;
    let Some((state, run_status)) = current else {
        return Err(WatchedFileInboxError::NotFound);
    };
    let allowed = matches!(state.as_str(), "FAILED" | "IGNORED")
        || (state == "STAGED" && run_status.as_deref() == Some("ROLLED_BACK"));
    if !allowed {
        return Err(WatchedFileInboxError::Conflict);
    }
    let changed = transaction.execute(
        "UPDATE watched_file_inbox SET state='DISCOVERED',attempt_count=0,
             import_run_id=NULL,last_error_code=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?1 AND household_id=?2 AND state=?3",
        params![item_id, household_id, state],
    )?;
    if changed != 1 {
        return Err(WatchedFileInboxError::Conflict);
    }
    let item = load_item(&transaction, household_id, item_id)?;
    transaction.commit()?;
    Ok(item)
}

fn complete_lease(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
    token: &str,
    next_state: &str,
    import_run_id: Option<&str>,
    error_code: Option<&str>,
) -> Result<WatchedFileInboxItemDto> {
    if !valid_identifier(household_id) || !canonical_hash(item_id) || !canonical_hash(token) {
        return Err(WatchedFileInboxError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    if let Some(run_id) = import_run_id {
        let valid: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM import_runs
             WHERE id=?1 AND household_id=?2
               AND status IN ('DISCOVERED','EXTRACTING','REVIEW_REQUIRED'))",
            params![run_id, household_id],
            |row| row.get(0),
        )?;
        if !valid {
            return Err(WatchedFileInboxError::Conflict);
        }
    }
    let changed = transaction.execute(
        "UPDATE watched_file_inbox SET state=?1, lease_token=NULL,
             lease_expires_at=NULL, processing_origin_state=NULL,
             import_run_id=?2, last_error_code=?3,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?4 AND household_id=?5 AND state='PROCESSING'
           AND lease_token=?6
           AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![
            next_state,
            import_run_id,
            error_code,
            item_id,
            household_id,
            token
        ],
    )?;
    if changed != 1 {
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM watched_file_inbox WHERE id=?1 AND household_id=?2)",
            params![item_id, household_id],
            |row| row.get(0),
        )?;
        return Err(if exists {
            WatchedFileInboxError::StaleLease
        } else {
            WatchedFileInboxError::NotFound
        });
    }
    let item = load_item(&transaction, household_id, item_id)?;
    transaction.commit()?;
    Ok(item)
}

fn user_transition(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
    next_state: &str,
    allowed: &[&str],
    reset_attempts: bool,
) -> Result<WatchedFileInboxItemDto> {
    if !valid_identifier(household_id) || !canonical_hash(item_id) {
        return Err(WatchedFileInboxError::InvalidInput);
    }
    let current: Option<String> = connection
        .query_row(
            "SELECT state FROM watched_file_inbox WHERE id=?1 AND household_id=?2",
            params![item_id, household_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(current) = current else {
        return Err(WatchedFileInboxError::NotFound);
    };
    if !allowed.contains(&current.as_str()) {
        return Err(WatchedFileInboxError::Conflict);
    }
    let changed = connection.execute(
        "UPDATE watched_file_inbox SET state=?1,
             attempt_count=CASE WHEN ?2 THEN 0 ELSE attempt_count END,
             last_error_code=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?3 AND household_id=?4 AND state=?5",
        params![next_state, reset_attempts, item_id, household_id, current],
    )?;
    if changed != 1 {
        return Err(WatchedFileInboxError::Conflict);
    }
    load_item(connection, household_id, item_id)
}

fn recover_expired_leases(connection: &Connection, household_id: &str) -> Result<()> {
    let transaction = connection.unchecked_transaction()?;
    recover_expired_leases_in(&transaction, household_id)?;
    transaction.commit()?;
    Ok(())
}

fn recover_expired_leases_in(transaction: &Transaction<'_>, household_id: &str) -> Result<()> {
    transaction.execute(
        "UPDATE watched_file_inbox SET
             state=CASE
               WHEN processing_origin_state='DISCOVERED' AND attempt_count>=?1 THEN 'FAILED'
               ELSE processing_origin_state END,
             last_error_code=CASE
               WHEN processing_origin_state='DISCOVERED' AND attempt_count>=?1
               THEN 'LEASE_EXPIRED' ELSE NULL END,
             lease_token=NULL, lease_expires_at=NULL, processing_origin_state=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?2 AND state='PROCESSING'
           AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![MAX_ATTEMPTS, household_id],
    )?;
    Ok(())
}

fn load_items_by_ids(
    connection: &Connection,
    household_id: &str,
    item_ids: &[String],
) -> Result<Vec<WatchedFileInboxItemDto>> {
    item_ids
        .iter()
        .map(|id| load_item(connection, household_id, id))
        .collect()
}

fn load_item(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
) -> Result<WatchedFileInboxItemDto> {
    connection
        .query_row(
            "SELECT i.id,i.household_id,i.watched_folder_id,wf.label,i.relative_path,
                    i.file_name,i.media_type,i.byte_size,i.modified_unix_ms,i.fingerprint,
                    i.state,i.attempt_count,i.import_run_id,i.last_error_code,
                    i.discovered_at,i.updated_at
             FROM watched_file_inbox i JOIN watched_folders wf ON wf.id=i.watched_folder_id
             WHERE i.id=?1 AND i.household_id=?2",
            params![item_id, household_id],
            item_from_row,
        )
        .optional()?
        .ok_or(WatchedFileInboxError::NotFound)
}

fn item_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WatchedFileInboxItemDto> {
    let byte_size: i64 = row.get(7)?;
    let modified: Option<i64> = row.get(8)?;
    let attempts: i64 = row.get(11)?;
    Ok(WatchedFileInboxItemDto {
        id: row.get(0)?,
        household_id: row.get(1)?,
        watched_folder_id: row.get(2)?,
        watched_folder_label: row.get(3)?,
        relative_path: row.get(4)?,
        file_name: row.get(5)?,
        media_type: row.get(6)?,
        byte_size: u64::try_from(byte_size)
            .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(7, byte_size))?,
        modified_unix_ms: modified
            .map(|value| {
                u64::try_from(value).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(8, value))
            })
            .transpose()?,
        fingerprint: row.get(9)?,
        state: row.get(10)?,
        attempt_count: u8::try_from(attempts)
            .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(11, attempts))?,
        import_run_id: row.get(12)?,
        last_error_code: row.get(13)?,
        discovered_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn require_enabled_folder(
    transaction: &Transaction<'_>,
    household_id: &str,
    watched_folder_id: &str,
) -> Result<()> {
    let valid: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM watched_folders
         WHERE id=?1 AND household_id=?2 AND is_enabled=1)",
        params![watched_folder_id, household_id],
        |row| row.get(0),
    )?;
    if valid {
        Ok(())
    } else {
        Err(WatchedFileInboxError::NotFound)
    }
}

fn metadata_fingerprint(file: &WatchedFileMetadataDto) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"KakeFlow watched file metadata fingerprint v1\0");
    hash_part(&mut hasher, file.relative_path.as_bytes());
    hash_part(&mut hasher, file.media_type.as_bytes());
    hasher.update(file.byte_size.to_be_bytes());
    match file.modified_unix_ms {
        Some(value) => {
            hasher.update([1]);
            hasher.update(value.to_be_bytes());
        }
        None => hasher.update([0]),
    }
    format!("{:x}", hasher.finalize())
}

fn generation_id(watched_folder_id: &str, relative_path: &str, fingerprint: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"KakeFlow watched file generation id v1\0");
    hash_part(&mut hasher, watched_folder_id.as_bytes());
    hash_part(&mut hasher, relative_path.as_bytes());
    hash_part(&mut hasher, fingerprint.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn lease_token(household_id: &str, item_ids: &[String]) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut hasher = Sha256::new();
    hasher.update(b"KakeFlow watched file lease v1\0");
    hash_part(&mut hasher, household_id.as_bytes());
    hasher.update(std::process::id().to_be_bytes());
    hasher.update(now.to_be_bytes());
    for id in item_ids {
        hash_part(&mut hasher, id.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn hash_part(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

fn validate_metadata(file: &WatchedFileMetadataDto) -> Result<()> {
    if !valid_relative_path(&file.relative_path)
        || file.file_name.is_empty()
        || file.file_name.len() > 255
        || file.media_type.is_empty()
        || file.media_type.len() > 127
        || file.byte_size > 52_428_800
    {
        return Err(WatchedFileInboxError::InvalidInput);
    }
    Ok(())
}

fn valid_relative_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4096
        && !path.starts_with('/')
        && !path.ends_with('/')
        && !path.contains('\\')
        && !path.contains('\0')
        && path
            .split('/')
            .all(|component| !component.is_empty() && component != "." && component != "..")
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn canonical_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_state(value: &str) -> bool {
    matches!(
        value,
        "DISCOVERED"
            | "PROCESSING"
            | "READY"
            | "NEEDS_MAPPING"
            | "STAGED"
            | "FAILED"
            | "IGNORED"
            | "REMOVED"
    )
}

fn valid_error_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ERROR_CODE_LEN
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        connection
            .execute_batch(include_str!("../migrations/0001_household_accounts.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0002_import_provenance.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0003_candidates.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0004_transactions_journal.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0008_watched_folders.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0028_watched_file_inbox.sql"))
            .unwrap();
        connection
            .execute(
                "INSERT INTO households(id,name) VALUES ('home','Home'),('other','Other')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO watched_folders(id,household_id,label,canonical_path) VALUES
                 ('folder-home','home','Inbox','/private/home'),
                 ('folder-other','other','Inbox','/private/other')",
                [],
            )
            .unwrap();
        connection
    }

    fn file(path: &str, bytes: u64, modified: u64) -> WatchedFileMetadataDto {
        WatchedFileMetadataDto {
            relative_path: path.to_owned(),
            file_name: path.rsplit('/').next().unwrap().to_owned(),
            media_type: "text/csv".to_owned(),
            byte_size: bytes,
            modified_unix_ms: Some(modified),
        }
    }

    fn discovered(connection: &Connection) -> WatchedFileInboxItemDto {
        reconcile_scan(
            connection,
            "home",
            "folder-home",
            &[file("bank/july.csv", 100, 1)],
        )
        .unwrap();
        list(connection, "home", Some("DISCOVERED"), None)
            .unwrap()
            .remove(0)
    }

    #[test]
    fn repeated_event_and_poll_are_idempotent_but_modified_metadata_is_a_new_generation() {
        let connection = database();
        let first = discovered(&connection);
        reconcile_scan(
            &connection,
            "home",
            "folder-home",
            &[file("bank/july.csv", 100, 1)],
        )
        .unwrap();
        assert_eq!(counts(&connection, "home").unwrap().total, 1);

        reconcile_scan(
            &connection,
            "home",
            "folder-home",
            &[file("bank/july.csv", 101, 2)],
        )
        .unwrap();
        let all = list(&connection, "home", None, None).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all
            .iter()
            .any(|item| item.id == first.id && item.state == "REMOVED"));
        assert!(all
            .iter()
            .any(|item| item.id != first.id && item.state == "DISCOVERED"));
        reconcile_scan(&connection, "home", "folder-home", &[]).unwrap();
        assert_eq!(
            list(&connection, "home", Some("REMOVED"), None)
                .unwrap()
                .len(),
            2
        );
        let columns = connection
            .prepare("PRAGMA table_info(watched_file_inbox)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert!(!columns.iter().any(|column| {
            matches!(
                column.as_str(),
                "canonical_path" | "absolute_path" | "bytes"
            )
        }));
    }

    #[test]
    fn claim_is_household_scoped_and_stale_or_wrong_leases_are_rejected() {
        let connection = database();
        let item = discovered(&connection);
        assert_eq!(
            claim(&connection, "other", std::slice::from_ref(&item.id)),
            Err(WatchedFileInboxError::NotFound)
        );
        let lease = claim(&connection, "home", std::slice::from_ref(&item.id)).unwrap();
        assert_eq!(lease.items[0].state, "PROCESSING");
        assert_eq!(lease.items[0].attempt_count, 1);
        assert_eq!(
            mark_ready(&connection, "home", &item.id, &"0".repeat(64)),
            Err(WatchedFileInboxError::StaleLease)
        );
        let ready = mark_ready(&connection, "home", &item.id, &lease.lease_token).unwrap();
        assert_eq!(ready.state, "READY");
        assert_eq!(
            mark_ready(&connection, "home", &item.id, &lease.lease_token),
            Err(WatchedFileInboxError::StaleLease)
        );
    }

    #[test]
    fn restart_rehydration_of_ready_and_needs_mapping_does_not_spend_retry_budget() {
        let connection = database();
        let item = discovered(&connection);
        let lease = claim(&connection, "home", std::slice::from_ref(&item.id)).unwrap();
        mark_needs_mapping(&connection, "home", &item.id, &lease.lease_token).unwrap();

        for _ in 0..10 {
            let lease = claim(&connection, "home", std::slice::from_ref(&item.id)).unwrap();
            assert_eq!(lease.items[0].attempt_count, 1);
            mark_needs_mapping(&connection, "home", &item.id, &lease.lease_token).unwrap();
        }
        let mapping = list(&connection, "home", Some("NEEDS_MAPPING"), None).unwrap();
        assert_eq!(mapping[0].attempt_count, 1);

        let _lease = claim(&connection, "home", std::slice::from_ref(&item.id)).unwrap();
        connection
            .execute(
                "UPDATE watched_file_inbox SET lease_expires_at='2000-01-01T00:00:00.000Z'
                 WHERE id=?1",
                [&item.id],
            )
            .unwrap();
        let recovered = list(&connection, "home", Some("NEEDS_MAPPING"), None).unwrap();
        assert_eq!(recovered[0].attempt_count, 1);
        let lease = claim(&connection, "home", std::slice::from_ref(&item.id)).unwrap();
        mark_ready(&connection, "home", &item.id, &lease.lease_token).unwrap();
        for _ in 0..10 {
            let lease = claim(&connection, "home", std::slice::from_ref(&item.id)).unwrap();
            assert_eq!(lease.items[0].attempt_count, 1);
            mark_ready(&connection, "home", &item.id, &lease.lease_token).unwrap();
        }
    }

    #[test]
    fn failure_retry_and_ignore_transitions_are_explicit_and_bounded() {
        let connection = database();
        let item = discovered(&connection);
        let lease = claim(&connection, "home", std::slice::from_ref(&item.id)).unwrap();
        let failed = mark_failed(
            &connection,
            "home",
            &item.id,
            &lease.lease_token,
            "PARSER_FAILED",
        )
        .unwrap();
        assert_eq!(failed.state, "FAILED");
        assert_eq!(failed.last_error_code.as_deref(), Some("PARSER_FAILED"));
        let retried = retry(&connection, "home", &item.id).unwrap();
        assert_eq!(retried.state, "DISCOVERED");
        assert_eq!(retried.attempt_count, 0);
        let ignored = ignore(&connection, "home", &item.id).unwrap();
        assert_eq!(ignored.state, "IGNORED");
        assert_eq!(counts(&connection, "home").unwrap().actionable, 0);
        let ledger_rows: i64 = connection
            .query_row("SELECT count(*) FROM transactions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            ledger_rows, 0,
            "Inbox orchestration must never post ledger data"
        );
    }

    #[test]
    fn five_expired_fresh_discovery_leases_become_a_bounded_failure() {
        let connection = database();
        let item = discovered(&connection);
        for attempt in 1..=5 {
            let lease = claim(&connection, "home", std::slice::from_ref(&item.id)).unwrap();
            assert_eq!(lease.items[0].attempt_count, attempt);
            connection
                .execute(
                    "UPDATE watched_file_inbox
                     SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?1",
                    [&item.id],
                )
                .unwrap();
            let _ = counts(&connection, "home").unwrap();
            if attempt < 5 {
                assert_eq!(
                    list(&connection, "home", Some("DISCOVERED"), None).unwrap()[0].attempt_count,
                    attempt
                );
            }
        }
        let failed = list(&connection, "home", Some("FAILED"), None).unwrap();
        assert_eq!(failed[0].attempt_count, 5);
        assert_eq!(failed[0].last_error_code.as_deref(), Some("LEASE_EXPIRED"));
        assert_eq!(
            claim(&connection, "home", &[item.id]),
            Err(WatchedFileInboxError::Conflict)
        );
    }

    #[test]
    fn staged_item_retries_only_after_its_import_run_is_rolled_back() {
        let connection = database();
        let item = discovered(&connection);
        connection
            .execute(
                "INSERT INTO import_runs(id,household_id,status) VALUES
                 ('run-home','home','REVIEW_REQUIRED'),
                 ('run-other','other','REVIEW_REQUIRED')",
                [],
            )
            .unwrap();
        let lease = claim(&connection, "home", std::slice::from_ref(&item.id)).unwrap();
        assert_eq!(
            mark_staged(
                &connection,
                "home",
                &item.id,
                &lease.lease_token,
                "run-other"
            ),
            Err(WatchedFileInboxError::Conflict)
        );
        let staged = mark_staged(
            &connection,
            "home",
            &item.id,
            &lease.lease_token,
            "run-home",
        )
        .unwrap();
        assert_eq!(staged.state, "STAGED");
        assert_eq!(
            retry(&connection, "home", &item.id),
            Err(WatchedFileInboxError::Conflict)
        );
        connection
            .execute(
                "UPDATE import_runs SET status='ROLLED_BACK',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='run-home'",
                [],
            )
            .unwrap();
        let retried = retry(&connection, "home", &item.id).unwrap();
        assert_eq!(retried.state, "DISCOVERED");
        assert_eq!(retried.import_run_id, None);
    }

    #[test]
    fn malformed_relative_paths_are_rejected_before_persistence() {
        let connection = database();
        for path in [
            "/absolute.csv",
            "../escape.csv",
            "a/../escape.csv",
            "a\\b.csv",
        ] {
            assert_eq!(
                reconcile_scan(&connection, "home", "folder-home", &[file(path, 1, 1)]),
                Err(WatchedFileInboxError::InvalidInput)
            );
        }
        assert_eq!(counts(&connection, "home").unwrap().total, 0);
    }
}
