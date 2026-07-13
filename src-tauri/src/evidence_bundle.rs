//! Passphrase-protected, portable source evidence for already-confirmed facts.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::Zeroizing;

use crate::backup;
use crate::document_vault::DocumentVault;
use crate::persistence;
use crate::sync_foundation;

const SCHEMA_VERSION: u32 = 1;
const APPLICATION_ID: i64 = 0x4b464556; // KFEV
const MAX_DOCUMENTS: usize = 2_048;
const MAX_RECORDS: usize = 100_000;
const MAX_PLAINTEXT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_RAW_PAYLOAD_BYTES: usize = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum EvidenceBundleError {
    #[error("evidence bundle input is invalid")]
    InvalidInput,
    #[error("evidence bundle has no confirmed source documents")]
    Empty,
    #[error("evidence bundle database operation failed")]
    Database,
    #[error("evidence bundle vault operation failed")]
    Vault,
    #[error("evidence bundle archive operation failed")]
    Archive,
    #[error("evidence bundle is corrupt")]
    Corrupt,
    #[error("evidence bundle conflicts with local provenance")]
    Conflict,
    #[error("evidence bundle dependency is missing")]
    MissingDependency,
    #[error("evidence bundle exceeds supported limits")]
    LimitExceeded,
    #[error("evidence bundle temporary storage failed")]
    Io,
}

