use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_DOCUMENT_BYTES: usize = 25 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_BYTES: usize = 1024 * 1024;
const MAX_PDF_OBJECTS: usize = 100_000;
const MAX_PDF_PAGES: usize = 2_000;
const MAX_PDF_STREAM_MARKERS: usize = 20_000;

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
pub struct ExtractedDocument {
    pub method: &'static str,
    pub text: String,
    pub confidence_bps: u16,
    pub issues: Vec<&'static str>,
    /// Page-aware evidence. Embedded-text extraction currently preserves page
    /// identity but leaves geometry unset; OCR supplies pixel bounding boxes.
    pub regions: Vec<ExtractedRegion>,
}

pub fn extract_document(bytes: &[u8], media_type: &str) -> Result<ExtractedDocument, ExtractError> {
    if bytes.is_empty() || bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(ExtractError::InvalidInput);
    }
    if media_type != "application/pdf" && !bytes.starts_with(b"%PDF-") {
        return Err(ExtractError::Unsupported);
    }
    preflight_pdf(bytes)?;
    let extracted = std::panic::catch_unwind(|| extract_text_capped(bytes))
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
        return Ok(ExtractedDocument {
            method: "EMBEDDED_TEXT",
            text,
            confidence_bps: 0,
            issues: vec!["OCR_REQUIRED"],
            regions: Vec::new(),
        });
    }
    let regions = text
        .split('\u{000c}')
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
        .collect();
    Ok(ExtractedDocument {
        method: "EMBEDDED_TEXT",
        text,
        confidence_bps: 9000,
        issues: Vec::new(),
        regions,
    })
}

fn preflight_pdf(bytes: &[u8]) -> Result<(), ExtractError> {
    if count_occurrences(bytes, b" stream") > MAX_PDF_STREAM_MARKERS
        || declared_pdf_size(bytes).is_some_and(|size| size > MAX_PDF_OBJECTS)
    {
        return Err(ExtractError::InvalidInput);
    }
    Ok(())
}

fn extract_text_capped(bytes: &[u8]) -> Result<String, ExtractError> {
    let mut document =
        pdf_extract::Document::load_mem(bytes).map_err(|_| ExtractError::Extraction)?;
    if document.objects.len() > MAX_PDF_OBJECTS || document.get_pages().len() > MAX_PDF_PAGES {
        return Err(ExtractError::InvalidInput);
    }
    if document.is_encrypted() {
        document.decrypt("").map_err(|_| ExtractError::Extraction)?;
    }

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
    String::from_utf8(text.value).map_err(|_| ExtractError::Extraction)
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
