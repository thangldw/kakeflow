//! Durable Google Drive connector state.
//!
//! This module owns only SQLite metadata. OAuth secrets and downloaded bytes
//! are deliberately handled by their dedicated native services. Every
//! mutation is household scoped and network workers must present a current
//! schedule or Inbox lease before advancing durable state.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use thiserror::Error;

pub const DRIVE_READONLY_SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";
const SCHEDULE_LEASE_MINUTES: u32 = 2;
const INBOX_LEASE_MINUTES: u32 = 5;
const MAX_INBOX_ATTEMPTS: i64 = 5;
const MAX_BATCH: usize = 100;

#[derive(Debug, Error)]
pub enum GoogleDriveStoreError {
    #[error("Google Drive connector input is invalid")]
    InvalidInput,
    #[error("Google Drive connector record was not found")]
    NotFound,
    #[error("Google Drive connector state changed; refresh and try again")]
    Conflict,
    #[error("Google Drive connector lease is stale")]
    StaleLease,
    #[error("Google Drive connector database operation failed")]
    Database(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, GoogleDriveStoreError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveConnectionDto {
    pub id: String,
    pub household_id: String,
    pub google_account_id: Option<String>,
    pub account_email: Option<String>,
    pub client_id_fingerprint: String,
    pub drive_id: Option<String>,
    pub root_folder_id: Option<String>,
    pub root_folder_name: Option<String>,
    pub root_resource_key: Option<String>,
    pub status: String,
    pub start_page_token: Option<String>,
    pub change_page_token: Option<String>,
    pub last_full_scan_at: Option<String>,
    pub last_change_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteNode {
    pub file_id: String,
    pub parent_file_id: Option<String>,
    pub name: String,
    pub mime_type: String,
    pub modified_time: Option<String>,
    pub byte_size: Option<u64>,
    pub md5_checksum: Option<String>,
    pub drive_version: Option<String>,
    pub is_folder: bool,
    pub can_download: bool,
    pub is_in_selected_tree: bool,
    pub is_trashed: bool,
    pub disposition: DiscoveryDisposition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoveryDisposition {
    Reviewable,
    TooLarge,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveInboxItemDto {
    pub id: String,
    pub household_id: String,
    pub connection_id: String,
    pub file_id: String,
    pub generation_fingerprint: String,
    pub file_name: String,
    pub media_type: String,
    pub remote_byte_size: Option<u64>,
    pub remote_modified_at: Option<String>,
    pub remote_md5_checksum: Option<String>,
    pub drive_version: Option<String>,
    pub content_sha256: Option<String>,
    pub state: String,
    pub attempt_count: u8,
    pub import_run_id: Option<String>,
    pub last_error_code: Option<String>,
    pub discovered_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InboxLeaseDto {
    pub lease_token: String,
    pub lease_expires_at: String,
    pub items: Vec<GoogleDriveInboxItemDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncScheduleDto {
    pub connection_id: String,
    pub enabled: bool,
    pub interval_minutes: u32,
    pub next_due_at: Option<String>,
    pub running: bool,
    pub lease_expires_at: Option<String>,
    pub last_attempt_at: Option<String>,
    pub last_success_at: Option<String>,
    pub last_result: String,
    pub last_discovered_count: u64,
    pub consecutive_failures: u8,
    pub suspended_until: Option<String>,
    pub suspension_reason: Option<String>,
    pub last_error_code: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncLeaseDto {
    pub household_id: String,
    pub connection_id: String,
    pub lease_token: String,
    pub lease_expires_at: String,
    pub change_page_token: String,
}

/// Starts a device-local OAuth connection record. A reconnect replaces only a
/// disconnected/auth-required shell with the same id; remote evidence remains.
pub fn begin_connection(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    client_id_fingerprint: &str,
) -> Result<GoogleDriveConnectionDto> {
    validate_id(household_id, 128)?;
    validate_id(connection_id, 128)?;
    validate_hash(client_id_fingerprint)?;
    connection.execute(
        "INSERT INTO google_drive_connections(
             id,household_id,client_id_fingerprint,status
         ) VALUES(?1,?2,?3,'AUTHORIZING')
         ON CONFLICT(id) DO UPDATE SET
             client_id_fingerprint=excluded.client_id_fingerprint,
             google_account_id=NULL,account_email=NULL,drive_id=NULL,
             root_folder_id=NULL,root_folder_name=NULL,root_resource_key=NULL,
             status='AUTHORIZING',
             start_page_token=NULL,change_page_token=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE google_drive_connections.household_id=excluded.household_id
           AND google_drive_connections.status IN ('AUTH_REQUIRED','DISCONNECTED')",
        params![connection_id, household_id, client_id_fingerprint],
    )?;
    load_connection(connection, household_id, connection_id)
}

pub fn mark_authorized(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    google_account_id: &str,
    account_email: &str,
) -> Result<GoogleDriveConnectionDto> {
    validate_scoped_ids(household_id, connection_id)?;
    validate_text(google_account_id, 256)?;
    validate_text(account_email, 320)?;
    if !account_email.contains('@') {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    let changed = connection.execute(
        "UPDATE google_drive_connections SET
             google_account_id=?3,account_email=?4,status='SELECTING_FOLDER',
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?2 AND household_id=?1 AND status='AUTHORIZING'",
        params![
            household_id,
            connection_id,
            google_account_id,
            account_email
        ],
    )?;
    require_changed(changed, connection, household_id, connection_id)?;
    load_connection(connection, household_id, connection_id)
}

/// Commits the selected root only after the caller has obtained a start page
/// token. Initial crawling can then run against a stable change baseline.
#[allow(clippy::too_many_arguments)]
pub fn select_root_with_baseline(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    drive_id: Option<&str>,
    root_folder_id: &str,
    root_folder_name: &str,
    root_resource_key: Option<&str>,
    start_page_token: &str,
) -> Result<GoogleDriveConnectionDto> {
    validate_scoped_ids(household_id, connection_id)?;
    validate_optional_text(drive_id, 256)?;
    validate_text(root_folder_id, 256)?;
    validate_text(root_folder_name, 255)?;
    validate_optional_drive_resource_key(root_resource_key)?;
    validate_cursor(start_page_token)?;
    let changed = connection.execute(
        "UPDATE google_drive_connections SET
             drive_id=?3,root_folder_id=?4,root_folder_name=?5,
             root_resource_key=?6,start_page_token=?7,change_page_token=?7,
             status='CONNECTED',
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?2 AND household_id=?1 AND status='SELECTING_FOLDER'",
        params![
            household_id,
            connection_id,
            drive_id,
            root_folder_id,
            root_folder_name,
            root_resource_key,
            start_page_token
        ],
    )?;
    require_changed(changed, connection, household_id, connection_id)?;
    load_connection(connection, household_id, connection_id)
}

pub fn require_reauthorization(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<GoogleDriveConnectionDto> {
    validate_scoped_ids(household_id, connection_id)?;
    let transaction = connection.unchecked_transaction()?;
    let changed = transaction.execute(
        "UPDATE google_drive_connections SET status='AUTH_REQUIRED',
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?2 AND household_id=?1 AND status!='DISCONNECTED'",
        params![household_id, connection_id],
    )?;
    require_changed(changed, &transaction, household_id, connection_id)?;
    suspend_schedule_in(&transaction, connection_id, "AUTH_EXPIRED")?;
    let dto = load_connection(&transaction, household_id, connection_id)?;
    transaction.commit()?;
    Ok(dto)
}

pub fn disconnect(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<GoogleDriveConnectionDto> {
    validate_scoped_ids(household_id, connection_id)?;
    let transaction = connection.unchecked_transaction()?;
    let changed = transaction.execute(
        "UPDATE google_drive_connections SET status='DISCONNECTED',
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?2 AND household_id=?1",
        params![household_id, connection_id],
    )?;
    require_changed(changed, &transaction, household_id, connection_id)?;
    transaction.execute(
        "UPDATE google_drive_sync_schedules SET enabled=0,next_due_at=NULL,
             lease_token=NULL,lease_expires_at=NULL,last_result='DISABLED',
             suspended_until=NULL,suspension_reason=NULL,last_error_code=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE connection_id=?1",
        [connection_id],
    )?;
    let dto = load_connection(&transaction, household_id, connection_id)?;
    transaction.commit()?;
    Ok(dto)
}

pub fn load_connection(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<GoogleDriveConnectionDto> {
    validate_scoped_ids(household_id, connection_id)?;
    connection
        .query_row(
            "SELECT id,household_id,google_account_id,account_email,
                    client_id_fingerprint,drive_id,root_folder_id,root_folder_name,
                    root_resource_key,status,start_page_token,change_page_token,last_full_scan_at,
                    last_change_at,created_at,updated_at
             FROM google_drive_connections WHERE id=?2 AND household_id=?1",
            params![household_id, connection_id],
            |row| {
                Ok(GoogleDriveConnectionDto {
                    id: row.get(0)?,
                    household_id: row.get(1)?,
                    google_account_id: row.get(2)?,
                    account_email: row.get(3)?,
                    client_id_fingerprint: row.get(4)?,
                    drive_id: row.get(5)?,
                    root_folder_id: row.get(6)?,
                    root_folder_name: row.get(7)?,
                    root_resource_key: row.get(8)?,
                    status: row.get(9)?,
                    start_page_token: row.get(10)?,
                    change_page_token: row.get(11)?,
                    last_full_scan_at: row.get(12)?,
                    last_change_at: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            },
        )
        .optional()?
        .ok_or(GoogleDriveStoreError::NotFound)
}

/// Applies one bounded metadata page while fencing every write with the active
/// sync lease. The node table keeps only current metadata; the Inbox retains
/// one immutable row per `(file, generation)`.
pub fn discover_nodes_claimed(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    lease_token: &str,
    nodes: &[RemoteNode],
) -> Result<Vec<GoogleDriveInboxItemDto>> {
    validate_scoped_ids(household_id, connection_id)?;
    validate_hash(lease_token)?;
    if nodes.len() > MAX_BATCH {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    let mut seen = BTreeSet::new();
    for node in nodes {
        validate_node(node)?;
        if !seen.insert(node.file_id.as_str()) {
            return Err(GoogleDriveStoreError::InvalidInput);
        }
    }
    let transaction = connection.unchecked_transaction()?;
    assert_sync_lease_in(&transaction, household_id, connection_id, lease_token)?;
    let mut discovered = Vec::new();
    for node in nodes {
        let fingerprint = node_fingerprint(node);
        let old_fingerprint: Option<String> = transaction
            .query_row(
                "SELECT generation_fingerprint FROM google_drive_nodes
                 WHERE connection_id=?1 AND file_id=?2",
                params![connection_id, node.file_id],
                |row| row.get(0),
            )
            .optional()?;
        let byte_size = node
            .byte_size
            .map(i64::try_from)
            .transpose()
            .map_err(|_| GoogleDriveStoreError::InvalidInput)?;
        transaction.execute(
            "INSERT INTO google_drive_nodes(
                 connection_id,file_id,parent_file_id,name,mime_type,modified_time,
                 byte_size,md5_checksum,drive_version,generation_fingerprint,
                 is_folder,can_download,is_in_selected_tree,is_trashed
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
             ON CONFLICT(connection_id,file_id) DO UPDATE SET
                 parent_file_id=excluded.parent_file_id,name=excluded.name,
                 mime_type=excluded.mime_type,modified_time=excluded.modified_time,
                 byte_size=excluded.byte_size,md5_checksum=excluded.md5_checksum,
                 drive_version=excluded.drive_version,
                 generation_fingerprint=excluded.generation_fingerprint,
                 is_folder=excluded.is_folder,can_download=excluded.can_download,
                 is_in_selected_tree=excluded.is_in_selected_tree,
                 is_trashed=excluded.is_trashed,
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![
                connection_id,
                node.file_id,
                node.parent_file_id,
                node.name,
                node.mime_type,
                node.modified_time,
                byte_size,
                node.md5_checksum,
                node.drive_version,
                fingerprint,
                node.is_folder,
                node.can_download,
                node.is_in_selected_tree,
                node.is_trashed
            ],
        )?;

        let generation_changed = old_fingerprint
            .as_deref()
            .is_some_and(|old| old != fingerprint);
        let removed_from_tree = node.is_trashed || !node.is_in_selected_tree;
        if generation_changed || removed_from_tree {
            transaction.execute(
                "UPDATE google_drive_inbox SET state='REMOVED',lease_token=NULL,
                     lease_expires_at=NULL,processing_origin_state=NULL,
                     last_error_code=NULL,
                     updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE household_id=?1 AND connection_id=?2 AND file_id=?3
                   AND (?5=1 OR generation_fingerprint!=?4)
                   AND state IN ('DISCOVERED','PROCESSING','READY','NEEDS_MAPPING','FAILED')",
                params![
                    household_id,
                    connection_id,
                    node.file_id,
                    fingerprint,
                    removed_from_tree
                ],
            )?;
        }
        if node.is_folder || node.is_trashed || !node.is_in_selected_tree {
            continue;
        }
        let state = match node.disposition {
            DiscoveryDisposition::Reviewable => "DISCOVERED",
            DiscoveryDisposition::TooLarge => "TOO_LARGE",
            DiscoveryDisposition::Unsupported => "UNSUPPORTED",
        };
        let id = inbox_generation_id(connection_id, &node.file_id, &fingerprint);
        transaction.execute(
            "INSERT INTO google_drive_inbox(
                 id,household_id,connection_id,file_id,generation_fingerprint,
                 file_name,media_type,remote_byte_size,remote_modified_at,
                 remote_md5_checksum,drive_version,state
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(connection_id,file_id,generation_fingerprint) DO UPDATE SET
                 state=CASE WHEN google_drive_inbox.state='REMOVED'
                            THEN excluded.state ELSE google_drive_inbox.state END,
                 updated_at=CASE WHEN google_drive_inbox.state='REMOVED'
                                 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now')
                                 ELSE google_drive_inbox.updated_at END",
            params![
                id,
                household_id,
                connection_id,
                node.file_id,
                fingerprint,
                node.name,
                node.mime_type,
                byte_size,
                node.modified_time,
                node.md5_checksum,
                node.drive_version,
                state
            ],
        )?;
        discovered.push(load_inbox_item(&transaction, household_id, &id)?);
    }
    transaction.commit()?;
    Ok(discovered)
}

pub fn list_inbox(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    limit: u16,
) -> Result<Vec<GoogleDriveInboxItemDto>> {
    validate_scoped_ids(household_id, connection_id)?;
    if !(1..=500).contains(&limit) {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    recover_expired_inbox_leases(connection, household_id, connection_id)?;
    let mut statement = connection.prepare(
        "SELECT id FROM google_drive_inbox
         WHERE household_id=?1 AND connection_id=?2
         ORDER BY updated_at DESC,id LIMIT ?3",
    )?;
    let ids = statement
        .query_map(params![household_id, connection_id, limit], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    ids.iter()
        .map(|id| load_inbox_item(connection, household_id, id))
        .collect()
}

pub fn list_inbox_in_state(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    state: &str,
    limit: u16,
) -> Result<Vec<GoogleDriveInboxItemDto>> {
    validate_scoped_ids(household_id, connection_id)?;
    if !(1..=500).contains(&limit)
        || !matches!(
            state,
            "DISCOVERED"
                | "PROCESSING"
                | "READY"
                | "NEEDS_MAPPING"
                | "STAGED"
                | "IGNORED"
                | "FAILED"
                | "REMOVED"
        )
    {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    recover_expired_inbox_leases(connection, household_id, connection_id)?;
    let mut statement = connection.prepare(
        "SELECT id FROM google_drive_inbox
         WHERE household_id=?1 AND connection_id=?2 AND state=?3
         ORDER BY updated_at DESC,id LIMIT ?4",
    )?;
    let ids = statement
        .query_map(params![household_id, connection_id, state, limit], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    ids.iter()
        .map(|id| load_inbox_item(connection, household_id, id))
        .collect()
}

pub fn ignore_inbox(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
) -> Result<GoogleDriveInboxItemDto> {
    validate_id(household_id, 128)?;
    validate_hash(item_id)?;
    let changed = connection.execute(
        "UPDATE google_drive_inbox SET state='IGNORED',last_error_code=NULL,
             lease_token=NULL,lease_expires_at=NULL,processing_origin_state=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?2 AND household_id=?1
           AND state IN ('DISCOVERED','READY','NEEDS_MAPPING','FAILED')",
        params![household_id, item_id],
    )?;
    if changed != 1 {
        return Err(GoogleDriveStoreError::Conflict);
    }
    load_inbox_item(connection, household_id, item_id)
}

pub fn retry_inbox(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
) -> Result<GoogleDriveInboxItemDto> {
    validate_id(household_id, 128)?;
    validate_hash(item_id)?;
    let changed = connection.execute(
        "UPDATE google_drive_inbox SET
             state=CASE WHEN content_sha256 IS NULL THEN 'DISCOVERED' ELSE 'READY' END,
             last_error_code=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?2 AND household_id=?1 AND state='FAILED' AND attempt_count<?3",
        params![household_id, item_id, MAX_INBOX_ATTEMPTS],
    )?;
    if changed != 1 {
        return Err(GoogleDriveStoreError::Conflict);
    }
    load_inbox_item(connection, household_id, item_id)
}

pub fn claim_inbox(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    item_ids: &[String],
) -> Result<InboxLeaseDto> {
    validate_scoped_ids(household_id, connection_id)?;
    if item_ids.is_empty() || item_ids.len() > 25 {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    let mut unique = BTreeSet::new();
    for id in item_ids {
        validate_hash(id)?;
        if !unique.insert(id) {
            return Err(GoogleDriveStoreError::InvalidInput);
        }
    }
    let transaction = connection.unchecked_transaction()?;
    recover_expired_inbox_leases_in(&transaction, household_id, connection_id)?;
    let lease_token = random_sql_hash(&transaction)?;
    for id in item_ids {
        let changed = transaction.execute(
            "UPDATE google_drive_inbox SET state='PROCESSING',
                 processing_origin_state=state,attempt_count=attempt_count+1,
                 lease_token=?4,
                 lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?5),
                 last_error_code=NULL,
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id=?3 AND household_id=?1 AND connection_id=?2
               AND state IN ('DISCOVERED','READY','NEEDS_MAPPING')
               AND attempt_count<?6",
            params![
                household_id,
                connection_id,
                id,
                lease_token,
                format!("+{INBOX_LEASE_MINUTES} minutes"),
                MAX_INBOX_ATTEMPTS
            ],
        )?;
        if changed != 1 {
            return Err(GoogleDriveStoreError::Conflict);
        }
    }
    let lease_expires_at: String = transaction.query_row(
        "SELECT lease_expires_at FROM google_drive_inbox WHERE id=?1",
        [&item_ids[0]],
        |row| row.get(0),
    )?;
    let items = item_ids
        .iter()
        .map(|id| load_inbox_item(&transaction, household_id, id))
        .collect::<Result<Vec<_>>>()?;
    transaction.commit()?;
    Ok(InboxLeaseDto {
        lease_token,
        lease_expires_at,
        items,
    })
}

pub fn claim_household_inbox(
    connection: &Connection,
    household_id: &str,
    item_ids: &[String],
) -> Result<InboxLeaseDto> {
    validate_id(household_id, 128)?;
    if item_ids.is_empty() || item_ids.len() > 25 {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    let mut unique = BTreeSet::new();
    for id in item_ids {
        validate_hash(id)?;
        if !unique.insert(id) {
            return Err(GoogleDriveStoreError::InvalidInput);
        }
    }
    let mut statement = connection.prepare(
        "SELECT DISTINCT connection_id FROM google_drive_inbox
         WHERE household_id=?1 AND id IN (SELECT value FROM json_each(?2))",
    )?;
    let ids_json =
        serde_json::to_string(item_ids).map_err(|_| GoogleDriveStoreError::InvalidInput)?;
    let connection_ids = statement
        .query_map(params![household_id, ids_json], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if connection_ids.len() != 1 {
        return Err(GoogleDriveStoreError::Conflict);
    }
    let matched: i64 = connection.query_row(
        "SELECT count(*) FROM google_drive_inbox
         WHERE household_id=?1 AND connection_id=?2
           AND id IN (SELECT value FROM json_each(?3))",
        params![household_id, &connection_ids[0], ids_json],
        |row| row.get(0),
    )?;
    if usize::try_from(matched).ok() != Some(item_ids.len()) {
        return Err(GoogleDriveStoreError::Conflict);
    }
    claim_inbox(connection, household_id, &connection_ids[0], item_ids)
}

pub fn load_household_inbox_item(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
) -> Result<GoogleDriveInboxItemDto> {
    validate_id(household_id, 128)?;
    validate_hash(item_id)?;
    load_inbox_item(connection, household_id, item_id)
}

pub fn mark_inbox_ready(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
    lease_token: &str,
    content_sha256: &str,
    needs_mapping: bool,
) -> Result<GoogleDriveInboxItemDto> {
    validate_hash(content_sha256)?;
    complete_inbox_lease(
        connection,
        household_id,
        item_id,
        lease_token,
        InboxLeaseCompletion {
            next_state: if needs_mapping {
                "NEEDS_MAPPING"
            } else {
                "READY"
            },
            content_sha256: Some(content_sha256),
            error_code: None,
            import_run_id: None,
        },
    )
}

pub fn fail_inbox(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
    lease_token: &str,
    error_code: &str,
) -> Result<GoogleDriveInboxItemDto> {
    validate_error_code(error_code)?;
    complete_inbox_lease(
        connection,
        household_id,
        item_id,
        lease_token,
        InboxLeaseCompletion {
            next_state: "FAILED",
            content_sha256: None,
            error_code: Some(error_code),
            import_run_id: None,
        },
    )
}

pub fn mark_inbox_staged(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
    lease_token: &str,
    import_run_id: &str,
) -> Result<GoogleDriveInboxItemDto> {
    validate_id(import_run_id, 128)?;
    let transaction = connection.unchecked_transaction()?;
    let valid_run: bool = transaction.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM import_runs r
             JOIN source_documents d ON d.import_run_id=r.id
             JOIN google_drive_inbox i
               ON i.id=?3 AND i.household_id=r.household_id
              AND i.content_sha256=d.sha256
             WHERE r.id=?1 AND r.household_id=?2
               AND r.status IN ('DISCOVERED','EXTRACTING','REVIEW_REQUIRED')
               AND d.source_type='GOOGLE_DRIVE'
         )",
        params![import_run_id, household_id, item_id],
        |row| row.get(0),
    )?;
    if !valid_run {
        return Err(GoogleDriveStoreError::Conflict);
    }
    let item = complete_inbox_lease(
        &transaction,
        household_id,
        item_id,
        lease_token,
        InboxLeaseCompletion {
            next_state: "STAGED",
            content_sha256: None,
            error_code: None,
            import_run_id: Some(import_run_id),
        },
    )?;
    transaction.commit()?;
    Ok(item)
}

pub fn reopen_staged_inbox(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
    import_run_id: &str,
) -> Result<GoogleDriveInboxItemDto> {
    validate_id(household_id, 128)?;
    validate_hash(item_id)?;
    validate_id(import_run_id, 128)?;
    let transaction = connection.unchecked_transaction()?;
    let changed = transaction.execute(
        "UPDATE google_drive_inbox SET state='READY',import_run_id=NULL,
             last_error_code=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?2 AND household_id=?1 AND state='STAGED' AND import_run_id=?3
           AND content_sha256 IS NOT NULL
           AND EXISTS(SELECT 1 FROM import_runs r
                      WHERE r.id=?3 AND r.household_id=?1 AND r.status='ROLLED_BACK')",
        params![household_id, item_id, import_run_id],
    )?;
    if changed != 1 {
        return Err(if inbox_exists(&transaction, household_id, item_id)? {
            GoogleDriveStoreError::Conflict
        } else {
            GoogleDriveStoreError::NotFound
        });
    }
    let item = load_inbox_item(&transaction, household_id, item_id)?;
    transaction.commit()?;
    Ok(item)
}

pub fn configure_schedule(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    enabled: bool,
    interval_minutes: u32,
) -> Result<SyncScheduleDto> {
    validate_scoped_ids(household_id, connection_id)?;
    if !matches!(interval_minutes, 15 | 30 | 60) {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    let connected: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM google_drive_connections
         WHERE id=?2 AND household_id=?1 AND status='CONNECTED')",
        params![household_id, connection_id],
        |row| row.get(0),
    )?;
    if !connected {
        return Err(GoogleDriveStoreError::Conflict);
    }
    connection.execute(
        "INSERT INTO google_drive_sync_schedules(
             connection_id,enabled,interval_minutes,next_due_at,last_result
         ) VALUES(?1,?2,?3,
             CASE WHEN ?2=1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') END,
             CASE WHEN ?2=1 THEN 'NEVER' ELSE 'DISABLED' END)
         ON CONFLICT(connection_id) DO UPDATE SET
             enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,
             next_due_at=excluded.next_due_at,lease_token=NULL,lease_expires_at=NULL,
             last_result=excluded.last_result,last_discovered_count=0,
             consecutive_failures=0,suspended_until=NULL,suspension_reason=NULL,
             last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![connection_id, enabled, interval_minutes],
    )?;
    load_schedule(connection, household_id, connection_id)
}

pub fn claim_due_sync(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<Option<SyncLeaseDto>> {
    validate_scoped_ids(household_id, connection_id)?;
    let transaction = connection.unchecked_transaction()?;
    recover_expired_sync_lease_in(&transaction, household_id, connection_id)?;
    let changed = transaction.execute(
        "UPDATE google_drive_sync_schedules SET
             lease_token=lower(hex(randomblob(32))),
             lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?3),
             last_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             last_result='RUNNING',last_error_code=NULL,
             suspended_until=NULL,suspension_reason=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE connection_id=?2 AND enabled=1 AND lease_token IS NULL
           AND next_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           AND (suspension_reason IS NULL OR (
                suspension_reason='RETRY_BACKOFF'
                AND suspended_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))
           AND EXISTS(SELECT 1 FROM google_drive_connections c
                      WHERE c.id=?2 AND c.household_id=?1 AND c.status='CONNECTED')",
        params![
            household_id,
            connection_id,
            format!("+{SCHEDULE_LEASE_MINUTES} minutes")
        ],
    )?;
    let lease = if changed == 1 {
        Some(transaction.query_row(
            "SELECT c.household_id,s.connection_id,s.lease_token,s.lease_expires_at,
                    c.change_page_token
             FROM google_drive_sync_schedules s
             JOIN google_drive_connections c ON c.id=s.connection_id
             WHERE s.connection_id=?1",
            [connection_id],
            |row| {
                Ok(SyncLeaseDto {
                    household_id: row.get(0)?,
                    connection_id: row.get(1)?,
                    lease_token: row.get(2)?,
                    lease_expires_at: row.get(3)?,
                    change_page_token: row.get(4)?,
                })
            },
        )?)
    } else {
        None
    };
    transaction.commit()?;
    Ok(lease)
}

pub fn assert_sync_lease(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    lease_token: &str,
) -> Result<()> {
    validate_scoped_ids(household_id, connection_id)?;
    validate_hash(lease_token)?;
    assert_sync_lease_in(connection, household_id, connection_id, lease_token)
}

pub fn heartbeat_sync_lease(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    lease_token: &str,
) -> Result<()> {
    assert_sync_lease(connection, household_id, connection_id, lease_token)?;
    let changed = connection.execute(
        "UPDATE google_drive_sync_schedules SET
             lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?4),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE connection_id=?2 AND lease_token=?3 AND enabled=1
           AND EXISTS(SELECT 1 FROM google_drive_connections c
                      WHERE c.id=?2 AND c.household_id=?1)",
        params![
            household_id,
            connection_id,
            lease_token,
            format!("+{SCHEDULE_LEASE_MINUTES} minutes")
        ],
    )?;
    if changed != 1 {
        return Err(GoogleDriveStoreError::StaleLease);
    }
    Ok(())
}

/// Advances the Drive cursor and releases its schedule lease atomically. A
/// stale worker can therefore never overwrite a cursor committed by a newer
/// generation.
pub fn complete_sync(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    lease_token: &str,
    next_page_token: &str,
    discovered_count: u64,
    was_full_scan: bool,
) -> Result<SyncScheduleDto> {
    validate_cursor(next_page_token)?;
    let count = i64::try_from(discovered_count).map_err(|_| GoogleDriveStoreError::InvalidInput)?;
    let transaction = connection.unchecked_transaction()?;
    assert_sync_lease_in(&transaction, household_id, connection_id, lease_token)?;
    transaction.execute(
        "UPDATE google_drive_connections SET change_page_token=?3,
             last_change_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             last_full_scan_at=CASE WHEN ?4=1
               THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE last_full_scan_at END,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?2 AND household_id=?1",
        params![household_id, connection_id, next_page_token, was_full_scan],
    )?;
    transaction.execute(
        "UPDATE google_drive_sync_schedules SET lease_token=NULL,lease_expires_at=NULL,
             last_success_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             last_result=CASE WHEN ?3=0 THEN 'NO_CHANGES' ELSE 'DISCOVERED' END,
             last_discovered_count=?3,consecutive_failures=0,suspended_until=NULL,
             suspension_reason=NULL,last_error_code=NULL,
             next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||interval_minutes||' minutes'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE connection_id=?1 AND lease_token=?2",
        params![connection_id, lease_token, count],
    )?;
    let dto = load_schedule(&transaction, household_id, connection_id)?;
    transaction.commit()?;
    Ok(dto)
}

/// Releases a current worker after a retryable failure. Retry delay is based
/// on the persisted interval and remains bounded by the schema failure cap.
pub fn fail_sync(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    lease_token: &str,
    error_code: &str,
) -> Result<SyncScheduleDto> {
    validate_error_code(error_code)?;
    if matches!(
        error_code,
        "AUTH_EXPIRED" | "MISSING_CREDENTIAL" | "CURSOR_INVALID"
    ) {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    assert_sync_lease_in(&transaction, household_id, connection_id, lease_token)?;
    let changed = transaction.execute(
        "UPDATE google_drive_sync_schedules SET lease_token=NULL,lease_expires_at=NULL,
             last_result='FAILED_RETRYABLE',last_discovered_count=0,
             consecutive_failures=min(consecutive_failures+1,10),
             last_error_code=?3,
             next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||
                 min(interval_minutes*(1 << min(consecutive_failures,4)),360)||' minutes'),
             suspended_until=CASE WHEN consecutive_failures>=4 THEN
                 strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||
                   min(interval_minutes*(1 << min(consecutive_failures,4)),360)||' minutes') END,
             suspension_reason=CASE WHEN consecutive_failures>=4
                                    THEN 'RETRY_BACKOFF' END,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE connection_id=?2 AND lease_token=?4",
        params![household_id, connection_id, error_code, lease_token],
    )?;
    if changed != 1 {
        return Err(GoogleDriveStoreError::StaleLease);
    }
    let dto = load_schedule(&transaction, household_id, connection_id)?;
    transaction.commit()?;
    Ok(dto)
}

/// Terminally suspends only the worker which still owns the active lease.
pub fn suspend_sync_claimed(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    lease_token: &str,
    reason: &str,
) -> Result<SyncScheduleDto> {
    if !matches!(
        reason,
        "AUTH_EXPIRED" | "MISSING_CREDENTIAL" | "CURSOR_INVALID"
    ) {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    assert_sync_lease_in(&transaction, household_id, connection_id, lease_token)?;
    let changed = transaction.execute(
        "UPDATE google_drive_sync_schedules SET lease_token=NULL,lease_expires_at=NULL,
             last_result='TERMINAL_SUSPENDED',last_discovered_count=0,
             suspended_until=NULL,suspension_reason=?3,last_error_code=?3,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE connection_id=?2 AND lease_token=?4",
        params![household_id, connection_id, reason, lease_token],
    )?;
    if changed != 1 {
        return Err(GoogleDriveStoreError::StaleLease);
    }
    let dto = load_schedule(&transaction, household_id, connection_id)?;
    transaction.commit()?;
    Ok(dto)
}

pub fn load_schedule(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<SyncScheduleDto> {
    validate_scoped_ids(household_id, connection_id)?;
    connection
        .query_row(
            "SELECT s.connection_id,s.enabled,s.interval_minutes,s.next_due_at,
                    s.lease_token IS NOT NULL,s.lease_expires_at,s.last_attempt_at,
                    s.last_success_at,s.last_result,s.last_discovered_count,
                    s.consecutive_failures,s.suspended_until,s.suspension_reason,
                    s.last_error_code,s.updated_at
             FROM google_drive_sync_schedules s
             JOIN google_drive_connections c ON c.id=s.connection_id
             WHERE s.connection_id=?2 AND c.household_id=?1",
            params![household_id, connection_id],
            |row| {
                let count: i64 = row.get(9)?;
                let failures: i64 = row.get(10)?;
                Ok(SyncScheduleDto {
                    connection_id: row.get(0)?,
                    enabled: row.get(1)?,
                    interval_minutes: row.get(2)?,
                    next_due_at: row.get(3)?,
                    running: row.get(4)?,
                    lease_expires_at: row.get(5)?,
                    last_attempt_at: row.get(6)?,
                    last_success_at: row.get(7)?,
                    last_result: row.get(8)?,
                    last_discovered_count: u64::try_from(count)
                        .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(9, count))?,
                    consecutive_failures: u8::try_from(failures)
                        .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(10, failures))?,
                    suspended_until: row.get(11)?,
                    suspension_reason: row.get(12)?,
                    last_error_code: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            },
        )
        .optional()?
        .ok_or(GoogleDriveStoreError::NotFound)
}

struct InboxLeaseCompletion<'a> {
    next_state: &'a str,
    content_sha256: Option<&'a str>,
    error_code: Option<&'a str>,
    import_run_id: Option<&'a str>,
}

fn complete_inbox_lease(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
    lease_token: &str,
    completion: InboxLeaseCompletion<'_>,
) -> Result<GoogleDriveInboxItemDto> {
    validate_id(household_id, 128)?;
    validate_hash(item_id)?;
    validate_hash(lease_token)?;
    let changed = connection.execute(
        "UPDATE google_drive_inbox SET state=?4,content_sha256=COALESCE(?5,content_sha256),
             last_error_code=?6,import_run_id=?7,lease_token=NULL,lease_expires_at=NULL,
             processing_origin_state=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=?2 AND household_id=?1 AND state='PROCESSING'
           AND lease_token=?3
           AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![
            household_id,
            item_id,
            lease_token,
            completion.next_state,
            completion.content_sha256,
            completion.error_code,
            completion.import_run_id
        ],
    )?;
    if changed != 1 {
        return Err(if inbox_exists(connection, household_id, item_id)? {
            GoogleDriveStoreError::StaleLease
        } else {
            GoogleDriveStoreError::NotFound
        });
    }
    load_inbox_item(connection, household_id, item_id)
}

fn load_inbox_item(
    connection: &Connection,
    household_id: &str,
    item_id: &str,
) -> Result<GoogleDriveInboxItemDto> {
    connection
        .query_row(
            "SELECT id,household_id,connection_id,file_id,generation_fingerprint,
                    file_name,media_type,remote_byte_size,remote_modified_at,
                    remote_md5_checksum,drive_version,content_sha256,state,
                    attempt_count,import_run_id,last_error_code,discovered_at,updated_at
             FROM google_drive_inbox WHERE id=?2 AND household_id=?1",
            params![household_id, item_id],
            |row| {
                let size: Option<i64> = row.get(7)?;
                let attempts: i64 = row.get(13)?;
                Ok(GoogleDriveInboxItemDto {
                    id: row.get(0)?,
                    household_id: row.get(1)?,
                    connection_id: row.get(2)?,
                    file_id: row.get(3)?,
                    generation_fingerprint: row.get(4)?,
                    file_name: row.get(5)?,
                    media_type: row.get(6)?,
                    remote_byte_size: size
                        .map(|value| {
                            u64::try_from(value)
                                .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(7, value))
                        })
                        .transpose()?,
                    remote_modified_at: row.get(8)?,
                    remote_md5_checksum: row.get(9)?,
                    drive_version: row.get(10)?,
                    content_sha256: row.get(11)?,
                    state: row.get(12)?,
                    attempt_count: u8::try_from(attempts)
                        .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(13, attempts))?,
                    import_run_id: row.get(14)?,
                    last_error_code: row.get(15)?,
                    discovered_at: row.get(16)?,
                    updated_at: row.get(17)?,
                })
            },
        )
        .optional()?
        .ok_or(GoogleDriveStoreError::NotFound)
}

fn inbox_exists(connection: &Connection, household_id: &str, item_id: &str) -> Result<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM google_drive_inbox WHERE id=?2 AND household_id=?1)",
        params![household_id, item_id],
        |row| row.get(0),
    )?)
}

fn recover_expired_inbox_leases(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<()> {
    let transaction = connection.unchecked_transaction()?;
    recover_expired_inbox_leases_in(&transaction, household_id, connection_id)?;
    transaction.commit()?;
    Ok(())
}

fn recover_expired_inbox_leases_in(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<()> {
    connection.execute(
        "UPDATE google_drive_inbox SET
             state=CASE WHEN processing_origin_state='DISCOVERED'
                              AND attempt_count>=?3 THEN 'FAILED'
                        ELSE processing_origin_state END,
             last_error_code=CASE WHEN processing_origin_state='DISCOVERED'
                                       AND attempt_count>=?3 THEN 'LEASE_EXPIRED'
                                  ELSE NULL END,
             lease_token=NULL,lease_expires_at=NULL,processing_origin_state=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND connection_id=?2 AND state='PROCESSING'
           AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![household_id, connection_id, MAX_INBOX_ATTEMPTS],
    )?;
    Ok(())
}

fn recover_expired_sync_lease_in(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<()> {
    connection.execute(
        "UPDATE google_drive_sync_schedules SET lease_token=NULL,lease_expires_at=NULL,
             last_result='LEASE_EXPIRED',last_discovered_count=0,
             consecutive_failures=min(consecutive_failures+1,10),
             last_error_code='LEASE_EXPIRED',
             next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||interval_minutes||' minutes'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE connection_id=?2 AND enabled=1 AND lease_token IS NOT NULL
           AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           AND EXISTS(SELECT 1 FROM google_drive_connections c
                      WHERE c.id=?2 AND c.household_id=?1)",
        params![household_id, connection_id],
    )?;
    Ok(())
}

fn assert_sync_lease_in(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    lease_token: &str,
) -> Result<()> {
    let active: bool = connection.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM google_drive_sync_schedules s
             JOIN google_drive_connections c ON c.id=s.connection_id
             WHERE s.connection_id=?2 AND c.household_id=?1
               AND c.status='CONNECTED' AND s.enabled=1 AND s.lease_token=?3
               AND s.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![household_id, connection_id, lease_token],
        |row| row.get(0),
    )?;
    if active {
        Ok(())
    } else {
        Err(GoogleDriveStoreError::StaleLease)
    }
}

fn suspend_schedule_in(connection: &Connection, connection_id: &str, reason: &str) -> Result<()> {
    connection.execute(
        "UPDATE google_drive_sync_schedules SET lease_token=NULL,lease_expires_at=NULL,
             last_result='TERMINAL_SUSPENDED',suspended_until=NULL,
             suspension_reason=?2,last_error_code=?2,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE connection_id=?1 AND enabled=1",
        params![connection_id, reason],
    )?;
    Ok(())
}

fn require_changed(
    changed: usize,
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<()> {
    if changed == 1 {
        return Ok(());
    }
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM google_drive_connections
         WHERE id=?2 AND household_id=?1)",
        params![household_id, connection_id],
        |row| row.get(0),
    )?;
    Err(if exists {
        GoogleDriveStoreError::Conflict
    } else {
        GoogleDriveStoreError::NotFound
    })
}

fn node_fingerprint(node: &RemoteNode) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"KakeFlow Google Drive generation v1\0");
    hash_part(&mut hasher, node.file_id.as_bytes());
    hash_optional(&mut hasher, node.modified_time.as_deref());
    hash_optional(&mut hasher, node.md5_checksum.as_deref());
    hash_optional(&mut hasher, node.drive_version.as_deref());
    match node.byte_size {
        Some(size) => {
            hasher.update([1]);
            hasher.update(size.to_be_bytes());
        }
        None => hasher.update([0]),
    }
    format!("{:x}", hasher.finalize())
}

fn inbox_generation_id(connection_id: &str, file_id: &str, fingerprint: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"KakeFlow Google Drive Inbox generation v1\0");
    hash_part(&mut hasher, connection_id.as_bytes());
    hash_part(&mut hasher, file_id.as_bytes());
    hash_part(&mut hasher, fingerprint.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn hash_part(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

fn hash_optional(hasher: &mut Sha256, value: Option<&str>) {
    match value {
        Some(value) => {
            hasher.update([1]);
            hash_part(hasher, value.as_bytes());
        }
        None => hasher.update([0]),
    }
}

fn random_sql_hash(connection: &Connection) -> Result<String> {
    Ok(connection.query_row("SELECT lower(hex(randomblob(32)))", [], |row| row.get(0))?)
}

fn validate_node(node: &RemoteNode) -> Result<()> {
    validate_text(&node.file_id, 256)?;
    validate_optional_text(node.parent_file_id.as_deref(), 256)?;
    validate_text(&node.name, 255)?;
    validate_text(&node.mime_type, 127)?;
    validate_optional_text(node.modified_time.as_deref(), 128)?;
    validate_optional_text(node.drive_version.as_deref(), 128)?;
    if let Some(md5) = node.md5_checksum.as_deref() {
        if md5.len() != 32
            || !md5
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err(GoogleDriveStoreError::InvalidInput);
        }
    }
    if node
        .byte_size
        .is_some_and(|size| size > 9_007_199_254_740_991)
        || node.is_folder != (node.mime_type.as_str() == "application/vnd.google-apps.folder")
        || (node.is_folder
            && (node.byte_size.is_some() || node.md5_checksum.is_some() || node.can_download))
    {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    Ok(())
}

fn validate_scoped_ids(household_id: &str, connection_id: &str) -> Result<()> {
    validate_id(household_id, 128)?;
    validate_id(connection_id, 128)
}

fn validate_id(value: &str, max: usize) -> Result<()> {
    if value.is_empty()
        || value.len() > max
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    Ok(())
}

fn validate_text(value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.len() > max || value.contains('\0') {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    Ok(())
}

fn validate_optional_text(value: Option<&str>, max: usize) -> Result<()> {
    if let Some(value) = value {
        validate_text(value, max)?;
    }
    Ok(())
}

fn validate_optional_drive_resource_key(value: Option<&str>) -> Result<()> {
    if let Some(value) = value {
        if value.is_empty()
            || value.len() > 256
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(GoogleDriveStoreError::InvalidInput);
        }
    }
    Ok(())
}

fn validate_hash(value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    Ok(())
}

fn validate_cursor(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > 4096 || value.contains(['\0', '\r', '\n']) {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    Ok(())
}

fn validate_error_code(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(GoogleDriveStoreError::InvalidInput);
    }
    Ok(())
}
