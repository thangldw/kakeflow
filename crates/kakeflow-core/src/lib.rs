//! Deterministic financial invariants shared by native and browser runtimes.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fmt::Write as _;
use thiserror::Error;

const MAX_ID_BYTES: usize = 255;
const MIN_ENTRIES: usize = 2;
const MAX_ENTRIES: usize = 128;
const SUPPORTED_TRANSACTION_TYPES: [&str; 9] = [
    "EXPENSE",
    "INCOME",
    "TRANSFER",
    "CARD_PURCHASE",
    "CARD_PAYMENT",
    "REFUND",
    "FEE",
    "INTEREST",
    "ADJUSTMENT",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PostingInput {
    pub candidate_id: String,
    pub transaction_id: String,
    pub transaction_type: String,
    pub candidate_amount_jpy: i64,
    pub approved: bool,
    pub entries: Vec<PostingEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PostingEntry {
    pub id: String,
    pub account_id: String,
    pub side: EntrySide,
    pub amount_jpy: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntrySide {
    Debit,
    Credit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PostingValidation {
    pub valid: bool,
    pub codes: Vec<ValidationCode>,
    pub debit_total_jpy: i64,
    pub credit_total_jpy: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValidationCode {
    ApprovalRequired,
    InvalidIdentifier,
    UnsupportedTransactionType,
    EntryCountOutOfRange,
    DuplicateEntryId,
    NonPositiveAmount,
    AmountOverflow,
    UnbalancedJournal,
    CandidateAmountMismatch,
}

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid posting: {0:?}")]
    InvalidPosting(Vec<ValidationCode>),
    #[error("canonical serialization failed")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalPosting<'a> {
    schema_version: u8,
    candidate_id: &'a str,
    transaction_id: &'a str,
    transaction_type: &'a str,
    candidate_amount_jpy: i64,
    approved: bool,
    entries: Vec<CanonicalEntry<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalEntry<'a> {
    id: &'a str,
    account_id: &'a str,
    side: EntrySide,
    amount_jpy: i64,
}

pub fn validate_posting(input: &PostingInput) -> PostingValidation {
    let mut codes = Vec::new();
    let mut push_code = |code| {
        if !codes.contains(&code) {
            codes.push(code);
        }
    };

    if !input.approved {
        push_code(ValidationCode::ApprovalRequired);
    }
    if !valid_id(&input.candidate_id) || !valid_id(&input.transaction_id) {
        push_code(ValidationCode::InvalidIdentifier);
    }
    if !SUPPORTED_TRANSACTION_TYPES.contains(&input.transaction_type.as_str()) {
        push_code(ValidationCode::UnsupportedTransactionType);
    }
    if !(MIN_ENTRIES..=MAX_ENTRIES).contains(&input.entries.len()) {
        push_code(ValidationCode::EntryCountOutOfRange);
    }
    if input.candidate_amount_jpy <= 0 {
        push_code(ValidationCode::NonPositiveAmount);
    }

    let mut entry_ids = HashSet::new();
    let mut debit_total_jpy = 0_i64;
    let mut credit_total_jpy = 0_i64;
    let mut amount_overflow = false;
    for entry in &input.entries {
        if !valid_id(&entry.id) || !valid_id(&entry.account_id) {
            push_code(ValidationCode::InvalidIdentifier);
        }
        if !entry_ids.insert(entry.id.as_str()) {
            push_code(ValidationCode::DuplicateEntryId);
        }
        if entry.amount_jpy <= 0 {
            push_code(ValidationCode::NonPositiveAmount);
            continue;
        }

        let total = match entry.side {
            EntrySide::Debit => &mut debit_total_jpy,
            EntrySide::Credit => &mut credit_total_jpy,
        };
        if let Some(next) = total.checked_add(entry.amount_jpy) {
            *total = next;
        } else {
            amount_overflow = true;
        }
    }

    if amount_overflow {
        push_code(ValidationCode::AmountOverflow);
    } else {
        if debit_total_jpy != credit_total_jpy {
            push_code(ValidationCode::UnbalancedJournal);
        }
        if debit_total_jpy != input.candidate_amount_jpy
            || credit_total_jpy != input.candidate_amount_jpy
        {
            push_code(ValidationCode::CandidateAmountMismatch);
        }
    }

    PostingValidation {
        valid: codes.is_empty(),
        codes,
        debit_total_jpy,
        credit_total_jpy,
    }
}

pub fn canonical_posting_json(input: &PostingInput) -> Result<String, CoreError> {
    let validation = validate_posting(input);
    if !validation.valid {
        return Err(CoreError::InvalidPosting(validation.codes));
    }

    let mut entries: Vec<_> = input
        .entries
        .iter()
        .map(|entry| CanonicalEntry {
            id: &entry.id,
            account_id: &entry.account_id,
            side: entry.side,
            amount_jpy: entry.amount_jpy,
        })
        .collect();
    entries.sort_unstable_by(|left, right| left.id.cmp(right.id));
    Ok(serde_json::to_string(&CanonicalPosting {
        schema_version: 1,
        candidate_id: &input.candidate_id,
        transaction_id: &input.transaction_id,
        transaction_type: &input.transaction_type,
        candidate_amount_jpy: input.candidate_amount_jpy,
        approved: input.approved,
        entries,
    })?)
}

pub fn canonical_posting_hash(input: &PostingInput) -> Result<String, CoreError> {
    let canonical = canonical_posting_json(input)?;
    let digest = Sha256::digest(canonical.as_bytes());
    let mut hash = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut hash, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(hash)
}

fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_ID_BYTES && !value.chars().any(char::is_control)
}
