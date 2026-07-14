//! OS credential storage for Google Drive OAuth refresh tokens.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use thiserror::Error;
use zeroize::Zeroizing;

const SERVICE: &str = "app.kakeflow.desktop";
const ACCOUNT_PREFIX: &str = "google-drive-refresh-v1:";
const PAYLOAD_PREFIX: &[u8] = b"kakeflow-google-drive-refresh-v1\0";
const VERSION: u32 = 1;
const MAX_ID: usize = 256;
const MAX_TOKEN: usize = 16_384;
pub const GOOGLE_DRIVE_READONLY_SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";

#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum GoogleDriveCredentialError {
    #[error("the Google Drive credential request is invalid")]
    InvalidInput,
    #[error("the Google Drive credential entry could not be opened")]
    EntryUnavailable,
    #[error("the Google Drive credential could not be read")]
    ReadFailed,
    #[error("the Google Drive credential could not be written")]
    WriteFailed,
    #[error("the Google Drive credential could not be deleted")]
    DeleteFailed,
    #[error("the stored Google Drive credential has an invalid format")]
    InvalidStoredCredential,
    #[error("the stored Google Drive credential belongs to a different connection")]
    BindingMismatch,
    #[error("Google Drive credential access could not be synchronized")]
    SynchronizationFailed,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[error("operating-system credential storage is unsupported on this platform")]
    UnsupportedPlatform,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GoogleDriveCredentialBinding {
    pub connection_id: String,
    pub household_id: String,
    pub client_id_fingerprint: String,
    pub scope: String,
}

impl GoogleDriveCredentialBinding {
    pub fn new(
        connection_id: impl Into<String>,
        household_id: impl Into<String>,
        client_id_fingerprint: impl Into<String>,
    ) -> Result<Self, GoogleDriveCredentialError> {
        let value = Self {
            connection_id: connection_id.into(),
            household_id: household_id.into(),
            client_id_fingerprint: client_id_fingerprint.into(),
            scope: GOOGLE_DRIVE_READONLY_SCOPE.into(),
        };
        validate_binding(&value)?;
        Ok(value)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveCredentialDto {
    pub connection_id: String,
    pub household_id: String,
    pub client_id_fingerprint: String,
    pub scope: String,
    pub credential_version: u32,
}

pub struct GoogleDriveRefreshCredential {
    binding: GoogleDriveCredentialBinding,
    refresh_token: Zeroizing<String>,
}

impl std::fmt::Debug for GoogleDriveRefreshCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GoogleDriveRefreshCredential")
            .field("binding", &self.binding)
            .field("refresh_token", &"[REDACTED]")
            .finish()
    }
}

impl GoogleDriveRefreshCredential {
    pub fn binding(&self) -> &GoogleDriveCredentialBinding {
        &self.binding
    }
    pub fn refresh_token(&self) -> &str {
        self.refresh_token.as_str()
    }
    pub fn dto(&self) -> GoogleDriveCredentialDto {
        dto(&self.binding)
    }
}

pub trait GoogleDriveCredentialBackend: Send + Sync {
    fn read(&self, account: &str)
        -> Result<Option<Zeroizing<Vec<u8>>>, GoogleDriveCredentialError>;
    fn write(&self, account: &str, value: &[u8]) -> Result<(), GoogleDriveCredentialError>;
    fn delete(&self, account: &str) -> Result<(), GoogleDriveCredentialError>;
}

pub struct GoogleDriveCredentialStore {
    backend: Arc<dyn GoogleDriveCredentialBackend>,
    operation_lock: Mutex<()>,
}

