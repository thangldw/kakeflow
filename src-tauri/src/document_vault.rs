//! Encrypted, content-addressed storage for immutable source documents.
//!
//! The vault deliberately does not accept an original filename. Objects are
//! addressed only by the SHA-256 digest of their plaintext and are encrypted
//! with a key dedicated to document storage.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::{Zeroize, Zeroizing};

const MAGIC: &[u8; 8] = b"KFLWDOC\0";
const FORMAT_VERSION: u16 = 1;
const KEY_ID_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;
const FIXED_HEADER_LEN: usize = 8 + 2 + KEY_ID_LEN + 8 + 32 + 2;
const MAX_MIME_LEN: usize = 255;
const FILE_EXTENSION: &str = "kfd";
const HKDF_SALT: &[u8] = b"KakeFlow/document-vault/HKDF-SHA256/salt/v1";
const HKDF_INFO: &[u8] = b"KakeFlow/document-vault/XChaCha20-Poly1305/key/v1";
const KEY_ID_CONTEXT: &[u8] = b"KakeFlow/document-vault/key-id/v1";

/// Sanitized vault errors. No filesystem path, key material, or document
/// content is included in either `Display` or `Debug` output.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum DocumentVaultError {
    #[error("invalid document vault input")]
    InvalidInput,
    #[error("document vault I/O operation failed")]
    Io,
    #[error("document is missing")]
    NotFound,
    #[error("document authentication failed")]
    Authentication,
    #[error("document is corrupt")]
    Corrupt,
    #[error("document vault key derivation failed")]
    KeyDerivation,
}

