use crate::{
    connector_control::{
        ConfigurationDestination, ConnectorAvailability, ConnectorCapability, ConnectorHealth,
        ConnectorKind, ConnectorLifecycle, ConnectorRegistry, ConnectorSummaryDto,
    },
    gmail_command_service, gmail_store, google_drive_command_service, google_drive_store,
    watched_folders,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;
use thiserror::Error;

const DEFAULT_PAGE_LIMIT: u16 = 100;
const MAX_PAGE_LIMIT: u16 = 100;
const MAX_CONNECTION_KEY_BYTES: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorCursorDto {
    pub connector_kind: ConnectorKind,
    pub connection_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ConnectorKindInput {
    GoogleDrive,
    Gmail,
    WatchedFolder,
    ManualImport,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectorCursorInput {
    connector_kind: ConnectorKindInput,
    connection_key: String,
}

impl<'de> Deserialize<'de> for ConnectorCursorDto {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let input = ConnectorCursorInput::deserialize(deserializer)?;
        let connector_kind = match input.connector_kind {
            ConnectorKindInput::GoogleDrive => ConnectorKind::GoogleDrive,
            ConnectorKindInput::Gmail => ConnectorKind::Gmail,
            ConnectorKindInput::WatchedFolder => ConnectorKind::WatchedFolder,
            ConnectorKindInput::ManualImport => ConnectorKind::ManualImport,
        };
        if !valid_connection_key(&input.connection_key) {
            return Err(serde::de::Error::custom("connector cursor is invalid"));
        }
        Ok(Self {
            connector_kind,
            connection_key: input.connection_key,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorSummaryPageDto {
    pub schema_version: u8,
    pub items: Vec<ConnectorSummaryDto>,
    pub next_cursor: Option<ConnectorCursorDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ConnectorProjectionError {
    #[error("connector projection input is invalid")]
    InvalidInput,
    #[error("connector projection page limit is invalid")]
    InvalidLimit,
    #[error("connector projection cursor is invalid")]
    InvalidCursor,
    #[error("connector projection contains a duplicate identity")]
    DuplicateIdentity,
    #[error("connector projection violates its public contract")]
    InvalidProjection,
    #[error("connector projection database is unavailable")]
    Database,
}

impl ConnectorProjectionError {
    pub fn public_message(self) -> &'static str {
        match self {
            Self::InvalidInput => "Connector projection input is invalid",
            Self::InvalidLimit => "Connector projection limit must be between 1 and 100",
            Self::InvalidCursor => "Connector projection cursor is invalid",
            Self::DuplicateIdentity | Self::InvalidProjection | Self::Database => {
                "Connector summaries are temporarily unavailable"
            }
        }
    }
}

pub(crate) trait ProjectionClock {
    fn now(&self, connection: &Connection) -> Result<String, ConnectorProjectionError>;
}

pub(crate) struct SqliteProjectionClock;

impl ProjectionClock for SqliteProjectionClock {
    fn now(&self, connection: &Connection) -> Result<String, ConnectorProjectionError> {
        connection
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
                row.get(0)
            })
            .map_err(|_| ConnectorProjectionError::Database)
    }
}

pub(crate) trait ConnectorAdapter {
    fn list_summaries(
        &self,
        connection: &Connection,
        household_id: &str,
        after_key: Option<&ConnectorCursorDto>,
        limit: usize,
    ) -> Result<Vec<ConnectorSummaryDto>, ConnectorProjectionError>;
}

pub(crate) struct ConnectionProjectionService<'a> {
    clock: &'a dyn ProjectionClock,
}

impl<'a> ConnectionProjectionService<'a> {
    pub fn new(clock: &'a dyn ProjectionClock) -> Self {
        Self { clock }
    }

    pub fn list_page(
        &self,
        connection: &Connection,
        household_id: &str,
        cursor: Option<ConnectorCursorDto>,
        limit: Option<u16>,
    ) -> Result<ConnectorSummaryPageDto, ConnectorProjectionError> {
        if household_id.is_empty()
            || household_id.trim() != household_id
            || household_id.len() > 48
            || !household_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(ConnectorProjectionError::InvalidInput);
        }
        let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT);
        if limit == 0 || limit > MAX_PAGE_LIMIT {
            return Err(ConnectorProjectionError::InvalidLimit);
        }
        if let Some(cursor) = cursor.as_ref() {
            if ConnectorRegistry
                .descriptor(cursor.connector_kind)
                .is_none()
                || !valid_connection_key(&cursor.connection_key)
                || !cursor_exists(connection, household_id, cursor)?
            {
                return Err(ConnectorProjectionError::InvalidCursor);
            }
        }

        let now = self.clock.now(connection)?;
        let adapters: [&dyn ConnectorAdapter; 4] = [
            &GoogleDriveAdapter { now: &now },
            &GmailAdapter { now: &now },
            &WatchedFolderAdapter,
            &ManualImportAdapter,
        ];
        let fetch_limit = usize::from(limit) + 1;
        let mut summaries = Vec::new();
        for adapter in adapters {
            summaries.extend(adapter.list_summaries(
                connection,
                household_id,
                cursor.as_ref(),
                fetch_limit,
            )?);
        }
        finalize_page(summaries, limit)
    }
}

fn finalize_page(
    mut summaries: Vec<ConnectorSummaryDto>,
    limit: u16,
) -> Result<ConnectorSummaryPageDto, ConnectorProjectionError> {
    summaries.sort_by(|left, right| summary_key(left).cmp(&summary_key(right)));
    let mut identities = BTreeSet::new();
    for summary in &summaries {
        summary
            .validate()
            .map_err(|_| ConnectorProjectionError::InvalidProjection)?;
        if !identities.insert((summary.connector_kind, summary.connection_key.as_str())) {
            return Err(ConnectorProjectionError::DuplicateIdentity);
        }
    }

    let has_more = summaries.len() > usize::from(limit);
    summaries.truncate(usize::from(limit));
    let next_cursor = has_more.then(|| {
        let last = summaries.last().expect("a non-empty bounded page");
        ConnectorCursorDto {
            connector_kind: last.connector_kind,
            connection_key: last.connection_key.clone(),
        }
    });
    Ok(ConnectorSummaryPageDto {
        schema_version: 1,
        items: summaries,
        next_cursor,
    })
}

struct GoogleDriveAdapter<'a> {
    now: &'a str,
}