pub type Result<T> = std::result::Result<T, EvidenceBundleError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceBundleSummaryDto {
    pub bundle_id: String,
    pub household_id: String,
    pub origin_installation_id: String,
    pub document_count: u64,
    pub record_count: u64,
    pub plaintext_bytes: u64,
    pub imported_document_count: u64,
    pub deduplicated_document_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    bundle_id: String,
    household_id: String,
    origin_installation_id: String,
    created_at: String,
    documents: Vec<ManifestDocument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManifestDocument {
    origin_installation_id: String,
    import_run: ManifestImportRun,
    id: String,
    source_type: String,
    original_filename: String,
    media_type: String,
    byte_size: u64,
    sha256: String,
    source_modified_at: Option<String>,
    imported_at: String,
    audience_visibility: String,
    audience_member_id: Option<String>,
    records: Vec<ManifestRecord>,
    transaction_links: Vec<ManifestTransactionLink>,
    card_statement_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManifestImportRun {
    id: String,
    status: String,
    adapter_id: Option<String>,
    adapter_version: Option<String>,
    started_at: String,
    completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManifestRecord {
    id: String,
    row_number: u64,
    record_hash: String,
    raw_payload_json: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManifestTransactionLink {
    transaction_id: String,
    source_record_id: String,
    candidate_id: Option<String>,
}

pub struct StagedEvidenceBundle {
    root: TemporaryRoot,
    key: Zeroizing<[u8; 32]>,
    manifest: Manifest,
    summary: EvidenceBundleSummaryDto,
}

impl StagedEvidenceBundle {
    pub fn summary(&self) -> &EvidenceBundleSummaryDto {
        &self.summary
    }
}

struct TemporaryRoot(PathBuf);

impl Drop for TemporaryRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn export_confirmed_evidence(
    connection: &Connection,
    live_vault: &DocumentVault,
    household_id: &str,
    archive_path: &Path,
    passphrase: &str,
) -> Result<EvidenceBundleSummaryDto> {
    validate_id(household_id)?;
    let identity = sync_foundation::get_local_status(connection, household_id)
        .map_err(|_| EvidenceBundleError::Database)?;
    let mut documents = load_confirmed_documents(connection, household_id, &identity.device.id)?;
    if documents.is_empty() {
        return Err(EvidenceBundleError::Empty);
    }
    validate_documents(&documents)?;

    let created_at: String = connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
            row.get(0)
        })
        .map_err(|_| EvidenceBundleError::Database)?;
    let mut manifest = Manifest {
        schema_version: SCHEMA_VERSION,
        bundle_id: String::new(),
        household_id: household_id.to_owned(),
        origin_installation_id: identity.device.id.clone(),
        created_at,
        documents: std::mem::take(&mut documents),
    };
    manifest.bundle_id = manifest_identity(&manifest)?;
    let encoded = serde_json::to_vec(&manifest).map_err(|_| EvidenceBundleError::Corrupt)?;
    if encoded.len() > MAX_MANIFEST_BYTES {
        return Err(EvidenceBundleError::LimitExceeded);
    }

    let root = temporary_root("kakeflow-evidence-export")?;
    let database_path = root.0.join("database").join("kakeflow.db");
    let mut key = Zeroizing::new([0_u8; 32]);
    getrandom::getrandom(key.as_mut()).map_err(|_| EvidenceBundleError::Io)?;
    let manifest_connection =
        persistence::create_keyed_container_database(&database_path, key.as_ref())
            .map_err(|_| EvidenceBundleError::Database)?;
    create_manifest_schema(&manifest_connection)?;
    manifest_connection
        .execute(
            "INSERT INTO evidence_manifest(id,payload_json,payload_sha256) VALUES(1,?1,?2)",
            params![
                String::from_utf8(encoded.clone()).map_err(|_| EvidenceBundleError::Corrupt)?,
                hex_digest(&encoded)
            ],
        )
        .map_err(|_| EvidenceBundleError::Database)?;
    manifest_connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|_| EvidenceBundleError::Database)?;
    drop(manifest_connection);

    let temporary_vault =
        DocumentVault::new(root.0.join("vault"), &key).map_err(|_| EvidenceBundleError::Vault)?;
    let mut plaintext_bytes = 0_u64;
    for document in &manifest.documents {
        let source = live_vault
            .read(&document.sha256)
            .map_err(|_| EvidenceBundleError::Vault)?;
        if source.mime_type != document.media_type
            || source.bytes.len() as u64 != document.byte_size
            || source.sha256 != document.sha256
        {
            return Err(EvidenceBundleError::Corrupt);
        }
        plaintext_bytes = plaintext_bytes
            .checked_add(document.byte_size)
            .ok_or(EvidenceBundleError::LimitExceeded)?;
        if plaintext_bytes > MAX_PLAINTEXT_BYTES {
            return Err(EvidenceBundleError::LimitExceeded);
        }
        let stored = temporary_vault
            .put(&source.bytes, &source.mime_type)
            .map_err(|_| EvidenceBundleError::Vault)?;
        if stored.sha256 != document.sha256 {
            return Err(EvidenceBundleError::Corrupt);
        }
    }
    drop(temporary_vault);
    backup::create_portable_backup(
        &database_path,
        root.0.join("vault"),
        archive_path,
        passphrase,
        &key,
    )
    .map_err(|_| EvidenceBundleError::Archive)?;

    Ok(summary(&manifest, plaintext_bytes, 0, 0))
}

pub fn stage_evidence_bundle(
    archive_path: &Path,
    passphrase: &str,
) -> Result<StagedEvidenceBundle> {
    let root = temporary_root("kakeflow-evidence-stage")?;
    let unpacked = root.0.join("unpacked");
    let (archive_summary, key) =
        backup::restore_portable_backup(archive_path, &unpacked, passphrase)
            .map_err(|_| EvidenceBundleError::Archive)?;
    if archive_summary.plaintext_bytes > MAX_PLAINTEXT_BYTES + MAX_MANIFEST_BYTES as u64 {
        return Err(EvidenceBundleError::LimitExceeded);
    }
    let database_path = unpacked.join("database").join("kakeflow.db");
    let manifest_connection =
        persistence::open_keyed_container_database_read_only(&database_path, key.as_ref())
            .map_err(|_| EvidenceBundleError::Corrupt)?;
    validate_manifest_schema(&manifest_connection)?;
    let (payload, digest): (String, String) = manifest_connection
        .query_row(
            "SELECT payload_json,payload_sha256 FROM evidence_manifest WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| EvidenceBundleError::Corrupt)?;
    if payload.len() > MAX_MANIFEST_BYTES || hex_digest(payload.as_bytes()) != digest {
        return Err(EvidenceBundleError::Corrupt);
    }
    let manifest: Manifest =
        serde_json::from_str(&payload).map_err(|_| EvidenceBundleError::Corrupt)?;
    validate_manifest(&manifest)?;
    let temporary_vault =
        DocumentVault::new(unpacked.join("vault"), &key).map_err(|_| EvidenceBundleError::Vault)?;
    let mut plaintext_bytes = 0_u64;
    for document in &manifest.documents {
        let retrieved = temporary_vault
            .read(&document.sha256)
            .map_err(|_| EvidenceBundleError::Corrupt)?;
        if retrieved.sha256 != document.sha256
            || retrieved.mime_type != document.media_type
            || retrieved.bytes.len() as u64 != document.byte_size
        {
            return Err(EvidenceBundleError::Corrupt);
        }
        plaintext_bytes = plaintext_bytes
            .checked_add(document.byte_size)
            .ok_or(EvidenceBundleError::LimitExceeded)?;
        if plaintext_bytes > MAX_PLAINTEXT_BYTES {
            return Err(EvidenceBundleError::LimitExceeded);
        }
    }
    let summary = summary(&manifest, plaintext_bytes, 0, 0);
    Ok(StagedEvidenceBundle {
        root,
        key,
        manifest,
        summary,
    })
}

pub fn apply_evidence_bundle(
    connection: &Connection,
    live_vault: &DocumentVault,
    staged: &StagedEvidenceBundle,
) -> Result<EvidenceBundleSummaryDto> {
    validate_manifest(&staged.manifest)?;
    let household_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM households WHERE id=?1)",
            [&staged.manifest.household_id],
            |row| row.get(0),
        )
        .map_err(|_| EvidenceBundleError::Database)?;
    if !household_exists {
        return Err(EvidenceBundleError::MissingDependency);
    }
    let previous: Option<String> = connection
        .query_row(
            "SELECT manifest_sha256 FROM evidence_bundle_receipts WHERE bundle_id=?1",
            [&staged.manifest.bundle_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| EvidenceBundleError::Database)?;
    let manifest_bytes =
        serde_json::to_vec(&staged.manifest).map_err(|_| EvidenceBundleError::Corrupt)?;
    let manifest_sha256 = hex_digest(&manifest_bytes);
    if let Some(previous) = previous {
        if previous != manifest_sha256 {
            return Err(EvidenceBundleError::Conflict);
        }
        return Ok(summary(
            &staged.manifest,
            staged.summary.plaintext_bytes,
            0,
            staged.manifest.documents.len() as u64,
        ));
    }

    validate_dependencies(connection, &staged.manifest)?;
    let staged_vault =
        DocumentVault::new(staged.root.0.join("unpacked").join("vault"), &staged.key)
            .map_err(|_| EvidenceBundleError::Vault)?;
    let mut new_hashes = Vec::new();
    let mut deduplicated = 0_u64;
    for document in &staged.manifest.documents {
        let retrieved = staged_vault
            .read(&document.sha256)
            .map_err(|_| EvidenceBundleError::Corrupt)?;
        let stored = live_vault
            .put(&retrieved.bytes, &retrieved.mime_type)
            .map_err(|_| EvidenceBundleError::Vault)?;
        if stored.sha256 != document.sha256 {
            cleanup_new_objects(connection, live_vault, &new_hashes);
            return Err(EvidenceBundleError::Corrupt);
        }
        if stored.deduplicated {
            deduplicated += 1;
        } else {
            new_hashes.push(stored.sha256);
        }
    }

    let result = (|| {
        let transaction = connection
            .unchecked_transaction()
            .map_err(|_| EvidenceBundleError::Database)?;
        for document in &staged.manifest.documents {
            materialize_document(&transaction, &staged.manifest, document)?;
        }
        transaction
            .execute(
                "INSERT INTO evidence_bundle_receipts(
                   bundle_id,household_id,origin_installation_id,manifest_sha256)
                 VALUES(?1,?2,?3,?4)",
                params![
                    staged.manifest.bundle_id,
                    staged.manifest.household_id,
                    staged.manifest.origin_installation_id,
                    manifest_sha256
                ],
            )
            .map_err(|_| EvidenceBundleError::Database)?;
        transaction
            .commit()
            .map_err(|_| EvidenceBundleError::Database)
    })();
    if result.is_err() {
        cleanup_new_objects(connection, live_vault, &new_hashes);
        return Err(result.err().unwrap_or(EvidenceBundleError::Database));
    }
    Ok(summary(
        &staged.manifest,
        staged.summary.plaintext_bytes,
        staged.manifest.documents.len() as u64 - deduplicated,
        deduplicated,
    ))
}

