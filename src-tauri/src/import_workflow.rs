//! Atomic staging and posting for imported financial records.
//!
//! This module deliberately accepts already-extracted JSON and an opaque vault
//! URI. Raw document bytes never cross this persistence boundary.

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

use crate::record_scope::{
    attribution_shape_is_valid, audience_shape_is_valid, AttributionKind, AudienceVisibility,
};

const MAX_RECORDS: usize = 100_000;
const MAX_CANDIDATES: usize = 100_000;
const MAX_EVIDENCE_PER_CANDIDATE: usize = 128;
const MAX_JSON_BYTES: usize = 1_048_576;
const MAX_TEXT_BYTES: usize = 16_384;
const MAX_PENDING_REVIEW_RUNS: usize = 200;
const MAX_SAFE_JSON_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_RECEIPT_ITEMS: usize = 100;
const MAX_RECEIPT_TAXES: usize = 16;
const MAX_RECEIPT_REGION_INDEXES: usize = 64;
const MAX_RECEIPT_TEXT_BYTES: usize = 512;

#[derive(Debug, Error)]
pub enum ImportWorkflowError {
    #[error("invalid import: {0}")]
    Validation(String),
    #[error("import run was not found")]
    RunNotFound,
    #[error("import run has already been posted")]
    AlreadyPosted,
    #[error("candidate does not belong to this import run: {0}")]
    CandidateOutsideRun(String),
    #[error("journal is not balanced for candidate {0}")]
    UnbalancedJournal(String),
    #[error("database operation failed")]
    Database(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, ImportWorkflowError>;

fn bounded_receipt_text(value: Option<&serde_json::Value>) -> Option<Option<String>> {
    match value {
        None | Some(serde_json::Value::Null) => Some(None),
        Some(serde_json::Value::String(value))
            if !value.trim().is_empty() && value.len() <= MAX_RECEIPT_TEXT_BYTES =>
        {
            Some(Some(value.clone()))
        }
        _ => None,
    }
}

fn safe_nonnegative_jpy(value: Option<&serde_json::Value>) -> Option<i64> {
    value?
        .as_i64()
        .filter(|amount| (0..=MAX_SAFE_JSON_INTEGER).contains(amount))
}

fn safe_positive_jpy(value: Option<&serde_json::Value>) -> Option<i64> {
    safe_nonnegative_jpy(value).filter(|amount| *amount > 0)
}

fn optional_nonnegative_jpy(value: Option<&serde_json::Value>) -> Option<Option<i64>> {
    match value {
        None | Some(serde_json::Value::Null) => Some(None),
        value => safe_nonnegative_jpy(value).map(Some),
    }
}

fn valid_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let parse = |slice: &[u8]| {
        slice.iter().try_fold(0_u32, |value, byte| {
            byte.is_ascii_digit()
                .then_some(value * 10 + u32::from(byte - b'0'))
        })
    };
    let (Some(year), Some(month), Some(day)) = (
        parse(&bytes[0..4]),
        parse(&bytes[5..7]),
        parse(&bytes[8..10]),
    ) else {
        return false;
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (2000..=2999).contains(&year) && (1..=days).contains(&day)
}

fn receipt_field_provenance(value: &serde_json::Value) -> Option<ReceiptFieldProvenance> {
    let object = value.as_object()?;
    let line_number = object
        .get("lineNumber")?
        .as_i64()
        .filter(|value| *value > 0)?;
    let indexes = object.get("regionIndexes")?.as_array()?;
    if indexes.len() > MAX_RECEIPT_REGION_INDEXES {
        return None;
    }
    let region_indexes = indexes
        .iter()
        .map(|value| value.as_i64().filter(|value| *value >= 0))
        .collect::<Option<Vec<_>>>()?;
    (object.get("method")?.as_str()? == "TEXT_PATTERN").then(|| ReceiptFieldProvenance {
        line_number,
        region_indexes,
        method: "TEXT_PATTERN".into(),
    })
}

fn receipt_review_from_primary(
    connection: &Connection,
    candidate_id: &str,
    import_run_id: &str,
) -> rusqlite::Result<Option<ReceiptReview>> {
    let mut statement = connection.prepare(
        "SELECT sr.id, sr.row_number, sr.raw_payload_json
         FROM candidate_sources cs JOIN source_records sr ON sr.id=cs.source_record_id
         JOIN source_documents sd ON sd.id=sr.source_document_id
         WHERE cs.candidate_id=?1 AND cs.evidence_role='PRIMARY' AND sd.import_run_id=?2
         ORDER BY sr.id LIMIT 2",
    )?;
    let rows = statement
        .query_map([candidate_id, import_run_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.len() != 1 {
        return Ok(None);
    }
    let (source_record_id, source_row_number, payload_json) = &rows[0];
    let Some(payload) = serde_json::from_str::<serde_json::Value>(payload_json)
        .ok()
        .and_then(|value| value.as_object().cloned())
    else {
        return Ok(None);
    };
    if !payload
        .get("evidenceVersion")
        .and_then(serde_json::Value::as_i64)
        .is_some_and(|version| (1..=5).contains(&version))
    {
        return Ok(None);
    }
    let evidence_version = payload
        .get("evidenceVersion")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default();
    let Some(receipt) = payload
        .get("receipt")
        .and_then(serde_json::Value::as_object)
    else {
        return Ok(None);
    };
    let parsed = (|| {
        let merchant = bounded_receipt_text(receipt.get("merchant"))?;
        let occurred_on = match receipt.get("occurredOn") {
            None | Some(serde_json::Value::Null) => None,
            Some(serde_json::Value::String(value)) if valid_iso_date(value) => Some(value.clone()),
            _ => return None,
        };
        let total_amount_jpy = safe_positive_jpy(receipt.get("amountJpy"))?;
        let item_values = receipt.get("items")?.as_array()?;
        let tax_values = receipt.get("taxes")?.as_array()?;
        if item_values.len() > MAX_RECEIPT_ITEMS || tax_values.len() > MAX_RECEIPT_TAXES {
            return None;
        }
        let items = item_values
            .iter()
            .map(|value| {
                let item = value.as_object()?;
                let description = bounded_receipt_text(item.get("description"))??;
                let quantity = match item.get("quantity") {
                    None | Some(serde_json::Value::Null) => None,
                    Some(value) => Some(
                        value
                            .as_i64()
                            .filter(|value| *value > 0 && *value <= 10_000)?,
                    ),
                };
                let confidence_bps = item
                    .get("confidenceBps")?
                    .as_i64()
                    .filter(|value| (0..=10_000).contains(value))?;
                Some(ReceiptReviewItem {
                    description,
                    quantity,
                    amount_jpy: safe_positive_jpy(item.get("amountJpy"))?,
                    tax_rate_percent: match item.get("taxRatePercent") {
                        None | Some(serde_json::Value::Null) => None,
                        Some(value) => {
                            Some(value.as_i64().filter(|rate| *rate == 8 || *rate == 10)?)
                        }
                    },
                    confidence_bps,
                    provenance: receipt_field_provenance(item.get("provenance")?)?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let adjustments = |field: &str| -> Option<Vec<ReceiptReviewAdjustment>> {
            let Some(values) = receipt.get(field) else {
                return (evidence_version < 5).then(Vec::new);
            };
            let values = values.as_array()?;
            if values.len() > MAX_RECEIPT_TAXES {
                return None;
            }
            values
                .iter()
                .map(|value| {
                    let adjustment = value.as_object()?;
                    Some(ReceiptReviewAdjustment {
                        amount_jpy: match adjustment.get("amountJpy") {
                            None | Some(serde_json::Value::Null) => None,
                            value => Some(safe_positive_jpy(value)?),
                        },
                        confidence_bps: adjustment
                            .get("confidenceBps")?
                            .as_i64()
                            .filter(|value| (0..=10_000).contains(value))?,
                        provenance: receipt_field_provenance(adjustment.get("provenance")?)?,
                    })
                })
                .collect()
        };
        let reconciliation = match receipt.get("reconciliation") {
            None if evidence_version < 5 => None,
            None => return None,
            Some(value) => {
                let value = value.as_object()?;
                let status = value.get("status")?.as_str()?;
                if !matches!(status, "EXACT" | "DELTA" | "NO_ITEMS") {
                    return None;
                }
                let item_total_jpy = optional_nonnegative_jpy(value.get("itemTotalJpy"))?;
                let reconciled_total = match value.get("totalAmountJpy") {
                    None | Some(serde_json::Value::Null) => None,
                    value => Some(safe_positive_jpy(value)?),
                };
                let delta_jpy =
                    match value.get("deltaJpy") {
                        None | Some(serde_json::Value::Null) => None,
                        Some(value) => Some(value.as_i64().filter(|value| {
                            value.unsigned_abs() <= MAX_SAFE_JSON_INTEGER as u64
                        })?),
                    };
                if reconciled_total.is_some_and(|value| value != total_amount_jpy)
                    || match (item_total_jpy, reconciled_total, delta_jpy) {
                        (Some(items), Some(total), Some(delta)) => {
                            i128::from(items) - i128::from(total) != i128::from(delta)
                        }
                        (None, _, None) if status == "NO_ITEMS" => false,
                        _ => true,
                    }
                    || (status == "EXACT" && delta_jpy != Some(0))
                    || (status == "NO_ITEMS" && !items.is_empty())
                {
                    return None;
                }
                Some(ReceiptReviewReconciliation {
                    status: status.into(),
                    item_total_jpy,
                    total_amount_jpy: reconciled_total,
                    delta_jpy,
                })
            }
        };
        let taxes = tax_values
            .iter()
            .map(|value| {
                let tax = value.as_object()?;
                let rate_percent = tax.get("ratePercent")?.as_i64()?;
                if rate_percent != 8 && rate_percent != 10 {
                    return None;
                }
                let confidence_bps = tax
                    .get("confidenceBps")?
                    .as_i64()
                    .filter(|value| (0..=10_000).contains(value))?;
                Some(ReceiptReviewTax {
                    rate_percent,
                    tax_amount_jpy: optional_nonnegative_jpy(tax.get("taxAmountJpy"))?,
                    taxable_amount_jpy: optional_nonnegative_jpy(tax.get("taxableAmountJpy"))?,
                    confidence_bps,
                    provenance: receipt_field_provenance(tax.get("provenance")?)?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let payment_method = bounded_receipt_text(receipt.get("paymentMethod"))?;
        let tax_mode = match receipt.get("taxMode") {
            None | Some(serde_json::Value::Null) => None,
            Some(serde_json::Value::String(value))
                if matches!(value.as_str(), "INCLUDED" | "EXCLUDED" | "MIXED") =>
            {
                Some(value.clone())
            }
            _ => return None,
        };
        let document_page_number = match payload.get("documentPageNumber") {
            None | Some(serde_json::Value::Null) => None,
            Some(value) => Some(value.as_i64().filter(|page| (1..=10_000).contains(page))?),
        };
        Some(ReceiptReview {
            merchant,
            occurred_on,
            total_amount_jpy,
            items,
            taxes,
            coupon_amount_jpy: optional_nonnegative_jpy(receipt.get("couponAmountJpy"))?,
            points_used_jpy: optional_nonnegative_jpy(receipt.get("pointsUsedJpy"))?,
            coupon_evidence: adjustments("couponEvidence")?,
            points_used_evidence: adjustments("pointsUsedEvidence")?,
            subtotal_jpy: optional_nonnegative_jpy(receipt.get("subtotalJpy"))?,
            change_jpy: optional_nonnegative_jpy(receipt.get("changeJpy"))?,
            payment_method,
            tax_mode,
            reconciliation,
            provenance: ReceiptReviewProvenance {
                source_record_id: source_record_id.clone(),
                source_row_number: *source_row_number,
                document_page_number,
            },
        })
    })();
    Ok(parsed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartImport {
    pub run_id: String,
    pub document_id: String,
    pub household_id: String,
    pub source_type: String,
    pub original_filename: String,
    pub media_type: String,
    pub byte_size: i64,
    pub sha256: String,
    pub source_modified_at: Option<String>,
    pub adapter_id: Option<String>,
    pub adapter_version: Option<String>,
    #[serde(default)]
    pub audience_visibility: AudienceVisibility,
    #[serde(default)]
    pub audience_member_id: Option<String>,
    pub records: Vec<ImportSourceRecord>,
    pub candidates: Vec<NormalizedCandidate>,
    #[serde(default)]
    pub card_statements: Vec<StartCardStatement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCardStatement {
    pub id: String,
    pub card_account_id: String,
    pub issuer: String,
    pub period_start: String,
    pub period_end: String,
    pub payment_due_on: Option<String>,
    pub statement_amount_jpy: i64,
    pub lines: Vec<StartCardStatementLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCardStatementLine {
    pub candidate_id: String,
    pub statement_line_number: i64,
    pub billed_amount_jpy: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourceRecord {
    pub id: String,
    pub row_number: i64,
    pub record_hash: String,
    /// Extracted source fields only. Binary data must remain in the vault.
    pub payload_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateEvidence {
    pub source_record_id: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedCandidate {
    pub id: String,
    pub account_id: Option<String>,
    pub occurred_on: String,
    pub posted_on: Option<String>,
    pub amount_jpy: i64,
    pub direction: String,
    pub description_raw: Option<String>,
    pub merchant_raw: Option<String>,
    pub external_transaction_id: Option<String>,
    #[serde(default)]
    pub external_source: Option<String>,
    #[serde(default)]
    pub external_fact_hash: Option<String>,
    #[serde(default = "default_true")]
    pub calculation_target: bool,
    #[serde(default)]
    pub suggested_transaction_type: Option<String>,
    #[serde(default)]
    pub institution_raw: Option<String>,
    #[serde(default)]
    pub category_major_raw: Option<String>,
    #[serde(default)]
    pub category_minor_raw: Option<String>,
    #[serde(default)]
    pub memo_raw: Option<String>,
    pub extraction_confidence_bps: Option<i64>,
    pub normalization_confidence_bps: Option<i64>,
    pub review_status: String,
    #[serde(default)]
    pub attribution_kind: AttributionKind,
    #[serde(default)]
    pub attributed_member_id: Option<String>,
    #[serde(default)]
    pub audience_visibility: AudienceVisibility,
    #[serde(default)]
    pub audience_member_id: Option<String>,
    pub evidence: Vec<CandidateEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub run_id: String,
    pub document_id: String,
    pub status: String,
    pub record_count: u64,
    pub candidate_count: u64,
    pub reused_existing: bool,
}

/// Safe, bounded metadata used to recover an Import Inbox review after the
/// frontend process has restarted. Original bytes, vault locations, hashes and
/// extracted raw payloads deliberately remain behind the existing per-run
/// preview boundary.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingReviewRunDto {
    pub run_id: String,
    pub document_id: String,
    pub status: String,
    pub adapter_id: Option<String>,
    pub adapter_version: Option<String>,
    pub started_at: String,
    pub source_type: String,
    pub original_filename: String,
    pub media_type: String,
    pub byte_size: i64,
    pub source_modified_at: Option<String>,
    pub record_count: u64,
    pub candidate_count: u64,
    pub completion_state: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingReviewListDto {
    pub household_id: String,
    pub runs: Vec<PendingReviewRunDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub summary: ImportSummary,
    pub source: PreviewSourceMetadata,
    pub candidates: Vec<PreviewCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSourceMetadata {
    pub source_type: String,
    pub original_filename: String,
    pub media_type: String,
    pub byte_size: i64,
    pub sha256: String,
    pub audience_visibility: String,
    pub audience_member_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCandidate {
    pub id: String,
    pub account_id: Option<String>,
    pub occurred_on: String,
    pub posted_on: Option<String>,
    pub amount_jpy: i64,
    pub direction: String,
    pub description_raw: Option<String>,
    pub merchant_raw: Option<String>,
    pub external_transaction_id: Option<String>,
    pub external_source: Option<String>,
    pub external_fact_hash: Option<String>,
    pub calculation_target: bool,
    pub suggested_transaction_type: Option<String>,
    pub institution_raw: Option<String>,
    pub category_major_raw: Option<String>,
    pub category_minor_raw: Option<String>,
    pub memo_raw: Option<String>,
    pub extraction_confidence_bps: Option<i64>,
    pub normalization_confidence_bps: Option<i64>,
    pub review_status: String,
    pub evidence_count: u64,
    pub evidence_roles: Vec<String>,
    pub issues: Vec<String>,
    pub attribution_kind: String,
    pub attributed_member_id: Option<String>,
    pub audience_visibility: String,
    pub audience_member_id: Option<String>,
    /// A deliberately small, structured projection of the PRIMARY receipt
    /// evidence. Raw OCR text, extraction regions and the original payload
    /// never cross the Import Inbox preview boundary.
    pub receipt_review: Option<ReceiptReview>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptReview {
    pub merchant: Option<String>,
    pub occurred_on: Option<String>,
    pub total_amount_jpy: i64,
    pub items: Vec<ReceiptReviewItem>,
    pub taxes: Vec<ReceiptReviewTax>,
    pub coupon_amount_jpy: Option<i64>,
    pub points_used_jpy: Option<i64>,
    pub coupon_evidence: Vec<ReceiptReviewAdjustment>,
    pub points_used_evidence: Vec<ReceiptReviewAdjustment>,
    pub subtotal_jpy: Option<i64>,
    pub change_jpy: Option<i64>,
    pub payment_method: Option<String>,
    pub tax_mode: Option<String>,
    pub reconciliation: Option<ReceiptReviewReconciliation>,
    pub provenance: ReceiptReviewProvenance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptReviewItem {
    pub description: String,
    pub quantity: Option<i64>,
    pub amount_jpy: i64,
    pub tax_rate_percent: Option<i64>,
    pub confidence_bps: i64,
    pub provenance: ReceiptFieldProvenance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptReviewAdjustment {
    pub amount_jpy: Option<i64>,
    pub confidence_bps: i64,
    pub provenance: ReceiptFieldProvenance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptReviewReconciliation {
    pub status: String,
    pub item_total_jpy: Option<i64>,
    pub total_amount_jpy: Option<i64>,
    pub delta_jpy: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptReviewTax {
    pub rate_percent: i64,
    pub tax_amount_jpy: Option<i64>,
    pub taxable_amount_jpy: Option<i64>,
    pub confidence_bps: i64,
    pub provenance: ReceiptFieldProvenance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptFieldProvenance {
    pub line_number: i64,
    pub region_indexes: Vec<i64>,
    pub method: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptReviewProvenance {
    pub source_record_id: String,
    pub source_row_number: i64,
    pub document_page_number: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostingDecision {
    pub candidate_id: String,
    pub transaction_id: String,
    pub transaction_type: String,
    pub payee: Option<String>,
    pub description: Option<String>,
    #[serde(default = "default_true")]
    pub calculation_target: bool,
    #[serde(default)]
    pub attribution_kind: AttributionKind,
    #[serde(default)]
    pub attributed_member_id: Option<String>,
    #[serde(default)]
    pub audience_visibility: AudienceVisibility,
    #[serde(default)]
    pub audience_member_id: Option<String>,
    #[serde(default)]
    pub classification_rule_id: Option<String>,
    #[serde(default)]
    pub expected_classification_rule_updated_at: Option<String>,
    pub entries: Vec<JournalEntryDecision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntryDecision {
    pub id: String,
    pub account_id: String,
    pub side: String,
    pub amount_jpy: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub run_id: String,
    pub posted_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CardMatchConfirmation {
    pub statement_id: String,
    pub payment_id: String,
    pub reconciliation_status: String,
}

type CardMatchRow = (String, String, i64, i64, String, String, Option<String>);

type CandidatePostingRow = (
    String,
    Option<String>,
    String,
    Option<String>,
    i64,
    String,
    bool,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

#[derive(Debug)]
struct ImportReviewClassificationRule {
    id: String,
    updated_at: String,
    category_account_id: String,
    labels: Vec<String>,
    tags: Vec<String>,
}

const fn default_true() -> bool {
    true
}

/// Atomically creates a run, its immutable extracted records and normalized
/// candidates. Re-importing the same household SHA returns the existing import.
pub fn start_import(
    connection: &Connection,
    request: &StartImport,
    vault_storage_uri: &str,
) -> Result<ImportSummary> {
    validate_start(request, vault_storage_uri)?;
    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)?;
    let summary = start_import_in_transaction(&tx, request, vault_storage_uri)?;
    tx.commit()?;
    Ok(summary)
}

/// Materializes a fully validated import graph inside a caller-owned
/// transaction. Portable handoff uses this boundary so its receipt and aliases
/// commit atomically with the mutable review run.
pub(crate) fn start_import_in_transaction(
    tx: &Transaction<'_>,
    request: &StartImport,
    vault_storage_uri: &str,
) -> Result<ImportSummary> {
    validate_start(request, vault_storage_uri)?;

    ensure_members_belong(
        tx,
        &request.household_id,
        [request.audience_member_id.as_deref()],
    )?;

    for record in &request.records {
        let valid_json: bool =
            tx.query_row("SELECT json_valid(?1)", [&record.payload_json], |row| {
                row.get(0)
            })?;
        if !valid_json {
            return Err(ImportWorkflowError::Validation(format!(
                "source record {} is not valid JSON",
                record.id
            )));
        }
    }

    if let Some(summary) = existing_summary(tx, &request.household_id, &request.sha256)? {
        return Ok(ImportSummary {
            reused_existing: true,
            ..summary
        });
    }

    tx.execute(
        "INSERT INTO import_runs (id, household_id, status, adapter_id, adapter_version) \
         VALUES (?1, ?2, 'REVIEW_REQUIRED', ?3, ?4)",
        params![
            request.run_id,
            request.household_id,
            request.adapter_id,
            request.adapter_version
        ],
    )?;
    tx.execute(
        "INSERT INTO source_documents \
         (id, household_id, import_run_id, source_type, original_filename, media_type, \
          byte_size, sha256, storage_path, source_modified_at, \
          audience_visibility, audience_member_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            request.document_id,
            request.household_id,
            request.run_id,
            request.source_type,
            request.original_filename,
            request.media_type,
            request.byte_size,
            request.sha256,
            vault_storage_uri,
            request.source_modified_at,
            request.audience_visibility.as_sql(),
            request.audience_member_id
        ],
    )?;

    for record in &request.records {
        tx.execute(
            "INSERT INTO source_records \
             (id, source_document_id, row_number, record_hash, raw_payload_json) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                record.id,
                request.document_id,
                record.row_number,
                record.record_hash,
                record.payload_json
            ],
        )?;
    }
    let mut staged_candidate_count = 0_u64;
    let mut request_external_keys: HashMap<(String, String), String> = HashMap::new();
    for candidate in &request.candidates {
        if let (Some(source), Some(external_id), Some(fact_hash)) = (
            candidate.external_source.as_deref(),
            candidate.external_transaction_id.as_deref(),
            candidate.external_fact_hash.as_deref(),
        ) {
            let key = (source.to_owned(), external_id.to_owned());
            if request_external_keys.contains_key(&key) {
                return Err(ImportWorkflowError::Validation(
                    "duplicate external transaction ID in one import".into(),
                ));
            }
            request_external_keys.insert(key, fact_hash.to_owned());
            let existing: Option<(String, String)> = tx.query_row(
                "SELECT fact_hash,transaction_id FROM transaction_external_keys WHERE household_id=?1 AND external_source=?2 AND external_id=?3",
                params![request.household_id, source, external_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional()?;
            if let Some((existing_hash, transaction_id)) = existing {
                if existing_hash == fact_hash {
                    for evidence in &candidate.evidence {
                        tx.execute(
                            "INSERT OR IGNORE INTO transaction_sources (transaction_id,source_record_id,candidate_id) VALUES (?1,?2,NULL)",
                            params![transaction_id, evidence.source_record_id],
                        )?;
                    }
                    continue;
                }
                return Err(ImportWorkflowError::Validation(
                    "external transaction ID conflicts with previously posted facts".into(),
                ));
            }
        }
        ensure_members_belong(
            tx,
            &request.household_id,
            [
                candidate.attributed_member_id.as_deref(),
                candidate.audience_member_id.as_deref(),
            ],
        )?;
        if let Some(account_id) = &candidate.account_id {
            let account_exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1 AND household_id = ?2)",
                params![account_id, request.household_id],
                |row| row.get(0),
            )?;
            if !account_exists {
                return Err(ImportWorkflowError::Validation(format!(
                    "candidate account outside household: {account_id}"
                )));
            }
        }
        tx.execute(
            "INSERT INTO transaction_candidates \
             (id, household_id, account_id, occurred_on, posted_on, amount_jpy, direction, \
              description_raw, merchant_raw, external_transaction_id, \
              extraction_confidence_bps, normalization_confidence_bps, review_status, \
              attribution_kind, attributed_member_id, audience_visibility, audience_member_id, \
              external_source, external_fact_hash, calculation_target, suggested_transaction_type, \
              institution_raw, category_major_raw, category_minor_raw, memo_raw) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, \
                     ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)",
            params![
                candidate.id,
                request.household_id,
                candidate.account_id,
                candidate.occurred_on,
                candidate.posted_on,
                candidate.amount_jpy,
                candidate.direction,
                candidate.description_raw,
                candidate.merchant_raw,
                candidate.external_transaction_id,
                candidate.extraction_confidence_bps,
                candidate.normalization_confidence_bps,
                candidate.review_status,
                candidate.attribution_kind.as_sql(),
                candidate.attributed_member_id,
                candidate.audience_visibility.as_sql(),
                candidate.audience_member_id,
                candidate.external_source,
                candidate.external_fact_hash,
                candidate.calculation_target,
                candidate.suggested_transaction_type,
                candidate.institution_raw,
                candidate.category_major_raw,
                candidate.category_minor_raw,
                candidate.memo_raw
            ],
        )?;
        staged_candidate_count += 1;
        for evidence in &candidate.evidence {
            tx.execute(
                "INSERT INTO candidate_sources (candidate_id, source_record_id, evidence_role) \
                 VALUES (?1, ?2, ?3)",
                params![candidate.id, evidence.source_record_id, evidence.role],
            )?;
        }
    }
    for statement in &request.card_statements {
        let valid_card_account: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1 AND household_id = ?2 \
             AND account_kind = 'LIABILITY' AND account_subtype = 'CREDIT_CARD')",
            params![statement.card_account_id, request.household_id],
            |row| row.get(0),
        )?;
        if !valid_card_account {
            return Err(ImportWorkflowError::Validation(
                "statement card account is invalid".into(),
            ));
        }
        tx.execute(
            "INSERT INTO staged_card_statements \
             (id, import_run_id, household_id, card_account_id, issuer, period_start, period_end, \
              payment_due_on, statement_amount_jpy) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                statement.id,
                request.run_id,
                request.household_id,
                statement.card_account_id,
                statement.issuer,
                statement.period_start,
                statement.period_end,
                statement.payment_due_on,
                statement.statement_amount_jpy
            ],
        )?;
        for line in &statement.lines {
            tx.execute(
                "INSERT INTO staged_card_statement_candidates \
                 (statement_id, candidate_id, statement_line_number, billed_amount_jpy) \
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    statement.id,
                    line.candidate_id,
                    line.statement_line_number,
                    line.billed_amount_jpy
                ],
            )?;
        }
    }
    Ok(ImportSummary {
        run_id: request.run_id.clone(),
        document_id: request.document_id.clone(),
        status: "REVIEW_REQUIRED".into(),
        record_count: request.records.len() as u64,
        candidate_count: staged_candidate_count,
        reused_existing: false,
    })
}

/// Returns review data without exposing the vault URI or source payload JSON.
pub fn preview_import(connection: &Connection, run_id: &str) -> Result<ImportPreview> {
    validate_id("run_id", run_id)?;
    let source_graph: Option<(u64, u64)> = connection
        .query_row(
            "SELECT count(sd.id), \
                    coalesce(sum(CASE WHEN sd.household_id=ir.household_id THEN 1 ELSE 0 END),0) \
             FROM import_runs ir \
             LEFT JOIN source_documents sd ON sd.import_run_id=ir.id \
             WHERE ir.id=?1 \
             GROUP BY ir.id",
            [run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((document_count, matching_household_count)) = source_graph else {
        return Err(ImportWorkflowError::RunNotFound);
    };
    if document_count != 1 || matching_household_count != 1 {
        return Err(ImportWorkflowError::Validation(
            "import source graph is invalid".into(),
        ));
    }
    let (
        document_id,
        _household_id,
        status,
        source_type,
        filename,
        media_type,
        byte_size,
        sha256,
        source_audience_visibility,
        source_audience_member_id,
    ) = connection
        .query_row(
            "SELECT sd.id, ir.household_id, ir.status, sd.source_type, \
                        sd.original_filename, sd.media_type, sd.byte_size, sd.sha256, \
                        sd.audience_visibility, sd.audience_member_id \
                 FROM import_runs ir JOIN source_documents sd ON sd.import_run_id = ir.id \
                  AND sd.household_id=ir.household_id \
                 WHERE ir.id = ?1 ORDER BY sd.imported_at LIMIT 1",
            [run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, Option<String>>(9)?,
                ))
            },
        )
        .optional()?
        .ok_or(ImportWorkflowError::RunNotFound)?;

    let record_count: u64 = connection.query_row(
        "SELECT count(*) FROM source_records sr JOIN source_documents sd \
         ON sd.id = sr.source_document_id WHERE sd.import_run_id = ?1",
        [run_id],
        |row| row.get(0),
    )?;
    let mut statement = connection.prepare(
        "SELECT DISTINCT tc.id, tc.account_id, tc.occurred_on, tc.posted_on, tc.amount_jpy, \
                tc.direction, tc.description_raw, tc.merchant_raw, tc.external_transaction_id, \
                tc.external_source, tc.external_fact_hash, tc.calculation_target, \
                tc.suggested_transaction_type, tc.institution_raw, tc.category_major_raw, \
                tc.category_minor_raw, tc.memo_raw, \
                tc.extraction_confidence_bps, tc.normalization_confidence_bps, tc.review_status, \
                tc.attribution_kind, tc.attributed_member_id, \
                tc.audience_visibility, tc.audience_member_id \
         FROM transaction_candidates tc \
         JOIN candidate_sources cs ON cs.candidate_id = tc.id \
         JOIN source_records sr ON sr.id = cs.source_record_id \
         JOIN source_documents sd ON sd.id = sr.source_document_id \
         WHERE sd.import_run_id = ?1 AND tc.review_status IN ('PENDING','READY')
         ORDER BY tc.occurred_on, tc.id",
    )?;
    let rows = statement.query_map([run_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, Option<String>>(10)?,
            row.get::<_, bool>(11)?,
            row.get::<_, Option<String>>(12)?,
            row.get::<_, Option<String>>(13)?,
            row.get::<_, Option<String>>(14)?,
            row.get::<_, Option<String>>(15)?,
            row.get::<_, Option<String>>(16)?,
            row.get::<_, Option<i64>>(17)?,
            row.get::<_, Option<i64>>(18)?,
            row.get::<_, String>(19)?,
            row.get::<_, String>(20)?,
            row.get::<_, Option<String>>(21)?,
            row.get::<_, String>(22)?,
            row.get::<_, Option<String>>(23)?,
        ))
    })?;
    let mut candidates = Vec::new();
    for row in rows {
        let (
            id,
            account_id,
            occurred_on,
            posted_on,
            amount_jpy,
            direction,
            description_raw,
            merchant_raw,
            external_transaction_id,
            external_source,
            external_fact_hash,
            calculation_target,
            suggested_transaction_type,
            institution_raw,
            category_major_raw,
            category_minor_raw,
            memo_raw,
            extraction,
            normalization,
            review_status,
            attribution_kind,
            attributed_member_id,
            audience_visibility,
            audience_member_id,
        ) = row?;
        let mut role_statement = connection.prepare(
            "SELECT cs.evidence_role FROM candidate_sources cs WHERE cs.candidate_id = ?1 \
             ORDER BY cs.evidence_role, cs.source_record_id",
        )?;
        let roles = role_statement
            .query_map([&id], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut issues = Vec::new();
        if account_id.is_none() {
            issues.push("ACCOUNT_REQUIRED".into());
        }
        if extraction.is_some_and(|value| value < 8_000) {
            issues.push("LOW_EXTRACTION_CONFIDENCE".into());
        }
        if normalization.is_some_and(|value| value < 8_000) {
            issues.push("LOW_NORMALIZATION_CONFIDENCE".into());
        }
        let receipt_review = receipt_review_from_primary(connection, &id, run_id)?;
        candidates.push(PreviewCandidate {
            id,
            account_id,
            occurred_on,
            posted_on,
            amount_jpy,
            direction,
            description_raw,
            merchant_raw,
            external_transaction_id,
            external_source,
            external_fact_hash,
            calculation_target,
            suggested_transaction_type,
            institution_raw,
            category_major_raw,
            category_minor_raw,
            memo_raw,
            extraction_confidence_bps: extraction,
            normalization_confidence_bps: normalization,
            review_status,
            evidence_count: roles.len() as u64,
            evidence_roles: roles,
            issues,
            attribution_kind,
            attributed_member_id,
            audience_visibility,
            audience_member_id,
            receipt_review,
        });
    }
    Ok(ImportPreview {
        summary: ImportSummary {
            run_id: run_id.into(),
            document_id,
            status,
            record_count,
            candidate_count: candidates.len() as u64,
            reused_existing: false,
        },
        source: PreviewSourceMetadata {
            source_type,
            original_filename: filename,
            media_type,
            byte_size,
            sha256,
            audience_visibility: source_audience_visibility,
            audience_member_id: source_audience_member_id,
        },
        candidates,
    })
}

/// Lists every review-required run for one household without silently
/// truncating the Inbox. A recoverable run must have exactly one source
/// document, matching the atomic `start_import` contract and the existing
/// `preview_import` shape.
pub fn list_pending_reviews(
    connection: &Connection,
    household_id: &str,
) -> Result<PendingReviewListDto> {
    validate_id("household id", household_id)?;

    let total: u64 = connection.query_row(
        "SELECT count(*) FROM import_runs WHERE household_id=?1 AND status='REVIEW_REQUIRED'",
        [household_id],
        |row| row.get(0),
    )?;
    if total > MAX_PENDING_REVIEW_RUNS as u64 {
        return Err(ImportWorkflowError::Validation(
            "too many pending import reviews".into(),
        ));
    }

    let mut statement = connection.prepare(
        "SELECT ir.id, sd.id, ir.status, ir.adapter_id, ir.adapter_version, ir.started_at, \
                sd.source_type, sd.original_filename, sd.media_type, sd.byte_size, \
                sd.source_modified_at, \
                (SELECT count(*) FROM source_records sr \
                  JOIN source_documents source ON source.id=sr.source_document_id \
                  WHERE source.import_run_id=ir.id \
                    AND source.household_id=ir.household_id), \
                (SELECT count(DISTINCT tc.id) FROM transaction_candidates tc \
                  JOIN candidate_sources cs ON cs.candidate_id=tc.id \
                  JOIN source_records sr ON sr.id=cs.source_record_id \
                  JOIN source_documents source ON source.id=sr.source_document_id \
                  WHERE source.import_run_id=ir.id \
                    AND source.household_id=ir.household_id \
                    AND tc.household_id=ir.household_id \
                    AND tc.review_status IN ('PENDING','READY')), \
                EXISTS(SELECT 1 FROM portfolio_snapshots p \
                  WHERE p.household_id=ir.household_id AND p.source_document_id=sd.id), \
                EXISTS(SELECT 1 FROM brokerage_events e \
                  WHERE e.household_id=ir.household_id AND e.source_document_id=sd.id), \
                EXISTS(SELECT 1 FROM aggregate_asset_snapshots a \
                  WHERE a.household_id=ir.household_id AND a.source_document_id=sd.id) \
         FROM import_runs ir \
         JOIN source_documents sd ON sd.import_run_id=ir.id \
          AND sd.household_id=ir.household_id \
         WHERE ir.household_id=?1 AND ir.status='REVIEW_REQUIRED' \
         GROUP BY ir.id \
         HAVING count(sd.id)=1 \
            AND (SELECT count(*) FROM source_documents all_sd \
                 WHERE all_sd.import_run_id=ir.id)=1 \
         ORDER BY ir.started_at DESC, ir.id ASC",
    )?;
    let runs = statement
        .query_map([household_id], |row| {
            let adapter_id: Option<String> = row.get(3)?;
            let candidate_count: u64 = row.get(12)?;
            let has_portfolio: bool = row.get(13)?;
            let has_brokerage: bool = row.get(14)?;
            let has_aggregate_assets: bool = row.get(15)?;
            Ok(PendingReviewRunDto {
                run_id: row.get(0)?,
                document_id: row.get(1)?,
                status: row.get(2)?,
                completion_state: pending_review_completion_state(
                    adapter_id.as_deref(),
                    candidate_count,
                    has_portfolio,
                    has_brokerage,
                    has_aggregate_assets,
                )
                .into(),
                adapter_id,
                adapter_version: row.get(4)?,
                started_at: row.get(5)?,
                source_type: row.get(6)?,
                original_filename: row.get(7)?,
                media_type: row.get(8)?,
                byte_size: row.get(9)?,
                source_modified_at: row.get(10)?,
                record_count: row.get(11)?,
                candidate_count,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    if runs.len() as u64 != total {
        return Err(ImportWorkflowError::Validation(
            "pending import source graph is invalid".into(),
        ));
    }

    Ok(PendingReviewListDto {
        household_id: household_id.to_owned(),
        runs,
    })
}

fn pending_review_completion_state(
    adapter_id: Option<&str>,
    candidate_count: u64,
    has_portfolio: bool,
    has_brokerage: bool,
    has_aggregate_assets: bool,
) -> &'static str {
    if candidate_count > 0 {
        return "CANDIDATE_REVIEW";
    }
    let source_ready = match adapter_id {
        Some("securities-asset-snapshot-v1") => has_portfolio,
        Some(
            "japanese-brokerage-transactions-v1"
            | "sbi-securities-trade-history-v1"
            | "rakuten-securities-domestic-trade-history-v1"
            | "monex-us-stock-trade-history-v1",
        ) => has_brokerage,
        Some("money-forward-me-asset-trend-v1") => has_aggregate_assets,
        _ => true,
    };
    if source_ready {
        "SOURCE_READY"
    } else {
        "SOURCE_RESUME_REQUIRED"
    }
}

/// Posts caller-approved candidates as balanced double-entry transactions.
pub fn commit_import(
    connection: &Connection,
    run_id: &str,
    decisions: &[PostingDecision],
) -> Result<CommitSummary> {
    validate_id("run_id", run_id)?;
    let mut candidate_ids = HashSet::new();
    let mut posted_count = 0_u64;
    for decision in decisions {
        validate_posting_decision(decision)?;
        if !candidate_ids.insert(decision.candidate_id.as_str()) {
            return Err(ImportWorkflowError::Validation(format!(
                "duplicate decision for {}",
                decision.candidate_id
            )));
        }
    }

    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)?;
    let (household_id, status): (String, String) = tx
        .query_row(
            "SELECT household_id, status FROM import_runs WHERE id = ?1",
            [run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(ImportWorkflowError::RunNotFound)?;
    if status == "POSTED" {
        return Err(ImportWorkflowError::AlreadyPosted);
    }
    if status == "ROLLED_BACK" {
        return Err(ImportWorkflowError::Validation(
            "import was rolled back".into(),
        ));
    }
    let expected_candidates: u64 = tx.query_row(
        "SELECT count(DISTINCT tc.id) FROM transaction_candidates tc \
         JOIN candidate_sources cs ON cs.candidate_id = tc.id \
         JOIN source_records sr ON sr.id = cs.source_record_id \
         JOIN source_documents sd ON sd.id = sr.source_document_id \
         WHERE sd.import_run_id = ?1 AND tc.review_status IN ('PENDING', 'READY')",
        [run_id],
        |row| row.get(0),
    )?;
    if expected_candidates != decisions.len() as u64 {
        return Err(ImportWorkflowError::Validation(
            "every reviewable candidate needs one posting decision".into(),
        ));
    }

    for decision in decisions {
        let candidate: Option<CandidatePostingRow> = tx
            .query_row(
                "SELECT tc.household_id, tc.account_id, tc.occurred_on, tc.posted_on, \
                        tc.amount_jpy, tc.review_status, tc.calculation_target, \
                        tc.suggested_transaction_type, tc.external_source, tc.external_fact_hash, \
                        tc.external_transaction_id \
                 FROM transaction_candidates tc WHERE tc.id = ?1 AND EXISTS ( \
                   SELECT 1 FROM candidate_sources cs \
                   JOIN source_records sr ON sr.id = cs.source_record_id \
                   JOIN source_documents sd ON sd.id = sr.source_document_id \
                   WHERE cs.candidate_id = tc.id AND sd.import_run_id = ?2)",
                params![decision.candidate_id, run_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                    ))
                },
            )
            .optional()?;
        let (
            candidate_household,
            _,
            occurred_on,
            posted_on,
            candidate_amount,
            review_status,
            _candidate_calculation_target,
            suggested_transaction_type,
            external_source,
            external_fact_hash,
            external_transaction_id,
        ) = candidate.ok_or_else(|| {
            ImportWorkflowError::CandidateOutsideRun(decision.candidate_id.clone())
        })?;
        if candidate_household != household_id
            || !matches!(review_status.as_str(), "PENDING" | "READY")
        {
            return Err(ImportWorkflowError::CandidateOutsideRun(
                decision.candidate_id.clone(),
            ));
        }
        if let (Some(source), Some(external_id), Some(fact_hash)) = (
            external_source.as_deref(),
            external_transaction_id.as_deref(),
            external_fact_hash.as_deref(),
        ) {
            let existing: Option<(String, String)> = tx.query_row(
                "SELECT fact_hash,transaction_id FROM transaction_external_keys WHERE household_id=?1 AND external_source=?2 AND external_id=?3",
                params![household_id, source, external_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional()?;
            if let Some((existing_hash, transaction_id)) = existing {
                if existing_hash != fact_hash {
                    return Err(ImportWorkflowError::Validation(
                        "external transaction ID conflicts with previously posted facts".into(),
                    ));
                }
                tx.execute(
                    "INSERT OR IGNORE INTO transaction_sources (transaction_id,source_record_id,candidate_id) SELECT ?1,source_record_id,?2 FROM candidate_sources WHERE candidate_id=?2",
                    params![transaction_id, decision.candidate_id],
                )?;
                tx.execute(
                    "UPDATE transaction_candidates SET review_status='DUPLICATE' WHERE id=?1",
                    [&decision.candidate_id],
                )?;
                continue;
            }
        }
        if suggested_transaction_type.as_deref() == Some("TRANSFER")
            && (decision.transaction_type != "TRANSFER" || decision.calculation_target)
        {
            return Err(ImportWorkflowError::Validation(
                "Money Forward transfer must remain a calculation-excluded TRANSFER".into(),
            ));
        }
        ensure_members_belong(
            &tx,
            &household_id,
            [
                decision.attributed_member_id.as_deref(),
                decision.audience_member_id.as_deref(),
            ],
        )?;

        let classification_rule = import_review_classification_rule(&tx, &household_id, decision)?;

        let mut debit = 0_i64;
        let mut credit = 0_i64;
        let mut card_payment_account = None;
        let mut has_income_or_expense_leg = false;
        let mut expense_entries = Vec::new();
        for entry in &decision.entries {
            let (account_kind, account_subtype): (String, String) = tx
                .query_row(
                    "SELECT account_kind, account_subtype FROM accounts WHERE id = ?1 AND household_id = ?2",
                    params![entry.account_id, household_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?
                .ok_or_else(|| {
                    ImportWorkflowError::Validation(format!(
                        "account outside household: {}",
                        entry.account_id
                    ))
                })?;
            has_income_or_expense_leg |= matches!(account_kind.as_str(), "INCOME" | "EXPENSE");
            if account_kind == "EXPENSE" {
                expense_entries.push((entry.account_id.as_str(), entry.side.as_str()));
            }
            if decision.transaction_type == "CARD_PAYMENT" && account_kind == "EXPENSE" {
                return Err(ImportWorkflowError::Validation(
                    "CARD_PAYMENT cannot post to an expense account".into(),
                ));
            }
            if decision.transaction_type == "CARD_PAYMENT"
                && entry.side == "DEBIT"
                && account_kind == "LIABILITY"
                && account_subtype == "CREDIT_CARD"
                && card_payment_account
                    .replace(entry.account_id.clone())
                    .is_some()
            {
                return Err(ImportWorkflowError::Validation(
                    "CARD_PAYMENT has multiple card accounts".into(),
                ));
            }
            match entry.side.as_str() {
                "DEBIT" => {
                    debit = debit.checked_add(entry.amount_jpy).ok_or_else(|| {
                        ImportWorkflowError::Validation("journal amount overflow".into())
                    })?;
                }
                "CREDIT" => {
                    credit = credit.checked_add(entry.amount_jpy).ok_or_else(|| {
                        ImportWorkflowError::Validation("journal amount overflow".into())
                    })?;
                }
                _ => unreachable!("entry side was validated before opening the transaction"),
            }
        }
        if suggested_transaction_type.as_deref() == Some("TRANSFER") && has_income_or_expense_leg {
            return Err(ImportWorkflowError::Validation(
                "Money Forward transfer cannot post to income or expense accounts".into(),
            ));
        }
        if let Some(rule) = classification_rule.as_ref() {
            let expected_side = match decision.transaction_type.as_str() {
                "EXPENSE" | "CARD_PURCHASE" => "DEBIT",
                "REFUND" => "CREDIT",
                _ => {
                    return Err(ImportWorkflowError::Validation(
                        "classification rules can only be applied to expenses, card purchases, or refunds during import review".into(),
                    ));
                }
            };
            if expense_entries.as_slice() != [(rule.category_account_id.as_str(), expected_side)] {
                return Err(ImportWorkflowError::Validation(
                    "classification rule requires exactly one correctly-sided expense entry using its category".into(),
                ));
            }
        }
        if debit != credit || debit != candidate_amount {
            return Err(ImportWorkflowError::UnbalancedJournal(
                decision.candidate_id.clone(),
            ));
        }

        tx.execute(
            "INSERT INTO transactions \
             (id, household_id, occurred_on, posted_on, transaction_type, payee, description, status, \
              attribution_kind, attributed_member_id, audience_visibility, audience_member_id, calculation_target) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'POSTED', ?8, ?9, ?10, ?11, ?12)",
            params![
                decision.transaction_id,
                household_id,
                occurred_on,
                posted_on,
                decision.transaction_type,
                decision.payee,
                decision.description,
                decision.attribution_kind.as_sql(),
                decision.attributed_member_id,
                decision.audience_visibility.as_sql(),
                decision.audience_member_id,
                decision.calculation_target
            ],
        )?;
        posted_count += 1;
        if let (Some(source), Some(external_id), Some(fact_hash)) = (
            external_source.as_deref(),
            external_transaction_id.as_deref(),
            external_fact_hash.as_deref(),
        ) {
            tx.execute(
                "INSERT INTO transaction_external_keys (household_id,external_source,external_id,fact_hash,transaction_id) VALUES (?1,?2,?3,?4,?5)",
                params![household_id, source, external_id, fact_hash, decision.transaction_id],
            )?;
        }
        if decision.transaction_type == "CARD_PAYMENT" {
            let card_account_id = card_payment_account.ok_or_else(|| {
                ImportWorkflowError::Validation(
                    "CARD_PAYMENT requires a credit-card liability debit".into(),
                )
            })?;
            tx.execute(
                "INSERT INTO card_payments \
                 (id, household_id, bank_transaction_id, card_account_id, payment_amount_jpy, \
                  payment_on, match_score_bps, reconciliation_status) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 'UNMATCHED')",
                params![
                    format!("{}-payment", decision.transaction_id),
                    household_id,
                    decision.transaction_id,
                    card_account_id,
                    candidate_amount,
                    occurred_on
                ],
            )?;
        }
        for (index, entry) in decision.entries.iter().enumerate() {
            tx.execute(
                "INSERT INTO journal_entries \
                 (id, transaction_id, account_id, entry_side, amount_jpy, line_number) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    entry.id,
                    decision.transaction_id,
                    entry.account_id,
                    entry.side,
                    entry.amount_jpy,
                    (index + 1) as i64
                ],
            )?;
        }
        if let Some(rule) = classification_rule {
            for label in &rule.labels {
                tx.execute(
                    "INSERT INTO transaction_labels (transaction_id, label) VALUES (?1, ?2)",
                    params![decision.transaction_id, label],
                )?;
            }
            for tag in &rule.tags {
                tx.execute(
                    "INSERT INTO transaction_tags (transaction_id, tag) VALUES (?1, ?2)",
                    params![decision.transaction_id, tag],
                )?;
            }
            tx.execute(
                "INSERT INTO classification_rule_applications
                 (household_id, transaction_id, rule_id, previous_category_account_id,
                  applied_category_account_id, rule_updated_at, application_source)
                 VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'IMPORT_REVIEW')",
                params![
                    household_id,
                    decision.transaction_id,
                    rule.id,
                    rule.category_account_id,
                    rule.updated_at
                ],
            )?;
        }
        tx.execute(
            "INSERT INTO transaction_sources (transaction_id, source_record_id, candidate_id) \
             SELECT ?1, cs.source_record_id, ?2 FROM candidate_sources cs \
             WHERE cs.candidate_id = ?2",
            params![decision.transaction_id, decision.candidate_id],
        )?;
        tx.execute(
            "UPDATE transaction_candidates SET review_status = 'POSTED' WHERE id = ?1",
            [&decision.candidate_id],
        )?;
    }
    finalize_card_statements(&tx, run_id, &household_id)?;
    reconcile_exact_card_payments(&tx, &household_id)?;
    tx.execute(
        "UPDATE import_runs SET status = 'POSTED', \
         completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        [run_id],
    )?;
    tx.commit()?;
    Ok(CommitSummary {
        run_id: run_id.into(),
        posted_count,
    })
}

fn import_review_classification_rule(
    tx: &Transaction<'_>,
    household_id: &str,
    decision: &PostingDecision,
) -> Result<Option<ImportReviewClassificationRule>> {
    let (Some(rule_id), Some(expected_updated_at)) = (
        decision.classification_rule_id.as_deref(),
        decision.expected_classification_rule_updated_at.as_deref(),
    ) else {
        return Ok(None);
    };
    let rule = tx
        .query_row(
            "SELECT r.id, r.updated_at, r.is_enabled, r.merchant_contains,
                    r.description_contains, r.category_account_id
             FROM classification_rules r
             JOIN accounts a ON a.id = r.category_account_id
                            AND a.household_id = r.household_id
                            AND a.account_kind = 'EXPENSE'
             WHERE r.id = ?1 AND r.household_id = ?2",
            params![rule_id, household_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((
        id,
        updated_at,
        enabled,
        merchant_contains,
        description_contains,
        category_account_id,
    )) = rule
    else {
        return Err(ImportWorkflowError::Validation(
            "classification rule is unavailable for this household".into(),
        ));
    };
    if !enabled || updated_at != expected_updated_at {
        return Err(ImportWorkflowError::Validation(
            "classification rule changed after import review".into(),
        ));
    }
    let contains = |value: Option<&str>, needle: Option<&str>| match needle {
        None => true,
        Some(needle) => value
            .map(|value| value.to_lowercase().contains(&needle.to_lowercase()))
            .unwrap_or(false),
    };
    if !contains(decision.payee.as_deref(), merchant_contains.as_deref())
        || !contains(
            decision.description.as_deref(),
            description_contains.as_deref(),
        )
    {
        return Err(ImportWorkflowError::Validation(
            "classification rule no longer matches the reviewed transaction".into(),
        ));
    }
    let mut labels = tx.prepare(
        "SELECT label FROM classification_rule_labels WHERE rule_id = ?1 ORDER BY label",
    )?;
    let labels = labels
        .query_map([&id], |row| row.get(0))?
        .collect::<std::result::Result<Vec<String>, _>>()?;
    let mut tags =
        tx.prepare("SELECT tag FROM classification_rule_tags WHERE rule_id = ?1 ORDER BY tag")?;
    let tags = tags
        .query_map([&id], |row| row.get(0))?
        .collect::<std::result::Result<Vec<String>, _>>()?;
    Ok(Some(ImportReviewClassificationRule {
        id,
        updated_at,
        category_account_id,
        labels,
        tags,
    }))
}

fn finalize_card_statements(tx: &Transaction<'_>, run_id: &str, household_id: &str) -> Result<()> {
    let statements = {
        let mut query = tx.prepare(
            "SELECT scs.id, scs.card_account_id, scs.period_start, scs.period_end, \
                    scs.payment_due_on, scs.statement_amount_jpy, sd.id \
             FROM staged_card_statements scs \
             JOIN source_documents sd ON sd.import_run_id = scs.import_run_id \
             WHERE scs.import_run_id = ?1 ORDER BY scs.id",
        )?;
        let rows = query
            .query_map([run_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows
    };
    for (id, account, start, end, due, amount, source_document) in statements {
        tx.execute(
            "INSERT INTO card_statements \
             (id, household_id, card_account_id, period_start, period_end, payment_due_on, \
              statement_amount_jpy, reconciliation_status, source_document_id) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'UNMATCHED', ?8)",
            params![
                id,
                household_id,
                account,
                start,
                end,
                due,
                amount,
                source_document
            ],
        )?;
        tx.execute(
            "INSERT INTO card_statement_transactions \
             (statement_id, transaction_id, statement_line_number, billed_amount_jpy) \
             SELECT DISTINCT ?1, ts.transaction_id, scc.statement_line_number, scc.billed_amount_jpy \
             FROM staged_card_statement_candidates scc \
             JOIN transaction_sources ts ON ts.candidate_id = scc.candidate_id \
             WHERE scc.statement_id = ?1",
            [&id],
        )?;
    }
    tx.execute(
        "DELETE FROM staged_card_statements WHERE import_run_id = ?1",
        [run_id],
    )?;
    Ok(())
}

fn reconcile_exact_card_payments(tx: &Transaction<'_>, household_id: &str) -> Result<()> {
    let payments = {
        let mut query = tx.prepare(
            "SELECT id, card_account_id, payment_amount_jpy, payment_on \
             FROM card_payments WHERE household_id = ?1 AND reconciliation_status = 'UNMATCHED' \
             ORDER BY payment_on, id",
        )?;
        let rows = query
            .query_map([household_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows
    };
    for (payment_id, account_id, amount, payment_on) in payments {
        let statement_id: Option<String> = tx
            .query_row(
                "SELECT id FROM card_statements \
                 WHERE household_id = ?1 AND card_account_id = ?2 \
                   AND statement_amount_jpy = ?3 AND reconciliation_status = 'UNMATCHED' \
                   AND period_end <= ?4 AND julianday(?4) - julianday(period_end) BETWEEN 0 AND 120 \
                 ORDER BY abs(julianday(?4) - julianday(period_end)), period_end DESC, id LIMIT 1",
                params![household_id, account_id, amount, payment_on],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(statement_id) = statement_id {
            tx.execute(
                "UPDATE card_payments SET statement_id = ?1, match_score_bps = 8000, \
                 reconciliation_status = 'POSSIBLE_MATCH' WHERE id = ?2",
                params![statement_id, payment_id],
            )?;
        }
    }
    Ok(())
}

pub fn confirm_card_match(
    connection: &Connection,
    household_id: &str,
    statement_id: &str,
    payment_id: &str,
) -> Result<CardMatchConfirmation> {
    validate_id("household id", household_id)?;
    validate_id("statement id", statement_id)?;
    validate_id("payment id", payment_id)?;
    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)?;
    let row: Option<CardMatchRow> = tx
        .query_row(
            "SELECT cs.card_account_id, cp.card_account_id, cs.statement_amount_jpy,
                    cp.payment_amount_jpy, cs.reconciliation_status, cp.reconciliation_status,
                    cp.confirmed_at
             FROM card_statements cs JOIN card_payments cp ON cp.statement_id = cs.id
             WHERE cs.id = ?1 AND cp.id = ?2 AND cs.household_id = ?3 AND cp.household_id = ?3",
            params![statement_id, payment_id, household_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()?;
    let (
        statement_account,
        payment_account,
        statement_amount,
        payment_amount,
        statement_status,
        payment_status,
        confirmed_at,
    ) = row.ok_or_else(|| ImportWorkflowError::Validation("card match was not found".into()))?;
    if statement_account != payment_account || statement_amount != payment_amount {
        return Err(ImportWorkflowError::Validation(
            "card match amount or account changed".into(),
        ));
    }
    if confirmed_at.is_some() {
        tx.commit()?;
        return Ok(CardMatchConfirmation {
            statement_id: statement_id.into(),
            payment_id: payment_id.into(),
            reconciliation_status: statement_status,
        });
    }
    if statement_status != "UNMATCHED" || payment_status != "POSSIBLE_MATCH" {
        return Err(ImportWorkflowError::Validation(
            "card match is not confirmable".into(),
        ));
    }
    tx.execute(
        "UPDATE card_payments SET reconciliation_status = 'FULLY_RECONCILED',
         match_score_bps = 10000,
         confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        [payment_id],
    )?;
    let confirmed_total: i64 = tx.query_row(
        "SELECT COALESCE(SUM(payment_amount_jpy),0) FROM card_payments
         WHERE statement_id=?1 AND confirmed_at IS NOT NULL",
        [statement_id],
        |row| row.get(0),
    )?;
    let reconciliation_status = if confirmed_total < statement_amount {
        "PARTIALLY_RECONCILED"
    } else if confirmed_total == statement_amount {
        "FULLY_RECONCILED"
    } else {
        "OVERPAID"
    };
    tx.execute(
        "UPDATE card_statements SET reconciliation_status=?1 WHERE id=?2",
        params![reconciliation_status, statement_id],
    )?;
    tx.commit()?;
    Ok(CardMatchConfirmation {
        statement_id: statement_id.into(),
        payment_id: payment_id.into(),
        reconciliation_status: reconciliation_status.into(),
    })
}

/// Removes only staging owned by an unposted run and keeps a rolled-back audit row.
pub fn rollback_import(connection: &Connection, run_id: &str) -> Result<()> {
    validate_id("run_id", run_id)?;
    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)?;
    let status: String = tx
        .query_row(
            "SELECT status FROM import_runs WHERE id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(ImportWorkflowError::RunNotFound)?;
    let posted_count: i64 = tx.query_row(
        "SELECT count(DISTINCT tc.id) FROM transaction_candidates tc \
         JOIN candidate_sources cs ON cs.candidate_id = tc.id \
         JOIN source_records sr ON sr.id = cs.source_record_id \
         JOIN source_documents sd ON sd.id = sr.source_document_id \
         WHERE sd.import_run_id = ?1 AND tc.review_status = 'POSTED'",
        [run_id],
        |row| row.get(0),
    )?;
    if status == "POSTED" || posted_count > 0 {
        return Err(ImportWorkflowError::AlreadyPosted);
    }
    tx.execute(
        "DELETE FROM staged_card_statements WHERE import_run_id = ?1",
        [run_id],
    )?;
    let candidate_ids = {
        let mut statement = tx.prepare(
            "SELECT DISTINCT tc.id FROM transaction_candidates tc \
             JOIN candidate_sources cs ON cs.candidate_id = tc.id \
             JOIN source_records sr ON sr.id = cs.source_record_id \
             JOIN source_documents sd ON sd.id = sr.source_document_id \
             WHERE sd.import_run_id = ?1 AND tc.review_status != 'POSTED'",
        )?;
        let ids = statement
            .query_map([run_id], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ids
    };
    tx.execute(
        "DELETE FROM candidate_sources WHERE source_record_id IN ( \
           SELECT sr.id FROM source_records sr JOIN source_documents sd \
           ON sd.id = sr.source_document_id WHERE sd.import_run_id = ?1)",
        [run_id],
    )?;
    tx.execute(
        "DELETE FROM transaction_sources WHERE candidate_id IS NULL AND source_record_id IN ( \
           SELECT sr.id FROM source_records sr JOIN source_documents sd \
           ON sd.id=sr.source_document_id WHERE sd.import_run_id=?1)",
        [run_id],
    )?;
    for candidate_id in candidate_ids {
        tx.execute(
            "DELETE FROM transaction_candidates WHERE id = ?1 AND review_status != 'POSTED' \
             AND NOT EXISTS (SELECT 1 FROM candidate_sources cs \
                             WHERE cs.candidate_id = transaction_candidates.id)",
            [candidate_id],
        )?;
    }
    tx.execute(
        "DELETE FROM source_documents WHERE import_run_id = ?1",
        [run_id],
    )?;
    tx.execute(
        "UPDATE import_runs SET status = 'ROLLED_BACK', \
         completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        [run_id],
    )?;
    tx.commit()?;
    Ok(())
}

fn existing_summary(
    connection: &Connection,
    household_id: &str,
    sha256: &str,
) -> Result<Option<ImportSummary>> {
    connection
        .query_row(
            "SELECT ir.id, sd.id, ir.status, \
                    (SELECT count(*) FROM source_records sr WHERE sr.source_document_id = sd.id), \
                    (SELECT count(DISTINCT cs.candidate_id) FROM candidate_sources cs \
                     JOIN source_records sr ON sr.id = cs.source_record_id \
                     WHERE sr.source_document_id = sd.id) \
             FROM source_documents sd JOIN import_runs ir ON ir.id = sd.import_run_id \
             WHERE sd.household_id = ?1 AND sd.sha256 = ?2",
            params![household_id, sha256],
            |row| {
                Ok(ImportSummary {
                    run_id: row.get(0)?,
                    document_id: row.get(1)?,
                    status: row.get(2)?,
                    record_count: row.get(3)?,
                    candidate_count: row.get(4)?,
                    reused_existing: false,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn validate_start(request: &StartImport, vault_uri: &str) -> Result<()> {
    for (name, id) in [
        ("run_id", request.run_id.as_str()),
        ("document_id", request.document_id.as_str()),
        ("household_id", request.household_id.as_str()),
    ] {
        validate_id(name, id)?;
    }
    validate_text("vault URI", vault_uri, MAX_TEXT_BYTES)?;
    validate_text("filename", &request.original_filename, MAX_TEXT_BYTES)?;
    if request.original_filename.contains('/') || request.original_filename.contains('\\') {
        return Err(ImportWorkflowError::Validation(
            "original filename must not contain a path".into(),
        ));
    }
    validate_text("media type", &request.media_type, 255)?;
    if !matches!(
        request.source_type.as_str(),
        "LOCAL_FOLDER"
            | "ICLOUD_PICKER"
            | "GOOGLE_DRIVE"
            | "GMAIL"
            | "MANUAL_UPLOAD"
            | "CAMERA_SCAN"
            | "OTHER"
    ) {
        return Err(ImportWorkflowError::Validation(
            "unsupported source type".into(),
        ));
    }
    validate_sha("document sha256", &request.sha256)?;
    validate_audience_input(
        request.audience_visibility,
        request.audience_member_id.as_deref(),
    )?;
    if request.byte_size < 0
        || request.records.len() > MAX_RECORDS
        || request.candidates.len() > MAX_CANDIDATES
    {
        return Err(ImportWorkflowError::Validation(
            "invalid import size".into(),
        ));
    }
    if let Some(date) = &request.source_modified_at {
        validate_timestamp(date)?;
    }
    let mut record_ids = HashSet::new();
    let mut rows = HashSet::new();
    let mut hashes = HashSet::new();
    for record in &request.records {
        validate_id("source record id", &record.id)?;
        validate_sha("record hash", &record.record_hash)?;
        if record.row_number <= 0
            || !record_ids.insert(record.id.as_str())
            || !rows.insert(record.row_number)
            || !hashes.insert(record.record_hash.as_str())
        {
            return Err(ImportWorkflowError::Validation(
                "duplicate or invalid source record".into(),
            ));
        }
        if record.payload_json.len() > MAX_JSON_BYTES {
            return Err(ImportWorkflowError::Validation(
                "source payload too large".into(),
            ));
        }
    }
    let mut candidate_ids = HashSet::new();
    for candidate in &request.candidates {
        validate_id("candidate id", &candidate.id)?;
        validate_attribution_input(
            candidate.attribution_kind,
            candidate.attributed_member_id.as_deref(),
        )?;
        validate_audience_input(
            candidate.audience_visibility,
            candidate.audience_member_id.as_deref(),
        )?;
        if !candidate_ids.insert(candidate.id.as_str()) {
            return Err(ImportWorkflowError::Validation(
                "duplicate candidate id".into(),
            ));
        }
        validate_date(&candidate.occurred_on)?;
        if let Some(date) = &candidate.posted_on {
            validate_date(date)?;
        }
        if candidate.amount_jpy < 0 || !matches!(candidate.direction.as_str(), "IN" | "OUT") {
            return Err(ImportWorkflowError::Validation(
                "invalid candidate amount or direction".into(),
            ));
        }
        for confidence in [
            candidate.extraction_confidence_bps,
            candidate.normalization_confidence_bps,
        ]
        .into_iter()
        .flatten()
        {
            if !(0..=10_000).contains(&confidence) {
                return Err(ImportWorkflowError::Validation(
                    "confidence must be basis points".into(),
                ));
            }
        }
        if !matches!(
            candidate.review_status.as_str(),
            "PENDING" | "READY" | "DUPLICATE" | "EXCLUDED"
        ) {
            return Err(ImportWorkflowError::Validation(
                "invalid initial review status".into(),
            ));
        }
        match (
            candidate.external_source.as_deref(),
            candidate.external_transaction_id.as_deref(),
            candidate.external_fact_hash.as_deref(),
        ) {
            (None, _, None) => {}
            (Some("MONEY_FORWARD_ME"), Some(external_id), Some(fact_hash)) => {
                validate_text("external transaction ID", external_id, MAX_TEXT_BYTES)?;
                validate_sha("external fact hash", fact_hash)?;
            }
            _ => {
                return Err(ImportWorkflowError::Validation(
                    "external source, ID, and fact hash must form a supported complete tuple"
                        .into(),
                ))
            }
        }
        if candidate.suggested_transaction_type.as_deref() == Some("TRANSFER")
            && candidate.calculation_target
        {
            return Err(ImportWorkflowError::Validation(
                "imported transfer must be excluded from calculations".into(),
            ));
        }
        if candidate.suggested_transaction_type.is_some()
            && candidate.suggested_transaction_type.as_deref() != Some("TRANSFER")
        {
            return Err(ImportWorkflowError::Validation(
                "unsupported suggested transaction type".into(),
            ));
        }
        if candidate.evidence.is_empty() || candidate.evidence.len() > MAX_EVIDENCE_PER_CANDIDATE {
            return Err(ImportWorkflowError::Validation(
                "invalid evidence count".into(),
            ));
        }
        let mut evidence_ids = HashSet::new();
        for evidence in &candidate.evidence {
            if !record_ids.contains(evidence.source_record_id.as_str())
                || !evidence_ids.insert(evidence.source_record_id.as_str())
            {
                return Err(ImportWorkflowError::Validation(
                    "candidate evidence is invalid".into(),
                ));
            }
            if !matches!(
                evidence.role.as_str(),
                "PRIMARY" | "FUNDING_LEG" | "REWARD_LEG" | "CONTINUATION" | "SUPPORTING"
            ) {
                return Err(ImportWorkflowError::Validation(
                    "invalid evidence role".into(),
                ));
            }
        }
        for text in [
            &candidate.description_raw,
            &candidate.merchant_raw,
            &candidate.external_transaction_id,
            &candidate.institution_raw,
            &candidate.category_major_raw,
            &candidate.category_minor_raw,
            &candidate.memo_raw,
        ]
        .into_iter()
        .flatten()
        {
            validate_text("candidate text", text, MAX_TEXT_BYTES)?;
        }
    }
    if request.card_statements.len() > 16 {
        return Err(ImportWorkflowError::Validation(
            "too many card statements".into(),
        ));
    }
    let candidate_ids = request
        .candidates
        .iter()
        .map(|candidate| candidate.id.as_str())
        .collect::<HashSet<_>>();
    let mut statement_ids = HashSet::new();
    for statement in &request.card_statements {
        validate_id("statement id", &statement.id)?;
        validate_id("statement card account", &statement.card_account_id)?;
        validate_text("statement issuer", &statement.issuer, 255)?;
        validate_date(&statement.period_start)?;
        validate_date(&statement.period_end)?;
        if statement.period_end < statement.period_start {
            return Err(ImportWorkflowError::Validation(
                "statement period is invalid".into(),
            ));
        }
        if let Some(due) = &statement.payment_due_on {
            validate_date(due)?;
        }
        if statement.statement_amount_jpy < 0
            || statement.lines.is_empty()
            || statement.lines.len() > MAX_CANDIDATES
            || !statement_ids.insert(statement.id.as_str())
        {
            return Err(ImportWorkflowError::Validation(
                "card statement is invalid".into(),
            ));
        }
        let mut line_candidates = HashSet::new();
        let mut line_numbers = HashSet::new();
        let mut detail_total = 0_i64;
        for line in &statement.lines {
            validate_id("statement candidate", &line.candidate_id)?;
            if !candidate_ids.contains(line.candidate_id.as_str())
                || !line_candidates.insert(line.candidate_id.as_str())
                || line.statement_line_number <= 0
                || !line_numbers.insert(line.statement_line_number)
                || line.billed_amount_jpy == 0
            {
                return Err(ImportWorkflowError::Validation(
                    "statement line is invalid".into(),
                ));
            }
            detail_total = detail_total
                .checked_add(line.billed_amount_jpy)
                .ok_or_else(|| {
                    ImportWorkflowError::Validation("statement total overflow".into())
                })?;
        }
        if detail_total != statement.statement_amount_jpy {
            return Err(ImportWorkflowError::Validation(
                "statement detail does not match total".into(),
            ));
        }
    }
    Ok(())
}

fn validate_posting_decision(decision: &PostingDecision) -> Result<()> {
    validate_id("candidate id", &decision.candidate_id)?;
    validate_id("transaction id", &decision.transaction_id)?;
    validate_attribution_input(
        decision.attribution_kind,
        decision.attributed_member_id.as_deref(),
    )?;
    validate_audience_input(
        decision.audience_visibility,
        decision.audience_member_id.as_deref(),
    )?;
    match (
        decision.classification_rule_id.as_deref(),
        decision.expected_classification_rule_updated_at.as_deref(),
    ) {
        (Some(rule_id), Some(expected_updated_at)) => {
            validate_id("classification rule id", rule_id)?;
            validate_id("classification rule version", expected_updated_at)?;
        }
        (None, None) => {}
        _ => {
            return Err(ImportWorkflowError::Validation(
                "classification rule id and version must be reviewed together".into(),
            ));
        }
    }
    if !matches!(
        decision.transaction_type.as_str(),
        "EXPENSE"
            | "INCOME"
            | "TRANSFER"
            | "CARD_PURCHASE"
            | "CARD_PAYMENT"
            | "REFUND"
            | "FEE"
            | "INTEREST"
            | "ADJUSTMENT"
    ) {
        return Err(ImportWorkflowError::Validation(
            "invalid transaction type".into(),
        ));
    }
    if decision.entries.len() < 2 || decision.entries.len() > 128 {
        return Err(ImportWorkflowError::Validation(
            "a journal needs 2..128 entries".into(),
        ));
    }
    let mut ids = HashSet::new();
    for entry in &decision.entries {
        validate_id("journal entry id", &entry.id)?;
        validate_id("account id", &entry.account_id)?;
        if !ids.insert(entry.id.as_str())
            || entry.amount_jpy <= 0
            || !matches!(entry.side.as_str(), "DEBIT" | "CREDIT")
        {
            return Err(ImportWorkflowError::Validation(
                "invalid journal entry".into(),
            ));
        }
    }
    Ok(())
}

fn validate_id(name: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 255 || value.chars().any(char::is_control) {
        return Err(ImportWorkflowError::Validation(format!("invalid {name}")));
    }
    Ok(())
}

fn validate_attribution_input(kind: AttributionKind, member_id: Option<&str>) -> Result<()> {
    if !attribution_shape_is_valid(kind, member_id) {
        return Err(ImportWorkflowError::Validation(
            "invalid transaction attribution".into(),
        ));
    }
    if let Some(member_id) = member_id {
        validate_id("attributed member id", member_id)?;
    }
    Ok(())
}

fn validate_audience_input(visibility: AudienceVisibility, member_id: Option<&str>) -> Result<()> {
    if !audience_shape_is_valid(visibility, member_id) {
        return Err(ImportWorkflowError::Validation(
            "invalid record audience".into(),
        ));
    }
    if let Some(member_id) = member_id {
        validate_id("audience member id", member_id)?;
    }
    Ok(())
}

fn ensure_members_belong<'a>(
    connection: &Connection,
    household_id: &str,
    member_ids: impl IntoIterator<Item = Option<&'a str>>,
) -> Result<()> {
    for member_id in member_ids.into_iter().flatten() {
        let belongs: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM household_members
             WHERE id = ?1 AND household_id = ?2)",
            params![member_id, household_id],
            |row| row.get(0),
        )?;
        if !belongs {
            return Err(ImportWorkflowError::Validation(
                "record member does not belong to household".into(),
            ));
        }
    }
    Ok(())
}

fn validate_text(name: &str, value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.len() > max || value.contains('\0') {
        return Err(ImportWorkflowError::Validation(format!("invalid {name}")));
    }
    Ok(())
}

fn validate_sha(name: &str, value: &str) -> Result<()> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ImportWorkflowError::Validation(format!("invalid {name}")));
    }
    Ok(())
}

fn validate_timestamp(value: &str) -> Result<()> {
    if value.len() < 10 {
        return Err(ImportWorkflowError::Validation("invalid timestamp".into()));
    }
    validate_date(&value[..10])
}

fn validate_date(value: &str) -> Result<()> {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return Err(ImportWorkflowError::Validation(format!(
            "invalid date: {value}"
        )));
    }
    let year: i32 = value[0..4]
        .parse()
        .map_err(|_| ImportWorkflowError::Validation("invalid year".into()))?;
    let month: u32 = value[5..7]
        .parse()
        .map_err(|_| ImportWorkflowError::Validation("invalid month".into()))?;
    let day: u32 = value[8..10]
        .parse()
        .map_err(|_| ImportWorkflowError::Validation("invalid day".into()))?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    if year < 1 || day == 0 || day > max_day {
        return Err(ImportWorkflowError::Validation(format!(
            "invalid date: {value}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("open test database");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE households (
                   id TEXT PRIMARY KEY, name TEXT NOT NULL, base_currency TEXT NOT NULL DEFAULT 'JPY');
                 CREATE TABLE household_members (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   display_name TEXT NOT NULL, status TEXT NOT NULL);
                 CREATE TABLE accounts (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   name TEXT NOT NULL, account_kind TEXT NOT NULL, account_subtype TEXT NOT NULL,
                   currency TEXT NOT NULL DEFAULT 'JPY');
                 CREATE TABLE import_runs (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   status TEXT NOT NULL, adapter_id TEXT, adapter_version TEXT,
                   started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                   completed_at TEXT);
                 CREATE TABLE source_documents (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   import_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
                   source_type TEXT NOT NULL, original_filename TEXT NOT NULL, media_type TEXT NOT NULL,
                   byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL, storage_path TEXT NOT NULL,
                   source_modified_at TEXT, imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                   audience_visibility TEXT NOT NULL DEFAULT 'SHARED', audience_member_id TEXT,
                   UNIQUE(household_id, sha256));
                 CREATE TABLE source_records (
                   id TEXT PRIMARY KEY, source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
                   row_number INTEGER NOT NULL, record_hash TEXT NOT NULL, raw_payload_json TEXT NOT NULL,
                   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                   UNIQUE(source_document_id,row_number), UNIQUE(source_document_id,record_hash));
                 CREATE TABLE transaction_candidates (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   account_id TEXT REFERENCES accounts(id), occurred_on TEXT NOT NULL, posted_on TEXT,
                   amount_jpy INTEGER NOT NULL, direction TEXT NOT NULL, description_raw TEXT,
                   merchant_raw TEXT, external_transaction_id TEXT, extraction_confidence_bps INTEGER,
                   normalization_confidence_bps INTEGER, review_status TEXT NOT NULL DEFAULT 'PENDING',
                   attribution_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD', attributed_member_id TEXT,
                   audience_visibility TEXT NOT NULL DEFAULT 'SHARED', audience_member_id TEXT,
                   external_source TEXT, external_fact_hash TEXT, calculation_target INTEGER NOT NULL DEFAULT 1,
                   suggested_transaction_type TEXT, institution_raw TEXT, category_major_raw TEXT,
                   category_minor_raw TEXT, memo_raw TEXT,
                   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
                 CREATE TABLE candidate_sources (
                   candidate_id TEXT NOT NULL REFERENCES transaction_candidates(id) ON DELETE CASCADE,
                   source_record_id TEXT NOT NULL REFERENCES source_records(id), evidence_role TEXT NOT NULL,
                   PRIMARY KEY(candidate_id,source_record_id));
                 CREATE TABLE transactions (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), occurred_on TEXT NOT NULL,
                   posted_on TEXT, transaction_type TEXT NOT NULL, payee TEXT, description TEXT, status TEXT NOT NULL,
                   attribution_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD', attributed_member_id TEXT,
                   audience_visibility TEXT NOT NULL DEFAULT 'SHARED', audience_member_id TEXT,
                   calculation_target INTEGER NOT NULL DEFAULT 1 CHECK(calculation_target IN (0,1)),
                   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                   updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
                 CREATE TABLE transaction_sources (
                   transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                   source_record_id TEXT NOT NULL REFERENCES source_records(id),
                   candidate_id TEXT REFERENCES transaction_candidates(id),
                   PRIMARY KEY(transaction_id,source_record_id));
                 CREATE TABLE transaction_external_keys (
                   household_id TEXT NOT NULL REFERENCES households(id), external_source TEXT NOT NULL,
                   external_id TEXT NOT NULL, fact_hash TEXT NOT NULL,
                   transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                   PRIMARY KEY(household_id,external_source,external_id));
                 CREATE TABLE journal_entries (
                   id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                   account_id TEXT NOT NULL REFERENCES accounts(id), entry_side TEXT NOT NULL,
                   amount_jpy INTEGER NOT NULL, line_number INTEGER NOT NULL,
                   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                   UNIQUE(transaction_id,line_number));
                 CREATE TABLE classification_rules (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   name TEXT NOT NULL, priority INTEGER NOT NULL, is_enabled INTEGER NOT NULL,
                   merchant_contains TEXT, description_contains TEXT,
                   category_account_id TEXT NOT NULL REFERENCES accounts(id),
                   created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                 CREATE TABLE classification_rule_labels (
                   rule_id TEXT NOT NULL REFERENCES classification_rules(id) ON DELETE CASCADE,
                   label TEXT NOT NULL, PRIMARY KEY(rule_id,label));
                 CREATE TABLE classification_rule_tags (
                   rule_id TEXT NOT NULL REFERENCES classification_rules(id) ON DELETE CASCADE,
                   tag TEXT NOT NULL, PRIMARY KEY(rule_id,tag));
                 CREATE TABLE transaction_labels (
                   transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                   label TEXT NOT NULL, PRIMARY KEY(transaction_id,label));
                 CREATE TABLE transaction_tags (
                   transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                   tag TEXT NOT NULL, PRIMARY KEY(transaction_id,tag));
                 CREATE TABLE classification_rule_applications (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   household_id TEXT NOT NULL REFERENCES households(id),
                   transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                   rule_id TEXT REFERENCES classification_rules(id) ON DELETE SET NULL,
                   previous_category_account_id TEXT REFERENCES accounts(id),
                   applied_category_account_id TEXT NOT NULL REFERENCES accounts(id),
                   rule_updated_at TEXT, application_source TEXT NOT NULL);
                 CREATE TABLE card_statements (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   card_account_id TEXT NOT NULL REFERENCES accounts(id), period_start TEXT NOT NULL,
                   period_end TEXT NOT NULL, payment_due_on TEXT, statement_amount_jpy INTEGER NOT NULL,
                   reconciliation_status TEXT NOT NULL, source_document_id TEXT REFERENCES source_documents(id));
                 CREATE TABLE card_statement_transactions (
                   statement_id TEXT NOT NULL REFERENCES card_statements(id) ON DELETE CASCADE,
                   transaction_id TEXT NOT NULL REFERENCES transactions(id), statement_line_number INTEGER NOT NULL,
                   billed_amount_jpy INTEGER NOT NULL, PRIMARY KEY(statement_id,transaction_id));
                 CREATE TABLE card_payments (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   statement_id TEXT REFERENCES card_statements(id), bank_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
                   card_account_id TEXT NOT NULL REFERENCES accounts(id), payment_amount_jpy INTEGER NOT NULL,
                   payment_on TEXT NOT NULL, match_score_bps INTEGER, reconciliation_status TEXT NOT NULL,
                   confirmed_at TEXT);
                 CREATE TABLE staged_card_statements (
                   id TEXT PRIMARY KEY, import_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
                   household_id TEXT NOT NULL REFERENCES households(id), card_account_id TEXT NOT NULL REFERENCES accounts(id),
                   issuer TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, payment_due_on TEXT,
                   statement_amount_jpy INTEGER NOT NULL, UNIQUE(import_run_id,card_account_id));
                 CREATE TABLE staged_card_statement_candidates (
                   statement_id TEXT NOT NULL REFERENCES staged_card_statements(id) ON DELETE CASCADE,
                   candidate_id TEXT NOT NULL REFERENCES transaction_candidates(id), statement_line_number INTEGER NOT NULL,
                   billed_amount_jpy INTEGER NOT NULL, PRIMARY KEY(statement_id,candidate_id));
                 CREATE TABLE portfolio_snapshots (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   source_document_id TEXT NOT NULL REFERENCES source_documents(id));
                 CREATE TABLE brokerage_events (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   source_document_id TEXT NOT NULL REFERENCES source_documents(id));
                 CREATE TABLE aggregate_asset_snapshots (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   source_document_id TEXT NOT NULL REFERENCES source_documents(id));
                 INSERT INTO households(id,name) VALUES('household','Test');
                 INSERT INTO household_members(id,household_id,display_name,status)
                   VALUES('member','household','Member','ARCHIVED');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                   VALUES('bank','household','Bank','ASSET','BANK'),
                         ('expense','household','Food','EXPENSE','OTHER'),
                         ('rule-expense','household','Subscriptions','EXPENSE','OTHER'),
                         ('card','household','Card','LIABILITY','CREDIT_CARD');",
            )
            .expect("create compatible schema");
        connection
    }

    fn request(run: &str, document: &str, sha: char) -> StartImport {
        StartImport {
            run_id: run.into(),
            document_id: document.into(),
            household_id: "household".into(),
            source_type: "MANUAL_UPLOAD".into(),
            original_filename: "statement.csv".into(),
            media_type: "text/csv".into(),
            byte_size: 42,
            sha256: sha.to_string().repeat(64),
            source_modified_at: Some("2026-07-12T10:00:00Z".into()),
            adapter_id: Some("test".into()),
            adapter_version: Some("1".into()),
            audience_visibility: AudienceVisibility::Shared,
            audience_member_id: None,
            records: vec![
                ImportSourceRecord {
                    id: format!("{run}-row-1"),
                    row_number: 1,
                    record_hash: "b".repeat(64),
                    payload_json: "{\"amount\":1000}".into(),
                },
                ImportSourceRecord {
                    id: format!("{run}-row-2"),
                    row_number: 2,
                    record_hash: "c".repeat(64),
                    payload_json: "{\"kind\":\"supporting\"}".into(),
                },
            ],
            candidates: vec![NormalizedCandidate {
                id: format!("{run}-candidate"),
                account_id: Some("bank".into()),
                occurred_on: "2026-07-12".into(),
                posted_on: None,
                amount_jpy: 1_000,
                direction: "OUT".into(),
                description_raw: Some("Store".into()),
                merchant_raw: Some("Store".into()),
                external_transaction_id: None,
                external_source: None,
                external_fact_hash: None,
                calculation_target: true,
                suggested_transaction_type: None,
                institution_raw: None,
                category_major_raw: None,
                category_minor_raw: None,
                memo_raw: None,
                extraction_confidence_bps: Some(9_900),
                normalization_confidence_bps: Some(9_500),
                review_status: "READY".into(),
                attribution_kind: AttributionKind::Household,
                attributed_member_id: None,
                audience_visibility: AudienceVisibility::Shared,
                audience_member_id: None,
                evidence: vec![
                    CandidateEvidence {
                        source_record_id: format!("{run}-row-1"),
                        role: "PRIMARY".into(),
                    },
                    CandidateEvidence {
                        source_record_id: format!("{run}-row-2"),
                        role: "SUPPORTING".into(),
                    },
                ],
            }],
            card_statements: Vec::new(),
        }
    }

    fn decision(run: &str, credit_amount: i64) -> PostingDecision {
        PostingDecision {
            candidate_id: format!("{run}-candidate"),
            transaction_id: format!("{run}-transaction"),
            transaction_type: "EXPENSE".into(),
            payee: Some("Store".into()),
            description: None,
            calculation_target: true,
            attribution_kind: AttributionKind::Household,
            attributed_member_id: None,
            audience_visibility: AudienceVisibility::Shared,
            audience_member_id: None,
            classification_rule_id: None,
            expected_classification_rule_updated_at: None,
            entries: vec![
                JournalEntryDecision {
                    id: format!("{run}-debit"),
                    account_id: "expense".into(),
                    side: "DEBIT".into(),
                    amount_jpy: 1_000,
                },
                JournalEntryDecision {
                    id: format!("{run}-credit"),
                    account_id: "bank".into(),
                    side: "CREDIT".into(),
                    amount_jpy: credit_amount,
                },
            ],
        }
    }

    fn install_classification_rule(connection: &Connection) {
        connection
            .execute_batch(
                "INSERT INTO classification_rules
             (id,household_id,name,priority,is_enabled,merchant_contains,description_contains,
              category_account_id,created_at,updated_at)
             VALUES('rule','household','Store rule',1,1,'store',NULL,'rule-expense',
                    '2026-07-12T00:00:00Z','2026-07-12T00:00:00Z');
             INSERT INTO classification_rule_labels(rule_id,label) VALUES('rule','subscription');
             INSERT INTO classification_rule_tags(rule_id,tag) VALUES('rule','household');",
            )
            .unwrap();
    }

    fn classified_decision(run: &str) -> PostingDecision {
        let mut posting = decision(run, 1_000);
        posting.entries[0].account_id = "rule-expense".into();
        posting.classification_rule_id = Some("rule".into());
        posting.expected_classification_rule_updated_at = Some("2026-07-12T00:00:00Z".into());
        posting
    }

    #[test]
    fn import_review_rule_is_revalidated_and_audited_with_metadata() {
        let connection = database();
        install_classification_rule(&connection);
        let serialized = serde_json::to_value(classified_decision("wire")).unwrap();
        assert_eq!(
            serialized["expectedClassificationRuleUpdatedAt"],
            "2026-07-12T00:00:00Z"
        );
        assert!(serialized
            .get("classificationRuleExpectedUpdatedAt")
            .is_none());
        start_import(
            &connection,
            &request("classified", "classified-doc", 'd'),
            "vault://classified",
        )
        .unwrap();

        let result = commit_import(
            &connection,
            "classified",
            &[classified_decision("classified")],
        )
        .unwrap();

        assert_eq!(result.posted_count, 1);
        let application: (String, String, String, String) = connection
            .query_row(
                "SELECT rule_id,applied_category_account_id,rule_updated_at,application_source
             FROM classification_rule_applications",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            application,
            (
                "rule".into(),
                "rule-expense".into(),
                "2026-07-12T00:00:00Z".into(),
                "IMPORT_REVIEW".into(),
            )
        );
        assert_eq!(
            connection
                .query_row("SELECT label FROM transaction_labels", [], |row| row
                    .get::<_, String>(0),)
                .unwrap(),
            "subscription"
        );
        assert_eq!(
            connection
                .query_row("SELECT tag FROM transaction_tags", [], |row| row
                    .get::<_, String>(0),)
                .unwrap(),
            "household"
        );
    }

    #[test]
    fn import_review_rejects_stale_rule_revision_atomically() {
        let connection = database();
        install_classification_rule(&connection);
        connection
            .execute(
                "UPDATE classification_rules SET updated_at='2026-07-13T00:00:00Z' WHERE id='rule'",
                [],
            )
            .unwrap();
        start_import(
            &connection,
            &request("stale", "stale-doc", 'e'),
            "vault://stale",
        )
        .unwrap();

        assert!(matches!(
            commit_import(&connection, "stale", &[classified_decision("stale")]),
            Err(ImportWorkflowError::Validation(message)) if message.contains("changed")
        ));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn import_review_rejects_deleted_rule() {
        let connection = database();
        install_classification_rule(&connection);
        connection
            .execute("DELETE FROM classification_rules WHERE id='rule'", [])
            .unwrap();
        start_import(
            &connection,
            &request("deleted", "deleted-doc", 'f'),
            "vault://deleted",
        )
        .unwrap();

        assert!(matches!(
            commit_import(&connection, "deleted", &[classified_decision("deleted")]),
            Err(ImportWorkflowError::Validation(message)) if message.contains("unavailable")
        ));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn import_review_rejects_cross_household_rule() {
        let connection = database();
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('other','Other');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                   VALUES('other-expense','other','Other expense','EXPENSE','OTHER');
                 INSERT INTO classification_rules
                   (id,household_id,name,priority,is_enabled,merchant_contains,
                    description_contains,category_account_id,created_at,updated_at)
                   VALUES('other-rule','other','Other rule',1,1,'store',NULL,
                          'other-expense','2026-07-12T00:00:00Z','2026-07-12T00:00:00Z');",
            )
            .unwrap();
        start_import(
            &connection,
            &request("cross-household", "cross-household-doc", '0'),
            "vault://cross-household",
        )
        .unwrap();
        let mut posting = decision("cross-household", 1_000);
        posting.classification_rule_id = Some("other-rule".into());
        posting.expected_classification_rule_updated_at = Some("2026-07-12T00:00:00Z".into());

        assert!(matches!(
            commit_import(&connection, "cross-household", &[posting]),
            Err(ImportWorkflowError::Validation(message)) if message.contains("unavailable")
        ));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn import_review_rejects_disabled_rule() {
        let connection = database();
        install_classification_rule(&connection);
        connection
            .execute(
                "UPDATE classification_rules SET is_enabled=0 WHERE id='rule'",
                [],
            )
            .unwrap();
        start_import(
            &connection,
            &request("disabled", "disabled-doc", '1'),
            "vault://disabled",
        )
        .unwrap();

        assert!(matches!(
            commit_import(&connection, "disabled", &[classified_decision("disabled")]),
            Err(ImportWorkflowError::Validation(message)) if message.contains("changed")
        ));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn import_review_rejects_rule_that_no_longer_matches_reviewed_text() {
        let connection = database();
        install_classification_rule(&connection);
        start_import(
            &connection,
            &request("mismatch", "mismatch-doc", '2'),
            "vault://mismatch",
        )
        .unwrap();
        let mut posting = classified_decision("mismatch");
        posting.payee = Some("Different merchant".into());

        assert!(matches!(
            commit_import(&connection, "mismatch", &[posting]),
            Err(ImportWorkflowError::Validation(message)) if message.contains("no longer matches")
        ));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn import_review_rejects_wrong_rule_category_entry() {
        let connection = database();
        install_classification_rule(&connection);
        start_import(
            &connection,
            &request("category", "category-doc", '3'),
            "vault://category",
        )
        .unwrap();
        let mut posting = classified_decision("category");
        posting.entries[0].account_id = "expense".into();

        assert!(matches!(
            commit_import(&connection, "category", &[posting]),
            Err(ImportWorkflowError::Validation(message)) if message.contains("correctly-sided")
        ));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn import_review_rejects_rule_on_transfer_shape() {
        let connection = database();
        install_classification_rule(&connection);
        start_import(
            &connection,
            &request("transfer", "transfer-doc", '4'),
            "vault://transfer",
        )
        .unwrap();
        let mut posting = classified_decision("transfer");
        posting.transaction_type = "TRANSFER".into();

        assert!(matches!(
            commit_import(&connection, "transfer", &[posting]),
            Err(ImportWorkflowError::Validation(message)) if message.contains("only be applied")
        ));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn import_review_rule_failure_rolls_back_earlier_decisions_in_same_run() {
        let connection = database();
        install_classification_rule(&connection);
        let mut input = request("atomic", "atomic-doc", '5');
        let mut second_candidate = input.candidates[0].clone();
        second_candidate.id = "atomic-candidate-2".into();
        second_candidate.evidence[0].role = "PRIMARY".into();
        input.candidates.push(second_candidate);
        start_import(&connection, &input, "vault://atomic").unwrap();
        let first = classified_decision("atomic");
        let mut second = classified_decision("atomic");
        second.candidate_id = "atomic-candidate-2".into();
        second.transaction_id = "atomic-transaction-2".into();
        second.entries[0].id = "atomic-debit-2".into();
        second.entries[1].id = "atomic-credit-2".into();
        second.payee = Some("Does not match".into());

        assert!(commit_import(&connection, "atomic", &[first, second]).is_err());
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM transaction_candidates WHERE review_status='READY'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT status FROM import_runs WHERE id='atomic'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "REVIEW_REQUIRED"
        );
    }

    #[test]
    fn icloud_source_type_is_preserved_across_document_preview_and_pending_review() {
        let connection = database();
        let mut input = request("icloud-run", "icloud-document", 'd');
        input.source_type = "ICLOUD_PICKER".into();

        start_import(&connection, &input, "vault://icloud-document").unwrap();

        let source_type: String = connection
            .query_row(
                "SELECT sd.source_type FROM import_runs ir \
                 JOIN source_documents sd ON sd.import_run_id=ir.id \
                 WHERE ir.id='icloud-run' AND sd.id='icloud-document'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(source_type, "ICLOUD_PICKER");

        let preview = preview_import(&connection, "icloud-run").unwrap();
        assert_eq!(preview.summary.run_id, "icloud-run");
        assert_eq!(preview.summary.document_id, "icloud-document");
        assert_eq!(preview.source.source_type, "ICLOUD_PICKER");

        let pending = list_pending_reviews(&connection, "household").unwrap();
        let recovered = pending
            .runs
            .iter()
            .find(|run| run.run_id == "icloud-run")
            .expect("iCloud run must remain reviewable");
        assert_eq!(recovered.document_id, "icloud-document");
        assert_eq!(recovered.source_type, "ICLOUD_PICKER");
    }

    #[test]
    fn google_drive_source_type_is_preserved_across_persistence_views() {
        let connection = database();
        let mut input = request("drive-run", "drive-document", 'e');
        input.source_type = "GOOGLE_DRIVE".into();

        start_import(&connection, &input, "vault://drive-document").unwrap();

        let persisted: String = connection
            .query_row(
                "SELECT source_type FROM source_documents WHERE id='drive-document'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(persisted, "GOOGLE_DRIVE");
        let preview = preview_import(&connection, "drive-run").unwrap();
        assert_eq!(preview.source.source_type, "GOOGLE_DRIVE");
        let pending = list_pending_reviews(&connection, "household").unwrap();
        assert_eq!(pending.runs.len(), 1);
        assert_eq!(pending.runs[0].source_type, "GOOGLE_DRIVE");
    }

    #[test]
    fn gmail_source_type_is_preserved_across_persistence_views() {
        let connection = database();
        let mut input = request("gmail-run", "gmail-document", 'f');
        input.source_type = "GMAIL".into();
        input.original_filename = "gmail-message.eml".into();
        input.media_type = "message/rfc822".into();

        start_import(&connection, &input, "vault://gmail-document").unwrap();

        let persisted: String = connection
            .query_row(
                "SELECT source_type FROM source_documents WHERE id='gmail-document'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(persisted, "GMAIL");
        let preview = preview_import(&connection, "gmail-run").unwrap();
        assert_eq!(preview.source.source_type, "GMAIL");
        let pending = list_pending_reviews(&connection, "household").unwrap();
        assert_eq!(pending.runs.len(), 1);
        assert_eq!(pending.runs[0].source_type, "GMAIL");
    }

    #[test]
    fn pending_review_list_is_complete_scoped_safe_and_newest_first() {
        let connection = database();
        let mut older = request("run-older", "doc-older", 'd');
        older.original_filename = "older.csv".into();
        older.adapter_id = Some("bank-v1".into());
        let mut newer = request("run-newer", "doc-newer", 'e');
        newer.original_filename = "newer.csv".into();
        newer.adapter_id = None;
        newer.adapter_version = None;
        start_import(&connection, &older, "vault://must-not-leak-older").unwrap();
        start_import(&connection, &newer, "vault://must-not-leak-newer").unwrap();
        connection
            .execute(
                "UPDATE import_runs SET started_at='2026-07-12T09:00:00Z' WHERE id='run-older'",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE import_runs SET started_at='2026-07-13T09:00:00Z' WHERE id='run-newer'",
                [],
            )
            .unwrap();

        connection
            .execute(
                "INSERT INTO households(id,name) VALUES('other-household','Other')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO import_runs(id,household_id,status,started_at) \
                 VALUES('other-run','other-household','REVIEW_REQUIRED','2026-07-14T09:00:00Z')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO source_documents( \
                   id,household_id,import_run_id,source_type,original_filename,media_type, \
                   byte_size,sha256,storage_path) \
                 VALUES('other-doc','other-household','other-run','MANUAL_UPLOAD','secret.csv', \
                        'text/csv',1,?1,'vault://other-secret')",
                ["f".repeat(64)],
            )
            .unwrap();

        let result = list_pending_reviews(&connection, "household").unwrap();
        assert_eq!(result.household_id, "household");
        assert_eq!(result.runs.len(), 2);
        assert_eq!(result.runs[0].run_id, "run-newer");
        assert_eq!(result.runs[1].run_id, "run-older");
        assert_eq!(result.runs[0].candidate_count, 1);
        assert_eq!(result.runs[0].completion_state, "CANDIDATE_REVIEW");
        assert_eq!(result.runs[0].record_count, 2);
        assert_eq!(result.runs[0].status, "REVIEW_REQUIRED");
        assert_eq!(result.runs[0].adapter_id, None);
        assert_eq!(result.runs[1].adapter_id.as_deref(), Some("bank-v1"));
        assert_eq!(result.runs[1].original_filename, "older.csv");

        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains("vault://"));
        assert!(!json.contains("raw_payload"));
        assert!(!json.contains(&"d".repeat(64)));
        assert!(!json.contains("other-run"));

        commit_import(&connection, "run-newer", &[decision("run-newer", 1_000)]).unwrap();
        assert_eq!(
            list_pending_reviews(&connection, "household")
                .unwrap()
                .runs
                .iter()
                .map(|run| run.run_id.as_str())
                .collect::<Vec<_>>(),
            vec!["run-older"]
        );
    }

    #[test]
    fn pending_review_list_rejects_an_invalid_source_graph() {
        let connection = database();
        connection
            .execute(
                "INSERT INTO import_runs(id,household_id,status) \
                 VALUES('orphan','household','REVIEW_REQUIRED')",
                [],
            )
            .unwrap();
        assert!(matches!(
            list_pending_reviews(&connection, "household"),
            Err(ImportWorkflowError::Validation(message))
                if message == "pending import source graph is invalid"
        ));
    }

    #[test]
    fn pending_review_list_rejects_a_cross_household_source_document() {
        let connection = database();
        connection
            .execute(
                "INSERT INTO households(id,name) VALUES('other-household','Other')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO import_runs(id,household_id,status) \
                 VALUES('cross-run','household','REVIEW_REQUIRED')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO source_documents( \
                   id,household_id,import_run_id,source_type,original_filename,media_type, \
                   byte_size,sha256,storage_path) \
                 VALUES('cross-doc','other-household','cross-run','MANUAL_UPLOAD','cross.csv', \
                        'text/csv',1,?1,'vault://cross')",
                ["a".repeat(64)],
            )
            .unwrap();

        assert!(matches!(
            list_pending_reviews(&connection, "household"),
            Err(ImportWorkflowError::Validation(message))
                if message == "pending import source graph is invalid"
        ));
    }

    #[test]
    fn pending_review_and_preview_reject_an_extra_cross_household_document() {
        let connection = database();
        start_import(
            &connection,
            &request("mixed-run", "valid-doc", 'a'),
            "vault://valid",
        )
        .unwrap();
        connection
            .execute(
                "INSERT INTO households(id,name) VALUES('other-household','Other')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO source_documents( \
                   id,household_id,import_run_id,source_type,original_filename,media_type, \
                   byte_size,sha256,storage_path,imported_at) \
                 VALUES('cross-doc','other-household','mixed-run','MANUAL_UPLOAD','cross-first.csv', \
                        'text/csv',1,?1,'vault://cross','2020-01-01T00:00:00Z')",
                ["b".repeat(64)],
            )
            .unwrap();

        assert!(matches!(
            list_pending_reviews(&connection, "household"),
            Err(ImportWorkflowError::Validation(message))
                if message == "pending import source graph is invalid"
        ));
        assert!(matches!(
            preview_import(&connection, "mixed-run"),
            Err(ImportWorkflowError::Validation(message))
                if message == "import source graph is invalid"
        ));
    }

    #[test]
    fn pending_review_completion_state_distinguishes_ready_and_resumable_sources() {
        let connection = database();
        let cases = [
            ("generic", "generic-doc", 'a', "generic-v1"),
            (
                "portfolio",
                "portfolio-doc",
                'b',
                "securities-asset-snapshot-v1",
            ),
            (
                "brokerage",
                "brokerage-doc",
                'c',
                "japanese-brokerage-transactions-v1",
            ),
            (
                "sbi-brokerage",
                "sbi-brokerage-doc",
                'e',
                "sbi-securities-trade-history-v1",
            ),
            (
                "rakuten-brokerage",
                "rakuten-brokerage-doc",
                'f',
                "rakuten-securities-domestic-trade-history-v1",
            ),
            (
                "monex-brokerage",
                "monex-brokerage-doc",
                '7',
                "monex-us-stock-trade-history-v1",
            ),
            (
                "aggregate",
                "aggregate-doc",
                'd',
                "money-forward-me-asset-trend-v1",
            ),
        ];
        for (run_id, document_id, sha, adapter_id) in cases {
            let mut source = request(run_id, document_id, sha);
            source.adapter_id = Some(adapter_id.into());
            source.candidates.clear();
            start_import(&connection, &source, &format!("vault://{run_id}")).unwrap();
        }
        connection
            .execute(
                "INSERT INTO brokerage_events(id,household_id,source_document_id) \
                 VALUES('event','household','brokerage-doc')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO brokerage_events(id,household_id,source_document_id) \
                 VALUES('sbi-event','household','sbi-brokerage-doc')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO brokerage_events(id,household_id,source_document_id) \
                 VALUES('rakuten-event','household','rakuten-brokerage-doc')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO brokerage_events(id,household_id,source_document_id) \
                 VALUES('monex-event','household','monex-brokerage-doc')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO aggregate_asset_snapshots(id,household_id,source_document_id) \
                 VALUES('aggregate-snapshot','household','aggregate-doc')",
                [],
            )
            .unwrap();

        let result = list_pending_reviews(&connection, "household").unwrap();
        let state = |run_id: &str| {
            result
                .runs
                .iter()
                .find(|run| run.run_id == run_id)
                .unwrap()
                .completion_state
                .as_str()
        };
        assert_eq!(state("generic"), "SOURCE_READY");
        assert_eq!(state("portfolio"), "SOURCE_RESUME_REQUIRED");
        assert_eq!(state("brokerage"), "SOURCE_READY");
        assert_eq!(state("sbi-brokerage"), "SOURCE_READY");
        assert_eq!(state("rakuten-brokerage"), "SOURCE_READY");
        assert_eq!(state("monex-brokerage"), "SOURCE_READY");
        assert_eq!(state("aggregate"), "SOURCE_READY");

        connection
            .execute(
                "INSERT INTO portfolio_snapshots(id,household_id,source_document_id) \
                 VALUES('portfolio-snapshot','household','portfolio-doc')",
                [],
            )
            .unwrap();
        let resumed = list_pending_reviews(&connection, "household").unwrap();
        assert_eq!(
            resumed
                .runs
                .iter()
                .find(|run| run.run_id == "portfolio")
                .unwrap()
                .completion_state,
            "SOURCE_READY"
        );
    }

    #[test]
    fn pending_review_list_fails_instead_of_truncating_over_the_bound() {
        let connection = database();
        let transaction = connection.unchecked_transaction().unwrap();
        for index in 0..=MAX_PENDING_REVIEW_RUNS {
            transaction
                .execute(
                    "INSERT INTO import_runs(id,household_id,status) VALUES(?1,'household','REVIEW_REQUIRED')",
                    [format!("run-{index:03}")],
                )
                .unwrap();
        }
        transaction.commit().unwrap();
        assert!(matches!(
            list_pending_reviews(&connection, "household"),
            Err(ImportWorkflowError::Validation(message))
                if message == "too many pending import reviews"
        ));
    }

    #[test]
    fn same_household_sha_is_idempotent() {
        let connection = database();
        let first = start_import(&connection, &request("run-1", "doc-1", 'a'), "vault://one")
            .expect("first import");
        let second = start_import(&connection, &request("run-2", "doc-2", 'a'), "vault://two")
            .expect("idempotent import");
        assert!(!first.reused_existing);
        assert!(second.reused_existing);
        assert_eq!(second.run_id, "run-1");
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM import_runs", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn import_persists_independent_source_candidate_and_posted_scopes() {
        let connection = database();
        let mut input = request("scope", "scope-doc", 'f');
        input.audience_visibility = AudienceVisibility::Personal;
        input.audience_member_id = Some("member".into());
        input.candidates[0].attribution_kind = AttributionKind::Member;
        input.candidates[0].attributed_member_id = Some("member".into());
        start_import(&connection, &input, "vault://scope").unwrap();
        let preview = preview_import(&connection, "scope").unwrap();
        assert_eq!(preview.source.audience_visibility, "PERSONAL");
        assert_eq!(preview.candidates[0].attribution_kind, "MEMBER");
        assert_eq!(preview.candidates[0].audience_visibility, "SHARED");

        let mut posting = decision("scope", 1_000);
        posting.attribution_kind = AttributionKind::Household;
        posting.audience_visibility = AudienceVisibility::Personal;
        posting.audience_member_id = Some("member".into());
        commit_import(&connection, "scope", &[posting]).unwrap();
        let stored: (String, Option<String>, String, Option<String>) = connection
            .query_row(
                "SELECT attribution_kind, attributed_member_id,
                        audience_visibility, audience_member_id
                 FROM transactions WHERE id = 'scope-transaction'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            stored,
            (
                "HOUSEHOLD".into(),
                None,
                "PERSONAL".into(),
                Some("member".into())
            )
        );
        let source_visibility: String = connection
            .query_row(
                "SELECT audience_visibility FROM source_documents WHERE id = 'scope-doc'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(source_visibility, "PERSONAL");
    }

    #[test]
    fn import_scope_defaults_are_backward_compatible_and_foreign_members_are_atomic() {
        let serialized = serde_json::to_value(request("legacy", "legacy-doc", '9')).unwrap();
        let mut legacy = serialized.as_object().unwrap().clone();
        legacy.remove("audienceVisibility");
        legacy.remove("audienceMemberId");
        let candidates = legacy
            .get_mut("candidates")
            .and_then(serde_json::Value::as_array_mut)
            .unwrap();
        for candidate in candidates {
            let candidate = candidate.as_object_mut().unwrap();
            candidate.remove("attributionKind");
            candidate.remove("attributedMemberId");
            candidate.remove("audienceVisibility");
            candidate.remove("audienceMemberId");
        }
        let legacy: StartImport = serde_json::from_value(legacy.into()).unwrap();
        assert_eq!(legacy.audience_visibility, AudienceVisibility::Shared);
        assert_eq!(
            legacy.candidates[0].attribution_kind,
            AttributionKind::Household
        );

        let connection = database();
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('other','Other');
                 INSERT INTO household_members(id,household_id,display_name,status)
                   VALUES('other-member','other','Other','ACTIVE');",
            )
            .unwrap();
        let mut invalid = request("invalid-scope", "invalid-doc", '8');
        invalid.candidates[0].attribution_kind = AttributionKind::Member;
        invalid.candidates[0].attributed_member_id = Some("other-member".into());
        assert!(matches!(
            start_import(&connection, &invalid, "vault://invalid"),
            Err(ImportWorkflowError::Validation(_))
        ));
        let rows: i64 = connection
            .query_row(
                "SELECT (SELECT count(*) FROM import_runs)
                      + (SELECT count(*) FROM source_documents)
                      + (SELECT count(*) FROM transaction_candidates)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn preview_preserves_multi_row_evidence_without_vault_path() {
        let connection = database();
        start_import(
            &connection,
            &request("run", "doc", 'a'),
            "vault://secret/path",
        )
        .unwrap();
        let preview = preview_import(&connection, "run").unwrap();
        assert_eq!(preview.candidates[0].evidence_count, 2);
        assert_eq!(
            preview.candidates[0].evidence_roles,
            vec!["PRIMARY", "SUPPORTING"]
        );
        assert_eq!(preview.candidates[0].receipt_review, None);
    }

    fn receipt_payload(version: i64, merchant: &str) -> String {
        serde_json::json!({
            "evidenceVersion": version,
            "documentPageNumber": 2,
            "extraction": { "text": "RAW OCR SECRET MUST NEVER LEAK", "regions": [{"text":"SECRET"}] },
            "receipt": {
                "merchant": merchant, "occurredOn": "2026-07-12", "amountJpy": 1200,
                "items": [{
                    "description": "牛乳", "quantity": 2, "amountJpy": 1200,
                    "taxRatePercent": 8, "confidenceBps": 8500,
                    "provenance": {"lineNumber": 4, "regionIndexes": [1, 2], "method": "TEXT_PATTERN"}
                }],
                "taxes": [{
                    "ratePercent": 8, "taxAmountJpy": 88, "taxableAmountJpy": 1112,
                    "confidenceBps": 8000,
                    "provenance": {"lineNumber": 5, "regionIndexes": [3], "method": "TEXT_PATTERN"}
                }],
                "couponAmountJpy": 50, "pointsUsedJpy": 20,
                "couponEvidence": [{"amountJpy": 50, "confidenceBps": 8000, "provenance": {"lineNumber": 6, "regionIndexes": [], "method": "TEXT_PATTERN"}}],
                "pointsUsedEvidence": [{"amountJpy": null, "confidenceBps": 4000, "provenance": {"lineNumber": 7, "regionIndexes": [], "method": "TEXT_PATTERN"}}],
                "subtotalJpy": 1180, "changeJpy": 100, "paymentMethod": "PayPay", "taxMode": "INCLUDED",
                "reconciliation": {"status": "EXACT", "itemTotalJpy": 1200, "totalAmountJpy": 1200, "deltaJpy": 0}
            }
        }).to_string()
    }

    #[test]
    fn preview_exposes_only_bounded_primary_receipt_review_and_recovers_after_restart() {
        let connection = database();
        let mut input = request("receipt-run", "receipt-doc", '7');
        input.records[0].payload_json = receipt_payload(5, "PRIMARY STORE");
        input.records[1].payload_json = receipt_payload(5, "SUPPORTING SECRET STORE");
        start_import(&connection, &input, "vault://receipt-secret").unwrap();

        let preview = preview_import(&connection, "receipt-run").unwrap();
        let receipt = preview.candidates[0].receipt_review.as_ref().unwrap();
        assert_eq!(receipt.merchant.as_deref(), Some("PRIMARY STORE"));
        assert_eq!(receipt.total_amount_jpy, 1200);
        assert_eq!(receipt.items[0].tax_rate_percent, Some(8));
        assert_eq!(receipt.coupon_evidence[0].amount_jpy, Some(50));
        assert_eq!(receipt.points_used_evidence[0].amount_jpy, None);
        assert_eq!(receipt.reconciliation.as_ref().unwrap().status, "EXACT");
        assert_eq!(receipt.provenance.source_record_id, "receipt-run-row-1");
        assert_eq!(receipt.provenance.document_page_number, Some(2));
        let serialized = serde_json::to_string(&preview).unwrap();
        assert!(!serialized.contains("RAW OCR"));
        assert!(!serialized.contains("SECRET"));
        assert!(!serialized.contains("\"extraction\":"));
        assert!(!serialized.contains("regions"));

        let temp = tempfile::tempdir().unwrap();
        let database_path = temp.path().join("recovered.sqlite3");
        connection
            .execute("VACUUM INTO ?1", [database_path.to_string_lossy().as_ref()])
            .unwrap();
        drop(connection);
        let recovered = Connection::open(database_path).unwrap();
        let recovered = preview_import(&recovered, "receipt-run").unwrap();
        assert_eq!(
            recovered.candidates[0].receipt_review,
            preview.candidates[0].receipt_review
        );
        assert_eq!(serde_json::to_string(&recovered).unwrap(), serialized);
    }

    #[test]
    fn malformed_receipt_payload_fails_closed_and_v4_remains_reviewable() {
        let connection = database();
        let mut malformed = request("malformed", "malformed-doc", '6');
        malformed.records[0].payload_json = receipt_payload(5, "BROKEN");
        let mut value: serde_json::Value =
            serde_json::from_str(&malformed.records[0].payload_json).unwrap();
        value["receipt"]["items"][0]["amountJpy"] = serde_json::json!(-1);
        malformed.records[0].payload_json = value.to_string();
        start_import(&connection, &malformed, "vault://malformed").unwrap();
        assert_eq!(
            preview_import(&connection, "malformed").unwrap().candidates[0].receipt_review,
            None
        );

        let mut legacy = request("legacy-receipt", "legacy-receipt-doc", '5');
        let mut value: serde_json::Value =
            serde_json::from_str(&receipt_payload(4, "LEGACY")).unwrap();
        let receipt = value["receipt"].as_object_mut().unwrap();
        receipt.remove("couponEvidence");
        receipt.remove("pointsUsedEvidence");
        receipt.remove("reconciliation");
        receipt["items"][0]
            .as_object_mut()
            .unwrap()
            .remove("taxRatePercent");
        legacy.records[0].payload_json = value.to_string();
        start_import(&connection, &legacy, "vault://legacy").unwrap();
        let legacy = preview_import(&connection, "legacy-receipt").unwrap();
        let review = legacy.candidates[0].receipt_review.as_ref().unwrap();
        assert_eq!(review.items[0].tax_rate_percent, None);
        assert!(review.coupon_evidence.is_empty());
        assert_eq!(review.reconciliation, None);
    }

    #[test]
    fn balanced_commit_posts_transaction_and_all_evidence() {
        let connection = database();
        start_import(&connection, &request("run", "doc", 'a'), "vault://one").unwrap();
        let result = commit_import(&connection, "run", &[decision("run", 1_000)]).unwrap();
        assert_eq!(result.posted_count, 1);
        assert_eq!(
            connection
                .query_row("SELECT calculation_target FROM transactions", [], |row| row
                    .get::<_, i64>(0),)
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM journal_entries", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transaction_sources", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT status FROM import_runs WHERE id='run'", [], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
            "POSTED"
        );
    }

    #[test]
    fn receipt_split_commit_posts_one_balanced_transaction_and_links_each_evidence_once() {
        let connection = database();
        connection
            .execute(
                "INSERT INTO accounts(id, household_id, name, account_kind, account_subtype) \
                 VALUES('expense-household', 'household', 'Household', 'EXPENSE', 'OTHER')",
                [],
            )
            .unwrap();
        let mut input = request("receipt-split", "receipt-split-doc", '7');
        input.records[0].payload_json = receipt_payload(5, "SPLIT STORE");
        input.candidates[0].amount_jpy = 1_200;
        start_import(&connection, &input, "vault://receipt-split").unwrap();

        let mut posting = decision("receipt-split", 1_200);
        posting.entries = vec![
            JournalEntryDecision {
                id: "receipt-split-food-debit".into(),
                account_id: "expense".into(),
                side: "DEBIT".into(),
                amount_jpy: 700,
            },
            JournalEntryDecision {
                id: "receipt-split-household-debit".into(),
                account_id: "expense-household".into(),
                side: "DEBIT".into(),
                amount_jpy: 500,
            },
            JournalEntryDecision {
                id: "receipt-split-payment-credit".into(),
                account_id: "bank".into(),
                side: "CREDIT".into(),
                amount_jpy: 1_200,
            },
        ];

        let result = commit_import(&connection, "receipt-split", &[posting]).unwrap();
        assert_eq!(result.posted_count, 1);
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        let (debit_total, credit_total): (i64, i64) = connection
            .query_row(
                "SELECT COALESCE(SUM(CASE WHEN entry_side='DEBIT' THEN amount_jpy END), 0), \
                        COALESCE(SUM(CASE WHEN entry_side='CREDIT' THEN amount_jpy END), 0) \
                 FROM journal_entries WHERE transaction_id='receipt-split-transaction'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let candidate_total: i64 = connection
            .query_row(
                "SELECT amount_jpy FROM transaction_candidates WHERE id='receipt-split-candidate'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            (debit_total, credit_total, candidate_total),
            (1_200, 1_200, 1_200)
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM transaction_sources \
                     WHERE transaction_id='receipt-split-transaction'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(DISTINCT source_record_id) FROM transaction_sources \
                     WHERE transaction_id='receipt-split-transaction'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT review_status FROM transaction_candidates \
                     WHERE id='receipt-split-candidate'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "POSTED"
        );
    }

    #[test]
    fn receipt_split_candidate_total_mismatch_rolls_back_every_posting_write() {
        let connection = database();
        connection
            .execute(
                "INSERT INTO accounts(id, household_id, name, account_kind, account_subtype) \
                 VALUES('expense-household', 'household', 'Household', 'EXPENSE', 'OTHER')",
                [],
            )
            .unwrap();
        let mut input = request("bad-receipt-split", "bad-receipt-split-doc", '8');
        input.records[0].payload_json = receipt_payload(5, "BAD SPLIT STORE");
        input.candidates[0].amount_jpy = 1_200;
        start_import(&connection, &input, "vault://bad-receipt-split").unwrap();

        let mut posting = decision("bad-receipt-split", 1_199);
        posting.entries = vec![
            JournalEntryDecision {
                id: "bad-receipt-split-food-debit".into(),
                account_id: "expense".into(),
                side: "DEBIT".into(),
                amount_jpy: 700,
            },
            JournalEntryDecision {
                id: "bad-receipt-split-household-debit".into(),
                account_id: "expense-household".into(),
                side: "DEBIT".into(),
                amount_jpy: 499,
            },
            JournalEntryDecision {
                id: "bad-receipt-split-payment-credit".into(),
                account_id: "bank".into(),
                side: "CREDIT".into(),
                amount_jpy: 1_199,
            },
        ];

        assert!(matches!(
            commit_import(&connection, "bad-receipt-split", &[posting]),
            Err(ImportWorkflowError::UnbalancedJournal(candidate))
                if candidate == "bad-receipt-split-candidate"
        ));
        for table in ["transactions", "journal_entries", "transaction_sources"] {
            let count: i64 = connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} must be rolled back");
        }
        assert_eq!(
            connection
                .query_row(
                    "SELECT review_status FROM transaction_candidates \
                     WHERE id='bad-receipt-split-candidate'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "READY"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT status FROM import_runs WHERE id='bad-receipt-split'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "REVIEW_REQUIRED"
        );
    }

    #[test]
    fn zero_candidate_raw_import_commits_without_ledger_rows() {
        let connection = database();
        let mut raw = request("raw", "raw-doc", 'a');
        raw.candidates.clear();
        start_import(&connection, &raw, "vault://raw").unwrap();

        let result = commit_import(&connection, "raw", &[]).unwrap();
        assert_eq!(result.posted_count, 0);
        assert_eq!(
            connection
                .query_row("SELECT status FROM import_runs WHERE id='raw'", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "POSTED"
        );
        let ledger_rows: i64 = connection
            .query_row(
                "SELECT (SELECT count(*) FROM transactions)
                      + (SELECT count(*) FROM journal_entries)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ledger_rows, 0);
        assert!(matches!(
            commit_import(&connection, "raw", &[]),
            Err(ImportWorkflowError::AlreadyPosted)
        ));
    }

    #[test]
    fn candidate_import_still_rejects_zero_posting_decisions() {
        let connection = database();
        start_import(&connection, &request("run", "doc", 'a'), "vault://one").unwrap();
        assert!(matches!(
            commit_import(&connection, "run", &[]),
            Err(ImportWorkflowError::Validation(message))
                if message == "every reviewable candidate needs one posting decision"
        ));
        assert_eq!(
            connection
                .query_row("SELECT status FROM import_runs WHERE id='run'", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "REVIEW_REQUIRED"
        );
    }

    #[test]
    fn money_forward_transfer_preserves_calculation_target_and_external_id_dedup() {
        let connection = database();
        let mut first = request("mf-run", "mf-doc", '1');
        let candidate = &mut first.candidates[0];
        candidate.external_transaction_id = Some("mf-transaction-1".into());
        candidate.external_source = Some("MONEY_FORWARD_ME".into());
        candidate.external_fact_hash = Some("a".repeat(64));
        candidate.calculation_target = false;
        candidate.suggested_transaction_type = Some("TRANSFER".into());
        candidate.institution_raw = Some("Main bank".into());
        candidate.category_major_raw = Some("振替".into());
        candidate.category_minor_raw = Some("カード支払".into());
        candidate.memo_raw = Some("source memo".into());
        start_import(&connection, &first, "vault://mf").unwrap();
        let mut posting = decision("mf-run", 1_000);
        posting.transaction_type = "TRANSFER".into();
        posting.calculation_target = false;
        posting.entries[0].account_id = "card".into();
        commit_import(&connection, "mf-run", &[posting]).unwrap();

        let stored: (i64, String, String) = connection.query_row(
            "SELECT t.calculation_target,k.external_id,k.fact_hash FROM transactions t JOIN transaction_external_keys k ON k.transaction_id=t.id WHERE t.id='mf-run-transaction'",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(stored, (0, "mf-transaction-1".into(), "a".repeat(64)));

        let mut duplicate = request("mf-duplicate", "mf-duplicate-doc", '2');
        duplicate.candidates[0].external_transaction_id = Some("mf-transaction-1".into());
        duplicate.candidates[0].external_source = Some("MONEY_FORWARD_ME".into());
        duplicate.candidates[0].external_fact_hash = Some("a".repeat(64));
        let summary = start_import(&connection, &duplicate, "vault://mf-duplicate").unwrap();
        assert_eq!(summary.candidate_count, 0);
        let evidence_count: i64 = connection.query_row(
            "SELECT count(*) FROM transaction_sources WHERE transaction_id='mf-run-transaction'", [], |row| row.get(0),
        ).unwrap();
        assert_eq!(evidence_count, 4);
        assert!(preview_import(&connection, "mf-duplicate")
            .unwrap()
            .candidates
            .is_empty());
        rollback_import(&connection, "mf-duplicate").unwrap();
        let evidence_after_rollback: i64 = connection.query_row(
            "SELECT count(*) FROM transaction_sources WHERE transaction_id='mf-run-transaction'", [], |row| row.get(0),
        ).unwrap();
        assert_eq!(evidence_after_rollback, 2);

        let mut duplicate_posted = request("mf-duplicate-posted", "mf-duplicate-posted-doc", '4');
        duplicate_posted.candidates[0].external_transaction_id = Some("mf-transaction-1".into());
        duplicate_posted.candidates[0].external_source = Some("MONEY_FORWARD_ME".into());
        duplicate_posted.candidates[0].external_fact_hash = Some("a".repeat(64));
        start_import(
            &connection,
            &duplicate_posted,
            "vault://mf-duplicate-posted",
        )
        .unwrap();
        assert_eq!(
            commit_import(&connection, "mf-duplicate-posted", &[])
                .unwrap()
                .posted_count,
            0
        );

        let mut conflict = request("mf-conflict", "mf-conflict-doc", '3');
        conflict.candidates[0].external_transaction_id = Some("mf-transaction-1".into());
        conflict.candidates[0].external_source = Some("MONEY_FORWARD_ME".into());
        conflict.candidates[0].external_fact_hash = Some("b".repeat(64));
        assert!(matches!(
            start_import(&connection, &conflict, "vault://mf-conflict"),
            Err(ImportWorkflowError::Validation(message)) if message.contains("conflicts")
        ));
        let conflict_run: i64 = connection
            .query_row(
                "SELECT count(*) FROM import_runs WHERE id='mf-conflict'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(conflict_run, 0);
    }

    #[test]
    fn unbalanced_commit_is_rejected_atomically() {
        let connection = database();
        start_import(&connection, &request("run", "doc", 'a'), "vault://one").unwrap();
        assert!(matches!(
            commit_import(&connection, "run", &[decision("run", 999)]),
            Err(ImportWorkflowError::UnbalancedJournal(_))
        ));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT review_status FROM transaction_candidates",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "READY"
        );
    }

    #[test]
    fn rollback_removes_only_staging_and_keeps_audit_run() {
        let connection = database();
        start_import(&connection, &request("run", "doc", 'a'), "vault://one").unwrap();
        rollback_import(&connection, "run").unwrap();
        assert_eq!(
            connection
                .query_row("SELECT status FROM import_runs WHERE id='run'", [], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
            "ROLLED_BACK"
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM source_documents", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transaction_candidates", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn rollback_refuses_a_posted_run() {
        let connection = database();
        start_import(&connection, &request("run", "doc", 'a'), "vault://one").unwrap();
        commit_import(&connection, "run", &[decision("run", 1_000)]).unwrap();
        assert!(matches!(
            rollback_import(&connection, "run"),
            Err(ImportWorkflowError::AlreadyPosted)
        ));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn card_statement_and_later_bank_payment_create_a_reviewable_exact_match() {
        let connection = database();
        let mut statement_request = request("statement-run", "statement-doc", 'd');
        statement_request.candidates[0].account_id = Some("card".into());
        statement_request.card_statements = vec![StartCardStatement {
            id: "statement-1".into(),
            card_account_id: "card".into(),
            issuer: "RAKUTEN_CARD".into(),
            period_start: "2026-07-12".into(),
            period_end: "2026-07-12".into(),
            payment_due_on: None,
            statement_amount_jpy: 1_000,
            lines: vec![StartCardStatementLine {
                candidate_id: "statement-run-candidate".into(),
                statement_line_number: 1,
                billed_amount_jpy: 1_000,
            }],
        }];
        start_import(&connection, &statement_request, "vault://statement").unwrap();
        let purchase = PostingDecision {
            candidate_id: "statement-run-candidate".into(),
            transaction_id: "purchase-transaction".into(),
            transaction_type: "CARD_PURCHASE".into(),
            payee: Some("Store".into()),
            description: None,
            calculation_target: true,
            attribution_kind: AttributionKind::Household,
            attributed_member_id: None,
            audience_visibility: AudienceVisibility::Shared,
            audience_member_id: None,
            classification_rule_id: None,
            expected_classification_rule_updated_at: None,
            entries: vec![
                JournalEntryDecision {
                    id: "purchase-debit".into(),
                    account_id: "expense".into(),
                    side: "DEBIT".into(),
                    amount_jpy: 1_000,
                },
                JournalEntryDecision {
                    id: "purchase-credit".into(),
                    account_id: "card".into(),
                    side: "CREDIT".into(),
                    amount_jpy: 1_000,
                },
            ],
        };
        commit_import(&connection, "statement-run", &[purchase]).unwrap();

        let mut payment_request = request("payment-run", "payment-doc", 'e');
        payment_request.candidates[0].occurred_on = "2026-08-10".into();
        start_import(&connection, &payment_request, "vault://payment").unwrap();
        let payment = PostingDecision {
            candidate_id: "payment-run-candidate".into(),
            transaction_id: "payment-transaction".into(),
            transaction_type: "CARD_PAYMENT".into(),
            payee: Some("Rakuten Card".into()),
            description: None,
            calculation_target: true,
            attribution_kind: AttributionKind::Household,
            attributed_member_id: None,
            audience_visibility: AudienceVisibility::Shared,
            audience_member_id: None,
            classification_rule_id: None,
            expected_classification_rule_updated_at: None,
            entries: vec![
                JournalEntryDecision {
                    id: "payment-debit".into(),
                    account_id: "card".into(),
                    side: "DEBIT".into(),
                    amount_jpy: 1_000,
                },
                JournalEntryDecision {
                    id: "payment-credit".into(),
                    account_id: "bank".into(),
                    side: "CREDIT".into(),
                    amount_jpy: 1_000,
                },
            ],
        };
        commit_import(&connection, "payment-run", &[payment]).unwrap();

        let statement_status: String = connection
            .query_row(
                "SELECT reconciliation_status FROM card_statements WHERE id = 'statement-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let (payment_status, score, linked): (String, i64, String) = connection
            .query_row(
                "SELECT reconciliation_status, match_score_bps, statement_id FROM card_payments",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(statement_status, "UNMATCHED");
        assert_eq!(payment_status, "POSSIBLE_MATCH");
        assert_eq!(score, 8_000);
        assert_eq!(linked, "statement-1");
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM card_statement_transactions",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        let confirmed = confirm_card_match(
            &connection,
            "household",
            "statement-1",
            "payment-transaction-payment",
        )
        .unwrap();
        assert_eq!(confirmed.reconciliation_status, "FULLY_RECONCILED");
        assert_eq!(
            confirm_card_match(
                &connection,
                "household",
                "statement-1",
                "payment-transaction-payment",
            )
            .unwrap(),
            confirmed
        );
    }
}
