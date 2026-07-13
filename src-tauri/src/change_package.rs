use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

use crate::sync_foundation::{canonical_json, get_local_status, sha256_hex};

pub const PACKAGE_SCHEMA_VERSION: u32 = 1;
pub const PACKAGE_MODE: &str = "FULL_CURRENT_STATE";
pub const COVERED_KINDS: [&str; 11] = [
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

const MAX_PACKAGE_RECORDS: usize = 100_000;

#[derive(Debug, Error)]
pub enum ChangePackageError {
    #[error("change package database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("change package input is invalid")]
    InvalidInput,
    #[error("change package is too large")]
    LimitExceeded,
    #[error("change package encoding failed")]
    Encoding,
    #[error("change package household was not found")]
    NotFound,
    #[error("another change package is awaiting review")]
    ReviewPending,
    #[error("change package conflicts with existing lineage")]
    Conflict,
    #[error("change package revision is stale")]
    Stale,
}

pub type Result<T> = std::result::Result<T, ChangePackageError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangePackageRecordDto {
    pub entity_kind: String,
    pub entity_id: String,
    pub operation: String,
    pub canonical_payload_json: String,
    pub payload_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalChangePackageDto {
    pub package_id: String,
    pub schema_version: u32,
    pub mode: String,
    pub source_installation_id: String,
    pub source_principal_id: String,
    pub source_revision: u64,
    pub household_id: String,
    pub created_at: String,
    pub covered_kinds: Vec<String>,
    pub counts_by_kind: BTreeMap<String, u64>,
    pub snapshot_sha256: String,
    pub package_sha256: String,
    pub records: Vec<ChangePackageRecordDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangePackageRecordReviewDto {
    pub record_order: u64,
    pub entity_kind: String,
    pub entity_id: String,
    pub operation: String,
    #[serde(skip_serializing)]
    pub canonical_payload_json: String,
    pub payload_sha256: String,
    pub review_state: String,
    pub resolution: String,
    pub current_payload_sha256: Option<String>,
    pub conflict_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangePackageReviewDto {
    pub package_id: String,
    pub target_household_id: String,
    pub source_installation_id: String,
    pub source_revision: u64,
    pub source_created_at: String,
    pub state: String,
    pub record_count: u64,
    pub create_count: u64,
    pub update_count: u64,
    pub unchanged_count: u64,
    pub delete_count: u64,
    pub conflict_count: u64,
    pub records: Vec<ChangePackageRecordReviewDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangePackageResolutionInput {
    pub entity_kind: String,
    pub entity_id: String,
    pub resolution: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotIdentity<'a> {
    schema_version: u32,
    mode: &'a str,
    source_installation_id: &'a str,
    source_principal_id: &'a str,
    source_revision: u64,
    household_id: &'a str,
    created_at: &'a str,
    covered_kinds: &'a [String],
    counts_by_kind: &'a BTreeMap<String, u64>,
    records: &'a [ChangePackageRecordDto],
}

pub fn export_current_state(
    connection: &Connection,
    household_id: &str,
) -> Result<LocalChangePackageDto> {
    build_current_state(connection, household_id, true)
}

fn current_state_for_comparison(
    connection: &Connection,
    household_id: &str,
) -> Result<LocalChangePackageDto> {
    build_current_state(connection, household_id, false)
}

fn build_current_state(
    connection: &Connection,
    household_id: &str,
    allocate_revision: bool,
) -> Result<LocalChangePackageDto> {
    if household_id.is_empty() || household_id.len() > 128 {
        return Err(ChangePackageError::InvalidInput);
    }
    let status =
        get_local_status(connection, household_id).map_err(|_| ChangePackageError::NotFound)?;
    let transaction = connection.unchecked_transaction()?;
    let exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM households WHERE id=?1)",
        [household_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(ChangePackageError::NotFound);
    }

    if allocate_revision {
        transaction.execute(
            "UPDATE local_change_package_revisions SET revision=revision+1,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1",
            [household_id],
        )?;
    }
    let source_revision: i64 = transaction.query_row(
        "SELECT revision FROM local_change_package_revisions WHERE household_id=?1",
        [household_id],
        |row| row.get(0),
    )?;
    let created_at: String = transaction.query_row(
        "SELECT CASE WHEN ?2 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     ELSE updated_at END
         FROM households WHERE id=?1",
        params![household_id, allocate_revision],
        |row| row.get(0),
    )?;

    let mut records = Vec::new();
    push_query_records(
        &transaction,
        &mut records,
        "HOUSEHOLD",
        "SELECT id,json(json_object(
           'recordKind','HOUSEHOLD','id',id,'name',name,'baseCurrency',base_currency,
           'createdAt',created_at,'updatedAt',updated_at))
         FROM households WHERE id=?1",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "HOUSEHOLD_MEMBER",
        "SELECT id,json(json_object(
           'recordKind','HOUSEHOLD_MEMBER','displayName',display_name,
           'householdId',household_id,'id',id,'relationshipLabel',relationship_label,
           'sortOrder',sort_order,'status',status,'createdAt',created_at,'updatedAt',updated_at))
         FROM household_members WHERE household_id=?1 ORDER BY sort_order,id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "ACCOUNT",
        "SELECT id,json(json_object(
           'recordKind','ACCOUNT','accountKind',account_kind,'accountSubtype',account_subtype,
           'householdId',household_id,'id',id,'name',name,'currency',currency,
           'institutionName',institution_name,'maskedIdentifier',masked_identifier,
           'isArchived',is_archived,'ownerMemberId',owner_member_id,
           'ownershipKind',ownership_kind,'visibility',visibility,
           'createdAt',created_at,'updatedAt',updated_at))
         FROM accounts WHERE household_id=?1 ORDER BY id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "TRANSACTION",
        "SELECT transaction_id,payload_json FROM sync_transaction_aggregate_payloads
         WHERE household_id=?1 ORDER BY transaction_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "MONTHLY_BUDGET_PLAN",
        "SELECT household_id,payload_json FROM sync_monthly_budget_plan_payloads
         WHERE household_id=?1",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "SAVINGS_GOAL",
        "SELECT id,json(json_object(
           'recordKind','SAVINGS_GOAL','id',id,'householdId',household_id,'name',name,
           'targetJpy',target_jpy,'savedJpy',saved_jpy,'targetDate',target_date,
           'status',status,'createdAt',created_at,'updatedAt',updated_at))
         FROM savings_goals WHERE household_id=?1 ORDER BY id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "CLASSIFICATION_RULE",
        "SELECT rule_id,payload_json FROM sync_classification_rule_payloads
         WHERE household_id=?1 ORDER BY rule_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "ACCOUNT_GROUP",
        "SELECT group_id,payload_json FROM sync_account_group_payloads
         WHERE household_id=?1 ORDER BY group_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "CARD_SETTLEMENT_MAPPING",
        "SELECT card_account_id,json(json_object(
           'recordKind','CARD_SETTLEMENT_MAPPING','householdId',household_id,
           'cardAccountId',card_account_id,'bankAccountId',bank_account_id,
           'createdAt',created_at,'updatedAt',updated_at))
         FROM card_settlement_bank_mappings WHERE household_id=?1 ORDER BY card_account_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "DASHBOARD_PREFERENCES",
        "SELECT household_id,json(json_object(
           'recordKind','DASHBOARD_PREFERENCES','householdId',household_id,
           'dashboardTemplate',dashboard_template,'theme',theme,'density',density,
           'createdAt',created_at,'updatedAt',updated_at))
         FROM dashboard_preferences WHERE household_id=?1",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "DELIMITED_PARSER_PROFILE",
        "SELECT profile_id,payload_json FROM sync_parser_profile_payloads
         WHERE household_id=?1 ORDER BY profile_id",
        household_id,
    )?;

    if records.len() > MAX_PACKAGE_RECORDS {
        return Err(ChangePackageError::LimitExceeded);
    }
    let identities = records
        .iter()
        .map(|record| (&record.entity_kind, &record.entity_id))
        .collect::<BTreeSet<_>>();
    if identities.len() != records.len() {
        return Err(ChangePackageError::Encoding);
    }
    let covered_kinds = COVERED_KINDS
        .iter()
        .map(|kind| (*kind).to_owned())
        .collect::<Vec<_>>();
    let mut counts_by_kind = covered_kinds
        .iter()
        .map(|kind| (kind.clone(), 0_u64))
        .collect::<BTreeMap<_, _>>();
    for record in &records {
        *counts_by_kind
            .get_mut(&record.entity_kind)
            .ok_or(ChangePackageError::Encoding)? += 1;
    }
    if counts_by_kind.get("HOUSEHOLD") != Some(&1)
        || counts_by_kind.get("MONTHLY_BUDGET_PLAN") != Some(&1)
    {
        return Err(ChangePackageError::Encoding);
    }
    let source_revision =
        u64::try_from(source_revision).map_err(|_| ChangePackageError::Encoding)?;
    let identity = SnapshotIdentity {
        schema_version: PACKAGE_SCHEMA_VERSION,
        mode: PACKAGE_MODE,
        source_installation_id: &status.device.id,
        source_principal_id: &status.principal.id,
        source_revision,
        household_id,
        created_at: &created_at,
        covered_kinds: &covered_kinds,
        counts_by_kind: &counts_by_kind,
        records: &records,
    };
    let identity_value =
        serde_json::to_value(&identity).map_err(|_| ChangePackageError::Encoding)?;
    let canonical_identity =
        canonical_json(&identity_value).map_err(|_| ChangePackageError::Encoding)?;
    let snapshot_sha256 = sha256_hex(canonical_identity.as_bytes());
    let package_id = format!("change-package-{snapshot_sha256}");
    let package_value = json!({
        "packageId": package_id,
        "schemaVersion": PACKAGE_SCHEMA_VERSION,
        "mode": PACKAGE_MODE,
        "sourceInstallationId": status.device.id,
        "sourcePrincipalId": status.principal.id,
        "sourceRevision": source_revision,
        "householdId": household_id,
        "createdAt": created_at,
        "coveredKinds": covered_kinds,
        "countsByKind": counts_by_kind,
        "snapshotSha256": snapshot_sha256,
        "records": records,
    });
    let canonical_package =
        canonical_json(&package_value).map_err(|_| ChangePackageError::Encoding)?;
    let package_sha256 = sha256_hex(canonical_package.as_bytes());
    transaction.commit()?;
    Ok(LocalChangePackageDto {
        package_id,
        schema_version: PACKAGE_SCHEMA_VERSION,
        mode: PACKAGE_MODE.to_owned(),
        source_installation_id: status.device.id,
        source_principal_id: status.principal.id,
        source_revision,
        household_id: household_id.to_owned(),
        created_at,
        covered_kinds,
        counts_by_kind,
        snapshot_sha256,
        package_sha256,
        records,
    })
}

