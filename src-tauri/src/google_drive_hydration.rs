//! Review-gated hydration of Google Drive remote Inbox generations.

use crate::{
    document_vault::DocumentVault,
    google_drive_api::{
        DriveApiClient, DriveApiError, DriveFile, DriveTransport, MAX_DOWNLOAD_BYTES,
    },
    google_drive_store::{self, GoogleDriveInboxItemDto, GoogleDriveStoreError, InboxLeaseDto},
};
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use thiserror::Error;

pub trait DriveHydrationApi {
    fn metadata(
        &self,
        file_id: &str,
        resource_key: Option<&str>,
    ) -> Result<DriveFile, DriveApiError>;
    fn download_bytes(
        &self,
        file_id: &str,
        resource_key: Option<&str>,
        max_bytes: u64,
    ) -> Result<Vec<u8>, DriveApiError>;
}

impl<T: DriveTransport> DriveHydrationApi for DriveApiClient<T> {
    fn metadata(
        &self,
        file_id: &str,
        resource_key: Option<&str>,
    ) -> Result<DriveFile, DriveApiError> {
        self.file_metadata(file_id, resource_key)
    }

    fn download_bytes(
        &self,
        file_id: &str,
        resource_key: Option<&str>,
        max_bytes: u64,
    ) -> Result<Vec<u8>, DriveApiError> {
        self.download(file_id, resource_key, max_bytes)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImmutableObject {
    pub sha256: String,
    pub byte_size: u64,
    pub media_type: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ImmutableSinkError {
    #[error("immutable object storage failed")]
    WriteFailed,
}

pub trait ImmutableDriveSink {
    /// Implementations must publish atomically or return an error without a
    /// partially addressable object. Repeating the same bytes is idempotent.
    fn put_immutable(
        &self,
        bytes: &[u8],
        media_type: &str,
    ) -> Result<ImmutableObject, ImmutableSinkError>;
}

impl ImmutableDriveSink for DocumentVault {
    fn put_immutable(
        &self,
        bytes: &[u8],
        media_type: &str,
    ) -> Result<ImmutableObject, ImmutableSinkError> {
        let stored = self
            .put(bytes, media_type)
            .map_err(|_| ImmutableSinkError::WriteFailed)?;
        Ok(ImmutableObject {
            sha256: stored.sha256,
            byte_size: stored.plaintext_size,
            media_type: stored.mime_type,
        })
    }
}

pub trait HydrationMappingPolicy {
    fn needs_mapping(&self, file_name: &str, media_type: &str, bytes: &[u8]) -> bool;
}

impl<F> HydrationMappingPolicy for F
where
    F: Fn(&str, &str, &[u8]) -> bool,
{
    fn needs_mapping(&self, file_name: &str, media_type: &str, bytes: &[u8]) -> bool {
        self(file_name, media_type, bytes)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HydrationOutcome {
    pub item_id: String,
    pub state: String,
    pub content_sha256: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Error)]
pub enum HydrationServiceError {
    #[error("Google Drive Inbox state changed")]
    Store(#[from] GoogleDriveStoreError),
}

pub struct HydrationBatchRequest<'a> {
    pub household_id: &'a str,
    pub connection_id: &'a str,
    pub item_ids: &'a [String],
    pub resource_keys: &'a BTreeMap<String, String>,
}

/// Claims a bounded set of reviewable remote generations and hydrates each
/// independently. Provider/storage failures become fenced FAILED Inbox rows;
/// this function never creates an import run or posts ledger data.
pub fn claim_and_hydrate<A, S, P>(
    connection: &Connection,
    request: HydrationBatchRequest<'_>,
    api: &A,
    sink: &S,
    mapping_policy: &P,
) -> Result<Vec<HydrationOutcome>, HydrationServiceError>
where
    A: DriveHydrationApi,
    S: ImmutableDriveSink,
    P: HydrationMappingPolicy,
{
    let lease = google_drive_store::claim_inbox(
        connection,
        request.household_id,
        request.connection_id,
        request.item_ids,
    )?;
    lease
        .items
        .iter()
        .map(|item| {
            hydrate_one(
                connection,
                item,
                &lease,
                request.resource_keys.get(&item.file_id).map(String::as_str),
                api,
                sink,
                mapping_policy,
            )
        })
        .collect()
}

fn hydrate_one<A, S, P>(
    connection: &Connection,
    item: &GoogleDriveInboxItemDto,
    lease: &InboxLeaseDto,
    resource_key: Option<&str>,
    api: &A,
    sink: &S,
    mapping_policy: &P,
) -> Result<HydrationOutcome, HydrationServiceError>
where
    A: DriveHydrationApi,
    S: ImmutableDriveSink,
    P: HydrationMappingPolicy,
{
    match hydrate_bytes(item, resource_key, api, sink, mapping_policy) {
        Ok((object, needs_mapping)) => {
            let ready = google_drive_store::mark_inbox_ready(
                connection,
                &item.household_id,
                &item.id,
                &lease.lease_token,
                &object.sha256,
                needs_mapping,
            )?;
            Ok(HydrationOutcome {
                item_id: item.id.clone(),
                state: ready.state,
                content_sha256: ready.content_sha256,
                error_code: None,
            })
        }
        Err(code) => {
            let failed = google_drive_store::fail_inbox(
                connection,
                &item.household_id,
                &item.id,
                &lease.lease_token,
                code,
            )?;
            Ok(HydrationOutcome {
                item_id: item.id.clone(),
                state: failed.state,
                content_sha256: None,
                error_code: failed.last_error_code,
            })
        }
    }
}

fn hydrate_bytes<A, S, P>(
    item: &GoogleDriveInboxItemDto,
    resource_key: Option<&str>,
    api: &A,
    sink: &S,
    mapping_policy: &P,
) -> Result<(ImmutableObject, bool), &'static str>
where
    A: DriveHydrationApi,
    S: ImmutableDriveSink,
    P: HydrationMappingPolicy,
{
    let before = api
        .metadata(&item.file_id, resource_key)
        .map_err(api_error_code)?;
    validate_generation(item, &before)?;
    let max_bytes = item.remote_byte_size.unwrap_or(MAX_DOWNLOAD_BYTES).max(1);
    if max_bytes > MAX_DOWNLOAD_BYTES {
        return Err("REMOTE_TOO_LARGE");
    }
    let bytes = api
        .download_bytes(&item.file_id, resource_key, max_bytes)
        .map_err(api_error_code)?;
    if item
        .remote_byte_size
        .is_some_and(|expected| expected != bytes.len() as u64)
    {
        return Err("REMOTE_GENERATION_CHANGED");
    }
    let after = api
        .metadata(&item.file_id, resource_key)
        .map_err(api_error_code)?;
    validate_generation(item, &after)?;
    if before.version != after.version
        || before.modified_time != after.modified_time
        || before.md5_checksum != after.md5_checksum
        || before.size != after.size
    {
        return Err("REMOTE_GENERATION_CHANGED");
    }

    let content_sha256 = format!("{:x}", Sha256::digest(&bytes));
    let object = sink
        .put_immutable(&bytes, &item.media_type)
        .map_err(|_| "IMMUTABLE_STORAGE_FAILED")?;
    if object.sha256 != content_sha256
        || object.byte_size != bytes.len() as u64
        || object.media_type != item.media_type
    {
        return Err("IMMUTABLE_STORAGE_MISMATCH");
    }
    let needs_mapping = mapping_policy.needs_mapping(&item.file_name, &item.media_type, &bytes);
    Ok((object, needs_mapping))
}

fn validate_generation(
    item: &GoogleDriveInboxItemDto,
    file: &DriveFile,
) -> Result<(), &'static str> {
    if file.id != item.file_id
        || file.name != item.file_name
        || file.mime_type != item.media_type
        || file.trashed
        || !file.capabilities.can_download
        || file.size != item.remote_byte_size
        || file.modified_time != item.remote_modified_at
        || file.md5_checksum != item.remote_md5_checksum
        || file.version.map(|value| value.to_string()) != item.drive_version
    {
        Err("REMOTE_GENERATION_CHANGED")
    } else {
        Ok(())
    }
}

fn api_error_code(error: DriveApiError) -> &'static str {
    match error {
        DriveApiError::ReauthorizationRequired => "AUTH_EXPIRED",
        DriveApiError::Forbidden => "REMOTE_FORBIDDEN",
        DriveApiError::NotFound => "REMOTE_NOT_FOUND",
        DriveApiError::RateLimited => "REMOTE_RATE_LIMITED",
        DriveApiError::ChangeCursorExpired => "REMOTE_CHANGE_CURSOR_EXPIRED",
        DriveApiError::Retryable => "REMOTE_UNAVAILABLE",
        DriveApiError::Network => "REMOTE_NETWORK_FAILED",
        DriveApiError::InvalidResponse => "REMOTE_INVALID_RESPONSE",
        DriveApiError::InvalidInput => "HYDRATION_INVALID_INPUT",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        google_drive_api::DriveCapabilities,
        google_drive_store::{DiscoveryDisposition, RemoteNode},
        persistence::AppState,
    };
    use std::sync::Mutex;

    struct FakeApi {
        metadata: Mutex<Vec<Result<DriveFile, DriveApiError>>>,
        download: Mutex<Option<Result<Vec<u8>, DriveApiError>>>,
        resource_keys: Mutex<Vec<Option<String>>>,
    }

    impl FakeApi {
        fn new(before: DriveFile, bytes: &[u8], after: DriveFile) -> Self {
            Self {
                metadata: Mutex::new(vec![Ok(after), Ok(before)]),
                download: Mutex::new(Some(Ok(bytes.to_vec()))),
                resource_keys: Mutex::new(Vec::new()),
            }
        }
    }

    impl DriveHydrationApi for FakeApi {
        fn metadata(
            &self,
            _file_id: &str,
            resource_key: Option<&str>,
        ) -> Result<DriveFile, DriveApiError> {
            self.resource_keys
                .lock()
                .unwrap()
                .push(resource_key.map(str::to_owned));
            self.metadata.lock().unwrap().pop().unwrap()
        }

        fn download_bytes(
            &self,
            _file_id: &str,
            resource_key: Option<&str>,
            max_bytes: u64,
        ) -> Result<Vec<u8>, DriveApiError> {
            self.resource_keys
                .lock()
                .unwrap()
                .push(resource_key.map(str::to_owned));
            let bytes = self.download.lock().unwrap().take().unwrap()?;
            assert!(bytes.len() as u64 <= max_bytes);
            Ok(bytes)
        }
    }

    #[derive(Default)]
    struct FakeSink {
        objects: Mutex<Vec<Vec<u8>>>,
        fail: bool,
        corrupt_receipt: bool,
    }

    impl ImmutableDriveSink for FakeSink {
        fn put_immutable(
            &self,
            bytes: &[u8],
            media_type: &str,
        ) -> Result<ImmutableObject, ImmutableSinkError> {
            if self.fail {
                return Err(ImmutableSinkError::WriteFailed);
            }
            self.objects.lock().unwrap().push(bytes.to_vec());
            Ok(ImmutableObject {
                sha256: if self.corrupt_receipt {
                    "0".repeat(64)
                } else {
                    format!("{:x}", Sha256::digest(bytes))
                },
                byte_size: bytes.len() as u64,
                media_type: media_type.to_owned(),
            })
        }
    }

    fn setup(bytes: &[u8]) -> (AppState, GoogleDriveInboxItemDto) {
        let state = AppState::in_memory(&[13_u8; 32]).unwrap();
        let item = state
            .with_connection(|connection| {
                connection
                    .execute("INSERT INTO households(id,name) VALUES('home','Home')", [])
                    .unwrap();
                google_drive_store::begin_connection(connection, "home", "drive", &"a".repeat(64))
                    .unwrap();
                google_drive_store::mark_authorized(
                    connection,
                    "home",
                    "drive",
                    "account",
                    "home@example.com",
                )
                .unwrap();
                google_drive_store::select_root_with_baseline(
                    connection, "home", "drive", None, "root", "Inbox", None, "baseline",
                )
                .unwrap();
                google_drive_store::configure_schedule(connection, "home", "drive", true, 30)
                    .unwrap();
                let sync = google_drive_store::claim_due_sync(connection, "home", "drive")
                    .unwrap()
                    .unwrap();
                let node = RemoteNode {
                    file_id: "file".to_owned(),
                    parent_file_id: Some("root".to_owned()),
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
                };
                let item = google_drive_store::discover_nodes_claimed(
                    connection,
                    "home",
                    "drive",
                    &sync.lease_token,
                    &[node],
                )
                .unwrap()
                .remove(0);
                google_drive_store::complete_sync(
                    connection,
                    "home",
                    "drive",
                    &sync.lease_token,
                    "terminal",
                    1,
                    true,
                )
                .unwrap();
                Ok(item)
            })
            .unwrap();
        (state, item)
    }

    fn metadata(bytes: &[u8], version: u64) -> DriveFile {
        DriveFile {
            id: "file".to_owned(),
            name: "bank.csv".to_owned(),
            mime_type: "text/csv".to_owned(),
            parents: vec!["root".to_owned()],
            modified_time: Some("2026-07-15T00:00:00Z".to_owned()),
            size: Some(bytes.len() as u64),
            md5_checksum: Some("11111111111111111111111111111111".to_owned()),
            version: Some(version),
            trashed: false,
            drive_id: None,
            capabilities: DriveCapabilities { can_download: true },
        }
    }

    #[test]
    fn exact_generation_is_saved_then_marked_ready_with_resource_key() {
        let bytes = b"date,amount\n2026-07-15,1200\n";
        let (state, item) = setup(bytes);
        state
            .with_connection(|connection| {
                let api = FakeApi::new(metadata(bytes, 7), bytes, metadata(bytes, 7));
                let sink = FakeSink::default();
                let keys = BTreeMap::from([("file".to_owned(), "resource-key".to_owned())]);
                let outcomes = claim_and_hydrate(
                    connection,
                    HydrationBatchRequest {
                        household_id: "home",
                        connection_id: "drive",
                        item_ids: std::slice::from_ref(&item.id),
                        resource_keys: &keys,
                    },
                    &api,
                    &sink,
                    &|_: &str, _: &str, _: &[u8]| false,
                )
                .unwrap();
                assert_eq!(outcomes[0].state, "READY");
                assert_eq!(sink.objects.lock().unwrap().as_slice(), &[bytes.to_vec()]);
                assert_eq!(
                    api.resource_keys.lock().unwrap().as_slice(),
                    vec![Some("resource-key".to_owned()); 3].as_slice()
                );
                assert!(outcomes[0].content_sha256.is_some());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn post_download_generation_race_never_reaches_immutable_sink() {
        let bytes = b"date,amount\n2026-07-15,1200\n";
        let (state, item) = setup(bytes);
        state
            .with_connection(|connection| {
                let api = FakeApi::new(metadata(bytes, 7), bytes, metadata(bytes, 8));
                let sink = FakeSink::default();
                let outcomes = claim_and_hydrate(
                    connection,
                    HydrationBatchRequest {
                        household_id: "home",
                        connection_id: "drive",
                        item_ids: &[item.id],
                        resource_keys: &BTreeMap::new(),
                    },
                    &api,
                    &sink,
                    &|_: &str, _: &str, _: &[u8]| false,
                )
                .unwrap();
                assert_eq!(outcomes[0].state, "FAILED");
                assert_eq!(
                    outcomes[0].error_code.as_deref(),
                    Some("REMOTE_GENERATION_CHANGED")
                );
                assert!(sink.objects.lock().unwrap().is_empty());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn immutable_sink_failure_is_review_gated_and_mapping_is_explicit() {
        let bytes = b"unrecognized headers\n";
        let (state, item) = setup(bytes);
        state
            .with_connection(|connection| {
                let failed = claim_and_hydrate(
                    connection,
                    HydrationBatchRequest {
                        household_id: "home",
                        connection_id: "drive",
                        item_ids: std::slice::from_ref(&item.id),
                        resource_keys: &BTreeMap::new(),
                    },
                    &FakeApi::new(metadata(bytes, 7), bytes, metadata(bytes, 7)),
                    &FakeSink {
                        fail: true,
                        ..FakeSink::default()
                    },
                    &|_: &str, _: &str, _: &[u8]| true,
                )
                .unwrap();
                assert_eq!(failed[0].state, "FAILED");
                assert_eq!(
                    failed[0].error_code.as_deref(),
                    Some("IMMUTABLE_STORAGE_FAILED")
                );
                Ok(())
            })
            .unwrap();

        let (state, item) = setup(bytes);
        state
            .with_connection(|connection| {
                let mapped = claim_and_hydrate(
                    connection,
                    HydrationBatchRequest {
                        household_id: "home",
                        connection_id: "drive",
                        item_ids: &[item.id],
                        resource_keys: &BTreeMap::new(),
                    },
                    &FakeApi::new(metadata(bytes, 7), bytes, metadata(bytes, 7)),
                    &FakeSink::default(),
                    &|_: &str, _: &str, _: &[u8]| true,
                )
                .unwrap();
                assert_eq!(mapped[0].state, "NEEDS_MAPPING");
                Ok(())
            })
            .unwrap();
    }
}
