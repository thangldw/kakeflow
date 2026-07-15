//! Audience-partitioned immutable evidence carried by family schemas v3 and v4.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::{
    document_vault::DocumentVault,
    evidence_bundle::{self, Manifest, ManifestDocument},
    family_snapshot::{self, FamilyAudienceDto, FamilySnapshotRecordDto, FamilySnapshotSetDto},
    sync_foundation::{canonical_json, sha256_hex},
};

const KFF3_MAGIC: &[u8; 4] = b"KFF3";
const KFF4_MAGIC: &[u8; 4] = b"KFF4";
const CURRENT_FORMAT: &str = "KFF4";
const CURRENT_SCHEMA_VERSION: u32 = 4;
const PREFIX_LEN: usize = 12;
pub(crate) const MAX_ARTIFACT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Error)]
pub(crate) enum FamilyEvidenceError {
    #[error("family evidence input is invalid")]
    Invalid,
    #[error("family evidence database operation failed")]
    Database,
    #[error("family evidence vault operation failed")]
    Vault,
    #[error("family evidence snapshot operation failed")]
    Snapshot,
    #[error("family evidence limit exceeded")]
    Limit,
}

pub(crate) type Result<T> = std::result::Result<T, FamilyEvidenceError>;

#[derive(Debug)]
pub(crate) struct PreparedFamilyEvidence {
    pub(crate) set: FamilySnapshotSetDto,
    pub(crate) withheld_counts_by_audience: BTreeMap<String, BTreeMap<String, u64>>,
    pub(crate) withheld_domains_by_audience: BTreeMap<String, BTreeMap<String, u64>>,
    documents: BTreeMap<String, Vec<ManifestDocument>>,
    blobs: BTreeMap<String, Vec<u8>>,
}

#[derive(Debug)]
pub(crate) struct DecodedFamilyEvidence {
    pub(crate) set: FamilySnapshotSetDto,
    pub(crate) documents: Vec<ManifestDocument>,
    pub(crate) blobs: Vec<Vec<u8>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FamilyEvidenceHeader {
    format: String,
    snapshot_set: FamilySnapshotSetDto,
    evidence_documents: Vec<ManifestDocument>,
}

fn audience_key(audience: &FamilyAudienceDto) -> String {
    audience
        .member_id
        .as_ref()
        .map(|member| format!("PERSONAL:{member}"))
        .unwrap_or_else(|| "SHARED".to_owned())
}

fn shared() -> FamilyAudienceDto {
    FamilyAudienceDto {
        visibility: "SHARED".to_owned(),
        member_id: None,
    }
}

fn personal(member: &str) -> FamilyAudienceDto {
    FamilyAudienceDto {
        visibility: "PERSONAL".to_owned(),
        member_id: Some(member.to_owned()),
    }
}

fn meet(left: &FamilyAudienceDto, right: &FamilyAudienceDto) -> Option<FamilyAudienceDto> {
    match (left.member_id.as_deref(), right.member_id.as_deref()) {
        (None, None) => Some(shared()),
        (Some(member), None) | (None, Some(member)) => Some(personal(member)),
        (Some(left), Some(right)) if left == right => Some(personal(left)),
        _ => None,
    }
}

fn document_audience(document: &ManifestDocument) -> Option<FamilyAudienceDto> {
    match (
        document.audience_visibility.as_str(),
        document.audience_member_id.as_deref(),
    ) {
        ("SHARED", None) => Some(shared()),
        ("PERSONAL", Some(member)) => Some(personal(member)),
        _ => None,
    }
}

fn record_value(record: &FamilySnapshotRecordDto) -> Result<Value> {
    serde_json::from_str(&record.canonical_payload_json).map_err(|_| FamilyEvidenceError::Invalid)
}

fn value_id(value: &Value, key: &str) -> Result<Option<String>> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if !value.is_empty() => Ok(Some(value.clone())),
        _ => Err(FamilyEvidenceError::Invalid),
    }
}

