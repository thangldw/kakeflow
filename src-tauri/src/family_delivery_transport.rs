use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{family_snapshot, sync_foundation};

const MAX_ID: usize = 128;
const MAX_ARTIFACTS: usize = 1_000;
const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
const ARTIFACT_SCHEMA_V1: &str = "FAMILY_AUDIENCE_PARTITION_V1";
const ARTIFACT_SCHEMA: &str = "FAMILY_AUDIENCE_PARTITION_V2";

#[derive(Debug, Error)]
pub enum FamilyDeliveryError {
    #[error("family delivery database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("family delivery input is invalid")]
    InvalidInput,
    #[error("family delivery connection was not found")]
    NotConnected,
    #[error("family delivery immutable state conflicts")]
    Conflict,
    #[error("family delivery audience is not available")]
    AudienceDenied,
    #[error("family delivery snapshot could not be prepared")]
    Snapshot,
    #[error("another family snapshot is awaiting review")]
    ReviewPending,
}

pub type Result<T> = std::result::Result<T, FamilyDeliveryError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FamilyMembershipDto {
    pub member_id: String,
    pub member_name: String,
    pub state: String,
    pub remote_membership_ids: Vec<String>,
    pub invite_id: Option<String>,
    pub invite_expires_at: Option<String>,
    pub device_count: u64,
    pub last_delivery_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FamilyPartitionStatusDto {
    pub audience_key: String,
    pub audience_visibility: String,
    pub audience_member_id: Option<String>,
    pub audience_member_name: Option<String>,
    pub recipient_names: Vec<String>,
    pub pending_change_count: u64,
    pub state: String,
    pub withheld_reason: Option<String>,
    pub domain_counts: BTreeMap<String, u64>,
    pub evidence_file_count: u64,
    pub evidence_record_count: u64,
    pub withheld_counts_by_reason: BTreeMap<String, u64>,
    pub coverage_state: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FamilyInboundDto {
    pub artifact_id: String,
    pub sender_member_name: String,
    pub audience_visibility: String,
    pub audience_member_name: Option<String>,
    pub item_count: u64,
    pub created_at: String,
    pub state: String,
    pub received_before_revocation: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FamilyDeliveryStatusDto {
    pub household_id: String,
    pub connection_state: String,
    pub endpoint: Option<String>,
    pub remote_principal_id: Option<String>,
    pub local_device_id: String,
    pub inbound_cursor: u64,
    pub local_member_id: Option<String>,
    pub local_member_name: Option<String>,
    pub memberships: Vec<FamilyMembershipDto>,
    pub outbound: Vec<FamilyPartitionStatusDto>,
    pub withheld_change_count: u64,
    pub withheld_counts_by_reason: BTreeMap<String, u64>,
    pub inbound: Vec<FamilyInboundDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveFamilyConnectionInput {
    pub household_id: String,
    pub endpoint: String,
    pub remote_principal_id: String,
    pub local_member_id: Option<String>,
    pub local_member_name: Option<String>,
    pub memberships: Vec<FamilyMembershipDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisterRemoteStateInput {
    pub household_id: String,
    pub remote_principal_id: String,
    pub local_member_id: Option<String>,
    pub local_member_name: Option<String>,
    pub memberships: Vec<FamilyMembershipDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareFamilyDeliveryInput {
    pub household_id: String,
    pub audience_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreparedFamilyArtifactDto {
    pub delivery_id: String,
    pub artifact_id: String,
    pub digest: String,
    pub household_id: String,
    pub origin_device_id: String,
    pub audience_key: String,
    pub audience_visibility: String,
    pub audience_member_id: Option<String>,
    pub artifact_schema: String,
    pub package_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptanceReceiptInput {
    pub delivery_id: String,
    pub artifact_id: String,
    pub digest: String,
    pub accepted_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptFamilyDeliveryInput {
    pub household_id: String,
    pub receipts: Vec<AcceptanceReceiptInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteFamilyArtifactInput {
    pub sequence: u64,
    pub artifact_id: String,
    pub digest: String,
    pub created_at: String,
    pub origin_device_id: String,
    pub sender_membership_id: String,
    pub audience_visibility: String,
    pub audience_member_id: Option<String>,
    pub byte_size: u64,
    pub artifact_schema: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisterFamilyInboundInput {
    pub household_id: String,
    pub artifacts: Vec<RemoteFamilyArtifactInput>,
    pub next_cursor: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageFamilyInboundInput {
    pub household_id: String,
    pub artifact_id: String,
    pub package_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FamilySnapshotUiResolutionInput {
    pub entity_kind: String,
    pub entity_id: String,
    pub resolution: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FamilySnapshotUiRecordDto {
    pub record_order: u64,
    pub entity_kind: String,
    pub entity_id: String,
    pub entity_label: String,
    pub operation: String,
    pub review_state: String,
    pub resolution: String,
    pub local_summary: Option<String>,
    pub incoming_summary: String,
    pub domain: String,
    pub entity_summary: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FamilySnapshotUiReviewDto {
    pub package_id: String,
    pub household_id: String,
    pub sender_member_name: String,
    pub audience_visibility: String,
    pub audience_member_name: Option<String>,
    pub state: String,
    pub record_count: u64,
    pub create_count: u64,
    pub update_count: u64,
    pub delete_count: u64,
    pub conflict_count: u64,
    pub records: Vec<FamilySnapshotUiRecordDto>,
}

fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_ID && !value.chars().any(char::is_control)
}

fn valid_name(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn valid_timestamp(value: &str) -> bool {
    (20..=40).contains(&value.len()) && value.contains('T') && value.ends_with('Z')
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn empty_domain_counts() -> BTreeMap<String, u64> {
    ["LEDGER", "PLANNING", "CONFIG", "CARD", "INVESTMENT"]
        .into_iter()
        .map(|domain| (domain.to_owned(), 0))
        .collect()
}

fn empty_withheld_counts() -> BTreeMap<String, u64> {
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

fn normalized_endpoint(value: &str) -> Option<String> {
    let endpoint = value.trim().trim_end_matches('/');
    let loopback = endpoint.starts_with("http://127.0.0.1:")
        || endpoint.starts_with("http://localhost:")
        || endpoint.starts_with("http://[::1]:");
    if endpoint.len() < 8
        || endpoint.len() > 2048
        || endpoint.chars().any(char::is_control)
        || !(endpoint.starts_with("https://") || loopback)
    {
        return None;
    }
    Some(endpoint.to_owned())
}

fn validate_memberships(
    connection: &Connection,
    household_id: &str,
    memberships: &[FamilyMembershipDto],
) -> Result<()> {
    if memberships.len() > 1_000 {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let mut members = BTreeSet::new();
    let mut remote_ids = BTreeSet::new();
    for item in memberships {
        if !valid_id(&item.member_id)
            || !valid_name(&item.member_name)
            || !matches!(
                item.state.as_str(),
                "UNLINKED" | "INVITED" | "ACTIVE" | "REVOKED" | "ARCHIVED_BLOCKED"
            )
            || !members.insert(item.member_id.as_str())
            || item.remote_membership_ids.len() > 64
            || item
                .remote_membership_ids
                .iter()
                .any(|id| !valid_id(id) || !remote_ids.insert(id))
            || ((item.state == "INVITED")
                != (item.invite_id.is_some() && item.invite_expires_at.is_some()))
            || item.invite_id.as_deref().is_some_and(|id| !valid_id(id))
            || item
                .invite_expires_at
                .as_deref()
                .is_some_and(|at| !valid_timestamp(at))
            || item
                .last_delivery_at
                .as_deref()
                .is_some_and(|at| !valid_timestamp(at))
        {
            return Err(FamilyDeliveryError::InvalidInput);
        }
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM household_members WHERE household_id=?1 AND id=?2 AND display_name=?3)",
            params![household_id, item.member_id, item.member_name], |row| row.get(0),
        )?;
        if !exists {
            return Err(FamilyDeliveryError::Conflict);
        }
    }
    Ok(())
}

fn replace_memberships(
    transaction: &Transaction<'_>,
    household_id: &str,
    memberships: &[FamilyMembershipDto],
) -> Result<()> {
    transaction.execute(
        "DELETE FROM family_delivery_memberships WHERE household_id=?1",
        [household_id],
    )?;
    for item in memberships {
        transaction.execute(
            "INSERT INTO family_delivery_memberships(
               household_id,member_id,member_name,state,remote_membership_id,invite_id,
               invite_expires_at,device_count,last_delivery_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                household_id,
                item.member_id,
                item.member_name,
                item.state,
                Option::<String>::None,
                item.invite_id,
                item.invite_expires_at,
                item.device_count,
                item.last_delivery_at
            ],
        )?;
        for remote_id in &item.remote_membership_ids {
            transaction.execute(
                "INSERT INTO family_delivery_remote_membership_ids(
                   household_id,member_id,remote_membership_id) VALUES(?1,?2,?3)",
                params![household_id, item.member_id, remote_id],
            )?;
        }
    }
    Ok(())
}

fn mark_revoked_inbound(
    transaction: &Transaction<'_>,
    household_id: &str,
    memberships: &[FamilyMembershipDto],
) -> Result<()> {
    for member in memberships
        .iter()
        .filter(|member| member.state == "REVOKED")
    {
        transaction.execute(
            "UPDATE family_delivery_inbound SET received_before_revocation=1
             WHERE household_id=?1 AND sender_member_id=?2",
            params![household_id, member.member_id],
        )?;
    }
    Ok(())
}

fn ensure_partition_rows(
    transaction: &Transaction<'_>,
    household_id: &str,
    local_member_id: &str,
) -> Result<()> {
    transaction.execute(
        "INSERT INTO family_delivery_partition_state(household_id,audience_key,visibility,member_id,member_key)
         VALUES(?1,'SHARED','SHARED',NULL,'') ON CONFLICT(household_id,audience_key) DO NOTHING",
        [household_id],
    )?;
    transaction.execute(
        "DELETE FROM family_delivery_partition_state
         WHERE household_id=?1 AND visibility='PERSONAL' AND member_id!=?2",
        params![household_id, local_member_id],
    )?;
    transaction.execute(
        "INSERT INTO family_delivery_partition_state(household_id,audience_key,visibility,member_id,member_key)
         VALUES(?1,'PERSONAL:'||?2,'PERSONAL',?2,?2)
         ON CONFLICT(household_id,audience_key) DO NOTHING",
        params![household_id,local_member_id],
    )?;
    Ok(())
}

pub fn save_connection(
    connection: &Connection,
    input: &SaveFamilyConnectionInput,
) -> Result<FamilyDeliveryStatusDto> {
    let endpoint = normalized_endpoint(&input.endpoint).ok_or(FamilyDeliveryError::InvalidInput)?;
    let (Some(local_member_id), Some(local_member_name)) =
        (&input.local_member_id, &input.local_member_name)
    else {
        return Err(FamilyDeliveryError::AudienceDenied);
    };
    if !valid_id(&input.household_id)
        || !valid_id(&input.remote_principal_id)
        || !valid_id(local_member_id)
        || !valid_name(local_member_name)
    {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    validate_memberships(connection, &input.household_id, &input.memberships)?;
    if !input.memberships.iter().any(|item| {
        item.member_id == *local_member_id
            && item.member_name == *local_member_name
            && item.state == "ACTIVE"
    }) {
        return Err(FamilyDeliveryError::AudienceDenied);
    }
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "INSERT INTO family_delivery_connections(
           household_id,endpoint,remote_principal_id,local_member_id,local_member_name,state)
         VALUES(?1,?2,?3,?4,?5,'CONNECTED')
         ON CONFLICT(household_id) DO UPDATE SET endpoint=excluded.endpoint,
           remote_principal_id=excluded.remote_principal_id,local_member_id=excluded.local_member_id,
           local_member_name=excluded.local_member_name,state='CONNECTED',
           last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![input.household_id,endpoint,input.remote_principal_id,local_member_id,local_member_name],
    )?;
    replace_memberships(&transaction, &input.household_id, &input.memberships)?;
    mark_revoked_inbound(&transaction, &input.household_id, &input.memberships)?;
    ensure_partition_rows(&transaction, &input.household_id, local_member_id)?;
    transaction.commit()?;
    status(connection, &input.household_id)
}

pub fn register_remote_state(
    connection: &Connection,
    input: &RegisterRemoteStateInput,
) -> Result<FamilyDeliveryStatusDto> {
    if !valid_id(&input.household_id) || !valid_id(&input.remote_principal_id) {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    validate_memberships(connection, &input.household_id, &input.memberships)?;
    let configured: Option<String> = connection
        .query_row(
            "SELECT remote_principal_id FROM family_delivery_connections
         WHERE household_id=?1 AND state!='DISCONNECTED'",
            [&input.household_id],
            |row| row.get(0),
        )
        .optional()?;
    if configured.as_deref() != Some(input.remote_principal_id.as_str()) {
        return Err(FamilyDeliveryError::Conflict);
    }
    let (Some(local_member_id), Some(local_member_name)) =
        (&input.local_member_id, &input.local_member_name)
    else {
        connection.execute("UPDATE family_delivery_connections SET state='MEMBERSHIP_REVOKED' WHERE household_id=?1", [&input.household_id])?;
        return status(connection, &input.household_id);
    };
    if !input
        .memberships
        .iter()
        .any(|item| item.member_id == *local_member_id && item.state == "ACTIVE")
    {
        return Err(FamilyDeliveryError::AudienceDenied);
    }
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "UPDATE family_delivery_connections SET local_member_id=?1,local_member_name=?2,
           state='CONNECTED',last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?3",
        params![local_member_id,local_member_name,input.household_id],
    )?;
    replace_memberships(&transaction, &input.household_id, &input.memberships)?;
    mark_revoked_inbound(&transaction, &input.household_id, &input.memberships)?;
    ensure_partition_rows(&transaction, &input.household_id, local_member_id)?;
    transaction.commit()?;
    status(connection, &input.household_id)
}

pub fn disconnect(connection: &Connection, household_id: &str) -> Result<FamilyDeliveryStatusDto> {
    if !valid_id(household_id) {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    connection.execute(
        "UPDATE family_delivery_connections SET state='DISCONNECTED' WHERE household_id=?1",
        [household_id],
    )?;
    status(connection, household_id)
}

pub fn status(connection: &Connection, household_id: &str) -> Result<FamilyDeliveryStatusDto> {
    if !valid_id(household_id) {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let local = sync_foundation::get_local_status(connection, household_id)
        .map_err(|_| FamilyDeliveryError::InvalidInput)?;
    let configured = connection.query_row(
        "SELECT endpoint,remote_principal_id,local_member_id,local_member_name,state,inbound_cursor
         FROM family_delivery_connections WHERE household_id=?1", [household_id], |row| Ok((
            row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?,row.get::<_,i64>(5)?
         )),
    ).optional()?;
    let Some((endpoint, principal, local_member_id, local_member_name, state, cursor)) = configured
    else {
        return Ok(FamilyDeliveryStatusDto {
            household_id: household_id.to_owned(),
            connection_state: "NOT_CONFIGURED".into(),
            endpoint: None,
            remote_principal_id: None,
            local_device_id: local.device.id,
            inbound_cursor: 0,
            local_member_id: None,
            local_member_name: None,
            memberships: vec![],
            outbound: vec![],
            withheld_change_count: 0,
            withheld_counts_by_reason: empty_withheld_counts(),
            inbound: vec![],
        });
    };
    if state == "DISCONNECTED" {
        return Ok(FamilyDeliveryStatusDto {
            household_id: household_id.to_owned(),
            connection_state: "NOT_CONFIGURED".into(),
            endpoint: None,
            remote_principal_id: None,
            local_device_id: local.device.id,
            inbound_cursor: cursor.max(0) as u64,
            local_member_id: None,
            local_member_name: None,
            memberships: vec![],
            outbound: vec![],
            withheld_change_count: 0,
            withheld_counts_by_reason: empty_withheld_counts(),
            inbound: vec![],
        });
    }
    let memberships = load_memberships(connection, household_id)?;
    let preview = family_snapshot::preview_snapshot_set(connection, household_id)
        .map_err(|_| FamilyDeliveryError::Snapshot)?;
    let withheld_counts_by_reason = preview.excluded_counts_by_reason.clone();
    let coverage_state = if withheld_counts_by_reason.values().sum::<u64>() == 0 {
        "COMPLETE"
    } else {
        "PARTIAL"
    };
    let mut statement = connection.prepare(
        "SELECT audience_key,visibility,member_id,dirty FROM family_delivery_partition_state
         WHERE household_id=?1 ORDER BY CASE visibility WHEN 'SHARED' THEN 0 ELSE 1 END,audience_key")?;
    let outbound = statement.query_map([household_id], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,Option<String>>(2)?,row.get::<_,i64>(3)?)))?
        .map(|item| {
            let (key,visibility,member_id,dirty) = item?;
            let member_name = member_id.as_ref().and_then(|id| memberships.iter().find(|m| &m.member_id == id).map(|m| m.member_name.clone()));
            let recipients = memberships.iter().filter(|m| m.state == "ACTIVE" && if visibility == "SHARED" {
                m.member_id != local_member_id || m.device_count > 1
            } else { m.member_id == local_member_id && m.device_count > 1 }).map(|m| m.member_name.clone()).collect::<Vec<_>>();
            let latest = connection.query_row(
                "SELECT state,item_count FROM family_delivery_deliveries WHERE household_id=?1 AND audience_key=?2
                 ORDER BY created_at DESC,delivery_id DESC LIMIT 1", params![household_id,key], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?)),
            ).optional()?;
            let outbound_state = if recipients.is_empty() { "BLOCKED_NO_RECIPIENT".to_owned() }
                else if dirty != 0 && latest.as_ref().is_some_and(|(state,_)| state == "RELAY_ACCEPTED") { "READY".to_owned() }
                else if let Some((delivery_state,_)) = &latest { delivery_state.clone() }
                else { "READY".to_owned() };
            let prepared_before = latest.as_ref().is_some_and(|(state,_)| matches!(state.as_str(), "SENDING"|"FAILED_RETRYABLE"));
            let pending = if dirty == 0 { 0 } else if prepared_before { latest.as_ref().map(|(_,count)| (*count).max(1) as u64).unwrap_or(1) } else { 1 };
            let domain_counts = preview.partitions.iter().find(|partition| {
                partition.audience.visibility == visibility && partition.audience.member_id == member_id
            }).map(|partition| {
                let mut counts = empty_domain_counts();
                for record in &partition.records {
                    *counts.entry(entity_domain(&record.entity_kind).to_owned()).or_default() += 1;
                }
                counts
            }).unwrap_or_else(empty_domain_counts);
            let mut domain_counts = domain_counts;
            domain_counts.insert(
                "CARD".to_owned(),
                *withheld_counts_by_reason
                    .get("EVIDENCE_REQUIRED_CARD")
                    .unwrap_or(&0),
            );
            domain_counts.insert(
                "INVESTMENT".to_owned(),
                *withheld_counts_by_reason
                    .get("EVIDENCE_REQUIRED_INVESTMENT")
                    .unwrap_or(&0),
            );
            Ok(FamilyPartitionStatusDto { audience_key:key,audience_visibility:visibility,audience_member_id:member_id,
                audience_member_name:member_name,recipient_names:recipients,pending_change_count:pending,state:outbound_state,
                withheld_reason:if dirty != 0 && !prepared_before { Some("件数は送信準備時に確定します".to_owned()) } else { None },
                domain_counts,evidence_file_count:0,evidence_record_count:0,
                withheld_counts_by_reason:withheld_counts_by_reason.clone(),coverage_state:coverage_state.to_owned() })
        }).collect::<std::result::Result<Vec<_>,rusqlite::Error>>()?;
    let mut inbound_statement = connection.prepare(
        "SELECT i.artifact_id,i.sender_member_name,i.visibility,i.member_name,
                coalesce(p.record_count,0),i.created_at,i.state,i.received_before_revocation
         FROM family_delivery_inbound i LEFT JOIN family_snapshot_partitions p
           ON p.snapshot_set_id=i.staged_snapshot_set_id
         WHERE i.household_id=?1 ORDER BY i.sequence DESC LIMIT 1000",
    )?;
    let inbound = inbound_statement
        .query_map([household_id], |row| {
            Ok(FamilyInboundDto {
                artifact_id: row.get(0)?,
                sender_member_name: row.get(1)?,
                audience_visibility: row.get(2)?,
                audience_member_name: row.get(3)?,
                item_count: u64::try_from(row.get::<_, i64>(4)?).unwrap_or(0),
                created_at: row.get(5)?,
                state: row.get(6)?,
                received_before_revocation: row.get::<_, i64>(7)? != 0,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let withheld_change_count = withheld_counts_by_reason.values().sum();
    Ok(FamilyDeliveryStatusDto {
        household_id: household_id.to_owned(),
        connection_state: state,
        endpoint: Some(endpoint),
        remote_principal_id: Some(principal),
        local_device_id: local.device.id,
        inbound_cursor: cursor.max(0) as u64,
        local_member_id: Some(local_member_id),
        local_member_name: Some(local_member_name),
        memberships,
        outbound,
        withheld_change_count,
        withheld_counts_by_reason,
        inbound,
    })
}

fn load_memberships(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<FamilyMembershipDto>> {
    let mut statement = connection.prepare(
        "SELECT member_id,member_name,state,invite_id,invite_expires_at,device_count,last_delivery_at
         FROM family_delivery_memberships WHERE household_id=?1 ORDER BY member_name,member_id")?;
    let memberships = statement
        .query_map([household_id], |row| {
            let member_id: String = row.get(0)?;
            let mut ids = connection.prepare(
                "SELECT remote_membership_id FROM family_delivery_remote_membership_ids
             WHERE household_id=?1 AND member_id=?2 ORDER BY remote_membership_id",
            )?;
            let remote_membership_ids = ids
                .query_map(params![household_id, member_id], |item| {
                    item.get::<_, String>(0)
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(FamilyMembershipDto {
                member_id,
                member_name: row.get(1)?,
                state: row.get(2)?,
                remote_membership_ids,
                invite_id: row.get(3)?,
                invite_expires_at: row.get(4)?,
                device_count: u64::try_from(row.get::<_, i64>(5)?).unwrap_or(0),
                last_delivery_at: row.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(memberships)
}

pub fn prepare_send(
    connection: &Connection,
    input: &PrepareFamilyDeliveryInput,
) -> Result<Vec<PreparedFamilyArtifactDto>> {
    if !valid_id(&input.household_id)
        || input.audience_keys.is_empty()
        || input.audience_keys.len() > 2
    {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let keys = input.audience_keys.iter().collect::<BTreeSet<_>>();
    if keys.len() != input.audience_keys.len() {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let connected: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM family_delivery_connections WHERE household_id=?1 AND state IN ('CONNECTED','NETWORK_UNAVAILABLE'))", [&input.household_id], |row| row.get(0))?;
    if !connected {
        return Err(FamilyDeliveryError::NotConnected);
    }
    let mut retries = Vec::new();
    for key in &input.audience_keys {
        if let Some(delivery) = load_retryable(connection, &input.household_id, key)? {
            retries.push(delivery);
        }
    }
    if !retries.is_empty() {
        if retries.len() != input.audience_keys.len() {
            return Err(FamilyDeliveryError::Conflict);
        }
        return Ok(retries);
    }
    for key in &input.audience_keys {
        let dirty: Option<i64> = connection
            .query_row(
                "SELECT dirty FROM family_delivery_partition_state
                 WHERE household_id=?1 AND audience_key=?2",
                params![input.household_id, key],
                |row| row.get(0),
            )
            .optional()?;
        if dirty != Some(1) {
            return Err(FamilyDeliveryError::Snapshot);
        }
    }
    let set = family_snapshot::export_snapshot_set(connection, &input.household_id)
        .map_err(|_| FamilyDeliveryError::Snapshot)?;
    let mut prepared = Vec::new();
    let transaction = connection.unchecked_transaction()?;
    for key in &input.audience_keys {
        let partition = set
            .partitions
            .iter()
            .find(|partition| audience_key(&partition.audience) == *key)
            .ok_or(FamilyDeliveryError::AudienceDenied)?;
        let recipients: i64 = if partition.audience.visibility == "SHARED" {
            transaction.query_row("SELECT count(*) FROM family_delivery_memberships m JOIN family_delivery_connections c USING(household_id)
                WHERE m.household_id=?1 AND m.state='ACTIVE' AND (m.member_id!=c.local_member_id OR m.device_count>1)", [&input.household_id], |row| row.get(0))?
        } else {
            transaction.query_row("SELECT count(*) FROM family_delivery_memberships m JOIN family_delivery_connections c USING(household_id)
                WHERE m.household_id=?1 AND m.state='ACTIVE' AND m.member_id=c.local_member_id AND m.device_count>1", [&input.household_id], |row| row.get(0))?
        };
        if recipients == 0 {
            return Err(FamilyDeliveryError::AudienceDenied);
        }
        let bytes = family_snapshot::encode_partition_artifact(&set, &partition.audience)
            .map_err(|_| FamilyDeliveryError::Snapshot)?;
        if bytes.is_empty() || bytes.len() > MAX_PACKAGE_BYTES {
            return Err(FamilyDeliveryError::InvalidInput);
        }
        let package_digest = digest(&bytes);
        let delivery_id = format!("family-delivery-{package_digest}");
        transaction.execute(
            "INSERT INTO family_delivery_deliveries(delivery_id,household_id,audience_key,artifact_id,package_sha256,
               origin_device_id,visibility,member_id,item_count,excluded_count,package_bytes,state,artifact_schema)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'SENDING',?12)",
            params![delivery_id,input.household_id,key,partition.package_id,package_digest,set.source_installation_id,
                partition.audience.visibility,partition.audience.member_id,partition.records.len() as u64,
                set.excluded_counts_by_reason.values().sum::<u64>(),bytes,ARTIFACT_SCHEMA],
        )?;
        prepared
            .push(load_delivery(&transaction, &delivery_id)?.ok_or(FamilyDeliveryError::Conflict)?);
    }
    transaction.commit()?;
    Ok(prepared)
}

fn audience_key(audience: &family_snapshot::FamilyAudienceDto) -> String {
    audience
        .member_id
        .as_ref()
        .map(|member| format!("PERSONAL:{member}"))
        .unwrap_or_else(|| "SHARED".to_owned())
}

fn load_retryable(
    connection: &Connection,
    household_id: &str,
    key: &str,
) -> Result<Option<PreparedFamilyArtifactDto>> {
    let id = connection.query_row(
        "SELECT delivery_id FROM family_delivery_deliveries WHERE household_id=?1 AND audience_key=?2
         AND state IN ('SENDING','FAILED_RETRYABLE') ORDER BY created_at,delivery_id LIMIT 1",
        params![household_id,key], |row| row.get::<_,String>(0),
    ).optional()?;
    id.map(|id| load_delivery(connection, &id)?.ok_or(FamilyDeliveryError::Conflict))
        .transpose()
}

fn load_delivery(
    connection: &Connection,
    delivery_id: &str,
) -> Result<Option<PreparedFamilyArtifactDto>> {
    let delivery = connection.query_row(
        "SELECT delivery_id,artifact_id,package_sha256,household_id,origin_device_id,audience_key,visibility,member_id,artifact_schema,package_bytes
         FROM family_delivery_deliveries WHERE delivery_id=?1", [delivery_id], |row| Ok(PreparedFamilyArtifactDto {
            delivery_id:row.get(0)?,artifact_id:row.get(1)?,digest:row.get(2)?,household_id:row.get(3)?,origin_device_id:row.get(4)?,
            audience_key:row.get(5)?,audience_visibility:row.get(6)?,audience_member_id:row.get(7)?,artifact_schema:row.get(8)?,package_bytes:row.get(9)?,
        }),
    ).optional()?;
    let Some(delivery) = delivery else {
        return Ok(None);
    };
    if digest(&delivery.package_bytes) != delivery.digest {
        return Err(FamilyDeliveryError::Conflict);
    }
    let set = family_snapshot::decode_and_validate(&delivery.package_bytes)
        .map_err(|_| FamilyDeliveryError::Conflict)?;
    let Some(partition) = set.partitions.first() else {
        return Err(FamilyDeliveryError::Conflict);
    };
    if set.partitions.len() != 1
        || set.household_id != delivery.household_id
        || set.source_installation_id != delivery.origin_device_id
        || partition.package_id != delivery.artifact_id
        || partition.audience.visibility != delivery.audience_visibility
        || partition.audience.member_id != delivery.audience_member_id
        || delivery.artifact_schema
            != if set.schema_version == 1 {
                ARTIFACT_SCHEMA_V1
            } else {
                ARTIFACT_SCHEMA
            }
    {
        return Err(FamilyDeliveryError::Conflict);
    }
    Ok(Some(delivery))
}

pub fn mark_accepted(
    connection: &Connection,
    input: &AcceptFamilyDeliveryInput,
) -> Result<FamilyDeliveryStatusDto> {
    if !valid_id(&input.household_id) || input.receipts.is_empty() || input.receipts.len() > 2 {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    for receipt in &input.receipts {
        if !valid_id(&receipt.delivery_id)
            || !valid_id(&receipt.artifact_id)
            || !valid_digest(&receipt.digest)
            || !valid_timestamp(&receipt.accepted_at)
        {
            return Err(FamilyDeliveryError::InvalidInput);
        }
        let existing = transaction.query_row(
            "SELECT audience_key,state,artifact_id,package_sha256,package_bytes FROM family_delivery_deliveries
             WHERE household_id=?1 AND delivery_id=?2", params![input.household_id,receipt.delivery_id], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,Option<Vec<u8>>>(4)?)),
        ).optional()?.ok_or(FamilyDeliveryError::Conflict)?;
        if existing.2 != receipt.artifact_id || existing.3 != receipt.digest {
            return Err(FamilyDeliveryError::Conflict);
        }
        if existing.1 != "RELAY_ACCEPTED" {
            let bytes = existing.4.as_deref().ok_or(FamilyDeliveryError::Conflict)?;
            let set = family_snapshot::decode_and_validate(bytes)
                .map_err(|_| FamilyDeliveryError::Conflict)?;
            let partition = set
                .partitions
                .first()
                .ok_or(FamilyDeliveryError::Conflict)?;
            let retained = partition
                .records
                .iter()
                .map(|record| (record.entity_kind.as_str(), record.entity_id.as_str()))
                .chain(
                    partition
                        .relocations
                        .iter()
                        .map(|record| (record.entity_kind.as_str(), record.entity_id.as_str())),
                )
                .collect::<BTreeSet<_>>();
            let mut old_statement = transaction.prepare(
                "SELECT entity_kind,entity_id FROM family_delivery_outbound_entity_heads
                 WHERE household_id=?1 AND visibility=?2 AND member_key=?3",
            )?;
            let old = old_statement
                .query_map(
                    params![
                        input.household_id,
                        partition.audience.visibility,
                        partition.audience.member_key()
                    ],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(old_statement);
            for (kind, id) in old {
                if !retained.contains(&(kind.as_str(), id.as_str())) {
                    transaction.execute(
                        "DELETE FROM family_delivery_outbound_entity_heads
                         WHERE household_id=?1 AND visibility=?2 AND member_key=?3
                           AND entity_kind=?4 AND entity_id=?5",
                        params![
                            input.household_id,
                            partition.audience.visibility,
                            partition.audience.member_key(),
                            kind,
                            id
                        ],
                    )?;
                }
            }
            for record in &partition.records {
                transaction.execute(
                    "INSERT INTO family_delivery_outbound_entity_heads(
                       household_id,visibility,member_id,member_key,entity_kind,entity_id,
                       payload_sha256,accepted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
                     ON CONFLICT(household_id,visibility,member_key,entity_kind,entity_id)
                     DO UPDATE SET member_id=excluded.member_id,payload_sha256=excluded.payload_sha256,
                       accepted_at=excluded.accepted_at",
                    params![input.household_id,partition.audience.visibility,
                        partition.audience.member_id,partition.audience.member_key(),record.entity_kind,
                        record.entity_id,record.payload_sha256,receipt.accepted_at],
                )?;
            }
            mark_v2_outbound_lineage_tracked(
                &transaction,
                &input.household_id,
                &existing.0,
                &receipt.accepted_at,
                set.schema_version,
            )?;
            transaction.execute("UPDATE family_delivery_deliveries SET state='RELAY_ACCEPTED',accepted_at=?1,package_bytes=NULL WHERE delivery_id=?2", params![receipt.accepted_at,receipt.delivery_id])?;
            transaction.execute("UPDATE family_delivery_partition_state SET dirty=0,last_accepted_digest=?1,last_accepted_at=?2 WHERE household_id=?3 AND audience_key=?4",
                params![receipt.digest,receipt.accepted_at,input.household_id,existing.0])?;
        }
    }
    transaction.execute("UPDATE family_delivery_connections SET state='CONNECTED',last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1", [&input.household_id])?;
    transaction.commit()?;
    status(connection, &input.household_id)
}

fn mark_v2_outbound_lineage_tracked(
    transaction: &Transaction<'_>,
    household_id: &str,
    audience_key: &str,
    accepted_at: &str,
    schema_version: u32,
) -> Result<()> {
    if schema_version >= 2 {
        transaction.execute(
            "INSERT INTO family_delivery_outbound_lineage_state(
               household_id,audience_key,state,updated_at) VALUES(?1,?2,'V2_TRACKED',?3)
             ON CONFLICT(household_id,audience_key) DO UPDATE SET
               state='V2_TRACKED',updated_at=excluded.updated_at",
            params![household_id, audience_key, accepted_at],
        )?;
    }
    Ok(())
}

pub fn mark_failed(
    connection: &Connection,
    household_id: &str,
    delivery_ids: &[String],
) -> Result<FamilyDeliveryStatusDto> {
    if !valid_id(household_id)
        || delivery_ids.is_empty()
        || delivery_ids.len() > 2
        || delivery_ids.iter().any(|id| !valid_id(id))
    {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    for id in delivery_ids {
        let changed=transaction.execute("UPDATE family_delivery_deliveries SET state='FAILED_RETRYABLE',accepted_at=NULL WHERE household_id=?1 AND delivery_id=?2 AND state!='RELAY_ACCEPTED'",params![household_id,id])?;
        if changed != 1 {
            return Err(FamilyDeliveryError::Conflict);
        }
    }
    transaction.execute(
        "UPDATE family_delivery_connections SET state='NETWORK_UNAVAILABLE' WHERE household_id=?1",
        [household_id],
    )?;
    transaction.commit()?;
    status(connection, household_id)
}

pub fn register_inbound(
    connection: &Connection,
    input: &RegisterFamilyInboundInput,
) -> Result<FamilyDeliveryStatusDto> {
    if !valid_id(&input.household_id) || input.artifacts.len() > MAX_ARTIFACTS {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let (local_device,local_member):(String,String)=connection.query_row(
        "SELECT c.device_id,f.local_member_id FROM family_delivery_connections f JOIN local_sync_contexts c USING(household_id)
         WHERE f.household_id=?1 AND f.state='CONNECTED'",[&input.household_id],|row|Ok((row.get(0)?,row.get(1)?)))
        .optional()?.ok_or(FamilyDeliveryError::NotConnected)?;
    let memberships = load_memberships(connection, &input.household_id)?;
    let remote_to_member = memberships
        .iter()
        .flat_map(|m| {
            m.remote_membership_ids.iter().map(|remote| {
                (
                    remote.clone(),
                    (m.member_id.clone(), m.member_name.clone(), m.state.clone()),
                )
            })
        })
        .collect::<BTreeMap<_, _>>();
    let transaction = connection.unchecked_transaction()?;
    let mut max_sequence = 0_u64;
    for artifact in &input.artifacts {
        if !valid_id(&artifact.artifact_id)
            || !valid_id(&artifact.origin_device_id)
            || !valid_id(&artifact.sender_membership_id)
            || !valid_digest(&artifact.digest)
            || !valid_timestamp(&artifact.created_at)
            || artifact.byte_size == 0
            || artifact.byte_size as usize > MAX_PACKAGE_BYTES
            || !matches!(
                artifact.artifact_schema.as_str(),
                ARTIFACT_SCHEMA_V1 | ARTIFACT_SCHEMA
            )
            || artifact.origin_device_id == local_device
            || !matches!(artifact.audience_visibility.as_str(), "SHARED" | "PERSONAL")
            || ((artifact.audience_visibility == "SHARED") != artifact.audience_member_id.is_none())
        {
            return Err(FamilyDeliveryError::InvalidInput);
        }
        if artifact.audience_visibility == "PERSONAL"
            && artifact.audience_member_id.as_deref() != Some(local_member.as_str())
        {
            return Err(FamilyDeliveryError::AudienceDenied);
        }
        let (sender_member_id, sender_name, sender_state) = remote_to_member
            .get(&artifact.sender_membership_id)
            .cloned()
            .ok_or(FamilyDeliveryError::AudienceDenied)?;
        let member_name = artifact
            .audience_member_id
            .as_ref()
            .map(|id| {
                memberships
                    .iter()
                    .find(|m| &m.member_id == id)
                    .map(|m| m.member_name.clone())
                    .ok_or(FamilyDeliveryError::AudienceDenied)
            })
            .transpose()?;
        register_one(
            &transaction,
            &input.household_id,
            artifact,
            &sender_member_id,
            &sender_name,
            sender_state != "ACTIVE",
            member_name.as_deref(),
        )?;
        max_sequence = max_sequence.max(artifact.sequence);
    }
    if input.next_cursor < max_sequence {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    transaction.execute("UPDATE family_delivery_connections SET inbound_cursor=max(inbound_cursor,?1),state='CONNECTED',last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?2",params![input.next_cursor,input.household_id])?;
    transaction.commit()?;
    status(connection, &input.household_id)
}

fn register_one(
    transaction: &Transaction<'_>,
    household_id: &str,
    artifact: &RemoteFamilyArtifactInput,
    sender_member_id: &str,
    sender_name: &str,
    revoked: bool,
    member_name: Option<&str>,
) -> Result<()> {
    let existing=transaction.query_row("SELECT household_id,package_sha256,origin_device_id,sender_membership_id,visibility,member_id FROM family_delivery_inbound WHERE artifact_id=?1",[&artifact.artifact_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?))).optional()?;
    if let Some(current) = existing {
        if current
            != (
                household_id.to_owned(),
                artifact.digest.clone(),
                artifact.origin_device_id.clone(),
                artifact.sender_membership_id.clone(),
                artifact.audience_visibility.clone(),
                artifact.audience_member_id.clone(),
            )
        {
            return Err(FamilyDeliveryError::Conflict);
        }
        return Ok(());
    }
    transaction.execute("INSERT INTO family_delivery_inbound(artifact_id,household_id,sequence,package_sha256,created_at,origin_device_id,
       sender_membership_id,sender_member_id,sender_member_name,visibility,member_id,member_key,member_name,byte_size,artifact_schema,state,received_before_revocation)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,coalesce(?11,''),?12,?13,?14,'AVAILABLE',?15)",
       params![artifact.artifact_id,household_id,artifact.sequence,artifact.digest,artifact.created_at,artifact.origin_device_id,
       artifact.sender_membership_id,sender_member_id,sender_name,artifact.audience_visibility,artifact.audience_member_id,member_name,artifact.byte_size,artifact.artifact_schema,if revoked{1}else{0}])?;
    Ok(())
}

pub fn stage_inbound(
    connection: &Connection,
    input: &StageFamilyInboundInput,
) -> Result<family_snapshot::FamilySnapshotReviewDto> {
    if !valid_id(&input.household_id)
        || !valid_id(&input.artifact_id)
        || input.package_bytes.is_empty()
        || input.package_bytes.len() > MAX_PACKAGE_BYTES
    {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let metadata=connection.query_row("SELECT package_sha256,origin_device_id,sender_membership_id,visibility,member_id,artifact_schema,sender_member_id
       FROM family_delivery_inbound WHERE household_id=?1 AND artifact_id=?2 AND state IN ('AVAILABLE','FAILED_RETRYABLE')",
       params![input.household_id,input.artifact_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?))).optional()?.ok_or(FamilyDeliveryError::InvalidInput)?;
    if digest(&input.package_bytes) != metadata.0 {
        return Err(FamilyDeliveryError::Conflict);
    }
    let set = family_snapshot::decode_and_validate(&input.package_bytes)
        .map_err(|_| FamilyDeliveryError::Snapshot)?;
    let partition = set
        .partitions
        .first()
        .ok_or(FamilyDeliveryError::Snapshot)?;
    if set.partitions.len() != 1
        || set.household_id != input.household_id
        || set.source_installation_id != metadata.1
        || partition.package_id != input.artifact_id
        || partition.audience.visibility != metadata.3
        || partition.audience.member_id != metadata.4
        || metadata.5
            != if set.schema_version == 1 {
                ARTIFACT_SCHEMA_V1
            } else {
                ARTIFACT_SCHEMA
            }
        || metadata.6 != set.publisher_member_id
    {
        return Err(FamilyDeliveryError::AudienceDenied);
    }
    let review =
        family_snapshot::stage_snapshot_set(connection, &input.household_id, &input.package_bytes)
            .map_err(|error| match error {
                family_snapshot::FamilySnapshotError::ReviewPending => {
                    FamilyDeliveryError::ReviewPending
                }
                family_snapshot::FamilySnapshotError::AudienceBlocked => {
                    FamilyDeliveryError::AudienceDenied
                }
                _ => FamilyDeliveryError::Snapshot,
            })?;
    let inbound_state = if review.state == "READY" {
        "READY_TO_APPLY"
    } else {
        "WAITING_FOR_REVIEW"
    };
    connection.execute("UPDATE family_delivery_inbound SET state=?1,staged_snapshot_set_id=?2 WHERE artifact_id=?3",params![inbound_state,review.snapshot_set_id,input.artifact_id])?;
    Ok(review)
}

pub fn update_review_state(
    connection: &Connection,
    snapshot_set_id: &str,
    state: &str,
) -> Result<()> {
    if !valid_id(snapshot_set_id)
        || !matches!(state, "WAITING_FOR_REVIEW" | "READY_TO_APPLY" | "APPLIED")
    {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    connection.execute(
        "UPDATE family_delivery_inbound SET state=?1 WHERE staged_snapshot_set_id=?2",
        params![state, snapshot_set_id],
    )?;
    Ok(())
}

pub fn discard_review(connection: &Connection, snapshot_set_id: &str) -> Result<()> {
    connection.execute("UPDATE family_delivery_inbound SET state='AVAILABLE',staged_snapshot_set_id=NULL WHERE staged_snapshot_set_id=?1",[snapshot_set_id])?;
    Ok(())
}

pub fn active_ui_review(
    connection: &Connection,
    household_id: &str,
) -> Result<Option<FamilySnapshotUiReviewDto>> {
    let review = family_snapshot::get_active_review(connection, household_id)
        .map_err(|_| FamilyDeliveryError::Snapshot)?;
    review.map(|item| ui_review(connection, &item)).transpose()
}

pub fn resolve_ui_review(
    connection: &Connection,
    package_id: &str,
    resolutions: &[FamilySnapshotUiResolutionInput],
) -> Result<FamilySnapshotUiReviewDto> {
    if !valid_id(package_id) || resolutions.is_empty() {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let household_id: String = connection
        .query_row(
            "SELECT target_household_id FROM family_snapshot_sets WHERE snapshot_set_id=?1",
            [package_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(FamilyDeliveryError::InvalidInput)?;
    let current = family_snapshot::get_active_review(connection, &household_id)
        .map_err(|_| FamilyDeliveryError::Snapshot)?
        .ok_or(FamilyDeliveryError::InvalidInput)?;
    if current.snapshot_set_id != package_id {
        return Err(FamilyDeliveryError::Conflict);
    }
    let mut keys = BTreeSet::new();
    let native = resolutions
        .iter()
        .map(|resolution| {
            if !valid_id(&resolution.entity_id)
                || !matches!(
                    resolution.resolution.as_str(),
                    "APPLY_INCOMING" | "KEEP_LOCAL"
                )
                || !keys.insert((
                    resolution.entity_kind.as_str(),
                    resolution.entity_id.as_str(),
                ))
            {
                return Err(FamilyDeliveryError::InvalidInput);
            }
            let record = current
                .records
                .iter()
                .find(|record| {
                    record.entity_kind == resolution.entity_kind
                        && record.entity_id == resolution.entity_id
                        && record.resolution == "PENDING"
                })
                .ok_or(FamilyDeliveryError::Conflict)?;
            Ok(family_snapshot::FamilySnapshotResolutionInput {
                partition_order: record.partition_order,
                entity_kind: resolution.entity_kind.clone(),
                entity_id: resolution.entity_id.clone(),
                resolution: resolution.resolution.clone(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let review = family_snapshot::resolve_snapshot_set(connection, package_id, &native)
        .map_err(|_| FamilyDeliveryError::Snapshot)?;
    update_review_state(
        connection,
        package_id,
        if review.state == "READY" {
            "READY_TO_APPLY"
        } else {
            "WAITING_FOR_REVIEW"
        },
    )?;
    ui_review(connection, &review)
}

pub fn apply_ui_review(
    connection: &Connection,
    package_id: &str,
) -> Result<FamilySnapshotUiReviewDto> {
    let review = family_snapshot::apply_snapshot_set(connection, package_id)
        .map_err(|_| FamilyDeliveryError::Snapshot)?;
    update_review_state(connection, package_id, "APPLIED")?;
    ui_review(connection, &review)
}

pub fn discard_ui_review(connection: &Connection, package_id: &str) -> Result<()> {
    if !valid_id(package_id) {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    discard_review(connection, package_id)?;
    family_snapshot::discard_snapshot_set(connection, package_id)
        .map_err(|_| FamilyDeliveryError::Snapshot)
}

fn ui_review(
    connection: &Connection,
    review: &family_snapshot::FamilySnapshotReviewDto,
) -> Result<FamilySnapshotUiReviewDto> {
    let source = connection
        .query_row(
            "SELECT i.sender_member_name,p.visibility,p.member_id,i.member_name
         FROM family_delivery_inbound i
         JOIN family_snapshot_partitions p ON p.snapshot_set_id=i.staged_snapshot_set_id
         WHERE i.staged_snapshot_set_id=?1 ORDER BY p.partition_order LIMIT 1",
            [&review.snapshot_set_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?
        .ok_or(FamilyDeliveryError::Conflict)?;
    if (source.1 == "SHARED") != source.2.is_none() {
        return Err(FamilyDeliveryError::Conflict);
    }
    let records = review
        .records
        .iter()
        .filter(|record| record.review_state != "UNCHANGED")
        .map(|record| {
            Ok(FamilySnapshotUiRecordDto {
                record_order: record.record_order,
                entity_kind: record.entity_kind.clone(),
                entity_id: record.entity_id.clone(),
                entity_label: format!(
                    "{}・{}",
                    entity_kind_label(&record.entity_kind),
                    record.entity_id
                ),
                operation: record.operation.clone(),
                review_state: record.review_state.clone(),
                resolution: record.resolution.clone(),
                local_summary: record
                    .current_payload_sha256
                    .as_ref()
                    .map(|_| "この端末に既存データがあります".to_owned()),
                incoming_summary: if record.operation == "DELETE" {
                    "受信した現在状態には含まれていません".to_owned()
                } else {
                    format!("受信した{}データ", entity_kind_label(&record.entity_kind))
                },
                domain: entity_domain(&record.entity_kind).to_owned(),
                entity_summary: review_entity_summary(
                    connection,
                    &review.snapshot_set_id,
                    record.record_order,
                    &record.entity_kind,
                    &record.entity_id,
                )?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let create_count = records
        .iter()
        .filter(|r| r.review_state == "CREATE")
        .count() as u64;
    let update_count = records
        .iter()
        .filter(|r| r.review_state == "UPDATE")
        .count() as u64;
    let delete_count = records
        .iter()
        .filter(|r| r.review_state == "DELETE")
        .count() as u64;
    let conflict_count = records
        .iter()
        .filter(|r| r.review_state == "CONFLICT")
        .count() as u64;
    Ok(FamilySnapshotUiReviewDto {
        package_id: review.snapshot_set_id.clone(),
        household_id: review.target_household_id.clone(),
        sender_member_name: source.0,
        audience_visibility: source.1,
        audience_member_name: source.3,
        state: review.state.clone(),
        record_count: records.len() as u64,
        create_count,
        update_count,
        delete_count,
        conflict_count,
        records,
    })
}

fn entity_kind_label(kind: &str) -> &'static str {
    match kind {
        "HOUSEHOLD" => "世帯",
        "HOUSEHOLD_MEMBER" => "メンバー",
        "ACCOUNT" => "口座",
        "TRANSACTION" => "取引",
        "MONTHLY_BUDGET_PLAN" => "月次予算",
        "SAVINGS_GOAL" => "貯蓄目標",
        "CLASSIFICATION_RULE" => "分類ルール",
        "ACCOUNT_GROUP" => "口座グループ",
        "CARD_SETTLEMENT_MAPPING" => "カード引落口座",
        "DASHBOARD_PREFERENCES" => "ダッシュボード設定",
        "DELIMITED_PARSER_PROFILE" => "CSV解析設定",
        _ => "データ",
    }
}

fn entity_domain(kind: &str) -> &'static str {
    match kind {
        "MONTHLY_BUDGET_PLAN" | "SAVINGS_GOAL" => "PLANNING",
        "CLASSIFICATION_RULE"
        | "ACCOUNT_GROUP"
        | "CARD_SETTLEMENT_MAPPING"
        | "DASHBOARD_PREFERENCES"
        | "DELIMITED_PARSER_PROFILE" => "CONFIG",
        _ => "LEDGER",
    }
}

fn review_entity_summary(
    connection: &Connection,
    snapshot_set_id: &str,
    record_order: u64,
    kind: &str,
    entity_id: &str,
) -> Result<String> {
    let payload: String = connection.query_row(
        "SELECT canonical_payload_json FROM family_snapshot_records
         WHERE snapshot_set_id=?1 AND record_order=?2",
        params![snapshot_set_id, record_order],
        |row| row.get(0),
    )?;
    let value: serde_json::Value =
        serde_json::from_str(&payload).map_err(|_| FamilyDeliveryError::Conflict)?;
    let text = match kind {
        "MONTHLY_BUDGET_PLAN" => {
            let budgets = value
                .get("budgets")
                .and_then(|v| v.as_array())
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let first = budgets
                .first()
                .and_then(|v| v.get("month"))
                .and_then(|v| v.as_str());
            let last = budgets
                .last()
                .and_then(|v| v.get("month"))
                .and_then(|v| v.as_str());
            format!(
                "{}件・{}〜{}",
                budgets.len(),
                first.unwrap_or("—"),
                last.unwrap_or("—")
            )
        }
        "SAVINGS_GOAL" => format!(
            "{}・¥{}/¥{}",
            value
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(entity_id),
            value.get("savedJpy").and_then(|v| v.as_i64()).unwrap_or(0),
            value.get("targetJpy").and_then(|v| v.as_i64()).unwrap_or(0)
        ),
        "CLASSIFICATION_RULE" => value
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(entity_id)
            .to_owned(),
        "ACCOUNT_GROUP" => format!(
            "{}・{}口座",
            value
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(entity_id),
            value
                .get("members")
                .and_then(|v| v.as_array())
                .map(Vec::len)
                .unwrap_or(0)
        ),
        "CARD_SETTLEMENT_MAPPING" => format!(
            "{} → {}",
            value
                .get("cardAccountId")
                .and_then(|v| v.as_str())
                .unwrap_or("—"),
            value
                .get("bankAccountId")
                .and_then(|v| v.as_str())
                .unwrap_or("—")
        ),
        "DASHBOARD_PREFERENCES" => format!(
            "{}・{}・{}",
            value
                .get("dashboardTemplate")
                .and_then(|v| v.as_str())
                .unwrap_or("—"),
            value.get("theme").and_then(|v| v.as_str()).unwrap_or("—"),
            value.get("density").and_then(|v| v.as_str()).unwrap_or("—")
        ),
        "DELIMITED_PARSER_PROFILE" => format!(
            "{}・v{}",
            value
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(entity_id),
            value.get("version").and_then(|v| v.as_i64()).unwrap_or(0)
        ),
        _ => format!("{}・{}", entity_kind_label(kind), entity_id),
    };
    Ok(text.chars().take(240).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        persistence::{AppState, PersistenceError},
        read_model::{
            create_household, create_household_member, CreateHouseholdInput,
            CreateHouseholdMemberInput,
        },
    };

    fn setup(key: u8) -> AppState {
        let state = AppState::in_memory(&[key; 32]).unwrap();
        state
            .with_connection(|connection| {
                create_household(
                    connection,
                    &CreateHouseholdInput {
                        id: "family".into(),
                        name: "Family".into(),
                    },
                )
                .unwrap();
                create_household_member(
                    connection,
                    &CreateHouseholdMemberInput {
                        id: "member-a".into(),
                        household_id: "family".into(),
                        display_name: "A".into(),
                        relationship_label: None,
                    },
                )
                .unwrap();
                sync_foundation::get_local_status(connection, "family").unwrap();
                sync_foundation::update_principal_member_binding(
                    connection,
                    &sync_foundation::UpdatePrincipalMemberBindingInput {
                        household_id: "family".into(),
                        principal_id: sync_foundation::get_local_status(connection, "family")
                            .unwrap()
                            .principal
                            .id,
                        member_id: Some("member-a".into()),
                        mutation_id: "bind-member-a".into(),
                    },
                )
                .unwrap();
                Ok(())
            })
            .unwrap();
        state
    }
    fn memberships() -> Vec<FamilyMembershipDto> {
        vec![FamilyMembershipDto {
            member_id: "member-a".into(),
            member_name: "A".into(),
            state: "ACTIVE".into(),
            remote_membership_ids: vec!["membership-a".into(), "membership-a-device-2".into()],
            invite_id: None,
            invite_expires_at: None,
            device_count: 2,
            last_delivery_at: None,
        }]
    }
    fn connect(connection: &Connection) {
        save_connection(
            connection,
            &SaveFamilyConnectionInput {
                household_id: "family".into(),
                endpoint: "https://relay.example".into(),
                remote_principal_id: "principal-a".into(),
                local_member_id: Some("member-a".into()),
                local_member_name: Some("A".into()),
                memberships: memberships(),
            },
        )
        .unwrap();
    }

    #[test]
    fn failed_delivery_retries_exact_partition_bytes() {
        let state = setup(1);
        state
            .with_connection(|connection| {
                connect(connection);
                let first = prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into()],
                    },
                )
                .unwrap();
                mark_failed(connection, "family", &[first[0].delivery_id.clone()]).unwrap();
                let retry = prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into()],
                    },
                )
                .unwrap();
                assert_eq!(first, retry);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn accepted_v1_preserves_unknown_lineage_until_v2_is_accepted() {
        let state = setup(15);
        state
            .with_connection(|connection| {
                connect(connection);
                connection.execute(
                    "INSERT INTO family_delivery_outbound_lineage_state(
                       household_id,audience_key,state,updated_at)
                     VALUES('family','SHARED','LEGACY_UNKNOWN','2026-07-13T00:00:00Z')
                     ON CONFLICT(household_id,audience_key) DO UPDATE SET
                       state='LEGACY_UNKNOWN',updated_at=excluded.updated_at",
                    [],
                )?;

                let transaction = connection.unchecked_transaction()?;
                mark_v2_outbound_lineage_tracked(
                    &transaction,
                    "family",
                    "SHARED",
                    "2026-07-14T00:00:00Z",
                    1,
                )
                .unwrap();
                transaction.commit()?;
                let after_v1: String = connection.query_row(
                    "SELECT state FROM family_delivery_outbound_lineage_state
                     WHERE household_id='family' AND audience_key='SHARED'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(after_v1, "LEGACY_UNKNOWN");

                let transaction = connection.unchecked_transaction()?;
                mark_v2_outbound_lineage_tracked(
                    &transaction,
                    "family",
                    "SHARED",
                    "2026-07-14T00:01:00Z",
                    2,
                )
                .unwrap();
                transaction.commit()?;
                let after_v2: String = connection.query_row(
                    "SELECT state FROM family_delivery_outbound_lineage_state
                     WHERE household_id='family' AND audience_key='SHARED'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(after_v2, "V2_TRACKED");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn accepted_partition_becomes_ready_after_a_new_local_change() {
        let state = setup(7);
        state
            .with_connection(|connection| {
                connect(connection);
                let first = prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into()],
                    },
                )
                .unwrap()
                .remove(0);
                mark_accepted(
                    connection,
                    &AcceptFamilyDeliveryInput {
                        household_id: "family".into(),
                        receipts: vec![AcceptanceReceiptInput {
                            delivery_id: first.delivery_id.clone(),
                            artifact_id: first.artifact_id.clone(),
                            digest: first.digest.clone(),
                            accepted_at: "2026-07-14T00:00:00Z".into(),
                        }],
                    },
                )
                .unwrap();
                assert!(matches!(
                    prepare_send(
                        connection,
                        &PrepareFamilyDeliveryInput {
                            household_id: "family".into(),
                            audience_keys: vec!["SHARED".into()],
                        }
                    ),
                    Err(FamilyDeliveryError::Snapshot)
                ));
                connection
                    .execute(
                        "UPDATE households SET name='Family changed' WHERE id='family'",
                        [],
                    )
                    .unwrap();
                let next_status = status(connection, "family").unwrap();
                let shared = next_status
                    .outbound
                    .iter()
                    .find(|item| item.audience_key == "SHARED")
                    .unwrap();
                assert_eq!(shared.state, "READY");
                let second = prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into()],
                    },
                )
                .unwrap()
                .remove(0);
                assert_ne!(second.artifact_id, first.artifact_id);
                Ok(())
            })
            .unwrap();
    }

    fn accept_one(connection: &Connection, artifact: &PreparedFamilyArtifactDto, at: &str) {
        mark_accepted(
            connection,
            &AcceptFamilyDeliveryInput {
                household_id: "family".into(),
                receipts: vec![AcceptanceReceiptInput {
                    delivery_id: artifact.delivery_id.clone(),
                    artifact_id: artifact.artifact_id.clone(),
                    digest: artifact.digest.clone(),
                    accepted_at: at.into(),
                }],
            },
        )
        .unwrap();
    }

    #[test]
    fn status_preview_reports_truthful_planning_configuration_and_coverage() {
        let state = setup(13);
        state
            .with_connection(|connection| {
                connect(connection);
                connection.execute(
                    "INSERT INTO savings_goals(id,household_id,name,target_jpy,saved_jpy,target_date)
                     VALUES('goal','family','Emergency',100000,10000,'2027-01-01')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO dashboard_preferences(household_id,dashboard_template,theme,density)
                     VALUES('family','FINANCIAL_OVERVIEW','DARK','COMPACT')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,currency,
                       ownership_kind,visibility) VALUES(
                       'card','family','Card','LIABILITY','CREDIT_CARD','JPY','HOUSEHOLD','SHARED')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO card_statements(id,household_id,card_account_id,period_start,
                       period_end,statement_amount_jpy)
                     VALUES('statement','family','card','2026-06-01','2026-06-30',1000)",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO investment_fx_rates(id,household_id,rate_date,base_currency,
                       quote_currency,rate,source_kind,provider,observed_at)
                     VALUES('fx','family','2026-07-14','USD','JPY',150,'MANUAL','User',
                       '2026-07-14T00:00:00Z')",
                    [],
                )?;
                let current = status(connection, "family").unwrap();
                let shared = current
                    .outbound
                    .iter()
                    .find(|partition| partition.audience_visibility == "SHARED")
                    .unwrap();
                assert!(shared.domain_counts["PLANNING"] >= 2);
                assert!(shared.domain_counts["CONFIG"] >= 1);
                assert_eq!(shared.domain_counts["CARD"], 1);
                assert_eq!(shared.domain_counts["INVESTMENT"], 1);
                assert_eq!(current.withheld_counts_by_reason["EVIDENCE_REQUIRED_CARD"], 1);
                assert_eq!(
                    current.withheld_counts_by_reason["EVIDENCE_REQUIRED_INVESTMENT"],
                    1
                );
                assert_eq!(
                    current.withheld_change_count,
                    current.withheld_counts_by_reason.values().sum::<u64>()
                );
                assert_eq!(shared.coverage_state, "PARTIAL");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn accepted_relocation_head_persists_without_leaking_never_shared_personal_ids() {
        let state = setup(14);
        state
            .with_connection(|connection| {
                connect(connection);
                connection.execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,currency,
                       ownership_kind,visibility) VALUES(
                       'moving','family','Moving','EXPENSE','OTHER','JPY','HOUSEHOLD','SHARED')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO monthly_category_budgets(household_id,month,category_account_id,budget_jpy)
                     VALUES('family','2026-07','moving',1000)",
                    [],
                )?;
                let first = prepare_send(connection, &PrepareFamilyDeliveryInput {
                    household_id:"family".into(),audience_keys:vec!["SHARED".into()]
                }).unwrap();
                accept_one(connection,&first[0],"2026-07-14T00:00:00Z");
                connection.execute(
                    "UPDATE accounts SET owner_member_id='member-a',ownership_kind='MEMBER',
                       visibility='PERSONAL' WHERE id='moving'",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,currency,
                       owner_member_id,ownership_kind,visibility) VALUES(
                       'never-shared-private','family','Private','EXPENSE','OTHER','JPY',
                       'member-a','MEMBER','PERSONAL')",
                    [],
                )?;
                let moved = prepare_send(connection, &PrepareFamilyDeliveryInput {
                    household_id:"family".into(),audience_keys:vec!["SHARED".into()]
                }).unwrap();
                let moved_set = family_snapshot::decode_and_validate(&moved[0].package_bytes).unwrap();
                assert!(moved_set.partitions[0].relocations.iter().any(|r|r.entity_id=="moving"));
                assert!(!String::from_utf8(moved[0].package_bytes.clone()).unwrap().contains("never-shared-private"));
                accept_one(connection,&moved[0],"2026-07-14T00:01:00Z");
                connection.execute(
                    "INSERT INTO savings_goals(id,household_id,name,target_jpy,target_date)
                     VALUES('later-goal','family','Later',1000,'2027-01-01')",
                    [],
                )?;
                let later = prepare_send(connection, &PrepareFamilyDeliveryInput {
                    household_id:"family".into(),audience_keys:vec!["SHARED".into()]
                }).unwrap();
                let later_set = family_snapshot::decode_and_validate(&later[0].package_bytes).unwrap();
                assert!(later_set.partitions[0].relocations.iter().any(|r|r.entity_id=="moving"));
                assert!(!String::from_utf8(later[0].package_bytes.clone()).unwrap().contains("never-shared-private"));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn inbound_binds_outer_metadata_sender_and_inner_partition() {
        let source = setup(2);
        let prepared = source
            .with_connection(|connection| {
                connect(connection);
                prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into()],
                    },
                )
                .map_err(|_| PersistenceError::Lock)
            })
            .unwrap()
            .remove(0);
        let target = setup(3);
        target
            .with_connection(|connection| {
                connect(connection);
                register_inbound(
                    connection,
                    &RegisterFamilyInboundInput {
                        household_id: "family".into(),
                        artifacts: vec![RemoteFamilyArtifactInput {
                            sequence: 1,
                            artifact_id: prepared.artifact_id.clone(),
                            digest: prepared.digest.clone(),
                            created_at: "2026-07-14T00:00:00Z".into(),
                            origin_device_id: prepared.origin_device_id.clone(),
                            sender_membership_id: "membership-a-device-2".into(),
                            audience_visibility: "SHARED".into(),
                            audience_member_id: None,
                            byte_size: prepared.package_bytes.len() as u64,
                            artifact_schema: ARTIFACT_SCHEMA.into(),
                        }],
                        next_cursor: 1,
                    },
                )
                .unwrap();
                let review = stage_inbound(
                    connection,
                    &StageFamilyInboundInput {
                        household_id: "family".into(),
                        artifact_id: prepared.artifact_id,
                        package_bytes: prepared.package_bytes,
                    },
                )
                .unwrap();
                assert!(matches!(review.state.as_str(), "READY" | "REVIEW_REQUIRED"));
                let ui = active_ui_review(connection, "family").unwrap().unwrap();
                let value = serde_json::to_value(&ui).unwrap();
                assert_eq!(value["packageId"], review.snapshot_set_id);
                assert_eq!(value["householdId"], "family");
                assert_eq!(value["senderMemberName"], "A");
                assert_eq!(value["audienceVisibility"], "SHARED");
                assert_eq!(value["recordCount"].as_u64(), Some(ui.records.len() as u64));
                assert!(ui
                    .records
                    .iter()
                    .all(|record| record.review_state != "UNCHANGED"));
                let pending = ui
                    .records
                    .iter()
                    .filter(|record| record.resolution == "PENDING")
                    .map(|record| FamilySnapshotUiResolutionInput {
                        entity_kind: record.entity_kind.clone(),
                        entity_id: record.entity_id.clone(),
                        resolution: "KEEP_LOCAL".into(),
                    })
                    .collect::<Vec<_>>();
                let ready = if pending.is_empty() {
                    ui
                } else {
                    resolve_ui_review(connection, &review.snapshot_set_id, &pending).unwrap()
                };
                assert_eq!(ready.state, "READY");
                let applied = apply_ui_review(connection, &review.snapshot_set_id).unwrap();
                assert_eq!(applied.state, "APPLIED");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn empty_inbound_page_advances_cursor() {
        let state = setup(4);
        state
            .with_connection(|connection| {
                connect(connection);
                let status = register_inbound(
                    connection,
                    &RegisterFamilyInboundInput {
                        household_id: "family".into(),
                        artifacts: vec![],
                        next_cursor: 42,
                    },
                )
                .unwrap();
                assert_eq!(status.inbound_cursor, 42);
                assert!(status.inbound.is_empty());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn outer_audience_mismatch_is_rejected_and_review_can_be_discarded() {
        let source = setup(5);
        let prepared = source
            .with_connection(|connection| {
                connect(connection);
                prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into()],
                    },
                )
                .map_err(|_| PersistenceError::Lock)
            })
            .unwrap()
            .remove(0);
        let target = setup(6);
        target.with_connection(|connection| {
            connect(connection);
            register_inbound(connection, &RegisterFamilyInboundInput {
                household_id: "family".into(), next_cursor: 1,
                artifacts: vec![RemoteFamilyArtifactInput { sequence: 1, artifact_id: prepared.artifact_id.clone(), digest: prepared.digest.clone(),
                    created_at: "2026-07-14T00:00:00Z".into(), origin_device_id: prepared.origin_device_id.clone(),
                    sender_membership_id: "membership-a".into(), audience_visibility: "PERSONAL".into(), audience_member_id: Some("member-a".into()),
                    byte_size: prepared.package_bytes.len() as u64, artifact_schema: ARTIFACT_SCHEMA.into() }],
            }).unwrap();
            assert!(matches!(stage_inbound(connection, &StageFamilyInboundInput { household_id: "family".into(), artifact_id: prepared.artifact_id.clone(), package_bytes: prepared.package_bytes.clone() }), Err(FamilyDeliveryError::AudienceDenied)));
            let staged: i64 = connection.query_row("SELECT count(*) FROM family_snapshot_sets", [], |row| row.get(0)).unwrap();
            assert_eq!(staged, 0);
            connection.execute("UPDATE family_delivery_inbound SET visibility='SHARED',member_id=NULL,member_key='',member_name=NULL WHERE artifact_id=?1", [&prepared.artifact_id]).unwrap();
            let review = stage_inbound(connection, &StageFamilyInboundInput { household_id: "family".into(), artifact_id: prepared.artifact_id, package_bytes: prepared.package_bytes }).unwrap();
            discard_ui_review(connection, &review.snapshot_set_id).unwrap();
            assert!(active_ui_review(connection, "family").unwrap().is_none());
            Ok(())
        }).unwrap();
    }
}
