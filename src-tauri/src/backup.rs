//! Portable, passphrase-protected backups for KakeFlow's local data.
//!
//! The archive contains the already-encrypted SQLCipher database and the
//! already-encrypted document-vault objects. A separate passphrase-derived key
//! protects the archive in transit. Version 1 archives intentionally omit the
//! application master key and therefore remain same-device backups. Version 2
//! archives carry the master key only inside an authenticated, encrypted key
//! capsule so they can be restored on another device.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"KFLWBKP\0";
const FORMAT_VERSION_V1: u16 = 1;
const FORMAT_VERSION_V2: u16 = 2;
const SALT_LEN: usize = 16;
const NONCE_PREFIX_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;
const HEADER_LEN: usize = 8 + 2 + SALT_LEN + NONCE_PREFIX_LEN + 4 + 4 + 4;
const RECORD_HEADER_LEN: usize = 8 + 1 + 4;
const CHUNK_SIZE: usize = 1024 * 1024;
const MAX_PATH_LEN: usize = 1024;
const MAX_RECORD_PLAINTEXT: usize = CHUNK_SIZE + MAX_PATH_LEN + 64;
const ARGON_MEMORY_KIB: u32 = 19 * 1024;
const ARGON_ITERATIONS: u32 = 2;
const ARGON_PARALLELISM: u32 = 1;
const RECORD_ENTRY: u8 = 1;
const RECORD_DATA: u8 = 2;
const RECORD_END: u8 = 3;
const RECORD_KEY_CAPSULE: u8 = 4;
const KEY_CAPSULE_MAGIC: &[u8; 8] = b"KFLWKEY\0";
const KEY_CAPSULE_LEN: usize = KEY_CAPSULE_MAGIC.len() + 32;
const MAX_ARCHIVE_BYTES: u64 = 10 * 1024 * 1024 * 1024;
const MAX_ENTRY_COUNT: u64 = 100_000;
const MAX_RECORD_COUNT: u64 = 1_000_000;
const MAX_TOTAL_PLAINTEXT: u64 = 8 * 1024 * 1024 * 1024;
const MAX_ENTRY_PLAINTEXT: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Clone, Copy)]
struct BackupLimits {
    archive_bytes: u64,
    entries: u64,
    records: u64,
    total_plaintext: u64,
    entry_plaintext: u64,
}

const DEFAULT_LIMITS: BackupLimits = BackupLimits {
    archive_bytes: MAX_ARCHIVE_BYTES,
    entries: MAX_ENTRY_COUNT,
    records: MAX_RECORD_COUNT,
    total_plaintext: MAX_TOTAL_PLAINTEXT,
    entry_plaintext: MAX_ENTRY_PLAINTEXT,
};

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum BackupError {
    #[error("invalid backup input")]
    InvalidInput,
    #[error("backup I/O operation failed")]
    Io,
    #[error("backup already exists")]
    AlreadyExists,
    #[error("backup authentication failed")]
    Authentication,
    #[error("backup archive is corrupt")]
    Corrupt,
    #[error("backup key derivation failed")]
    KeyDerivation,
    #[error("backup exceeds supported resource limits")]
    LimitExceeded,
}

