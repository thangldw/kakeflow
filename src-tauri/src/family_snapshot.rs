//! Audience-partitioned family current-state snapshots.
//!
//! This format is intentionally independent from `change_package` schema v1-v4.
//! It currently carries only the household/member/account/transaction graph and
//! fails closed when a transaction depends on PERSONAL accounts belonging to
//! more than one member.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

use crate::{
    change_package,
    sync_foundation::{canonical_json, get_local_status, sha256_hex},
};

pub const FAMILY_FORMAT: &str = "KAKEFLOW_FAMILY_SNAPSHOT_SET";
pub const FAMILY_SCHEMA_VERSION: u32 = 2;
pub const FAMILY_MODE: &str = "AUDIENCE_PARTITION_CURRENT_STATE";
pub const FAMILY_V1_SUPPORTED_KINDS: [&str; 4] =
    ["HOUSEHOLD", "HOUSEHOLD_MEMBER", "ACCOUNT", "TRANSACTION"];
pub const FAMILY_SUPPORTED_KINDS: [&str; 11] = [
    "HOUSEHOLD",
    "HOUSEHOLD_MEMBER",
    "ACCOUNT",
    "TRANSACTION",
    "MONTHLY_BUDGET_PLAN",
    "SAVINGS_GOAL",
    "CLASSIFICATION_RULE",
    "ACCOUNT_GROUP",
    "CARD_SETTLEMENT_MAPPING",
    "DASHBOARD_PREFERENCES",
    "DELIMITED_PARSER_PROFILE",
];
const MAX_RECORDS: usize = 100_000;

#[derive(Debug, Error)]
pub enum FamilySnapshotError {
    #[error("family snapshot database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("family snapshot input is invalid")]
    InvalidInput,
    #[error("family snapshot household was not found")]
    NotFound,
    #[error("family snapshot has unresolved audience dependencies")]
    AudienceBlocked,
    #[error("another family snapshot is awaiting review")]
    ReviewPending,
    #[error("family snapshot conflicts with local state")]
    Conflict,
    #[error("family snapshot revision is stale")]
    Stale,
    #[error("family snapshot limit was exceeded")]
    LimitExceeded,
    #[error("family snapshot encoding failed")]
    Encoding,
}

pub type Result<T> = std::result::Result<T, FamilySnapshotError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FamilyAudienceDto {
    pub visibility: String,
    pub member_id: Option<String>,
}

impl FamilyAudienceDto {
    fn shared() -> Self {
        Self {
            visibility: "SHARED".to_owned(),
            member_id: None,
        }
    }

    fn personal(member_id: impl Into<String>) -> Self {
        Self {
            visibility: "PERSONAL".to_owned(),
            member_id: Some(member_id.into()),
        }
    }

    fn valid(&self) -> bool {
        match (self.visibility.as_str(), self.member_id.as_deref()) {
            ("SHARED", None) => true,
            ("PERSONAL", Some(member)) => valid_id(member),
            _ => false,
        }
    }

