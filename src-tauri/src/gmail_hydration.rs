//! Review-gated hydration of immutable Gmail raw-message evidence.

use crate::{
    document_vault::DocumentVault,
    gmail_api::{
        GmailApiClient, GmailApiError, GmailRawMessage, GmailTransport, MAX_RAW_MESSAGE_BYTES,
    },
    gmail_store::{self, GmailInboxItemDto, GmailStoreError, InboxLeaseDto},
};
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

pub trait GmailHydrationApi {
    fn raw_message(
        &self,
        message_id: &str,
        max_decoded_bytes: usize,
    ) -> Result<GmailRawMessage, GmailApiError>;
}

impl<T: GmailTransport> GmailHydrationApi for GmailApiClient<T> {
    fn raw_message(
        &self,
        message_id: &str,
        max_decoded_bytes: usize,
    ) -> Result<GmailRawMessage, GmailApiError> {
        self.get_message_raw(message_id, max_decoded_bytes)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImmutableGmailObject {
    pub sha256: String,
    pub byte_size: u64,
    pub media_type: String,
    pub deduplicated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ImmutableGmailSinkError {
    #[error("immutable Gmail evidence storage failed")]
    WriteFailed,
}

pub trait ImmutableGmailSink {
    /// Publishes content atomically under its plaintext SHA-256. Repeating the
    /// same bytes must authenticate and return the existing object.
    fn put_raw_eml(&self, bytes: &[u8]) -> Result<ImmutableGmailObject, ImmutableGmailSinkError>;
}

impl ImmutableGmailSink for DocumentVault {
    fn put_raw_eml(&self, bytes: &[u8]) -> Result<ImmutableGmailObject, ImmutableGmailSinkError> {
        let stored = self
            .put(bytes, "message/rfc822")
            .map_err(|_| ImmutableGmailSinkError::WriteFailed)?;
        Ok(ImmutableGmailObject {
            sha256: stored.sha256,
            byte_size: stored.plaintext_size,
            media_type: stored.mime_type,
            deduplicated: stored.deduplicated,
        })
    }
}

pub trait GmailMappingPolicy {
    fn needs_mapping(&self, file_name: &str, raw_eml: &[u8]) -> bool;
}

impl<F> GmailMappingPolicy for F
where
    F: Fn(&str, &[u8]) -> bool,
{
    fn needs_mapping(&self, file_name: &str, raw_eml: &[u8]) -> bool {
        self(file_name, raw_eml)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailHydrationOutcome {
    pub item_id: String,
    pub state: String,
    pub content_sha256: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Error)]
pub enum GmailHydrationError {
    #[error("Gmail Inbox state changed")]
    Store(#[from] GmailStoreError),
}

pub struct GmailHydrationRequest<'a> {
    pub household_id: &'a str,
    pub connection_id: &'a str,
    pub item_ids: &'a [String],
}

/// Claims a bounded set of discovered messages and hydrates each independently.
/// Provider or vault failures are persisted as retryable Inbox evidence; no
/// import run or ledger row is created here.
pub fn claim_and_hydrate<A, S, P>(
    connection: &Connection,
    request: GmailHydrationRequest<'_>,
    api: &A,
    sink: &S,
    mapping_policy: &P,
) -> Result<Vec<GmailHydrationOutcome>, GmailHydrationError>
where
    A: GmailHydrationApi,
    S: ImmutableGmailSink,
    P: GmailMappingPolicy,
{
    let lease = gmail_store::claim_inbox(
        connection,
        request.household_id,
        request.connection_id,
        request.item_ids,
    )?;
    lease
        .items
        .iter()
        .map(|item| hydrate_claimed_one(connection, item, &lease, api, sink, mapping_policy))
        .collect()
}

fn hydrate_claimed_one<A, S, P>(
    connection: &Connection,
    item: &GmailInboxItemDto,
    lease: &InboxLeaseDto,
    api: &A,
    sink: &S,
    mapping_policy: &P,
) -> Result<GmailHydrationOutcome, GmailHydrationError>
where
    A: GmailHydrationApi,
    S: ImmutableGmailSink,
    P: GmailMappingPolicy,
{
    match hydrate_raw(item, api, sink, mapping_policy) {
        Ok((object, needs_mapping)) => {
            let ready = gmail_store::mark_inbox_ready(
                connection,
                &item.household_id,
                &item.id,
                &lease.lease_token,
                &object.sha256,
                needs_mapping,
            )?;
            Ok(GmailHydrationOutcome {
                item_id: item.id.clone(),
                state: ready.state,
                content_sha256: ready.content_sha256,
                error_code: None,
            })
        }
        Err(code) => {
            let failed = gmail_store::fail_inbox(
                connection,
                &item.household_id,
                &item.id,
                &lease.lease_token,
                code,
            )?;
            Ok(GmailHydrationOutcome {
                item_id: item.id.clone(),
                state: failed.state,
                content_sha256: failed.content_sha256,
                error_code: failed.last_error_code,
            })
        }
    }
}

fn hydrate_raw<A, S, P>(
    item: &GmailInboxItemDto,
    api: &A,
    sink: &S,
    mapping_policy: &P,
) -> Result<(ImmutableGmailObject, bool), &'static str>
where
    A: GmailHydrationApi,
    S: ImmutableGmailSink,
    P: GmailMappingPolicy,
{
    let raw = api
        .raw_message(&item.provider_message_id, MAX_RAW_MESSAGE_BYTES)
        .map_err(api_error_code)?;
    validate_remote_identity(item, &raw)?;
    if raw.bytes.is_empty() || raw.bytes.len() > MAX_RAW_MESSAGE_BYTES {
        return Err("REMOTE_INVALID_MESSAGE");
    }
    let expected_sha = format!("{:x}", Sha256::digest(&raw.bytes));
    let object = sink
        .put_raw_eml(&raw.bytes)
        .map_err(|_| "IMMUTABLE_STORAGE_FAILED")?;
    if object.sha256 != expected_sha
        || object.byte_size != raw.bytes.len() as u64
        || object.media_type != "message/rfc822"
    {
        return Err("IMMUTABLE_STORAGE_MISMATCH");
    }
    let needs_mapping = mapping_policy.needs_mapping(&item.file_name, &raw.bytes);
    Ok((object, needs_mapping))
}

fn validate_remote_identity(
    item: &GmailInboxItemDto,
    raw: &GmailRawMessage,
) -> Result<(), &'static str> {
    if raw.id != item.provider_message_id
        || Some(raw.thread_id.as_str()) != item.thread_id.as_deref()
        || raw.internal_date_ms != item.internal_date_ms
        || Some(raw.size_estimate) != item.estimated_byte_size
    {
        Err("REMOTE_MESSAGE_CHANGED")
    } else {
        Ok(())
    }
}

fn api_error_code(error: GmailApiError) -> &'static str {
    match error {
        GmailApiError::ReauthorizationRequired => "AUTH_EXPIRED",
        GmailApiError::Forbidden => "REMOTE_FORBIDDEN",
        GmailApiError::NotFound => "REMOTE_NOT_FOUND",
        GmailApiError::HistoryCursorExpired => "REMOTE_HISTORY_EXPIRED",
        GmailApiError::RateLimited => "REMOTE_RATE_LIMITED",
        GmailApiError::Retryable => "REMOTE_UNAVAILABLE",
        GmailApiError::Network => "REMOTE_NETWORK_FAILED",
        GmailApiError::InvalidResponse => "REMOTE_INVALID_RESPONSE",
        GmailApiError::InvalidInput => "HYDRATION_INVALID_INPUT",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        gmail_store::{MessageDisposition, RemoteMessage},
        persistence::AppState,
    };
    use std::sync::Mutex;

    struct FakeApi(Mutex<Option<Result<GmailRawMessage, GmailApiError>>>);
    impl GmailHydrationApi for FakeApi {
        fn raw_message(
            &self,
            _message_id: &str,
            _max_decoded_bytes: usize,
        ) -> Result<GmailRawMessage, GmailApiError> {
            self.0.lock().unwrap().take().unwrap()
        }
    }

    fn raw(bytes: &[u8]) -> GmailRawMessage {
        GmailRawMessage {
            id: "message-1".into(),
            thread_id: "thread-1".into(),
            history_id: 101,
            internal_date_ms: 1_784_064_000_000,
            size_estimate: 512,
            bytes: bytes.to_vec(),
        }
    }

    fn setup() -> (AppState, GmailInboxItemDto) {
        let state = AppState::in_memory(&[17_u8; 32]).unwrap();
        let item = state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])?;
                gmail_store::begin_connection(connection, "home", "gmail", &"a".repeat(64))
                    .unwrap();
                gmail_store::mark_authorized(
                    connection,
                    "home",
                    "gmail",
                    "account",
                    "home@example.com",
                    "99",
                )
                .unwrap();
                gmail_store::bind_label(
                    connection,
                    "home",
                    "gmail",
                    "has:attachment",
                    "Label_42",
                    "KakeFlow Inbox",
                    "100",
                )
                .unwrap();
                gmail_store::configure_schedule(connection, "home", "gmail", true, 30).unwrap();
                let sync = gmail_store::claim_due_sync(connection, "home", "gmail")
                    .unwrap()
                    .unwrap();
                let item = gmail_store::discover_messages_claimed(
                    connection,
                    &sync,
                    &[RemoteMessage {
                        provider_message_id: "message-1".into(),
                        thread_id: Some("thread-1".into()),
                        history_id: "101".into(),
                        internal_date_ms: 1_784_064_000_000,
                        estimated_byte_size: Some(512),
                        rfc822_message_id: None,
                        file_name: "gmail-message-1.eml".into(),
                        disposition: MessageDisposition::Reviewable,
                    }],
                )
                .unwrap()
                .remove(0);
                gmail_store::complete_sync(connection, &sync, "101", 1, true).unwrap();
                Ok(item)
            })
            .unwrap();
        (state, item)
    }

    #[test]
    fn exact_raw_message_is_content_addressed_and_retry_is_idempotent() {
        let bytes = b"From: bank@example.com\r\nContent-Type: text/plain\r\n\r\nstatement";
        let (state, item) = setup();
        let temp = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(temp.path(), &[29_u8; 32]).unwrap();
        let expected = format!("{:x}", Sha256::digest(bytes));
        state
            .with_connection(|connection| {
                let result = claim_and_hydrate(
                    connection,
                    GmailHydrationRequest {
                        household_id: "home",
                        connection_id: "gmail",
                        item_ids: std::slice::from_ref(&item.id),
                    },
                    &FakeApi(Mutex::new(Some(Ok(raw(bytes))))),
                    &vault,
                    &|_: &str, _: &[u8]| false,
                )
                .unwrap();
                assert_eq!(result[0].state, "READY");
                assert_eq!(result[0].content_sha256.as_deref(), Some(expected.as_str()));
                assert_eq!(vault.read(&expected).unwrap().bytes, bytes);
                let duplicate = vault.put(bytes, "message/rfc822").unwrap();
                assert!(duplicate.deduplicated);
                assert_eq!(duplicate.sha256, expected);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn remote_identity_or_vault_failure_never_becomes_ready() {
        let bytes = b"From: bank@example.com\r\n\r\nstatement";
        let (state, item) = setup();
        let temp = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(temp.path(), &[29_u8; 32]).unwrap();
        let mut changed = raw(bytes);
        changed.thread_id = "other-thread".into();
        state
            .with_connection(|connection| {
                let result = claim_and_hydrate(
                    connection,
                    GmailHydrationRequest {
                        household_id: "home",
                        connection_id: "gmail",
                        item_ids: std::slice::from_ref(&item.id),
                    },
                    &FakeApi(Mutex::new(Some(Ok(changed)))),
                    &vault,
                    &|_: &str, _: &[u8]| false,
                )
                .unwrap();
                assert_eq!(result[0].state, "FAILED");
                assert_eq!(
                    result[0].error_code.as_deref(),
                    Some("REMOTE_MESSAGE_CHANGED")
                );
                let retried = gmail_store::retry_inbox(connection, "home", &item.id).unwrap();
                assert_eq!(retried.state, "DISCOVERED");
                let recovered = claim_and_hydrate(
                    connection,
                    GmailHydrationRequest {
                        household_id: "home",
                        connection_id: "gmail",
                        item_ids: std::slice::from_ref(&item.id),
                    },
                    &FakeApi(Mutex::new(Some(Ok(raw(bytes))))),
                    &vault,
                    &|_: &str, _: &[u8]| false,
                )
                .unwrap();
                assert_eq!(recovered[0].state, "READY");
                Ok(())
            })
            .unwrap();
    }
}
