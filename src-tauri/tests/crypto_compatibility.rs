// Synthetic vectors generated with chacha20poly1305 0.10.1 and x25519-dalek 2.0.1.
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use x25519_dalek::{PublicKey, StaticSecret};

#[test]
fn decrypts_legacy_xchacha20_ciphertext_without_format_changes() {
    let key = [0x42u8; 32];
    let nonce = XNonce::from([0x24u8; 24]);
    let plaintext = b"synthetic KakeFlow compatibility fixture";
    let aad = b"KakeFlow/vault/compatibility/v1";
    let legacy_ciphertext = [
        214, 39, 185, 17, 6, 65, 56, 207, 193, 15, 116, 91, 101, 237, 75, 166, 93, 134, 174, 217,
        19, 114, 4, 252, 85, 8, 132, 36, 7, 121, 175, 180, 52, 247, 225, 160, 64, 238, 41, 249, 20,
        93, 78, 59, 185, 11, 211, 152, 247, 89, 245, 156, 231, 62, 76, 125,
    ];
    let cipher = XChaCha20Poly1305::new_from_slice(&key).unwrap();
    assert_eq!(
        cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: &legacy_ciphertext,
                    aad
                }
            )
            .unwrap(),
        plaintext
    );
    assert_eq!(
        cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: plaintext,
                    aad
                }
            )
            .unwrap(),
        legacy_ciphertext
    );
}

#[test]
fn preserves_legacy_x25519_identity_and_shared_secret() {
    let identity = StaticSecret::from([0x12u8; 32]);
    let peer = PublicKey::from(&StaticSecret::from([0x34u8; 32]));
    assert_eq!(
        PublicKey::from(&identity).as_bytes(),
        &[
            5, 42, 80, 119, 58, 200, 217, 23, 115, 242, 220, 150, 98, 225, 47, 13, 239, 233, 21,
            228, 21, 184, 161, 200, 226, 10, 90, 61, 106, 178, 184, 67
        ]
    );
    assert_eq!(
        identity.diffie_hellman(&peer).as_bytes(),
        &[
            22, 30, 133, 73, 7, 185, 2, 207, 14, 246, 69, 85, 69, 139, 63, 13, 134, 222, 148, 57,
            201, 234, 248, 89, 94, 164, 131, 79, 139, 77, 11, 15
        ]
    );
}
