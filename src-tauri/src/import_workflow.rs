//! Atomic staging and posting for imported financial records.
//!
//! This module deliberately accepts already-extracted JSON and an opaque vault
//! URI. Raw document bytes never cross this persistence boundary.

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use thiserror::Error;

const MAX_RECORDS: usize = 100_000;
const MAX_CANDIDATES: usize = 100_000;
const MAX_EVIDENCE_PER_CANDIDATE: usize = 128;
const MAX_JSON_BYTES: usize = 1_048_576;
const MAX_TEXT_BYTES: usize = 16_384;

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
    pub records: Vec<ImportSourceRecord>,
    pub candidates: Vec<NormalizedCandidate>,
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
    pub extraction_confidence_bps: Option<i64>,
    pub normalization_confidence_bps: Option<i64>,
    pub review_status: String,
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
    pub extraction_confidence_bps: Option<i64>,
    pub normalization_confidence_bps: Option<i64>,
    pub review_status: String,
    pub evidence_count: u64,
    pub evidence_roles: Vec<String>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostingDecision {
    pub candidate_id: String,
    pub transaction_id: String,
    pub transaction_type: String,
    pub payee: Option<String>,
    pub description: Option<String>,
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

type CandidatePostingRow = (String, Option<String>, String, Option<String>, i64, String);

/// Atomically creates a run, its immutable extracted records and normalized
/// candidates. Re-importing the same household SHA returns the existing import.
pub fn start_import(
    connection: &Connection,
    request: &StartImport,
    vault_storage_uri: &str,
) -> Result<ImportSummary> {
    validate_start(request, vault_storage_uri)?;
    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)?;

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

    if let Some(summary) = existing_summary(&tx, &request.household_id, &request.sha256)? {
        tx.commit()?;
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
          byte_size, sha256, storage_path, source_modified_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
            request.source_modified_at
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
    for candidate in &request.candidates {
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
              extraction_confidence_bps, normalization_confidence_bps, review_status) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
                candidate.review_status
            ],
        )?;
        for evidence in &candidate.evidence {
            tx.execute(
                "INSERT INTO candidate_sources (candidate_id, source_record_id, evidence_role) \
                 VALUES (?1, ?2, ?3)",
                params![candidate.id, evidence.source_record_id, evidence.role],
            )?;
        }
    }
    tx.commit()?;
    Ok(ImportSummary {
        run_id: request.run_id.clone(),
        document_id: request.document_id.clone(),
        status: "REVIEW_REQUIRED".into(),
        record_count: request.records.len() as u64,
        candidate_count: request.candidates.len() as u64,
        reused_existing: false,
    })
}

/// Returns review data without exposing the vault URI or source payload JSON.
pub fn preview_import(connection: &Connection, run_id: &str) -> Result<ImportPreview> {
    validate_id("run_id", run_id)?;
    let (document_id, _household_id, status, source_type, filename, media_type, byte_size, sha256) =
        connection
            .query_row(
                "SELECT sd.id, ir.household_id, ir.status, sd.source_type, \
                        sd.original_filename, sd.media_type, sd.byte_size, sd.sha256 \
                 FROM import_runs ir JOIN source_documents sd ON sd.import_run_id = ir.id \
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
                tc.extraction_confidence_bps, tc.normalization_confidence_bps, tc.review_status \
         FROM transaction_candidates tc \
         JOIN candidate_sources cs ON cs.candidate_id = tc.id \
         JOIN source_records sr ON sr.id = cs.source_record_id \
         JOIN source_documents sd ON sd.id = sr.source_document_id \
         WHERE sd.import_run_id = ?1 ORDER BY tc.occurred_on, tc.id",
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
            row.get::<_, Option<i64>>(9)?,
            row.get::<_, Option<i64>>(10)?,
            row.get::<_, String>(11)?,
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
            extraction,
            normalization,
            review_status,
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
            extraction_confidence_bps: extraction,
            normalization_confidence_bps: normalization,
            review_status,
            evidence_count: roles.len() as u64,
            evidence_roles: roles,
            issues,
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
        },
        candidates,
    })
}

