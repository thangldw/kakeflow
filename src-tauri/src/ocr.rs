//! Bounded, offline receipt OCR using an explicitly discovered Tesseract engine.
//!
//! The provider deliberately has no network fallback. Construction probes the
//! executable and requested language models, so callers can distinguish an
//! unavailable OCR feature from a failed recognition attempt.

use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const DEFAULT_MAX_INPUT_BYTES: u64 = 20 * 1024 * 1024;
const DEFAULT_MAX_PIXELS: u64 = 80_000_000;
const DEFAULT_MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_IMAGE_EDGE: u32 = 20_000;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum OcrError {
    #[error("OCR configuration is invalid")]
    InvalidConfig,
    #[error("the selected image cannot be read")]
    InputUnreadable,
    #[error("the selected file is not a supported PNG or JPEG image")]
    UnsupportedImage,
    #[error("the selected image exceeds the OCR size limit")]
    InputTooLarge,
    #[error("the selected image dimensions exceed the OCR safety limit")]
    ImageDimensionsTooLarge,
    #[error("the offline OCR engine is not installed")]
    EngineUnavailable,
    #[error("the offline OCR language models are not installed")]
    LanguageModelsUnavailable,
    #[error("offline OCR timed out")]
    TimedOut,
    #[error("offline OCR produced too much output")]
    OutputTooLarge,
    #[error("offline OCR failed")]
    EngineFailed,
    #[error("offline OCR returned invalid data")]
    InvalidOutput,
}

#[derive(Debug, Clone)]
pub struct OcrConfig {
    /// An application-bundled executable may be supplied here. When omitted,
    /// only the current process PATH is searched.
    pub executable: Option<PathBuf>,
    pub tessdata_dir: Option<PathBuf>,
    pub languages: Vec<String>,
    pub timeout: Duration,
    pub max_input_bytes: u64,
    pub max_pixels: u64,
    pub max_output_bytes: usize,
}

