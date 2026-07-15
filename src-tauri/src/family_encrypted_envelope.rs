//! End-to-end encryption envelope for audience-partitioned family artifacts.
//!
//! The relay-facing envelope encrypts one immutable family artifact once and
//! wraps its random content key independently for each explicitly addressed
//! device key. Routing metadata is authenticated as AEAD associated data; the
//! relay never needs a private key or plaintext access.

use std::collections::HashSet;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

const MAGIC: &[u8; 4] = b"KFE1";
const FORMAT: &str = "KAKEFLOW_ENCRYPTED_FAMILY_ENVELOPE";
const VERSION: u32 = 1;
const HEADER_LENGTH_BYTES: usize = 4;
const MAX_HEADER_BYTES: usize = 256 * 1024;
const MAX_RECIPIENTS: usize = 64;
const WRAPPED_KEY_BYTES: usize = 32 + 16;
const PAYLOAD_TAG_BYTES: usize = 16;
const KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 24;
const HKDF_SALT: &[u8] = b"KakeFlow/family-envelope/X25519-HKDF-SHA256/salt/v1";
const HKDF_INFO_PREFIX: &[u8] = b"KakeFlow/family-envelope/content-key-wrap/v1\0";

/// The relay limit applies to the complete encrypted envelope, not only the
/// inner family artifact.
pub const MAX_ENCRYPTED_FAMILY_ENVELOPE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum FamilyEnvelopeError {
    #[error("the encrypted family envelope input is invalid")]
    InvalidInput,
    #[error("the encrypted family envelope is malformed")]
    Malformed,
    #[error("the encrypted family envelope exceeds its byte limit")]
    SizeLimit,
    #[error("the recipient is not addressed by this envelope")]
    RecipientNotFound,
    #[error("the recipient key does not match the addressed public key")]
    RecipientKeyMismatch,
    #[error("the encrypted family envelope metadata does not match the expected artifact")]
    MetadataMismatch,
    #[error("the encrypted family envelope failed authentication")]
    AuthenticationFailed,
    #[error("secure random generation failed")]
    Random,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FamilyEnvelopeMetadata {
    pub household_id: String,
    pub publication_id: String,
    pub origin_installation_id: String,
    pub artifact_schema: String,
    pub inner_sha256: String,
}

impl FamilyEnvelopeMetadata {
    pub fn new(
        household_id: impl Into<String>,
        publication_id: impl Into<String>,
        origin_installation_id: impl Into<String>,
        artifact_schema: impl Into<String>,
        plaintext: &[u8],
    ) -> Self {
        Self {
            household_id: household_id.into(),
            publication_id: publication_id.into(),
            origin_installation_id: origin_installation_id.into(),
            artifact_schema: artifact_schema.into(),
            inner_sha256: sha256_hex(plaintext),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecipientPublicKey {
    pub recipient_id: String,
    pub public_key: [u8; KEY_BYTES],
}

pub struct RecipientKeyPair {
    recipient_id: String,
    private_key: Zeroizing<[u8; KEY_BYTES]>,
}

impl RecipientKeyPair {
    pub fn generate(recipient_id: impl Into<String>) -> Result<Self, FamilyEnvelopeError> {
        let recipient_id = recipient_id.into();
        validate_identifier(&recipient_id)?;
        let mut private_key = Zeroizing::new([0_u8; KEY_BYTES]);
        fill_random(private_key.as_mut())?;
        Ok(Self {
            recipient_id,
            private_key,
        })
    }

    pub fn from_private_bytes(
        recipient_id: impl Into<String>,
        private_key: [u8; KEY_BYTES],
    ) -> Result<Self, FamilyEnvelopeError> {
        let recipient_id = recipient_id.into();
        validate_identifier(&recipient_id)?;
        if private_key.iter().all(|byte| *byte == 0) {
            return Err(FamilyEnvelopeError::InvalidInput);
        }
        Ok(Self {
            recipient_id,
            private_key: Zeroizing::new(private_key),
        })
    }

    pub fn recipient_id(&self) -> &str {
        &self.recipient_id
    }

    pub fn public_key(&self) -> RecipientPublicKey {
        let secret = StaticSecret::from(*self.private_key);
        RecipientPublicKey {
            recipient_id: self.recipient_id.clone(),
            public_key: PublicKey::from(&secret).to_bytes(),
        }
    }

    /// Returns a zeroizing copy suitable for persistence in the OS credential
    /// store without exposing it through serialization or debug formatting.
    pub fn private_key_bytes(&self) -> Zeroizing<[u8; KEY_BYTES]> {
        Zeroizing::new(*self.private_key)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FamilyEnvelopeSummary {
    pub metadata: FamilyEnvelopeMetadata,
    pub recipient_ids: Vec<String>,
    pub plaintext_byte_size: u64,
    pub encrypted_byte_size: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireHeader {
    format: String,
    version: u32,
    metadata: FamilyEnvelopeMetadata,
    ephemeral_public_key: String,
    payload_nonce: String,
    plaintext_byte_size: u64,
    ciphertext_byte_size: u64,
    routing_sha256: String,
    recipients: Vec<WireRecipient>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireRecipient {
    recipient_id: String,
    public_key_sha256: String,
    wrap_nonce: String,
    wrapped_content_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoutingDescriptor<'a> {
    recipient_id: &'a str,
    public_key_sha256: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PayloadAad<'a> {
    format: &'static str,
    version: u32,
    metadata: &'a FamilyEnvelopeMetadata,
    ephemeral_public_key: &'a str,
    payload_nonce: &'a str,
    plaintext_byte_size: u64,
    routing_sha256: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WrapContext<'a> {
    format: &'static str,
    version: u32,
    metadata: &'a FamilyEnvelopeMetadata,
    ephemeral_public_key: &'a str,
    recipient_id: &'a str,
    public_key_sha256: &'a str,
    routing_sha256: &'a str,
}

pub fn seal_family_envelope(
    metadata: FamilyEnvelopeMetadata,
    plaintext: &[u8],
    recipients: &[RecipientPublicKey],
) -> Result<Vec<u8>, FamilyEnvelopeError> {
    seal_with_limit(
        metadata,
        plaintext,
        recipients,
        MAX_ENCRYPTED_FAMILY_ENVELOPE_BYTES,
    )
}

pub fn inspect_family_envelope(
    encoded: &[u8],
) -> Result<FamilyEnvelopeSummary, FamilyEnvelopeError> {
    let parsed = parse_envelope(encoded, MAX_ENCRYPTED_FAMILY_ENVELOPE_BYTES)?;
    Ok(FamilyEnvelopeSummary {
        metadata: parsed.header.metadata.clone(),
        recipient_ids: parsed
            .header
            .recipients
            .iter()
            .map(|recipient| recipient.recipient_id.clone())
            .collect(),
        plaintext_byte_size: parsed.header.plaintext_byte_size,
        encrypted_byte_size: encoded.len() as u64,
    })
}

pub fn open_family_envelope(
    encoded: &[u8],
    recipient: &RecipientKeyPair,
    expected_metadata: &FamilyEnvelopeMetadata,
) -> Result<Vec<u8>, FamilyEnvelopeError> {
    open_with_limit(
        encoded,
        recipient,
        expected_metadata,
        MAX_ENCRYPTED_FAMILY_ENVELOPE_BYTES,
    )
}

fn seal_with_limit(
    metadata: FamilyEnvelopeMetadata,
    plaintext: &[u8],
    recipients: &[RecipientPublicKey],
    max_bytes: usize,
) -> Result<Vec<u8>, FamilyEnvelopeError> {
    validate_metadata(&metadata)?;
    if plaintext.is_empty()
        || sha256_hex(plaintext) != metadata.inner_sha256
        || recipients.is_empty()
        || recipients.len() > MAX_RECIPIENTS
        || max_bytes < MAGIC.len() + HEADER_LENGTH_BYTES + PAYLOAD_TAG_BYTES + 1
        || plaintext.len() > max_bytes
    {
        return Err(if plaintext.len() > max_bytes {
            FamilyEnvelopeError::SizeLimit
        } else {
            FamilyEnvelopeError::InvalidInput
        });
    }

    let mut recipients = recipients.to_vec();
    recipients.sort_by(|left, right| left.recipient_id.cmp(&right.recipient_id));
    validate_recipients(&recipients)?;

    let mut ephemeral_bytes = Zeroizing::new([0_u8; KEY_BYTES]);
    fill_random(ephemeral_bytes.as_mut())?;
    let ephemeral_secret = StaticSecret::from(*ephemeral_bytes);
    let ephemeral_public = PublicKey::from(&ephemeral_secret);
    let ephemeral_public_key = encode_bytes(ephemeral_public.as_bytes());

    let route_descriptors = recipients
        .iter()
        .map(|recipient| (recipient, sha256_hex(&recipient.public_key)))
        .collect::<Vec<_>>();
    let routing_json = serde_json::to_vec(
        &route_descriptors
            .iter()
            .map(|(recipient, fingerprint)| RoutingDescriptor {
                recipient_id: &recipient.recipient_id,
                public_key_sha256: fingerprint,
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|_| FamilyEnvelopeError::InvalidInput)?;
    let routing_sha256 = sha256_hex(&routing_json);

    let mut payload_nonce_bytes = [0_u8; NONCE_BYTES];
    fill_random(&mut payload_nonce_bytes)?;
    let payload_nonce = encode_bytes(&payload_nonce_bytes);
    let payload_aad = payload_aad(
        &metadata,
        &ephemeral_public_key,
        &payload_nonce,
        plaintext.len() as u64,
        &routing_sha256,
    )?;

    let mut content_key = Zeroizing::new([0_u8; KEY_BYTES]);
    fill_random(content_key.as_mut())?;
    let payload_cipher = XChaCha20Poly1305::new_from_slice(content_key.as_ref())
        .map_err(|_| FamilyEnvelopeError::InvalidInput)?;
    let ciphertext = payload_cipher
        .encrypt(
            XNonce::from_slice(&payload_nonce_bytes),
            Payload {
                msg: plaintext,
                aad: &payload_aad,
            },
        )
        .map_err(|_| FamilyEnvelopeError::AuthenticationFailed)?;

    let wire_recipients = route_descriptors
        .iter()
        .map(|(recipient, fingerprint)| {
            let public = PublicKey::from(recipient.public_key);
            let shared = ephemeral_secret.diffie_hellman(&public);
            if !shared.was_contributory() {
                return Err(FamilyEnvelopeError::InvalidInput);
            }
            let context = wrap_context(
                &metadata,
                &ephemeral_public_key,
                &recipient.recipient_id,
                fingerprint,
                &routing_sha256,
            )?;
            let wrapping_key = derive_wrapping_key(shared.as_bytes(), &context)?;
            let mut wrap_nonce = [0_u8; NONCE_BYTES];
            fill_random(&mut wrap_nonce)?;
            let cipher = XChaCha20Poly1305::new_from_slice(wrapping_key.as_ref())
                .map_err(|_| FamilyEnvelopeError::InvalidInput)?;
            let wrapped = cipher
                .encrypt(
                    XNonce::from_slice(&wrap_nonce),
                    Payload {
                        msg: content_key.as_ref(),
                        aad: &context,
                    },
                )
                .map_err(|_| FamilyEnvelopeError::AuthenticationFailed)?;
            Ok(WireRecipient {
                recipient_id: recipient.recipient_id.clone(),
                public_key_sha256: fingerprint.clone(),
                wrap_nonce: encode_bytes(&wrap_nonce),
                wrapped_content_key: encode_bytes(&wrapped),
            })
        })
        .collect::<Result<Vec<_>, FamilyEnvelopeError>>()?;

    let header = WireHeader {
        format: FORMAT.to_owned(),
        version: VERSION,
        metadata,
        ephemeral_public_key,
        payload_nonce,
        plaintext_byte_size: plaintext.len() as u64,
        ciphertext_byte_size: ciphertext.len() as u64,
        routing_sha256,
        recipients: wire_recipients,
    };
    let header_bytes =
        serde_json::to_vec(&header).map_err(|_| FamilyEnvelopeError::InvalidInput)?;
    if header_bytes.len() > MAX_HEADER_BYTES || header_bytes.len() > u32::MAX as usize {
        return Err(FamilyEnvelopeError::SizeLimit);
    }
    let total = MAGIC
        .len()
        .checked_add(HEADER_LENGTH_BYTES)
        .and_then(|value| value.checked_add(header_bytes.len()))
        .and_then(|value| value.checked_add(ciphertext.len()))
        .ok_or(FamilyEnvelopeError::SizeLimit)?;
    if total > max_bytes {
        return Err(FamilyEnvelopeError::SizeLimit);
    }
    let mut encoded = Vec::with_capacity(total);
    encoded.extend_from_slice(MAGIC);
    encoded.extend_from_slice(&(header_bytes.len() as u32).to_be_bytes());
    encoded.extend_from_slice(&header_bytes);
    encoded.extend_from_slice(&ciphertext);
    Ok(encoded)
}

fn open_with_limit(
    encoded: &[u8],
    recipient: &RecipientKeyPair,
    expected_metadata: &FamilyEnvelopeMetadata,
    max_bytes: usize,
) -> Result<Vec<u8>, FamilyEnvelopeError> {
    let parsed = parse_envelope(encoded, max_bytes)?;
    if &parsed.header.metadata != expected_metadata {
        return Err(FamilyEnvelopeError::MetadataMismatch);
    }
    let slot = parsed
        .header
        .recipients
        .iter()
        .find(|slot| slot.recipient_id == recipient.recipient_id)
        .ok_or(FamilyEnvelopeError::RecipientNotFound)?;

    let recipient_public = recipient.public_key();
    if sha256_hex(&recipient_public.public_key) != slot.public_key_sha256 {
        return Err(FamilyEnvelopeError::RecipientKeyMismatch);
    }
    let ephemeral_public_bytes = decode_fixed::<KEY_BYTES>(&parsed.header.ephemeral_public_key)?;
    let ephemeral_public = PublicKey::from(ephemeral_public_bytes);
    let recipient_secret = StaticSecret::from(*recipient.private_key);
    let shared = recipient_secret.diffie_hellman(&ephemeral_public);
    if !shared.was_contributory() {
        return Err(FamilyEnvelopeError::AuthenticationFailed);
    }
    let context = wrap_context(
        &parsed.header.metadata,
        &parsed.header.ephemeral_public_key,
        &slot.recipient_id,
        &slot.public_key_sha256,
        &parsed.header.routing_sha256,
    )?;
    let wrapping_key = derive_wrapping_key(shared.as_bytes(), &context)?;
    let wrap_nonce = decode_fixed::<NONCE_BYTES>(&slot.wrap_nonce)?;
    let wrapped_key = decode_bytes(&slot.wrapped_content_key)?;
    if wrapped_key.len() != WRAPPED_KEY_BYTES {
        return Err(FamilyEnvelopeError::Malformed);
    }
    let wrap_cipher = XChaCha20Poly1305::new_from_slice(wrapping_key.as_ref())
        .map_err(|_| FamilyEnvelopeError::Malformed)?;
    let content_key = Zeroizing::new(
        wrap_cipher
            .decrypt(
                XNonce::from_slice(&wrap_nonce),
                Payload {
                    msg: &wrapped_key,
                    aad: &context,
                },
            )
            .map_err(|_| FamilyEnvelopeError::AuthenticationFailed)?,
    );
    if content_key.len() != KEY_BYTES {
        return Err(FamilyEnvelopeError::AuthenticationFailed);
    }
    let payload_nonce = decode_fixed::<NONCE_BYTES>(&parsed.header.payload_nonce)?;
    let aad = payload_aad(
        &parsed.header.metadata,
        &parsed.header.ephemeral_public_key,
        &parsed.header.payload_nonce,
        parsed.header.plaintext_byte_size,
        &parsed.header.routing_sha256,
    )?;
    let payload_cipher = XChaCha20Poly1305::new_from_slice(content_key.as_ref())
        .map_err(|_| FamilyEnvelopeError::Malformed)?;
    let plaintext = payload_cipher
        .decrypt(
            XNonce::from_slice(&payload_nonce),
            Payload {
                msg: parsed.ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| FamilyEnvelopeError::AuthenticationFailed)?;
    if plaintext.len() as u64 != parsed.header.plaintext_byte_size
        || sha256_hex(&plaintext) != parsed.header.metadata.inner_sha256
    {
        return Err(FamilyEnvelopeError::AuthenticationFailed);
    }
    Ok(plaintext)
}

struct ParsedEnvelope<'a> {
    header: WireHeader,
    ciphertext: &'a [u8],
}

fn parse_envelope(
    encoded: &[u8],
    max_bytes: usize,
) -> Result<ParsedEnvelope<'_>, FamilyEnvelopeError> {
    if encoded.len() > max_bytes {
        return Err(FamilyEnvelopeError::SizeLimit);
    }
    if encoded.len() < MAGIC.len() + HEADER_LENGTH_BYTES + PAYLOAD_TAG_BYTES + 1
        || &encoded[..MAGIC.len()] != MAGIC
    {
        return Err(FamilyEnvelopeError::Malformed);
    }
    let length_offset = MAGIC.len();
    let header_length = u32::from_be_bytes(
        encoded[length_offset..length_offset + HEADER_LENGTH_BYTES]
            .try_into()
            .map_err(|_| FamilyEnvelopeError::Malformed)?,
    ) as usize;
    if header_length == 0 || header_length > MAX_HEADER_BYTES {
        return Err(FamilyEnvelopeError::Malformed);
    }
    let header_start = length_offset + HEADER_LENGTH_BYTES;
    let header_end = header_start
        .checked_add(header_length)
        .ok_or(FamilyEnvelopeError::Malformed)?;
    if header_end >= encoded.len() {
        return Err(FamilyEnvelopeError::Malformed);
    }
    let header_bytes = &encoded[header_start..header_end];
    let header: WireHeader =
        serde_json::from_slice(header_bytes).map_err(|_| FamilyEnvelopeError::Malformed)?;
    if serde_json::to_vec(&header).map_err(|_| FamilyEnvelopeError::Malformed)? != header_bytes {
        return Err(FamilyEnvelopeError::Malformed);
    }
    validate_wire_header(&header)?;
    let ciphertext = &encoded[header_end..];
    if ciphertext.len() as u64 != header.ciphertext_byte_size
        || ciphertext.len() != header.plaintext_byte_size as usize + PAYLOAD_TAG_BYTES
    {
        return Err(FamilyEnvelopeError::Malformed);
    }
    Ok(ParsedEnvelope { header, ciphertext })
}

fn validate_wire_header(header: &WireHeader) -> Result<(), FamilyEnvelopeError> {
    if header.format != FORMAT
        || header.version != VERSION
        || header.plaintext_byte_size == 0
        || header.recipients.is_empty()
        || header.recipients.len() > MAX_RECIPIENTS
        || header.ciphertext_byte_size
            != header
                .plaintext_byte_size
                .checked_add(PAYLOAD_TAG_BYTES as u64)
                .ok_or(FamilyEnvelopeError::Malformed)?
    {
        return Err(FamilyEnvelopeError::Malformed);
    }
    validate_metadata(&header.metadata).map_err(|_| FamilyEnvelopeError::Malformed)?;
    decode_fixed::<KEY_BYTES>(&header.ephemeral_public_key)?;
    decode_fixed::<NONCE_BYTES>(&header.payload_nonce)?;
    validate_sha256(&header.routing_sha256).map_err(|_| FamilyEnvelopeError::Malformed)?;

    let mut previous: Option<&str> = None;
    let mut public_keys = HashSet::new();
    for slot in &header.recipients {
        validate_identifier(&slot.recipient_id).map_err(|_| FamilyEnvelopeError::Malformed)?;
        validate_sha256(&slot.public_key_sha256).map_err(|_| FamilyEnvelopeError::Malformed)?;
        decode_fixed::<NONCE_BYTES>(&slot.wrap_nonce)?;
        if decode_bytes(&slot.wrapped_content_key)?.len() != WRAPPED_KEY_BYTES
            || previous.is_some_and(|value| value >= slot.recipient_id.as_str())
            || !public_keys.insert(slot.public_key_sha256.as_str())
        {
            return Err(FamilyEnvelopeError::Malformed);
        }
        previous = Some(&slot.recipient_id);
    }
    let descriptors = header
        .recipients
        .iter()
        .map(|slot| RoutingDescriptor {
            recipient_id: &slot.recipient_id,
            public_key_sha256: &slot.public_key_sha256,
        })
        .collect::<Vec<_>>();
    let routing_json =
        serde_json::to_vec(&descriptors).map_err(|_| FamilyEnvelopeError::Malformed)?;
    if sha256_hex(&routing_json) != header.routing_sha256 {
        return Err(FamilyEnvelopeError::Malformed);
    }
    Ok(())
}

fn validate_metadata(metadata: &FamilyEnvelopeMetadata) -> Result<(), FamilyEnvelopeError> {
    validate_identifier(&metadata.household_id)?;
    validate_identifier(&metadata.publication_id)?;
    validate_identifier(&metadata.origin_installation_id)?;
    if !matches!(
        metadata.artifact_schema.as_str(),
        "FAMILY_AUDIENCE_PARTITION_V1"
            | "FAMILY_AUDIENCE_PARTITION_V2"
            | "FAMILY_AUDIENCE_PARTITION_V3"
            | "FAMILY_AUDIENCE_PARTITION_V4"
    ) {
        return Err(FamilyEnvelopeError::InvalidInput);
    }
    validate_sha256(&metadata.inner_sha256)
}

fn validate_recipients(recipients: &[RecipientPublicKey]) -> Result<(), FamilyEnvelopeError> {
    let mut ids = HashSet::new();
    let mut keys = HashSet::new();
    for recipient in recipients {
        validate_identifier(&recipient.recipient_id)?;
        if !ids.insert(recipient.recipient_id.as_str()) || !keys.insert(recipient.public_key) {
            return Err(FamilyEnvelopeError::InvalidInput);
        }
        let public = PublicKey::from(recipient.public_key);
        let probe = StaticSecret::from([0x42_u8; KEY_BYTES]);
        if !probe.diffie_hellman(&public).was_contributory() {
            return Err(FamilyEnvelopeError::InvalidInput);
        }
    }
    Ok(())
}

fn validate_identifier(value: &str) -> Result<(), FamilyEnvelopeError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(FamilyEnvelopeError::InvalidInput);
    }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<(), FamilyEnvelopeError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(FamilyEnvelopeError::InvalidInput);
    }
    Ok(())
}

fn payload_aad(
    metadata: &FamilyEnvelopeMetadata,
    ephemeral_public_key: &str,
    payload_nonce: &str,
    plaintext_byte_size: u64,
    routing_sha256: &str,
) -> Result<Vec<u8>, FamilyEnvelopeError> {
    serde_json::to_vec(&PayloadAad {
        format: FORMAT,
        version: VERSION,
        metadata,
        ephemeral_public_key,
        payload_nonce,
        plaintext_byte_size,
        routing_sha256,
    })
    .map_err(|_| FamilyEnvelopeError::InvalidInput)
}

fn wrap_context(
    metadata: &FamilyEnvelopeMetadata,
    ephemeral_public_key: &str,
    recipient_id: &str,
    public_key_sha256: &str,
    routing_sha256: &str,
) -> Result<Vec<u8>, FamilyEnvelopeError> {
    serde_json::to_vec(&WrapContext {
        format: FORMAT,
        version: VERSION,
        metadata,
        ephemeral_public_key,
        recipient_id,
        public_key_sha256,
        routing_sha256,
    })
    .map_err(|_| FamilyEnvelopeError::InvalidInput)
}

fn derive_wrapping_key(
    shared_secret: &[u8; KEY_BYTES],
    context: &[u8],
) -> Result<Zeroizing<[u8; KEY_BYTES]>, FamilyEnvelopeError> {
    let hkdf = Hkdf::<Sha256>::new(Some(HKDF_SALT), shared_secret);
    let mut info = Vec::with_capacity(HKDF_INFO_PREFIX.len() + context.len());
    info.extend_from_slice(HKDF_INFO_PREFIX);
    info.extend_from_slice(context);
    let mut key = Zeroizing::new([0_u8; KEY_BYTES]);
    hkdf.expand(&info, key.as_mut())
        .map_err(|_| FamilyEnvelopeError::InvalidInput)?;
    Ok(key)
}

fn fill_random(bytes: &mut [u8]) -> Result<(), FamilyEnvelopeError> {
    getrandom::getrandom(bytes).map_err(|_| FamilyEnvelopeError::Random)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn encode_bytes(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn decode_bytes(value: &str) -> Result<Vec<u8>, FamilyEnvelopeError> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| FamilyEnvelopeError::Malformed)
}

fn decode_fixed<const N: usize>(value: &str) -> Result<[u8; N], FamilyEnvelopeError> {
    decode_bytes(value)?
        .try_into()
        .map_err(|_| FamilyEnvelopeError::Malformed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(plaintext: &[u8]) -> FamilyEnvelopeMetadata {
        FamilyEnvelopeMetadata::new(
            "household-1",
            "publication-1",
            "installation-a",
            "FAMILY_AUDIENCE_PARTITION_V3",
            plaintext,
        )
    }

    #[test]
    fn round_trip_binds_metadata_and_exposes_only_routing_summary() {
        let recipient = RecipientKeyPair::generate("device-a").unwrap();
        let plaintext = b"KFF3 immutable family evidence bytes";
        let metadata = metadata(plaintext);
        let encoded =
            seal_family_envelope(metadata.clone(), plaintext, &[recipient.public_key()]).unwrap();

        let summary = inspect_family_envelope(&encoded).unwrap();
        assert_eq!(summary.metadata, metadata);
        assert_eq!(summary.recipient_ids, ["device-a"]);
        assert_eq!(summary.plaintext_byte_size, plaintext.len() as u64);
        assert_eq!(
            open_family_envelope(&encoded, &recipient, &metadata).unwrap(),
            plaintext
        );

        let mut wrong_metadata = metadata.clone();
        wrong_metadata.publication_id = "publication-2".into();
        assert_eq!(
            open_family_envelope(&encoded, &recipient, &wrong_metadata),
            Err(FamilyEnvelopeError::MetadataMismatch)
        );
    }

    #[test]
    fn metadata_accepts_family_v4_without_widening_to_unknown_versions() {
        let bytes = b"KFF4 recurring preferences and evidence";
        let v4 = FamilyEnvelopeMetadata::new(
            "household-1",
            "publication-v4",
            "installation-a",
            "FAMILY_AUDIENCE_PARTITION_V4",
            bytes,
        );
        assert_eq!(validate_metadata(&v4), Ok(()));
        let mut unknown = v4;
        unknown.artifact_schema = "FAMILY_AUDIENCE_PARTITION_V5".to_owned();
        assert_eq!(
            validate_metadata(&unknown),
            Err(FamilyEnvelopeError::InvalidInput)
        );
    }

    #[test]
    fn one_ciphertext_opens_for_each_explicit_recipient_only() {
        let alice = RecipientKeyPair::generate("device-alice").unwrap();
        let bob = RecipientKeyPair::generate("device-bob").unwrap();
        let outsider = RecipientKeyPair::generate("device-outsider").unwrap();
        let plaintext = b"shared partition";
        let metadata = metadata(plaintext);
        let encoded = seal_family_envelope(
            metadata.clone(),
            plaintext,
            &[bob.public_key(), alice.public_key()],
        )
        .unwrap();

        assert_eq!(
            inspect_family_envelope(&encoded).unwrap().recipient_ids,
            ["device-alice", "device-bob"]
        );
        assert_eq!(
            open_family_envelope(&encoded, &alice, &metadata).unwrap(),
            plaintext
        );
        assert_eq!(
            open_family_envelope(&encoded, &bob, &metadata).unwrap(),
            plaintext
        );
        assert_eq!(
            open_family_envelope(&encoded, &outsider, &metadata),
            Err(FamilyEnvelopeError::RecipientNotFound)
        );
    }

    #[test]
    fn same_recipient_id_with_wrong_private_key_is_rejected() {
        let intended = RecipientKeyPair::generate("device-a").unwrap();
        let impostor = RecipientKeyPair::generate("device-a").unwrap();
        let plaintext = b"personal partition";
        let metadata = metadata(plaintext);
        let encoded =
            seal_family_envelope(metadata.clone(), plaintext, &[intended.public_key()]).unwrap();
        assert_eq!(
            open_family_envelope(&encoded, &impostor, &metadata),
            Err(FamilyEnvelopeError::RecipientKeyMismatch)
        );
    }

    #[test]
    fn header_and_payload_tampering_are_rejected() {
        let recipient = RecipientKeyPair::generate("device-a").unwrap();
        let plaintext = b"authenticated artifact bytes";
        let metadata = metadata(plaintext);
        let encoded =
            seal_family_envelope(metadata.clone(), plaintext, &[recipient.public_key()]).unwrap();

        let mut payload_tamper = encoded.clone();
        *payload_tamper.last_mut().unwrap() ^= 0x01;
        assert_eq!(
            open_family_envelope(&payload_tamper, &recipient, &metadata),
            Err(FamilyEnvelopeError::AuthenticationFailed)
        );

        let mut header_tamper = encoded;
        let header_start = MAGIC.len() + HEADER_LENGTH_BYTES;
        let header_end = header_start
            + u32::from_be_bytes(header_tamper[MAGIC.len()..header_start].try_into().unwrap())
                as usize;
        let position = header_tamper[header_start..header_end]
            .windows("device-a".len())
            .position(|window| window == b"device-a")
            .unwrap()
            + header_start;
        header_tamper[position] = b'x';
        assert!(matches!(
            open_family_envelope(&header_tamper, &recipient, &metadata),
            Err(FamilyEnvelopeError::Malformed | FamilyEnvelopeError::RecipientNotFound)
        ));
    }

    #[test]
    fn key_rotation_affects_only_envelopes_created_after_rotation() {
        let old_key = RecipientKeyPair::generate("device-a").unwrap();
        let new_key = RecipientKeyPair::generate("device-a").unwrap();
        let first = b"before rotation";
        let second = b"after rotation";
        let first_metadata = metadata(first);
        let mut second_metadata = metadata(second);
        second_metadata.publication_id = "publication-2".into();
        let old_envelope =
            seal_family_envelope(first_metadata.clone(), first, &[old_key.public_key()]).unwrap();
        let new_envelope =
            seal_family_envelope(second_metadata.clone(), second, &[new_key.public_key()]).unwrap();

        assert_eq!(
            open_family_envelope(&old_envelope, &old_key, &first_metadata).unwrap(),
            first
        );
        assert_eq!(
            open_family_envelope(&new_envelope, &new_key, &second_metadata).unwrap(),
            second
        );
        assert_eq!(
            open_family_envelope(&new_envelope, &old_key, &second_metadata),
            Err(FamilyEnvelopeError::RecipientKeyMismatch)
        );
        assert_eq!(
            open_family_envelope(&old_envelope, &new_key, &first_metadata),
            Err(FamilyEnvelopeError::RecipientKeyMismatch)
        );
    }

    #[test]
    fn complete_envelope_must_fit_post_encryption_limit() {
        let recipient = RecipientKeyPair::generate("device-a").unwrap();
        let plaintext = vec![0x5a; 128];
        let metadata = metadata(&plaintext);
        let baseline = seal_with_limit(
            metadata.clone(),
            &plaintext,
            &[recipient.public_key()],
            16 * 1024,
        )
        .unwrap();
        assert_eq!(
            seal_with_limit(
                metadata.clone(),
                &plaintext,
                &[recipient.public_key()],
                baseline.len() - 1,
            ),
            Err(FamilyEnvelopeError::SizeLimit)
        );
        assert_eq!(
            open_with_limit(&baseline, &recipient, &metadata, baseline.len() - 1),
            Err(FamilyEnvelopeError::SizeLimit)
        );
        assert_eq!(
            open_with_limit(&baseline, &recipient, &metadata, baseline.len()).unwrap(),
            plaintext
        );
    }
}