pub type Result<T> = std::result::Result<T, BackupError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupSummary {
    pub entry_count: u64,
    pub plaintext_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SourceEntry {
    source: PathBuf,
    archive_path: String,
    size: u64,
    digest: [u8; 32],
}

/// Creates a new archive without replacing an existing destination.
///
/// `vault_root` is the root passed to `DocumentVault`; only regular files
/// below its `objects` directory are included. Symlinks are rejected. The
/// caller must close the database or checkpoint its WAL before calling this
/// function so `database_path` is a consistent, self-contained SQLCipher file.
pub fn create_backup(
    database_path: impl AsRef<Path>,
    vault_root: impl AsRef<Path>,
    archive_path: impl AsRef<Path>,
    passphrase: &str,
) -> Result<BackupSummary> {
    validate_passphrase(passphrase)?;
    let database_path = database_path.as_ref();
    let vault_root = vault_root.as_ref();
    let archive_path = archive_path.as_ref();
    if archive_path.exists() {
        return Err(BackupError::AlreadyExists);
    }

    let entries = collect_entries(database_path, vault_root, FORMAT_VERSION_V1)?;
    let parent = archive_path.parent().ok_or(BackupError::InvalidInput)?;
    fs::create_dir_all(parent).map_err(|_| BackupError::Io)?;
    let temporary_path = unique_sibling(parent, ".kakeflow-backup", "tmp")?;

    let result = write_archive(
        &temporary_path,
        &entries,
        passphrase,
        FORMAT_VERSION_V1,
        None,
    )
    .and_then(|summary| {
        publish_archive(&temporary_path, archive_path)?;
        sync_directory(parent)?;
        Ok(summary)
    });
    let _ = fs::remove_file(&temporary_path);
    result
}

/// Creates a portable version 2 archive containing an encrypted master-key
/// capsule.
///
/// The capsule is authenticated and encrypted with the passphrase-derived
/// archive key. The raw master key is never written to the archive or to a
/// temporary file. As with [`create_backup`], the caller must first close or
/// checkpoint the SQLCipher database.
pub fn create_portable_backup(
    database_path: impl AsRef<Path>,
    vault_root: impl AsRef<Path>,
    archive_path: impl AsRef<Path>,
    passphrase: &str,
    master_key: &[u8; 32],
) -> Result<BackupSummary> {
    validate_passphrase(passphrase)?;
    let database_path = database_path.as_ref();
    let vault_root = vault_root.as_ref();
    let archive_path = archive_path.as_ref();
    if archive_path.exists() {
        return Err(BackupError::AlreadyExists);
    }

    let entries = collect_entries(database_path, vault_root, FORMAT_VERSION_V2)?;
    let parent = archive_path.parent().ok_or(BackupError::InvalidInput)?;
    fs::create_dir_all(parent).map_err(|_| BackupError::Io)?;
    let temporary_path = unique_sibling(parent, ".kakeflow-backup", "tmp")?;

    let result = write_archive(
        &temporary_path,
        &entries,
        passphrase,
        FORMAT_VERSION_V2,
        Some(master_key),
    )
    .and_then(|summary| {
        publish_archive(&temporary_path, archive_path)?;
        sync_directory(parent)?;
        Ok(summary)
    });
    let _ = fs::remove_file(&temporary_path);
    result
}

/// Restores an archive into a new application-data directory.
///
/// Files are authenticated and written into a sibling staging directory. The
/// completed directory is made visible with one rename, so failed restores do
/// not leave a partial destination. Existing destinations are never replaced.
/// The restored layout is `database/ledger.db` and `vault/objects/...`.
pub fn restore_backup(
    archive_path: impl AsRef<Path>,
    destination_root: impl AsRef<Path>,
    passphrase: &str,
) -> Result<BackupSummary> {
    validate_passphrase(passphrase)?;
    let archive_path = archive_path.as_ref();
    let destination_root = destination_root.as_ref();
    if destination_root.exists() {
        return Err(BackupError::AlreadyExists);
    }
    let parent = destination_root.parent().ok_or(BackupError::InvalidInput)?;
    fs::create_dir_all(parent).map_err(|_| BackupError::Io)?;
    let staging = unique_sibling(parent, ".kakeflow-restore", "staging")?;
    fs::create_dir(&staging).map_err(|_| BackupError::Io)?;

    let result = read_archive(archive_path, &staging, passphrase, RestoreMode::Legacy).and_then(
        |restored| {
            if destination_root.exists() {
                return Err(BackupError::AlreadyExists);
            }
            sync_tree(&staging)?;
            fs::rename(&staging, destination_root).map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    BackupError::AlreadyExists
                } else {
                    BackupError::Io
                }
            })?;
            sync_directory(parent)?;
            Ok(restored.summary)
        },
    );
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Restores a portable version 2 archive and returns its master key in
/// zeroizing memory.
///
/// The key capsule is decrypted in memory and is never materialized under the
/// staging or destination directory. Version 1 archives are deliberately
/// rejected because they contain no key and remain same-device-only backups.
pub fn restore_portable_backup(
    archive_path: impl AsRef<Path>,
    destination_root: impl AsRef<Path>,
    passphrase: &str,
) -> Result<(BackupSummary, Zeroizing<[u8; 32]>)> {
    validate_passphrase(passphrase)?;
    let archive_path = archive_path.as_ref();
    let destination_root = destination_root.as_ref();
    if destination_root.exists() {
        return Err(BackupError::AlreadyExists);
    }
    let parent = destination_root.parent().ok_or(BackupError::InvalidInput)?;
    fs::create_dir_all(parent).map_err(|_| BackupError::Io)?;
    let staging = unique_sibling(parent, ".kakeflow-restore", "staging")?;
    fs::create_dir(&staging).map_err(|_| BackupError::Io)?;

    let result = read_archive(archive_path, &staging, passphrase, RestoreMode::Portable).and_then(
        |restored| {
            let master_key = restored.master_key.ok_or(BackupError::Corrupt)?;
            if destination_root.exists() {
                return Err(BackupError::AlreadyExists);
            }
            sync_tree(&staging)?;
            fs::rename(&staging, destination_root).map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    BackupError::AlreadyExists
                } else {
                    BackupError::Io
                }
            })?;
            sync_directory(parent)?;
            Ok((restored.summary, master_key))
        },
    );
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn collect_entries(
    database_path: &Path,
    vault_root: &Path,
    format_version: u16,
) -> Result<Vec<SourceEntry>> {
    let metadata = fs::symlink_metadata(database_path).map_err(|_| BackupError::Io)?;
    if !metadata.file_type().is_file() {
        return Err(BackupError::InvalidInput);
    }
    let database_name = match format_version {
        FORMAT_VERSION_V1 => "database/ledger.db",
        FORMAT_VERSION_V2 => "database/kakeflow.db",
        _ => return Err(BackupError::InvalidInput),
    };
    let mut entries = vec![source_entry(database_path, database_name.to_owned())?];

    let objects = vault_root.join("objects");
    if objects.exists() {
        collect_vault_files(&objects, &objects, &mut entries)?;
    }
    validate_source_entries(&entries, format_version, DEFAULT_LIMITS)?;
    entries.sort_by(|left, right| left.archive_path.cmp(&right.archive_path));
    Ok(entries)
}

fn collect_vault_files(
    root: &Path,
    directory: &Path,
    entries: &mut Vec<SourceEntry>,
) -> Result<()> {
    let metadata = fs::symlink_metadata(directory).map_err(|_| BackupError::Io)?;
    if !metadata.file_type().is_dir() {
        return Err(BackupError::InvalidInput);
    }
    let mut children = fs::read_dir(directory)
        .map_err(|_| BackupError::Io)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| BackupError::Io)?;
    children.sort_by_key(|entry| entry.file_name());

    for child in children {
        let path = child.path();
        let metadata = fs::symlink_metadata(&path).map_err(|_| BackupError::Io)?;
        if metadata.file_type().is_symlink() {
            return Err(BackupError::InvalidInput);
        }
        if metadata.file_type().is_dir() {
            collect_vault_files(root, &path, entries)?;
        } else if metadata.file_type().is_file() {
            if entries.len() as u64 >= DEFAULT_LIMITS.entries {
                return Err(BackupError::LimitExceeded);
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| BackupError::InvalidInput)?;
            let relative = portable_relative_path(relative)?;
            entries.push(source_entry(&path, format!("vault/objects/{relative}"))?);
        } else {
            return Err(BackupError::InvalidInput);
        }
    }
    Ok(())
}