impl Default for OcrConfig {
    fn default() -> Self {
        Self {
            executable: None,
            tessdata_dir: None,
            languages: vec!["jpn".into(), "eng".into()],
            timeout: DEFAULT_TIMEOUT,
            max_input_bytes: DEFAULT_MAX_INPUT_BYTES,
            max_pixels: DEFAULT_MAX_PIXELS,
            max_output_bytes: DEFAULT_MAX_OUTPUT_BYTES,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrWord {
    pub text: String,
    /// Tesseract confidence normalized to 0.0..=1.0.
    pub confidence: f32,
    pub page: u32,
    pub block: u32,
    pub paragraph: u32,
    pub line: u32,
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub text: String,
    pub words: Vec<OcrWord>,
    pub mean_confidence: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct OfflineOcrProvider {
    executable: PathBuf,
    config: OcrConfig,
}

impl OfflineOcrProvider {
    /// Discovers Tesseract and verifies every requested model before reporting
    /// the provider as available.
    pub fn discover(config: OcrConfig) -> Result<Self, OcrError> {
        validate_config(&config)?;
        let executable = match &config.executable {
            Some(path) if path.is_file() => path.clone(),
            Some(_) => return Err(OcrError::EngineUnavailable),
            None => find_on_path(tesseract_program_name()).ok_or(OcrError::EngineUnavailable)?,
        };

        let mut args = Vec::<OsString>::new();
        if let Some(directory) = &config.tessdata_dir {
            if !directory.is_dir() {
                return Err(OcrError::LanguageModelsUnavailable);
            }
            args.push("--tessdata-dir".into());
            args.push(directory.as_os_str().to_owned());
        }
        args.push("--list-langs".into());
        let output = run_bounded(
            &executable,
            &args,
            config.timeout.min(Duration::from_secs(10)),
            256 * 1024,
        )?;
        if !output.success {
            return Err(OcrError::EngineUnavailable);
        }
        let listed = String::from_utf8(output.stdout).map_err(|_| OcrError::EngineFailed)?;
        let available: std::collections::HashSet<&str> = listed.lines().map(str::trim).collect();
        if !config
            .languages
            .iter()
            .all(|lang| available.contains(lang.as_str()))
        {
            return Err(OcrError::LanguageModelsUnavailable);
        }

        Ok(Self { executable, config })
    }

    pub fn recognize(&self, image_path: &Path) -> Result<OcrResult, OcrError> {
        self.recognize_with_timeout(image_path, self.config.timeout)
    }

    pub fn recognize_with_timeout(
        &self,
        image_path: &Path,
        timeout: Duration,
    ) -> Result<OcrResult, OcrError> {
        if timeout.is_zero() || timeout > self.config.timeout {
            return Err(OcrError::InvalidConfig);
        }
        validate_image(
            image_path,
            self.config.max_input_bytes,
            self.config.max_pixels,
        )?;

        let mut args = vec![
            image_path.as_os_str().to_owned(),
            OsString::from("stdout"),
            OsString::from("-l"),
            OsString::from(self.config.languages.join("+")),
        ];
        if let Some(directory) = &self.config.tessdata_dir {
            args.push("--tessdata-dir".into());
            args.push(directory.as_os_str().to_owned());
        }
        args.push("tsv".into());

        let output = run_bounded(
            &self.executable,
            &args,
            timeout,
            self.config.max_output_bytes,
        )?;
        if !output.success {
            return Err(OcrError::EngineFailed);
        }
        let tsv = String::from_utf8(output.stdout).map_err(|_| OcrError::InvalidOutput)?;
        parse_tsv(&tsv)
    }
}

fn validate_config(config: &OcrConfig) -> Result<(), OcrError> {
    let valid_language = |language: &str| {
        !language.is_empty()
            && language.len() <= 32
            && language
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    };
    if config.languages.is_empty()
        || config.languages.len() > 8
        || !config.languages.iter().all(|value| valid_language(value))
        || config.timeout.is_zero()
        || config.timeout > MAX_TIMEOUT
        || config.max_input_bytes == 0
        || config.max_pixels == 0
        || config.max_output_bytes == 0
    {
        return Err(OcrError::InvalidConfig);
    }
    Ok(())
}

fn validate_image(path: &Path, max_bytes: u64, max_pixels: u64) -> Result<(), OcrError> {
    let metadata = path.metadata().map_err(|_| OcrError::InputUnreadable)?;
    if !metadata.is_file() {
        return Err(OcrError::InputUnreadable);
    }
    if metadata.len() > max_bytes {
        return Err(OcrError::InputTooLarge);
    }
    let mut file = File::open(path).map_err(|_| OcrError::InputUnreadable)?;
    let (width, height) = read_image_dimensions(&mut file)?;
    if width == 0
        || height == 0
        || width > MAX_IMAGE_EDGE
        || height > MAX_IMAGE_EDGE
        || u64::from(width) * u64::from(height) > max_pixels
    {
        return Err(OcrError::ImageDimensionsTooLarge);
    }
    Ok(())
}

fn read_image_dimensions(reader: &mut File) -> Result<(u32, u32), OcrError> {
    let mut prefix = [0_u8; 24];
    reader
        .read_exact(&mut prefix)
        .map_err(|_| OcrError::UnsupportedImage)?;
    if prefix[..8] == [137, 80, 78, 71, 13, 10, 26, 10] && &prefix[12..16] == b"IHDR" {
        return Ok((
            u32::from_be_bytes(prefix[16..20].try_into().unwrap()),
            u32::from_be_bytes(prefix[20..24].try_into().unwrap()),
        ));
    }
    if prefix[0..2] != [0xff, 0xd8] {
        return Err(OcrError::UnsupportedImage);
    }

    // Restart from the first marker after SOI. JPEG segments are length-bounded,
    // and only a fixed two-byte buffer is allocated while scanning.
    use std::io::{Seek, SeekFrom};
    reader
        .seek(SeekFrom::Start(2))
        .map_err(|_| OcrError::UnsupportedImage)?;
    loop {
        let mut marker = [0_u8; 2];
        reader
            .read_exact(&mut marker)
            .map_err(|_| OcrError::UnsupportedImage)?;
        while marker[0] != 0xff {
            marker[0] = marker[1];
            reader
                .read_exact(&mut marker[1..2])
                .map_err(|_| OcrError::UnsupportedImage)?;
        }
        while marker[1] == 0xff {
            reader
                .read_exact(&mut marker[1..2])
                .map_err(|_| OcrError::UnsupportedImage)?;
        }
        let code = marker[1];
        if matches!(code, 0xd8 | 0xd9) || (0xd0..=0xd7).contains(&code) {
            continue;
        }
        let mut length_bytes = [0_u8; 2];
        reader
            .read_exact(&mut length_bytes)
            .map_err(|_| OcrError::UnsupportedImage)?;
        let length = u16::from_be_bytes(length_bytes);
        if length < 2 {
            return Err(OcrError::UnsupportedImage);
        }
        if matches!(code, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            if length < 7 {
                return Err(OcrError::UnsupportedImage);
            }
            let mut dimensions = [0_u8; 5];
            reader
                .read_exact(&mut dimensions)
                .map_err(|_| OcrError::UnsupportedImage)?;
            return Ok((
                u16::from_be_bytes([dimensions[3], dimensions[4]]).into(),
                u16::from_be_bytes([dimensions[1], dimensions[2]]).into(),
            ));
        }
        reader
            .seek(SeekFrom::Current(i64::from(length) - 2))
            .map_err(|_| OcrError::UnsupportedImage)?;
    }
}

pub fn parse_tsv(tsv: &str) -> Result<OcrResult, OcrError> {
    let mut words = Vec::new();
    for (index, row) in tsv.lines().enumerate() {
        if index == 0 && row.starts_with("level\t") {
            continue;
        }
        if row.trim().is_empty() {
            continue;
        }
        let columns: Vec<&str> = row.splitn(12, '\t').collect();
        if columns.len() != 12 {
            return Err(OcrError::InvalidOutput);
        }
        let level = parse_u32(columns[0])?;
        let confidence = columns[10]
            .parse::<f32>()
            .map_err(|_| OcrError::InvalidOutput)?;
        if level != 5 || confidence < 0.0 || columns[11].trim().is_empty() {
            continue;
        }
        if !confidence.is_finite() || confidence > 100.0 {
            return Err(OcrError::InvalidOutput);
        }
        words.push(OcrWord {
            text: columns[11].trim().to_owned(),
            confidence: confidence / 100.0,
            page: parse_u32(columns[1])?,
            block: parse_u32(columns[2])?,
            paragraph: parse_u32(columns[3])?,
            line: parse_u32(columns[4])?,
            left: parse_u32(columns[6])?,
            top: parse_u32(columns[7])?,
            width: parse_u32(columns[8])?,
            height: parse_u32(columns[9])?,
        });
    }
    let text = reconstruct_text(&words);
    let mean_confidence = if words.is_empty() {
        None
    } else {
        Some(words.iter().map(|word| word.confidence).sum::<f32>() / words.len() as f32)
    };
    Ok(OcrResult {
        text,
        words,
        mean_confidence,
    })
}

/// Rebuilds the reading order that Tesseract exposes in TSV instead of
/// flattening a receipt into one space-separated line. The hierarchy tuple is
/// also what downstream evidence uses to form line-level provenance regions.
pub fn reconstruct_text(words: &[OcrWord]) -> String {
    let mut text = String::new();
    let mut previous: Option<(u32, u32, u32, u32)> = None;
    for word in words {
        let key = (word.page, word.block, word.paragraph, word.line);
        if let Some(prior) = previous {
            if prior.0 != key.0 {
                text.push_str("\n\u{000c}\n");
            } else if prior != key {
                text.push('\n');
            } else {
                text.push(' ');
            }
        }
        text.push_str(&word.text);
        previous = Some(key);
    }
    text
}

fn parse_u32(value: &str) -> Result<u32, OcrError> {
    value.parse().map_err(|_| OcrError::InvalidOutput)
}

struct CommandOutput {
    success: bool,
    stdout: Vec<u8>,
}

fn run_bounded(
    executable: &Path,
    args: &[OsString],
    timeout: Duration,
    max_output_bytes: usize,
) -> Result<CommandOutput, OcrError> {
    let mut child = Command::new(executable)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| OcrError::EngineUnavailable)?;
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            kill_and_reap(&mut child);
            return Err(OcrError::EngineFailed);
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            drop(stdout);
            kill_and_reap(&mut child);
            return Err(OcrError::EngineFailed);
        }
    };
    let stdout_reader = thread::spawn(move || read_capped(stdout, max_output_bytes));
    let stderr_reader = thread::spawn(move || read_capped(stderr, max_output_bytes));

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                kill_and_reap(&mut child);
                // Do not join here: a hostile executable could leave a child
                // process holding an inherited pipe open. The bounded readers
                // own no secrets and will terminate when that pipe closes.
                return Err(OcrError::TimedOut);
            }
            Err(_) => {
                kill_and_reap(&mut child);
                return Err(OcrError::EngineFailed);
            }
        }
    };
    let stdout = stdout_reader.join().map_err(|_| OcrError::EngineFailed)??;
    let _stderr = stderr_reader.join().map_err(|_| OcrError::EngineFailed)??;
    Ok(CommandOutput {
        success: status.success(),
        stdout,
    })
}

