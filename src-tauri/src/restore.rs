//! Crash-recoverable activation of portable KakeFlow backups.
//!
//! [`crate::backup::restore_portable_backup`] authenticates and extracts an
//! archive. This module coordinates the remaining cross-device restore: it
//! stages the fixed application-data layout, swaps `database/` and
//! `documents/` without relying on replacement renames, and installs the
//! recovered master key through an injectable credential store.
//!
//! The recovered master key is held in zeroizing memory and is passed directly
//! to the credential callback. Only a domain-separated SHA-256 fingerprint is
//! recorded in the on-disk recovery journal.

#[cfg(unix)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::backup::{self, BackupSummary};
use crate::document_vault::DocumentVault;
use crate::persistence;

const WORK_DIR: &str = ".restore-work";
const UNPACKED_DIR: &str = "unpacked";
const CANDIDATE_DIR: &str = "candidate";
const ROLLBACK_DIR: &str = "rollback";
const DATABASE_DIR: &str = "database";
const DOCUMENTS_DIR: &str = "documents";
const ARCHIVE_VAULT_DIR: &str = "vault";
const JOURNAL_SLOT_0: &str = "journal.0";
const JOURNAL_SLOT_1: &str = "journal.1";
const JOURNAL_TEMP: &str = "journal.new";
const JOURNAL_MAGIC: &[u8; 8] = b"KFLWRST\0";
const JOURNAL_VERSION: u16 = 1;
const JOURNAL_BODY_LEN: usize = 8 + 2 + 8 + 1 + 1 + 32;
const JOURNAL_LEN: usize = JOURNAL_BODY_LEN + 32;
const FLAG_DATABASE_EXISTED: u8 = 1 << 0;
const FLAG_DOCUMENTS_EXISTED: u8 = 1 << 1;
const KEY_FINGERPRINT_DOMAIN: &[u8] = b"KakeFlow restore credential fingerprint v1\0";

/// Sanitized restore errors. No variant carries a passphrase or key material.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum RestoreError {
    #[error("portable backup could not be restored")]
    Backup,
    #[error("restore filesystem operation failed")]
    Io,
    #[error("restore staging layout is invalid")]
    InvalidLayout,
    #[error("restore recovery journal is corrupt")]
    CorruptJournal,
    #[error("restore credential operation failed")]
    Credential,
    #[error("restored financial data failed integrity validation")]
    Validation,
    #[error("another restore is waiting for startup activation")]
    RestorePending,
    #[error("restore activation was interrupted")]
    Interrupted,
}

pub type Result<T> = std::result::Result<T, RestoreError>;

/// Credential operations required by restore activation and startup recovery.
///
/// `stage_master_key` writes only to a dedicated pending entry;
/// `activate_staged_master_key` must report success only after the active
/// operating-system credential durably contains that key. Implementations
/// should compute fingerprints in memory with [`master_key_fingerprint`].
pub trait RestoreCredentialStore {
    fn current_key_fingerprint(&self) -> Result<Option<[u8; 32]>>;
    fn staged_key_fingerprint(&self) -> Result<Option<[u8; 32]>>;
    fn stage_master_key(&self, master_key: &[u8; 32]) -> Result<()>;
    fn activate_staged_master_key(&self) -> Result<()>;
    fn discard_staged_master_key(&self) -> Result<()>;
}

/// Stable checkpoints used by tests and platform fault-injection harnesses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestoreCheckpoint {
    ArchiveExtracted,
    Prepared,
    Activating,
    DatabaseBackedUp,
    DatabaseActivated,
    DocumentsBackedUp,
    DocumentsActivated,
    DirectoriesActivated,
    CredentialInstalled,
    CredentialActivated,
}

pub trait RestoreFaultInjector {
    fn checkpoint(&self, checkpoint: RestoreCheckpoint) -> Result<()>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct NoRestoreFaults;

impl RestoreFaultInjector for NoRestoreFaults {
    fn checkpoint(&self, _checkpoint: RestoreCheckpoint) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum Phase {
    Prepared = 1,
    Activating = 2,
    DirectoriesActivated = 3,
    CredentialActivated = 4,
}

impl TryFrom<u8> for Phase {
    type Error = RestoreError;

