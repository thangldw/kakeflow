//! Passphrase-protected handoff for one mutable Import Inbox review run.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::Zeroizing;

use crate::backup;
use crate::document_vault::DocumentVault;
use crate::import_workflow::{
    self, CandidateEvidence, ImportSourceRecord, NormalizedCandidate, StartCardStatement,
    StartCardStatementLine, StartImport,
};
use crate::persistence;
use crate::record_scope::{AttributionKind, AudienceVisibility};
use crate::sync_foundation;

pub const SCHEMA_VERSION: u32 = 1;
const APPLICATION_ID: i64 = 0x4b465049; // KFPI
const MAX_SOURCE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_RECORDS: usize = 100_000;
const MAX_CANDIDATES: usize = 100_000;
const MAX_STATEMENTS: usize = 16;
const MAX_MANIFEST_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum PendingImportBundleError {
    #[error("pending import handoff input is invalid")]
    InvalidInput,
    #[error("pending import handoff run was not found")]
    NotFound,
    #[error("pending import handoff supports candidate review runs only")]
    UnsupportedRun,
    #[error("pending import handoff exceeds supported limits")]
    LimitExceeded,
    #[error("pending import handoff archive operation failed")]
    Archive,
    #[error("pending import handoff is corrupt")]
    Corrupt,
    #[error("pending import handoff dependency is missing or invalid")]
    MissingDependency,
    #[error("pending import handoff conflicts with local state")]
    Conflict,
    #[error("the matching local import is already terminal")]
    Terminal,
    #[error("pending import handoff database operation failed")]
    Database,
    #[error("pending import handoff vault operation failed")]
    Vault,
    #[error("pending import handoff temporary storage failed")]
    Io,
}

