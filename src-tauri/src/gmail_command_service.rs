//! Redacted command-boundary contracts for the direct Gmail connector.
//!
//! The durable store necessarily retains provider identifiers, OAuth-client
//! fingerprints, and history cursors. None of those values belong in desktop
//! WebView responses. This module is intentionally pure: it validates command
//! input and projects store records without opening SQLite or performing I/O.

use crate::gmail_store::{GmailConnectionDto, GmailInboxItemDto, InboxLeaseDto, SyncScheduleDto};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_CONNECTION_ID_BYTES: usize = 128;
const MAX_LABEL_ID_BYTES: usize = 256;
const MAX_LABEL_NAME_BYTES: usize = 255;
const MAX_QUERY_BYTES: usize = 1_024;
const REQUIRED_ATTACHMENT_QUERY: &str = "has:attachment";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GmailAuthorizationMode {
    SystemBrowserLoopback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GmailScopeProfile {
    GmailReadonly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GmailUnavailableReason {
    ClientIdNotCompiled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailAvailabilityDto {
    pub available: bool,
    pub authorization_mode: GmailAuthorizationMode,
    pub scope_profile: GmailScopeProfile,
    pub unavailable_reason: Option<GmailUnavailableReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactedGmailConnectionDto {
    pub id: String,
    pub status: String,
    pub account_email: Option<String>,
    pub label_id: Option<String>,
    pub label_name: Option<String>,
    pub gmail_query: String,
    pub label_bound: bool,
    pub last_full_scan_at: Option<String>,
    pub last_change_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GmailLabelKindDto {
    System,
    User,
}

/// The immutable provider label id is intentionally exposed because it is the
/// value a user selects and the command must bind. Account ids and sync cursors
/// remain excluded from every label response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailLabelDto {
    pub id: String,
    pub name: String,
    pub kind: GmailLabelKindDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactedGmailScheduleDto {
    pub connection_id: String,
    pub enabled: bool,
    pub interval_minutes: u32,
    pub next_due_at: Option<String>,
    pub running: bool,
    pub last_result: String,
    pub last_discovered_count: u64,
    pub consecutive_failures: u8,
    pub suspended_until: Option<String>,
    pub suspension_reason: Option<String>,
    pub last_error_code: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactedGmailInboxItemDto {
    pub id: String,
    pub household_id: String,
    pub connection_id: String,
    pub file_name: String,
    pub media_type: String,
    pub internal_date_ms: u64,
    pub estimated_byte_size: Option<u64>,
    pub content_ready: bool,
    pub state: String,
    pub attempt_count: u8,
    pub import_run_id: Option<String>,
    pub last_error_code: Option<String>,
    pub discovered_at: String,
    pub updated_at: String,
}

/// Inbox claims are explicit short-lived capabilities used by the existing
/// review workflow. The token is returned, while provider message ids, thread
/// ids, fingerprints, history ids, RFC Message-IDs, and content hashes are not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactedGmailInboxLeaseDto {
    pub lease_token: String,
    pub lease_expires_at: String,
    pub items: Vec<RedactedGmailInboxItemDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GmailBindInput {
    pub connection_id: String,
    pub label_id: String,
    pub label_name: String,
    pub gmail_query: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedGmailBindInput {
    pub connection_id: String,
    pub label_id: String,
    pub label_name: String,
    pub gmail_query: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum GmailCommandServiceError {
    #[error("the Gmail connection id is invalid")]
    InvalidConnectionId,
    #[error("the Gmail label id is invalid")]
    InvalidLabelId,
    #[error("the Gmail label name is invalid")]
    InvalidLabelName,
    #[error("the Gmail query is invalid")]
    InvalidQuery,
    #[error("the Gmail query must retain the attachment-only boundary")]
    AttachmentQueryRequired,
}

pub fn availability(oauth_client_configured: bool) -> GmailAvailabilityDto {
    GmailAvailabilityDto {
        available: oauth_client_configured,
        authorization_mode: GmailAuthorizationMode::SystemBrowserLoopback,
        scope_profile: GmailScopeProfile::GmailReadonly,
        unavailable_reason: (!oauth_client_configured)
            .then_some(GmailUnavailableReason::ClientIdNotCompiled),
    }
}

pub fn project_connection(connection: GmailConnectionDto) -> RedactedGmailConnectionDto {
    let label_bound = connection.label_id.is_some();
    RedactedGmailConnectionDto {
        id: connection.id,
        status: connection.status,
        account_email: connection.account_email,
        label_id: connection.label_id,
        label_name: connection.label_name,
        gmail_query: connection.gmail_query,
        label_bound,
        last_full_scan_at: connection.last_full_scan_at,
        last_change_at: connection.last_change_at,
        created_at: connection.created_at,
        updated_at: connection.updated_at,
    }
}

pub fn project_label(
    id: impl Into<String>,
    name: impl Into<String>,
    kind: GmailLabelKindDto,
) -> Result<GmailLabelDto, GmailCommandServiceError> {
    let id = id.into();
    let name = name.into();
    validate_label_id(&id)?;
    validate_label_name(&name)?;
    Ok(GmailLabelDto { id, name, kind })
}

pub fn project_schedule(schedule: SyncScheduleDto) -> RedactedGmailScheduleDto {
    RedactedGmailScheduleDto {
        connection_id: schedule.connection_id,
        enabled: schedule.enabled,
        interval_minutes: schedule.interval_minutes,
        next_due_at: schedule.next_due_at,
        running: schedule.running,
        last_result: schedule.last_result,
        last_discovered_count: schedule.last_discovered_count,
        consecutive_failures: schedule.consecutive_failures,
        suspended_until: schedule.suspended_until,
        suspension_reason: schedule.suspension_reason,
        last_error_code: schedule.last_error_code,
        updated_at: schedule.updated_at,
    }
}

pub fn project_inbox_item(item: GmailInboxItemDto) -> RedactedGmailInboxItemDto {
    RedactedGmailInboxItemDto {
        id: item.id,
        household_id: item.household_id,
        connection_id: item.connection_id,
        file_name: item.file_name,
        media_type: "message/rfc822".into(),
        internal_date_ms: item.internal_date_ms,
        estimated_byte_size: item.estimated_byte_size,
        content_ready: item.content_sha256.is_some(),
        state: item.state,
        attempt_count: item.attempt_count,
        import_run_id: item.import_run_id,
        last_error_code: item.last_error_code,
        discovered_at: item.discovered_at,
        updated_at: item.updated_at,
    }
}

pub fn project_inbox_items(items: Vec<GmailInboxItemDto>) -> Vec<RedactedGmailInboxItemDto> {
    items.into_iter().map(project_inbox_item).collect()
}

pub fn project_inbox_lease(lease: InboxLeaseDto) -> RedactedGmailInboxLeaseDto {
    RedactedGmailInboxLeaseDto {
        lease_token: lease.lease_token,
        lease_expires_at: lease.lease_expires_at,
        items: project_inbox_items(lease.items),
    }
}

pub fn validate_bind_input(
    input: GmailBindInput,
) -> Result<ValidatedGmailBindInput, GmailCommandServiceError> {
    validate_text(
        &input.connection_id,
        MAX_CONNECTION_ID_BYTES,
        GmailCommandServiceError::InvalidConnectionId,
    )?;
    validate_label_id(&input.label_id)?;
    validate_label_name(&input.label_name)?;
    validate_text(
        &input.gmail_query,
        MAX_QUERY_BYTES,
        GmailCommandServiceError::InvalidQuery,
    )?;
    if !input
        .gmail_query
        .split_ascii_whitespace()
        .any(|term| term.eq_ignore_ascii_case(REQUIRED_ATTACHMENT_QUERY))
    {
        return Err(GmailCommandServiceError::AttachmentQueryRequired);
    }
    Ok(ValidatedGmailBindInput {
        connection_id: input.connection_id,
        label_id: input.label_id,
        label_name: input.label_name,
        gmail_query: input.gmail_query,
    })
}

fn validate_label_id(value: &str) -> Result<(), GmailCommandServiceError> {
    validate_text(
        value,
        MAX_LABEL_ID_BYTES,
        GmailCommandServiceError::InvalidLabelId,
    )?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_graphic() && !matches!(byte, b'/' | b'?' | b'#'))
    {
        return Err(GmailCommandServiceError::InvalidLabelId);
    }
    Ok(())
}

fn validate_label_name(value: &str) -> Result<(), GmailCommandServiceError> {
    validate_text(
        value,
        MAX_LABEL_NAME_BYTES,
        GmailCommandServiceError::InvalidLabelName,
    )
}

fn validate_text(
    value: &str,
    max_bytes: usize,
    error: GmailCommandServiceError,
) -> Result<(), GmailCommandServiceError> {
    if value.is_empty()
        || value.trim() != value
        || value.len() > max_bytes
        || value.chars().any(char::is_control)
    {
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACCOUNT_ID: &str = "provider-account-secret";
    const CLIENT_FINGERPRINT: &str =
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const START_CURSOR: &str = "100000001";
    const CURRENT_CURSOR: &str = "100000099";
    const PROVIDER_MESSAGE_ID: &str = "provider-message-secret";
    const THREAD_ID: &str = "thread-secret";
    const GENERATION: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const CONTENT_HASH: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const RFC822_ID: &str = "<private-message-id@example.com>";

    fn connection() -> GmailConnectionDto {
        GmailConnectionDto {
            id: "gmail-a".into(),
            household_id: "family-secret".into(),
            google_account_id: Some(ACCOUNT_ID.into()),
            account_email: Some("home@example.com".into()),
            client_id_fingerprint: CLIENT_FINGERPRINT.into(),
            gmail_query: "has:attachment newer_than:90d".into(),
            label_id: Some("Label_123".into()),
            label_name: Some("KakeFlow".into()),
            status: "CONNECTED".into(),
            start_history_id: Some(START_CURSOR.into()),
            history_id: Some(CURRENT_CURSOR.into()),
            last_full_scan_at: Some("2026-07-15T00:00:00Z".into()),
            last_change_at: Some("2026-07-15T00:01:00Z".into()),
            created_at: "2026-07-15T00:00:00Z".into(),
            updated_at: "2026-07-15T00:01:00Z".into(),
        }
    }

    fn inbox_item() -> GmailInboxItemDto {
        GmailInboxItemDto {
            id: "d".repeat(64),
            household_id: "family".into(),
            connection_id: "gmail-a".into(),
            provider_message_id: PROVIDER_MESSAGE_ID.into(),
            generation_fingerprint: GENERATION.into(),
            thread_id: Some(THREAD_ID.into()),
            message_history_id: CURRENT_CURSOR.into(),
            internal_date_ms: 1_752_537_600_000,
            estimated_byte_size: Some(42_000),
            rfc822_message_id: Some(RFC822_ID.into()),
            file_name: "statement.eml".into(),
            content_sha256: Some(CONTENT_HASH.into()),
            state: "READY".into(),
            attempt_count: 1,
            import_run_id: None,
            last_error_code: None,
            discovered_at: "2026-07-15T00:00:00Z".into(),
            updated_at: "2026-07-15T00:01:00Z".into(),
        }
    }

    fn assert_provider_metadata_redacted(json: &str) {
        for forbidden in [
            ACCOUNT_ID,
            CLIENT_FINGERPRINT,
            START_CURSOR,
            CURRENT_CURSOR,
            PROVIDER_MESSAGE_ID,
            THREAD_ID,
            GENERATION,
            CONTENT_HASH,
            RFC822_ID,
        ] {
            assert!(!json.contains(forbidden), "serialized {forbidden}");
        }
        for forbidden_field in [
            "googleAccountId",
            "clientIdFingerprint",
            "startHistoryId",
            "historyId",
            "providerMessageId",
            "threadId",
            "generationFingerprint",
            "contentSha256",
            "rfc822MessageId",
            "leaseExpiresAt",
        ] {
            assert!(
                !json.contains(forbidden_field),
                "serialized {forbidden_field}"
            );
        }
    }

    #[test]
    fn availability_is_explicit_and_never_serializes_configuration() {
        assert_eq!(
            availability(false),
            GmailAvailabilityDto {
                available: false,
                authorization_mode: GmailAuthorizationMode::SystemBrowserLoopback,
                scope_profile: GmailScopeProfile::GmailReadonly,
                unavailable_reason: Some(GmailUnavailableReason::ClientIdNotCompiled),
            }
        );
        assert_eq!(
            serde_json::to_string(&availability(true)).unwrap(),
            r#"{"available":true,"authorizationMode":"SYSTEM_BROWSER_LOOPBACK","scopeProfile":"GMAIL_READONLY","unavailableReason":null}"#
        );
    }

    #[test]
    fn connection_projection_allows_email_label_and_query_but_no_provider_identity_or_cursor() {
        let projected = project_connection(connection());
        assert_eq!(projected.account_email.as_deref(), Some("home@example.com"));
        assert_eq!(projected.label_id.as_deref(), Some("Label_123"));
        assert_eq!(projected.label_name.as_deref(), Some("KakeFlow"));
        assert!(projected.label_bound);
        assert_provider_metadata_redacted(&serde_json::to_string(&projected).unwrap());

        for status in [
            "AUTHORIZING",
            "SELECTING_LABEL",
            "CONNECTED",
            "AUTH_REQUIRED",
            "DISCONNECTED",
        ] {
            let mut source = connection();
            source.status = status.into();
            assert_eq!(project_connection(source).status, status);
        }
    }

    #[test]
    fn schedule_and_inbox_projections_remove_worker_and_provider_metadata() {
        let schedule = project_schedule(SyncScheduleDto {
            connection_id: "gmail-a".into(),
            enabled: true,
            interval_minutes: 30,
            next_due_at: Some("2026-07-15T00:30:00Z".into()),
            running: true,
            lease_expires_at: Some("2026-07-15T00:02:00Z".into()),
            last_attempt_at: Some("2026-07-15T00:00:00Z".into()),
            last_success_at: Some("2026-07-14T00:00:00Z".into()),
            last_result: "RUNNING".into(),
            last_discovered_count: 2,
            consecutive_failures: 0,
            suspended_until: None,
            suspension_reason: None,
            last_error_code: None,
            updated_at: "2026-07-15T00:00:00Z".into(),
        });
        let item = project_inbox_item(inbox_item());
        assert!(item.content_ready);
        assert_eq!(item.media_type, "message/rfc822");
        let json = serde_json::to_string(&(schedule, item)).unwrap();
        assert_provider_metadata_redacted(&json);
        assert!(!json.contains("lastAttemptAt"));
        assert!(!json.contains("lastSuccessAt"));
    }

    #[test]
    fn inbox_claim_retains_only_the_required_capability_and_redacted_items() {
        let projected = project_inbox_lease(InboxLeaseDto {
            lease_token: "e".repeat(64),
            lease_expires_at: "2026-07-15T00:05:00Z".into(),
            items: vec![inbox_item()],
        });
        assert_eq!(projected.lease_token, "e".repeat(64));
        assert_eq!(projected.items.len(), 1);
        let json = serde_json::to_string(&projected).unwrap();
        for forbidden in [
            PROVIDER_MESSAGE_ID,
            THREAD_ID,
            GENERATION,
            CONTENT_HASH,
            RFC822_ID,
            CURRENT_CURSOR,
        ] {
            assert!(!json.contains(forbidden));
        }
    }

    #[test]
    fn label_projection_validates_provider_id_and_display_name() {
        assert_eq!(
            project_label("Label_123", "家計簿", GmailLabelKindDto::User).unwrap(),
            GmailLabelDto {
                id: "Label_123".into(),
                name: "家計簿".into(),
                kind: GmailLabelKindDto::User,
            }
        );
        assert_eq!(
            project_label("INBOX", "受信トレイ", GmailLabelKindDto::System)
                .unwrap()
                .kind,
            GmailLabelKindDto::System
        );
        for id in ["", " Label_1", "Label/1", "Label?1", "Label#1"] {
            assert_eq!(
                project_label(id, "valid", GmailLabelKindDto::User).unwrap_err(),
                GmailCommandServiceError::InvalidLabelId
            );
        }
    }

    #[test]
    fn bind_input_is_exact_bounded_and_attachment_only() {
        let input = GmailBindInput {
            connection_id: "gmail-a".into(),
            label_id: "Label_123".into(),
            label_name: "家計簿".into(),
            gmail_query: "has:attachment newer_than:90d".into(),
        };
        let validated = validate_bind_input(input.clone()).unwrap();
        assert_eq!(validated.connection_id, input.connection_id);
        assert_eq!(validated.gmail_query, input.gmail_query);

        let invalid = |gmail_query: String| GmailBindInput {
            gmail_query,
            ..input.clone()
        };
        assert_eq!(
            validate_bind_input(invalid("newer_than:90d".into())).unwrap_err(),
            GmailCommandServiceError::AttachmentQueryRequired
        );
        assert_eq!(
            validate_bind_input(invalid(format!(
                "has:attachment {}",
                "x".repeat(MAX_QUERY_BYTES)
            )))
            .unwrap_err(),
            GmailCommandServiceError::InvalidQuery
        );
        for query in [
            " has:attachment",
            "has:attachment ",
            "has:attachment\nfrom:bank",
        ] {
            assert_eq!(
                validate_bind_input(invalid(query.into())).unwrap_err(),
                GmailCommandServiceError::InvalidQuery
            );
        }
    }

    #[test]
    fn bind_input_rejects_overlong_or_unsafe_identity_fields() {
        let valid = GmailBindInput {
            connection_id: "gmail-a".into(),
            label_id: "Label_123".into(),
            label_name: "KakeFlow".into(),
            gmail_query: "has:attachment".into(),
        };
        let cases = [
            GmailBindInput {
                connection_id: "x".repeat(MAX_CONNECTION_ID_BYTES + 1),
                ..valid.clone()
            },
            GmailBindInput {
                label_id: "Label/123".into(),
                ..valid.clone()
            },
            GmailBindInput {
                label_name: "x".repeat(MAX_LABEL_NAME_BYTES + 1),
                ..valid
            },
        ];
        assert_eq!(
            validate_bind_input(cases[0].clone()).unwrap_err(),
            GmailCommandServiceError::InvalidConnectionId
        );
        assert_eq!(
            validate_bind_input(cases[1].clone()).unwrap_err(),
            GmailCommandServiceError::InvalidLabelId
        );
        assert_eq!(
            validate_bind_input(cases[2].clone()).unwrap_err(),
            GmailCommandServiceError::InvalidLabelName
        );
    }
}
