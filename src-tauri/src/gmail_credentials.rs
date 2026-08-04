//! OS credential storage for Gmail OAuth refresh tokens.
//!
//! Gmail credentials deliberately use a different account namespace and
//! payload envelope from Google Drive credentials. A stored refresh token is
//! valid only for the exact Gmail connection, household, OAuth client, and
//! read-only scope captured by its binding.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use thiserror::Error;
use zeroize::Zeroizing;

#[cfg(any(target_os = "macos", target_os = "windows"))]
const SERVICE: &str = "app.kakeflow.desktop";
const ACCOUNT_PREFIX: &str = "gmail-refresh-v1:";
const PAYLOAD_PREFIX: &[u8] = b"kakeflow-gmail-refresh-v1\0";
const VERSION: u32 = 1;
const MAX_ID: usize = 256;
const MAX_TOKEN: usize = 16_384;
pub const GMAIL_READONLY_SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";

#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum GmailCredentialError {
    #[error("the Gmail credential request is invalid")]
    InvalidInput,
    #[error("the Gmail credential entry could not be opened")]
    EntryUnavailable,
    #[error("the Gmail credential could not be read")]
    ReadFailed,
    #[error("the Gmail credential could not be written")]
    WriteFailed,
    #[error("the Gmail credential could not be deleted")]
    DeleteFailed,
    #[error("the stored Gmail credential has an invalid format")]
    InvalidStoredCredential,
    #[error("the stored Gmail credential belongs to a different connection")]
    BindingMismatch,
    #[error("Gmail credential access could not be synchronized")]
    SynchronizationFailed,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[error("operating-system credential storage is unsupported on this platform")]
    UnsupportedPlatform,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GmailCredentialBinding {
    pub connection_id: String,
    pub household_id: String,
    pub client_id_fingerprint: String,
    pub scope: String,
}

impl GmailCredentialBinding {
    pub fn new(
        connection_id: impl Into<String>,
        household_id: impl Into<String>,
        client_id_fingerprint: impl Into<String>,
    ) -> Result<Self, GmailCredentialError> {
        let binding = Self {
            connection_id: connection_id.into(),
            household_id: household_id.into(),
            client_id_fingerprint: client_id_fingerprint.into(),
            scope: GMAIL_READONLY_SCOPE.into(),
        };
        validate_binding(&binding)?;
        Ok(binding)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailCredentialDto {
    pub connection_id: String,
    pub household_id: String,
    pub client_id_fingerprint: String,
    pub scope: String,
    pub credential_version: u32,
}

pub struct GmailRefreshCredential {
    binding: GmailCredentialBinding,
    refresh_token: Zeroizing<String>,
}

impl std::fmt::Debug for GmailRefreshCredential {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GmailRefreshCredential")
            .field("binding", &self.binding)
            .field("refresh_token", &"[REDACTED]")
            .finish()
    }
}

impl GmailRefreshCredential {
    pub fn binding(&self) -> &GmailCredentialBinding {
        &self.binding
    }

    pub fn refresh_token(&self) -> &str {
        self.refresh_token.as_str()
    }

    pub fn dto(&self) -> GmailCredentialDto {
        dto(&self.binding)
    }
}

pub trait GmailCredentialBackend: Send + Sync {
    fn read(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, GmailCredentialError>;
    fn write(&self, account: &str, value: &[u8]) -> Result<(), GmailCredentialError>;
    fn delete(&self, account: &str) -> Result<(), GmailCredentialError>;
}

pub struct GmailCredentialStore {
    backend: Arc<dyn GmailCredentialBackend>,
    operation_lock: Mutex<()>,
}

impl GmailCredentialStore {
    pub fn new_os() -> Result<Self, GmailCredentialError> {
        Ok(Self::with_backend(Arc::new(OsCredentialBackend::new()?)))
    }

    pub fn new_ephemeral() -> Self {
        Self::with_backend(Arc::new(EphemeralCredentialBackend::default()))
    }

    pub fn with_backend(backend: Arc<dyn GmailCredentialBackend>) -> Self {
        Self {
            backend,
            operation_lock: Mutex::new(()),
        }
    }