fn source_entry(source: &Path, archive_path: String) -> Result<SourceEntry> {
    validate_archive_path(&archive_path)?;
    let metadata = fs::symlink_metadata(source).map_err(|_| BackupError::Io)?;
    if !metadata.file_type().is_file() {
        return Err(BackupError::InvalidInput);
    }
    if metadata.len() > DEFAULT_LIMITS.entry_plaintext {
        return Err(BackupError::LimitExceeded);
    }
    let mut file = File::open(source).map_err(|_| BackupError::Io)?;
    let mut hasher = Sha256::new();
    let size = std::io::copy(&mut file, &mut hasher).map_err(|_| BackupError::Io)?;
    Ok(SourceEntry {
        source: source.to_path_buf(),
        archive_path,
        size,
        digest: hasher.finalize().into(),
    })
}

fn validate_source_entries(
    entries: &[SourceEntry],
    format_version: u16,
    limits: BackupLimits,
) -> Result<()> {
    if entries.len() as u64 > limits.entries {
        return Err(BackupError::LimitExceeded);
    }
    let mut total = 0_u64;
    let mut records = if format_version == FORMAT_VERSION_V2 {
        1_u64
    } else {
        0_u64
    };
    for entry in entries {
        let (_, next_total) = enforce_new_entry_limits(
            0,
            total,
            entry.size,
            BackupLimits {
                entries: u64::MAX,
                ..limits
            },
        )?;
        total = next_total;
        let chunks = entry.size.div_ceil(CHUNK_SIZE as u64);
        records = records
            .checked_add(1)
            .and_then(|value| value.checked_add(chunks))
            .ok_or(BackupError::LimitExceeded)?;
    }
    // Every archive ends with one authenticated summary record.
    records = records.checked_add(1).ok_or(BackupError::LimitExceeded)?;
    if records > limits.records {
        return Err(BackupError::LimitExceeded);
    }
    Ok(())
}

fn write_archive(
    path: &Path,
    entries: &[SourceEntry],
    passphrase: &str,
    format_version: u16,
    master_key: Option<&[u8; 32]>,
) -> Result<BackupSummary> {
    match (format_version, master_key) {
        (FORMAT_VERSION_V1, None) | (FORMAT_VERSION_V2, Some(_)) => {}
        _ => return Err(BackupError::InvalidInput),
    }
    let mut salt = [0_u8; SALT_LEN];
    let mut nonce_prefix = [0_u8; NONCE_PREFIX_LEN];
    getrandom::getrandom(&mut salt).map_err(|_| BackupError::Io)?;
    getrandom::getrandom(&mut nonce_prefix).map_err(|_| BackupError::Io)?;
    let header = encode_header(format_version, &salt, &nonce_prefix)?;
    let key = derive_key(
        passphrase,
        &salt,
        ARGON_MEMORY_KIB,
        ARGON_ITERATIONS,
        ARGON_PARALLELISM,
    )?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| BackupError::KeyDerivation)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| BackupError::Io)?;
    output.write_all(&header).map_err(|_| BackupError::Io)?;

    let mut index = 0_u64;
    if let Some(master_key) = master_key {
        let mut capsule = Zeroizing::new(Vec::with_capacity(KEY_CAPSULE_LEN));
        capsule.extend_from_slice(KEY_CAPSULE_MAGIC);
        capsule.extend_from_slice(master_key);
        write_record(
            &mut output,
            &cipher,
            &header,
            &nonce_prefix,
            index,
            RECORD_KEY_CAPSULE,
            &capsule,
        )?;
        index = index.checked_add(1).ok_or(BackupError::InvalidInput)?;
    }
    let mut total_bytes = 0_u64;
    for entry in entries {
        let metadata = encode_entry(entry)?;
        write_record(
            &mut output,
            &cipher,
            &header,
            &nonce_prefix,
            index,
            RECORD_ENTRY,
            &metadata,
        )?;
        index = index.checked_add(1).ok_or(BackupError::InvalidInput)?;

        let mut input = File::open(&entry.source).map_err(|_| BackupError::Io)?;
        let mut remaining = entry.size;
        let mut buffer = vec![0_u8; CHUNK_SIZE];
        while remaining > 0 {
            let wanted = usize::try_from(remaining.min(CHUNK_SIZE as u64))
                .map_err(|_| BackupError::InvalidInput)?;
            input
                .read_exact(&mut buffer[..wanted])
                .map_err(|_| BackupError::Io)?;
            write_record(
                &mut output,
                &cipher,
                &header,
                &nonce_prefix,
                index,
                RECORD_DATA,
                &buffer[..wanted],
            )?;
            index = index.checked_add(1).ok_or(BackupError::InvalidInput)?;
            remaining -= wanted as u64;
        }
        total_bytes = total_bytes
            .checked_add(entry.size)
            .ok_or(BackupError::InvalidInput)?;
    }
    let mut end = Vec::with_capacity(16);
    end.extend_from_slice(&(entries.len() as u64).to_le_bytes());
    end.extend_from_slice(&total_bytes.to_le_bytes());
    write_record(
        &mut output,
        &cipher,
        &header,
        &nonce_prefix,
        index,
        RECORD_END,
        &end,
    )?;
    output.sync_all().map_err(|_| BackupError::Io)?;

    Ok(BackupSummary {
        entry_count: entries.len() as u64,
        plaintext_bytes: total_bytes,
    })
}

#[allow(clippy::too_many_arguments)]
fn write_record(
    output: &mut File,
    cipher: &XChaCha20Poly1305,
    archive_header: &[u8],
    nonce_prefix: &[u8; NONCE_PREFIX_LEN],
    index: u64,
    record_type: u8,
    plaintext: &[u8],
) -> Result<()> {
    let ciphertext_len = plaintext
        .len()
        .checked_add(TAG_LEN)
        .ok_or(BackupError::InvalidInput)?;
    let ciphertext_len = u32::try_from(ciphertext_len).map_err(|_| BackupError::InvalidInput)?;
    let record_header = encode_record_header(index, record_type, ciphertext_len);
    let aad = [archive_header, record_header.as_slice()].concat();
    let nonce = record_nonce(nonce_prefix, index);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| BackupError::Authentication)?;
    output
        .write_all(&record_header)
        .map_err(|_| BackupError::Io)?;
    output.write_all(&ciphertext).map_err(|_| BackupError::Io)?;
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RestoreMode {
    Legacy,
    Portable,
}