fn transaction_audience(
    connection: &Connection,
    household_id: &str,
    transaction_id: &str,
) -> Result<Option<FamilyAudienceDto>> {
    let Some(mut audience) = connection
        .query_row(
            "SELECT audience_visibility,audience_member_id FROM transactions
             WHERE household_id=?1 AND id=?2 AND status='POSTED'",
            [household_id, transaction_id],
            |row| {
                Ok(FamilyAudienceDto {
                    visibility: row.get(0)?,
                    member_id: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|_| FamilyEvidenceError::Database)?
    else {
        return Ok(None);
    };
    if !matches!(
        (audience.visibility.as_str(), audience.member_id.as_deref()),
        ("SHARED", None) | ("PERSONAL", Some(_))
    ) {
        return Err(FamilyEvidenceError::Invalid);
    }

    // The declared transaction audience is only an upper bound. A journal
    // line touching a PERSONAL account makes the whole immutable financial
    // fact personal, exactly as canonical family snapshot partitioning does.
    let mut statement = connection
        .prepare(
            "SELECT a.household_id,a.visibility,a.owner_member_id
             FROM journal_entries j
             JOIN accounts a ON a.id=j.account_id
             WHERE j.transaction_id=?1
             ORDER BY j.line_number,j.id",
        )
        .map_err(|_| FamilyEvidenceError::Database)?;
    let rows = statement
        .query_map([transaction_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|_| FamilyEvidenceError::Database)?;
    for row in rows {
        let (account_household_id, visibility, member_id) =
            row.map_err(|_| FamilyEvidenceError::Database)?;
        if account_household_id != household_id {
            return Err(FamilyEvidenceError::Invalid);
        }
        let dependency = match (visibility.as_str(), member_id.as_deref()) {
            ("SHARED", _) => shared(),
            ("PERSONAL", Some(member)) if !member.trim().is_empty() => personal(member),
            _ => return Err(FamilyEvidenceError::Invalid),
        };
        audience = meet(&audience, &dependency).ok_or(FamilyEvidenceError::Invalid)?;
    }
    Ok(Some(audience))
}

fn increment(set: &mut FamilySnapshotSetDto, reason: &str) {
    *set.excluded_counts_by_reason
        .entry(reason.to_owned())
        .or_default() += 1;
}

fn empty_reasons() -> BTreeMap<String, u64> {
    [
        "MISSING_CARD_EVIDENCE",
        "MISSING_INVESTMENT_EVIDENCE",
        "EVIDENCE_AUDIENCE_MISMATCH",
        "EVIDENCE_SIZE_LIMIT",
        "MIXED_PERSONAL_MEMBERS",
        "OTHER_MEMBER_PERSONAL",
        "UNASSIGNED_SCOPE",
    ]
    .into_iter()
    .map(|reason| (reason.to_owned(), 0))
    .collect()
}

fn empty_domains() -> BTreeMap<String, u64> {
    ["LEDGER", "PLANNING", "CONFIG", "CARD", "INVESTMENT"]
        .into_iter()
        .map(|domain| (domain.to_owned(), 0))
        .collect()
}

fn evidence_domain(kind: &str) -> &'static str {
    match kind {
        "CARD_STATEMENT" | "CARD_PAYMENT" => "CARD",
        _ => "INVESTMENT",
    }
}

fn attribute_withheld(
    reasons: &mut BTreeMap<String, BTreeMap<String, u64>>,
    domains: &mut BTreeMap<String, BTreeMap<String, u64>>,
    audience: &FamilyAudienceDto,
    reason: &str,
    domain: &str,
) {
    *reasons
        .entry(audience_key(audience))
        .or_insert_with(empty_reasons)
        .entry(reason.to_owned())
        .or_default() += 1;
    *domains
        .entry(audience_key(audience))
        .or_insert_with(empty_domains)
        .entry(domain.to_owned())
        .or_default() += 1;
}

fn remove_kind_authority(set: &mut FamilySnapshotSetDto, kind: &str) {
    for partition in &mut set.partitions {
        partition.authoritative_kinds.retain(|value| value != kind);
    }
}

fn target_partition_mut<'a>(
    set: &'a mut FamilySnapshotSetDto,
    audience: &FamilyAudienceDto,
) -> Option<&'a mut family_snapshot::FamilySnapshotPartitionDto> {
    set.partitions
        .iter_mut()
        .find(|partition| partition.audience == *audience)
}

fn manifest_digest(documents: &[ManifestDocument]) -> Result<String> {
    let value = serde_json::to_value(documents).map_err(|_| FamilyEvidenceError::Invalid)?;
    let canonical = canonical_json(&value).map_err(|_| FamilyEvidenceError::Invalid)?;
    Ok(sha256_hex(canonical.as_bytes()))
}

fn valid_source_free(kind: &str, value: &Value) -> bool {
    if !matches!(kind, "INVESTMENT_FX_RATE" | "INVESTMENT_MARKET_PRICE")
        || value
            .get("sourceDocumentId")
            .is_some_and(|value| !value.is_null())
        || value.get("sourceRow").is_some_and(|value| !value.is_null())
    {
        return false;
    }
    let source_kind = value.get("sourceKind").and_then(Value::as_str);
    matches!(
        (kind, source_kind),
        ("INVESTMENT_FX_RATE", Some("MANUAL" | "OFFICIAL_REFERENCE"))
            | (
                "INVESTMENT_MARKET_PRICE",
                Some("MANUAL" | "OFFICIAL_REFERENCE" | "EXCHANGE_CLOSE")
            )
    )
}

fn portfolio_rows_present(record: &FamilySnapshotRecordDto, document: &ManifestDocument) -> bool {
    let Ok(value) = record_value(record) else {
        return false;
    };
    let rows = document
        .records
        .iter()
        .map(|record| record.row_number)
        .collect::<BTreeSet<_>>();
    ["assetClasses", "positions", "fxRates"]
        .into_iter()
        .all(|key| {
            value
                .get(key)
                .and_then(Value::as_array)
                .is_some_and(|items| {
                    items.iter().all(|item| {
                        item.get("sourceRow")
                            .and_then(Value::as_u64)
                            .is_some_and(|row| rows.contains(&row))
                    })
                })
        })
}

/// Add the evidence closure to a preview or allocated snapshot. Incomplete
/// aggregates are withheld at parent grain and their kind ceases to be
/// authoritative, preventing an omission from becoming a remote delete.
pub(crate) fn prepare(
    connection: &Connection,
    vault: &DocumentVault,
    mut set: FamilySnapshotSetDto,
) -> Result<PreparedFamilyEvidence> {
    if set.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(FamilyEvidenceError::Invalid);
    }
    let mut withheld_counts_by_audience = set
        .partitions
        .iter()
        .map(|partition| (audience_key(&partition.audience), empty_reasons()))
        .collect::<BTreeMap<_, _>>();
    let mut withheld_domains_by_audience = set
        .partitions
        .iter()
        .map(|partition| (audience_key(&partition.audience), empty_domains()))
        .collect::<BTreeMap<_, _>>();
    let all_documents = evidence_bundle::load_confirmed_documents(
        connection,
        &set.household_id,
        &set.source_installation_id,
    )
    .map_err(|_| FamilyEvidenceError::Database)?;
    let mut blobs = BTreeMap::new();
    let mut documents = Vec::new();
    for document in all_documents {
        let Ok(retrieved) = vault.read(&document.sha256) else {
            continue;
        };
        if retrieved.sha256 != document.sha256
            || retrieved.mime_type != document.media_type
            || retrieved.bytes.len() as u64 != document.byte_size
        {
            continue;
        }
        blobs
            .entry(document.sha256.clone())
            .or_insert(retrieved.bytes);
        documents.push(document);
    }

    let evidence_kinds = [
        "CARD_STATEMENT",
        "CARD_PAYMENT",
        "PORTFOLIO_SNAPSHOT",
        "BROKERAGE_EVENT",
        "INVESTMENT_FX_RATE",
        "INVESTMENT_MARKET_PRICE",
        "AGGREGATE_ASSET_SNAPSHOT",
    ];
    let mut pending = Vec::new();
    for partition in &mut set.partitions {
        let audience = partition.audience.clone();
        let mut retained = Vec::new();
        for record in partition.records.drain(..) {
            if evidence_kinds.contains(&record.entity_kind.as_str()) {
                pending.push((audience.clone(), record));
            } else {
                retained.push(record);
            }
        }
        partition.records = retained;
    }

    let mut accepted = BTreeMap::<(String, String), FamilyAudienceDto>::new();
    let mut payment_transactions = BTreeMap::<String, (String, FamilyAudienceDto)>::new();
    pending.sort_by_key(|(_, record)| match record.entity_kind.as_str() {
        "CARD_STATEMENT" => 0,
        "CARD_PAYMENT" => 2,
        _ => 1,
    });
    for (base_audience, record) in pending {
        let value = record_value(&record)?;
        let mut audience = base_audience.clone();
        let reason = if record.entity_kind == "CARD_STATEMENT" {
            let supporting = documents
                .iter()
                .filter(|document| document.card_statement_ids.contains(&record.entity_id))
                .collect::<Vec<_>>();
            if supporting.len() != 1 {
                Some("MISSING_CARD_EVIDENCE")
            } else if let Some(next) = document_audience(supporting[0])
                .as_ref()
                .and_then(|dependency| meet(&audience, dependency))
            {
                audience = next;
                let mut mismatch = false;
                for transaction_id in value
                    .get("lines")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|line| line.get("transactionId").and_then(Value::as_str))
                {
                    let Some(dependency) =
                        transaction_audience(connection, &set.household_id, transaction_id)?
                    else {
                        mismatch = true;
                        break;
                    };
                    let Some(next) = meet(&audience, &dependency) else {
                        mismatch = true;
                        break;
                    };
                    audience = next;
                }
                mismatch.then_some("EVIDENCE_AUDIENCE_MISMATCH")
            } else {
                Some("EVIDENCE_AUDIENCE_MISMATCH")
            }
        } else if record.entity_kind == "CARD_PAYMENT" {
            let bank_transaction =
                value_id(&value, "bankTransactionId")?.ok_or(FamilyEvidenceError::Invalid)?;
            let supporting = documents
                .iter()
                .filter(|document| {
                    document
                        .transaction_links
                        .iter()
                        .any(|link| link.transaction_id == bank_transaction)
                })
                .collect::<Vec<_>>();
            if supporting.is_empty() {
                Some("MISSING_CARD_EVIDENCE")
            } else {
                let mut mismatch = false;
                let mut missing = false;
                for document in supporting {
                    let Some(next) = document_audience(document)
                        .as_ref()
                        .and_then(|dependency| meet(&audience, dependency))
                    else {
                        mismatch = true;
                        break;
                    };
                    audience = next;
                }
                if let Some(transaction) =
                    transaction_audience(connection, &set.household_id, &bank_transaction)?
                {
                    if let Some(next) = meet(&audience, &transaction) {
                        audience = next;
                    } else {
                        mismatch = true;
                    }
                } else {
                    mismatch = true;
                }
                if let Some(statement_id) = value_id(&value, "statementId")? {
                    match accepted.get(&("CARD_STATEMENT".to_owned(), statement_id)) {
                        Some(statement_audience) => {
                            if let Some(next) = meet(&audience, statement_audience) {
                                audience = next;
                            } else {
                                mismatch = true;
                            }
                        }
                        None => missing = true,
                    }
                }
                if !mismatch {
                    payment_transactions.insert(
                        record.entity_id.clone(),
                        (bank_transaction, audience.clone()),
                    );
                }
                if missing {
                    Some("MISSING_CARD_EVIDENCE")
                } else {
                    mismatch.then_some("EVIDENCE_AUDIENCE_MISMATCH")
                }
            }
        } else if valid_source_free(&record.entity_kind, &value) {
            None
        } else {
            let supporting = documents
                .iter()
                .filter(|document| {
                    document.investment_links.iter().any(|link| {
                        link.entity_kind == record.entity_kind && link.entity_id == record.entity_id
                    })
                })
                .collect::<Vec<_>>();
            if supporting.len() != 1
                || (record.entity_kind == "PORTFOLIO_SNAPSHOT"
                    && !portfolio_rows_present(&record, supporting[0]))
            {
                Some("MISSING_INVESTMENT_EVIDENCE")
            } else if let Some(next) = document_audience(supporting[0])
                .as_ref()
                .and_then(|dependency| meet(&audience, dependency))
            {
                audience = next;
                None
            } else {
                Some("EVIDENCE_AUDIENCE_MISMATCH")
            }
        };

        if let Some(reason) = reason {
            increment(&mut set, reason);
            attribute_withheld(
                &mut withheld_counts_by_audience,
                &mut withheld_domains_by_audience,
                &base_audience,
                reason,
                evidence_domain(&record.entity_kind),
            );
            remove_kind_authority(&mut set, &record.entity_kind);
            continue;
        }
        if audience.member_id.is_some()
            && audience.member_id.as_deref() != Some(set.publisher_member_id.as_str())
        {
            increment(&mut set, "OTHER_MEMBER_PERSONAL");
            attribute_withheld(
                &mut withheld_counts_by_audience,
                &mut withheld_domains_by_audience,
                &base_audience,
                "OTHER_MEMBER_PERSONAL",
                evidence_domain(&record.entity_kind),
            );
            remove_kind_authority(&mut set, &record.entity_kind);
            continue;
        }
        let Some(partition) = target_partition_mut(&mut set, &audience) else {
            increment(&mut set, "UNASSIGNED_SCOPE");
            attribute_withheld(
                &mut withheld_counts_by_audience,
                &mut withheld_domains_by_audience,
                &base_audience,
                "UNASSIGNED_SCOPE",
                evidence_domain(&record.entity_kind),
            );
            remove_kind_authority(&mut set, &record.entity_kind);
            continue;
        };
        accepted.insert(
            (record.entity_kind.clone(), record.entity_id.clone()),
            audience,
        );
        partition.records.push(record);
    }

    let mut by_audience = BTreeMap::new();
    for partition in &set.partitions {
        let audience = partition.audience.clone();
        let statement_ids = accepted
            .iter()
            .filter(|((kind, _), record_audience)| {
                kind == "CARD_STATEMENT" && **record_audience == audience
            })
            .map(|((_, id), _)| id.as_str())
            .collect::<BTreeSet<_>>();
        let investment_ids = accepted
            .iter()
            .filter(|((kind, _), record_audience)| {
                kind != "CARD_STATEMENT" && kind != "CARD_PAYMENT" && **record_audience == audience
            })
            .map(|((kind, id), _)| (kind.as_str(), id.as_str()))
            .collect::<BTreeSet<_>>();
        let bank_transactions = payment_transactions
            .values()
            .filter(|(_, record_audience)| *record_audience == audience)
            .map(|(transaction, _)| transaction.as_str())
            .collect::<BTreeSet<_>>();
        let mut selected = Vec::new();
        for document in &documents {
            let mut document = document.clone();
            document
                .card_statement_ids
                .retain(|id| statement_ids.contains(id.as_str()));
            document.investment_links.retain(|link| {
                investment_ids.contains(&(link.entity_kind.as_str(), link.entity_id.as_str()))
            });
            document
                .transaction_links
                .retain(|link| bank_transactions.contains(link.transaction_id.as_str()));
            if !document.card_statement_ids.is_empty()
                || !document.investment_links.is_empty()
                || !document.transaction_links.is_empty()
            {
                selected.push(document);
            }
        }
        evidence_bundle::validate_documents(&selected, 2)
            .map_err(|_| FamilyEvidenceError::Invalid)?;
        by_audience.insert(audience_key(&audience), selected);
    }

    for partition in &mut set.partitions {
        let docs = by_audience
            .get(&audience_key(&partition.audience))
            .ok_or(FamilyEvidenceError::Invalid)?;
        partition.evidence_file_count = docs.len() as u64;
        partition.evidence_record_count = docs
            .iter()
            .map(|document| document.records.len() as u64)
            .sum();
        partition.evidence_manifest_sha256 = Some(manifest_digest(docs)?);
    }
    family_snapshot::rebuild_after_evidence(&mut set).map_err(|_| FamilyEvidenceError::Snapshot)?;

    let oversized = set
        .partitions
        .iter()
        .filter_map(|partition| {
            let docs = by_audience.get(&audience_key(&partition.audience))?;
            let header = FamilyEvidenceHeader {
                format: CURRENT_FORMAT.to_owned(),
                snapshot_set: one_partition(&set, &partition.audience).ok()?,
                evidence_documents: docs.clone(),
            };
            let size = canonical_header(&header)
                .ok()?
                .len()
                .checked_add(PREFIX_LEN)?
                .checked_add(docs.iter().try_fold(0_usize, |total, document| {
                    total.checked_add(document.byte_size as usize)
                })?)?;
            (size > MAX_ARTIFACT_BYTES).then_some(partition.audience.clone())
        })
        .collect::<Vec<_>>();
    for audience in oversized {
        let removed = {
            let partition =
                target_partition_mut(&mut set, &audience).ok_or(FamilyEvidenceError::Invalid)?;
            let removed = partition
                .records
                .iter()
                .filter(|record| evidence_kinds.contains(&record.entity_kind.as_str()))
                .map(|record| record.entity_kind.clone())
                .collect::<Vec<_>>();
            partition
                .records
                .retain(|record| !evidence_kinds.contains(&record.entity_kind.as_str()));
            removed
        };
        for kind in &removed {
            increment(&mut set, "EVIDENCE_SIZE_LIMIT");
            attribute_withheld(
                &mut withheld_counts_by_audience,
                &mut withheld_domains_by_audience,
                &audience,
                "EVIDENCE_SIZE_LIMIT",
                evidence_domain(kind),
            );
            remove_kind_authority(&mut set, kind);
        }
        let docs = by_audience
            .get_mut(&audience_key(&audience))
            .ok_or(FamilyEvidenceError::Invalid)?;
        docs.clear();
    }
    if !by_audience.is_empty() {
        for partition in &mut set.partitions {
            let docs = by_audience
                .get(&audience_key(&partition.audience))
                .ok_or(FamilyEvidenceError::Invalid)?;
            partition.evidence_file_count = docs.len() as u64;
            partition.evidence_record_count = docs
                .iter()
                .map(|document| document.records.len() as u64)
                .sum();
            partition.evidence_manifest_sha256 = Some(manifest_digest(docs)?);
        }
        family_snapshot::rebuild_after_evidence(&mut set)
            .map_err(|_| FamilyEvidenceError::Snapshot)?;
    }

    for partition in &set.partitions {
        let docs = by_audience
            .get(&audience_key(&partition.audience))
            .ok_or(FamilyEvidenceError::Invalid)?;
        let header = FamilyEvidenceHeader {
            format: CURRENT_FORMAT.to_owned(),
            snapshot_set: one_partition(&set, &partition.audience)?,
            evidence_documents: docs.clone(),
        };
        let header_len = canonical_header(&header)?.len();
        let blob_len = docs
            .iter()
            .try_fold(0_usize, |total, document| {
                total.checked_add(document.byte_size as usize)
            })
            .ok_or(FamilyEvidenceError::Limit)?;
        if PREFIX_LEN + header_len + blob_len > MAX_ARTIFACT_BYTES {
            return Err(FamilyEvidenceError::Limit);
        }
    }

    Ok(PreparedFamilyEvidence {
        set,
        withheld_counts_by_audience,
        withheld_domains_by_audience,
        documents: by_audience,
        blobs,
    })
}

