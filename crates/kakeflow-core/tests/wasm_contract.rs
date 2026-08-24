use kakeflow_core::{derive_key_argon2id_bytes, validate_posting_json};

const VALID_POSTING_JSON: &str = r#"{
  "candidateId": "candidate-1",
  "transactionId": "transaction-1",
  "transactionType": "EXPENSE",
  "candidateAmountJpy": 1000,
  "approved": true,
  "entries": [
    {"id":"entry-debit","accountId":"expense","side":"DEBIT","amountJpy":1000},
    {"id":"entry-credit","accountId":"cash","side":"CREDIT","amountJpy":1000}
  ]
}"#;

#[test]
fn json_boundary_returns_the_serialized_core_validation() {
    let output = validate_posting_json(VALID_POSTING_JSON).unwrap();
    let validation: serde_json::Value = serde_json::from_str(&output).unwrap();

    assert_eq!(validation["valid"], true);
    assert_eq!(validation["codes"], serde_json::json!([]));
    assert_eq!(validation["debitTotalJpy"], 1_000);
    assert_eq!(validation["creditTotalJpy"], 1_000);
}

#[test]
fn json_boundary_rejects_malformed_input() {
    assert!(validate_posting_json(r#"{"approved":true}"#).is_err());
}

#[test]
fn argon2id_derivation_is_deterministic_salt_bound_and_32_bytes() {
    let first = derive_key_argon2id_bytes(
        b"correct horse battery staple",
        b"0123456789abcdef",
        64,
        2,
        1,
    )
    .unwrap();
    let repeated = derive_key_argon2id_bytes(
        b"correct horse battery staple",
        b"0123456789abcdef",
        64,
        2,
        1,
    )
    .unwrap();
    let other_salt = derive_key_argon2id_bytes(
        b"correct horse battery staple",
        b"fedcba9876543210",
        64,
        2,
        1,
    )
    .unwrap();

    assert_eq!(first.len(), 32);
    assert_eq!(first, repeated);
    assert_ne!(first, other_salt);
}

#[test]
fn argon2id_derivation_rejects_invalid_parameters() {
    assert!(derive_key_argon2id_bytes(b"passphrase", b"short", 64, 2, 1).is_err());
    assert!(derive_key_argon2id_bytes(b"passphrase", b"0123456789abcdef", 0, 2, 1).is_err());
}
