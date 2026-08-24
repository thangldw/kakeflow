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
    assert_eq!(
        validation["canonicalHash"],
        "c190a870d36257f86f3e473bdfb77f085d5c21a171332025ff04460392ee484f"
    );
}

#[test]
fn json_boundary_rejects_malformed_input() {
    assert!(validate_posting_json(r#"{"approved":true}"#).is_err());
}

#[test]
fn argon2id_derivation_is_deterministic_salt_bound_and_32_bytes() {
    let salt = (0_u8..16).collect::<Vec<_>>();
    let other_salt = (16_u8..32).collect::<Vec<_>>();
    let first =
        derive_key_argon2id_bytes(b"correct horse battery staple", &salt, 64, 2, 1).unwrap();
    let repeated =
        derive_key_argon2id_bytes(b"correct horse battery staple", &salt, 64, 2, 1).unwrap();
    let other_salt =
        derive_key_argon2id_bytes(b"correct horse battery staple", &other_salt, 64, 2, 1).unwrap();

    assert_eq!(first.len(), 32);
    assert_eq!(first, repeated);
    assert_ne!(first, other_salt);
}

#[test]
fn argon2id_derivation_rejects_invalid_parameters() {
    let valid_salt = (0_u8..16).collect::<Vec<_>>();
    assert!(derive_key_argon2id_bytes(b"passphrase", b"short", 64, 2, 1).is_err());
    assert!(derive_key_argon2id_bytes(b"passphrase", &valid_salt, 0, 2, 1).is_err());
}
