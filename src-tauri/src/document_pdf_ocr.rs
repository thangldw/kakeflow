//! Complete, bounded OCR for image-only PDF documents.
//!
//! Rendering is shared with the authenticated source viewer, so persisted
//! pixel coordinates remain aligned when the original page is reviewed later.
//! A required-page failure aborts the whole attempt; no partial extraction is
//! returned to the import workflow.

use std::{
    collections::BTreeMap,
    io::Write as _,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use serde::Serialize;
use thiserror::Error;

use crate::{
    document_extract::{EvidenceBoundingBox, ExtractedDocument, ExtractedPage, ExtractedRegion},
    ocr::{OcrConfig, OcrError, OcrResult, OcrWord, OfflineOcrProvider},
    private_fs,
    source_pdf_preview::{self, SourcePdfPreviewError},
};

const MAX_PDF_BYTES: usize = 25 * 1024 * 1024;
const MAX_PASSWORD_BYTES: usize = 256;
const MAX_OCR_PAGES: usize = 32;
const MAX_RENDERED_PIXELS: u64 = 80_000_000;
const MAX_TEXT_BYTES: usize = 256 * 1024;
const MAX_REGIONS: usize = 10_000;
const MAX_SERIALIZED_BYTES: usize = 768 * 1024;
const MAX_TOTAL_DURATION: Duration = Duration::from_secs(120);
const MAX_PAGE_DURATION: Duration = Duration::from_secs(30);

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum PdfOcrError {
    #[error("PDF OCR input is invalid")]
    Invalid,
    #[error("PDF OCR format is unsupported")]
    Unsupported,
    #[error("PDF password is required")]
    PasswordRequired,
    #[error("PDF password is invalid")]
    PasswordInvalid,
    #[error("PDF password encryption is unsupported")]
    PasswordUnsupported,
    #[error("offline OCR engine is unavailable")]
    EngineUnavailable,
    #[error("offline OCR language models are unavailable")]
    ModelsUnavailable,
    #[error("PDF OCR exceeds a processing limit")]
    LimitExceeded,
    #[error("PDF OCR timed out")]
    TimedOut,
    #[error("PDF OCR found no text")]
    NoText,
    #[error("PDF OCR failed")]
    Failed,
}

impl PdfOcrError {
    fn status(self) -> &'static str {
        match self {
            Self::PasswordRequired => "PASSWORD_REQUIRED",
            Self::PasswordInvalid => "PASSWORD_INVALID",
            Self::PasswordUnsupported => "PASSWORD_UNSUPPORTED",
            Self::EngineUnavailable => "OCR_ENGINE_UNAVAILABLE",
            Self::ModelsUnavailable => "OCR_MODELS_UNAVAILABLE",
            Self::LimitExceeded => "LIMIT_EXCEEDED",
            Self::TimedOut => "TIMED_OUT",
            Self::NoText => "NO_TEXT",
            Self::Invalid | Self::Unsupported | Self::Failed => "FAILED",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PdfOcrAttempt {
    pub status: &'static str,
    pub document: Option<ExtractedDocument>,
}

pub fn attempt_pdf_ocr(
    bytes: &[u8],
    media_type: &str,
    password: Option<&str>,
    temporary_directory: &Path,
    config: OcrConfig,
) -> PdfOcrAttempt {
    match recognize_pdf(bytes, media_type, password, temporary_directory, config) {
        Ok(document) => PdfOcrAttempt {
            status: "SUCCESS",
            document: Some(document),
        },
        Err(error) => PdfOcrAttempt {
            status: error.status(),
            document: None,
        },
    }
}

fn recognize_pdf(
    bytes: &[u8],
    media_type: &str,
    password: Option<&str>,
    temporary_directory: &Path,
    config: OcrConfig,
) -> Result<ExtractedDocument, PdfOcrError> {
    if media_type != "application/pdf" {
        return Err(PdfOcrError::Unsupported);
    }
    if bytes.is_empty()
        || bytes.len() > MAX_PDF_BYTES
        || !bytes.starts_with(b"%PDF-")
        || password.is_some_and(|value| value.len() > MAX_PASSWORD_BYTES)
    {
        return Err(PdfOcrError::Invalid);
    }
    let started = Instant::now();
    let rendered =
        source_pdf_preview::render_pdf_pages(bytes, password, MAX_OCR_PAGES, MAX_RENDERED_PIXELS)
            .map_err(map_render_error)?;
    std::fs::create_dir_all(temporary_directory).map_err(|_| PdfOcrError::Failed)?;
    private_fs::secure_directory(temporary_directory).map_err(|_| PdfOcrError::Failed)?;
    let provider = OfflineOcrProvider::discover(config).map_err(map_ocr_error)?;

    let mut page_results = Vec::with_capacity(rendered.len());
    for page in rendered {
        let remaining = MAX_TOTAL_DURATION
            .checked_sub(started.elapsed())
            .ok_or(PdfOcrError::TimedOut)?;
        let timeout = remaining.min(MAX_PAGE_DURATION);
        if timeout.is_zero() {
            return Err(PdfOcrError::TimedOut);
        }
        let file = TemporaryOcrFile::create(temporary_directory, &page.png)?;
        let result = provider
            .recognize_with_timeout(&file.path, timeout)
            .map_err(map_ocr_error)?;
        validate_word_boxes(&result.words, page.width_pixels, page.height_pixels)?;
        page_results.push(PageRecognition {
            page_number: page.page_number,
            width_pixels: page.width_pixels,
            height_pixels: page.height_pixels,
            result,
        });
    }
    if started.elapsed() > MAX_TOTAL_DURATION {
        return Err(PdfOcrError::TimedOut);
    }
    build_document(page_results)
}

struct PageRecognition {
    page_number: u32,
    width_pixels: u16,
    height_pixels: u16,
    result: OcrResult,
}

fn build_document(results: Vec<PageRecognition>) -> Result<ExtractedDocument, PdfOcrError> {
    if results.is_empty() {
        return Err(PdfOcrError::Failed);
    }
    let mut regions = Vec::new();
    let mut pages = Vec::with_capacity(results.len());
    let mut page_text = Vec::with_capacity(results.len());
    let mut confidence_sum = 0.0_f64;
    let mut confidence_words = 0_u64;
    let mut empty_page = false;

    for page in results {
        let words = &page.result.words;
        let confidence_bps = if words.is_empty() {
            0
        } else {
            ((words
                .iter()
                .map(|word| f64::from(word.confidence))
                .sum::<f64>()
                / words.len() as f64)
                * 10_000.0)
                .round() as u16
        };
        confidence_sum += words
            .iter()
            .map(|word| f64::from(word.confidence))
            .sum::<f64>();
        confidence_words = confidence_words
            .checked_add(u64::try_from(words.len()).map_err(|_| PdfOcrError::LimitExceeded)?)
            .ok_or(PdfOcrError::LimitExceeded)?;
        let mut issues = Vec::new();
        if page.result.text.trim().is_empty() {
            issues.push("NO_TEXT");
            empty_page = true;
        } else if confidence_bps < 7_500 {
            issues.push("LOW_OCR_CONFIDENCE");
        }
        pages.push(ExtractedPage {
            page_number: page.page_number,
            width_pixels: Some(page.width_pixels),
            height_pixels: Some(page.height_pixels),
            confidence_bps,
            issues,
        });
        page_text.push(page.result.text.trim().to_owned());
        regions.extend(line_regions(page.page_number, words));
        regions.extend(words.iter().map(|word| word_region(page.page_number, word)));
        if regions.len() > MAX_REGIONS {
            return Err(PdfOcrError::LimitExceeded);
        }
    }
    let text = page_text.join("\n\u{000c}\n");
    if text.len() > MAX_TEXT_BYTES {
        return Err(PdfOcrError::LimitExceeded);
    }
    if text
        .chars()
        .filter(|character| !character.is_whitespace())
        .count()
        < 2
    {
        return Err(PdfOcrError::NoText);
    }
    let confidence_bps = if confidence_words == 0 {
        0
    } else {
        ((confidence_sum / confidence_words as f64) * 10_000.0).round() as u16
    };
    let mut issues = Vec::new();
    if confidence_bps < 7_500 {
        issues.push("LOW_OCR_CONFIDENCE");
    }
    if empty_page {
        issues.push("OCR_EMPTY_PAGE");
    }
    let document = ExtractedDocument {
        method: "OCR",
        text,
        confidence_bps,
        issues,
        regions,
        page_count: u32::try_from(pages.len()).map_err(|_| PdfOcrError::LimitExceeded)?,
        pages,
    };
    if serde_json::to_vec(&document)
        .map_err(|_| PdfOcrError::Failed)?
        .len()
        > MAX_SERIALIZED_BYTES
    {
        return Err(PdfOcrError::LimitExceeded);
    }
    Ok(document)
}

pub(crate) fn line_regions(page_number: u32, words: &[OcrWord]) -> Vec<ExtractedRegion> {
    let mut lines: BTreeMap<(u32, u32, u32, u32), Vec<&OcrWord>> = BTreeMap::new();
    for word in words {
        lines
            .entry((word.page, word.block, word.paragraph, word.line))
            .or_default()
            .push(word);
    }
    lines
        .into_values()
        .filter_map(|line| {
            let left = line.iter().map(|word| word.left).min()?;
            let top = line.iter().map(|word| word.top).min()?;
            let right = line
                .iter()
                .filter_map(|word| word.left.checked_add(word.width))
                .max()?;
            let bottom = line
                .iter()
                .filter_map(|word| word.top.checked_add(word.height))
                .max()?;
            Some(ExtractedRegion {
                page_number,
                coordinate_space: "PIXELS".to_owned(),
                bounding_box: Some(EvidenceBoundingBox {
                    left,
                    top,
                    width: right - left,
                    height: bottom - top,
                }),
                text: line
                    .iter()
                    .map(|word| word.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
                confidence_bps: ((line
                    .iter()
                    .map(|word| f64::from(word.confidence))
                    .sum::<f64>()
                    / line.len() as f64)
                    * 10_000.0)
                    .round() as u16,
                provenance: "TESSERACT_LINE".to_owned(),
            })
        })
        .collect()
}

pub(crate) fn word_region(page_number: u32, word: &OcrWord) -> ExtractedRegion {
    ExtractedRegion {
        page_number,
        coordinate_space: "PIXELS".to_owned(),
        bounding_box: Some(EvidenceBoundingBox {
            left: word.left,
            top: word.top,
            width: word.width,
            height: word.height,
        }),
        text: word.text.clone(),
        confidence_bps: (word.confidence * 10_000.0).round() as u16,
        provenance: "TESSERACT_WORD".to_owned(),
    }
}

fn validate_word_boxes(words: &[OcrWord], width: u16, height: u16) -> Result<(), PdfOcrError> {
    for word in words {
        let right = word
            .left
            .checked_add(word.width)
            .ok_or(PdfOcrError::Failed)?;
        let bottom = word
            .top
            .checked_add(word.height)
            .ok_or(PdfOcrError::Failed)?;
        if word.page == 0
            || word.width == 0
            || word.height == 0
            || right > u32::from(width)
            || bottom > u32::from(height)
        {
            return Err(PdfOcrError::Failed);
        }
    }
    Ok(())
}

fn map_render_error(error: SourcePdfPreviewError) -> PdfOcrError {
    match error {
        SourcePdfPreviewError::PasswordRequired => PdfOcrError::PasswordRequired,
        SourcePdfPreviewError::PasswordInvalid => PdfOcrError::PasswordInvalid,
        SourcePdfPreviewError::PasswordUnsupported => PdfOcrError::PasswordUnsupported,
        SourcePdfPreviewError::PageLimitExceeded => PdfOcrError::LimitExceeded,
        _ => PdfOcrError::Failed,
    }
}

fn map_ocr_error(error: OcrError) -> PdfOcrError {
    match error {
        OcrError::EngineUnavailable => PdfOcrError::EngineUnavailable,
        OcrError::LanguageModelsUnavailable => PdfOcrError::ModelsUnavailable,
        OcrError::TimedOut => PdfOcrError::TimedOut,
        OcrError::InputTooLarge | OcrError::ImageDimensionsTooLarge | OcrError::OutputTooLarge => {
            PdfOcrError::LimitExceeded
        }
        _ => PdfOcrError::Failed,
    }
}

struct TemporaryOcrFile {
    path: PathBuf,
}

impl TemporaryOcrFile {
    fn create(directory: &Path, bytes: &[u8]) -> Result<Self, PdfOcrError> {
        for _ in 0..16 {
            let mut random = [0_u8; 16];
            getrandom::getrandom(&mut random).map_err(|_| PdfOcrError::Failed)?;
            let name = random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            let path = directory.join(format!(".{name}.png"));
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            match options.open(&path) {
                Ok(mut file) => {
                    if private_fs::secure_file(&path).is_err()
                        || file.write_all(bytes).is_err()
                        || file.sync_all().is_err()
                    {
                        let _ = std::fs::remove_file(&path);
                        return Err(PdfOcrError::Failed);
                    }
                    return Ok(Self { path });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err(PdfOcrError::Failed),
            }
        }
        Err(PdfOcrError::Failed)
    }
}

impl Drop for TemporaryOcrFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_pdf(page_count: usize) -> Vec<u8> {
        let kids = (0..page_count)
            .map(|index| format!("{} 0 R", index + 3))
            .collect::<Vec<_>>()
            .join(" ");
        let mut objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            format!("<< /Type /Pages /Kids [{kids}] /Count {page_count} >>"),
        ];
        objects.extend(
            (0..page_count)
                .map(|_| "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] >>".to_owned()),
        );
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

    fn word(text: &str, page: u32, line: u32, left: u32, confidence: f32) -> OcrWord {
        OcrWord {
            text: text.to_owned(),
            confidence,
            page,
            block: 1,
            paragraph: 1,
            line,
            left,
            top: line * 20,
            width: 30,
            height: 12,
        }
    }

    #[test]
    fn builds_ordered_page_outcomes_and_word_weighted_confidence() {
        let pages = vec![
            PageRecognition {
                page_number: 1,
                width_pixels: 200,
                height_pixels: 300,
                result: OcrResult {
                    text: "STORE\nTOTAL 1200".to_owned(),
                    words: vec![word("STORE", 1, 1, 10, 0.9), word("TOTAL", 1, 2, 10, 0.7)],
                    mean_confidence: Some(0.8),
                },
            },
            PageRecognition {
                page_number: 2,
                width_pixels: 200,
                height_pixels: 300,
                result: OcrResult {
                    text: "SECOND".to_owned(),
                    words: vec![word("SECOND", 1, 1, 10, 0.3)],
                    mean_confidence: Some(0.3),
                },
            },
        ];
        let document = build_document(pages).unwrap();
        assert_eq!(document.page_count, 2);
        assert_eq!(
            document
                .pages
                .iter()
                .map(|page| page.page_number)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(document.confidence_bps, 6333);
        assert_eq!(document.text, "STORE\nTOTAL 1200\n\u{000c}\nSECOND");
        assert!(document
            .regions
            .iter()
            .any(|region| region.page_number == 2 && region.provenance == "TESSERACT_WORD"));
        assert!(document
            .regions
            .iter()
            .any(|region| region.text == "TOTAL" && region.provenance == "TESSERACT_LINE"));
    }

    #[test]
    fn keeps_blank_page_explicit_but_refuses_an_entirely_empty_document() {
        let useful = PageRecognition {
            page_number: 1,
            width_pixels: 100,
            height_pixels: 100,
            result: OcrResult {
                text: "TOTAL 100".to_owned(),
                words: vec![word("TOTAL", 1, 1, 1, 0.9), word("100", 1, 1, 35, 0.9)],
                mean_confidence: Some(0.9),
            },
        };
        let blank = PageRecognition {
            page_number: 2,
            width_pixels: 100,
            height_pixels: 100,
            result: OcrResult {
                text: String::new(),
                words: Vec::new(),
                mean_confidence: None,
            },
        };
        let document = build_document(vec![useful, blank]).unwrap();
        assert_eq!(document.pages[1].issues, vec!["NO_TEXT"]);
        assert!(document.issues.contains(&"OCR_EMPTY_PAGE"));

        let empty = PageRecognition {
            page_number: 1,
            width_pixels: 100,
            height_pixels: 100,
            result: OcrResult {
                text: String::new(),
                words: Vec::new(),
                mean_confidence: None,
            },
        };
        assert_eq!(
            build_document(vec![empty]).unwrap_err(),
            PdfOcrError::NoText
        );
    }

    #[test]
    fn rejects_regions_outside_the_rendered_page() {
        assert_eq!(
            validate_word_boxes(&[word("outside", 1, 1, 90, 0.9)], 100, 100),
            Err(PdfOcrError::Failed)
        );
    }

    #[cfg(unix)]
    #[test]
    fn recognizes_every_pdf_page_with_original_page_numbers_and_cleans_temp_files() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let engine = temp.path().join("fake-tesseract");
        std::fs::write(
            &engine,
            "#!/bin/sh\ncase \"$*\" in *--list-langs*) printf 'jpn\\neng\\n';; *) c=\"$0.count\"; n=0; test -f \"$c\" && n=$(cat \"$c\"); n=$((n+1)); printf '%s' \"$n\" > \"$c\"; printf 'level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n'; if test \"$n\" = 1; then printf '5\\t1\\t1\\t1\\t1\\t1\\t10\\t20\\t40\\t12\\t90\\tSTORE\\n5\\t1\\t1\\t1\\t2\\t1\\t10\\t40\\t40\\t12\\t90\\tTOTAL\\n5\\t1\\t1\\t1\\t2\\t2\\t55\\t40\\t35\\t12\\t90\\t1200\\n'; else printf '5\\t1\\t1\\t1\\t1\\t1\\t10\\t20\\t60\\t12\\t80\\tSECOND\\n'; fi;; esac\n",
        )
        .unwrap();
        std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
        let work = temp.path().join("work");
        let document = recognize_pdf(
            &blank_pdf(2),
            "application/pdf",
            None,
            &work,
            OcrConfig {
                executable: Some(engine),
                ..OcrConfig::default()
            },
        )
        .unwrap();
        assert_eq!(document.page_count, 2);
        assert!(document
            .regions
            .iter()
            .any(|region| region.page_number == 2 && region.text == "SECOND"));
        assert_eq!(std::fs::read_dir(work).unwrap().count(), 0);
    }

    #[test]
    fn rejects_a_pdf_over_the_ocr_page_limit_before_engine_discovery() {
        let temp = tempfile::tempdir().unwrap();
        let error = recognize_pdf(
            &blank_pdf(MAX_OCR_PAGES + 1),
            "application/pdf",
            None,
            temp.path(),
            OcrConfig {
                executable: Some(temp.path().join("missing-engine")),
                ..OcrConfig::default()
            },
        )
        .unwrap_err();
        assert_eq!(error, PdfOcrError::LimitExceeded);
    }
}
