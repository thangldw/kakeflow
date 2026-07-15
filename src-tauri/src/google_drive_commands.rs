//! Tauri command wiring for the Google Drive desktop connector.

use crate::{
    document_vault::DocumentVault,
    google_drive_api::DriveApiClient,
    google_drive_command_service::{
        self, GoogleDriveAvailabilityDto, RedactedGoogleDriveConnectionDto,
    },
    google_drive_credentials::{GoogleDriveCredentialBinding, GoogleDriveCredentialStore},
    google_drive_folder::{parse_folder_reference, GoogleDriveFolderMetadata},
    google_drive_hydration::{claim_and_hydrate, HydrationBatchRequest},
    google_drive_initial_sync::{run_initial_sync, InitialSyncLimits},
    google_drive_oauth::{GoogleDriveOAuthClient, GoogleDriveOAuthError, ReqwestOAuthTransport},
    google_drive_oauth_runtime::{
        BoundLoopbackSession, BrowserOpenError, BrowserOpener, DEFAULT_SESSION_TIMEOUT,
    },
    google_drive_store::{GoogleDriveInboxItemDto, InboxLeaseDto, SyncScheduleDto},
    google_drive_sync_adapter::{GoogleDriveInitialApi, GoogleDriveInitialStore},
    persistence::AppState,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::process::Command;
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

const CALLBACK_PATH: &str = "/oauth/google-drive/callback";
const COMPILED_CLIENT_ID: Option<&str> = option_env!("KAKEFLOW_GOOGLE_DRIVE_CLIENT_ID");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BindFolderInput {
    household_id: String,
    connection_id: String,
    folder_reference: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateScheduleInput {
    household_id: String,
    connection_id: String,
    enabled: bool,
    interval_minutes: u32,
}

struct SystemBrowserOpener;

impl BrowserOpener for SystemBrowserOpener {
    fn open(&self, authorization_url: &str) -> Result<(), BrowserOpenError> {
        #[cfg(target_os = "macos")]
        let launched = Command::new("/usr/bin/open").arg(authorization_url).spawn();
        #[cfg(target_os = "windows")]
        let launched = Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(authorization_url)
            .spawn();
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let launched = Command::new("xdg-open").arg(authorization_url).spawn();
        launched.map(|_| ()).map_err(|_| BrowserOpenError::Failed)
    }
}

#[tauri::command]
pub fn google_drive_availability() -> GoogleDriveAvailabilityDto {
    google_drive_command_service::availability(configured_client_id().is_some())
}

#[tauri::command]
pub fn google_drive_connections_list(
    state: State<'_, AppState>,
    household_id: String,
) -> Result<Vec<RedactedGoogleDriveConnectionDto>, String> {
    state
        .with_connection(|connection| {
            google_drive_command_service::list_connections(connection, &household_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive connections are unavailable".to_owned())
}

#[tauri::command]
pub fn google_drive_connection_load(
    state: State<'_, AppState>,
    household_id: String,
    connection_id: String,
) -> Result<RedactedGoogleDriveConnectionDto, String> {
    state
        .with_connection(|connection| {
            google_drive_command_service::load_connection(connection, &household_id, &connection_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive connection is unavailable".to_owned())
}

#[tauri::command]
pub async fn google_drive_connect(
    app: AppHandle,
    household_id: String,
) -> Result<RedactedGoogleDriveConnectionDto, String> {
    let connection_id = random_connection_id()?;
    tauri::async_runtime::spawn_blocking(move || {
        google_drive_connect_blocking(&app, household_id, connection_id)
    })
    .await
    .map_err(|_| "Google Drive connection worker stopped".to_owned())?
}

fn google_drive_connect_blocking(
    app: &AppHandle,
    household_id: String,
    connection_id: String,
) -> Result<RedactedGoogleDriveConnectionDto, String> {
    let state = app.state::<AppState>();
    let credential_store = app.state::<GoogleDriveCredentialStore>();
    let client_id =
        configured_client_id().ok_or_else(|| "Google Drive OAuth is not configured".to_owned())?;
    let fingerprint = client_fingerprint(client_id);
    state
        .with_connection(|connection| {
            google_drive_command_service::begin_connection(
                connection,
                &household_id,
                &connection_id,
                &fingerprint,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive connection could not be started".to_owned())?;
    let result = (|| {
        let oauth = GoogleDriveOAuthClient::new(
            client_id,
            ReqwestOAuthTransport::new()
                .map_err(|_| "Google Drive authorization is unavailable".to_owned())?,
        )
        .map_err(|_| "Google Drive OAuth is not configured".to_owned())?;
        let session = BoundLoopbackSession::bind(CALLBACK_PATH, DEFAULT_SESSION_TIMEOUT)
            .map_err(|_| "Google Drive authorization could not be started".to_owned())?;
        let attempt = oauth
            .authorization_attempt(session.port(), CALLBACK_PATH)
            .map_err(|_| "Google Drive authorization could not be started".to_owned())?;
        let callback = session
            .open_and_wait(&attempt, &SystemBrowserOpener)
            .map_err(|_| "Google Drive authorization did not complete".to_owned())?;
        let tokens = oauth
            .exchange_code(
                &callback.code,
                &attempt.code_verifier,
                &attempt.redirect_uri,
            )
            .map_err(|_| "Google Drive authorization did not complete".to_owned())?;
        let drive = DriveApiClient::production(&tokens.access_token)
            .map_err(|_| "Google Drive profile is unavailable".to_owned())?;
        let user = drive
            .about_user()
            .map_err(|_| "Google Drive profile is unavailable".to_owned())?;
        let binding = GoogleDriveCredentialBinding::new(
            connection_id.clone(),
            household_id.clone(),
            fingerprint,
        )
        .map_err(|_| "Google Drive credential binding is invalid".to_owned())?;
        state
            .with_connection(|connection| {
                persist_authorized_connection(
                    connection,
                    credential_store.inner(),
                    binding,
                    tokens.refresh_token,
                    &user.permission_id,
                    &user.email_address,
                )
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
            })
            .map_err(|_| "Google Drive connection could not be saved".to_owned())
    })();
    if result.is_err() {
        let _ = state.with_connection(|connection| {
            crate::google_drive_store::require_reauthorization(
                connection,
                &household_id,
                &connection_id,
            )
            .map(|_| ())
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        });
    }
    result
}

#[tauri::command]
pub async fn google_drive_folder_bind(
    app: AppHandle,
    input: BindFolderInput,
) -> Result<RedactedGoogleDriveConnectionDto, String> {
    let BindFolderInput {
        household_id,
        connection_id,
        folder_reference,
    } = input;
    tauri::async_runtime::spawn_blocking(move || {
        google_drive_folder_bind_blocking(&app, household_id, connection_id, folder_reference)
    })
    .await
    .map_err(|_| "Google Drive folder worker stopped".to_owned())?
}

fn google_drive_folder_bind_blocking(
    app: &AppHandle,
    household_id: String,
    connection_id: String,
    folder_reference: String,
) -> Result<RedactedGoogleDriveConnectionDto, String> {
    let state = app.state::<AppState>();
    let credential_store = app.state::<GoogleDriveCredentialStore>();
    let client_id =
        configured_client_id().ok_or_else(|| "Google Drive OAuth is not configured".to_owned())?;
    let reference = parse_folder_reference(&folder_reference)
        .map_err(|_| "Google Drive folder reference is invalid".to_owned())?;
    let raw = state
        .with_connection(|connection| {
            crate::google_drive_store::load_connection(connection, &household_id, &connection_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive connection is unavailable".to_owned())?;
    let binding = GoogleDriveCredentialBinding::new(
        connection_id.clone(),
        household_id.clone(),
        raw.client_id_fingerprint,
    )
    .map_err(|_| "Google Drive credential binding is invalid".to_owned())?;
    let credential = credential_store
        .read(&binding)
        .map_err(|_| "Google Drive credential is unavailable".to_owned())?
        .ok_or_else(|| "Google Drive must be connected again".to_owned())?;
    let oauth = GoogleDriveOAuthClient::production(client_id)
        .map_err(|_| "Google Drive authorization is unavailable".to_owned())?;
    let access = match oauth.refresh(credential.refresh_token()) {
        Ok(access) => access,
        Err(GoogleDriveOAuthError::ReauthorizationRequired) => {
            let _ = state.with_connection(|connection| {
                crate::google_drive_store::require_reauthorization(
                    connection,
                    &household_id,
                    &connection_id,
                )
                .map(|_| ())
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
            });
            return Err("Google Drive must be connected again".to_owned());
        }
        Err(_) => return Err("Google Drive authorization is unavailable".to_owned()),
    };
    let drive = DriveApiClient::production(&access.access_token)
        .map_err(|_| "Google Drive folder is unavailable".to_owned())?;
    let file = drive
        .file_metadata(&reference.folder_id, reference.resource_key.as_deref())
        .map_err(|_| "Google Drive folder is unavailable".to_owned())?;
    let baseline = drive
        .start_page_token(file.drive_id.as_deref())
        .map_err(|_| "Google Drive change baseline is unavailable".to_owned())?;
    let metadata = GoogleDriveFolderMetadata {
        file_id: file.id,
        name: file.name,
        mime_type: file.mime_type,
        drive_id: file.drive_id,
        trashed: file.trashed,
    };
    let bound = state
        .with_connection(|connection| {
            google_drive_command_service::bind_verified_folder(
                connection,
                &household_id,
                &connection_id,
                &folder_reference,
                metadata,
                &baseline,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive folder could not be bound".to_owned())?;
    state
        .with_connection(|connection| {
            google_drive_command_service::update_schedule(
                connection,
                &household_id,
                &connection_id,
                false,
                30,
            )
            .map(|_| ())
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive schedule could not be initialized".to_owned())?;
    Ok(bound)
}

#[tauri::command]
pub fn google_drive_schedule_get(
    state: State<'_, AppState>,
    household_id: String,
    connection_id: String,
) -> Result<SyncScheduleDto, String> {
    state
        .with_connection(|connection| {
            google_drive_command_service::get_schedule(connection, &household_id, &connection_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive schedule is unavailable".to_owned())
}

#[tauri::command]
pub fn google_drive_schedule_update(
    state: State<'_, AppState>,
    input: UpdateScheduleInput,
) -> Result<SyncScheduleDto, String> {
    let UpdateScheduleInput {
        household_id,
        connection_id,
        enabled,
        interval_minutes,
    } = input;
    state
        .with_connection(|connection| {
            google_drive_command_service::update_schedule(
                connection,
                &household_id,
                &connection_id,
                enabled,
                interval_minutes,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive schedule could not be updated".to_owned())
}

#[tauri::command]
pub fn google_drive_inbox_list(
    app_state: State<'_, AppState>,
    household_id: String,
    connection_id: Option<String>,
    state: Option<String>,
    limit: Option<u16>,
) -> Result<Vec<GoogleDriveInboxItemDto>, String> {
    let limit = limit.unwrap_or(100).clamp(1, 500);
    app_state
        .with_connection(|connection| {
            let connections = match connection_id.as_deref() {
                Some(id) => vec![id.to_owned()],
                None => google_drive_command_service::list_connections(connection, &household_id)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?
                    .into_iter()
                    .map(|item| item.id)
                    .collect(),
            };
            let mut items = Vec::new();
            for id in connections {
                items.extend(if let Some(expected) = state.as_deref() {
                    crate::google_drive_store::list_inbox_in_state(
                        connection,
                        &household_id,
                        &id,
                        expected,
                        limit,
                    )
                    .map_err(|_| rusqlite::Error::InvalidQuery)?
                } else {
                    google_drive_command_service::list_inbox(connection, &household_id, &id, limit)
                        .map_err(|_| rusqlite::Error::InvalidQuery)?
                });
            }
            items.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
            items.truncate(limit as usize);
            Ok(items)
        })
        .map_err(|_| "Google Drive Inbox is unavailable".to_owned())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveInboxFileDto {
    pub item: GoogleDriveInboxItemDto,
    pub file_bytes: Vec<u8>,
}

#[tauri::command]
pub async fn google_drive_inbox_file_read(
    app: AppHandle,
    household_id: String,
    item_id: String,
) -> Result<GoogleDriveInboxFileDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        google_drive_inbox_file_read_blocking(&app, household_id, item_id)
    })
    .await
    .map_err(|_| "Google Drive Inbox file worker stopped".to_owned())?
}

fn google_drive_inbox_file_read_blocking(
    app: &AppHandle,
    household_id: String,
    item_id: String,
) -> Result<GoogleDriveInboxFileDto, String> {
    let state = app.state::<AppState>();
    let vault = app.state::<DocumentVault>();
    read_hydrated_inbox_file(&state, &vault, &household_id, &item_id)
}

fn read_hydrated_inbox_file(
    state: &AppState,
    vault: &DocumentVault,
    household_id: &str,
    item_id: &str,
) -> Result<GoogleDriveInboxFileDto, String> {
    // The database guard is released when this call returns. Vault I/O and
    // decryption below therefore never hold the SQLite application mutex.
    let item = state
        .with_connection(|connection| {
            crate::google_drive_store::load_household_inbox_item(connection, household_id, item_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive Inbox file is unavailable".to_owned())?;
    if !matches!(item.state.as_str(), "READY" | "NEEDS_MAPPING") {
        return Err("Google Drive Inbox file is unavailable".to_owned());
    }
    let content_sha256 = item
        .content_sha256
        .as_deref()
        .ok_or_else(|| "Google Drive Inbox file is unavailable".to_owned())?;
    let retrieved = vault
        .read(content_sha256)
        .map_err(|_| "Google Drive Inbox file is unavailable".to_owned())?;
    let byte_size = u64::try_from(retrieved.bytes.len())
        .map_err(|_| "Google Drive Inbox file is too large".to_owned())?;
    if byte_size > crate::google_drive_api::MAX_DOWNLOAD_BYTES
        || item
            .remote_byte_size
            .is_some_and(|expected| expected != byte_size)
        || retrieved.sha256 != content_sha256
        || retrieved.mime_type != item.media_type
    {
        return Err("Google Drive Inbox file does not match its metadata".to_owned());
    }
    Ok(GoogleDriveInboxFileDto {
        item,
        file_bytes: retrieved.bytes,
    })
}

#[tauri::command]
pub fn google_drive_inbox_claim(
    state: State<'_, AppState>,
    household_id: String,
    item_ids: Vec<String>,
) -> Result<InboxLeaseDto, String> {
    state
        .with_connection(|connection| {
            google_drive_command_service::claim_inbox(connection, &household_id, &item_ids)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive Inbox items could not be claimed".to_owned())
}

#[tauri::command]
pub fn google_drive_inbox_mark_staged(
    state: State<'_, AppState>,
    household_id: String,
    item_id: String,
    lease_token: String,
    import_run_id: String,
) -> Result<GoogleDriveInboxItemDto, String> {
    state
        .with_connection(|connection| {
            google_drive_command_service::mark_inbox_staged(
                connection,
                &household_id,
                &item_id,
                &lease_token,
                &import_run_id,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive Inbox item could not be staged".to_owned())
}

#[tauri::command]
pub fn google_drive_inbox_mark_failed(
    state: State<'_, AppState>,
    household_id: String,
    item_id: String,
    lease_token: String,
    error_code: String,
) -> Result<GoogleDriveInboxItemDto, String> {
    state
        .with_connection(|connection| {
            google_drive_command_service::mark_inbox_failed(
                connection,
                &household_id,
                &item_id,
                &lease_token,
                &error_code,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive Inbox item could not be marked failed".to_owned())
}

#[tauri::command]
pub fn google_drive_inbox_reopen(
    state: State<'_, AppState>,
    household_id: String,
    item_id: String,
    import_run_id: String,
) -> Result<GoogleDriveInboxItemDto, String> {
    state
        .with_connection(|connection| {
            google_drive_command_service::reopen_inbox(
                connection,
                &household_id,
                &item_id,
                &import_run_id,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive Inbox item could not be reopened".to_owned())
}

#[tauri::command]
pub fn google_drive_inbox_ignore(
    state: State<'_, AppState>,
    household_id: String,
    item_id: String,
) -> Result<GoogleDriveInboxItemDto, String> {
    state
        .with_connection(|connection| {
            google_drive_command_service::ignore_inbox(connection, &household_id, &item_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive Inbox item could not be ignored".to_owned())
}

#[tauri::command]
pub fn google_drive_inbox_retry(
    state: State<'_, AppState>,
    household_id: String,
    item_id: String,
) -> Result<GoogleDriveInboxItemDto, String> {
    state
        .with_connection(|connection| {
            google_drive_command_service::retry_inbox(connection, &household_id, &item_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive Inbox item could not be retried".to_owned())
}

#[tauri::command]
pub async fn google_drive_sync_now(
    app: AppHandle,
    household_id: String,
    connection_id: String,
) -> Result<SyncScheduleDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        google_drive_sync_now_blocking(&app, household_id, connection_id)
    })
    .await
    .map_err(|_| "Google Drive sync worker stopped".to_owned())?
}

fn google_drive_sync_now_blocking(
    app: &AppHandle,
    household_id: String,
    connection_id: String,
) -> Result<SyncScheduleDto, String> {
    let client_id =
        configured_client_id().ok_or_else(|| "Google Drive OAuth is not configured".to_owned())?;
    let state = app.state::<AppState>();
    let credentials = app.state::<GoogleDriveCredentialStore>();
    let vault = app.state::<DocumentVault>();
    let raw = state
        .with_connection(|connection| {
            crate::google_drive_store::load_connection(connection, &household_id, &connection_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive connection is unavailable".to_owned())?;
    let root_folder_id = raw
        .root_folder_id
        .clone()
        .ok_or_else(|| "Google Drive folder is not selected".to_owned())?;
    let binding = GoogleDriveCredentialBinding::new(
        connection_id.clone(),
        household_id.clone(),
        raw.client_id_fingerprint,
    )
    .map_err(|_| "Google Drive credential binding is invalid".to_owned())?;
    let credential = credentials
        .read(&binding)
        .map_err(|_| "Google Drive credential is unavailable".to_owned())?
        .ok_or_else(|| "Google Drive must be connected again".to_owned())?;
    let oauth = GoogleDriveOAuthClient::production(client_id)
        .map_err(|_| "Google Drive authorization is unavailable".to_owned())?;
    let access = match oauth.refresh(credential.refresh_token()) {
        Ok(access) => access,
        Err(GoogleDriveOAuthError::ReauthorizationRequired) => {
            let _ = state.with_connection(|connection| {
                crate::google_drive_store::require_reauthorization(
                    connection,
                    &household_id,
                    &connection_id,
                )
                .map(|_| ())
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
            });
            return Err("Google Drive must be connected again".to_owned());
        }
        Err(_) => return Err("Google Drive authorization is unavailable".to_owned()),
    };
    let drive = DriveApiClient::production(&access.access_token)
        .map_err(|_| "Google Drive is unavailable".to_owned())?;

    state
        .with_connection(|connection| {
            let schedule =
                crate::google_drive_store::load_schedule(connection, &household_id, &connection_id)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let restore_disabled = !schedule.enabled;
            if restore_disabled {
                crate::google_drive_store::configure_schedule(
                    connection,
                    &household_id,
                    &connection_id,
                    true,
                    schedule.interval_minutes,
                )
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            }
            connection.execute(
                "UPDATE google_drive_sync_schedules SET
                     next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                     suspended_until=NULL,suspension_reason=NULL,
                     updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE connection_id=?1 AND enabled=1 AND lease_token IS NULL",
                [&connection_id],
            )?;
            let lease = crate::google_drive_store::claim_due_sync(
                connection,
                &household_id,
                &connection_id,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery)?
            .ok_or(rusqlite::Error::InvalidQuery)?;
            let mut api = GoogleDriveInitialApi::new(
                &drive,
                &root_folder_id,
                raw.root_resource_key.as_deref(),
                Some(&lease.change_page_token),
            );
            let mut store = GoogleDriveInitialStore::new(connection, &lease, &root_folder_id)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            if run_initial_sync(
                &mut api,
                &mut store,
                raw.drive_id.as_deref(),
                &root_folder_id,
                &InitialSyncLimits::default(),
            )
            .is_err()
            {
                let _ = crate::google_drive_store::fail_sync(
                    connection,
                    &household_id,
                    &connection_id,
                    &lease.lease_token,
                    "SYNC_FAILED",
                );
                if restore_disabled {
                    let _ = connection.execute(
                        "UPDATE google_drive_sync_schedules SET enabled=0,next_due_at=NULL,
                             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                         WHERE connection_id=?1 AND lease_token IS NULL",
                        [&connection_id],
                    );
                }
                return Err(rusqlite::Error::InvalidQuery.into());
            }
            let discovered = crate::google_drive_store::list_inbox_in_state(
                connection,
                &household_id,
                &connection_id,
                "DISCOVERED",
                100,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let item_ids = discovered
                .into_iter()
                .map(|item| item.id)
                .collect::<Vec<_>>();
            if !item_ids.is_empty() {
                claim_and_hydrate(
                    connection,
                    HydrationBatchRequest {
                        household_id: &household_id,
                        connection_id: &connection_id,
                        item_ids: &item_ids,
                        resource_keys: &BTreeMap::new(),
                    },
                    &drive,
                    vault.inner(),
                    &accept_without_mapping,
                )
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            }
            if restore_disabled {
                connection.execute(
                    "UPDATE google_drive_sync_schedules SET enabled=0,next_due_at=NULL,
                         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE connection_id=?1 AND lease_token IS NULL",
                    [&connection_id],
                )?;
            }
            crate::google_drive_store::load_schedule(connection, &household_id, &connection_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive synchronization did not complete".to_owned())
}

#[tauri::command]
pub async fn google_drive_disconnect(
    app: AppHandle,
    household_id: String,
    connection_id: String,
) -> Result<RedactedGoogleDriveConnectionDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        google_drive_disconnect_blocking(&app, household_id, connection_id)
    })
    .await
    .map_err(|_| "Google Drive disconnect worker stopped".to_owned())?
}

fn google_drive_disconnect_blocking(
    app: &AppHandle,
    household_id: String,
    connection_id: String,
) -> Result<RedactedGoogleDriveConnectionDto, String> {
    let state = app.state::<AppState>();
    let credential_store = app.state::<GoogleDriveCredentialStore>();
    let raw = state
        .with_connection(|connection| {
            crate::google_drive_store::load_connection(connection, &household_id, &connection_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive connection is unavailable".to_owned())?;
    let binding = GoogleDriveCredentialBinding::new(
        connection_id.clone(),
        household_id.clone(),
        raw.client_id_fingerprint,
    )
    .map_err(|_| "Google Drive credential binding is invalid".to_owned())?;
    if let (Some(client_id), Ok(Some(credential))) =
        (configured_client_id(), credential_store.read(&binding))
    {
        if let Ok(oauth) = GoogleDriveOAuthClient::production(client_id) {
            let _ = oauth.revoke(credential.refresh_token());
        }
    }
    let disconnected = state
        .with_connection(|connection| {
            google_drive_command_service::disconnect(connection, &household_id, &connection_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Google Drive connection could not be disconnected".to_owned())?;
    credential_store
        .delete(&binding)
        .map_err(|_| "Google Drive credential could not be removed".to_owned())?;
    Ok(disconnected)
}

fn configured_client_id() -> Option<&'static str> {
    COMPILED_CLIENT_ID.filter(|value| {
        !value.is_empty()
            && value.len() <= 512
            && !value.chars().any(char::is_whitespace)
            && value.ends_with(".apps.googleusercontent.com")
    })
}

fn client_fingerprint(client_id: &str) -> String {
    format!("{:x}", Sha256::digest(client_id.as_bytes()))
}

fn random_connection_id() -> Result<String, String> {
    let mut random = [0_u8; 32];
    getrandom::getrandom(&mut random)
        .map_err(|_| "Google Drive connection identity is unavailable".to_owned())?;
    let mut hasher = Sha256::new();
    hasher.update(b"KakeFlow Google Drive connection v1\0");
    hasher.update(random);
    Ok(format!("drive-{:x}", hasher.finalize()))
}

fn accept_without_mapping(_: &str, _: &str, _: &[u8]) -> bool {
    false
}

fn persist_authorized_connection(
    connection: &rusqlite::Connection,
    credential_store: &GoogleDriveCredentialStore,
    binding: GoogleDriveCredentialBinding,
    refresh_token: Zeroizing<String>,
    permission_id: &str,
    email: &str,
) -> Result<RedactedGoogleDriveConnectionDto, ()> {
    credential_store
        .store(binding.clone(), refresh_token)
        .map_err(|_| ())?;
    match google_drive_command_service::mark_authorized(
        connection,
        &binding.household_id,
        &binding.connection_id,
        permission_id,
        email,
    ) {
        Ok(dto) => Ok(dto),
        Err(_) => {
            let _ = credential_store.delete(&binding);
            Err(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        google_drive_store::{DiscoveryDisposition, RemoteNode},
        persistence::AppState,
    };

    const FINGERPRINT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn setup() -> AppState {
        let state = AppState::in_memory(&[23_u8; 32]).unwrap();
        state
            .with_connection(|connection| {
                connection
                    .execute("INSERT INTO households(id,name) VALUES('home','Home')", [])
                    .unwrap();
                Ok(())
            })
            .unwrap();
        state
    }

    fn binding() -> GoogleDriveCredentialBinding {
        GoogleDriveCredentialBinding::new("drive", "home", FINGERPRINT).unwrap()
    }

    fn seed_inbox_item(
        state: &AppState,
        vault: &DocumentVault,
        bytes: &[u8],
        hydrated_state: Option<bool>,
        vault_media_type: &str,
    ) -> String {
        state
            .with_connection(|connection| {
                google_drive_command_service::begin_connection(
                    connection,
                    "home",
                    "drive",
                    FINGERPRINT,
                )
                .unwrap();
                google_drive_command_service::mark_authorized(
                    connection,
                    "home",
                    "drive",
                    "permission-id",
                    "home@example.com",
                )
                .unwrap();
                crate::google_drive_store::select_root_with_baseline(
                    connection,
                    "home",
                    "drive",
                    None,
                    "rootFolder123",
                    "Inbox",
                    None,
                    "baseline",
                )
                .unwrap();
                crate::google_drive_store::configure_schedule(
                    connection, "home", "drive", true, 30,
                )
                .unwrap();
                let sync = crate::google_drive_store::claim_due_sync(connection, "home", "drive")
                    .unwrap()
                    .unwrap();
                let item = crate::google_drive_store::discover_nodes_claimed(
                    connection,
                    "home",
                    "drive",
                    &sync.lease_token,
                    &[RemoteNode {
                        file_id: "remoteFile123".to_owned(),
                        parent_file_id: Some("rootFolder123".to_owned()),
                        name: "bank.csv".to_owned(),
                        mime_type: "text/csv".to_owned(),
                        modified_time: Some("2026-07-15T00:00:00Z".to_owned()),
                        byte_size: Some(bytes.len() as u64),
                        md5_checksum: Some("11111111111111111111111111111111".to_owned()),
                        drive_version: Some("7".to_owned()),
                        is_folder: false,
                        can_download: true,
                        is_in_selected_tree: true,
                        is_trashed: false,
                        disposition: DiscoveryDisposition::Reviewable,
                    }],
                )
                .unwrap()
                .remove(0);
                crate::google_drive_store::complete_sync(
                    connection,
                    "home",
                    "drive",
                    &sync.lease_token,
                    "terminal",
                    1,
                    true,
                )
                .unwrap();
                if let Some(needs_mapping) = hydrated_state {
                    let stored = vault.put(bytes, vault_media_type).unwrap();
                    let lease = crate::google_drive_store::claim_inbox(
                        connection,
                        "home",
                        "drive",
                        std::slice::from_ref(&item.id),
                    )
                    .unwrap();
                    crate::google_drive_store::mark_inbox_ready(
                        connection,
                        "home",
                        &item.id,
                        &lease.lease_token,
                        &stored.sha256,
                        needs_mapping,
                    )
                    .unwrap();
                }
                Ok(item.id)
            })
            .unwrap()
    }

    #[test]
    fn availability_never_exposes_compiled_oauth_client_id() {
        let dto = google_drive_availability();
        assert_eq!(dto.available, configured_client_id().is_some());
        let json = serde_json::to_string(&dto).unwrap();
        if let Some(client_id) = COMPILED_CLIENT_ID {
            assert!(!json.contains(client_id));
        }
        if let Some(client_id) = configured_client_id() {
            assert_eq!(client_fingerprint(client_id).len(), 64);
            assert_eq!(client_fingerprint(client_id), client_fingerprint(client_id));
        }
    }

    #[test]
    fn authorization_persists_bound_refresh_credential_and_redacted_identity() {
        let state = setup();
        let credentials = GoogleDriveCredentialStore::new_ephemeral();
        state
            .with_connection(|connection| {
                google_drive_command_service::begin_connection(
                    connection,
                    "home",
                    "drive",
                    FINGERPRINT,
                )
                .unwrap();
                let dto = persist_authorized_connection(
                    connection,
                    &credentials,
                    binding(),
                    Zeroizing::new("refresh-token".to_owned()),
                    "permission-id",
                    "home@example.com",
                )
                .unwrap();
                assert_eq!(dto.status, "SELECTING_FOLDER");
                assert_eq!(dto.account_email.as_deref(), Some("home@example.com"));
                let serialized = serde_json::to_string(&dto).unwrap();
                assert!(!serialized.contains("permission-id"));
                assert!(!serialized.contains("refresh-token"));
                let stored = credentials.read(&binding()).unwrap().unwrap();
                assert_eq!(stored.refresh_token(), "refresh-token");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn database_transition_failure_compensates_new_credential() {
        let state = setup();
        let credentials = GoogleDriveCredentialStore::new_ephemeral();
        state
            .with_connection(|connection| {
                google_drive_command_service::begin_connection(
                    connection,
                    "home",
                    "drive",
                    FINGERPRINT,
                )
                .unwrap();
                google_drive_command_service::disconnect(connection, "home", "drive").unwrap();
                assert!(persist_authorized_connection(
                    connection,
                    &credentials,
                    binding(),
                    Zeroizing::new("orphan-refresh-token".to_owned()),
                    "permission-id",
                    "home@example.com",
                )
                .is_err());
                assert!(credentials.read(&binding()).unwrap().is_none());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn hydrated_ready_and_mapping_items_return_authenticated_exact_bytes() {
        for needs_mapping in [false, true] {
            let state = setup();
            let temp = tempfile::tempdir().unwrap();
            let vault = DocumentVault::new(temp.path(), &[31_u8; 32]).unwrap();
            let bytes = b"date,amount\n2026-07-15,1200\n";
            let item_id = seed_inbox_item(&state, &vault, bytes, Some(needs_mapping), "text/csv");
            let dto = read_hydrated_inbox_file(&state, &vault, "home", &item_id).unwrap();
            assert_eq!(dto.file_bytes, bytes);
            assert_eq!(dto.item.remote_byte_size, Some(bytes.len() as u64));
            assert_eq!(dto.item.media_type, "text/csv");
            assert_eq!(
                dto.item.state,
                if needs_mapping {
                    "NEEDS_MAPPING"
                } else {
                    "READY"
                }
            );
            assert_eq!(dto.item.id, item_id);
            assert_eq!(dto.item.connection_id, "drive");
        }
    }

    #[test]
    fn unhydrated_or_cross_household_items_cannot_read_vault_content() {
        let state = setup();
        let temp = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(temp.path(), &[33_u8; 32]).unwrap();
        let item_id = seed_inbox_item(&state, &vault, b"pending", None, "text/csv");
        assert!(read_hydrated_inbox_file(&state, &vault, "home", &item_id).is_err());

        let state = setup();
        let temp = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(temp.path(), &[35_u8; 32]).unwrap();
        let item_id = seed_inbox_item(&state, &vault, b"ready", Some(false), "text/csv");
        assert!(read_hydrated_inbox_file(&state, &vault, "other", &item_id).is_err());
    }

    #[test]
    fn metadata_mismatch_and_oversized_remote_claim_are_rejected() {
        let state = setup();
        let temp = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(temp.path(), &[37_u8; 32]).unwrap();
        let item_id = seed_inbox_item(
            &state,
            &vault,
            b"same bytes",
            Some(false),
            "application/pdf",
        );
        assert!(read_hydrated_inbox_file(&state, &vault, "home", &item_id).is_err());

        let state = setup();
        let temp = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(temp.path(), &[39_u8; 32]).unwrap();
        let item_id = seed_inbox_item(&state, &vault, b"small", Some(false), "text/csv");
        state
            .with_connection(|connection| {
                connection
                    .execute(
                        "UPDATE google_drive_inbox SET remote_byte_size=?2 WHERE id=?1",
                        rusqlite::params![
                            item_id,
                            crate::google_drive_api::MAX_DOWNLOAD_BYTES as i64 + 1
                        ],
                    )
                    .unwrap();
                Ok(())
            })
            .unwrap();
        assert!(read_hydrated_inbox_file(&state, &vault, "home", &item_id).is_err());
    }
}