struct RestoredArchive {
    summary: BackupSummary,
    master_key: Option<Zeroizing<[u8; 32]>>,
}

fn read_archive(
    path: &Path,
    staging: &Path,
    passphrase: &str,
    mode: RestoreMode,
) -> Result<RestoredArchive> {
    read_archive_with_limits(path, staging, passphrase, mode, DEFAULT_LIMITS)
}

fn read_archive_with_limits(
    path: &Path,
    staging: &Path,
    passphrase: &str,
    mode: RestoreMode,
    limits: BackupLimits,
) -> Result<RestoredArchive> {
    let metadata = fs::symlink_metadata(path).map_err(|_| BackupError::Io)?;
    if !metadata.file_type().is_file() {
        return Err(BackupError::InvalidInput);
    }
    if metadata.len() > limits.archive_bytes {
        return Err(BackupError::LimitExceeded);
    }
    let mut input = File::open(path).map_err(|_| BackupError::Io)?;
    let mut header = [0_u8; HEADER_LEN];
    input
        .read_exact(&mut header)
        .map_err(map_archive_read_error)?;
    let decoded = decode_header(&header)?;
    let expected_version = match mode {
        RestoreMode::Legacy => FORMAT_VERSION_V1,
        RestoreMode::Portable => FORMAT_VERSION_V2,
    };
    if decoded.version != expected_version {
        return Err(BackupError::Corrupt);
    }
    let key = derive_key(
        passphrase,
        &decoded.salt,
        decoded.memory_kib,
        decoded.iterations,
        decoded.parallelism,
    )?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| BackupError::KeyDerivation)?;

    let mut index = 0_u64;
    let mut active: Option<RestoreEntry> = None;
    let mut entry_count = 0_u64;
    let mut total_bytes = 0_u64;
    let mut master_key = None;
    let mut database_seen = false;
    loop {
        if index >= limits.records {
            return Err(BackupError::LimitExceeded);
        }
        let (record_type, plaintext) =
            read_record(&mut input, &cipher, &header, &decoded.nonce_prefix, index)?;
        index = index.checked_add(1).ok_or(BackupError::Corrupt)?;
        match record_type {
            RECORD_KEY_CAPSULE => {
                if mode != RestoreMode::Portable
                    || index != 1
                    || active.is_some()
                    || master_key.is_some()
                    || plaintext.len() != KEY_CAPSULE_LEN
                    || &plaintext[..KEY_CAPSULE_MAGIC.len()] != KEY_CAPSULE_MAGIC
                {
                    return Err(BackupError::Corrupt);
                }
                let mut key = Zeroizing::new([0_u8; 32]);
                key.copy_from_slice(&plaintext[KEY_CAPSULE_MAGIC.len()..]);
                master_key = Some(key);
            }
            RECORD_ENTRY => {
                if mode == RestoreMode::Portable && master_key.is_none() {
                    return Err(BackupError::Corrupt);
                }
                finish_entry(active.take())?;
                let entry = decode_entry(&plaintext)?;
                let expected_database_path = match mode {
                    RestoreMode::Legacy => "database/ledger.db",
                    RestoreMode::Portable => "database/kakeflow.db",
                };
                if entry.path.starts_with("database/") {
                    if database_seen || entry.path != expected_database_path {
                        return Err(BackupError::Corrupt);
                    }
                    database_seen = true;
                }
                let target = safe_destination(staging, &entry.path)?;
                enforce_new_entry_limits(entry_count, total_bytes, entry.size, limits)?;
                if target.exists() {
                    return Err(BackupError::Corrupt);
                }
                let parent = target.parent().ok_or(BackupError::Corrupt)?;
                fs::create_dir_all(parent).map_err(|_| BackupError::Io)?;
                let file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(target)
                    .map_err(|_| BackupError::Io)?;
                active = Some(RestoreEntry {
                    file,
                    expected_size: entry.size,
                    expected_digest: entry.digest,
                    written: 0,
                    hasher: Sha256::new(),
                });
            }
            RECORD_DATA => {
                if plaintext.is_empty() {
                    return Err(BackupError::Corrupt);
                }
                let entry = active.as_mut().ok_or(BackupError::Corrupt)?;
                entry.written = entry
                    .written
                    .checked_add(plaintext.len() as u64)
                    .ok_or(BackupError::Corrupt)?;
                if entry.written > entry.expected_size {
                    return Err(BackupError::Corrupt);
                }
                entry
                    .file
                    .write_all(&plaintext)
                    .map_err(|_| BackupError::Io)?;
                entry.hasher.update(&plaintext);
            }
            RECORD_END => {
                finish_entry(active.take())?;
                if plaintext.len() != 16 {
                    return Err(BackupError::Corrupt);
                }
                let expected_entries = u64::from_le_bytes(
                    plaintext[..8]
                        .try_into()
                        .map_err(|_| BackupError::Corrupt)?,
                );
                let expected_bytes = u64::from_le_bytes(
                    plaintext[8..]
                        .try_into()
                        .map_err(|_| BackupError::Corrupt)?,
                );
                if expected_entries != entry_count
                    || expected_bytes != total_bytes
                    || !database_seen
                {
                    return Err(BackupError::Corrupt);
                }
                let mut trailing = [0_u8; 1];
                if input.read(&mut trailing).map_err(|_| BackupError::Io)? != 0 {
                    return Err(BackupError::Corrupt);
                }
                if mode == RestoreMode::Portable && master_key.is_none() {
                    return Err(BackupError::Corrupt);
                }
                return Ok(RestoredArchive {
                    summary: BackupSummary {
                        entry_count,
                        plaintext_bytes: total_bytes,
                    },
                    master_key,
                });
            }
            _ => return Err(BackupError::Corrupt),
        }
        if record_type == RECORD_ENTRY {
            entry_count = entry_count.checked_add(1).ok_or(BackupError::Corrupt)?;
            let entry = active.as_ref().ok_or(BackupError::Corrupt)?;
            total_bytes = total_bytes
                .checked_add(entry.expected_size)
                .ok_or(BackupError::Corrupt)?;
        }
    }
}

