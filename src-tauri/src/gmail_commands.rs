//! Tauri command wiring for Gmail's review-gated desktop connector.

use crate::{
    document_vault::DocumentVault,
    gmail_api::{GmailApiClient, GmailLabelType},
    gmail_command_service::{
        self, GmailAvailabilityDto, GmailBindInput, GmailLabelDto, GmailLabelKindDto,
        RedactedGmailConnectionDto, RedactedGmailInboxItemDto, RedactedGmailInboxLeaseDto,
        RedactedGmailScheduleDto,
    },
    gmail_credentials::{GmailCredentialBinding, GmailCredentialStore},
    gmail_oauth::{GmailOAuthClient, GmailOAuthError},
    gmail_oauth_runtime::{
        BoundGmailLoopbackSession, BrowserOpenError, BrowserOpener, DEFAULT_SESSION_TIMEOUT,
    },
    gmail_store::{self, SyncLeaseDto},
    gmail_sync::{run_full_sync, run_incremental_sync, GmailSyncError, GmailSyncLimits},
    gmail_sync_adapter::GmailSqliteSyncStore,
    persistence::AppState,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::process::Command;
use tauri::{AppHandle, Manager, State};

const CALLBACK_PATH: &str = "/oauth/gmail/callback";
const COMPILED_CLIENT_ID: Option<&str> = option_env!("KAKEFLOW_GMAIL_CLIENT_ID");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BindLabelInput {
    household_id: String,
    #[serde(flatten)]
    bind: GmailBindInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateScheduleInput {
    household_id: String,
    connection_id: String,
    enabled: bool,
    interval_minutes: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailInboxFileDto {
    pub item: RedactedGmailInboxItemDto,
    pub file_bytes: Vec<u8>,
}

struct SystemBrowserOpener;
impl BrowserOpener for SystemBrowserOpener {
    fn open(&self, url: &str) -> Result<(), BrowserOpenError> {
        #[cfg(target_os = "macos")]
        let result = Command::new("/usr/bin/open").arg(url).spawn();
        #[cfg(target_os = "windows")]
        let result = Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(url)
            .spawn();
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let result = Command::new("xdg-open").arg(url).spawn();
        result.map(|_| ()).map_err(|_| BrowserOpenError::Failed)
    }
}

#[tauri::command]
pub fn gmail_availability() -> GmailAvailabilityDto {
    gmail_command_service::availability(configured_client_id().is_some())
}

#[tauri::command]
pub fn gmail_connections_list(
    state: State<'_, AppState>,
    household_id: String,
) -> Result<Vec<RedactedGmailConnectionDto>, String> {
    state
        .with_connection(|c| {
            gmail_store::list_connections(c, &household_id)
                .map(|rows| {
                    rows.into_iter()
                        .map(gmail_command_service::project_connection)
                        .collect()
                })
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Gmail connections are unavailable".into())
}

#[tauri::command]
pub async fn gmail_connect(
    app: AppHandle,
    household_id: String,
) -> Result<RedactedGmailConnectionDto, String> {
    tauri::async_runtime::spawn_blocking(move || connect_blocking(&app, household_id))
        .await
        .map_err(|_| "Gmail connection worker stopped".to_owned())?
}

fn connect_blocking(
    app: &AppHandle,
    household_id: String,
) -> Result<RedactedGmailConnectionDto, String> {
    let client_id =
        configured_client_id().ok_or_else(|| "Gmail OAuth is not configured".to_owned())?;
    let connection_id = random_connection_id()?;
    let fingerprint = format!("{:x}", Sha256::digest(client_id.as_bytes()));
    let state = app.state::<AppState>();
    state
        .with_connection(|c| {
            gmail_store::begin_connection(c, &household_id, &connection_id, &fingerprint)
                .map(|_| ())
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Gmail connection could not be started".to_owned())?;
    let result = (|| {
        let oauth = GmailOAuthClient::production(client_id)
            .map_err(|_| "Gmail authorization is unavailable".to_owned())?;
        let session = BoundGmailLoopbackSession::bind(CALLBACK_PATH, DEFAULT_SESSION_TIMEOUT)
            .map_err(|_| "Gmail authorization could not be started".to_owned())?;
        let attempt = oauth
            .authorization_attempt(session.port(), CALLBACK_PATH)
            .map_err(|_| "Gmail authorization could not be started".to_owned())?;
        let callback = session
            .open_and_wait(&attempt, &SystemBrowserOpener)
            .map_err(|_| "Gmail authorization did not complete".to_owned())?;
        let tokens = oauth
            .exchange_code(
                &callback.code,
                &attempt.code_verifier,
                &attempt.redirect_uri,
            )
            .map_err(|_| "Gmail authorization did not complete".to_owned())?;
        let api = GmailApiClient::production(&tokens.access_token)
            .map_err(|_| "Gmail profile is unavailable".to_owned())?;
        let profile = api
            .profile()
            .map_err(|_| "Gmail profile is unavailable".to_owned())?;
        let binding = GmailCredentialBinding::new(&connection_id, &household_id, &fingerprint)
            .map_err(|_| "Gmail credential binding is invalid".to_owned())?;
        app.state::<GmailCredentialStore>()
            .store(binding.clone(), tokens.refresh_token)
            .map_err(|_| "Gmail credential could not be saved".to_owned())?;
        let account_id = format!(
            "{:x}",
            Sha256::digest(profile.email_address.to_ascii_lowercase().as_bytes())
        );
        let saved = state.with_connection(|c| {
            gmail_store::mark_authorized(
                c,
                &household_id,
                &connection_id,
                &account_id,
                &profile.email_address,
                &profile.history_id.to_string(),
            )
            .map(gmail_command_service::project_connection)
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        });
        if saved.is_err() {
            let _ = app.state::<GmailCredentialStore>().delete(&binding);
        }
        saved.map_err(|_| "Gmail connection could not be saved".to_owned())
    })();
    if result.is_err() {
        let _ = state.with_connection(|c| { c.execute("UPDATE gmail_connections SET status='AUTH_REQUIRED' WHERE household_id=?1 AND id=?2", rusqlite::params![household_id, connection_id])?; Ok(()) });
    }
    result
}

#[tauri::command]
pub async fn gmail_labels_list(
    app: AppHandle,
    household_id: String,
    connection_id: String,
) -> Result<Vec<GmailLabelDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_api(&app, &household_id, &connection_id, |api| {
            api.list_labels()
                .map_err(|_| "Gmail labels are unavailable".to_owned())?
                .into_iter()
                .map(|label| {
                    gmail_command_service::project_label(
                        label.id,
                        label.name,
                        match label.label_type {
                            GmailLabelType::System => GmailLabelKindDto::System,
                            GmailLabelType::User => GmailLabelKindDto::User,
                        },
                    )
                    .map_err(|_| "Gmail returned an invalid label".to_owned())
                })
                .collect()
        })
    })
    .await
    .map_err(|_| "Gmail label worker stopped".to_owned())?
}

#[tauri::command]
pub async fn gmail_label_bind(
    app: AppHandle,
    input: BindLabelInput,
) -> Result<RedactedGmailConnectionDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let validated = gmail_command_service::validate_bind_input(input.bind)
            .map_err(|_| "Gmail label selection is invalid".to_owned())?;
        with_api(&app, &input.household_id, &validated.connection_id, |api| {
            let profile = api
                .profile()
                .map_err(|_| "Gmail profile is unavailable".to_owned())?;
            app.state::<AppState>()
                .with_connection(|c| {
                    let dto = gmail_store::bind_label(
                        c,
                        &input.household_id,
                        &validated.connection_id,
                        &validated.gmail_query,
                        &validated.label_id,
                        &validated.label_name,
                        &profile.history_id.to_string(),
                    )
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                    gmail_store::configure_schedule(
                        c,
                        &input.household_id,
                        &validated.connection_id,
                        false,
                        30,
                    )
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                    Ok(gmail_command_service::project_connection(dto))
                })
                .map_err(|_| "Gmail label could not be bound".to_owned())
        })
    })
    .await
    .map_err(|_| "Gmail label worker stopped".to_owned())?
}

#[tauri::command]
pub fn gmail_schedule_get(
    state: State<'_, AppState>,
    household_id: String,
    connection_id: String,
) -> Result<RedactedGmailScheduleDto, String> {
    state
        .with_connection(|c| {
            gmail_store::load_schedule(c, &household_id, &connection_id)
                .map(gmail_command_service::project_schedule)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Gmail schedule is unavailable".into())
}

#[tauri::command]
pub fn gmail_schedule_update(
    state: State<'_, AppState>,
    input: UpdateScheduleInput,
) -> Result<RedactedGmailScheduleDto, String> {
    state
        .with_connection(|c| {
            gmail_store::configure_schedule(
                c,
                &input.household_id,
                &input.connection_id,
                input.enabled,
                input.interval_minutes,
            )
            .map(gmail_command_service::project_schedule)
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Gmail schedule could not be updated".into())
}

#[tauri::command]
pub fn gmail_inbox_list(
    app_state: State<'_, AppState>,
    household_id: String,
    connection_id: Option<String>,
    state: Option<String>,
    limit: Option<u16>,
) -> Result<Vec<RedactedGmailInboxItemDto>, String> {
    let limit = usize::from(limit.unwrap_or(100).clamp(1, 100));
    app_state
        .with_connection(|c| {
            let ids = match connection_id {
                Some(id) => vec![id],
                None => gmail_store::list_connections(c, &household_id)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?
                    .into_iter()
                    .map(|row| row.id)
                    .collect(),
            };
            let mut items = Vec::new();
            for id in ids {
                items.extend(
                    gmail_store::list_inbox(c, &household_id, &id, limit)
                        .map_err(|_| rusqlite::Error::InvalidQuery)?,
                );
            }
            if let Some(expected) = state.as_deref() {
                items.retain(|item| item.state == expected);
            }
            items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            items.truncate(limit);
            Ok(gmail_command_service::project_inbox_items(items))
        })
        .map_err(|_| "Gmail Inbox is unavailable".into())
}

#[tauri::command]
pub async fn gmail_inbox_file_read(
    app: AppHandle,
    household_id: String,
    item_id: String,
) -> Result<GmailInboxFileDto, String> {
    tauri::async_runtime::spawn_blocking(move || read_inbox_file(&app, &household_id, &item_id))
        .await
        .map_err(|_| "Gmail Inbox file worker stopped".to_owned())?
}

fn read_inbox_file(
    app: &AppHandle,
    household: &str,
    item_id: &str,
) -> Result<GmailInboxFileDto, String> {
    let raw = app
        .state::<AppState>()
        .with_connection(|c| {
            gmail_store::load_household_inbox_item(c, household, item_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Gmail Inbox file is unavailable".to_owned())?;
    if !matches!(raw.state.as_str(), "READY" | "NEEDS_MAPPING") {
        return Err("Gmail Inbox file is unavailable".into());
    }
    let sha = raw
        .content_sha256
        .as_deref()
        .ok_or_else(|| "Gmail Inbox file is unavailable".to_owned())?;
    let file = app
        .state::<DocumentVault>()
        .read(sha)
        .map_err(|_| "Gmail Inbox file is unavailable".to_owned())?;
    if file.sha256 != sha
        || file.mime_type != "message/rfc822"
        || file.bytes.len() > 50 * 1024 * 1024
    {
        return Err("Gmail Inbox file does not match its metadata".into());
    }
    Ok(GmailInboxFileDto {
        item: gmail_command_service::project_inbox_item(raw),
        file_bytes: file.bytes,
    })
}

#[tauri::command]
pub fn gmail_inbox_claim(
    state: State<'_, AppState>,
    household_id: String,
    item_ids: Vec<String>,
) -> Result<RedactedGmailInboxLeaseDto, String> {
    state
        .with_connection(|c| {
            let first = item_ids.first().ok_or(rusqlite::Error::InvalidQuery)?;
            let connection_id = gmail_store::load_household_inbox_item(c, &household_id, first)
                .map_err(|_| rusqlite::Error::InvalidQuery)?
                .connection_id;
            for item_id in &item_ids[1..] {
                if gmail_store::load_household_inbox_item(c, &household_id, item_id)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?
                    .connection_id
                    != connection_id
                {
                    return Err(rusqlite::Error::InvalidQuery.into());
                }
            }
            gmail_store::claim_inbox(c, &household_id, &connection_id, &item_ids)
                .map(gmail_command_service::project_inbox_lease)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Gmail Inbox items could not be claimed".into())
}

macro_rules! inbox_command {
    ($name:ident, $store:ident, $message:literal, [$($arg:ident : $ty:ty),*]) => {
        #[tauri::command]
        pub fn $name(state: State<'_, AppState>, household_id: String, $($arg:$ty),*) -> Result<RedactedGmailInboxItemDto,String> {
            state.with_connection(|c| gmail_store::$store(c, &household_id, $(&$arg),*).map(gmail_command_service::project_inbox_item).map_err(|_| rusqlite::Error::InvalidQuery.into())).map_err(|_| $message.into())
        }
    }
}
inbox_command!(gmail_inbox_ignore, ignore_inbox, "Gmail Inbox item could not be ignored", [item_id:String]);
inbox_command!(gmail_inbox_retry, retry_inbox, "Gmail Inbox item could not be retried", [item_id:String]);
inbox_command!(gmail_inbox_reopen, reopen_staged_inbox, "Gmail Inbox item could not be reopened", [item_id:String, import_run_id:String]);
inbox_command!(gmail_inbox_mark_staged, mark_inbox_staged, "Gmail Inbox item could not be staged", [item_id:String, lease_token:String, import_run_id:String]);
inbox_command!(gmail_inbox_mark_failed, fail_inbox, "Gmail Inbox item could not be marked failed", [item_id:String, lease_token:String, error_code:String]);

#[tauri::command]
pub async fn gmail_sync_now(
    app: AppHandle,
    household_id: String,
    connection_id: String,
) -> Result<RedactedGmailScheduleDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sync_now_blocking(&app, &household_id, &connection_id)
    })
    .await
    .map_err(|_| "Gmail sync worker stopped".to_owned())?
}

fn sync_now_blocking(
    app: &AppHandle,
    household: &str,
    connection_id: &str,
) -> Result<RedactedGmailScheduleDto, String> {
    let state = app.state::<AppState>();
    let (lease, restore) = state.with_connection(|c| {
        let schedule = gmail_store::load_schedule(c, household, connection_id).map_err(|_| rusqlite::Error::InvalidQuery)?;
        let restore = !schedule.enabled;
        if restore { gmail_store::configure_schedule(c, household, connection_id, true, schedule.interval_minutes).map_err(|_| rusqlite::Error::InvalidQuery)?; }
        c.execute("UPDATE gmail_sync_schedules SET next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),suspended_until=NULL,suspension_reason=NULL WHERE connection_id=?1 AND lease_token IS NULL", [connection_id])?;
        Ok((gmail_store::claim_due_sync(c, household, connection_id).map_err(|_| rusqlite::Error::InvalidQuery)?.ok_or(rusqlite::Error::InvalidQuery)?, restore))
    }).map_err(|_| "Gmail synchronization could not start".to_owned())?;
    let result = run_claimed_gmail_sync(app, &lease);
    if restore {
        let _ = state.with_connection(|c| { c.execute("UPDATE gmail_sync_schedules SET enabled=0,next_due_at=NULL WHERE connection_id=?1 AND lease_token IS NULL", [connection_id])?; Ok(()) });
    }
    result
}

pub(crate) fn run_claimed_gmail_sync(
    app: &AppHandle,
    lease: &SyncLeaseDto,
) -> Result<RedactedGmailScheduleDto, String> {
    let raw = app
        .state::<AppState>()
        .with_connection(|c| {
            gmail_store::load_connection(c, &lease.household_id, &lease.connection_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| {
            finish_claim(app, lease, "CONNECTION_UNAVAILABLE", false);
            "Gmail connection is unavailable".to_owned()
        })?;
    let label = raw.label_id.clone().ok_or_else(|| {
        finish_claim(app, lease, "LABEL_UNAVAILABLE", false);
        "Gmail label is not selected".to_owned()
    })?;
    let client_id = configured_client_id().ok_or_else(|| {
        finish_claim(app, lease, "CONFIG_UNAVAILABLE", false);
        "Gmail OAuth is not configured".to_owned()
    })?;
    let binding = GmailCredentialBinding::new(
        &lease.connection_id,
        &lease.household_id,
        &raw.client_id_fingerprint,
    )
    .map_err(|_| {
        finish_claim(app, lease, "MISSING_CREDENTIAL", true);
        "Gmail credential binding is invalid".to_owned()
    })?;
    let credential = app
        .state::<GmailCredentialStore>()
        .read(&binding)
        .map_err(|_| {
            finish_claim(app, lease, "MISSING_CREDENTIAL", true);
            "Gmail credential is unavailable".to_owned()
        })?
        .ok_or_else(|| {
            finish_claim(app, lease, "MISSING_CREDENTIAL", true);
            "Gmail must be connected again".to_owned()
        })?;
    let oauth = GmailOAuthClient::production(client_id).map_err(|_| {
        finish_claim(app, lease, "CONFIG_UNAVAILABLE", false);
        "Gmail authorization is unavailable".to_owned()
    })?;
    let access = match oauth.refresh(credential.refresh_token()) {
        Ok(access) => access,
        Err(GmailOAuthError::ReauthorizationRequired) => {
            finish_claim(app, lease, "AUTH_EXPIRED", true);
            return Err("Gmail must be connected again".into());
        }
        Err(_) => {
            finish_claim(app, lease, "AUTH_REFRESH_FAILED", false);
            return Err("Gmail authorization is unavailable".into());
        }
    };
    let mut api = GmailApiClient::production(&access.access_token).map_err(|_| {
        finish_claim(app, lease, "GMAIL_UNAVAILABLE", false);
        "Gmail is unavailable".to_owned()
    })?;
    let vault = app.state::<DocumentVault>();
    let result = app.state::<AppState>().with_connection(|c| {
        let mut active = lease.clone();
        let mut store = GmailSqliteSyncStore::new(c, active.clone(), vault.inner(), &never_map)
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let outcome = if raw.last_full_scan_at.is_none() {
            run_full_sync(
                &mut api,
                &mut store,
                &label,
                &raw.gmail_query,
                &GmailSyncLimits::default(),
            )
            .map(|_| ())
        } else {
            let cursor = active
                .history_id
                .parse::<u64>()
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            match run_incremental_sync(
                &mut api,
                &mut store,
                &label,
                cursor,
                &GmailSyncLimits::default(),
            ) {
                Err(GmailSyncError::FullReconciliationRequired) => {
                    active =
                        gmail_store::claim_due_sync(c, &active.household_id, &active.connection_id)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?
                            .ok_or(rusqlite::Error::InvalidQuery)?;
                    let mut full_store =
                        GmailSqliteSyncStore::new(c, active.clone(), vault.inner(), &never_map)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?;
                    run_full_sync(
                        &mut api,
                        &mut full_store,
                        &label,
                        &raw.gmail_query,
                        &GmailSyncLimits::default(),
                    )
                    .map(|_| ())
                }
                other => other.map(|_| ()),
            }
        };
        if outcome.is_err() {
            fail_if_active(c, &active, "SYNC_FAILED");
            return Err(rusqlite::Error::InvalidQuery.into());
        }
        gmail_store::load_schedule(c, &lease.household_id, &lease.connection_id)
            .map(gmail_command_service::project_schedule)
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
    });
    result.map_err(|_| "Gmail synchronization did not complete".to_owned())
}

fn never_map(_: &str, _: &[u8]) -> bool {
    false
}
fn fail_if_active(c: &rusqlite::Connection, lease: &SyncLeaseDto, code: &str) {
    if gmail_store::heartbeat_sync(c, lease).is_ok() {
        let _ = gmail_store::fail_sync(c, lease, code);
    }
}
fn finish_claim(app: &AppHandle, lease: &SyncLeaseDto, code: &str, terminal: bool) {
    let _ = app.state::<AppState>().with_connection(|c| { fail_if_active(c, lease, code); if terminal { c.execute("UPDATE gmail_connections SET status='AUTH_REQUIRED' WHERE household_id=?1 AND id=?2", rusqlite::params![lease.household_id, lease.connection_id])?; } Ok(()) });
}

fn with_api<R>(
    app: &AppHandle,
    household: &str,
    connection_id: &str,
    work: impl FnOnce(&GmailApiClient<crate::gmail_api::ReqwestGmailTransport>) -> Result<R, String>,
) -> Result<R, String> {
    let raw = app
        .state::<AppState>()
        .with_connection(|c| {
            gmail_store::load_connection(c, household, connection_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Gmail connection is unavailable".to_owned())?;
    let binding = GmailCredentialBinding::new(connection_id, household, raw.client_id_fingerprint)
        .map_err(|_| "Gmail credential binding is invalid".to_owned())?;
    let credential = app
        .state::<GmailCredentialStore>()
        .read(&binding)
        .map_err(|_| "Gmail credential is unavailable".to_owned())?
        .ok_or_else(|| "Gmail must be connected again".to_owned())?;
    let oauth = GmailOAuthClient::production(
        configured_client_id().ok_or_else(|| "Gmail OAuth is not configured".to_owned())?,
    )
    .map_err(|_| "Gmail authorization is unavailable".to_owned())?;
    let access = oauth.refresh(credential.refresh_token()).map_err(|error| {
        if error == GmailOAuthError::ReauthorizationRequired {
            "Gmail must be connected again".to_owned()
        } else {
            "Gmail authorization is unavailable".to_owned()
        }
    })?;
    let api = GmailApiClient::production(&access.access_token)
        .map_err(|_| "Gmail is unavailable".to_owned())?;
    work(&api)
}

#[tauri::command]
pub async fn gmail_disconnect(
    app: AppHandle,
    household_id: String,
    connection_id: String,
) -> Result<RedactedGmailConnectionDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let raw = app
            .state::<AppState>()
            .with_connection(|c| {
                gmail_store::load_connection(c, &household_id, &connection_id)
                    .map_err(|_| rusqlite::Error::InvalidQuery.into())
            })
            .map_err(|_| "Gmail connection is unavailable".to_owned())?;
        let binding =
            GmailCredentialBinding::new(&connection_id, &household_id, raw.client_id_fingerprint)
                .map_err(|_| "Gmail credential binding is invalid".to_owned())?;
        if let (Some(client), Ok(Some(credential))) = (
            configured_client_id(),
            app.state::<GmailCredentialStore>().read(&binding),
        ) {
            if let Ok(oauth) = GmailOAuthClient::production(client) {
                let _ = oauth.revoke(credential.refresh_token());
            }
        }
        let dto = app
            .state::<AppState>()
            .with_connection(|c| {
                let disconnected = gmail_store::disconnect(c, &household_id, &connection_id)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                crate::connector_binding::delete_active_binding(
                    c,
                    &household_id,
                    crate::connector_control::ConnectorKind::Gmail,
                    &connection_id,
                )
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
                Ok(gmail_command_service::project_connection(disconnected))
            })
            .map_err(|_| "Gmail connection could not be disconnected".to_owned())?;
        app.state::<GmailCredentialStore>()
            .delete(&binding)
            .map_err(|_| "Gmail credential could not be removed".to_owned())?;
        Ok(dto)
    })
    .await
    .map_err(|_| "Gmail disconnect worker stopped".to_owned())?
}

fn configured_client_id() -> Option<&'static str> {
    COMPILED_CLIENT_ID.filter(|v| {
        !v.is_empty()
            && v.len() <= 512
            && !v.chars().any(char::is_whitespace)
            && v.ends_with(".apps.googleusercontent.com")
    })
}
fn random_connection_id() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| "Gmail connection id could not be created".to_owned())?;
    let encoded = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!("gmail-{encoded}"))
}