    fn try_from(value: u8) -> Result<Self> {
        match value {
            1 => Ok(Self::Prepared),
            2 => Ok(Self::Activating),
            3 => Ok(Self::DirectoriesActivated),
            4 => Ok(Self::CredentialActivated),
            _ => Err(RestoreError::CorruptJournal),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Journal {
    generation: u64,
    phase: Phase,
    original_flags: u8,
    target_key_fingerprint: [u8; 32],
}

#[derive(Debug, Clone)]
struct RestorePaths {
    root: PathBuf,
    work: PathBuf,
    unpacked: PathBuf,
    candidate: PathBuf,
    rollback: PathBuf,
    active_database: PathBuf,
    active_documents: PathBuf,
}

impl RestorePaths {
    fn new(app_data_root: &Path) -> Self {
        let work = app_data_root.join(WORK_DIR);
        Self {
            root: app_data_root.to_path_buf(),
            unpacked: work.join(UNPACKED_DIR),
            candidate: work.join(CANDIDATE_DIR),
            rollback: work.join(ROLLBACK_DIR),
            active_database: app_data_root.join(DATABASE_DIR),
            active_documents: app_data_root.join(DOCUMENTS_DIR),
            work,
        }
    }

    fn candidate_database(&self) -> PathBuf {
        self.candidate.join(DATABASE_DIR)
    }

    fn candidate_documents(&self) -> PathBuf {
        self.candidate.join(DOCUMENTS_DIR)
    }

    fn rollback_database(&self) -> PathBuf {
        self.rollback.join(DATABASE_DIR)
    }

    fn rollback_documents(&self) -> PathBuf {
        self.rollback.join(DOCUMENTS_DIR)
    }
}

/// Restores a portable archive and activates it at the fixed application-data
/// paths `database/` and `documents/`.
///
/// Call this before opening the database or document vault. If it returns
/// [`RestoreError::Interrupted`], the next startup must call
/// [`recover_interrupted_restore`] before accessing either directory.
pub fn restore_and_activate(
    app_data_root: impl AsRef<Path>,
    archive_path: impl AsRef<Path>,
    passphrase: &str,
    credentials: &dyn RestoreCredentialStore,
) -> Result<BackupSummary> {
    restore_and_activate_with_faults(
        app_data_root,
        archive_path,
        passphrase,
        credentials,
        &NoRestoreFaults,
    )
}

/// Fault-injectable form of [`restore_and_activate`].
pub fn restore_and_activate_with_faults(
    app_data_root: impl AsRef<Path>,
    archive_path: impl AsRef<Path>,
    passphrase: &str,
    credentials: &dyn RestoreCredentialStore,
    faults: &dyn RestoreFaultInjector,
) -> Result<BackupSummary> {
    let app_data_root = app_data_root.as_ref();
    let summary = stage_portable_restore_with_faults(
        app_data_root,
        archive_path,
        passphrase,
        credentials,
        faults,
    )?;
    activate_staged_restore_with_faults(app_data_root, credentials, faults)?;
    Ok(summary)
}

/// Authenticates and stages a portable restore while the live database may
/// still be open.
///
/// The recovered key is persisted only to the implementation's dedicated
/// pending OS-credential entry. The active credential and live data
/// directories are not changed. The application can then restart and call
/// [`activate_staged_restore`] before opening SQLite or the document vault.
pub fn stage_portable_restore(
    app_data_root: impl AsRef<Path>,
    archive_path: impl AsRef<Path>,
    passphrase: &str,
    credentials: &dyn RestoreCredentialStore,
) -> Result<BackupSummary> {
    stage_portable_restore_with_faults(
        app_data_root,
        archive_path,
        passphrase,
        credentials,
        &NoRestoreFaults,
    )
}

pub fn stage_portable_restore_with_faults(
    app_data_root: impl AsRef<Path>,
    archive_path: impl AsRef<Path>,
    passphrase: &str,
    credentials: &dyn RestoreCredentialStore,
    faults: &dyn RestoreFaultInjector,
) -> Result<BackupSummary> {
    let paths = RestorePaths::new(app_data_root.as_ref());
    fs::create_dir_all(&paths.root).map_err(|_| RestoreError::Io)?;
    if paths.work.exists() {
        if read_latest_journal(&paths)?.is_some() {
            return Err(RestoreError::RestorePending);
        }
        remove_tree_if_exists(&paths.work)?;
        credentials.discard_staged_master_key()?;
    }
    fs::create_dir(&paths.work).map_err(|_| RestoreError::Io)?;

    let restored = backup::restore_portable_backup(archive_path, &paths.unpacked, passphrase)
        .map_err(|_| RestoreError::Backup);
    let (summary, recovered_key) = match restored {
        Ok(value) => value,
        Err(error) => {
            remove_tree_if_exists(&paths.work)?;
            return Err(error);
        }
    };
    faults.checkpoint(RestoreCheckpoint::ArchiveExtracted)?;

    prepare_candidate_layout(&paths)?;
    let target_key_fingerprint = master_key_fingerprint(&recovered_key);
    let original_flags = original_flags(&paths)?;
    if validate_candidate_data(&paths, &recovered_key).is_err() {
        remove_tree_if_exists(&paths.work)?;
        credentials.discard_staged_master_key()?;
        return Err(RestoreError::Validation);
    }
    credentials.stage_master_key(&recovered_key)?;
    if credentials.staged_key_fingerprint()? != Some(target_key_fingerprint) {
        return Err(RestoreError::Credential);
    }
    let journal = Journal {
        generation: 0,
        phase: Phase::Prepared,
        original_flags,
        target_key_fingerprint,
    };
    write_journal(&paths, journal)?;
    faults.checkpoint(RestoreCheckpoint::Prepared)?;
    Ok(summary)
}

/// Activates a previously authenticated restore. This must run before opening
/// SQLite, especially on Windows where an open database prevents directory
/// replacement.
pub fn activate_staged_restore(
    app_data_root: impl AsRef<Path>,
    credentials: &dyn RestoreCredentialStore,
) -> Result<()> {
    activate_staged_restore_with_faults(app_data_root, credentials, &NoRestoreFaults)
}

/// Returns the exact target fingerprint only while a fully authenticated
/// restore is waiting in the Prepared state and its pending OS credential is
/// still present. UI code uses this value as an unforgeable backend-owned
/// authorization binding; the webview never supplies it.
pub fn prepared_restore_fingerprint(
    app_data_root: impl AsRef<Path>,
    credentials: &dyn RestoreCredentialStore,
) -> Result<Option<[u8; 32]>> {
    let paths = RestorePaths::new(app_data_root.as_ref());
    let Some(journal) = read_latest_journal(&paths)? else {
        return Ok(None);
    };
    if journal.phase != Phase::Prepared
        || credentials.staged_key_fingerprint()? != Some(journal.target_key_fingerprint)
    {
        return Ok(None);
    }
    Ok(Some(journal.target_key_fingerprint))
}

fn activate_staged_restore_with_faults(
    app_data_root: impl AsRef<Path>,
    credentials: &dyn RestoreCredentialStore,
    faults: &dyn RestoreFaultInjector,
) -> Result<()> {
    let paths = RestorePaths::new(app_data_root.as_ref());
    let mut journal = read_latest_journal(&paths)?.ok_or(RestoreError::InvalidLayout)?;
    if journal.phase != Phase::Prepared
        || credentials.staged_key_fingerprint()? != Some(journal.target_key_fingerprint)
    {
        return Err(RestoreError::Credential);
    }
    let original_flags = journal.original_flags;
    let target_key_fingerprint = journal.target_key_fingerprint;

    journal.phase = Phase::Activating;
    journal = write_journal(&paths, journal)?;
    faults.checkpoint(RestoreCheckpoint::Activating)?;

    activate_directory(
        &paths.active_database,
        &paths.rollback_database(),
        &paths.candidate_database(),
        original_flags & FLAG_DATABASE_EXISTED != 0,
        RestoreCheckpoint::DatabaseBackedUp,
        RestoreCheckpoint::DatabaseActivated,
        faults,
    )?;
    activate_directory(
        &paths.active_documents,
        &paths.rollback_documents(),
        &paths.candidate_documents(),
        original_flags & FLAG_DOCUMENTS_EXISTED != 0,
        RestoreCheckpoint::DocumentsBackedUp,
        RestoreCheckpoint::DocumentsActivated,
        faults,
    )?;
    sync_directory(&paths.root)?;

    journal.phase = Phase::DirectoriesActivated;
    journal = write_journal(&paths, journal)?;
    faults.checkpoint(RestoreCheckpoint::DirectoriesActivated)?;

    credentials.activate_staged_master_key()?;
    let installed = credentials.current_key_fingerprint()?;
    if installed != Some(target_key_fingerprint) {
        return Err(RestoreError::Credential);
    }
    faults.checkpoint(RestoreCheckpoint::CredentialInstalled)?;

    journal.phase = Phase::CredentialActivated;
    write_journal(&paths, journal)?;
    faults.checkpoint(RestoreCheckpoint::CredentialActivated)?;
    credentials.discard_staged_master_key()?;
    finalize_activation(&paths)?;
    Ok(())
}

/// Recovers an interrupted activation before application data is opened.
///
/// Before credential activation, recovery restores the old directories. Once
/// the target credential is durably visible, recovery commits the new
/// directories and only removes the rollback copy.
pub fn recover_interrupted_restore(
    app_data_root: impl AsRef<Path>,
    credentials: &dyn RestoreCredentialStore,
) -> Result<()> {
    let paths = RestorePaths::new(app_data_root.as_ref());
    if !paths.work.exists() {
        return credentials.discard_staged_master_key();
    }
    let Some(journal) = read_latest_journal(&paths)? else {
        // Extraction may have failed before the first journal was published.
        remove_tree_if_exists(&paths.work)?;
        credentials.discard_staged_master_key()?;
        return Ok(());
    };

    match journal.phase {
        Phase::Prepared => activate_staged_restore(&paths.root, credentials),
        Phase::Activating => {
            credentials.discard_staged_master_key()?;
            rollback_activation(&paths, journal.original_flags)
        }
        Phase::DirectoriesActivated => {
            if credentials.current_key_fingerprint()? == Some(journal.target_key_fingerprint) {
                credentials.discard_staged_master_key()?;
                finalize_activation(&paths)
            } else if credentials.staged_key_fingerprint()? == Some(journal.target_key_fingerprint)
            {
                credentials.activate_staged_master_key()?;
                if credentials.current_key_fingerprint()? != Some(journal.target_key_fingerprint) {
                    return Err(RestoreError::Credential);
                }
                let mut committed = journal;
                committed.phase = Phase::CredentialActivated;
                write_journal(&paths, committed)?;
                credentials.discard_staged_master_key()?;
                finalize_activation(&paths)
            } else {
                credentials.discard_staged_master_key()?;
                rollback_activation(&paths, journal.original_flags)
            }
        }
        Phase::CredentialActivated => {
            if credentials.current_key_fingerprint()? != Some(journal.target_key_fingerprint) {
                return Err(RestoreError::Credential);
            }
            credentials.discard_staged_master_key()?;
            finalize_activation(&paths)
        }
    }
}

/// Domain-separated fingerprint suitable for journal comparison.
pub fn master_key_fingerprint(master_key: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(KEY_FINGERPRINT_DOMAIN);
    hasher.update(master_key);
    hasher.finalize().into()
}

fn validate_candidate_data(paths: &RestorePaths, master_key: &[u8; 32]) -> Result<()> {
    let database = paths.candidate_database().join("kakeflow.db");
    persistence::validate_existing_database(&database, master_key)
        .map_err(|_| RestoreError::Validation)?;
    persistence::clear_restored_device_local_state(&database, master_key)
        .map_err(|_| RestoreError::Validation)?;
    let restored = persistence::validate_existing_database(&database, master_key)
        .map_err(|_| RestoreError::Validation)?;
    let vault = DocumentVault::new(paths.candidate_documents(), master_key)
        .map_err(|_| RestoreError::Validation)?;
    for expected in restored.source_documents {
        let document = vault
            .read(&expected.sha256)
            .map_err(|_| RestoreError::Validation)?;
        let byte_size =
            u64::try_from(document.bytes.len()).map_err(|_| RestoreError::Validation)?;
        if document.sha256 != expected.sha256
            || document.mime_type != expected.media_type
            || byte_size != expected.byte_size
        {
            return Err(RestoreError::Validation);
        }
    }
    Ok(())
}

fn prepare_candidate_layout(paths: &RestorePaths) -> Result<()> {
    let unpacked_database = paths.unpacked.join(DATABASE_DIR);
    let unpacked_vault = paths.unpacked.join(ARCHIVE_VAULT_DIR);
    if !is_real_directory(&unpacked_database)?
        || !is_regular_file(&unpacked_database.join("kakeflow.db"))?
    {
        return Err(RestoreError::InvalidLayout);
    }
    if unpacked_vault.exists() && !is_real_directory(&unpacked_vault)? {
        return Err(RestoreError::InvalidLayout);
    }

    fs::create_dir(&paths.candidate).map_err(|_| RestoreError::Io)?;
    rename_no_replace(&unpacked_database, &paths.candidate_database())?;
    if unpacked_vault.exists() {
        rename_no_replace(&unpacked_vault, &paths.candidate_documents())?;
    } else {
        fs::create_dir(paths.candidate_documents()).map_err(|_| RestoreError::Io)?;
    }
    fs::remove_dir(&paths.unpacked).map_err(|_| RestoreError::Io)?;
    fs::create_dir(&paths.rollback).map_err(|_| RestoreError::Io)?;
    sync_directory(&paths.candidate)?;
    sync_directory(&paths.work)?;
    Ok(())
}

fn original_flags(paths: &RestorePaths) -> Result<u8> {
    let mut flags = 0;
    if paths.active_database.exists() {
        if !is_real_directory(&paths.active_database)? {
            return Err(RestoreError::InvalidLayout);
        }
        flags |= FLAG_DATABASE_EXISTED;
    }
    if paths.active_documents.exists() {
        if !is_real_directory(&paths.active_documents)? {
            return Err(RestoreError::InvalidLayout);
        }
        flags |= FLAG_DOCUMENTS_EXISTED;
    }
    Ok(flags)
}

#[allow(clippy::too_many_arguments)]
fn activate_directory(
    active: &Path,
    rollback: &Path,
    candidate: &Path,
    existed: bool,
    backed_up_checkpoint: RestoreCheckpoint,
    activated_checkpoint: RestoreCheckpoint,
    faults: &dyn RestoreFaultInjector,
) -> Result<()> {
    if existed {
        rename_no_replace(active, rollback)?;
        sync_parent(active)?;
    }
    faults.checkpoint(backed_up_checkpoint)?;
    rename_no_replace(candidate, active)?;
    sync_parent(active)?;
    faults.checkpoint(activated_checkpoint)
}

fn rollback_activation(paths: &RestorePaths, original_flags: u8) -> Result<()> {
    rollback_directory(
        &paths.active_database,
        &paths.rollback_database(),
        original_flags & FLAG_DATABASE_EXISTED != 0,
    )?;
    rollback_directory(
        &paths.active_documents,
        &paths.rollback_documents(),
        original_flags & FLAG_DOCUMENTS_EXISTED != 0,
    )?;
    sync_directory(&paths.root)?;
    remove_tree_if_exists(&paths.work)
}

fn rollback_directory(active: &Path, rollback: &Path, existed: bool) -> Result<()> {
    if rollback.exists() {
        remove_tree_if_exists(active)?;
        rename_no_replace(rollback, active)?;
        sync_parent(active)?;
    } else if !existed {
        remove_tree_if_exists(active)?;
        sync_parent(active)?;
    }
    Ok(())
}

fn finalize_activation(paths: &RestorePaths) -> Result<()> {
    if !paths.active_database.join("kakeflow.db").is_file() || !paths.active_documents.is_dir() {
        return Err(RestoreError::InvalidLayout);
    }
    remove_tree_if_exists(&paths.rollback)?;
    remove_tree_if_exists(&paths.candidate)?;
    remove_tree_if_exists(&paths.unpacked)?;
    remove_file_if_exists(&paths.work.join(JOURNAL_SLOT_0))?;
    remove_file_if_exists(&paths.work.join(JOURNAL_SLOT_1))?;
    remove_file_if_exists(&paths.work.join(JOURNAL_TEMP))?;
    sync_directory(&paths.work)?;
    fs::remove_dir(&paths.work).map_err(|_| RestoreError::Io)?;
    sync_directory(&paths.root)
}

fn rename_no_replace(source: &Path, destination: &Path) -> Result<()> {
    // `std::fs::rename` replaces some destinations on Unix but not on Windows.
    // Requiring an absent destination gives identical, conservative semantics.
    if destination.exists() {
        return Err(RestoreError::InvalidLayout);
    }
    fs::rename(source, destination).map_err(|_| RestoreError::Io)
}

fn write_journal(paths: &RestorePaths, mut journal: Journal) -> Result<Journal> {
    let latest = read_latest_journal(paths)?;
    journal.generation = latest
        .map(|value| value.generation)
        .unwrap_or(0)
        .checked_add(1)
        .ok_or(RestoreError::CorruptJournal)?;
    let bytes = encode_journal(journal);
    let temporary = paths.work.join(JOURNAL_TEMP);
    remove_file_if_exists(&temporary)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| RestoreError::Io)?;
    file.write_all(&bytes).map_err(|_| RestoreError::Io)?;
    file.sync_all().map_err(|_| RestoreError::Io)?;
    drop(file);

    let slot = if journal.generation % 2 == 0 {
        paths.work.join(JOURNAL_SLOT_0)
    } else {
        paths.work.join(JOURNAL_SLOT_1)
    };
    // The other slot always remains valid while this slot is replaced. This
    // avoids depending on Unix-only rename-over-existing behavior.
    remove_file_if_exists(&slot)?;
    rename_no_replace(&temporary, &slot)?;
    sync_directory(&paths.work)?;
    Ok(journal)
}

fn read_latest_journal(paths: &RestorePaths) -> Result<Option<Journal>> {
    let mut journals = Vec::new();
    let mut found_slot = false;
    for name in [JOURNAL_SLOT_0, JOURNAL_SLOT_1] {
        let path = paths.work.join(name);
        if path.exists() {
            found_slot = true;
            if let Ok(journal) = decode_journal(&fs::read(path).map_err(|_| RestoreError::Io)?) {
                journals.push(journal);
            }
        }
    }
    let latest = journals.into_iter().max_by_key(|value| value.generation);
    if latest.is_none() && found_slot {
        Err(RestoreError::CorruptJournal)
    } else {
        Ok(latest)
    }
}

fn encode_journal(journal: Journal) -> [u8; JOURNAL_LEN] {
    let mut encoded = [0_u8; JOURNAL_LEN];
    encoded[..8].copy_from_slice(JOURNAL_MAGIC);
    encoded[8..10].copy_from_slice(&JOURNAL_VERSION.to_le_bytes());
    encoded[10..18].copy_from_slice(&journal.generation.to_le_bytes());
    encoded[18] = journal.phase as u8;
    encoded[19] = journal.original_flags;
    encoded[20..52].copy_from_slice(&journal.target_key_fingerprint);
    let checksum: [u8; 32] = Sha256::digest(&encoded[..JOURNAL_BODY_LEN]).into();
    encoded[JOURNAL_BODY_LEN..].copy_from_slice(&checksum);
    encoded
}

fn decode_journal(encoded: &[u8]) -> Result<Journal> {
    if encoded.len() != JOURNAL_LEN
        || &encoded[..8] != JOURNAL_MAGIC
        || u16::from_le_bytes(
            encoded[8..10]
                .try_into()
                .map_err(|_| RestoreError::CorruptJournal)?,
        ) != JOURNAL_VERSION
    {
        return Err(RestoreError::CorruptJournal);
    }
    let expected: [u8; 32] = Sha256::digest(&encoded[..JOURNAL_BODY_LEN]).into();
    if encoded[JOURNAL_BODY_LEN..] != expected {
        return Err(RestoreError::CorruptJournal);
    }
    let original_flags = encoded[19];
    if original_flags & !(FLAG_DATABASE_EXISTED | FLAG_DOCUMENTS_EXISTED) != 0 {
        return Err(RestoreError::CorruptJournal);
    }
    Ok(Journal {
        generation: u64::from_le_bytes(
            encoded[10..18]
                .try_into()
                .map_err(|_| RestoreError::CorruptJournal)?,
        ),
        phase: Phase::try_from(encoded[18])?,
        original_flags,
        target_key_fingerprint: encoded[20..52]
            .try_into()
            .map_err(|_| RestoreError::CorruptJournal)?,
    })
}

fn is_real_directory(path: &Path) -> Result<bool> {
    let metadata = fs::symlink_metadata(path).map_err(|_| RestoreError::Io)?;
    Ok(metadata.file_type().is_dir() && !metadata.file_type().is_symlink())
}

fn is_regular_file(path: &Path) -> Result<bool> {
    let metadata = fs::symlink_metadata(path).map_err(|_| RestoreError::Io)?;
    Ok(metadata.file_type().is_file() && !metadata.file_type().is_symlink())
}

fn remove_tree_if_exists(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {
            fs::remove_dir_all(path).map_err(|_| RestoreError::Io)
        }
        Ok(_) => fs::remove_file(path).map_err(|_| RestoreError::Io),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(RestoreError::Io),
    }
}

fn remove_file_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(RestoreError::Io),
    }
}

fn sync_parent(path: &Path) -> Result<()> {
    sync_directory(path.parent().ok_or(RestoreError::InvalidLayout)?)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<()> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| RestoreError::Io)
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<()> {
    // Windows does not support opening directories through `std::fs::File`.
    // File handles are flushed before every rename; directory renames remain
    // same-volume and never depend on replacement semantics.
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::backup::create_portable_backup;
    use crate::persistence::AppState;

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            let mut random = [0_u8; 12];
            getrandom::getrandom(&mut random).expect("random temp path");
            let suffix = random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            let path = std::env::temp_dir().join(format!("kakeflow-restore-{suffix}"));
            fs::create_dir(&path).expect("create temp root");
            Self(path)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct MemoryCredentials {
        key: Mutex<Option<[u8; 32]>>,
        staged: Mutex<Option<[u8; 32]>>,
    }

    impl MemoryCredentials {
        fn new(key: Option<[u8; 32]>) -> Self {
            Self {
                key: Mutex::new(key),
                staged: Mutex::new(None),
            }
        }

        fn key(&self) -> Option<[u8; 32]> {
            *self.key.lock().expect("credential lock")
        }
    }

    impl RestoreCredentialStore for MemoryCredentials {
        fn current_key_fingerprint(&self) -> Result<Option<[u8; 32]>> {
            Ok(self.key().as_ref().map(master_key_fingerprint))
        }

        fn staged_key_fingerprint(&self) -> Result<Option<[u8; 32]>> {
            Ok(self
                .staged
                .lock()
                .map_err(|_| RestoreError::Credential)?
                .as_ref()
                .map(master_key_fingerprint))
        }

        fn stage_master_key(&self, master_key: &[u8; 32]) -> Result<()> {
            *self.staged.lock().map_err(|_| RestoreError::Credential)? = Some(*master_key);
            Ok(())
        }

        fn activate_staged_master_key(&self) -> Result<()> {
            let staged = *self.staged.lock().map_err(|_| RestoreError::Credential)?;
            *self.key.lock().map_err(|_| RestoreError::Credential)? =
                Some(staged.ok_or(RestoreError::Credential)?);
            Ok(())
        }

        fn discard_staged_master_key(&self) -> Result<()> {
            *self.staged.lock().map_err(|_| RestoreError::Credential)? = None;
            Ok(())
        }
    }

    struct FailAt(RestoreCheckpoint);

    impl RestoreFaultInjector for FailAt {
        fn checkpoint(&self, checkpoint: RestoreCheckpoint) -> Result<()> {
            if checkpoint == self.0 {
                Err(RestoreError::Interrupted)
            } else {
                Ok(())
            }
        }
    }

    fn fixture() -> (TempRoot, PathBuf, PathBuf, [u8; 32], [u8; 32]) {
        let root = TempRoot::new();
        let app_data = root.0.join("app-data");
        fs::create_dir_all(app_data.join("database")).expect("old database dir");
        fs::create_dir_all(app_data.join("documents/objects/old")).expect("old documents dir");
        fs::write(app_data.join("database/kakeflow.db"), b"old database").expect("old database");
        fs::write(
            app_data.join("documents/objects/old/document.kfd"),
            b"old document",
        )
        .expect("old document");

        let source = root.0.join("source");
        let source_database = source.join("kakeflow.db");
        let archive = root.0.join("portable.kfb");
        let old_key = [0x21; 32];
        let new_key = [0x73; 32];
        let state = AppState::open_with_key(source_database.clone(), &new_key)
            .expect("encrypted source database");
        let vault = DocumentVault::new(source.join("vault"), &new_key).expect("source vault");
        let stored = vault
            .put(b"new document", "application/octet-stream")
            .expect("source document");
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households (id, name) VALUES ('household', 'Restored')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO import_runs (id, household_id, status) \
                     VALUES ('run', 'household', 'POSTED')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO source_documents \
                     (id, household_id, import_run_id, source_type, original_filename, \
                      media_type, byte_size, sha256, storage_path) \
                     VALUES ('document', 'household', 'run', 'MANUAL_UPLOAD', 'source.bin', \
                             'application/octet-stream', 12, ?1, ?2)",
                    rusqlite::params![stored.sha256, format!("vault://{}", stored.sha256)],
                )?;
                connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
                Ok(())
            })
            .expect("source provenance");
        drop(state);
        create_portable_backup(
            source_database,
            source.join("vault"),
            &archive,
            "restore correct horse battery staple",
            &new_key,
        )
        .expect("portable archive");
        (root, app_data, archive, old_key, new_key)
    }

    fn assert_old_layout(app_data: &Path) {
        assert_eq!(
            fs::read(app_data.join("database/kakeflow.db")).expect("old database present"),
            b"old database"
        );
        assert_eq!(
            fs::read(app_data.join("documents/objects/old/document.kfd"))
                .expect("old document present"),
            b"old document"
        );
        assert!(!app_data.join(WORK_DIR).exists());
    }

    fn assert_new_layout(app_data: &Path, new_key: &[u8; 32]) {
        let restored = persistence::validate_existing_database(
            &app_data.join("database/kakeflow.db"),
            new_key,
        )
        .expect("new database validates");
        assert_eq!(restored.household_count, 1);
        assert_eq!(restored.source_documents.len(), 1);
        let vault = DocumentVault::new(app_data.join("documents"), new_key)
            .expect("new document vault opens");
        assert_eq!(
            vault
                .read(&restored.source_documents[0].sha256)
                .expect("new document authenticates")
                .bytes,
            b"new document"
        );
        assert!(!app_data.join(WORK_DIR).exists());
    }

    #[test]
    fn activates_portable_backup_and_installs_key_without_disk_materialization() {
        let (root, app_data, archive, old_key, new_key) = fixture();
        let credentials = MemoryCredentials::new(Some(old_key));
        restore_and_activate(
            &app_data,
            archive,
            "restore correct horse battery staple",
            &credentials,
        )
        .expect("activate restore");

        assert_new_layout(&app_data, &new_key);
        assert_eq!(credentials.key(), Some(new_key));
        for entry in walk_regular_files(&root.0) {
            let bytes = fs::read(entry).expect("read fixture file");
            assert!(
                !bytes.windows(new_key.len()).any(|window| window == new_key),
                "recovered key must never be materialized as plaintext"
            );
        }
    }

    #[test]
    fn staging_leaves_openable_live_paths_untouched_until_startup_activation() {
        let (_root, app_data, archive, old_key, new_key) = fixture();
        let credentials = MemoryCredentials::new(Some(old_key));
        stage_portable_restore(
            &app_data,
            archive,
            "restore correct horse battery staple",
            &credentials,
        )
        .expect("stage restore");

        assert_eq!(
            fs::read(app_data.join("database/kakeflow.db")).expect("live database untouched"),
            b"old database"
        );
        assert_eq!(credentials.key(), Some(old_key));
        assert_eq!(
            credentials.staged_key_fingerprint().expect("pending key"),
            Some(master_key_fingerprint(&new_key))
        );
        assert_eq!(
            prepared_restore_fingerprint(&app_data, &credentials).expect("prepared restore"),
            Some(master_key_fingerprint(&new_key))
        );

        recover_interrupted_restore(&app_data, &credentials).expect("startup activation");
        assert_new_layout(&app_data, &new_key);
        assert_eq!(credentials.key(), Some(new_key));
        assert_eq!(
            prepared_restore_fingerprint(&app_data, &credentials).expect("completed restore"),
            None
        );
    }

    #[test]
    fn validation_rejects_missing_referenced_vault_object_and_cleans_staging() {
        let (root, app_data, _archive, old_key, new_key) = fixture();
        let source = root.0.join("source");
        fs::remove_dir_all(source.join("vault/objects")).expect("remove referenced object");
        fs::create_dir(source.join("vault/objects")).expect("empty vault objects");
        let broken_archive = root.0.join("missing-object.kfb");
        create_portable_backup(
            source.join("kakeflow.db"),
            source.join("vault"),
            &broken_archive,
            "restore correct horse battery staple",
            &new_key,
        )
        .expect("archive with missing referenced object");
        let credentials = MemoryCredentials::new(Some(old_key));

        assert_eq!(
            stage_portable_restore(
                &app_data,
                broken_archive,
                "restore correct horse battery staple",
                &credentials,
            ),
            Err(RestoreError::Validation)
        );
        assert_old_layout(&app_data);
        assert_eq!(credentials.key(), Some(old_key));
        assert_eq!(
            credentials.staged_key_fingerprint().expect("pending key"),
            None
        );
    }

    #[test]
    fn validation_rejects_source_metadata_that_disagrees_with_vault() {
        for update in [
            "UPDATE source_documents SET byte_size = byte_size + 1",
            "UPDATE source_documents SET media_type = 'text/plain'",
        ] {
            let (root, app_data, _archive, old_key, new_key) = fixture();
            let source = root.0.join("source");
            let state = AppState::open_with_key(source.join("kakeflow.db"), &new_key)
                .expect("source database");
            state
                .with_connection(|connection| {
                    connection.execute(update, [])?;
                    connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
                    Ok(())
                })
                .expect("mutate source metadata");
            drop(state);
            let mismatched_archive = root.0.join("metadata-mismatch.kfb");
            create_portable_backup(
                source.join("kakeflow.db"),
                source.join("vault"),
                &mismatched_archive,
                "restore correct horse battery staple",
                &new_key,
            )
            .expect("archive with mismatched source metadata");
            let credentials = MemoryCredentials::new(Some(old_key));

            assert_eq!(
                stage_portable_restore(
                    &app_data,
                    mismatched_archive,
                    "restore correct horse battery staple",
                    &credentials,
                ),
                Err(RestoreError::Validation)
            );
            assert_old_layout(&app_data);
            assert_eq!(credentials.key(), Some(old_key));
            assert_eq!(
                credentials.staged_key_fingerprint().expect("pending key"),
                None
            );
        }
    }

    #[test]
    fn extraction_fault_cleans_up_and_swap_faults_roll_back_on_next_startup() {
        let (_root, app_data, archive, old_key, _new_key) = fixture();
        let credentials = MemoryCredentials::new(Some(old_key));
        assert_eq!(
            restore_and_activate_with_faults(
                &app_data,
                archive,
                "restore correct horse battery staple",
                &credentials,
                &FailAt(RestoreCheckpoint::ArchiveExtracted),
            ),
            Err(RestoreError::Interrupted)
        );
        recover_interrupted_restore(&app_data, &credentials).expect("clean abandoned extraction");
        assert_old_layout(&app_data);

        let checkpoints = [
            RestoreCheckpoint::Activating,
            RestoreCheckpoint::DatabaseBackedUp,
            RestoreCheckpoint::DatabaseActivated,
            RestoreCheckpoint::DocumentsBackedUp,
            RestoreCheckpoint::DocumentsActivated,
        ];
        for checkpoint in checkpoints {
            let (_root, app_data, archive, old_key, _new_key) = fixture();
            let credentials = MemoryCredentials::new(Some(old_key));
            assert_eq!(
                restore_and_activate_with_faults(
                    &app_data,
                    archive,
                    "restore correct horse battery staple",
                    &credentials,
                    &FailAt(checkpoint),
                ),
                Err(RestoreError::Interrupted),
                "checkpoint {checkpoint:?}"
            );
            recover_interrupted_restore(&app_data, &credentials)
                .expect("startup recovery rolls back");
            assert_old_layout(&app_data);
            assert_eq!(credentials.key(), Some(old_key));
        }
    }

    #[test]
    fn staged_and_postswap_faults_commit_on_next_startup() {
        for checkpoint in [
            RestoreCheckpoint::Prepared,
            RestoreCheckpoint::DirectoriesActivated,
            RestoreCheckpoint::CredentialInstalled,
            RestoreCheckpoint::CredentialActivated,
        ] {
            let (_root, app_data, archive, old_key, new_key) = fixture();
            let credentials = MemoryCredentials::new(Some(old_key));
            assert_eq!(
                restore_and_activate_with_faults(
                    &app_data,
                    archive,
                    "restore correct horse battery staple",
                    &credentials,
                    &FailAt(checkpoint),
                ),
                Err(RestoreError::Interrupted),
                "checkpoint {checkpoint:?}"
            );
            recover_interrupted_restore(&app_data, &credentials).expect("startup recovery commits");
            assert_new_layout(&app_data, &new_key);
            assert_eq!(credentials.key(), Some(new_key));
        }
    }

    #[test]
    fn same_key_restore_is_safe_during_partial_directory_swap() {
        let (_root, app_data, archive, _old_key, new_key) = fixture();
        let credentials = MemoryCredentials::new(Some(new_key));
        assert_eq!(
            restore_and_activate_with_faults(
                &app_data,
                archive,
                "restore correct horse battery staple",
                &credentials,
                &FailAt(RestoreCheckpoint::DocumentsBackedUp),
            ),
            Err(RestoreError::Interrupted)
        );
        recover_interrupted_restore(&app_data, &credentials).expect("rollback partial swap");
        assert_old_layout(&app_data);
    }

    #[test]
    fn rename_helper_never_replaces_an_existing_destination() {
        let root = TempRoot::new();
        let source = root.0.join("source");
        let destination = root.0.join("destination");
        fs::create_dir(&source).expect("source");
        fs::create_dir(&destination).expect("destination");
        fs::write(source.join("value"), b"source").expect("source value");
        fs::write(destination.join("value"), b"destination").expect("destination value");

        assert_eq!(
            rename_no_replace(&source, &destination),
            Err(RestoreError::InvalidLayout)
        );
        assert_eq!(
            fs::read(destination.join("value")).expect("destination retained"),
            b"destination"
        );
        assert!(source.exists());
    }

    #[test]
    fn torn_newer_journal_falls_back_to_last_durable_slot() {
        let (_root, app_data, archive, old_key, new_key) = fixture();
        let credentials = MemoryCredentials::new(Some(old_key));
        assert_eq!(
            restore_and_activate_with_faults(
                &app_data,
                archive,
                "restore correct horse battery staple",
                &credentials,
                &FailAt(RestoreCheckpoint::Activating),
            ),
            Err(RestoreError::Interrupted)
        );
        let paths = RestorePaths::new(&app_data);
        let latest = read_latest_journal(&paths)
            .expect("journal")
            .expect("latest");
        let slot = if latest.generation % 2 == 0 {
            paths.work.join(JOURNAL_SLOT_0)
        } else {
            paths.work.join(JOURNAL_SLOT_1)
        };
        let mut bytes = fs::read(&slot).expect("journal bytes");
        bytes[20] ^= 0x80;
        fs::write(slot, bytes).expect("corrupt journal");
        recover_interrupted_restore(&app_data, &credentials).expect("recover older journal slot");
        assert_new_layout(&app_data, &new_key);
        assert_eq!(credentials.key(), Some(new_key));
    }

    fn walk_regular_files(root: &Path) -> Vec<PathBuf> {
        let mut files = Vec::new();
        let mut pending = vec![root.to_path_buf()];
        while let Some(directory) = pending.pop() {
            for entry in fs::read_dir(directory).expect("walk directory") {
                let entry = entry.expect("walk entry");
                let file_type = entry.file_type().expect("file type");
                if file_type.is_dir() {
                    pending.push(entry.path());
                } else if file_type.is_file() {
                    files.push(entry.path());
                }
            }
        }
        files
    }
}
