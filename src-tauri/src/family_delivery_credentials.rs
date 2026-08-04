//! Operating-system credential storage for family-relay bearer tokens.
//!
//! The token is kept out of serializable DTOs and application persistence. A
//! versioned credential payload binds it to one household, normalized relay
//! endpoint, and remote principal. Production uses macOS Keychain or Windows
//! Credential Manager; tests inject an in-memory backend.

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
const ACCOUNT_PREFIX: &str = "family-relay-token-v1:";
const PAYLOAD_PREFIX: &[u8] = b"kakeflow-family-relay-token-v1\0";
const CREDENTIAL_VERSION: u32 = 1;
const MAX_ID_BYTES: usize = 256;
const MAX_ENDPOINT_BYTES: usize = 2_048;
const MAX_TOKEN_BYTES: usize = 16_384;

/// Errors are deliberately coarse and never contain backend diagnostics,
/// payload bytes, account contents, or bearer-token material.
#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum FamilyDeliveryCredentialError {
    #[error("the family relay credential request is invalid")]
    InvalidInput,
    #[error("the family relay credential entry could not be opened")]
    EntryUnavailable,
    #[error("the family relay credential could not be read")]
    ReadFailed,
    #[error("the family relay credential could not be written")]
    WriteFailed,
    #[error("the family relay credential could not be deleted")]
    DeleteFailed,
    #[error("the stored family relay credential has an unsupported or invalid format")]
    InvalidStoredCredential,
    #[error("the stored family relay credential belongs to a different relay connection")]
    BindingMismatch,
    #[error("family relay credential access could not be synchronized")]
    SynchronizationFailed,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[error("operating-system credential storage is unsupported on this platform")]
    UnsupportedPlatform,
}

/// Non-secret identity of the connection to which a token is bound.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FamilyDeliveryCredentialBinding {
    pub household_id: String,
    pub endpoint: String,
    pub remote_principal_id: String,
}

impl FamilyDeliveryCredentialBinding {
    pub fn new(
        household_id: impl Into<String>,
        endpoint: impl AsRef<str>,
        remote_principal_id: impl Into<String>,
    ) -> Result<Self, FamilyDeliveryCredentialError> {
        let household_id = household_id.into();
        let remote_principal_id = remote_principal_id.into();
        if !valid_identifier(&household_id) || !valid_identifier(&remote_principal_id) {
            return Err(FamilyDeliveryCredentialError::InvalidInput);
        }
        let endpoint = normalize_family_delivery_endpoint(endpoint.as_ref())
            .ok_or(FamilyDeliveryCredentialError::InvalidInput)?;
        Ok(Self {
            household_id,
            endpoint,
            remote_principal_id,
        })
    }
}

/// Safe to send across IPC: it proves that a credential exists but never
/// exposes the token itself or a token-derived fingerprint.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyDeliveryCredentialDto {
    pub household_id: String,
    pub endpoint: String,
    pub remote_principal_id: String,
    pub credential_version: u32,
}

/// Native-only credential value. It intentionally implements neither
/// `Serialize` nor `Clone`; its custom `Debug` output redacts the token.
pub struct FamilyDeliveryBearerCredential {
    binding: FamilyDeliveryCredentialBinding,
    bearer_token: Zeroizing<String>,
}

impl std::fmt::Debug for FamilyDeliveryBearerCredential {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FamilyDeliveryBearerCredential")
            .field("binding", &self.binding)
            .field("bearer_token", &"[REDACTED]")
            .finish()
    }
}

impl FamilyDeliveryBearerCredential {
    pub fn binding(&self) -> &FamilyDeliveryCredentialBinding {
        &self.binding
    }

    pub fn bearer_token(&self) -> &str {
        self.bearer_token.as_str()
    }

    pub fn dto(&self) -> FamilyDeliveryCredentialDto {
        dto(&self.binding)
    }
}

