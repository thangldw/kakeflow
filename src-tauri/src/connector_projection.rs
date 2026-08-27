use crate::{
    connector_control::{
        ConfigurationDestination, ConnectorAvailability, ConnectorBindingSummaryDto,
        ConnectorCapability, ConnectorHealth, ConnectorKind, ConnectorLifecycle,
        ConnectorRegistry, ConnectorSummaryDto,
    },
    folder_discovery, gmail_command_service, gmail_store, google_drive_command_service,
    google_drive_store,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;
use std::path::Path;
use thiserror::Error;

const DEFAULT_PAGE_LIMIT: u16 = 100;
const MAX_PAGE_LIMIT: u16 = 100;
const MAX_CONNECTION_KEY_BYTES: usize = 128;

#[cfg(test)]
thread_local! {
    static MATERIALIZED_SOURCE_ROWS: std::cell::RefCell<std::collections::BTreeMap<ConnectorKind, usize>> =
        std::cell::RefCell::new(std::collections::BTreeMap::new());
}

#[cfg(test)]
fn record_materialized_source_rows(kind: ConnectorKind, count: usize) {
    MATERIALIZED_SOURCE_ROWS.with(|counts| {
        counts.borrow_mut().insert(kind, count);
    });
}

#[cfg(test)]
fn reset_materialized_source_rows() {
    MATERIALIZED_SOURCE_ROWS.with(|counts| counts.borrow_mut().clear());
}

#[cfg(test)]
fn materialized_source_rows(kind: ConnectorKind) -> usize {
    MATERIALIZED_SOURCE_ROWS.with(|counts| counts.borrow().get(&kind).copied().unwrap_or_default())
}

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
            &WatchedFolderAdapter { now: &now },
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
        let Some(after_key) = adapter_after_key(ConnectorKind::GoogleDrive, after_key) else {
            return Ok(Vec::new());
        };
        let connection_ids = list_bounded_source_ids(
            connection,
            "google_drive_connections",
            household_id,
            after_key,
            limit,
        )?;
        #[cfg(test)]
        record_materialized_source_rows(ConnectorKind::GoogleDrive, connection_ids.len());
        connection_ids
            .into_iter()
            .map(|connection_id| {
                let source = google_drive_command_service::load_connection(
                    connection,
                    household_id,
                    &connection_id,
                )
                .map_err(|_| ConnectorProjectionError::Database)?;
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
                let binding_summary = project_binding_summary(
                    connection,
                    household_id,
                    ConnectorKind::GoogleDrive,
                    &source.id,
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
                    binding_summary,
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
        let Some(after_key) = adapter_after_key(ConnectorKind::Gmail, after_key) else {
            return Ok(Vec::new());
        };
        let connection_ids = list_bounded_source_ids(
            connection,
            "gmail_connections",
            household_id,
            after_key,
            limit,
        )?;
        #[cfg(test)]
        record_materialized_source_rows(ConnectorKind::Gmail, connection_ids.len());
        connection_ids
            .into_iter()
            .map(|connection_id| {
                let source = gmail_command_service::project_connection(
                    gmail_store::load_connection(connection, household_id, &connection_id)
                        .map_err(|_| ConnectorProjectionError::Database)?,
                );
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
                let binding_summary = project_binding_summary(
                    connection,
                    household_id,
                    ConnectorKind::Gmail,
                    &source.id,
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
                    binding_summary,
                    configuration_destination: ConfigurationDestination::GmailSettings,
                })
            })
            .collect()
    }
}

struct WatchedFolderAdapter<'a> {
    now: &'a str,
}