fn one_partition(
    set: &FamilySnapshotSetDto,
    audience: &FamilyAudienceDto,
) -> Result<FamilySnapshotSetDto> {
    let bytes = family_snapshot::encode_partition_artifact(set, audience)
        .map_err(|_| FamilyEvidenceError::Snapshot)?;
    family_snapshot::decode_and_validate(&bytes).map_err(|_| FamilyEvidenceError::Snapshot)
}

fn canonical_header(header: &FamilyEvidenceHeader) -> Result<Vec<u8>> {
    let value = serde_json::to_value(header).map_err(|_| FamilyEvidenceError::Invalid)?;
    Ok(canonical_json(&value)
        .map_err(|_| FamilyEvidenceError::Invalid)?
        .into_bytes())
}

pub(crate) fn encode(
    prepared: &PreparedFamilyEvidence,
    audience: &FamilyAudienceDto,
) -> Result<Vec<u8>> {
    let documents = prepared
        .documents
        .get(&audience_key(audience))
        .ok_or(FamilyEvidenceError::Invalid)?;
    if prepared.set.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(FamilyEvidenceError::Invalid);
    }
    let header = FamilyEvidenceHeader {
        format: CURRENT_FORMAT.to_owned(),
        snapshot_set: one_partition(&prepared.set, audience)?,
        evidence_documents: documents.clone(),
    };
    let header = canonical_header(&header)?;
    let header_len = u64::try_from(header.len()).map_err(|_| FamilyEvidenceError::Limit)?;
    let mut bytes = Vec::with_capacity(PREFIX_LEN + header.len());
    bytes.extend_from_slice(KFF4_MAGIC);
    bytes.extend_from_slice(&header_len.to_be_bytes());
    bytes.extend_from_slice(&header);
    for document in documents {
        let blob = prepared
            .blobs
            .get(&document.sha256)
            .ok_or(FamilyEvidenceError::Vault)?;
        bytes.extend_from_slice(blob);
    }
    if bytes.len() > MAX_ARTIFACT_BYTES {
        return Err(FamilyEvidenceError::Limit);
    }
    Ok(bytes)
}

