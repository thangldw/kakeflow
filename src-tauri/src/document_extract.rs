use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_DOCUMENT_BYTES: usize = 25 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_BYTES: usize = 1024 * 1024;
const MAX_PDF_OBJECTS: usize = 100_000;
const MAX_PDF_PAGES: usize = 2_000;
const MAX_PDF_STREAM_MARKERS: usize = 20_000;
const MAX_PDF_PASSWORD_BYTES: usize = 256;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ExtractError {
    #[error("document input is invalid")]
    InvalidInput,
    #[error("document format is unsupported")]
    Unsupported,
    #[error("document extraction failed")]
    Extraction,
    #[error("document requires OCR")]
    OcrRequired,
    #[error("PDF password is required")]
    PasswordRequired,
    #[error("PDF password is invalid")]
    PasswordInvalid,
    #[error("PDF password encryption is unsupported")]
    PasswordUnsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceBoundingBox {
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedRegion {
    /// One-based page number, matching PDF viewers and Tesseract output.
    pub page_number: u32,
    /// `PIXELS` for OCR and `UNLOCATED` when an extractor cannot expose geometry.
    pub coordinate_space: String,
    pub bounding_box: Option<EvidenceBoundingBox>,
    pub text: String,
    pub confidence_bps: u16,
    pub provenance: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedPage {
    /// One-based page number. Every source PDF page receives one outcome,
    /// including pages on which no text was recognized.
    pub page_number: u32,
    /// Pixel coordinate canvas used by OCR regions. Embedded-text pages do not
    /// have a pixel canvas and therefore expose `None`.
    pub width_pixels: Option<u16>,
    pub height_pixels: Option<u16>,
    pub confidence_bps: u16,
    pub issues: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedDocument {
    pub method: &'static str,
    pub text: String,
    pub confidence_bps: u16,
    pub issues: Vec<&'static str>,
    /// Page-aware evidence. Embedded-text extraction currently preserves page
    /// identity but leaves geometry unset; OCR supplies pixel bounding boxes.
    pub regions: Vec<ExtractedRegion>,
    pub page_count: u32,
    pub pages: Vec<ExtractedPage>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentExtractionAttempt {
    pub status: &'static str,
    pub document: Option<ExtractedDocument>,
}

pub fn extract_document(bytes: &[u8], media_type: &str) -> Result<ExtractedDocument, ExtractError> {
    extract_document_with_password(bytes, media_type, None)
}

pub fn extract_document_with_password(
    bytes: &[u8],
    media_type: &str,
    password: Option<&str>,
) -> Result<ExtractedDocument, ExtractError> {
    if bytes.is_empty() || bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(ExtractError::InvalidInput);
    }
    if password.is_some_and(|value| value.len() > MAX_PDF_PASSWORD_BYTES) {
        return Err(ExtractError::InvalidInput);
    }
    if media_type != "application/pdf" && !bytes.starts_with(b"%PDF-") {
        return Err(ExtractError::Unsupported);
    }
    preflight_pdf(bytes)?;
    let (extracted, page_count) = std::panic::catch_unwind(|| extract_text_capped(bytes, password))
        .map_err(|_| ExtractError::Extraction)??;
    let text = extracted.replace('\0', "").trim().to_owned();
    if text.len() > MAX_EXTRACTED_TEXT_BYTES {
        return Err(ExtractError::InvalidInput);
    }
    let meaningful = text
        .chars()
        .filter(|character| !character.is_whitespace())
        .count();
    if meaningful < 8 {
        let pages = (1..=page_count)
            .map(|page_number| ExtractedPage {
                page_number,
                width_pixels: None,
                height_pixels: None,
                confidence_bps: 0,
                issues: vec!["OCR_REQUIRED"],
            })
            .collect();
        return Ok(ExtractedDocument {
            method: "EMBEDDED_TEXT",
            text,
            confidence_bps: 0,
            issues: vec!["OCR_REQUIRED"],
            regions: Vec::new(),
            page_count,
            pages,
        });
    }
    let page_texts = text.split('\u{000c}').collect::<Vec<_>>();
    let regions = page_texts
        .iter()
        .enumerate()
        .filter_map(|(index, page_text)| {
            let page_text = page_text.trim();
            (!page_text.is_empty()).then(|| ExtractedRegion {
                page_number: u32::try_from(index + 1).unwrap_or(u32::MAX),
                coordinate_space: "UNLOCATED".to_owned(),
                bounding_box: None,
                text: page_text.to_owned(),
                confidence_bps: 9000,
                provenance: "PDF_EMBEDDED_TEXT".to_owned(),
            })
        })
        .collect::<Vec<_>>();
    let pages = (1..=page_count)
        .map(|page_number| {
            let has_text = page_texts
                .get(usize::try_from(page_number - 1).unwrap_or(usize::MAX))
                .is_some_and(|value| value.chars().any(|character| !character.is_whitespace()));
            ExtractedPage {
                page_number,
                width_pixels: None,
                height_pixels: None,
                confidence_bps: if has_text { 9000 } else { 0 },
                issues: if has_text {
                    Vec::new()
                } else {
                    vec!["OCR_REQUIRED"]
                },
            }
        })
        .collect::<Vec<_>>();
    let issues = if pages.iter().any(|page| !page.issues.is_empty()) {
        vec!["OCR_REQUIRED"]
    } else {
        Vec::new()
    };
    Ok(ExtractedDocument {
        method: "EMBEDDED_TEXT",
        text,
        confidence_bps: 9000,
        issues,
        regions,
        page_count,
        pages,
    })
}

pub fn attempt_document_extraction(
    bytes: &[u8],
    media_type: &str,
    password: Option<&str>,
) -> Result<DocumentExtractionAttempt, ExtractError> {
    match extract_document_with_password(bytes, media_type, password) {
        Ok(document) => Ok(DocumentExtractionAttempt {
            status: "SUCCESS",
            document: Some(document),
        }),
        Err(ExtractError::PasswordRequired) => Ok(DocumentExtractionAttempt {
            status: "PASSWORD_REQUIRED",
            document: None,
        }),
        Err(ExtractError::PasswordInvalid) => Ok(DocumentExtractionAttempt {
            status: "PASSWORD_INVALID",
            document: None,
        }),
        Err(ExtractError::PasswordUnsupported) => Ok(DocumentExtractionAttempt {
            status: "PASSWORD_UNSUPPORTED",
            document: None,
        }),
        Err(error) => Err(error),
    }
}

fn preflight_pdf(bytes: &[u8]) -> Result<(), ExtractError> {
    if count_occurrences(bytes, b" stream") > MAX_PDF_STREAM_MARKERS
        || declared_pdf_size(bytes).is_some_and(|size| size > MAX_PDF_OBJECTS)
    {
        return Err(ExtractError::InvalidInput);
    }
    Ok(())
}

fn extract_text_capped(
    bytes: &[u8],
    password: Option<&str>,
) -> Result<(String, u32), ExtractError> {
    let mut document =
        pdf_extract::Document::load_mem(bytes).map_err(|_| ExtractError::Extraction)?;
    if document.is_encrypted() {
        document = pdf_extract::Document::load_mem_with_options(
            bytes,
            pdf_extract::LoadOptions::with_password(password.unwrap_or("")),
        )
        .map_err(|error| classify_decryption_error(error, password.is_some()))?;
    }
    let page_count = document.get_pages().len();
    if document.objects.len() > MAX_PDF_OBJECTS || page_count == 0 || page_count > MAX_PDF_PAGES {
        return Err(ExtractError::InvalidInput);
    }
    let page_count = u32::try_from(page_count).map_err(|_| ExtractError::InvalidInput)?;

    let mut text = CappedBytes::new(MAX_EXTRACTED_TEXT_BYTES);
    let output_result = {
        let writer: &mut dyn std::io::Write = &mut text;
        let mut output = pdf_extract::PlainTextOutput::new(writer);
        pdf_extract::output_doc(&document, &mut output)
    };
    if text.exceeded {
        return Err(ExtractError::InvalidInput);
    }
    output_result.map_err(|_| ExtractError::Extraction)?;
    if text.value.iter().all(u8::is_ascii_whitespace) {
        let page_numbers = document.get_pages().keys().copied().collect::<Vec<_>>();
        let fallback = document
            .extract_text(&page_numbers)
            .map_err(|_| ExtractError::Extraction)?;
        if fallback.len() > MAX_EXTRACTED_TEXT_BYTES {
            return Err(ExtractError::InvalidInput);
        }
        return Ok((fallback, page_count));
    }
    String::from_utf8(text.value)
        .map(|text| (text, page_count))
        .map_err(|_| ExtractError::Extraction)
}

fn classify_decryption_error(error: pdf_extract::Error, password_supplied: bool) -> ExtractError {
    use pdf_extract::encryption::DecryptionError;
    match error {
        pdf_extract::Error::InvalidPassword
        | pdf_extract::Error::Decryption(DecryptionError::IncorrectPassword) => {
            if password_supplied {
                ExtractError::PasswordInvalid
            } else {
                ExtractError::PasswordRequired
            }
        }
        pdf_extract::Error::UnsupportedSecurityHandler(_)
        | pdf_extract::Error::Decryption(
            DecryptionError::UnsupportedEncryption
            | DecryptionError::UnsupportedVersion
            | DecryptionError::UnsupportedRevision,
        ) => ExtractError::PasswordUnsupported,
        _ => ExtractError::Extraction,
    }
}

fn count_occurrences(haystack: &[u8], needle: &[u8]) -> usize {
    haystack
        .windows(needle.len())
        .filter(|window| *window == needle)
        .count()
}

fn declared_pdf_size(bytes: &[u8]) -> Option<usize> {
    let mut largest = None;
    for index in 0..bytes.len().saturating_sub(5) {
        if &bytes[index..index + 5] != b"/Size" {
            continue;
        }
        let mut cursor = index + 5;
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        let start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        if cursor > start {
            let value = std::str::from_utf8(&bytes[start..cursor])
                .ok()
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(usize::MAX);
            largest = Some(largest.map_or(value, |current: usize| current.max(value)));
        }
    }
    largest
}

struct CappedBytes {
    value: Vec<u8>,
    limit: usize,
    exceeded: bool,
}

impl CappedBytes {
    fn new(limit: usize) -> Self {
        Self {
            value: Vec::new(),
            limit,
            exceeded: false,
        }
    }
}

impl std::io::Write for CappedBytes {
    fn write(&mut self, value: &[u8]) -> std::io::Result<usize> {
        let Some(next_len) = self.value.len().checked_add(value.len()) else {
            self.exceeded = true;
            return Err(std::io::Error::other("extracted text limit exceeded"));
        };
        if next_len > self.limit {
            self.exceeded = true;
            return Err(std::io::Error::other("extracted text limit exceeded"));
        }
        self.value.extend_from_slice(value);
        Ok(value.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::io::Write as _;

    fn text_pdf(text: &str) -> Vec<u8> {
        let escaped = text
            .replace('\\', "\\\\")
            .replace('(', "\\(")
            .replace(')', "\\)");
        let stream = format!("BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET");
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>".to_owned(),
            format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len()),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
        ];
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
        }
        let xref = pdf.len();
        pdf.extend_from_slice(
            format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
        );
        for offset in offsets {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
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

    #[test]
    fn extracts_embedded_pdf_text_without_ocr() {
        let result = extract_document(&text_pdf("STORE TOTAL 1200"), "application/pdf").unwrap();
        assert!(result.text.contains("STORE TOTAL 1200"));
        assert_eq!(result.confidence_bps, 9000);
        assert!(result.issues.is_empty());
        assert_eq!(result.regions[0].page_number, 1);
        assert_eq!(result.regions[0].coordinate_space, "UNLOCATED");
    }

    #[test]
    fn extracts_password_protected_pdf_only_with_the_ephemeral_password() {
        let bytes = password_protected_pdf();
        assert_eq!(
            attempt_document_extraction(&bytes, "application/pdf", None).unwrap(),
            DocumentExtractionAttempt {
                status: "PASSWORD_REQUIRED",
                document: None,
            }
        );
        assert_eq!(
            attempt_document_extraction(&bytes, "application/pdf", Some("wrong")).unwrap(),
            DocumentExtractionAttempt {
                status: "PASSWORD_INVALID",
                document: None,
            }
        );
        let attempt =
            attempt_document_extraction(&bytes, "application/pdf", Some("one-time-password"))
                .unwrap();
        assert_eq!(attempt.status, "SUCCESS");
        let document = attempt.document.unwrap();
        assert!(
            document.text.contains("PRIVATE TOTAL 2400"),
            "extracted text was {:?}",
            document.text
        );
    }

    #[test]
    fn rejects_non_pdf_and_oversized_input() {
        assert_eq!(
            extract_document(b"image", "image/png"),
            Err(ExtractError::Unsupported)
        );
        assert_eq!(
            extract_document(&[], "application/pdf"),
            Err(ExtractError::InvalidInput)
        );
    }

    #[test]
    fn rejects_implausible_declared_object_count_before_parsing() {
        let bytes = b"%PDF-1.7\ntrailer << /Size 100001 >>\n%%EOF";
        assert_eq!(
            extract_document(bytes, "application/pdf"),
            Err(ExtractError::InvalidInput)
        );
    }

    #[test]
    fn capped_writer_stops_before_allocating_excess_output() {
        let mut writer = CappedBytes::new(8);
        assert!(writer.write_all(b"12345678").is_ok());
        assert!(writer.write_all(b"9").is_err());
        assert!(writer.exceeded);
        assert_eq!(writer.value, b"12345678");
    }

    #[test]
    fn aborts_pdf_text_extraction_at_output_limit() {
        let oversized_text = "A".repeat(MAX_EXTRACTED_TEXT_BYTES + 1);
        assert_eq!(
            extract_document(&text_pdf(&oversized_text), "application/pdf"),
            Err(ExtractError::InvalidInput)
        );
    }
}
