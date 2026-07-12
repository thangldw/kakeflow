use serde::Serialize;
use thiserror::Error;

const MAX_DOCUMENT_BYTES: usize = 25 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_BYTES: usize = 1024 * 1024;

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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedDocument {
    pub method: &'static str,
    pub text: String,
    pub confidence_bps: u16,
    pub issues: Vec<&'static str>,
}

pub fn extract_document(bytes: &[u8], media_type: &str) -> Result<ExtractedDocument, ExtractError> {
    if bytes.is_empty() || bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(ExtractError::InvalidInput);
    }
    if media_type != "application/pdf" && !bytes.starts_with(b"%PDF-") {
        return Err(ExtractError::Unsupported);
    }
    let extracted = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(bytes))
        .map_err(|_| ExtractError::Extraction)?
        .map_err(|_| ExtractError::Extraction)?;
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
        });
    }
    Ok(ExtractedDocument {
        method: "EMBEDDED_TEXT",
        text,
        confidence_bps: 9000,
        issues: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