impl ConnectorAdapter for GoogleDriveAdapter<'_> {
    fn list_summaries(
        &self,
        connection: &Connection,
        household_id: &str,
        after_key: Option<&ConnectorCursorDto>,
        limit: usize,
    ) -> Result<Vec<ConnectorSummaryDto>, ConnectorProjectionError> {
        let mut connections =
            google_drive_command_service::list_connections(connection, household_id)
                .map_err(|_| ConnectorProjectionError::Database)?;
        connections.sort_by(|left, right| left.id.cmp(&right.id));
        connections
            .into_iter()
            .filter(|source| is_after(ConnectorKind::GoogleDrive, &source.id, after_key))
            .take(limit)
            .map(|source| {
                let lifecycle = lifecycle_from_drive_status(&source.status);
                let schedule = match google_drive_command_service::get_schedule(
                    connection,
                    household_id,
                    &source.id,
                ) {
                    Ok(schedule) => Some(schedule),
                    Err(google_drive_command_service::GoogleDriveCommandServiceError::Store(
                        google_drive_store::GoogleDriveStoreError::NotFound,
                    )) => None,
                    Err(_) => return Err(ConnectorProjectionError::Database),
                };
                let schedule =
                    project_schedule(connection, lifecycle, schedule.as_ref(), self.now)?;
                let pending_review_count = pending_count(
                    connection,
                    "google_drive_inbox",
                    "connection_id",
                    household_id,
                    &source.id,
                    true,
                )?;
                Ok(ConnectorSummaryDto {
                    schema_version: 1,
                    connector_kind: ConnectorKind::GoogleDrive,
                    connection_key: source.id,
                    display_label: source.folder_name.unwrap_or_else(|| "Google Drive".into()),
                    availability: ConnectorAvailability::Available,
                    lifecycle,
                    health: schedule.health,
                    capabilities: capabilities(ConnectorKind::GoogleDrive, lifecycle),
                    last_attempt_at: schedule.last_attempt_at,
                    last_success_at: schedule.last_success_at,
                    freshness_deadline_at: schedule.freshness_deadline_at,
                    next_due_at: schedule.next_due_at,
                    pending_review_count,
                    consecutive_failures: schedule.consecutive_failures,
                    last_error_code: schedule.last_error_code,
                    binding_summary: None,
                    configuration_destination: ConfigurationDestination::GoogleDriveSettings,
                })
            })
            .collect()
    }
}

struct GmailAdapter<'a> {
    now: &'a str,
}

