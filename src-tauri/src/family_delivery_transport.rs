use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{document_vault::DocumentVault, family_evidence, family_snapshot, sync_foundation};

const MAX_ID: usize = 128;
const MAX_ARTIFACTS: usize = 1_000;
const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
const ARTIFACT_SCHEMA_V1: &str = "FAMILY_AUDIENCE_PARTITION_V1";
const ARTIFACT_SCHEMA_V2: &str = "FAMILY_AUDIENCE_PARTITION_V2";
const ARTIFACT_SCHEMA: &str = "FAMILY_AUDIENCE_PARTITION_V3";

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
    pub withheld_domain_counts: BTreeMap<String, u64>,
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
    pub envelope_schema: Option<String>,
    pub transport_digest: Option<String>,
    pub inner_digest: Option<String>,
    pub recipient_set_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CachedOutboundEnvelopeDto {
    pub delivery_id: String,
    pub envelope_schema: String,
    pub transport_sha256: String,
    pub inner_sha256: String,
    pub recipient_set_digest: String,
    pub envelope_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CacheOutboundEnvelopeInput {
    pub delivery_id: String,
    pub envelope_schema: String,
    pub transport_sha256: String,
    pub inner_sha256: String,
    pub recipient_set_digest: String,
    pub envelope_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RejectedRecipientSetDeliveryInput {
    pub delivery_id: String,
    pub transport_sha256: String,
    pub recipient_set_digest: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResetRejectedRecipientSetsInput {
    pub household_id: String,
    pub deliveries: Vec<RejectedRecipientSetDeliveryInput>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InboundTransportMetadataDto {
    pub artifact_id: String,
    pub household_id: String,
    pub origin_device_id: String,
    pub state: String,
    pub envelope_schema: Option<String>,
    pub transport_sha256: String,
    pub inner_sha256: String,
    pub recipient_set_digest: Option<String>,
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
    pub evidence_file_count: u64,
    pub evidence_record_count: u64,
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

struct RemoteTransportDigests<'a> {
    inner: &'a str,
    envelope_schema: Option<&'a str>,
    transport: Option<&'a str>,
    recipient_set: Option<&'a str>,
}

fn remote_transport_digests(
    artifact: &RemoteFamilyArtifactInput,
) -> Result<RemoteTransportDigests<'_>> {
    match (
        artifact.envelope_schema.as_deref(),
        artifact.transport_digest.as_deref(),
        artifact.inner_digest.as_deref(),
        artifact.recipient_set_digest.as_deref(),
    ) {
        (None, None, None, None) => Ok(RemoteTransportDigests {
            inner: &artifact.digest,
            envelope_schema: None,
            transport: None,
            recipient_set: None,
        }),
        (Some(schema), Some(transport), Some(inner), Some(recipient_set))
            if valid_id(schema)
                && valid_digest(transport)
                && valid_digest(inner)
                && valid_digest(recipient_set)
                && artifact.digest == transport =>
        {
            Ok(RemoteTransportDigests {
                inner,
                envelope_schema: Some(schema),
                transport: Some(transport),
                recipient_set: Some(recipient_set),
            })
        }
        _ => Err(FamilyDeliveryError::InvalidInput),
    }
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
    status_inner(connection, None, household_id)
}

pub fn status_with_vault(
    connection: &Connection,
    vault: &DocumentVault,
    household_id: &str,
) -> Result<FamilyDeliveryStatusDto> {
    status_inner(connection, Some(vault), household_id)
}

fn status_inner(
    connection: &Connection,
    vault: Option<&DocumentVault>,
    household_id: &str,
) -> Result<FamilyDeliveryStatusDto> {
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
    let (preview, withheld_by_audience, withheld_domains_by_audience) = if let Some(vault) = vault {
        let base = family_snapshot::export_snapshot_set(connection, household_id)
            .map_err(|_| FamilyDeliveryError::Snapshot)?;
        let prepared = family_evidence::prepare(connection, vault, base)
            .map_err(|_| FamilyDeliveryError::Snapshot)?;
        (
            prepared.set,
            prepared.withheld_counts_by_audience,
            prepared.withheld_domains_by_audience,
        )
    } else {
        let preview = family_snapshot::preview_snapshot_set(connection, household_id)
            .map_err(|_| FamilyDeliveryError::Snapshot)?;
        let mut reasons = BTreeMap::new();
        reasons.insert(
            "SHARED".to_owned(),
            preview.excluded_counts_by_reason.clone(),
        );
        let mut domains = BTreeMap::new();
        let mut legacy_domains = empty_domain_counts();
        legacy_domains.insert(
            "LEDGER".to_owned(),
            preview.excluded_counts_by_reason.values().sum(),
        );
        domains.insert("SHARED".to_owned(), legacy_domains);
        (preview, reasons, domains)
    };
    let withheld_counts_by_reason = preview.excluded_counts_by_reason.clone();
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
            let preview_partition = preview.partitions.iter().find(|partition| {
                partition.audience.visibility == visibility && partition.audience.member_id == member_id
            });
            let domain_counts = preview_partition.map(|partition| {
                let mut counts = empty_domain_counts();
                for record in &partition.records {
                    *counts.entry(entity_domain(&record.entity_kind).to_owned()).or_default() += 1;
                }
                counts
            }).unwrap_or_else(empty_domain_counts);
            let evidence_file_count = preview_partition.map(|p| p.evidence_file_count).unwrap_or(0);
            let evidence_record_count = preview_partition.map(|p| p.evidence_record_count).unwrap_or(0);
            let partition_reasons = withheld_by_audience.get(&key).cloned().unwrap_or_else(empty_withheld_counts);
            let withheld_domain_counts = withheld_domains_by_audience.get(&key).cloned().unwrap_or_else(empty_domain_counts);
            let coverage_state = if partition_reasons.values().sum::<u64>() == 0 { "COMPLETE" } else { "PARTIAL" };
            Ok(FamilyPartitionStatusDto { audience_key:key,audience_visibility:visibility,audience_member_id:member_id,
                audience_member_name:member_name,recipient_names:recipients,pending_change_count:pending,state:outbound_state,
                withheld_reason:if dirty != 0 && !prepared_before { Some("件数は送信準備時に確定します".to_owned()) } else { None },
                domain_counts,withheld_domain_counts,evidence_file_count,evidence_record_count,
                withheld_counts_by_reason:partition_reasons,coverage_state:coverage_state.to_owned() })
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

pub fn prepare_send_with_vault(
    connection: &Connection,
    vault: &DocumentVault,
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
    let base = family_snapshot::export_snapshot_set(connection, &input.household_id)
        .map_err(|_| FamilyDeliveryError::Snapshot)?;
    let prepared_evidence = family_evidence::prepare(connection, vault, base)
        .map_err(|_| FamilyDeliveryError::Snapshot)?;
    let set = &prepared_evidence.set;
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
        let bytes = family_evidence::encode(&prepared_evidence, &partition.audience)
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

#[cfg(test)]
fn prepare_send(
    connection: &Connection,
    input: &PrepareFamilyDeliveryInput,
) -> Result<Vec<PreparedFamilyArtifactDto>> {
    let root = tempfile::tempdir().map_err(|_| FamilyDeliveryError::Snapshot)?;
    let vault =
        DocumentVault::new(root.path(), &[91_u8; 32]).map_err(|_| FamilyDeliveryError::Snapshot)?;
    prepare_send_with_vault(connection, &vault, input)
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
    let set = if delivery.artifact_schema == ARTIFACT_SCHEMA {
        family_evidence::decode(&delivery.package_bytes)
            .map_err(|_| FamilyDeliveryError::Conflict)?
            .set
    } else {
        family_snapshot::decode_and_validate(&delivery.package_bytes)
            .map_err(|_| FamilyDeliveryError::Conflict)?
    };
    let Some(partition) = set.partitions.first() else {
        return Err(FamilyDeliveryError::Conflict);
    };
    if set.partitions.len() != 1
        || set.household_id != delivery.household_id
        || set.source_installation_id != delivery.origin_device_id
        || partition.package_id != delivery.artifact_id
        || partition.audience.visibility != delivery.audience_visibility
        || partition.audience.member_id != delivery.audience_member_id
        || delivery.artifact_schema != artifact_schema(set.schema_version)
    {
        return Err(FamilyDeliveryError::Conflict);
    }
    Ok(Some(delivery))
}

pub fn load_prepared_artifact(
    connection: &Connection,
    delivery_id: &str,
) -> Result<Option<PreparedFamilyArtifactDto>> {
    if !valid_id(delivery_id) {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    load_delivery(connection, delivery_id)
}

pub fn load_cached_outbound_envelope(
    connection: &Connection,
    delivery_id: &str,
    inner_sha256: &str,
    recipient_set_digest: &str,
) -> Result<Option<CachedOutboundEnvelopeDto>> {
    if !valid_id(delivery_id) || !valid_digest(inner_sha256) || !valid_digest(recipient_set_digest)
    {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let cached = connection
        .query_row(
            "SELECT delivery_id,envelope_schema,transport_sha256,package_sha256,
                    recipient_set_digest,envelope_bytes,package_bytes
             FROM family_delivery_deliveries
             WHERE delivery_id=?1 AND package_sha256=?2 AND recipient_set_digest=?3
               AND state IN ('SENDING','FAILED_RETRYABLE') AND envelope_bytes IS NOT NULL",
            params![delivery_id, inner_sha256, recipient_set_digest],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<Vec<u8>>>(5)?,
                    row.get::<_, Option<Vec<u8>>>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((delivery_id, schema, transport, inner, recipient_set, envelope, package)) = cached
    else {
        return Ok(None);
    };
    let (Some(schema), Some(transport), Some(recipient_set), Some(envelope), Some(package)) =
        (schema, transport, recipient_set, envelope, package)
    else {
        return Err(FamilyDeliveryError::Conflict);
    };
    if !valid_id(&schema)
        || !valid_digest(&transport)
        || !valid_digest(&inner)
        || !valid_digest(&recipient_set)
        || digest(&envelope) != transport
        || digest(&package) != inner
    {
        return Err(FamilyDeliveryError::Conflict);
    }
    Ok(Some(CachedOutboundEnvelopeDto {
        delivery_id,
        envelope_schema: schema,
        transport_sha256: transport,
        inner_sha256: inner,
        recipient_set_digest: recipient_set,
        envelope_bytes: envelope,
    }))
}

pub fn load_any_cached_outbound_envelope(
    connection: &Connection,
    delivery_id: &str,
    inner_sha256: &str,
) -> Result<Option<CachedOutboundEnvelopeDto>> {
    if !valid_id(delivery_id) || !valid_digest(inner_sha256) {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let recipient_set_digest = connection
        .query_row(
            "SELECT recipient_set_digest FROM family_delivery_deliveries
             WHERE delivery_id=?1 AND package_sha256=?2
               AND state IN ('SENDING','FAILED_RETRYABLE')
               AND envelope_bytes IS NOT NULL",
            params![delivery_id, inner_sha256],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let Some(recipient_set_digest) = recipient_set_digest else {
        return Ok(None);
    };
    if !valid_digest(&recipient_set_digest) {
        return Err(FamilyDeliveryError::Conflict);
    }
    load_cached_outbound_envelope(connection, delivery_id, inner_sha256, &recipient_set_digest)
}

pub fn cache_outbound_envelope(
    connection: &Connection,
    input: &CacheOutboundEnvelopeInput,
) -> Result<CachedOutboundEnvelopeDto> {
    if !valid_id(&input.delivery_id)
        || !valid_id(&input.envelope_schema)
        || !valid_digest(&input.transport_sha256)
        || !valid_digest(&input.inner_sha256)
        || !valid_digest(&input.recipient_set_digest)
        || input.envelope_bytes.is_empty()
        || input.envelope_bytes.len() > MAX_PACKAGE_BYTES
        || digest(&input.envelope_bytes) != input.transport_sha256
    {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    let delivery = transaction
        .query_row(
            "SELECT package_sha256,package_bytes,state,envelope_schema,transport_sha256,
                    recipient_set_digest,envelope_bytes FROM family_delivery_deliveries
             WHERE delivery_id=?1",
            [&input.delivery_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<Vec<u8>>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<Vec<u8>>>(6)?,
                ))
            },
        )
        .optional()?
        .ok_or(FamilyDeliveryError::Conflict)?;
    let package = delivery.1.as_deref().ok_or(FamilyDeliveryError::Conflict)?;
    if delivery.0 != input.inner_sha256
        || digest(package) != input.inner_sha256
        || !matches!(delivery.2.as_str(), "SENDING" | "FAILED_RETRYABLE")
    {
        return Err(FamilyDeliveryError::Conflict);
    }
    match (&delivery.3, &delivery.4, &delivery.5, &delivery.6) {
        (None, None, None, None) => {}
        (Some(schema), Some(transport), Some(recipient_set), Some(envelope))
            if schema == &input.envelope_schema
                && transport == &input.transport_sha256
                && recipient_set == &input.recipient_set_digest
                && envelope == &input.envelope_bytes =>
        {
            transaction.commit()?;
            return load_cached_outbound_envelope(
                connection,
                &input.delivery_id,
                &input.inner_sha256,
                &input.recipient_set_digest,
            )?
            .ok_or(FamilyDeliveryError::Conflict);
        }
        _ => return Err(FamilyDeliveryError::Conflict),
    }
    transaction.execute(
        "UPDATE family_delivery_deliveries SET envelope_schema=?1,transport_sha256=?2,
           recipient_set_digest=?3,envelope_bytes=?4 WHERE delivery_id=?5",
        params![
            input.envelope_schema,
            input.transport_sha256,
            input.recipient_set_digest,
            input.envelope_bytes,
            input.delivery_id
        ],
    )?;
    transaction.commit()?;
    load_cached_outbound_envelope(
        connection,
        &input.delivery_id,
        &input.inner_sha256,
        &input.recipient_set_digest,
    )?
    .ok_or(FamilyDeliveryError::Conflict)
}

/// Clears an encrypted envelope only after the relay has explicitly rejected
/// the exact transport/recipient-set tuple that is still cached locally.
///
/// This is intentionally separate from `mark_failed`: ambiguous transport
/// failures must keep the exact envelope bytes for an idempotent retry. The
/// immutable inner package and outbound lineage are never changed here.
pub fn reset_rejected_outbound_envelopes(
    connection: &Connection,
    input: &ResetRejectedRecipientSetsInput,
) -> Result<FamilyDeliveryStatusDto> {
    if !valid_id(&input.household_id)
        || input.deliveries.is_empty()
        || input.deliveries.len() > 2
        || input.deliveries.iter().any(|delivery| {
            !valid_id(&delivery.delivery_id)
                || !valid_digest(&delivery.transport_sha256)
                || !valid_digest(&delivery.recipient_set_digest)
        })
        || input
            .deliveries
            .iter()
            .map(|delivery| delivery.delivery_id.as_str())
            .collect::<BTreeSet<_>>()
            .len()
            != input.deliveries.len()
    {
        return Err(FamilyDeliveryError::InvalidInput);
    }

    let transaction = connection.unchecked_transaction()?;
    let mut needs_reset = Vec::with_capacity(input.deliveries.len());
    for rejected in &input.deliveries {
        let current = transaction
            .query_row(
                "SELECT state,package_sha256,package_bytes,envelope_schema,transport_sha256,
                        recipient_set_digest,envelope_bytes
                 FROM family_delivery_deliveries
                 WHERE household_id=?1 AND delivery_id=?2",
                params![input.household_id, rejected.delivery_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<Vec<u8>>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<Vec<u8>>>(6)?,
                    ))
                },
            )
            .optional()?
            .ok_or(FamilyDeliveryError::Conflict)?;
        let Some(package) = current.2 else {
            return Err(FamilyDeliveryError::Conflict);
        };
        if current.1 != digest(&package) {
            return Err(FamilyDeliveryError::Conflict);
        }
        match (current.3, current.4, current.5, current.6) {
            (None, None, None, None) if current.0 == "FAILED_RETRYABLE" => {
                // The exact reset may already have committed even when its IPC
                // response was lost. Repeating it is a safe, non-destructive
                // success while no replacement tuple has been cached.
                needs_reset.push(false);
            }
            (Some(schema), Some(transport), Some(recipient_set), Some(envelope))
                if matches!(current.0.as_str(), "SENDING" | "FAILED_RETRYABLE")
                    && valid_id(&schema)
                    && transport == rejected.transport_sha256
                    && recipient_set == rejected.recipient_set_digest
                    && transport == digest(&envelope) =>
            {
                needs_reset.push(true);
            }
            _ => return Err(FamilyDeliveryError::Conflict),
        }
    }

    for (rejected, should_reset) in input.deliveries.iter().zip(needs_reset) {
        if !should_reset {
            continue;
        }
        let changed = transaction.execute(
            "UPDATE family_delivery_deliveries
             SET state='FAILED_RETRYABLE',accepted_at=NULL,envelope_schema=NULL,
                 transport_sha256=NULL,recipient_set_digest=NULL,envelope_bytes=NULL
             WHERE household_id=?1 AND delivery_id=?2
               AND state IN ('SENDING','FAILED_RETRYABLE')
               AND transport_sha256=?3 AND recipient_set_digest=?4
               AND package_bytes IS NOT NULL AND envelope_schema IS NOT NULL
               AND envelope_bytes IS NOT NULL",
            params![
                input.household_id,
                rejected.delivery_id,
                rejected.transport_sha256,
                rejected.recipient_set_digest
            ],
        )?;
        if changed != 1 {
            return Err(FamilyDeliveryError::Conflict);
        }
    }
    transaction.commit()?;
    status(connection, &input.household_id)
}

pub fn load_inbound_transport_metadata(
    connection: &Connection,
    household_id: &str,
    artifact_id: &str,
) -> Result<Option<InboundTransportMetadataDto>> {
    if !valid_id(household_id) || !valid_id(artifact_id) {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let metadata = connection
        .query_row(
            "SELECT artifact_id,household_id,origin_device_id,state,envelope_schema,
                    transport_sha256,package_sha256,recipient_set_digest,byte_size,artifact_schema
             FROM family_delivery_inbound WHERE household_id=?1 AND artifact_id=?2
               AND state IN ('AVAILABLE','FAILED_RETRYABLE')",
            params![household_id, artifact_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, u64>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?;
    let Some((
        artifact_id,
        household_id,
        origin_device_id,
        state,
        schema,
        transport,
        inner,
        recipient_set,
        byte_size,
        artifact_schema,
    )) = metadata
    else {
        return Ok(None);
    };
    if !valid_digest(&inner) {
        return Err(FamilyDeliveryError::Conflict);
    }
    let transport_sha256 = match (&schema, &transport, &recipient_set) {
        (None, None, None) => inner.clone(),
        (Some(schema), Some(transport), Some(recipient_set))
            if valid_id(schema) && valid_digest(transport) && valid_digest(recipient_set) =>
        {
            transport.clone()
        }
        _ => return Err(FamilyDeliveryError::Conflict),
    };
    Ok(Some(InboundTransportMetadataDto {
        artifact_id,
        household_id,
        origin_device_id,
        state,
        envelope_schema: schema,
        transport_sha256,
        inner_sha256: inner,
        recipient_set_digest: recipient_set,
        byte_size,
        artifact_schema,
    }))
}

pub fn oldest_encrypted_available(
    connection: &Connection,
    household_id: &str,
) -> Result<Option<InboundTransportMetadataDto>> {
    if !valid_id(household_id) {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let artifact_id = connection
        .query_row(
            "SELECT artifact_id FROM family_delivery_inbound
             WHERE household_id=?1 AND state='AVAILABLE'
               AND envelope_schema='FAMILY_ENCRYPTED_ENVELOPE_V1'
             ORDER BY sequence,artifact_id LIMIT 1",
            [household_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    artifact_id
        .as_deref()
        .map(|id| load_inbound_transport_metadata(connection, household_id, id))
        .transpose()
        .map(Option::flatten)
}

pub fn has_active_review(connection: &Connection, household_id: &str) -> Result<bool> {
    if !valid_id(household_id) {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    Ok(family_snapshot::get_active_review(connection, household_id)
        .map_err(|_| FamilyDeliveryError::Snapshot)?
        .is_some())
}

pub fn reject_inbound(
    connection: &Connection,
    household_id: &str,
    artifact_id: &str,
    state: &str,
) -> Result<()> {
    if !valid_id(household_id)
        || !valid_id(artifact_id)
        || !matches!(state, "REJECTED_INVALID" | "AUDIENCE_DENIED")
    {
        return Err(FamilyDeliveryError::InvalidInput);
    }
    let changed = connection.execute(
        "UPDATE family_delivery_inbound SET state=?3
         WHERE household_id=?1 AND artifact_id=?2 AND state='AVAILABLE'",
        params![household_id, artifact_id, state],
    )?;
    if changed != 1 {
        return Err(FamilyDeliveryError::Conflict);
    }
    Ok(())
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
            "SELECT audience_key,state,artifact_id,package_sha256,package_bytes,transport_sha256 FROM family_delivery_deliveries
             WHERE household_id=?1 AND delivery_id=?2", params![input.household_id,receipt.delivery_id], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,Option<Vec<u8>>>(4)?,row.get::<_,Option<String>>(5)?)),
        ).optional()?.ok_or(FamilyDeliveryError::Conflict)?;
        let receipt_digest = existing.5.as_deref().unwrap_or(&existing.3);
        if existing.2 != receipt.artifact_id || receipt_digest != receipt.digest {
            return Err(FamilyDeliveryError::Conflict);
        }
        if existing.1 != "RELAY_ACCEPTED" {
            let bytes = existing.4.as_deref().ok_or(FamilyDeliveryError::Conflict)?;
            let set = if bytes.starts_with(b"KFF3") {
                family_evidence::decode(bytes)
                    .map_err(|_| FamilyDeliveryError::Conflict)?
                    .set
            } else {
                family_snapshot::decode_and_validate(bytes)
                    .map_err(|_| FamilyDeliveryError::Conflict)?
            };
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
            transaction.execute("UPDATE family_delivery_deliveries SET state='RELAY_ACCEPTED',accepted_at=?1,package_bytes=NULL,envelope_bytes=NULL WHERE delivery_id=?2", params![receipt.accepted_at,receipt.delivery_id])?;
            transaction.execute("UPDATE family_delivery_partition_state SET dirty=0,last_accepted_digest=?1,last_accepted_at=?2 WHERE household_id=?3 AND audience_key=?4",
                params![existing.3,receipt.accepted_at,input.household_id,existing.0])?;
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

/// Recovers sends interrupted by process termination. `SENDING` is only an
/// in-process ownership marker; after a fresh process starts no sender can
/// still own it. Exact package and encrypted-envelope bytes remain untouched
/// so the next attempt is an idempotent resend.
pub fn recover_interrupted_sends(connection: &Connection) -> Result<u64> {
    Ok(connection.execute(
        "UPDATE family_delivery_deliveries
         SET state='FAILED_RETRYABLE',accepted_at=NULL
         WHERE state='SENDING'",
        [],
    )? as u64)
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
         WHERE f.household_id=?1 AND f.state IN ('CONNECTED','NETWORK_UNAVAILABLE')",[&input.household_id],|row|Ok((row.get(0)?,row.get(1)?)))
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
        let transport_digests = remote_transport_digests(artifact)?;
        if !valid_id(&artifact.artifact_id)
            || !valid_id(&artifact.origin_device_id)
            || !valid_id(&artifact.sender_membership_id)
            || !valid_digest(&artifact.digest)
            || !valid_timestamp(&artifact.created_at)
            || artifact.byte_size == 0
            || artifact.byte_size as usize > MAX_PACKAGE_BYTES
            || !matches!(
                artifact.artifact_schema.as_str(),
                ARTIFACT_SCHEMA_V1 | ARTIFACT_SCHEMA_V2 | ARTIFACT_SCHEMA
            )
            || artifact.origin_device_id == local_device
            || !matches!(artifact.audience_visibility.as_str(), "SHARED" | "PERSONAL")
            || ((artifact.audience_visibility == "SHARED") != artifact.audience_member_id.is_none())
        {
            return Err(FamilyDeliveryError::InvalidInput);
        }
        if !valid_digest(transport_digests.inner) {
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
    let digests = remote_transport_digests(artifact)?;
    let existing=transaction.query_row("SELECT household_id,package_sha256,origin_device_id,sender_membership_id,visibility,member_id,envelope_schema,transport_sha256,recipient_set_digest FROM family_delivery_inbound WHERE artifact_id=?1",[&artifact.artifact_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,Option<String>>(8)?))).optional()?;
    if let Some(current) = existing {
        if current
            != (
                household_id.to_owned(),
                digests.inner.to_owned(),
                artifact.origin_device_id.clone(),
                artifact.sender_membership_id.clone(),
                artifact.audience_visibility.clone(),
                artifact.audience_member_id.clone(),
                digests.envelope_schema.map(str::to_owned),
                digests.transport.map(str::to_owned),
                digests.recipient_set.map(str::to_owned),
            )
        {
            return Err(FamilyDeliveryError::Conflict);
        }
        return Ok(());
    }
    transaction.execute("INSERT INTO family_delivery_inbound(artifact_id,household_id,sequence,package_sha256,created_at,origin_device_id,
       sender_membership_id,sender_member_id,sender_member_name,visibility,member_id,member_key,member_name,byte_size,artifact_schema,state,received_before_revocation,
       envelope_schema,transport_sha256,recipient_set_digest)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,coalesce(?11,''),?12,?13,?14,'AVAILABLE',?15,?16,?17,?18)",
       params![artifact.artifact_id,household_id,artifact.sequence,digests.inner,artifact.created_at,artifact.origin_device_id,
       artifact.sender_membership_id,sender_member_id,sender_name,artifact.audience_visibility,artifact.audience_member_id,member_name,artifact.byte_size,artifact.artifact_schema,if revoked{1}else{0},
       digests.envelope_schema,digests.transport,digests.recipient_set])?;
    Ok(())
}

pub fn stage_inbound_with_vault(
    connection: &Connection,
    vault: &DocumentVault,
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
    let decoded = if metadata.5 == ARTIFACT_SCHEMA {
        Some(
            family_evidence::decode(&input.package_bytes)
                .map_err(|_| FamilyDeliveryError::Snapshot)?,
        )
    } else {
        None
    };
    let set = if let Some(decoded) = decoded.as_ref() {
        decoded.set.clone()
    } else {
        family_snapshot::decode_and_validate(&input.package_bytes)
            .map_err(|_| FamilyDeliveryError::Snapshot)?
    };
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
        || metadata.5 != artifact_schema(set.schema_version)
        || metadata.6 != set.publisher_member_id
    {
        return Err(FamilyDeliveryError::AudienceDenied);
    }
    let snapshot_bytes =
        family_snapshot::encode_pretty(&set).map_err(|_| FamilyDeliveryError::Snapshot)?;
    let review =
        family_snapshot::stage_snapshot_set(connection, &input.household_id, &snapshot_bytes)
            .map_err(|error| match error {
                family_snapshot::FamilySnapshotError::ReviewPending => {
                    FamilyDeliveryError::ReviewPending
                }
                family_snapshot::FamilySnapshotError::AudienceBlocked => {
                    FamilyDeliveryError::AudienceDenied
                }
                _ => FamilyDeliveryError::Snapshot,
            })?;
    let _ = vault;
    let inbound_state = if review.state == "READY" {
        "READY_TO_APPLY"
    } else {
        "WAITING_FOR_REVIEW"
    };
    connection.execute(
        "UPDATE family_delivery_inbound SET state=?1,staged_snapshot_set_id=?2,
       pending_package_bytes=CASE WHEN artifact_schema=?4 THEN ?5 ELSE NULL END
       WHERE artifact_id=?3",
        params![
            inbound_state,
            review.snapshot_set_id,
            input.artifact_id,
            ARTIFACT_SCHEMA,
            input.package_bytes
        ],
    )?;
    Ok(review)
}

#[cfg(test)]
fn stage_inbound(
    connection: &Connection,
    input: &StageFamilyInboundInput,
) -> Result<family_snapshot::FamilySnapshotReviewDto> {
    let root = tempfile::tempdir().map_err(|_| FamilyDeliveryError::Snapshot)?;
    let vault =
        DocumentVault::new(root.path(), &[92_u8; 32]).map_err(|_| FamilyDeliveryError::Snapshot)?;
    stage_inbound_with_vault(connection, &vault, input)
}

fn artifact_schema(schema_version: u32) -> &'static str {
    match schema_version {
        1 => ARTIFACT_SCHEMA_V1,
        2 => ARTIFACT_SCHEMA_V2,
        _ => ARTIFACT_SCHEMA,
    }
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
    connection.execute(
        "UPDATE family_delivery_inbound SET state='AVAILABLE',staged_snapshot_set_id=NULL,
       pending_package_bytes=NULL WHERE staged_snapshot_set_id=?1",
        [snapshot_set_id],
    )?;
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

pub fn apply_ui_review_with_vault(
    connection: &Connection,
    vault: &DocumentVault,
    package_id: &str,
) -> Result<FamilySnapshotUiReviewDto> {
    let pending: Option<Vec<u8>> = connection
        .query_row(
            "SELECT pending_package_bytes FROM family_delivery_inbound
             WHERE staged_snapshot_set_id=?1",
            [package_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let decoded = pending
        .as_deref()
        .map(family_evidence::decode)
        .transpose()
        .map_err(|_| FamilyDeliveryError::Snapshot)?;
    let new_hashes = if let Some(decoded) = decoded.as_ref() {
        family_evidence::put_blobs(vault, decoded).map_err(|_| FamilyDeliveryError::Snapshot)?
    } else {
        Vec::new()
    };
    let applied =
        family_snapshot::apply_snapshot_set_with_hook(connection, package_id, |transaction| {
            if let Some(decoded) = decoded.as_ref() {
                family_evidence::materialize(transaction, decoded)
                    .map_err(|_| family_snapshot::FamilySnapshotError::Encoding)?;
            }
            Ok(())
        });
    let review = match applied {
        Ok(review) => review,
        Err(_) => {
            family_evidence::cleanup(vault, &new_hashes);
            return Err(FamilyDeliveryError::Snapshot);
        }
    };
    connection.execute(
        "UPDATE family_delivery_inbound SET state='APPLIED',pending_package_bytes=NULL
         WHERE staged_snapshot_set_id=?1",
        [package_id],
    )?;
    ui_review(connection, &review)
}

#[cfg(test)]
fn apply_ui_review(connection: &Connection, package_id: &str) -> Result<FamilySnapshotUiReviewDto> {
    let root = tempfile::tempdir().map_err(|_| FamilyDeliveryError::Snapshot)?;
    let vault =
        DocumentVault::new(root.path(), &[93_u8; 32]).map_err(|_| FamilyDeliveryError::Snapshot)?;
    apply_ui_review_with_vault(connection, &vault, package_id)
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
    let manifest: String = connection.query_row(
        "SELECT manifest_json FROM family_snapshot_sets WHERE snapshot_set_id=?1",
        [&review.snapshot_set_id],
        |row| row.get(0),
    )?;
    let staged: family_snapshot::FamilySnapshotSetDto =
        serde_json::from_str(&manifest).map_err(|_| FamilyDeliveryError::Conflict)?;
    let partition = staged
        .partitions
        .first()
        .ok_or(FamilyDeliveryError::Conflict)?;
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
        evidence_file_count: partition.evidence_file_count,
        evidence_record_count: partition.evidence_record_count,
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
        "CARD_STATEMENT" | "CARD_PAYMENT" => "CARD",
        "PORTFOLIO_SNAPSHOT"
        | "BROKERAGE_EVENT"
        | "INVESTMENT_FX_RATE"
        | "INVESTMENT_MARKET_PRICE"
        | "AGGREGATE_ASSET_SNAPSHOT" => "INVESTMENT",
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

    type CachedEnvelopeColumns = (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<Vec<u8>>,
    );

    fn setup(key: u8) -> AppState {
        let state = AppState::in_memory(&[key; 32]).unwrap();
        initialize_state(&state);
        state
    }

    fn initialize_state(state: &AppState) {
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

    fn cache_test_envelope(
        connection: &Connection,
        prepared: &PreparedFamilyArtifactDto,
        label: &str,
    ) -> CacheOutboundEnvelopeInput {
        let envelope_bytes = format!("encrypted-envelope-{label}").into_bytes();
        let input = CacheOutboundEnvelopeInput {
            delivery_id: prepared.delivery_id.clone(),
            envelope_schema: "FAMILY_ENCRYPTED_ENVELOPE_V1".into(),
            transport_sha256: digest(&envelope_bytes),
            inner_sha256: prepared.digest.clone(),
            recipient_set_digest: digest(format!("recipient-set-{label}").as_bytes()),
            envelope_bytes,
        };
        cache_outbound_envelope(connection, &input).unwrap();
        input
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
    fn startup_recovery_after_reopen_keeps_exact_cached_sending_envelope() {
        let root = tempfile::tempdir().unwrap();
        let database = root.path().join("kakeflow.db");
        let key = [25_u8; 32];
        let (prepared, cached) = {
            let state = AppState::open_with_key(database.clone(), &key).unwrap();
            initialize_state(&state);
            state
                .with_connection(|connection| {
                    connect(connection);
                    let prepared = prepare_send(
                        connection,
                        &PrepareFamilyDeliveryInput {
                            household_id: "family".into(),
                            audience_keys: vec!["SHARED".into()],
                        },
                    )
                    .unwrap()
                    .remove(0);
                    let cached = cache_test_envelope(connection, &prepared, "before-crash");
                    Ok((prepared, cached))
                })
                .unwrap()
        };

        let reopened = AppState::open_with_key(database, &key).unwrap();
        reopened
            .with_connection(|connection| {
                assert_eq!(recover_interrupted_sends(connection).unwrap(), 1);
                let state: String = connection.query_row(
                    "SELECT state FROM family_delivery_deliveries WHERE delivery_id=?1",
                    [&prepared.delivery_id],
                    |row| row.get(0),
                )?;
                assert_eq!(state, "FAILED_RETRYABLE");
                let recovered = load_any_cached_outbound_envelope(
                    connection,
                    &prepared.delivery_id,
                    &prepared.digest,
                )
                .unwrap()
                .unwrap();
                assert_eq!(recovered.transport_sha256, cached.transport_sha256);
                assert_eq!(recovered.recipient_set_digest, cached.recipient_set_digest);
                assert_eq!(recovered.envelope_bytes, cached.envelope_bytes);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn encrypted_envelope_cache_is_immutable_exact_and_cleared_on_acceptance() {
        let state = setup(2);
        state
            .with_connection(|connection| {
                connect(connection);
                let prepared = prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into()],
                    },
                )
                .unwrap()
                .remove(0);
                let envelope_bytes = b"encrypted-envelope".to_vec();
                let transport_sha256 = digest(&envelope_bytes);
                let recipient_set_digest = digest(b"recipient-set");
                let input = CacheOutboundEnvelopeInput {
                    delivery_id: prepared.delivery_id.clone(),
                    envelope_schema: "KAKEFLOW_ENCRYPTED_FAMILY_ENVELOPE".into(),
                    transport_sha256: transport_sha256.clone(),
                    inner_sha256: prepared.digest.clone(),
                    recipient_set_digest: recipient_set_digest.clone(),
                    envelope_bytes: envelope_bytes.clone(),
                };
                assert_eq!(
                    cache_outbound_envelope(connection, &input).unwrap(),
                    cache_outbound_envelope(connection, &input).unwrap()
                );
                assert!(load_cached_outbound_envelope(
                    connection,
                    &prepared.delivery_id,
                    &prepared.digest,
                    &digest(b"different-recipient-set")
                )
                .unwrap()
                .is_none());
                let mut changed = input.clone();
                changed.envelope_bytes = b"different-envelope".to_vec();
                changed.transport_sha256 = digest(&changed.envelope_bytes);
                assert!(matches!(
                    cache_outbound_envelope(connection, &changed),
                    Err(FamilyDeliveryError::Conflict)
                ));
                mark_accepted(
                    connection,
                    &AcceptFamilyDeliveryInput {
                        household_id: "family".into(),
                        receipts: vec![AcceptanceReceiptInput {
                            delivery_id: prepared.delivery_id.clone(),
                            artifact_id: prepared.artifact_id,
                            digest: transport_sha256.clone(),
                            accepted_at: "2026-07-14T12:00:00Z".into(),
                        }],
                    },
                )
                .unwrap();
                assert!(load_cached_outbound_envelope(
                    connection,
                    &prepared.delivery_id,
                    &prepared.digest,
                    &recipient_set_digest
                )
                .unwrap()
                .is_none());
                let retained: (Option<String>, Option<String>, i64) = connection.query_row(
                    "SELECT transport_sha256,recipient_set_digest,envelope_bytes IS NULL
                     FROM family_delivery_deliveries WHERE delivery_id=?1",
                    [&prepared.delivery_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )?;
                assert_eq!(
                    retained,
                    (Some(transport_sha256), Some(recipient_set_digest), 1)
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn exact_recipient_set_rejection_preserves_inner_package_and_allows_resealing() {
        let state = setup(21);
        state
            .with_connection(|connection| {
                connect(connection);
                let prepared = prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into()],
                    },
                )
                .unwrap()
                .remove(0);
                let old = cache_test_envelope(connection, &prepared, "old");
                let immutable_before: (String, String, String, String, Option<Vec<u8>>) = connection
                    .query_row(
                        "SELECT artifact_id,package_sha256,origin_device_id,audience_key,package_bytes
                         FROM family_delivery_deliveries WHERE delivery_id=?1",
                        [&prepared.delivery_id],
                        |row| {
                            Ok((
                                row.get(0)?,
                                row.get(1)?,
                                row.get(2)?,
                                row.get(3)?,
                                row.get(4)?,
                            ))
                        },
                    )?;

                let rejected = ResetRejectedRecipientSetsInput {
                    household_id: "family".into(),
                    deliveries: vec![RejectedRecipientSetDeliveryInput {
                        delivery_id: prepared.delivery_id.clone(),
                        transport_sha256: old.transport_sha256.clone(),
                        recipient_set_digest: old.recipient_set_digest.clone(),
                    }],
                };
                reset_rejected_outbound_envelopes(connection, &rejected).unwrap();
                // Simulate the first IPC response being lost. The retry sees
                // an already-cleared FAILED_RETRYABLE row and is a safe no-op.
                reset_rejected_outbound_envelopes(connection, &rejected).unwrap();
                let cleared: CachedEnvelopeColumns = connection.query_row(
                        "SELECT state,envelope_schema,transport_sha256,recipient_set_digest,envelope_bytes
                         FROM family_delivery_deliveries WHERE delivery_id=?1",
                        [&prepared.delivery_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
                    )?;
                assert_eq!(
                    cleared,
                    ("FAILED_RETRYABLE".into(), None, None, None, None)
                );
                let immutable_after: (String, String, String, String, Option<Vec<u8>>) = connection
                    .query_row(
                        "SELECT artifact_id,package_sha256,origin_device_id,audience_key,package_bytes
                         FROM family_delivery_deliveries WHERE delivery_id=?1",
                        [&prepared.delivery_id],
                        |row| {
                            Ok((
                                row.get(0)?,
                                row.get(1)?,
                                row.get(2)?,
                                row.get(3)?,
                                row.get(4)?,
                            ))
                        },
                    )?;
                assert_eq!(immutable_before, immutable_after);

                let replacement = cache_test_envelope(connection, &prepared, "new-members");
                assert_ne!(replacement.recipient_set_digest, old.recipient_set_digest);
                assert!(matches!(
                    reset_rejected_outbound_envelopes(connection, &rejected),
                    Err(FamilyDeliveryError::Conflict)
                ));
                assert_eq!(
                    load_cached_outbound_envelope(
                        connection,
                        &prepared.delivery_id,
                        &prepared.digest,
                        &replacement.recipient_set_digest,
                    )
                    .unwrap()
                    .unwrap()
                    .envelope_bytes,
                    replacement.envelope_bytes
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn recipient_set_rejection_cannot_clear_an_unsealed_sending_delivery() {
        let state = setup(26);
        state
            .with_connection(|connection| {
                connect(connection);
                let prepared = prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into()],
                    },
                )
                .unwrap()
                .remove(0);
                assert!(matches!(
                    reset_rejected_outbound_envelopes(
                        connection,
                        &ResetRejectedRecipientSetsInput {
                            household_id: "family".into(),
                            deliveries: vec![RejectedRecipientSetDeliveryInput {
                                delivery_id: prepared.delivery_id,
                                transport_sha256: digest(b"never-cached-envelope"),
                                recipient_set_digest: digest(b"never-cached-recipients"),
                            }],
                        }
                    ),
                    Err(FamilyDeliveryError::Conflict)
                ));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn ambiguous_send_failure_preserves_exact_encrypted_envelope() {
        let state = setup(22);
        state
            .with_connection(|connection| {
                connect(connection);
                let prepared = prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into()],
                    },
                )
                .unwrap()
                .remove(0);
                let cached = cache_test_envelope(connection, &prepared, "ambiguous");

                mark_failed(
                    connection,
                    "family",
                    std::slice::from_ref(&prepared.delivery_id),
                )
                .unwrap();

                let retried = load_cached_outbound_envelope(
                    connection,
                    &prepared.delivery_id,
                    &prepared.digest,
                    &cached.recipient_set_digest,
                )
                .unwrap()
                .unwrap();
                assert_eq!(retried.transport_sha256, cached.transport_sha256);
                assert_eq!(retried.envelope_bytes, cached.envelope_bytes);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn accepted_or_stale_recipient_set_rejections_cannot_reset_delivery() {
        let state = setup(23);
        state
            .with_connection(|connection| {
                connect(connection);
                let prepared = prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into()],
                    },
                )
                .unwrap()
                .remove(0);
                let cached = cache_test_envelope(connection, &prepared, "accepted");
                let reset = ResetRejectedRecipientSetsInput {
                    household_id: "family".into(),
                    deliveries: vec![RejectedRecipientSetDeliveryInput {
                        delivery_id: prepared.delivery_id.clone(),
                        transport_sha256: cached.transport_sha256.clone(),
                        recipient_set_digest: cached.recipient_set_digest.clone(),
                    }],
                };
                mark_accepted(
                    connection,
                    &AcceptFamilyDeliveryInput {
                        household_id: "family".into(),
                        receipts: vec![AcceptanceReceiptInput {
                            delivery_id: prepared.delivery_id.clone(),
                            artifact_id: prepared.artifact_id,
                            digest: cached.transport_sha256,
                            accepted_at: "2026-07-14T12:00:00Z".into(),
                        }],
                    },
                )
                .unwrap();
                assert!(matches!(
                    reset_rejected_outbound_envelopes(connection, &reset),
                    Err(FamilyDeliveryError::Conflict)
                ));
                let accepted: (String, Option<Vec<u8>>) = connection.query_row(
                    "SELECT state,envelope_bytes FROM family_delivery_deliveries WHERE delivery_id=?1",
                    [&prepared.delivery_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                assert_eq!(accepted, ("RELAY_ACCEPTED".into(), None));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn multi_delivery_recipient_set_reset_is_atomic_on_tuple_mismatch() {
        let state = setup(24);
        state
            .with_connection(|connection| {
                connect(connection);
                let prepared = prepare_send(
                    connection,
                    &PrepareFamilyDeliveryInput {
                        household_id: "family".into(),
                        audience_keys: vec!["SHARED".into(), "PERSONAL:member-a".into()],
                    },
                )
                .unwrap();
                assert_eq!(prepared.len(), 2);
                let first = cache_test_envelope(connection, &prepared[0], "atomic-first");
                let second = cache_test_envelope(connection, &prepared[1], "atomic-second");
                let input = ResetRejectedRecipientSetsInput {
                    household_id: "family".into(),
                    deliveries: vec![
                        RejectedRecipientSetDeliveryInput {
                            delivery_id: prepared[0].delivery_id.clone(),
                            transport_sha256: first.transport_sha256.clone(),
                            recipient_set_digest: first.recipient_set_digest.clone(),
                        },
                        RejectedRecipientSetDeliveryInput {
                            delivery_id: prepared[1].delivery_id.clone(),
                            transport_sha256: digest(b"stale-transport"),
                            recipient_set_digest: second.recipient_set_digest.clone(),
                        },
                    ],
                };
                assert!(matches!(
                    reset_rejected_outbound_envelopes(connection, &input),
                    Err(FamilyDeliveryError::Conflict)
                ));
                for (artifact, cached) in prepared.iter().zip([first, second]) {
                    assert_eq!(
                        load_cached_outbound_envelope(
                            connection,
                            &artifact.delivery_id,
                            &artifact.digest,
                            &cached.recipient_set_digest,
                        )
                        .unwrap()
                        .unwrap()
                        .envelope_bytes,
                        cached.envelope_bytes
                    );
                }
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn encrypted_inbound_keeps_outer_and_inner_digests_separate() {
        let state = setup(3);
        state
            .with_connection(|connection| {
                connect(connection);
                let inner_digest = digest(b"inner-package");
                let transport_digest = digest(b"encrypted-transport");
                let recipient_set_digest = digest(b"recipient-set");
                let artifact = RemoteFamilyArtifactInput {
                    sequence: 1,
                    artifact_id: "encrypted-artifact".into(),
                    digest: transport_digest.clone(),
                    created_at: "2026-07-14T12:00:00Z".into(),
                    origin_device_id: "remote-device".into(),
                    sender_membership_id: "membership-a-device-2".into(),
                    audience_visibility: "SHARED".into(),
                    audience_member_id: None,
                    byte_size: 19,
                    artifact_schema: ARTIFACT_SCHEMA.into(),
                    envelope_schema: Some("KAKEFLOW_ENCRYPTED_FAMILY_ENVELOPE".into()),
                    transport_digest: Some(transport_digest.clone()),
                    inner_digest: Some(inner_digest.clone()),
                    recipient_set_digest: Some(recipient_set_digest.clone()),
                };
                register_inbound(
                    connection,
                    &RegisterFamilyInboundInput {
                        household_id: "family".into(),
                        artifacts: vec![artifact.clone()],
                        next_cursor: 1,
                    },
                )
                .unwrap();
                let metadata =
                    load_inbound_transport_metadata(connection, "family", "encrypted-artifact")
                        .unwrap()
                        .unwrap();
                assert_eq!(metadata.origin_device_id, "remote-device");
                assert_eq!(metadata.state, "AVAILABLE");
                assert_eq!(metadata.inner_sha256, inner_digest);
                assert_eq!(metadata.transport_sha256, transport_digest);
                assert_eq!(metadata.recipient_set_digest, Some(recipient_set_digest));

                let mut partial = artifact;
                partial.artifact_id = "partial-artifact".into();
                partial.envelope_schema = None;
                assert!(matches!(
                    register_inbound(
                        connection,
                        &RegisterFamilyInboundInput {
                            household_id: "family".into(),
                            artifacts: vec![partial],
                            next_cursor: 2,
                        }
                    ),
                    Err(FamilyDeliveryError::InvalidInput)
                ));
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
                let root = tempfile::tempdir().unwrap();
                let vault = DocumentVault::new(root.path(), &[94_u8; 32]).unwrap();
                let current = status_with_vault(connection, &vault, "family").unwrap();
                let shared = current
                    .outbound
                    .iter()
                    .find(|partition| partition.audience_visibility == "SHARED")
                    .unwrap();
                assert!(shared.domain_counts["PLANNING"] >= 2);
                assert!(shared.domain_counts["CONFIG"] >= 1);
                assert_eq!(shared.domain_counts["CARD"], 0);
                assert_eq!(shared.domain_counts["INVESTMENT"], 1);
                assert_eq!(current.withheld_counts_by_reason["MISSING_CARD_EVIDENCE"], 1);
                assert_eq!(current.withheld_counts_by_reason["MISSING_INVESTMENT_EVIDENCE"], 0);
                assert_eq!(shared.withheld_domain_counts["CARD"], 1);
                assert_eq!(
                    shared.withheld_counts_by_reason.values().sum::<u64>(),
                    shared.withheld_domain_counts.values().sum::<u64>()
                );
                let personal = current
                    .outbound
                    .iter()
                    .find(|partition| partition.audience_visibility == "PERSONAL")
                    .unwrap();
                assert_eq!(personal.coverage_state, "COMPLETE");
                assert_eq!(personal.withheld_counts_by_reason.values().sum::<u64>(), 0);
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
    fn oversized_evidence_withholds_aggregate_and_keeps_non_evidence_graph() {
        let state = setup(15);
        let root = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(root.path(), &[95_u8; 32]).unwrap();
        let blob = vec![b'x'; family_evidence::MAX_ARTIFACT_BYTES];
        let stored = vault.put(&blob, "text/csv").unwrap();
        state
            .with_connection(|connection| {
                connect(connection);
                connection.execute_batch(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,currency,
                       ownership_kind,visibility) VALUES(
                       'card','family','Card','LIABILITY','CREDIT_CARD','JPY','HOUSEHOLD','SHARED');
                     INSERT INTO import_runs(id,household_id,status) VALUES('large-run','family','POSTED');",
                )?;
                connection.execute(
                    "INSERT INTO source_documents(id,household_id,import_run_id,source_type,
                       original_filename,media_type,byte_size,sha256,storage_path)
                     VALUES('large-doc','family','large-run','OTHER','large.csv','text/csv',?1,?2,?3)",
                    params![stored.plaintext_size, stored.sha256, "vault"],
                )?;
                connection.execute(
                    "INSERT INTO card_statements(id,household_id,card_account_id,period_start,
                       period_end,statement_amount_jpy,source_document_id)
                     VALUES('large-statement','family','card','2026-06-01','2026-06-30',1000,'large-doc')",
                    [],
                )?;
                let prepared = family_evidence::prepare(
                    connection,
                    &vault,
                    family_snapshot::export_snapshot_set(connection, "family").unwrap(),
                )
                .unwrap();
                let shared = prepared
                    .set
                    .partitions
                    .iter()
                    .find(|partition| partition.audience.visibility == "SHARED")
                    .unwrap();
                assert!(shared.records.iter().any(|record| {
                    record.entity_kind == "ACCOUNT" && record.entity_id == "card"
                }));
                assert!(!shared
                    .records
                    .iter()
                    .any(|record| record.entity_kind == "CARD_STATEMENT"));
                assert_eq!(
                    prepared.set.excluded_counts_by_reason["EVIDENCE_SIZE_LIMIT"],
                    1
                );
                assert!(!shared
                    .authoritative_kinds
                    .iter()
                    .any(|kind| kind == "CARD_STATEMENT"));
                let bytes = family_evidence::encode(&prepared, &shared.audience).unwrap();
                assert!(bytes.len() < family_evidence::MAX_ARTIFACT_BYTES);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn source_scope_failures_remain_global_without_false_partition_attribution() {
        let state = setup(17);
        let root = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(root.path(), &[97_u8; 32]).unwrap();
        state
            .with_connection(|connection| {
                let mut base = family_snapshot::export_snapshot_set(connection, "family").unwrap();
                base.excluded_counts_by_reason
                    .insert("UNASSIGNED_SCOPE".to_owned(), 1);
                let prepared = family_evidence::prepare(connection, &vault, base).unwrap();
                assert_eq!(
                    prepared.set.excluded_counts_by_reason["UNASSIGNED_SCOPE"],
                    1
                );
                assert!(prepared
                    .withheld_counts_by_audience
                    .values()
                    .all(|reasons| { reasons.values().sum::<u64>() == 0 }));
                assert!(prepared
                    .withheld_domains_by_audience
                    .values()
                    .all(|domains| { domains.values().sum::<u64>() == 0 }));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn personal_journal_dependency_never_leaks_card_evidence_into_shared_kff3() {
        let state = setup(16);
        let root = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(root.path(), &[96_u8; 32]).unwrap();
        let stored = vault.put(b"private card evidence", "text/csv").unwrap();
        state
            .with_connection(|connection| {
                connect(connection);
                connection.execute_batch(
                    "INSERT INTO accounts(
                       id,household_id,name,account_kind,account_subtype,currency,
                       owner_member_id,ownership_kind,visibility)
                     VALUES
                       ('card','family','Card','LIABILITY','CREDIT_CARD','JPY',NULL,'HOUSEHOLD','SHARED'),
                       ('private-expense','family','Private expense','EXPENSE','OTHER','JPY',
                         'member-a','MEMBER','PERSONAL'),
                       ('private-bank','family','Private bank','ASSET','BANK','JPY',
                         'member-a','MEMBER','PERSONAL');
                     INSERT INTO transactions(
                       id,household_id,occurred_on,transaction_type,status,
                       audience_visibility,audience_member_id)
                     VALUES
                       ('purchase','family','2026-06-15','CARD_PURCHASE','POSTED','SHARED',NULL),
                       ('bank-payment','family','2026-07-27','CARD_PAYMENT','POSTED','SHARED',NULL);
                     INSERT INTO journal_entries(
                       id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                     VALUES
                       ('purchase-debit','purchase','private-expense','DEBIT',1000,1),
                       ('purchase-credit','purchase','card','CREDIT',1000,2),
                       ('payment-debit','bank-payment','card','DEBIT',1000,1),
                       ('payment-credit','bank-payment','private-bank','CREDIT',1000,2);
                     INSERT INTO import_runs(id,household_id,status)
                     VALUES('private-run','family','POSTED');",
                )?;
                connection.execute(
                    "INSERT INTO source_documents(
                       id,household_id,import_run_id,source_type,original_filename,media_type,
                       byte_size,sha256,storage_path,audience_visibility,audience_member_id)
                     VALUES('private-doc','family','private-run','OTHER','private.csv','text/csv',
                       ?1,?2,'vault','SHARED',NULL)",
                    params![stored.plaintext_size, stored.sha256],
                )?;
                connection.execute_batch(
                    "INSERT INTO source_records(
                       id,source_document_id,row_number,record_hash,raw_payload_json)
                     VALUES('private-row','private-doc',1,
                       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}');
                     INSERT INTO transaction_sources(transaction_id,source_record_id)
                     VALUES('bank-payment','private-row');
                     INSERT INTO card_statements(
                       id,household_id,card_account_id,period_start,period_end,payment_due_on,
                       statement_amount_jpy,source_document_id)
                     VALUES('private-statement','family','card','2026-06-01','2026-06-30',
                       '2026-07-27',1000,'private-doc');
                     INSERT INTO card_statement_transactions(
                       statement_id,transaction_id,statement_line_number,billed_amount_jpy)
                     VALUES('private-statement','purchase',1,1000);
                     INSERT INTO card_payments(
                       id,household_id,statement_id,bank_transaction_id,card_account_id,
                       payment_amount_jpy,payment_on)
                     VALUES('private-payment','family','private-statement','bank-payment','card',
                       1000,'2026-07-27');",
                )?;

                let base = family_snapshot::export_snapshot_set(connection, "family")
                    .expect("base snapshot should export");
                let prepared = family_evidence::prepare(connection, &vault, base)
                    .expect("personal card evidence should prepare");
                let shared_audience = prepared
                    .set
                    .partitions
                    .iter()
                    .find(|partition| partition.audience.visibility == "SHARED")
                    .unwrap()
                    .audience
                    .clone();
                let personal_audience = prepared
                    .set
                    .partitions
                    .iter()
                    .find(|partition| partition.audience.member_id.as_deref() == Some("member-a"))
                    .unwrap()
                    .audience
                    .clone();
                let shared_package = family_evidence::encode(&prepared, &shared_audience).unwrap();
                let personal_package =
                    family_evidence::encode(&prepared, &personal_audience).unwrap();
                let shared_bytes = String::from_utf8_lossy(&shared_package);
                assert!(!shared_bytes.contains("private-statement"));
                assert!(!shared_bytes.contains("private-payment"));
                assert!(!shared_bytes.contains("private card evidence"));
                let personal_set = family_evidence::decode(&personal_package).unwrap().set;
                assert!(personal_set.partitions[0].records.iter().any(|record| {
                    record.entity_kind == "CARD_STATEMENT"
                        && record.entity_id == "private-statement"
                }));
                assert!(personal_set.partitions[0].records.iter().any(|record| {
                    record.entity_kind == "CARD_PAYMENT" && record.entity_id == "private-payment"
                }));
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
                    household_id:"family".into(),audience_keys:vec!["SHARED".into(),"PERSONAL:member-a".into()]
                }).unwrap();
                accept_one(connection,first.iter().find(|artifact| artifact.audience_key == "SHARED").unwrap(),"2026-07-14T00:00:00Z");
                accept_one(connection,first.iter().find(|artifact| artifact.audience_key == "PERSONAL:member-a").unwrap(),"2026-07-14T00:00:01Z");
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
                    household_id:"family".into(),audience_keys:vec!["SHARED".into(),"PERSONAL:member-a".into()]
                }).unwrap();
                let shared_artifact = moved.iter().find(|artifact| artifact.audience_key == "SHARED").unwrap();
                let moved_set = family_evidence::decode(&shared_artifact.package_bytes).unwrap().set;
                assert!(moved_set.partitions[0].relocations.iter().any(|r|r.entity_id=="moving"));
                assert!(!String::from_utf8_lossy(&shared_artifact.package_bytes).contains("never-shared-private"));
                accept_one(connection,shared_artifact,"2026-07-14T00:01:00Z");
                let personal_artifact = moved.iter().find(|artifact| artifact.audience_key == "PERSONAL:member-a").unwrap();
                accept_one(connection,personal_artifact,"2026-07-14T00:01:01Z");
                connection.execute(
                    "INSERT INTO savings_goals(id,household_id,name,target_jpy,target_date)
                     VALUES('later-goal','family','Later',1000,'2027-01-01')",
                    [],
                )?;
                let later = prepare_send(connection, &PrepareFamilyDeliveryInput {
                    household_id:"family".into(),audience_keys:vec!["SHARED".into()]
                }).unwrap();
                let later_set = family_evidence::decode(&later[0].package_bytes).unwrap().set;
                assert!(later_set.partitions[0].relocations.iter().any(|r|r.entity_id=="moving"));
                assert!(!String::from_utf8_lossy(&later[0].package_bytes).contains("never-shared-private"));
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
                            envelope_schema: None,
                            transport_digest: None,
                            inner_digest: None,
                            recipient_set_digest: None,
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
                let staged: (bool, i64) = connection.query_row(
                    "SELECT pending_package_bytes IS NOT NULL,
                       (SELECT count(*) FROM evidence_source_document_aliases)
                     FROM family_delivery_inbound WHERE staged_snapshot_set_id=?1",
                    [&review.snapshot_set_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                assert!(
                    staged.0,
                    "KFF3 bytes must survive staging until explicit apply"
                );
                assert_eq!(staged.1, 0, "staging must not materialize evidence");
                let ui = active_ui_review(connection, "family").unwrap().unwrap();
                assert_eq!(ui.evidence_file_count, 0);
                assert_eq!(ui.evidence_record_count, 0);
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
                let retained: bool = connection.query_row(
                    "SELECT pending_package_bytes IS NOT NULL FROM family_delivery_inbound
                     WHERE staged_snapshot_set_id=?1",
                    [&review.snapshot_set_id],
                    |row| row.get(0),
                )?;
                assert!(!retained, "applied KFF3 bytes must be released");
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
    fn successful_inbound_poll_recovers_network_unavailable_connection() {
        let state = setup(24);
        state
            .with_connection(|connection| {
                connect(connection);
                connection.execute(
                    "UPDATE family_delivery_connections SET state='NETWORK_UNAVAILABLE'
                     WHERE household_id='family'",
                    [],
                )?;
                let status = register_inbound(
                    connection,
                    &RegisterFamilyInboundInput {
                        household_id: "family".into(),
                        artifacts: vec![],
                        next_cursor: 7,
                    },
                )
                .unwrap();
                assert_eq!(status.connection_state, "CONNECTED");
                assert_eq!(status.inbound_cursor, 7);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn register_preserves_v1_v2_v3_schema_and_stage_routes_each_decoder() {
        let state = setup(16);
        state
            .with_connection(|connection| {
                connect(connection);
                let samples = [
                    (ARTIFACT_SCHEMA_V1, b"v1".to_vec()),
                    (ARTIFACT_SCHEMA_V2, b"v2".to_vec()),
                    (ARTIFACT_SCHEMA, b"KFF3-invalid".to_vec()),
                ];
                let artifacts = samples
                    .iter()
                    .enumerate()
                    .map(|(index, (schema, bytes))| RemoteFamilyArtifactInput {
                        sequence: index as u64 + 1,
                        artifact_id: format!("artifact-schema-{}", index + 1),
                        digest: digest(bytes),
                        created_at: format!("2026-07-14T00:00:0{index}Z"),
                        origin_device_id: "remote-device".into(),
                        sender_membership_id: "membership-a-device-2".into(),
                        audience_visibility: "SHARED".into(),
                        audience_member_id: None,
                        byte_size: bytes.len() as u64,
                        artifact_schema: (*schema).into(),
                        envelope_schema: None,
                        transport_digest: None,
                        inner_digest: None,
                        recipient_set_digest: None,
                    })
                    .collect();
                register_inbound(
                    connection,
                    &RegisterFamilyInboundInput {
                        household_id: "family".into(),
                        artifacts,
                        next_cursor: 3,
                    },
                )
                .unwrap();
                let stored = connection
                    .prepare(
                        "SELECT artifact_schema FROM family_delivery_inbound ORDER BY sequence",
                    )?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                assert_eq!(
                    stored,
                    samples
                        .iter()
                        .map(|(schema, _)| (*schema).to_owned())
                        .collect::<Vec<_>>()
                );
                for (index, (_, bytes)) in samples.iter().enumerate() {
                    assert!(matches!(
                        stage_inbound(
                            connection,
                            &StageFamilyInboundInput {
                                household_id: "family".into(),
                                artifact_id: format!("artifact-schema-{}", index + 1),
                                package_bytes: bytes.clone(),
                            }
                        ),
                        Err(FamilyDeliveryError::Snapshot)
                    ));
                }
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
                    byte_size: prepared.package_bytes.len() as u64, artifact_schema: ARTIFACT_SCHEMA.into(),
                    envelope_schema: None, transport_digest: None, inner_digest: None, recipient_set_digest: None }],
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