pub type Result<T> = std::result::Result<T, PendingImportBundleError>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingImportExportRequest {
    pub household_id: String,
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingImportExportSummaryDto {
    pub package_id: String,
    pub schema_version: u32,
    pub household_id: String,
    pub portable_run_id: String,
    pub manifest_sha256: String,
    pub source_sha256: String,
    pub record_count: u64,
    pub candidate_count: u64,
    pub statement_count: u64,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingImportAccountDependencyDto {
    pub portable_account_id: String,
    pub name: String,
    pub account_kind: String,
    pub account_subtype: String,
    pub currency: String,
    pub institution_name: Option<String>,
    pub masked_identifier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingImportMemberDependencyDto {
    pub portable_member_id: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingImportStageDto {
    pub package_id: String,
    pub schema_version: u32,
    pub origin_installation_id: String,
    pub portable_run_id: String,
    pub manifest_sha256: String,
    pub source_filename: String,
    pub source_sha256: String,
    pub record_count: u64,
    pub candidate_count: u64,
    pub statement_count: u64,
    pub account_dependencies: Vec<PendingImportAccountDependencyDto>,
    pub member_dependencies: Vec<PendingImportMemberDependencyDto>,
    pub already_applied: bool,
    pub existing_local_run_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingImportAccountMappingDto {
    pub portable_account_id: String,
    pub local_account_id: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingImportMemberMappingDto {
    pub portable_member_id: String,
    pub local_member_id: String,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingImportMappingsDto {
    pub accounts: Vec<PendingImportAccountMappingDto>,
    pub members: Vec<PendingImportMemberMappingDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingImportApplySummaryDto {
    pub package_id: String,
    pub local_run_id: String,
    pub local_document_id: String,
    pub record_count: u64,
    pub candidate_count: u64,
    pub statement_count: u64,
    pub reused_existing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    package_id: String,
    origin_household_id: String,
    origin_installation_id: String,
    created_at: String,
    import: StartImport,
    account_dependencies: Vec<PendingImportAccountDependencyDto>,
    member_dependencies: Vec<PendingImportMemberDependencyDto>,
}

pub struct StagedPendingImport {
    root: TemporaryRoot,
    key: Zeroizing<[u8; 32]>,
    manifest: Manifest,
    manifest_sha256: String,
    target_household_id: String,
    summary: PendingImportStageDto,
}

impl StagedPendingImport {
    pub fn summary(&self) -> &PendingImportStageDto {
        &self.summary
    }

    pub fn target_household_id(&self) -> &str {
        &self.target_household_id
    }
}

struct TemporaryRoot(PathBuf);

impl Drop for TemporaryRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn export_pending_import(
    connection: &Connection,
    live_vault: &DocumentVault,
    request: &PendingImportExportRequest,
    archive_path: &Path,
    passphrase: &str,
) -> Result<PendingImportExportSummaryDto> {
    validate_id(&request.household_id)?;
    validate_id(&request.run_id)?;
    let identity = sync_foundation::get_local_status(connection, &request.household_id)
        .map_err(|_| PendingImportBundleError::Database)?;
    let import = load_import(connection, request)?;
    let adapter = import.adapter_id.as_deref().unwrap_or_default();
    if import.candidates.is_empty()
        || adapter.starts_with("receipt-")
        || matches!(
            adapter,
            "securities-asset-snapshot-v1"
                | "japanese-brokerage-transactions-v1"
                | "sbi-securities-trade-history-v1"
                | "money-forward-me-asset-trend-v1"
        )
    {
        return Err(PendingImportBundleError::UnsupportedRun);
    }
    if import.byte_size < 0 || import.byte_size as u64 > MAX_SOURCE_BYTES {
        return Err(PendingImportBundleError::LimitExceeded);
    }
    let account_dependencies = load_account_dependencies(connection, &import)?;
    let member_dependencies = load_member_dependencies(connection, &import)?;
    // The export timestamp is intentionally the immutable run creation time.
    // Re-exporting an unchanged review must produce the same manifest identity.
    let created_at: String = connection
        .query_row(
            "SELECT started_at FROM import_runs WHERE id=?1 AND household_id=?2",
            params![request.run_id, request.household_id],
            |row| row.get(0),
        )
        .map_err(|_| PendingImportBundleError::Database)?;
    let mut manifest = Manifest {
        schema_version: SCHEMA_VERSION,
        package_id: String::new(),
        origin_household_id: request.household_id.clone(),
        origin_installation_id: identity.device.id,
        created_at,
        import,
        account_dependencies,
        member_dependencies,
    };
    manifest.package_id = manifest_identity(&manifest)?;
    validate_manifest(&manifest)?;
    let encoded = serde_json::to_vec(&manifest).map_err(|_| PendingImportBundleError::Corrupt)?;
    if encoded.len() > MAX_MANIFEST_BYTES {
        return Err(PendingImportBundleError::LimitExceeded);
    }
    let manifest_sha256 = hex_digest(&encoded);

    let source = live_vault
        .read(&manifest.import.sha256)
        .map_err(|_| PendingImportBundleError::Vault)?;
    if source.sha256 != manifest.import.sha256
        || source.mime_type != manifest.import.media_type
        || source.bytes.len() as i64 != manifest.import.byte_size
    {
        return Err(PendingImportBundleError::Corrupt);
    }

    let root = temporary_root("kakeflow-review-export")?;
    let database_path = root.0.join("database").join("kakeflow.db");
    let mut key = Zeroizing::new([0_u8; 32]);
    getrandom::getrandom(key.as_mut()).map_err(|_| PendingImportBundleError::Io)?;
    let container = persistence::create_keyed_container_database(&database_path, key.as_ref())
        .map_err(|_| PendingImportBundleError::Database)?;
    create_manifest_schema(&container)?;
    container
        .execute(
            "INSERT INTO pending_import_manifest(id,payload_json,payload_sha256) VALUES(1,?1,?2)",
            params![
                String::from_utf8(encoded).map_err(|_| PendingImportBundleError::Corrupt)?,
                manifest_sha256
            ],
        )
        .map_err(|_| PendingImportBundleError::Database)?;
    container
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|_| PendingImportBundleError::Database)?;
    drop(container);
    let temporary_vault = DocumentVault::new(root.0.join("vault"), &key)
        .map_err(|_| PendingImportBundleError::Vault)?;
    let stored = temporary_vault
        .put(&source.bytes, &source.mime_type)
        .map_err(|_| PendingImportBundleError::Vault)?;
    if stored.sha256 != manifest.import.sha256 {
        return Err(PendingImportBundleError::Corrupt);
    }
    drop(temporary_vault);
    backup::create_portable_backup(
        &database_path,
        root.0.join("vault"),
        archive_path,
        passphrase,
        &key,
    )
    .map_err(|_| PendingImportBundleError::Archive)?;
    Ok(export_summary(&manifest, &manifest_sha256))
}

pub fn stage_pending_import(
    connection: &Connection,
    archive_path: &Path,
    target_household_id: &str,
    passphrase: &str,
) -> Result<StagedPendingImport> {
    validate_id(target_household_id)?;
    let household_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM households WHERE id=?1)",
            [target_household_id],
            |row| row.get(0),
        )
        .map_err(|_| PendingImportBundleError::Database)?;
    if !household_exists {
        return Err(PendingImportBundleError::MissingDependency);
    }
    let root = temporary_root("kakeflow-review-stage")?;
    let unpacked = root.0.join("unpacked");
    let (archive_summary, key) =
        backup::restore_portable_backup(archive_path, &unpacked, passphrase)
            .map_err(|_| PendingImportBundleError::Archive)?;
    if archive_summary.plaintext_bytes > MAX_SOURCE_BYTES + MAX_MANIFEST_BYTES as u64 {
        return Err(PendingImportBundleError::LimitExceeded);
    }
    let database_path = unpacked.join("database").join("kakeflow.db");
    let container =
        persistence::open_keyed_container_database_read_only(&database_path, key.as_ref())
            .map_err(|_| PendingImportBundleError::Corrupt)?;
    validate_manifest_schema(&container)?;
    let (payload, stored_digest): (String, String) = container
        .query_row(
            "SELECT payload_json,payload_sha256 FROM pending_import_manifest WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| PendingImportBundleError::Corrupt)?;
    if payload.len() > MAX_MANIFEST_BYTES || hex_digest(payload.as_bytes()) != stored_digest {
        return Err(PendingImportBundleError::Corrupt);
    }
    let manifest: Manifest =
        serde_json::from_str(&payload).map_err(|_| PendingImportBundleError::Corrupt)?;
    validate_manifest(&manifest)?;
    let manifest_sha256 = hex_digest(payload.as_bytes());
    let staged_vault = DocumentVault::new(unpacked.join("vault"), &key)
        .map_err(|_| PendingImportBundleError::Vault)?;
    let source = staged_vault
        .read(&manifest.import.sha256)
        .map_err(|_| PendingImportBundleError::Corrupt)?;
    if source.sha256 != manifest.import.sha256
        || source.mime_type != manifest.import.media_type
        || source.bytes.len() as i64 != manifest.import.byte_size
    {
        return Err(PendingImportBundleError::Corrupt);
    }
    let previous = receipt(connection, target_household_id, &manifest)?;
    let summary = PendingImportStageDto {
        package_id: manifest.package_id.clone(),
        schema_version: manifest.schema_version,
        origin_installation_id: manifest.origin_installation_id.clone(),
        portable_run_id: manifest.import.run_id.clone(),
        manifest_sha256: manifest_sha256.clone(),
        source_filename: manifest.import.original_filename.clone(),
        source_sha256: manifest.import.sha256.clone(),
        record_count: manifest.import.records.len() as u64,
        candidate_count: manifest.import.candidates.len() as u64,
        statement_count: manifest.import.card_statements.len() as u64,
        account_dependencies: manifest.account_dependencies.clone(),
        member_dependencies: manifest.member_dependencies.clone(),
        already_applied: previous.is_some(),
        existing_local_run_id: previous,
    };
    Ok(StagedPendingImport {
        root,
        key,
        manifest,
        manifest_sha256,
        target_household_id: target_household_id.to_owned(),
        summary,
    })
}

pub fn apply_pending_import(
    connection: &Connection,
    live_vault: &DocumentVault,
    staged: &StagedPendingImport,
    mappings: &PendingImportMappingsDto,
) -> Result<PendingImportApplySummaryDto> {
    validate_manifest(&staged.manifest)?;
    if let Some(local_run_id) = receipt(connection, &staged.target_household_id, &staged.manifest)?
    {
        let local_document_id: String = connection
            .query_row(
                "SELECT local_document_id FROM pending_import_receipts WHERE household_id=?1 AND origin_installation_id=?2 AND portable_run_id=?3",
                params![staged.target_household_id, staged.manifest.origin_installation_id, staged.manifest.import.run_id],
                |row| row.get(0),
            )
            .map_err(|_| PendingImportBundleError::Database)?;
        return Ok(apply_summary(staged, local_run_id, local_document_id, true));
    }
    let account_map = validate_account_mappings(connection, staged, mappings)?;
    let member_map = validate_member_mappings(connection, staged, mappings)?;
    if let Some(status) = connection
        .query_row(
            "SELECT ir.status FROM source_documents sd JOIN import_runs ir ON ir.id=sd.import_run_id WHERE sd.household_id=?1 AND sd.sha256=?2",
            params![staged.target_household_id, staged.manifest.import.sha256],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| PendingImportBundleError::Database)?
    {
        return Err(if matches!(status.as_str(), "POSTED" | "ROLLED_BACK" | "FAILED") {
            PendingImportBundleError::Terminal
        } else {
            PendingImportBundleError::Conflict
        });
    }
    let transformed = transform_import(staged, &account_map, &member_map)?;
    let staged_vault =
        DocumentVault::new(staged.root.0.join("unpacked").join("vault"), &staged.key)
            .map_err(|_| PendingImportBundleError::Vault)?;
    let source = staged_vault
        .read(&staged.manifest.import.sha256)
        .map_err(|_| PendingImportBundleError::Corrupt)?;
    let stored = live_vault
        .put(&source.bytes, &source.mime_type)
        .map_err(|_| PendingImportBundleError::Vault)?;
    let storage_uri = format!("vault://{}", stored.sha256);
    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(|_| PendingImportBundleError::Database)?;
    let result = apply_transaction(&tx, staged, &transformed, &storage_uri);
    match result {
        Ok(summary) => {
            tx.commit()
                .map_err(|_| PendingImportBundleError::Database)?;
            Ok(summary)
        }
        Err(error) => {
            drop(tx);
            if !stored.deduplicated {
                let _ = live_vault.delete(&stored.sha256);
            }
            Err(error)
        }
    }
}

fn apply_transaction(
    tx: &Transaction<'_>,
    staged: &StagedPendingImport,
    transformed: &StartImport,
    storage_uri: &str,
) -> Result<PendingImportApplySummaryDto> {
    let imported = import_workflow::start_import_in_transaction(tx, transformed, storage_uri)
        .map_err(|_| PendingImportBundleError::Conflict)?;
    if imported.reused_existing || imported.candidate_count != transformed.candidates.len() as u64 {
        return Err(PendingImportBundleError::Conflict);
    }
    tx.execute(
        "INSERT INTO pending_import_receipts(household_id,origin_installation_id,portable_run_id,package_id,manifest_sha256,local_run_id,local_document_id) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            staged.target_household_id,
            staged.manifest.origin_installation_id,
            staged.manifest.import.run_id,
            staged.manifest.package_id,
            staged.manifest_sha256,
            transformed.run_id,
            transformed.document_id
        ],
    )
    .map_err(|_| PendingImportBundleError::Database)?;
    insert_alias(
        tx,
        staged,
        "IMPORT_RUN",
        &staged.manifest.import.run_id,
        &transformed.run_id,
    )?;
    insert_alias(
        tx,
        staged,
        "SOURCE_DOCUMENT",
        &staged.manifest.import.document_id,
        &transformed.document_id,
    )?;
    for (portable, local) in staged
        .manifest
        .import
        .records
        .iter()
        .zip(&transformed.records)
    {
        insert_alias(tx, staged, "SOURCE_RECORD", &portable.id, &local.id)?;
    }
    for (portable, local) in staged
        .manifest
        .import
        .candidates
        .iter()
        .zip(&transformed.candidates)
    {
        insert_alias(tx, staged, "CANDIDATE", &portable.id, &local.id)?;
    }
    for (portable, local) in staged
        .manifest
        .import
        .card_statements
        .iter()
        .zip(&transformed.card_statements)
    {
        insert_alias(tx, staged, "CARD_STATEMENT", &portable.id, &local.id)?;
    }
    Ok(apply_summary(
        staged,
        transformed.run_id.clone(),
        transformed.document_id.clone(),
        false,
    ))
}

fn insert_alias(
    tx: &Transaction<'_>,
    staged: &StagedPendingImport,
    kind: &str,
    portable: &str,
    local: &str,
) -> Result<()> {
    tx.execute(
        "INSERT INTO pending_import_entity_aliases(household_id,origin_installation_id,portable_run_id,entity_kind,portable_entity_id,local_entity_id) VALUES(?1,?2,?3,?4,?5,?6)",
        params![staged.target_household_id, staged.manifest.origin_installation_id, staged.manifest.import.run_id, kind, portable, local],
    )
    .map_err(|_| PendingImportBundleError::Database)?;
    Ok(())
}

fn load_import(
    connection: &Connection,
    request: &PendingImportExportRequest,
) -> Result<StartImport> {
    let row = connection
        .query_row(
            "SELECT ir.status,ir.adapter_id,ir.adapter_version,sd.id,sd.source_type,sd.original_filename,sd.media_type,sd.byte_size,sd.sha256,sd.source_modified_at,sd.audience_visibility,sd.audience_member_id,(SELECT count(*) FROM source_documents x WHERE x.import_run_id=ir.id) FROM import_runs ir JOIN source_documents sd ON sd.import_run_id=ir.id AND sd.household_id=ir.household_id WHERE ir.id=?1 AND ir.household_id=?2",
            params![request.run_id, request.household_id],
            |row| Ok((row.get::<_, String>(0)?,row.get::<_, Option<String>>(1)?,row.get::<_, Option<String>>(2)?,row.get::<_, String>(3)?,row.get::<_, String>(4)?,row.get::<_, String>(5)?,row.get::<_, String>(6)?,row.get::<_, i64>(7)?,row.get::<_, String>(8)?,row.get::<_, Option<String>>(9)?,row.get::<_, String>(10)?,row.get::<_, Option<String>>(11)?,row.get::<_, u64>(12)?)),
        )
        .optional()
        .map_err(|_| PendingImportBundleError::Database)?
        .ok_or(PendingImportBundleError::NotFound)?;
    if row.0 != "REVIEW_REQUIRED" || row.12 != 1 {
        return Err(PendingImportBundleError::UnsupportedRun);
    }
    let mut records_stmt = connection.prepare("SELECT id,row_number,record_hash,raw_payload_json FROM source_records WHERE source_document_id=?1 ORDER BY row_number,id").map_err(|_| PendingImportBundleError::Database)?;
    let records = records_stmt
        .query_map([&row.3], |r| {
            Ok(ImportSourceRecord {
                id: r.get(0)?,
                row_number: r.get(1)?,
                record_hash: r.get(2)?,
                payload_json: r.get(3)?,
            })
        })
        .map_err(|_| PendingImportBundleError::Database)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| PendingImportBundleError::Database)?;
    let mut candidates_stmt = connection.prepare(
        "SELECT DISTINCT c.id,c.account_id,c.occurred_on,c.posted_on,c.amount_jpy,c.direction,c.description_raw,c.merchant_raw,c.external_transaction_id,c.external_source,c.external_fact_hash,c.calculation_target,c.suggested_transaction_type,c.institution_raw,c.category_major_raw,c.category_minor_raw,c.memo_raw,c.extraction_confidence_bps,c.normalization_confidence_bps,c.review_status,c.attribution_kind,c.attributed_member_id,c.audience_visibility,c.audience_member_id FROM transaction_candidates c JOIN candidate_sources cs ON cs.candidate_id=c.id JOIN source_records sr ON sr.id=cs.source_record_id WHERE sr.source_document_id=?1 ORDER BY c.occurred_on,c.id"
    ).map_err(|_| PendingImportBundleError::Database)?;
    let rows = candidates_stmt
        .query_map([&row.3], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, Option<String>>(8)?,
                r.get::<_, Option<String>>(9)?,
                r.get::<_, Option<String>>(10)?,
                r.get::<_, bool>(11)?,
                r.get::<_, Option<String>>(12)?,
                r.get::<_, Option<String>>(13)?,
                r.get::<_, Option<String>>(14)?,
                r.get::<_, Option<String>>(15)?,
                r.get::<_, Option<String>>(16)?,
                r.get::<_, Option<i64>>(17)?,
                r.get::<_, Option<i64>>(18)?,
                r.get::<_, String>(19)?,
                r.get::<_, String>(20)?,
                r.get::<_, Option<String>>(21)?,
                r.get::<_, String>(22)?,
                r.get::<_, Option<String>>(23)?,
            ))
        })
        .map_err(|_| PendingImportBundleError::Database)?;
    let mut candidates = Vec::new();
    for item in rows {
        let c = item.map_err(|_| PendingImportBundleError::Database)?;
        let mut evidence_stmt=connection.prepare("SELECT source_record_id,evidence_role FROM candidate_sources WHERE candidate_id=?1 ORDER BY source_record_id").map_err(|_| PendingImportBundleError::Database)?;
        let evidence = evidence_stmt
            .query_map([&c.0], |e| {
                Ok(CandidateEvidence {
                    source_record_id: e.get(0)?,
                    role: e.get(1)?,
                })
            })
            .map_err(|_| PendingImportBundleError::Database)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| PendingImportBundleError::Database)?;
        candidates.push(NormalizedCandidate {
            id: c.0,
            account_id: c.1,
            occurred_on: c.2,
            posted_on: c.3,
            amount_jpy: c.4,
            direction: c.5,
            description_raw: c.6,
            merchant_raw: c.7,
            external_transaction_id: c.8,
            external_source: c.9,
            external_fact_hash: c.10,
            calculation_target: c.11,
            suggested_transaction_type: c.12,
            institution_raw: c.13,
            category_major_raw: c.14,
            category_minor_raw: c.15,
            memo_raw: c.16,
            extraction_confidence_bps: c.17,
            normalization_confidence_bps: c.18,
            review_status: c.19,
            attribution_kind: parse_attribution(&c.20)?,
            attributed_member_id: c.21,
            audience_visibility: parse_audience(&c.22)?,
            audience_member_id: c.23,
            evidence,
        });
    }
    let mut statements_stmt=connection.prepare("SELECT id,card_account_id,issuer,period_start,period_end,payment_due_on,statement_amount_jpy FROM staged_card_statements WHERE import_run_id=?1 ORDER BY id").map_err(|_| PendingImportBundleError::Database)?;
    let statement_rows = statements_stmt
        .query_map([&request.run_id], |s| {
            Ok((
                s.get::<_, String>(0)?,
                s.get::<_, String>(1)?,
                s.get::<_, String>(2)?,
                s.get::<_, String>(3)?,
                s.get::<_, String>(4)?,
                s.get::<_, Option<String>>(5)?,
                s.get::<_, i64>(6)?,
            ))
        })
        .map_err(|_| PendingImportBundleError::Database)?;
    let mut card_statements = Vec::new();
    for item in statement_rows {
        let s = item.map_err(|_| PendingImportBundleError::Database)?;
        let mut lines_stmt=connection.prepare("SELECT candidate_id,statement_line_number,billed_amount_jpy FROM staged_card_statement_candidates WHERE statement_id=?1 ORDER BY statement_line_number").map_err(|_|PendingImportBundleError::Database)?;
        let lines = lines_stmt
            .query_map([&s.0], |l| {
                Ok(StartCardStatementLine {
                    candidate_id: l.get(0)?,
                    statement_line_number: l.get(1)?,
                    billed_amount_jpy: l.get(2)?,
                })
            })
            .map_err(|_| PendingImportBundleError::Database)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| PendingImportBundleError::Database)?;
        card_statements.push(StartCardStatement {
            id: s.0,
            card_account_id: s.1,
            issuer: s.2,
            period_start: s.3,
            period_end: s.4,
            payment_due_on: s.5,
            statement_amount_jpy: s.6,
            lines,
        });
    }
    Ok(StartImport {
        run_id: request.run_id.clone(),
        document_id: row.3,
        household_id: request.household_id.clone(),
        source_type: row.4,
        original_filename: row.5,
        media_type: row.6,
        byte_size: row.7,
        sha256: row.8,
        source_modified_at: row.9,
        adapter_id: row.1,
        adapter_version: row.2,
        audience_visibility: parse_audience(&row.10)?,
        audience_member_id: row.11,
        records,
        candidates,
        card_statements,
    })
}

