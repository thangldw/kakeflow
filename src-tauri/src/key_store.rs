//! Database master-key storage backed by the operating system credential vault.
//!
//! The stored value is a versioned, base64-encoded 32-byte random key. Encoding
//! avoids credential-store differences around arbitrary binary values. This
//! module deliberately never formats the key or backend error details.

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use std::sync::{Arc, Mutex};
use thiserror::Error;
use zeroize::{Zeroize, Zeroizing};

pub const SERVICE: &str = "app.kakeflow.desktop";
pub const ACCOUNT: &str = "database-master-key";
const KEY_BYTES: usize = 32;
const ENCODING_PREFIX: &[u8] = b"kakeflow-key-v1:";

/// Sanitized credential-store errors. No variant carries backend or secret text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum KeyStoreError {
    #[error("the operating system credential entry could not be opened")]
    EntryUnavailable,
    #[error("the database key could not be read from the operating system credential store")]
    ReadFailed,
    #[error("the database key could not be written to the operating system credential store")]
    WriteFailed,
    #[error("the stored database key has an unsupported or invalid format")]
    InvalidStoredKey,
    #[error("secure random key generation failed")]
    RandomGenerationFailed,
    #[error("database key generation could not be synchronized")]
    SynchronizationFailed,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[error("operating system credential storage is unsupported on this platform")]
    UnsupportedPlatform,
}

/// Minimal interface used to keep production credential access injectable.
///
/// Implementations return encoded credential bytes rather than decoded key
/// material. Test implementations therefore never touch the real Keychain or
/// Windows Credential Manager.
pub trait CredentialBackend: Send + Sync {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, KeyStoreError>;
    fn write(&self, encoded_key: &[u8]) -> Result<(), KeyStoreError>;
}

/// Loads or creates the database master key.
///
/// `key` returns zeroizing key material suitable for adapting to
/// `persistence::DatabaseKeyProvider`. The provider itself does not cache the
/// key, so an owned plaintext copy is kept only for the caller's lifetime.
pub struct OsDatabaseKeyProvider {
    backend: Arc<dyn CredentialBackend>,
    generation_lock: Mutex<()>,
}

impl OsDatabaseKeyProvider {
    /// Uses macOS Keychain or Windows Credential Manager.
    pub fn new() -> Result<Self, KeyStoreError> {
        Ok(Self {
            backend: Arc::new(OsCredentialBackend::new()?),
            generation_lock: Mutex::new(()),
        })
    }

    /// Injection point for tests and alternative platform credential adapters.
    #[cfg(test)]
    pub fn with_backend(backend: Arc<dyn CredentialBackend>) -> Self {
        Self {
            backend,
            generation_lock: Mutex::new(()),
        }
    }

    pub fn key(&self) -> Result<Zeroizing<Vec<u8>>, KeyStoreError> {
        if let Some(encoded) = self.backend.read()? {
            return decode_key(&encoded);
        }

        // Serialize creation within this process and double-check after taking
        // the lock. Normal application single-instance enforcement provides
        // the corresponding process-level protection.
        let _guard = self
            .generation_lock
            .lock()
            .map_err(|_| KeyStoreError::SynchronizationFailed)?;
        if let Some(encoded) = self.backend.read()? {
            return decode_key(&encoded);
        }

        let mut generated = Zeroizing::new(vec![0_u8; KEY_BYTES]);
        getrandom::getrandom(&mut generated).map_err(|_| KeyStoreError::RandomGenerationFailed)?;

        let encoded = encode_key(&generated);
        self.backend.write(&encoded)?;

        // Read back the credential so a backend serialization problem never
        // leaves the database encrypted with a key that cannot be recovered.
        // This also confirms that the persisted value has the expected format.
        let persisted = self.backend.read()?.ok_or(KeyStoreError::WriteFailed)?;
        let result = decode_key(&persisted)?;
        generated.zeroize();
        Ok(result)
    }
}

fn encode_key(key: &[u8]) -> Zeroizing<Vec<u8>> {
    let payload_len = base64::encoded_len(key.len(), false).unwrap_or(44);
    let mut encoded = Zeroizing::new(vec![0_u8; ENCODING_PREFIX.len() + payload_len]);
    encoded[..ENCODING_PREFIX.len()].copy_from_slice(ENCODING_PREFIX);
    let written = STANDARD_NO_PAD
        .encode_slice(key, &mut encoded[ENCODING_PREFIX.len()..])
        .expect("precomputed base64 output length must be sufficient");
    encoded.truncate(ENCODING_PREFIX.len() + written);
    encoded
}