pub fn encode_pretty(package: &LocalChangePackageDto) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(package).map_err(|_| ChangePackageError::Encoding)?;
    bytes.push(b'\n');
    Ok(bytes)
}

pub fn decode_and_validate(bytes: &[u8]) -> Result<LocalChangePackageDto> {
    let package: LocalChangePackageDto =
        serde_json::from_slice(bytes).map_err(|_| ChangePackageError::InvalidInput)?;
    validate_package(&package)?;
    Ok(package)
}

pub fn validate_package(package: &LocalChangePackageDto) -> Result<()> {
    if package.schema_version != PACKAGE_SCHEMA_VERSION
        || package.mode != PACKAGE_MODE
        || package.source_installation_id.is_empty()
        || package.source_installation_id.len() > 128
        || package.source_principal_id.is_empty()
        || package.source_principal_id.len() > 128
        || package.household_id.is_empty()
        || package.household_id.len() > 128
        || package.source_revision == 0
        || package.records.len() > MAX_PACKAGE_RECORDS
    {
        return Err(ChangePackageError::InvalidInput);
    }
    let expected_kinds = COVERED_KINDS
        .iter()
        .map(|kind| (*kind).to_owned())
        .collect::<Vec<_>>();
    if package.covered_kinds != expected_kinds
        || package.counts_by_kind.len() != COVERED_KINDS.len()
    {
        return Err(ChangePackageError::InvalidInput);
    }
    let mut actual_counts = COVERED_KINDS
        .iter()
        .map(|kind| ((*kind).to_owned(), 0_u64))
        .collect::<BTreeMap<_, _>>();
    let mut identities = BTreeSet::new();
    for record in &package.records {
        if record.operation != "UPSERT"
            || record.entity_id.is_empty()
            || record.entity_id.len() > 128
            || !actual_counts.contains_key(&record.entity_kind)
            || !identities.insert((record.entity_kind.as_str(), record.entity_id.as_str()))
        {
            return Err(ChangePackageError::InvalidInput);
        }
        let payload: Value = serde_json::from_str(&record.canonical_payload_json)
            .map_err(|_| ChangePackageError::InvalidInput)?;
        let canonical = canonical_json(&payload).map_err(|_| ChangePackageError::InvalidInput)?;
        if canonical != record.canonical_payload_json
            || sha256_hex(canonical.as_bytes()) != record.payload_sha256
            || !payload_identity_matches(record, &payload, &package.household_id)
        {
            return Err(ChangePackageError::InvalidInput);
        }
        *actual_counts
            .get_mut(&record.entity_kind)
            .ok_or(ChangePackageError::InvalidInput)? += 1;
    }
    if actual_counts != package.counts_by_kind
        || actual_counts.get("HOUSEHOLD") != Some(&1)
        || actual_counts.get("MONTHLY_BUDGET_PLAN") != Some(&1)
    {
        return Err(ChangePackageError::InvalidInput);
    }
    let identity = SnapshotIdentity {
        schema_version: package.schema_version,
        mode: &package.mode,
        source_installation_id: &package.source_installation_id,
        source_principal_id: &package.source_principal_id,
        source_revision: package.source_revision,
        household_id: &package.household_id,
        created_at: &package.created_at,
        covered_kinds: &package.covered_kinds,
        counts_by_kind: &package.counts_by_kind,
        records: &package.records,
    };
    let identity_value =
        serde_json::to_value(&identity).map_err(|_| ChangePackageError::Encoding)?;
    let canonical_identity =
        canonical_json(&identity_value).map_err(|_| ChangePackageError::Encoding)?;
    let snapshot_sha256 = sha256_hex(canonical_identity.as_bytes());
    if snapshot_sha256 != package.snapshot_sha256
        || package.package_id != format!("change-package-{snapshot_sha256}")
    {
        return Err(ChangePackageError::InvalidInput);
    }
    let package_value = json!({
        "packageId": package.package_id,
        "schemaVersion": package.schema_version,
        "mode": package.mode,
        "sourceInstallationId": package.source_installation_id,
        "sourcePrincipalId": package.source_principal_id,
        "sourceRevision": package.source_revision,
        "householdId": package.household_id,
        "createdAt": package.created_at,
        "coveredKinds": package.covered_kinds,
        "countsByKind": package.counts_by_kind,
        "snapshotSha256": package.snapshot_sha256,
        "records": package.records,
    });
    let canonical_package =
        canonical_json(&package_value).map_err(|_| ChangePackageError::Encoding)?;
    if sha256_hex(canonical_package.as_bytes()) != package.package_sha256 {
        return Err(ChangePackageError::InvalidInput);
    }
    Ok(())
}