fn load_account_dependencies(
    connection: &Connection,
    import: &StartImport,
) -> Result<Vec<PendingImportAccountDependencyDto>> {
    let ids = import
        .candidates
        .iter()
        .filter_map(|c| c.account_id.as_ref())
        .chain(import.card_statements.iter().map(|s| &s.card_account_id))
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut result = Vec::new();
    for id in ids {
        let dep=connection.query_row("SELECT id,name,account_kind,account_subtype,currency,institution_name,masked_identifier FROM accounts WHERE id=?1 AND household_id=?2",params![id,import.household_id],|r|Ok(PendingImportAccountDependencyDto{portable_account_id:r.get(0)?,name:r.get(1)?,account_kind:r.get(2)?,account_subtype:r.get(3)?,currency:r.get(4)?,institution_name:r.get(5)?,masked_identifier:r.get(6)?})).optional().map_err(|_|PendingImportBundleError::Database)?.ok_or(PendingImportBundleError::MissingDependency)?;
        result.push(dep);
    }
    Ok(result)
}

fn load_member_dependencies(
    connection: &Connection,
    import: &StartImport,
) -> Result<Vec<PendingImportMemberDependencyDto>> {
    let ids = import
        .audience_member_id
        .iter()
        .chain(
            import
                .candidates
                .iter()
                .filter_map(|c| c.attributed_member_id.as_ref()),
        )
        .chain(
            import
                .candidates
                .iter()
                .filter_map(|c| c.audience_member_id.as_ref()),
        )
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut result = Vec::new();
    for id in ids {
        let dep=connection.query_row("SELECT id,display_name,coalesce(relationship_label,'MEMBER') FROM household_members WHERE id=?1 AND household_id=?2",params![id,import.household_id],|r|Ok(PendingImportMemberDependencyDto{portable_member_id:r.get(0)?,display_name:r.get(1)?,role:r.get(2)?})).optional().map_err(|_|PendingImportBundleError::Database)?.ok_or(PendingImportBundleError::MissingDependency)?;
        result.push(dep);
    }
    Ok(result)
}

