use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::io::Read as _;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use thiserror::Error;

const MAX_HOUSEHOLD_ID_LEN: usize = 48;
const MAX_FOLDER_ID_LEN: usize = 64;
const MAX_LABEL_LEN: usize = 80;
const MAX_STORED_PATH_LEN: usize = 4096;
const MAX_SCAN_DEPTH: usize = 4;
const MAX_SCANNED_ENTRIES: usize = 4_096;
const MAX_SUPPORTED_FILES: usize = 2_000;
const MAX_RELATIVE_PATH_LEN: usize = 1_024;
const MAX_WATCHED_FILE_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum WatchedFolderError {
    #[error("invalid input")]
    InvalidInput,
    #[error("folder is unavailable")]
    FolderUnavailable,
    #[error("folder links are not allowed")]
    SymlinkNotAllowed,
    #[error("record was not found")]
    NotFound,
    #[error("folder is already watched")]
    Conflict,
    #[error("scan safety limit was exceeded")]
    ScanLimit,
    #[error("database is unavailable")]
    Database,
}

impl WatchedFolderError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput => "Watched folder input is invalid",
            Self::FolderUnavailable => "Selected folder is unavailable",
            Self::SymlinkNotAllowed => "Symbolic-link folders are not allowed",
            Self::NotFound => "Watched folder was not found",
            Self::Conflict => "This folder is already watched for the household",
            Self::ScanLimit => "Folder scan exceeded its safety limit",
            Self::Database => "Watched folders are temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolderDto {
    pub id: String,
    pub household_id: String,
    pub label: String,
    /// A non-sensitive leaf name for display. The absolute path remains native-only.
    pub display_name: String,
    pub is_enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFileMetadataDto {
    pub relative_path: String,
    pub file_name: String,
    pub media_type: String,
    pub byte_size: u64,
    pub modified_unix_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolderScanDto {
    pub watched_folder_id: String,
    pub files: Vec<WatchedFileMetadataDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFileDto {
    pub relative_path: String,
    pub file_name: String,
    pub media_type: String,
    pub byte_size: u64,
    pub modified_unix_ms: Option<u64>,
    pub file_bytes: Vec<u8>,
}

fn valid_identifier(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn validate_label(label: &str) -> Result<&str, WatchedFolderError> {
    let trimmed = label.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_LABEL_LEN || trimmed.chars().any(char::is_control)
    {
        return Err(WatchedFolderError::InvalidInput);
    }
    Ok(trimmed)
}

/// Validate once at the native trust boundary and persist only a canonical,
/// existing directory. Every existing path component is inspected without
/// following links before canonicalization, including on Windows where
/// `canonicalize` may add a verbatim path prefix.
pub fn validate_selected_directory(path: &Path) -> Result<PathBuf, WatchedFolderError> {
    if !path.is_absolute() {
        return Err(WatchedFolderError::InvalidInput);
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err(WatchedFolderError::InvalidInput);
        }
        current.push(component);
        // A Windows drive prefix is not independently queryable. Its root and
        // all following components are inspected on subsequent iterations.
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        let component_metadata =
            fs::symlink_metadata(&current).map_err(|_| WatchedFolderError::FolderUnavailable)?;
        if component_metadata.file_type().is_symlink() {
            return Err(WatchedFolderError::SymlinkNotAllowed);
        }
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| WatchedFolderError::FolderUnavailable)?;
    if !metadata.is_dir() {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    let canonical = fs::canonicalize(path).map_err(|_| WatchedFolderError::FolderUnavailable)?;
    let encoded = canonical.to_str().ok_or(WatchedFolderError::InvalidInput)?;
    if encoded.len() > MAX_STORED_PATH_LEN {
        return Err(WatchedFolderError::InvalidInput);
    }
    // Opening the directory now catches inaccessible selections before storage.
    fs::read_dir(&canonical).map_err(|_| WatchedFolderError::FolderUnavailable)?;
    Ok(canonical)
}

pub fn register(
    connection: &Connection,
    household_id: &str,
    label: &str,
    selected_path: &Path,
) -> Result<WatchedFolderDto, WatchedFolderError> {
    if !valid_identifier(household_id, MAX_HOUSEHOLD_ID_LEN) {
        return Err(WatchedFolderError::InvalidInput);
    }
    let label = validate_label(label)?;
    let canonical = validate_selected_directory(selected_path)?;
    let canonical_text = canonical.to_str().ok_or(WatchedFolderError::InvalidInput)?;
    let id = random_id()?;
    let household_exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM households WHERE id = ?1)",
            [household_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| WatchedFolderError::Database)?;
    if !household_exists {
        return Err(WatchedFolderError::NotFound);
    }
    connection
        .execute(
            "INSERT INTO watched_folders (id, household_id, label, canonical_path)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, household_id, label, canonical_text],
        )
        .map_err(map_database_error)?;
    get(connection, household_id, &id)?.ok_or(WatchedFolderError::Database)
}

pub fn list(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<WatchedFolderDto>, WatchedFolderError> {
    if !valid_identifier(household_id, MAX_HOUSEHOLD_ID_LEN) {
        return Err(WatchedFolderError::InvalidInput);
    }
    let mut statement = connection
        .prepare(
            "SELECT id, household_id, label, canonical_path, is_enabled, created_at
             FROM watched_folders WHERE household_id = ?1
             ORDER BY created_at ASC, id ASC",
        )
        .map_err(|_| WatchedFolderError::Database)?;
    let rows = statement
        .query_map([household_id], row_to_dto)
        .map_err(|_| WatchedFolderError::Database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| WatchedFolderError::Database)
}

pub fn remove(
    connection: &Connection,
    household_id: &str,
    watched_folder_id: &str,
) -> Result<(), WatchedFolderError> {
    validate_lookup(household_id, watched_folder_id)?;
    let changed = connection
        .execute(
            "DELETE FROM watched_folders WHERE id = ?1 AND household_id = ?2",
            params![watched_folder_id, household_id],
        )
        .map_err(|_| WatchedFolderError::Database)?;
    if changed == 0 {
        return Err(WatchedFolderError::NotFound);
    }
    Ok(())
}

pub fn scan_registered(
    connection: &Connection,
    household_id: &str,
    watched_folder_id: &str,
) -> Result<WatchedFolderScanDto, WatchedFolderError> {
    validate_lookup(household_id, watched_folder_id)?;
    let root = registered_root(connection, household_id, watched_folder_id)?;
    Ok(WatchedFolderScanDto {
        watched_folder_id: watched_folder_id.to_owned(),
        files: scan_directory(&root)?,
    })
}

pub fn read_registered_file(
    connection: &Connection,
    household_id: &str,
    watched_folder_id: &str,
    relative_path: &str,
) -> Result<WatchedFileDto, WatchedFolderError> {
    validate_lookup(household_id, watched_folder_id)?;
    let relative = validate_relative_path(relative_path)?;
    let root = registered_root(connection, household_id, watched_folder_id)?;
    let path = root.join(relative);
    let (metadata, media_type) = validate_read_target(&root, &path)?;
    if metadata.len() > MAX_WATCHED_FILE_BYTES {
        return Err(WatchedFolderError::ScanLimit);
    }

    let file = fs::File::open(&path).map_err(|_| WatchedFolderError::FolderUnavailable)?;
    let mut file_bytes = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0));
    file.take(MAX_WATCHED_FILE_BYTES + 1)
        .read_to_end(&mut file_bytes)
        .map_err(|_| WatchedFolderError::FolderUnavailable)?;
    if file_bytes.len() as u64 > MAX_WATCHED_FILE_BYTES {
        return Err(WatchedFolderError::ScanLimit);
    }

    // Detect replacement or growth during the read. The application never
    // imports bytes if the path no longer resolves to the same safe shape.
    let (final_metadata, final_media_type) = validate_read_target(&root, &path)?;
    if final_metadata.len() != file_bytes.len() as u64
        || final_metadata.len() != metadata.len()
        || final_media_type != media_type
    {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    let relative_path = relative_path.replace('\\', "/");
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(WatchedFolderError::InvalidInput)?
        .to_owned();
    Ok(WatchedFileDto {
        relative_path,
        file_name,
        media_type: media_type.to_owned(),
        byte_size: final_metadata.len(),
        modified_unix_ms: modified_unix_ms(&final_metadata),
        file_bytes,
    })
}

fn registered_root(
    connection: &Connection,
    household_id: &str,
    watched_folder_id: &str,
) -> Result<PathBuf, WatchedFolderError> {
    let stored: Option<String> = connection
        .query_row(
            "SELECT canonical_path FROM watched_folders
             WHERE id = ?1 AND household_id = ?2 AND is_enabled = 1",
            params![watched_folder_id, household_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| WatchedFolderError::Database)?;
    let stored = stored.ok_or(WatchedFolderError::NotFound)?;
    validate_selected_directory(Path::new(&stored))
}

fn validate_relative_path(relative_path: &str) -> Result<&Path, WatchedFolderError> {
    if relative_path.is_empty()
        || relative_path.len() > MAX_RELATIVE_PATH_LEN
        || relative_path.chars().any(char::is_control)
    {
        return Err(WatchedFolderError::InvalidInput);
    }
    let path = Path::new(relative_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(WatchedFolderError::InvalidInput);
    }
    Ok(path)
}

fn validate_read_target<'a>(
    root: &Path,
    path: &'a Path,
) -> Result<(fs::Metadata, &'a str), WatchedFolderError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| WatchedFolderError::FolderUnavailable)?;
    if metadata.file_type().is_symlink() {
        return Err(WatchedFolderError::SymlinkNotAllowed);
    }
    if !metadata.is_file() {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    let media_type = supported_media_type(path).ok_or(WatchedFolderError::InvalidInput)?;
    let canonical = fs::canonicalize(path).map_err(|_| WatchedFolderError::FolderUnavailable)?;
    if canonical != path || !canonical.starts_with(root) {
        return Err(WatchedFolderError::SymlinkNotAllowed);
    }
    Ok((metadata, media_type))
}

fn scan_directory(root: &Path) -> Result<Vec<WatchedFileMetadataDto>, WatchedFolderError> {
    let mut pending = vec![(root.to_path_buf(), 0_usize)];
    let mut visited_entries = 0_usize;
    let mut files = Vec::new();

    while let Some((directory, depth)) = pending.pop() {
        validate_scan_directory(root, &directory)?;
        for entry in fs::read_dir(&directory).map_err(|_| WatchedFolderError::FolderUnavailable)? {
            let entry = entry.map_err(|_| WatchedFolderError::FolderUnavailable)?;
            visited_entries = visited_entries
                .checked_add(1)
                .ok_or(WatchedFolderError::ScanLimit)?;
            if visited_entries > MAX_SCANNED_ENTRIES {
                return Err(WatchedFolderError::ScanLimit);
            }
            let file_type = entry
                .file_type()
                .map_err(|_| WatchedFolderError::FolderUnavailable)?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            let metadata =
                fs::symlink_metadata(&path).map_err(|_| WatchedFolderError::FolderUnavailable)?;
            if metadata.is_dir() {
                if depth < MAX_SCAN_DEPTH {
                    pending.push((path, depth + 1));
                }
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            let Some(media_type) = supported_media_type(&path) else {
                continue;
            };
            if files.len() >= MAX_SUPPORTED_FILES {
                return Err(WatchedFolderError::ScanLimit);
            }
            // Never disclose the configured absolute root to the webview.
            let relative = path
                .strip_prefix(root)
                .map_err(|_| WatchedFolderError::FolderUnavailable)?;
            let relative_path = relative
                .to_str()
                .ok_or(WatchedFolderError::InvalidInput)?
                .replace('\\', "/");
            let file_name = entry
                .file_name()
                .to_str()
                .ok_or(WatchedFolderError::InvalidInput)?
                .to_owned();
            files.push(WatchedFileMetadataDto {
                relative_path,
                file_name,
                media_type: media_type.to_owned(),
                byte_size: metadata.len(),
                modified_unix_ms: modified_unix_ms(&metadata),
            });
        }
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(files)
}

fn modified_unix_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn validate_scan_directory(root: &Path, directory: &Path) -> Result<(), WatchedFolderError> {
    let metadata =
        fs::symlink_metadata(directory).map_err(|_| WatchedFolderError::FolderUnavailable)?;
    if metadata.file_type().is_symlink() {
        return Err(WatchedFolderError::SymlinkNotAllowed);
    }
    if !metadata.is_dir() {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    let canonical =
        fs::canonicalize(directory).map_err(|_| WatchedFolderError::FolderUnavailable)?;
    if canonical != directory || !canonical.starts_with(root) {
        return Err(WatchedFolderError::SymlinkNotAllowed);
    }
    Ok(())
}

fn supported_media_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "csv" => Some("text/csv"),
        "xlsx" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "xls" => Some("application/vnd.ms-excel"),
        "pdf" => Some("application/pdf"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        _ => None,
    }
}

fn validate_lookup(household_id: &str, watched_folder_id: &str) -> Result<(), WatchedFolderError> {
    if !valid_identifier(household_id, MAX_HOUSEHOLD_ID_LEN)
        || !valid_identifier(watched_folder_id, MAX_FOLDER_ID_LEN)
    {
        return Err(WatchedFolderError::InvalidInput);
    }
    Ok(())
}

fn get(
    connection: &Connection,
    household_id: &str,
    id: &str,
) -> Result<Option<WatchedFolderDto>, WatchedFolderError> {
    connection
        .query_row(
            "SELECT id, household_id, label, canonical_path, is_enabled, created_at
             FROM watched_folders WHERE household_id = ?1 AND id = ?2",
            params![household_id, id],
            row_to_dto,
        )
        .optional()
        .map_err(|_| WatchedFolderError::Database)
}

fn row_to_dto(row: &rusqlite::Row<'_>) -> rusqlite::Result<WatchedFolderDto> {
    let canonical_path: String = row.get(3)?;
    let display_name = Path::new(&canonical_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Selected folder")
        .to_owned();
    Ok(WatchedFolderDto {
        id: row.get(0)?,
        household_id: row.get(1)?,
        label: row.get(2)?,
        display_name,
        is_enabled: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn random_id() -> Result<String, WatchedFolderError> {
    let mut random = [0_u8; 16];
    getrandom::getrandom(&mut random).map_err(|_| WatchedFolderError::Database)?;
    Ok(format!(
        "watch-{}",
        random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

fn map_database_error(error: rusqlite::Error) -> WatchedFolderError {
    match error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == ErrorCode::ConstraintViolation =>
        {
            WatchedFolderError::Conflict
        }
        _ => WatchedFolderError::Database,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn temporary_directory() -> PathBuf {
        let mut random = [0_u8; 8];
        getrandom::getrandom(&mut random).unwrap();
        let suffix = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let path = std::env::temp_dir().join(format!("kakeflow-watch-{suffix}"));
        fs::create_dir(&path).unwrap();
        fs::canonicalize(path).unwrap()
    }

    #[test]
    fn scan_returns_only_supported_regular_file_metadata() {
        let root = temporary_directory();
        fs::create_dir(root.join("nested")).unwrap();
        fs::File::create(root.join("bank.csv"))
            .unwrap()
            .write_all(b"date,amount")
            .unwrap();
        fs::File::create(root.join("nested").join("receipt.JPG"))
            .unwrap()
            .write_all(b"image")
            .unwrap();
        fs::File::create(root.join("ignore.txt")).unwrap();

        let files = scan_directory(&root).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].relative_path, "bank.csv");
        assert_eq!(files[0].byte_size, 11);
        assert_eq!(files[1].relative_path, "nested/receipt.JPG");
        assert_eq!(files[1].media_type, "image/jpeg");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn selected_symlinks_and_scanned_symlinks_are_rejected_or_skipped() {
        use std::os::unix::fs::symlink;

        let root = temporary_directory();
        let linked_root = root.with_extension("link");
        symlink(&root, &linked_root).unwrap();
        assert!(matches!(
            validate_selected_directory(&linked_root),
            Err(WatchedFolderError::SymlinkNotAllowed)
        ));

        fs::File::create(root.join("receipt.pdf")).unwrap();
        symlink(root.join("receipt.pdf"), root.join("linked.pdf")).unwrap();
        let files = scan_directory(&root).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].relative_path, "receipt.pdf");
        fs::remove_file(linked_root).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repository_scopes_records_to_the_household() {
        let root = temporary_directory();
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON;
                 CREATE TABLE households (id TEXT PRIMARY KEY);
                 INSERT INTO households (id) VALUES ('home'), ('other');",
            )
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0008_watched_folders.sql"))
            .unwrap();
        let watched = register(&connection, "home", "Inbox", &root).unwrap();

        assert_eq!(list(&connection, "home").unwrap().len(), 1);
        assert!(list(&connection, "other").unwrap().is_empty());
        assert!(matches!(
            scan_registered(&connection, "other", &watched.id),
            Err(WatchedFolderError::NotFound)
        ));
        assert!(matches!(
            remove(&connection, "other", &watched.id),
            Err(WatchedFolderError::NotFound)
        ));
        remove(&connection, "home", &watched.id).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn registered_read_is_bounded_scoped_and_never_accepts_traversal() {
        let root = temporary_directory();
        fs::File::create(root.join("bank.csv"))
            .unwrap()
            .write_all(b"date,amount")
            .unwrap();
        fs::File::create(root.join("ignore.txt"))
            .unwrap()
            .write_all(b"private")
            .unwrap();
        fs::File::create(root.join("oversized.pdf"))
            .unwrap()
            .set_len(MAX_WATCHED_FILE_BYTES + 1)
            .unwrap();
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON;
                 CREATE TABLE households (id TEXT PRIMARY KEY);
                 INSERT INTO households (id) VALUES ('home'), ('other');",
            )
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0008_watched_folders.sql"))
            .unwrap();
        let watched = register(&connection, "home", "Inbox", &root).unwrap();

        let file = read_registered_file(&connection, "home", &watched.id, "bank.csv").unwrap();
        assert_eq!(file.file_bytes, b"date,amount");
        assert_eq!(file.relative_path, "bank.csv");
        assert!(matches!(
            read_registered_file(&connection, "home", &watched.id, "../bank.csv"),
            Err(WatchedFolderError::InvalidInput)
        ));
        assert!(matches!(
            read_registered_file(&connection, "home", &watched.id, "/etc/passwd"),
            Err(WatchedFolderError::InvalidInput)
        ));
        assert!(matches!(
            read_registered_file(&connection, "home", &watched.id, "ignore.txt"),
            Err(WatchedFolderError::InvalidInput)
        ));
        assert!(matches!(
            read_registered_file(&connection, "home", &watched.id, "oversized.pdf"),
            Err(WatchedFolderError::ScanLimit)
        ));
        assert!(matches!(
            read_registered_file(&connection, "other", &watched.id, "bank.csv"),
            Err(WatchedFolderError::NotFound)
        ));
        fs::remove_dir_all(root).unwrap();
    }
}