    pub fn store(
        &self,
        binding: GmailCredentialBinding,
        refresh_token: Zeroizing<String>,
    ) -> Result<GmailCredentialDto, GmailCredentialError> {
        validate_binding(&binding)?;
        validate_token(&refresh_token)?;
        let account = credential_account(&binding.connection_id)?;
        let encoded = encode(&binding, &refresh_token)?;
        let _guard = self
            .operation_lock
            .lock()
            .map_err(|_| GmailCredentialError::SynchronizationFailed)?;
        self.backend.write(&account, &encoded)?;
        let persisted = self
            .backend
            .read(&account)?
            .ok_or(GmailCredentialError::WriteFailed)?;
        let decoded = decode(&persisted)?;
        if decoded.binding != binding || decoded.refresh_token.as_str() != refresh_token.as_str() {
            return Err(GmailCredentialError::WriteFailed);
        }
        Ok(dto(&binding))
    }

    pub fn read(
        &self,
        expected: &GmailCredentialBinding,
    ) -> Result<Option<GmailRefreshCredential>, GmailCredentialError> {
        validate_binding(expected)?;
        let Some(raw) = self
            .backend
            .read(&credential_account(&expected.connection_id)?)?
        else {
            return Ok(None);
        };
        let credential = decode(&raw)?;
        if credential.binding != *expected {
            return Err(GmailCredentialError::BindingMismatch);
        }
        Ok(Some(credential))
    }