fn load_confirmed_documents(
    connection: &Connection,
    household_id: &str,
    local_origin: &str,
) -> Result<Vec<ManifestDocument>> {
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT sd.id
             FROM source_documents sd
             WHERE sd.household_id=?1 AND (
               EXISTS (
                 SELECT 1 FROM source_records sr
                 JOIN transaction_sources ts ON ts.source_record_id=sr.id
                 JOIN transactions t ON t.id=ts.transaction_id
                 WHERE sr.source_document_id=sd.id AND t.status='POSTED'
               ) OR EXISTS (
                 SELECT 1 FROM evidence_source_document_aliases da
                 JOIN evidence_source_record_aliases ra
                   ON ra.household_id=da.household_id
                  AND ra.origin_installation_id=da.origin_installation_id
                  AND ra.portable_document_id=da.portable_document_id
                 JOIN transaction_portable_source_links p ON p.source_record_id=ra.portable_record_id
                 JOIN transactions t ON t.id=p.transaction_id
                 WHERE da.local_document_id=sd.id AND t.status='POSTED'
               ) OR EXISTS (
                 SELECT 1 FROM card_statements cs WHERE cs.source_document_id=sd.id
               ) OR EXISTS (
                 SELECT 1 FROM evidence_source_document_aliases da
                 JOIN card_statement_portable_source_refs p
                   ON p.source_document_id=da.portable_document_id
                 WHERE da.local_document_id=sd.id
               )
             )
             ORDER BY sd.imported_at,sd.id",
        )
        .map_err(|_| EvidenceBundleError::Database)?;
    let ids = statement
        .query_map([household_id], |row| row.get::<_, String>(0))
        .map_err(|_| EvidenceBundleError::Database)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| EvidenceBundleError::Database)?;
    let mut result = Vec::new();
    for id in ids {
        let native: bool = connection.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM source_records sr JOIN transaction_sources ts ON ts.source_record_id=sr.id
               JOIN transactions t ON t.id=ts.transaction_id
               WHERE sr.source_document_id=?1 AND t.household_id=?2 AND t.status='POSTED'
               UNION ALL SELECT 1 FROM card_statements cs
               WHERE cs.source_document_id=?1 AND cs.household_id=?2
             )", params![id,household_id], |row| row.get(0)
        ).map_err(|_| EvidenceBundleError::Database)?;
        if native {
            result.push(load_document(
                connection,
                household_id,
                &id,
                local_origin,
                None,
            )?);
        }
        let mut aliases = connection.prepare(
            "SELECT origin_installation_id,portable_document_id,portable_import_run_id
             FROM evidence_source_document_aliases da
             WHERE da.household_id=?1 AND da.local_document_id=?2 AND (
               EXISTS(SELECT 1 FROM evidence_source_record_aliases ra
                 JOIN transaction_portable_source_links p ON p.source_record_id=ra.portable_record_id
                 JOIN transactions t ON t.id=p.transaction_id
                 WHERE ra.household_id=da.household_id
                   AND ra.origin_installation_id=da.origin_installation_id
                   AND ra.portable_document_id=da.portable_document_id AND t.status='POSTED')
               OR EXISTS(SELECT 1 FROM card_statement_portable_source_refs p
                 WHERE p.source_document_id=da.portable_document_id)
             ) ORDER BY origin_installation_id,portable_document_id"
        ).map_err(|_| EvidenceBundleError::Database)?;
        let aliases = aliases
            .query_map(params![household_id, id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|_| EvidenceBundleError::Database)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| EvidenceBundleError::Database)?;
        for alias in aliases {
            result.push(load_document(
                connection,
                household_id,
                &id,
                local_origin,
                Some(alias),
            )?);
        }
        if result.len() > MAX_DOCUMENTS {
            return Err(EvidenceBundleError::LimitExceeded);
        }
    }
    Ok(result)
}