fn kill_and_reap(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn read_capped(reader: impl Read, max_bytes: usize) -> Result<Vec<u8>, OcrError> {
    let take_limit = u64::try_from(max_bytes)
        .map_err(|_| OcrError::InvalidConfig)?
        .saturating_add(1);
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    reader
        .take(take_limit)
        .read_to_end(&mut bytes)
        .map_err(|_| OcrError::EngineFailed)?;
    if bytes.len() > max_bytes {
        return Err(OcrError::OutputTooLarge);
    }
    Ok(bytes)
}

fn find_on_path(program: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|directory| directory.join(program))
        .find(|candidate| candidate.is_file())
}

#[cfg(target_os = "windows")]
fn tesseract_program_name() -> &'static OsStr {
    OsStr::new("tesseract.exe")
}

#[cfg(not(target_os = "windows"))]
fn tesseract_program_name() -> &'static OsStr {
    OsStr::new("tesseract")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "kakeflow-ocr-{}-{}",
                std::process::id(),
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13];
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes
    }

    #[test]
    fn parses_word_rows_and_confidence() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
                   1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t\n\
                   5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t91.5\t合計\n\
                   5\t1\t1\t1\t1\t2\t45\t20\t25\t12\t88\t1000";
        let result = parse_tsv(tsv).unwrap();
        assert_eq!(result.text, "合計 1000");
        assert_eq!(result.words.len(), 2);
        assert!((result.mean_confidence.unwrap() - 0.8975).abs() < 0.0001);
        assert_eq!(result.words[0].left, 10);
    }

    #[test]
    fn preserves_tesseract_lines_and_pages_in_reading_order() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
                   5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t90\tSTORE\n\
                   5\t1\t1\t1\t2\t1\t10\t40\t30\t12\t80\tTOTAL\n\
                   5\t1\t1\t1\t2\t2\t45\t40\t25\t12\t70\t1200\n\
                   5\t2\t1\t1\t1\t1\t10\t20\t30\t12\t60\tSECOND";
        let result = parse_tsv(tsv).unwrap();
        assert_eq!(result.text, "STORE\nTOTAL 1200\n\u{000c}\nSECOND");
    }

    #[test]
    fn rejects_malformed_or_unbounded_confidence() {
        assert_eq!(parse_tsv("5\t1").unwrap_err(), OcrError::InvalidOutput);
        let invalid = "5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t101\tword";
        assert_eq!(parse_tsv(invalid).unwrap_err(), OcrError::InvalidOutput);
    }

    #[test]
    fn validates_magic_dimensions_and_pixel_limit() {
        let temp = TestDir::new();
        let image = temp.0.join("receipt.png");
        fs::write(&image, png_header(2_000, 3_000)).unwrap();
        assert!(validate_image(&image, 1024, 6_000_000).is_ok());
        assert_eq!(
            validate_image(&image, 1024, 5_999_999).unwrap_err(),
            OcrError::ImageDimensionsTooLarge
        );
        fs::write(&image, b"not an image").unwrap();
        assert_eq!(
            validate_image(&image, 1024, 6_000_000).unwrap_err(),
            OcrError::UnsupportedImage
        );
    }

    #[test]
    fn missing_explicit_engine_is_unavailable_without_fallback() {
        let config = OcrConfig {
            executable: Some(PathBuf::from("/definitely/not/a/tesseract/binary")),
            ..OcrConfig::default()
        };
        assert_eq!(
            OfflineOcrProvider::discover(config).unwrap_err(),
            OcrError::EngineUnavailable
        );
    }

    #[test]
    fn invalid_language_token_is_rejected_before_process_launch() {
        let config = OcrConfig {
            languages: vec!["jpn+../../secret".into()],
            ..OcrConfig::default()
        };
        assert_eq!(
            OfflineOcrProvider::discover(config).unwrap_err(),
            OcrError::InvalidConfig
        );
    }

    #[cfg(unix)]
    #[test]
    fn probes_models_then_recognizes_with_a_bounded_local_process() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TestDir::new();
        let engine = temp.0.join("fake-tesseract");
        fs::write(
            &engine,
            "#!/bin/sh\ncase \"$*\" in *--list-langs*) printf 'List of available languages (2):\\njpn\\neng\\n';; *) printf 'level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n5\\t1\\t1\\t1\\t1\\t1\\t1\\t2\\t3\\t4\\t90\\treceipt\\n';; esac\n",
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        let image = temp.0.join("receipt.png");
        fs::write(&image, png_header(100, 200)).unwrap();
        let provider = OfflineOcrProvider::discover(OcrConfig {
            executable: Some(engine),
            ..OcrConfig::default()
        })
        .unwrap();
        let result = provider.recognize(&image).unwrap();
        assert_eq!(result.text, "receipt");
        assert_eq!(result.mean_confidence, Some(0.9));
    }

    #[cfg(unix)]
    #[test]
    fn reports_missing_models_and_sanitizes_engine_details() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TestDir::new();
        let engine = temp.0.join("contains-private-user-path");
        fs::write(&engine, "#!/bin/sh\nprintf 'eng\\n'\n").unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        let error = OfflineOcrProvider::discover(OcrConfig {
            executable: Some(engine),
            ..OcrConfig::default()
        })
        .unwrap_err();
        assert_eq!(error, OcrError::LanguageModelsUnavailable);
        assert!(!error.to_string().contains("private"));
    }

    #[cfg(unix)]
    #[test]
    fn recognition_timeout_is_enforced() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TestDir::new();
        let engine = temp.0.join("slow-tesseract");
        fs::write(
            &engine,
            "#!/bin/sh\ncase \"$*\" in *--list-langs*) printf 'jpn\\neng\\n';; *) sleep 2;; esac\n",
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        let image = temp.0.join("receipt.png");
        fs::write(&image, png_header(100, 200)).unwrap();
        let mut provider = OfflineOcrProvider::discover(OcrConfig {
            executable: Some(engine),
            // Model discovery launches a separate process and can be delayed
            // by parallel CI load. Recognition receives the intentionally
            // tiny timeout below after discovery has completed.
            timeout: Duration::from_secs(2),
            ..OcrConfig::default()
        })
        .unwrap();
        provider.config.timeout = Duration::from_millis(50);
        assert_eq!(provider.recognize(&image).unwrap_err(), OcrError::TimedOut);
    }

    #[cfg(unix)]
    #[test]
    fn recognition_output_limit_is_enforced() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TestDir::new();
        let engine = temp.0.join("noisy-tesseract");
        fs::write(
            &engine,
            "#!/bin/sh\ncase \"$*\" in *--list-langs*) printf 'jpn\\neng\\n';; *) head -c 1024 /dev/zero;; esac\n",
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        let image = temp.0.join("receipt.png");
        fs::write(&image, png_header(100, 200)).unwrap();
        let provider = OfflineOcrProvider::discover(OcrConfig {
            executable: Some(engine),
            max_output_bytes: 64,
            ..OcrConfig::default()
        })
        .unwrap();
        assert_eq!(
            provider.recognize(&image).unwrap_err(),
            OcrError::OutputTooLarge
        );
    }
}
