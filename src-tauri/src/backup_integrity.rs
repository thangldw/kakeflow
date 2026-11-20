//! Passphrase-free integrity check of backup files already written.
//!
//! When a backup is created its SHA-256 and size are remembered (device-local). Later the files can be re-read
//! and compared: still there and unchanged, missing, or changed (truncated, bit-rotted, synced badly). This
//! proves the *file* is intact; it does not open the backup, so it cannot prove the passphrase is remembered —
//! the existing "verify backup" flow does that.

use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use thiserror::Error;

const KEEP_NEWEST: i64 = 10;

#[derive(Debug, Error)]
pub enum BackupIntegrityError {
    #[error("backup integrity database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("backup file could not be read")]
    Io,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprint {
    pub path: String,
    pub sha256: String,
    pub byte_size: u64,
    pub recorded_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FileStatus {
    Ok,
    Missing,
    Changed,
    Unreadable,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileCheckDto {
    pub path: String,
    pub file_name: String,
    pub recorded_at: String,
    pub byte_size: u64,
    pub status: FileStatus,
}

/// Streams the file through SHA-256; returns (hex digest, size).
pub fn hash_file(path: &Path) -> Result<(String, u64), BackupIntegrityError> {
    let mut file = std::fs::File::open(path).map_err(|_| BackupIntegrityError::Io)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut total = 0_u64;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| BackupIntegrityError::Io)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        total += read as u64;
    }
    let digest = hasher.finalize();
    Ok((
        digest.iter().map(|byte| format!("{byte:02x}")).collect(),
        total,
    ))
}

/// Remembers a backup file's fingerprint (replacing an earlier one for the same path) and keeps only the newest few.
pub fn record(connection: &Connection, path: &Path) -> Result<(), BackupIntegrityError> {
    let (sha256, size) = hash_file(path)?;
    let text = path.to_string_lossy();
    if text.is_empty() || text.len() > 4096 {
        return Err(BackupIntegrityError::Io);
    }
    connection.execute(
        "INSERT INTO backup_fingerprints(path, sha256, byte_size) VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET sha256 = excluded.sha256, byte_size = excluded.byte_size,
                                         recorded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        params![text, sha256, size as i64],
    )?;
    connection.execute(
        "DELETE FROM backup_fingerprints WHERE path NOT IN
           (SELECT path FROM backup_fingerprints ORDER BY recorded_at DESC, path LIMIT ?1)",
        params![KEEP_NEWEST],
    )?;
    Ok(())
}

pub fn list(connection: &Connection) -> Result<Vec<Fingerprint>, BackupIntegrityError> {
    let rows = connection
        .prepare(
            "SELECT path, sha256, byte_size, recorded_at FROM backup_fingerprints
              ORDER BY recorded_at DESC, path",
        )?
        .query_map([], |row| {
            Ok(Fingerprint {
                path: row.get(0)?,
                sha256: row.get(1)?,
                byte_size: row.get::<_, i64>(2)? as u64,
                recorded_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Re-reads each remembered file and compares it with its fingerprint. Touches only the filesystem.
pub fn check(fingerprints: &[Fingerprint]) -> Vec<BackupFileCheckDto> {
    fingerprints
        .iter()
        .map(|fingerprint| {
            let path = Path::new(&fingerprint.path);
            let status = match std::fs::metadata(path) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => FileStatus::Missing,
                Err(_) => FileStatus::Unreadable,
                Ok(meta) if meta.len() != fingerprint.byte_size => FileStatus::Changed,
                Ok(_) => match hash_file(path) {
                    Ok((hash, _)) if hash == fingerprint.sha256 => FileStatus::Ok,
                    Ok(_) => FileStatus::Changed,
                    Err(_) => FileStatus::Unreadable,
                },
            };
            BackupFileCheckDto {
                path: fingerprint.path.clone(),
                file_name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| fingerprint.path.clone()),
                recorded_at: fingerprint.recorded_at.clone(),
                byte_size: fingerprint.byte_size,
                status,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;
    use std::fs;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kakeflow-bi-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn with_db(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(&[8_u8; 32]).expect("migrations");
        state
            .with_connection(|connection| {
                test(connection);
                Ok(())
            })
            .expect("body");
    }

    #[test]
    fn hashes_a_file_the_same_way_as_a_known_digest() {
        let dir = scratch("hash");
        let file = dir.join("a.bin");
        fs::write(&file, b"abc").unwrap();
        let (hash, size) = hash_file(&file).unwrap();
        assert_eq!(
            hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(size, 3);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn detects_ok_changed_same_size_changed_and_missing() {
        let dir = scratch("check");
        with_db(|c| {
            let (ok, grown, flipped, gone) = (
                dir.join("ok.kb"),
                dir.join("grown.kb"),
                dir.join("flipped.kb"),
                dir.join("gone.kb"),
            );
            for file in [&ok, &grown, &flipped, &gone] {
                fs::write(file, b"0123456789").unwrap();
                record(c, file).unwrap();
            }
            fs::write(&grown, b"0123456789!").unwrap();
            fs::write(&flipped, b"0123456780").unwrap();
            fs::remove_file(&gone).unwrap();
            let results = check(&list(c).unwrap());
            let status = |name: &str| results.iter().find(|r| r.file_name == name).unwrap().status;
            assert_eq!(status("ok.kb"), FileStatus::Ok);
            assert_eq!(status("grown.kb"), FileStatus::Changed);
            assert_eq!(status("flipped.kb"), FileStatus::Changed);
            assert_eq!(status("gone.kb"), FileStatus::Missing);
        });
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn re_recording_a_path_replaces_it_and_only_the_newest_are_kept() {
        let dir = scratch("keep");
        with_db(|c| {
            let file = dir.join("same.kb");
            fs::write(&file, b"one").unwrap();
            record(c, &file).unwrap();
            fs::write(&file, b"two!").unwrap();
            record(c, &file).unwrap();
            let rows = list(c).unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].byte_size, 4);
            for n in 0..12 {
                let f = dir.join(format!("b{n}.kb"));
                fs::write(&f, [n as u8]).unwrap();
                record(c, &f).unwrap();
            }
            assert_eq!(list(c).unwrap().len(), KEEP_NEWEST as usize);
        });
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn recording_an_unreadable_path_fails_without_a_row() {
        with_db(|c| {
            assert!(record(c, Path::new("/definitely/not/here.kb")).is_err());
            assert!(list(c).unwrap().is_empty());
        });
    }
}