fn validate_account_mappings(
    connection: &Connection,
    staged: &StagedPendingImport,
    mappings: &PendingImportMappingsDto,
) -> Result<HashMap<String, String>> {
    if mappings.accounts.len() != staged.manifest.account_dependencies.len() {
        return Err(PendingImportBundleError::MissingDependency);
    }
    let expected = staged
        .manifest
        .account_dependencies
        .iter()
        .map(|d| (d.portable_account_id.as_str(), d))
        .collect::<BTreeMap<_, _>>();
    let mut result = HashMap::new();
    for mapping in &mappings.accounts {
        let dep = expected
            .get(mapping.portable_account_id.as_str())
            .ok_or(PendingImportBundleError::InvalidInput)?;
        if result
            .insert(
                mapping.portable_account_id.clone(),
                mapping.local_account_id.clone(),
            )
            .is_some()
        {
            return Err(PendingImportBundleError::InvalidInput);
        }
        let local:Option<(String,String,String)>=connection.query_row("SELECT account_kind,account_subtype,currency FROM accounts WHERE id=?1 AND household_id=?2 AND is_archived=0",params![mapping.local_account_id,staged.target_household_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|_|PendingImportBundleError::Database)?;
        let local = local.ok_or(PendingImportBundleError::MissingDependency)?;
        if local.0 != dep.account_kind || local.1 != dep.account_subtype || local.2 != dep.currency
        {
            return Err(PendingImportBundleError::MissingDependency);
        }
    }
    Ok(result)
}

fn validate_member_mappings(
    connection: &Connection,
    staged: &StagedPendingImport,
    mappings: &PendingImportMappingsDto,
) -> Result<HashMap<String, String>> {
    if mappings.members.len() != staged.manifest.member_dependencies.len() {
        return Err(PendingImportBundleError::MissingDependency);
    }
    let expected = staged
        .manifest
        .member_dependencies
        .iter()
        .map(|d| d.portable_member_id.as_str())
        .collect::<BTreeSet<_>>();
    let mut result = HashMap::new();
    for mapping in &mappings.members {
        if !expected.contains(mapping.portable_member_id.as_str())
            || result
                .insert(
                    mapping.portable_member_id.clone(),
                    mapping.local_member_id.clone(),
                )
                .is_some()
        {
            return Err(PendingImportBundleError::InvalidInput);
        }
        let valid:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM household_members WHERE id=?1 AND household_id=?2 AND status='ACTIVE')",params![mapping.local_member_id,staged.target_household_id],|r|r.get(0)).map_err(|_|PendingImportBundleError::Database)?;
        if !valid {
            return Err(PendingImportBundleError::MissingDependency);
        }
    }
    Ok(result)
}