fn load_document(
    connection: &Connection,
    household_id: &str,
    document_id: &str,
    local_origin: &str,
    alias: Option<(String, String, String)>,
) -> Result<ManifestDocument> {
    let mut document = connection
        .query_row(
            "SELECT sd.id,sd.source_type,sd.original_filename,sd.media_type,sd.byte_size,
                    sd.sha256,sd.source_modified_at,sd.imported_at,sd.audience_visibility,
                    sd.audience_member_id,ir.id,ir.status,ir.adapter_id,ir.adapter_version,
                    ir.started_at,ir.completed_at
             FROM source_documents sd JOIN import_runs ir ON ir.id=sd.import_run_id
             WHERE sd.id=?1 AND sd.household_id=?2",
            params![document_id, household_id],
            |row| {
                let byte_size: i64 = row.get(4)?;
                Ok(ManifestDocument {
                    origin_installation_id: local_origin.to_owned(),
                    id: row.get(0)?,
                    source_type: row.get(1)?,
                    original_filename: row.get(2)?,
                    media_type: row.get(3)?,
                    byte_size: byte_size.max(0) as u64,
                    sha256: row.get(5)?,
                    source_modified_at: row.get(6)?,
                    imported_at: row.get(7)?,
                    audience_visibility: row.get(8)?,
                    audience_member_id: row.get(9)?,
                    import_run: ManifestImportRun {
                        id: row.get(10)?,
                        status: row.get(11)?,
                        adapter_id: row.get(12)?,
                        adapter_version: row.get(13)?,
                        started_at: row.get(14)?,
                        completed_at: row.get(15)?,
                    },
                    records: Vec::new(),
                    transaction_links: Vec::new(),
                    card_statement_ids: Vec::new(),
                })
            },
        )
        .map_err(|_| EvidenceBundleError::Database)?;
    if let Some((origin, portable_document, portable_run)) = alias.as_ref() {
        document.origin_installation_id = origin.clone();
        document.id = portable_document.clone();
        document.import_run.id = portable_run.clone();
    }
    let mut records = connection
        .prepare(
            "SELECT id,row_number,record_hash,raw_payload_json,created_at FROM source_records
         WHERE source_document_id=?1 ORDER BY row_number,id",
        )
        .map_err(|_| EvidenceBundleError::Database)?;
    document.records = records
        .query_map([document_id], |row| {
            let row_number: i64 = row.get(1)?;
            Ok(ManifestRecord {
                id: row.get(0)?,
                row_number: row_number.max(0) as u64,
                record_hash: row.get(2)?,
                raw_payload_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|_| EvidenceBundleError::Database)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| EvidenceBundleError::Database)?;

    for record in &mut document.records {
        if alias.is_none() {
            continue;
        }
        if let Some(portable) = connection
            .query_row(
                "SELECT portable_record_id FROM evidence_source_record_aliases
             WHERE household_id=?1 AND origin_installation_id=?2 AND local_record_id=?3",
                params![household_id, document.origin_installation_id, record.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| EvidenceBundleError::Database)?
        {
            record.id = portable;
        }
    }

    if alias.is_none() {
        let mut links = connection
            .prepare(
                "SELECT ts.transaction_id,ts.source_record_id,ts.candidate_id
         FROM transaction_sources ts JOIN transactions t ON t.id=ts.transaction_id
         JOIN source_records sr ON sr.id=ts.source_record_id
         WHERE sr.source_document_id=?1 AND t.household_id=?2 AND t.status='POSTED'
         ORDER BY ts.transaction_id,ts.source_record_id",
            )
            .map_err(|_| EvidenceBundleError::Database)?;
        document.transaction_links = links
            .query_map(params![document_id, household_id], |row| {
                Ok(ManifestTransactionLink {
                    transaction_id: row.get(0)?,
                    source_record_id: row.get(1)?,
                    candidate_id: row.get(2)?,
                })
            })
            .map_err(|_| EvidenceBundleError::Database)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| EvidenceBundleError::Database)?;
    } else {
        let mut portable = connection
            .prepare(
                "SELECT p.transaction_id,ra.portable_record_id,p.candidate_id
         FROM evidence_source_record_aliases ra
         JOIN transaction_portable_source_links p ON p.source_record_id=ra.portable_record_id
         JOIN transactions t ON t.id=p.transaction_id
         WHERE ra.local_record_id IN (SELECT id FROM source_records WHERE source_document_id=?1)
           AND ra.household_id=?2 AND ra.origin_installation_id=?3 AND t.status='POSTED'
         ORDER BY p.transaction_id,ra.portable_record_id",
            )
            .map_err(|_| EvidenceBundleError::Database)?;
        document.transaction_links = portable
            .query_map(
                params![document_id, household_id, document.origin_installation_id],
                |row| {
                    Ok(ManifestTransactionLink {
                        transaction_id: row.get(0)?,
                        source_record_id: row.get(1)?,
                        candidate_id: row.get(2)?,
                    })
                },
            )
            .map_err(|_| EvidenceBundleError::Database)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| EvidenceBundleError::Database)?;
    }
    document.transaction_links.sort();
    document.transaction_links.dedup();

    let card_sql = if alias.is_none() {
        "SELECT id FROM card_statements WHERE household_id=?1 AND source_document_id=?2 ORDER BY 1"
    } else {
        "SELECT p.statement_id FROM card_statement_portable_source_refs p
         WHERE p.source_document_id=?2 ORDER BY 1"
    };
    let mut cards = connection
        .prepare(card_sql)
        .map_err(|_| EvidenceBundleError::Database)?;
    document.card_statement_ids = cards
        .query_map(params![household_id, document_id], |row| row.get(0))
        .map_err(|_| EvidenceBundleError::Database)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| EvidenceBundleError::Database)?;
    Ok(document)
}

fn validate_manifest(manifest: &Manifest) -> Result<()> {
    if manifest.schema_version != SCHEMA_VERSION || manifest.documents.is_empty() {
        return Err(EvidenceBundleError::Corrupt);
    }
    validate_id(&manifest.bundle_id)?;
    validate_id(&manifest.household_id)?;
    validate_id(&manifest.origin_installation_id)?;
    validate_documents(&manifest.documents)?;
    if !valid_hash(&manifest.bundle_id) || manifest_identity(manifest)? != manifest.bundle_id {
        return Err(EvidenceBundleError::Corrupt);
    }
    Ok(())
}