pub(crate) fn decode(bytes: &[u8]) -> Result<DecodedFamilyEvidence> {
    if bytes.len() < PREFIX_LEN || bytes.len() > MAX_ARTIFACT_BYTES {
        return Err(FamilyEvidenceError::Invalid);
    }
    let magic = &bytes[..4];
    if magic != KFF3_MAGIC && magic != KFF4_MAGIC {
        return Err(FamilyEvidenceError::Invalid);
    }
    let header_len = usize::try_from(u64::from_be_bytes(
        bytes[4..12]
            .try_into()
            .map_err(|_| FamilyEvidenceError::Invalid)?,
    ))
    .map_err(|_| FamilyEvidenceError::Limit)?;
    let header_end = PREFIX_LEN
        .checked_add(header_len)
        .filter(|end| *end <= bytes.len())
        .ok_or(FamilyEvidenceError::Invalid)?;
    let header: FamilyEvidenceHeader = serde_json::from_slice(&bytes[PREFIX_LEN..header_end])
        .map_err(|_| FamilyEvidenceError::Invalid)?;
    if !valid_container_tuple(magic, &header.format, header.snapshot_set.schema_version)
        || canonical_header(&header)? != bytes[PREFIX_LEN..header_end]
        || header.snapshot_set.partitions.len() != 1
    {
        return Err(FamilyEvidenceError::Invalid);
    }
    family_snapshot::validate_snapshot_set(&header.snapshot_set)
        .map_err(|_| FamilyEvidenceError::Invalid)?;
    evidence_bundle::validate_documents(&header.evidence_documents, 2)
        .map_err(|_| FamilyEvidenceError::Invalid)?;
    let partition = &header.snapshot_set.partitions[0];
    if partition.evidence_manifest_sha256.as_deref()
        != Some(manifest_digest(&header.evidence_documents)?.as_str())
        || partition.evidence_file_count != header.evidence_documents.len() as u64
        || partition.evidence_record_count
            != header
                .evidence_documents
                .iter()
                .map(|document| document.records.len() as u64)
                .sum::<u64>()
    {
        return Err(FamilyEvidenceError::Invalid);
    }
    let mut offset = header_end;
    let mut blobs = Vec::new();
    for document in &header.evidence_documents {
        let len = usize::try_from(document.byte_size).map_err(|_| FamilyEvidenceError::Limit)?;
        let end = offset
            .checked_add(len)
            .filter(|end| *end <= bytes.len())
            .ok_or(FamilyEvidenceError::Invalid)?;
        let blob = bytes[offset..end].to_vec();
        if sha256_hex(&blob) != document.sha256 {
            return Err(FamilyEvidenceError::Invalid);
        }
        blobs.push(blob);
        offset = end;
    }
    if offset != bytes.len() {
        return Err(FamilyEvidenceError::Invalid);
    }
    Ok(DecodedFamilyEvidence {
        set: header.snapshot_set,
        documents: header.evidence_documents,
        blobs,
    })
}