impl ConnectorAdapter for WatchedFolderAdapter<'_> {
    fn list_summaries(
        &self,
        connection: &Connection,
        household_id: &str,
        after_key: Option<&ConnectorCursorDto>,
        limit: usize,
    ) -> Result<Vec<ConnectorSummaryDto>, ConnectorProjectionError> {
        let Some(after_key) = adapter_after_key(ConnectorKind::WatchedFolder, after_key) else {
            return Ok(Vec::new());
        };
        let folders = list_bounded_watched_folders(connection, household_id, after_key, limit)?;
        #[cfg(test)]
        record_materialized_source_rows(ConnectorKind::WatchedFolder, folders.len());
        folders
            .into_iter()
            .map(|source| {
                let lifecycle = if source.is_enabled {
                    ConnectorLifecycle::Connected
                } else {
                    ConnectorLifecycle::Disconnected
                };
                let runtime = project_watched_folder_runtime(
                    connection,
                    household_id,
                    &source.id,
                    lifecycle,
                    self.now,
                )?;
                let pending_review_count = pending_count(
                    connection,
                    "watched_file_inbox",
                    "watched_folder_id",
                    household_id,
                    &source.id,
                    false,
                )?;
                let binding_summary = project_binding_summary(
                    connection,
                    household_id,
                    ConnectorKind::WatchedFolder,
                    &source.id,
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
                    health: runtime.health,
                    capabilities: capabilities(ConnectorKind::WatchedFolder, lifecycle),
                    last_attempt_at: runtime.last_attempt_at,
                    last_success_at: runtime.last_success_at,
                    freshness_deadline_at: runtime.freshness_deadline_at,
                    next_due_at: runtime.next_due_at,
                    pending_review_count,
                    consecutive_failures: runtime.consecutive_failures,
                    last_error_code: runtime.last_error_code,
                    binding_summary,
                    configuration_destination: ConfigurationDestination::WatchedFolderSettings,
                })
            })
            .collect()
    }
}

fn project_watched_folder_runtime(
    connection: &Connection,
    household_id: &str,
    connection_key: &str,
    lifecycle: ConnectorLifecycle,
    now: &str,
) -> Result<ScheduleProjection, ConnectorProjectionError> {
    let observation = connection
        .query_row(
            "SELECT last_attempt_at,last_success_at,consecutive_failures,last_error_code
             FROM connector_runtime_observations
             WHERE household_id=?1 AND connector_kind='WATCHED_FOLDER' AND connection_key=?2",
            params![household_id, connection_key],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|_| ConnectorProjectionError::Database)?;
    let Some((last_attempt_at, last_success_at, consecutive_failures, last_error_code)) =
        observation
    else {
        return Ok(empty_schedule());
    };
    let consecutive_failures = consecutive_failures.min(u64::from(u8::MAX)) as u8;
    let freshness_deadline_at = last_success_at
        .as_deref()
        .map(|timestamp| timestamp_after_poll_interval(connection, timestamp))
        .transpose()?;
    let next_due_at = last_attempt_at
        .as_deref()
        .map(|timestamp| timestamp_after_poll_interval(connection, timestamp))
        .transpose()?;
    let deadline_is_stale = freshness_deadline_at
        .as_deref()
        .map(|deadline| timestamp_is_before(connection, deadline, now))
        .transpose()?
        .unwrap_or(false);
    let health = if lifecycle != ConnectorLifecycle::Connected {
        ConnectorHealth::NeverRefreshed
    } else if last_error_code.as_deref().is_some_and(|code| {
        matches!(
            code,
            "FOLDER_SCAN_LIMIT" | "FOLDER_CONFIGURATION_REQUIRED" | "FOLDER_RECONCILE_REQUIRED"
        )
    }) {
        ConnectorHealth::NeedsAction
    } else if last_error_code.is_some() {
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
        next_due_at,
        consecutive_failures,
        last_error_code,
    })
}

fn timestamp_after_poll_interval(
    connection: &Connection,
    timestamp: &str,
) -> Result<String, ConnectorProjectionError> {
    connection
        .query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%fZ',?1,?2)",
            params![
                timestamp,
                format!("+{} seconds", folder_discovery::POLL_INTERVAL_SECONDS)
            ],
            |row| row.get(0),
        )
        .map_err(|_| ConnectorProjectionError::InvalidProjection)
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
        let binding_summary = project_binding_summary(
            connection,
            household_id,
            ConnectorKind::ManualImport,
            "manual-import",
        )?;
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
            binding_summary,
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