fn validate_documents(documents: &[ManifestDocument]) -> Result<()> {
    if documents.len() > MAX_DOCUMENTS {
        return Err(EvidenceBundleError::LimitExceeded);
    }
    let mut document_ids = BTreeSet::new();
    let mut record_ids = BTreeSet::new();
    let mut total_records = 0_usize;
    let mut total_bytes = 0_u64;
    for document in documents {
        validate_id(&document.origin_installation_id)?;
        validate_id(&document.id)?;
        validate_id(&document.import_run.id)?;
        if !document_ids.insert(&document.id)
            || !valid_hash(&document.sha256)
            || document.original_filename.is_empty()
            || document.media_type.is_empty()
            || !matches!(
                document.import_run.status.as_str(),
                "POSTED" | "REVIEW_REQUIRED"
            )
            || !matches!(document.audience_visibility.as_str(), "SHARED" | "PERSONAL")
            || (document.audience_visibility == "SHARED") != document.audience_member_id.is_none()
        {
            return Err(EvidenceBundleError::Corrupt);
        }
        total_bytes = total_bytes
            .checked_add(document.byte_size)
            .ok_or(EvidenceBundleError::LimitExceeded)?;
        for record in &document.records {
            validate_id(&record.id)?;
            if record.row_number == 0
                || !record_ids.insert(&record.id)
                || !valid_hash(&record.record_hash)
                || record.raw_payload_json.len() > MAX_RAW_PAYLOAD_BYTES
                || serde_json::from_str::<serde_json::Value>(&record.raw_payload_json).is_err()
            {
                return Err(EvidenceBundleError::Corrupt);
            }
        }
        let contained = document
            .records
            .iter()
            .map(|record| record.id.as_str())
            .collect::<BTreeSet<_>>();
        for link in &document.transaction_links {
            validate_id(&link.transaction_id)?;
            validate_id(&link.source_record_id)?;
            if let Some(candidate) = link.candidate_id.as_deref() {
                validate_id(candidate)?;
            }
            if !contained.contains(link.source_record_id.as_str()) {
                return Err(EvidenceBundleError::Corrupt);
            }
        }
        for statement in &document.card_statement_ids {
            validate_id(statement)?;
        }
        total_records = total_records
            .checked_add(document.records.len())
            .ok_or(EvidenceBundleError::LimitExceeded)?;
    }
    if total_records > MAX_RECORDS || total_bytes > MAX_PLAINTEXT_BYTES {
        return Err(EvidenceBundleError::LimitExceeded);
    }
    Ok(())
}

fn validate_dependencies(connection: &Connection, manifest: &Manifest) -> Result<()> {
    for document in &manifest.documents {
        for link in &document.transaction_links {
            let exists: bool = connection
                .query_row(
                    "SELECT EXISTS(
                   SELECT 1 FROM transactions t
                   WHERE t.id=?1 AND t.household_id=?2 AND t.status='POSTED' AND (
                     EXISTS(SELECT 1 FROM transaction_portable_source_links p
                       WHERE p.transaction_id=t.id AND p.source_record_id=?3
                         AND p.candidate_id IS ?4)
                     OR EXISTS(SELECT 1 FROM transaction_sources actual
                       WHERE actual.transaction_id=t.id AND actual.source_record_id=?3
                         AND actual.candidate_id IS ?4)
                   ))",
                    params![
                        link.transaction_id,
                        manifest.household_id,
                        link.source_record_id,
                        link.candidate_id
                    ],
                    |row| row.get(0),
                )
                .map_err(|_| EvidenceBundleError::Database)?;
            if !exists {
                return Err(EvidenceBundleError::MissingDependency);
            }
        }
        for statement in &document.card_statement_ids {
            let exists: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM card_statements s
                     WHERE s.id=?1 AND s.household_id=?2 AND (
                       s.source_document_id=?3 OR EXISTS(
                         SELECT 1 FROM card_statement_portable_source_refs p
                         WHERE p.statement_id=s.id AND p.source_document_id=?3)))",
                    params![statement, manifest.household_id, document.id],
                    |row| row.get(0),
                )
                .map_err(|_| EvidenceBundleError::Database)?;
            if !exists {
                return Err(EvidenceBundleError::MissingDependency);
            }
        }
    }
    Ok(())
}