fn valid_container_tuple(magic: &[u8], format: &str, schema_version: u32) -> bool {
    matches!(
        (magic, format, schema_version),
        (b"KFF3", "KFF3", 3) | (b"KFF4", "KFF4", 4)
    )
}

pub(crate) fn put_blobs(
    vault: &DocumentVault,
    decoded: &DecodedFamilyEvidence,
) -> Result<Vec<String>> {
    let mut new_hashes = Vec::new();
    for (document, blob) in decoded.documents.iter().zip(&decoded.blobs) {
        let stored = vault
            .put(blob, &document.media_type)
            .map_err(|_| FamilyEvidenceError::Vault)?;
        if stored.sha256 != document.sha256 || stored.plaintext_size != document.byte_size {
            cleanup(vault, &new_hashes);
            return Err(FamilyEvidenceError::Vault);
        }
        if !stored.deduplicated {
            new_hashes.push(stored.sha256);
        }
    }
    Ok(new_hashes)
}

pub(crate) fn materialize(
    transaction: &rusqlite::Transaction<'_>,
    decoded: &DecodedFamilyEvidence,
) -> Result<()> {
    let manifest = Manifest {
        schema_version: 2,
        bundle_id: manifest_digest(&decoded.documents)?,
        household_id: decoded.set.household_id.clone(),
        origin_installation_id: decoded.set.source_installation_id.clone(),
        created_at: decoded.set.created_at.clone(),
        documents: decoded.documents.clone(),
    };
    for document in &decoded.documents {
        evidence_bundle::materialize_document(transaction, &manifest, document)
            .map_err(|_| FamilyEvidenceError::Database)?;
    }
    Ok(())
}

