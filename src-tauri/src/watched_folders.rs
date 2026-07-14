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
    #[error("cloud file is not available locally")]
    CloudFileUnavailable,
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
            Self::CloudFileUnavailable => "CLOUD_FILE_UNAVAILABLE",
            Self::SymlinkNotAllowed => "Symbolic-link folders are not allowed",
            Self::NotFound => "Watched folder was not found",
            Self::Conflict => "This folder is already watched for the household",
            Self::ScanLimit => "Folder scan exceeded its safety limit",
            Self::Database => "Watched folders are temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WatchedFolderSourceType {
    LocalFolder,
    IcloudPicker,
}

impl WatchedFolderSourceType {
    fn as_str(self) -> &'static str {
        match self {
            Self::LocalFolder => "LOCAL_FOLDER",
            Self::IcloudPicker => "ICLOUD_PICKER",
        }
    }

    fn from_database(value: &str) -> Option<Self> {
        match value {
            "LOCAL_FOLDER" => Some(Self::LocalFolder),
            "ICLOUD_PICKER" => Some(Self::IcloudPicker),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WatchedFolderProvider {
    Local,
    Icloud,
}

impl WatchedFolderProvider {
    fn as_str(self) -> &'static str {
        match self {
            Self::Local => "LOCAL",
            Self::Icloud => "ICLOUD",
        }
    }

    fn from_database(value: &str) -> Option<Self> {
        match value {
            "LOCAL" => Some(Self::Local),
            "ICLOUD" => Some(Self::Icloud),
            _ => None,
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
    pub source_type: WatchedFolderSourceType,
    pub provider: WatchedFolderProvider,
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

/// Device-local registration metadata used only by the native discovery
/// supervisor. The canonical root must never be serialized or sent to the
/// webview; public DTOs deliberately omit it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EnabledWatchedFolder {
    pub household_id: String,
    pub watched_folder_id: String,
    pub canonical_root: PathBuf,
    pub source_type: WatchedFolderSourceType,
    pub provider: WatchedFolderProvider,
}

pub(crate) fn list_enabled_registrations(
    connection: &Connection,
) -> Result<Vec<EnabledWatchedFolder>, WatchedFolderError> {
    let mut statement = connection
        .prepare(
            "SELECT household_id, id, canonical_path, source_type, provider FROM watched_folders
             WHERE is_enabled = 1 ORDER BY household_id, id",
        )
        .map_err(|_| WatchedFolderError::Database)?;
    let rows = statement
        .query_map([], |row| {
            let source_type = parse_source_type(row.get::<_, String>(3)?)?;
            let provider = parse_provider(row.get::<_, String>(4)?)?;
            Ok(EnabledWatchedFolder {
                household_id: row.get(0)?,
                watched_folder_id: row.get(1)?,
                canonical_root: PathBuf::from(row.get::<_, String>(2)?),
                source_type,
                provider,
            })
        })
        .map_err(|_| WatchedFolderError::Database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| WatchedFolderError::Database)
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

/// Returns the locally synchronized iCloud Drive root for the current OS.
/// The root must already exist; KakeFlow never creates or guesses a cloud
/// container because that could silently register an unrelated directory.
pub fn resolve_icloud_root() -> Result<PathBuf, WatchedFolderError> {
    #[cfg(target_os = "macos")]
    let candidate = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library/Mobile Documents/com~apple~CloudDocs"));

    #[cfg(target_os = "windows")]
    let candidate = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|home| home.join("iCloudDrive"));

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let candidate: Option<PathBuf> = None;

    validate_selected_directory(&candidate.ok_or(WatchedFolderError::FolderUnavailable)?)
}

pub fn validate_icloud_selection(
    selected_path: &Path,
    icloud_root: &Path,
) -> Result<PathBuf, WatchedFolderError> {
    let canonical_root = validate_selected_directory(icloud_root)?;
    let canonical_selected = validate_selected_directory(selected_path)?;
    if !canonical_selected.starts_with(&canonical_root) {
        return Err(WatchedFolderError::InvalidInput);
    }
    Ok(canonical_selected)
}

pub fn register_icloud(
    connection: &Connection,
    household_id: &str,
    label: &str,
    selected_path: &Path,
    icloud_root: &Path,
) -> Result<WatchedFolderDto, WatchedFolderError> {
    let canonical_selected = validate_icloud_selection(selected_path, icloud_root)?;
    register_with_source(
        connection,
        household_id,
        label,
        &canonical_selected,
        WatchedFolderSourceType::IcloudPicker,
        WatchedFolderProvider::Icloud,
    )
}

pub fn register(
    connection: &Connection,
    household_id: &str,
    label: &str,
    selected_path: &Path,
) -> Result<WatchedFolderDto, WatchedFolderError> {
    register_with_source(
        connection,
        household_id,
        label,
        selected_path,
        WatchedFolderSourceType::LocalFolder,
        WatchedFolderProvider::Local,
    )
}

pub fn register_with_source(
    connection: &Connection,
    household_id: &str,
    label: &str,
    selected_path: &Path,
    source_type: WatchedFolderSourceType,
    provider: WatchedFolderProvider,
) -> Result<WatchedFolderDto, WatchedFolderError> {
    if !matches!(
        (source_type, provider),
        (
            WatchedFolderSourceType::LocalFolder,
            WatchedFolderProvider::Local
        ) | (
            WatchedFolderSourceType::IcloudPicker,
            WatchedFolderProvider::Icloud
        )
    ) {
        return Err(WatchedFolderError::InvalidInput);
    }
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
            "INSERT INTO watched_folders (
                 id, household_id, label, canonical_path, source_type, provider
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                household_id,
                label,
                canonical_text,
                source_type.as_str(),
                provider.as_str()
            ],
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
            "SELECT id, household_id, label, canonical_path, source_type, provider,
                    is_enabled, created_at
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
    let (root, source_type) =
        registered_root_with_source(connection, household_id, watched_folder_id)?;
    let cloud_backed = source_type == WatchedFolderSourceType::IcloudPicker;
    let path = root.join(relative);
    let media_type = supported_media_type(&path).ok_or(WatchedFolderError::InvalidInput)?;
    let mut file = match open_regular_file_bound_to_path(&root, &path) {
        Ok(file) => file,
        Err(
            error @ (WatchedFolderError::SymlinkNotAllowed | WatchedFolderError::FolderUnavailable),
        ) if cloud_backed && validate_path_shape(&root, &path).is_ok() => {
            let _ = error;
            return Err(WatchedFolderError::CloudFileUnavailable);
        }
        Err(error) => return Err(error),
    };
    let opened_metadata = file
        .metadata()
        .map_err(|_| cloud_access_error(cloud_backed))?;
    let opened_identity = file_identity(&file, &opened_metadata)?;
    let opened_modified = opened_metadata.modified().ok();
    if opened_metadata.len() > MAX_WATCHED_FILE_BYTES {
        return Err(WatchedFolderError::ScanLimit);
    }

    let mut file_bytes = Vec::with_capacity(usize::try_from(opened_metadata.len()).unwrap_or(0));
    (&mut file)
        .take(MAX_WATCHED_FILE_BYTES + 1)
        .read_to_end(&mut file_bytes)
        .map_err(|_| cloud_access_error(cloud_backed))?;
    if file_bytes.len() as u64 > MAX_WATCHED_FILE_BYTES {
        return Err(WatchedFolderError::ScanLimit);
    }

    // Recheck both the already-open handle and the pathname. The identity
    // comparison rejects same-size rename/replacement races that length-only
    // checks cannot detect.
    let final_handle_metadata = file
        .metadata()
        .map_err(|_| WatchedFolderError::FolderUnavailable)?;
    let final_handle_identity = file_identity(&file, &final_handle_metadata)?;
    if final_handle_identity != opened_identity
        || final_handle_metadata.len() != opened_metadata.len()
        || final_handle_metadata.len() != file_bytes.len() as u64
        || final_handle_metadata.modified().ok() != opened_modified
    {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    verify_path_matches_open_file(
        &root,
        &path,
        &opened_identity,
        opened_metadata.len(),
        opened_modified,
    )?;
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
        byte_size: final_handle_metadata.len(),
        modified_unix_ms: modified_unix_ms(&final_handle_metadata),
        file_bytes,
    })
}

fn registered_root(
    connection: &Connection,
    household_id: &str,
    watched_folder_id: &str,
) -> Result<PathBuf, WatchedFolderError> {
    registered_root_with_source(connection, household_id, watched_folder_id).map(|(root, _)| root)
}

fn registered_root_with_source(
    connection: &Connection,
    household_id: &str,
    watched_folder_id: &str,
) -> Result<(PathBuf, WatchedFolderSourceType), WatchedFolderError> {
    let stored: Option<(String, String)> = connection
        .query_row(
            "SELECT canonical_path, source_type FROM watched_folders
             WHERE id = ?1 AND household_id = ?2 AND is_enabled = 1",
            params![watched_folder_id, household_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| WatchedFolderError::Database)?;
    let (stored_path, stored_source_type) = stored.ok_or(WatchedFolderError::NotFound)?;
    let source_type = WatchedFolderSourceType::from_database(&stored_source_type)
        .ok_or(WatchedFolderError::Database)?;
    validate_selected_directory(Path::new(&stored_path)).map(|root| (root, source_type))
}

fn cloud_access_error(cloud_backed: bool) -> WatchedFolderError {
    if cloud_backed {
        WatchedFolderError::CloudFileUnavailable
    } else {
        WatchedFolderError::FolderUnavailable
    }
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

fn validate_path_shape(root: &Path, path: &Path) -> Result<fs::Metadata, WatchedFolderError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| WatchedFolderError::FolderUnavailable)?;
    if metadata.file_type().is_symlink() {
        return Err(WatchedFolderError::SymlinkNotAllowed);
    }
    if !metadata.is_file() {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    let canonical = fs::canonicalize(path).map_err(|_| WatchedFolderError::FolderUnavailable)?;
    if canonical != path || !canonical.starts_with(root) {
        return Err(WatchedFolderError::SymlinkNotAllowed);
    }
    Ok(metadata)
}

fn open_regular_file_bound_to_path(
    root: &Path,
    path: &Path,
) -> Result<fs::File, WatchedFolderError> {
    let path_metadata = validate_path_shape(root, path)?;
    let file = open_file_no_follow(path)?;
    let handle_metadata = file
        .metadata()
        .map_err(|_| WatchedFolderError::FolderUnavailable)?;
    if !handle_metadata.is_file() || handle_metadata.len() != path_metadata.len() {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    let identity = file_identity(&file, &handle_metadata)?;
    verify_path_matches_open_file(
        root,
        path,
        &identity,
        handle_metadata.len(),
        handle_metadata.modified().ok(),
    )?;
    Ok(file)
}

fn verify_path_matches_open_file(
    root: &Path,
    path: &Path,
    expected_identity: &FileIdentity,
    expected_size: u64,
    expected_modified: Option<std::time::SystemTime>,
) -> Result<fs::Metadata, WatchedFolderError> {
    let path_metadata = validate_path_shape(root, path)?;
    if path_metadata.len() != expected_size {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    let verification_file = open_file_no_follow(path)?;
    let verification_metadata = verification_file
        .metadata()
        .map_err(|_| WatchedFolderError::FolderUnavailable)?;
    if !verification_metadata.is_file()
        || verification_metadata.len() != expected_size
        || verification_metadata.modified().ok() != expected_modified
        || file_identity(&verification_file, &verification_metadata)? != *expected_identity
    {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    Ok(verification_metadata)
}

fn scan_directory(root: &Path) -> Result<Vec<WatchedFileMetadataDto>, WatchedFolderError> {
    let mut pending = vec![(root.to_path_buf(), 0_usize)];
    let mut visited_entries = 0_usize;
    let mut files = Vec::new();

    while let Some((directory, depth)) = pending.pop() {
        let directory_identity = validate_scan_directory(root, &directory)?;
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
            // Bind metadata to an opened no-follow handle and canonical path.
            // This prevents a scan from returning a symlink target or a file
            // that was renamed/replaced between directory enumeration and stat.
            let stable_file = open_regular_file_bound_to_path(root, &path)?;
            let stable_metadata = stable_file
                .metadata()
                .map_err(|_| WatchedFolderError::FolderUnavailable)?;
            let stable_identity = file_identity(&stable_file, &stable_metadata)?;
            let final_metadata = verify_path_matches_open_file(
                root,
                &path,
                &stable_identity,
                stable_metadata.len(),
                stable_metadata.modified().ok(),
            )?;
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
                byte_size: final_metadata.len(),
                modified_unix_ms: modified_unix_ms(&final_metadata),
            });
        }
        if validate_scan_directory(root, &directory)? != directory_identity {
            return Err(WatchedFolderError::FolderUnavailable);
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

fn validate_scan_directory(
    root: &Path,
    directory: &Path,
) -> Result<DirectoryIdentity, WatchedFolderError> {
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
    let handle = open_directory_no_follow(directory)?;
    let handle_metadata = handle
        .metadata()
        .map_err(|_| WatchedFolderError::FolderUnavailable)?;
    if !handle_metadata.is_dir() {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    Ok(DirectoryIdentity {
        identity: file_identity(&handle, &handle_metadata)?,
        modified: handle_metadata.modified().ok(),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileIdentity {
    first: u64,
    second: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DirectoryIdentity {
    identity: FileIdentity,
    modified: Option<std::time::SystemTime>,
}

#[cfg(unix)]
fn open_file_no_follow(path: &Path) -> Result<fs::File, WatchedFolderError> {
    use std::os::unix::fs::OpenOptionsExt as _;

    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| WatchedFolderError::SymlinkNotAllowed)
}

#[cfg(unix)]
fn open_directory_no_follow(path: &Path) -> Result<fs::File, WatchedFolderError> {
    use std::os::unix::fs::OpenOptionsExt as _;

    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY)
        .open(path)
        .map_err(|_| WatchedFolderError::SymlinkNotAllowed)
}

#[cfg(windows)]
fn open_file_no_follow(path: &Path) -> Result<fs::File, WatchedFolderError> {
    use std::os::windows::fs::OpenOptionsExt as _;
    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;

    fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| WatchedFolderError::SymlinkNotAllowed)
}

#[cfg(windows)]
fn open_directory_no_follow(path: &Path) -> Result<fs::File, WatchedFolderError> {
    use std::os::windows::fs::OpenOptionsExt as _;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    };

    fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .map_err(|_| WatchedFolderError::SymlinkNotAllowed)
}

#[cfg(not(any(unix, windows)))]
fn open_file_no_follow(path: &Path) -> Result<fs::File, WatchedFolderError> {
    fs::File::open(path).map_err(|_| WatchedFolderError::FolderUnavailable)
}

#[cfg(not(any(unix, windows)))]
fn open_directory_no_follow(path: &Path) -> Result<fs::File, WatchedFolderError> {
    fs::File::open(path).map_err(|_| WatchedFolderError::FolderUnavailable)
}

#[cfg(unix)]
fn file_identity(
    _file: &fs::File,
    metadata: &fs::Metadata,
) -> Result<FileIdentity, WatchedFolderError> {
    use std::os::unix::fs::MetadataExt as _;

    Ok(FileIdentity {
        first: metadata.dev(),
        second: metadata.ino(),
    })
}

#[cfg(windows)]
fn file_identity(
    file: &fs::File,
    _metadata: &fs::Metadata,
) -> Result<FileIdentity, WatchedFolderError> {
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT,
    };

    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: the handle is owned by `file` for the duration of this call and
    // the output points to a fully sized writable structure.
    let succeeded = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) };
    if succeeded == 0 {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    if information.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(WatchedFolderError::SymlinkNotAllowed);
    }
    Ok(FileIdentity {
        first: u64::from(information.dwVolumeSerialNumber),
        second: (u64::from(information.nFileIndexHigh) << 32)
            | u64::from(information.nFileIndexLow),
    })
}

#[cfg(not(any(unix, windows)))]
fn file_identity(
    _file: &fs::File,
    metadata: &fs::Metadata,
) -> Result<FileIdentity, WatchedFolderError> {
    Ok(FileIdentity {
        first: metadata.len(),
        second: modified_unix_ms(metadata).unwrap_or(0),
    })
}

fn supported_media_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "csv" => Some("text/csv"),
        "tsv" => Some("text/tab-separated-values"),
        "xlsx" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "xls" => Some("application/vnd.ms-excel"),
        "pdf" => Some("application/pdf"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "eml" => Some("message/rfc822"),
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
            "SELECT id, household_id, label, canonical_path, source_type, provider,
                    is_enabled, created_at
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
    let source_type = parse_source_type(row.get::<_, String>(4)?)?;
    let provider = parse_provider(row.get::<_, String>(5)?)?;
    Ok(WatchedFolderDto {
        id: row.get(0)?,
        household_id: row.get(1)?,
        label: row.get(2)?,
        display_name,
        source_type,
        provider,
        is_enabled: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn parse_source_type(value: String) -> rusqlite::Result<WatchedFolderSourceType> {
    WatchedFolderSourceType::from_database(&value).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(0, "source_type".to_owned(), rusqlite::types::Type::Text)
    })
}

fn parse_provider(value: String) -> rusqlite::Result<WatchedFolderProvider> {
    WatchedFolderProvider::from_database(&value).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(0, "provider".to_owned(), rusqlite::types::Type::Text)
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
        fs::File::create(root.join("wallet.tsv"))
            .unwrap()
            .write_all(b"date\tamount")
            .unwrap();
        fs::File::create(root.join("nested").join("receipt.JPG"))
            .unwrap()
            .write_all(b"image")
            .unwrap();
        fs::File::create(root.join("statement.eml"))
            .unwrap()
            .write_all(b"From: bank@example.test\r\n\r\nstatement")
            .unwrap();
        fs::File::create(root.join("ignore.txt")).unwrap();

        let files = scan_directory(&root).unwrap();
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].relative_path, "bank.csv");
        assert_eq!(files[0].byte_size, 11);
        assert_eq!(files[1].relative_path, "nested/receipt.JPG");
        assert_eq!(files[1].media_type, "image/jpeg");
        assert_eq!(files[2].relative_path, "statement.eml");
        assert_eq!(files[2].media_type, "message/rfc822");
        assert_eq!(files[3].relative_path, "wallet.tsv");
        assert_eq!(files[3].media_type, "text/tab-separated-values");
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

    #[cfg(unix)]
    #[test]
    fn opened_file_identity_rejects_same_size_path_replacement() {
        let root = temporary_directory();
        let path = root.join("bank.csv");
        fs::File::create(&path)
            .unwrap()
            .write_all(b"original")
            .unwrap();
        let opened = open_regular_file_bound_to_path(&root, &path).unwrap();
        let opened_metadata = opened.metadata().unwrap();
        let opened_identity = file_identity(&opened, &opened_metadata).unwrap();

        fs::rename(&path, root.join("old.csv")).unwrap();
        fs::File::create(&path)
            .unwrap()
            .write_all(b"replaced")
            .unwrap();
        assert_eq!(opened_metadata.len(), fs::metadata(&path).unwrap().len());
        assert!(matches!(
            verify_path_matches_open_file(
                &root,
                &path,
                &opened_identity,
                opened_metadata.len(),
                opened_metadata.modified().ok(),
            ),
            Err(WatchedFolderError::FolderUnavailable)
        ));
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
        connection
            .execute_batch(include_str!(
                "../migrations/0051_watched_folder_sources.sql"
            ))
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
    fn icloud_registration_requires_a_canonical_descendant_and_persists_provenance() {
        let icloud_root = temporary_directory();
        let inbox = icloud_root.join("KakeFlow Inbox");
        fs::create_dir(&inbox).unwrap();
        let outside = temporary_directory();
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON;
                 CREATE TABLE households (id TEXT PRIMARY KEY);
                 INSERT INTO households (id) VALUES ('home');",
            )
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0008_watched_folders.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0051_watched_folder_sources.sql"
            ))
            .unwrap();

        assert!(matches!(
            register_icloud(&connection, "home", "iCloud", &outside, &icloud_root),
            Err(WatchedFolderError::InvalidInput)
        ));
        let watched = register_icloud(&connection, "home", "iCloud", &inbox, &icloud_root).unwrap();
        assert_eq!(watched.source_type, WatchedFolderSourceType::IcloudPicker);
        assert_eq!(watched.provider, WatchedFolderProvider::Icloud);
        let enabled = list_enabled_registrations(&connection).unwrap();
        assert_eq!(
            enabled[0].source_type,
            WatchedFolderSourceType::IcloudPicker
        );
        assert_eq!(enabled[0].provider, WatchedFolderProvider::Icloud);

        fs::remove_dir_all(icloud_root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn cloud_file_unavailable_has_a_stable_retryable_public_code() {
        assert_eq!(
            WatchedFolderError::CloudFileUnavailable.public_message(),
            "CLOUD_FILE_UNAVAILABLE"
        );
        assert!(matches!(
            cloud_access_error(true),
            WatchedFolderError::CloudFileUnavailable
        ));
        assert!(matches!(
            cloud_access_error(false),
            WatchedFolderError::FolderUnavailable
        ));
    }

    #[test]
    fn registered_read_is_bounded_scoped_and_never_accepts_traversal() {
        let root = temporary_directory();
        fs::File::create(root.join("bank.csv"))
            .unwrap()
            .write_all(b"date,amount")
            .unwrap();
        let email_bytes = b"From: bank@example.test\r\nSubject: statement\r\n\r\nbody";
        fs::File::create(root.join("statement.eml"))
            .unwrap()
            .write_all(email_bytes)
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
        connection
            .execute_batch(include_str!(
                "../migrations/0051_watched_folder_sources.sql"
            ))
            .unwrap();
        let watched = register(&connection, "home", "Inbox", &root).unwrap();

        let file = read_registered_file(&connection, "home", &watched.id, "bank.csv").unwrap();
        assert_eq!(file.file_bytes, b"date,amount");
        assert_eq!(file.relative_path, "bank.csv");
        let email =
            read_registered_file(&connection, "home", &watched.id, "statement.eml").unwrap();
        assert_eq!(email.media_type, "message/rfc822");
        assert_eq!(email.file_bytes, email_bytes);
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
