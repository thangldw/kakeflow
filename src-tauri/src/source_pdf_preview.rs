use base64::{engine::general_purpose::STANDARD, Engine as _};
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::{DecryptionError, LoadPdfError, Pdf};
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{render, RenderCache, RenderSettings};
use rusqlite::Connection;
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};
use thiserror::Error;

use crate::document_vault::DocumentVault;
use crate::source_viewer;

const MAX_PDF_BYTES: u64 = 25 * 1024 * 1024;
const MAX_PDF_PAGES: usize = 2_000;
const MAX_RENDER_EDGE: f32 = 1_600.0;
const MAX_PDF_PASSWORD_BYTES: usize = 256;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum SourcePdfPreviewError {
    #[error("source PDF preview request is invalid")]
    Invalid,
    #[error("source PDF preview was not found")]
    NotFound,
    #[error("source PDF preview format is unsupported")]
    Unsupported,
    #[error("source PDF preview is unavailable")]
    Unavailable,
    #[error("source PDF password is required")]
    PasswordRequired,
    #[error("source PDF password is invalid")]
    PasswordInvalid,
    #[error("source PDF password encryption is unsupported")]
    PasswordUnsupported,
}

impl SourcePdfPreviewError {
    pub fn public_message(self) -> &'static str {
        match self {
            Self::Invalid => "Source PDF preview request is invalid",
            Self::NotFound => "Source PDF preview was not found",
            Self::Unsupported => "Only PDF source page previews are supported",
            Self::Unavailable => "Source PDF preview is temporarily unavailable",
            Self::PasswordRequired => "Source PDF password is required",
            Self::PasswordInvalid => "Source PDF password is invalid",
            Self::PasswordUnsupported => "Source PDF password encryption is unsupported",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourcePdfPagePreviewDto {
    pub source_document_id: String,
    pub filename: String,
    /// One-based page number, matching the evidence model and desktop UI.
    pub page_number: u32,
    pub page_count: u32,
    pub page_width_points: f32,
    pub page_height_points: f32,
    pub width_pixels: u16,
    pub height_pixels: u16,
    pub media_type: &'static str,
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourcePdfPagePreviewAttemptDto {
    pub status: &'static str,
    pub preview: Option<SourcePdfPagePreviewDto>,
}

pub fn render_source_pdf_page(
    connection: &Connection,
    vault: &DocumentVault,
    household_id: &str,
    source_document_id: &str,
    page_number: u32,
) -> Result<SourcePdfPagePreviewDto, SourcePdfPreviewError> {
    render_source_pdf_page_with_password(
        connection,
        vault,
        household_id,
        source_document_id,
        page_number,
        None,
    )
}

pub fn render_source_pdf_page_with_password(
    connection: &Connection,
    vault: &DocumentVault,
    household_id: &str,
    source_document_id: &str,
    page_number: u32,
    password: Option<&str>,
) -> Result<SourcePdfPagePreviewDto, SourcePdfPreviewError> {
    if password.is_some_and(|value| value.len() > MAX_PDF_PASSWORD_BYTES) {
        return Err(SourcePdfPreviewError::Invalid);
    }
    if page_number == 0 {
        return Err(SourcePdfPreviewError::Invalid);
    }
    let document = source_viewer::get_source_document(connection, household_id, source_document_id)
        .map_err(|error| match error {
            crate::read_model::RepositoryError::InvalidInput(_) => SourcePdfPreviewError::Invalid,
            crate::read_model::RepositoryError::NotFound => SourcePdfPreviewError::NotFound,
            _ => SourcePdfPreviewError::Unavailable,
        })?;
    if document.media_type != "application/pdf" {
        return Err(SourcePdfPreviewError::Unsupported);
    }
    if document.byte_size == 0 || document.byte_size > MAX_PDF_BYTES {
        return Err(SourcePdfPreviewError::Unsupported);
    }
    let retrieved = vault
        .read(&document.sha256)
        .map_err(|_| SourcePdfPreviewError::Unavailable)?;
    if retrieved.mime_type != document.media_type
        || u64::try_from(retrieved.bytes.len()).ok() != Some(document.byte_size)
        || !retrieved.bytes.starts_with(b"%PDF-")
    {
        return Err(SourcePdfPreviewError::Unavailable);
    }

    let rendered = catch_unwind(AssertUnwindSafe(|| {
        render_page(&retrieved.bytes, page_number, password)
    }))
    .map_err(|_| SourcePdfPreviewError::Unavailable)??;
    let encoded = STANDARD.encode(rendered.png);
    Ok(SourcePdfPagePreviewDto {
        source_document_id: document.id,
        filename: document.original_filename,
        page_number,
        page_count: rendered.page_count,
        page_width_points: rendered.page_width_points,
        page_height_points: rendered.page_height_points,
        width_pixels: rendered.width_pixels,
        height_pixels: rendered.height_pixels,
        media_type: "image/png",
        data_url: format!("data:image/png;base64,{encoded}"),
    })
}

pub fn attempt_source_pdf_page_preview(
    connection: &Connection,
    vault: &DocumentVault,
    household_id: &str,
    source_document_id: &str,
    page_number: u32,
    password: Option<&str>,
) -> Result<SourcePdfPagePreviewAttemptDto, SourcePdfPreviewError> {
    match render_source_pdf_page_with_password(
        connection,
        vault,
        household_id,
        source_document_id,
        page_number,
        password,
    ) {
        Ok(preview) => Ok(SourcePdfPagePreviewAttemptDto {
            status: "SUCCESS",
            preview: Some(preview),
        }),
        Err(SourcePdfPreviewError::PasswordRequired) => Ok(SourcePdfPagePreviewAttemptDto {
            status: "PASSWORD_REQUIRED",
            preview: None,
        }),
        Err(SourcePdfPreviewError::PasswordInvalid) => Ok(SourcePdfPagePreviewAttemptDto {
            status: "PASSWORD_INVALID",
            preview: None,
        }),
        Err(SourcePdfPreviewError::PasswordUnsupported) => Ok(SourcePdfPagePreviewAttemptDto {
            status: "PASSWORD_UNSUPPORTED",
            preview: None,
        }),
        Err(error) => Err(error),
    }
}

struct RenderedPage {
    png: Vec<u8>,
    page_count: u32,
    page_width_points: f32,
    page_height_points: f32,
    width_pixels: u16,
    height_pixels: u16,
}

fn render_page(
    bytes: &[u8],
    page_number: u32,
    password: Option<&str>,
) -> Result<RenderedPage, SourcePdfPreviewError> {
    let pdf =
        Pdf::new_with_password(bytes.to_vec(), password.unwrap_or("")).map_err(
            |error| match error {
                LoadPdfError::Decryption(DecryptionError::PasswordProtected) => {
                    if password.is_some() {
                        SourcePdfPreviewError::PasswordInvalid
                    } else {
                        SourcePdfPreviewError::PasswordRequired
                    }
                }
                LoadPdfError::Decryption(DecryptionError::UnsupportedAlgorithm) => {
                    SourcePdfPreviewError::PasswordUnsupported
                }
                _ => SourcePdfPreviewError::Unavailable,
            },
        )?;
    let pages = pdf.pages();
    if pages.is_empty() || pages.len() > MAX_PDF_PAGES {
        return Err(SourcePdfPreviewError::Unavailable);
    }
    let page_index =
        usize::try_from(page_number - 1).map_err(|_| SourcePdfPreviewError::Invalid)?;
    let page = pages
        .get(page_index)
        .ok_or(SourcePdfPreviewError::Invalid)?;
    let (page_width_points, page_height_points) = page.render_dimensions();
    if !page_width_points.is_finite()
        || !page_height_points.is_finite()
        || page_width_points <= 0.0
        || page_height_points <= 0.0
    {
        return Err(SourcePdfPreviewError::Unavailable);
    }
    let scale = (MAX_RENDER_EDGE / page_width_points.max(page_height_points)).min(2.0);
    let width_pixels = (page_width_points * scale)
        .round()
        .clamp(1.0, MAX_RENDER_EDGE) as u16;
    let height_pixels = (page_height_points * scale)
        .round()
        .clamp(1.0, MAX_RENDER_EDGE) as u16;
    let pixmap = render(
        page,
        &RenderCache::new(),
        &InterpreterSettings::default(),
        &RenderSettings {
            x_scale: scale,
            y_scale: scale,
            width: Some(width_pixels),
            height: Some(height_pixels),
            bg_color: WHITE,
        },
    );
    let png = pixmap
        .into_png()
        .map_err(|_| SourcePdfPreviewError::Unavailable)?;
    Ok(RenderedPage {
        png,
        page_count: u32::try_from(pages.len()).map_err(|_| SourcePdfPreviewError::Unavailable)?,
        page_width_points,
        page_height_points,
        width_pixels,
        height_pixels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn text_pdf(text: &str) -> Vec<u8> {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>".to_owned(),
            format!("<< /Length {} >>\nstream\nBT /F1 18 Tf 30 100 Td ({text}) Tj ET\nendstream", 40 + text.len()),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
        ];
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = vec![0];
        for (index, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
        }
        let xref = pdf.len();
        pdf.extend_from_slice(
            format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
        );
        for offset in offsets.iter().skip(1) {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF",
                objects.len() + 1
            )
            .as_bytes(),
        );
        pdf
    }

    fn password_protected_pdf() -> Vec<u8> {
        STANDARD
            .decode(include_str!("../testdata/password-protected-reportlab.pdf.b64").trim())
            .unwrap()
    }

    fn fixture(media_type: &str, bytes: &[u8]) -> (Connection, DocumentVault, tempfile::TempDir) {
        let temp = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(temp.path().join("vault"), &[8_u8; 32]).unwrap();
        let stored = vault.put(bytes, media_type).unwrap();
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE household_members(id TEXT PRIMARY KEY, household_id TEXT, display_name TEXT); CREATE TABLE import_runs(id TEXT PRIMARY KEY, household_id TEXT, adapter_id TEXT, adapter_version TEXT); CREATE TABLE source_documents(id TEXT PRIMARY KEY, household_id TEXT, import_run_id TEXT, source_type TEXT, original_filename TEXT, media_type TEXT, byte_size INTEGER, sha256 TEXT, storage_path TEXT, source_modified_at TEXT, imported_at TEXT, audience_visibility TEXT, audience_member_id TEXT); CREATE TABLE source_records(id TEXT PRIMARY KEY,source_document_id TEXT,row_number INTEGER,record_hash TEXT,raw_payload_json TEXT,created_at TEXT); INSERT INTO import_runs VALUES('run','family','pdf','1');").unwrap();
        connection.execute("INSERT INTO source_documents VALUES('document','family','run','MANUAL_UPLOAD','statement.pdf',?1,?2,?3,'vault://object',NULL,'2026-07-13T00:00:00Z','SHARED',NULL)", params![media_type, bytes.len() as i64, stored.sha256]).unwrap();
        (connection, vault, temp)
    }

    #[test]
    fn renders_a_tenant_scoped_authenticated_pdf_page() {
        let bytes = text_pdf("KakeFlow 1200");
        let (connection, vault, _temp) = fixture("application/pdf", &bytes);
        let preview = render_source_pdf_page(&connection, &vault, "family", "document", 1).unwrap();
        assert_eq!(preview.page_count, 1);
        assert_eq!(preview.page_width_points, 300.0);
        assert_eq!(preview.page_height_points, 200.0);
        assert!(preview.data_url.starts_with("data:image/png;base64,"));
        if let Ok(path) = std::env::var("KAKEFLOW_PDF_PREVIEW_TEST_OUTPUT") {
            let encoded = preview.data_url.split_once(',').unwrap().1;
            std::fs::write(path, STANDARD.decode(encoded).unwrap()).unwrap();
        }
        assert_eq!(
            render_source_pdf_page(&connection, &vault, "other", "document", 1),
            Err(SourcePdfPreviewError::NotFound)
        );
    }

    #[test]
    fn rejects_non_pdf_sources_and_out_of_bounds_pages() {
        let (connection, vault, _temp) = fixture("image/png", b"not-a-pdf");
        assert_eq!(
            render_source_pdf_page(&connection, &vault, "family", "document", 1),
            Err(SourcePdfPreviewError::Unsupported)
        );

        let bytes = text_pdf("one page");
        let (connection, vault, _temp) = fixture("application/pdf", &bytes);
        assert_eq!(
            render_source_pdf_page(&connection, &vault, "family", "document", 0),
            Err(SourcePdfPreviewError::Invalid)
        );
        assert_eq!(
            render_source_pdf_page(&connection, &vault, "family", "document", 2),
            Err(SourcePdfPreviewError::Invalid)
        );
    }

    #[test]
    fn renders_an_encrypted_vault_pdf_only_with_an_ephemeral_password() {
        let bytes = password_protected_pdf();
        let (connection, vault, _temp) = fixture("application/pdf", &bytes);

        let required =
            attempt_source_pdf_page_preview(&connection, &vault, "family", "document", 1, None)
                .unwrap();
        assert_eq!(required.status, "PASSWORD_REQUIRED");
        assert!(required.preview.is_none());

        let invalid = attempt_source_pdf_page_preview(
            &connection,
            &vault,
            "family",
            "document",
            1,
            Some("wrong"),
        )
        .unwrap();
        assert_eq!(invalid.status, "PASSWORD_INVALID");

        let success = attempt_source_pdf_page_preview(
            &connection,
            &vault,
            "family",
            "document",
            1,
            Some("one-time-password"),
        )
        .unwrap();
        assert_eq!(success.status, "SUCCESS");
        assert!(success
            .preview
            .unwrap()
            .data_url
            .starts_with("data:image/png;base64,"));
    }
}
