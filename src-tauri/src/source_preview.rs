use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::Connection;
use serde::Serialize;
use thiserror::Error;

use crate::document_vault::DocumentVault;
use crate::source_viewer;

const MAX_PREVIEW_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum SourcePreviewError {
    #[error("source preview request is invalid")]
    Invalid,
    #[error("source preview was not found")]
    NotFound,
    #[error("source preview format is unsupported")]
    Unsupported,
    #[error("source preview is unavailable")]
    Unavailable,
}

impl SourcePreviewError {
    pub fn public_message(self) -> &'static str {
        match self {
            Self::Invalid => "Source preview request is invalid",
            Self::NotFound => "Source preview was not found",
            Self::Unsupported => "Only PNG, JPEG, and WebP source previews are supported",
            Self::Unavailable => "Source preview is temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceImagePreviewDto {
    pub source_document_id: String,
    pub filename: String,
    pub media_type: String,
    pub byte_size: u64,
    pub data_url: String,
}

pub fn read_source_image_preview(
    connection: &Connection,
    vault: &DocumentVault,
    household_id: &str,
    source_document_id: &str,
) -> Result<SourceImagePreviewDto, SourcePreviewError> {
    let document = source_viewer::get_source_document(connection, household_id, source_document_id)
        .map_err(|error| match error {
            crate::read_model::RepositoryError::InvalidInput(_) => SourcePreviewError::Invalid,
            crate::read_model::RepositoryError::NotFound => SourcePreviewError::NotFound,
            _ => SourcePreviewError::Unavailable,
        })?;
    if document.byte_size > MAX_PREVIEW_BYTES || !supported_image(&document.media_type) {
        return Err(SourcePreviewError::Unsupported);
    }
    let retrieved = vault
        .read(&document.sha256)
        .map_err(|_| SourcePreviewError::Unavailable)?;
    if retrieved.mime_type != document.media_type
        || u64::try_from(retrieved.bytes.len()).ok() != Some(document.byte_size)
    {
        return Err(SourcePreviewError::Unavailable);
    }
    let encoded = STANDARD.encode(&retrieved.bytes);
    Ok(SourceImagePreviewDto {
        source_document_id: document.id,
        filename: document.original_filename,
        media_type: document.media_type.clone(),
        byte_size: document.byte_size,
        data_url: format!("data:{};base64,{encoded}", document.media_type),
    })
}

fn supported_image(media_type: &str) -> bool {
    matches!(media_type, "image/png" | "image/jpeg" | "image/webp")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document_vault::DocumentVault;
    use rusqlite::params;

    fn fixture(media_type: &str, bytes: &[u8]) -> (Connection, DocumentVault, tempfile::TempDir) {
        let temp = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(temp.path().join("vault"), &[7_u8; 32]).unwrap();
        let stored = vault.put(bytes, media_type).unwrap();
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE import_runs(id TEXT PRIMARY KEY, household_id TEXT, adapter_id TEXT, adapter_version TEXT); CREATE TABLE source_documents(id TEXT PRIMARY KEY, household_id TEXT, import_run_id TEXT, source_type TEXT, original_filename TEXT, media_type TEXT, byte_size INTEGER, sha256 TEXT, storage_path TEXT, source_modified_at TEXT, imported_at TEXT); CREATE TABLE source_records(id TEXT PRIMARY KEY,source_document_id TEXT,row_number INTEGER,record_hash TEXT,raw_payload_json TEXT,created_at TEXT); INSERT INTO import_runs VALUES('run','family','receipt','2');").unwrap();
        connection.execute("INSERT INTO source_documents VALUES('image','family','run','MANUAL_UPLOAD','receipt.png',?1,?2,?3,'vault://object',NULL,'2026-07-13T00:00:00Z')", params![media_type, bytes.len() as i64, stored.sha256]).unwrap();
        (connection, vault, temp)
    }

    #[test]
    fn returns_a_tenant_scoped_authenticated_image_data_url() {
        let (connection, vault, _temp) = fixture("image/png", b"not-a-real-png-but-authenticated");
        let preview = read_source_image_preview(&connection, &vault, "family", "image").unwrap();
        assert_eq!(preview.filename, "receipt.png");
        assert!(preview.data_url.starts_with("data:image/png;base64,"));
        assert!(read_source_image_preview(&connection, &vault, "other", "image").is_err());
    }

    #[test]
    fn rejects_non_image_documents_before_vault_read() {
        let (connection, vault, _temp) = fixture("application/pdf", b"%PDF-1.7");
        assert_eq!(
            read_source_image_preview(&connection, &vault, "family", "image"),
            Err(SourcePreviewError::Unsupported)
        );
    }
}