/// Injectable credential boundary. Encoded values remain zeroizing while
/// crossing the boundary; a test backend can therefore avoid the real OS
/// credential store entirely.
pub trait FamilyDeliveryCredentialBackend: Send + Sync {
    fn read(
        &self,
        account: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, FamilyDeliveryCredentialError>;
    fn write(
        &self,
        account: &str,
        encoded_credential: &[u8],
    ) -> Result<(), FamilyDeliveryCredentialError>;
    fn delete(&self, account: &str) -> Result<(), FamilyDeliveryCredentialError>;
}

pub struct FamilyDeliveryCredentialStore {
    backend: Arc<dyn FamilyDeliveryCredentialBackend>,
    operation_lock: Mutex<()>,
}

impl FamilyDeliveryCredentialStore {
    /// Opens the production macOS Keychain or Windows Credential Manager
    /// backend. Unsupported targets return a sanitized error.
    pub fn new_os() -> Result<Self, FamilyDeliveryCredentialError> {
        Ok(Self::with_backend(Arc::new(OsCredentialBackend::new()?)))
    }

    /// Process-only store used by packaged smoke runs. It never opens the
    /// user's Keychain or Windows Credential Manager and is discarded at exit.
    pub fn new_ephemeral() -> Self {
        Self::with_backend(Arc::new(EphemeralCredentialBackend::default()))
    }

    /// Injection point used by unit tests and deterministic host tests.
    pub fn with_backend(backend: Arc<dyn FamilyDeliveryCredentialBackend>) -> Self {
        Self {
            backend,
            operation_lock: Mutex::new(()),
        }
    }

    /// Stores or rotates the bearer token for this exact connection binding.
    /// The returned DTO contains no token material.
    pub fn store(
        &self,
        binding: FamilyDeliveryCredentialBinding,
        bearer_token: Zeroizing<String>,
    ) -> Result<FamilyDeliveryCredentialDto, FamilyDeliveryCredentialError> {
        validate_binding(&binding)?;
        validate_token(&bearer_token)?;
        let account = credential_account(&binding.household_id)?;
        let encoded = encode_payload(&binding, &bearer_token)?;
        let _guard = self
            .operation_lock
            .lock()
            .map_err(|_| FamilyDeliveryCredentialError::SynchronizationFailed)?;
        self.backend.write(&account, &encoded)?;

        // Confirm persistence and binding so a backend conversion issue cannot
        // leave the UI believing that a usable token was stored.
        let persisted = self
            .backend
            .read(&account)?
            .ok_or(FamilyDeliveryCredentialError::WriteFailed)?;
        let decoded = decode_payload(&persisted)?;
        if decoded.binding != binding || decoded.bearer_token.as_str() != bearer_token.as_str() {
            return Err(FamilyDeliveryCredentialError::WriteFailed);
        }
        Ok(dto(&binding))
    }

    /// Reads a token only when every binding field matches the requested
    /// connection. Missing credentials are represented as `None`.
    pub fn read(
        &self,
        expected: &FamilyDeliveryCredentialBinding,
    ) -> Result<Option<FamilyDeliveryBearerCredential>, FamilyDeliveryCredentialError> {
        validate_binding(expected)?;
        let account = credential_account(&expected.household_id)?;
        let encoded = match self.backend.read(&account)? {
            Some(encoded) => encoded,
            None => return Ok(None),
        };
        let credential = decode_payload(&encoded)?;
        if credential.binding != *expected {
            return Err(FamilyDeliveryCredentialError::BindingMismatch);
        }
        Ok(Some(credential))
    }