fn project_binding_summary(
    connection: &Connection,
    household_id: &str,
    connector_kind: ConnectorKind,
    connection_key: &str,
) -> Result<Option<ConnectorBindingSummaryDto>, ConnectorProjectionError> {
    let connector_kind = match connector_kind {
        ConnectorKind::GoogleDrive => "GOOGLE_DRIVE",
        ConnectorKind::Gmail => "GMAIL",
        ConnectorKind::WatchedFolder => "WATCHED_FOLDER",
        ConnectorKind::ManualImport => "MANUAL_IMPORT",
    };
    let row = connection
        .query_row(
            "SELECT count(a.account_id),b.parser_profile_id IS NOT NULL,b.version
             FROM connector_bindings b
             LEFT JOIN connector_binding_accounts a
               ON a.household_id=b.household_id AND a.connector_kind=b.connector_kind
              AND a.connection_key=b.connection_key
             WHERE b.household_id=?1 AND b.connector_kind=?2 AND b.connection_key=?3
             GROUP BY b.household_id,b.connector_kind,b.connection_key",
            params![household_id, connector_kind, connection_key],
            |row| {
                Ok((
                    row.get::<_, u64>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, u64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|_| ConnectorProjectionError::Database)?;
    let Some((allowed_account_count, parser_profile_configured, version)) = row else {
        return Ok(None);
    };
    if !(1..=256).contains(&allowed_account_count)
        || version == 0
        || version > 9_007_199_254_740_991
    {
        return Err(ConnectorProjectionError::InvalidProjection);
    }
    Ok(Some(ConnectorBindingSummaryDto {
        allowed_account_count: allowed_account_count as u16,
        parser_profile_configured,
        version,
    }))
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

fn adapter_after_key<'a>(
    kind: ConnectorKind,
    cursor: Option<&'a ConnectorCursorDto>,
) -> Option<Option<&'a str>> {
    match cursor {
        None => Some(None),
        Some(cursor) if kind < cursor.connector_kind => None,
        Some(cursor) if kind == cursor.connector_kind => Some(Some(&cursor.connection_key)),
        Some(_) => Some(None),
    }
}

fn list_bounded_source_ids(
    connection: &Connection,
    table: &str,
    household_id: &str,
    after_key: Option<&str>,
    limit: usize,
) -> Result<Vec<String>, ConnectorProjectionError> {
    let sql = format!(
        "SELECT id FROM {table}
         WHERE household_id=?1 AND (?2 IS NULL OR id>?2)
         ORDER BY id LIMIT ?3"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|_| ConnectorProjectionError::Database)?;
    let rows = statement
        .query_map(params![household_id, after_key, limit], |row| row.get(0))
        .map_err(|_| ConnectorProjectionError::Database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| ConnectorProjectionError::Database)?;
    Ok(rows)
}

struct WatchedFolderProjectionRow {
    id: String,
    label: String,
    display_name: String,
    is_enabled: bool,
}

fn list_bounded_watched_folders(
    connection: &Connection,
    household_id: &str,
    after_key: Option<&str>,
    limit: usize,
) -> Result<Vec<WatchedFolderProjectionRow>, ConnectorProjectionError> {
    let mut statement = connection
        .prepare(
            "SELECT id,label,canonical_path,is_enabled FROM watched_folders
             WHERE household_id=?1 AND (?2 IS NULL OR id>?2)
             ORDER BY id LIMIT ?3",
        )
        .map_err(|_| ConnectorProjectionError::Database)?;
    let rows = statement
        .query_map(params![household_id, after_key, limit], |row| {
            let canonical_path: String = row.get(2)?;
            Ok(WatchedFolderProjectionRow {
                id: row.get(0)?,
                label: row.get(1)?,
                display_name: Path::new(&canonical_path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Selected folder")
                    .to_owned(),
                is_enabled: row.get(3)?,
            })
        })
        .map_err(|_| ConnectorProjectionError::Database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| ConnectorProjectionError::Database)?;
    Ok(rows)
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
    fn projects_redacted_binding_summaries_for_every_connector_kind() {
        let state = migrated_state();
        state
            .with_connection(|connection| {
                seed_contract_fixture(connection);
                connection.execute_batch(
                    r#"
                    INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,is_archived)
                    VALUES('bank','home','Bank','ASSET','BANK',0),
                          ('reserve','home','Reserve','ASSET','BANK',0);
                    INSERT INTO delimited_parser_profiles(
                        id,household_id,name,delimiter,encoding,header_row,date_column,date_format,
                        description_column,amount_mode,signed_positive_direction,signed_amount_column,
                        is_enabled,priority,version
                    ) VALUES(
                        'profile','home','Bank CSV','COMMA','UTF8',1,'date','YYYY_MM_DD',
                        'description','SIGNED','OUT','amount',1,1,2
                    );
                    INSERT INTO connector_bindings(
                        household_id,connector_kind,connection_key,parser_profile_id,
                        parser_profile_version,version
                    ) VALUES
                        ('home','GOOGLE_DRIVE','drive-connected','profile',2,7),
                        ('home','GMAIL','gmail-connected',NULL,NULL,3),
                        ('home','WATCHED_FOLDER','watched-home',NULL,NULL,4),
                        ('home','MANUAL_IMPORT','manual-import',NULL,NULL,5);
                    INSERT INTO connector_binding_accounts(
                        household_id,connector_kind,connection_key,account_id
                    ) VALUES
                        ('home','GOOGLE_DRIVE','drive-connected','bank'),
                        ('home','GOOGLE_DRIVE','drive-connected','reserve'),
                        ('home','GMAIL','gmail-connected','bank'),
                        ('home','WATCHED_FOLDER','watched-home','reserve'),
                        ('home','MANUAL_IMPORT','manual-import','bank');
                    "#,
                )?;

                let page = ConnectionProjectionService::new(&FixedClock)
                    .list_page(connection, "home", None, Some(100))
                    .unwrap();
                let summary = |kind, key| {
                    page.items
                        .iter()
                        .find(|item| item.connector_kind == kind && item.connection_key == key)
                        .unwrap()
                        .binding_summary
                        .clone()
                };

                assert_eq!(
                    summary(ConnectorKind::GoogleDrive, "drive-connected"),
                    Some(crate::connector_control::ConnectorBindingSummaryDto {
                        allowed_account_count: 2,
                        parser_profile_configured: true,
                        version: 7,
                    })
                );
                assert_eq!(
                    summary(ConnectorKind::Gmail, "gmail-connected"),
                    Some(crate::connector_control::ConnectorBindingSummaryDto {
                        allowed_account_count: 1,
                        parser_profile_configured: false,
                        version: 3,
                    })
                );
                assert_eq!(
                    summary(ConnectorKind::WatchedFolder, "watched-home"),
                    Some(crate::connector_control::ConnectorBindingSummaryDto {
                        allowed_account_count: 1,
                        parser_profile_configured: false,
                        version: 4,
                    })
                );
                assert_eq!(
                    summary(ConnectorKind::ManualImport, "manual-import"),
                    Some(crate::connector_control::ConnectorBindingSummaryDto {
                        allowed_account_count: 1,
                        parser_profile_configured: false,
                        version: 5,
                    })
                );
                assert_eq!(
                    summary(ConnectorKind::GoogleDrive, "drive-configuring"),
                    None
                );
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
                assert_eq!(materialized_source_rows(ConnectorKind::WatchedFolder), 5);
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

    #[test]
    fn watched_freshness_is_derived_from_safe_observation_and_fixed_poll_policy() {
        let state = migrated_state();
        state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])?;
                connection.execute(
                    "INSERT INTO watched_folders(
                         id,household_id,label,canonical_path,source_type,provider
                     ) VALUES('folder','home','Bank','/safe/bank','LOCAL_FOLDER','LOCAL')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO connector_runtime_observations(
                         household_id,connector_kind,connection_key,last_attempt_at,last_success_at,
                         consecutive_failures,updated_at
                     ) VALUES('home','WATCHED_FOLDER','folder','2026-08-25T11:59:55.000Z',
                              '2026-08-25T11:59:55.000Z',0,'2026-08-25T11:59:55.000Z')",
                    [],
                )?;
                let service = ConnectionProjectionService::new(&FixedClock);
                let fresh = service
                    .list_page(connection, "home", None, Some(10))
                    .unwrap();
                let watched = fresh
                    .items
                    .iter()
                    .find(|item| item.connector_kind == ConnectorKind::WatchedFolder)
                    .unwrap();
                assert_eq!(watched.health, ConnectorHealth::Fresh);
                assert_eq!(
                    watched.freshness_deadline_at.as_deref(),
                    Some("2026-08-25T12:00:05.000Z")
                );
                assert_eq!(
                    watched.next_due_at.as_deref(),
                    Some("2026-08-25T12:00:05.000Z")
                );

                connection.execute(
                    "UPDATE connector_runtime_observations SET
                         last_attempt_at='2026-08-25T11:59:59.000Z',consecutive_failures=1,
                         last_error_code='FOLDER_UNAVAILABLE',updated_at='2026-08-25T11:59:59.000Z'
                     WHERE household_id='home' AND connector_kind='WATCHED_FOLDER'
                       AND connection_key='folder'",
                    [],
                )?;
                let retrying = service
                    .list_page(connection, "home", None, Some(10))
                    .unwrap();
                let watched = retrying
                    .items
                    .iter()
                    .find(|item| item.connector_kind == ConnectorKind::WatchedFolder)
                    .unwrap();
                assert_eq!(watched.health, ConnectorHealth::RetryBackoff);
                assert_eq!(watched.consecutive_failures, 1);
                assert_eq!(
                    watched.last_error_code.as_deref(),
                    Some("FOLDER_UNAVAILABLE")
                );
                assert_eq!(
                    watched.next_due_at.as_deref(),
                    Some("2026-08-25T12:00:09.000Z")
                );

                connection.execute(
                    "UPDATE connector_runtime_observations SET
                         last_error_code='FOLDER_CONFIGURATION_REQUIRED'
                     WHERE household_id='home' AND connector_kind='WATCHED_FOLDER'
                       AND connection_key='folder'",
                    [],
                )?;
                let action = service
                    .list_page(connection, "home", None, Some(10))
                    .unwrap();
                let watched = action
                    .items
                    .iter()
                    .find(|item| item.connector_kind == ConnectorKind::WatchedFolder)
                    .unwrap();
                assert_eq!(watched.health, ConnectorHealth::NeedsAction);

                connection.execute(
                    "UPDATE connector_runtime_observations SET consecutive_failures=10000
                     WHERE household_id='home' AND connector_kind='WATCHED_FOLDER'
                       AND connection_key='folder'",
                    [],
                )?;
                let bounded = service
                    .list_page(connection, "home", None, Some(10))
                    .unwrap();
                let watched = bounded
                    .items
                    .iter()
                    .find(|item| item.connector_kind == ConnectorKind::WatchedFolder)
                    .unwrap();
                assert_eq!(watched.consecutive_failures, u8::MAX);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn each_storage_query_materializes_at_most_limit_plus_one_source_rows() {
        let state = migrated_state();
        state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])?;
                for index in 0..20 {
                    connection.execute(
                        "INSERT INTO google_drive_connections(id,household_id,client_id_fingerprint,status) VALUES(?1,'home',?2,'DISCONNECTED')",
                        rusqlite::params![
                            format!("drive-{index:03}"),
                            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        ],
                    )?;
                    connection.execute(
                        "INSERT INTO gmail_connections(id,household_id,client_id_fingerprint,status) VALUES(?1,'home',?2,'DISCONNECTED')",
                        rusqlite::params![
                            format!("gmail-{index:03}"),
                            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                        ],
                    )?;
                    connection.execute(
                        "INSERT INTO watched_folders(id,household_id,label,canonical_path,source_type,provider) VALUES(?1,'home',?2,?3,'LOCAL_FOLDER','LOCAL')",
                        rusqlite::params![
                            format!("folder-{index:03}"),
                            format!("Folder {index:03}"),
                            format!("/safe/folder-{index:03}"),
                        ],
                    )?;
                }

                reset_materialized_source_rows();
                ConnectionProjectionService::new(&FixedClock)
                    .list_page(connection, "home", None, Some(3))
                    .unwrap();
                assert_eq!(materialized_source_rows(ConnectorKind::GoogleDrive), 4);
                assert_eq!(materialized_source_rows(ConnectorKind::Gmail), 4);
                assert_eq!(materialized_source_rows(ConnectorKind::WatchedFolder), 4);
                Ok(())
            })
            .unwrap();
    }
}