impl GoogleDriveCredentialStore {
    pub fn new_os() -> Result<Self, GoogleDriveCredentialError> {
        Ok(Self::with_backend(Arc::new(OsCredentialBackend::new()?)))
    }
    pub fn new_ephemeral() -> Self {
        Self::with_backend(Arc::new(EphemeralCredentialBackend::default()))
    }
    pub fn with_backend(backend: Arc<dyn GoogleDriveCredentialBackend>) -> Self {
        Self {
            backend,
            operation_lock: Mutex::new(()),
        }
    }
    pub fn store(
        &self,
        binding: GoogleDriveCredentialBinding,
        refresh_token: Zeroizing<String>,
    ) -> Result<GoogleDriveCredentialDto, GoogleDriveCredentialError> {
        validate_binding(&binding)?;
        validate_token(&refresh_token)?;
        let account = credential_account(&binding.connection_id)?;
        let encoded = encode(&binding, &refresh_token)?;
        let _guard = self
            .operation_lock
            .lock()
            .map_err(|_| GoogleDriveCredentialError::SynchronizationFailed)?;
        self.backend.write(&account, &encoded)?;
        let persisted = self
            .backend
            .read(&account)?
            .ok_or(GoogleDriveCredentialError::WriteFailed)?;
        let decoded = decode(&persisted)?;
        if decoded.binding != binding || decoded.refresh_token.as_str() != refresh_token.as_str() {
            return Err(GoogleDriveCredentialError::WriteFailed);
        }
        Ok(dto(&binding))
    }
    pub fn read(
        &self,
        expected: &GoogleDriveCredentialBinding,
    ) -> Result<Option<GoogleDriveRefreshCredential>, GoogleDriveCredentialError> {
        validate_binding(expected)?;
        let Some(raw) = self
            .backend
            .read(&credential_account(&expected.connection_id)?)?
        else {
            return Ok(None);
        };
        let credential = decode(&raw)?;
        if credential.binding != *expected {
            return Err(GoogleDriveCredentialError::BindingMismatch);
        }
        Ok(Some(credential))
    }
    pub fn delete(
        &self,
        expected: &GoogleDriveCredentialBinding,
    ) -> Result<(), GoogleDriveCredentialError> {
        validate_binding(expected)?;
        let account = credential_account(&expected.connection_id)?;
        let _guard = self
            .operation_lock
            .lock()
            .map_err(|_| GoogleDriveCredentialError::SynchronizationFailed)?;
        if let Some(raw) = self.backend.read(&account)? {
            if decode(&raw)?.binding != *expected {
                return Err(GoogleDriveCredentialError::BindingMismatch);
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
impl GoogleDriveCredentialBackend for EphemeralCredentialBackend {
    fn read(
        &self,
        account: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, GoogleDriveCredentialError> {
        Ok(self
            .entries
            .lock()
            .map_err(|_| GoogleDriveCredentialError::SynchronizationFailed)?
            .get(account)
            .map(|v| Zeroizing::new(v.as_slice().to_vec())))
    }
    fn write(&self, account: &str, value: &[u8]) -> Result<(), GoogleDriveCredentialError> {
        self.entries
            .lock()
            .map_err(|_| GoogleDriveCredentialError::SynchronizationFailed)?
            .insert(account.into(), Zeroizing::new(value.to_vec()));
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), GoogleDriveCredentialError> {
        self.entries
            .lock()
            .map_err(|_| GoogleDriveCredentialError::SynchronizationFailed)?
            .remove(account);
        Ok(())
    }
}

pub fn credential_account(connection_id: &str) -> Result<String, GoogleDriveCredentialError> {
    if !valid_id(connection_id) {
        return Err(GoogleDriveCredentialError::InvalidInput);
    }
    Ok(format!(
        "{ACCOUNT_PREFIX}{:x}",
        Sha256::digest(connection_id.as_bytes())
    ))
}
fn dto(b: &GoogleDriveCredentialBinding) -> GoogleDriveCredentialDto {
    GoogleDriveCredentialDto {
        connection_id: b.connection_id.clone(),
        household_id: b.household_id.clone(),
        client_id_fingerprint: b.client_id_fingerprint.clone(),
        scope: b.scope.clone(),
        credential_version: VERSION,
    }
}
fn valid_id(v: &str) -> bool {
    !v.is_empty() && v.trim() == v && v.len() <= MAX_ID && !v.chars().any(char::is_control)
}
fn canonical_hash(v: &str) -> bool {
    v.len() == 64
        && v.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn validate_binding(b: &GoogleDriveCredentialBinding) -> Result<(), GoogleDriveCredentialError> {
    if !valid_id(&b.connection_id)
        || !valid_id(&b.household_id)
        || !canonical_hash(&b.client_id_fingerprint)
        || b.scope != GOOGLE_DRIVE_READONLY_SCOPE
    {
        return Err(GoogleDriveCredentialError::InvalidInput);
    }
    Ok(())
}
fn validate_token(v: &str) -> Result<(), GoogleDriveCredentialError> {
    if v.is_empty()
        || v.len() > MAX_TOKEN
        || !v.is_ascii()
        || v.bytes()
            .any(|b| b.is_ascii_control() || b.is_ascii_whitespace())
    {
        return Err(GoogleDriveCredentialError::InvalidInput);
    }
    Ok(())
}
fn encode(
    b: &GoogleDriveCredentialBinding,
    token: &str,
) -> Result<Zeroizing<Vec<u8>>, GoogleDriveCredentialError> {
    validate_binding(b)?;
    validate_token(token)?;
    let fields = [
        b.connection_id.as_bytes(),
        b.household_id.as_bytes(),
        b.client_id_fingerprint.as_bytes(),
        b.scope.as_bytes(),
        token.as_bytes(),
    ];
    let mut out = Zeroizing::new(Vec::new());
    out.extend_from_slice(PAYLOAD_PREFIX);
    for field in fields {
        let len =
            u32::try_from(field.len()).map_err(|_| GoogleDriveCredentialError::InvalidInput)?;
        out.extend_from_slice(&len.to_be_bytes());
        out.extend_from_slice(field);
    }
    Ok(out)
}
fn decode(raw: &[u8]) -> Result<GoogleDriveRefreshCredential, GoogleDriveCredentialError> {
    if !raw.starts_with(PAYLOAD_PREFIX) {
        return Err(GoogleDriveCredentialError::InvalidStoredCredential);
    }
    let mut at = PAYLOAD_PREFIX.len();
    let binding = GoogleDriveCredentialBinding {
        connection_id: field(raw, &mut at, MAX_ID)?,
        household_id: field(raw, &mut at, MAX_ID)?,
        client_id_fingerprint: field(raw, &mut at, 64)?,
        scope: field(raw, &mut at, GOOGLE_DRIVE_READONLY_SCOPE.len())?,
    };
    let refresh_token = Zeroizing::new(field(raw, &mut at, MAX_TOKEN)?);
    if at != raw.len()
        || validate_binding(&binding).is_err()
        || validate_token(&refresh_token).is_err()
    {
        return Err(GoogleDriveCredentialError::InvalidStoredCredential);
    }
    Ok(GoogleDriveRefreshCredential {
        binding,
        refresh_token,
    })
}
fn field(raw: &[u8], at: &mut usize, max: usize) -> Result<String, GoogleDriveCredentialError> {
    let end = at
        .checked_add(4)
        .ok_or(GoogleDriveCredentialError::InvalidStoredCredential)?;
    let bytes: [u8; 4] = raw
        .get(*at..end)
        .ok_or(GoogleDriveCredentialError::InvalidStoredCredential)?
        .try_into()
        .map_err(|_| GoogleDriveCredentialError::InvalidStoredCredential)?;
    let len = u32::from_be_bytes(bytes) as usize;
    if len == 0 || len > max {
        return Err(GoogleDriveCredentialError::InvalidStoredCredential);
    }
    let value_end = end
        .checked_add(len)
        .ok_or(GoogleDriveCredentialError::InvalidStoredCredential)?;
    let value = std::str::from_utf8(
        raw.get(end..value_end)
            .ok_or(GoogleDriveCredentialError::InvalidStoredCredential)?,
    )
    .map_err(|_| GoogleDriveCredentialError::InvalidStoredCredential)?
    .to_owned();
    *at = value_end;
    Ok(value)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
struct OsCredentialBackend;
#[cfg(any(target_os = "macos", target_os = "windows"))]
impl OsCredentialBackend {
    fn new() -> Result<Self, GoogleDriveCredentialError> {
        Ok(Self)
    }
    fn entry(account: &str) -> Result<keyring::Entry, GoogleDriveCredentialError> {
        keyring::Entry::new(SERVICE, account)
            .map_err(|_| GoogleDriveCredentialError::EntryUnavailable)
    }
}
#[cfg(any(target_os = "macos", target_os = "windows"))]
impl GoogleDriveCredentialBackend for OsCredentialBackend {
    fn read(
        &self,
        account: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, GoogleDriveCredentialError> {
        match Self::entry(account)?.get_secret() {
            Ok(v) => Ok(Some(Zeroizing::new(v))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(GoogleDriveCredentialError::ReadFailed),
        }
    }
    fn write(&self, account: &str, value: &[u8]) -> Result<(), GoogleDriveCredentialError> {
        Self::entry(account)?
            .set_secret(value)
            .map_err(|_| GoogleDriveCredentialError::WriteFailed)
    }
    fn delete(&self, account: &str) -> Result<(), GoogleDriveCredentialError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(GoogleDriveCredentialError::DeleteFailed),
        }
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
struct OsCredentialBackend;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl OsCredentialBackend {
    fn new() -> Result<Self, GoogleDriveCredentialError> {
        Err(GoogleDriveCredentialError::UnsupportedPlatform)
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl GoogleDriveCredentialBackend for OsCredentialBackend {
    fn read(
        &self,
        _account: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, GoogleDriveCredentialError> {
        Err(GoogleDriveCredentialError::UnsupportedPlatform)
    }

    fn write(&self, _account: &str, _value: &[u8]) -> Result<(), GoogleDriveCredentialError> {
        Err(GoogleDriveCredentialError::UnsupportedPlatform)
    }

    fn delete(&self, _account: &str) -> Result<(), GoogleDriveCredentialError> {
        Err(GoogleDriveCredentialError::UnsupportedPlatform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding(connection: &str, household: &str) -> GoogleDriveCredentialBinding {
        GoogleDriveCredentialBinding::new(connection, household, "a".repeat(64)).unwrap()
    }
    #[test]
    fn store_read_rotate_delete_and_redact() {
        let store = GoogleDriveCredentialStore::new_ephemeral();
        let expected = binding("drive-a", "family-a");
        let secret = "1//refresh-token";
        let dto = store
            .store(expected.clone(), Zeroizing::new(secret.into()))
            .unwrap();
        assert_eq!(dto.credential_version, 1);
        assert!(!serde_json::to_string(&dto).unwrap().contains(secret));
        let loaded = store.read(&expected).unwrap().unwrap();
        assert_eq!(loaded.refresh_token(), secret);
        assert!(!format!("{loaded:?}").contains(secret));
        store
            .store(expected.clone(), Zeroizing::new("rotated".into()))
            .unwrap();
        assert_eq!(
            store.read(&expected).unwrap().unwrap().refresh_token(),
            "rotated"
        );
        store.delete(&expected).unwrap();
        assert!(store.read(&expected).unwrap().is_none());
        store.delete(&expected).unwrap();
    }
    #[test]
    fn binding_mismatch_is_rejected() {
        let store = GoogleDriveCredentialStore::new_ephemeral();
        let expected = binding("drive", "family-a");
        store
            .store(expected.clone(), Zeroizing::new("refresh".into()))
            .unwrap();
        let wrong_household = binding("drive", "family-b");
        assert_eq!(
            store.read(&wrong_household).unwrap_err(),
            GoogleDriveCredentialError::BindingMismatch
        );
        let wrong_client =
            GoogleDriveCredentialBinding::new("drive", "family-a", "b".repeat(64)).unwrap();
        assert_eq!(
            store.delete(&wrong_client),
            Err(GoogleDriveCredentialError::BindingMismatch)
        );
        let mut wrong_scope = expected.clone();
        wrong_scope.scope = "https://www.googleapis.com/auth/drive.file".into();
        assert!(matches!(
            store.read(&wrong_scope),
            Err(GoogleDriveCredentialError::InvalidInput)
        ));
    }
    #[test]
    fn account_and_payload_are_versioned_and_bounded() {
        let account = credential_account("private-connection-id").unwrap();
        assert!(account.starts_with(ACCOUNT_PREFIX));
        assert!(!account.contains("private-connection-id"));
        let expected = binding("drive", "family");
        let valid = encode(&expected, "refresh").unwrap();
        assert_eq!(
            decode(&valid[..valid.len() - 1]).unwrap_err(),
            GoogleDriveCredentialError::InvalidStoredCredential
        );
        let mut trailing = valid.to_vec();
        trailing.push(0);
        assert_eq!(
            decode(&trailing).unwrap_err(),
            GoogleDriveCredentialError::InvalidStoredCredential
        );
        assert_eq!(
            decode(b"kakeflow-google-drive-refresh-v2\0").unwrap_err(),
            GoogleDriveCredentialError::InvalidStoredCredential
        );
        for token in ["", "has space", "line\nbreak", "é"] {
            assert_eq!(
                GoogleDriveCredentialStore::new_ephemeral()
                    .store(expected.clone(), Zeroizing::new(token.into())),
                Err(GoogleDriveCredentialError::InvalidInput)
            );
        }
    }
}
