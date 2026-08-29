use serde::Serialize;
use std::collections::BTreeSet;
use thiserror::Error;

const SCHEMA_VERSION: u8 = 1;
const MAX_CONNECTION_KEY_BYTES: usize = 128;
const MAX_DISPLAY_LABEL_BYTES: usize = 256;
const MAX_ERROR_CODE_BYTES: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectorKind {
    GoogleDrive,
    Gmail,
    WatchedFolder,
    ManualImport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectorCapability {
    Configure,
    Disconnect,
    RefreshNow,
    Schedule,
    Retry,
    ImportFile,
    AccountBinding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectorAvailability {
    Available,
    RuntimeUnsupported,
    ConfigMissing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectorLifecycle {
    Disconnected,
    Configuring,
    Connected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectorHealth {
    NeverRefreshed,
    Manual,
    Fresh,
    Stale,
    Running,
    RetryBackoff,
    NeedsAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectorPrimaryState {
    NeedsAction,
    Running,
    RetryBackoff,
    Stale,
    Fresh,
    Manual,
    NeverRefreshed,
    Disconnected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConfigurationDestination {
    GoogleDriveSettings,
    GmailSettings,
    WatchedFolderSettings,
    ImportInbox,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorBindingSummaryDto {
    pub allowed_account_count: u16,
    pub parser_profile_configured: bool,
    pub version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorSummaryDto {
    pub schema_version: u8,
    pub connector_kind: ConnectorKind,
    pub connection_key: String,
    pub display_label: String,
    pub availability: ConnectorAvailability,
    pub lifecycle: ConnectorLifecycle,
    pub health: ConnectorHealth,
    pub capabilities: Vec<ConnectorCapability>,
    pub last_attempt_at: Option<String>,
    pub last_success_at: Option<String>,
    pub freshness_deadline_at: Option<String>,
    pub next_due_at: Option<String>,
    pub pending_review_count: u64,
    pub consecutive_failures: u8,
    pub last_error_code: Option<String>,
    pub binding_summary: Option<ConnectorBindingSummaryDto>,
    pub configuration_destination: ConfigurationDestination,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectorDescriptor {
    pub connector_kind: ConnectorKind,
    pub display_key: &'static str,
    pub source_family: &'static str,
    pub supports_native: bool,
    pub supports_web: bool,
    pub capabilities: &'static [ConnectorCapability],
    pub persistent_connections: bool,
    pub configuration_destination: ConfigurationDestination,
}

const NATIVE_SYNC_CAPABILITIES: &[ConnectorCapability] = &[
    ConnectorCapability::Configure,
    ConnectorCapability::Disconnect,
    ConnectorCapability::RefreshNow,
    ConnectorCapability::Schedule,
    ConnectorCapability::Retry,
    ConnectorCapability::AccountBinding,
];
const MANUAL_IMPORT_CAPABILITIES: &[ConnectorCapability] = &[
    ConnectorCapability::ImportFile,
    ConnectorCapability::AccountBinding,
];
const DESCRIPTORS: &[ConnectorDescriptor] = &[
    ConnectorDescriptor {
        connector_kind: ConnectorKind::GoogleDrive,
        display_key: "connector.google_drive",
        source_family: "GOOGLE_DRIVE",
        supports_native: true,
        supports_web: false,
        capabilities: NATIVE_SYNC_CAPABILITIES,
        persistent_connections: true,
        configuration_destination: ConfigurationDestination::GoogleDriveSettings,
    },
    ConnectorDescriptor {
        connector_kind: ConnectorKind::Gmail,
        display_key: "connector.gmail",
        source_family: "GMAIL",
        supports_native: true,
        supports_web: false,
        capabilities: NATIVE_SYNC_CAPABILITIES,
        persistent_connections: true,
        configuration_destination: ConfigurationDestination::GmailSettings,
    },
    ConnectorDescriptor {
        connector_kind: ConnectorKind::WatchedFolder,
        display_key: "connector.watched_folder",
        source_family: "WATCHED_FOLDER",
        supports_native: true,
        supports_web: false,
        capabilities: NATIVE_SYNC_CAPABILITIES,
        persistent_connections: true,
        configuration_destination: ConfigurationDestination::WatchedFolderSettings,
    },
    ConnectorDescriptor {
        connector_kind: ConnectorKind::ManualImport,
        display_key: "connector.manual_import",
        source_family: "MANUAL_IMPORT",
        supports_native: true,
        supports_web: true,
        capabilities: MANUAL_IMPORT_CAPABILITIES,
        persistent_connections: false,
        configuration_destination: ConfigurationDestination::ImportInbox,
    },
];

#[derive(Debug, Default, Clone, Copy)]
pub struct ConnectorRegistry;

impl ConnectorRegistry {
    pub fn descriptors(&self) -> &'static [ConnectorDescriptor] {
        DESCRIPTORS
    }

    pub fn descriptor(
        &self,
        connector_kind: ConnectorKind,
    ) -> Option<&'static ConnectorDescriptor> {
        DESCRIPTORS
            .iter()
            .find(|descriptor| descriptor.connector_kind == connector_kind)
    }

    pub fn validate(&self) -> Result<(), ConnectorContractError> {
        let mut kinds = BTreeSet::new();
        for descriptor in DESCRIPTORS {
            if !kinds.insert(descriptor.connector_kind)
                || descriptor.display_key.is_empty()
                || descriptor.source_family.is_empty()
                || (!descriptor.supports_native && !descriptor.supports_web)
                || !unique_capabilities(descriptor.capabilities)
            {
                return Err(ConnectorContractError::InvalidDescriptor);
            }
            if descriptor.connector_kind == ConnectorKind::ManualImport {
                if descriptor.persistent_connections
                    || !descriptor.supports_web
                    || !descriptor
                        .capabilities
                        .contains(&ConnectorCapability::ImportFile)
                    || descriptor
                        .capabilities
                        .contains(&ConnectorCapability::RefreshNow)
                {
                    return Err(ConnectorContractError::InvalidDescriptor);
                }
            } else if !descriptor.persistent_connections || !descriptor.supports_native {
                return Err(ConnectorContractError::InvalidDescriptor);
            }
        }
        if kinds.len() == DESCRIPTORS.len() {
            Ok(())
        } else {
            Err(ConnectorContractError::InvalidDescriptor)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ConnectorContractError {
    #[error("connector schema version is unsupported")]
    UnsupportedSchemaVersion,
    #[error("connector connection key is invalid")]
    InvalidConnectionKey,
    #[error("connector display label is invalid")]
    InvalidDisplayLabel,
    #[error("connector error code is invalid")]
    InvalidErrorCode,
    #[error("connector timestamp is invalid")]
    InvalidTimestamp,
    #[error("connector state combination is impossible")]
    ImpossibleState,
    #[error("connector capabilities are inconsistent with runtime")]
    InconsistentCapabilities,
    #[error("connector descriptor is invalid")]
    InvalidDescriptor,
}

impl ConnectorSummaryDto {
    pub fn validate(&self) -> Result<(), ConnectorContractError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(ConnectorContractError::UnsupportedSchemaVersion);
        }
        validate_identifier(&self.connection_key, MAX_CONNECTION_KEY_BYTES)
            .then_some(())
            .ok_or(ConnectorContractError::InvalidConnectionKey)?;
        validate_label(&self.display_label)
            .then_some(())
            .ok_or(ConnectorContractError::InvalidDisplayLabel)?;
        if self
            .last_error_code
            .as_deref()
            .is_some_and(|code| !validate_identifier(code, MAX_ERROR_CODE_BYTES))
        {
            return Err(ConnectorContractError::InvalidErrorCode);
        }
        for timestamp in [
            self.last_attempt_at.as_deref(),
            self.last_success_at.as_deref(),
            self.freshness_deadline_at.as_deref(),
            self.next_due_at.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if !is_rfc3339_utc(timestamp) {
                return Err(ConnectorContractError::InvalidTimestamp);
            }
        }

        let descriptor = ConnectorRegistry
            .descriptor(self.connector_kind)
            .ok_or(ConnectorContractError::InvalidDescriptor)?;
        if descriptor.configuration_destination != self.configuration_destination
            || !unique_capabilities(&self.capabilities)
            || !self
                .capabilities
                .iter()
                .all(|capability| descriptor.capabilities.contains(capability))
            || (self.availability == ConnectorAvailability::RuntimeUnsupported
                && !self.capabilities.is_empty())
            || (self.lifecycle != ConnectorLifecycle::Connected
                && self.capabilities.iter().any(|capability| {
                    matches!(
                        capability,
                        ConnectorCapability::RefreshNow
                            | ConnectorCapability::Schedule
                            | ConnectorCapability::Retry
                    )
                }))
            || (self.health == ConnectorHealth::Running
                && !self.capabilities.contains(&ConnectorCapability::RefreshNow))
            || (self.health == ConnectorHealth::RetryBackoff
                && !self.capabilities.contains(&ConnectorCapability::Retry))
        {
            return Err(ConnectorContractError::InconsistentCapabilities);
        }
        if !valid_state(self.connector_kind, self.lifecycle, self.health) {
            return Err(ConnectorContractError::ImpossibleState);
        }
        Ok(())
    }
}

pub fn primary_state(
    lifecycle: ConnectorLifecycle,
    health: ConnectorHealth,
) -> ConnectorPrimaryState {
    if lifecycle == ConnectorLifecycle::Disconnected {
        return ConnectorPrimaryState::Disconnected;
    }
    match health {
        ConnectorHealth::NeedsAction => ConnectorPrimaryState::NeedsAction,
        ConnectorHealth::Running => ConnectorPrimaryState::Running,
        ConnectorHealth::RetryBackoff => ConnectorPrimaryState::RetryBackoff,
        ConnectorHealth::Stale => ConnectorPrimaryState::Stale,
        ConnectorHealth::Fresh => ConnectorPrimaryState::Fresh,
        ConnectorHealth::Manual => ConnectorPrimaryState::Manual,
        ConnectorHealth::NeverRefreshed => ConnectorPrimaryState::NeverRefreshed,
    }
}

fn valid_state(
    connector_kind: ConnectorKind,
    lifecycle: ConnectorLifecycle,
    health: ConnectorHealth,
) -> bool {
    match lifecycle {
        ConnectorLifecycle::Disconnected | ConnectorLifecycle::Configuring => {
            health == ConnectorHealth::NeverRefreshed
        }
        ConnectorLifecycle::Connected if connector_kind == ConnectorKind::ManualImport => {
            health == ConnectorHealth::Manual
        }
        ConnectorLifecycle::Connected => health != ConnectorHealth::Manual,
    }
}

fn validate_identifier(value: &str, max_bytes: usize) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.len() <= max_bytes
        && value
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'/')
}

fn validate_label(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.len() <= MAX_DISPLAY_LABEL_BYTES
        && !value.chars().any(char::is_control)
}

fn unique_capabilities(capabilities: &[ConnectorCapability]) -> bool {
    capabilities.iter().copied().collect::<BTreeSet<_>>().len() == capabilities.len()
}

fn is_rfc3339_utc(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.last() != Some(&b'Z')
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
        || ![0..4, 5..7, 8..10, 11..13, 14..16, 17..19]
            .into_iter()
            .flatten()
            .all(|index| bytes[index].is_ascii_digit())
    {
        return false;
    }
    let fraction = &bytes[19..bytes.len() - 1];
    if !fraction.is_empty()
        && (fraction[0] != b'.'
            || fraction.len() == 1
            || !fraction[1..].iter().all(u8::is_ascii_digit))
    {
        return false;
    }
    let year = number(&bytes[0..4]);
    let month = number(&bytes[5..7]);
    let day = number(&bytes[8..10]);
    let hour = number(&bytes[11..13]);
    let minute = number(&bytes[14..16]);
    let second = number(&bytes[17..19]);
    year > 0
        && (1..=12).contains(&month)
        && (1..=days_in_month(year, month)).contains(&day)
        && hour <= 23
        && minute <= 59
        && second <= 59
}

fn number(bytes: &[u8]) -> u32 {
    bytes
        .iter()
        .fold(0, |value, byte| value * 10 + u32::from(byte - b'0'))
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary() -> ConnectorSummaryDto {
        ConnectorSummaryDto {
            schema_version: 1,
            connector_kind: ConnectorKind::Gmail,
            connection_key: "gmail-connection".into(),
            display_label: "Bank mail".into(),
            availability: ConnectorAvailability::Available,
            lifecycle: ConnectorLifecycle::Connected,
            health: ConnectorHealth::Fresh,
            capabilities: vec![
                ConnectorCapability::Configure,
                ConnectorCapability::Disconnect,
                ConnectorCapability::RefreshNow,
                ConnectorCapability::Schedule,
                ConnectorCapability::Retry,
                ConnectorCapability::AccountBinding,
            ],
            last_attempt_at: Some("2026-08-25T00:00:00Z".into()),
            last_success_at: Some("2026-08-25T00:00:01Z".into()),
            freshness_deadline_at: Some("2026-08-25T00:30:00Z".into()),
            next_due_at: Some("2026-08-25T00:30:00Z".into()),
            pending_review_count: 2,
            consecutive_failures: 0,
            last_error_code: None,
            binding_summary: None,
            configuration_destination: ConfigurationDestination::GmailSettings,
        }
    }

    #[test]
    fn registry_has_the_four_unique_descriptors_in_display_order() {
        let registry = ConnectorRegistry;
        let kinds = registry
            .descriptors()
            .iter()
            .map(|descriptor| descriptor.connector_kind)
            .collect::<Vec<_>>();

        assert_eq!(
            kinds,
            vec![
                ConnectorKind::GoogleDrive,
                ConnectorKind::Gmail,
                ConnectorKind::WatchedFolder,
                ConnectorKind::ManualImport,
            ]
        );
        assert_eq!(kinds.len(), 4);
        assert!(registry.validate().is_ok());
    }

    #[test]
    fn primary_state_uses_the_documented_action_precedence() {
        let cases = [
            (
                ConnectorHealth::NeedsAction,
                ConnectorPrimaryState::NeedsAction,
            ),
            (ConnectorHealth::Running, ConnectorPrimaryState::Running),
            (
                ConnectorHealth::RetryBackoff,
                ConnectorPrimaryState::RetryBackoff,
            ),
            (ConnectorHealth::Stale, ConnectorPrimaryState::Stale),
            (ConnectorHealth::Fresh, ConnectorPrimaryState::Fresh),
            (ConnectorHealth::Manual, ConnectorPrimaryState::Manual),
            (
                ConnectorHealth::NeverRefreshed,
                ConnectorPrimaryState::NeverRefreshed,
            ),
        ];

        for (health, expected) in cases {
            assert_eq!(
                primary_state(ConnectorLifecycle::Connected, health),
                expected
            );
        }
        assert_eq!(
            primary_state(
                ConnectorLifecycle::Disconnected,
                ConnectorHealth::NeverRefreshed,
            ),
            ConnectorPrimaryState::Disconnected
        );
    }

    #[test]
    fn summary_rejects_overlong_keys_labels_invalid_timestamps_and_impossible_states() {
        let mut at_limits = summary();
        at_limits.connection_key = "x".repeat(128);
        at_limits.display_label = "x".repeat(256);
        assert!(at_limits.validate().is_ok());

        let mut value = summary();
        value.connection_key = "x".repeat(129);
        assert_eq!(
            value.validate().unwrap_err(),
            ConnectorContractError::InvalidConnectionKey
        );

        let mut value = summary();
        value.display_label = "x".repeat(257);
        assert_eq!(
            value.validate().unwrap_err(),
            ConnectorContractError::InvalidDisplayLabel
        );

        let mut value = summary();
        value.last_success_at = Some("2026-08-25T00:00:01+00:00".into());
        assert_eq!(
            value.validate().unwrap_err(),
            ConnectorContractError::InvalidTimestamp
        );

        let mut value = summary();
        value.last_success_at = Some("2026-08-25T12:34:60Z".into());
        assert_eq!(
            value.validate().unwrap_err(),
            ConnectorContractError::InvalidTimestamp
        );

        let mut value = summary();
        value.lifecycle = ConnectorLifecycle::Disconnected;
        value.capabilities = vec![ConnectorCapability::Configure];
        assert_eq!(
            value.validate().unwrap_err(),
            ConnectorContractError::ImpossibleState
        );

        let mut value = summary();
        value.connector_kind = ConnectorKind::Gmail;
        value.health = ConnectorHealth::Manual;
        assert_eq!(
            value.validate().unwrap_err(),
            ConnectorContractError::ImpossibleState
        );
    }

    #[test]
    fn summary_requires_runtime_consistent_capabilities() {
        let mut value = summary();
        value.availability = ConnectorAvailability::RuntimeUnsupported;
        assert_eq!(
            value.validate().unwrap_err(),
            ConnectorContractError::InconsistentCapabilities
        );

        let registry = ConnectorRegistry;
        let manual = registry.descriptor(ConnectorKind::ManualImport).unwrap();
        assert!(manual.supports_web);
        assert!(manual
            .capabilities
            .contains(&ConnectorCapability::ImportFile));
        assert!(!manual
            .capabilities
            .contains(&ConnectorCapability::RefreshNow));
        assert!(
            !registry
                .descriptor(ConnectorKind::Gmail)
                .unwrap()
                .supports_web
        );
    }

    #[test]
    fn disconnected_or_configuring_sources_cannot_execute_connected_only_operations() {
        for lifecycle in [
            ConnectorLifecycle::Disconnected,
            ConnectorLifecycle::Configuring,
        ] {
            for capability in [
                ConnectorCapability::RefreshNow,
                ConnectorCapability::Schedule,
                ConnectorCapability::Retry,
            ] {
                let mut value = summary();
                value.lifecycle = lifecycle;
                value.health = ConnectorHealth::NeverRefreshed;
                value.capabilities = vec![ConnectorCapability::Configure, capability];
                assert_eq!(
                    value.validate().unwrap_err(),
                    ConnectorContractError::InconsistentCapabilities
                );
            }
        }
    }

    #[test]
    fn summary_serialization_is_redacted_by_construction() {
        struct SourceProjection {
            connection_key: String,
            display_label: String,
            refresh_token: String,
            page_token: String,
            absolute_path: String,
            label_id: String,
            provider_response: String,
        }

        let source = SourceProjection {
            connection_key: "gmail-connection".into(),
            display_label: "Bank mail".into(),
            refresh_token: "refresh-token-secret".into(),
            page_token: "page-token-secret".into(),
            absolute_path: "/Users/private".into(),
            label_id: "Label_123".into(),
            provider_response: r#"{\"provider\":\"raw-response\"}"#.into(),
        };
        let value = ConnectorSummaryDto {
            connection_key: source.connection_key.clone(),
            display_label: source.display_label.clone(),
            ..summary()
        };

        let json = serde_json::to_string(&value).unwrap();
        assert!(json.contains(&source.connection_key));
        assert!(json.contains(&source.display_label));
        for forbidden in [
            source.refresh_token,
            source.page_token,
            source.absolute_path,
            source.label_id,
            source.provider_response,
        ] {
            assert!(!json.contains(&forbidden));
        }
    }
}
