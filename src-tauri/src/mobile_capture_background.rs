//! Explicitly enabled, process-scoped intake of immutable mobile captures.
//! The worker downloads and validates capsules into Capture Inbox only. It
//! never invokes OCR, promotion, matching, classification, or ledger posting.

use crate::{
    document_vault::DocumentVault,
    family_delivery_credentials::FamilyDeliveryCredentialStore,
    family_delivery_scheduler::{credential_binding, load_connection_context},
    mobile_capture_capsule,
    mobile_capture_inbox::{self, IngestMobileCaptureInput},
    persistence::{AppState, PersistenceError},
};
use reqwest::{blocking::Client, StatusCode, Url};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    sync::{Arc, Condvar, Mutex},
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

const MAX_CAPSULE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PAGE_BYTES: u64 = 512 * 1024;
const WORKER_INTERVAL: Duration = Duration::from_secs(15);
const LEASE_MINUTES: u32 = 2;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MobileCaptureBackgroundStatusDto {
    pub household_id: String,
    pub enabled: bool,
    pub interval_minutes: u32,
    pub next_due_at: Option<String>,
    pub running: bool,
    pub lease_expires_at: Option<String>,
    pub last_attempt_at: Option<String>,
    pub last_success_at: Option<String>,
    pub last_result: String,
    pub last_ingested_count: u64,
    pub consecutive_failures: u32,
    pub suspended_until: Option<String>,
    pub suspension_reason: Option<String>,
    pub last_error_code: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct Lease {
    pub household_id: String,
    pub lease_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IntakeFailure {
    Terminal(&'static str),
    Retryable(&'static str),
    Cancelled,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteAudience {
    pub visibility: String,
    pub member_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteCapture {
    pub sequence: u64,
    pub capture_id: String,
    pub digest: String,
    pub household_id: String,
    pub origin_device_id: String,
    pub sender_membership_id: String,
    pub audience: RemoteAudience,
    pub byte_size: u64,
    pub created_at: String,
    pub capsule_schema: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemotePageWire {
    captures: Vec<RemoteCapture>,
    next_cursor: String,
}

#[derive(Debug, Clone)]
pub struct RemotePage {
    pub captures: Vec<RemoteCapture>,
    pub next_cursor: u64,
}

pub trait MobileCaptureTransport {
    fn list(
        &self,
        household_id: &str,
        after: u64,
        exclude_device: &str,
    ) -> Result<RemotePage, IntakeFailure>;
    fn download(&self, household_id: &str, capture_id: &str) -> Result<Vec<u8>, IntakeFailure>;
}

pub struct HttpMobileCaptureTransport {
    endpoint: Url,
    token: String,
    client: Client,
}

impl HttpMobileCaptureTransport {
    pub fn new(endpoint: &str, token: &str) -> Result<Self, IntakeFailure> {
        let endpoint =
            Url::parse(endpoint).map_err(|_| IntakeFailure::Retryable("INVALID_ENDPOINT"))?;
        let loopback = endpoint.scheme() == "http"
            && endpoint
                .host_str()
                .is_some_and(|host| matches!(host, "localhost" | "127.0.0.1" | "::1"));
        if endpoint.scheme() != "https" && !loopback {
            return Err(IntakeFailure::Retryable("INVALID_ENDPOINT"));
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| IntakeFailure::Retryable("NETWORK_RETRYABLE"))?;
        Ok(Self {
            endpoint,
            token: token.to_owned(),
            client,
        })
    }

    fn url(&self, household_id: &str, suffix: &str) -> Result<Url, IntakeFailure> {
        let mut url = self.endpoint.clone();
        url.set_path(&format!("/v2/households/{household_id}/captures{suffix}"));
        url.set_query(None);
        Ok(url)
    }

    fn map_status(status: StatusCode, download: bool) -> IntakeFailure {
        match status.as_u16() {
            401 => IntakeFailure::Terminal("AUTH_EXPIRED"),
            404 if !download => IntakeFailure::Terminal("MEMBERSHIP_REVOKED"),
            404 => IntakeFailure::Retryable("AUDIENCE_DENIED"),
            500..=599 => IntakeFailure::Retryable("NETWORK_RETRYABLE"),
            _ => IntakeFailure::Retryable("INVALID_RESPONSE"),
        }
    }
}

impl MobileCaptureTransport for HttpMobileCaptureTransport {
    fn list(
        &self,
        household_id: &str,
        after: u64,
        exclude_device: &str,
    ) -> Result<RemotePage, IntakeFailure> {
        let mut url = self.url(household_id, "")?;
        url.query_pairs_mut()
            .append_pair("after", &after.to_string())
            .append_pair("excludeOriginDeviceId", exclude_device);
        let response = self
            .client
            .get(url)
            .bearer_auth(&self.token)
            .send()
            .map_err(|_| IntakeFailure::Retryable("NETWORK_RETRYABLE"))?;
        if !response.status().is_success() {
            return Err(Self::map_status(response.status(), false));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_PAGE_BYTES)
        {
            return Err(IntakeFailure::Retryable("INVALID_RESPONSE"));
        }
        let mut body = Vec::new();
        response
            .take(MAX_PAGE_BYTES + 1)
            .read_to_end(&mut body)
            .map_err(|_| IntakeFailure::Retryable("NETWORK_RETRYABLE"))?;
        if body.len() as u64 > MAX_PAGE_BYTES {
            return Err(IntakeFailure::Retryable("INVALID_RESPONSE"));
        }
        let wire: RemotePageWire = serde_json::from_slice(&body)
            .map_err(|_| IntakeFailure::Retryable("INVALID_RESPONSE"))?;
        let next_cursor = wire
            .next_cursor
            .parse::<u64>()
            .map_err(|_| IntakeFailure::Retryable("INVALID_RESPONSE"))?;
        Ok(RemotePage {
            captures: wire.captures,
            next_cursor,
        })
    }

    fn download(&self, household_id: &str, capture_id: &str) -> Result<Vec<u8>, IntakeFailure> {
        let response = self
            .client
            .get(self.url(household_id, &format!("/{capture_id}"))?)
            .bearer_auth(&self.token)
            .header("Accept", "application/octet-stream")
            .send()
            .map_err(|_| IntakeFailure::Retryable("NETWORK_RETRYABLE"))?;
        if !response.status().is_success() {
            return Err(Self::map_status(response.status(), true));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_CAPSULE_BYTES)
        {
            return Err(IntakeFailure::Retryable("INVALID_CAPTURE"));
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_CAPSULE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| IntakeFailure::Retryable("NETWORK_RETRYABLE"))?;
        if bytes.is_empty() || bytes.len() as u64 > MAX_CAPSULE_BYTES {
            return Err(IntakeFailure::Retryable("INVALID_CAPTURE"));
        }
        Ok(bytes)
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn validate_remote(
    capture: &RemoteCapture,
    household_id: &str,
    cursor: u64,
) -> Result<(), IntakeFailure> {
    let audience_ok = (capture.audience.visibility == "SHARED"
        && capture.audience.member_id.is_none())
        || (capture.audience.visibility == "PERSONAL"
            && capture.audience.member_id.as_deref().is_some_and(valid_id));
    if capture.household_id != household_id
        || capture.sequence <= cursor
        || !valid_id(&capture.capture_id)
        || !valid_id(&capture.origin_device_id)
        || !valid_id(&capture.sender_membership_id)
        || !valid_hash(&capture.digest)
        || capture.byte_size == 0
        || capture.byte_size > MAX_CAPSULE_BYTES
        || capture.capsule_schema != "MOBILE_RECEIPT_CAPTURE_V1"
        || !audience_ok
        || capture
            .created_at
            .parse::<chrono_free::Timestamp>()
            .is_err()
    {
        return Err(IntakeFailure::Retryable("INVALID_RESPONSE"));
    }
    Ok(())
}

// Minimal RFC3339 shape validation without adding a date dependency.
mod chrono_free {
    pub struct Timestamp;
    impl std::str::FromStr for Timestamp {
        type Err = ();
        fn from_str(value: &str) -> Result<Self, Self::Err> {
            if value.len() >= 20
                && value.as_bytes().get(4) == Some(&b'-')
                && value.contains('T')
                && value.ends_with('Z')
            {
                Ok(Self)
            } else {
                Err(())
            }
        }
    }
}

pub fn process_with_transport<T: MobileCaptureTransport>(
    state: &AppState,
    vault: &DocumentVault,
    household_id: &str,
    lease_token: &str,
    transport: &T,
) -> Result<u64, IntakeFailure> {
    let status = state
        .with_connection(|connection| {
            assert_lease(connection, household_id, lease_token)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            mobile_capture_inbox::status(connection, household_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| IntakeFailure::Cancelled)?;
    let page = transport.list(
        household_id,
        status.capture_inbound_cursor,
        &status.local_device_id,
    )?;
    if page.captures.len() > 100 {
        return Err(IntakeFailure::Retryable("INVALID_RESPONSE"));
    }
    let mut cursor = status.capture_inbound_cursor;
    let mut ingested = 0_u64;
    for capture in page.captures {
        validate_remote(&capture, household_id, cursor)?;
        heartbeat(state, household_id, lease_token)?;
        let bytes = transport.download(household_id, &capture.capture_id)?;
        if bytes.len() as u64 != capture.byte_size
            || mobile_capture_capsule::digest(&bytes) != capture.digest
        {
            return Err(IntakeFailure::Retryable("INVALID_CAPTURE"));
        }
        let input = IngestMobileCaptureInput {
            household_id: household_id.to_owned(),
            artifact_id: capture.capture_id,
            claimed_digest: capture.digest,
            origin_device_id: capture.origin_device_id,
            sender_membership_id: capture.sender_membership_id,
            audience_visibility: capture.audience.visibility,
            audience_member_id: capture.audience.member_id,
            capsule_bytes: bytes,
        };
        state
            .with_connection(|connection| {
                assert_lease(connection, household_id, lease_token)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                mobile_capture_inbox::ingest_with_cursor(
                    connection,
                    vault,
                    &input,
                    capture.sequence,
                )
                .map(|_| ())
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
            })
            .map_err(|_| IntakeFailure::Retryable("LOCAL_INGEST_FAILED"))?;
        cursor = capture.sequence;
        ingested += 1;
    }
    if page.next_cursor < cursor {
        return Err(IntakeFailure::Retryable("INVALID_RESPONSE"));
    }
    if page.next_cursor > cursor {
        state
            .with_connection(|connection| {
                assert_lease(connection, household_id, lease_token)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                mobile_capture_inbox::update_cursor(connection, household_id, page.next_cursor)
                    .map(|_| ())
                    .map_err(|_| rusqlite::Error::InvalidQuery.into())
            })
            .map_err(|_| IntakeFailure::Retryable("LOCAL_INGEST_FAILED"))?;
    }
    Ok(ingested)
}

fn heartbeat(state: &AppState, household_id: &str, lease_token: &str) -> Result<(), IntakeFailure> {
    state
        .with_connection(|c| {
            heartbeat_lease(c, household_id, lease_token)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| IntakeFailure::Cancelled)
}

pub fn configure(
    connection: &Connection,
    household_id: &str,
    enabled: bool,
    interval: u32,
) -> rusqlite::Result<MobileCaptureBackgroundStatusDto> {
    if !valid_id(household_id) || !matches!(interval, 15 | 30 | 60) {
        return Err(rusqlite::Error::InvalidQuery);
    }
    connection.execute("INSERT INTO mobile_capture_schedules(household_id,enabled,interval_minutes,next_due_at,last_result) SELECT household_id,?2,?3,CASE WHEN ?2=1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') END,CASE WHEN ?2=1 THEN 'NEVER' ELSE 'DISABLED' END FROM family_delivery_connections WHERE household_id=?1 AND state!='DISCONNECTED' ON CONFLICT(household_id) DO UPDATE SET enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,next_due_at=excluded.next_due_at,lease_token=NULL,lease_expires_at=NULL,last_result=excluded.last_result,last_ingested_count=0,consecutive_failures=0,suspended_until=NULL,suspension_reason=NULL,last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",params![household_id,enabled,interval])?;
    status(connection, household_id)
}
pub fn disable(
    connection: &Connection,
    household_id: &str,
) -> rusqlite::Result<MobileCaptureBackgroundStatusDto> {
    let changed=connection.execute("UPDATE mobile_capture_schedules SET enabled=0,next_due_at=NULL,lease_token=NULL,lease_expires_at=NULL,last_result='DISABLED',last_ingested_count=0,suspended_until=NULL,suspension_reason=NULL,last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1",[household_id])?;
    if changed != 1 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    status(connection, household_id)
}
pub fn request_now(
    connection: &Connection,
    household_id: &str,
) -> rusqlite::Result<MobileCaptureBackgroundStatusDto> {
    let changed=connection.execute("UPDATE mobile_capture_schedules SET next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),suspended_until=NULL,suspension_reason=NULL WHERE household_id=?1 AND enabled=1 AND (suspension_reason IS NULL OR suspension_reason='RETRY_BACKOFF')",[household_id])?;
    if changed != 1 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    status(connection, household_id)
}
pub fn status(
    connection: &Connection,
    household_id: &str,
) -> rusqlite::Result<MobileCaptureBackgroundStatusDto> {
    recover_expired(connection, household_id)?;
    read_status(connection, household_id)
}

fn read_status(
    connection: &Connection,
    household_id: &str,
) -> rusqlite::Result<MobileCaptureBackgroundStatusDto> {
    connection.query_row("SELECT household_id,enabled,interval_minutes,next_due_at,lease_token IS NOT NULL,lease_expires_at,last_attempt_at,last_success_at,last_result,last_ingested_count,consecutive_failures,suspended_until,suspension_reason,last_error_code,updated_at FROM mobile_capture_schedules WHERE household_id=?1",[household_id],|r|Ok(MobileCaptureBackgroundStatusDto{household_id:r.get(0)?,enabled:r.get(1)?,interval_minutes:r.get(2)?,next_due_at:r.get(3)?,running:r.get(4)?,lease_expires_at:r.get(5)?,last_attempt_at:r.get(6)?,last_success_at:r.get(7)?,last_result:r.get(8)?,last_ingested_count:r.get::<_,i64>(9)?.max(0) as u64,consecutive_failures:r.get(10)?,suspended_until:r.get(11)?,suspension_reason:r.get(12)?,last_error_code:r.get(13)?,updated_at:r.get(14)?}))
}

fn recover_expired(connection: &Connection, household_id: &str) -> rusqlite::Result<()> {
    connection.execute("UPDATE mobile_capture_schedules SET lease_token=NULL,lease_expires_at=NULL,last_result='LEASE_EXPIRED',last_error_code='LEASE_EXPIRED',consecutive_failures=min(consecutive_failures+1,10),next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||interval_minutes||' minutes'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND enabled=1 AND lease_token IS NOT NULL AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')",[household_id])?;
    Ok(())
}
pub fn claim_due(connection: &Connection, household_id: &str) -> rusqlite::Result<Option<Lease>> {
    recover_expired(connection, household_id)?;
    let changed=connection.execute("UPDATE mobile_capture_schedules SET lease_token=lower(hex(randomblob(32))),lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?2),last_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_result='RUNNING',last_error_code=NULL WHERE household_id=?1 AND enabled=1 AND lease_token IS NULL AND next_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (suspension_reason IS NULL OR (suspension_reason='RETRY_BACKOFF' AND suspended_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))",params![household_id,format!("+{LEASE_MINUTES} minutes")])?;
    if changed == 0 {
        return Ok(None);
    };
    connection.query_row(
        "SELECT household_id,lease_token FROM mobile_capture_schedules WHERE household_id=?1",
        [household_id],
        |r| {
            Ok(Some(Lease {
                household_id: r.get(0)?,
                lease_token: r.get(1)?,
            }))
        },
    )
}
pub fn claim_next_due(connection: &Connection) -> rusqlite::Result<Option<Lease>> {
    let id:Option<String>=connection.query_row("SELECT household_id FROM mobile_capture_schedules WHERE enabled=1 AND lease_token IS NULL AND next_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (suspension_reason IS NULL OR (suspension_reason='RETRY_BACKOFF' AND suspended_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))) ORDER BY next_due_at,household_id LIMIT 1",[],|r|r.get(0)).optional()?;
    id.map(|id| claim_due(connection, &id))
        .transpose()
        .map(Option::flatten)
}
fn assert_lease(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
) -> rusqlite::Result<()> {
    let active:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM mobile_capture_schedules WHERE household_id=?1 AND enabled=1 AND lease_token=?2 AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",params![household_id,lease_token],|r|r.get(0))?;
    if active {
        Ok(())
    } else {
        Err(rusqlite::Error::InvalidQuery)
    }
}
fn heartbeat_lease(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
) -> rusqlite::Result<()> {
    let changed=connection.execute("UPDATE mobile_capture_schedules SET lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?3) WHERE household_id=?1 AND enabled=1 AND lease_token=?2 AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",params![household_id,lease_token,format!("+{LEASE_MINUTES} minutes")])?;
    if changed == 1 {
        Ok(())
    } else {
        Err(rusqlite::Error::InvalidQuery)
    }
}
fn finish(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
    result: Result<u64, IntakeFailure>,
) -> rusqlite::Result<MobileCaptureBackgroundStatusDto> {
    match result {
        Ok(count) => {
            let changed = connection.execute("UPDATE mobile_capture_schedules SET lease_token=NULL,lease_expires_at=NULL,last_success_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_result=CASE WHEN ?3=0 THEN 'NO_CHANGES' ELSE 'INGESTED' END,last_ingested_count=?3,consecutive_failures=0,suspended_until=NULL,suspension_reason=NULL,last_error_code=NULL,next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||interval_minutes||' minutes'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND enabled=1 AND lease_token=?2",params![household_id,lease_token,count])?;
            if changed != 1 {
                return Err(rusqlite::Error::InvalidQuery);
            }
        }
        Err(IntakeFailure::Terminal(code)) => {
            let changed = connection.execute("UPDATE mobile_capture_schedules SET lease_token=NULL,lease_expires_at=NULL,last_result='TERMINAL_SUSPENDED',last_ingested_count=0,suspension_reason=?3,suspended_until=NULL,last_error_code=?3,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND enabled=1 AND lease_token=?2",params![household_id,lease_token,code])?;
            if changed != 1 {
                return Err(rusqlite::Error::InvalidQuery);
            }
        }
        Err(IntakeFailure::Retryable(code)) => {
            finish_retryable(connection, household_id, lease_token, code)?;
        }
        Err(IntakeFailure::Cancelled) => {
            finish_retryable(connection, household_id, lease_token, "APP_SHUTDOWN")?;
        }
    }
    read_status(connection, household_id)
}

fn finish_retryable(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
    code: &str,
) -> rusqlite::Result<()> {
    let changed = connection.execute("UPDATE mobile_capture_schedules SET lease_token=NULL,lease_expires_at=NULL,last_result='FAILED_RETRYABLE',last_ingested_count=0,consecutive_failures=min(consecutive_failures+1,10),last_error_code=?3,next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||min(interval_minutes*(1<<min(consecutive_failures,4)),360)||' minutes'),suspended_until=CASE WHEN consecutive_failures>=4 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||min(interval_minutes*(1<<min(consecutive_failures,4)),360)||' minutes') END,suspension_reason=CASE WHEN consecutive_failures>=4 THEN 'RETRY_BACKOFF' END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND enabled=1 AND lease_token=?2",params![household_id,lease_token,code])?;
    if changed == 1 {
        Ok(())
    } else {
        Err(rusqlite::Error::InvalidQuery)
    }
}

pub fn run_claimed(
    state: &AppState,
    credentials: &FamilyDeliveryCredentialStore,
    vault: &DocumentVault,
    household_id: &str,
    lease_token: &str,
) -> Result<u64, IntakeFailure> {
    let context = load_connection_context(state, household_id)
        .map_err(|_| IntakeFailure::Retryable("CONNECTION_UNAVAILABLE"))?;
    let binding =
        credential_binding(&context).map_err(|_| IntakeFailure::Retryable("INVALID_CONNECTION"))?;
    let credential = credentials
        .read(&binding)
        .map_err(|_| IntakeFailure::Terminal("MISSING_CREDENTIAL"))?
        .ok_or(IntakeFailure::Terminal("MISSING_CREDENTIAL"))?;
    let transport = HttpMobileCaptureTransport::new(&context.endpoint, credential.bearer_token())?;
    process_with_transport(state, vault, household_id, lease_token, &transport)
}

#[derive(Default)]
struct StopSignal {
    stopped: Mutex<bool>,
    changed: Condvar,
}
impl StopSignal {
    fn wait(&self, d: Duration) -> bool {
        let Ok(s) = self.stopped.lock() else {
            return true;
        };
        if *s {
            return true;
        }
        self.changed.wait_timeout(s, d).map_or(true, |(s, _)| *s)
    }
    fn stop(&self) {
        if let Ok(mut s) = self.stopped.lock() {
            *s = true;
            self.changed.notify_all()
        }
    }
}
pub struct BackgroundMobileCaptureIntake {
    stop: Arc<StopSignal>,
    worker: Mutex<Option<JoinHandle<()>>>,
}
impl BackgroundMobileCaptureIntake {
    pub fn start(app: AppHandle) -> Self {
        let stop = Arc::new(StopSignal::default());
        let child = Arc::clone(&stop);
        let worker = thread::Builder::new()
            .name("kakeflow-mobile-capture-intake".into())
            .spawn(move || {
                while !child.wait(WORKER_INTERVAL) {
                    let state = app.state::<AppState>();
                    let lease = state
                        .with_connection(|c| claim_next_due(c).map_err(PersistenceError::from));
                    if let Ok(Some(lease)) = lease {
                        let result = run_claimed(
                            &state,
                            &app.state::<FamilyDeliveryCredentialStore>(),
                            &app.state::<DocumentVault>(),
                            &lease.household_id,
                            &lease.lease_token,
                        );
                        if let Ok(status) = state.with_connection(|c| {
                            finish(c, &lease.household_id, &lease.lease_token, result)
                                .map_err(PersistenceError::from)
                        }) {
                            let _ = app.emit("kakeflow://mobile-capture-intake", status);
                        }
                    }
                }
            })
            .ok();
        Self {
            stop,
            worker: Mutex::new(worker),
        }
    }
}
impl Drop for BackgroundMobileCaptureIntake {
    fn drop(&mut self) {
        self.stop.stop();
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}

pub fn process_now(
    state: &AppState,
    credentials: &FamilyDeliveryCredentialStore,
    vault: &DocumentVault,
    household_id: &str,
    lease_token: &str,
) -> Result<MobileCaptureBackgroundStatusDto, String> {
    let result = run_claimed(state, credentials, vault, household_id, lease_token);
    state
        .with_connection(|c| {
            finish(c, household_id, lease_token, result).map_err(PersistenceError::from)
        })
        .map_err(|_| "Mobile capture background intake could not finish".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        family_delivery_transport::{self, FamilyMembershipDto, SaveFamilyConnectionInput},
        mobile_capture_capsule::{build, digest, CaptureAudienceManifest, MobileCaptureManifest},
        read_model::{
            create_household, create_household_member, CreateHouseholdInput,
            CreateHouseholdMemberInput,
        },
    };
    use std::collections::HashMap;
    use tempfile::tempdir;

    struct FakeTransport {
        captures: Vec<RemoteCapture>,
        payloads: HashMap<String, Vec<u8>>,
        list_error: Option<IntakeFailure>,
        download_error_for: Option<String>,
    }

    impl MobileCaptureTransport for FakeTransport {
        fn list(
            &self,
            _household_id: &str,
            after: u64,
            _exclude_device: &str,
        ) -> Result<RemotePage, IntakeFailure> {
            if let Some(error) = self.list_error.clone() {
                return Err(error);
            }
            let captures = self
                .captures
                .iter()
                .filter(|capture| capture.sequence > after)
                .cloned()
                .collect::<Vec<_>>();
            let next_cursor = captures.last().map_or(after, |capture| capture.sequence);
            Ok(RemotePage {
                captures,
                next_cursor,
            })
        }

        fn download(
            &self,
            _household_id: &str,
            capture_id: &str,
        ) -> Result<Vec<u8>, IntakeFailure> {
            if self.download_error_for.as_deref() == Some(capture_id) {
                return Err(IntakeFailure::Retryable("NETWORK_RETRYABLE"));
            }
            self.payloads
                .get(capture_id)
                .cloned()
                .ok_or(IntakeFailure::Retryable("INVALID_RESPONSE"))
        }
    }

    fn capsule(capture_id: &str) -> Vec<u8> {
        let mut image = vec![
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, b'I', b'H', b'D', b'R',
        ];
        image.extend_from_slice(&1u32.to_be_bytes());
        image.extend_from_slice(&1u32.to_be_bytes());
        image.extend_from_slice(&[8, 2, 0, 0, 0]);
        build(
            &MobileCaptureManifest {
                format: "KAKEFLOW_MOBILE_RECEIPT_CAPTURE".into(),
                schema_version: 1,
                capture_id: capture_id.into(),
                household_id: "family".into(),
                origin_device_id: "mobile-1".into(),
                captured_at: "2026-07-14T00:00:00Z".into(),
                original_filename: format!("{capture_id}.png"),
                media_type: "image/png".into(),
                image_byte_size: image.len() as u64,
                image_sha256: digest(&image),
                audience: CaptureAudienceManifest {
                    visibility: "SHARED".into(),
                    member_id: None,
                },
            },
            &image,
        )
        .unwrap()
    }

    fn remote(sequence: u64, capture_id: &str, bytes: &[u8]) -> RemoteCapture {
        RemoteCapture {
            sequence,
            capture_id: capture_id.into(),
            digest: digest(bytes),
            household_id: "family".into(),
            origin_device_id: "mobile-1".into(),
            sender_membership_id: "membership-1".into(),
            audience: RemoteAudience {
                visibility: "SHARED".into(),
                member_id: None,
            },
            byte_size: bytes.len() as u64,
            created_at: "2026-07-14T00:00:00Z".into(),
            capsule_schema: "MOBILE_RECEIPT_CAPTURE_V1".into(),
        }
    }

    fn setup() -> (AppState, DocumentVault, tempfile::TempDir) {
        let state = AppState::in_memory(&[42; 32]).unwrap();
        state
            .with_connection(|connection| {
                create_household(
                    connection,
                    &CreateHouseholdInput {
                        id: "family".into(),
                        name: "Family".into(),
                    },
                )
                .unwrap();
                create_household_member(
                    connection,
                    &CreateHouseholdMemberInput {
                        id: "member-a".into(),
                        household_id: "family".into(),
                        display_name: "A".into(),
                        relationship_label: None,
                    },
                )
                .unwrap();
                family_delivery_transport::save_connection(
                    connection,
                    &SaveFamilyConnectionInput {
                        household_id: "family".into(),
                        endpoint: "https://relay.example".into(),
                        remote_principal_id: "principal-a".into(),
                        local_member_id: Some("member-a".into()),
                        local_member_name: Some("A".into()),
                        memberships: vec![FamilyMembershipDto {
                            member_id: "member-a".into(),
                            member_name: "A".into(),
                            state: "ACTIVE".into(),
                            remote_membership_ids: vec!["membership-1".into()],
                            invite_id: None,
                            invite_expires_at: None,
                            device_count: 1,
                            last_delivery_at: None,
                        }],
                    },
                )
                .unwrap();
                configure(connection, "family", true, 15)?;
                Ok(())
            })
            .unwrap();
        let temp = tempdir().unwrap();
        let vault = DocumentVault::new(temp.path(), &[9; 32]).unwrap();
        (state, vault, temp)
    }

    fn claim(state: &AppState) -> Lease {
        let lease = state
            .with_connection(|connection| {
                claim_due(connection, "family").map_err(PersistenceError::from)
            })
            .unwrap()
            .unwrap();
        state
            .with_connection(|connection| {
                assert_lease(connection, "family", &lease.lease_token)
                    .expect("claimed lease must remain active");
                mobile_capture_inbox::status(connection, "family")
                    .expect("mobile capture status must load");
                Ok(())
            })
            .unwrap();
        lease
    }

    #[test]
    fn intake_stores_only_immutable_inbox_evidence_and_advances_cursor() {
        let (state, vault, _) = setup();
        let bytes = capsule("capture-1");
        let transport = FakeTransport {
            captures: vec![remote(1, "capture-1", &bytes)],
            payloads: HashMap::from([("capture-1".into(), bytes)]),
            list_error: None,
            download_error_for: None,
        };
        let lease = claim(&state);
        assert_eq!(
            process_with_transport(&state, &vault, "family", &lease.lease_token, &transport),
            Ok(1)
        );
        let finished = state
            .with_connection(|connection| {
                finish(connection, "family", &lease.lease_token, Ok(1))
                    .map_err(PersistenceError::from)
            })
            .unwrap();
        assert_eq!(finished.last_result, "INGESTED");
        state
            .with_connection(|connection| {
                assert_eq!(
                    connection.query_row(
                        "SELECT capture_inbound_cursor FROM family_delivery_connections WHERE household_id='family'",
                        [],
                        |row| row.get::<_, u64>(0),
                    )?,
                    1
                );
                for table in ["source_documents", "import_runs", "transactions"] {
                    assert_eq!(
                        connection.query_row(
                            &format!("SELECT count(*) FROM {table}"),
                            [],
                            |row| row.get::<_, u64>(0),
                        )?,
                        0
                    );
                }
                assert_eq!(
                    connection.query_row(
                        "SELECT state FROM mobile_capture_inbox WHERE artifact_id='capture-1'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "RECEIVED"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn retry_resumes_after_last_atomic_success_without_duplicate() {
        let (state, vault, _) = setup();
        let first = capsule("capture-1");
        let second = capsule("capture-2");
        let captures = vec![
            remote(1, "capture-1", &first),
            remote(2, "capture-2", &second),
        ];
        let payloads = HashMap::from([("capture-1".into(), first), ("capture-2".into(), second)]);
        let lease = claim(&state);
        let failing = FakeTransport {
            captures: captures.clone(),
            payloads: payloads.clone(),
            list_error: None,
            download_error_for: Some("capture-2".into()),
        };
        assert_eq!(
            process_with_transport(&state, &vault, "family", &lease.lease_token, &failing),
            Err(IntakeFailure::Retryable("NETWORK_RETRYABLE"))
        );
        state
            .with_connection(|connection| {
                finish(
                    connection,
                    "family",
                    &lease.lease_token,
                    Err(IntakeFailure::Retryable("NETWORK_RETRYABLE")),
                )
                .map_err(PersistenceError::from)
            })
            .unwrap();
        state
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE mobile_capture_schedules SET next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id='family'",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let retry_lease = claim(&state);
        let healthy = FakeTransport {
            captures,
            payloads,
            list_error: None,
            download_error_for: None,
        };
        assert_eq!(
            process_with_transport(&state, &vault, "family", &retry_lease.lease_token, &healthy,),
            Ok(1)
        );
        state
            .with_connection(|connection| {
                assert_eq!(
                    connection.query_row("SELECT count(*) FROM mobile_capture_inbox", [], |row| row.get::<_, u64>(0))?,
                    2
                );
                assert_eq!(
                    connection.query_row("SELECT capture_inbound_cursor FROM family_delivery_connections WHERE household_id='family'", [], |row| row.get::<_, u64>(0))?,
                    2
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn authentication_failure_terminally_suspends_schedule() {
        let (state, vault, _) = setup();
        let transport = FakeTransport {
            captures: vec![],
            payloads: HashMap::new(),
            list_error: Some(IntakeFailure::Terminal("AUTH_EXPIRED")),
            download_error_for: None,
        };
        let lease = claim(&state);
        let result =
            process_with_transport(&state, &vault, "family", &lease.lease_token, &transport);
        assert_eq!(result, Err(IntakeFailure::Terminal("AUTH_EXPIRED")));
        let status = state
            .with_connection(|connection| {
                finish(connection, "family", &lease.lease_token, result)
                    .map_err(PersistenceError::from)
            })
            .unwrap();
        assert_eq!(status.last_result, "TERMINAL_SUSPENDED");
        assert_eq!(status.suspension_reason.as_deref(), Some("AUTH_EXPIRED"));
        assert!(state
            .with_connection(
                |connection| claim_due(connection, "family").map_err(PersistenceError::from)
            )
            .unwrap()
            .is_none());
    }

    #[test]
    fn digest_mismatch_never_publishes_or_advances_cursor() {
        let (state, vault, _) = setup();
        let bytes = capsule("capture-1");
        let mut descriptor = remote(1, "capture-1", &bytes);
        descriptor.digest = "0".repeat(64);
        let transport = FakeTransport {
            captures: vec![descriptor],
            payloads: HashMap::from([("capture-1".into(), bytes)]),
            list_error: None,
            download_error_for: None,
        };
        let lease = claim(&state);
        assert_eq!(
            process_with_transport(&state, &vault, "family", &lease.lease_token, &transport),
            Err(IntakeFailure::Retryable("INVALID_CAPTURE"))
        );
        state
            .with_connection(|connection| {
                assert_eq!(
                    connection.query_row("SELECT count(*) FROM mobile_capture_inbox", [], |row| row.get::<_, u64>(0))?,
                    0
                );
                assert_eq!(
                    connection.query_row("SELECT capture_inbound_cursor FROM family_delivery_connections WHERE household_id='family'", [], |row| row.get::<_, u64>(0))?,
                    0
                );
                Ok(())
            })
            .unwrap();
    }
}