pub type Result<T> = std::result::Result<T, DocumentVaultError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredDocument {
    pub sha256: String,
    pub plaintext_size: u64,
    pub mime_type: String,
    pub deduplicated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievedDocument {
    pub sha256: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

/// An encrypted immutable document store rooted at an application-controlled
/// directory.
pub struct DocumentVault {
    root: PathBuf,
    document_key: Zeroizing<[u8; 32]>,
    key_id: [u8; KEY_ID_LEN],
}

impl DocumentVault {
    /// Opens a vault and derives a document-only key from the application's
    /// 32-byte master key using versioned HKDF-SHA256 context.
    pub fn new(root: impl AsRef<Path>, master_key: &[u8; 32]) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        secure_directory(&root)?;
        secure_directory(&root.join("objects"))?;

        let hkdf = Hkdf::<Sha256>::new(Some(HKDF_SALT), master_key);
        let mut document_key = Zeroizing::new([0_u8; 32]);
        hkdf.expand(HKDF_INFO, document_key.as_mut())
            .map_err(|_| DocumentVaultError::KeyDerivation)?;

        let mut id_hasher = Sha256::new();
        id_hasher.update(KEY_ID_CONTEXT);
        id_hasher.update(document_key.as_ref());
        let key_id_digest = id_hasher.finalize();
        let mut key_id = [0_u8; KEY_ID_LEN];
        key_id.copy_from_slice(&key_id_digest[..KEY_ID_LEN]);

        Ok(Self {
            root,
            document_key,
            key_id,
        })
    }

    /// Encrypts and stores plaintext. If the same plaintext already exists,
    /// the existing object is authenticated and returned without replacement.
    pub fn put(&self, plaintext: &[u8], mime_type: &str) -> Result<StoredDocument> {
        validate_mime(mime_type)?;
        let plaintext_size =
            u64::try_from(plaintext.len()).map_err(|_| DocumentVaultError::InvalidInput)?;
        let digest: [u8; 32] = Sha256::digest(plaintext).into();
        let hash = encode_hex(&digest);
        let final_path = self.object_path(&hash)?;

        if final_path.exists() {
            return self.authenticate_duplicate(&hash, plaintext);
        }

        let parent = final_path.parent().ok_or(DocumentVaultError::Io)?;
        secure_directory(parent)?;

        let mut nonce = [0_u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce).map_err(|_| DocumentVaultError::Io)?;
        let header = encode_header(&self.key_id, plaintext_size, &digest, mime_type, &nonce)?;
        let cipher = XChaCha20Poly1305::new_from_slice(self.document_key.as_ref())
            .map_err(|_| DocumentVaultError::KeyDerivation)?;
        let ciphertext = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad: &header,
                },
            )
            .map_err(|_| DocumentVaultError::Authentication)?;

        let temp_path = self.temp_path(parent)?;
        let write_result = self.write_and_commit(&temp_path, &final_path, &header, &ciphertext);
        let _ = fs::remove_file(&temp_path);

        match write_result {
            Ok(()) => Ok(StoredDocument {
                sha256: hash,
                plaintext_size,
                mime_type: mime_type.to_owned(),
                deduplicated: false,
            }),
            Err(DocumentVaultError::InvalidInput) if final_path.exists() => {
                self.authenticate_duplicate(&hash, plaintext)
            }
            Err(error) => Err(error),
        }
    }

    /// Authenticates and decrypts a document selected by its plaintext hash.
    pub fn read(&self, hash: &str) -> Result<RetrievedDocument> {
        let normalized_hash = validate_hash(hash)?;
        let path = self.object_path(&normalized_hash)?;
        let metadata = fs::symlink_metadata(&path).map_err(map_read_io)?;
        if !metadata.file_type().is_file() {
            return Err(DocumentVaultError::Corrupt);
        }

        let mut file = File::open(path).map_err(map_read_io)?;
        let file_len = usize::try_from(metadata.len()).map_err(|_| DocumentVaultError::Corrupt)?;
        if file_len < FIXED_HEADER_LEN + NONCE_LEN + TAG_LEN {
            return Err(DocumentVaultError::Corrupt);
        }
        let mut encoded = Vec::with_capacity(file_len);
        file.read_to_end(&mut encoded)
            .map_err(|_| DocumentVaultError::Io)?;
        if encoded.len() != file_len {
            return Err(DocumentVaultError::Corrupt);
        }

        let parsed = parse_header(&encoded)?;
        if parsed.key_id != self.key_id {
            return Err(DocumentVaultError::Authentication);
        }
        let expected_ciphertext_len = usize::try_from(parsed.plaintext_size)
            .map_err(|_| DocumentVaultError::Corrupt)?
            .checked_add(TAG_LEN)
            .ok_or(DocumentVaultError::Corrupt)?;
        if encoded.len().saturating_sub(parsed.header_len) != expected_ciphertext_len {
            return Err(DocumentVaultError::Corrupt);
        }

        let (header, ciphertext) = encoded.split_at(parsed.header_len);
        let cipher = XChaCha20Poly1305::new_from_slice(self.document_key.as_ref())
            .map_err(|_| DocumentVaultError::KeyDerivation)?;
        let plaintext = cipher
            .decrypt(
                XNonce::from_slice(&parsed.nonce),
                Payload {
                    msg: ciphertext,
                    aad: header,
                },
            )
            .map_err(|_| DocumentVaultError::Authentication)?;

        if plaintext.len() as u64 != parsed.plaintext_size {
            return Err(DocumentVaultError::Corrupt);
        }
        let actual_digest: [u8; 32] = Sha256::digest(&plaintext).into();
        if actual_digest != parsed.sha256 || encode_hex(&actual_digest) != normalized_hash {
            return Err(DocumentVaultError::Corrupt);
        }

        Ok(RetrievedDocument {
            sha256: normalized_hash,
            mime_type: parsed.mime_type,
            bytes: plaintext,
        })
    }

    /// Deletes an object. Only an exact 64-character hexadecimal digest is
    /// accepted, so callers cannot use this operation for arbitrary paths.
    pub fn delete(&self, hash: &str) -> Result<()> {
        let normalized_hash = validate_hash(hash)?;
        let path = self.object_path(&normalized_hash)?;
        fs::remove_file(path).map_err(map_read_io)?;
        Ok(())
    }

    fn authenticate_duplicate(&self, hash: &str, expected: &[u8]) -> Result<StoredDocument> {
        let existing = self.read(hash)?;
        if existing.bytes != expected {
            return Err(DocumentVaultError::Corrupt);
        }
        Ok(StoredDocument {
            sha256: existing.sha256,
            plaintext_size: existing.bytes.len() as u64,
            mime_type: existing.mime_type,
            deduplicated: true,
        })
    }

    fn object_path(&self, hash: &str) -> Result<PathBuf> {
        let hash = validate_hash(hash)?;
        Ok(self.root.join("objects").join(&hash[..2]).join(format!(
            "{}.{}",
            &hash[2..],
            FILE_EXTENSION
        )))
    }

    fn temp_path(&self, parent: &Path) -> Result<PathBuf> {
        for _ in 0..16 {
            let mut random = [0_u8; 16];
            getrandom::getrandom(&mut random).map_err(|_| DocumentVaultError::Io)?;
            let candidate = parent.join(format!(".{}.tmp", encode_hex(&random)));
            if !candidate.exists() {
                return Ok(candidate);
            }
        }
        Err(DocumentVaultError::Io)
    }

    fn write_and_commit(
        &self,
        temp_path: &Path,
        final_path: &Path,
        header: &[u8],
        ciphertext: &[u8],
    ) -> Result<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        set_private_file_mode(&mut options);
        let mut temp = options
            .open(temp_path)
            .map_err(|_| DocumentVaultError::Io)?;
        temp.write_all(header).map_err(|_| DocumentVaultError::Io)?;
        temp.write_all(ciphertext)
            .map_err(|_| DocumentVaultError::Io)?;
        temp.sync_all().map_err(|_| DocumentVaultError::Io)?;
        drop(temp);

        // A same-filesystem hard link is an atomic no-replace commit: unlike
        // `rename`, it can never overwrite an immutable destination. The temp
        // object and final object briefly name the same fully-synced inode.
        fs::hard_link(temp_path, final_path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                DocumentVaultError::InvalidInput
            } else {
                DocumentVaultError::Io
            }
        })?;
        fs::remove_file(temp_path).map_err(|_| DocumentVaultError::Io)?;
        sync_parent(final_path)?;
        Ok(())
    }
}