pub fn stage_package(
    connection: &Connection,
    target_household_id: &str,
    bytes: &[u8],
) -> Result<ChangePackageReviewDto> {
    let package = decode_and_validate(bytes)?;
    if package.household_id != target_household_id {
        return Err(ChangePackageError::InvalidInput);
    }
    if let Some(existing) = load_package_by_id(connection, &package.package_id)? {
        let stored_hash: String = connection.query_row(
            "SELECT package_sha256 FROM change_packages WHERE package_id=?1",
            [&package.package_id],
            |row| row.get(0),
        )?;
        if stored_hash != package.package_sha256 {
            return Err(ChangePackageError::Conflict);
        }
        if existing.state != "REJECTED" {
            return Ok(existing);
        }
        connection.execute(
            "DELETE FROM change_packages WHERE package_id=?1 AND state='REJECTED'",
            [&package.package_id],
        )?;
    }
    let active: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM change_packages
         WHERE target_household_id=?1 AND state IN ('STAGED','REVIEW_REQUIRED','READY'))",
        [target_household_id],
        |row| row.get(0),
    )?;
    if active {
        return Err(ChangePackageError::ReviewPending);
    }

    let current = current_state_for_comparison(connection, target_household_id)?;
    if current.source_installation_id == package.source_installation_id {
        return Err(ChangePackageError::InvalidInput);
    }
    let latest_source: Option<(i64, String)> = connection
        .query_row(
            "SELECT source_revision,snapshot_sha256 FROM applied_change_packages
             WHERE household_id=?1 AND source_installation_id=?2
             ORDER BY source_revision DESC LIMIT 1",
            params![target_household_id, package.source_installation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((revision, digest)) = latest_source {
        let incoming =
            i64::try_from(package.source_revision).map_err(|_| ChangePackageError::InvalidInput)?;
        if incoming < revision {
            return Err(ChangePackageError::Stale);
        }
        if incoming == revision {
            return if digest == package.snapshot_sha256 {
                Err(ChangePackageError::Stale)
            } else {
                Err(ChangePackageError::Conflict)
            };
        }
    }

    let current_records = current
        .records
        .into_iter()
        .map(|record| {
            (
                (record.entity_kind.clone(), record.entity_id.clone()),
                record,
            )
        })
        .collect::<BTreeMap<_, _>>();
    let incoming_keys = package
        .records
        .iter()
        .map(|record| (record.entity_kind.clone(), record.entity_id.clone()))
        .collect::<BTreeSet<_>>();
    let heads = load_replica_heads(connection, target_household_id)?;
    let mut actions = Vec::new();
    for record in &package.records {
        if entity_belongs_to_other_household(
            connection,
            &record.entity_kind,
            &record.entity_id,
            target_household_id,
        )? {
            return Err(ChangePackageError::Conflict);
        }
        let key = (record.entity_kind.clone(), record.entity_id.clone());
        let current_record = current_records.get(&key);
        let head = heads.get(&key);
        let (review_state, resolution, current_hash, conflict_reason) = match current_record {
            None => ("CREATE", "APPLY_INCOMING", None, None),
            Some(current_record) if current_record.payload_sha256 == record.payload_sha256 => (
                "UNCHANGED",
                "SKIP",
                Some(current_record.payload_sha256.clone()),
                None,
            ),
            Some(current_record)
                if head.is_some_and(|head| {
                    head.source_installation_id == package.source_installation_id
                        && head.payload_sha256 == current_record.payload_sha256
                }) =>
            {
                (
                    "UPDATE",
                    "APPLY_INCOMING",
                    Some(current_record.payload_sha256.clone()),
                    None,
                )
            }
            Some(current_record) => (
                "CONFLICT",
                "PENDING",
                Some(current_record.payload_sha256.clone()),
                Some(if head.is_some() {
                    "LOCAL_DIVERGENCE"
                } else {
                    "SAME_ID_DIFFERENT_CONTENT"
                }),
            ),
        };
        actions.push(StagedAction {
            entity_kind: record.entity_kind.clone(),
            entity_id: record.entity_id.clone(),
            operation: "UPSERT".to_owned(),
            canonical_payload_json: record.canonical_payload_json.clone(),
            payload_sha256: record.payload_sha256.clone(),
            review_state: review_state.to_owned(),
            resolution: resolution.to_owned(),
            current_payload_sha256: current_hash,
            conflict_reason: conflict_reason.map(str::to_owned),
        });
    }
    for (key, current_record) in &current_records {
        if incoming_keys.contains(key) || !kind_supports_absence_delete(&key.0) {
            continue;
        }
        let head = heads.get(key);
        let (review_state, reason) = if head.is_some_and(|head| {
            head.source_installation_id == package.source_installation_id
                && head.payload_sha256 == current_record.payload_sha256
        }) {
            ("DELETE", None)
        } else if head.is_some() {
            ("CONFLICT", Some("LOCAL_DIVERGENCE"))
        } else {
            ("DELETE", None)
        };
        actions.push(StagedAction {
            entity_kind: key.0.clone(),
            entity_id: key.1.clone(),
            operation: "DELETE".to_owned(),
            canonical_payload_json: current_record.canonical_payload_json.clone(),
            payload_sha256: current_record.payload_sha256.clone(),
            review_state: review_state.to_owned(),
            resolution: "PENDING".to_owned(),
            current_payload_sha256: Some(current_record.payload_sha256.clone()),
            conflict_reason: reason.map(str::to_owned),
        });
    }
    actions.sort_by(|left, right| {
        dependency_rank(&left.entity_kind)
            .cmp(&dependency_rank(&right.entity_kind))
            .then_with(|| left.entity_id.cmp(&right.entity_id))
            .then_with(|| left.operation.cmp(&right.operation))
    });
    if actions.len() > MAX_PACKAGE_RECORDS {
        return Err(ChangePackageError::LimitExceeded);
    }

    let counts = ActionCounts::from_actions(&actions);
    let state = if counts.conflict_count > 0 || counts.delete_count > 0 {
        "REVIEW_REQUIRED"
    } else {
        "READY"
    };
    let reviewed_at = (state == "READY").then_some("strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    let manifest = serde_json::to_value(&package).map_err(|_| ChangePackageError::Encoding)?;
    let manifest_json = canonical_json(&manifest).map_err(|_| ChangePackageError::Encoding)?;
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        &format!(
            "INSERT INTO change_packages(
               package_id,schema_version,target_household_id,source_installation_id,
               source_principal_id,source_revision,snapshot_sha256,manifest_json,package_sha256,
               state,record_count,create_count,update_count,unchanged_count,delete_count,
               conflict_count,source_created_at,reviewed_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,{})",
            reviewed_at.unwrap_or("NULL")
        ),
        params![
            package.package_id,
            package.schema_version,
            target_household_id,
            package.source_installation_id,
            package.source_principal_id,
            package.source_revision,
            package.snapshot_sha256,
            manifest_json,
            package.package_sha256,
            state,
            counts.total(),
            counts.create_count,
            counts.update_count,
            counts.unchanged_count,
            counts.delete_count,
            counts.conflict_count,
            package.created_at,
        ],
    )?;
    for (index, action) in actions.iter().enumerate() {
        transaction.execute(
            "INSERT INTO change_package_records(
               package_id,record_order,entity_kind,entity_id,operation,
               canonical_payload_json,payload_sha256,review_state,resolution,
               current_payload_sha256,conflict_reason)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                package.package_id,
                i64::try_from(index).map_err(|_| ChangePackageError::LimitExceeded)?,
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
    load_package_by_id(connection, &package.package_id)?.ok_or(ChangePackageError::NotFound)
}

pub fn resolve_package(
    connection: &Connection,
    package_id: &str,
    resolutions: &[ChangePackageResolutionInput],
) -> Result<ChangePackageReviewDto> {
    if resolutions.is_empty() {
        return Err(ChangePackageError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    let state: String = transaction
        .query_row(
            "SELECT state FROM change_packages WHERE package_id=?1",
            [package_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(ChangePackageError::NotFound)?;
    if !matches!(state.as_str(), "STAGED" | "REVIEW_REQUIRED") {
        return Err(ChangePackageError::InvalidInput);
    }
    let mut seen = BTreeSet::new();
    for resolution in resolutions {
        if !matches!(
            resolution.resolution.as_str(),
            "APPLY_INCOMING" | "KEEP_LOCAL"
        ) || !seen.insert((&resolution.entity_kind, &resolution.entity_id))
        {
            return Err(ChangePackageError::InvalidInput);
        }
        let changed = transaction.execute(
            "UPDATE change_package_records SET resolution=?1
             WHERE package_id=?2 AND entity_kind=?3 AND entity_id=?4
               AND review_state IN ('DELETE','CONFLICT') AND resolution='PENDING'",
            params![
                resolution.resolution,
                package_id,
                resolution.entity_kind,
                resolution.entity_id
            ],
        )?;
        if changed != 1 {
            return Err(ChangePackageError::InvalidInput);
        }
    }
    let pending: i64 = transaction.query_row(
        "SELECT count(*) FROM change_package_records
         WHERE package_id=?1 AND resolution='PENDING'",
        [package_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        "UPDATE change_packages SET state=?1,
           reviewed_at=CASE WHEN ?1='READY' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE reviewed_at END,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE package_id=?2",
        params![if pending == 0 { "READY" } else { "REVIEW_REQUIRED" }, package_id],
    )?;
    transaction.commit()?;
    load_package_by_id(connection, package_id)?.ok_or(ChangePackageError::NotFound)
}

pub fn discard_package(connection: &Connection, package_id: &str) -> Result<()> {
    let affected = connection.execute(
        "UPDATE change_packages SET state='REJECTED',
           reviewed_at=COALESCE(reviewed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE package_id=?1 AND state IN ('STAGED','REVIEW_REQUIRED','READY')",
        [package_id],
    )?;
    if affected == 1 {
        Ok(())
    } else {
        Err(ChangePackageError::NotFound)
    }
}

pub fn get_active_review(
    connection: &Connection,
    household_id: &str,
) -> Result<Option<ChangePackageReviewDto>> {
    let package_id = connection
        .query_row(
            "SELECT package_id FROM change_packages
             WHERE target_household_id=?1 AND state IN ('STAGED','REVIEW_REQUIRED','READY')
             ORDER BY staged_at DESC LIMIT 1",
            [household_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    package_id
        .map(|package_id| load_package_by_id(connection, &package_id))
        .transpose()
        .map(Option::flatten)
}

pub fn apply_package(connection: &Connection, package_id: &str) -> Result<ChangePackageReviewDto> {
    let review = load_package_by_id(connection, package_id)?.ok_or(ChangePackageError::NotFound)?;
    if review.state == "APPLIED" {
        return Ok(review);
    }
    if review.state != "READY"
        || review
            .records
            .iter()
            .any(|record| record.resolution == "PENDING")
    {
        return Err(ChangePackageError::ReviewPending);
    }

    let manifest_json: String = connection.query_row(
        "SELECT manifest_json FROM change_packages WHERE package_id=?1",
        [package_id],
        |row| row.get(0),
    )?;
    let package: LocalChangePackageDto =
        serde_json::from_str(&manifest_json).map_err(|_| ChangePackageError::Encoding)?;
    validate_package(&package)?;

    // Re-read the destination immediately before opening the write transaction.
    // Production calls serialize access through AppState's connection mutex.
    let current = current_state_for_comparison(connection, &review.target_household_id)?;
    let current_hashes = current
        .records
        .into_iter()
        .map(|record| {
            (
                (record.entity_kind, record.entity_id),
                record.payload_sha256,
            )
        })
        .collect::<BTreeMap<_, _>>();
    for record in &review.records {
        if record.resolution == "KEEP_LOCAL" {
            continue;
        }
        let current_hash =
            current_hashes.get(&(record.entity_kind.clone(), record.entity_id.clone()));
        if current_hash != record.current_payload_sha256.as_ref() {
            return Err(ChangePackageError::Conflict);
        }
    }

    let transaction = connection.unchecked_transaction()?;
    let already_applied: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM applied_change_packages WHERE package_id=?1)",
        [package_id],
        |row| row.get(0),
    )?;
    if already_applied {
        transaction.commit()?;
        return load_package_by_id(connection, package_id)?.ok_or(ChangePackageError::NotFound);
    }
    transaction.execute(
        "INSERT INTO sync_apply_guard(household_id,package_id) VALUES(?1,?2)",
        params![review.target_household_id, package_id],
    )?;

    for record in review
        .records
        .iter()
        .filter(|record| record.resolution == "APPLY_INCOMING" && record.operation == "UPSERT")
    {
        materialize_upsert(
            &transaction,
            &record.entity_kind,
            &record.canonical_payload_json,
        )?;
    }
    for record in review
        .records
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

    for record in review
        .records
        .iter()
        .filter(|record| record.resolution == "APPLY_INCOMING")
    {
        let actual = load_entity_payload(
            &transaction,
            &review.target_household_id,
            &record.entity_kind,
            &record.entity_id,
        )?;
        match record.operation.as_str() {
            "UPSERT" => {
                let actual = actual.ok_or(ChangePackageError::Conflict)?;
                let value: Value =
                    serde_json::from_str(&actual).map_err(|_| ChangePackageError::Encoding)?;
                let canonical = canonical_json(&value).map_err(|_| ChangePackageError::Encoding)?;
                if sha256_hex(canonical.as_bytes()) != record.payload_sha256 {
                    return Err(ChangePackageError::Conflict);
                }
            }
            "DELETE" if actual.is_some() => return Err(ChangePackageError::Conflict),
            "DELETE" => {}
            _ => return Err(ChangePackageError::InvalidInput),
        }
    }

    for record in &review.records {
        if matches!(record.resolution.as_str(), "APPLY_INCOMING" | "SKIP") {
            transaction.execute(
                "INSERT INTO sync_replica_entity_heads(
                   household_id,entity_kind,entity_id,source_installation_id,
                   package_id,source_revision,operation,payload_sha256)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
                 ON CONFLICT(household_id,entity_kind,entity_id) DO UPDATE SET
                   source_installation_id=excluded.source_installation_id,
                   package_id=excluded.package_id,
                   source_revision=excluded.source_revision,operation=excluded.operation,
                   payload_sha256=excluded.payload_sha256,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                params![
                    review.target_household_id,
                    record.entity_kind,
                    record.entity_id,
                    review.source_installation_id,
                    package_id,
                    review.source_revision,
                    record.operation,
                    record.payload_sha256,
                ],
            )?;
        }
    }
    transaction.execute(
        "INSERT INTO applied_change_packages(
           package_id,household_id,source_installation_id,source_revision,snapshot_sha256)
         VALUES(?1,?2,?3,?4,?5)",
        params![
            package_id,
            review.target_household_id,
            review.source_installation_id,
            review.source_revision,
            package.snapshot_sha256,
        ],
    )?;
    let guard_removed = transaction.execute(
        "DELETE FROM sync_apply_guard WHERE household_id=?1 AND package_id=?2",
        params![review.target_household_id, package_id],
    )?;
    if guard_removed != 1 {
        return Err(ChangePackageError::Conflict);
    }
    transaction.execute(
        "UPDATE change_packages SET state='APPLIED',
           applied_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE package_id=?1",
        [package_id],
    )?;
    transaction.commit()?;
    load_package_by_id(connection, package_id)?.ok_or(ChangePackageError::NotFound)
}

fn materialize_upsert(connection: &Connection, kind: &str, payload: &str) -> Result<()> {
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
        "MONTHLY_BUDGET_PLAN" => {
            connection.execute(
                "DELETE FROM monthly_category_budgets WHERE household_id=json_extract(?1,'$.householdId')",
                [payload],
            )?;
            connection.execute(
                "INSERT INTO monthly_category_budgets(
                   household_id,month,category_account_id,budget_jpy,created_at,updated_at)
                 SELECT json_extract(value,'$.householdId'),json_extract(value,'$.month'),
                   json_extract(value,'$.categoryAccountId'),json_extract(value,'$.budgetJpy'),
                   json_extract(value,'$.createdAt'),json_extract(value,'$.updatedAt')
                 FROM json_each(?1,'$.budgets')",
                [payload],
            )?;
        }
        "SAVINGS_GOAL" => {
            connection.execute(
            "INSERT INTO savings_goals(
               id,household_id,name,target_jpy,saved_jpy,target_date,status,created_at,updated_at)
             VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
               json_extract(?1,'$.name'),json_extract(?1,'$.targetJpy'),
               json_extract(?1,'$.savedJpy'),json_extract(?1,'$.targetDate'),
               json_extract(?1,'$.status'),json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,target_jpy=excluded.target_jpy,
               saved_jpy=excluded.saved_jpy,target_date=excluded.target_date,status=excluded.status,
               created_at=excluded.created_at,updated_at=excluded.updated_at",
            [payload],
            )?;
        }
        "CLASSIFICATION_RULE" => materialize_rule(connection, payload)?,
        "ACCOUNT_GROUP" => materialize_group(connection, payload)?,
        "CARD_SETTLEMENT_MAPPING" => {
            connection.execute(
                "INSERT INTO card_settlement_bank_mappings(
               household_id,card_account_id,bank_account_id,created_at,updated_at)
             VALUES(json_extract(?1,'$.householdId'),json_extract(?1,'$.cardAccountId'),
               json_extract(?1,'$.bankAccountId'),json_extract(?1,'$.createdAt'),
               json_extract(?1,'$.updatedAt'))
             ON CONFLICT(household_id,card_account_id) DO UPDATE SET
               bank_account_id=excluded.bank_account_id,created_at=excluded.created_at,
               updated_at=excluded.updated_at",
                [payload],
            )?;
        }
        "DASHBOARD_PREFERENCES" => {
            connection.execute(
                "INSERT INTO dashboard_preferences(
               household_id,dashboard_template,theme,density,created_at,updated_at)
             VALUES(json_extract(?1,'$.householdId'),json_extract(?1,'$.dashboardTemplate'),
               json_extract(?1,'$.theme'),json_extract(?1,'$.density'),
               json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
             ON CONFLICT(household_id) DO UPDATE SET dashboard_template=excluded.dashboard_template,
               theme=excluded.theme,density=excluded.density,created_at=excluded.created_at,
               updated_at=excluded.updated_at",
                [payload],
            )?;
        }
        "DELIMITED_PARSER_PROFILE" => materialize_parser_profile(connection, payload)?,
        _ => return Err(ChangePackageError::InvalidInput),
    };
    Ok(())
}

fn materialize_transaction(connection: &Connection, payload: &str) -> Result<()> {
    let unrepresented_actual_links: i64 = connection.query_row(
        "SELECT count(*) FROM transaction_sources actual
         WHERE actual.transaction_id=json_extract(?1,'$.id')
           AND NOT EXISTS (
             SELECT 1 FROM json_each(?1,'$.sourceLinks') incoming
             WHERE json_extract(incoming.value,'$.sourceRecordId')=actual.source_record_id
           )",
        [payload],
        |row| row.get(0),
    )?;
    if unrepresented_actual_links != 0 {
        return Err(ChangePackageError::Conflict);
    }
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
         ON CONFLICT(id) DO UPDATE SET occurred_on=excluded.occurred_on,posted_on=excluded.posted_on,
           transaction_type=excluded.transaction_type,payee=excluded.payee,
           description=excluded.description,status=excluded.status,
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
        "transaction_portable_source_links",
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
        "INSERT INTO transaction_portable_source_links(transaction_id,source_record_id,candidate_id)
         SELECT json_extract(value,'$.transactionId'),json_extract(value,'$.sourceRecordId'),
           json_extract(value,'$.candidateId') FROM json_each(?1,'$.sourceLinks')",
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

fn materialize_rule(connection: &Connection, payload: &str) -> Result<()> {
    connection.execute(
        "INSERT INTO classification_rules(
           id,household_id,name,priority,is_enabled,merchant_contains,description_contains,
           category_account_id,created_at,updated_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),json_extract(?1,'$.name'),
           json_extract(?1,'$.priority'),json_extract(?1,'$.isEnabled'),
           json_extract(?1,'$.merchantContains'),json_extract(?1,'$.descriptionContains'),
           json_extract(?1,'$.categoryAccountId'),json_extract(?1,'$.createdAt'),
           json_extract(?1,'$.updatedAt'))
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,priority=excluded.priority,
           is_enabled=excluded.is_enabled,merchant_contains=excluded.merchant_contains,
           description_contains=excluded.description_contains,category_account_id=excluded.category_account_id,
           created_at=excluded.created_at,updated_at=excluded.updated_at",
        [payload],
    )?;
    connection.execute(
        "DELETE FROM classification_rule_labels WHERE rule_id=json_extract(?1,'$.id')",
        [payload],
    )?;
    connection.execute(
        "DELETE FROM classification_rule_tags WHERE rule_id=json_extract(?1,'$.id')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO classification_rule_labels(rule_id,label)
         SELECT json_extract(?1,'$.id'),value FROM json_each(?1,'$.labels')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO classification_rule_tags(rule_id,tag)
         SELECT json_extract(?1,'$.id'),value FROM json_each(?1,'$.tags')",
        [payload],
    )?;
    Ok(())
}