    pub fn delete(&self, expected: &GmailCredentialBinding) -> Result<(), GmailCredentialError> {
        validate_binding(expected)?;
        let account = credential_account(&expected.connection_id)?;
        let _guard = self
            .operation_lock
            .lock()
            .map_err(|_| GmailCredentialError::SynchronizationFailed)?;
        if let Some(raw) = self.backend.read(&account)? {
            if decode(&raw)?.binding != *expected {
                return Err(GmailCredentialError::BindingMismatch);
            }
            self.backend.delete(&account)?;
        }
        Ok(())
    }
}

#[derive(Default)]
struct EphemeralCredentialBackend {
    entries: Mutex<BTreeMap<String, Zeroizing<Vec<u8>>>>,
}

impl GmailCredentialBackend for EphemeralCredentialBackend {
    fn read(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, GmailCredentialError> {
        Ok(self
            .entries
            .lock()
            .map_err(|_| GmailCredentialError::SynchronizationFailed)?
            .get(account)
            .map(|value| Zeroizing::new(value.as_slice().to_vec())))
    }

    fn write(&self, account: &str, value: &[u8]) -> Result<(), GmailCredentialError> {
        self.entries
            .lock()
            .map_err(|_| GmailCredentialError::SynchronizationFailed)?
            .insert(account.into(), Zeroizing::new(value.to_vec()));
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), GmailCredentialError> {
        self.entries
            .lock()
            .map_err(|_| GmailCredentialError::SynchronizationFailed)?
            .remove(account);
        Ok(())
    }
}

pub fn credential_account(connection_id: &str) -> Result<String, GmailCredentialError> {
    if !valid_id(connection_id) {
        return Err(GmailCredentialError::InvalidInput);
    }
    Ok(format!(
        "{ACCOUNT_PREFIX}{:x}",
        Sha256::digest(connection_id.as_bytes())
    ))
}

fn dto(binding: &GmailCredentialBinding) -> GmailCredentialDto {
    GmailCredentialDto {
        connection_id: binding.connection_id.clone(),
        household_id: binding.household_id.clone(),
        client_id_fingerprint: binding.client_id_fingerprint.clone(),
        scope: binding.scope.clone(),
        credential_version: VERSION,
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.len() <= MAX_ID
        && !value.chars().any(char::is_control)
}

fn canonical_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_binding(binding: &GmailCredentialBinding) -> Result<(), GmailCredentialError> {
    if !valid_id(&binding.connection_id)
        || !valid_id(&binding.household_id)
        || !canonical_hash(&binding.client_id_fingerprint)
        || binding.scope != GMAIL_READONLY_SCOPE
    {
        return Err(GmailCredentialError::InvalidInput);
    }
    Ok(())
}

fn validate_token(value: &str) -> Result<(), GmailCredentialError> {
    if value.is_empty()
        || value.len() > MAX_TOKEN
        || !value.is_ascii()
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err(GmailCredentialError::InvalidInput);
    }
    Ok(())
}

fn encode(
    binding: &GmailCredentialBinding,
    token: &str,
) -> Result<Zeroizing<Vec<u8>>, GmailCredentialError> {
    validate_binding(binding)?;
    validate_token(token)?;
    let fields = [
        binding.connection_id.as_bytes(),
        binding.household_id.as_bytes(),
        binding.client_id_fingerprint.as_bytes(),
        binding.scope.as_bytes(),
        token.as_bytes(),
    ];
    let mut encoded = Zeroizing::new(Vec::new());
    encoded.extend_from_slice(PAYLOAD_PREFIX);
    for field in fields {
        let length = u32::try_from(field.len()).map_err(|_| GmailCredentialError::InvalidInput)?;
        encoded.extend_from_slice(&length.to_be_bytes());
        encoded.extend_from_slice(field);
    }
    Ok(encoded)
}

fn decode(raw: &[u8]) -> Result<GmailRefreshCredential, GmailCredentialError> {
    if !raw.starts_with(PAYLOAD_PREFIX) {
        return Err(GmailCredentialError::InvalidStoredCredential);
    }
    let mut offset = PAYLOAD_PREFIX.len();
    let binding = GmailCredentialBinding {
        connection_id: field(raw, &mut offset, MAX_ID)?,
        household_id: field(raw, &mut offset, MAX_ID)?,
        client_id_fingerprint: field(raw, &mut offset, 64)?,
        scope: field(raw, &mut offset, GMAIL_READONLY_SCOPE.len())?,
    };
    let refresh_token = Zeroizing::new(field(raw, &mut offset, MAX_TOKEN)?);
    if offset != raw.len()
        || validate_binding(&binding).is_err()
        || validate_token(&refresh_token).is_err()
    {
        return Err(GmailCredentialError::InvalidStoredCredential);
    }
    Ok(GmailRefreshCredential {
        binding,
        refresh_token,
    })
}

fn field(raw: &[u8], offset: &mut usize, max: usize) -> Result<String, GmailCredentialError> {
    let length_end = offset
        .checked_add(4)
        .ok_or(GmailCredentialError::InvalidStoredCredential)?;
    let length_bytes: [u8; 4] = raw
        .get(*offset..length_end)
        .ok_or(GmailCredentialError::InvalidStoredCredential)?
        .try_into()
        .map_err(|_| GmailCredentialError::InvalidStoredCredential)?;
    let length = u32::from_be_bytes(length_bytes) as usize;
    if length == 0 || length > max {
        return Err(GmailCredentialError::InvalidStoredCredential);
    }
    let value_end = length_end
        .checked_add(length)
        .ok_or(GmailCredentialError::InvalidStoredCredential)?;
    let value = std::str::from_utf8(
        raw.get(length_end..value_end)
            .ok_or(GmailCredentialError::InvalidStoredCredential)?,
    )
    .map_err(|_| GmailCredentialError::InvalidStoredCredential)?
    .to_owned();
    *offset = value_end;
    Ok(value)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
struct OsCredentialBackend;

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl OsCredentialBackend {
    fn new() -> Result<Self, GmailCredentialError> {
        Ok(Self)
    }

    fn entry(account: &str) -> Result<keyring::Entry, GmailCredentialError> {
        keyring::Entry::new(SERVICE, account).map_err(|_| GmailCredentialError::EntryUnavailable)
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl GmailCredentialBackend for OsCredentialBackend {
    fn read(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, GmailCredentialError> {
        match Self::entry(account)?.get_secret() {
            Ok(value) => Ok(Some(Zeroizing::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(GmailCredentialError::ReadFailed),
        }
    }

    fn write(&self, account: &str, value: &[u8]) -> Result<(), GmailCredentialError> {
        Self::entry(account)?
            .set_secret(value)
            .map_err(|_| GmailCredentialError::WriteFailed)
    }

    fn delete(&self, account: &str) -> Result<(), GmailCredentialError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(GmailCredentialError::DeleteFailed),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
struct OsCredentialBackend;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl OsCredentialBackend {
    fn new() -> Result<Self, GmailCredentialError> {
        Err(GmailCredentialError::UnsupportedPlatform)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl GmailCredentialBackend for OsCredentialBackend {
    fn read(&self, _account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, GmailCredentialError> {
        Err(GmailCredentialError::UnsupportedPlatform)
    }

    fn write(&self, _account: &str, _value: &[u8]) -> Result<(), GmailCredentialError> {
        Err(GmailCredentialError::UnsupportedPlatform)
    }

    fn delete(&self, _account: &str) -> Result<(), GmailCredentialError> {
        Err(GmailCredentialError::UnsupportedPlatform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(connection: &str, household: &str) -> GmailCredentialBinding {
        GmailCredentialBinding::new(connection, household, "a".repeat(64)).unwrap()
    }

    #[test]
    fn ephemeral_store_reads_rotates_deletes_and_redacts() {
        let store = GmailCredentialStore::new_ephemeral();
        let expected = binding("gmail-a", "family-a");
        let secret = "1//gmail-refresh-token";
        let persisted = store
            .store(expected.clone(), Zeroizing::new(secret.into()))
            .unwrap();

        assert_eq!(persisted.credential_version, VERSION);
        assert_eq!(persisted.scope, GMAIL_READONLY_SCOPE);
        assert!(!serde_json::to_string(&persisted).unwrap().contains(secret));

        let loaded = store.read(&expected).unwrap().unwrap();
        assert_eq!(loaded.binding(), &expected);
        assert_eq!(loaded.refresh_token(), secret);
        assert_eq!(loaded.dto(), persisted);
        let debug = format!("{loaded:?}");
        assert!(debug.contains("[REDACTED]"));
        assert!(!debug.contains(secret));

        store
            .store(
                expected.clone(),
                Zeroizing::new("rotated-gmail-token".into()),
            )
            .unwrap();
        assert_eq!(
            store.read(&expected).unwrap().unwrap().refresh_token(),
            "rotated-gmail-token"
        );
        store.delete(&expected).unwrap();
        assert!(store.read(&expected).unwrap().is_none());
        store.delete(&expected).unwrap();
    }

    #[test]
    fn exact_household_client_and_scope_binding_is_required() {
        let store = GmailCredentialStore::new_ephemeral();
        let expected = binding("gmail", "family-a");
        store
            .store(expected.clone(), Zeroizing::new("refresh".into()))
            .unwrap();

        let wrong_household = binding("gmail", "family-b");
        assert_eq!(
            store.read(&wrong_household).unwrap_err(),
            GmailCredentialError::BindingMismatch
        );
        let wrong_client =
            GmailCredentialBinding::new("gmail", "family-a", "b".repeat(64)).unwrap();
        assert_eq!(
            store.delete(&wrong_client),
            Err(GmailCredentialError::BindingMismatch)
        );
        let mut wrong_scope = expected;
        wrong_scope.scope = "https://www.googleapis.com/auth/gmail.metadata".into();
        assert_eq!(
            store.read(&wrong_scope).unwrap_err(),
            GmailCredentialError::InvalidInput
        );
    }

    #[test]
    fn gmail_account_and_payload_namespaces_are_distinct_and_bounded() {
        let account = credential_account("private-gmail-connection").unwrap();
        assert!(account.starts_with(ACCOUNT_PREFIX));
        assert!(!account.contains("private-gmail-connection"));
        assert!(!account.starts_with("google-drive-refresh-v1:"));

        let expected = binding("gmail", "family");
        let valid = encode(&expected, "refresh").unwrap();
        assert!(valid.starts_with(PAYLOAD_PREFIX));
        assert!(!valid.starts_with(b"kakeflow-google-drive-refresh-v1\0"));
        assert_eq!(
            decode(&valid[..valid.len() - 1]).unwrap_err(),
            GmailCredentialError::InvalidStoredCredential
        );
        let mut trailing = valid.to_vec();
        trailing.push(0);
        assert_eq!(
            decode(&trailing).unwrap_err(),
            GmailCredentialError::InvalidStoredCredential
        );
        assert_eq!(
            decode(b"kakeflow-gmail-refresh-v2\0").unwrap_err(),
            GmailCredentialError::InvalidStoredCredential
        );

        for token in ["", "has space", "line\nbreak", "é"] {
            assert_eq!(
                GmailCredentialStore::new_ephemeral()
                    .store(expected.clone(), Zeroizing::new(token.into())),
                Err(GmailCredentialError::InvalidInput)
            );
        }
    }

    #[test]
    fn malformed_bindings_are_rejected_before_backend_access() {
        for (connection, household, fingerprint) in [
            ("", "family", "a".repeat(64)),
            (" gmail", "family", "a".repeat(64)),
            ("gmail", "", "a".repeat(64)),
            ("gmail", "family", "A".repeat(64)),
            ("gmail", "family", "a".repeat(63)),
        ] {
            assert_eq!(
                GmailCredentialBinding::new(connection, household, fingerprint).unwrap_err(),
                GmailCredentialError::InvalidInput
            );
        }
    }
}
