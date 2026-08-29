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

/// An internal, device-local capability for one registered-folder traversal.
/// The canonical root and fencing metadata must never cross the native DTO
/// boundary.
#[derive(Debug, Clone)]
pub(crate) struct RegisteredFolderScanPlan {
    household_id: String,
    watched_folder_id: String,
    label: String,
    canonical_root: PathBuf,
    source_type: WatchedFolderSourceType,
    provider: WatchedFolderProvider,
    created_at: String,
    updated_at: String,
    root_identity: DirectoryIdentity,
}

/// Opaque output from the production no-follow traversal. Callers can neither
/// construct it without scanning nor replace the observed root identity.
#[derive(Debug)]
pub(crate) struct RegisteredFolderScanResult {
    files: Vec<WatchedFileMetadataDto>,
    observed_root_identity: DirectoryIdentity,
    root_identity_stable: bool,
    _directory_pins: Vec<PinnedScanDirectory>,
}

impl RegisteredFolderScanResult {
    pub(crate) fn files(&self) -> &[WatchedFileMetadataDto] {
        &self.files
    }

    pub(crate) fn into_scan(self, watched_folder_id: &str) -> WatchedFolderScanDto {
        WatchedFolderScanDto {
            watched_folder_id: watched_folder_id.to_owned(),
            files: self.files,
        }
    }
}

#[derive(Debug)]
pub(crate) enum RegisteredFolderScanValidationError {
    ObservedRootChanged,
    Watched(WatchedFolderError),
}

impl RegisteredFolderScanValidationError {
    pub(crate) fn into_watched(self) -> WatchedFolderError {
        match self {
            Self::ObservedRootChanged => WatchedFolderError::FolderUnavailable,
            Self::Watched(error) => error,
        }
    }
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
    let plan = prepare_registered_scan(connection, household_id, watched_folder_id)?;
    let scan = scan_prepared_registered(&plan)?;
    validate_registered_scan_plan(connection, &plan, &scan)
        .map_err(RegisteredFolderScanValidationError::into_watched)?;
    Ok(scan.into_scan(watched_folder_id))
}