fn enforce_new_entry_limits(
    entry_count: u64,
    total_bytes: u64,
    entry_size: u64,
    limits: BackupLimits,
) -> Result<(u64, u64)> {
    let next_count = entry_count
        .checked_add(1)
        .ok_or(BackupError::LimitExceeded)?;
    let next_total = total_bytes
        .checked_add(entry_size)
        .ok_or(BackupError::LimitExceeded)?;
    if next_count > limits.entries
        || entry_size > limits.entry_plaintext
        || next_total > limits.total_plaintext
    {
        return Err(BackupError::LimitExceeded);
    }
    Ok((next_count, next_total))
}

struct RestoreEntry {
    file: File,
    expected_size: u64,
    expected_digest: [u8; 32],
    written: u64,
    hasher: Sha256,
}

fn finish_entry(entry: Option<RestoreEntry>) -> Result<()> {
    if let Some(mut entry) = entry {
        if entry.written != entry.expected_size {
            return Err(BackupError::Corrupt);
        }
        let digest: [u8; 32] = entry.hasher.finalize().into();
        if digest != entry.expected_digest {
            return Err(BackupError::Corrupt);
        }
        entry.file.flush().map_err(|_| BackupError::Io)?;
        entry.file.sync_all().map_err(|_| BackupError::Io)?;
    }
    Ok(())
}

fn read_record(
    input: &mut File,
    cipher: &XChaCha20Poly1305,
    archive_header: &[u8],
    nonce_prefix: &[u8; NONCE_PREFIX_LEN],
    expected_index: u64,
) -> Result<(u8, Zeroizing<Vec<u8>>)> {
    let mut encoded_header = [0_u8; RECORD_HEADER_LEN];
    input
        .read_exact(&mut encoded_header)
        .map_err(map_archive_read_error)?;
    let index = u64::from_le_bytes(
        encoded_header[..8]
            .try_into()
            .map_err(|_| BackupError::Corrupt)?,
    );
    if index != expected_index {
        return Err(BackupError::Corrupt);
    }
    let record_type = encoded_header[8];
    let ciphertext_len = u32::from_le_bytes(
        encoded_header[9..]
            .try_into()
            .map_err(|_| BackupError::Corrupt)?,
    ) as usize;
    if !(TAG_LEN..=MAX_RECORD_PLAINTEXT + TAG_LEN).contains(&ciphertext_len) {
        return Err(BackupError::Corrupt);
    }
    let mut ciphertext = vec![0_u8; ciphertext_len];
    input
        .read_exact(&mut ciphertext)
        .map_err(map_archive_read_error)?;
    let aad = [archive_header, encoded_header.as_slice()].concat();
    let nonce = record_nonce(nonce_prefix, index);
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| BackupError::Authentication)?;
    Ok((record_type, Zeroizing::new(plaintext)))
}

struct DecodedHeader {
    version: u16,
    salt: [u8; SALT_LEN],
    nonce_prefix: [u8; NONCE_PREFIX_LEN],
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
}

fn encode_header(
    version: u16,
    salt: &[u8; SALT_LEN],
    nonce_prefix: &[u8; NONCE_PREFIX_LEN],
) -> Result<Vec<u8>> {
    if !matches!(version, FORMAT_VERSION_V1 | FORMAT_VERSION_V2) {
        return Err(BackupError::InvalidInput);
    }
    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&version.to_le_bytes());
    header.extend_from_slice(salt);
    header.extend_from_slice(nonce_prefix);
    header.extend_from_slice(&ARGON_MEMORY_KIB.to_le_bytes());
    header.extend_from_slice(&ARGON_ITERATIONS.to_le_bytes());
    header.extend_from_slice(&ARGON_PARALLELISM.to_le_bytes());
    Ok(header)
}

fn decode_header(header: &[u8; HEADER_LEN]) -> Result<DecodedHeader> {
    if &header[..8] != MAGIC {
        return Err(BackupError::Corrupt);
    }
    let version = u16::from_le_bytes(header[8..10].try_into().map_err(|_| BackupError::Corrupt)?);
    if !matches!(version, FORMAT_VERSION_V1 | FORMAT_VERSION_V2) {
        return Err(BackupError::Corrupt);
    }
    let salt = header[10..26]
        .try_into()
        .map_err(|_| BackupError::Corrupt)?;
    let nonce_prefix = header[26..42]
        .try_into()
        .map_err(|_| BackupError::Corrupt)?;
    let memory_kib = u32::from_le_bytes(
        header[42..46]
            .try_into()
            .map_err(|_| BackupError::Corrupt)?,
    );
    let iterations = u32::from_le_bytes(
        header[46..50]
            .try_into()
            .map_err(|_| BackupError::Corrupt)?,
    );
    let parallelism = u32::from_le_bytes(
        header[50..54]
            .try_into()
            .map_err(|_| BackupError::Corrupt)?,
    );
    // Version 1 has one fixed KDF profile. Reject attacker-controlled work
    // factors before attempting authentication and bump the format version if
    // the profile changes in a future release.
    if memory_kib != ARGON_MEMORY_KIB
        || iterations != ARGON_ITERATIONS
        || parallelism != ARGON_PARALLELISM
    {
        return Err(BackupError::Corrupt);
    }
    Ok(DecodedHeader {
        version,
        salt,
        nonce_prefix,
        memory_kib,
        iterations,
        parallelism,
    })
}

