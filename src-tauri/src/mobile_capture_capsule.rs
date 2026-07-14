//! Versioned mobile receipt-capture capsule.
//!
//! A capsule carries one immutable PNG/JPEG original and capture metadata. It
//! deliberately contains no OCR output, classification, account choice, or
//! ledger decision.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

const MAGIC: &[u8] = b"KAKEFLOW_MOBILE_RECEIPT_CAPTURE_V1\n";
const MAX_MANIFEST_BYTES: usize = 16 * 1024;
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_EDGE: u32 = 20_000;
const MAX_PIXELS: u64 = 80_000_000;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum CapsuleError {
    #[error("mobile capture capsule is invalid")]
    Invalid,
    #[error("mobile capture capsule exceeds supported limits")]
    LimitExceeded,
    #[error("mobile capture image is unsupported")]
    UnsupportedImage,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureAudienceManifest {
    pub visibility: String,
    pub member_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MobileCaptureManifest {
    pub format: String,
    pub schema_version: u32,
    pub capture_id: String,
    pub household_id: String,
    pub origin_device_id: String,
    pub captured_at: String,
    pub original_filename: String,
    pub media_type: String,
    pub image_byte_size: u64,
    pub image_sha256: String,
    pub audience: CaptureAudienceManifest,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedMobileCapture {
    pub manifest: MobileCaptureManifest,
    pub image_bytes: Vec<u8>,
    pub capsule_sha256: String,
}

pub fn build(manifest: &MobileCaptureManifest, image: &[u8]) -> Result<Vec<u8>, CapsuleError> {
    validate(manifest, image)?;
    let encoded = serde_json::to_vec(manifest).map_err(|_| CapsuleError::Invalid)?;
    if encoded.len() > MAX_MANIFEST_BYTES {
        return Err(CapsuleError::LimitExceeded);
    }
    let manifest_len = u32::try_from(encoded.len()).map_err(|_| CapsuleError::LimitExceeded)?;
    let mut output = Vec::with_capacity(MAGIC.len() + 4 + encoded.len() + image.len());
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&manifest_len.to_be_bytes());
    output.extend_from_slice(&encoded);
    output.extend_from_slice(image);
    Ok(output)
}

pub fn parse(bytes: &[u8]) -> Result<ParsedMobileCapture, CapsuleError> {
    let prefix_len = MAGIC.len() + 4;
    if bytes.len() <= prefix_len || bytes.len() > prefix_len + MAX_MANIFEST_BYTES + MAX_IMAGE_BYTES
    {
        return Err(CapsuleError::LimitExceeded);
    }
    if !bytes.starts_with(MAGIC) {
        return Err(CapsuleError::Invalid);
    }
    let manifest_len =
        u32::from_be_bytes(bytes[MAGIC.len()..prefix_len].try_into().unwrap()) as usize;
    if manifest_len == 0
        || manifest_len > MAX_MANIFEST_BYTES
        || prefix_len + manifest_len >= bytes.len()
    {
        return Err(CapsuleError::Invalid);
    }
    let manifest: MobileCaptureManifest =
        serde_json::from_slice(&bytes[prefix_len..prefix_len + manifest_len])
            .map_err(|_| CapsuleError::Invalid)?;
    let image = &bytes[prefix_len + manifest_len..];
    validate(&manifest, image)?;
    Ok(ParsedMobileCapture {
        manifest,
        image_bytes: image.to_vec(),
        capsule_sha256: digest(bytes),
    })
}

fn validate(manifest: &MobileCaptureManifest, image: &[u8]) -> Result<(), CapsuleError> {
    if manifest.format != "KAKEFLOW_MOBILE_RECEIPT_CAPTURE"
        || manifest.schema_version != 1
        || !valid_id(&manifest.capture_id, 128)
        || !valid_id(&manifest.household_id, 128)
        || !valid_id(&manifest.origin_device_id, 128)
        || !valid_timestamp(&manifest.captured_at)
        || !valid_filename(&manifest.original_filename)
        || !valid_hash(&manifest.image_sha256)
        || manifest.image_byte_size != image.len() as u64
        || manifest.image_sha256 != digest(image)
        || !matches!(manifest.audience.visibility.as_str(), "SHARED" | "PERSONAL")
        || (manifest.audience.visibility == "SHARED") != manifest.audience.member_id.is_none()
        || manifest
            .audience
            .member_id
            .as_deref()
            .is_some_and(|id| !valid_id(id, 128))
        || image.is_empty()
        || image.len() > MAX_IMAGE_BYTES
    {
        return Err(CapsuleError::Invalid);
    }
    let (width, height, detected) = image_dimensions(image)?;
    if detected != manifest.media_type {
        return Err(CapsuleError::UnsupportedImage);
    }
    if width == 0
        || height == 0
        || width > MAX_EDGE
        || height > MAX_EDGE
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(CapsuleError::LimitExceeded);
    }
    Ok(())
}

fn image_dimensions(bytes: &[u8]) -> Result<(u32, u32, &'static str), CapsuleError> {
    if bytes.len() >= 24
        && bytes[..8] == [137, 80, 78, 71, 13, 10, 26, 10]
        && &bytes[12..16] == b"IHDR"
    {
        return Ok((
            u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
            u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
            "image/png",
        ));
    }
    if bytes.len() < 4 || bytes[..2] != [0xff, 0xd8] {
        return Err(CapsuleError::UnsupportedImage);
    }
    let mut offset = 2usize;
    while offset + 4 <= bytes.len() {
        while offset < bytes.len() && bytes[offset] != 0xff {
            offset += 1;
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        if offset >= bytes.len() {
            break;
        }
        let code = bytes[offset];
        offset += 1;
        if matches!(code, 0xd8 | 0xd9) || (0xd0..=0xd7).contains(&code) {
            continue;
        }
        if offset + 2 > bytes.len() {
            break;
        }
        let length = u16::from_be_bytes([bytes[offset], bytes[offset + 1]]) as usize;
        if length < 2 || offset + length > bytes.len() {
            return Err(CapsuleError::UnsupportedImage);
        }
        if matches!(code, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            if length < 7 {
                return Err(CapsuleError::UnsupportedImage);
            }
            return Ok((
                u16::from_be_bytes([bytes[offset + 5], bytes[offset + 6]]) as u32,
                u16::from_be_bytes([bytes[offset + 3], bytes[offset + 4]]) as u32,
                "image/jpeg",
            ));
        }
        offset += length;
    }
    Err(CapsuleError::UnsupportedImage)
}

fn valid_id(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
fn valid_filename(value: &str) -> bool {
    valid_id(value, 255) && !value.contains('/') && !value.contains('\\')
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn valid_timestamp(value: &str) -> bool {
    value.len() >= 20
        && value.len() <= 35
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value.as_bytes().get(10) == Some(&b'T')
        && (value.ends_with('Z')
            || matches!(
                value.as_bytes().get(value.len().saturating_sub(6)),
                Some(b'+' | b'-')
            ))
        && !value.chars().any(char::is_control)
}
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut value = vec![
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, b'I', b'H', b'D', b'R',
        ];
        value.extend_from_slice(&width.to_be_bytes());
        value.extend_from_slice(&height.to_be_bytes());
        value.extend_from_slice(&[8, 2, 0, 0, 0]);
        value
    }
    fn manifest(image: &[u8]) -> MobileCaptureManifest {
        MobileCaptureManifest {
            format: "KAKEFLOW_MOBILE_RECEIPT_CAPTURE".into(),
            schema_version: 1,
            capture_id: "capture-1".into(),
            household_id: "family".into(),
            origin_device_id: "mobile-1".into(),
            captured_at: "2026-07-14T11:59:00+09:00".into(),
            original_filename: "receipt.png".into(),
            media_type: "image/png".into(),
            image_byte_size: image.len() as u64,
            image_sha256: digest(image),
            audience: CaptureAudienceManifest {
                visibility: "SHARED".into(),
                member_id: None,
            },
        }
    }
    #[test]
    fn round_trips_exact_image() {
        let image = png(100, 200);
        let encoded = build(&manifest(&image), &image).unwrap();
        let parsed = parse(&encoded).unwrap();
        assert_eq!(parsed.image_bytes, image);
        assert_eq!(parsed.capsule_sha256, digest(&encoded));
    }
    #[test]
    fn rejects_unknown_manifest_fields_and_tampering() {
        let image = png(1, 1);
        let mut encoded = build(&manifest(&image), &image).unwrap();
        *encoded.last_mut().unwrap() ^= 1;
        assert_eq!(parse(&encoded).unwrap_err(), CapsuleError::Invalid);
        let raw=br#"{"format":"KAKEFLOW_MOBILE_RECEIPT_CAPTURE","schemaVersion":1,"captureId":"x","extra":1}"#;
        let mut unknown = MAGIC.to_vec();
        unknown.extend_from_slice(&(raw.len() as u32).to_be_bytes());
        unknown.extend_from_slice(raw);
        unknown.extend_from_slice(&image);
        assert_eq!(parse(&unknown).unwrap_err(), CapsuleError::Invalid);
    }
    #[test]
    fn rejects_media_mismatch_and_pixel_bomb() {
        let image = png(20_001, 1);
        assert_eq!(
            build(&manifest(&image), &image).unwrap_err(),
            CapsuleError::LimitExceeded
        );
        let image = png(1, 1);
        let mut m = manifest(&image);
        m.media_type = "image/jpeg".into();
        assert_eq!(
            build(&m, &image).unwrap_err(),
            CapsuleError::UnsupportedImage
        );
    }
}
