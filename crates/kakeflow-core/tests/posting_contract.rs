use kakeflow_core::{
    canonical_posting_hash, canonical_posting_json, validate_posting, EntrySide, PostingEntry,
    PostingInput, ValidationCode,
};

fn valid_posting() -> PostingInput {
    PostingInput {
        candidate_id: "candidate-1".into(),
        transaction_id: "transaction-1".into(),
        transaction_type: "EXPENSE".into(),
        candidate_amount_jpy: 1_000,
        approved: true,
        entries: vec![
            PostingEntry {
                id: "entry-debit".into(),
                account_id: "expense".into(),
                side: EntrySide::Debit,
                amount_jpy: 1_000,
            },
            PostingEntry {
                id: "entry-credit".into(),
                account_id: "cash".into(),
                side: EntrySide::Credit,
                amount_jpy: 1_000,
            },
        ],
    }
}

fn assert_invalid_with(input: &PostingInput, code: ValidationCode) {
    let validation = validate_posting(input);
    assert!(!validation.valid);
    assert!(validation.codes.contains(&code), "{validation:?}");
}

#[test]
fn accepts_an_explicitly_approved_balanced_posting() {
    let validation = validate_posting(&valid_posting());

    assert!(validation.valid);
    assert!(validation.codes.is_empty());
    assert_eq!(validation.debit_total_jpy, 1_000);
    assert_eq!(validation.credit_total_jpy, 1_000);
}

#[test]
fn rejects_missing_approval() {
    let mut input = valid_posting();
    input.approved = false;

    assert_invalid_with(&input, ValidationCode::ApprovalRequired);
}

#[test]
fn rejects_unbalanced_journal() {
    let mut input = valid_posting();
    input.entries[1].amount_jpy = 999;

    assert_invalid_with(&input, ValidationCode::UnbalancedJournal);
}

#[test]
fn rejects_duplicate_entry_id() {
    let mut input = valid_posting();
    input.entries[1].id = input.entries[0].id.clone();

    assert_invalid_with(&input, ValidationCode::DuplicateEntryId);
}

#[test]
fn rejects_unsupported_transaction_type() {
    let mut input = valid_posting();
    input.transaction_type = "CRYPTO_STAKE".into();

    assert_invalid_with(&input, ValidationCode::UnsupportedTransactionType);
}

#[test]
fn rejects_control_character_in_id() {
    let mut input = valid_posting();
    input.entries[0].account_id = "expense\naccount".into();

    assert_invalid_with(&input, ValidationCode::InvalidIdentifier);
}

#[test]
fn rejects_zero_entry_amount() {
    let mut input = valid_posting();
    input.entries[0].amount_jpy = 0;

    assert_invalid_with(&input, ValidationCode::NonPositiveAmount);
}

#[test]
fn rejects_candidate_total_mismatch() {
    let mut input = valid_posting();
    input.candidate_amount_jpy = 1_001;

    assert_invalid_with(&input, ValidationCode::CandidateAmountMismatch);
}

#[test]
fn canonical_form_is_field_ordered_and_entry_sorted() {
    let input = valid_posting();

    assert_eq!(
        canonical_posting_json(&input).unwrap(),
        r#"{"schemaVersion":1,"candidateId":"candidate-1","transactionId":"transaction-1","transactionType":"EXPENSE","candidateAmountJpy":1000,"approved":true,"entries":[{"id":"entry-credit","accountId":"cash","side":"CREDIT","amountJpy":1000},{"id":"entry-debit","accountId":"expense","side":"DEBIT","amountJpy":1000}]}"#
    );
    assert_eq!(
        canonical_posting_hash(&input).unwrap(),
        "c190a870d36257f86f3e473bdfb77f085d5c21a171332025ff04460392ee484f"
    );
}

#[test]
fn invalid_posting_has_no_canonical_hash() {
    let mut input = valid_posting();
    input.approved = false;

    assert!(canonical_posting_hash(&input).is_err());
}