    /// Deletes the credential idempotently, but refuses to delete an entry
    /// whose endpoint or remote-principal binding does not match the caller.
    pub fn delete(
        &self,
        expected: &FamilyDeliveryCredentialBinding,
    ) -> Result<(), FamilyDeliveryCredentialError> {
        validate_binding(expected)?;
        let account = credential_account(&expected.household_id)?;
        let _guard = self
            .operation_lock
            .lock()
            .map_err(|_| FamilyDeliveryCredentialError::SynchronizationFailed)?;
        if let Some(encoded) = self.backend.read(&account)? {
            let credential = decode_payload(&encoded)?;
            if credential.binding != *expected {
                return Err(FamilyDeliveryCredentialError::BindingMismatch);
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

impl FamilyDeliveryCredentialBackend for EphemeralCredentialBackend {
    fn read(
        &self,
        account: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, FamilyDeliveryCredentialError> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| FamilyDeliveryCredentialError::SynchronizationFailed)?;
        Ok(entries
            .get(account)
            .map(|value| Zeroizing::new(value.as_slice().to_vec())))
    }

    fn write(
        &self,
        account: &str,
        encoded_credential: &[u8],
    ) -> Result<(), FamilyDeliveryCredentialError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| FamilyDeliveryCredentialError::SynchronizationFailed)?;
        entries.insert(
            account.to_owned(),
            Zeroizing::new(encoded_credential.to_vec()),
        );
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), FamilyDeliveryCredentialError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| FamilyDeliveryCredentialError::SynchronizationFailed)?;
        entries.remove(account);
        Ok(())
    }
}

/// Canonicalizes the endpoint in the same form persisted by family delivery:
/// surrounding whitespace and trailing slashes are removed; HTTPS is required
/// except for explicit loopback development endpoints.
pub fn normalize_family_delivery_endpoint(value: &str) -> Option<String> {
    let endpoint = value.trim().trim_end_matches('/');
    let loopback = endpoint.starts_with("http://127.0.0.1:")
        || endpoint.starts_with("http://localhost:")
        || endpoint.starts_with("http://[::1]:");
    if endpoint.len() < 8
        || endpoint.len() > MAX_ENDPOINT_BYTES
        || endpoint.chars().any(char::is_control)
        || !(endpoint.starts_with("https://") || loopback)
    {
        return None;
    }
    Some(endpoint.to_owned())
}

/// Stable, non-secret OS credential account. The household identifier itself
/// is not placed in the account label.
pub fn credential_account(household_id: &str) -> Result<String, FamilyDeliveryCredentialError> {
    if !valid_identifier(household_id) {
        return Err(FamilyDeliveryCredentialError::InvalidInput);
    }
    Ok(format!(
        "{ACCOUNT_PREFIX}{:x}",
        Sha256::digest(household_id.as_bytes())
    ))
}

fn dto(binding: &FamilyDeliveryCredentialBinding) -> FamilyDeliveryCredentialDto {
    FamilyDeliveryCredentialDto {
        household_id: binding.household_id.clone(),
        endpoint: binding.endpoint.clone(),
        remote_principal_id: binding.remote_principal_id.clone(),
        credential_version: CREDENTIAL_VERSION,
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.trim().is_empty()
        && value.trim() == value
        && value.len() <= MAX_ID_BYTES
        && !value.chars().any(char::is_control)
}

fn validate_binding(
    binding: &FamilyDeliveryCredentialBinding,
) -> Result<(), FamilyDeliveryCredentialError> {
    if !valid_identifier(&binding.household_id)
        || !valid_identifier(&binding.remote_principal_id)
        || normalize_family_delivery_endpoint(&binding.endpoint).as_deref()
            != Some(binding.endpoint.as_str())
    {
        return Err(FamilyDeliveryCredentialError::InvalidInput);
    }
    Ok(())
}

fn validate_token(token: &str) -> Result<(), FamilyDeliveryCredentialError> {
    if token.is_empty()
        || token.len() > MAX_TOKEN_BYTES
        || !token.is_ascii()
        || token
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err(FamilyDeliveryCredentialError::InvalidInput);
    }
    Ok(())
}

