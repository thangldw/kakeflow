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
    drain_local_change_capture(connection, household_id)?;
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

fn drain_local_change_capture(connection: &Connection, household_id: &str) -> Result<()> {
    let available: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master
         WHERE type='table' AND name='sync_local_change_capture')",
        [],
        |row| row.get(0),
    )?;
    if !available {
        return Ok(());
    }
    let transaction = connection.unchecked_transaction()?;
    loop {
        let captured = {
            let mut statement = transaction.prepare(
                "SELECT c.capture_sequence,c.entity_kind,c.entity_id,c.operation,c.payload_json
                 FROM sync_local_change_capture c
                 WHERE c.household_id=?1 AND c.processed_envelope_id IS NULL
                   AND c.capture_sequence=(
                     SELECT max(latest.capture_sequence)
                     FROM sync_local_change_capture latest
                     WHERE latest.household_id=c.household_id
                       AND latest.entity_kind=c.entity_kind
                       AND latest.entity_id=c.entity_id
                       AND latest.processed_envelope_id IS NULL
                   )
                 ORDER BY c.capture_sequence LIMIT 1000",
            )?;
            let rows = statement.query_map([household_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        if captured.is_empty() {
            break;
        }
        for (capture_sequence, entity_kind, entity_id, operation, payload_json) in captured {
            let payload: Value =
                serde_json::from_str(&payload_json).map_err(|_| SyncFoundationError::Encoding)?;
            let canonical_payload_json = canonical_json(&payload)?;
            let mutation_id = format!("capture:{capture_sequence}");
            let envelope_id = enqueue_change_in_transaction(
                &transaction,
                household_id,
                &mutation_id,
                &entity_kind,
                &entity_id,
                &operation,
                &payload,
            )?;
            transaction.execute(
                "UPDATE sync_local_change_capture
                 SET processed_envelope_id=?1,operation=?2,payload_json=?3
                 WHERE household_id=?4 AND entity_kind=?5 AND entity_id=?6
                   AND capture_sequence<=?7 AND processed_envelope_id IS NULL",
                params![
                    envelope_id,
                    operation,
                    canonical_payload_json,
                    household_id,
                    entity_kind,
                    entity_id,
                    capture_sequence
                ],
            )?;
        }
    }
    transaction.commit()?;
    Ok(())
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
             CREATE TABLE households(
               id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Family',
               base_currency TEXT NOT NULL DEFAULT 'JPY',
               created_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z',
               updated_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z') STRICT;
             CREATE TABLE household_members(
               id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
               display_name TEXT NOT NULL, status TEXT NOT NULL, sort_order INTEGER NOT NULL,
               relationship_label TEXT, created_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z',
               updated_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z',
               UNIQUE(household_id,id)) STRICT;
             CREATE TABLE accounts(
               id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
               name TEXT NOT NULL, account_kind TEXT NOT NULL, account_subtype TEXT NOT NULL,
               currency TEXT NOT NULL DEFAULT 'JPY', institution_name TEXT, masked_identifier TEXT,
               is_archived INTEGER NOT NULL DEFAULT 0, owner_member_id TEXT,
               ownership_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD', visibility TEXT NOT NULL DEFAULT 'SHARED',
               created_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z',
               updated_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z') STRICT;
             CREATE TABLE transactions(
               id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
               occurred_on TEXT NOT NULL, posted_on TEXT, transaction_type TEXT NOT NULL,
               payee TEXT, description TEXT, status TEXT NOT NULL DEFAULT 'POSTED',
               calculation_target INTEGER NOT NULL DEFAULT 1,
               attribution_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD', attributed_member_id TEXT,
               audience_visibility TEXT NOT NULL DEFAULT 'SHARED', audience_member_id TEXT,
               created_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z',
               updated_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z') STRICT;
             CREATE TABLE journal_entries(
               id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
               account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
               entry_side TEXT NOT NULL, amount_jpy INTEGER NOT NULL, line_number INTEGER NOT NULL,
               created_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z',
               UNIQUE(transaction_id,line_number)) STRICT;
             CREATE TABLE transaction_sources(
               transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
               source_record_id TEXT NOT NULL,candidate_id TEXT,
               PRIMARY KEY(transaction_id,source_record_id)) STRICT, WITHOUT ROWID;
             CREATE TABLE transaction_external_keys(
               household_id TEXT NOT NULL,external_source TEXT NOT NULL,external_id TEXT NOT NULL,
               fact_hash TEXT NOT NULL,transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
               created_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z',
               PRIMARY KEY(household_id,external_source,external_id)) STRICT, WITHOUT ROWID;
             INSERT INTO households(id) VALUES('family');
             INSERT INTO household_members(id,household_id,display_name,status,sort_order)
             VALUES('taro','family','Taro','ACTIVE',0);",
        ).unwrap();
        connection
            .execute_batch(include_str!("../migrations/0007_planning.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0009_classification_rules.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0011_account_groups.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0019_delimited_parser_profiles.sql"
            ))
            .unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0023_card_settlement_bank_mappings.sql"
            ))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0029_dashboard_preferences.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0030_cash_flow_dashboard.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0031_sync_foundation.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0032_core_change_capture.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0033_replicable_ledger_capture.sql"
            ))
            .unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0034_replicable_planning_capture.sql"
            ))
            .unwrap();
        connection
    }

    fn seed_planning_configuration(connection: &Connection) {
        connection
            .execute_batch(
                "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('bank','family','Bank','ASSET','BANK'),
                       ('card','family','Card','LIABILITY','CREDIT_CARD'),
                       ('food','family','Food','EXPENSE','OTHER'),
                       ('travel','family','Travel','EXPENSE','OTHER');
                 INSERT INTO monthly_category_budgets(household_id,month,category_account_id,budget_jpy)
                 VALUES('family','2026-08','travel',30000),('family','2026-07','food',50000);
                 INSERT INTO savings_goals(id,household_id,name,target_jpy,saved_jpy,target_date,status)
                 VALUES('goal','family','Emergency',500000,100000,'2027-07-01','ACTIVE');
                 INSERT INTO classification_rules(
                   id,household_id,name,priority,is_enabled,merchant_contains,category_account_id)
                 VALUES('rule','family','Market',10,1,'MARKET','food');
                 INSERT INTO classification_rule_labels VALUES('rule','Reviewed'),('rule','Recurring');
                 INSERT INTO classification_rule_tags VALUES('rule','weekly'),('rule','family');
                 INSERT INTO account_groups(id,household_id,name,group_kind,sort_order)
                 VALUES('group','family','Daily','DAILY_SPENDING',0);
                 INSERT INTO account_group_members(household_id,account_group_id,account_id,sort_order)
                 VALUES('family','group','food',1),('family','group','bank',0);
                 INSERT INTO card_settlement_bank_mappings(household_id,card_account_id,bank_account_id)
                 VALUES('family','card','bank');
                 INSERT INTO dashboard_preferences(household_id,dashboard_template,theme,density)
                 VALUES('family','CASH_FLOW','DARK','COMPACT');
                 INSERT INTO delimited_parser_profiles(
                   id,household_id,name,delimiter,encoding,header_row,date_column,date_format,
                   description_column,payee_column,amount_mode,signed_positive_direction,
                   signed_amount_column,debit_column,credit_column,is_enabled,priority,version)
                 VALUES('profile','family','Bank CSV','COMMA','CP932',2,'Date','YYYY_MM_DD',
                   'Description',NULL,'SIGNED','OUT','Amount',NULL,NULL,1,5,2);",
            )
            .unwrap();
    }

    fn latest_payload(connection: &Connection, kind: &str, id: &str) -> (String, Value) {
        let envelope = list_pending_envelopes(connection, "family", 500)
            .unwrap()
            .into_iter()
            .filter(|item| item.entity_kind == kind && item.entity_id == id)
            .max_by_key(|item| item.origin_sequence)
            .expect("expected planning/config envelope");
        (
            envelope.operation,
            serde_json::from_str(&envelope.canonical_payload_json).unwrap(),
        )
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
        let baseline = status.outbox.envelope_count;
        let input = UpdatePrincipalMemberBindingInput {
            household_id: "family".into(),
            principal_id: status.principal.id,
            member_id: None,
            mutation_id: "binding-1".into(),
        };
        let changed = update_principal_member_binding(&connection, &input).unwrap();
        assert_eq!(changed.binding.member_id, None);
        assert_eq!(changed.outbox.envelope_count, baseline + 1);
        let pending = list_pending_envelopes(&connection, "family", 10).unwrap();
        let binding = pending
            .iter()
            .find(|item| item.entity_kind == "PRINCIPAL_BINDING")
            .unwrap();
        assert_eq!(binding.origin_sequence, baseline + 1);
        assert_eq!(
            binding.canonical_payload_json,
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
                .iter()
                .filter(|item| item.mutation_id == "retry")
                .count(),
            1
        );
        input.member_id = Some("taro".into());
        assert!(matches!(
            update_principal_member_binding(&connection, &input),
            Err(SyncFoundationError::Conflict)
        ));
    }

    #[test]
    fn core_domain_writes_are_captured_and_drained_in_order() {
        let connection = database();
        let baseline = get_local_status(&connection, "family").unwrap().outbox;
        connection
            .execute(
                "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
             VALUES('bank','family','Bank','ASSET','BANK')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,payee)
             VALUES('tx','family','2026-07-13','EXPENSE','Store')",
                [],
            )
            .unwrap();
        let status = get_local_status(&connection, "family").unwrap();
        let pending = list_pending_envelopes(&connection, "family", 20).unwrap();
        assert_eq!(status.outbox.envelope_count, baseline.envelope_count + 2);
        assert_eq!(
            pending
                .iter()
                .filter(|item| matches!(item.entity_kind.as_str(), "ACCOUNT" | "TRANSACTION"))
                .map(|item| item.entity_kind.as_str())
                .collect::<Vec<_>>(),
            vec!["ACCOUNT", "TRANSACTION"]
        );
        assert_eq!(
            pending[pending.len() - 2].origin_sequence,
            baseline.latest_sequence + 1
        );
        assert_eq!(
            pending[pending.len() - 1].origin_sequence,
            baseline.latest_sequence + 2
        );
        assert_eq!(connection.query_row(
            "SELECT count(*) FROM sync_local_change_capture WHERE processed_envelope_id IS NULL",
            [], |row| row.get::<_, i64>(0),
        ).unwrap(), 0);
    }

    #[test]
    fn posted_transaction_aggregate_replays_into_a_second_database_balanced() {
        let source = database();
        get_local_status(&source, "family").unwrap();
        source
            .execute_batch(
                "BEGIN;
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('bank','family','Bank','ASSET','BANK'),
                       ('food','family','Food','EXPENSE','OTHER');
                 INSERT INTO transactions(
                   id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,
                   calculation_target,attribution_kind,attributed_member_id,
                   audience_visibility,audience_member_id)
                 VALUES('ledger-tx','family','2026-07-13','2026-07-14','EXPENSE','Market',
                        'Weekly groceries','POSTED',1,'MEMBER','taro','PERSONAL','taro');
                 INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                 VALUES('ledger-tx-d','ledger-tx','food','DEBIT',4200,1),
                       ('ledger-tx-c','ledger-tx','bank','CREDIT',4200,2);
                 INSERT INTO transaction_labels VALUES('ledger-tx','Recurring'),('ledger-tx','Reviewed');
                 INSERT INTO transaction_tags VALUES('ledger-tx','weekly'),('ledger-tx','family');
                 INSERT INTO transaction_sources VALUES('ledger-tx','source-row-7','candidate-7');
                 INSERT INTO transaction_external_keys(
                   household_id,external_source,external_id,fact_hash,transaction_id)
                 VALUES('family','MONEY_FORWARD_ME','mf-7',
                   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','ledger-tx');
                 COMMIT;",
            )
            .unwrap();

        get_local_status(&source, "family").unwrap();
        let envelopes = list_pending_envelopes(&source, "family", 20).unwrap();
        let aggregate = envelopes
            .iter()
            .find(|item| item.entity_kind == "TRANSACTION" && item.entity_id == "ledger-tx")
            .unwrap();
        assert_eq!(
            envelopes
                .iter()
                .filter(|item| item.entity_kind == "TRANSACTION")
                .count(),
            1
        );
        let payload: Value = serde_json::from_str(&aggregate.canonical_payload_json).unwrap();
        assert_eq!(payload["recordKind"], "TRANSACTION_AGGREGATE");
        assert_eq!(payload["attributionKind"], "MEMBER");
        assert_eq!(payload["audienceVisibility"], "PERSONAL");
        assert_eq!(
            payload["labels"],
            serde_json::json!(["Recurring", "Reviewed"])
        );
        assert_eq!(payload["tags"], serde_json::json!(["family", "weekly"]));
        assert_eq!(payload["journalEntries"].as_array().unwrap().len(), 2);
        assert_eq!(payload["journalEntries"][0]["lineNumber"], 1);
        assert_eq!(payload["journalEntries"][1]["lineNumber"], 2);
        assert_eq!(payload["sourceLinks"][0]["sourceRecordId"], "source-row-7");
        assert_eq!(payload["externalKeys"][0]["externalId"], "mf-7");

        let capture_stats: (i64, i64) = source
            .query_row(
                "SELECT count(*),count(DISTINCT processed_envelope_id)
                 FROM sync_local_change_capture
                 WHERE entity_kind='TRANSACTION' AND entity_id='ledger-tx'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(capture_stats, (9, 1));

        let destination = Connection::open_in_memory().unwrap();
        destination
            .execute_batch(
                "CREATE TABLE transactions(
                   id TEXT PRIMARY KEY,household_id TEXT,occurred_on TEXT,posted_on TEXT,
                   transaction_type TEXT,payee TEXT,description TEXT,status TEXT,
                   calculation_target INTEGER,attribution_kind TEXT,attributed_member_id TEXT,
                   audience_visibility TEXT,audience_member_id TEXT,created_at TEXT,updated_at TEXT);
                 CREATE TABLE journal_entries(
                   id TEXT PRIMARY KEY,transaction_id TEXT,account_id TEXT,entry_side TEXT,
                   amount_jpy INTEGER,line_number INTEGER,created_at TEXT,
                   UNIQUE(transaction_id,line_number));
                 CREATE TABLE transaction_labels(transaction_id TEXT,label TEXT,PRIMARY KEY(transaction_id,label));
                 CREATE TABLE transaction_tags(transaction_id TEXT,tag TEXT,PRIMARY KEY(transaction_id,tag));
                 CREATE TABLE transaction_sources(
                   transaction_id TEXT,source_record_id TEXT,candidate_id TEXT,
                   PRIMARY KEY(transaction_id,source_record_id));
                 CREATE TABLE transaction_external_keys(
                   household_id TEXT,external_source TEXT,external_id TEXT,fact_hash TEXT,
                   transaction_id TEXT,created_at TEXT,
                   PRIMARY KEY(household_id,external_source,external_id));",
            )
            .unwrap();
        let value = |key: &str| payload.get(key).and_then(Value::as_str);
        destination
            .execute(
                "INSERT INTO transactions VALUES(
                   ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                params![
                    value("id"),
                    value("householdId"),
                    value("occurredOn"),
                    value("postedOn"),
                    value("transactionType"),
                    value("payee"),
                    value("description"),
                    value("status"),
                    payload["calculationTarget"].as_i64(),
                    value("attributionKind"),
                    value("attributedMemberId"),
                    value("audienceVisibility"),
                    value("audienceMemberId"),
                    value("createdAt"),
                    value("updatedAt")
                ],
            )
            .unwrap();
        for entry in payload["journalEntries"].as_array().unwrap() {
            destination
                .execute(
                    "INSERT INTO journal_entries VALUES(?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        entry["id"].as_str(),
                        entry["transactionId"].as_str(),
                        entry["accountId"].as_str(),
                        entry["entrySide"].as_str(),
                        entry["amountJpy"].as_i64(),
                        entry["lineNumber"].as_i64(),
                        entry["createdAt"].as_str()
                    ],
                )
                .unwrap();
        }
        for label in payload["labels"].as_array().unwrap() {
            destination
                .execute(
                    "INSERT INTO transaction_labels VALUES(?1,?2)",
                    params![value("id"), label.as_str()],
                )
                .unwrap();
        }
        for tag in payload["tags"].as_array().unwrap() {
            destination
                .execute(
                    "INSERT INTO transaction_tags VALUES(?1,?2)",
                    params![value("id"), tag.as_str()],
                )
                .unwrap();
        }
        for link in payload["sourceLinks"].as_array().unwrap() {
            destination
                .execute(
                    "INSERT INTO transaction_sources VALUES(?1,?2,?3)",
                    params![
                        link["transactionId"].as_str(),
                        link["sourceRecordId"].as_str(),
                        link["candidateId"].as_str()
                    ],
                )
                .unwrap();
        }
        for key in payload["externalKeys"].as_array().unwrap() {
            destination
                .execute(
                    "INSERT INTO transaction_external_keys VALUES(?1,?2,?3,?4,?5,?6)",
                    params![
                        key["householdId"].as_str(),
                        key["externalSource"].as_str(),
                        key["externalId"].as_str(),
                        key["factHash"].as_str(),
                        key["transactionId"].as_str(),
                        key["createdAt"].as_str()
                    ],
                )
                .unwrap();
        }

        let balance: i64 = destination
            .query_row(
                "SELECT SUM(CASE entry_side WHEN 'DEBIT' THEN amount_jpy ELSE -amount_jpy END)
                 FROM journal_entries WHERE transaction_id='ledger-tx'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(balance, 0);
        assert_eq!(
            destination
                .query_row(
                    "SELECT payee||':'||attribution_kind||':'||audience_visibility
                     FROM transactions WHERE id='ledger-tx'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "Market:MEMBER:PERSONAL"
        );
        assert_eq!(
            destination
                .query_row(
                    "SELECT group_concat(label,',') FROM
                     (SELECT label FROM transaction_labels ORDER BY label)",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "Recurring,Reviewed"
        );
        assert_eq!(
            destination
                .query_row(
                    "SELECT source_record_id||':'||candidate_id FROM transaction_sources",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "source-row-7:candidate-7"
        );
        assert_eq!(
            destination
                .query_row(
                    "SELECT external_source||':'||external_id FROM transaction_external_keys",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "MONEY_FORWARD_ME:mf-7"
        );

        let before = envelopes.len();
        get_local_status(&source, "family").unwrap();
        assert_eq!(
            list_pending_envelopes(&source, "family", 20).unwrap().len(),
            before
        );
    }

    #[test]
    fn metadata_updates_are_captured_and_household_moves_are_rejected() {
        let connection = database();
        get_local_status(&connection, "family").unwrap();
        connection
            .execute_batch(
                "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('bank','family','Bank','ASSET','BANK'),('food','family','Food','EXPENSE','OTHER');
                 INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status)
                 VALUES('tx','family','2026-07-13','EXPENSE','POSTED');
                 INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                 VALUES('d','tx','food','DEBIT',1000,1),('c','tx','bank','CREDIT',1000,2);
                 INSERT INTO transaction_labels VALUES('tx','OLD');
                 INSERT INTO transaction_tags VALUES('tx','before');",
            )
            .unwrap();
        get_local_status(&connection, "family").unwrap();
        connection
            .execute_batch(
                "UPDATE transaction_labels SET label='NEW' WHERE transaction_id='tx' AND label='OLD';
                 UPDATE transaction_tags SET tag='after' WHERE transaction_id='tx' AND tag='before';",
            )
            .unwrap();
        get_local_status(&connection, "family").unwrap();
        let latest = list_pending_envelopes(&connection, "family", 50)
            .unwrap()
            .into_iter()
            .filter(|item| item.entity_kind == "TRANSACTION" && item.entity_id == "tx")
            .max_by_key(|item| item.origin_sequence)
            .unwrap();
        let payload: Value = serde_json::from_str(&latest.canonical_payload_json).unwrap();
        assert_eq!(payload["labels"], serde_json::json!(["NEW"]));
        assert_eq!(payload["tags"], serde_json::json!(["after"]));
        connection
            .execute("INSERT INTO households(id) VALUES('other')", [])
            .unwrap();
        assert!(connection
            .execute(
                "UPDATE accounts SET household_id='other' WHERE id='bank'",
                []
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE transactions SET household_id='other' WHERE id='tx'",
                []
            )
            .is_err());
    }

    #[test]
    fn planning_configuration_captures_complete_coalesced_payloads() {
        let connection = database();
        let baseline = get_local_status(&connection, "family")
            .unwrap()
            .outbox
            .latest_sequence;
        seed_planning_configuration(&connection);
        get_local_status(&connection, "family").unwrap();

        let planning = list_pending_envelopes(&connection, "family", 500)
            .unwrap()
            .into_iter()
            .filter(|item| {
                item.origin_sequence > baseline
                    && matches!(
                        item.entity_kind.as_str(),
                        "MONTHLY_BUDGET_PLAN"
                            | "SAVINGS_GOAL"
                            | "CLASSIFICATION_RULE"
                            | "ACCOUNT_GROUP"
                            | "CARD_SETTLEMENT_MAPPING"
                            | "DASHBOARD_PREFERENCES"
                            | "DELIMITED_PARSER_PROFILE"
                    )
            })
            .collect::<Vec<_>>();
        assert_eq!(planning.len(), 7);
        for kind in [
            "MONTHLY_BUDGET_PLAN",
            "SAVINGS_GOAL",
            "CLASSIFICATION_RULE",
            "ACCOUNT_GROUP",
            "CARD_SETTLEMENT_MAPPING",
            "DASHBOARD_PREFERENCES",
            "DELIMITED_PARSER_PROFILE",
        ] {
            assert_eq!(
                planning
                    .iter()
                    .filter(|item| item.entity_kind == kind)
                    .count(),
                1,
                "{kind} should coalesce to one envelope"
            );
        }

        let (_, budget) = latest_payload(&connection, "MONTHLY_BUDGET_PLAN", "family");
        assert_eq!(budget["recordKind"], "MONTHLY_BUDGET_PLAN");
        assert_eq!(budget["budgets"].as_array().unwrap().len(), 2);
        assert_eq!(budget["budgets"][0]["month"], "2026-07");
        assert_eq!(budget["budgets"][1]["month"], "2026-08");

        let (_, goal) = latest_payload(&connection, "SAVINGS_GOAL", "goal");
        assert_eq!(goal["targetJpy"], 500_000);
        assert_eq!(goal["savedJpy"], 100_000);
        assert_eq!(goal["status"], "ACTIVE");

        let (_, rule) = latest_payload(&connection, "CLASSIFICATION_RULE", "rule");
        assert_eq!(rule["categoryAccountId"], "food");
        assert_eq!(rule["labels"], serde_json::json!(["Recurring", "Reviewed"]));
        assert_eq!(rule["tags"], serde_json::json!(["family", "weekly"]));

        let (_, group) = latest_payload(&connection, "ACCOUNT_GROUP", "group");
        assert_eq!(group["members"][0]["accountId"], "bank");
        assert_eq!(group["members"][1]["accountId"], "food");

        let (_, mapping) = latest_payload(&connection, "CARD_SETTLEMENT_MAPPING", "card");
        assert_eq!(mapping["bankAccountId"], "bank");
        let (_, dashboard) = latest_payload(&connection, "DASHBOARD_PREFERENCES", "family");
        assert_eq!(dashboard["dashboardTemplate"], "CASH_FLOW");
        let (_, profile) = latest_payload(&connection, "DELIMITED_PARSER_PROFILE", "profile");
        assert_eq!(profile["amountMode"], "SIGNED");
        assert_eq!(profile["signedPositiveDirection"], "OUT");

        let before = list_pending_envelopes(&connection, "family", 500)
            .unwrap()
            .len();
        get_local_status(&connection, "family").unwrap();
        assert_eq!(
            list_pending_envelopes(&connection, "family", 500)
                .unwrap()
                .len(),
            before
        );
    }

    #[test]
    fn planning_children_empty_state_and_parent_deletes_capture_final_state() {
        let connection = database();
        get_local_status(&connection, "family").unwrap();
        seed_planning_configuration(&connection);
        get_local_status(&connection, "family").unwrap();

        connection
            .execute_batch(
                "UPDATE classification_rule_labels SET label='Automatic'
                   WHERE rule_id='rule' AND label='Recurring';
                 DELETE FROM classification_rule_tags WHERE rule_id='rule' AND tag='weekly';
                 DELETE FROM account_group_members
                   WHERE account_group_id='group' AND account_id='food';
                 DELETE FROM monthly_category_budgets WHERE household_id='family';",
            )
            .unwrap();
        get_local_status(&connection, "family").unwrap();
        let (budget_operation, budget) =
            latest_payload(&connection, "MONTHLY_BUDGET_PLAN", "family");
        assert_eq!(budget_operation, "UPSERT");
        assert_eq!(budget["budgets"], serde_json::json!([]));
        let (_, rule) = latest_payload(&connection, "CLASSIFICATION_RULE", "rule");
        assert_eq!(rule["labels"], serde_json::json!(["Automatic", "Reviewed"]));
        assert_eq!(rule["tags"], serde_json::json!(["family"]));
        let (_, group) = latest_payload(&connection, "ACCOUNT_GROUP", "group");
        assert_eq!(group["members"].as_array().unwrap().len(), 1);
        assert_eq!(group["members"][0]["accountId"], "bank");

        connection
            .execute_batch(
                "DELETE FROM classification_rules WHERE id='rule';
                 DELETE FROM account_groups WHERE id='group';
                 DELETE FROM savings_goals WHERE id='goal';
                 DELETE FROM card_settlement_bank_mappings WHERE card_account_id='card';
                 DELETE FROM dashboard_preferences WHERE household_id='family';
                 DELETE FROM delimited_parser_profiles WHERE id='profile';",
            )
            .unwrap();
        get_local_status(&connection, "family").unwrap();
        for (kind, id) in [
            ("CLASSIFICATION_RULE", "rule"),
            ("ACCOUNT_GROUP", "group"),
            ("SAVINGS_GOAL", "goal"),
            ("CARD_SETTLEMENT_MAPPING", "card"),
            ("DASHBOARD_PREFERENCES", "family"),
            ("DELIMITED_PARSER_PROFILE", "profile"),
        ] {
            let (operation, payload) = latest_payload(&connection, kind, id);
            assert_eq!(operation, "DELETE", "{kind} delete must win coalescing");
            assert_eq!(payload["recordKind"], kind);
        }
    }

    #[test]
    fn drain_processes_more_than_one_thousand_distinct_config_entities() {
        let connection = database();
        get_local_status(&connection, "family").unwrap();
        let transaction = connection.unchecked_transaction().unwrap();
        for index in 0..1_001 {
            transaction
                .execute(
                    "INSERT INTO savings_goals(
                       id,household_id,name,target_jpy,saved_jpy,target_date,status)
                     VALUES(?1,'family',?2,1000,0,'2027-01-01','ACTIVE')",
                    params![format!("goal-{index}"), format!("Goal {index}")],
                )
                .unwrap();
        }
        transaction.commit().unwrap();

        get_local_status(&connection, "family").unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sync_change_envelopes
                     WHERE household_id='family' AND entity_kind='SAVINGS_GOAL'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1_001
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sync_local_change_capture
                     WHERE household_id='family' AND processed_envelope_id IS NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn household_delete_cascades_without_creating_orphan_captures() {
        let connection = database();
        seed_planning_configuration(&connection);
        connection
            .execute(
                "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status)
                 VALUES('tx','family','2026-07-13','EXPENSE','DRAFT')",
                [],
            )
            .unwrap();
        connection
            .execute("DELETE FROM households WHERE id='family'", [])
            .expect("household cascade must not violate capture foreign keys");
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM households", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sync_local_change_capture",
                    [],
                    |row| { row.get::<_, i64>(0) }
                )
                .unwrap(),
            0
        );
    }
}