impl ConnectorAdapter for GmailAdapter<'_> {
    fn list_summaries(
        &self,
        connection: &Connection,
        household_id: &str,
        after_key: Option<&ConnectorCursorDto>,
        limit: usize,
    ) -> Result<Vec<ConnectorSummaryDto>, ConnectorProjectionError> {
        let mut connections = gmail_store::list_connections(connection, household_id)
            .map_err(|_| ConnectorProjectionError::Database)?;
        connections.sort_by(|left, right| left.id.cmp(&right.id));
        connections
            .into_iter()
            .map(gmail_command_service::project_connection)
            .filter(|source| is_after(ConnectorKind::Gmail, &source.id, after_key))
            .take(limit)
            .map(|source| {
                let lifecycle = lifecycle_from_gmail_status(&source.status);
                let schedule =
                    match gmail_store::load_schedule(connection, household_id, &source.id) {
                        Ok(schedule) => Some(schedule),
                        Err(gmail_store::GmailStoreError::NotFound) => None,
                        Err(_) => return Err(ConnectorProjectionError::Database),
                    };
                let schedule =
                    project_schedule(connection, lifecycle, schedule.as_ref(), self.now)?;
                let pending_review_count = pending_count(
                    connection,
                    "gmail_inbox",
                    "connection_id",
                    household_id,
                    &source.id,
                    true,
                )?;
                Ok(ConnectorSummaryDto {
                    schema_version: 1,
                    connector_kind: ConnectorKind::Gmail,
                    connection_key: source.id,
                    display_label: source.label_name.unwrap_or_else(|| "Gmail".into()),
                    availability: ConnectorAvailability::Available,
                    lifecycle,
                    health: schedule.health,
                    capabilities: capabilities(ConnectorKind::Gmail, lifecycle),
                    last_attempt_at: schedule.last_attempt_at,
                    last_success_at: schedule.last_success_at,
                    freshness_deadline_at: schedule.freshness_deadline_at,
                    next_due_at: schedule.next_due_at,
                    pending_review_count,
                    consecutive_failures: schedule.consecutive_failures,
                    last_error_code: schedule.last_error_code,
                    binding_summary: None,
                    configuration_destination: ConfigurationDestination::GmailSettings,
                })
            })
            .collect()
    }
}

struct WatchedFolderAdapter;

impl ConnectorAdapter for WatchedFolderAdapter {
    fn list_summaries(
        &self,
        connection: &Connection,
        household_id: &str,
        after_key: Option<&ConnectorCursorDto>,
        limit: usize,
    ) -> Result<Vec<ConnectorSummaryDto>, ConnectorProjectionError> {
        let mut folders = watched_folders::list(connection, household_id)
            .map_err(|_| ConnectorProjectionError::Database)?;
        folders.sort_by(|left, right| left.id.cmp(&right.id));
        folders
            .into_iter()
            .filter(|source| is_after(ConnectorKind::WatchedFolder, &source.id, after_key))
            .take(limit)
            .map(|source| {
                let lifecycle = if source.is_enabled {
                    ConnectorLifecycle::Connected
                } else {
                    ConnectorLifecycle::Disconnected
                };
                let pending_review_count = pending_count(
                    connection,
                    "watched_file_inbox",
                    "watched_folder_id",
                    household_id,
                    &source.id,
                    false,
                )?;
                Ok(ConnectorSummaryDto {
                    schema_version: 1,
                    connector_kind: ConnectorKind::WatchedFolder,
                    connection_key: source.id,
                    display_label: watched_folder_display_label(
                        &source.label,
                        &source.display_name,
                    ),
                    availability: ConnectorAvailability::Available,
                    lifecycle,
                    health: ConnectorHealth::NeverRefreshed,
                    capabilities: capabilities(ConnectorKind::WatchedFolder, lifecycle),
                    last_attempt_at: None,
                    last_success_at: None,
                    freshness_deadline_at: None,
                    next_due_at: None,
                    pending_review_count,
                    consecutive_failures: 0,
                    last_error_code: None,
                    binding_summary: None,
                    configuration_destination: ConfigurationDestination::WatchedFolderSettings,
                })
            })
            .collect()
    }
}

struct ManualImportAdapter;

impl ConnectorAdapter for ManualImportAdapter {
    fn list_summaries(
        &self,
        connection: &Connection,
        household_id: &str,
        after_key: Option<&ConnectorCursorDto>,
        limit: usize,
    ) -> Result<Vec<ConnectorSummaryDto>, ConnectorProjectionError> {
        if limit == 0 || !is_after(ConnectorKind::ManualImport, "manual-import", after_key) {
            return Ok(Vec::new());
        }
        let pending_review_count = connection
            .query_row(
                "SELECT count(*) FROM import_runs ir
                 WHERE ir.household_id=?1 AND ir.status='REVIEW_REQUIRED'
                   AND EXISTS(SELECT 1 FROM source_documents sd
                              WHERE sd.import_run_id=ir.id AND sd.household_id=ir.household_id
                                AND sd.source_type='MANUAL_UPLOAD')",
                [household_id],
                |row| row.get::<_, u64>(0),
            )
            .map_err(|_| ConnectorProjectionError::Database)?;
        Ok(vec![ConnectorSummaryDto {
            schema_version: 1,
            connector_kind: ConnectorKind::ManualImport,
            connection_key: "manual-import".into(),
            display_label: "Manual import".into(),
            availability: ConnectorAvailability::Available,
            lifecycle: ConnectorLifecycle::Connected,
            health: ConnectorHealth::Manual,
            capabilities: capabilities(ConnectorKind::ManualImport, ConnectorLifecycle::Connected),
            last_attempt_at: None,
            last_success_at: None,
            freshness_deadline_at: None,
            next_due_at: None,
            pending_review_count,
            consecutive_failures: 0,
            last_error_code: None,
            binding_summary: None,
            configuration_destination: ConfigurationDestination::ImportInbox,
        }])
    }
}