fn encode_payload(
    binding: &FamilyDeliveryCredentialBinding,
    bearer_token: &str,
) -> Result<Zeroizing<Vec<u8>>, FamilyDeliveryCredentialError> {
    validate_binding(binding)?;
    validate_token(bearer_token)?;
    let fields = [
        binding.household_id.as_bytes(),
        binding.endpoint.as_bytes(),
        binding.remote_principal_id.as_bytes(),
        bearer_token.as_bytes(),
    ];
    let capacity = PAYLOAD_PREFIX.len()
        + fields
            .iter()
            .map(|field| 4_usize.saturating_add(field.len()))
            .sum::<usize>();
    let mut encoded = Zeroizing::new(Vec::with_capacity(capacity));
    encoded.extend_from_slice(PAYLOAD_PREFIX);
    for field in fields {
        let length =
            u32::try_from(field.len()).map_err(|_| FamilyDeliveryCredentialError::InvalidInput)?;
        encoded.extend_from_slice(&length.to_be_bytes());
        encoded.extend_from_slice(field);
    }
    Ok(encoded)
}

fn decode_payload(
    encoded: &[u8],
) -> Result<FamilyDeliveryBearerCredential, FamilyDeliveryCredentialError> {
    let mut cursor = PAYLOAD_PREFIX.len();
    if !encoded.starts_with(PAYLOAD_PREFIX) {
        return Err(FamilyDeliveryCredentialError::InvalidStoredCredential);
    }
    let household_id = decode_string_field(encoded, &mut cursor, MAX_ID_BYTES)?;
    let endpoint = decode_string_field(encoded, &mut cursor, MAX_ENDPOINT_BYTES)?;
    let remote_principal_id = decode_string_field(encoded, &mut cursor, MAX_ID_BYTES)?;
    let bearer_token = Zeroizing::new(decode_string_field(encoded, &mut cursor, MAX_TOKEN_BYTES)?);
    if cursor != encoded.len() {
        return Err(FamilyDeliveryCredentialError::InvalidStoredCredential);
    }
    let binding = FamilyDeliveryCredentialBinding::new(household_id, endpoint, remote_principal_id)
        .map_err(|_| FamilyDeliveryCredentialError::InvalidStoredCredential)?;
    validate_token(&bearer_token)
        .map_err(|_| FamilyDeliveryCredentialError::InvalidStoredCredential)?;
    Ok(FamilyDeliveryBearerCredential {
        binding,
        bearer_token,
    })
}