fn materialize_document(
    transaction: &rusqlite::Transaction<'_>,
    manifest: &Manifest,
    document: &ManifestDocument,
) -> Result<()> {
    let local_run_id = deterministic_id(
        "evr",
        &document.origin_installation_id,
        &document.import_run.id,
    );
    transaction.execute(
        "INSERT INTO import_runs(id,household_id,status,adapter_id,adapter_version,started_at,completed_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(id) DO NOTHING",
        params![local_run_id,manifest.household_id,document.import_run.status,document.import_run.adapter_id,
            document.import_run.adapter_version,document.import_run.started_at,document.import_run.completed_at]
    ).map_err(|_| EvidenceBundleError::Database)?;
    let run_scope: Option<String> = transaction
        .query_row(
            "SELECT household_id FROM import_runs WHERE id=?1",
            [&local_run_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| EvidenceBundleError::Database)?;
    if run_scope.as_deref() != Some(manifest.household_id.as_str()) {
        return Err(EvidenceBundleError::Conflict);
    }
    transaction.execute(
        "INSERT INTO evidence_import_run_aliases(household_id,origin_installation_id,portable_import_run_id,local_import_run_id)
         VALUES(?1,?2,?3,?4) ON CONFLICT DO NOTHING",
        params![manifest.household_id,document.origin_installation_id,document.import_run.id,local_run_id]
    ).map_err(|_| EvidenceBundleError::Conflict)?;
    let aliased_run: String = transaction
        .query_row(
            "SELECT local_import_run_id FROM evidence_import_run_aliases
         WHERE household_id=?1 AND origin_installation_id=?2 AND portable_import_run_id=?3",
            params![
                manifest.household_id,
                document.origin_installation_id,
                document.import_run.id
            ],
            |row| row.get(0),
        )
        .map_err(|_| EvidenceBundleError::Conflict)?;
    if aliased_run != local_run_id {
        return Err(EvidenceBundleError::Conflict);
    }

    let existing_document: Option<String> = transaction
        .query_row(
            "SELECT id FROM source_documents WHERE household_id=?1 AND sha256=?2",
            params![manifest.household_id, document.sha256],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| EvidenceBundleError::Database)?;
    let local_document_id = existing_document
        .unwrap_or_else(|| deterministic_id("evd", &document.origin_installation_id, &document.id));
    transaction.execute(
        "INSERT INTO source_documents(id,household_id,import_run_id,source_type,original_filename,media_type,
           byte_size,sha256,storage_path,source_modified_at,imported_at,audience_visibility,audience_member_id)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
         ON CONFLICT(id) DO NOTHING",
        params![local_document_id,manifest.household_id,local_run_id,document.source_type,document.original_filename,
            document.media_type,document.byte_size as i64,document.sha256,format!("vault://{}",document.sha256),
            document.source_modified_at,document.imported_at,document.audience_visibility,document.audience_member_id]
    ).map_err(|_| EvidenceBundleError::Database)?;
    let document_fact: Option<(String, String, i64)> = transaction
        .query_row(
            "SELECT household_id,sha256,byte_size FROM source_documents WHERE id=?1",
            [&local_document_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| EvidenceBundleError::Database)?;
    if document_fact
        != Some((
            manifest.household_id.clone(),
            document.sha256.clone(),
            document.byte_size as i64,
        ))
    {
        return Err(EvidenceBundleError::Conflict);
    }
    transaction
        .execute(
            "INSERT INTO evidence_source_document_aliases(household_id,origin_installation_id,
           portable_document_id,portable_import_run_id,local_document_id,content_sha256)
         VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT DO NOTHING",
            params![
                manifest.household_id,
                document.origin_installation_id,
                document.id,
                document.import_run.id,
                local_document_id,
                document.sha256
            ],
        )
        .map_err(|_| EvidenceBundleError::Conflict)?;
    let aliased_document: (String, String) = transaction
        .query_row(
            "SELECT local_document_id,content_sha256 FROM evidence_source_document_aliases
         WHERE household_id=?1 AND origin_installation_id=?2 AND portable_document_id=?3",
            params![
                manifest.household_id,
                document.origin_installation_id,
                document.id
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| EvidenceBundleError::Conflict)?;
    if aliased_document != (local_document_id.clone(), document.sha256.clone()) {
        return Err(EvidenceBundleError::Conflict);
    }

    for record in &document.records {
        let existing_record: Option<String> = transaction
            .query_row(
                "SELECT id FROM source_records WHERE source_document_id=?1 AND record_hash=?2",
                params![local_document_id, record.record_hash],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| EvidenceBundleError::Database)?;
        let local_record_id = existing_record.unwrap_or_else(|| {
            deterministic_id("evs", &document.origin_installation_id, &record.id)
        });
        transaction.execute(
            "INSERT INTO source_records(id,source_document_id,row_number,record_hash,raw_payload_json,created_at)
             VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO NOTHING",
            params![local_record_id,local_document_id,record.row_number as i64,record.record_hash,
                record.raw_payload_json,record.created_at]
        ).map_err(|_| EvidenceBundleError::Database)?;
        let record_fact: Option<(String, String, i64, String, String)> = transaction
            .query_row(
                "SELECT source_document_id,record_hash,row_number,raw_payload_json,created_at
                 FROM source_records WHERE id=?1",
                [&local_record_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| EvidenceBundleError::Database)?;
        if record_fact
            != Some((
                local_document_id.clone(),
                record.record_hash.clone(),
                record.row_number as i64,
                record.raw_payload_json.clone(),
                record.created_at.clone(),
            ))
        {
            return Err(EvidenceBundleError::Conflict);
        }
        transaction
            .execute(
                "INSERT INTO evidence_source_record_aliases(household_id,origin_installation_id,
               portable_document_id,portable_record_id,local_record_id,record_hash)
             VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT DO NOTHING",
                params![
                    manifest.household_id,
                    document.origin_installation_id,
                    document.id,
                    record.id,
                    local_record_id,
                    record.record_hash
                ],
            )
            .map_err(|_| EvidenceBundleError::Conflict)?;
        let aliased_record: (String, String) = transaction
            .query_row(
                "SELECT local_record_id,record_hash FROM evidence_source_record_aliases
             WHERE household_id=?1 AND origin_installation_id=?2 AND portable_record_id=?3",
                params![
                    manifest.household_id,
                    document.origin_installation_id,
                    record.id
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| EvidenceBundleError::Conflict)?;
        if aliased_record != (local_record_id, record.record_hash.clone()) {
            return Err(EvidenceBundleError::Conflict);
        }
    }
    Ok(())
}

fn create_manifest_schema(connection: &Connection) -> Result<()> {
    connection
        .pragma_update(None, "application_id", APPLICATION_ID)
        .map_err(|_| EvidenceBundleError::Database)?;
    connection
        .pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(|_| EvidenceBundleError::Database)?;
    connection.execute_batch(
        "CREATE TABLE evidence_manifest(
           id INTEGER PRIMARY KEY CHECK(id=1),payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
           payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64)
         ) STRICT;"
    ).map_err(|_| EvidenceBundleError::Database)
}

fn validate_manifest_schema(connection: &Connection) -> Result<()> {
    let app: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|_| EvidenceBundleError::Corrupt)?;
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| EvidenceBundleError::Corrupt)?;
    let count: i64 = connection
        .query_row("SELECT count(*) FROM evidence_manifest", [], |row| {
            row.get(0)
        })
        .map_err(|_| EvidenceBundleError::Corrupt)?;
    if app != APPLICATION_ID || version != SCHEMA_VERSION || count != 1 {
        return Err(EvidenceBundleError::Corrupt);
    }
    Ok(())
}

fn summary(
    manifest: &Manifest,
    plaintext_bytes: u64,
    imported: u64,
    deduplicated: u64,
) -> EvidenceBundleSummaryDto {
    EvidenceBundleSummaryDto {
        bundle_id: manifest.bundle_id.clone(),
        household_id: manifest.household_id.clone(),
        origin_installation_id: manifest.origin_installation_id.clone(),
        document_count: manifest.documents.len() as u64,
        record_count: manifest
            .documents
            .iter()
            .map(|document| document.records.len() as u64)
            .sum(),
        plaintext_bytes,
        imported_document_count: imported,
        deduplicated_document_count: deduplicated,
    }
}

fn manifest_identity(manifest: &Manifest) -> Result<String> {
    let mut identity = manifest.clone();
    identity.bundle_id.clear();
    serde_json::to_vec(&identity)
        .map(|bytes| hex_digest(&bytes))
        .map_err(|_| EvidenceBundleError::Corrupt)
}

fn cleanup_new_objects(connection: &Connection, vault: &DocumentVault, hashes: &[String]) {
    for hash in hashes {
        let referenced = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM source_documents WHERE sha256=?1)",
                [hash],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(true);
        if !referenced {
            let _ = vault.delete(hash);
        }
    }
}