trait ScheduleSource {
    fn enabled(&self) -> bool;
    fn interval_minutes(&self) -> u32;
    fn running(&self) -> bool;
    fn next_due_at(&self) -> Option<&String>;
    fn last_attempt_at(&self) -> Option<&String>;
    fn last_success_at(&self) -> Option<&String>;
    fn consecutive_failures(&self) -> u8;
    fn suspension_reason(&self) -> Option<&String>;
    fn last_error_code(&self) -> Option<&String>;
}

macro_rules! impl_schedule_source {
    ($type:path) => {
        impl ScheduleSource for $type {
            fn enabled(&self) -> bool {
                self.enabled
            }
            fn interval_minutes(&self) -> u32 {
                self.interval_minutes
            }
            fn running(&self) -> bool {
                self.running
            }
            fn next_due_at(&self) -> Option<&String> {
                self.next_due_at.as_ref()
            }
            fn last_attempt_at(&self) -> Option<&String> {
                self.last_attempt_at.as_ref()
            }
            fn last_success_at(&self) -> Option<&String> {
                self.last_success_at.as_ref()
            }
            fn consecutive_failures(&self) -> u8 {
                self.consecutive_failures
            }
            fn suspension_reason(&self) -> Option<&String> {
                self.suspension_reason.as_ref()
            }
            fn last_error_code(&self) -> Option<&String> {
                self.last_error_code.as_ref()
            }
        }
    };
}

impl_schedule_source!(google_drive_store::SyncScheduleDto);
impl_schedule_source!(gmail_store::SyncScheduleDto);

struct ScheduleProjection {
    health: ConnectorHealth,
    last_attempt_at: Option<String>,
    last_success_at: Option<String>,
    freshness_deadline_at: Option<String>,
    next_due_at: Option<String>,
    consecutive_failures: u8,
    last_error_code: Option<String>,
}

fn project_schedule<T: ScheduleSource>(
    connection: &Connection,
    lifecycle: ConnectorLifecycle,
    schedule: Option<&T>,
    now: &str,
) -> Result<ScheduleProjection, ConnectorProjectionError> {
    let Some(schedule) = schedule else {
        return Ok(empty_schedule());
    };
    let last_attempt_at = schedule.last_attempt_at().cloned();
    let last_success_at = schedule.last_success_at().cloned();
    let freshness_deadline_at = if schedule.enabled() {
        schedule
            .last_success_at()
            .map(|success| freshness_deadline(connection, success, schedule.interval_minutes()))
            .transpose()?
    } else {
        None
    };
    let deadline_is_stale = freshness_deadline_at
        .as_deref()
        .map(|deadline| timestamp_is_before(connection, deadline, now))
        .transpose()?
        .unwrap_or(false);
    let health = if lifecycle != ConnectorLifecycle::Connected {
        ConnectorHealth::NeverRefreshed
    } else if schedule
        .suspension_reason()
        .is_some_and(|reason| reason != "RETRY_BACKOFF")
    {
        ConnectorHealth::NeedsAction
    } else if schedule.running() {
        ConnectorHealth::Running
    } else if schedule
        .suspension_reason()
        .is_some_and(|reason| reason == "RETRY_BACKOFF")
    {
        ConnectorHealth::RetryBackoff
    } else if deadline_is_stale {
        ConnectorHealth::Stale
    } else if last_success_at.is_some() {
        ConnectorHealth::Fresh
    } else {
        ConnectorHealth::NeverRefreshed
    };
    Ok(ScheduleProjection {
        health,
        last_attempt_at,
        last_success_at,
        freshness_deadline_at,
        next_due_at: schedule.next_due_at().cloned(),
        consecutive_failures: schedule.consecutive_failures(),
        last_error_code: schedule.last_error_code().cloned(),
    })
}

fn empty_schedule() -> ScheduleProjection {
    ScheduleProjection {
        health: ConnectorHealth::NeverRefreshed,
        last_attempt_at: None,
        last_success_at: None,
        freshness_deadline_at: None,
        next_due_at: None,
        consecutive_failures: 0,
        last_error_code: None,
    }
}

fn freshness_deadline(
    connection: &Connection,
    last_success_at: &str,
    interval_minutes: u32,
) -> Result<String, ConnectorProjectionError> {
    connection
        .query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%fZ',?1,?2)",
            params![last_success_at, format!("+{interval_minutes} minutes")],
            |row| row.get(0),
        )
        .map_err(|_| ConnectorProjectionError::InvalidProjection)
}