fn materialize_group(connection: &Connection, payload: &str) -> Result<()> {
    connection.execute(
        "INSERT INTO account_groups(id,household_id,name,group_kind,sort_order,created_at,updated_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),json_extract(?1,'$.name'),
           json_extract(?1,'$.groupKind'),json_extract(?1,'$.sortOrder'),
           json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,group_kind=excluded.group_kind,
           sort_order=excluded.sort_order,created_at=excluded.created_at,updated_at=excluded.updated_at",
        [payload],
    )?;
    connection.execute(
        "DELETE FROM account_group_members WHERE account_group_id=json_extract(?1,'$.id')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO account_group_members(household_id,account_group_id,account_id,sort_order)
         SELECT json_extract(value,'$.householdId'),json_extract(value,'$.accountGroupId'),
           json_extract(value,'$.accountId'),json_extract(value,'$.sortOrder')
         FROM json_each(?1,'$.members')",
        [payload],
    )?;
    Ok(())
}

fn materialize_parser_profile(connection: &Connection, payload: &str) -> Result<()> {
    connection.execute(
        "INSERT INTO delimited_parser_profiles(
           id,household_id,name,delimiter,encoding,header_row,date_column,date_format,
           description_column,payee_column,amount_mode,signed_positive_direction,
           signed_amount_column,debit_column,credit_column,external_id_column,
           account_hint_column,is_enabled,priority,version,created_at,updated_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),json_extract(?1,'$.name'),
           json_extract(?1,'$.delimiter'),json_extract(?1,'$.encoding'),json_extract(?1,'$.headerRow'),
           json_extract(?1,'$.dateColumn'),json_extract(?1,'$.dateFormat'),
           json_extract(?1,'$.descriptionColumn'),json_extract(?1,'$.payeeColumn'),
           json_extract(?1,'$.amountMode'),json_extract(?1,'$.signedPositiveDirection'),
           json_extract(?1,'$.signedAmountColumn'),json_extract(?1,'$.debitColumn'),
           json_extract(?1,'$.creditColumn'),json_extract(?1,'$.externalIdColumn'),
           json_extract(?1,'$.accountHintColumn'),json_extract(?1,'$.isEnabled'),
           json_extract(?1,'$.priority'),json_extract(?1,'$.version'),
           json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,delimiter=excluded.delimiter,
           encoding=excluded.encoding,header_row=excluded.header_row,date_column=excluded.date_column,
           date_format=excluded.date_format,description_column=excluded.description_column,
           payee_column=excluded.payee_column,amount_mode=excluded.amount_mode,
           signed_positive_direction=excluded.signed_positive_direction,
           signed_amount_column=excluded.signed_amount_column,debit_column=excluded.debit_column,
           credit_column=excluded.credit_column,external_id_column=excluded.external_id_column,
           account_hint_column=excluded.account_hint_column,is_enabled=excluded.is_enabled,
           priority=excluded.priority,version=excluded.version,created_at=excluded.created_at,
           updated_at=excluded.updated_at",
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
    let (table, key) = match kind {
        "ACCOUNT" => ("accounts", "id"),
        "TRANSACTION" => ("transactions", "id"),
        "SAVINGS_GOAL" => ("savings_goals", "id"),
        "CLASSIFICATION_RULE" => ("classification_rules", "id"),
        "ACCOUNT_GROUP" => ("account_groups", "id"),
        "CARD_SETTLEMENT_MAPPING" => ("card_settlement_bank_mappings", "card_account_id"),
        "DASHBOARD_PREFERENCES" => ("dashboard_preferences", "household_id"),
        "DELIMITED_PARSER_PROFILE" => ("delimited_parser_profiles", "id"),
        _ => return Err(ChangePackageError::InvalidInput),
    };
    let affected = connection.execute(
        &format!("DELETE FROM {table} WHERE {key}=?1 AND household_id=?2"),
        params![entity_id, household_id],
    )?;
    if affected > 1 {
        return Err(ChangePackageError::Conflict);
    }
    Ok(())
}