pub(crate) fn prepare_registered_scan(
    connection: &Connection,
    household_id: &str,
    watched_folder_id: &str,
) -> Result<RegisteredFolderScanPlan, WatchedFolderError> {
    validate_lookup(household_id, watched_folder_id)?;
    let stored: Option<(String, String, String, String, String, String)> = connection
        .query_row(
            "SELECT label,canonical_path,source_type,provider,created_at,updated_at
             FROM watched_folders
             WHERE id=?1 AND household_id=?2 AND is_enabled=1",
            params![watched_folder_id, household_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(|_| WatchedFolderError::Database)?;
    let (label, stored_path, stored_source_type, stored_provider, created_at, updated_at) =
        stored.ok_or(WatchedFolderError::NotFound)?;
    let source_type = WatchedFolderSourceType::from_database(&stored_source_type)
        .ok_or(WatchedFolderError::Database)?;
    let provider = WatchedFolderProvider::from_database(&stored_provider)
        .ok_or(WatchedFolderError::Database)?;
    let canonical_root = validate_selected_directory(Path::new(&stored_path))?;
    let root_identity = validate_scan_directory(&canonical_root, &canonical_root)?;
    Ok(RegisteredFolderScanPlan {
        household_id: household_id.to_owned(),
        watched_folder_id: watched_folder_id.to_owned(),
        label,
        canonical_root,
        source_type,
        provider,
        created_at,
        updated_at,
        root_identity,
    })
}

pub(crate) fn scan_prepared_registered(
    plan: &RegisteredFolderScanPlan,
) -> Result<RegisteredFolderScanResult, WatchedFolderError> {
    scan_directory(&plan.canonical_root)
}

#[cfg(test)]
pub(crate) fn scan_prepared_registered_with_root_observer(
    plan: &RegisteredFolderScanPlan,
    after_root_open: impl FnMut(),
) -> Result<RegisteredFolderScanResult, WatchedFolderError> {
    scan_directory_with_observers(&plan.canonical_root, after_root_open, |_| {}, || {})
}

#[cfg(test)]
pub(crate) fn scan_prepared_registered_with_root_observers(
    plan: &RegisteredFolderScanPlan,
    after_root_open: impl FnMut(),
    before_final_root_check: impl FnMut(),
) -> Result<RegisteredFolderScanResult, WatchedFolderError> {
    scan_directory_with_observers(
        &plan.canonical_root,
        after_root_open,
        |_| {},
        before_final_root_check,
    )
}

#[cfg(all(test, windows))]
pub(crate) fn scan_prepared_registered_with_directory_observer(
    plan: &RegisteredFolderScanPlan,
    after_directory: impl FnMut(&Path),
) -> Result<RegisteredFolderScanResult, WatchedFolderError> {
    scan_directory_with_observers(&plan.canonical_root, || {}, after_directory, || {})
}

/// Rebind an unlocked traversal to the exact enabled registration and root
/// identity that authorized it. This must run immediately before reconcile.
pub(crate) fn validate_registered_scan_plan(
    connection: &Connection,
    plan: &RegisteredFolderScanPlan,
    scan: &RegisteredFolderScanResult,
) -> Result<(), RegisteredFolderScanValidationError> {
    if !scan.root_identity_stable || scan.observed_root_identity != plan.root_identity {
        return Err(RegisteredFolderScanValidationError::ObservedRootChanged);
    }
    validate_registered_scan_configuration(connection, plan)
        .map_err(RegisteredFolderScanValidationError::Watched)
}

pub(crate) fn validate_registered_scan_configuration(
    connection: &Connection,
    plan: &RegisteredFolderScanPlan,
) -> Result<(), WatchedFolderError> {
    let stored: Option<(String, String, String, String, String, String)> = connection
        .query_row(
            "SELECT label,canonical_path,source_type,provider,created_at,updated_at
             FROM watched_folders
             WHERE id=?1 AND household_id=?2 AND is_enabled=1",
            params![plan.watched_folder_id, plan.household_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(|_| WatchedFolderError::Database)?;
    let (label, stored_path, stored_source_type, stored_provider, created_at, updated_at) =
        stored.ok_or(WatchedFolderError::NotFound)?;
    if label != plan.label
        || stored_path != plan.canonical_root.to_string_lossy()
        || stored_source_type != plan.source_type.as_str()
        || stored_provider != plan.provider.as_str()
        || created_at != plan.created_at
        || updated_at != plan.updated_at
    {
        return Err(WatchedFolderError::Conflict);
    }
    let canonical_root = validate_selected_directory(Path::new(&stored_path))?;
    if canonical_root != plan.canonical_root
        || validate_scan_directory(&canonical_root, &canonical_root)? != plan.root_identity
    {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    Ok(())
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
    let identity = file_identity(&file, &handle_metadata)?;
    if !handle_metadata.is_file() || handle_metadata.len() != path_metadata.len() {
        return Err(WatchedFolderError::FolderUnavailable);
    }
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
    let verification_identity = file_identity(&verification_file, &verification_metadata)?;
    if !verification_metadata.is_file()
        || verification_metadata.len() != expected_size
        || verification_metadata.modified().ok() != expected_modified
        || verification_identity != *expected_identity
    {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    Ok(verification_metadata)
}

fn scan_directory(root: &Path) -> Result<RegisteredFolderScanResult, WatchedFolderError> {
    scan_directory_with_observers(root, || {}, |_| {}, || {})
}

#[cfg(test)]
fn scan_directory_with_observer(
    root: &Path,
    after_directory: impl FnMut(&Path),
) -> Result<RegisteredFolderScanResult, WatchedFolderError> {
    let scan = scan_directory_with_observers(root, || {}, after_directory, || {})?;
    if !scan.root_identity_stable {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    Ok(scan)
}

fn scan_directory_with_observers(
    root: &Path,
    mut after_root_open: impl FnMut(),
    mut after_directory: impl FnMut(&Path),
    mut before_final_root_check: impl FnMut(),
) -> Result<RegisteredFolderScanResult, WatchedFolderError> {
    let root_pin = PinnedScanDirectory::open_root(root)?;
    let observed_root_identity = root_pin.identity;
    if !root_path_matches_identity(root, observed_root_identity) {
        return Ok(invalidated_scan_result(observed_root_identity));
    }
    let mut pending = vec![(root_pin.try_clone()?, PathBuf::new(), 0_usize)];
    // Retain every opened directory through final validation and reconcile so
    // both Unix fd-relative and Windows handle-relative traversal stay bound.
    let mut retained_directory_pins = vec![root_pin];
    let mut visited_entries = 0_usize;
    let mut files = Vec::new();

    while let Some((directory, relative_directory, depth)) = pending.pop() {
        if !root_path_matches_identity(root, observed_root_identity) {
            return Ok(invalidated_scan_result(observed_root_identity));
        }
        if relative_directory.as_os_str().is_empty() {
            // The root is already pinned. Enumeration on either platform is
            // relative to that opened root rather than reopening its pathname.
            after_root_open();
        }
        let absolute_directory = root.join(&relative_directory);
        let remaining_entries = MAX_SCANNED_ENTRIES
            .checked_sub(visited_entries)
            .ok_or(WatchedFolderError::ScanLimit)?;
        let entries = directory.read_entries(&absolute_directory, remaining_entries)?;
        visited_entries = visited_entries
            .checked_add(entries.len())
            .ok_or(WatchedFolderError::ScanLimit)?;
        for entry in entries {
            if entry.kind == PinnedEntryKind::Symlink {
                continue;
            }
            let relative_path = relative_directory.join(&entry.name);
            let absolute_path = root.join(&relative_path);
            if entry.kind == PinnedEntryKind::Directory {
                if depth < MAX_SCAN_DEPTH {
                    let child = directory.open_child(&absolute_path, &entry.name)?;
                    retained_directory_pins.push(child.try_clone()?);
                    pending.push((child, relative_path, depth + 1));
                }
                continue;
            }
            if entry.kind != PinnedEntryKind::File {
                continue;
            }
            let Some(media_type) = supported_media_type(&relative_path) else {
                continue;
            };
            if files.len() >= MAX_SUPPORTED_FILES {
                return Err(WatchedFolderError::ScanLimit);
            }
            let stable_file = directory.open_file(&absolute_path, &entry.name)?;
            let stable_metadata = stable_file
                .metadata()
                .map_err(|_| WatchedFolderError::FolderUnavailable)?;
            let stable_identity = file_identity(&stable_file, &stable_metadata)?;
            if !stable_metadata.is_file() {
                return Err(WatchedFolderError::FolderUnavailable);
            }
            let final_metadata = directory.verify_file(
                &absolute_path,
                &entry.name,
                &stable_identity,
                stable_metadata.len(),
                stable_metadata.modified().ok(),
            )?;
            let relative_path = relative_path
                .to_str()
                .ok_or(WatchedFolderError::InvalidInput)?
                .replace('\\', "/");
            let file_name = entry
                .name
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
        after_directory(&absolute_directory);
    }
    before_final_root_check();
    if !root_path_matches_identity(root, observed_root_identity) {
        return Ok(invalidated_scan_result(observed_root_identity));
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(RegisteredFolderScanResult {
        files,
        observed_root_identity,
        root_identity_stable: true,
        _directory_pins: retained_directory_pins,
    })
}

fn invalidated_scan_result(
    observed_root_identity: DirectoryIdentity,
) -> RegisteredFolderScanResult {
    RegisteredFolderScanResult {
        files: Vec::new(),
        observed_root_identity,
        root_identity_stable: false,
        _directory_pins: Vec::new(),
    }
}

fn root_path_matches_identity(root: &Path, expected: DirectoryIdentity) -> bool {
    matches!(validate_scan_directory(root, root), Ok(identity) if identity == expected)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PinnedEntryKind {
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Debug)]
struct PinnedEntry {
    name: std::ffi::OsString,
    kind: PinnedEntryKind,
}

#[derive(Debug)]
struct PinnedScanDirectory {
    handle: fs::File,
    identity: DirectoryIdentity,
}

impl PinnedScanDirectory {
    fn open_root(root: &Path) -> Result<Self, WatchedFolderError> {
        let metadata =
            fs::symlink_metadata(root).map_err(|_| WatchedFolderError::FolderUnavailable)?;
        if metadata.file_type().is_symlink() {
            return Err(WatchedFolderError::SymlinkNotAllowed);
        }
        if !metadata.is_dir() {
            return Err(WatchedFolderError::FolderUnavailable);
        }
        let canonical =
            fs::canonicalize(root).map_err(|_| WatchedFolderError::FolderUnavailable)?;
        if canonical != root {
            return Err(WatchedFolderError::SymlinkNotAllowed);
        }
        let handle = open_directory_no_follow(root)?;
        let identity = directory_identity_from_handle(&handle)?;
        Ok(Self { handle, identity })
    }

    fn try_clone(&self) -> Result<Self, WatchedFolderError> {
        Ok(Self {
            handle: self
                .handle
                .try_clone()
                .map_err(|_| WatchedFolderError::FolderUnavailable)?,
            identity: self.identity,
        })
    }
}

#[cfg(unix)]
impl PinnedScanDirectory {
    fn read_entries(
        &self,
        _absolute_path: &Path,
        max_entries: usize,
    ) -> Result<Vec<PinnedEntry>, WatchedFolderError> {
        use std::ffi::{CStr, OsString};
        use std::os::fd::AsRawFd as _;
        use std::os::unix::ffi::OsStringExt as _;

        // SAFETY: the source descriptor is owned by `self`; a successful
        // duplicate is transferred immediately to `fdopendir`.
        let duplicated = unsafe { libc::fcntl(self.handle.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
        if duplicated < 0 {
            return Err(WatchedFolderError::FolderUnavailable);
        }
        // SAFETY: `duplicated` is a live directory descriptor and ownership is
        // transferred to the returned DIR stream on success.
        let raw_stream = unsafe { libc::fdopendir(duplicated) };
        if raw_stream.is_null() {
            unsafe {
                libc::close(duplicated);
            }
            return Err(WatchedFolderError::FolderUnavailable);
        }
        let stream = UnixDirectoryStream(raw_stream);
        let mut entries = Vec::new();
        loop {
            clear_errno();
            // SAFETY: the stream remains owned and open for this loop.
            let raw_entry = unsafe { libc::readdir(stream.0) };
            if raw_entry.is_null() {
                if current_errno() != 0 {
                    return Err(WatchedFolderError::FolderUnavailable);
                }
                break;
            }
            // SAFETY: POSIX guarantees a NUL-terminated d_name valid until the
            // next readdir call; bytes are copied before advancing the stream.
            let name_bytes = unsafe { CStr::from_ptr((*raw_entry).d_name.as_ptr()) }.to_bytes();
            if name_bytes == b"." || name_bytes == b".." {
                continue;
            }
            if entries.len() >= max_entries {
                return Err(WatchedFolderError::ScanLimit);
            }
            let name = OsString::from_vec(name_bytes.to_vec());
            let kind = self.entry_kind(&name)?;
            entries.push(PinnedEntry { name, kind });
        }
        Ok(entries)
    }

    fn entry_kind(&self, name: &std::ffi::OsStr) -> Result<PinnedEntryKind, WatchedFolderError> {
        use std::mem::MaybeUninit;
        use std::os::fd::AsRawFd as _;

        let name = unix_component_name(name)?;
        let mut metadata = MaybeUninit::<libc::stat>::uninit();
        // SAFETY: the output buffer is initialized only when fstatat succeeds;
        // the component is NUL-terminated and relative to the owned parent fd.
        let result = unsafe {
            libc::fstatat(
                self.handle.as_raw_fd(),
                name.as_ptr(),
                metadata.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result != 0 {
            return Err(WatchedFolderError::FolderUnavailable);
        }
        // SAFETY: the successful fstatat call initialized the complete struct.
        let mode = unsafe { metadata.assume_init() }.st_mode & libc::S_IFMT;
        Ok(if mode == libc::S_IFDIR {
            PinnedEntryKind::Directory
        } else if mode == libc::S_IFREG {
            PinnedEntryKind::File
        } else if mode == libc::S_IFLNK {
            PinnedEntryKind::Symlink
        } else {
            PinnedEntryKind::Other
        })
    }

    fn open_child(
        &self,
        _absolute_path: &Path,
        name: &std::ffi::OsStr,
    ) -> Result<Self, WatchedFolderError> {
        let handle = openat_no_follow(
            &self.handle,
            name,
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
        )?;
        let identity = directory_identity_from_handle(&handle)?;
        Ok(Self { handle, identity })
    }

    fn open_file(
        &self,
        _absolute_path: &Path,
        name: &std::ffi::OsStr,
    ) -> Result<fs::File, WatchedFolderError> {
        openat_no_follow(
            &self.handle,
            name,
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    }

    fn verify_file(
        &self,
        _absolute_path: &Path,
        name: &std::ffi::OsStr,
        expected_identity: &FileIdentity,
        expected_size: u64,
        expected_modified: Option<std::time::SystemTime>,
    ) -> Result<fs::Metadata, WatchedFolderError> {
        let verification_file = self.open_file(Path::new(""), name)?;
        let verification_metadata = verification_file
            .metadata()
            .map_err(|_| WatchedFolderError::FolderUnavailable)?;
        let verification_identity = file_identity(&verification_file, &verification_metadata)?;
        if !verification_metadata.is_file()
            || verification_metadata.len() != expected_size
            || verification_metadata.modified().ok() != expected_modified
            || verification_identity != *expected_identity
        {
            return Err(WatchedFolderError::FolderUnavailable);
        }
        Ok(verification_metadata)
    }
}

#[cfg(unix)]
struct UnixDirectoryStream(*mut libc::DIR);

#[cfg(unix)]
impl Drop for UnixDirectoryStream {
    fn drop(&mut self) {
        // SAFETY: this wrapper uniquely owns the DIR pointer from fdopendir.
        unsafe {
            libc::closedir(self.0);
        }
    }
}

#[cfg(unix)]
fn unix_component_name(name: &std::ffi::OsStr) -> Result<std::ffi::CString, WatchedFolderError> {
    use std::os::unix::ffi::OsStrExt as _;

    std::ffi::CString::new(name.as_bytes()).map_err(|_| WatchedFolderError::InvalidInput)
}

#[cfg(unix)]
fn openat_no_follow(
    parent: &fs::File,
    name: &std::ffi::OsStr,
    flags: libc::c_int,
) -> Result<fs::File, WatchedFolderError> {
    use std::os::fd::{AsRawFd as _, FromRawFd as _};

    let name = unix_component_name(name)?;
    // SAFETY: the parent descriptor is live and the NUL-terminated name is a
    // single directory entry; O_NOFOLLOW prevents a final symlink traversal.
    let descriptor =
        unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags | libc::O_NOFOLLOW) };
    if descriptor < 0 {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    // SAFETY: openat returned a new owned descriptor transferred to File.
    Ok(unsafe { fs::File::from_raw_fd(descriptor) })
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn clear_errno() {
    unsafe {
        *libc::__errno_location() = 0;
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn current_errno() -> libc::c_int {
    unsafe { *libc::__errno_location() }
}

#[cfg(any(
    target_vendor = "apple",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd",
    target_os = "dragonfly"
))]
fn clear_errno() {
    unsafe {
        *libc::__error() = 0;
    }
}

#[cfg(any(
    target_vendor = "apple",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd",
    target_os = "dragonfly"
))]
fn current_errno() -> libc::c_int {
    unsafe { *libc::__error() }
}

#[cfg(all(
    unix,
    not(any(
        target_os = "linux",
        target_os = "android",
        target_vendor = "apple",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd",
        target_os = "dragonfly"
    ))
))]
compile_error!("watched-folder fd-relative traversal requires a supported Unix errno API");

#[cfg(windows)]
impl PinnedScanDirectory {
    fn read_entries(
        &self,
        _absolute_path: &Path,
        max_entries: usize,
    ) -> Result<Vec<PinnedEntry>, WatchedFolderError> {
        use std::os::windows::ffi::OsStringExt as _;
        use std::os::windows::io::AsRawHandle as _;
        use windows_sys::Wdk::Storage::FileSystem::{
            FileIdBothDirectoryInformation, NtQueryDirectoryFile,
        };
        use windows_sys::Win32::Foundation::{STATUS_NO_MORE_FILES, STATUS_SUCCESS};
        use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

        const BUFFER_BYTES: usize = 64 * 1024;

        let mut entries = Vec::new();
        let mut buffer = vec![0_u64; BUFFER_BYTES / std::mem::size_of::<u64>()];
        let mut restart_scan = true;
        loop {
            let mut io_status = IO_STATUS_BLOCK::default();
            // SAFETY: the synchronous pinned directory handle remains live,
            // and the aligned output buffer is writable for its full length.
            let status = unsafe {
                NtQueryDirectoryFile(
                    self.handle.as_raw_handle(),
                    std::ptr::null_mut(),
                    None,
                    std::ptr::null(),
                    &mut io_status,
                    buffer.as_mut_ptr().cast(),
                    u32::try_from(BUFFER_BYTES)
                        .map_err(|_| WatchedFolderError::FolderUnavailable)?,
                    FileIdBothDirectoryInformation,
                    false,
                    std::ptr::null(),
                    restart_scan,
                )
            };
            if status == STATUS_NO_MORE_FILES {
                break;
            }
            if status != STATUS_SUCCESS
                || io_status.Information == 0
                || io_status.Information > BUFFER_BYTES
            {
                return Err(WatchedFolderError::FolderUnavailable);
            }
            // SAFETY: NtQueryDirectoryFile initialized exactly Information
            // bytes in the live u64-aligned backing allocation.
            let initialized = unsafe {
                std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), io_status.Information)
            };
            let remaining = max_entries
                .checked_sub(entries.len())
                .ok_or(WatchedFolderError::ScanLimit)?;
            entries.extend(
                parse_windows_directory_buffer(initialized, remaining)?
                    .into_iter()
                    .map(|entry| PinnedEntry {
                        name: std::ffi::OsString::from_wide(&entry.name),
                        kind: entry.kind,
                    }),
            );
            restart_scan = false;
        }
        Ok(entries)
    }

    fn open_child(
        &self,
        _absolute_path: &Path,
        name: &std::ffi::OsStr,
    ) -> Result<Self, WatchedFolderError> {
        let handle = open_windows_relative_no_follow(&self.handle, name, true)?;
        let identity = directory_identity_from_handle(&handle)?;
        Ok(Self { handle, identity })
    }

    fn open_file(
        &self,
        _absolute_path: &Path,
        name: &std::ffi::OsStr,
    ) -> Result<fs::File, WatchedFolderError> {
        open_windows_relative_no_follow(&self.handle, name, false)
    }

    fn verify_file(
        &self,
        _absolute_path: &Path,
        name: &std::ffi::OsStr,
        expected_identity: &FileIdentity,
        expected_size: u64,
        expected_modified: Option<std::time::SystemTime>,
    ) -> Result<fs::Metadata, WatchedFolderError> {
        let verification_file = self.open_file(Path::new(""), name)?;
        let verification_metadata = verification_file
            .metadata()
            .map_err(|_| WatchedFolderError::FolderUnavailable)?;
        let verification_identity = file_identity(&verification_file, &verification_metadata)?;
        if !verification_metadata.is_file()
            || verification_metadata.len() != expected_size
            || verification_metadata.modified().ok() != expected_modified
            || verification_identity != *expected_identity
        {
            return Err(WatchedFolderError::FolderUnavailable);
        }
        Ok(verification_metadata)
    }
}

#[cfg(any(test, windows))]
#[derive(Debug)]
struct WindowsDirectoryEntry {
    name: Vec<u16>,
    kind: PinnedEntryKind,
}

#[cfg(windows)]
const _: () = {
    use windows_sys::Wdk::Storage::FileSystem::FILE_ID_BOTH_DIR_INFORMATION;

    assert!(std::mem::offset_of!(FILE_ID_BOTH_DIR_INFORMATION, FileAttributes) == 56);
    assert!(std::mem::offset_of!(FILE_ID_BOTH_DIR_INFORMATION, FileNameLength) == 60);
    assert!(std::mem::offset_of!(FILE_ID_BOTH_DIR_INFORMATION, FileName) == 104);
};

#[cfg(any(test, windows))]
fn parse_windows_directory_buffer(
    buffer: &[u8],
    max_entries: usize,
) -> Result<Vec<WindowsDirectoryEntry>, WatchedFolderError> {
    const FILE_NAME_OFFSET: usize = 104;
    const FILE_ATTRIBUTES_OFFSET: usize = 56;
    const FILE_NAME_LENGTH_OFFSET: usize = 60;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
    const FILE_ATTRIBUTE_DEVICE: u32 = 0x40;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

    fn u32_at(buffer: &[u8], offset: usize) -> Option<u32> {
        let bytes = buffer.get(offset..offset.checked_add(4)?)?;
        Some(u32::from_le_bytes(bytes.try_into().ok()?))
    }

    let mut offset = 0_usize;
    let mut entries = Vec::new();
    while offset < buffer.len() {
        let entry = buffer
            .get(offset..)
            .ok_or(WatchedFolderError::FolderUnavailable)?;
        if entry.len() < FILE_NAME_OFFSET {
            return Err(WatchedFolderError::FolderUnavailable);
        }
        let next_offset =
            usize::try_from(u32_at(entry, 0).ok_or(WatchedFolderError::FolderUnavailable)?)
                .map_err(|_| WatchedFolderError::FolderUnavailable)?;
        let name_bytes = usize::try_from(
            u32_at(entry, FILE_NAME_LENGTH_OFFSET).ok_or(WatchedFolderError::FolderUnavailable)?,
        )
        .map_err(|_| WatchedFolderError::FolderUnavailable)?;
        if name_bytes % 2 != 0 {
            return Err(WatchedFolderError::FolderUnavailable);
        }
        let minimum_entry_bytes = FILE_NAME_OFFSET
            .checked_add(name_bytes)
            .ok_or(WatchedFolderError::FolderUnavailable)?;
        let entry_bytes = if next_offset == 0 {
            entry.len()
        } else {
            if next_offset % 8 != 0 || next_offset < minimum_entry_bytes {
                return Err(WatchedFolderError::FolderUnavailable);
            }
            next_offset
        };
        if entry_bytes > entry.len() || minimum_entry_bytes > entry_bytes {
            return Err(WatchedFolderError::FolderUnavailable);
        }
        let mut name = Vec::with_capacity(name_bytes / 2);
        for bytes in entry[FILE_NAME_OFFSET..minimum_entry_bytes].chunks_exact(2) {
            name.push(u16::from_le_bytes([bytes[0], bytes[1]]));
        }
        let dot = [u16::from(b'.')];
        let dot_dot = [u16::from(b'.'), u16::from(b'.')];
        if name.as_slice() != dot && name.as_slice() != dot_dot {
            if name.is_empty()
                || name
                    .iter()
                    .any(|character| matches!(*character, 0 | 47 | 58 | 92))
            {
                return Err(WatchedFolderError::FolderUnavailable);
            }
            if entries.len() >= max_entries {
                return Err(WatchedFolderError::ScanLimit);
            }
            let attributes = u32_at(entry, FILE_ATTRIBUTES_OFFSET)
                .ok_or(WatchedFolderError::FolderUnavailable)?;
            let kind = if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                PinnedEntryKind::Symlink
            } else if attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
                PinnedEntryKind::Directory
            } else if attributes & FILE_ATTRIBUTE_DEVICE != 0 {
                PinnedEntryKind::Other
            } else {
                PinnedEntryKind::File
            };
            entries.push(WindowsDirectoryEntry { name, kind });
        }
        if next_offset == 0 {
            break;
        }
        offset = offset
            .checked_add(next_offset)
            .ok_or(WatchedFolderError::FolderUnavailable)?;
    }
    Ok(entries)
}

#[cfg(windows)]
fn open_windows_relative_no_follow(
    parent: &fs::File,
    name: &std::ffi::OsStr,
    directory: bool,
) -> Result<fs::File, WatchedFolderError> {
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _};
    use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
    use windows_sys::Wdk::Storage::FileSystem::{
        NtCreateFile, FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN,
        FILE_OPEN_REPARSE_POINT, FILE_SYNCHRONOUS_IO_NONALERT,
    };
    use windows_sys::Win32::Foundation::{
        OBJ_CASE_INSENSITIVE, OBJ_DONT_REPARSE, STATUS_SUCCESS, UNICODE_STRING,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_SHARE_READ,
        FILE_SHARE_WRITE, SYNCHRONIZE,
    };
    use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

    let mut name = name.encode_wide().collect::<Vec<_>>();
    if name.is_empty()
        || name
            .iter()
            .any(|character| matches!(*character, 0 | 47 | 58 | 92))
    {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    let name_bytes = name
        .len()
        .checked_mul(2)
        .and_then(|length| u16::try_from(length).ok())
        .ok_or(WatchedFolderError::FolderUnavailable)?;
    let object_name = UNICODE_STRING {
        Length: name_bytes,
        MaximumLength: name_bytes,
        Buffer: name.as_mut_ptr(),
    };
    let object_attributes = OBJECT_ATTRIBUTES {
        Length: u32::try_from(std::mem::size_of::<OBJECT_ATTRIBUTES>())
            .map_err(|_| WatchedFolderError::FolderUnavailable)?,
        RootDirectory: parent.as_raw_handle(),
        ObjectName: &object_name,
        Attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
        SecurityDescriptor: std::ptr::null(),
        SecurityQualityOfService: std::ptr::null(),
    };
    let mut io_status = IO_STATUS_BLOCK::default();
    let mut handle = std::ptr::null_mut();
    let desired_access = FILE_READ_ATTRIBUTES
        | SYNCHRONIZE
        | if directory {
            FILE_LIST_DIRECTORY
        } else {
            FILE_READ_DATA
        };
    let create_options = FILE_OPEN_REPARSE_POINT
        | FILE_SYNCHRONOUS_IO_NONALERT
        | if directory {
            FILE_DIRECTORY_FILE
        } else {
            FILE_NON_DIRECTORY_FILE
        };
    // SAFETY: every native descriptor points to live stack-owned storage for
    // this synchronous call; success transfers the returned owned handle.
    let status = unsafe {
        NtCreateFile(
            &mut handle,
            desired_access,
            &object_attributes,
            &mut io_status,
            std::ptr::null(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            FILE_OPEN,
            create_options,
            std::ptr::null(),
            0,
        )
    };
    if status != STATUS_SUCCESS {
        return Err(classify_windows_nt_open_status(status));
    }
    if handle.is_null() {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    // SAFETY: NtCreateFile returned a new owned handle on STATUS_SUCCESS.
    Ok(unsafe { fs::File::from_raw_handle(handle) })
}

#[cfg(not(any(unix, windows)))]
compile_error!("watched-folder traversal requires Unix fd-relative or Windows pinned-handle APIs");

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
    directory_identity_from_handle(&handle)
}

fn directory_identity_from_handle(
    handle: &fs::File,
) -> Result<DirectoryIdentity, WatchedFolderError> {
    let handle_metadata = handle
        .metadata()
        .map_err(|_| WatchedFolderError::FolderUnavailable)?;
    let identity = file_identity(handle, &handle_metadata)?;
    if !handle_metadata.is_dir() {
        return Err(WatchedFolderError::FolderUnavailable);
    }
    Ok(DirectoryIdentity {
        identity,
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
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(path)
        .map_err(|error| classify_windows_open_error_code(error.raw_os_error()))
}

#[cfg(windows)]
fn open_directory_no_follow(path: &Path) -> Result<fs::File, WatchedFolderError> {
    use std::os::windows::fs::OpenOptionsExt as _;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(path)
        .map_err(|error| classify_windows_open_error_code(error.raw_os_error()))
}

#[cfg(any(test, windows))]
fn classify_windows_open_error_code(error_code: Option<i32>) -> WatchedFolderError {
    const ERROR_REPARSE_POINT_ENCOUNTERED: i32 = 4_395;
    const ERROR_STOPPED_ON_SYMLINK: i32 = 681;

    if matches!(
        error_code,
        Some(ERROR_REPARSE_POINT_ENCOUNTERED | ERROR_STOPPED_ON_SYMLINK)
    ) {
        WatchedFolderError::SymlinkNotAllowed
    } else {
        WatchedFolderError::FolderUnavailable
    }
}

#[cfg(any(test, windows))]
fn classify_windows_nt_open_status(status: i32) -> WatchedFolderError {
    const STATUS_DIRECTORY_IS_A_REPARSE_POINT: i32 = 0xC000_0281_u32 as i32;
    const STATUS_REPARSE_POINT_ENCOUNTERED: i32 = 0xC000_050B_u32 as i32;
    const STATUS_STOPPED_ON_SYMLINK: i32 = 0x8000_002D_u32 as i32;

    if matches!(
        status,
        STATUS_DIRECTORY_IS_A_REPARSE_POINT
            | STATUS_REPARSE_POINT_ENCOUNTERED
            | STATUS_STOPPED_ON_SYMLINK
    ) {
        WatchedFolderError::SymlinkNotAllowed
    } else {
        WatchedFolderError::FolderUnavailable
    }
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

        let files = scan_directory(&root).unwrap().files;
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
    fn root_replacement_after_directory_enumeration_is_rejected() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("root");
        let replacement = parent.path().join("replacement");
        let parked = parent.path().join("parked");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&replacement).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let replacement = fs::canonicalize(replacement).unwrap();
        let mut swapped = false;

        let result = scan_directory_with_observer(&root, |_| {
            if !swapped {
                fs::rename(&root, &parked).unwrap();
                fs::rename(&replacement, &root).unwrap();
                swapped = true;
            }
        });
        assert!(matches!(result, Err(WatchedFolderError::FolderUnavailable)));
        fs::rename(&root, &replacement).unwrap();
        fs::rename(&parked, &root).unwrap();
    }

    #[test]
    fn windows_open_errors_classify_only_confirmed_reparse() {
        assert!(matches!(
            classify_windows_open_error_code(Some(4_395)),
            WatchedFolderError::SymlinkNotAllowed
        ));
        assert!(matches!(
            classify_windows_open_error_code(Some(681)),
            WatchedFolderError::SymlinkNotAllowed
        ));
        for error_code in [None, Some(2), Some(3), Some(32), Some(1_920)] {
            assert!(matches!(
                classify_windows_open_error_code(error_code),
                WatchedFolderError::FolderUnavailable
            ));
        }
        assert!(matches!(
            classify_windows_nt_open_status(0xC000_050B_u32 as i32),
            WatchedFolderError::SymlinkNotAllowed
        ));
        for status in [0xC000_0281_u32 as i32, 0x8000_002D_u32 as i32] {
            assert!(matches!(
                classify_windows_nt_open_status(status),
                WatchedFolderError::SymlinkNotAllowed
            ));
        }
        for status in [0xC000_0034_u32 as i32, 0xC000_0043_u32 as i32] {
            assert!(matches!(
                classify_windows_nt_open_status(status),
                WatchedFolderError::FolderUnavailable
            ));
        }
    }

    #[test]
    fn windows_handle_directory_buffer_is_bounded_and_reparse_aware() {
        fn entry(name: &str, attributes: u32) -> Vec<u8> {
            let name = name.encode_utf16().collect::<Vec<_>>();
            let mut buffer = vec![0_u8; 104 + name.len() * 2];
            buffer[56..60].copy_from_slice(&attributes.to_le_bytes());
            buffer[60..64].copy_from_slice(&u32::try_from(name.len() * 2).unwrap().to_le_bytes());
            for (index, character) in name.into_iter().enumerate() {
                let start = 104 + index * 2;
                buffer[start..start + 2].copy_from_slice(&character.to_le_bytes());
            }
            buffer
        }

        let directory = parse_windows_directory_buffer(&entry("receipts", 0x10), 1).unwrap();
        assert_eq!(directory.len(), 1);
        assert_eq!(String::from_utf16(&directory[0].name).unwrap(), "receipts");
        assert_eq!(directory[0].kind, PinnedEntryKind::Directory);

        let reparse = parse_windows_directory_buffer(&entry("redirect", 0x10 | 0x400), 1).unwrap();
        assert_eq!(reparse[0].kind, PinnedEntryKind::Symlink);
        assert!(matches!(
            parse_windows_directory_buffer(&entry("too-many.csv", 0), 0),
            Err(WatchedFolderError::ScanLimit)
        ));

        let mut malformed = entry("odd.csv", 0);
        malformed[60..64].copy_from_slice(&1_u32.to_le_bytes());
        assert!(matches!(
            parse_windows_directory_buffer(&malformed, 1),
            Err(WatchedFolderError::FolderUnavailable)
        ));
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
        let files = scan_directory(&root).unwrap().files;
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