impl Drop for DocumentVault {
    fn drop(&mut self) {
        self.key_id.zeroize();
        // `Zeroizing` clears document_key after this Drop implementation.
    }
}

struct ParsedHeader {
    key_id: [u8; KEY_ID_LEN],
    plaintext_size: u64,
    sha256: [u8; 32],
    mime_type: String,
    nonce: [u8; NONCE_LEN],
    header_len: usize,
}

fn encode_header(
    key_id: &[u8; KEY_ID_LEN],
    plaintext_size: u64,
    sha256: &[u8; 32],
    mime_type: &str,
    nonce: &[u8; NONCE_LEN],
) -> Result<Vec<u8>> {
    validate_mime(mime_type)?;
    let mime_len = u16::try_from(mime_type.len()).map_err(|_| DocumentVaultError::InvalidInput)?;
    let mut header = Vec::with_capacity(FIXED_HEADER_LEN + mime_type.len() + NONCE_LEN);
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&FORMAT_VERSION.to_be_bytes());
    header.extend_from_slice(key_id);
    header.extend_from_slice(&plaintext_size.to_be_bytes());
    header.extend_from_slice(sha256);
    header.extend_from_slice(&mime_len.to_be_bytes());
    header.extend_from_slice(mime_type.as_bytes());
    header.extend_from_slice(nonce);
    Ok(header)
}