fn timestamp_is_before(
    connection: &Connection,
    left: &str,
    right: &str,
) -> Result<bool, ConnectorProjectionError> {
    connection
        .query_row(
            "SELECT julianday(?1) < julianday(?2)",
            params![left, right],
            |row| row.get(0),
        )
        .map_err(|_| ConnectorProjectionError::InvalidProjection)
}

fn pending_count(
    connection: &Connection,
    table: &str,
    connection_column: &str,
    household_id: &str,
    connection_key: &str,
    includes_terminal_discovery_states: bool,
) -> Result<u64, ConnectorProjectionError> {
    let states = if includes_terminal_discovery_states {
        "('DISCOVERED','READY','NEEDS_MAPPING','FAILED','TOO_LARGE','UNSUPPORTED')"
    } else {
        "('DISCOVERED','READY','NEEDS_MAPPING','FAILED')"
    };
    let sql = format!(
        "SELECT count(*) FROM {table} WHERE household_id=?1 AND {connection_column}=?2 AND state IN {states}"
    );
    connection
        .query_row(&sql, params![household_id, connection_key], |row| {
            row.get(0)
        })
        .map_err(|_| ConnectorProjectionError::Database)
}

fn capabilities(kind: ConnectorKind, lifecycle: ConnectorLifecycle) -> Vec<ConnectorCapability> {
    let descriptor = ConnectorRegistry
        .descriptor(kind)
        .expect("the closed registry contains every connector kind");
    descriptor
        .capabilities
        .iter()
        .copied()
        .filter(|capability| {
            lifecycle == ConnectorLifecycle::Connected
                || !matches!(
                    capability,
                    ConnectorCapability::RefreshNow
                        | ConnectorCapability::Schedule
                        | ConnectorCapability::Retry
                )
        })
        .collect()
}

fn watched_folder_display_label(label: &str, display_name: &str) -> String {
    let mut output = format!("{label} · ");
    for character in display_name.chars() {
        if output.len() + character.len_utf8() > 256 {
            break;
        }
        output.push(character);
    }
    output
}

fn lifecycle_from_drive_status(status: &str) -> ConnectorLifecycle {
    match status {
        "CONNECTED" => ConnectorLifecycle::Connected,
        "AUTHORIZING" | "SELECTING_FOLDER" => ConnectorLifecycle::Configuring,
        _ => ConnectorLifecycle::Disconnected,
    }
}

fn lifecycle_from_gmail_status(status: &str) -> ConnectorLifecycle {
    match status {
        "CONNECTED" => ConnectorLifecycle::Connected,
        "AUTHORIZING" | "SELECTING_LABEL" => ConnectorLifecycle::Configuring,
        _ => ConnectorLifecycle::Disconnected,
    }
}

fn summary_key(summary: &ConnectorSummaryDto) -> (ConnectorKind, &str) {
    (summary.connector_kind, &summary.connection_key)
}

fn is_after(kind: ConnectorKind, key: &str, cursor: Option<&ConnectorCursorDto>) -> bool {
    cursor
        .is_none_or(|cursor| (kind, key) > (cursor.connector_kind, cursor.connection_key.as_str()))
}

fn valid_connection_key(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.len() <= MAX_CONNECTION_KEY_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'/')
}