fn transform_import(
    staged: &StagedPendingImport,
    accounts: &HashMap<String, String>,
    members: &HashMap<String, String>,
) -> Result<StartImport> {
    let mut import = staged.manifest.import.clone();
    let origin = &staged.manifest.origin_installation_id;
    let target = &staged.target_household_id;
    let record_ids = import
        .records
        .iter()
        .map(|r| (r.id.clone(), deterministic_id("pir", target, origin, &r.id)))
        .collect::<HashMap<_, _>>();
    let candidate_ids = import
        .candidates
        .iter()
        .map(|c| (c.id.clone(), deterministic_id("pic", target, origin, &c.id)))
        .collect::<HashMap<_, _>>();
    import.household_id = staged.target_household_id.clone();
    import.run_id = deterministic_id("pih", target, origin, &import.run_id);
    import.document_id = deterministic_id("pid", target, origin, &import.document_id);
    import.audience_member_id = map_optional(&import.audience_member_id, members)?;
    for record in &mut import.records {
        record.id = record_ids[&record.id].clone();
    }
    for candidate in &mut import.candidates {
        candidate.id = candidate_ids[&candidate.id].clone();
        candidate.account_id = map_optional(&candidate.account_id, accounts)?;
        candidate.attributed_member_id = map_optional(&candidate.attributed_member_id, members)?;
        candidate.audience_member_id = map_optional(&candidate.audience_member_id, members)?;
        for evidence in &mut candidate.evidence {
            evidence.source_record_id = record_ids
                .get(&evidence.source_record_id)
                .ok_or(PendingImportBundleError::Corrupt)?
                .clone();
        }
    }
    for statement in &mut import.card_statements {
        statement.id = deterministic_id("pis", target, origin, &statement.id);
        statement.card_account_id = accounts
            .get(&statement.card_account_id)
            .ok_or(PendingImportBundleError::MissingDependency)?
            .clone();
        for line in &mut statement.lines {
            line.candidate_id = candidate_ids
                .get(&line.candidate_id)
                .ok_or(PendingImportBundleError::Corrupt)?
                .clone();
        }
    }
    Ok(import)
}

fn map_optional(value: &Option<String>, map: &HashMap<String, String>) -> Result<Option<String>> {
    value
        .as_ref()
        .map(|v| {
            map.get(v)
                .cloned()
                .ok_or(PendingImportBundleError::MissingDependency)
        })
        .transpose()
}

