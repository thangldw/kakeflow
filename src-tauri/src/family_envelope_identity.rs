//! OS-credential-backed device identity and IPC boundary for KFE1 envelopes.
//!
//! Only the X25519 public identity crosses IPC. The 32-byte private key is held
//! in zeroizing native state and is persisted exclusively through the platform
//! credential backend.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::Zeroizing;

use crate::{
    family_encrypted_envelope::{
        open_family_envelope, seal_family_envelope, FamilyEnvelopeError, FamilyEnvelopeMetadata,
        RecipientKeyPair, RecipientPublicKey,
    },
    key_store::{KeyStoreError, OsDatabaseKeyProvider},
};

const CREDENTIAL_ACCOUNT: &str = "family-envelope-x25519-private-key-v1";
const KEY_BYTES: usize = 32;
const GENERATION: u32 = 1;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum FamilyEnvelopeIdentityError {
    #[error("the family encryption identity is unavailable")]
    Credential,
    #[error("the family encryption request is invalid")]
    InvalidInput,
    #[error("the family artifact could not be encrypted")]
    Seal,
    #[error("the family artifact could not be decrypted")]
    Open,
}

impl From<KeyStoreError> for FamilyEnvelopeIdentityError {
    fn from(_: KeyStoreError) -> Self {
        Self::Credential
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyEnvelopePublicIdentityDto {
    pub key_id: String,
    pub public_key: String,
    pub generation: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FamilyEnvelopeRecipientDto {
    pub membership_id: String,
    pub key_id: String,
    pub public_key: String,
    pub generation: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SealFamilyEnvelopeInput {
    pub metadata: FamilyEnvelopeMetadata,
    pub artifact_bytes: Vec<u8>,
    pub recipients: Vec<FamilyEnvelopeRecipientDto>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SealFamilyEnvelopeOutput {
    pub envelope_bytes: Vec<u8>,
    pub envelope_sha256: String,
    pub envelope_byte_size: u64,
    pub recipient_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenFamilyEnvelopeInput {
    pub expected_metadata: FamilyEnvelopeMetadata,
    pub envelope_bytes: Vec<u8>,
    pub local_membership_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFamilyEnvelopeOutput {
    pub artifact_bytes: Vec<u8>,
    pub artifact_sha256: String,
    pub artifact_byte_size: u64,
}

pub struct FamilyEnvelopeIdentityState {
    private_key: Zeroizing<[u8; KEY_BYTES]>,
    public_identity: FamilyEnvelopePublicIdentityDto,
}

impl FamilyEnvelopeIdentityState {
    /// Loads or creates the identity in macOS Keychain or Windows Credential
    /// Manager. No private material is cached by the credential provider.
    pub fn load_or_create_os() -> Result<Self, FamilyEnvelopeIdentityError> {
        let key = OsDatabaseKeyProvider::new_for_account(CREDENTIAL_ACCOUNT)?.key()?;
        let private_key: [u8; KEY_BYTES] = key
            .as_slice()
            .try_into()
            .map_err(|_| FamilyEnvelopeIdentityError::Credential)?;
        Self::from_private_key(private_key)
    }

    /// Injection point for deterministic functional tests and packaged smoke.
    pub fn from_private_key(
        private_key: [u8; KEY_BYTES],
    ) -> Result<Self, FamilyEnvelopeIdentityError> {
        let key_pair = RecipientKeyPair::from_private_bytes("identity", private_key)
            .map_err(|_| FamilyEnvelopeIdentityError::InvalidInput)?;
        let public_key = key_pair.public_key().public_key;
        let public_identity = FamilyEnvelopePublicIdentityDto {
            key_id: sha256_hex(&public_key),
            public_key: URL_SAFE_NO_PAD.encode(public_key),
            generation: GENERATION,
        };
        Ok(Self {
            private_key: Zeroizing::new(private_key),
            public_identity,
        })
    }

    pub fn public_identity(&self) -> FamilyEnvelopePublicIdentityDto {
        self.public_identity.clone()
    }

    pub fn seal(
        &self,
        input: SealFamilyEnvelopeInput,
    ) -> Result<SealFamilyEnvelopeOutput, FamilyEnvelopeIdentityError> {
        if input.recipients.is_empty() || input.recipients.len() > u32::MAX as usize {
            return Err(FamilyEnvelopeIdentityError::InvalidInput);
        }
        let recipients = input
            .recipients
            .iter()
            .map(parse_recipient)
            .collect::<Result<Vec<_>, _>>()?;
        let recipient_count = recipients.len() as u32;
        let envelope_bytes =
            seal_family_envelope(input.metadata, &input.artifact_bytes, &recipients)
                .map_err(map_seal_error)?;
        Ok(SealFamilyEnvelopeOutput {
            envelope_sha256: sha256_hex(&envelope_bytes),
            envelope_byte_size: envelope_bytes.len() as u64,
            envelope_bytes,
            recipient_count,
        })
    }

    pub fn open(
        &self,
        input: OpenFamilyEnvelopeInput,
    ) -> Result<OpenFamilyEnvelopeOutput, FamilyEnvelopeIdentityError> {
        let key_pair =
            RecipientKeyPair::from_private_bytes(input.local_membership_id, *self.private_key)
                .map_err(|_| FamilyEnvelopeIdentityError::InvalidInput)?;
        let artifact_bytes =
            open_family_envelope(&input.envelope_bytes, &key_pair, &input.expected_metadata)
                .map_err(map_open_error)?;
        Ok(OpenFamilyEnvelopeOutput {
            artifact_sha256: sha256_hex(&artifact_bytes),
            artifact_byte_size: artifact_bytes.len() as u64,
            artifact_bytes,
        })
    }
}

fn parse_recipient(
    recipient: &FamilyEnvelopeRecipientDto,
) -> Result<RecipientPublicKey, FamilyEnvelopeIdentityError> {
    if recipient.generation != GENERATION {
        return Err(FamilyEnvelopeIdentityError::InvalidInput);
    }
    let public_key: [u8; KEY_BYTES] = URL_SAFE_NO_PAD
        .decode(&recipient.public_key)
        .map_err(|_| FamilyEnvelopeIdentityError::InvalidInput)?
        .try_into()
        .map_err(|_| FamilyEnvelopeIdentityError::InvalidInput)?;
    if sha256_hex(&public_key) != recipient.key_id {
        return Err(FamilyEnvelopeIdentityError::InvalidInput);
    }
    Ok(RecipientPublicKey {
        recipient_id: recipient.membership_id.clone(),
        public_key,
    })
}

fn map_seal_error(error: FamilyEnvelopeError) -> FamilyEnvelopeIdentityError {
    match error {
        FamilyEnvelopeError::InvalidInput | FamilyEnvelopeError::SizeLimit => {
            FamilyEnvelopeIdentityError::InvalidInput
        }
        _ => FamilyEnvelopeIdentityError::Seal,
    }
}

fn map_open_error(error: FamilyEnvelopeError) -> FamilyEnvelopeIdentityError {
    match error {
        FamilyEnvelopeError::InvalidInput | FamilyEnvelopeError::SizeLimit => {
            FamilyEnvelopeIdentityError::InvalidInput
        }
        _ => FamilyEnvelopeIdentityError::Open,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[tauri::command]
pub fn family_envelope_identity_get(
    state: tauri::State<'_, FamilyEnvelopeIdentityState>,
) -> FamilyEnvelopePublicIdentityDto {
    state.public_identity()
}

#[tauri::command]
pub fn family_envelope_seal(
    state: tauri::State<'_, FamilyEnvelopeIdentityState>,
    input: SealFamilyEnvelopeInput,
) -> Result<SealFamilyEnvelopeOutput, String> {
    state.seal(input).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn family_envelope_open(
    state: tauri::State<'_, FamilyEnvelopeIdentityState>,
    input: OpenFamilyEnvelopeInput,
) -> Result<OpenFamilyEnvelopeOutput, String> {
    state.open(input).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(bytes: &[u8]) -> FamilyEnvelopeMetadata {
        FamilyEnvelopeMetadata::new(
            "household-1",
            "publication-1",
            "installation-a",
            "FAMILY_AUDIENCE_PARTITION_V3",
            bytes,
        )
    }

    fn recipient(
        membership_id: &str,
        state: &FamilyEnvelopeIdentityState,
    ) -> FamilyEnvelopeRecipientDto {
        let identity = state.public_identity();
        FamilyEnvelopeRecipientDto {
            membership_id: membership_id.into(),
            key_id: identity.key_id,
            public_key: identity.public_key,
            generation: identity.generation,
        }
    }

    #[test]
    fn injected_private_key_produces_stable_public_only_identity() {
        let state = FamilyEnvelopeIdentityState::from_private_key([0x21; 32]).unwrap();
        let first = state.public_identity();
        let second = FamilyEnvelopeIdentityState::from_private_key([0x21; 32])
            .unwrap()
            .public_identity();

        assert_eq!(first, second);
        assert_eq!(first.generation, 1);
        assert_eq!(first.key_id.len(), 64);
        assert_eq!(URL_SAFE_NO_PAD.decode(&first.public_key).unwrap().len(), 32);
        let serialized = serde_json::to_string(&first).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&serialized).unwrap()["generation"],
            1
        );
        assert!(!serialized.contains(&URL_SAFE_NO_PAD.encode([0x21; 32])));
    }

    #[test]
    fn native_states_seal_for_memberships_and_open_with_local_private_keys() {
        let alice = FamilyEnvelopeIdentityState::from_private_key([0x31; 32]).unwrap();
        let bob = FamilyEnvelopeIdentityState::from_private_key([0x32; 32]).unwrap();
        let bytes = b"KFF3 evidence partition".to_vec();
        let metadata = metadata(&bytes);
        let sealed = alice
            .seal(SealFamilyEnvelopeInput {
                metadata: metadata.clone(),
                artifact_bytes: bytes.clone(),
                recipients: vec![
                    recipient("member-alice", &alice),
                    recipient("member-bob", &bob),
                ],
            })
            .unwrap();

        assert_eq!(sealed.recipient_count, 2);
        assert_eq!(sealed.envelope_sha256, sha256_hex(&sealed.envelope_bytes));
        for (state, membership_id) in [(&alice, "member-alice"), (&bob, "member-bob")] {
            let opened = state
                .open(OpenFamilyEnvelopeInput {
                    expected_metadata: metadata.clone(),
                    envelope_bytes: sealed.envelope_bytes.clone(),
                    local_membership_id: membership_id.into(),
                })
                .unwrap();
            assert_eq!(opened.artifact_bytes, bytes);
            assert_eq!(opened.artifact_sha256, metadata.inner_sha256);
        }
    }

    #[test]
    fn recipient_key_id_and_generation_are_validated_before_sealing() {
        let state = FamilyEnvelopeIdentityState::from_private_key([0x41; 32]).unwrap();
        let bytes = b"artifact".to_vec();
        let metadata = metadata(&bytes);
        let mut invalid = recipient("member-a", &state);
        invalid.key_id = "0".repeat(64);
        let request = |recipient| SealFamilyEnvelopeInput {
            metadata: metadata.clone(),
            artifact_bytes: bytes.clone(),
            recipients: vec![recipient],
        };

        assert_eq!(
            state.seal(request(invalid)),
            Err(FamilyEnvelopeIdentityError::InvalidInput)
        );
        let mut future = recipient("member-a", &state);
        future.generation = 2;
        assert_eq!(
            state.seal(request(future)),
            Err(FamilyEnvelopeIdentityError::InvalidInput)
        );
    }

    #[test]
    fn open_requires_the_addressed_membership_and_exact_expected_metadata() {
        let state = FamilyEnvelopeIdentityState::from_private_key([0x51; 32]).unwrap();
        let bytes = b"artifact".to_vec();
        let metadata = metadata(&bytes);
        let sealed = state
            .seal(SealFamilyEnvelopeInput {
                metadata: metadata.clone(),
                artifact_bytes: bytes,
                recipients: vec![recipient("member-a", &state)],
            })
            .unwrap();

        assert_eq!(
            state.open(OpenFamilyEnvelopeInput {
                expected_metadata: metadata.clone(),
                envelope_bytes: sealed.envelope_bytes.clone(),
                local_membership_id: "member-b".into(),
            }),
            Err(FamilyEnvelopeIdentityError::Open)
        );
        let mut wrong_metadata = metadata;
        wrong_metadata.publication_id = "publication-other".into();
        assert_eq!(
            state.open(OpenFamilyEnvelopeInput {
                expected_metadata: wrong_metadata,
                envelope_bytes: sealed.envelope_bytes,
                local_membership_id: "member-a".into(),
            }),
            Err(FamilyEnvelopeIdentityError::Open)
        );
    }
}
