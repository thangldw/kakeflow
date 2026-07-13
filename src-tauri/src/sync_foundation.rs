use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use thiserror::Error;

const MAX_ID_LEN: usize = 128;
const ENVELOPE_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Error)]
pub enum SyncFoundationError {
    #[error("sync foundation database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("sync foundation input is invalid")]
    InvalidInput,
    #[error("sync foundation identity was not found")]
    NotFound,
    #[error("sync mutation conflicts with an existing envelope")]
    Conflict,
    #[error("random device identity could not be generated")]
    Random,
    #[error("sync payload could not be encoded")]
    Encoding,
}

pub type Result<T> = std::result::Result<T, SyncFoundationError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalIdentityDto {
    pub id: String,
    pub display_name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrincipalBindingDto {
    pub household_id: String,
    pub principal_id: String,
    pub member_id: Option<String>,
    pub member_name: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalOutboxStatusDto {
    pub envelope_count: u64,
    pub latest_sequence: u64,
    pub latest_recorded_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalSyncFoundationStatusDto {
    pub device: LocalIdentityDto,
    pub platform: String,
    pub principal: LocalIdentityDto,
    pub binding: PrincipalBindingDto,
    pub outbox: LocalOutboxStatusDto,
    pub remote_transport: &'static str,
    pub restore_validation: &'static str,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdatePrincipalMemberBindingInput {
    pub household_id: String,
    pub principal_id: String,
    pub member_id: Option<String>,
    pub mutation_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncChangeEnvelopeDto {
    pub envelope_id: String,
    pub schema_version: u32,
    pub household_id: String,
    pub origin_device_id: String,
    pub origin_principal_id: String,
    pub origin_sequence: u64,
    pub mutation_id: String,
    pub entity_kind: String,
    pub entity_id: String,
    pub operation: String,
    pub canonical_payload_json: String,
    pub payload_sha256: String,
    pub occurred_at: String,
    pub state: String,
}

pub fn get_local_status(
    connection: &Connection,
    household_id: &str,
) -> Result<LocalSyncFoundationStatusDto> {
    validate_id(household_id)?;
    ensure_local_context(connection, household_id)?;
    connection
        .query_row(
            "SELECT d.id, d.display_name, d.platform, d.created_at,
                    p.id, p.display_name, p.created_at,
                    b.member_id, m.display_name, b.updated_at,
                    (SELECT count(*) FROM sync_change_envelopes e
                       WHERE e.household_id=c.household_id),
                    COALESCE((SELECT max(e.origin_sequence) FROM sync_change_envelopes e
                       WHERE e.household_id=c.household_id AND e.origin_device_id=c.device_id),0),
                    (SELECT max(e.occurred_at) FROM sync_change_envelopes e
                       WHERE e.household_id=c.household_id)
             FROM local_sync_contexts c
             JOIN sync_devices d ON d.id=c.device_id
             JOIN sync_principals p ON p.id=c.principal_id
             JOIN household_principal_bindings b
               ON b.household_id=c.household_id AND b.principal_id=c.principal_id
             LEFT JOIN household_members m
               ON m.household_id=b.household_id AND m.id=b.member_id
             WHERE c.household_id=?1",
            [household_id],
            |row| {
                let envelope_count: i64 = row.get(10)?;
                let latest_sequence: i64 = row.get(11)?;
                Ok(LocalSyncFoundationStatusDto {
                    device: LocalIdentityDto {
                        id: row.get(0)?,
                        display_name: row.get(1)?,
                        created_at: row.get(3)?,
                    },
                    platform: row.get(2)?,
                    principal: LocalIdentityDto {
                        id: row.get(4)?,
                        display_name: row.get(5)?,
                        created_at: row.get(6)?,
                    },
                    binding: PrincipalBindingDto {
                        household_id: household_id.to_owned(),
                        principal_id: row.get(4)?,
                        member_id: row.get(7)?,
                        member_name: row.get(8)?,
                        updated_at: row.get(9)?,
                    },
                    outbox: LocalOutboxStatusDto {
                        envelope_count: u64::try_from(envelope_count).unwrap_or(0),
                        latest_sequence: u64::try_from(latest_sequence).unwrap_or(0),
                        latest_recorded_at: row.get(12)?,
                    },
                    remote_transport: "NOT_CONFIGURED",
                    restore_validation: "ENABLED",
                })
            },
        )
        .map_err(SyncFoundationError::from)
}

pub fn update_principal_member_binding(
    connection: &Connection,
    input: &UpdatePrincipalMemberBindingInput,
) -> Result<LocalSyncFoundationStatusDto> {
    validate_id(&input.household_id)?;
    validate_id(&input.principal_id)?;
    validate_id(&input.mutation_id)?;
    if let Some(member_id) = input.member_id.as_deref() {
        validate_id(member_id)?;
    }
    ensure_local_context(connection, &input.household_id)?;
    let transaction = connection.unchecked_transaction()?;
    let context_principal: String = transaction.query_row(
        "SELECT principal_id FROM local_sync_contexts WHERE household_id=?1",
        [&input.household_id],
        |row| row.get(0),
    )?;
    if context_principal != input.principal_id {
        return Err(SyncFoundationError::NotFound);
    }
    if let Some(member_id) = input.member_id.as_deref() {
        let active: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM household_members
             WHERE household_id=?1 AND id=?2 AND status='ACTIVE')",
            params![input.household_id, member_id],
            |row| row.get(0),
        )?;
        if !active {
            return Err(SyncFoundationError::NotFound);
        }
    }
    transaction.execute(
        "UPDATE household_principal_bindings
         SET member_id=?1, status='ACTIVE', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?2 AND principal_id=?3",
        params![input.member_id, input.household_id, input.principal_id],
    )?;
    let payload = serde_json::json!({
        "householdId": input.household_id,
        "memberId": input.member_id,
        "principalId": input.principal_id,
    });
    enqueue_change_in_transaction(
        &transaction,
        &input.household_id,
        &input.mutation_id,
        "PRINCIPAL_BINDING",
        &input.principal_id,
        "UPSERT",
        &payload,
    )?;
    transaction.commit()?;
    get_local_status(connection, &input.household_id)
}

pub fn list_pending_envelopes(
    connection: &Connection,
    household_id: &str,
    limit: u32,
) -> Result<Vec<SyncChangeEnvelopeDto>> {
    validate_id(household_id)?;
    if limit == 0 || limit > 500 {
        return Err(SyncFoundationError::InvalidInput);
    }
    let mut statement = connection.prepare(
        "SELECT e.envelope_id, e.schema_version, e.household_id,
                e.origin_device_id, e.origin_principal_id, e.origin_sequence,
                e.mutation_id, e.entity_kind, e.entity_id, e.operation,
                e.canonical_payload_json, e.payload_sha256, e.occurred_at, o.state
         FROM sync_outbox o JOIN sync_change_envelopes e ON e.envelope_id=o.envelope_id
         WHERE e.household_id=?1 AND o.state='PENDING'
         ORDER BY e.origin_device_id, e.origin_sequence, e.envelope_id LIMIT ?2",
    )?;
    let rows = statement.query_map(params![household_id, limit], |row| {
        Ok(SyncChangeEnvelopeDto {
            envelope_id: row.get(0)?,
            schema_version: row.get::<_, u32>(1)?,
            household_id: row.get(2)?,
            origin_device_id: row.get(3)?,
            origin_principal_id: row.get(4)?,
            origin_sequence: row.get::<_, u64>(5)?,
            mutation_id: row.get(6)?,
            entity_kind: row.get(7)?,
            entity_id: row.get(8)?,
            operation: row.get(9)?,
            canonical_payload_json: row.get(10)?,
            payload_sha256: row.get(11)?,
            occurred_at: row.get(12)?,
            state: row.get(13)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

fn ensure_local_context(connection: &Connection, household_id: &str) -> Result<()> {
    if connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM local_sync_contexts WHERE household_id=?1)",
        [household_id],
        |row| row.get::<_, bool>(0),
    )? {
        return Ok(());
    }
    let transaction = connection.unchecked_transaction()?;
    let primary_member: String = transaction
        .query_row(
            "SELECT id FROM household_members
             WHERE household_id=?1 AND status='ACTIVE' ORDER BY sort_order, id LIMIT 1",
            [household_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(SyncFoundationError::NotFound)?;
    let principal_id = deterministic_principal_id(household_id);
    transaction.execute(
        "INSERT INTO sync_principals(id, display_name) VALUES(?1,'Local principal')
         ON CONFLICT(id) DO NOTHING",
        [&principal_id],
    )?;
    transaction.execute(
        "INSERT INTO household_principal_bindings(household_id,principal_id,member_id)
         VALUES(?1,?2,?3) ON CONFLICT(household_id,principal_id) DO NOTHING",
        params![household_id, principal_id, primary_member],
    )?;
    let existing_device: Option<String> = transaction
        .query_row(
            "SELECT id FROM sync_devices WHERE status='ACTIVE' ORDER BY created_at,id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let device_id = existing_device.unwrap_or(random_device_id()?);
    transaction.execute(
        "INSERT INTO sync_devices(id,display_name,platform) VALUES(?1,?2,?3)
         ON CONFLICT(id) DO NOTHING",
        params![device_id, local_device_name(), local_platform()],
    )?;
    transaction.execute(
        "INSERT INTO sync_device_sequences(device_id,next_sequence) VALUES(?1,1)
         ON CONFLICT(device_id) DO NOTHING",
        [&device_id],
    )?;
    transaction.execute(
        "INSERT INTO local_sync_contexts(household_id,device_id,principal_id)
         VALUES(?1,?2,?3)",
        params![household_id, device_id, principal_id],
    )?;
    transaction.commit()?;
    Ok(())
}

fn enqueue_change_in_transaction(
    transaction: &Transaction<'_>,
    household_id: &str,
    mutation_id: &str,
    entity_kind: &str,
    entity_id: &str,
    operation: &str,
    payload: &Value,
) -> Result<String> {
    if !matches!(operation, "UPSERT" | "DELETE")
        || [entity_kind, entity_id]
            .iter()
            .any(|value| value.is_empty() || value.len() > MAX_ID_LEN)
    {
        return Err(SyncFoundationError::InvalidInput);
    }
    let (device_id, principal_id): (String, String) = transaction.query_row(
        "SELECT device_id,principal_id FROM local_sync_contexts WHERE household_id=?1",
        [household_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let canonical_payload_json = canonical_json(payload)?;
    let payload_sha256 = sha256_hex(canonical_payload_json.as_bytes());
    if let Some(existing) = transaction
        .query_row(
            "SELECT envelope_id,entity_kind,entity_id,operation,payload_sha256
             FROM sync_change_envelopes WHERE origin_device_id=?1 AND mutation_id=?2",
            params![device_id, mutation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?
    {
        return if existing.1 == entity_kind
            && existing.2 == entity_id
            && existing.3 == operation
            && existing.4 == payload_sha256
        {
            Ok(existing.0)
        } else {
            Err(SyncFoundationError::Conflict)
        };
    }
    let sequence: i64 = transaction.query_row(
        "SELECT next_sequence FROM sync_device_sequences WHERE device_id=?1",
        [&device_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        "UPDATE sync_device_sequences SET next_sequence=next_sequence+1 WHERE device_id=?1",
        [&device_id],
    )?;
    let envelope_id = envelope_id(&EnvelopeSeed {
        household_id,
        device_id: &device_id,
        principal_id: &principal_id,
        sequence,
        mutation_id,
        entity_kind,
        entity_id,
        operation,
        payload_sha256: &payload_sha256,
    });
    transaction.execute(
        "INSERT INTO sync_change_envelopes(
           envelope_id,schema_version,household_id,origin_device_id,origin_principal_id,
           origin_sequence,mutation_id,entity_kind,entity_id,operation,
           canonical_payload_json,payload_sha256)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            envelope_id,
            ENVELOPE_SCHEMA_VERSION,
            household_id,
            device_id,
            principal_id,
            sequence,
            mutation_id,
            entity_kind,
            entity_id,
            operation,
            canonical_payload_json,
            payload_sha256
        ],
    )?;
    transaction.execute(
        "INSERT INTO sync_outbox(envelope_id) VALUES(?1)",
        [&envelope_id],
    )?;
    Ok(envelope_id)
}

fn deterministic_principal_id(household_id: &str) -> String {
    format!(
        "principal-{}",
        &sha256_hex(format!("kakeflow:local-principal:v1:{household_id}").as_bytes())[..32]
    )
}

fn random_device_id() -> Result<String> {
    let mut random = [0_u8; 16];
    getrandom::getrandom(&mut random).map_err(|_| SyncFoundationError::Random)?;
    Ok(format!("device-{}", hex(&random)))
}

fn local_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "MACOS",
        "windows" => "WINDOWS",
        _ => "OTHER",
    }
}

fn local_device_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "KakeFlow on macOS",
        "windows" => "KakeFlow on Windows",
        _ => "KakeFlow desktop",
    }
}

fn canonical_json(value: &Value) -> Result<String> {
    fn sorted(value: &Value) -> Value {
        match value {
            Value::Object(object) => {
                let mut keys = object.keys().collect::<Vec<_>>();
                keys.sort_unstable();
                let mut result = Map::new();
                for key in keys {
                    result.insert(key.clone(), sorted(&object[key]));
                }
                Value::Object(result)
            }
            Value::Array(values) => Value::Array(values.iter().map(sorted).collect()),
            other => other.clone(),
        }
    }
    serde_json::to_string(&sorted(value)).map_err(|_| SyncFoundationError::Encoding)
}

struct EnvelopeSeed<'a> {
    household_id: &'a str,
    device_id: &'a str,
    principal_id: &'a str,
    sequence: i64,
    mutation_id: &'a str,
    entity_kind: &'a str,
    entity_id: &'a str,
    operation: &'a str,
    payload_sha256: &'a str,
}

fn envelope_id(seed: &EnvelopeSeed<'_>) -> String {
    let EnvelopeSeed {
        household_id,
        device_id,
        principal_id,
        sequence,
        mutation_id,
        entity_kind,
        entity_id,
        operation,
        payload_sha256,
    } = seed;
    let source = format!("kakeflow:envelope:v1\0{household_id}\0{device_id}\0{principal_id}\0{sequence}\0{mutation_id}\0{entity_kind}\0{entity_id}\0{operation}\0{payload_sha256}");
    format!("envelope-{}", sha256_hex(source.as_bytes()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn validate_id(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > MAX_ID_LEN
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':'))
    {
        return Err(SyncFoundationError::InvalidInput);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE households(id TEXT PRIMARY KEY) STRICT;
             CREATE TABLE household_members(
               id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
               display_name TEXT NOT NULL, status TEXT NOT NULL, sort_order INTEGER NOT NULL,
               UNIQUE(household_id,id)) STRICT;
             INSERT INTO households VALUES('family');
             INSERT INTO household_members VALUES('taro','family','Taro','ACTIVE',0);",
        ).unwrap();
        connection
            .execute_batch(include_str!("../migrations/0031_sync_foundation.sql"))
            .unwrap();
        connection
    }

    #[test]
    fn local_context_is_stable_and_explicitly_bound() {
        let connection = database();
        let first = get_local_status(&connection, "family").unwrap();
        let second = get_local_status(&connection, "family").unwrap();
        assert_eq!(first.device.id, second.device.id);
        assert_eq!(first.principal.id, second.principal.id);
        assert_eq!(first.binding.member_id.as_deref(), Some("taro"));
        assert_eq!(first.remote_transport, "NOT_CONFIGURED");
    }

    #[test]
    fn binding_change_creates_deterministic_pending_envelope() {
        let connection = database();
        let status = get_local_status(&connection, "family").unwrap();
        let input = UpdatePrincipalMemberBindingInput {
            household_id: "family".into(),
            principal_id: status.principal.id,
            member_id: None,
            mutation_id: "binding-1".into(),
        };
        let changed = update_principal_member_binding(&connection, &input).unwrap();
        assert_eq!(changed.binding.member_id, None);
        assert_eq!(changed.outbox.envelope_count, 1);
        let pending = list_pending_envelopes(&connection, "family", 10).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].origin_sequence, 1);
        assert_eq!(
            pending[0].canonical_payload_json,
            format!(
                "{{\"householdId\":\"family\",\"memberId\":null,\"principalId\":\"{}\"}}",
                input.principal_id
            )
        );
    }

    #[test]
    fn mutation_retry_is_idempotent_and_conflicting_content_is_rejected() {
        let connection = database();
        let status = get_local_status(&connection, "family").unwrap();
        let mut input = UpdatePrincipalMemberBindingInput {
            household_id: "family".into(),
            principal_id: status.principal.id,
            member_id: None,
            mutation_id: "retry".into(),
        };
        update_principal_member_binding(&connection, &input).unwrap();
        update_principal_member_binding(&connection, &input).unwrap();
        assert_eq!(
            list_pending_envelopes(&connection, "family", 10)
                .unwrap()
                .len(),
            1
        );
        input.member_id = Some("taro".into());
        assert!(matches!(
            update_principal_member_binding(&connection, &input),
            Err(SyncFoundationError::Conflict)
        ));
    }
}