fn decode_string_field(
    encoded: &[u8],
    cursor: &mut usize,
    maximum: usize,
) -> Result<String, FamilyDeliveryCredentialError> {
    let length_end = cursor
        .checked_add(4)
        .ok_or(FamilyDeliveryCredentialError::InvalidStoredCredential)?;
    let length_bytes: [u8; 4] = encoded
        .get(*cursor..length_end)
        .ok_or(FamilyDeliveryCredentialError::InvalidStoredCredential)?
        .try_into()
        .map_err(|_| FamilyDeliveryCredentialError::InvalidStoredCredential)?;
    let length = u32::from_be_bytes(length_bytes) as usize;
    if length == 0 || length > maximum {
        return Err(FamilyDeliveryCredentialError::InvalidStoredCredential);
    }
    let value_end = length_end
        .checked_add(length)
        .ok_or(FamilyDeliveryCredentialError::InvalidStoredCredential)?;
    let value = std::str::from_utf8(
        encoded
            .get(length_end..value_end)
            .ok_or(FamilyDeliveryCredentialError::InvalidStoredCredential)?,
    )
    .map_err(|_| FamilyDeliveryCredentialError::InvalidStoredCredential)?
    .to_owned();
    *cursor = value_end;
    Ok(value)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
struct OsCredentialBackend;

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl OsCredentialBackend {
    fn new() -> Result<Self, FamilyDeliveryCredentialError> {
        Ok(Self)
    }

    fn entry(account: &str) -> Result<keyring::Entry, FamilyDeliveryCredentialError> {
        keyring::Entry::new(SERVICE, account)
            .map_err(|_| FamilyDeliveryCredentialError::EntryUnavailable)
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl FamilyDeliveryCredentialBackend for OsCredentialBackend {
    fn read(
        &self,
        account: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, FamilyDeliveryCredentialError> {
        match Self::entry(account)?.get_secret() {
            Ok(value) => Ok(Some(Zeroizing::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(FamilyDeliveryCredentialError::ReadFailed),
        }
    }

    fn write(
        &self,
        account: &str,
        encoded_credential: &[u8],
    ) -> Result<(), FamilyDeliveryCredentialError> {
        Self::entry(account)?
            .set_secret(encoded_credential)
            .map_err(|_| FamilyDeliveryCredentialError::WriteFailed)
    }

    fn delete(&self, account: &str) -> Result<(), FamilyDeliveryCredentialError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(FamilyDeliveryCredentialError::DeleteFailed),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
struct OsCredentialBackend;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl OsCredentialBackend {
    fn new() -> Result<Self, FamilyDeliveryCredentialError> {
        Err(FamilyDeliveryCredentialError::UnsupportedPlatform)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl FamilyDeliveryCredentialBackend for OsCredentialBackend {
    fn read(
        &self,
        _account: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, FamilyDeliveryCredentialError> {
        Err(FamilyDeliveryCredentialError::UnsupportedPlatform)
    }

    fn write(
        &self,
        _account: &str,
        _encoded_credential: &[u8],
    ) -> Result<(), FamilyDeliveryCredentialError> {
        Err(FamilyDeliveryCredentialError::UnsupportedPlatform)
    }

    fn delete(&self, _account: &str) -> Result<(), FamilyDeliveryCredentialError> {
        Err(FamilyDeliveryCredentialError::UnsupportedPlatform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemoryCredentialBackend {
        values: Mutex<HashMap<String, Vec<u8>>>,
        fail_read: bool,
        fail_write: bool,
        fail_delete: bool,
    }

    impl MemoryCredentialBackend {
        fn raw(&self, account: &str) -> Option<Vec<u8>> {
            self.values.lock().unwrap().get(account).cloned()
        }

        fn insert_raw(&self, account: &str, value: Vec<u8>) {
            self.values
                .lock()
                .unwrap()
                .insert(account.to_owned(), value);
        }
    }

    impl FamilyDeliveryCredentialBackend for MemoryCredentialBackend {
        fn read(
            &self,
            account: &str,
        ) -> Result<Option<Zeroizing<Vec<u8>>>, FamilyDeliveryCredentialError> {
            if self.fail_read {
                return Err(FamilyDeliveryCredentialError::ReadFailed);
            }
            Ok(self
                .values
                .lock()
                .unwrap()
                .get(account)
                .cloned()
                .map(Zeroizing::new))
        }

        fn write(
            &self,
            account: &str,
            encoded_credential: &[u8],
        ) -> Result<(), FamilyDeliveryCredentialError> {
            if self.fail_write {
                return Err(FamilyDeliveryCredentialError::WriteFailed);
            }
            self.values
                .lock()
                .unwrap()
                .insert(account.to_owned(), encoded_credential.to_vec());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), FamilyDeliveryCredentialError> {
            if self.fail_delete {
                return Err(FamilyDeliveryCredentialError::DeleteFailed);
            }
            self.values.lock().unwrap().remove(account);
            Ok(())
        }
    }

    fn binding(household: &str) -> FamilyDeliveryCredentialBinding {
        FamilyDeliveryCredentialBinding::new(
            household,
            " https://relay.example/ ",
            "principal-owner",
        )
        .unwrap()
    }

    #[test]
    fn normalizes_supported_endpoints_and_rejects_unsafe_forms() {
        assert_eq!(
            normalize_family_delivery_endpoint(" https://relay.example/// ").as_deref(),
            Some("https://relay.example")
        );
        assert_eq!(
            normalize_family_delivery_endpoint("http://127.0.0.1:8787/").as_deref(),
            Some("http://127.0.0.1:8787")
        );
        assert_eq!(
            normalize_family_delivery_endpoint("http://[::1]:8787/").as_deref(),
            Some("http://[::1]:8787")
        );
        assert!(normalize_family_delivery_endpoint("http://relay.example").is_none());
        assert!(normalize_family_delivery_endpoint("https://relay.example\nattack").is_none());
    }

    #[test]
    fn account_is_versioned_deterministic_and_hides_household_identifier() {
        let first = credential_account("family-a").unwrap();
        let second = credential_account("family-a").unwrap();
        assert_eq!(first, second);
        assert!(first.starts_with(ACCOUNT_PREFIX));
        assert_eq!(first.len(), ACCOUNT_PREFIX.len() + 64);
        assert!(!first.contains("family-a"));
        assert_ne!(first, credential_account("family-b").unwrap());
    }

    #[test]
    fn stores_reads_and_deletes_a_bound_token_without_exposing_it_in_dto() {
        let backend = Arc::new(MemoryCredentialBackend::default());
        let store = FamilyDeliveryCredentialStore::with_backend(backend.clone());
        let expected = binding("family-a");
        let secret = "super-secret-relay-token";

        let summary = store
            .store(expected.clone(), Zeroizing::new(secret.to_owned()))
            .unwrap();
        assert_eq!(summary.household_id, "family-a");
        assert_eq!(summary.endpoint, "https://relay.example");
        assert_eq!(summary.credential_version, 1);
        assert!(!serde_json::to_string(&summary).unwrap().contains(secret));

        let loaded = store.read(&expected).unwrap().unwrap();
        assert_eq!(loaded.binding(), &expected);
        assert_eq!(loaded.bearer_token(), secret);
        assert!(!format!("{loaded:?}").contains(secret));

        store.delete(&expected).unwrap();
        assert!(store.read(&expected).unwrap().is_none());
        store.delete(&expected).unwrap();
    }

    #[test]
    fn isolates_households_and_allows_in_place_token_rotation() {
        let backend = Arc::new(MemoryCredentialBackend::default());
        let store = FamilyDeliveryCredentialStore::with_backend(backend);
        let first = binding("family-a");
        let second = binding("family-b");
        store
            .store(first.clone(), Zeroizing::new("token-a1".to_owned()))
            .unwrap();
        store
            .store(second.clone(), Zeroizing::new("token-b".to_owned()))
            .unwrap();
        store
            .store(first.clone(), Zeroizing::new("token-a2".to_owned()))
            .unwrap();

        assert_eq!(
            store.read(&first).unwrap().unwrap().bearer_token(),
            "token-a2"
        );
        assert_eq!(
            store.read(&second).unwrap().unwrap().bearer_token(),
            "token-b"
        );
    }

    #[test]
    fn refuses_endpoint_or_principal_binding_mismatch_for_read_and_delete() {
        let backend = Arc::new(MemoryCredentialBackend::default());
        let store = FamilyDeliveryCredentialStore::with_backend(backend.clone());
        let expected = binding("family-a");
        store
            .store(expected.clone(), Zeroizing::new("token-a".to_owned()))
            .unwrap();
        let wrong_endpoint = FamilyDeliveryCredentialBinding::new(
            "family-a",
            "https://other.example",
            "principal-owner",
        )
        .unwrap();
        let wrong_principal = FamilyDeliveryCredentialBinding::new(
            "family-a",
            "https://relay.example",
            "principal-other",
        )
        .unwrap();

        for wrong in [&wrong_endpoint, &wrong_principal] {
            assert_eq!(
                store.read(wrong).unwrap_err(),
                FamilyDeliveryCredentialError::BindingMismatch
            );
            assert_eq!(
                store.delete(wrong),
                Err(FamilyDeliveryCredentialError::BindingMismatch)
            );
        }
        assert!(backend
            .raw(&credential_account("family-a").unwrap())
            .is_some());
    }

    #[test]
    fn rejects_invalid_tokens_and_noncanonical_bindings_before_writing() {
        let backend = Arc::new(MemoryCredentialBackend::default());
        let store = FamilyDeliveryCredentialStore::with_backend(backend.clone());
        let expected = binding("family-a");
        for token in ["", "has space", "line\nbreak", "é"] {
            assert_eq!(
                store.store(expected.clone(), Zeroizing::new(token.to_owned())),
                Err(FamilyDeliveryCredentialError::InvalidInput)
            );
        }
        let noncanonical = FamilyDeliveryCredentialBinding {
            endpoint: "https://relay.example/".to_owned(),
            ..expected
        };
        assert_eq!(
            store.store(noncanonical, Zeroizing::new("token".to_owned())),
            Err(FamilyDeliveryCredentialError::InvalidInput)
        );
        assert!(backend.values.lock().unwrap().is_empty());
    }

    #[test]
    fn rejects_wrong_version_truncation_trailing_bytes_and_invalid_utf8() {
        let backend = Arc::new(MemoryCredentialBackend::default());
        let store = FamilyDeliveryCredentialStore::with_backend(backend.clone());
        let expected = binding("family-a");
        let account = credential_account("family-a").unwrap();
        let valid = encode_payload(&expected, "token-a").unwrap().to_vec();
        let mut cases = vec![
            b"kakeflow-family-relay-token-v2\0".to_vec(),
            valid[..valid.len() - 1].to_vec(),
            {
                let mut bytes = valid.clone();
                bytes.push(0);
                bytes
            },
        ];
        let mut invalid_utf8 = valid;
        let token_offset = invalid_utf8.len() - "token-a".len();
        invalid_utf8[token_offset] = 0xff;
        cases.push(invalid_utf8);

        for malformed in cases {
            backend.insert_raw(&account, malformed);
            assert_eq!(
                store.read(&expected).unwrap_err(),
                FamilyDeliveryCredentialError::InvalidStoredCredential
            );
        }
    }

    #[test]
    fn maps_backend_failures_to_sanitized_errors() {
        let expected = binding("family-a");
        let secret = "never-include-this-token";
        let read_store =
            FamilyDeliveryCredentialStore::with_backend(Arc::new(MemoryCredentialBackend {
                fail_read: true,
                ..MemoryCredentialBackend::default()
            }));
        let write_store =
            FamilyDeliveryCredentialStore::with_backend(Arc::new(MemoryCredentialBackend {
                fail_write: true,
                ..MemoryCredentialBackend::default()
            }));
        assert_eq!(
            read_store.read(&expected).unwrap_err(),
            FamilyDeliveryCredentialError::ReadFailed
        );
        let error = write_store
            .store(expected, Zeroizing::new(secret.to_owned()))
            .unwrap_err();
        assert_eq!(error, FamilyDeliveryCredentialError::WriteFailed);
        assert!(!error.to_string().contains(secret));
    }

    #[test]
    fn delete_failure_does_not_report_backend_or_secret_material() {
        let writable = Arc::new(MemoryCredentialBackend::default());
        let expected = binding("family-a");
        let account = credential_account("family-a").unwrap();
        let encoded = encode_payload(&expected, "secret-token").unwrap().to_vec();
        let failing = Arc::new(MemoryCredentialBackend {
            values: Mutex::new(HashMap::from([(account, encoded)])),
            fail_delete: true,
            ..MemoryCredentialBackend::default()
        });
        // Keep a separate backend alive to also exercise the public injection
        // type without any operating-system credential access.
        writable.insert_raw("unused", vec![1]);
        let store = FamilyDeliveryCredentialStore::with_backend(failing);
        let error = store.delete(&expected).unwrap_err();
        assert_eq!(error, FamilyDeliveryCredentialError::DeleteFailed);
        assert!(!error.to_string().contains("secret-token"));
    }
}