fn parse_header(encoded: &[u8]) -> Result<ParsedHeader> {
    if encoded.len() < FIXED_HEADER_LEN + NONCE_LEN + TAG_LEN || &encoded[..8] != MAGIC {
        return Err(DocumentVaultError::Corrupt);
    }
    let version = u16::from_be_bytes([encoded[8], encoded[9]]);
    if version != FORMAT_VERSION {
        return Err(DocumentVaultError::Corrupt);
    }

    let mut cursor = 10;
    let mut key_id = [0_u8; KEY_ID_LEN];
    key_id.copy_from_slice(&encoded[cursor..cursor + KEY_ID_LEN]);
    cursor += KEY_ID_LEN;

    let plaintext_size = u64::from_be_bytes(
        encoded[cursor..cursor + 8]
            .try_into()
            .map_err(|_| DocumentVaultError::Corrupt)?,
    );
    cursor += 8;

    let mut sha256 = [0_u8; 32];
    sha256.copy_from_slice(&encoded[cursor..cursor + 32]);
    cursor += 32;

    let mime_len = u16::from_be_bytes([encoded[cursor], encoded[cursor + 1]]) as usize;
    cursor += 2;
    if mime_len == 0 || mime_len > MAX_MIME_LEN {
        return Err(DocumentVaultError::Corrupt);
    }
    let header_len = cursor
        .checked_add(mime_len)
        .and_then(|length| length.checked_add(NONCE_LEN))
        .ok_or(DocumentVaultError::Corrupt)?;
    if encoded.len() < header_len + TAG_LEN {
        return Err(DocumentVaultError::Corrupt);
    }
    let mime_bytes = &encoded[cursor..cursor + mime_len];
    let mime_type = std::str::from_utf8(mime_bytes)
        .map_err(|_| DocumentVaultError::Corrupt)?
        .to_owned();
    validate_mime(&mime_type).map_err(|_| DocumentVaultError::Corrupt)?;
    cursor += mime_len;

    let mut nonce = [0_u8; NONCE_LEN];
    nonce.copy_from_slice(&encoded[cursor..cursor + NONCE_LEN]);

    Ok(ParsedHeader {
        key_id,
        plaintext_size,
        sha256,
        mime_type,
        nonce,
        header_len,
    })
}

fn validate_mime(mime_type: &str) -> Result<()> {
    if mime_type.is_empty()
        || mime_type.len() > MAX_MIME_LEN
        || !mime_type.is_ascii()
        || mime_type
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        || !mime_type.contains('/')
    {
        return Err(DocumentVaultError::InvalidInput);
    }
    Ok(())
}

fn validate_hash(hash: &str) -> Result<String> {
    if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DocumentVaultError::InvalidInput);
    }
    Ok(hash.to_ascii_lowercase())
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn map_read_io(error: std::io::Error) -> DocumentVaultError {
    if error.kind() == std::io::ErrorKind::NotFound {
        DocumentVaultError::NotFound
    } else {
        DocumentVaultError::Io
    }
}

fn secure_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path).map_err(|_| DocumentVaultError::Io)?;
    set_private_directory_mode(path)
}

#[cfg(unix)]
fn set_private_directory_mode(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| DocumentVaultError::Io)
}

#[cfg(not(unix))]
fn set_private_directory_mode(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_mode(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;

    options.mode(0o600);
}

#[cfg(not(unix))]
fn set_private_file_mode(_options: &mut OpenOptions) {}

#[cfg(unix)]
fn sync_parent(path: &Path) -> Result<()> {
    let parent = path.parent().ok_or(DocumentVaultError::Io)?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| DocumentVaultError::Io)
}

