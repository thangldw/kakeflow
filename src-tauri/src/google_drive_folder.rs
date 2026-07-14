//! Pure Google Drive folder-reference and binding validation primitives.
//!
//! Parsing user input is deliberately separate from validating Drive metadata:
//! a folder URL does not reveal whether the folder belongs to My Drive or a
//! shared drive. The caller must obtain bounded metadata and pass it to
//! [`validate_folder_binding`] before persisting a binding.

use reqwest::Url;
use serde::Serialize;
use thiserror::Error;

pub const GOOGLE_DRIVE_FOLDER_MIME_TYPE: &str = "application/vnd.google-apps.folder";

const DRIVE_HOST: &str = "drive.google.com";
const MAX_REFERENCE_BYTES: usize = 2_048;
const MAX_FILE_ID_BYTES: usize = 256;
const MAX_RESOURCE_KEY_BYTES: usize = 256;
const MAX_FOLDER_NAME_BYTES: usize = 255;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum GoogleDriveFolderError {
    #[error("the Google Drive folder reference is invalid")]
    InvalidReference,
    #[error("the Google Drive URL does not identify a folder")]
    NotFolderUrl,
    #[error("the Google Drive folder reference is ambiguous")]
    AmbiguousReference,
    #[error("the selected Google Drive item is not a folder")]
    NotFolder,
    #[error("the selected Google Drive folder no longer exists")]
    Trashed,
    #[error("the Google Drive folder metadata does not match the selection")]
    BindingMismatch,
    #[error("the Google Drive folder metadata is invalid")]
    InvalidMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GoogleDriveFolderReferenceKind {
    BareId,
    FolderUrl,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveFolderReference {
    pub folder_id: String,
    pub kind: GoogleDriveFolderReferenceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleDriveFolderMetadata {
    pub file_id: String,
    pub name: String,
    pub mime_type: String,
    /// Present only when Drive reports that the item belongs to a shared drive.
    pub drive_id: Option<String>,
    pub trashed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GoogleDriveIdentity {
    MyDrive,
    SharedDrive {
        #[serde(rename = "driveId")]
        drive_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveFolderBinding {
    pub folder_id: String,
    pub folder_name: String,
    pub drive: GoogleDriveIdentity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_key: Option<String>,
}

/// Parses a pasted Drive folder URL or a bare canonical Drive file ID.
///
/// Accepted URL forms are:
/// - `https://drive.google.com/drive/folders/{folder_id}`
/// - `https://drive.google.com/drive/u/{account_index}/folders/{folder_id}`
///
/// Common sharing query parameters are ignored because they do not identify a
/// different folder. Query parameters that contain another item ID are rejected
/// as ambiguous.
pub fn parse_folder_reference(
    input: &str,
) -> Result<GoogleDriveFolderReference, GoogleDriveFolderError> {
    if input.len() > MAX_REFERENCE_BYTES {
        return Err(GoogleDriveFolderError::InvalidReference);
    }
    let input = input.trim();
    if input.is_empty() || input.contains('\0') {
        return Err(GoogleDriveFolderError::InvalidReference);
    }

    if !input.contains("://") {
        return Ok(GoogleDriveFolderReference {
            folder_id: canonical_id(input)?,
            kind: GoogleDriveFolderReferenceKind::BareId,
            resource_key: None,
        });
    }

    let url = Url::parse(input).map_err(|_| GoogleDriveFolderError::InvalidReference)?;
    parse_folder_url(&url)
}

/// Validates Drive metadata against the user's parsed selection and returns a
/// persistence-safe binding. No network access or identity inference from the
/// URL is performed.
pub fn validate_folder_binding(
    reference: &GoogleDriveFolderReference,
    metadata: GoogleDriveFolderMetadata,
) -> Result<GoogleDriveFolderBinding, GoogleDriveFolderError> {
    let expected_id = canonical_id(&reference.folder_id)?;
    let actual_id =
        canonical_id(&metadata.file_id).map_err(|_| GoogleDriveFolderError::InvalidMetadata)?;
    if expected_id != actual_id {
        return Err(GoogleDriveFolderError::BindingMismatch);
    }
    if metadata.mime_type != GOOGLE_DRIVE_FOLDER_MIME_TYPE {
        return Err(GoogleDriveFolderError::NotFolder);
    }
    if metadata.trashed {
        return Err(GoogleDriveFolderError::Trashed);
    }

    let folder_name = metadata.name.trim();
    if folder_name.is_empty()
        || folder_name.len() > MAX_FOLDER_NAME_BYTES
        || folder_name.contains('\0')
        || folder_name.chars().any(char::is_control)
    {
        return Err(GoogleDriveFolderError::InvalidMetadata);
    }

    let drive = match metadata.drive_id {
        Some(drive_id) => GoogleDriveIdentity::SharedDrive {
            drive_id: canonical_id(&drive_id)
                .map_err(|_| GoogleDriveFolderError::InvalidMetadata)?,
        },
        None => GoogleDriveIdentity::MyDrive,
    };
    let resource_key = reference
        .resource_key
        .as_deref()
        .map(canonical_resource_key)
        .transpose()?;

    Ok(GoogleDriveFolderBinding {
        folder_id: actual_id,
        folder_name: folder_name.to_owned(),
        drive,
        resource_key,
    })
}

fn parse_folder_url(url: &Url) -> Result<GoogleDriveFolderReference, GoogleDriveFolderError> {
    if url.scheme() != "https"
        || url.host_str() != Some(DRIVE_HOST)
        || url.username() != ""
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return Err(GoogleDriveFolderError::InvalidReference);
    }

    // An ID in the query competes with the path ID. Legacy `/open?id=...`
    // links are intentionally not accepted because they may point to files.
    let mut resource_key = None;
    for (key, value) in url.query_pairs() {
        if matches!(key.as_ref(), "id" | "folderId" | "fileId") {
            return Err(GoogleDriveFolderError::AmbiguousReference);
        }
        if key == "resourcekey" {
            if resource_key.is_some() {
                return Err(GoogleDriveFolderError::AmbiguousReference);
            }
            resource_key = Some(canonical_resource_key(&value)?);
        }
    }

    let segments = url
        .path_segments()
        .ok_or(GoogleDriveFolderError::NotFolderUrl)?
        .collect::<Vec<_>>();
    let raw_id = match segments.as_slice() {
        ["drive", "folders", folder_id] => *folder_id,
        ["drive", "folders", folder_id, ""] => *folder_id,
        ["drive", "u", account_index, "folders", folder_id]
            if !account_index.is_empty()
                && account_index.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            *folder_id
        }
        ["drive", "u", account_index, "folders", folder_id, ""]
            if !account_index.is_empty()
                && account_index.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            *folder_id
        }
        ["file", "d", ..] | ["document", "d", ..] => {
            return Err(GoogleDriveFolderError::NotFolderUrl);
        }
        _ => return Err(GoogleDriveFolderError::NotFolderUrl),
    };

    Ok(GoogleDriveFolderReference {
        folder_id: canonical_id(raw_id)?,
        kind: GoogleDriveFolderReferenceKind::FolderUrl,
        resource_key,
    })
}

fn canonical_resource_key(value: &str) -> Result<String, GoogleDriveFolderError> {
    if value.is_empty()
        || value.len() > MAX_RESOURCE_KEY_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(GoogleDriveFolderError::InvalidReference);
    }
    Ok(value.to_owned())
}

fn canonical_id(value: &str) -> Result<String, GoogleDriveFolderError> {
    // Drive resource IDs are opaque and case-sensitive. Their documented URL
    // representation uses the URL-safe ASCII alphabet, so normalization only
    // validates and copies; it never changes case or decodes the identifier.
    if value.is_empty()
        || value == "root"
        || value.len() > MAX_FILE_ID_BYTES
        || value != value.trim()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(GoogleDriveFolderError::InvalidReference);
    }
    Ok(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FOLDER_ID: &str = "1AbC_def-GhijKLMnOP234567890";

    fn metadata(drive_id: Option<&str>) -> GoogleDriveFolderMetadata {
        GoogleDriveFolderMetadata {
            file_id: FOLDER_ID.to_owned(),
            name: "家計簿 Inbox".to_owned(),
            mime_type: GOOGLE_DRIVE_FOLDER_MIME_TYPE.to_owned(),
            drive_id: drive_id.map(str::to_owned),
            trashed: false,
        }
    }

    #[test]
    fn parses_bare_id_and_canonical_folder_urls() {
        let bare = parse_folder_reference(&format!("  {FOLDER_ID}\n")).unwrap();
        assert_eq!(bare.folder_id, FOLDER_ID);
        assert_eq!(bare.kind, GoogleDriveFolderReferenceKind::BareId);
        assert_eq!(bare.resource_key, None);

        for url in [
            format!("https://drive.google.com/drive/folders/{FOLDER_ID}"),
            format!("https://drive.google.com/drive/folders/{FOLDER_ID}/"),
            format!("https://drive.google.com/drive/folders/{FOLDER_ID}?usp=drive_link"),
            format!("https://drive.google.com/drive/u/2/folders/{FOLDER_ID}/"),
        ] {
            let parsed = parse_folder_reference(&url).unwrap();
            assert_eq!(parsed.folder_id, FOLDER_ID);
            assert_eq!(parsed.kind, GoogleDriveFolderReferenceKind::FolderUrl);
            assert_eq!(parsed.resource_key, None);
        }
    }

    #[test]
    fn preserves_one_bounded_resource_key() {
        let parsed = parse_folder_reference(&format!(
            "https://drive.google.com/drive/u/2/folders/{FOLDER_ID}?usp=drive_link&resourcekey=0-Key_123"
        ))
        .unwrap();
        assert_eq!(parsed.resource_key.as_deref(), Some("0-Key_123"));

        for url in [
            format!(
                "https://drive.google.com/drive/folders/{FOLDER_ID}?resourcekey=first&resourcekey=second"
            ),
            format!("https://drive.google.com/drive/folders/{FOLDER_ID}?resourcekey="),
            format!(
                "https://drive.google.com/drive/folders/{FOLDER_ID}?resourcekey={}x",
                "A".repeat(MAX_RESOURCE_KEY_BYTES)
            ),
        ] {
            assert!(parse_folder_reference(&url).is_err(), "accepted {url}");
        }
    }

    #[test]
    fn rejects_file_urls_legacy_links_and_ambiguous_ids() {
        for value in [
            format!("https://drive.google.com/file/d/{FOLDER_ID}/view"),
            format!("https://drive.google.com/open?id={FOLDER_ID}"),
            format!("https://docs.google.com/document/d/{FOLDER_ID}/edit"),
            format!("https://drive.google.com/drive/folders/{FOLDER_ID}?id=anotherFolder123"),
            format!("http://drive.google.com/drive/folders/{FOLDER_ID}"),
        ] {
            assert!(parse_folder_reference(&value).is_err(), "accepted {value}");
        }
    }

    #[test]
    fn rejects_malformed_or_unbounded_references() {
        for value in ["", "root", "not/a/drive/id", "folder id", "folder.id"] {
            assert!(parse_folder_reference(value).is_err(), "accepted {value}");
        }
        assert!(parse_folder_reference(&"A".repeat(MAX_FILE_ID_BYTES + 1)).is_err());
        assert!(parse_folder_reference(&format!(
            "https://drive.google.com/drive/folders/{}",
            "A".repeat(MAX_FILE_ID_BYTES + 1)
        ))
        .is_err());
        assert!(parse_folder_reference(&"A".repeat(MAX_REFERENCE_BYTES + 1)).is_err());
    }

    #[test]
    fn binds_my_drive_folder_without_guessing_from_url() {
        let reference = parse_folder_reference(&format!(
            "https://drive.google.com/drive/folders/{FOLDER_ID}"
        ))
        .unwrap();
        let binding = validate_folder_binding(&reference, metadata(None)).unwrap();

        assert_eq!(binding.folder_id, FOLDER_ID);
        assert_eq!(binding.folder_name, "家計簿 Inbox");
        assert_eq!(binding.drive, GoogleDriveIdentity::MyDrive);
        assert_eq!(binding.resource_key, None);
    }

    #[test]
    fn binds_shared_drive_from_verified_metadata() {
        let reference = parse_folder_reference(FOLDER_ID).unwrap();
        let binding =
            validate_folder_binding(&reference, metadata(Some("0AExampleSharedDrivePVA"))).unwrap();

        assert_eq!(
            binding.drive,
            GoogleDriveIdentity::SharedDrive {
                drive_id: "0AExampleSharedDrivePVA".to_owned()
            }
        );
    }

    #[test]
    fn rejects_mismatched_non_folder_trashed_and_invalid_metadata() {
        let reference = parse_folder_reference(FOLDER_ID).unwrap();

        let mut mismatch = metadata(None);
        mismatch.file_id = "anotherFolder123456789".to_owned();
        assert_eq!(
            validate_folder_binding(&reference, mismatch).unwrap_err(),
            GoogleDriveFolderError::BindingMismatch
        );

        let mut file = metadata(None);
        file.mime_type = "application/pdf".to_owned();
        assert_eq!(
            validate_folder_binding(&reference, file).unwrap_err(),
            GoogleDriveFolderError::NotFolder
        );

        let mut trashed = metadata(None);
        trashed.trashed = true;
        assert_eq!(
            validate_folder_binding(&reference, trashed).unwrap_err(),
            GoogleDriveFolderError::Trashed
        );

        let mut invalid_drive = metadata(Some("invalid shared drive"));
        assert_eq!(
            validate_folder_binding(&reference, invalid_drive.clone()).unwrap_err(),
            GoogleDriveFolderError::InvalidMetadata
        );
        invalid_drive.drive_id = None;
        invalid_drive.name = " \n".to_owned();
        assert_eq!(
            validate_folder_binding(&reference, invalid_drive).unwrap_err(),
            GoogleDriveFolderError::InvalidMetadata
        );

        let invalid_reference = GoogleDriveFolderReference {
            folder_id: FOLDER_ID.to_owned(),
            kind: GoogleDriveFolderReferenceKind::FolderUrl,
            resource_key: Some("invalid resource key".to_owned()),
        };
        assert_eq!(
            validate_folder_binding(&invalid_reference, metadata(None)).unwrap_err(),
            GoogleDriveFolderError::InvalidReference
        );
    }

    #[test]
    fn binding_dtos_serialize_with_stable_drive_identity() {
        let reference = parse_folder_reference(FOLDER_ID).unwrap();
        let my_drive = validate_folder_binding(&reference, metadata(None)).unwrap();
        assert_eq!(
            serde_json::to_value(my_drive).unwrap(),
            serde_json::json!({
                "folderId": FOLDER_ID,
                "folderName": "家計簿 Inbox",
                "drive": { "kind": "MY_DRIVE" }
            })
        );

        let with_key = parse_folder_reference(&format!(
            "https://drive.google.com/drive/folders/{FOLDER_ID}?resourcekey=0-Key_123"
        ))
        .unwrap();
        let with_key = validate_folder_binding(&with_key, metadata(None)).unwrap();
        assert_eq!(
            serde_json::to_value(with_key).unwrap(),
            serde_json::json!({
                "folderId": FOLDER_ID,
                "folderName": "家計簿 Inbox",
                "drive": { "kind": "MY_DRIVE" },
                "resourceKey": "0-Key_123"
            })
        );

        let shared =
            validate_folder_binding(&reference, metadata(Some("0AExampleSharedDrivePVA"))).unwrap();
        assert_eq!(
            serde_json::to_value(shared).unwrap(),
            serde_json::json!({
                "folderId": FOLDER_ID,
                "folderName": "家計簿 Inbox",
                "drive": {
                    "kind": "SHARED_DRIVE",
                    "driveId": "0AExampleSharedDrivePVA"
                }
            })
        );
    }
}