/// Posts caller-approved candidates as balanced double-entry transactions.
pub fn commit_import(
    connection: &Connection,
    run_id: &str,
    decisions: &[PostingDecision],
) -> Result<CommitSummary> {
    validate_id("run_id", run_id)?;
    if decisions.is_empty() {
        return Err(ImportWorkflowError::Validation(
            "no posting decisions".into(),
        ));
    }
    let mut candidate_ids = HashSet::new();
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

    for decision in decisions {
        let candidate: Option<CandidatePostingRow> = tx
            .query_row(
                "SELECT tc.household_id, tc.account_id, tc.occurred_on, tc.posted_on, \
                        tc.amount_jpy, tc.review_status \
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
                    ))
                },
            )
            .optional()?;
        let (candidate_household, _, occurred_on, posted_on, candidate_amount, review_status) =
            candidate.ok_or_else(|| {
                ImportWorkflowError::CandidateOutsideRun(decision.candidate_id.clone())
            })?;
        if candidate_household != household_id
            || !matches!(review_status.as_str(), "PENDING" | "READY")
        {
            return Err(ImportWorkflowError::CandidateOutsideRun(
                decision.candidate_id.clone(),
            ));
        }

        let mut debit = 0_i64;
        let mut credit = 0_i64;
        for entry in &decision.entries {
            let account_kind: String = tx
                .query_row(
                    "SELECT account_kind FROM accounts WHERE id = ?1 AND household_id = ?2",
                    params![entry.account_id, household_id],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| {
                    ImportWorkflowError::Validation(format!(
                        "account outside household: {}",
                        entry.account_id
                    ))
                })?;
            if decision.transaction_type == "CARD_PAYMENT" && account_kind == "EXPENSE" {
                return Err(ImportWorkflowError::Validation(
                    "CARD_PAYMENT cannot post to an expense account".into(),
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
        if debit != credit || debit != candidate_amount {
            return Err(ImportWorkflowError::UnbalancedJournal(
                decision.candidate_id.clone(),
            ));
        }

        tx.execute(
            "INSERT INTO transactions \
             (id, household_id, occurred_on, posted_on, transaction_type, payee, description, status) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'POSTED')",
            params![decision.transaction_id, household_id, occurred_on, posted_on,
                    decision.transaction_type, decision.payee, decision.description],
        )?;
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
    tx.execute(
        "UPDATE import_runs SET status = 'POSTED', \
         completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        [run_id],
    )?;
    tx.commit()?;
    Ok(CommitSummary {
        run_id: run_id.into(),
        posted_count: decisions.len() as u64,
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
        "LOCAL_FOLDER" | "MANUAL_UPLOAD" | "CAMERA_SCAN" | "OTHER"
    ) {
        return Err(ImportWorkflowError::Validation(
            "unsupported source type".into(),
        ));
    }
    validate_sha("document sha256", &request.sha256)?;
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
        ]
        .into_iter()
        .flatten()
        {
            validate_text("candidate text", text, MAX_TEXT_BYTES)?;
        }
    }
    Ok(())
}

fn validate_posting_decision(decision: &PostingDecision) -> Result<()> {
    validate_id("candidate id", &decision.candidate_id)?;
    validate_id("transaction id", &decision.transaction_id)?;
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
                   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
                 CREATE TABLE candidate_sources (
                   candidate_id TEXT NOT NULL REFERENCES transaction_candidates(id) ON DELETE CASCADE,
                   source_record_id TEXT NOT NULL REFERENCES source_records(id), evidence_role TEXT NOT NULL,
                   PRIMARY KEY(candidate_id,source_record_id));
                 CREATE TABLE transactions (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), occurred_on TEXT NOT NULL,
                   posted_on TEXT, transaction_type TEXT NOT NULL, payee TEXT, description TEXT, status TEXT NOT NULL,
                   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                   updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
                 CREATE TABLE transaction_sources (
                   transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                   source_record_id TEXT NOT NULL REFERENCES source_records(id),
                   candidate_id TEXT REFERENCES transaction_candidates(id),
                   PRIMARY KEY(transaction_id,source_record_id));
                 CREATE TABLE journal_entries (
                   id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                   account_id TEXT NOT NULL REFERENCES accounts(id), entry_side TEXT NOT NULL,
                   amount_jpy INTEGER NOT NULL, line_number INTEGER NOT NULL,
                   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                   UNIQUE(transaction_id,line_number));
                 INSERT INTO households(id,name) VALUES('household','Test');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                   VALUES('bank','household','Bank','ASSET','BANK'),
                         ('expense','household','Food','EXPENSE','OTHER');",
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
                extraction_confidence_bps: Some(9_900),
                normalization_confidence_bps: Some(9_500),
                review_status: "READY".into(),
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
        }
    }

    fn decision(run: &str, credit_amount: i64) -> PostingDecision {
        PostingDecision {
            candidate_id: format!("{run}-candidate"),
            transaction_id: format!("{run}-transaction"),
            transaction_type: "EXPENSE".into(),
            payee: Some("Store".into()),
            description: None,
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
    }

    #[test]
    fn balanced_commit_posts_transaction_and_all_evidence() {
        let connection = database();
        start_import(&connection, &request("run", "doc", 'a'), "vault://one").unwrap();
        let result = commit_import(&connection, "run", &[decision("run", 1_000)]).unwrap();
        assert_eq!(result.posted_count, 1);
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
}