    pub(crate) fn member_key(&self) -> &str {
        self.member_id.as_deref().unwrap_or("")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FamilySnapshotRecordDto {
    pub entity_kind: String,
    pub entity_id: String,
    pub operation: String,
    pub canonical_payload_json: String,
    pub payload_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FamilySnapshotPartitionDto {
    pub package_id: String,
    pub audience: FamilyAudienceDto,
    pub dependency_audiences: BTreeMap<String, FamilyAudienceDto>,
    pub authoritative_kinds: Vec<String>,
    pub counts_by_kind: BTreeMap<String, u64>,
    pub snapshot_sha256: String,
    pub package_sha256: String,
    pub records: Vec<FamilySnapshotRecordDto>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relocations: Vec<FamilyEntityRelocationDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FamilySnapshotSetDto {
    pub format: String,
    pub schema_version: u32,
    pub mode: String,
    pub snapshot_set_id: String,
    pub source_installation_id: String,
    pub source_principal_id: String,
    pub publisher_member_id: String,
    pub source_revision: u64,
    pub household_id: String,
    pub created_at: String,
    pub excluded_counts_by_reason: BTreeMap<String, u64>,
    pub partitions: Vec<FamilySnapshotPartitionDto>,
    pub set_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FamilyEntityRelocationDto {
    pub entity_kind: String,
    pub entity_id: String,
    pub target_audience: FamilyAudienceDto,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FamilySnapshotRecordReviewDto {
    pub partition_order: u32,
    pub audience: FamilyAudienceDto,
    pub record_order: u64,
    pub entity_kind: String,
    pub entity_id: String,
    pub operation: String,
    pub payload_sha256: String,
    pub review_state: String,
    pub resolution: String,
    pub current_payload_sha256: Option<String>,
    pub conflict_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FamilySnapshotReviewDto {
    pub snapshot_set_id: String,
    pub target_household_id: String,
    pub source_installation_id: String,
    pub source_revision: u64,
    pub publisher_member_id: String,
    pub state: String,
    pub record_count: u64,
    pub conflict_count: u64,
    pub delete_count: u64,
    pub records: Vec<FamilySnapshotRecordReviewDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FamilySnapshotResolutionInput {
    pub partition_order: u32,
    pub entity_kind: String,
    pub entity_id: String,
    pub resolution: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PartitionIdentity<'a> {
    format: &'static str,
    schema_version: u32,
    mode: &'static str,
    source_installation_id: &'a str,
    source_principal_id: &'a str,
    publisher_member_id: &'a str,
    source_revision: u64,
    household_id: &'a str,
    created_at: &'a str,
    audience: &'a FamilyAudienceDto,
    dependency_audiences: &'a BTreeMap<String, FamilyAudienceDto>,
    authoritative_kinds: &'a [String],
    counts_by_kind: &'a BTreeMap<String, u64>,
    records: &'a [FamilySnapshotRecordDto],
    #[serde(skip_serializing_if = "Vec::is_empty")]
    relocations: &'a Vec<FamilyEntityRelocationDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetIdentity<'a> {
    format: &'a str,
    schema_version: u32,
    mode: &'a str,
    source_installation_id: &'a str,
    source_principal_id: &'a str,
    publisher_member_id: &'a str,
    source_revision: u64,
    household_id: &'a str,
    created_at: &'a str,
    excluded_counts_by_reason: &'a BTreeMap<String, u64>,
    partitions: &'a [FamilySnapshotPartitionDto],
}

struct PartitionSource<'a> {
    source_installation_id: &'a str,
    source_principal_id: &'a str,
    publisher_member_id: &'a str,
    source_revision: u64,
    household_id: &'a str,
    created_at: &'a str,
}

#[derive(Debug, Clone)]
struct RawRecord {
    entity_kind: String,
    entity_id: String,
    canonical_payload_json: String,
    payload_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum EffectiveAudience {
    Deliver(FamilyAudienceDto),
    OtherMember,
    Mixed,
    Unassigned,
}

pub fn export_snapshot_set(
    connection: &Connection,
    household_id: &str,
) -> Result<FamilySnapshotSetDto> {
    build_snapshot_set(connection, household_id, true)
}

pub(crate) fn preview_snapshot_set(
    connection: &Connection,
    household_id: &str,
) -> Result<FamilySnapshotSetDto> {
    build_snapshot_set(connection, household_id, false)
}

fn build_snapshot_set(
    connection: &Connection,
    household_id: &str,
    allocate_revision: bool,
) -> Result<FamilySnapshotSetDto> {
    if !valid_id(household_id) {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let status =
        get_local_status(connection, household_id).map_err(|_| FamilySnapshotError::NotFound)?;
    let publisher_member_id = status
        .binding
        .member_id
        .clone()
        .ok_or(FamilySnapshotError::AudienceBlocked)?;
    let publisher_active: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM household_members
         WHERE household_id=?1 AND id=?2 AND status='ACTIVE')",
        params![household_id, publisher_member_id],
        |row| row.get(0),
    )?;
    if !publisher_active {
        return Err(FamilySnapshotError::AudienceBlocked);
    }

    let transaction = connection.unchecked_transaction()?;
    if allocate_revision {
        transaction.execute(
            "UPDATE family_snapshot_revisions SET revision=revision+1,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1",
            [household_id],
        )?;
    }
    let revision: i64 = transaction.query_row(
        "SELECT revision FROM family_snapshot_revisions WHERE household_id=?1",
        [household_id],
        |row| row.get(0),
    )?;
    let created_at: String = if allocate_revision {
        transaction.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
            row.get(0)
        })?
    } else {
        transaction.query_row(
            "SELECT updated_at FROM households WHERE id=?1",
            [household_id],
            |row| row.get(0),
        )?
    };

    let mut raw_records = load_core_records(&transaction, household_id)?;
    raw_records.extend(
        change_package::load_planning_configuration_records(&transaction, household_id)
            .map_err(|_| FamilySnapshotError::Encoding)?
            .into_iter()
            .map(|record| RawRecord {
                entity_kind: record.entity_kind,
                entity_id: record.entity_id,
                canonical_payload_json: record.canonical_payload_json,
                payload_sha256: record.payload_sha256,
            }),
    );
    if raw_records.len() > MAX_RECORDS {
        return Err(FamilySnapshotError::LimitExceeded);
    }
    let account_audiences = account_audiences(&raw_records)?;
    let mut shared_records = Vec::new();
    let mut personal_records = Vec::new();
    let mut excluded = default_excluded_counts();
    let mut unresolved_kinds = BTreeSet::new();

    for record in raw_records {
        match effective_audience(&record, &account_audiences, &publisher_member_id)? {
            EffectiveAudience::Deliver(audience) if audience.visibility == "SHARED" => {
                shared_records.push(to_record(record));
            }
            EffectiveAudience::Deliver(_) => personal_records.push(to_record(record)),
            EffectiveAudience::OtherMember => increment(&mut excluded, "OTHER_MEMBER_PERSONAL"),
            EffectiveAudience::Mixed => {
                increment(&mut excluded, "MIXED_PERSONAL_MEMBERS");
                unresolved_kinds.insert(record.entity_kind.clone());
            }
            EffectiveAudience::Unassigned => {
                increment(&mut excluded, "UNASSIGNED_SCOPE");
                unresolved_kinds.insert(record.entity_kind.clone());
            }
        }
    }
    excluded.insert(
        "EVIDENCE_REQUIRED_CARD".to_owned(),
        count_card_evidence_required_records(&transaction, household_id)?,
    );
    excluded.insert(
        "EVIDENCE_REQUIRED_INVESTMENT".to_owned(),
        count_investment_evidence_required_records(&transaction, household_id)?,
    );

    sort_records(&mut shared_records);
    sort_records(&mut personal_records);
    let current_audiences = shared_records
        .iter()
        .map(|record| {
            (
                (record.entity_kind.clone(), record.entity_id.clone()),
                (FamilyAudienceDto::shared(), record.payload_sha256.clone()),
            )
        })
        .chain(personal_records.iter().map(|record| {
            (
                (record.entity_kind.clone(), record.entity_id.clone()),
                (
                    FamilyAudienceDto::personal(&publisher_member_id),
                    record.payload_sha256.clone(),
                ),
            )
        }))
        .collect::<BTreeMap<_, _>>();
    let (shared_relocations, personal_relocations) = load_relocations(
        &transaction,
        household_id,
        &publisher_member_id,
        &current_audiences,
    )?;
    let source_revision =
        u64::try_from(revision.max(1)).map_err(|_| FamilySnapshotError::Encoding)?;
    let shared_lineage_unknown = outbound_lineage_unknown(&transaction, household_id, "SHARED")?;
    let personal_lineage_unknown = outbound_lineage_unknown(
        &transaction,
        household_id,
        &format!("PERSONAL:{publisher_member_id}"),
    )?;
    let shared_authoritative = FAMILY_SUPPORTED_KINDS
        .iter()
        .filter(|kind| {
            !unresolved_kinds.contains(**kind)
                && (!shared_lineage_unknown || !kind_supports_absence_delete(kind))
        })
        .map(|kind| (*kind).to_owned())
        .collect::<Vec<_>>();
    let personal_authoritative = [
        "ACCOUNT",
        "TRANSACTION",
        "MONTHLY_BUDGET_PLAN",
        "CLASSIFICATION_RULE",
        "ACCOUNT_GROUP",
        "CARD_SETTLEMENT_MAPPING",
    ]
    .iter()
    .filter(|kind| {
        !unresolved_kinds.contains(**kind)
            && (!personal_lineage_unknown || !kind_supports_absence_delete(kind))
    })
    .map(|kind| (*kind).to_owned())
    .collect::<Vec<_>>();
    let partition_source = PartitionSource {
        source_installation_id: &status.device.id,
        source_principal_id: &status.principal.id,
        publisher_member_id: &publisher_member_id,
        source_revision,
        household_id,
        created_at: &created_at,
    };
    let shared = build_partition(
        &partition_source,
        FamilyAudienceDto::shared(),
        shared_authoritative,
        shared_records,
        &account_audiences,
        shared_relocations,
    )?;
    let personal = build_partition(
        &partition_source,
        FamilyAudienceDto::personal(&publisher_member_id),
        personal_authoritative,
        personal_records,
        &account_audiences,
        personal_relocations,
    )?;
    let partitions = vec![shared, personal];
    let identity = SetIdentity {
        format: FAMILY_FORMAT,
        schema_version: FAMILY_SCHEMA_VERSION,
        mode: FAMILY_MODE,
        source_installation_id: &status.device.id,
        source_principal_id: &status.principal.id,
        publisher_member_id: &publisher_member_id,
        source_revision,
        household_id,
        created_at: &created_at,
        excluded_counts_by_reason: &excluded,
        partitions: &partitions,
    };
    let set_sha256 = hash_serializable(&identity)?;
    let snapshot_set_id = format!("family-set-{set_sha256}");
    transaction.commit()?;
    Ok(FamilySnapshotSetDto {
        format: FAMILY_FORMAT.to_owned(),
        schema_version: FAMILY_SCHEMA_VERSION,
        mode: FAMILY_MODE.to_owned(),
        snapshot_set_id,
        source_installation_id: status.device.id,
        source_principal_id: status.principal.id,
        publisher_member_id,
        source_revision,
        household_id: household_id.to_owned(),
        created_at,
        excluded_counts_by_reason: excluded,
        partitions,
        set_sha256,
    })
}

pub fn encode_pretty(set: &FamilySnapshotSetDto) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(set).map_err(|_| FamilySnapshotError::Encoding)?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// Encode one independently deliverable audience artifact. The envelope keeps
/// the source identity and revision, while its set identity is recomputed over
/// only the selected partition so SHARED and PERSONAL can travel separately.
pub fn encode_partition_artifact(
    set: &FamilySnapshotSetDto,
    audience: &FamilyAudienceDto,
) -> Result<Vec<u8>> {
    validate_snapshot_set(set)?;
    let partition = set
        .partitions
        .iter()
        .find(|partition| partition.audience == *audience)
        .cloned()
        .ok_or(FamilySnapshotError::NotFound)?;
    let mut artifact = set.clone();
    artifact.partitions = vec![partition];
    let identity = SetIdentity {
        format: &artifact.format,
        schema_version: artifact.schema_version,
        mode: &artifact.mode,
        source_installation_id: &artifact.source_installation_id,
        source_principal_id: &artifact.source_principal_id,
        publisher_member_id: &artifact.publisher_member_id,
        source_revision: artifact.source_revision,
        household_id: &artifact.household_id,
        created_at: &artifact.created_at,
        excluded_counts_by_reason: &artifact.excluded_counts_by_reason,
        partitions: &artifact.partitions,
    };
    artifact.set_sha256 = hash_serializable(&identity)?;
    artifact.snapshot_set_id = format!("family-set-{}", artifact.set_sha256);
    encode_pretty(&artifact)
}

pub fn decode_and_validate(bytes: &[u8]) -> Result<FamilySnapshotSetDto> {
    let set: FamilySnapshotSetDto =
        serde_json::from_slice(bytes).map_err(|_| FamilySnapshotError::InvalidInput)?;
    validate_snapshot_set(&set)?;
    Ok(set)
}

pub fn validate_snapshot_set(set: &FamilySnapshotSetDto) -> Result<()> {
    if set.format != FAMILY_FORMAT
        || !matches!(set.schema_version, 1 | FAMILY_SCHEMA_VERSION)
        || set.mode != FAMILY_MODE
        || !valid_id(&set.source_installation_id)
        || !valid_id(&set.source_principal_id)
        || !valid_id(&set.publisher_member_id)
        || !valid_id(&set.household_id)
        || set.source_revision == 0
        || !(1..=2).contains(&set.partitions.len())
    {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let valid_partition_shape = match set.partitions.as_slice() {
        [only] => {
            only.audience == FamilyAudienceDto::shared()
                || only.audience == FamilyAudienceDto::personal(&set.publisher_member_id)
        }
        [shared, personal] => {
            shared.audience == FamilyAudienceDto::shared()
                && personal.audience == FamilyAudienceDto::personal(&set.publisher_member_id)
        }
        _ => false,
    };
    if !valid_partition_shape {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let expected_excluded = if set.schema_version == 1 {
        vec![
            "EVIDENCE_DEPENDENT_INVESTMENT",
            "MIXED_PERSONAL_MEMBERS",
            "OTHER_MEMBER_PERSONAL",
            "UNASSIGNED_SCOPE",
            "UNSUPPORTED_KIND",
        ]
    } else {
        vec![
            "EVIDENCE_REQUIRED_CARD",
            "EVIDENCE_REQUIRED_INVESTMENT",
            "MIXED_PERSONAL_MEMBERS",
            "OTHER_MEMBER_PERSONAL",
            "UNASSIGNED_SCOPE",
        ]
    }
    .into_iter()
    .map(str::to_owned)
    .collect::<BTreeSet<_>>();
    if set
        .excluded_counts_by_reason
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>()
        != expected_excluded
    {
        return Err(FamilySnapshotError::InvalidInput);
    }

    let mut identities = BTreeSet::new();
    let mut all_records = Vec::new();
    for partition in &set.partitions {
        validate_partition(set, partition)?;
        for record in &partition.records {
            if !identities.insert((record.entity_kind.clone(), record.entity_id.clone())) {
                return Err(FamilySnapshotError::InvalidInput);
            }
            all_records.push((partition.audience.clone(), record.clone()));
        }
    }
    if all_records.len() > MAX_RECORDS {
        return Err(FamilySnapshotError::LimitExceeded);
    }
    validate_partition_scopes(set, &all_records, &set.publisher_member_id)?;

    let identity = SetIdentity {
        format: &set.format,
        schema_version: set.schema_version,
        mode: &set.mode,
        source_installation_id: &set.source_installation_id,
        source_principal_id: &set.source_principal_id,
        publisher_member_id: &set.publisher_member_id,
        source_revision: set.source_revision,
        household_id: &set.household_id,
        created_at: &set.created_at,
        excluded_counts_by_reason: &set.excluded_counts_by_reason,
        partitions: &set.partitions,
    };
    let digest = hash_serializable(&identity)?;
    if digest != set.set_sha256 || set.snapshot_set_id != format!("family-set-{digest}") {
        return Err(FamilySnapshotError::InvalidInput);
    }
    Ok(())
}

pub fn stage_snapshot_set(
    connection: &Connection,
    target_household_id: &str,
    bytes: &[u8],
) -> Result<FamilySnapshotReviewDto> {
    let set = decode_and_validate(bytes)?;
    if set.household_id != target_household_id {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let local = get_local_status(connection, target_household_id)
        .map_err(|_| FamilySnapshotError::NotFound)?;
    if local.device.id == set.source_installation_id {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let local_member = local
        .binding
        .member_id
        .ok_or(FamilySnapshotError::AudienceBlocked)?;
    if set.partitions.iter().any(|partition| {
        partition.audience.visibility == "PERSONAL"
            && partition.audience.member_id.as_deref() != Some(local_member.as_str())
    }) {
        return Err(FamilySnapshotError::AudienceBlocked);
    }
    let active: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM household_members
         WHERE household_id=?1 AND id=?2 AND status='ACTIVE')",
        params![target_household_id, local_member],
        |row| row.get(0),
    )?;
    if !active {
        return Err(FamilySnapshotError::AudienceBlocked);
    }
    for partition in &set.partitions {
        for (account_id, audience) in &partition.dependency_audiences {
            if *audience != FamilyAudienceDto::shared() {
                return Err(FamilySnapshotError::AudienceBlocked);
            }
            let matching: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts
                 WHERE household_id=?1 AND id=?2 AND visibility='SHARED')",
                params![target_household_id, account_id],
                |row| row.get(0),
            )?;
            if !matching {
                return Err(FamilySnapshotError::AudienceBlocked);
            }
        }
    }
    if let Some(existing) = load_review(connection, &set.snapshot_set_id)? {
        let stored: String = connection.query_row(
            "SELECT set_sha256 FROM family_snapshot_sets WHERE snapshot_set_id=?1",
            [&set.snapshot_set_id],
            |row| row.get(0),
        )?;
        return if stored == set.set_sha256 {
            Ok(existing)
        } else {
            Err(FamilySnapshotError::Conflict)
        };
    }
    let pending: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM family_snapshot_sets
         WHERE target_household_id=?1 AND state IN ('REVIEW_REQUIRED','READY'))",
        [target_household_id],
        |row| row.get(0),
    )?;
    if pending {
        return Err(FamilySnapshotError::ReviewPending);
    }

    for partition in &set.partitions {
        let latest: Option<(i64, String)> = connection
            .query_row(
                "SELECT source_revision,snapshot_sha256 FROM family_applied_partitions
                 WHERE household_id=?1 AND source_installation_id=?2
                   AND visibility=?3 AND member_key=?4
                 ORDER BY source_revision DESC LIMIT 1",
                params![
                    target_household_id,
                    set.source_installation_id,
                    partition.audience.visibility,
                    partition.audience.member_key()
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((revision, digest)) = latest {
            let incoming = i64::try_from(set.source_revision)
                .map_err(|_| FamilySnapshotError::InvalidInput)?;
            if incoming < revision {
                return Err(FamilySnapshotError::Stale);
            }
            if incoming == revision {
                return if digest == partition.snapshot_sha256 {
                    Err(FamilySnapshotError::Stale)
                } else {
                    Err(FamilySnapshotError::Conflict)
                };
            }
        }
    }

    let mut actions = Vec::new();
    for (partition_order, partition) in set.partitions.iter().enumerate() {
        let mut incoming = BTreeSet::new();
        for record in &partition.records {
            incoming.insert((record.entity_kind.clone(), record.entity_id.clone()));
            let current = load_entity_payload(
                connection,
                target_household_id,
                &record.entity_kind,
                &record.entity_id,
            )?;
            let current_hash = current
                .as_ref()
                .map(|payload| sha256_hex(payload.as_bytes()));
            let head = load_head(
                connection,
                target_household_id,
                &partition.audience,
                &record.entity_kind,
                &record.entity_id,
            )?;
            let (state, resolution, reason) = match current_hash.as_deref() {
                None => ("CREATE", "APPLY_INCOMING", None),
                Some(hash) if hash == record.payload_sha256 => ("UNCHANGED", "SKIP", None),
                Some(hash)
                    if head.as_ref().is_some_and(|head| {
                        head.source_installation_id == set.source_installation_id
                            && head.payload_sha256 == hash
                    }) =>
                {
                    ("UPDATE", "APPLY_INCOMING", None)
                }
                Some(_) => ("CONFLICT", "PENDING", Some("LOCAL_DIVERGENCE")),
            };
            actions.push(StagedRecord {
                partition_order: partition_order as u32,
                entity_kind: record.entity_kind.clone(),
                entity_id: record.entity_id.clone(),
                operation: "UPSERT".to_owned(),
                canonical_payload_json: record.canonical_payload_json.clone(),
                payload_sha256: record.payload_sha256.clone(),
                review_state: state.to_owned(),
                resolution: resolution.to_owned(),
                current_payload_sha256: current_hash,
                conflict_reason: reason.map(str::to_owned),
            });
        }

        for kind in &partition.authoritative_kinds {
            if matches!(kind.as_str(), "HOUSEHOLD" | "HOUSEHOLD_MEMBER") {
                continue;
            }
            let heads = load_partition_heads(
                connection,
                target_household_id,
                &partition.audience,
                &set.source_installation_id,
                kind,
            )?;
            for head in heads {
                let key = (kind.clone(), head.entity_id.clone());
                if incoming.contains(&key) {
                    continue;
                }
                if set.schema_version >= 2 {
                    if let Some(target) = partition.relocations.iter().find(|entry| {
                        entry.entity_kind == *kind && entry.entity_id == head.entity_id
                    }) {
                        if target.target_audience.visibility == "SHARED"
                            || target.target_audience.member_id.as_deref()
                                == Some(local_member.as_str())
                        {
                            // The entity moved to another partition that this
                            // local member may receive. Do not let a later
                            // omission delete clobber the target-partition
                            // upsert, regardless of delivery order.
                            continue;
                        }
                    }
                }
                let Some(current) =
                    load_entity_payload(connection, target_household_id, kind, &head.entity_id)?
                else {
                    continue;
                };
                let current_hash = sha256_hex(current.as_bytes());
                // Fail closed: omission is only actionable while the exact
                // previously accepted partition head is still current.
                if current_hash != head.payload_sha256 {
                    continue;
                }
                actions.push(StagedRecord {
                    partition_order: partition_order as u32,
                    entity_kind: kind.clone(),
                    entity_id: head.entity_id,
                    operation: "DELETE".to_owned(),
                    canonical_payload_json: current,
                    payload_sha256: current_hash.clone(),
                    review_state: "DELETE".to_owned(),
                    resolution: "PENDING".to_owned(),
                    current_payload_sha256: Some(current_hash),
                    conflict_reason: None,
                });
            }
        }
    }
    actions.sort_by(|a, b| {
        a.partition_order
            .cmp(&b.partition_order)
            .then_with(|| dependency_rank(&a.entity_kind).cmp(&dependency_rank(&b.entity_kind)))
            .then_with(|| a.entity_id.cmp(&b.entity_id))
    });
    if actions.len() > MAX_RECORDS {
        return Err(FamilySnapshotError::LimitExceeded);
    }
    let conflict_count = actions
        .iter()
        .filter(|a| a.review_state == "CONFLICT")
        .count() as u64;
    let delete_count = actions
        .iter()
        .filter(|a| a.review_state == "DELETE")
        .count() as u64;
    let state = if conflict_count + delete_count == 0 {
        "READY"
    } else {
        "REVIEW_REQUIRED"
    };
    let manifest =
        canonical_json(&serde_json::to_value(&set).map_err(|_| FamilySnapshotError::Encoding)?)
            .map_err(|_| FamilySnapshotError::Encoding)?;
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "INSERT INTO family_snapshot_sets(
           snapshot_set_id,target_household_id,source_installation_id,source_principal_id,
           publisher_member_id,source_revision,set_sha256,manifest_json,state,record_count,
           conflict_count,delete_count,source_created_at,reviewed_at,schema_version)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,
           CASE WHEN ?9='READY' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,?14)",
        params![
            set.snapshot_set_id,
            target_household_id,
            set.source_installation_id,
            set.source_principal_id,
            set.publisher_member_id,
            set.source_revision,
            set.set_sha256,
            manifest,
            state,
            actions.len() as u64,
            conflict_count,
            delete_count,
            set.created_at,
            set.schema_version,
        ],
    )?;
    for (order, partition) in set.partitions.iter().enumerate() {
        transaction.execute(
            "INSERT INTO family_snapshot_partitions(
               snapshot_set_id,partition_order,visibility,member_id,member_key,package_id,
               snapshot_sha256,package_sha256,authoritative_kinds_json,record_count)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                set.snapshot_set_id,
                order as u32,
                partition.audience.visibility,
                partition.audience.member_id,
                partition.audience.member_key(),
                partition.package_id,
                partition.snapshot_sha256,
                partition.package_sha256,
                serde_json::to_string(&partition.authoritative_kinds)
                    .map_err(|_| FamilySnapshotError::Encoding)?,
                partition.records.len() as u64,
            ],
        )?;
    }
    for (order, action) in actions.iter().enumerate() {
        transaction.execute(
            "INSERT INTO family_snapshot_records(
               snapshot_set_id,partition_order,record_order,entity_kind,entity_id,operation,
               canonical_payload_json,payload_sha256,review_state,resolution,
               current_payload_sha256,conflict_reason)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                set.snapshot_set_id,
                action.partition_order,
                order as u64,
                action.entity_kind,
                action.entity_id,
                action.operation,
                action.canonical_payload_json,
                action.payload_sha256,
                action.review_state,
                action.resolution,
                action.current_payload_sha256,
                action.conflict_reason,
            ],
        )?;
    }
    transaction.commit()?;
    load_review(connection, &set.snapshot_set_id)?.ok_or(FamilySnapshotError::NotFound)
}