fn entity_belongs_to_other_household(
    connection: &Connection,
    kind: &str,
    entity_id: &str,
    household_id: &str,
) -> Result<bool> {
    let table = match kind {
        "HOUSEHOLD_MEMBER" => "household_members",
        "ACCOUNT" => "accounts",
        "TRANSACTION" => "transactions",
        "SAVINGS_GOAL" => "savings_goals",
        "CLASSIFICATION_RULE" => "classification_rules",
        "ACCOUNT_GROUP" => "account_groups",
        "DELIMITED_PARSER_PROFILE" => "delimited_parser_profiles",
        _ => return Ok(false),
    };
    connection
        .query_row(
            &format!("SELECT household_id!=?2 FROM {table} WHERE id=?1"),
            params![entity_id, household_id],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(ChangePackageError::from)
}

fn load_entity_payload(
    connection: &Connection,
    household_id: &str,
    kind: &str,
    entity_id: &str,
) -> Result<Option<String>> {
    let sql = match kind {
        "HOUSEHOLD" => {
            "SELECT json(json_object(
          'recordKind','HOUSEHOLD','id',id,'name',name,'baseCurrency',base_currency,
          'createdAt',created_at,'updatedAt',updated_at))
          FROM households WHERE id=?2 AND id=?1"
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
        "MONTHLY_BUDGET_PLAN" => {
            "SELECT payload_json FROM sync_monthly_budget_plan_payloads
          WHERE household_id=?1 AND household_id=?2"
        }
        "SAVINGS_GOAL" => {
            "SELECT json(json_object(
          'recordKind','SAVINGS_GOAL','id',id,'householdId',household_id,'name',name,
          'targetJpy',target_jpy,'savedJpy',saved_jpy,'targetDate',target_date,
          'status',status,'createdAt',created_at,'updatedAt',updated_at))
          FROM savings_goals WHERE household_id=?1 AND id=?2"
        }
        "CLASSIFICATION_RULE" => {
            "SELECT payload_json FROM sync_classification_rule_payloads
          WHERE household_id=?1 AND rule_id=?2"
        }
        "ACCOUNT_GROUP" => {
            "SELECT payload_json FROM sync_account_group_payloads
          WHERE household_id=?1 AND group_id=?2"
        }
        "CARD_SETTLEMENT_MAPPING" => {
            "SELECT json(json_object(
          'recordKind','CARD_SETTLEMENT_MAPPING','householdId',household_id,
          'cardAccountId',card_account_id,'bankAccountId',bank_account_id,
          'createdAt',created_at,'updatedAt',updated_at))
          FROM card_settlement_bank_mappings WHERE household_id=?1 AND card_account_id=?2"
        }
        "DASHBOARD_PREFERENCES" => {
            "SELECT json(json_object(
          'recordKind','DASHBOARD_PREFERENCES','householdId',household_id,
          'dashboardTemplate',dashboard_template,'theme',theme,'density',density,
          'createdAt',created_at,'updatedAt',updated_at))
          FROM dashboard_preferences WHERE household_id=?1 AND household_id=?2"
        }
        "DELIMITED_PARSER_PROFILE" => {
            "SELECT payload_json FROM sync_parser_profile_payloads
          WHERE household_id=?1 AND profile_id=?2"
        }
        _ => return Err(ChangePackageError::InvalidInput),
    };
    let parameters = if kind == "HOUSEHOLD" {
        params![entity_id, household_id]
    } else {
        params![household_id, entity_id]
    };
    connection
        .query_row(sql, parameters, |row| row.get(0))
        .optional()
        .map_err(ChangePackageError::from)
}