fn derive_key(
    passphrase: &str,
    salt: &[u8; SALT_LEN],
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<Zeroizing<[u8; 32]>> {
    let params = Params::new(memory_kib, iterations, parallelism, Some(32))
        .map_err(|_| BackupError::KeyDerivation)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0_u8; 32]);
    argon
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|_| BackupError::KeyDerivation)?;
    Ok(key)
}

fn encode_record_header(index: u64, record_type: u8, ciphertext_len: u32) -> Vec<u8> {
    let mut header = Vec::with_capacity(RECORD_HEADER_LEN);
    header.extend_from_slice(&index.to_le_bytes());
    header.push(record_type);
    header.extend_from_slice(&ciphertext_len.to_le_bytes());
    header
}

fn record_nonce(prefix: &[u8; NONCE_PREFIX_LEN], index: u64) -> [u8; NONCE_LEN] {
    let mut nonce = [0_u8; NONCE_LEN];
    nonce[..NONCE_PREFIX_LEN].copy_from_slice(prefix);
    nonce[NONCE_PREFIX_LEN..].copy_from_slice(&index.to_le_bytes());
    nonce
}

fn encode_entry(entry: &SourceEntry) -> Result<Vec<u8>> {
    let path = entry.archive_path.as_bytes();
    let path_len = u16::try_from(path.len()).map_err(|_| BackupError::InvalidInput)?;
    let mut encoded = Vec::with_capacity(2 + path.len() + 8 + 32);
    encoded.extend_from_slice(&path_len.to_le_bytes());
    encoded.extend_from_slice(path);
    encoded.extend_from_slice(&entry.size.to_le_bytes());
    encoded.extend_from_slice(&entry.digest);
    Ok(encoded)
}

struct DecodedEntry {
    path: String,
    size: u64,
    digest: [u8; 32],
}

fn decode_entry(encoded: &[u8]) -> Result<DecodedEntry> {
    if encoded.len() < 2 + 8 + 32 {
        return Err(BackupError::Corrupt);
    }
    let path_len =
        u16::from_le_bytes(encoded[..2].try_into().map_err(|_| BackupError::Corrupt)?) as usize;
    if path_len == 0 || path_len > MAX_PATH_LEN || encoded.len() != 2 + path_len + 8 + 32 {
        return Err(BackupError::Corrupt);
    }
    let path = std::str::from_utf8(&encoded[2..2 + path_len])
        .map_err(|_| BackupError::Corrupt)?
        .to_owned();
    validate_archive_path(&path)?;
    let size_start = 2 + path_len;
    let size = u64::from_le_bytes(
        encoded[size_start..size_start + 8]
            .try_into()
            .map_err(|_| BackupError::Corrupt)?,
    );
    let digest = encoded[size_start + 8..]
        .try_into()
        .map_err(|_| BackupError::Corrupt)?;
    Ok(DecodedEntry { path, size, digest })
}

fn validate_archive_path(path: &str) -> Result<()> {
    if path.is_empty() || path.len() > MAX_PATH_LEN || path.contains('\\') || path.contains('\0') {
        return Err(BackupError::Corrupt);
    }
    let parsed = Path::new(path);
    if parsed.is_absolute()
        || parsed
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(BackupError::Corrupt);
    }
    let valid_database = matches!(path, "database/ledger.db" | "database/kakeflow.db");
    let valid_vault = path.starts_with("vault/objects/") && path.len() > "vault/objects/".len();
    if !valid_database && !valid_vault {
        return Err(BackupError::Corrupt);
    }
    Ok(())
}

fn safe_destination(root: &Path, archive_path: &str) -> Result<PathBuf> {
    validate_archive_path(archive_path)?;
    Ok(root.join(archive_path))
}

fn portable_relative_path(path: &Path) -> Result<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                parts.push(value.to_str().ok_or(BackupError::InvalidInput)?)
            }
            _ => return Err(BackupError::InvalidInput),
        }
    }
    if parts.is_empty() {
        return Err(BackupError::InvalidInput);
    }
    Ok(parts.join("/"))
}

fn validate_passphrase(passphrase: &str) -> Result<()> {
    if passphrase.len() < 12 || passphrase.len() > 1024 {
        return Err(BackupError::InvalidInput);
    }
    Ok(())
}

