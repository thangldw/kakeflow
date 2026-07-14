use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{change_package, sync_foundation};

const MAX_ID: usize = 128;
const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum RelayError {
    #[error("relay database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("relay input is invalid")]
    InvalidInput,
    #[error("relay connection was not found")]
    NotConnected,
    #[error("relay artifact conflicts with immutable state")]
    Conflict,
    #[error("relay package could not be prepared")]
    Package,
    #[error("another change package is awaiting review")]
    ReviewPending,
}

pub type Result<T> = std::result::Result<T, RelayError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelayInboundArtifactDto {
    pub artifact_id: String,
    pub digest: String,
    pub created_at: String,
    pub origin_device_id: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatusDto {
    pub household_id: String,
    pub local_device_id: String,
    pub connection_state: String,
    pub endpoint: Option<String>,
    pub remote_principal_id: Option<String>,
    pub outbound: RelayOutboundStatusDto,
    pub inbound: Vec<RelayInboundArtifactDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelayOutboundStatusDto {
    pub total_envelope_count: u64,
    pub pending_envelope_count: u64,
    pub delivery_state: String,
    pub latest_accepted_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveConnectionInput {
    pub household_id: String,
    pub endpoint: String,
    pub remote_principal_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelayPreparedDeliveryDto {
    pub delivery_id: String,
    pub artifact_id: String,
    pub digest: String,
    pub household_id: String,
    pub origin_device_id: String,
    pub package_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptDeliveryInput {
    pub household_id: String,
    pub delivery_id: String,
    pub artifact_id: String,
    pub digest: String,
    pub accepted_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelayInboundMetadataInput {
    pub artifact_id: String,
    pub digest: String,
    pub created_at: String,
    pub origin_device_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisterInboundInput {
    pub household_id: String,
    pub artifacts: Vec<RelayInboundMetadataInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageInboundInput {
    pub household_id: String,
    pub artifact_id: String,
    pub package_bytes: Vec<u8>,
}

fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_ID && !value.chars().any(char::is_control)
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_timestamp(value: &str) -> bool {
    value.len() >= 20 && value.len() <= 40 && value.ends_with('Z') && value.contains('T')
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn normalized_endpoint(value: &str) -> Option<String> {
    let endpoint = value.trim().trim_end_matches('/');
    let local_http =
        endpoint.starts_with("http://127.0.0.1:") || endpoint.starts_with("http://localhost:");
    if endpoint.len() < 8
        || endpoint.len() > 2048
        || endpoint.chars().any(char::is_control)
        || !(endpoint.starts_with("https://") || local_http)
    {
        return None;
    }
    Some(endpoint.to_owned())
}

pub fn save_connection(
    connection: &Connection,
    input: &SaveConnectionInput,
) -> Result<RelayStatusDto> {
    if !valid_id(&input.household_id) || !valid_id(&input.remote_principal_id) {
        return Err(RelayError::InvalidInput);
    }
    let endpoint = normalized_endpoint(&input.endpoint).ok_or(RelayError::InvalidInput)?;
    let household_exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM households WHERE id=?1)",
        [&input.household_id],
        |row| row.get(0),
    )?;
    if !household_exists {
        return Err(RelayError::InvalidInput);
    }
    connection.execute(
        "INSERT INTO relay_connections(household_id,endpoint,remote_principal_id,state)
         VALUES(?1,?2,?3,'CONNECTED')
         ON CONFLICT(household_id) DO UPDATE SET endpoint=excluded.endpoint,
           remote_principal_id=excluded.remote_principal_id,state='CONNECTED',
           connected_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![input.household_id, endpoint, input.remote_principal_id],
    )?;
    status(connection, &input.household_id)
}

pub fn disconnect(connection: &Connection, household_id: &str) -> Result<RelayStatusDto> {
    if !valid_id(household_id) {
        return Err(RelayError::InvalidInput);
    }
    connection.execute(
        "UPDATE relay_connections SET state='DISCONNECTED' WHERE household_id=?1",
        [household_id],
    )?;
    status(connection, household_id)
}

pub fn status(connection: &Connection, household_id: &str) -> Result<RelayStatusDto> {
    if !valid_id(household_id) {
        return Err(RelayError::InvalidInput);
    }
    let local_status = sync_foundation::get_local_status(connection, household_id)
        .map_err(|_| RelayError::InvalidInput)?;
    let configured = connection.query_row(
        "SELECT endpoint,remote_principal_id,state FROM relay_connections WHERE household_id=?1",
        [household_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
    ).optional()?;
    let (endpoint, principal, connection_state) = match configured {
        Some((endpoint, principal, state)) if state != "DISCONNECTED" => {
            (Some(endpoint), Some(principal), state)
        }
        _ => (None, None, "NOT_CONFIGURED".to_owned()),
    };
    let (total, pending): (i64, i64) = connection.query_row(
        "SELECT count(*),sum(CASE WHEN o.state='PENDING' THEN 1 ELSE 0 END)
         FROM sync_change_envelopes e JOIN sync_outbox o ON o.envelope_id=e.envelope_id WHERE e.household_id=?1",
        [household_id], |row| Ok((row.get(0)?, row.get::<_, Option<i64>>(1)?.unwrap_or(0))),
    )?;
    let delivery = connection.query_row(
        "SELECT state,accepted_at FROM relay_deliveries WHERE household_id=?1 ORDER BY created_at DESC,delivery_id DESC LIMIT 1",
        [household_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
    ).optional()?;
    let mut statement = connection.prepare(
        "SELECT artifact_id,package_sha256,created_at,origin_device_id,state
         FROM relay_inbound_artifacts WHERE household_id=?1 ORDER BY created_at DESC,artifact_id DESC LIMIT 100",
    )?;
    let inbound = statement
        .query_map([household_id], |row| {
            Ok(RelayInboundArtifactDto {
                artifact_id: row.get(0)?,
                digest: row.get(1)?,
                created_at: row.get(2)?,
                origin_device_id: row.get(3)?,
                state: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(RelayStatusDto {
        household_id: household_id.to_owned(),
        local_device_id: local_status.device.id,
        connection_state,
        endpoint,
        remote_principal_id: principal,
        outbound: RelayOutboundStatusDto {
            total_envelope_count: u64::try_from(total).unwrap_or(0),
            pending_envelope_count: u64::try_from(pending).unwrap_or(0),
            delivery_state: delivery
                .as_ref()
                .map(|item| {
                    if item.0 == "READY" {
                        "SENDING".to_owned()
                    } else {
                        item.0.clone()
                    }
                })
                .unwrap_or_else(|| "IDLE".to_owned()),
            latest_accepted_at: delivery.and_then(|item| item.1),
        },
        inbound,
    })
}

pub fn prepare_send(
    connection: &Connection,
    household_id: &str,
) -> Result<RelayPreparedDeliveryDto> {
    if !valid_id(household_id) {
        return Err(RelayError::InvalidInput);
    }
    let connected: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM relay_connections WHERE household_id=?1 AND state='CONNECTED')",
        [household_id], |row| row.get(0),
    )?;
    if !connected {
        return Err(RelayError::NotConnected);
    }
    if let Some(existing) = load_retryable_delivery(connection, household_id)? {
        return Ok(existing);
    }
    let pending_count: i64 = connection.query_row(
        "SELECT count(*) FROM sync_outbox o JOIN sync_change_envelopes e ON e.envelope_id=o.envelope_id
         WHERE e.household_id=?1 AND o.state='PENDING'",
        [household_id],
        |row| row.get(0),
    )?;
    if pending_count == 0 {
        return Err(RelayError::Package);
    }
    let package = change_package::export_current_state(connection, household_id)
        .map_err(|_| RelayError::Package)?;
    let bytes = change_package::encode_pretty(&package).map_err(|_| RelayError::Package)?;
    if bytes.is_empty() || bytes.len() > MAX_PACKAGE_BYTES {
        return Err(RelayError::InvalidInput);
    }
    let artifact_digest = digest(&bytes);
    let status = sync_foundation::get_local_status(connection, household_id)
        .map_err(|_| RelayError::Package)?;
    let delivery_id = format!("relay-delivery-{artifact_digest}");
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "INSERT INTO relay_deliveries(delivery_id,household_id,artifact_id,package_sha256,snapshot_sequence,package_bytes,state)
         VALUES(?1,?2,?3,?4,?5,?6,'SENDING')",
        params![delivery_id, household_id, package.package_id, artifact_digest, status.outbox.latest_sequence, bytes],
    )?;
    transaction.execute(
        "INSERT INTO relay_delivery_envelopes(delivery_id,envelope_id)
         SELECT ?1,o.envelope_id FROM sync_outbox o JOIN sync_change_envelopes e ON e.envelope_id=o.envelope_id
         WHERE e.household_id=?2 AND o.state='PENDING'",
        params![delivery_id, household_id],
    )?;
    transaction.commit()?;
    load_delivery(connection, &delivery_id)?.ok_or(RelayError::Conflict)
}

fn load_retryable_delivery(
    connection: &Connection,
    household_id: &str,
) -> Result<Option<RelayPreparedDeliveryDto>> {
    let id = connection.query_row(
        "SELECT delivery_id FROM relay_deliveries WHERE household_id=?1 AND state IN ('READY','SENDING','FAILED_RETRYABLE') ORDER BY created_at,delivery_id LIMIT 1",
        [household_id], |row| row.get::<_, String>(0),
    ).optional()?;
    id.map(|id| load_delivery(connection, &id)?.ok_or(RelayError::Conflict))
        .transpose()
}

fn load_delivery(
    connection: &Connection,
    delivery_id: &str,
) -> Result<Option<RelayPreparedDeliveryDto>> {
    connection.query_row(
        "SELECT d.delivery_id,d.artifact_id,d.package_sha256,d.household_id,c.device_id,d.package_bytes
         FROM relay_deliveries d JOIN local_sync_contexts c ON c.household_id=d.household_id WHERE d.delivery_id=?1",
        [delivery_id], |row| Ok(RelayPreparedDeliveryDto {
            delivery_id: row.get(0)?, artifact_id: row.get(1)?, digest: row.get(2)?, household_id: row.get(3)?, origin_device_id: row.get(4)?, package_bytes: row.get(5)?,
        }),
    ).optional().map_err(RelayError::from)
}

pub fn mark_accepted(
    connection: &Connection,
    input: &AcceptDeliveryInput,
) -> Result<RelayStatusDto> {
    if !valid_id(&input.household_id)
        || !valid_id(&input.delivery_id)
        || !valid_id(&input.artifact_id)
        || !valid_digest(&input.digest)
        || !valid_timestamp(&input.accepted_at)
    {
        return Err(RelayError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    let matches: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM relay_deliveries WHERE delivery_id=?1 AND household_id=?2 AND artifact_id=?3 AND package_sha256=?4)",
        params![input.delivery_id,input.household_id,input.artifact_id,input.digest], |row| row.get(0),
    )?;
    if !matches {
        return Err(RelayError::Conflict);
    }
    transaction.execute(
        "UPDATE relay_deliveries SET state='ACCEPTED',accepted_at=?1,package_bytes=NULL WHERE delivery_id=?2",
        params![input.accepted_at, input.delivery_id],
    )?;
    transaction.execute(
        "UPDATE sync_outbox SET state='ACKNOWLEDGED',acknowledged_at=?1
         WHERE state='PENDING' AND envelope_id IN (SELECT envelope_id FROM relay_delivery_envelopes WHERE delivery_id=?2)",
        params![input.accepted_at,input.delivery_id],
    )?;
    transaction.commit()?;
    status(connection, &input.household_id)
}

pub fn mark_send_failed(
    connection: &Connection,
    household_id: &str,
    delivery_id: &str,
) -> Result<RelayStatusDto> {
    if !valid_id(household_id) || !valid_id(delivery_id) {
        return Err(RelayError::InvalidInput);
    }
    connection.execute(
        "UPDATE relay_deliveries SET state='FAILED_RETRYABLE',accepted_at=NULL WHERE household_id=?1 AND delivery_id=?2 AND state!='ACCEPTED'",
        params![household_id,delivery_id],
    )?;
    status(connection, household_id)
}

pub fn register_inbound(
    connection: &Connection,
    input: &RegisterInboundInput,
) -> Result<RelayStatusDto> {
    if !valid_id(&input.household_id) || input.artifacts.len() > 1000 {
        return Err(RelayError::InvalidInput);
    }
    let connected: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM relay_connections WHERE household_id=?1 AND state='CONNECTED')",
        [&input.household_id],
        |row| row.get(0),
    )?;
    if !connected {
        return Err(RelayError::NotConnected);
    }
    let local_device: String = connection.query_row(
        "SELECT device_id FROM local_sync_contexts WHERE household_id=?1",
        [&input.household_id],
        |row| row.get(0),
    )?;
    let transaction = connection.unchecked_transaction()?;
    for artifact in &input.artifacts {
        if !valid_id(&artifact.artifact_id)
            || !valid_id(&artifact.origin_device_id)
            || !valid_digest(&artifact.digest)
            || !valid_timestamp(&artifact.created_at)
            || artifact.origin_device_id == local_device
        {
            return Err(RelayError::InvalidInput);
        }
        register_one(&transaction, &input.household_id, artifact)?;
    }
    transaction.commit()?;
    status(connection, &input.household_id)
}

fn register_one(
    transaction: &Transaction<'_>,
    household_id: &str,
    artifact: &RelayInboundMetadataInput,
) -> Result<()> {
    let existing = transaction
        .query_row(
            "SELECT household_id,package_sha256 FROM relay_inbound_artifacts WHERE artifact_id=?1",
            [&artifact.artifact_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((existing_household, existing_digest)) = existing {
        if existing_household != household_id || existing_digest != artifact.digest {
            return Err(RelayError::Conflict);
        }
        return Ok(());
    }
    transaction.execute(
        "INSERT INTO relay_inbound_artifacts(artifact_id,household_id,package_sha256,origin_device_id,created_at,state) VALUES(?1,?2,?3,?4,?5,'AVAILABLE')",
        params![artifact.artifact_id,household_id,artifact.digest,artifact.origin_device_id,artifact.created_at],
    )?;
    Ok(())
}

pub fn stage_inbound(
    connection: &Connection,
    input: &StageInboundInput,
) -> Result<change_package::ChangePackageReviewDto> {
    if !valid_id(&input.household_id)
        || !valid_id(&input.artifact_id)
        || input.package_bytes.is_empty()
        || input.package_bytes.len() > MAX_PACKAGE_BYTES
    {
        return Err(RelayError::InvalidInput);
    }
    let (expected_digest, origin_device): (String,String) = connection.query_row(
        "SELECT package_sha256,origin_device_id FROM relay_inbound_artifacts WHERE artifact_id=?1 AND household_id=?2 AND state IN ('AVAILABLE','FAILED_RETRYABLE')",
        params![input.artifact_id,input.household_id], |row| Ok((row.get(0)?,row.get(1)?)),
    ).optional()?.ok_or(RelayError::InvalidInput)?;
    if digest(&input.package_bytes) != expected_digest {
        return Err(RelayError::Conflict);
    }
    let decoded = change_package::decode_and_validate(&input.package_bytes)
        .map_err(|_| RelayError::Package)?;
    if decoded.package_id != input.artifact_id
        || decoded.source_installation_id != origin_device
        || decoded.household_id != input.household_id
    {
        return Err(RelayError::Conflict);
    }
    let review =
        change_package::stage_package(connection, &input.household_id, &input.package_bytes)
            .map_err(|error| match error {
                change_package::ChangePackageError::ReviewPending => RelayError::ReviewPending,
                _ => RelayError::Package,
            })?;
    connection.execute(
        "UPDATE relay_inbound_artifacts SET state='WAITING_FOR_REVIEW',staged_package_id=?1 WHERE artifact_id=?2",
        params![review.package_id,input.artifact_id],
    )?;
    Ok(review)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::{AppState, PersistenceError};
    use crate::read_model::{create_household, CreateHouseholdInput};

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
                sync_foundation::get_local_status(connection, "family").unwrap();
                save_connection(
                    connection,
                    &SaveConnectionInput {
                        household_id: "family".into(),
                        endpoint: "https://relay.example.test".into(),
                        remote_principal_id: "remote-principal".into(),
                    },
                )
                .unwrap();
                Ok(())
            })
            .unwrap();
        state
    }

    #[test]
    fn accepted_delivery_acknowledges_only_its_snapshot() {
        let state = setup(1);
        state
            .with_connection(|connection| {
                let prepared = prepare_send(connection, "family").unwrap();
                let before: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM relay_delivery_envelopes WHERE delivery_id=?1",
                        [&prepared.delivery_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                connection
                    .execute(
                        "UPDATE households SET name='Family later' WHERE id='family'",
                        [],
                    )
                    .unwrap();
                sync_foundation::get_local_status(connection, "family").unwrap();
                mark_accepted(
                    connection,
                    &AcceptDeliveryInput {
                        household_id: "family".into(),
                        delivery_id: prepared.delivery_id,
                        artifact_id: prepared.artifact_id,
                        digest: prepared.digest,
                        accepted_at: "2026-07-14T00:00:00Z".into(),
                    },
                )
                .unwrap();
                let pending: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM sync_outbox WHERE state='PENDING'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert!(before > 0);
                assert!(
                    pending > 0,
                    "a change captured after the delivery snapshot must remain pending"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn failed_send_reuses_identical_package_and_does_not_ack() {
        let state = setup(2);
        state
            .with_connection(|connection| {
                let first = prepare_send(connection, "family").unwrap();
                mark_send_failed(connection, "family", &first.delivery_id).unwrap();
                let retry = prepare_send(connection, "family").unwrap();
                assert_eq!(first, retry);
                let acknowledged: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM sync_outbox WHERE state='ACKNOWLEDGED'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(acknowledged, 0);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn inbound_requires_registered_digest_origin_and_explicit_review() {
        let source = setup(3);
        let prepared = source
            .with_connection(|connection| {
                prepare_send(connection, "family").map_err(|_| PersistenceError::Lock)
            })
            .unwrap();
        let target = setup(4);
        target
            .with_connection(|connection| {
                let target_device: String = connection
                    .query_row(
                        "SELECT device_id FROM local_sync_contexts WHERE household_id='family'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_ne!(prepared.origin_device_id, target_device);
                register_inbound(
                    connection,
                    &RegisterInboundInput {
                        household_id: "family".into(),
                        artifacts: vec![RelayInboundMetadataInput {
                            artifact_id: prepared.artifact_id.clone(),
                            digest: digest(&prepared.package_bytes),
                            created_at: "2026-07-14T00:00:00Z".into(),
                            origin_device_id: prepared.origin_device_id.clone(),
                        }],
                    },
                )
                .unwrap();
                let review = stage_inbound(
                    connection,
                    &StageInboundInput {
                        household_id: "family".into(),
                        artifact_id: prepared.artifact_id,
                        package_bytes: prepared.package_bytes,
                    },
                )
                .unwrap();
                assert!(matches!(review.state.as_str(), "REVIEW_REQUIRED" | "READY"));
                assert_eq!(
                    connection
                        .query_row("SELECT state FROM relay_inbound_artifacts", [], |row| {
                            row.get::<_, String>(0)
                        })
                        .unwrap(),
                    "WAITING_FOR_REVIEW"
                );
                Ok(())
            })
            .unwrap();
    }
}
