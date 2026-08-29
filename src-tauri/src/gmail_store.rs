//! Durable metadata for the direct Gmail connector.
//!
//! OAuth credentials and RFC 822 bytes deliberately live outside SQLite.
//! Every worker mutation is fenced by a household-scoped lease; Inbox rows
//! identify immutable remote generations and only retain a vault checksum.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use thiserror::Error;

pub const GMAIL_READONLY_SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";
const SYNC_LEASE_MINUTES: u32 = 2;
const INBOX_LEASE_MINUTES: u32 = 5;
const MAX_BATCH: usize = 100;
const MAX_INBOX_ATTEMPTS: i64 = 5;
const MAX_FULL_RECONCILIATION_MESSAGES: usize = 250_000;

#[derive(Debug, Error)]
pub enum GmailStoreError {
    #[error("Gmail connector input is invalid")]
    InvalidInput,
    #[error("Gmail connector record was not found")]
    NotFound,
    #[error("Gmail connector state changed; refresh and try again")]
    Conflict,
    #[error("Gmail connector lease is stale")]
    StaleLease,
    #[error("Gmail connector database operation failed")]
    Database(#[from] rusqlite::Error),
}
pub type Result<T> = std::result::Result<T, GmailStoreError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GmailConnectionDto {
    pub id: String,
    pub household_id: String,
    pub google_account_id: Option<String>,
    pub account_email: Option<String>,
    pub client_id_fingerprint: String,
    pub gmail_query: String,
    pub label_id: Option<String>,
    pub label_name: Option<String>,
    pub status: String,
    pub start_history_id: Option<String>,
    pub history_id: Option<String>,
    pub last_full_scan_at: Option<String>,
    pub last_change_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteMessage {
    pub provider_message_id: String,
    pub thread_id: Option<String>,
    pub history_id: String,
    pub internal_date_ms: u64,
    pub estimated_byte_size: Option<u64>,
    pub rfc822_message_id: Option<String>,
    pub file_name: String,
    pub disposition: MessageDisposition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageDisposition {
    Reviewable,
    TooLarge,
    Unsupported,
    Removed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GmailInboxItemDto {
    pub id: String,
    pub household_id: String,
    pub connection_id: String,
    pub provider_message_id: String,
    pub generation_fingerprint: String,
    pub thread_id: Option<String>,
    pub message_history_id: String,
    pub internal_date_ms: u64,
    pub estimated_byte_size: Option<u64>,
    pub rfc822_message_id: Option<String>,
    pub file_name: String,
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
    pub history_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InboxLeaseDto {
    pub lease_token: String,
    pub lease_expires_at: String,
    pub items: Vec<GmailInboxItemDto>,
}

pub fn begin_connection(
    c: &Connection,
    household: &str,
    id: &str,
    fingerprint: &str,
) -> Result<GmailConnectionDto> {
    scoped(household, id)?;
    hash(fingerprint)?;
    c.execute(
        "INSERT INTO gmail_connections(id,household_id,client_id_fingerprint) VALUES(?1,?2,?3)
         ON CONFLICT(id) DO UPDATE SET client_id_fingerprint=excluded.client_id_fingerprint,
           google_account_id=NULL,account_email=NULL,gmail_query='has:attachment',label_id=NULL,label_name=NULL,status='AUTHORIZING',start_history_id=NULL,
           history_id=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE gmail_connections.household_id=excluded.household_id
           AND gmail_connections.status IN ('AUTH_REQUIRED','DISCONNECTED')",
        params![id, household, fingerprint],
    )?;
    load_connection(c, household, id)
}

pub fn mark_authorized(
    c: &Connection,
    household: &str,
    id: &str,
    account_id: &str,
    email: &str,
    history_id: &str,
) -> Result<GmailConnectionDto> {
    scoped(household, id)?;
    text(account_id, 256)?;
    if !email.contains('@') {
        return Err(GmailStoreError::InvalidInput);
    }
    text(email, 320)?;
    history(history_id)?;
    let changed = c.execute(
        "UPDATE gmail_connections SET google_account_id=?3,account_email=?4,
           label_id=NULL,label_name=NULL,start_history_id=?5,history_id=?5,status='SELECTING_LABEL',
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND id=?2 AND status='AUTHORIZING'",
        params![household, id, account_id, email, history_id],
    )?;
    require_changed(c, household, id, changed)?;
    load_connection(c, household, id)
}

pub fn bind_label(
    c: &Connection,
    household: &str,
    id: &str,
    query: &str,
    label_id: &str,
    label_name: &str,
    fresh_history_id: &str,
) -> Result<GmailConnectionDto> {
    scoped(household, id)?;
    text(query, 1024)?;
    text(label_id, 256)?;
    text(label_name, 255)?;
    history(fresh_history_id)?;
    let changed = c.execute(
        "UPDATE gmail_connections SET gmail_query=?3,label_id=?4,label_name=?5,
         start_history_id=?6,history_id=?6,status='CONNECTED',
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND id=?2 AND status='SELECTING_LABEL'",
        params![household, id, query, label_id, label_name, fresh_history_id],
    )?;
    require_changed(c, household, id, changed)?;
    load_connection(c, household, id)
}

pub fn load_connection(c: &Connection, household: &str, id: &str) -> Result<GmailConnectionDto> {
    scoped(household, id)?;
    c.query_row(
        "SELECT id,household_id,google_account_id,account_email,client_id_fingerprint,gmail_query,
                label_id,label_name,status,start_history_id,history_id,last_full_scan_at,last_change_at,created_at,updated_at
         FROM gmail_connections WHERE household_id=?1 AND id=?2",
        params![household, id], |r| Ok(GmailConnectionDto {
            id:r.get(0)?, household_id:r.get(1)?, google_account_id:r.get(2)?, account_email:r.get(3)?,
            client_id_fingerprint:r.get(4)?, gmail_query:r.get(5)?, label_id:r.get(6)?, label_name:r.get(7)?, status:r.get(8)?, start_history_id:r.get(9)?,
            history_id:r.get(10)?, last_full_scan_at:r.get(11)?, last_change_at:r.get(12)?, created_at:r.get(13)?, updated_at:r.get(14)?,
        }),
    ).optional()?.ok_or(GmailStoreError::NotFound)
}

pub fn list_connections(c: &Connection, household: &str) -> Result<Vec<GmailConnectionDto>> {
    text(household, 128)?;
    let mut statement = c.prepare(
        "SELECT id FROM gmail_connections WHERE household_id=?1 ORDER BY updated_at DESC,id",
    )?;
    let ids = statement
        .query_map([household], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    ids.iter()
        .map(|id| load_connection(c, household, id))
        .collect()
}

pub fn disconnect(c: &Connection, household: &str, id: &str) -> Result<GmailConnectionDto> {
    scoped(household, id)?;
    let tx = c.unchecked_transaction()?;
    let n = tx.execute("UPDATE gmail_connections SET status='DISCONNECTED',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND id=?2", params![household,id])?;
    require_changed(&tx, household, id, n)?;
    tx.execute("UPDATE gmail_sync_schedules SET enabled=0,next_due_at=NULL,lease_token=NULL,lease_expires_at=NULL,last_result='DISABLED',suspended_until=NULL,suspension_reason=NULL,last_error_code=NULL WHERE connection_id=?1", [id])?;
    let dto = load_connection(&tx, household, id)?;
    tx.commit()?;
    Ok(dto)
}

pub fn configure_schedule(
    c: &Connection,
    household: &str,
    id: &str,
    enabled: bool,
    interval: u32,
) -> Result<SyncScheduleDto> {
    scoped(household, id)?;
    if !matches!(interval, 15 | 30 | 60) {
        return Err(GmailStoreError::InvalidInput);
    }
    let connected:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM gmail_connections WHERE household_id=?1 AND id=?2 AND status='CONNECTED')",params![household,id],|r|r.get(0))?;
    if !connected {
        return Err(GmailStoreError::Conflict);
    }
    c.execute("INSERT INTO gmail_sync_schedules(connection_id,enabled,interval_minutes,next_due_at,last_result)
      VALUES(?1,?2,?3,CASE WHEN ?2=1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') END,CASE WHEN ?2=1 THEN 'NEVER' ELSE 'DISABLED' END)
      ON CONFLICT(connection_id) DO UPDATE SET enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,next_due_at=excluded.next_due_at,
      lease_token=NULL,lease_expires_at=NULL,last_result=excluded.last_result,last_discovered_count=0,consecutive_failures=0,suspended_until=NULL,suspension_reason=NULL,last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",params![id,enabled,interval])?;
    load_schedule(c, household, id)
}

pub fn load_schedule(c: &Connection, household: &str, id: &str) -> Result<SyncScheduleDto> {
    scoped(household, id)?;
    c.query_row("SELECT s.connection_id,s.enabled,s.interval_minutes,s.next_due_at,s.lease_token IS NOT NULL,s.lease_expires_at,s.last_attempt_at,s.last_success_at,s.last_result,s.last_discovered_count,s.consecutive_failures,s.suspended_until,s.suspension_reason,s.last_error_code,s.updated_at
      FROM gmail_sync_schedules s JOIN gmail_connections g ON g.id=s.connection_id WHERE g.household_id=?1 AND s.connection_id=?2",params![household,id],|r|Ok(SyncScheduleDto{
        connection_id:r.get(0)?,enabled:r.get(1)?,interval_minutes:r.get::<_,u32>(2)?,next_due_at:r.get(3)?,running:r.get(4)?,lease_expires_at:r.get(5)?,last_attempt_at:r.get(6)?,last_success_at:r.get(7)?,last_result:r.get(8)?,last_discovered_count:r.get::<_,u64>(9)?,consecutive_failures:r.get::<_,u8>(10)?,suspended_until:r.get(11)?,suspension_reason:r.get(12)?,last_error_code:r.get(13)?,updated_at:r.get(14)?
      })).optional()?.ok_or(GmailStoreError::NotFound)
}

pub fn claim_due_sync(c: &Connection, household: &str, id: &str) -> Result<Option<SyncLeaseDto>> {
    scoped(household, id)?;
    let tx = c.unchecked_transaction()?;
    tx.execute("UPDATE gmail_sync_schedules SET lease_token=NULL,lease_expires_at=NULL,last_result='LEASE_EXPIRED',consecutive_failures=min(consecutive_failures+1,10),next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE connection_id=?1 AND lease_token IS NOT NULL AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')",[id])?;
    let n=tx.execute("UPDATE gmail_sync_schedules SET lease_token=lower(hex(randomblob(32))),lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?3),last_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_result='RUNNING',last_error_code=NULL,suspended_until=NULL,suspension_reason=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE connection_id=?2 AND enabled=1 AND lease_token IS NULL AND next_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND (suspension_reason IS NULL OR (suspension_reason='RETRY_BACKOFF' AND suspended_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))
      AND EXISTS(SELECT 1 FROM gmail_connections g WHERE g.household_id=?1 AND g.id=?2 AND g.status='CONNECTED')",params![household,id,format!("+{SYNC_LEASE_MINUTES} minutes")])?;
    let out = if n == 1 {
        Some(tx.query_row("SELECT g.household_id,s.connection_id,s.lease_token,s.lease_expires_at,g.history_id FROM gmail_sync_schedules s JOIN gmail_connections g ON g.id=s.connection_id WHERE s.connection_id=?1",[id],|r|Ok(SyncLeaseDto{household_id:r.get(0)?,connection_id:r.get(1)?,lease_token:r.get(2)?,lease_expires_at:r.get(3)?,history_id:r.get(4)?}))?)
    } else {
        None
    };
    tx.commit()?;
    Ok(out)
}

pub fn claim_next_due_sync(c: &Connection) -> Result<Option<SyncLeaseDto>> {
    let candidate=c.query_row("SELECT g.household_id,s.connection_id FROM gmail_sync_schedules s JOIN gmail_connections g ON g.id=s.connection_id WHERE g.status='CONNECTED' AND s.enabled=1 AND s.lease_token IS NULL AND s.next_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (s.suspension_reason IS NULL OR (s.suspension_reason='RETRY_BACKOFF' AND s.suspended_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))) ORDER BY s.next_due_at,g.household_id,s.connection_id LIMIT 1",[],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()?;
    candidate
        .map(|(h, id)| claim_due_sync(c, &h, &id))
        .transpose()
        .map(Option::flatten)
}

pub fn heartbeat_sync(c: &Connection, lease: &SyncLeaseDto) -> Result<()> {
    hash(&lease.lease_token)?;
    let n=c.execute("UPDATE gmail_sync_schedules SET lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?4),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE connection_id=?2 AND lease_token=?3 AND enabled=1 AND EXISTS(SELECT 1 FROM gmail_connections g WHERE g.id=?2 AND g.household_id=?1)",params![lease.household_id,lease.connection_id,lease.lease_token,format!("+{SYNC_LEASE_MINUTES} minutes")])?;
    if n == 1 {
        Ok(())
    } else {
        Err(GmailStoreError::StaleLease)
    }
}

pub fn discover_messages_claimed(
    c: &Connection,
    lease: &SyncLeaseDto,
    messages: &[RemoteMessage],
) -> Result<Vec<GmailInboxItemDto>> {
    if messages.len() > MAX_BATCH {
        return Err(GmailStoreError::InvalidInput);
    }
    let mut seen = BTreeSet::new();
    for m in messages {
        validate_message(m)?;
        if !seen.insert(m.provider_message_id.as_str()) {
            return Err(GmailStoreError::InvalidInput);
        }
    }
    let tx = c.unchecked_transaction()?;
    assert_sync(&tx, lease)?;
    let mut out = Vec::new();
    for m in messages {
        let fp = message_fingerprint(m);
        let inbox_id = inbox_id(&lease.connection_id, &m.provider_message_id, &fp);
        let state = match m.disposition {
            MessageDisposition::Reviewable => "DISCOVERED",
            MessageDisposition::TooLarge => "TOO_LARGE",
            MessageDisposition::Unsupported => "UNSUPPORTED",
            MessageDisposition::Removed => "REMOVED",
        };
        let date = i64::try_from(m.internal_date_ms).map_err(|_| GmailStoreError::InvalidInput)?;
        let size = m
            .estimated_byte_size
            .map(i64::try_from)
            .transpose()
            .map_err(|_| GmailStoreError::InvalidInput)?;
        tx.execute("INSERT INTO gmail_inbox(id,household_id,connection_id,provider_message_id,generation_fingerprint,thread_id,message_history_id,internal_date_ms,estimated_byte_size,rfc822_message_id,file_name,state)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
          ON CONFLICT(connection_id,provider_message_id,generation_fingerprint) DO UPDATE SET
            state=CASE WHEN gmail_inbox.state='REMOVED' AND gmail_inbox.content_sha256 IS NOT NULL
                       THEN 'READY'
                       WHEN gmail_inbox.state='REMOVED' THEN excluded.state
                       ELSE gmail_inbox.state END,
            updated_at=CASE WHEN gmail_inbox.state='REMOVED' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE gmail_inbox.updated_at END",
          params![inbox_id,lease.household_id,lease.connection_id,m.provider_message_id,fp,m.thread_id,m.history_id,date,size,m.rfc822_message_id,m.file_name,state])?;
        out.push(load_inbox_item(&tx, &lease.household_id, &inbox_id)?);
    }
    tx.commit()?;
    Ok(out)
}

/// Applies a selected-label removal while fencing the state mutation with the
/// active history-sync lease. Staged evidence remains immutable and auditable.
pub fn mark_message_removed_claimed(
    c: &Connection,
    lease: &SyncLeaseDto,
    provider_message_id: &str,
) -> Result<()> {
    text(provider_message_id, 256)?;
    let tx = c.unchecked_transaction()?;
    assert_sync(&tx, lease)?;
    tx.execute(
        "UPDATE gmail_inbox SET state='REMOVED',lease_token=NULL,lease_expires_at=NULL,
         processing_origin_state=NULL,last_error_code=NULL,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND connection_id=?2 AND provider_message_id=?3
         AND state IN ('DISCOVERED','PROCESSING','READY','NEEDS_MAPPING','FAILED','TOO_LARGE','UNSUPPORTED')",
        params![lease.household_id, lease.connection_id, provider_message_id],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn complete_sync(
    c: &Connection,
    lease: &SyncLeaseDto,
    next_history_id: &str,
    count: u64,
    was_full: bool,
) -> Result<SyncScheduleDto> {
    history(next_history_id)?;
    let count = i64::try_from(count).map_err(|_| GmailStoreError::InvalidInput)?;
    let tx = c.unchecked_transaction()?;
    assert_sync(&tx, lease)?;
    let n=tx.execute("UPDATE gmail_connections SET history_id=?4,last_change_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_full_scan_at=CASE WHEN ?5=1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE last_full_scan_at END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND id=?2 AND history_id=?3",params![lease.household_id,lease.connection_id,lease.history_id,next_history_id,was_full])?;
    if n != 1 {
        return Err(GmailStoreError::StaleLease);
    }
    tx.execute("UPDATE gmail_sync_schedules SET lease_token=NULL,lease_expires_at=NULL,last_success_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_result=CASE WHEN ?3=0 THEN 'NO_CHANGES' ELSE 'DISCOVERED' END,last_discovered_count=?3,consecutive_failures=0,suspended_until=NULL,suspension_reason=NULL,last_error_code=NULL,next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||interval_minutes||' minutes'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE connection_id=?1 AND lease_token=?2",params![lease.connection_id,lease.lease_token,count])?;
    let dto = load_schedule(&tx, &lease.household_id, &lease.connection_id)?;
    tx.commit()?;
    Ok(dto)
}

/// Completes a full label/query reconciliation atomically. Pending evidence
/// absent from the final membership set is removed before the History cursor
/// is published; staged evidence and its lineage remain untouched.
pub fn complete_full_reconciliation(
    c: &Connection,
    lease: &SyncLeaseDto,
    next_history_id: &str,
    discovered_count: u64,
    present_message_ids: &[String],
) -> Result<SyncScheduleDto> {
    history(next_history_id)?;
    if present_message_ids.len() > MAX_FULL_RECONCILIATION_MESSAGES {
        return Err(GmailStoreError::InvalidInput);
    }
    let mut unique = BTreeSet::new();
    for id in present_message_ids {
        text(id, 256)?;
        if !unique.insert(id.as_str()) {
            return Err(GmailStoreError::InvalidInput);
        }
    }
    let count = i64::try_from(discovered_count).map_err(|_| GmailStoreError::InvalidInput)?;
    let tx = c.unchecked_transaction()?;
    assert_sync(&tx, lease)?;
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS gmail_full_scan_present(
           provider_message_id TEXT PRIMARY KEY NOT NULL
             CHECK(length(trim(provider_message_id)) BETWEEN 1 AND 256)
         ) STRICT, WITHOUT ROWID;
         DELETE FROM gmail_full_scan_present;",
    )?;
    {
        let mut insert =
            tx.prepare("INSERT INTO gmail_full_scan_present(provider_message_id) VALUES(?1)")?;
        for id in present_message_ids {
            insert.execute([id])?;
        }
    }
    tx.execute(
        "UPDATE gmail_inbox SET state='REMOVED',lease_token=NULL,lease_expires_at=NULL,
         processing_origin_state=NULL,last_error_code=NULL,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND connection_id=?2
         AND state IN ('DISCOVERED','PROCESSING','READY','NEEDS_MAPPING','FAILED','TOO_LARGE','UNSUPPORTED')
         AND NOT EXISTS(SELECT 1 FROM gmail_full_scan_present p
                        WHERE p.provider_message_id=gmail_inbox.provider_message_id)",
        params![lease.household_id, lease.connection_id],
    )?;
    let changed = tx.execute(
        "UPDATE gmail_connections SET history_id=?4,
         last_change_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         last_full_scan_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND id=?2 AND history_id=?3",
        params![
            lease.household_id,
            lease.connection_id,
            lease.history_id,
            next_history_id
        ],
    )?;
    if changed != 1 {
        return Err(GmailStoreError::StaleLease);
    }
    let released = tx.execute(
        "UPDATE gmail_sync_schedules SET lease_token=NULL,lease_expires_at=NULL,
         last_success_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         last_result=CASE WHEN ?3=0 THEN 'NO_CHANGES' ELSE 'DISCOVERED' END,
         last_discovered_count=?3,consecutive_failures=0,suspended_until=NULL,
         suspension_reason=NULL,last_error_code=NULL,
         next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||interval_minutes||' minutes'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE connection_id=?1 AND lease_token=?2",
        params![lease.connection_id, lease.lease_token, count],
    )?;
    if released != 1 {
        return Err(GmailStoreError::StaleLease);
    }
    let dto = load_schedule(&tx, &lease.household_id, &lease.connection_id)?;
    tx.commit()?;
    Ok(dto)
}

pub fn fail_sync(c: &Connection, lease: &SyncLeaseDto, error: &str) -> Result<SyncScheduleDto> {
    error_code(error)?;
    let tx = c.unchecked_transaction()?;
    assert_sync(&tx, lease)?;
    tx.execute(
        "UPDATE gmail_sync_schedules SET lease_token=NULL,lease_expires_at=NULL,
         last_result='FAILED_RETRYABLE',
         consecutive_failures=min(consecutive_failures+1,10),
         suspension_reason='RETRY_BACKOFF',
         suspended_until=strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||
           min(360,interval_minutes*(1 << min(consecutive_failures,4)))||' minutes'),
         next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||
           min(360,interval_minutes*(1 << min(consecutive_failures,4)))||' minutes'),
         last_error_code=?2,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE connection_id=?1 AND lease_token=?3",
        params![lease.connection_id, error, lease.lease_token],
    )?;
    let dto = load_schedule(&tx, &lease.household_id, &lease.connection_id)?;
    tx.commit()?;
    Ok(dto)
}

/// Releases an expired-history worker and atomically marks the connection for
/// a full query-based reconciliation. The retry must acquire a new lease.
pub fn require_full_reconciliation(
    c: &Connection,
    lease: &SyncLeaseDto,
) -> Result<SyncScheduleDto> {
    let tx = c.unchecked_transaction()?;
    assert_sync(&tx, lease)?;
    tx.execute(
        "UPDATE gmail_connections SET last_full_scan_at=NULL,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND id=?2 AND history_id=?3",
        params![lease.household_id, lease.connection_id, lease.history_id],
    )?;
    let changed = tx.execute(
        "UPDATE gmail_sync_schedules SET lease_token=NULL,lease_expires_at=NULL,
         last_result='FAILED_RETRYABLE',last_discovered_count=0,
         consecutive_failures=min(consecutive_failures+1,10),
         last_error_code='FULL_RECONCILIATION_REQUIRED',
         next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         suspended_until=NULL,suspension_reason=NULL,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE connection_id=?1 AND lease_token=?2",
        params![lease.connection_id, lease.lease_token],
    )?;
    if changed != 1 {
        return Err(GmailStoreError::StaleLease);
    }
    let dto = load_schedule(&tx, &lease.household_id, &lease.connection_id)?;
    tx.commit()?;
    Ok(dto)
}

pub fn list_inbox(
    c: &Connection,
    household: &str,
    id: &str,
    limit: usize,
) -> Result<Vec<GmailInboxItemDto>> {
    scoped(household, id)?;
    if limit == 0 || limit > 100 {
        return Err(GmailStoreError::InvalidInput);
    }
    let mut s=c.prepare("SELECT id FROM gmail_inbox WHERE household_id=?1 AND connection_id=?2 ORDER BY updated_at DESC,id LIMIT ?3")?;
    let ids = s
        .query_map(params![household, id, limit as i64], |r| {
            r.get::<_, String>(0)
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    ids.iter()
        .map(|item| load_inbox_item(c, household, item))
        .collect()
}

pub fn claim_inbox(
    c: &Connection,
    household: &str,
    id: &str,
    item_ids: &[String],
) -> Result<InboxLeaseDto> {
    scoped(household, id)?;
    if item_ids.is_empty() || item_ids.len() > 25 {
        return Err(GmailStoreError::InvalidInput);
    }
    let tx = c.unchecked_transaction()?;
    let token = random_hash(&tx)?;
    let expiry = format!("+{INBOX_LEASE_MINUTES} minutes");
    let mut items = Vec::new();
    for item in item_ids {
        hash(item)?;
        let n=tx.execute("UPDATE gmail_inbox SET state='PROCESSING',processing_origin_state=state,lease_token=?4,lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?5),attempt_count=attempt_count+1,last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND connection_id=?2 AND id=?3 AND state IN ('DISCOVERED','READY','NEEDS_MAPPING') AND attempt_count<?6",params![household,id,item,token,expiry,MAX_INBOX_ATTEMPTS])?;
        if n != 1 {
            return Err(if inbox_exists(&tx, household, item)? {
                GmailStoreError::Conflict
            } else {
                GmailStoreError::NotFound
            });
        }
        items.push(load_inbox_item(&tx, household, item)?);
    }
    let lease_expires_at = tx.query_row(
        "SELECT lease_expires_at FROM gmail_inbox WHERE id=?1",
        [&item_ids[0]],
        |r| r.get(0),
    )?;
    tx.commit()?;
    Ok(InboxLeaseDto {
        lease_token: token,
        lease_expires_at,
        items,
    })
}

pub fn mark_inbox_ready(
    c: &Connection,
    household: &str,
    item: &str,
    lease: &str,
    sha: &str,
    needs_mapping: bool,
) -> Result<GmailInboxItemDto> {
    hash(item)?;
    hash(lease)?;
    hash(sha)?;
    let state = if needs_mapping {
        "NEEDS_MAPPING"
    } else {
        "READY"
    };
    let n=c.execute("UPDATE gmail_inbox SET state=?4,content_sha256=?5,lease_token=NULL,lease_expires_at=NULL,processing_origin_state=NULL,last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND id=?2 AND state='PROCESSING' AND lease_token=?3 AND processing_origin_state='DISCOVERED' AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",params![household,item,lease,state,sha])?;
    if n != 1 {
        return Err(if inbox_exists(c, household, item)? {
            GmailStoreError::StaleLease
        } else {
            GmailStoreError::NotFound
        });
    }
    load_inbox_item(c, household, item)
}

pub fn mark_inbox_staged(
    c: &Connection,
    household: &str,
    item: &str,
    lease: &str,
    run: &str,
) -> Result<GmailInboxItemDto> {
    hash(item)?;
    hash(lease)?;
    text(run, 128)?;
    let tx = c.unchecked_transaction()?;
    let source_document_id = tx
        .query_row(
            "SELECT d.id FROM source_documents d
             JOIN gmail_inbox i ON i.household_id=d.household_id
             WHERE i.household_id=?1 AND i.id=?2 AND d.import_run_id=?3
               AND d.source_type='GMAIL' AND d.sha256=i.content_sha256
             ORDER BY d.id LIMIT 2",
            params![household, item, run],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or(GmailStoreError::Conflict)?;
    let source_count: i64 = tx.query_row(
        "SELECT count(*) FROM source_documents d
         JOIN gmail_inbox i ON i.household_id=d.household_id
         WHERE i.household_id=?1 AND i.id=?2 AND d.import_run_id=?3
           AND d.source_type='GMAIL' AND d.sha256=i.content_sha256",
        params![household, item, run],
        |row| row.get(0),
    )?;
    if source_count != 1 {
        return Err(GmailStoreError::Conflict);
    }
    let n=tx.execute("UPDATE gmail_inbox SET state='STAGED',import_run_id=?4,lease_token=NULL,lease_expires_at=NULL,processing_origin_state=NULL,last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND id=?2 AND state='PROCESSING' AND lease_token=?3 AND processing_origin_state IN ('READY','NEEDS_MAPPING') AND content_sha256 IS NOT NULL AND EXISTS(SELECT 1 FROM import_runs r WHERE r.id=?4 AND r.household_id=?1 AND r.status='REVIEW_REQUIRED')",params![household,item,lease,run])?;
    if n != 1 {
        return Err(if inbox_exists(&tx, household, item)? {
            GmailStoreError::Conflict
        } else {
            GmailStoreError::NotFound
        });
    }
    tx.execute(
        "INSERT INTO gmail_source_links(inbox_id,source_document_id) VALUES(?1,?2)",
        params![item, source_document_id],
    )?;
    let dto = load_inbox_item(&tx, household, item)?;
    tx.commit()?;
    Ok(dto)
}

pub fn fail_inbox(
    c: &Connection,
    household: &str,
    item: &str,
    lease: &str,
    error: &str,
) -> Result<GmailInboxItemDto> {
    hash(item)?;
    hash(lease)?;
    error_code(error)?;
    let n=c.execute("UPDATE gmail_inbox SET state='FAILED',lease_token=NULL,lease_expires_at=NULL,processing_origin_state=NULL,last_error_code=?4,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND id=?2 AND state='PROCESSING' AND lease_token=?3",params![household,item,lease,error])?;
    if n != 1 {
        return Err(if inbox_exists(c, household, item)? {
            GmailStoreError::StaleLease
        } else {
            GmailStoreError::NotFound
        });
    }
    load_inbox_item(c, household, item)
}

pub fn retry_inbox(c: &Connection, household: &str, item: &str) -> Result<GmailInboxItemDto> {
    hash(item)?;
    let n=c.execute("UPDATE gmail_inbox SET state=CASE WHEN content_sha256 IS NULL THEN 'DISCOVERED' ELSE 'READY' END,attempt_count=0,last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND id=?2 AND state='FAILED'",params![household,item])?;
    if n != 1 {
        return Err(if inbox_exists(c, household, item)? {
            GmailStoreError::Conflict
        } else {
            GmailStoreError::NotFound
        });
    }
    load_inbox_item(c, household, item)
}

pub fn ignore_inbox(c: &Connection, household: &str, item: &str) -> Result<GmailInboxItemDto> {
    hash(item)?;
    let n = c.execute(
        "UPDATE gmail_inbox SET state='IGNORED',last_error_code=NULL,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND id=?2 AND state IN
         ('DISCOVERED','READY','NEEDS_MAPPING','FAILED','TOO_LARGE','UNSUPPORTED')",
        params![household, item],
    )?;
    if n != 1 {
        return Err(if inbox_exists(c, household, item)? {
            GmailStoreError::Conflict
        } else {
            GmailStoreError::NotFound
        });
    }
    load_inbox_item(c, household, item)
}

pub fn reopen_staged_inbox(
    c: &Connection,
    household: &str,
    item: &str,
    import_run_id: &str,
) -> Result<GmailInboxItemDto> {
    hash(item)?;
    text(import_run_id, 128)?;
    let tx = c.unchecked_transaction()?;
    let n = tx.execute(
        "UPDATE gmail_inbox SET state='READY',import_run_id=NULL,last_error_code=NULL,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND id=?2 AND state='STAGED' AND import_run_id=?3
         AND content_sha256 IS NOT NULL AND EXISTS(
           SELECT 1 FROM import_runs r WHERE r.id=?3 AND r.household_id=?1 AND r.status='ROLLED_BACK')",
        params![household, item, import_run_id],
    )?;
    if n != 1 {
        return Err(if inbox_exists(&tx, household, item)? {
            GmailStoreError::Conflict
        } else {
            GmailStoreError::NotFound
        });
    }
    let dto = load_inbox_item(&tx, household, item)?;
    tx.commit()?;
    Ok(dto)
}

/// Inserts only the lineage link. The migration trigger validates the exact
/// household, import run, SHA-256 and `GMAIL` canonical source type.
pub fn link_source_document(
    c: &Connection,
    household: &str,
    item: &str,
    source_document_id: &str,
) -> Result<()> {
    hash(item)?;
    text(source_document_id, 128)?;
    let staged: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM gmail_inbox WHERE household_id=?1 AND id=?2 AND state='STAGED')",
        params![household, item],
        |r| r.get(0),
    )?;
    if !staged {
        return Err(if inbox_exists(c, household, item)? {
            GmailStoreError::Conflict
        } else {
            GmailStoreError::NotFound
        });
    }
    c.execute(
        "INSERT OR IGNORE INTO gmail_source_links(inbox_id,source_document_id) VALUES(?1,?2)",
        params![item, source_document_id],
    )?;
    Ok(())
}

pub fn load_household_inbox_item(
    c: &Connection,
    household: &str,
    item: &str,
) -> Result<GmailInboxItemDto> {
    hash(item)?;
    load_inbox_item(c, household, item)
}

fn load_inbox_item(c: &Connection, household: &str, id: &str) -> Result<GmailInboxItemDto> {
    c.query_row("SELECT id,household_id,connection_id,provider_message_id,generation_fingerprint,thread_id,message_history_id,internal_date_ms,estimated_byte_size,rfc822_message_id,file_name,content_sha256,state,attempt_count,import_run_id,last_error_code,discovered_at,updated_at FROM gmail_inbox WHERE household_id=?1 AND id=?2",params![household,id],|r|Ok(GmailInboxItemDto{id:r.get(0)?,household_id:r.get(1)?,connection_id:r.get(2)?,provider_message_id:r.get(3)?,generation_fingerprint:r.get(4)?,thread_id:r.get(5)?,message_history_id:r.get(6)?,internal_date_ms:r.get(7)?,estimated_byte_size:r.get(8)?,rfc822_message_id:r.get(9)?,file_name:r.get(10)?,content_sha256:r.get(11)?,state:r.get(12)?,attempt_count:r.get(13)?,import_run_id:r.get(14)?,last_error_code:r.get(15)?,discovered_at:r.get(16)?,updated_at:r.get(17)?})).optional()?.ok_or(GmailStoreError::NotFound)
}
fn inbox_exists(c: &Connection, h: &str, id: &str) -> Result<bool> {
    Ok(c.query_row(
        "SELECT EXISTS(SELECT 1 FROM gmail_inbox WHERE household_id=?1 AND id=?2)",
        params![h, id],
        |r| r.get(0),
    )?)
}
fn assert_sync(c: &Connection, l: &SyncLeaseDto) -> Result<()> {
    hash(&l.lease_token)?;
    let ok:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM gmail_sync_schedules s JOIN gmail_connections g ON g.id=s.connection_id WHERE g.household_id=?1 AND s.connection_id=?2 AND s.lease_token=?3 AND s.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.history_id=?4)",params![l.household_id,l.connection_id,l.lease_token,l.history_id],|r|r.get(0))?;
    if ok {
        Ok(())
    } else {
        Err(GmailStoreError::StaleLease)
    }
}
fn require_changed(c: &Connection, h: &str, id: &str, n: usize) -> Result<()> {
    if n == 1 {
        return Ok(());
    }
    let exists: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM gmail_connections WHERE household_id=?1 AND id=?2)",
        params![h, id],
        |r| r.get(0),
    )?;
    Err(if exists {
        GmailStoreError::Conflict
    } else {
        GmailStoreError::NotFound
    })
}
fn random_hash(c: &Connection) -> Result<String> {
    Ok(c.query_row("SELECT lower(hex(randomblob(32)))", [], |r| r.get(0))?)
}
fn message_fingerprint(m: &RemoteMessage) -> String {
    let mut h = Sha256::new();
    h.update(m.provider_message_id.as_bytes());
    format!("{:x}", h.finalize())
}
fn inbox_id(connection: &str, message: &str, fp: &str) -> String {
    let mut h = Sha256::new();
    h.update(connection);
    h.update([0]);
    h.update(message);
    h.update([0]);
    h.update(fp);
    format!("{:x}", h.finalize())
}
fn validate_message(m: &RemoteMessage) -> Result<()> {
    text(&m.provider_message_id, 256)?;
    if let Some(v) = &m.thread_id {
        text(v, 256)?
    }
    history(&m.history_id)?;
    if m.internal_date_ms > 9_007_199_254_740_991 {
        return Err(GmailStoreError::InvalidInput);
    }
    if m.estimated_byte_size.is_some_and(|v| v > 52_428_800) {
        return Err(GmailStoreError::InvalidInput);
    }
    if let Some(v) = &m.rfc822_message_id {
        text(v, 998)?
    }
    text(&m.file_name, 255)
}
fn scoped(h: &str, id: &str) -> Result<()> {
    text(h, 128)?;
    text(id, 128)
}
fn text(v: &str, max: usize) -> Result<()> {
    let n = v.trim().len();
    if n == 0 || n > max || v.chars().any(char::is_control) {
        Err(GmailStoreError::InvalidInput)
    } else {
        Ok(())
    }
}
fn hash(v: &str) -> Result<()> {
    if v.len() == 64
        && v.bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(GmailStoreError::InvalidInput)
    }
}
fn history(v: &str) -> Result<()> {
    if !v.is_empty() && v.len() <= 64 && v.bytes().all(|b| b.is_ascii_digit()) {
        Ok(())
    } else {
        Err(GmailStoreError::InvalidInput)
    }
}
fn error_code(v: &str) -> Result<()> {
    if !v.is_empty()
        && v.len() <= 64
        && v.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
    {
        Ok(())
    } else {
        Err(GmailStoreError::InvalidInput)
    }
}