fn unique_sibling(parent: &Path, prefix: &str, extension: &str) -> Result<PathBuf> {
    for _ in 0..32 {
        let mut random = [0_u8; 16];
        getrandom::getrandom(&mut random).map_err(|_| BackupError::Io)?;
        let name = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let candidate = parent.join(format!("{prefix}-{name}.{extension}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(BackupError::Io)
}

fn publish_archive(temporary_path: &Path, archive_path: &Path) -> Result<()> {
    match fs::hard_link(temporary_path, archive_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(BackupError::AlreadyExists)
        }
        Err(_) => {
            // FAT/exFAT, some network shares, and virtual folders do not support
            // hard links. Copy the already-complete archive through an exclusive
            // destination handle and remove any partial copy on failure.
            let mut created_destination = false;
            let result = (|| {
                let mut source = File::open(temporary_path).map_err(|_| BackupError::Io)?;
                let mut destination = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(archive_path)
                    .map_err(|error| {
                        if error.kind() == std::io::ErrorKind::AlreadyExists {
                            BackupError::AlreadyExists
                        } else {
                            BackupError::Io
                        }
                    })?;
                created_destination = true;
                std::io::copy(&mut source, &mut destination).map_err(|_| BackupError::Io)?;
                destination.sync_all().map_err(|_| BackupError::Io)
            })();
            if result.is_err() && created_destination {
                let _ = fs::remove_file(archive_path);
            }
            result
        }
    }
}

fn map_archive_read_error(error: std::io::Error) -> BackupError {
    if error.kind() == std::io::ErrorKind::UnexpectedEof {
        BackupError::Corrupt
    } else {
        BackupError::Io
    }
}

fn sync_tree(root: &Path) -> Result<()> {
    let mut directories = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        directories.push(directory.clone());
        for entry in fs::read_dir(&directory).map_err(|_| BackupError::Io)? {
            let entry = entry.map_err(|_| BackupError::Io)?;
            if entry.file_type().map_err(|_| BackupError::Io)?.is_dir() {
                pending.push(entry.path());
            }
        }
    }
    for directory in directories.into_iter().rev() {
        sync_directory(&directory)?;
    }
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<()> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| BackupError::Io)
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<()> {
    // Windows does not support opening directories through `std::fs::File`.
    // Every staged regular file is synced before the final directory rename.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("kakeflow-backup-test-{}", unique_name()));
            fs::create_dir(&root).expect("create test root");
            Self(root)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn unique_name() -> String {
        let mut bytes = [0_u8; 12];
        getrandom::getrandom(&mut bytes).expect("random test name");
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn fixture() -> (TestDir, PathBuf, PathBuf) {
        let root = TestDir::new();
        let database = root.0.join("source/ledger.db");
        let vault = root.0.join("source/vault");
        fs::create_dir_all(vault.join("objects/ab")).expect("vault directories");
        fs::create_dir_all(database.parent().expect("database parent")).expect("database dir");
        fs::write(&database, b"encrypted sqlcipher bytes").expect("database fixture");
        fs::write(vault.join("objects/ab/cdef.kfd"), b"encrypted document").expect("vault fixture");
        (root, database, vault)
    }

    fn restore_staging_count(root: &Path) -> usize {
        fs::read_dir(root)
            .expect("test root")
            .filter_map(std::result::Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".kakeflow-restore")
            })
            .count()
    }

    #[test]
    fn entry_limits_reject_count_size_and_aggregate_overflow_before_writes() {
        let limits = BackupLimits {
            archive_bytes: 1024,
            entries: 2,
            records: 8,
            total_plaintext: 10,
            entry_plaintext: 8,
        };

        assert_eq!(enforce_new_entry_limits(0, 0, 8, limits), Ok((1, 8)));
        assert_eq!(
            enforce_new_entry_limits(2, 0, 1, limits),
            Err(BackupError::LimitExceeded)
        );
        assert_eq!(
            enforce_new_entry_limits(0, 0, 9, limits),
            Err(BackupError::LimitExceeded)
        );
        assert_eq!(
            enforce_new_entry_limits(1, 8, 3, limits),
            Err(BackupError::LimitExceeded)
        );
        assert_eq!(
            enforce_new_entry_limits(u64::MAX, 0, 0, limits),
            Err(BackupError::LimitExceeded)
        );
    }

    #[test]
    fn oversized_archive_is_rejected_before_parsing_or_staging() {
        let root = TestDir::new();
        let archive = root.0.join("oversized.kfb");
        let file = File::create(&archive).expect("sparse archive");
        file.set_len(MAX_ARCHIVE_BYTES + 1)
            .expect("extend sparse archive");
        drop(file);
        let destination = root.0.join("restored");

        assert_eq!(
            restore_backup(&archive, &destination, "correct horse battery staple"),
            Err(BackupError::LimitExceeded)
        );
        assert!(!destination.exists());
        assert_eq!(restore_staging_count(&root.0), 0);
    }

    #[test]
    fn round_trip_restores_database_and_vault() {
        let (root, database, vault) = fixture();
        let archive = root.0.join("portable.kfb");
        let destination = root.0.join("restored");

        let created = create_backup(&database, &vault, &archive, "correct horse battery staple")
            .expect("create backup");
        let restored = restore_backup(&archive, &destination, "correct horse battery staple")
            .expect("restore backup");

        assert_eq!(created, restored);
        assert_eq!(created.entry_count, 2);
        assert_eq!(
            fs::read(destination.join("database/ledger.db")).expect("restored database"),
            b"encrypted sqlcipher bytes"
        );
        assert_eq!(
            fs::read(destination.join("vault/objects/ab/cdef.kfd")).expect("restored vault"),
            b"encrypted document"
        );
    }

    #[test]
    fn wrong_passphrase_leaves_no_destination_or_staging_directory() {
        let (root, database, vault) = fixture();
        let archive = root.0.join("portable.kfb");
        let destination = root.0.join("restored");
        create_backup(&database, &vault, &archive, "correct horse battery staple")
            .expect("create backup");

        assert_eq!(
            restore_backup(&archive, &destination, "wrong passphrase is long enough"),
            Err(BackupError::Authentication)
        );
        assert!(!destination.exists());
        assert_eq!(restore_staging_count(&root.0), 0);
    }

    #[test]
    fn tampering_is_authenticated() {
        let (root, database, vault) = fixture();
        let archive = root.0.join("portable.kfb");
        create_backup(&database, &vault, &archive, "correct horse battery staple")
            .expect("create backup");
        let mut bytes = fs::read(&archive).expect("archive");
        let tamper_at = HEADER_LEN + RECORD_HEADER_LEN + 4;
        bytes[tamper_at] ^= 0x80;
        fs::write(&archive, bytes).expect("tamper archive");

        assert_eq!(
            restore_backup(
                &archive,
                root.0.join("restored"),
                "correct horse battery staple"
            ),
            Err(BackupError::Authentication)
        );
    }

    #[test]
    fn existing_archive_and_restore_are_not_replaced() {
        let (root, database, vault) = fixture();
        let archive = root.0.join("portable.kfb");
        fs::write(&archive, b"keep me").expect("existing archive");
        assert_eq!(
            create_backup(&database, &vault, &archive, "correct horse battery staple"),
            Err(BackupError::AlreadyExists)
        );
        assert_eq!(fs::read(&archive).expect("existing archive"), b"keep me");

        let destination = root.0.join("restored");
        fs::create_dir(&destination).expect("existing destination");
        fs::write(destination.join("keep"), b"safe").expect("destination marker");
        assert_eq!(
            restore_backup(&archive, &destination, "correct horse battery staple"),
            Err(BackupError::AlreadyExists)
        );
        assert_eq!(fs::read(destination.join("keep")).expect("marker"), b"safe");
    }

    #[test]
    fn traversal_and_non_backup_paths_are_rejected() {
        for path in [
            "../ledger.db",
            "/database/ledger.db",
            "vault/objects/../../secret",
            "vault\\objects\\secret",
            "other/file",
            "database/other.db",
        ] {
            assert_eq!(
                validate_archive_path(path),
                Err(BackupError::Corrupt),
                "{path}"
            );
        }
        assert!(validate_archive_path("database/ledger.db").is_ok());
        assert!(validate_archive_path("database/kakeflow.db").is_ok());
        assert!(validate_archive_path("vault/objects/ab/cdef.kfd").is_ok());
    }

    #[test]
    fn portable_round_trip_recovers_cross_device_master_key_in_memory() {
        let (root, database, vault) = fixture();
        let archive = root.0.join("portable-v2.kfb");
        let destination = root.0.join("restored-v2");
        let source_device_key = [0x4d_u8; 32];
        let unrelated_destination_device_key = [0xa7_u8; 32];
        assert_ne!(source_device_key, unrelated_destination_device_key);

        let created = create_portable_backup(
            &database,
            &vault,
            &archive,
            "portable correct horse battery staple",
            &source_device_key,
        )
        .expect("create v2 backup");
        let (restored, recovered_key) = restore_portable_backup(
            &archive,
            &destination,
            "portable correct horse battery staple",
        )
        .expect("restore v2 backup");

        assert_eq!(created, restored);
        assert_eq!(recovered_key.as_ref(), &source_device_key);
        assert_ne!(recovered_key.as_ref(), &unrelated_destination_device_key);
        assert_eq!(
            fs::read(destination.join("database/kakeflow.db")).expect("restored v2 database"),
            b"encrypted sqlcipher bytes"
        );
        assert!(!destination.join("database/ledger.db").exists());
        assert_eq!(
            fs::read(destination.join("vault/objects/ab/cdef.kfd")).expect("restored vault"),
            b"encrypted document"
        );
    }

    #[test]
    fn portable_archive_never_contains_plaintext_master_key() {
        let (root, database, vault) = fixture();
        let archive = root.0.join("portable-v2.kfb");
        let master_key: [u8; 32] = std::array::from_fn(|index| (index as u8).wrapping_mul(7) + 3);
        create_portable_backup(
            &database,
            &vault,
            &archive,
            "portable correct horse battery staple",
            &master_key,
        )
        .expect("create v2 backup");

        let archive_bytes = fs::read(archive).expect("read v2 archive");
        assert!(
            !archive_bytes
                .windows(master_key.len())
                .any(|window| window == master_key),
            "raw master-key bytes must not be serialized"
        );
    }

    #[test]
    fn portable_wrong_passphrase_and_tamper_leave_no_restore_artifacts() {
        let (root, database, vault) = fixture();
        let archive = root.0.join("portable-v2.kfb");
        let master_key = [0x71_u8; 32];
        create_portable_backup(
            &database,
            &vault,
            &archive,
            "portable correct horse battery staple",
            &master_key,
        )
        .expect("create v2 backup");

        let wrong_destination = root.0.join("wrong-passphrase");
        assert!(matches!(
            restore_portable_backup(
                &archive,
                &wrong_destination,
                "portable incorrect passphrase"
            ),
            Err(BackupError::Authentication)
        ));
        assert!(!wrong_destination.exists());
        assert_eq!(restore_staging_count(&root.0), 0);

        let mut bytes = fs::read(&archive).expect("archive");
        // The first v2 record is the encrypted key capsule.
        bytes[HEADER_LEN + RECORD_HEADER_LEN + 5] ^= 0x40;
        fs::write(&archive, bytes).expect("tamper key capsule");
        let tampered_destination = root.0.join("tampered");
        assert!(matches!(
            restore_portable_backup(
                &archive,
                &tampered_destination,
                "portable correct horse battery staple"
            ),
            Err(BackupError::Authentication)
        ));
        assert!(!tampered_destination.exists());
        assert_eq!(restore_staging_count(&root.0), 0);
    }

    #[test]
    fn version_one_remains_same_device_only_and_legacy_compatible() {
        let (root, database, vault) = fixture();
        let archive = root.0.join("legacy-v1.kfb");
        create_backup(
            &database,
            &vault,
            &archive,
            "legacy correct horse battery staple",
        )
        .expect("create v1 backup");

        let portable_destination = root.0.join("portable-restore");
        assert!(matches!(
            restore_portable_backup(
                &archive,
                &portable_destination,
                "legacy correct horse battery staple"
            ),
            Err(BackupError::Corrupt)
        ));
        assert!(!portable_destination.exists());
        assert_eq!(restore_staging_count(&root.0), 0);

        let legacy_destination = root.0.join("legacy-restore");
        restore_backup(
            &archive,
            &legacy_destination,
            "legacy correct horse battery staple",
        )
        .expect("legacy restore remains supported");
        assert_eq!(
            fs::read(legacy_destination.join("database/ledger.db"))
                .expect("legacy restored database"),
            b"encrypted sqlcipher bytes"
        );
        assert!(!legacy_destination.join("database/kakeflow.db").exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_in_vault_are_rejected() {
        use std::os::unix::fs::symlink;

        let (root, database, vault) = fixture();
        symlink(&database, vault.join("objects/link.kfd")).expect("vault symlink");
        assert_eq!(
            create_backup(
                &database,
                &vault,
                root.0.join("portable.kfb"),
                "correct horse battery staple"
            ),
            Err(BackupError::InvalidInput)
        );
    }
}