fn receipt(
    connection: &Connection,
    household_id: &str,
    manifest: &Manifest,
) -> Result<Option<String>> {
    let row=connection.query_row("SELECT receipt.manifest_sha256,receipt.local_run_id,run.status FROM pending_import_receipts receipt JOIN import_runs run ON run.id=receipt.local_run_id AND run.household_id=receipt.household_id WHERE receipt.household_id=?1 AND receipt.origin_installation_id=?2 AND receipt.portable_run_id=?3",params![household_id,manifest.origin_installation_id,manifest.import.run_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).optional().map_err(|_|PendingImportBundleError::Database)?;
    if let Some((digest, run, status)) = row {
        let current = hex_digest(
            &serde_json::to_vec(manifest).map_err(|_| PendingImportBundleError::Corrupt)?,
        );
        if digest != current {
            return Err(PendingImportBundleError::Conflict);
        }
        if status != "REVIEW_REQUIRED" {
            return Err(PendingImportBundleError::Terminal);
        }
        return Ok(Some(run));
    }
    Ok(None)
}

fn validate_manifest(manifest: &Manifest) -> Result<()> {
    if manifest.schema_version != SCHEMA_VERSION
        || manifest.package_id != manifest_identity(manifest)?
        || manifest.import.candidates.is_empty()
        || manifest.import.candidates.len() > MAX_CANDIDATES
        || manifest.import.records.len() > MAX_RECORDS
        || manifest.import.card_statements.len() > MAX_STATEMENTS
        || manifest.import.byte_size < 0
        || manifest.import.byte_size as u64 > MAX_SOURCE_BYTES
    {
        return Err(PendingImportBundleError::Corrupt);
    }
    let adapter = manifest.import.adapter_id.as_deref().unwrap_or_default();
    if adapter.starts_with("receipt-")
        || matches!(
            adapter,
            "securities-asset-snapshot-v1"
                | "japanese-brokerage-transactions-v1"
                | "sbi-securities-trade-history-v1"
                | "money-forward-me-asset-trend-v1"
        )
    {
        return Err(PendingImportBundleError::UnsupportedRun);
    }
    Ok(())
}

fn create_manifest_schema(connection: &Connection) -> Result<()> {
    connection.execute_batch(&format!("PRAGMA application_id={APPLICATION_ID}; CREATE TABLE pending_import_manifest(id INTEGER PRIMARY KEY CHECK(id=1),payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64)) STRICT;")).map_err(|_|PendingImportBundleError::Database)
}
fn validate_manifest_schema(connection: &Connection) -> Result<()> {
    let app: i64 = connection
        .query_row("PRAGMA application_id", [], |r| r.get(0))
        .map_err(|_| PendingImportBundleError::Corrupt)?;
    let count:u64=connection.query_row("SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='pending_import_manifest'",[],|r|r.get(0)).map_err(|_|PendingImportBundleError::Corrupt)?;
    if app != APPLICATION_ID || count != 1 {
        return Err(PendingImportBundleError::Corrupt);
    }
    Ok(())
}
fn manifest_identity(manifest: &Manifest) -> Result<String> {
    let mut clone = manifest.clone();
    clone.package_id.clear();
    let bytes = serde_json::to_vec(&clone).map_err(|_| PendingImportBundleError::Corrupt)?;
    Ok(hex_digest(&bytes))
}
fn export_summary(manifest: &Manifest, digest: &str) -> PendingImportExportSummaryDto {
    PendingImportExportSummaryDto {
        package_id: manifest.package_id.clone(),
        schema_version: manifest.schema_version,
        household_id: manifest.origin_household_id.clone(),
        portable_run_id: manifest.import.run_id.clone(),
        manifest_sha256: digest.to_owned(),
        source_sha256: manifest.import.sha256.clone(),
        record_count: manifest.import.records.len() as u64,
        candidate_count: manifest.import.candidates.len() as u64,
        statement_count: manifest.import.card_statements.len() as u64,
        byte_size: manifest.import.byte_size as u64,
    }
}
fn apply_summary(
    staged: &StagedPendingImport,
    local_run_id: String,
    local_document_id: String,
    reused_existing: bool,
) -> PendingImportApplySummaryDto {
    PendingImportApplySummaryDto {
        package_id: staged.manifest.package_id.clone(),
        local_run_id,
        local_document_id,
        record_count: staged.manifest.import.records.len() as u64,
        candidate_count: staged.manifest.import.candidates.len() as u64,
        statement_count: staged.manifest.import.card_statements.len() as u64,
        reused_existing,
    }
}
fn temporary_root(prefix: &str) -> Result<TemporaryRoot> {
    let base = std::env::temp_dir();
    for _ in 0..16 {
        let mut random = [0u8; 16];
        getrandom::getrandom(&mut random).map_err(|_| PendingImportBundleError::Io)?;
        let name = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let path = base.join(format!("{prefix}-{name}"));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(TemporaryRoot(path)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(PendingImportBundleError::Io),
        }
    }
    Err(PendingImportBundleError::Io)
}
fn deterministic_id(prefix: &str, target_household: &str, origin: &str, portable: &str) -> String {
    format!(
        "{prefix}-{}",
        &hex_digest(format!("{target_household}\0{origin}\0{portable}").as_bytes())[..32]
    )
}
fn hex_digest(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}
fn validate_id(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 255 || value.chars().any(char::is_control) {
        Err(PendingImportBundleError::InvalidInput)
    } else {
        Ok(())
    }
}
fn parse_attribution(value: &str) -> Result<AttributionKind> {
    match value {
        "HOUSEHOLD" => Ok(AttributionKind::Household),
        "MEMBER" => Ok(AttributionKind::Member),
        _ => Err(PendingImportBundleError::Corrupt),
    }
}
fn parse_audience(value: &str) -> Result<AudienceVisibility> {
    match value {
        "SHARED" => Ok(AudienceVisibility::Shared),
        "PERSONAL" => Ok(AudienceVisibility::Personal),
        _ => Err(PendingImportBundleError::Corrupt),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    const PASSPHRASE: &str = "correct horse battery staple";

    fn seed_household(state: &AppState, account_id: &str, account_name: &str) {
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Family')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES(?1,'family',?2,'ASSET','BANK')",
                    params![account_id, account_name],
                )?;
                Ok(())
            })
            .unwrap();
    }

    fn seed_pending_source(state: &AppState, vault: &DocumentVault) {
        seed_household(state, "source-bank", "Source Bank");
        let bytes = b"date,merchant,amount\n2026-07-12,STORE,1200\n";
        let stored = vault.put(bytes, "text/csv").unwrap();
        let request = StartImport {
            run_id: "portable-run".into(),
            document_id: "portable-document".into(),
            household_id: "family".into(),
            source_type: "MANUAL_UPLOAD".into(),
            original_filename: "bank.csv".into(),
            media_type: "text/csv".into(),
            byte_size: bytes.len() as i64,
            sha256: stored.sha256.clone(),
            source_modified_at: Some("2026-07-12T00:00:00Z".into()),
            adapter_id: Some("japanese-bank-ledger-v1".into()),
            adapter_version: Some("1".into()),
            audience_visibility: AudienceVisibility::Shared,
            audience_member_id: None,
            records: vec![ImportSourceRecord {
                id: "portable-record".into(),
                row_number: 2,
                record_hash: hex_digest(b"record"),
                payload_json: r#"{"date":"2026-07-12","amount":1200}"#.into(),
            }],
            candidates: vec![NormalizedCandidate {
                id: "portable-candidate".into(),
                account_id: Some("source-bank".into()),
                occurred_on: "2026-07-12".into(),
                posted_on: None,
                amount_jpy: 1200,
                direction: "OUT".into(),
                description_raw: Some("STORE".into()),
                merchant_raw: Some("STORE".into()),
                external_transaction_id: None,
                external_source: None,
                external_fact_hash: None,
                calculation_target: true,
                suggested_transaction_type: None,
                institution_raw: None,
                category_major_raw: None,
                category_minor_raw: None,
                memo_raw: None,
                extraction_confidence_bps: Some(10_000),
                normalization_confidence_bps: Some(10_000),
                review_status: "PENDING".into(),
                attribution_kind: AttributionKind::Household,
                attributed_member_id: None,
                audience_visibility: AudienceVisibility::Shared,
                audience_member_id: None,
                evidence: vec![CandidateEvidence {
                    source_record_id: "portable-record".into(),
                    role: "PRIMARY".into(),
                }],
            }],
            card_statements: Vec::new(),
        };
        state
            .with_connection(|connection| {
                Ok(import_workflow::start_import(
                    connection,
                    &request,
                    &format!("vault://{}", stored.sha256),
                )
                .unwrap())
            })
            .unwrap();
    }

    fn export_fixture(
        temp: &tempfile::TempDir,
    ) -> (
        PathBuf,
        AppState,
        DocumentVault,
        PendingImportExportSummaryDto,
    ) {
        let source_state = AppState::in_memory(&[1_u8; 32]).unwrap();
        let source_vault =
            DocumentVault::new(temp.path().join("source-vault"), &[2_u8; 32]).unwrap();
        seed_pending_source(&source_state, &source_vault);
        let archive = temp.path().join("review.kakeflow-review");
        let summary = source_state
            .with_connection(|connection| {
                Ok(export_pending_import(
                    connection,
                    &source_vault,
                    &PendingImportExportRequest {
                        household_id: "family".into(),
                        run_id: "portable-run".into(),
                    },
                    &archive,
                    PASSPHRASE,
                )
                .unwrap())
            })
            .unwrap();
        (archive, source_state, source_vault, summary)
    }

    #[test]
    fn candidate_review_round_trips_between_databases_and_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let (archive, source_state, source_vault, exported) = export_fixture(&temp);
        assert_eq!(exported.candidate_count, 1);
        assert_eq!(exported.record_count, 1);
        let second_archive = temp.path().join("review-again.kakeflow-review");
        let reexported = source_state
            .with_connection(|connection| {
                Ok(export_pending_import(
                    connection,
                    &source_vault,
                    &PendingImportExportRequest {
                        household_id: "family".into(),
                        run_id: "portable-run".into(),
                    },
                    &second_archive,
                    PASSPHRASE,
                )
                .unwrap())
            })
            .unwrap();
        assert_eq!(reexported.package_id, exported.package_id);
        assert_eq!(reexported.manifest_sha256, exported.manifest_sha256);

        let receiver = AppState::in_memory(&[3_u8; 32]).unwrap();
        let receiver_vault =
            DocumentVault::new(temp.path().join("receiver-vault"), &[4_u8; 32]).unwrap();
        seed_household(&receiver, "target-bank", "Target Bank");
        let staged = receiver
            .with_connection(|connection| {
                Ok(stage_pending_import(connection, &archive, "family", PASSPHRASE).unwrap())
            })
            .unwrap();
        assert!(!staged.summary().already_applied);
        assert_eq!(staged.summary().account_dependencies.len(), 1);
        let mappings = PendingImportMappingsDto {
            accounts: vec![PendingImportAccountMappingDto {
                portable_account_id: "source-bank".into(),
                local_account_id: "target-bank".into(),
            }],
            members: Vec::new(),
        };
        let first = receiver
            .with_connection(|connection| {
                Ok(apply_pending_import(connection, &receiver_vault, &staged, &mappings).unwrap())
            })
            .unwrap();
        assert!(!first.reused_existing);
        assert_ne!(first.local_run_id, "portable-run");
        receiver
            .with_connection(|connection| {
                let account: String = connection.query_row(
                    "SELECT account_id FROM transaction_candidates WHERE household_id='family'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(account, "target-bank");
                let transactions: u64 = connection.query_row(
                    "SELECT count(*) FROM transactions WHERE household_id='family'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(transactions, 0, "handoff must never carry approvals");
                let hash: String = connection.query_row(
                    "SELECT sha256 FROM source_documents WHERE id=?1",
                    [&first.local_document_id],
                    |row| row.get(0),
                )?;
                let bytes = receiver_vault.read(&hash).unwrap().bytes;
                assert_eq!(bytes, b"date,merchant,amount\n2026-07-12,STORE,1200\n");
                Ok(())
            })
            .unwrap();

        let second = receiver
            .with_connection(|connection| {
                Ok(apply_pending_import(connection, &receiver_vault, &staged, &mappings).unwrap())
            })
            .unwrap();
        assert!(second.reused_existing);
        assert_eq!(second.local_run_id, first.local_run_id);
        receiver
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE import_runs SET status='POSTED' WHERE id=?1",
                    [&first.local_run_id],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(matches!(
            receiver
                .with_connection(|connection| Ok(apply_pending_import(
                    connection,
                    &receiver_vault,
                    &staged,
                    &mappings
                )))
                .unwrap(),
            Err(PendingImportBundleError::Terminal)
        ));
    }

    #[test]
    fn wrong_passphrase_tamper_and_missing_mapping_do_not_apply() {
        let temp = tempfile::tempdir().unwrap();
        let (archive, _source_state, _source_vault, _summary) = export_fixture(&temp);
        let receiver = AppState::in_memory(&[5_u8; 32]).unwrap();
        let receiver_vault =
            DocumentVault::new(temp.path().join("receiver-vault"), &[6_u8; 32]).unwrap();
        seed_household(&receiver, "target-bank", "Target Bank");
        assert!(matches!(
            receiver
                .with_connection(|connection| Ok(stage_pending_import(
                    connection,
                    &archive,
                    "family",
                    "wrong passphrase but long enough"
                )))
                .unwrap(),
            Err(PendingImportBundleError::Archive)
        ));
        let staged = receiver
            .with_connection(|connection| {
                Ok(stage_pending_import(connection, &archive, "family", PASSPHRASE).unwrap())
            })
            .unwrap();
        assert!(matches!(
            receiver
                .with_connection(|connection| Ok(apply_pending_import(
                    connection,
                    &receiver_vault,
                    &staged,
                    &PendingImportMappingsDto::default()
                )))
                .unwrap(),
            Err(PendingImportBundleError::MissingDependency)
        ));
        receiver
            .with_connection(|connection| {
                let count: u64 = connection.query_row(
                    "SELECT count(*) FROM pending_import_receipts",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(count, 0);
                Ok(())
            })
            .unwrap();

        let tampered = temp.path().join("tampered.kakeflow-review");
        let mut bytes = fs::read(&archive).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        fs::write(&tampered, bytes).unwrap();
        assert!(receiver
            .with_connection(|connection| Ok(stage_pending_import(
                connection, &tampered, "family", PASSPHRASE
            )))
            .unwrap()
            .is_err());
    }

    #[test]
    fn receipt_adapter_is_rejected_without_creating_archive() {
        let temp = tempfile::tempdir().unwrap();
        let state = AppState::in_memory(&[7_u8; 32]).unwrap();
        let vault = DocumentVault::new(temp.path().join("vault"), &[8_u8; 32]).unwrap();
        seed_pending_source(&state, &vault);
        state
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE import_runs SET adapter_id='receipt-text-v2' WHERE id='portable-run'",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let archive = temp.path().join("receipt.kakeflow-review");
        let result = state
            .with_connection(|connection| {
                Ok(export_pending_import(
                    connection,
                    &vault,
                    &PendingImportExportRequest {
                        household_id: "family".into(),
                        run_id: "portable-run".into(),
                    },
                    &archive,
                    PASSPHRASE,
                ))
            })
            .unwrap();
        assert!(matches!(
            result,
            Err(PendingImportBundleError::UnsupportedRun)
        ));
        assert!(!archive.exists());
    }

    #[test]
    fn member_card_and_evidence_graph_round_trip_with_explicit_mappings() {
        let temp = tempfile::tempdir().unwrap();
        let source = AppState::in_memory(&[9_u8; 32]).unwrap();
        let source_vault =
            DocumentVault::new(temp.path().join("source-vault"), &[10_u8; 32]).unwrap();
        seed_pending_source(&source, &source_vault);
        source
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO household_members(id,household_id,display_name,relationship_label,status,sort_order) VALUES('source-member','family','Source Member','OWNER','ACTIVE',1)",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES('source-card','family','Source Card','LIABILITY','CREDIT_CARD')",
                    [],
                )?;
                connection.execute(
                    "UPDATE source_documents SET audience_visibility='PERSONAL',audience_member_id='source-member' WHERE id='portable-document'",
                    [],
                )?;
                connection.execute(
                    "UPDATE transaction_candidates SET attribution_kind='MEMBER',attributed_member_id='source-member',audience_visibility='PERSONAL',audience_member_id='source-member' WHERE id='portable-candidate'",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO staged_card_statements(id,import_run_id,household_id,card_account_id,issuer,period_start,period_end,statement_amount_jpy) VALUES('portable-statement','portable-run','family','source-card','Issuer','2026-07-01','2026-07-31',1200)",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO staged_card_statement_candidates(statement_id,candidate_id,statement_line_number,billed_amount_jpy) VALUES('portable-statement','portable-candidate',1,1200)",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let archive = temp.path().join("member-card.kakeflow-review");
        source
            .with_connection(|connection| {
                Ok(export_pending_import(
                    connection,
                    &source_vault,
                    &PendingImportExportRequest {
                        household_id: "family".into(),
                        run_id: "portable-run".into(),
                    },
                    &archive,
                    PASSPHRASE,
                )
                .unwrap())
            })
            .unwrap();

        let receiver = AppState::in_memory(&[11_u8; 32]).unwrap();
        let receiver_vault =
            DocumentVault::new(temp.path().join("receiver-vault"), &[12_u8; 32]).unwrap();
        seed_household(&receiver, "target-bank", "Target Bank");
        receiver
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES('target-card','family','Target Card','LIABILITY','CREDIT_CARD')",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let staged = receiver
            .with_connection(|connection| {
                Ok(stage_pending_import(connection, &archive, "family", PASSPHRASE).unwrap())
            })
            .unwrap();
        assert_eq!(staged.summary().account_dependencies.len(), 2);
        assert_eq!(staged.summary().member_dependencies.len(), 1);
        assert_eq!(staged.summary().statement_count, 1);
        let applied = receiver
            .with_connection(|connection| {
                Ok(apply_pending_import(
                    connection,
                    &receiver_vault,
                    &staged,
                    &PendingImportMappingsDto {
                        accounts: vec![
                            PendingImportAccountMappingDto {
                                portable_account_id: "source-bank".into(),
                                local_account_id: "target-bank".into(),
                            },
                            PendingImportAccountMappingDto {
                                portable_account_id: "source-card".into(),
                                local_account_id: "target-card".into(),
                            },
                        ],
                        members: vec![PendingImportMemberMappingDto {
                            portable_member_id: "source-member".into(),
                            local_member_id: "family-member-primary".into(),
                        }],
                    },
                )
                .unwrap())
            })
            .unwrap();
        receiver
            .with_connection(|connection| {
                let candidate: (String, String, String, String) = connection.query_row(
                    "SELECT attributed_member_id,audience_member_id,attribution_kind,audience_visibility FROM transaction_candidates WHERE household_id='family'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )?;
                assert_eq!(candidate, ("family-member-primary".into(), "family-member-primary".into(), "MEMBER".into(), "PERSONAL".into()));
                let document_member: String = connection.query_row(
                    "SELECT audience_member_id FROM source_documents WHERE id=?1",
                    [&applied.local_document_id],
                    |row| row.get(0),
                )?;
                assert_eq!(document_member, "family-member-primary");
                let card: (String, u64) = connection.query_row(
                    "SELECT card_account_id,(SELECT count(*) FROM staged_card_statement_candidates WHERE statement_id=s.id) FROM staged_card_statements s WHERE import_run_id=?1",
                    [&applied.local_run_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                assert_eq!(card, ("target-card".into(), 1));
                let evidence: u64 = connection.query_row(
                    "SELECT count(*) FROM candidate_sources cs JOIN source_records sr ON sr.id=cs.source_record_id JOIN source_documents sd ON sd.id=sr.source_document_id WHERE sd.import_run_id=?1",
                    [&applied.local_run_id],
                    |row| row.get(0),
                )?;
                assert_eq!(evidence, 1);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn equivocation_and_terminal_source_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let (archive, _source_state, _source_vault, _summary) = export_fixture(&temp);
        let receiver = AppState::in_memory(&[13_u8; 32]).unwrap();
        let receiver_vault =
            DocumentVault::new(temp.path().join("receiver-vault"), &[14_u8; 32]).unwrap();
        seed_household(&receiver, "target-bank", "Target Bank");
        let mut staged = receiver
            .with_connection(|connection| {
                Ok(stage_pending_import(connection, &archive, "family", PASSPHRASE).unwrap())
            })
            .unwrap();
        let mappings = PendingImportMappingsDto {
            accounts: vec![PendingImportAccountMappingDto {
                portable_account_id: "source-bank".into(),
                local_account_id: "target-bank".into(),
            }],
            members: Vec::new(),
        };
        receiver
            .with_connection(|connection| {
                Ok(apply_pending_import(connection, &receiver_vault, &staged, &mappings).unwrap())
            })
            .unwrap();
        staged.manifest.import.candidates[0].memo_raw = Some("changed content".into());
        staged.manifest.package_id = manifest_identity(&staged.manifest).unwrap();
        staged.manifest_sha256 = hex_digest(&serde_json::to_vec(&staged.manifest).unwrap());
        assert!(matches!(
            receiver
                .with_connection(|connection| Ok(apply_pending_import(
                    connection,
                    &receiver_vault,
                    &staged,
                    &mappings
                )))
                .unwrap(),
            Err(PendingImportBundleError::Conflict)
        ));

        let terminal = AppState::in_memory(&[15_u8; 32]).unwrap();
        let terminal_vault =
            DocumentVault::new(temp.path().join("terminal-vault"), &[16_u8; 32]).unwrap();
        seed_household(&terminal, "target-bank", "Target Bank");
        let exact = terminal_vault
            .put(b"date,merchant,amount\n2026-07-12,STORE,1200\n", "text/csv")
            .unwrap();
        terminal
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO import_runs(id,household_id,status) VALUES('terminal-run','family','POSTED')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO source_documents(id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path) VALUES('terminal-document','family','terminal-run','MANUAL_UPLOAD','old.csv','text/csv',?1,?2,?3)",
                    params![exact.plaintext_size as i64,exact.sha256,format!("vault://{}",exact.sha256)],
                )?;
                Ok(())
            })
            .unwrap();
        let terminal_stage = terminal
            .with_connection(|connection| {
                Ok(stage_pending_import(connection, &archive, "family", PASSPHRASE).unwrap())
            })
            .unwrap();
        assert!(matches!(
            terminal
                .with_connection(|connection| Ok(apply_pending_import(
                    connection,
                    &terminal_vault,
                    &terminal_stage,
                    &mappings
                )))
                .unwrap(),
            Err(PendingImportBundleError::Terminal)
        ));
    }

    #[test]
    fn database_conflict_rolls_back_graph_and_new_vault_object() {
        let temp = tempfile::tempdir().unwrap();
        let (archive, _source_state, _source_vault, summary) = export_fixture(&temp);
        let receiver = AppState::in_memory(&[17_u8; 32]).unwrap();
        let receiver_vault =
            DocumentVault::new(temp.path().join("receiver-vault"), &[18_u8; 32]).unwrap();
        seed_household(&receiver, "target-bank", "Target Bank");
        let staged = receiver
            .with_connection(|connection| {
                Ok(stage_pending_import(connection, &archive, "family", PASSPHRASE).unwrap())
            })
            .unwrap();
        let collision = deterministic_id(
            "pic",
            "family",
            &staged.manifest.origin_installation_id,
            "portable-candidate",
        );
        receiver
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO transaction_candidates(id,household_id,occurred_on,amount_jpy,direction,review_status) VALUES(?1,'family','2026-01-01',1,'OUT','PENDING')",
                    [&collision],
                )?;
                Ok(())
            })
            .unwrap();
        let result = receiver
            .with_connection(|connection| {
                Ok(apply_pending_import(
                    connection,
                    &receiver_vault,
                    &staged,
                    &PendingImportMappingsDto {
                        accounts: vec![PendingImportAccountMappingDto {
                            portable_account_id: "source-bank".into(),
                            local_account_id: "target-bank".into(),
                        }],
                        members: Vec::new(),
                    },
                ))
            })
            .unwrap();
        assert!(matches!(result, Err(PendingImportBundleError::Conflict)));
        assert!(receiver_vault.read(&summary.source_sha256).is_err());
        receiver
            .with_connection(|connection| {
                let runs: u64 = connection.query_row(
                    "SELECT count(*) FROM import_runs WHERE household_id='family'",
                    [],
                    |row| row.get(0),
                )?;
                let receipts: u64 = connection.query_row(
                    "SELECT count(*) FROM pending_import_receipts",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!((runs, receipts), (0, 0));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn same_package_applies_independently_to_two_target_households() {
        let temp = tempfile::tempdir().unwrap();
        let (archive, _source_state, _source_vault, _summary) = export_fixture(&temp);
        let receiver = AppState::in_memory(&[21_u8; 32]).unwrap();
        let receiver_vault =
            DocumentVault::new(temp.path().join("receiver-vault"), &[22_u8; 32]).unwrap();
        receiver
            .with_connection(|connection| {
                for (household, name, account, account_name) in [
                    ("household-a", "Household A", "bank-a", "Bank A"),
                    ("household-b", "Household B", "bank-b", "Bank B"),
                ] {
                    connection.execute(
                        "INSERT INTO households(id,name) VALUES(?1,?2)",
                        params![household, name],
                    )?;
                    connection.execute(
                        "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES(?1,?2,?3,'ASSET','BANK')",
                        params![account, household, account_name],
                    )?;
                }
                Ok(())
            })
            .unwrap();
        let staged_a = receiver
            .with_connection(|connection| {
                Ok(stage_pending_import(connection, &archive, "household-a", PASSPHRASE).unwrap())
            })
            .unwrap();
        let staged_b = receiver
            .with_connection(|connection| {
                Ok(stage_pending_import(connection, &archive, "household-b", PASSPHRASE).unwrap())
            })
            .unwrap();
        let applied_a = receiver
            .with_connection(|connection| {
                Ok(apply_pending_import(
                    connection,
                    &receiver_vault,
                    &staged_a,
                    &PendingImportMappingsDto {
                        accounts: vec![PendingImportAccountMappingDto {
                            portable_account_id: "source-bank".into(),
                            local_account_id: "bank-a".into(),
                        }],
                        members: Vec::new(),
                    },
                )
                .unwrap())
            })
            .unwrap();
        let applied_b = receiver
            .with_connection(|connection| {
                Ok(apply_pending_import(
                    connection,
                    &receiver_vault,
                    &staged_b,
                    &PendingImportMappingsDto {
                        accounts: vec![PendingImportAccountMappingDto {
                            portable_account_id: "source-bank".into(),
                            local_account_id: "bank-b".into(),
                        }],
                        members: Vec::new(),
                    },
                )
                .unwrap())
            })
            .unwrap();
        assert_ne!(applied_a.local_run_id, applied_b.local_run_id);
        assert_ne!(applied_a.local_document_id, applied_b.local_document_id);
        receiver
            .with_connection(|connection| {
                let receipts: u64 = connection.query_row(
                    "SELECT count(*) FROM pending_import_receipts WHERE package_id=?1",
                    [&staged_a.manifest.package_id],
                    |row| row.get(0),
                )?;
                assert_eq!(receipts, 2);
                let accounts = connection
                    .prepare(
                        "SELECT household_id,account_id FROM transaction_candidates ORDER BY household_id",
                    )?
                    .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                assert_eq!(
                    accounts,
                    vec![
                        ("household-a".into(), "bank-a".into()),
                        ("household-b".into(), "bank-b".into())
                    ]
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn zero_candidate_run_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let state = AppState::in_memory(&[19_u8; 32]).unwrap();
        let vault = DocumentVault::new(temp.path().join("vault"), &[20_u8; 32]).unwrap();
        seed_pending_source(&state, &vault);
        state
            .with_connection(|connection| {
                connection.execute(
                    "DELETE FROM transaction_candidates WHERE id='portable-candidate'",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let result = state
            .with_connection(|connection| {
                Ok(export_pending_import(
                    connection,
                    &vault,
                    &PendingImportExportRequest {
                        household_id: "family".into(),
                        run_id: "portable-run".into(),
                    },
                    &temp.path().join("empty.kakeflow-review"),
                    PASSPHRASE,
                ))
            })
            .unwrap();
        assert!(matches!(
            result,
            Err(PendingImportBundleError::UnsupportedRun)
        ));
    }
}
