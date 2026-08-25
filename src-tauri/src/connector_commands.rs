use crate::{
    connector_binding::{
        self, ConnectorBindingDto, DeleteConnectorBindingInput, UpsertConnectorBindingInput,
    },
    connector_control::{ConnectorCapability, ConnectorKind},
    connector_projection::{
        ConnectionProjectionService, ConnectorCursorDto, ConnectorProjectionError,
        ConnectorSummaryPageDto, SqliteProjectionClock,
    },
    connector_refresh::{
        self, ConnectorRefreshBatchDto, ConnectorRefreshError, RefreshBatchStatus,
        RefreshItemStatus, RefreshTarget,
    },
    connector_refresh_worker::BackgroundConnectorRefresh,
    persistence::AppState,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

const REFRESH_PAGE_LIMIT: u16 = 100;
const MAX_REFRESH_BATCH_ITEMS: usize = 10_000;

#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ConnectorRefreshKindInput {
    GoogleDrive,
    Gmail,
    WatchedFolder,
    ManualImport,
}

impl From<ConnectorRefreshKindInput> for ConnectorKind {
    fn from(value: ConnectorRefreshKindInput) -> Self {
        match value {
            ConnectorRefreshKindInput::GoogleDrive => Self::GoogleDrive,
            ConnectorRefreshKindInput::Gmail => Self::Gmail,
            ConnectorRefreshKindInput::WatchedFolder => Self::WatchedFolder,
            ConnectorRefreshKindInput::ManualImport => Self::ManualImport,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectorRefreshOneInput {
    household_id: String,
    connector_kind: ConnectorRefreshKindInput,
    connection_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorRefreshBatchProgressDto {
    schema_version: u8,
    batch_id: String,
    household_id: String,
    status: RefreshBatchStatus,
    total_count: u64,
    terminal_count: u64,
    succeeded_count: u64,
    no_changes_count: u64,
    skipped_manual_count: u64,
    failed_count: u64,
    changed_count: u64,
    created_at: String,
    updated_at: String,
    completed_at: Option<String>,
    items: Vec<ConnectorRefreshItemProgressDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorRefreshItemProgressDto {
    connector_kind: ConnectorKind,
    connection_key: String,
    status: RefreshItemStatus,
    changed_count: u64,
    last_error_code: Option<String>,
    updated_at: String,
    started_at: Option<String>,
    completed_at: Option<String>,
}

#[tauri::command]
pub fn connector_control_list(
    state: State<'_, AppState>,
    household_id: String,
    cursor: Option<ConnectorCursorDto>,
    limit: Option<u16>,
) -> Result<ConnectorSummaryPageDto, String> {
    state
        .with_connection(|connection| {
            Ok(
                ConnectionProjectionService::new(&SqliteProjectionClock).list_page(
                    connection,
                    &household_id,
                    cursor,
                    limit,
                ),
            )
        })
        .map_err(|_| "Connector summaries are temporarily unavailable".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
pub fn connector_bindings_list(
    state: State<'_, AppState>,
    household_id: String,
) -> Result<Vec<ConnectorBindingDto>, String> {
    state
        .with_connection(|connection| {
            Ok(connector_binding::list_bindings(connection, &household_id))
        })
        .map_err(|_| "Connector bindings are temporarily unavailable".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
pub fn connector_binding_upsert(
    state: State<'_, AppState>,
    input: UpsertConnectorBindingInput,
) -> Result<ConnectorBindingDto, String> {
    state
        .with_connection(|connection| Ok(connector_binding::upsert_binding(connection, &input)))
        .map_err(|_| "Connector bindings are temporarily unavailable".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
pub fn connector_binding_delete(
    state: State<'_, AppState>,
    input: DeleteConnectorBindingInput,
) -> Result<(), String> {
    state
        .with_connection(|connection| Ok(connector_binding::delete_binding(connection, &input)))
        .map_err(|_| "Connector bindings are temporarily unavailable".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
pub fn connector_refresh_one(
    state: State<'_, AppState>,
    background: State<'_, BackgroundConnectorRefresh>,
    input: ConnectorRefreshOneInput,
) -> Result<ConnectorRefreshBatchDto, String> {
    let batch = state
        .with_connection(|connection| {
            Ok(create_refresh_one_batch(
                connection,
                &input.household_id,
                input.connector_kind.into(),
                &input.connection_key,
            ))
        })
        .map_err(|_| ConnectorRefreshError::Database.code().to_owned())?
        .map_err(|error| error.code().to_owned())?;
    background.wake();
    Ok(batch)
}

#[tauri::command]
pub fn connector_refresh_all(
    state: State<'_, AppState>,
    background: State<'_, BackgroundConnectorRefresh>,
    household_id: String,
) -> Result<ConnectorRefreshBatchDto, String> {
    let batch = state
        .with_connection(|connection| Ok(create_refresh_all_batch(connection, &household_id)))
        .map_err(|_| ConnectorRefreshError::Database.code().to_owned())?
        .map_err(|error| error.code().to_owned())?;
    background.wake();
    Ok(batch)
}

#[tauri::command]
pub fn connector_refresh_batch_get(
    state: State<'_, AppState>,
    household_id: String,
    batch_id: String,
) -> Result<ConnectorRefreshBatchProgressDto, String> {
    state
        .with_connection(|connection| {
            Ok(load_refresh_batch_progress(
                connection,
                &household_id,
                &batch_id,
            ))
        })
        .map_err(|_| ConnectorRefreshError::Database.code().to_owned())?
        .map_err(|error| error.code().to_owned())
}

fn create_refresh_all_batch(
    connection: &Connection,
    household_id: &str,
) -> Result<ConnectorRefreshBatchDto, ConnectorRefreshError> {
    let targets = snapshot_refreshable_targets(connection, household_id)?;
    connector_refresh::create_batch(connection, household_id, &targets)
}

fn create_refresh_one_batch(
    connection: &Connection,
    household_id: &str,
    connector_kind: ConnectorKind,
    connection_key: &str,
) -> Result<ConnectorRefreshBatchDto, ConnectorRefreshError> {
    let requested =
        snapshot_refreshable_target(connection, household_id, connector_kind, connection_key)?;
    connector_refresh::create_batch(connection, household_id, &[requested])
}

fn snapshot_refreshable_target(
    connection: &Connection,
    household_id: &str,
    connector_kind: ConnectorKind,
    connection_key: &str,
) -> Result<RefreshTarget, ConnectorRefreshError> {
    let service = ConnectionProjectionService::new(&SqliteProjectionClock);
    let mut cursor = None;
    loop {
        let page = service
            .list_page(
                connection,
                household_id,
                cursor.take(),
                Some(REFRESH_PAGE_LIMIT),
            )
            .map_err(projection_refresh_error)?;
        if let Some(summary) = page.items.into_iter().find(|summary| {
            summary.connector_kind == connector_kind
                && summary.connection_key == connection_key
                && summary
                    .capabilities
                    .contains(&ConnectorCapability::RefreshNow)
        }) {
            return Ok(RefreshTarget {
                connector_kind: summary.connector_kind,
                connection_key: summary.connection_key,
            });
        }
        let Some(next_cursor) = page.next_cursor else {
            return Err(ConnectorRefreshError::InvalidInput);
        };
        cursor = Some(next_cursor);
    }
}

fn snapshot_refreshable_targets(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<RefreshTarget>, ConnectorRefreshError> {
    let service = ConnectionProjectionService::new(&SqliteProjectionClock);
    let mut cursor = None;
    let mut targets = Vec::new();
    loop {
        let page = service
            .list_page(
                connection,
                household_id,
                cursor.take(),
                Some(REFRESH_PAGE_LIMIT),
            )
            .map_err(projection_refresh_error)?;
        for summary in page.items {
            if summary.connector_kind == ConnectorKind::ManualImport
                || summary
                    .capabilities
                    .contains(&ConnectorCapability::RefreshNow)
            {
                targets.push(RefreshTarget {
                    connector_kind: summary.connector_kind,
                    connection_key: summary.connection_key,
                });
                if targets.len() > MAX_REFRESH_BATCH_ITEMS {
                    return Err(ConnectorRefreshError::BatchLimitExceeded);
                }
            }
        }
        let Some(next_cursor) = page.next_cursor else {
            return Ok(targets);
        };
        cursor = Some(next_cursor);
    }
}

fn projection_refresh_error(error: ConnectorProjectionError) -> ConnectorRefreshError {
    match error {
        ConnectorProjectionError::InvalidInput
        | ConnectorProjectionError::InvalidLimit
        | ConnectorProjectionError::InvalidCursor => ConnectorRefreshError::InvalidInput,
        ConnectorProjectionError::DuplicateIdentity
        | ConnectorProjectionError::InvalidProjection
        | ConnectorProjectionError::Database => ConnectorRefreshError::Database,
    }
}

fn load_refresh_batch_progress(
    connection: &Connection,
    household_id: &str,
    batch_id: &str,
) -> Result<ConnectorRefreshBatchProgressDto, ConnectorRefreshError> {
    let loaded = connector_refresh::load_batch(connection, household_id, batch_id)?;
    Ok(ConnectorRefreshBatchProgressDto {
        schema_version: 1,
        batch_id: loaded.batch.batch_id,
        household_id: loaded.batch.household_id,
        status: loaded.batch.status,
        total_count: loaded.batch.total_count,
        terminal_count: loaded.batch.terminal_count,
        succeeded_count: loaded.batch.succeeded_count,
        no_changes_count: loaded.batch.no_changes_count,
        skipped_manual_count: loaded.batch.skipped_manual_count,
        failed_count: loaded.batch.failed_count,
        changed_count: loaded.batch.changed_count,
        created_at: loaded.batch.created_at,
        updated_at: loaded.batch.updated_at,
        completed_at: loaded.batch.completed_at,
        items: loaded
            .items
            .into_iter()
            .map(|item| ConnectorRefreshItemProgressDto {
                connector_kind: item.connector_kind,
                connection_key: item.connection_key,
                status: item.status,
                changed_count: item.changed_count,
                last_error_code: item.last_error_code,
                updated_at: item.updated_at,
                started_at: item.started_at,
                completed_at: item.completed_at,
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{connector_control::ConnectorKind, connector_refresh};

    fn state() -> AppState {
        AppState::in_memory(b"connector-refresh-command-test-key").unwrap()
    }

    #[test]
    fn refresh_all_pages_server_projections_and_uses_the_durable_batch_shape() {
        let state = state();
        state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])?;
                for index in 0..105 {
                    connection.execute(
                        "INSERT INTO watched_folders(
                             id,household_id,label,canonical_path,source_type,provider
                         ) VALUES(?1,'home',?2,?3,'LOCAL_FOLDER','LOCAL')",
                        rusqlite::params![
                            format!("folder-{index:03}"),
                            format!("Folder {index:03}"),
                            format!("/safe/folder-{index:03}"),
                        ],
                    )?;
                }
                connection.execute(
                    "UPDATE watched_folders SET is_enabled=0 WHERE id='folder-050'",
                    [],
                )?;

                let batch = create_refresh_all_batch(connection, "home").unwrap();
                assert_eq!(batch.total_count, 105);
                let loaded =
                    connector_refresh::load_batch(connection, "home", &batch.batch_id).unwrap();
                assert_eq!(loaded.items.len(), 105);
                assert_eq!(loaded.skipped_manual_count, 1);
                assert!(loaded.items.iter().any(|item| {
                    item.connector_kind == ConnectorKind::ManualImport
                        && item.connection_key == "manual-import"
                }));
                assert!(loaded
                    .items
                    .iter()
                    .filter(|item| { item.connector_kind == ConnectorKind::WatchedFolder })
                    .all(|item| item.connection_key != "folder-050"));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn refresh_all_rejects_over_ten_thousand_atomically() {
        let state = state();
        state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])?;
                connection.execute(
                    "WITH RECURSIVE sequence(value) AS (
                         SELECT 1 UNION ALL SELECT value+1 FROM sequence WHERE value < 10000
                     )
                     INSERT INTO watched_folders(
                         id,household_id,label,canonical_path,source_type,provider
                     )
                     SELECT printf('folder-%05d',value),'home',printf('Folder %05d',value),
                            printf('/safe/folder-%05d',value),'LOCAL_FOLDER','LOCAL'
                     FROM sequence",
                    [],
                )?;

                assert_eq!(
                    create_refresh_all_batch(connection, "home").unwrap_err(),
                    connector_refresh::ConnectorRefreshError::BatchLimitExceeded
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM connector_refresh_batches",
                        [],
                        |row| row.get::<_, u64>(0),
                    )?,
                    0
                );
                let one = create_refresh_one_batch(
                    connection,
                    "home",
                    ConnectorKind::WatchedFolder,
                    "folder-00001",
                )
                .unwrap();
                assert_eq!(one.total_count, 1);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn refresh_one_is_household_scoped_and_requires_refresh_capability() {
        let state = state();
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('home','Home'),('other','Other')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO watched_folders(
                         id,household_id,label,canonical_path,source_type,provider,is_enabled
                     ) VALUES
                         ('home-folder','home','Home','/safe/home','LOCAL_FOLDER','LOCAL',1),
                         ('disabled-folder','home','Disabled','/safe/disabled','LOCAL_FOLDER','LOCAL',0),
                         ('other-folder','other','Other','/safe/other','LOCAL_FOLDER','LOCAL',1)",
                    [],
                )?;

                let batch = create_refresh_one_batch(
                    connection,
                    "home",
                    ConnectorKind::WatchedFolder,
                    "home-folder",
                )
                .unwrap();
                assert_eq!(batch.total_count, 1);
                assert_eq!(
                    create_refresh_one_batch(
                        connection,
                        "home",
                        ConnectorKind::WatchedFolder,
                        "other-folder",
                    )
                    .unwrap_err(),
                    connector_refresh::ConnectorRefreshError::InvalidInput
                );
                assert_eq!(
                    create_refresh_one_batch(
                        connection,
                        "home",
                        ConnectorKind::WatchedFolder,
                        "disabled-folder",
                    )
                    .unwrap_err(),
                    connector_refresh::ConnectorRefreshError::InvalidInput
                );
                assert_eq!(
                    create_refresh_one_batch(
                        connection,
                        "home",
                        ConnectorKind::ManualImport,
                        "manual-import",
                    )
                    .unwrap_err(),
                    connector_refresh::ConnectorRefreshError::InvalidInput
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn refresh_one_input_has_no_frontend_operation_selector() {
        assert!(
            serde_json::from_value::<ConnectorRefreshOneInput>(serde_json::json!({
                "householdId": "home",
                "connectorKind": "WATCHED_FOLDER",
                "connectionKey": "folder"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<ConnectorRefreshOneInput>(serde_json::json!({
                "householdId": "home",
                "connectorKind": "WATCHED_FOLDER",
                "connectionKey": "folder",
                "operation": "delete-everything"
            }))
            .is_err()
        );
    }

    #[test]
    fn batch_get_cannot_cross_households() {
        let state = state();
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('home','Home'),('other','Other')",
                    [],
                )?;
                let batch = connector_refresh::create_batch(
                    connection,
                    "home",
                    &[connector_refresh::RefreshTarget {
                        connector_kind: ConnectorKind::ManualImport,
                        connection_key: "manual-import".to_owned(),
                    }],
                )
                .unwrap();
                assert_eq!(
                    load_refresh_batch_progress(connection, "other", &batch.batch_id).unwrap_err(),
                    connector_refresh::ConnectorRefreshError::NotFound
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn refresh_all_manual_only_household_returns_a_completed_skipped_batch() {
        let state = state();
        state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])?;
                let batch = create_refresh_all_batch(connection, "home").unwrap();
                assert_eq!(
                    batch.status,
                    connector_refresh::RefreshBatchStatus::Complete
                );
                assert_eq!(batch.total_count, 1);
                assert_eq!(batch.terminal_count, 1);
                assert_eq!(batch.skipped_manual_count, 1);
                let loaded =
                    connector_refresh::load_batch(connection, "home", &batch.batch_id).unwrap();
                assert_eq!(loaded.items.len(), 1);
                assert_eq!(
                    loaded.items[0].status,
                    connector_refresh::RefreshItemStatus::SkippedManual
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn batch_progress_serialization_has_only_explicit_redacted_fields() {
        let state = state();
        state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])?;
                connection.execute(
                    "INSERT INTO watched_folders(
                         id,household_id,label,canonical_path,source_type,provider
                     ) VALUES('folder','home','Folder','/private/sentinel','LOCAL_FOLDER','LOCAL')",
                    [],
                )?;
                let batch = create_refresh_one_batch(
                    connection,
                    "home",
                    ConnectorKind::WatchedFolder,
                    "folder",
                )
                .unwrap();
                let claim = connector_refresh::claim_next(connection, "home", &batch.batch_id)
                    .unwrap()
                    .unwrap();
                assert_eq!(claim.lease_token.len(), 64);

                let progress =
                    load_refresh_batch_progress(connection, "home", &batch.batch_id).unwrap();
                let value = serde_json::to_value(progress).unwrap();
                let top = value
                    .as_object()
                    .unwrap()
                    .keys()
                    .cloned()
                    .collect::<std::collections::BTreeSet<_>>();
                assert_eq!(
                    top,
                    [
                        "batchId",
                        "changedCount",
                        "completedAt",
                        "createdAt",
                        "failedCount",
                        "householdId",
                        "items",
                        "noChangesCount",
                        "schemaVersion",
                        "skippedManualCount",
                        "status",
                        "succeededCount",
                        "terminalCount",
                        "totalCount",
                        "updatedAt",
                    ]
                    .into_iter()
                    .map(str::to_owned)
                    .collect()
                );
                let item = value["items"][0].as_object().unwrap();
                assert_eq!(
                    item.keys()
                        .cloned()
                        .collect::<std::collections::BTreeSet<_>>(),
                    [
                        "changedCount",
                        "completedAt",
                        "connectionKey",
                        "connectorKind",
                        "lastErrorCode",
                        "startedAt",
                        "status",
                        "updatedAt",
                    ]
                    .into_iter()
                    .map(str::to_owned)
                    .collect()
                );
                let serialized = serde_json::to_string(&value).unwrap();
                for forbidden in [
                    "leaseToken",
                    "leaseExpiresAt",
                    "attemptGeneration",
                    "itemId",
                    "/private/sentinel",
                    &claim.lease_token,
                ] {
                    assert!(!serialized.contains(forbidden));
                }
                Ok(())
            })
            .unwrap();
    }
}
