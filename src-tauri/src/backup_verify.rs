//! Proves a backup archive can actually be restored, without touching the live data.
//!
//! The archive is authenticated and unpacked into a private scratch directory, then the same checks a real
//! restore performs are run on the unpacked copy (SQLCipher integrity, foreign keys, schema, every stored
//! source document), followed by the double-entry ledger audit for every household. The scratch directory is
//! always removed, including on failure. Nothing is staged and no credential is written.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use thiserror::Error;

use crate::backup;
use crate::document_vault::DocumentVault;
use crate::ledger_audit;
use crate::persistence;

const SCRATCH_PREFIX: &str = ".kakeflow-backup-verify";

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum BackupVerifyError {
    #[error("backup authentication or format is invalid")]
    Backup,
    #[error("backup contents are invalid")]
    Invalid,
    #[error("backup verification I/O failed")]
    Io,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupVerificationDto {
    pub entry_count: u64,
    pub plaintext_bytes: u64,
    pub schema_version: i64,
    pub household_count: u64,
    pub documents_checked: u64,
    pub posted_transactions: u64,
    pub journal_entries: u64,
    pub ledger_findings: u64,
    /// True only when the archive restores and the books of every household balance.
    pub ok: bool,
}

struct Scratch(PathBuf);

impl Scratch {
    fn create(parent: &Path) -> Result<Self, BackupVerifyError> {
        fs::create_dir_all(parent).map_err(|_| BackupVerifyError::Io)?;
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path = parent.join(format!("{SCRATCH_PREFIX}-{}-{nanos}", std::process::id()));
        fs::create_dir(&path).map_err(|_| BackupVerifyError::Io)?;
        Ok(Self(path))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Removes scratch directories left behind by a crash during an earlier verification.
pub fn remove_stale_scratch(parent: &Path) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(SCRATCH_PREFIX)
        {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

pub fn verify_portable_backup(
    scratch_parent: &Path,
    archive_path: &Path,
    passphrase: &str,
) -> Result<BackupVerificationDto, BackupVerifyError> {
    let scratch = Scratch::create(scratch_parent)?;
    let unpacked = scratch.0.join("unpacked");
    let (summary, key) = backup::restore_portable_backup(archive_path, &unpacked, passphrase)
        .map_err(|_| BackupVerifyError::Backup)?;

    let database = unpacked.join("database").join("kakeflow.db");
    let info = persistence::validate_existing_database(&database, key.as_slice())
        .map_err(|_| BackupVerifyError::Invalid)?;

    let vault =
        DocumentVault::new(unpacked.join("vault"), &key).map_err(|_| BackupVerifyError::Invalid)?;
    let mut documents_checked = 0_u64;
    for expected in &info.source_documents {
        let document = vault
            .read(&expected.sha256)
            .map_err(|_| BackupVerifyError::Invalid)?;
        let byte_size =
            u64::try_from(document.bytes.len()).map_err(|_| BackupVerifyError::Invalid)?;
        if document.sha256 != expected.sha256
            || document.mime_type != expected.media_type
            || byte_size != expected.byte_size
        {
            return Err(BackupVerifyError::Invalid);
        }
        documents_checked += 1;
    }

    let (posted_transactions, journal_entries, ledger_findings) =
        persistence::inspect_existing_database(&database, key.as_slice(), |connection| {
            let mut statement = connection.prepare("SELECT id FROM households ORDER BY id")?;
            let households = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            let (mut transactions, mut entries, mut findings) = (0_u64, 0_u64, 0_u64);
            for household in households {
                let report = ledger_audit::audit_household(connection, &household)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                transactions += report.posted_transactions;
                entries += report.journal_entries;
                findings += u64::try_from(report.findings.len()).unwrap_or(u64::MAX);
                if report.truncated {
                    findings = findings.saturating_add(1);
                }
            }
            Ok((transactions, entries, findings))
        })
        .map_err(|_| BackupVerifyError::Invalid)?;

    Ok(BackupVerificationDto {
        entry_count: summary.entry_count,
        plaintext_bytes: summary.plaintext_bytes,
        schema_version: info.schema_version,
        household_count: info.household_count,
        documents_checked,
        posted_transactions,
        journal_entries,
        ledger_findings,
        ok: ledger_findings == 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    const PASSPHRASE: &str = "verify correct horse battery staple";

    fn archive_fixture(root: &Path) -> PathBuf {
        let source = root.join("source");
        let database = source.join("kakeflow.db");
        let archive = root.join("portable.kfb");
        let key = [0x42_u8; 32];
        let state = AppState::open_with_key(database.clone(), &key).expect("source database");
        let vault = DocumentVault::new(source.join("vault"), &key).expect("source vault");
        let stored = vault
            .put(b"receipt bytes", "application/octet-stream")
            .expect("document");
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households (id, name) VALUES ('household', 'Verify')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO import_runs (id, household_id, status) VALUES ('run', 'household', 'POSTED')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO source_documents \
                     (id, household_id, import_run_id, source_type, original_filename, \
                      media_type, byte_size, sha256, storage_path) \
                     VALUES ('document', 'household', 'run', 'MANUAL_UPLOAD', 'receipt.bin', \
                             'application/octet-stream', 13, ?1, ?2)",
                    rusqlite::params![stored.sha256, format!("vault://{}", stored.sha256)],
                )?;
                connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
                Ok(())
            })
            .expect("source rows");
        drop(state);
        backup::create_portable_backup(database, source.join("vault"), &archive, PASSPHRASE, &key)
            .expect("archive");
        archive
    }

    fn scratch_leftovers(parent: &Path) -> usize {
        fs::read_dir(parent)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|entry| {
                        entry
                            .file_name()
                            .to_string_lossy()
                            .starts_with(SCRATCH_PREFIX)
                    })
                    .count()
            })
            .unwrap_or(0)
    }

    #[test]
    fn verifies_a_good_archive_and_removes_the_scratch_directory() {
        let root = tempfile::tempdir().expect("temp root");
        let archive = archive_fixture(root.path());
        let scratch_parent = root.path().join("app-data");

        let report =
            verify_portable_backup(&scratch_parent, &archive, PASSPHRASE).expect("verification");

        assert!(report.ok);
        assert_eq!(report.household_count, 1);
        assert_eq!(report.documents_checked, 1);
        assert_eq!(report.ledger_findings, 0);
        assert!(report.schema_version > 0);
        assert_eq!(scratch_leftovers(&scratch_parent), 0);
    }

    #[test]
    fn rejects_a_wrong_passphrase_and_leaves_nothing_behind() {
        let root = tempfile::tempdir().expect("temp root");
        let archive = archive_fixture(root.path());
        let scratch_parent = root.path().join("app-data");

        let result =
            verify_portable_backup(&scratch_parent, &archive, "not the right passphrase!!");

        assert_eq!(result, Err(BackupVerifyError::Backup));
        assert_eq!(scratch_leftovers(&scratch_parent), 0);
    }

    #[test]
    fn rejects_a_corrupted_archive() {
        let root = tempfile::tempdir().expect("temp root");
        let archive = archive_fixture(root.path());
        let mut bytes = fs::read(&archive).expect("read archive");
        let middle = bytes.len() / 2;
        bytes[middle] ^= 0xff;
        fs::write(&archive, bytes).expect("write corrupted archive");
        let scratch_parent = root.path().join("app-data");

        let result = verify_portable_backup(&scratch_parent, &archive, PASSPHRASE);

        assert_eq!(result, Err(BackupVerifyError::Backup));
        assert_eq!(scratch_leftovers(&scratch_parent), 0);
    }

    #[test]
    fn removes_stale_scratch_directories_only() {
        let root = tempfile::tempdir().expect("temp root");
        fs::create_dir(root.path().join(format!("{SCRATCH_PREFIX}-1-2"))).expect("stale");
        fs::create_dir(root.path().join("database")).expect("keep");

        remove_stale_scratch(root.path());

        assert_eq!(scratch_leftovers(root.path()), 0);
        assert!(root.path().join("database").exists());
    }
}