pub fn resolve_snapshot_set(
    connection: &Connection,
    snapshot_set_id: &str,
    resolutions: &[FamilySnapshotResolutionInput],
) -> Result<FamilySnapshotReviewDto> {
    if !valid_id(snapshot_set_id) || resolutions.is_empty() {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    let mut seen = BTreeSet::new();
    for resolution in resolutions {
        if !matches!(
            resolution.resolution.as_str(),
            "APPLY_INCOMING" | "KEEP_LOCAL"
        ) || !FAMILY_SUPPORTED_KINDS.contains(&resolution.entity_kind.as_str())
            || !valid_id(&resolution.entity_id)
            || !seen.insert((
                resolution.partition_order,
                resolution.entity_kind.clone(),
                resolution.entity_id.clone(),
            ))
        {
            return Err(FamilySnapshotError::InvalidInput);
        }
        let changed = transaction.execute(
            "UPDATE family_snapshot_records SET resolution=?1
             WHERE snapshot_set_id=?2 AND partition_order=?3 AND entity_kind=?4 AND entity_id=?5
               AND resolution='PENDING'",
            params![
                resolution.resolution,
                snapshot_set_id,
                resolution.partition_order,
                resolution.entity_kind,
                resolution.entity_id,
            ],
        )?;
        if changed != 1 {
            return Err(FamilySnapshotError::Conflict);
        }
    }
    let pending: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM family_snapshot_records
         WHERE snapshot_set_id=?1 AND resolution='PENDING')",
        [snapshot_set_id],
        |row| row.get(0),
    )?;
    if !pending {
        transaction.execute(
            "UPDATE family_snapshot_sets SET state='READY',
               reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE snapshot_set_id=?1 AND state='REVIEW_REQUIRED'",
            [snapshot_set_id],
        )?;
    }
    transaction.commit()?;
    load_review(connection, snapshot_set_id)?.ok_or(FamilySnapshotError::NotFound)
}

pub fn apply_snapshot_set(
    connection: &Connection,
    snapshot_set_id: &str,
) -> Result<FamilySnapshotReviewDto> {
    let review = load_review(connection, snapshot_set_id)?.ok_or(FamilySnapshotError::NotFound)?;
    if review.state == "APPLIED" {
        return Ok(review);
    }
    if review.state != "READY" || review.records.iter().any(|r| r.resolution == "PENDING") {
        return Err(FamilySnapshotError::ReviewPending);
    }
    let manifest: String = connection.query_row(
        "SELECT manifest_json FROM family_snapshot_sets WHERE snapshot_set_id=?1",
        [snapshot_set_id],
        |row| row.get(0),
    )?;
    let set: FamilySnapshotSetDto =
        serde_json::from_str(&manifest).map_err(|_| FamilySnapshotError::Encoding)?;
    validate_snapshot_set(&set)?;

    for record in &review.records {
        if record.resolution == "KEEP_LOCAL" {
            continue;
        }
        let current = load_entity_payload(
            connection,
            &review.target_household_id,
            &record.entity_kind,
            &record.entity_id,
        )?;
        let hash = current.as_ref().map(|value| sha256_hex(value.as_bytes()));
        if hash != record.current_payload_sha256 {
            return Err(FamilySnapshotError::Conflict);
        }
    }

    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "INSERT INTO sync_apply_guard(household_id,package_id) VALUES(?1,?2)",
        params![review.target_household_id, snapshot_set_id],
    )?;
    let stored_records = load_stored_records(&transaction, snapshot_set_id)?;
    for record in stored_records
        .iter()
        .filter(|record| record.resolution == "APPLY_INCOMING" && record.operation == "UPSERT")
    {
        materialize_upsert(
            &transaction,
            &record.entity_kind,
            &record.canonical_payload_json,
        )?;
    }
    for record in stored_records
        .iter()
        .rev()
        .filter(|record| record.resolution == "APPLY_INCOMING" && record.operation == "DELETE")
    {
        materialize_delete(
            &transaction,
            &review.target_household_id,
            &record.entity_kind,
            &record.entity_id,
        )?;
    }

    for partition in &set.partitions {
        transaction.execute(
            "INSERT INTO family_applied_partitions(
               package_id,snapshot_set_id,household_id,source_installation_id,
               visibility,member_id,member_key,source_revision,snapshot_sha256)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                partition.package_id,
                snapshot_set_id,
                review.target_household_id,
                set.source_installation_id,
                partition.audience.visibility,
                partition.audience.member_id,
                partition.audience.member_key(),
                set.source_revision,
                partition.snapshot_sha256,
            ],
        )?;
    }
    for record in stored_records
        .iter()
        .filter(|record| matches!(record.resolution.as_str(), "APPLY_INCOMING" | "SKIP"))
    {
        let partition = set
            .partitions
            .get(record.partition_order as usize)
            .ok_or(FamilySnapshotError::Encoding)?;
        transaction.execute(
            "INSERT INTO family_replica_entity_heads(
               household_id,visibility,member_id,member_key,entity_kind,entity_id,
               source_installation_id,package_id,source_revision,operation,payload_sha256)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(household_id,visibility,member_key,entity_kind,entity_id) DO UPDATE SET
               member_id=excluded.member_id,source_installation_id=excluded.source_installation_id,
               package_id=excluded.package_id,source_revision=excluded.source_revision,
               operation=excluded.operation,payload_sha256=excluded.payload_sha256,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![
                review.target_household_id,
                partition.audience.visibility,
                partition.audience.member_id,
                partition.audience.member_key(),
                record.entity_kind,
                record.entity_id,
                set.source_installation_id,
                partition.package_id,
                set.source_revision,
                record.operation,
                record.payload_sha256,
            ],
        )?;
    }
    if set.schema_version >= 2 {
        for partition in &set.partitions {
            for entry in &partition.relocations {
                transaction.execute(
                    "DELETE FROM family_replica_entity_heads
                     WHERE household_id=?1 AND visibility=?2 AND member_key=?3
                       AND entity_kind=?4 AND entity_id=?5",
                    params![
                        review.target_household_id,
                        partition.audience.visibility,
                        partition.audience.member_key(),
                        entry.entity_kind,
                        entry.entity_id
                    ],
                )?;
            }
        }
    }
    transaction.execute(
        "DELETE FROM sync_apply_guard WHERE household_id=?1 AND package_id=?2",
        params![review.target_household_id, snapshot_set_id],
    )?;
    transaction.execute(
        "UPDATE family_snapshot_sets SET state='APPLIED',
           applied_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE snapshot_set_id=?1",
        [snapshot_set_id],
    )?;
    transaction.commit()?;
    load_review(connection, snapshot_set_id)?.ok_or(FamilySnapshotError::NotFound)
}