pub(crate) fn cleanup(vault: &DocumentVault, hashes: &[String]) {
    for hash in hashes {
        let _ = vault.delete(hash);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{persistence::AppState, sync_foundation::get_local_status};
    use serde_json::json;

    const TEST_KEY: &[u8] = b"family-evidence-container-test-key";

    fn current_prepared() -> PreparedFamilyEvidence {
        let state = AppState::in_memory(TEST_KEY).unwrap();
        let root = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(root.path(), &[73_u8; 32]).unwrap();
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name,base_currency)
                     VALUES('family','Family','JPY')",
                    [],
                )?;
                get_local_status(connection, "family").unwrap();
                let set = family_snapshot::export_snapshot_set(connection, "family").unwrap();
                Ok(prepare(connection, &vault, set).unwrap())
            })
            .unwrap()
    }

    fn digest(value: &Value) -> String {
        sha256_hex(canonical_json(value).unwrap().as_bytes())
    }

    fn downgrade_kff4_to_schema_three(bytes: &[u8]) -> Vec<u8> {
        let header_len =
            usize::try_from(u64::from_be_bytes(bytes[4..12].try_into().unwrap())).unwrap();
        let mut header: Value =
            serde_json::from_slice(&bytes[PREFIX_LEN..PREFIX_LEN + header_len]).unwrap();
        header["format"] = Value::String("KFF3".into());
        let set = header["snapshotSet"].as_object_mut().unwrap();
        set.insert("schemaVersion".into(), Value::from(3));
        let partition_values = {
            let partition = set["partitions"].as_array_mut().unwrap()[0]
                .as_object_mut()
                .unwrap();
            partition["records"]
                .as_array_mut()
                .unwrap()
                .retain(|record| record["entityKind"] != "RECURRING_SERIES_PREFERENCES");
            partition["authoritativeKinds"]
                .as_array_mut()
                .unwrap()
                .retain(|kind| kind != "RECURRING_SERIES_PREFERENCES");
            partition["countsByKind"]
                .as_object_mut()
                .unwrap()
                .remove("RECURRING_SERIES_PREFERENCES");
            partition.clone()
        };

        let partition_identity = json!({
            "format": set["format"],
            "schemaVersion": set["schemaVersion"],
            "mode": set["mode"],
            "sourceInstallationId": set["sourceInstallationId"],
            "sourcePrincipalId": set["sourcePrincipalId"],
            "publisherMemberId": set["publisherMemberId"],
            "sourceRevision": set["sourceRevision"],
            "householdId": set["householdId"],
            "createdAt": set["createdAt"],
            "audience": partition_values["audience"],
            "dependencyAudiences": partition_values["dependencyAudiences"],
            "authoritativeKinds": partition_values["authoritativeKinds"],
            "countsByKind": partition_values["countsByKind"],
            "records": partition_values["records"],
            "evidenceManifestSha256": partition_values["evidenceManifestSha256"],
            "evidenceFileCount": partition_values.get("evidenceFileCount").cloned().unwrap_or(Value::from(0)),
            "evidenceRecordCount": partition_values.get("evidenceRecordCount").cloned().unwrap_or(Value::from(0)),
        });
        let snapshot_sha256 = digest(&partition_identity);
        let partition = set["partitions"].as_array_mut().unwrap()[0]
            .as_object_mut()
            .unwrap();
        partition.insert(
            "snapshotSha256".into(),
            Value::String(snapshot_sha256.clone()),
        );
        let package_id = format!("family-partition-{snapshot_sha256}");
        partition.insert("packageId".into(), Value::String(package_id.clone()));
        partition.insert(
            "packageSha256".into(),
            Value::String(digest(&json!({
                "packageId": package_id,
                "snapshotSha256": snapshot_sha256,
                "identity": partition_identity,
            }))),
        );

        let mut set_identity = Value::Object(set.clone());
        let identity = set_identity.as_object_mut().unwrap();
        identity.remove("snapshotSetId");
        identity.remove("setSha256");
        let set_sha256 = digest(&set_identity);
        set.insert("setSha256".into(), Value::String(set_sha256.clone()));
        set.insert(
            "snapshotSetId".into(),
            Value::String(format!("family-set-{set_sha256}")),
        );

        let canonical = canonical_json(&header).unwrap().into_bytes();
        let mut downgraded = Vec::with_capacity(PREFIX_LEN + canonical.len());
        downgraded.extend_from_slice(KFF3_MAGIC);
        downgraded.extend_from_slice(&(canonical.len() as u64).to_be_bytes());
        downgraded.extend_from_slice(&canonical);
        downgraded
    }

    #[test]
    fn accepts_only_exact_evidence_container_and_snapshot_schema_tuples() {
        assert!(valid_container_tuple(KFF3_MAGIC, "KFF3", 3));
        assert!(valid_container_tuple(KFF4_MAGIC, "KFF4", 4));
        for (magic, format, schema_version) in [
            (KFF3_MAGIC.as_slice(), "KFF3", 4),
            (KFF3_MAGIC.as_slice(), "KFF4", 3),
            (KFF4_MAGIC.as_slice(), "KFF4", 3),
            (KFF4_MAGIC.as_slice(), "KFF3", 4),
        ] {
            assert!(!valid_container_tuple(magic, format, schema_version));
        }
    }

    #[test]
    fn current_encode_emits_kff4_and_schema_four_round_trips() {
        let prepared = current_prepared();
        let audience = prepared.set.partitions[0].audience.clone();
        let bytes = encode(&prepared, &audience).unwrap();
        assert_eq!(&bytes[..4], KFF4_MAGIC);
        let decoded = decode(&bytes).unwrap();
        assert_eq!(decoded.set.schema_version, 4);
        assert_eq!(decoded.documents.len(), decoded.blobs.len());
    }

    #[test]
    fn historical_kff3_schema_three_still_round_trips() {
        let prepared = current_prepared();
        let audience = prepared.set.partitions[0].audience.clone();
        let current = encode(&prepared, &audience).unwrap();
        let historical = downgrade_kff4_to_schema_three(&current);
        assert_eq!(&historical[..4], KFF3_MAGIC);
        let decoded = decode(&historical).unwrap();
        assert_eq!(decoded.set.schema_version, 3);
        assert!(decoded.set.partitions[0]
            .records
            .iter()
            .all(|record| record.entity_kind != "RECURRING_SERIES_PREFERENCES"));
    }

    #[test]
    fn decode_rejects_magic_format_and_snapshot_schema_mismatches() {
        let prepared = current_prepared();
        let audience = prepared.set.partitions[0].audience.clone();
        let current = encode(&prepared, &audience).unwrap();
        let historical = downgrade_kff4_to_schema_three(&current);

        for mut mismatched in [current, historical] {
            if &mismatched[..4] == KFF4_MAGIC {
                mismatched[..4].copy_from_slice(KFF3_MAGIC);
            } else {
                mismatched[..4].copy_from_slice(KFF4_MAGIC);
            }
            assert!(matches!(
                decode(&mismatched),
                Err(FamilyEvidenceError::Invalid)
            ));
        }
    }

    #[test]
    fn rejects_truncated_or_tampered_family_evidence_headers() {
        assert!(matches!(decode(b"KFF3"), Err(FamilyEvidenceError::Invalid)));
        assert!(matches!(decode(b"KFF4"), Err(FamilyEvidenceError::Invalid)));

        let mut non_canonical = Vec::from(KFF4_MAGIC.as_slice());
        non_canonical.extend_from_slice(&(2_u64).to_be_bytes());
        non_canonical.extend_from_slice(b"{}");
        assert!(matches!(
            decode(&non_canonical),
            Err(FamilyEvidenceError::Invalid)
        ));

        let mut impossible_length = Vec::from(KFF3_MAGIC.as_slice());
        impossible_length.extend_from_slice(&u64::MAX.to_be_bytes());
        assert!(matches!(
            decode(&impossible_length),
            Err(FamilyEvidenceError::Limit | FamilyEvidenceError::Invalid)
        ));
    }

    #[test]
    fn rejects_artifacts_over_the_transport_limit_before_parsing() {
        let bytes = vec![0_u8; MAX_ARTIFACT_BYTES + 1];
        assert!(matches!(decode(&bytes), Err(FamilyEvidenceError::Invalid)));
    }
}
