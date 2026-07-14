//! Redacted command boundary for the Google Drive desktop connector.

use crate::{
    google_drive_folder::{
        parse_folder_reference, validate_folder_binding, GoogleDriveFolderError,
        GoogleDriveFolderMetadata,
    },
    google_drive_store::{
        self, GoogleDriveConnectionDto, GoogleDriveInboxItemDto, GoogleDriveStoreError,
        SyncScheduleDto,
    },
};
use rusqlite::Connection;
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GoogleDriveAuthorizationMode {
    SystemBrowserLoopback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GoogleDriveScopeProfile {
    DriveReadonly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GoogleDriveUnavailableReason {
    ClientIdNotCompiled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveAvailabilityDto {
    pub available: bool,
    pub authorization_mode: GoogleDriveAuthorizationMode,
    pub scope_profile: GoogleDriveScopeProfile,
    pub unavailable_reason: Option<GoogleDriveUnavailableReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GoogleDriveScopeDto {
    MyDrive,
    SharedDrive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactedGoogleDriveConnectionDto {
    pub id: String,
    pub status: String,
    pub account_email: Option<String>,
    pub folder_name: Option<String>,
    pub drive_scope: Option<GoogleDriveScopeDto>,
    pub folder_bound: bool,
    pub last_full_scan_at: Option<String>,
    pub last_change_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Error)]
pub enum GoogleDriveCommandServiceError {
    #[error(transparent)]
    Store(#[from] GoogleDriveStoreError),
    #[error(transparent)]
    Folder(#[from] GoogleDriveFolderError),
    #[error("Google Drive connection list could not be loaded")]
    Database(#[from] rusqlite::Error),
}

pub fn availability(oauth_client_configured: bool) -> GoogleDriveAvailabilityDto {
    GoogleDriveAvailabilityDto {
        available: oauth_client_configured,
        authorization_mode: GoogleDriveAuthorizationMode::SystemBrowserLoopback,
        scope_profile: GoogleDriveScopeProfile::DriveReadonly,
        unavailable_reason: (!oauth_client_configured)
            .then_some(GoogleDriveUnavailableReason::ClientIdNotCompiled),
    }
}

pub fn list_connections(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<RedactedGoogleDriveConnectionDto>, GoogleDriveCommandServiceError> {
    let mut statement = connection.prepare(
        "SELECT id FROM google_drive_connections
         WHERE household_id=?1 ORDER BY updated_at DESC,id",
    )?;
    let ids = statement
        .query_map([household_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.iter()
        .map(|id| load_connection(connection, household_id, id))
        .collect()
}

pub fn load_connection(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<RedactedGoogleDriveConnectionDto, GoogleDriveCommandServiceError> {
    Ok(redact(google_drive_store::load_connection(
        connection,
        household_id,
        connection_id,
    )?))
}

pub fn begin_connection(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    client_id_fingerprint: &str,
) -> Result<RedactedGoogleDriveConnectionDto, GoogleDriveCommandServiceError> {
    Ok(redact(google_drive_store::begin_connection(
        connection,
        household_id,
        connection_id,
        client_id_fingerprint,
    )?))
}

pub fn mark_authorized(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    google_account_id: &str,
    account_email: &str,
) -> Result<RedactedGoogleDriveConnectionDto, GoogleDriveCommandServiceError> {
    Ok(redact(google_drive_store::mark_authorized(
        connection,
        household_id,
        connection_id,
        google_account_id,
        account_email,
    )?))
}

pub fn bind_verified_folder(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    folder_reference: &str,
    metadata: GoogleDriveFolderMetadata,
    captured_start_page_token: &str,
) -> Result<RedactedGoogleDriveConnectionDto, GoogleDriveCommandServiceError> {
    let reference = parse_folder_reference(folder_reference)?;
    let drive_id = metadata.drive_id.clone();
    let binding = validate_folder_binding(&reference, metadata)?;
    Ok(redact(google_drive_store::select_root_with_baseline(
        connection,
        household_id,
        connection_id,
        drive_id.as_deref(),
        &binding.folder_id,
        &binding.folder_name,
        binding.resource_key.as_deref(),
        captured_start_page_token,
    )?))
}

pub fn get_schedule(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<SyncScheduleDto, GoogleDriveCommandServiceError> {
    Ok(google_drive_store::load_schedule(
        connection,
        household_id,
        connection_id,
    )?)
}

pub fn update_schedule(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    enabled: bool,
    interval_minutes: u32,
) -> Result<SyncScheduleDto, GoogleDriveCommandServiceError> {
    Ok(google_drive_store::configure_schedule(
        connection,
        household_id,
        connection_id,
        enabled,
        interval_minutes,
    )?)
}

pub fn list_inbox(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
    limit: u16,
) -> Result<Vec<GoogleDriveInboxItemDto>, GoogleDriveCommandServiceError> {
    Ok(google_drive_store::list_inbox(
        connection,
        household_id,
        connection_id,
        limit,
    )?)
}

pub fn disconnect(
    connection: &Connection,
    household_id: &str,
    connection_id: &str,
) -> Result<RedactedGoogleDriveConnectionDto, GoogleDriveCommandServiceError> {
    Ok(redact(google_drive_store::disconnect(
        connection,
        household_id,
        connection_id,
    )?))
}

fn redact(connection: GoogleDriveConnectionDto) -> RedactedGoogleDriveConnectionDto {
    let folder_bound = connection.root_folder_id.is_some();
    let drive_scope = folder_bound.then_some(if connection.drive_id.is_some() {
        GoogleDriveScopeDto::SharedDrive
    } else {
        GoogleDriveScopeDto::MyDrive
    });
    RedactedGoogleDriveConnectionDto {
        id: connection.id,
        status: connection.status,
        account_email: connection.account_email,
        folder_name: connection.root_folder_name,
        drive_scope,
        folder_bound,
        last_full_scan_at: connection.last_full_scan_at,
        last_change_at: connection.last_change_at,
        created_at: connection.created_at,
        updated_at: connection.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        google_drive_folder::GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        google_drive_store::{DiscoveryDisposition, RemoteNode},
        persistence::AppState,
    };

    const FOLDER_ID: &str = "1AbC_def-GhijKLMnOP234567890";
    const ACCOUNT_ID: &str = "google-account-secret-123";
    const RESOURCE_KEY: &str = "resource_key_secret";
    const BASELINE: &str = "secret-change-cursor";
    const FINGERPRINT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn setup() -> AppState {
        let state = AppState::in_memory(&[17_u8; 32]).unwrap();
        state
            .with_connection(|connection| {
                connection
                    .execute(
                        "INSERT INTO households(id,name) VALUES('home','Home'),('other','Other')",
                        [],
                    )
                    .unwrap();
                Ok(())
            })
            .unwrap();
        state
    }

    fn authorize(connection: &Connection) {
        begin_connection(connection, "home", "drive", FINGERPRINT).unwrap();
        mark_authorized(connection, "home", "drive", ACCOUNT_ID, "home@example.com").unwrap();
    }

    fn bind(connection: &Connection) -> RedactedGoogleDriveConnectionDto {
        bind_verified_folder(
            connection,
            "home",
            "drive",
            &format!(
                "https://drive.google.com/drive/folders/{FOLDER_ID}?resourcekey={RESOURCE_KEY}"
            ),
            GoogleDriveFolderMetadata {
                file_id: FOLDER_ID.to_owned(),
                name: "家計簿 Inbox".to_owned(),
                mime_type: GOOGLE_DRIVE_FOLDER_MIME_TYPE.to_owned(),
                drive_id: Some("0ASharedDriveExample".to_owned()),
                trashed: false,
            },
            BASELINE,
        )
        .unwrap()
    }

    fn assert_redacted(dto: &RedactedGoogleDriveConnectionDto) {
        let json = serde_json::to_string(dto).unwrap();
        for forbidden in [
            FINGERPRINT,
            ACCOUNT_ID,
            RESOURCE_KEY,
            BASELINE,
            FOLDER_ID,
            "0ASharedDriveExample",
        ] {
            assert!(!json.contains(forbidden), "serialized {forbidden}");
        }
        assert!(!json.contains("pageToken"));
        assert!(!json.contains("resourceKey"));
        assert!(!json.contains("clientIdFingerprint"));
        assert!(!json.contains("googleAccountId"));
    }

    #[test]
    fn availability_is_explicit_and_contains_no_configuration_value() {
        assert_eq!(
            availability(false),
            GoogleDriveAvailabilityDto {
                available: false,
                authorization_mode: GoogleDriveAuthorizationMode::SystemBrowserLoopback,
                scope_profile: GoogleDriveScopeProfile::DriveReadonly,
                unavailable_reason: Some(GoogleDriveUnavailableReason::ClientIdNotCompiled),
            }
        );
        let json = serde_json::to_string(&availability(true)).unwrap();
        assert_eq!(
            json,
            r#"{"available":true,"authorizationMode":"SYSTEM_BROWSER_LOOPBACK","scopeProfile":"DRIVE_READONLY","unavailableReason":null}"#
        );
    }

    #[test]
    fn lifecycle_returns_only_redacted_connection_views() {
        let state = setup();
        state
            .with_connection(|connection| {
                let beginning = begin_connection(connection, "home", "drive", FINGERPRINT).unwrap();
                assert_eq!(beginning.status, "AUTHORIZING");
                assert_redacted(&beginning);

                let authorized =
                    mark_authorized(connection, "home", "drive", ACCOUNT_ID, "home@example.com")
                        .unwrap();
                assert_eq!(
                    authorized.account_email.as_deref(),
                    Some("home@example.com")
                );
                assert_redacted(&authorized);

                let bound = bind(connection);
                assert_eq!(bound.status, "CONNECTED");
                assert_eq!(bound.folder_name.as_deref(), Some("家計簿 Inbox"));
                assert_eq!(bound.drive_scope, Some(GoogleDriveScopeDto::SharedDrive));
                assert!(bound.folder_bound);
                assert_redacted(&bound);

                assert_eq!(list_connections(connection, "home").unwrap(), vec![bound]);
                assert!(list_connections(connection, "other").unwrap().is_empty());
                assert!(load_connection(connection, "other", "drive").is_err());

                // Secrets needed by native workers remain durable but are not
                // exposed by any serialized command DTO.
                let raw = google_drive_store::load_connection(connection, "home", "drive").unwrap();
                assert_eq!(raw.google_account_id.as_deref(), Some(ACCOUNT_ID));
                assert_eq!(raw.root_resource_key.as_deref(), Some(RESOURCE_KEY));
                assert_eq!(raw.change_page_token.as_deref(), Some(BASELINE));
                assert_eq!(raw.client_id_fingerprint, FINGERPRINT);

                let disconnected = disconnect(connection, "home", "drive").unwrap();
                assert_eq!(disconnected.status, "DISCONNECTED");
                assert_redacted(&disconnected);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn folder_reference_and_verified_metadata_must_agree_before_binding() {
        let state = setup();
        state
            .with_connection(|connection| {
                authorize(connection);
                let error = bind_verified_folder(
                    connection,
                    "home",
                    "drive",
                    FOLDER_ID,
                    GoogleDriveFolderMetadata {
                        file_id: "differentFolder123".to_owned(),
                        name: "Wrong".to_owned(),
                        mime_type: GOOGLE_DRIVE_FOLDER_MIME_TYPE.to_owned(),
                        drive_id: None,
                        trashed: false,
                    },
                    BASELINE,
                );
                assert!(matches!(
                    error,
                    Err(GoogleDriveCommandServiceError::Folder(
                        GoogleDriveFolderError::BindingMismatch
                    ))
                ));
                assert_eq!(
                    google_drive_store::load_connection(connection, "home", "drive")
                        .unwrap()
                        .status,
                    "SELECTING_FOLDER"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn schedule_and_inbox_commands_preserve_review_gate() {
        let state = setup();
        state
            .with_connection(|connection| {
                authorize(connection);
                bind(connection);
                let schedule = update_schedule(connection, "home", "drive", true, 15).unwrap();
                assert!(schedule.enabled);
                assert_eq!(get_schedule(connection, "home", "drive").unwrap(), schedule);

                let lease = google_drive_store::claim_due_sync(connection, "home", "drive")
                    .unwrap()
                    .unwrap();
                let node = RemoteNode {
                    file_id: "remoteFile123".to_owned(),
                    parent_file_id: Some(FOLDER_ID.to_owned()),
                    name: "bank.csv".to_owned(),
                    mime_type: "text/csv".to_owned(),
                    modified_time: Some("2026-07-15T00:00:00Z".to_owned()),
                    byte_size: Some(42),
                    md5_checksum: Some("11111111111111111111111111111111".to_owned()),
                    drive_version: Some("7".to_owned()),
                    is_folder: false,
                    can_download: true,
                    is_in_selected_tree: true,
                    is_trashed: false,
                    disposition: DiscoveryDisposition::Reviewable,
                };
                google_drive_store::discover_nodes_claimed(
                    connection,
                    "home",
                    "drive",
                    &lease.lease_token,
                    &[node],
                )
                .unwrap();
                google_drive_store::complete_sync(
                    connection,
                    "home",
                    "drive",
                    &lease.lease_token,
                    "next-cursor",
                    1,
                    true,
                )
                .unwrap();

                let inbox = list_inbox(connection, "home", "drive", 20).unwrap();
                assert_eq!(inbox.len(), 1);
                assert_eq!(inbox[0].state, "DISCOVERED");
                assert!(inbox[0].import_run_id.is_none());
                assert!(inbox[0].content_sha256.is_none());

                let disabled = update_schedule(connection, "home", "drive", false, 30).unwrap();
                assert!(!disabled.enabled);
                assert_eq!(disabled.last_result, "DISABLED");
                Ok(())
            })
            .unwrap();
    }
}