pub fn get_active_review(
    connection: &Connection,
    household_id: &str,
) -> Result<Option<FamilySnapshotReviewDto>> {
    if !valid_id(household_id) {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let snapshot_set_id = connection
        .query_row(
            "SELECT snapshot_set_id FROM family_snapshot_sets
             WHERE target_household_id=?1 AND state IN ('REVIEW_REQUIRED','READY')
             ORDER BY staged_at,snapshot_set_id LIMIT 1",
            [household_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    snapshot_set_id
        .map(|id| load_review(connection, &id)?.ok_or(FamilySnapshotError::NotFound))
        .transpose()
}

pub fn discard_snapshot_set(connection: &Connection, snapshot_set_id: &str) -> Result<()> {
    if !valid_id(snapshot_set_id) {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let changed = connection.execute(
        "DELETE FROM family_snapshot_sets
         WHERE snapshot_set_id=?1 AND state IN ('REVIEW_REQUIRED','READY','REJECTED')",
        [snapshot_set_id],
    )?;
    if changed != 1 {
        return Err(FamilySnapshotError::Conflict);
    }
    Ok(())
}

fn build_partition(
    source: &PartitionSource<'_>,
    audience: FamilyAudienceDto,
    authoritative_kinds: Vec<String>,
    records: Vec<FamilySnapshotRecordDto>,
    account_audiences: &BTreeMap<String, FamilyAudienceDto>,
    relocations: Vec<FamilyEntityRelocationDto>,
) -> Result<FamilySnapshotPartitionDto> {
    let mut counts = FAMILY_SUPPORTED_KINDS
        .iter()
        .map(|kind| ((*kind).to_owned(), 0_u64))
        .collect::<BTreeMap<_, _>>();
    for record in &records {
        *counts
            .get_mut(&record.entity_kind)
            .ok_or(FamilySnapshotError::Encoding)? += 1;
    }
    let included_accounts = records
        .iter()
        .filter(|record| record.entity_kind == "ACCOUNT")
        .map(|record| record.entity_id.as_str())
        .collect::<BTreeSet<_>>();
    let mut dependency_audiences = BTreeMap::new();
    for record in &records {
        let raw = RawRecord {
            entity_kind: record.entity_kind.clone(),
            entity_id: record.entity_id.clone(),
            canonical_payload_json: record.canonical_payload_json.clone(),
            payload_sha256: record.payload_sha256.clone(),
        };
        for account_id in record_account_dependencies(&raw)? {
            if included_accounts.contains(account_id.as_str()) {
                continue;
            }
            let dependency = account_audiences
                .get(&account_id)
                .ok_or(FamilySnapshotError::AudienceBlocked)?;
            if *dependency != FamilyAudienceDto::shared() {
                return Err(FamilySnapshotError::AudienceBlocked);
            }
            dependency_audiences.insert(account_id, dependency.clone());
        }
    }
    let identity = PartitionIdentity {
        format: FAMILY_FORMAT,
        schema_version: FAMILY_SCHEMA_VERSION,
        mode: FAMILY_MODE,
        source_installation_id: source.source_installation_id,
        source_principal_id: source.source_principal_id,
        publisher_member_id: source.publisher_member_id,
        source_revision: source.source_revision,
        household_id: source.household_id,
        created_at: source.created_at,
        audience: &audience,
        dependency_audiences: &dependency_audiences,
        authoritative_kinds: &authoritative_kinds,
        counts_by_kind: &counts,
        records: &records,
        relocations: &relocations,
    };
    let snapshot_sha256 = hash_serializable(&identity)?;
    let package_id = format!("family-partition-{snapshot_sha256}");
    let package_sha256 = hash_serializable(&json!({
        "packageId": package_id,
        "snapshotSha256": snapshot_sha256,
        "identity": identity,
    }))?;
    Ok(FamilySnapshotPartitionDto {
        package_id,
        audience,
        dependency_audiences,
        authoritative_kinds,
        counts_by_kind: counts,
        snapshot_sha256,
        package_sha256,
        records,
        relocations,
    })
}

fn validate_partition(
    set: &FamilySnapshotSetDto,
    partition: &FamilySnapshotPartitionDto,
) -> Result<()> {
    if !partition.audience.valid()
        || partition.records.len() > MAX_RECORDS
        || partition
            .dependency_audiences
            .iter()
            .any(|(account_id, audience)| {
                !valid_id(account_id) || *audience != FamilyAudienceDto::shared()
            })
        || partition
            .authoritative_kinds
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != partition.authoritative_kinds.len()
        || partition
            .authoritative_kinds
            .iter()
            .any(|kind| !supported_kinds(set.schema_version).contains(&kind.as_str()))
        || (set.schema_version == 1 && !partition.relocations.is_empty())
    {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let mut relocation_keys = BTreeSet::new();
    for relocation in &partition.relocations {
        if !supported_kinds(set.schema_version).contains(&relocation.entity_kind.as_str())
            || !valid_id(&relocation.entity_id)
            || !relocation.target_audience.valid()
            || relocation.target_audience == partition.audience
            || !relocation_keys.insert((
                relocation.entity_kind.as_str(),
                relocation.entity_id.as_str(),
            ))
        {
            return Err(FamilySnapshotError::InvalidInput);
        }
    }
    let expected_keys = supported_kinds(set.schema_version)
        .iter()
        .map(|kind| (*kind).to_owned())
        .collect::<BTreeSet<_>>();
    if partition
        .counts_by_kind
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>()
        != expected_keys
    {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let mut counts = expected_keys
        .iter()
        .map(|kind| (kind.clone(), 0_u64))
        .collect::<BTreeMap<_, _>>();
    let mut identities = BTreeSet::new();
    for record in &partition.records {
        if record.operation != "UPSERT"
            || !valid_id(&record.entity_id)
            || !supported_kinds(set.schema_version).contains(&record.entity_kind.as_str())
            || !identities.insert((record.entity_kind.clone(), record.entity_id.clone()))
        {
            return Err(FamilySnapshotError::InvalidInput);
        }
        let value: Value = serde_json::from_str(&record.canonical_payload_json)
            .map_err(|_| FamilySnapshotError::InvalidInput)?;
        let canonical = canonical_json(&value).map_err(|_| FamilySnapshotError::InvalidInput)?;
        if canonical != record.canonical_payload_json
            || sha256_hex(canonical.as_bytes()) != record.payload_sha256
            || !payload_identity_matches(record, &value, &set.household_id)
        {
            return Err(FamilySnapshotError::InvalidInput);
        }
        *counts
            .get_mut(&record.entity_kind)
            .ok_or(FamilySnapshotError::InvalidInput)? += 1;
    }
    if counts != partition.counts_by_kind {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let identity = PartitionIdentity {
        format: FAMILY_FORMAT,
        schema_version: set.schema_version,
        mode: FAMILY_MODE,
        source_installation_id: &set.source_installation_id,
        source_principal_id: &set.source_principal_id,
        publisher_member_id: &set.publisher_member_id,
        source_revision: set.source_revision,
        household_id: &set.household_id,
        created_at: &set.created_at,
        audience: &partition.audience,
        dependency_audiences: &partition.dependency_audiences,
        authoritative_kinds: &partition.authoritative_kinds,
        counts_by_kind: &partition.counts_by_kind,
        records: &partition.records,
        relocations: &partition.relocations,
    };
    let snapshot = hash_serializable(&identity)?;
    if snapshot != partition.snapshot_sha256
        || partition.package_id != format!("family-partition-{snapshot}")
    {
        return Err(FamilySnapshotError::InvalidInput);
    }
    let package = hash_serializable(&json!({
        "packageId": partition.package_id,
        "snapshotSha256": partition.snapshot_sha256,
        "identity": identity,
    }))?;
    if package != partition.package_sha256 {
        return Err(FamilySnapshotError::InvalidInput);
    }
    Ok(())
}

fn load_core_records(connection: &Connection, household_id: &str) -> Result<Vec<RawRecord>> {
    let mut records = Vec::new();
    push_query_records(
        connection,
        &mut records,
        "HOUSEHOLD",
        "SELECT id,json(json_object(
          'recordKind','HOUSEHOLD','id',id,'name',name,'baseCurrency',base_currency,
          'createdAt',created_at,'updatedAt',updated_at))
         FROM households WHERE id=?1",
        household_id,
    )?;
    push_query_records(
        connection,
        &mut records,
        "HOUSEHOLD_MEMBER",
        "SELECT id,json(json_object(
          'recordKind','HOUSEHOLD_MEMBER','displayName',display_name,'householdId',household_id,
          'id',id,'relationshipLabel',relationship_label,'sortOrder',sort_order,'status',status,
          'createdAt',created_at,'updatedAt',updated_at))
         FROM household_members WHERE household_id=?1 ORDER BY sort_order,id",
        household_id,
    )?;
    push_query_records(
        connection,
        &mut records,
        "ACCOUNT",
        "SELECT id,json(json_object(
          'recordKind','ACCOUNT','accountKind',account_kind,'accountSubtype',account_subtype,
          'householdId',household_id,'id',id,'name',name,'currency',currency,
          'institutionName',institution_name,'maskedIdentifier',masked_identifier,
          'isArchived',is_archived,'ownerMemberId',owner_member_id,'ownershipKind',ownership_kind,
          'visibility',visibility,'createdAt',created_at,'updatedAt',updated_at))
         FROM accounts WHERE household_id=?1 ORDER BY id",
        household_id,
    )?;
    push_query_records(
        connection,
        &mut records,
        "TRANSACTION",
        "SELECT transaction_id,payload_json FROM sync_transaction_aggregate_payloads
         WHERE household_id=?1 ORDER BY transaction_id",
        household_id,
    )?;
    Ok(records)
}

fn push_query_records(
    connection: &Connection,
    output: &mut Vec<RawRecord>,
    kind: &str,
    sql: &str,
    household_id: &str,
) -> Result<()> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map([household_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (entity_id, payload) = row?;
        let mut value: Value =
            serde_json::from_str(&payload).map_err(|_| FamilySnapshotError::Encoding)?;
        if kind == "TRANSACTION" {
            let object = value.as_object_mut().ok_or(FamilySnapshotError::Encoding)?;
            object.insert("sourceLinks".to_owned(), Value::Array(Vec::new()));
        }
        let canonical = canonical_json(&value).map_err(|_| FamilySnapshotError::Encoding)?;
        output.push(RawRecord {
            entity_kind: kind.to_owned(),
            entity_id,
            payload_sha256: sha256_hex(canonical.as_bytes()),
            canonical_payload_json: canonical,
        });
    }
    Ok(())
}

fn account_audiences(records: &[RawRecord]) -> Result<BTreeMap<String, FamilyAudienceDto>> {
    records
        .iter()
        .filter(|record| record.entity_kind == "ACCOUNT")
        .map(|record| {
            let value: Value = serde_json::from_str(&record.canonical_payload_json)
                .map_err(|_| FamilySnapshotError::Encoding)?;
            let visibility = value.get("visibility").and_then(Value::as_str);
            let owner = value.get("ownerMemberId").and_then(Value::as_str);
            let audience = match (visibility, owner) {
                (Some("SHARED"), _) => FamilyAudienceDto::shared(),
                (Some("PERSONAL"), Some(member)) if valid_id(member) => {
                    FamilyAudienceDto::personal(member)
                }
                _ => return Err(FamilySnapshotError::AudienceBlocked),
            };
            Ok((record.entity_id.clone(), audience))
        })
        .collect()
}

fn effective_audience(
    record: &RawRecord,
    accounts: &BTreeMap<String, FamilyAudienceDto>,
    publisher_member_id: &str,
) -> Result<EffectiveAudience> {
    if matches!(
        record.entity_kind.as_str(),
        "HOUSEHOLD" | "HOUSEHOLD_MEMBER"
    ) {
        return Ok(EffectiveAudience::Deliver(FamilyAudienceDto::shared()));
    }
    if record.entity_kind == "ACCOUNT" {
        return classify_for_publisher(
            accounts
                .get(&record.entity_id)
                .cloned()
                .ok_or(FamilySnapshotError::AudienceBlocked)?,
            publisher_member_id,
        );
    }
    let value: Value = serde_json::from_str(&record.canonical_payload_json)
        .map_err(|_| FamilySnapshotError::Encoding)?;
    if record.entity_kind == "ACCOUNT_GROUP"
        && value.get("groupKind").and_then(Value::as_str) == Some("PERSONAL")
    {
        // ACCOUNT_GROUP has no owner member. Inferring one from zero, shared,
        // or even currently-personal members would turn mutable dependencies
        // into an access-control decision, so PERSONAL groups fail closed.
        return Ok(EffectiveAudience::Unassigned);
    }
    let mut audience = if record.entity_kind == "TRANSACTION" {
        match (
            value.get("audienceVisibility").and_then(Value::as_str),
            value.get("audienceMemberId").and_then(Value::as_str),
        ) {
            (Some("SHARED"), None) => FamilyAudienceDto::shared(),
            (Some("PERSONAL"), Some(member)) if valid_id(member) => {
                FamilyAudienceDto::personal(member)
            }
            _ => return Ok(EffectiveAudience::Unassigned),
        }
    } else {
        FamilyAudienceDto::shared()
    };
    for account_id in record_account_dependencies(record)? {
        let Some(dependency) = accounts.get(&account_id) else {
            return Ok(EffectiveAudience::Unassigned);
        };
        match meet_audience(&audience, dependency) {
            Some(next) => audience = next,
            None => return Ok(EffectiveAudience::Mixed),
        }
    }
    classify_for_publisher(audience, publisher_member_id)
}

fn record_account_dependencies(record: &RawRecord) -> Result<Vec<String>> {
    let value: Value = serde_json::from_str(&record.canonical_payload_json)
        .map_err(|_| FamilySnapshotError::Encoding)?;
    let mut dependencies = Vec::new();
    let mut push = |value: Option<&Value>| -> Result<()> {
        if let Some(value) = value {
            let id = value.as_str().ok_or(FamilySnapshotError::Encoding)?;
            if !valid_id(id) {
                return Err(FamilySnapshotError::Encoding);
            }
            dependencies.push(id.to_owned());
        }
        Ok(())
    };
    match record.entity_kind.as_str() {
        "TRANSACTION" => {
            for entry in value
                .get("journalEntries")
                .and_then(Value::as_array)
                .ok_or(FamilySnapshotError::Encoding)?
            {
                push(entry.get("accountId"))?;
            }
        }
        "MONTHLY_BUDGET_PLAN" => {
            for budget in value
                .get("budgets")
                .and_then(Value::as_array)
                .ok_or(FamilySnapshotError::Encoding)?
            {
                push(budget.get("categoryAccountId"))?;
            }
        }
        "CLASSIFICATION_RULE" => push(value.get("categoryAccountId"))?,
        "ACCOUNT_GROUP" => {
            for member in value
                .get("members")
                .and_then(Value::as_array)
                .ok_or(FamilySnapshotError::Encoding)?
            {
                push(member.get("accountId"))?;
            }
        }
        "CARD_SETTLEMENT_MAPPING" => {
            push(value.get("cardAccountId"))?;
            push(value.get("bankAccountId"))?;
        }
        _ => {}
    }
    dependencies.sort_unstable();
    dependencies.dedup();
    Ok(dependencies)
}

fn classify_for_publisher(
    audience: FamilyAudienceDto,
    publisher_member_id: &str,
) -> Result<EffectiveAudience> {
    if audience.visibility == "SHARED" || audience.member_id.as_deref() == Some(publisher_member_id)
    {
        Ok(EffectiveAudience::Deliver(audience))
    } else if audience.visibility == "PERSONAL" {
        Ok(EffectiveAudience::OtherMember)
    } else {
        Ok(EffectiveAudience::Unassigned)
    }
}

fn meet_audience(left: &FamilyAudienceDto, right: &FamilyAudienceDto) -> Option<FamilyAudienceDto> {
    match (left.member_id.as_deref(), right.member_id.as_deref()) {
        (None, None) => Some(FamilyAudienceDto::shared()),
        (Some(member), None) | (None, Some(member)) => Some(FamilyAudienceDto::personal(member)),
        (Some(left), Some(right)) if left == right => Some(FamilyAudienceDto::personal(left)),
        _ => None,
    }
}

fn validate_partition_scopes(
    set: &FamilySnapshotSetDto,
    records: &[(FamilyAudienceDto, FamilySnapshotRecordDto)],
    publisher_member_id: &str,
) -> Result<()> {
    let raw = records
        .iter()
        .map(|(_, record)| RawRecord {
            entity_kind: record.entity_kind.clone(),
            entity_id: record.entity_id.clone(),
            canonical_payload_json: record.canonical_payload_json.clone(),
            payload_sha256: record.payload_sha256.clone(),
        })
        .collect::<Vec<_>>();
    let actual_accounts = account_audiences(&raw)?;
    for partition in &set.partitions {
        let mut accounts = actual_accounts.clone();
        for (account_id, audience) in &partition.dependency_audiences {
            if accounts
                .insert(account_id.clone(), audience.clone())
                .is_some_and(|actual| actual != *audience)
            {
                return Err(FamilySnapshotError::AudienceBlocked);
            }
        }
        for record in &partition.records {
            let raw = RawRecord {
                entity_kind: record.entity_kind.clone(),
                entity_id: record.entity_id.clone(),
                canonical_payload_json: record.canonical_payload_json.clone(),
                payload_sha256: record.payload_sha256.clone(),
            };
            match effective_audience(&raw, &accounts, publisher_member_id)? {
                EffectiveAudience::Deliver(actual) if actual == partition.audience => {}
                _ => return Err(FamilySnapshotError::AudienceBlocked),
            }
        }
    }
    Ok(())
}

fn count_card_evidence_required_records(
    connection: &Connection,
    household_id: &str,
) -> Result<u64> {
    let count: i64 = connection.query_row(
        "SELECT (SELECT count(*) FROM card_statements WHERE household_id=?1)+
                (SELECT count(*) FROM card_payments WHERE household_id=?1)",
        [household_id],
        |row| row.get(0),
    )?;
    Ok(count.max(0) as u64)
}

fn count_investment_evidence_required_records(
    connection: &Connection,
    household_id: &str,
) -> Result<u64> {
    let count: i64 = connection.query_row(
        "SELECT
           (SELECT count(*) FROM portfolio_snapshots WHERE household_id=?1)+
           (SELECT count(*) FROM brokerage_events WHERE household_id=?1)+
           (SELECT count(*) FROM investment_fx_rates WHERE household_id=?1)+
           (SELECT count(*) FROM investment_market_prices WHERE household_id=?1)+
           (SELECT count(*) FROM aggregate_asset_snapshots WHERE household_id=?1)",
        [household_id],
        |row| row.get(0),
    )?;
    Ok(count.max(0) as u64)
}

fn outbound_lineage_unknown(
    connection: &Connection,
    household_id: &str,
    audience_key: &str,
) -> Result<bool> {
    connection
        .query_row(
            "SELECT state='LEGACY_UNKNOWN' FROM family_delivery_outbound_lineage_state
             WHERE household_id=?1 AND audience_key=?2",
            params![household_id, audience_key],
            |row| row.get(0),
        )
        .optional()
        .map(|state| state.unwrap_or(false))
        .map_err(FamilySnapshotError::from)
}

fn kind_supports_absence_delete(kind: &&str) -> bool {
    matches!(
        *kind,
        "ACCOUNT"
            | "TRANSACTION"
            | "SAVINGS_GOAL"
            | "CLASSIFICATION_RULE"
            | "ACCOUNT_GROUP"
            | "CARD_SETTLEMENT_MAPPING"
            | "DASHBOARD_PREFERENCES"
            | "DELIMITED_PARSER_PROFILE"
    )
}

fn load_relocations(
    connection: &Connection,
    household_id: &str,
    publisher_member_id: &str,
    current: &BTreeMap<(String, String), (FamilyAudienceDto, String)>,
) -> Result<(
    Vec<FamilyEntityRelocationDto>,
    Vec<FamilyEntityRelocationDto>,
)> {
    let mut statement = connection.prepare(
        "SELECT visibility,member_id,entity_kind,entity_id
         FROM family_delivery_outbound_entity_heads
         WHERE household_id=?1 ORDER BY visibility,member_key,entity_kind,entity_id",
    )?;
    let rows = statement.query_map([household_id], |row| {
        Ok((
            FamilyAudienceDto {
                visibility: row.get(0)?,
                member_id: row.get(1)?,
            },
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let mut shared = Vec::new();
    let mut personal = Vec::new();
    for row in rows {
        let (previous, kind, id) = row?;
        let Some((target, _hash)) = current.get(&(kind.clone(), id.clone())) else {
            continue;
        };
        if previous == *target {
            continue;
        }
        let relocation = FamilyEntityRelocationDto {
            entity_kind: kind,
            entity_id: id,
            target_audience: target.clone(),
        };
        if previous.visibility == "SHARED" {
            shared.push(relocation);
        } else if previous.member_id.as_deref() == Some(publisher_member_id) {
            personal.push(relocation);
        }
    }
    Ok((shared, personal))
}

fn default_excluded_counts() -> BTreeMap<String, u64> {
    [
        "EVIDENCE_REQUIRED_CARD",
        "EVIDENCE_REQUIRED_INVESTMENT",
        "MIXED_PERSONAL_MEMBERS",
        "OTHER_MEMBER_PERSONAL",
        "UNASSIGNED_SCOPE",
    ]
    .into_iter()
    .map(|reason| (reason.to_owned(), 0))
    .collect()
}

fn increment(counts: &mut BTreeMap<String, u64>, reason: &str) {
    *counts.entry(reason.to_owned()).or_default() += 1;
}

fn to_record(record: RawRecord) -> FamilySnapshotRecordDto {
    FamilySnapshotRecordDto {
        entity_kind: record.entity_kind,
        entity_id: record.entity_id,
        operation: "UPSERT".to_owned(),
        canonical_payload_json: record.canonical_payload_json,
        payload_sha256: record.payload_sha256,
    }
}

fn sort_records(records: &mut [FamilySnapshotRecordDto]) {
    records.sort_by(|a, b| {
        dependency_rank(&a.entity_kind)
            .cmp(&dependency_rank(&b.entity_kind))
            .then_with(|| a.entity_id.cmp(&b.entity_id))
    });
}

fn payload_identity_matches(
    record: &FamilySnapshotRecordDto,
    payload: &Value,
    household_id: &str,
) -> bool {
    let string = |key: &str| payload.get(key).and_then(Value::as_str);
    let expected = if record.entity_kind == "TRANSACTION" {
        "TRANSACTION_AGGREGATE"
    } else {
        record.entity_kind.as_str()
    };
    if string("recordKind") != Some(expected) {
        return false;
    }
    match record.entity_kind.as_str() {
        "HOUSEHOLD" => {
            string("id") == Some(record.entity_id.as_str()) && record.entity_id == household_id
        }
        "MONTHLY_BUDGET_PLAN" | "DASHBOARD_PREFERENCES" => {
            string("householdId") == Some(household_id) && record.entity_id == household_id
        }
        "CARD_SETTLEMENT_MAPPING" => {
            string("householdId") == Some(household_id)
                && string("cardAccountId") == Some(record.entity_id.as_str())
        }
        _ => {
            string("householdId") == Some(household_id)
                && string("id") == Some(record.entity_id.as_str())
        }
    }
}

#[derive(Debug)]
struct StagedRecord {
    partition_order: u32,
    entity_kind: String,
    entity_id: String,
    operation: String,
    canonical_payload_json: String,
    payload_sha256: String,
    review_state: String,
    resolution: String,
    current_payload_sha256: Option<String>,
    conflict_reason: Option<String>,
}

#[derive(Debug)]
struct ReplicaHead {
    entity_id: String,
    source_installation_id: String,
    payload_sha256: String,
}

fn load_head(
    connection: &Connection,
    household_id: &str,
    audience: &FamilyAudienceDto,
    kind: &str,
    entity_id: &str,
) -> Result<Option<ReplicaHead>> {
    connection
        .query_row(
            "SELECT entity_id,source_installation_id,payload_sha256
             FROM family_replica_entity_heads
             WHERE household_id=?1 AND visibility=?2 AND member_key=?3
               AND entity_kind=?4 AND entity_id=?5",
            params![
                household_id,
                audience.visibility,
                audience.member_key(),
                kind,
                entity_id
            ],
            |row| {
                Ok(ReplicaHead {
                    entity_id: row.get(0)?,
                    source_installation_id: row.get(1)?,
                    payload_sha256: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(FamilySnapshotError::from)
}

fn load_partition_heads(
    connection: &Connection,
    household_id: &str,
    audience: &FamilyAudienceDto,
    source_installation_id: &str,
    kind: &str,
) -> Result<Vec<ReplicaHead>> {
    let mut statement = connection.prepare(
        "SELECT entity_id,source_installation_id,payload_sha256
         FROM family_replica_entity_heads
         WHERE household_id=?1 AND visibility=?2 AND member_key=?3
           AND source_installation_id=?4 AND entity_kind=?5
         ORDER BY entity_id",
    )?;
    let rows = statement.query_map(
        params![
            household_id,
            audience.visibility,
            audience.member_key(),
            source_installation_id,
            kind
        ],
        |row| {
            Ok(ReplicaHead {
                entity_id: row.get(0)?,
                source_installation_id: row.get(1)?,
                payload_sha256: row.get(2)?,
            })
        },
    )?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

fn load_entity_payload(
    connection: &Connection,
    household_id: &str,
    kind: &str,
    entity_id: &str,
) -> Result<Option<String>> {
    if !FAMILY_V1_SUPPORTED_KINDS.contains(&kind) {
        return change_package::load_entity_payload(connection, household_id, kind, entity_id, 4)
            .map_err(|_| FamilySnapshotError::Encoding);
    }
    let sql = match kind {
        "HOUSEHOLD" => {
            "SELECT json(json_object(
          'recordKind','HOUSEHOLD','id',id,'name',name,'baseCurrency',base_currency,
          'createdAt',created_at,'updatedAt',updated_at)) FROM households WHERE id=?1 AND id=?2"
        }
        "HOUSEHOLD_MEMBER" => {
            "SELECT json(json_object(
          'recordKind','HOUSEHOLD_MEMBER','displayName',display_name,'householdId',household_id,
          'id',id,'relationshipLabel',relationship_label,'sortOrder',sort_order,'status',status,
          'createdAt',created_at,'updatedAt',updated_at))
          FROM household_members WHERE household_id=?1 AND id=?2"
        }
        "ACCOUNT" => {
            "SELECT json(json_object(
          'recordKind','ACCOUNT','accountKind',account_kind,'accountSubtype',account_subtype,
          'householdId',household_id,'id',id,'name',name,'currency',currency,
          'institutionName',institution_name,'maskedIdentifier',masked_identifier,
          'isArchived',is_archived,'ownerMemberId',owner_member_id,'ownershipKind',ownership_kind,
          'visibility',visibility,'createdAt',created_at,'updatedAt',updated_at))
          FROM accounts WHERE household_id=?1 AND id=?2"
        }
        "TRANSACTION" => {
            "SELECT payload_json FROM sync_transaction_aggregate_payloads
          WHERE household_id=?1 AND transaction_id=?2"
        }
        _ => return Err(FamilySnapshotError::InvalidInput),
    };
    let parameters = if kind == "HOUSEHOLD" {
        params![entity_id, household_id]
    } else {
        params![household_id, entity_id]
    };
    let raw: Option<String> = connection
        .query_row(sql, parameters, |row| row.get(0))
        .optional()?;
    raw.map(|raw| {
        let mut value: Value =
            serde_json::from_str(&raw).map_err(|_| FamilySnapshotError::Encoding)?;
        if kind == "TRANSACTION" {
            let object = value.as_object_mut().ok_or(FamilySnapshotError::Encoding)?;
            object.insert("sourceLinks".to_owned(), Value::Array(Vec::new()));
        }
        canonical_json(&value).map_err(|_| FamilySnapshotError::Encoding)
    })
    .transpose()
}

fn load_review(
    connection: &Connection,
    snapshot_set_id: &str,
) -> Result<Option<FamilySnapshotReviewDto>> {
    let header = connection
        .query_row(
            "SELECT target_household_id,source_installation_id,source_revision,
                    publisher_member_id,state,record_count,conflict_count,delete_count
             FROM family_snapshot_sets WHERE snapshot_set_id=?1",
            [snapshot_set_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        )
        .optional()?;
    let Some(header) = header else {
        return Ok(None);
    };
    let mut statement = connection.prepare(
        "SELECT r.partition_order,p.visibility,p.member_id,r.record_order,r.entity_kind,
                r.entity_id,r.operation,r.payload_sha256,r.review_state,r.resolution,
                r.current_payload_sha256,r.conflict_reason
         FROM family_snapshot_records r JOIN family_snapshot_partitions p
           ON p.snapshot_set_id=r.snapshot_set_id AND p.partition_order=r.partition_order
         WHERE r.snapshot_set_id=?1 ORDER BY r.record_order",
    )?;
    let records = statement
        .query_map([snapshot_set_id], |row| {
            Ok(FamilySnapshotRecordReviewDto {
                partition_order: row.get(0)?,
                audience: FamilyAudienceDto {
                    visibility: row.get(1)?,
                    member_id: row.get(2)?,
                },
                record_order: row.get(3)?,
                entity_kind: row.get(4)?,
                entity_id: row.get(5)?,
                operation: row.get(6)?,
                payload_sha256: row.get(7)?,
                review_state: row.get(8)?,
                resolution: row.get(9)?,
                current_payload_sha256: row.get(10)?,
                conflict_reason: row.get(11)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(Some(FamilySnapshotReviewDto {
        snapshot_set_id: snapshot_set_id.to_owned(),
        target_household_id: header.0,
        source_installation_id: header.1,
        source_revision: u64::try_from(header.2).map_err(|_| FamilySnapshotError::Encoding)?,
        publisher_member_id: header.3,
        state: header.4,
        record_count: header.5.max(0) as u64,
        conflict_count: header.6.max(0) as u64,
        delete_count: header.7.max(0) as u64,
        records,
    }))
}

fn load_stored_records(
    connection: &Connection,
    snapshot_set_id: &str,
) -> Result<Vec<StagedRecord>> {
    let mut statement = connection.prepare(
        "SELECT r.partition_order,r.entity_kind,r.entity_id,
                r.operation,r.canonical_payload_json,r.payload_sha256,r.review_state,
                r.resolution,r.current_payload_sha256,r.conflict_reason
         FROM family_snapshot_records r
         WHERE r.snapshot_set_id=?1 ORDER BY r.record_order",
    )?;
    let rows = statement.query_map([snapshot_set_id], |row| {
        Ok(StagedRecord {
            partition_order: row.get(0)?,
            entity_kind: row.get(1)?,
            entity_id: row.get(2)?,
            operation: row.get(3)?,
            canonical_payload_json: row.get(4)?,
            payload_sha256: row.get(5)?,
            review_state: row.get(6)?,
            resolution: row.get(7)?,
            current_payload_sha256: row.get(8)?,
            conflict_reason: row.get(9)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

fn materialize_upsert(connection: &Connection, kind: &str, payload: &str) -> Result<()> {
    if !FAMILY_V1_SUPPORTED_KINDS.contains(&kind) {
        return change_package::materialize_upsert(connection, kind, payload, 4)
            .map_err(|_| FamilySnapshotError::Conflict);
    }
    match kind {
        "HOUSEHOLD" => {
            connection.execute(
                "INSERT INTO households(id,name,base_currency,created_at,updated_at)
                 VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.name'),
                   json_extract(?1,'$.baseCurrency'),json_extract(?1,'$.createdAt'),
                   json_extract(?1,'$.updatedAt'))
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name,
                   base_currency=excluded.base_currency,created_at=excluded.created_at,
                   updated_at=excluded.updated_at",
                [payload],
            )?;
        }
        "HOUSEHOLD_MEMBER" => {
            connection.execute(
                "INSERT INTO household_members(
                   id,household_id,display_name,relationship_label,status,sort_order,created_at,updated_at)
                 VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
                   json_extract(?1,'$.displayName'),json_extract(?1,'$.relationshipLabel'),
                   json_extract(?1,'$.status'),json_extract(?1,'$.sortOrder'),
                   json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
                 ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,
                   relationship_label=excluded.relationship_label,status=excluded.status,
                   sort_order=excluded.sort_order,created_at=excluded.created_at,
                   updated_at=excluded.updated_at",
                [payload],
            )?;
        }
        "ACCOUNT" => {
            connection.execute(
                "INSERT INTO accounts(
                   id,household_id,name,account_kind,account_subtype,currency,institution_name,
                   masked_identifier,is_archived,owner_member_id,ownership_kind,visibility,
                   created_at,updated_at)
                 VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
                   json_extract(?1,'$.name'),json_extract(?1,'$.accountKind'),
                   json_extract(?1,'$.accountSubtype'),json_extract(?1,'$.currency'),
                   json_extract(?1,'$.institutionName'),json_extract(?1,'$.maskedIdentifier'),
                   json_extract(?1,'$.isArchived'),json_extract(?1,'$.ownerMemberId'),
                   json_extract(?1,'$.ownershipKind'),json_extract(?1,'$.visibility'),
                   json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name,account_kind=excluded.account_kind,
                   account_subtype=excluded.account_subtype,currency=excluded.currency,
                   institution_name=excluded.institution_name,masked_identifier=excluded.masked_identifier,
                   is_archived=excluded.is_archived,owner_member_id=excluded.owner_member_id,
                   ownership_kind=excluded.ownership_kind,visibility=excluded.visibility,
                   created_at=excluded.created_at,updated_at=excluded.updated_at",
                [payload],
            )?;
        }
        "TRANSACTION" => materialize_transaction(connection, payload)?,
        _ => return Err(FamilySnapshotError::InvalidInput),
    }
    Ok(())
}

fn materialize_transaction(connection: &Connection, payload: &str) -> Result<()> {
    connection.execute(
        "INSERT INTO transactions(
           id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,
           calculation_target,attribution_kind,attributed_member_id,audience_visibility,
           audience_member_id,created_at,updated_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
           json_extract(?1,'$.occurredOn'),json_extract(?1,'$.postedOn'),
           json_extract(?1,'$.transactionType'),json_extract(?1,'$.payee'),
           json_extract(?1,'$.description'),json_extract(?1,'$.status'),
           json_extract(?1,'$.calculationTarget'),json_extract(?1,'$.attributionKind'),
           json_extract(?1,'$.attributedMemberId'),json_extract(?1,'$.audienceVisibility'),
           json_extract(?1,'$.audienceMemberId'),json_extract(?1,'$.createdAt'),
           json_extract(?1,'$.updatedAt'))
         ON CONFLICT(id) DO UPDATE SET occurred_on=excluded.occurred_on,
           posted_on=excluded.posted_on,transaction_type=excluded.transaction_type,
           payee=excluded.payee,description=excluded.description,status=excluded.status,
           calculation_target=excluded.calculation_target,attribution_kind=excluded.attribution_kind,
           attributed_member_id=excluded.attributed_member_id,
           audience_visibility=excluded.audience_visibility,audience_member_id=excluded.audience_member_id,
           created_at=excluded.created_at,updated_at=excluded.updated_at",
        [payload],
    )?;
    for table in [
        "journal_entries",
        "transaction_labels",
        "transaction_tags",
        "transaction_external_keys",
    ] {
        connection.execute(
            &format!("DELETE FROM {table} WHERE transaction_id=json_extract(?1,'$.id')"),
            [payload],
        )?;
    }
    connection.execute(
        "INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number,created_at)
         SELECT json_extract(value,'$.id'),json_extract(value,'$.transactionId'),
           json_extract(value,'$.accountId'),json_extract(value,'$.entrySide'),
           json_extract(value,'$.amountJpy'),json_extract(value,'$.lineNumber'),
           json_extract(value,'$.createdAt') FROM json_each(?1,'$.journalEntries')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO transaction_labels(transaction_id,label)
         SELECT json_extract(?1,'$.id'),value FROM json_each(?1,'$.labels')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO transaction_tags(transaction_id,tag)
         SELECT json_extract(?1,'$.id'),value FROM json_each(?1,'$.tags')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO transaction_external_keys(
           household_id,external_source,external_id,fact_hash,transaction_id,created_at)
         SELECT json_extract(value,'$.householdId'),json_extract(value,'$.externalSource'),
           json_extract(value,'$.externalId'),json_extract(value,'$.factHash'),
           json_extract(value,'$.transactionId'),json_extract(value,'$.createdAt')
         FROM json_each(?1,'$.externalKeys')",
        [payload],
    )?;
    Ok(())
}

fn materialize_delete(
    connection: &Connection,
    household_id: &str,
    kind: &str,
    entity_id: &str,
) -> Result<()> {
    if !FAMILY_V1_SUPPORTED_KINDS.contains(&kind) {
        return change_package::materialize_delete(connection, household_id, kind, entity_id, 4)
            .map_err(|_| FamilySnapshotError::Conflict);
    }
    let table = match kind {
        "TRANSACTION" => "transactions",
        "ACCOUNT" => "accounts",
        _ => return Err(FamilySnapshotError::InvalidInput),
    };
    let affected = connection.execute(
        &format!("DELETE FROM {table} WHERE id=?1 AND household_id=?2"),
        params![entity_id, household_id],
    )?;
    if affected > 1 {
        return Err(FamilySnapshotError::Conflict);
    }
    Ok(())
}

fn dependency_rank(kind: &str) -> u8 {
    match kind {
        "HOUSEHOLD" => 0,
        "HOUSEHOLD_MEMBER" => 1,
        "ACCOUNT" => 2,
        "TRANSACTION" => 3,
        "SAVINGS_GOAL" | "DASHBOARD_PREFERENCES" | "DELIMITED_PARSER_PROFILE" => 4,
        "MONTHLY_BUDGET_PLAN"
        | "CLASSIFICATION_RULE"
        | "ACCOUNT_GROUP"
        | "CARD_SETTLEMENT_MAPPING" => 5,
        _ => u8::MAX,
    }
}

fn hash_serializable(value: &impl Serialize) -> Result<String> {
    let value = serde_json::to_value(value).map_err(|_| FamilySnapshotError::Encoding)?;
    let canonical = canonical_json(&value).map_err(|_| FamilySnapshotError::Encoding)?;
    Ok(sha256_hex(canonical.as_bytes()))
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

fn supported_kinds(schema_version: u32) -> &'static [&'static str] {
    if schema_version == 1 {
        &FAMILY_V1_SUPPORTED_KINDS
    } else {
        &FAMILY_SUPPORTED_KINDS
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    const KEY: &[u8] = b"family-snapshot-test-key-material-32";

    fn state() -> AppState {
        AppState::in_memory(KEY).unwrap()
    }

    fn setup(state: &AppState, name: &str) {
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name,base_currency) VALUES('family',?1,'JPY')",
                    [name],
                )?;
                connection.execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,currency,
                       owner_member_id,ownership_kind,visibility)
                     VALUES('shared-bank','family','Shared','ASSET','BANK','JPY',NULL,'HOUSEHOLD','SHARED')",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        state
            .with_connection(|connection| {
                get_local_status(connection, "family").unwrap();
                Ok(())
            })
            .unwrap();
    }

    fn export_from(state: &AppState) -> FamilySnapshotSetDto {
        state
            .with_connection(|connection| Ok(export_snapshot_set(connection, "family").unwrap()))
            .unwrap()
    }

    fn reidentify_destination(state: &AppState) {
        state
            .with_connection(|connection| {
                connection.execute(
                    "DELETE FROM local_sync_contexts WHERE household_id='family'",
                    [],
                )?;
                connection.execute(
                    "UPDATE sync_devices SET status='RETIRED' WHERE status='ACTIVE'",
                    [],
                )?;
                get_local_status(connection, "family").unwrap();
                Ok(())
            })
            .unwrap();
    }

    fn resolve_pending(connection: &Connection, review: &FamilySnapshotReviewDto) {
        let resolutions = review
            .records
            .iter()
            .filter(|record| record.resolution == "PENDING")
            .map(|record| FamilySnapshotResolutionInput {
                partition_order: record.partition_order,
                entity_kind: record.entity_kind.clone(),
                entity_id: record.entity_id.clone(),
                resolution: "APPLY_INCOMING".to_owned(),
            })
            .collect::<Vec<_>>();
        if !resolutions.is_empty() {
            resolve_snapshot_set(connection, &review.snapshot_set_id, &resolutions).unwrap();
        }
    }

    fn seed_planning_configuration(state: &AppState) {
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,currency,
                       owner_member_id,ownership_kind,visibility)
                     VALUES('private-category','family','Private category','EXPENSE','OTHER','JPY',
                       'family-member-primary','MEMBER','PERSONAL')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO monthly_category_budgets(household_id,month,category_account_id,budget_jpy)
                     VALUES('family','2026-07','private-category',50000)",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO classification_rules(id,household_id,name,priority,merchant_contains,category_account_id)
                     VALUES('private-rule','family','Private rule',10,'STORE','private-category')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO account_groups(id,household_id,name,group_kind,sort_order)
                     VALUES('private-group','family','Private group','CUSTOM',1)",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO account_group_members(household_id,account_group_id,account_id,sort_order)
                     VALUES('family','private-group','shared-bank',0),
                           ('family','private-group','private-category',1)",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO savings_goals(id,household_id,name,target_jpy,saved_jpy,target_date)
                     VALUES('shared-goal','family','Emergency fund',1000000,100000,'2027-07-01')",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn schema_two_partitions_atomic_planning_configuration_by_account_dependencies() {
        let source = state();
        setup(&source, "Source");
        seed_planning_configuration(&source);
        let set = export_from(&source);
        assert_eq!(set.schema_version, 2);
        let shared = &set.partitions[0];
        let personal = &set.partitions[1];
        assert!(shared
            .records
            .iter()
            .any(|record| record.entity_kind == "SAVINGS_GOAL"));
        for kind in [
            "MONTHLY_BUDGET_PLAN",
            "CLASSIFICATION_RULE",
            "ACCOUNT_GROUP",
        ] {
            assert!(personal
                .records
                .iter()
                .any(|record| record.entity_kind == kind));
            assert!(!shared
                .records
                .iter()
                .any(|record| record.entity_kind == kind));
        }
        let shared_bytes = encode_partition_artifact(&set, &FamilyAudienceDto::shared()).unwrap();
        let shared_text = String::from_utf8(shared_bytes).unwrap();
        assert!(!shared_text.contains("private-rule"));
        assert!(!shared_text.contains("private-group"));
        assert!(!shared_text.contains("private-category"));
        decode_and_validate(&encode_pretty(&set).unwrap()).unwrap();
    }

    #[test]
    fn personal_account_groups_without_explicit_owner_fail_closed() {
        for with_shared_member in [false, true] {
            let state = state();
            setup(&state, "Source");
            state
                .with_connection(|connection| {
                    connection.execute(
                        "INSERT INTO account_groups(id,household_id,name,group_kind,sort_order)
                         VALUES('ambiguous-personal','family','Ambiguous','PERSONAL',1)",
                        [],
                    )?;
                    if with_shared_member {
                        connection.execute(
                            "INSERT INTO account_group_members(
                               household_id,account_group_id,account_id,sort_order)
                             VALUES('family','ambiguous-personal','shared-bank',0)",
                            [],
                        )?;
                    }
                    Ok(())
                })
                .unwrap();
            let set = export_from(&state);
            assert_eq!(set.excluded_counts_by_reason["UNASSIGNED_SCOPE"], 1);
            assert!(!set.partitions.iter().any(|partition| partition
                .records
                .iter()
                .any(|record| record.entity_id == "ambiguous-personal")));
            assert!(set.partitions.iter().all(|partition| !partition
                .authoritative_kinds
                .iter()
                .any(|kind| kind == "ACCOUNT_GROUP")));
        }
    }

    #[test]
    fn genuine_schema_one_identity_remains_compatible() {
        let state = state();
        setup(&state, "Source");
        let mut legacy = export_from(&state);
        legacy.schema_version = 1;
        legacy.excluded_counts_by_reason = [
            "EVIDENCE_DEPENDENT_INVESTMENT",
            "MIXED_PERSONAL_MEMBERS",
            "OTHER_MEMBER_PERSONAL",
            "UNASSIGNED_SCOPE",
            "UNSUPPORTED_KIND",
        ]
        .into_iter()
        .map(|reason| (reason.to_owned(), 0))
        .collect();
        for partition in &mut legacy.partitions {
            partition
                .records
                .retain(|record| FAMILY_V1_SUPPORTED_KINDS.contains(&record.entity_kind.as_str()));
            partition
                .authoritative_kinds
                .retain(|kind| FAMILY_V1_SUPPORTED_KINDS.contains(&kind.as_str()));
            partition.counts_by_kind = FAMILY_V1_SUPPORTED_KINDS
                .iter()
                .map(|kind| {
                    (
                        (*kind).to_owned(),
                        partition
                            .records
                            .iter()
                            .filter(|record| record.entity_kind == *kind)
                            .count() as u64,
                    )
                })
                .collect();
            partition.relocations.clear();
            partition.dependency_audiences.clear();
            let identity = PartitionIdentity {
                format: FAMILY_FORMAT,
                schema_version: 1,
                mode: FAMILY_MODE,
                source_installation_id: &legacy.source_installation_id,
                source_principal_id: &legacy.source_principal_id,
                publisher_member_id: &legacy.publisher_member_id,
                source_revision: legacy.source_revision,
                household_id: &legacy.household_id,
                created_at: &legacy.created_at,
                audience: &partition.audience,
                dependency_audiences: &partition.dependency_audiences,
                authoritative_kinds: &partition.authoritative_kinds,
                counts_by_kind: &partition.counts_by_kind,
                records: &partition.records,
                relocations: &partition.relocations,
            };
            partition.snapshot_sha256 = hash_serializable(&identity).unwrap();
            partition.package_id = format!("family-partition-{}", partition.snapshot_sha256);
            partition.package_sha256 = hash_serializable(&json!({
                "packageId": partition.package_id,
                "snapshotSha256": partition.snapshot_sha256,
                "identity": identity,
            }))
            .unwrap();
        }
        let identity = SetIdentity {
            format: FAMILY_FORMAT,
            schema_version: 1,
            mode: FAMILY_MODE,
            source_installation_id: &legacy.source_installation_id,
            source_principal_id: &legacy.source_principal_id,
            publisher_member_id: &legacy.publisher_member_id,
            source_revision: legacy.source_revision,
            household_id: &legacy.household_id,
            created_at: &legacy.created_at,
            excluded_counts_by_reason: &legacy.excluded_counts_by_reason,
            partitions: &legacy.partitions,
        };
        legacy.set_sha256 = hash_serializable(&identity).unwrap();
        legacy.snapshot_set_id = format!("family-set-{}", legacy.set_sha256);
        let bytes = encode_pretty(&legacy).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("relocations"));
        for partition in &legacy.partitions {
            validate_partition(&legacy, partition).unwrap();
        }
        let records = legacy
            .partitions
            .iter()
            .flat_map(|partition| {
                partition
                    .records
                    .iter()
                    .cloned()
                    .map(|record| (partition.audience.clone(), record))
            })
            .collect::<Vec<_>>();
        validate_partition_scopes(&legacy, &records, &legacy.publisher_member_id).unwrap();
        let check_identity = SetIdentity {
            format: &legacy.format,
            schema_version: legacy.schema_version,
            mode: &legacy.mode,
            source_installation_id: &legacy.source_installation_id,
            source_principal_id: &legacy.source_principal_id,
            publisher_member_id: &legacy.publisher_member_id,
            source_revision: legacy.source_revision,
            household_id: &legacy.household_id,
            created_at: &legacy.created_at,
            excluded_counts_by_reason: &legacy.excluded_counts_by_reason,
            partitions: &legacy.partitions,
        };
        assert_eq!(
            hash_serializable(&check_identity).unwrap(),
            legacy.set_sha256
        );
        let decoded = decode_and_validate(&bytes).unwrap();
        assert_eq!(decoded.schema_version, 1);
    }

    #[test]
    fn legacy_unknown_outbound_lineage_disables_first_v2_omissions() {
        let state = state();
        setup(&state, "Source");
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO family_delivery_connections(
                       household_id,endpoint,remote_principal_id,local_member_id,
                       local_member_name,state)
                     VALUES('family','https://relay.example','principal',
                       'family-member-primary','Primary','CONNECTED')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO family_delivery_partition_state(
                       household_id,audience_key,visibility,member_id,member_key,dirty)
                     VALUES('family','SHARED','SHARED',NULL,'',1)",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO family_delivery_outbound_lineage_state(
                       household_id,audience_key,state)
                     VALUES('family','SHARED','LEGACY_UNKNOWN')",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let set = export_from(&state);
        let shared = &set.partitions[0];
        for kind in [
            "ACCOUNT",
            "TRANSACTION",
            "SAVINGS_GOAL",
            "CLASSIFICATION_RULE",
            "ACCOUNT_GROUP",
            "CARD_SETTLEMENT_MAPPING",
            "DASHBOARD_PREFERENCES",
            "DELIMITED_PARSER_PROFILE",
        ] {
            assert!(!shared.authoritative_kinds.iter().any(|value| value == kind));
        }
    }

    #[test]
    fn schema_two_round_trip_reuses_change_package_materializers() {
        let source = state();
        setup(&source, "Source");
        seed_planning_configuration(&source);
        let bytes = encode_pretty(&export_from(&source)).unwrap();

        let destination = state();
        setup(&destination, "Destination");
        reidentify_destination(&destination);
        destination
            .with_connection(|connection| {
                let review = stage_snapshot_set(connection, "family", &bytes).unwrap();
                resolve_pending(connection, &review);
                apply_snapshot_set(connection, &review.snapshot_set_id).unwrap();
                let values: (i64, i64, i64, i64) = connection.query_row(
                    "SELECT
                       (SELECT count(*) FROM monthly_category_budgets WHERE household_id='family'),
                       (SELECT count(*) FROM classification_rules WHERE household_id='family'),
                       (SELECT count(*) FROM account_groups WHERE household_id='family'),
                       (SELECT count(*) FROM savings_goals WHERE household_id='family')",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )?;
                assert_eq!(values, (1, 1, 1, 1));
                Ok(())
            })
            .unwrap();
    }

    fn apply_artifact(state: &AppState, bytes: &[u8]) {
        state
            .with_connection(|connection| {
                let review = stage_snapshot_set(connection, "family", bytes).unwrap();
                resolve_pending(connection, &review);
                apply_snapshot_set(connection, &review.snapshot_set_id).unwrap();
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn audience_index_prevents_shared_personal_move_clobber_in_both_orders() {
        let source = state();
        setup(&source, "Source");
        source
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO monthly_category_budgets(household_id,month,category_account_id,budget_jpy)
                     VALUES('family','2026-07','shared-bank',50000)",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let initial_set = export_from(&source);
        source
            .with_connection(|connection| {
                for partition in &initial_set.partitions {
                    for record in &partition.records {
                        connection.execute(
                            "INSERT INTO family_delivery_outbound_entity_heads(
                               household_id,visibility,member_id,member_key,entity_kind,entity_id,
                               payload_sha256,accepted_at) VALUES('family',?1,?2,?3,?4,?5,?6,
                               '2026-07-14T00:00:00Z')",
                            params![
                                partition.audience.visibility,
                                partition.audience.member_id,
                                partition.audience.member_key(),
                                record.entity_kind,
                                record.entity_id,
                                record.payload_sha256
                            ],
                        )?;
                    }
                }
                Ok(())
            })
            .unwrap();
        let initial = encode_pretty(&initial_set).unwrap();
        let destination = state();
        setup(&destination, "Destination");
        reidentify_destination(&destination);
        apply_artifact(&destination, &initial);

        source
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE accounts SET owner_member_id='family-member-primary',
                       ownership_kind='MEMBER',visibility='PERSONAL' WHERE id='shared-bank'",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let moved_personal = export_from(&source);
        let personal_first = encode_partition_artifact(
            &moved_personal,
            &FamilyAudienceDto::personal("family-member-primary"),
        )
        .unwrap();
        let shared_second =
            encode_partition_artifact(&moved_personal, &FamilyAudienceDto::shared()).unwrap();
        apply_artifact(&destination, &personal_first);
        apply_artifact(&destination, &shared_second);
        source
            .with_connection(|connection| {
                connection.execute(
                    "DELETE FROM family_delivery_outbound_entity_heads WHERE household_id='family'",
                    [],
                )?;
                for partition in &moved_personal.partitions {
                    for record in &partition.records {
                        connection.execute(
                            "INSERT INTO family_delivery_outbound_entity_heads(
                               household_id,visibility,member_id,member_key,entity_kind,entity_id,
                               payload_sha256,accepted_at) VALUES('family',?1,?2,?3,?4,?5,?6,
                               '2026-07-14T00:01:00Z')",
                            params![
                                partition.audience.visibility,
                                partition.audience.member_id,
                                partition.audience.member_key(),
                                record.entity_kind,
                                record.entity_id,
                                record.payload_sha256
                            ],
                        )?;
                    }
                }
                Ok(())
            })
            .unwrap();

        source
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE accounts SET owner_member_id=NULL,ownership_kind='HOUSEHOLD',
                       visibility='SHARED' WHERE id='shared-bank'",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let moved_shared = export_from(&source);
        let shared_first =
            encode_partition_artifact(&moved_shared, &FamilyAudienceDto::shared()).unwrap();
        let personal_second = encode_partition_artifact(
            &moved_shared,
            &FamilyAudienceDto::personal("family-member-primary"),
        )
        .unwrap();
        apply_artifact(&destination, &shared_first);
        apply_artifact(&destination, &personal_second);
        destination
            .with_connection(|connection| {
                let state: (String, i64) = connection.query_row(
                    "SELECT a.visibility,
                      (SELECT count(*) FROM monthly_category_budgets b
                       WHERE b.household_id=a.household_id AND b.category_account_id=a.id)
                     FROM accounts a WHERE a.id='shared-bank'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                assert_eq!(state, ("SHARED".to_owned(), 1));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn exports_distinct_shared_and_bound_personal_partitions() {
        let state = state();
        setup(&state, "Source");
        state
            .with_connection(|connection| {
                let member: String = connection.query_row(
                    "SELECT member_id FROM local_sync_contexts c JOIN household_principal_bindings b
                     ON b.household_id=c.household_id AND b.principal_id=c.principal_id
                     WHERE c.household_id='family'",
                    [],
                    |row| row.get(0),
                )?;
                connection.execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,currency,
                       owner_member_id,ownership_kind,visibility)
                     VALUES('private-bank','family','Private','ASSET','BANK','JPY',?1,'MEMBER','PERSONAL')",
                    [member],
                )?;
                Ok(())
            })
            .unwrap();
        let set = export_from(&state);
        validate_snapshot_set(&set).unwrap();
        assert_eq!(set.partitions.len(), 2);
        assert_eq!(set.partitions[0].audience.visibility, "SHARED");
        assert_eq!(set.partitions[1].audience.visibility, "PERSONAL");
        assert!(set.partitions[0]
            .records
            .iter()
            .any(|r| r.entity_id == "shared-bank"));
        assert!(set.partitions[1]
            .records
            .iter()
            .any(|r| r.entity_id == "private-bank"));
    }

    #[test]
    fn mixed_member_transaction_is_withheld_and_disables_transaction_authority() {
        let state = state();
        setup(&state, "Source");
        state
            .with_connection(|connection| {
                let primary: String = connection.query_row(
                    "SELECT id FROM household_members WHERE household_id='family' ORDER BY sort_order LIMIT 1",
                    [],
                    |row| row.get(0),
                )?;
                connection.execute(
                    "INSERT INTO household_members(id,household_id,display_name,status,sort_order)
                     VALUES('member-two','family','Two','ACTIVE',1)",
                    [],
                )?;
                for (id, member) in [("private-one", primary.as_str()), ("private-two", "member-two")] {
                    connection.execute(
                        "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,currency,
                           owner_member_id,ownership_kind,visibility)
                         VALUES(?1,'family',?1,'ASSET','BANK','JPY',?2,'MEMBER','PERSONAL')",
                        params![id, member],
                    )?;
                }
                connection.execute(
                    "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status,
                       attribution_kind,audience_visibility,created_at,updated_at)
                     VALUES('mixed','family','2026-07-14','TRANSFER','POSTED','HOUSEHOLD','SHARED',
                       '2026-07-14T00:00:00Z','2026-07-14T00:00:00Z')",
                    [],
                )?;
                for (id, account, side, line) in [
                    ("mixed-d", "private-one", "DEBIT", 1),
                    ("mixed-c", "private-two", "CREDIT", 2),
                ] {
                    connection.execute(
                        "INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                         VALUES(?1,'mixed',?2,?3,100,?4)",
                        params![id, account, side, line],
                    )?;
                }
                Ok(())
            })
            .unwrap();
        let set = export_from(&state);
        assert_eq!(set.excluded_counts_by_reason["MIXED_PERSONAL_MEMBERS"], 1);
        assert!(set.partitions.iter().all(|partition| {
            !partition
                .records
                .iter()
                .any(|record| record.entity_id == "mixed")
                && !partition
                    .authoritative_kinds
                    .contains(&"TRANSACTION".to_owned())
        }));
    }

    #[test]
    fn personal_partition_requires_matching_active_local_member() {
        let source = state();
        setup(&source, "Source");
        let set = export_from(&source);
        let bytes =
            encode_partition_artifact(&set, &FamilyAudienceDto::personal(&set.publisher_member_id))
                .unwrap();

        let destination = state();
        setup(&destination, "Destination");
        reidentify_destination(&destination);
        destination
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO household_members(id,household_id,display_name,status,sort_order)
                     VALUES('other','family','Other','ACTIVE',1)",
                    [],
                )?;
                let principal: String = connection.query_row(
                    "SELECT principal_id FROM local_sync_contexts WHERE household_id='family'",
                    [],
                    |row| row.get(0),
                )?;
                connection.execute(
                    "UPDATE household_principal_bindings SET member_id='other'
                     WHERE household_id='family' AND principal_id=?1",
                    [principal],
                )?;
                assert!(matches!(
                    stage_snapshot_set(connection, "family", &bytes),
                    Err(FamilySnapshotError::AudienceBlocked)
                ));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn applies_shared_first_and_omission_delete_requires_matching_partition_head() {
        let source = state();
        setup(&source, "Source");
        let first = export_from(&source);
        let first_bytes = encode_pretty(&first).unwrap();

        let destination = state();
        setup(&destination, "Destination");
        // Match member identity but retain a distinct device identity.
        reidentify_destination(&destination);
        destination
            .with_connection(|connection| {
                let review = stage_snapshot_set(connection, "family", &first_bytes).unwrap();
                resolve_pending(connection, &review);
                let applied = apply_snapshot_set(connection, &review.snapshot_set_id).unwrap();
                assert_eq!(applied.state, "APPLIED");
                Ok(())
            })
            .unwrap();

        source
            .with_connection(|connection| {
                connection.execute("DELETE FROM accounts WHERE id='shared-bank'", [])?;
                Ok(())
            })
            .unwrap();
        let second = export_from(&source);
        let second_bytes = encode_pretty(&second).unwrap();
        destination
            .with_connection(|connection| {
                let review = stage_snapshot_set(connection, "family", &second_bytes).unwrap();
                let delete = review
                    .records
                    .iter()
                    .find(|record| {
                        record.operation == "DELETE" && record.entity_id == "shared-bank"
                    })
                    .unwrap();
                assert_eq!(delete.resolution, "PENDING");
                resolve_pending(connection, &review);
                let resolved = load_review(connection, &review.snapshot_set_id)
                    .unwrap()
                    .unwrap();
                assert_eq!(resolved.state, "READY");
                apply_snapshot_set(connection, &review.snapshot_set_id).unwrap();
                let exists: bool = connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM accounts WHERE id='shared-bank')",
                    [],
                    |row| row.get(0),
                )?;
                assert!(!exists);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn shared_and_personal_artifacts_stage_sequentially_at_one_revision() {
        let source = state();
        setup(&source, "Source");
        source
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,currency,
                       owner_member_id,ownership_kind,visibility)
                     VALUES('private-bank','family','Private','ASSET','BANK','JPY',
                       'family-member-primary','MEMBER','PERSONAL')",
                    [],
                )?;
                connection.execute_batch(
                    "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status,
                       attribution_kind,attributed_member_id,audience_visibility,audience_member_id,
                       created_at,updated_at)
                     VALUES('personal-purchase','family','2026-07-14','EXPENSE','POSTED',
                       'MEMBER','family-member-primary','PERSONAL','family-member-primary',
                       '2026-07-14T00:00:00Z','2026-07-14T00:00:00Z');
                     INSERT INTO journal_entries(
                       id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                     VALUES('personal-purchase-d','personal-purchase','shared-bank','DEBIT',100,1),
                           ('personal-purchase-c','personal-purchase','private-bank','CREDIT',100,2);",
                )?;
                Ok(())
            })
            .unwrap();
        let set = export_from(&source);
        let shared = encode_partition_artifact(&set, &FamilyAudienceDto::shared()).unwrap();
        let personal =
            encode_partition_artifact(&set, &FamilyAudienceDto::personal(&set.publisher_member_id))
                .unwrap();
        let personal_envelope = decode_and_validate(&personal).unwrap();
        assert_eq!(
            personal_envelope.partitions[0]
                .dependency_audiences
                .get("shared-bank"),
            Some(&FamilyAudienceDto::shared())
        );

        let destination = state();
        setup(&destination, "Destination");
        reidentify_destination(&destination);
        destination
            .with_connection(|connection| {
                for artifact in [&shared, &personal] {
                    let review = stage_snapshot_set(connection, "family", artifact).unwrap();
                    resolve_pending(connection, &review);
                    assert_eq!(
                        apply_snapshot_set(connection, &review.snapshot_set_id)
                            .unwrap()
                            .state,
                        "APPLIED"
                    );
                }
                let private_exists: bool = connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM accounts WHERE id='private-bank')",
                    [],
                    |row| row.get(0),
                )?;
                assert!(private_exists);
                let transaction_exists: bool = connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM transactions WHERE id='personal-purchase')",
                    [],
                    |row| row.get(0),
                )?;
                assert!(transaction_exists);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn personal_artifact_requires_local_shared_account_dependency() {
        let source = state();
        setup(&source, "Source");
        source
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,currency,
                       owner_member_id,ownership_kind,visibility)
                     VALUES('private-bank','family','Private','ASSET','BANK','JPY',
                       'family-member-primary','MEMBER','PERSONAL');
                     INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status,
                       attribution_kind,attributed_member_id,audience_visibility,audience_member_id)
                     VALUES('personal-purchase','family','2026-07-14','EXPENSE','POSTED',
                       'MEMBER','family-member-primary','PERSONAL','family-member-primary');
                     INSERT INTO journal_entries(
                       id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                     VALUES('personal-purchase-d','personal-purchase','shared-bank','DEBIT',100,1),
                           ('personal-purchase-c','personal-purchase','private-bank','CREDIT',100,2);",
                )?;
                Ok(())
            })
            .unwrap();
        let set = export_from(&source);
        let personal =
            encode_partition_artifact(&set, &FamilyAudienceDto::personal(&set.publisher_member_id))
                .unwrap();

        let destination = state();
        setup(&destination, "Destination");
        reidentify_destination(&destination);
        destination
            .with_connection(|connection| {
                connection.execute("DELETE FROM accounts WHERE id='shared-bank'", [])?;
                assert!(matches!(
                    stage_snapshot_set(connection, "family", &personal),
                    Err(FamilySnapshotError::AudienceBlocked)
                ));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn transaction_artifact_strips_source_links_and_applies_without_source_evidence() {
        let source = state();
        setup(&source, "Source");
        source
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status,
                       attribution_kind,audience_visibility,created_at,updated_at)
                     VALUES('purchase','family','2026-07-14','EXPENSE','POSTED','HOUSEHOLD','SHARED',
                       '2026-07-14T00:00:00Z','2026-07-14T00:00:00Z');
                     INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                     VALUES('purchase-d','purchase','shared-bank','DEBIT',100,1),
                           ('purchase-c','purchase','shared-bank','CREDIT',100,2);
                     INSERT INTO transaction_portable_source_links(transaction_id,source_record_id,candidate_id)
                     VALUES('purchase','source-record','candidate');",
                )?;
                Ok(())
            })
            .unwrap();
        let set = export_from(&source);
        let transaction = set
            .partitions
            .iter()
            .flat_map(|partition| &partition.records)
            .find(|record| record.entity_id == "purchase")
            .unwrap();
        let payload: Value = serde_json::from_str(&transaction.canonical_payload_json).unwrap();
        assert_eq!(payload["sourceLinks"], json!([]));

        let shared = encode_partition_artifact(&set, &FamilyAudienceDto::shared()).unwrap();
        let destination = state();
        setup(&destination, "Destination");
        reidentify_destination(&destination);
        destination
            .with_connection(|connection| {
                let review = stage_snapshot_set(connection, "family", &shared).unwrap();
                resolve_pending(connection, &review);
                apply_snapshot_set(connection, &review.snapshot_set_id).unwrap();
                let links: i64 = connection.query_row(
                    "SELECT count(*) FROM transaction_portable_source_links
                     WHERE transaction_id='purchase'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(links, 0);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn omission_never_deletes_head_from_another_partition_or_source() {
        let state = state();
        setup(&state, "Destination");
        state
            .with_connection(|connection| {
                // A foreign SHARED head cannot authorize a deletion for a new source.
                connection.execute(
                    "INSERT INTO family_snapshot_sets(snapshot_set_id,target_household_id,
                       source_installation_id,source_principal_id,publisher_member_id,source_revision,
                       set_sha256,manifest_json,state,record_count,conflict_count,delete_count,
                       source_created_at,reviewed_at,applied_at)
                     VALUES('old-set','family','old-source','old-principal','family-member-primary',1,
                       ?1,'{}','APPLIED',0,0,0,'2026-07-14T00:00:00Z',
                       '2026-07-14T00:00:00Z','2026-07-14T00:00:00Z')",
                    ["a".repeat(64)],
                )?;
                connection.execute(
                    "INSERT INTO family_snapshot_partitions(snapshot_set_id,partition_order,visibility,
                       member_id,member_key,package_id,snapshot_sha256,package_sha256,
                       authoritative_kinds_json,record_count)
                     VALUES('old-set',0,'SHARED',NULL,'','old-package',?1,?1,'[\"ACCOUNT\"]',0)",
                    ["b".repeat(64)],
                )?;
                connection.execute(
                    "INSERT INTO family_applied_partitions(package_id,snapshot_set_id,household_id,
                       source_installation_id,visibility,member_id,member_key,source_revision,snapshot_sha256)
                     VALUES('old-package','old-set','family','old-source','SHARED',NULL,'',1,?1)",
                    ["b".repeat(64)],
                )?;
                let payload =
                    load_entity_payload(connection, "family", "ACCOUNT", "shared-bank")
                        .unwrap()
                        .unwrap();
                connection.execute(
                    "INSERT INTO family_replica_entity_heads(household_id,visibility,member_id,member_key,
                       entity_kind,entity_id,source_installation_id,package_id,source_revision,operation,payload_sha256)
                     VALUES('family','SHARED',NULL,'','ACCOUNT','shared-bank','old-source','old-package',1,'UPSERT',?1)",
                    [sha256_hex(payload.as_bytes())],
                )?;
                Ok(())
            })
            .unwrap();
        // The exact staging case is covered by the source predicate in
        // `load_partition_heads`; assert it directly to guard the boundary.
        state
            .with_connection(|connection| {
                let heads = load_partition_heads(
                    connection,
                    "family",
                    &FamilyAudienceDto::shared(),
                    "different-source",
                    "ACCOUNT",
                )
                .unwrap();
                assert!(heads.is_empty());
                Ok(())
            })
            .unwrap();
    }
}