fn decode_key(encoded: &[u8]) -> Result<Zeroizing<Vec<u8>>, KeyStoreError> {
    let payload = encoded
        .strip_prefix(ENCODING_PREFIX)
        .ok_or(KeyStoreError::InvalidStoredKey)?;
    let mut decoded = Zeroizing::new(Vec::with_capacity(KEY_BYTES));
    STANDARD_NO_PAD
        .decode_vec(payload, &mut decoded)
        .map_err(|_| KeyStoreError::InvalidStoredKey)?;
    if decoded.len() != KEY_BYTES {
        return Err(KeyStoreError::InvalidStoredKey);
    }
    Ok(decoded)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub struct OsCredentialBackend {
    entry: keyring::Entry,
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl OsCredentialBackend {
    fn new() -> Result<Self, KeyStoreError> {
        let entry =
            keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| KeyStoreError::EntryUnavailable)?;
        Ok(Self { entry })
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl CredentialBackend for OsCredentialBackend {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, KeyStoreError> {
        match self.entry.get_secret() {
            Ok(value) => Ok(Some(Zeroizing::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(KeyStoreError::ReadFailed),
        }
    }

    fn write(&self, encoded_key: &[u8]) -> Result<(), KeyStoreError> {
        self.entry
            .set_secret(encoded_key)
            .map_err(|_| KeyStoreError::WriteFailed)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub struct OsCredentialBackend;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl OsCredentialBackend {
    fn new() -> Result<Self, KeyStoreError> {
        Err(KeyStoreError::UnsupportedPlatform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct MockBackend {
        value: Mutex<Option<Vec<u8>>>,
        reads: Mutex<usize>,
        writes: Mutex<usize>,
        fail_read: bool,
        fail_write: bool,
    }

    impl MockBackend {
        fn containing(value: Vec<u8>) -> Self {
            Self {
                value: Mutex::new(Some(value)),
                ..Self::default()
            }
        }
    }

    impl CredentialBackend for MockBackend {
        fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, KeyStoreError> {
            *self.reads.lock().unwrap() += 1;
            if self.fail_read {
                return Err(KeyStoreError::ReadFailed);
            }
            Ok(self.value.lock().unwrap().clone().map(Zeroizing::new))
        }

        fn write(&self, encoded_key: &[u8]) -> Result<(), KeyStoreError> {
            *self.writes.lock().unwrap() += 1;
            if self.fail_write {
                return Err(KeyStoreError::WriteFailed);
            }
            *self.value.lock().unwrap() = Some(encoded_key.to_vec());
            Ok(())
        }
    }

    #[test]
    fn returns_existing_exactly_32_byte_key_without_writing() {
        let expected = vec![0xA5; KEY_BYTES];
        let backend = Arc::new(MockBackend::containing(encode_key(&expected).to_vec()));
        let provider = OsDatabaseKeyProvider::with_backend(backend.clone());

        let actual = provider.key().unwrap();

        assert_eq!(actual.as_slice(), expected);
        assert_eq!(*backend.writes.lock().unwrap(), 0);
    }

    #[test]
    fn generates_persists_and_reads_back_new_key() {
        let backend = Arc::new(MockBackend::default());
        let provider = OsDatabaseKeyProvider::with_backend(backend.clone());

        let first = provider.key().unwrap();
        let second = provider.key().unwrap();

        assert_eq!(first.len(), KEY_BYTES);
        assert_eq!(first.as_slice(), second.as_slice());
        assert_ne!(first.as_slice(), &[0_u8; KEY_BYTES]);
        assert_eq!(*backend.writes.lock().unwrap(), 1);
        assert_eq!(*backend.reads.lock().unwrap(), 4);
    }

    #[test]
    fn rejects_invalid_or_wrong_length_stored_values_without_overwriting() {
        for value in [b"not-versioned".to_vec(), encode_key(&[7_u8; 31]).to_vec()] {
            let backend = Arc::new(MockBackend::containing(value));
            let provider = OsDatabaseKeyProvider::with_backend(backend.clone());

            assert_eq!(provider.key().unwrap_err(), KeyStoreError::InvalidStoredKey);
            assert_eq!(*backend.writes.lock().unwrap(), 0);
        }
    }

    #[test]
    fn maps_backend_failures_without_exposing_backend_details() {
        let read_backend = Arc::new(MockBackend {
            fail_read: true,
            ..MockBackend::default()
        });
        let write_backend = Arc::new(MockBackend {
            fail_write: true,
            ..MockBackend::default()
        });

        assert_eq!(
            OsDatabaseKeyProvider::with_backend(read_backend)
                .key()
                .unwrap_err(),
            KeyStoreError::ReadFailed
        );
        assert_eq!(
            OsDatabaseKeyProvider::with_backend(write_backend)
                .key()
                .unwrap_err(),
            KeyStoreError::WriteFailed
        );
    }
}