#[derive(Debug)]
struct StagedAction {
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

#[derive(Debug, Clone)]
struct ReplicaHead {
    source_installation_id: String,
    payload_sha256: String,
}

#[derive(Default)]
struct ActionCounts {
    create_count: u64,
    update_count: u64,
    unchanged_count: u64,
    delete_count: u64,
    conflict_count: u64,
}

impl ActionCounts {
    fn from_actions(actions: &[StagedAction]) -> Self {
        let mut counts = Self::default();
        for action in actions {
            match action.review_state.as_str() {
                "CREATE" => counts.create_count += 1,
                "UPDATE" => counts.update_count += 1,
                "UNCHANGED" => counts.unchanged_count += 1,
                "DELETE" => counts.delete_count += 1,
                "CONFLICT" => counts.conflict_count += 1,
                _ => {}
            }
        }
        counts
    }

    fn total(&self) -> u64 {
        self.create_count
            + self.update_count
            + self.unchanged_count
            + self.delete_count
            + self.conflict_count
    }
}

fn load_replica_heads(
    connection: &Connection,
    household_id: &str,
) -> Result<BTreeMap<(String, String), ReplicaHead>> {
    let mut statement = connection.prepare(
        "SELECT entity_kind,entity_id,source_installation_id,payload_sha256
         FROM sync_replica_entity_heads WHERE household_id=?1",
    )?;
    let rows = statement.query_map([household_id], |row| {
        Ok((
            (row.get::<_, String>(0)?, row.get::<_, String>(1)?),
            ReplicaHead {
                source_installation_id: row.get(2)?,
                payload_sha256: row.get(3)?,
            },
        ))
    })?;
    Ok(rows.collect::<std::result::Result<BTreeMap<_, _>, _>>()?)
}

fn load_package_by_id(
    connection: &Connection,
    package_id: &str,
) -> Result<Option<ChangePackageReviewDto>> {
    let header = connection
        .query_row(
            "SELECT package_id,target_household_id,source_installation_id,source_revision,
                    source_created_at,state,record_count,create_count,update_count,
                    unchanged_count,delete_count,conflict_count
             FROM change_packages WHERE package_id=?1",
            [package_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, i64>(11)?,
                ))
            },
        )
        .optional()?;
    let Some(header) = header else {
        return Ok(None);
    };
    let mut statement = connection.prepare(
        "SELECT record_order,entity_kind,entity_id,operation,canonical_payload_json,
                payload_sha256,review_state,resolution,current_payload_sha256,conflict_reason
         FROM change_package_records WHERE package_id=?1 ORDER BY record_order",
    )?;
    let rows = statement.query_map([package_id], |row| {
        Ok(ChangePackageRecordReviewDto {
            record_order: u64::try_from(row.get::<_, i64>(0)?).unwrap_or(0),
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
    let records = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(Some(ChangePackageReviewDto {
        package_id: header.0,
        target_household_id: header.1,
        source_installation_id: header.2,
        source_revision: u64::try_from(header.3).map_err(|_| ChangePackageError::Encoding)?,
        source_created_at: header.4,
        state: header.5,
        record_count: as_u64(header.6)?,
        create_count: as_u64(header.7)?,
        update_count: as_u64(header.8)?,
        unchanged_count: as_u64(header.9)?,
        delete_count: as_u64(header.10)?,
        conflict_count: as_u64(header.11)?,
        records,
    }))
}

fn as_u64(value: i64) -> Result<u64> {
    u64::try_from(value).map_err(|_| ChangePackageError::Encoding)
}

fn kind_supports_absence_delete(kind: &str) -> bool {
    matches!(
        kind,
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

fn dependency_rank(kind: &str) -> u8 {
    match kind {
        "HOUSEHOLD" => 0,
        "HOUSEHOLD_MEMBER" => 1,
        "ACCOUNT" => 2,
        "SAVINGS_GOAL" | "DASHBOARD_PREFERENCES" | "DELIMITED_PARSER_PROFILE" => 3,
        "MONTHLY_BUDGET_PLAN"
        | "CLASSIFICATION_RULE"
        | "ACCOUNT_GROUP"
        | "CARD_SETTLEMENT_MAPPING" => 4,
        "TRANSACTION" => 5,
        _ => u8::MAX,
    }
}

fn payload_identity_matches(
    record: &ChangePackageRecordDto,
    payload: &Value,
    household_id: &str,
) -> bool {
    let string = |key: &str| payload.get(key).and_then(Value::as_str);
    let expected_record_kind = if record.entity_kind == "TRANSACTION" {
        "TRANSACTION_AGGREGATE"
    } else {
        record.entity_kind.as_str()
    };
    if string("recordKind") != Some(expected_record_kind) {
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

fn push_query_records(
    connection: &Connection,
    output: &mut Vec<ChangePackageRecordDto>,
    entity_kind: &str,
    sql: &str,
    household_id: &str,
) -> Result<()> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map([household_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (entity_id, payload_json) = row?;
        let value: Value =
            serde_json::from_str(&payload_json).map_err(|_| ChangePackageError::Encoding)?;
        let canonical_payload_json =
            canonical_json(&value).map_err(|_| ChangePackageError::Encoding)?;
        output.push(ChangePackageRecordDto {
            entity_kind: entity_kind.to_owned(),
            entity_id,
            operation: "UPSERT".to_owned(),
            payload_sha256: sha256_hex(canonical_payload_json.as_bytes()),
            canonical_payload_json,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    const TEST_KEY: &[u8] = b"change-package-test-key-material-32bytes";

    fn seed_complete_household(connection: &Connection) {
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('family','Source family');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('bank','family','Bank','ASSET','BANK'),
                       ('card','family','Card','LIABILITY','CREDIT_CARD'),
                       ('food','family','Food','EXPENSE','OTHER');
                 INSERT INTO transactions(
                   id,household_id,occurred_on,transaction_type,payee,status)
                 VALUES('tx','family','2026-07-13','CARD_PURCHASE','Market','POSTED');
                 INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                 VALUES('tx-d','tx','food','DEBIT',1200,1),('tx-c','tx','card','CREDIT',1200,2);
                 INSERT INTO transaction_labels VALUES('tx','Reviewed');
                 INSERT INTO transaction_tags VALUES('tx','weekly');
                 INSERT INTO transaction_portable_source_links VALUES('tx','source-row-1','candidate-1');
                 INSERT INTO monthly_category_budgets(household_id,month,category_account_id,budget_jpy)
                 VALUES('family','2026-07','food',50000);
                 INSERT INTO savings_goals(id,household_id,name,target_jpy,saved_jpy,target_date,status)
                 VALUES('goal','family','Emergency',500000,100000,'2027-07-01','ACTIVE');
                 INSERT INTO classification_rules(
                   id,household_id,name,priority,is_enabled,merchant_contains,category_account_id)
                 VALUES('rule','family','Market',10,1,'MARKET','food');
                 INSERT INTO classification_rule_labels VALUES('rule','Recurring');
                 INSERT INTO classification_rule_tags VALUES('rule','family');
                 INSERT INTO account_groups(id,household_id,name,group_kind,sort_order)
                 VALUES('group','family','Daily','DAILY_SPENDING',0);
                 INSERT INTO account_group_members(household_id,account_group_id,account_id,sort_order)
                 VALUES('family','group','bank',0);
                 INSERT INTO card_settlement_bank_mappings(household_id,card_account_id,bank_account_id)
                 VALUES('family','card','bank');
                 INSERT INTO dashboard_preferences(household_id,dashboard_template,theme,density)
                 VALUES('family','CASH_FLOW','DARK','COMPACT');
                 INSERT INTO delimited_parser_profiles(
                   id,household_id,name,delimiter,encoding,header_row,date_column,date_format,
                   description_column,amount_mode,signed_positive_direction,signed_amount_column,
                   is_enabled,priority,version)
                 VALUES('profile','family','Bank CSV','COMMA','CP932',1,'Date','YYYY_MM_DD',
                   'Description','SIGNED','OUT','Amount',1,10,1);",
            )
            .unwrap();
    }

    #[test]
    fn complete_package_round_trips_all_covered_aggregates_without_echo() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        assert_eq!(package.covered_kinds, COVERED_KINDS);
        assert!(COVERED_KINDS
            .iter()
            .all(|kind| package.counts_by_kind.contains_key(*kind)));
        let bytes = encode_pretty(&package).unwrap();

        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Destination')",
                    [],
                )?;
                let destination_revision_before = export_current_state(connection, "family")
                    .unwrap()
                    .source_revision;
                let mut review = stage_package(connection, "family", &bytes).unwrap();
                let resolutions = review
                    .records
                    .iter()
                    .filter(|record| record.resolution == "PENDING")
                    .map(|record| ChangePackageResolutionInput {
                        entity_kind: record.entity_kind.clone(),
                        entity_id: record.entity_id.clone(),
                        resolution: "APPLY_INCOMING".to_owned(),
                    })
                    .collect::<Vec<_>>();
                if !resolutions.is_empty() {
                    review = resolve_package(connection, &review.package_id, &resolutions).unwrap();
                }
                assert_eq!(review.state, "READY");
                let capture_before: i64 = connection.query_row(
                    "SELECT count(*) FROM sync_local_change_capture",
                    [],
                    |row| row.get(0),
                )?;
                let applied = apply_package(connection, &review.package_id).unwrap();
                assert_eq!(applied.state, "APPLIED");
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM sync_local_change_capture",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    capture_before
                );
                let destination_package = export_current_state(connection, "family").unwrap();
                assert!(destination_package.source_revision > destination_revision_before);
                let source_hashes = package
                    .records
                    .iter()
                    .map(|record| {
                        (
                            (record.entity_kind.clone(), record.entity_id.clone()),
                            record.payload_sha256.clone(),
                        )
                    })
                    .collect::<BTreeMap<_, _>>();
                let destination_hashes = destination_package
                    .records
                    .iter()
                    .map(|record| {
                        (
                            (record.entity_kind.clone(), record.entity_id.clone()),
                            record.payload_sha256.clone(),
                        )
                    })
                    .collect::<BTreeMap<_, _>>();
                assert_eq!(destination_hashes, source_hashes);
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM transaction_portable_source_links
                         WHERE transaction_id='tx' AND source_record_id='source-row-1'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    1
                );
                assert_eq!(
                    apply_package(connection, &review.package_id).unwrap().state,
                    "APPLIED"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn tampering_and_post_stage_destination_edits_are_rejected() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        let mut tampered = package.clone();
        tampered.records[0].canonical_payload_json.push(' ');
        assert!(matches!(
            validate_package(&tampered),
            Err(ChangePackageError::InvalidInput)
        ));

        let bytes = encode_pretty(&package).unwrap();
        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Destination')",
                    [],
                )?;
                let review = stage_package(connection, "family", &bytes).unwrap();
                let resolutions = review
                    .records
                    .iter()
                    .filter(|record| record.resolution == "PENDING")
                    .map(|record| ChangePackageResolutionInput {
                        entity_kind: record.entity_kind.clone(),
                        entity_id: record.entity_id.clone(),
                        resolution: "APPLY_INCOMING".to_owned(),
                    })
                    .collect::<Vec<_>>();
                let ready = resolve_package(connection, &review.package_id, &resolutions).unwrap();
                connection.execute(
                    "UPDATE households SET name='Edited after review' WHERE id='family'",
                    [],
                )?;
                assert!(matches!(
                    apply_package(connection, &ready.package_id),
                    Err(ChangePackageError::Conflict)
                ));
                assert_eq!(
                    connection.query_row(
                        "SELECT state FROM change_packages WHERE package_id=?1",
                        [&ready.package_id],
                        |row| row.get::<_, String>(0)
                    )?,
                    "READY"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn failed_dependency_delete_rolls_back_the_whole_package() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Incoming')",
                    [],
                )?;
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        let bytes = encode_pretty(&package).unwrap();
        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination.with_connection(|connection| {
            connection.execute_batch(
                "INSERT INTO households(id,name) VALUES('family','Before apply');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('asset','family','Asset','ASSET','BANK'),
                       ('expense','family','Expense','EXPENSE','OTHER');
                 INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status)
                 VALUES('local-tx','family','2026-07-13','EXPENSE','POSTED');
                 INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                 VALUES('local-d','local-tx','expense','DEBIT',500,1),
                       ('local-c','local-tx','asset','CREDIT',500,2);",
            )?;
            let review = stage_package(connection, "family", &bytes).unwrap();
            let resolutions = review.records.iter().filter(|record| record.resolution == "PENDING")
                .map(|record| ChangePackageResolutionInput {
                    entity_kind: record.entity_kind.clone(), entity_id: record.entity_id.clone(),
                    resolution: if record.entity_kind == "TRANSACTION" { "KEEP_LOCAL" } else { "APPLY_INCOMING" }.to_owned(),
                }).collect::<Vec<_>>();
            let ready = resolve_package(connection, &review.package_id, &resolutions).unwrap();
            assert!(matches!(apply_package(connection, &ready.package_id), Err(ChangePackageError::Database(_))));
            assert_eq!(connection.query_row("SELECT name FROM households WHERE id='family'", [], |row| row.get::<_, String>(0))?, "Before apply");
            assert_eq!(connection.query_row("SELECT count(*) FROM accounts WHERE household_id='family'", [], |row| row.get::<_, i64>(0))?, 2);
            assert_eq!(connection.query_row("SELECT state FROM change_packages WHERE package_id=?1", [&ready.package_id], |row| row.get::<_, String>(0))?, "READY");
            assert_eq!(connection.query_row("SELECT count(*) FROM sync_apply_guard", [], |row| row.get::<_, i64>(0))?, 0);
            Ok(())
        }).unwrap();
    }

    #[test]
    fn rejected_package_can_be_staged_again_and_cross_household_ids_are_blocked() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source.with_connection(|connection| {
            connection.execute("INSERT INTO households(id,name) VALUES('family','Incoming')", [])?;
            connection.execute("INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES('shared-id','family','Incoming bank','ASSET','BANK')", [])?;
            Ok(export_current_state(connection, "family").unwrap())
        }).unwrap();
        let bytes = encode_pretty(&package).unwrap();

        let retry_destination = AppState::in_memory(TEST_KEY).unwrap();
        retry_destination
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Destination')",
                    [],
                )?;
                let staged = stage_package(connection, "family", &bytes).unwrap();
                discard_package(connection, &staged.package_id).unwrap();
                let restaged = stage_package(connection, "family", &bytes).unwrap();
                assert_ne!(restaged.state, "REJECTED");
                Ok(())
            })
            .unwrap();

        let collision_destination = AppState::in_memory(TEST_KEY).unwrap();
        collision_destination
            .with_connection(|connection| {
                connection.execute_batch(
                "INSERT INTO households(id,name) VALUES('family','Destination'),('other','Other');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('shared-id','other','Other bank','ASSET','BANK');",
            )?;
                assert!(matches!(
                    stage_package(connection, "family", &bytes),
                    Err(ChangePackageError::Conflict)
                ));
                assert_eq!(
                    connection.query_row(
                        "SELECT name FROM accounts WHERE id='shared-id'",
                        [],
                        |row| row.get::<_, String>(0)
                    )?,
                    "Other bank"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn incoming_transaction_cannot_silently_drop_actual_local_source_links() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        let bytes = encode_pretty(&package).unwrap();
        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination.with_connection(|connection| {
            seed_complete_household(connection);
            connection.execute_batch(
                "INSERT INTO import_runs(id,household_id,status) VALUES('run','family','POSTED');
                 INSERT INTO source_documents(
                   id,household_id,import_run_id,source_type,original_filename,media_type,
                   byte_size,sha256,storage_path)
                 VALUES('doc','family','run','OTHER','local.csv','text/csv',0,
                   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','object');
                 INSERT INTO source_records(id,source_document_id,row_number,record_hash,raw_payload_json)
                 VALUES('actual-row','doc',1,
                   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','{}');
                 INSERT INTO transaction_sources(transaction_id,source_record_id)
                 VALUES('tx','actual-row');",
            )?;
            let review = stage_package(connection, "family", &bytes).unwrap();
            let resolutions = review.records.iter().filter(|record| record.resolution == "PENDING")
                .map(|record| ChangePackageResolutionInput {
                    entity_kind: record.entity_kind.clone(), entity_id: record.entity_id.clone(),
                    resolution: "APPLY_INCOMING".to_owned(),
                }).collect::<Vec<_>>();
            let ready = resolve_package(connection, &review.package_id, &resolutions).unwrap();
            assert!(matches!(apply_package(connection, &ready.package_id), Err(ChangePackageError::Conflict)));
            assert_eq!(connection.query_row(
                "SELECT count(*) FROM transaction_sources WHERE transaction_id='tx' AND source_record_id='actual-row'",
                [], |row| row.get::<_, i64>(0))?, 1);
            assert_eq!(connection.query_row("SELECT state FROM change_packages WHERE package_id=?1", [&ready.package_id], |row| row.get::<_, String>(0))?, "READY");
            Ok(())
        }).unwrap();
    }
}