#[cfg(not(unix))]
fn sync_parent(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "kakeflow-vault-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp root");
        path
    }

    fn vault(root: &Path) -> DocumentVault {
        DocumentVault::new(root, &[7_u8; 32]).expect("create vault")
    }

    fn stored_path(root: &Path, hash: &str) -> PathBuf {
        root.join("objects")
            .join(&hash[..2])
            .join(format!("{}.kfd", &hash[2..]))
    }

    #[test]
    fn round_trip() {
        let root = temp_root("roundtrip");
        let vault = vault(&root);
        let stored = vault
            .put(b"financial statement bytes", "application/pdf")
            .expect("store");
        assert!(!stored.deduplicated);
        let retrieved = vault.read(&stored.sha256).expect("read");
        assert_eq!(retrieved.bytes, b"financial statement bytes");
        assert_eq!(retrieved.mime_type, "application/pdf");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn deduplicates_only_after_authentication() {
        let root = temp_root("dedup");
        let vault = vault(&root);
        let first = vault.put(b"same", "text/csv").expect("first");
        let second = vault
            .put(b"same", "application/octet-stream")
            .expect("second");
        assert!(second.deduplicated);
        assert_eq!(second.sha256, first.sha256);
        assert_eq!(second.mime_type, "text/csv");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_tampering() {
        let root = temp_root("tamper");
        let vault = vault(&root);
        let stored = vault.put(b"protected", "text/plain").expect("store");
        let path = stored_path(&root, &stored.sha256);
        let mut bytes = fs::read(&path).expect("read encoded");
        let last = bytes.len() - 1;
        bytes[last] ^= 0x80;
        fs::write(path, bytes).expect("tamper");
        assert_eq!(
            vault.read(&stored.sha256).expect_err("must reject"),
            DocumentVaultError::Authentication
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_truncation() {
        let root = temp_root("truncate");
        let vault = vault(&root);
        let stored = vault.put(b"protected", "text/plain").expect("store");
        let path = stored_path(&root, &stored.sha256);
        let mut bytes = fs::read(&path).expect("read encoded");
        bytes.truncate(bytes.len() - 3);
        fs::write(path, bytes).expect("truncate");
        assert!(matches!(
            vault.read(&stored.sha256),
            Err(DocumentVaultError::Corrupt | DocumentVaultError::Authentication)
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_wrong_key() {
        let root = temp_root("wrong-key");
        let first = vault(&root);
        let stored = first.put(b"secret", "text/plain").expect("store");
        let second = DocumentVault::new(&root, &[9_u8; 32]).expect("other vault");
        assert_eq!(
            second.read(&stored.sha256).expect_err("wrong key"),
            DocumentVaultError::Authentication
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn traversal_hashes_are_rejected_for_read_and_delete() {
        let root = temp_root("traversal");
        let vault = vault(&root);
        for invalid in [
            "../../etc/passwd",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
            "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
            "abc",
        ] {
            assert_eq!(
                vault.read(invalid).expect_err("invalid read"),
                DocumentVaultError::InvalidInput
            );
            assert_eq!(
                vault.delete(invalid).expect_err("invalid delete"),
                DocumentVaultError::InvalidInput
            );
        }
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn ciphertext_does_not_expose_plaintext_names() {
        let root = temp_root("plaintext");
        let vault = vault(&root);
        let secret = b"Merchant=SEVEN-ELEVEN SHINJUKU; Customer=Jane Example";
        let stored = vault.put(secret, "text/plain").expect("store");
        let encoded = fs::read(stored_path(&root, &stored.sha256)).expect("encoded");
        assert!(!encoded
            .windows(b"SEVEN-ELEVEN".len())
            .any(|window| window == b"SEVEN-ELEVEN"));
        assert!(!encoded
            .windows(b"Jane Example".len())
            .any(|window| window == b"Jane Example"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn delete_removes_document() {
        let root = temp_root("delete");
        let vault = vault(&root);
        let stored = vault.put(b"delete me", "text/plain").expect("store");
        vault.delete(&stored.sha256).expect("delete");
        assert_eq!(
            vault.read(&stored.sha256).expect_err("gone"),
            DocumentVaultError::NotFound
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn concurrent_put_never_overwrites_an_immutable_object() {
        let root = temp_root("race");
        let vault = Arc::new(vault(&root));
        let barrier = Arc::new(Barrier::new(8));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let vault = Arc::clone(&vault);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    vault.put(b"one immutable object", "text/plain")
                })
            })
            .collect();
        let results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().expect("thread").expect("put"))
            .collect();
        assert_eq!(
            results.iter().filter(|result| !result.deduplicated).count(),
            1
        );
        assert!(results.iter().skip(1).all(|result| {
            result.sha256 == results[0].sha256
                && vault.read(&result.sha256).expect("read").bytes == b"one immutable object"
        }));
        drop(vault);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn uses_private_unix_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_root("permissions");
        let vault = vault(&root);
        let stored = vault.put(b"private", "text/plain").expect("store");
        let object_path = stored_path(&root, &stored.sha256);
        assert_eq!(
            fs::metadata(&root)
                .expect("root metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(root.join("objects"))
                .expect("objects metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(object_path)
                .expect("object metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::remove_dir_all(root).expect("cleanup");
    }
}