fn temporary_root(prefix: &str) -> Result<TemporaryRoot> {
    let parent = std::env::temp_dir();
    for _ in 0..16 {
        let mut random = [0_u8; 16];
        getrandom::getrandom(&mut random).map_err(|_| EvidenceBundleError::Io)?;
        let path = parent.join(format!("{prefix}-{}", hex_digest(&random)[..24].to_owned()));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(TemporaryRoot(path)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(EvidenceBundleError::Io),
        }
    }
    Err(EvidenceBundleError::Io)
}

fn deterministic_id(prefix: &str, origin: &str, portable: &str) -> String {
    let mut bytes = Vec::with_capacity(origin.len() + portable.len() + 1);
    bytes.extend_from_slice(origin.as_bytes());
    bytes.push(0);
    bytes.extend_from_slice(portable.as_bytes());
    format!("{prefix}-{}", &hex_digest(&bytes)[..32])
}
fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
fn validate_id(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        Err(EvidenceBundleError::InvalidInput)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    fn seed_source(state: &AppState, vault: &DocumentVault, include_source: bool) {
        let stored = include_source.then(|| {
            vault
                .put(b"date,merchant,amount\n2026-07-12,STORE,1200\n", "text/csv")
                .unwrap()
        });
        state.with_connection(|connection| {
            connection.execute("INSERT INTO households(id,name) VALUES('family','Family')", [])?;
            connection.execute(
                "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status,payee)
                 VALUES('tx','family','2026-07-12','EXPENSE','POSTED','STORE')", [],
            )?;
            if include_source {
                let stored=stored.as_ref().unwrap();
                connection.execute(
                    "INSERT INTO import_runs(id,household_id,status,adapter_id,adapter_version)
                     VALUES('run','family','POSTED','test-csv','1')", [],
                )?;
                connection.execute(
                    "INSERT INTO source_documents(id,household_id,import_run_id,source_type,
                       original_filename,media_type,byte_size,sha256,storage_path)
                     VALUES('document','family','run','MANUAL_UPLOAD','bank.csv','text/csv',?1,?2,?3)",
                    params![stored.plaintext_size as i64,stored.sha256,format!("vault://{}",stored.sha256)],
                )?;
                connection.execute(
                    "INSERT INTO source_records(id,source_document_id,row_number,record_hash,raw_payload_json)
                     VALUES('record','document',2,?1,'{\"date\":\"2026-07-12\",\"amount\":1200}')",
                    [hex_digest(b"record")],
                )?;
                connection.execute(
                    "INSERT INTO transaction_sources(transaction_id,source_record_id,candidate_id)
                     VALUES('tx','record',NULL)", [],
                )?;
            } else {
                connection.execute(
                    "INSERT INTO transaction_portable_source_links(transaction_id,source_record_id,candidate_id)
                     VALUES('tx','record',NULL)", [],
                )?;
            }
            Ok(())
        }).unwrap();
    }

    #[test]
    fn confirmed_csv_round_trips_and_reapply_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let source_state = AppState::in_memory(&[1_u8; 32]).unwrap();
        let source_vault =
            DocumentVault::new(temp.path().join("source-vault"), &[2_u8; 32]).unwrap();
        seed_source(&source_state, &source_vault, true);
        let archive = temp.path().join("confirmed.kakeflow-evidence");
        let exported = source_state
            .with_connection(|connection| {
                Ok(export_confirmed_evidence(
                    connection,
                    &source_vault,
                    "family",
                    &archive,
                    "correct horse battery staple",
                )
                .unwrap())
            })
            .unwrap();
        assert_eq!(exported.document_count, 1);
        assert_eq!(exported.record_count, 1);

        let receiver_state = AppState::in_memory(&[3_u8; 32]).unwrap();
        let receiver_vault =
            DocumentVault::new(temp.path().join("receiver-vault"), &[4_u8; 32]).unwrap();
        seed_source(&receiver_state, &receiver_vault, false);
        let staged = stage_evidence_bundle(&archive, "correct horse battery staple").unwrap();
        let applied = receiver_state
            .with_connection(|connection| {
                Ok(apply_evidence_bundle(connection, &receiver_vault, &staged).unwrap())
            })
            .unwrap();
        assert_eq!(applied.imported_document_count, 1);
        receiver_state
            .with_connection(|connection| {
                let visible: i64 = connection.query_row(
                    "SELECT count(*) FROM transaction_portable_source_links p
                 JOIN evidence_source_record_aliases a ON a.portable_record_id=p.source_record_id
                 WHERE p.transaction_id='tx' AND a.household_id='family'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(visible, 1);
                Ok(())
            })
            .unwrap();
        let reapplied = receiver_state
            .with_connection(|connection| {
                Ok(apply_evidence_bundle(connection, &receiver_vault, &staged).unwrap())
            })
            .unwrap();
        assert_eq!(reapplied.imported_document_count, 0);
        assert_eq!(reapplied.deduplicated_document_count, 1);

        receiver_state.with_connection(|connection| {
            connection.execute_batch(
                "INSERT INTO evidence_import_run_aliases
                   (household_id,origin_installation_id,portable_import_run_id,local_import_run_id)
                 SELECT 'family','second-origin','second-run',import_run_id
                 FROM source_documents WHERE household_id='family' LIMIT 1;
                 INSERT INTO evidence_source_document_aliases
                   (household_id,origin_installation_id,portable_document_id,portable_import_run_id,
                    local_document_id,content_sha256)
                 SELECT 'family','second-origin','second-document','second-run',id,sha256
                 FROM source_documents WHERE household_id='family' LIMIT 1;
                 INSERT INTO evidence_source_record_aliases
                   (household_id,origin_installation_id,portable_document_id,portable_record_id,
                    local_record_id,record_hash)
                 SELECT 'family','second-origin','second-document','second-record',sr.id,sr.record_hash
                 FROM source_records sr JOIN source_documents sd ON sd.id=sr.source_document_id
                 WHERE sd.household_id='family' LIMIT 1;
                 INSERT INTO transaction_portable_source_links VALUES('tx','second-record',NULL);",
            )?;
            Ok(())
        }).unwrap();

        let forwarded_archive = temp.path().join("forwarded.kakeflow-evidence");
        let forwarded_summary = receiver_state
            .with_connection(|connection| {
                Ok(export_confirmed_evidence(
                    connection,
                    &receiver_vault,
                    "family",
                    &forwarded_archive,
                    "another correct horse battery",
                )
                .unwrap())
            })
            .unwrap();
        assert_eq!(forwarded_summary.document_count, 2);
        let third_state = AppState::in_memory(&[7_u8; 32]).unwrap();
        let third_vault = DocumentVault::new(temp.path().join("third-vault"), &[8_u8; 32]).unwrap();
        seed_source(&third_state, &third_vault, false);
        third_state
            .with_connection(|connection| {
                connection.execute(
                "INSERT INTO transaction_portable_source_links VALUES('tx','second-record',NULL)",
                [],
            )?;
                Ok(())
            })
            .unwrap();
        let forwarded =
            stage_evidence_bundle(&forwarded_archive, "another correct horse battery").unwrap();
        third_state
            .with_connection(|connection| {
                Ok(apply_evidence_bundle(connection, &third_vault, &forwarded).unwrap())
            })
            .unwrap();
        third_state
            .with_connection(|connection| {
                let identities: String = connection.query_row(
                    "SELECT group_concat(portable_record_id,',') FROM (
                       SELECT portable_record_id FROM evidence_source_record_aliases
                       WHERE household_id='family' ORDER BY portable_record_id)",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(identities, "record,second-record");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn wrong_passphrase_does_not_stage() {
        let temp = tempfile::tempdir().unwrap();
        let state = AppState::in_memory(&[5_u8; 32]).unwrap();
        let vault = DocumentVault::new(temp.path().join("vault"), &[6_u8; 32]).unwrap();
        seed_source(&state, &vault, true);
        let archive = temp.path().join("confirmed.kakeflow-evidence");
        state
            .with_connection(|connection| {
                export_confirmed_evidence(
                    connection,
                    &vault,
                    "family",
                    &archive,
                    "correct horse battery staple",
                )
                .map(|_| ())
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
            })
            .unwrap();
        assert!(stage_evidence_bundle(&archive, "definitely wrong passphrase").is_err());
    }

    #[test]
    fn missing_portable_relationship_rejects_before_database_publication() {
        let temp = tempfile::tempdir().unwrap();
        let source_state = AppState::in_memory(&[9_u8; 32]).unwrap();
        let source_vault = DocumentVault::new(temp.path().join("source"), &[10_u8; 32]).unwrap();
        seed_source(&source_state, &source_vault, true);
        let archive = temp.path().join("evidence.kakeflow-evidence");
        source_state
            .with_connection(|connection| {
                Ok(export_confirmed_evidence(
                    connection,
                    &source_vault,
                    "family",
                    &archive,
                    "correct horse battery staple",
                )
                .unwrap())
            })
            .unwrap();
        let receiver_state = AppState::in_memory(&[11_u8; 32]).unwrap();
        let receiver_vault =
            DocumentVault::new(temp.path().join("receiver"), &[12_u8; 32]).unwrap();
        seed_source(&receiver_state, &receiver_vault, false);
        receiver_state
            .with_connection(|connection| {
                connection.execute("DELETE FROM transaction_portable_source_links", [])?;
                Ok(())
            })
            .unwrap();
        let staged = stage_evidence_bundle(&archive, "correct horse battery staple").unwrap();
        let result = receiver_state
            .with_connection(|connection| {
                Ok(apply_evidence_bundle(connection, &receiver_vault, &staged))
            })
            .unwrap();
        assert!(matches!(
            result,
            Err(EvidenceBundleError::MissingDependency)
        ));
        receiver_state
            .with_connection(|connection| {
                let documents: i64 =
                    connection.query_row("SELECT count(*) FROM source_documents", [], |row| {
                        row.get(0)
                    })?;
                let aliases: i64 = connection.query_row(
                    "SELECT count(*) FROM evidence_source_record_aliases",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!((documents, aliases), (0, 0));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn same_record_hash_with_different_immutable_fact_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let source_state = AppState::in_memory(&[13_u8; 32]).unwrap();
        let source_vault = DocumentVault::new(temp.path().join("source"), &[14_u8; 32]).unwrap();
        seed_source(&source_state, &source_vault, true);
        let archive = temp.path().join("evidence.kakeflow-evidence");
        source_state
            .with_connection(|connection| {
                Ok(export_confirmed_evidence(
                    connection,
                    &source_vault,
                    "family",
                    &archive,
                    "correct horse battery staple",
                )
                .unwrap())
            })
            .unwrap();
        let receiver_state = AppState::in_memory(&[15_u8; 32]).unwrap();
        let receiver_vault =
            DocumentVault::new(temp.path().join("receiver"), &[16_u8; 32]).unwrap();
        seed_source(&receiver_state, &receiver_vault, true);
        receiver_state.with_connection(|connection| {
            connection.execute(
                "UPDATE source_records SET raw_payload_json='{\"date\":\"2026-07-12\",\"amount\":9999}' WHERE id='record'",
                [],
            )?;
            Ok(())
        }).unwrap();
        let staged = stage_evidence_bundle(&archive, "correct horse battery staple").unwrap();
        let result = receiver_state
            .with_connection(|connection| {
                Ok(apply_evidence_bundle(connection, &receiver_vault, &staged))
            })
            .unwrap();
        assert!(matches!(result, Err(EvidenceBundleError::Conflict)));
        receiver_state
            .with_connection(|connection| {
                let aliases: i64 = connection.query_row(
                    "SELECT count(*) FROM evidence_source_record_aliases",
                    [],
                    |row| row.get(0),
                )?;
                let receipts: i64 = connection.query_row(
                    "SELECT count(*) FROM evidence_bundle_receipts",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!((aliases, receipts), (0, 0));
                Ok(())
            })
            .unwrap();
    }
}