fn cursor_exists(
    connection: &Connection,
    household_id: &str,
    cursor: &ConnectorCursorDto,
) -> Result<bool, ConnectorProjectionError> {
    if cursor.connector_kind == ConnectorKind::ManualImport {
        return Ok(cursor.connection_key == "manual-import");
    }
    let table = match cursor.connector_kind {
        ConnectorKind::GoogleDrive => "google_drive_connections",
        ConnectorKind::Gmail => "gmail_connections",
        ConnectorKind::WatchedFolder => "watched_folders",
        ConnectorKind::ManualImport => unreachable!(),
    };
    let sql = format!("SELECT 1 FROM {table} WHERE household_id=?1 AND id=?2");
    connection
        .query_row(&sql, params![household_id, &cursor.connection_key], |_| {
            Ok(true)
        })
        .optional()
        .map(Option::unwrap_or_default)
        .map_err(|_| ConnectorProjectionError::Database)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        connector_control::{ConnectorHealth, ConnectorKind, ConnectorLifecycle},
        persistence::AppState,
    };
    use rusqlite::Connection;

    const NOW: &str = "2026-08-25T12:00:00.000Z";

    struct FixedClock;

    impl ProjectionClock for FixedClock {
        fn now(&self, _connection: &Connection) -> Result<String, ConnectorProjectionError> {
            Ok(NOW.into())
        }
    }

    fn migrated_state() -> AppState {
        AppState::in_memory(b"connector-projection-test-key").unwrap()
    }

    fn seed_contract_fixture(connection: &Connection) {
        connection
            .execute_batch(
                r#"
                INSERT INTO households(id,name) VALUES ('home','Home'),('other','Other');

                INSERT INTO google_drive_connections(
                    id,household_id,google_account_id,account_email,client_id_fingerprint,
                    root_folder_id,root_folder_name,status,start_page_token,change_page_token
                ) VALUES
                    ('drive-connected','home','provider-drive-home','home@example.test',
                     'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                     'provider-folder-home','Household statements','CONNECTED',
                     'start-page-token-secret','change-page-token-secret'),
                    ('drive-configuring','home',NULL,NULL,
                     'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                     NULL,NULL,'AUTHORIZING',NULL,NULL),
                    ('drive-disconnected','home',NULL,NULL,
                     'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                     NULL,NULL,'DISCONNECTED',NULL,NULL),
                    ('drive-other','other','provider-drive-other','other@example.test',
                     'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
                     'provider-folder-other','Other household private','CONNECTED',
                     'other-start-secret','other-change-secret');

                INSERT INTO google_drive_sync_schedules(
                    connection_id,enabled,interval_minutes,next_due_at,last_attempt_at,last_success_at,
                    last_result,consecutive_failures
                ) VALUES
                    ('drive-connected',1,30,'2026-08-25T11:30:00.000Z',
                     '2026-08-25T10:00:00.000Z','2026-08-25T10:00:00.000Z','NO_CHANGES',0),
                    ('drive-other',0,30,NULL,'2026-08-25T11:00:00.000Z',
                     '2026-08-25T11:00:00.000Z','DISABLED',0);

                INSERT INTO google_drive_nodes(
                    connection_id,file_id,name,mime_type,generation_fingerprint,
                    is_folder,can_download,is_in_selected_tree,is_trashed
                ) VALUES
                    ('drive-connected','provider-file-home','statement.csv','text/csv',
                     '1111111111111111111111111111111111111111111111111111111111111111',0,1,1,0),
                    ('drive-other','provider-file-other','other.csv','text/csv',
                     '2222222222222222222222222222222222222222222222222222222222222222',0,1,1,0);

                INSERT INTO google_drive_inbox(
                    id,household_id,connection_id,file_id,generation_fingerprint,file_name,media_type,state
                ) VALUES
                    ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','home',
                     'drive-connected','provider-file-home',
                     '1111111111111111111111111111111111111111111111111111111111111111',
                     'statement.csv','text/csv','READY'),
                    ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','other',
                     'drive-other','provider-file-other',
                     '2222222222222222222222222222222222222222222222222222222222222222',
                     'other.csv','text/csv','READY');

                INSERT INTO gmail_connections(
                    id,household_id,google_account_id,account_email,client_id_fingerprint,
                    gmail_query,label_id,label_name,status,start_history_id,history_id
                ) VALUES
                    ('gmail-connected','home','provider-gmail-home','mail@example.test',
                     'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                     'has:attachment','Label_provider_secret','Bank statements','CONNECTED','100','101'),
                    ('gmail-configuring','home',NULL,NULL,
                     'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
                     'has:attachment',NULL,NULL,'AUTHORIZING',NULL,NULL),
                    ('gmail-disconnected','home',NULL,NULL,
                     'abababababababababababababababababababababababababababababababab',
                     'has:attachment',NULL,NULL,'DISCONNECTED',NULL,NULL),
                    ('gmail-never','home','provider-gmail-never','never@example.test',
                     '1212121212121212121212121212121212121212121212121212121212121212',
                     'has:attachment','Label_never_secret','New mailbox','CONNECTED','300','301'),
                    ('gmail-other','other','provider-gmail-other','other@example.test',
                     'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
                     'has:attachment','Label_other_secret','Other private','CONNECTED','200','201');

                INSERT INTO gmail_sync_schedules(
                    connection_id,enabled,interval_minutes,next_due_at,last_attempt_at,last_success_at,
                    last_result,consecutive_failures
                ) VALUES
                    ('gmail-connected',0,30,NULL,'2026-08-25T11:00:00.000Z',
                     '2026-08-25T11:00:00.000Z','DISABLED',0),
                    ('gmail-never',0,30,NULL,NULL,NULL,'DISABLED',0),
                    ('gmail-other',1,30,'2026-08-25T12:30:00.000Z',NULL,NULL,'NEVER',0);

                INSERT INTO gmail_inbox(
                    id,household_id,connection_id,provider_message_id,generation_fingerprint,
                    message_history_id,internal_date_ms,file_name,state
                ) VALUES
                    ('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','home',
                     'gmail-connected','provider-message-secret',
                     '3333333333333333333333333333333333333333333333333333333333333333',
                     '101',1,'message.eml','NEEDS_MAPPING'),
                    ('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','other',
                     'gmail-other','provider-message-other',
                     '4444444444444444444444444444444444444444444444444444444444444444',
                     '201',2,'other.eml','NEEDS_MAPPING');

                INSERT INTO watched_folders(
                    id,household_id,label,canonical_path,is_enabled,source_type,provider
                ) VALUES
                    ('watched-home','home','Receipt Inbox','/Users/private/receipt-inbox',1,'LOCAL_FOLDER','LOCAL'),
                    ('watched-other','other','Other Inbox','/Users/private/other-inbox',1,'LOCAL_FOLDER','LOCAL');

                INSERT INTO watched_file_inbox(
                    id,household_id,watched_folder_id,relative_path,file_name,media_type,
                    byte_size,fingerprint,state
                ) VALUES
                    ('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','home',
                     'watched-home','private.csv','private.csv','text/csv',1,
                     '5555555555555555555555555555555555555555555555555555555555555555','DISCOVERED'),
                    ('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','other',
                     'watched-other','other.csv','other.csv','text/csv',1,
                     '6666666666666666666666666666666666666666666666666666666666666666','DISCOVERED');

                INSERT INTO import_runs(id,household_id,status) VALUES
                    ('manual-review-home','home','REVIEW_REQUIRED'),
                    ('manual-posted-home','home','POSTED'),
                    ('manual-review-other','other','REVIEW_REQUIRED');
                INSERT INTO source_documents(
                    id,household_id,import_run_id,source_type,original_filename,media_type,
                    byte_size,sha256,storage_path
                ) VALUES
                    ('manual-document-home','home','manual-review-home','MANUAL_UPLOAD',
                     'source-secret.csv','text/csv',1,
                     '7777777777777777777777777777777777777777777777777777777777777777',
                     '/Users/private/source-secret.csv'),
                    ('manual-document-posted','home','manual-posted-home','MANUAL_UPLOAD',
                     'posted.csv','text/csv',1,
                     '8888888888888888888888888888888888888888888888888888888888888888',
                     '/Users/private/posted.csv'),
                    ('manual-document-other','other','manual-review-other','MANUAL_UPLOAD',
                     'other-secret.csv','text/csv',1,
                     '9999999999999999999999999999999999999999999999999999999999999999',
                     '/Users/private/other-secret.csv');
                "#,
            )
            .unwrap();
    }

    #[test]
    fn projects_household_scoped_ordered_redacted_summaries_from_authoritative_rows() {
        let state = migrated_state();
        state
            .with_connection(|connection| {
                seed_contract_fixture(connection);
                let page = ConnectionProjectionService::new(&FixedClock)
                    .list_page(connection, "home", None, Some(100))
                    .unwrap();

                let identities = page
                    .items
                    .iter()
                    .map(|summary| (summary.connector_kind, summary.connection_key.as_str()))
                    .collect::<Vec<_>>();
                assert_eq!(
                    identities,
                    vec![
                        (ConnectorKind::GoogleDrive, "drive-configuring"),
                        (ConnectorKind::GoogleDrive, "drive-connected"),
                        (ConnectorKind::GoogleDrive, "drive-disconnected"),
                        (ConnectorKind::Gmail, "gmail-configuring"),
                        (ConnectorKind::Gmail, "gmail-connected"),
                        (ConnectorKind::Gmail, "gmail-disconnected"),
                        (ConnectorKind::Gmail, "gmail-never"),
                        (ConnectorKind::WatchedFolder, "watched-home"),
                        (ConnectorKind::ManualImport, "manual-import"),
                    ]
                );
                assert!(page.next_cursor.is_none());

                let drive = page
                    .items
                    .iter()
                    .find(|item| item.connection_key == "drive-connected")
                    .unwrap();
                assert_eq!(drive.lifecycle, ConnectorLifecycle::Connected);
                assert_eq!(drive.health, ConnectorHealth::Stale);
                assert_eq!(drive.pending_review_count, 1);
                assert_eq!(
                    drive.freshness_deadline_at.as_deref(),
                    Some("2026-08-25T10:30:00.000Z")
                );

                let gmail = page
                    .items
                    .iter()
                    .find(|item| item.connection_key == "gmail-connected")
                    .unwrap();
                assert_eq!(gmail.health, ConnectorHealth::Fresh);
                assert_eq!(gmail.freshness_deadline_at, None);
                assert_eq!(gmail.pending_review_count, 1);

                let gmail_never = page
                    .items
                    .iter()
                    .find(|item| item.connection_key == "gmail-never")
                    .unwrap();
                assert_eq!(gmail_never.health, ConnectorHealth::NeverRefreshed);
                assert_eq!(gmail_never.freshness_deadline_at, None);

                let watched = page
                    .items
                    .iter()
                    .find(|item| item.connection_key == "watched-home")
                    .unwrap();
                assert_eq!(watched.lifecycle, ConnectorLifecycle::Connected);
                assert_eq!(watched.health, ConnectorHealth::NeverRefreshed);
                assert_eq!(watched.display_label, "Receipt Inbox · receipt-inbox");
                assert_eq!(watched.pending_review_count, 1);

                let manual = page
                    .items
                    .iter()
                    .filter(|item| item.connector_kind == ConnectorKind::ManualImport)
                    .collect::<Vec<_>>();
                assert_eq!(manual.len(), 1);
                assert_eq!(manual[0].connection_key, "manual-import");
                assert_eq!(manual[0].lifecycle, ConnectorLifecycle::Connected);
                assert_eq!(manual[0].health, ConnectorHealth::Manual);
                assert_eq!(manual[0].pending_review_count, 1);

                let json = serde_json::to_string(&page).unwrap();
                for forbidden in [
                    "provider-drive-home",
                    "provider-folder-home",
                    "start-page-token-secret",
                    "change-page-token-secret",
                    "Label_provider_secret",
                    "provider-message-secret",
                    "/Users/private",
                    "private.csv",
                    "source-secret.csv",
                ] {
                    assert!(
                        !json.contains(forbidden),
                        "serialized provider data: {forbidden}"
                    );
                }
                assert!(!json.contains("drive-other"));
                assert!(!json.contains("gmail-other"));
                assert!(!json.contains("watched-other"));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn paginates_at_one_hundred_with_a_structured_registry_cursor() {
        let state = migrated_state();
        state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])?;
                for index in 0..105 {
                    connection.execute(
                        "INSERT INTO watched_folders(id,household_id,label,canonical_path,source_type,provider) VALUES(?1,'home',?2,?3,'LOCAL_FOLDER','LOCAL')",
                        rusqlite::params![format!("folder-{index:03}"), format!("Folder {index:03}"), format!("/safe/folder-{index:03}")],
                    )?;
                }

                let service = ConnectionProjectionService::new(&FixedClock);
                let first = service.list_page(connection, "home", None, Some(100)).unwrap();
                assert_eq!(first.items.len(), 100);
                assert_eq!(first.items[0].connection_key, "folder-000");
                assert_eq!(first.items[99].connection_key, "folder-099");
                assert_eq!(first.next_cursor.as_ref().unwrap().connector_kind, ConnectorKind::WatchedFolder);
                assert_eq!(first.next_cursor.as_ref().unwrap().connection_key, "folder-099");

                let second = service.list_page(connection, "home", first.next_cursor, Some(100)).unwrap();
                assert_eq!(second.items.len(), 6);
                assert_eq!(second.items[0].connection_key, "folder-100");
                assert_eq!(second.items[5].connection_key, "manual-import");
                assert!(second.next_cursor.is_none());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn rejects_zero_oversized_and_non_household_cursors() {
        let state = migrated_state();
        state
            .with_connection(|connection| {
                seed_contract_fixture(connection);
                let service = ConnectionProjectionService::new(&FixedClock);
                assert_eq!(
                    service
                        .list_page(connection, "home", None, Some(0))
                        .unwrap_err(),
                    ConnectorProjectionError::InvalidLimit
                );
                assert_eq!(
                    service
                        .list_page(connection, "home", None, Some(101))
                        .unwrap_err(),
                    ConnectorProjectionError::InvalidLimit
                );
                assert_eq!(
                    service
                        .list_page(
                            connection,
                            "home",
                            Some(ConnectorCursorDto {
                                connector_kind: ConnectorKind::Gmail,
                                connection_key: "gmail-other".into(),
                            }),
                            Some(10),
                        )
                        .unwrap_err(),
                    ConnectorProjectionError::InvalidCursor
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn service_rejects_duplicate_connector_identities_before_serialization() {
        let state = migrated_state();
        state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])?;
                let summary = ConnectionProjectionService::new(&FixedClock)
                    .list_page(connection, "home", None, Some(1))
                    .unwrap()
                    .items
                    .remove(0);
                assert_eq!(
                    finalize_page(vec![summary.clone(), summary], 100).unwrap_err(),
                    ConnectorProjectionError::DuplicateIdentity
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn watched_folder_display_text_keeps_both_safe_parts_within_public_byte_bound() {
        let state = migrated_state();
        state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])?;
                let label = "L".repeat(80);
                let leaf = "日".repeat(80);
                connection.execute(
                    "INSERT INTO watched_folders(id,household_id,label,canonical_path,source_type,provider) VALUES('folder','home',?1,?2,'LOCAL_FOLDER','LOCAL')",
                    rusqlite::params![label, format!("/safe/{leaf}")],
                )?;
                let page = ConnectionProjectionService::new(&FixedClock)
                    .list_page(connection, "home", None, Some(10))
                    .unwrap();
                let display = &page.items[0].display_label;
                assert!(display.starts_with(&format!("{} · ", "L".repeat(80))));
                assert!(display.contains('日'));
                assert!(display.len() <= 256);
                Ok(())
            })
            .unwrap();
    }
}
