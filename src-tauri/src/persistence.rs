use rusqlite::{Connection, OpenFlags, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;
use zeroize::Zeroizing;

use crate::private_fs;

const MIGRATIONS: &[M<'static>] = &[
    M::up(include_str!("../migrations/0001_household_accounts.sql")),
    M::up(include_str!("../migrations/0002_import_provenance.sql")),
    M::up(include_str!("../migrations/0003_candidates.sql")),
    M::up(include_str!("../migrations/0004_transactions_journal.sql")),
    M::up(include_str!("../migrations/0005_card_reconciliation.sql")),
    M::up(include_str!(
        "../migrations/0006_import_card_statements.sql"
    )),
    M::up(include_str!("../migrations/0007_planning.sql")),
    M::up(include_str!("../migrations/0008_watched_folders.sql")),
    M::up(include_str!("../migrations/0009_classification_rules.sql")),
    M::up(include_str!("../migrations/0010_portfolio_snapshots.sql")),
    M::up(include_str!("../migrations/0011_account_groups.sql")),
    M::up(include_str!("../migrations/0012_brokerage_events.sql")),
    M::up(include_str!(
        "../migrations/0013_investment_performance.sql"
    )),
    M::up(include_str!(
        "../migrations/0014_investment_corporate_actions_fx.sql"
    )),
    M::up(include_str!(
        "../migrations/0015_investment_market_prices.sql"
    )),
    M::up(include_str!(
        "../migrations/0016_complex_corporate_actions.sql"
    )),
    M::up(include_str!(
        "../migrations/0017_household_members_account_ownership.sql"
    )),
    M::up(include_str!(
        "../migrations/0018_transaction_source_audience.sql"
    )),
    M::up(include_str!(
        "../migrations/0019_delimited_parser_profiles.sql"
    )),
    M::up(include_str!(
        "../migrations/0020_mixed_currency_mergers.sql"
    )),
    M::up(include_str!(
        "../migrations/0021_aggregate_asset_history.sql"
    )),
    M::up(include_str!(
        "../migrations/0022_transaction_calculation_target.sql"
    )),
    M::up(include_str!(
        "../migrations/0023_card_settlement_bank_mappings.sql"
    )),
    M::up(include_str!(
        "../migrations/0024_money_forward_household_import.sql"
    )),
    M::up(include_str!(
        "../migrations/0025_receipt_evidence_linking.sql"
    )),
    M::up(include_str!("../migrations/0026_transaction_metadata.sql")),
    M::up(include_str!(
        "../migrations/0027_cumulative_card_payments.sql"
    )),
    M::up(include_str!("../migrations/0028_watched_file_inbox.sql")),
    M::up(include_str!("../migrations/0029_dashboard_preferences.sql")),
    M::up(include_str!("../migrations/0030_cash_flow_dashboard.sql")),
    M::up(include_str!("../migrations/0031_sync_foundation.sql")),
    M::up(include_str!("../migrations/0032_core_change_capture.sql")),
    M::up(include_str!(
        "../migrations/0033_replicable_ledger_capture.sql"
    )),
    M::up(include_str!(
        "../migrations/0034_replicable_planning_capture.sql"
    )),
    M::up(include_str!("../migrations/0035_local_change_packages.sql")),
    M::up(include_str!(
        "../migrations/0036_replicable_card_reconciliation.sql"
    )),
    M::up(include_str!(
        "../migrations/0037_portable_confirmed_evidence.sql"
    )),
    M::up(include_str!(
        "../migrations/0038_replicable_investment_graph.sql"
    )),
    M::up(include_str!(
        "../migrations/0039_dashboard_widget_layout.sql"
    )),
    M::up(include_str!(
        "../migrations/0040_dashboard_template_layouts.sql"
    )),
    M::up(include_str!(
        "../migrations/0041_pending_import_handoff.sql"
    )),
    M::up(include_str!(
        "../migrations/0042_replicable_dashboard_layouts.sql"
    )),
    M::up(include_str!(
        "../migrations/0043_authenticated_personal_relay.sql"
    )),
    M::up(include_str!(
        "../migrations/0044_family_audience_foundation.sql"
    )),
    M::up(include_str!(
        "../migrations/0045_family_delivery_transport.sql"
    )),
    M::up(include_str!("../migrations/0046_mobile_capture_inbox.sql")),
    M::up(include_str!(
        "../migrations/0047_family_planning_configuration.sql"
    )),
    M::up(include_str!(
        "../migrations/0048_origin_qualified_evidence.sql"
    )),
    M::up(include_str!(
        "../migrations/0049_encrypted_family_delivery_transport.sql"
    )),
    M::up(include_str!(
        "../migrations/0050_family_delivery_schedule.sql"
    )),
    M::up(include_str!(
        "../migrations/0051_watched_folder_sources.sql"
    )),
    M::up(include_str!(
        "../migrations/0052_mobile_capture_background.sql"
    )),
    M::up(include_str!(
        "../migrations/0053_google_drive_connections.sql"
    )),
    M::up(include_str!("../migrations/0054_google_drive_inbox.sql")),
    M::up(include_str!(
        "../migrations/0055_google_drive_root_resource_key.sql"
    )),
    M::up(include_str!(
        "../migrations/0056_source_document_cloud_sources.sql"
    )),
    M::up(include_str!("../migrations/0057_gmail_connector.sql")),
    M::up(include_str!(
        "../migrations/0058_gmail_label_selection_state.sql"
    )),
    M::up(include_str!(
        "../migrations/0059_gmail_removed_evidence.sql"
    )),
    M::up(include_str!(
        "../migrations/0060_family_delivery_background_intake.sql"
    )),
    M::up(include_str!(
        "../migrations/0061_classification_application_audit.sql"
    )),
    M::up(include_str!(
        "../migrations/0062_recurring_series_preferences.sql"
    )),
    M::up(include_str!(
        "../migrations/0063_replicable_recurring_preferences.sql"
    )),
    M::up(include_str!(
        "../migrations/0064_family_recurring_preferences.sql"
    )),
    M::up(include_str!(
        "../migrations/0065_card_payment_link_corrections.sql"
    )),
    M::up(include_str!("../migrations/0066_import_deduplication.sql")),
    M::up(include_str!("../migrations/0067_monthly_review_memos.sql")),
    M::up(include_str!(
        "../migrations/0068_mobile_capture_discards.sql"
    )),
    M::up(include_str!(
        "../migrations/0069_japanese_expense_categories.sql"
    )),
    M::up(include_str!("../migrations/0070_connector_bindings.sql")),
];

const MAX_RESTORED_SOURCE_DOCUMENT_ROWS: u64 = 100_000;
const MAX_RESTORED_UNIQUE_OBJECTS: usize = 100_000;

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("database directory could not be prepared")]
    Directory,
    #[error("database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("database migration failed")]
    Migration(#[from] rusqlite_migration::Error),
    #[error("database lock is unavailable")]
    Lock,
    #[error("SQLCipher support is unavailable")]
    CipherUnavailable,
}

pub struct AppState {
    connection: Mutex<Connection>,
}

impl AppState {
    /// Opens the database with key material that was already resolved by the
    /// caller. Startup uses this path so an existing installation never does a
    /// second, potentially generative credential lookup after its key has been
    /// loaded for the document vault.
    pub fn open_with_key(
        database_path: PathBuf,
        key_material: &[u8],
    ) -> Result<Self, PersistenceError> {
        let parent = database_path.parent().ok_or(PersistenceError::Directory)?;
        fs::create_dir_all(parent).map_err(|_| PersistenceError::Directory)?;
        restrict_directory_permissions(parent)?;

        let mut connection = Connection::open_with_flags(
            &database_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        apply_key(&connection, key_material)?;
        configure_connection(&connection)?;
        migrate(&mut connection)?;
        restrict_database_file_permissions(&database_path)?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    #[cfg(test)]
    pub(crate) fn in_memory(key: &[u8]) -> Result<Self, PersistenceError> {
        let connection = Connection::open_in_memory()?;
        apply_key(&connection, key)?;
        configure_connection(&connection)?;
        let mut connection = connection;
        migrate(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, PersistenceError>,
    ) -> Result<T, PersistenceError> {
        let connection = self.connection.lock().map_err(|_| PersistenceError::Lock)?;
        operation(&connection)
    }
}

/// Creates a keyed SQLCipher container without applying the application
/// migrations. This is reserved for small, self-describing encrypted capsule
/// manifests whose schema is owned by their feature module.
pub(crate) fn create_keyed_container_database(
    database_path: &std::path::Path,
    key_material: &[u8],
) -> Result<Connection, PersistenceError> {
    if database_path.exists() {
        return Err(PersistenceError::Directory);
    }
    let parent = database_path.parent().ok_or(PersistenceError::Directory)?;
    fs::create_dir_all(parent).map_err(|_| PersistenceError::Directory)?;
    restrict_directory_permissions(parent)?;
    let connection = Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    apply_key(&connection, key_material)?;
    configure_connection(&connection)?;
    restrict_database_file_permissions(database_path)?;
    Ok(connection)
}

/// Opens an existing keyed capsule database without creating it or running
/// product migrations.
pub(crate) fn open_keyed_container_database_read_only(
    database_path: &std::path::Path,
    key_material: &[u8],
) -> Result<Connection, PersistenceError> {
    let connection = Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    apply_key(&connection, key_material)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    if !integrity_check(&connection)? {
        return Err(PersistenceError::Database(rusqlite::Error::InvalidQuery));
    }
    Ok(connection)
}

fn apply_key(connection: &Connection, key_material: &[u8]) -> Result<(), PersistenceError> {
    // Hashing produces a fixed-size SQLCipher raw key and avoids embedding an
    // arbitrary passphrase in SQL syntax. This string is intentionally never logged.
    let digest = Sha256::digest(key_material);
    let mut raw_key = Zeroizing::new(String::with_capacity(67));
    raw_key.push_str("x'");
    for byte in digest {
        use std::fmt::Write as _;
        write!(raw_key, "{byte:02x}").expect("writing to a string cannot fail");
    }
    raw_key.push('\'');
    connection.pragma_update(None, "key", raw_key.as_str())?;

    let cipher_version: Option<String> = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .optional()?;
    if cipher_version.as_deref().is_none_or(str::is_empty) {
        return Err(PersistenceError::CipherUnavailable);
    }
    Ok(())
}

fn configure_connection(connection: &Connection) -> Result<(), PersistenceError> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "FULL")?;
    connection.pragma_update(None, "secure_delete", "ON")?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

fn migrate(connection: &mut Connection) -> Result<(), PersistenceError> {
    Migrations::new(MIGRATIONS.to_vec()).to_latest(connection)?;
    Ok(())
}

pub fn schema_version(connection: &Connection) -> Result<i64, PersistenceError> {
    Ok(connection.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

pub fn integrity_check(connection: &Connection) -> Result<bool, PersistenceError> {
    let result: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    Ok(result == "ok")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoredDatabaseInfo {
    pub schema_version: i64,
    pub household_count: u64,
    pub source_documents: Vec<RestoredSourceDocument>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoredSourceDocument {
    pub sha256: String,
    pub byte_size: u64,
    pub media_type: String,
    pub storage_path: String,
}

pub fn validate_existing_database(
    database_path: &std::path::Path,
    key_material: &[u8],
) -> Result<RestoredDatabaseInfo, PersistenceError> {
    let connection = Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    apply_key(&connection, key_material)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    if !integrity_check(&connection)? {
        return Err(PersistenceError::Database(rusqlite::Error::InvalidQuery));
    }
    let foreign_key_error: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
        [],
        |row| row.get(0),
    )?;
    if foreign_key_error {
        return Err(PersistenceError::Database(rusqlite::Error::InvalidQuery));
    }
    let schema_version = schema_version(&connection)?;
    if schema_version <= 0 || schema_version > MIGRATIONS.len() as i64 {
        return Err(invalid_restored_database());
    }
    validate_restored_semantics(&connection, schema_version)?;
    let household_count =
        connection.query_row("SELECT count(*) FROM households", [], |row| row.get(0))?;
    let source_documents = collect_source_documents(
        &connection,
        schema_version,
        MAX_RESTORED_SOURCE_DOCUMENT_ROWS,
        MAX_RESTORED_UNIQUE_OBJECTS,
    )?;
    Ok(RestoredDatabaseInfo {
        schema_version,
        household_count,
        source_documents,
    })
}

/// Remove grants that are meaningful only on the device where they were
/// selected. Portable restores must require a fresh native folder selection.
pub fn clear_restored_device_local_state(
    database_path: &std::path::Path,
    key_material: &[u8],
) -> Result<(), PersistenceError> {
    let mut connection = Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    apply_key(&connection, key_material)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    let version = schema_version(&connection)?;
    if version >= 8 {
        let transaction = connection.transaction()?;
        if version >= 70 {
            transaction.execute("DELETE FROM connector_bindings", [])?;
        }
        transaction.execute("DELETE FROM watched_folders", [])?;
        if version >= 31 {
            transaction.execute("DELETE FROM local_sync_contexts", [])?;
        }
        if version >= 53 {
            transaction.execute("DELETE FROM google_drive_connections", [])?;
        }
        if version >= 57 {
            transaction.execute("DELETE FROM gmail_connections", [])?;
        }
        transaction.commit()?;
        connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    }
    Ok(())
}

fn collect_source_documents(
    connection: &Connection,
    schema_version: i64,
    max_rows: u64,
    max_unique_objects: usize,
) -> Result<Vec<RestoredSourceDocument>, PersistenceError> {
    if schema_version < 2 {
        return Ok(Vec::new());
    }
    let row_count: i64 =
        connection.query_row("SELECT count(*) FROM source_documents", [], |row| {
            row.get(0)
        })?;
    let row_count = u64::try_from(row_count).map_err(|_| invalid_restored_database())?;
    if row_count > max_rows {
        return Err(invalid_restored_database());
    }

    let mut statement = connection.prepare(
        "SELECT sha256, byte_size, media_type, storage_path \
         FROM source_documents ORDER BY sha256, id",
    )?;
    let mut rows = statement.query([])?;
    let mut documents = BTreeMap::<String, RestoredSourceDocument>::new();
    while let Some(row) = rows.next()? {
        let sha256: String = row.get(0)?;
        let byte_size: i64 = row.get(1)?;
        let media_type: String = row.get(2)?;
        let storage_path: String = row.get(3)?;
        if !is_canonical_sha256(&sha256)
            || byte_size < 0
            || media_type.is_empty()
            || storage_path != format!("vault://{sha256}")
        {
            return Err(invalid_restored_database());
        }
        let document = RestoredSourceDocument {
            sha256: sha256.clone(),
            byte_size: u64::try_from(byte_size).map_err(|_| invalid_restored_database())?,
            media_type,
            storage_path,
        };
        if let Some(existing) = documents.get(&sha256) {
            if existing != &document {
                return Err(invalid_restored_database());
            }
        } else {
            if documents.len() >= max_unique_objects {
                return Err(invalid_restored_database());
            }
            documents.insert(sha256, document);
        }
    }
    Ok(documents.into_values().collect())
}

fn validate_restored_semantics(
    connection: &Connection,
    schema_version: i64,
) -> Result<(), PersistenceError> {
    if schema_version >= 31 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM household_principal_bindings b
             LEFT JOIN household_members m ON m.id=b.member_id AND m.household_id=b.household_id
             LEFT JOIN sync_principals p ON p.id=b.principal_id
             WHERE p.id IS NULL OR (b.member_id IS NOT NULL AND m.id IS NULL) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM local_sync_contexts c
             LEFT JOIN sync_devices d ON d.id=c.device_id
             LEFT JOIN household_principal_bindings b
               ON b.household_id=c.household_id AND b.principal_id=c.principal_id
             LEFT JOIN sync_principals p ON p.id=c.principal_id
             WHERE d.id IS NULL OR d.status!='ACTIVE' OR b.status!='ACTIVE'
                OR p.id IS NULL OR p.status!='ACTIVE' LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_change_envelopes e
             LEFT JOIN sync_devices d ON d.id=e.origin_device_id
             LEFT JOIN sync_principals p ON p.id=e.origin_principal_id
             LEFT JOIN household_principal_bindings b
               ON b.household_id=e.household_id AND b.principal_id=e.origin_principal_id
             WHERE d.id IS NULL OR p.id IS NULL OR b.principal_id IS NULL
                OR e.canonical_payload_json!=json(e.canonical_payload_json) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_outbox o
             LEFT JOIN sync_change_envelopes e ON e.envelope_id=o.envelope_id
             WHERE e.envelope_id IS NULL LIMIT 1",
        )?;
    }
    if schema_version >= 32 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             LEFT JOIN households h ON h.id=c.household_id
             LEFT JOIN sync_change_envelopes e ON e.envelope_id=c.processed_envelope_id
             WHERE h.id IS NULL OR (c.processed_envelope_id IS NOT NULL AND (
               e.envelope_id IS NULL OR e.household_id!=c.household_id
               OR e.entity_kind!=c.entity_kind OR e.entity_id!=c.entity_id
             )) LIMIT 1",
        )?;
    }
    if schema_version >= 43 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM relay_delivery_envelopes de
             JOIN relay_deliveries d ON d.delivery_id=de.delivery_id
             JOIN sync_change_envelopes e ON e.envelope_id=de.envelope_id
             JOIN local_sync_contexts c ON c.household_id=d.household_id
             JOIN sync_outbox o ON o.envelope_id=e.envelope_id
             WHERE d.household_id!=e.household_id
                OR e.origin_device_id!=c.device_id
                OR e.origin_sequence>d.snapshot_sequence
                OR (d.state='ACCEPTED' AND o.state!='ACKNOWLEDGED')
                OR (d.state!='ACCEPTED' AND o.state!='PENDING') LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM relay_deliveries d
             LEFT JOIN relay_connections c ON c.household_id=d.household_id
             WHERE c.household_id IS NULL LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM relay_inbound_artifacts i
             LEFT JOIN relay_connections c ON c.household_id=i.household_id
             WHERE c.household_id IS NULL LIMIT 1",
        )?;
    }
    if schema_version >= 33 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             LEFT JOIN sync_change_envelopes e ON e.envelope_id=c.processed_envelope_id
             WHERE c.processed_envelope_id IS NOT NULL AND (
               e.envelope_id IS NULL OR e.operation!=c.operation
               OR e.canonical_payload_json!=c.payload_json
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind='HOUSEHOLD' AND (
               COALESCE(json_type(c.payload_json,'$.recordKind'),'missing')!='text'
               OR json_extract(c.payload_json,'$.recordKind')!='HOUSEHOLD'
               OR COALESCE(json_type(c.payload_json,'$.id'),'missing')!='text'
               OR json_extract(c.payload_json,'$.id')!=c.household_id
               OR c.entity_id!=c.household_id OR c.operation!='UPSERT'
               OR COALESCE(json_type(c.payload_json,'$.name'),'missing')!='text'
               OR trim(json_extract(c.payload_json,'$.name'))=''
               OR COALESCE(json_type(c.payload_json,'$.baseCurrency'),'missing')!='text'
               OR json_extract(c.payload_json,'$.baseCurrency')!='JPY'
               OR COALESCE(json_type(c.payload_json,'$.createdAt'),'missing')!='text'
               OR COALESCE(json_type(c.payload_json,'$.updatedAt'),'missing')!='text'
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind='HOUSEHOLD_MEMBER' AND (
               COALESCE(json_type(c.payload_json,'$.recordKind'),'missing')!='text'
               OR json_extract(c.payload_json,'$.recordKind')!='HOUSEHOLD_MEMBER'
               OR COALESCE(json_type(c.payload_json,'$.householdId'),'missing')!='text'
               OR json_extract(c.payload_json,'$.householdId')!=c.household_id
               OR COALESCE(json_type(c.payload_json,'$.id'),'missing')!='text'
               OR json_extract(c.payload_json,'$.id')!=c.entity_id
               OR (c.operation='UPSERT' AND (
                 COALESCE(json_type(c.payload_json,'$.displayName'),'missing')!='text'
                 OR trim(json_extract(c.payload_json,'$.displayName'))=''
                 OR COALESCE(json_type(c.payload_json,'$.relationshipLabel'),'missing') NOT IN ('text','null')
                 OR COALESCE(json_type(c.payload_json,'$.sortOrder'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.sortOrder')<0
                 OR COALESCE(json_type(c.payload_json,'$.status'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.status') NOT IN ('ACTIVE','ARCHIVED')
                 OR COALESCE(json_type(c.payload_json,'$.createdAt'),'missing')!='text'
                 OR COALESCE(json_type(c.payload_json,'$.updatedAt'),'missing')!='text'
               ))
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind='ACCOUNT' AND (
               COALESCE(json_type(c.payload_json,'$.recordKind'),'missing')!='text'
               OR json_extract(c.payload_json,'$.recordKind')!='ACCOUNT'
               OR COALESCE(json_type(c.payload_json,'$.householdId'),'missing')!='text'
               OR json_extract(c.payload_json,'$.householdId')!=c.household_id
               OR COALESCE(json_type(c.payload_json,'$.id'),'missing')!='text'
               OR json_extract(c.payload_json,'$.id')!=c.entity_id
               OR (c.operation='UPSERT' AND (
                 COALESCE(json_type(c.payload_json,'$.name'),'missing')!='text'
                 OR trim(json_extract(c.payload_json,'$.name'))=''
                 OR COALESCE(json_type(c.payload_json,'$.accountKind'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.accountKind') NOT IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')
                 OR COALESCE(json_type(c.payload_json,'$.accountSubtype'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.accountSubtype') NOT IN ('BANK','CASH','WALLET','SECURITIES','CREDIT_CARD','RECEIVABLE','OTHER')
                 OR COALESCE(json_type(c.payload_json,'$.currency'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.currency')!='JPY'
                 OR COALESCE(json_type(c.payload_json,'$.institutionName'),'missing') NOT IN ('text','null')
                 OR COALESCE(json_type(c.payload_json,'$.maskedIdentifier'),'missing') NOT IN ('text','null')
                 OR COALESCE(json_type(c.payload_json,'$.isArchived'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.isArchived') NOT IN (0,1)
                 OR COALESCE(json_type(c.payload_json,'$.ownershipKind'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.ownershipKind') NOT IN ('HOUSEHOLD','MEMBER')
                 OR COALESCE(json_type(c.payload_json,'$.ownerMemberId'),'missing') NOT IN ('text','null')
                 OR COALESCE(json_type(c.payload_json,'$.visibility'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.visibility') NOT IN ('SHARED','PERSONAL')
                 OR COALESCE(json_type(c.payload_json,'$.createdAt'),'missing')!='text'
                 OR COALESCE(json_type(c.payload_json,'$.updatedAt'),'missing')!='text'
               ))
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind='TRANSACTION'
               AND (c.processed_envelope_id IS NOT NULL OR c.capture_sequence=(
                 SELECT max(latest.capture_sequence)
                 FROM sync_local_change_capture latest
                 WHERE latest.household_id=c.household_id
                   AND latest.entity_kind=c.entity_kind
                   AND latest.entity_id=c.entity_id
                   AND latest.processed_envelope_id IS NULL
               )) AND (
               COALESCE(json_type(c.payload_json,'$.recordKind'),'missing')!='text'
               OR json_extract(c.payload_json,'$.recordKind')!='TRANSACTION_AGGREGATE'
               OR COALESCE(json_type(c.payload_json,'$.householdId'),'missing')!='text'
               OR json_extract(c.payload_json,'$.householdId')!=c.household_id
               OR COALESCE(json_type(c.payload_json,'$.id'),'missing')!='text'
               OR json_extract(c.payload_json,'$.id')!=c.entity_id
               OR (c.operation='UPSERT' AND (
                 COALESCE(json_type(c.payload_json,'$.occurredOn'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.occurredOn') NOT GLOB '????-??-??'
                 OR COALESCE(json_type(c.payload_json,'$.postedOn'),'missing') NOT IN ('text','null')
                 OR (json_type(c.payload_json,'$.postedOn')='text'
                     AND json_extract(c.payload_json,'$.postedOn') NOT GLOB '????-??-??')
                 OR COALESCE(json_type(c.payload_json,'$.payee'),'missing') NOT IN ('text','null')
                 OR COALESCE(json_type(c.payload_json,'$.description'),'missing') NOT IN ('text','null')
                 OR COALESCE(json_type(c.payload_json,'$.transactionType'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.transactionType') NOT IN (
                   'EXPENSE','INCOME','TRANSFER','CARD_PURCHASE','CARD_PAYMENT',
                   'REFUND','FEE','INTEREST','ADJUSTMENT')
                 OR COALESCE(json_type(c.payload_json,'$.status'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.status') NOT IN ('DRAFT','POSTED','VOID')
                 OR COALESCE(json_type(c.payload_json,'$.calculationTarget'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.calculationTarget') NOT IN (0,1)
                 OR COALESCE(json_type(c.payload_json,'$.attributionKind'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.attributionKind') NOT IN ('HOUSEHOLD','MEMBER')
                 OR COALESCE(json_type(c.payload_json,'$.attributedMemberId'),'missing') NOT IN ('text','null')
                 OR (json_extract(c.payload_json,'$.attributionKind')='HOUSEHOLD'
                     AND json_type(c.payload_json,'$.attributedMemberId')!='null')
                 OR (json_extract(c.payload_json,'$.attributionKind')='MEMBER'
                     AND json_type(c.payload_json,'$.attributedMemberId')!='text')
                 OR COALESCE(json_type(c.payload_json,'$.audienceVisibility'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.audienceVisibility') NOT IN ('SHARED','PERSONAL')
                 OR COALESCE(json_type(c.payload_json,'$.audienceMemberId'),'missing') NOT IN ('text','null')
                 OR (json_extract(c.payload_json,'$.audienceVisibility')='SHARED'
                     AND json_type(c.payload_json,'$.audienceMemberId')!='null')
                 OR (json_extract(c.payload_json,'$.audienceVisibility')='PERSONAL'
                     AND json_type(c.payload_json,'$.audienceMemberId')!='text')
                 OR COALESCE(json_type(c.payload_json,'$.createdAt'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.createdAt') NOT GLOB '????-??-??T??:??:??*Z'
                 OR COALESCE(json_type(c.payload_json,'$.updatedAt'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.updatedAt') NOT GLOB '????-??-??T??:??:??*Z'
                 OR COALESCE(json_type(c.payload_json,'$.journalEntries'),'missing')!='array'
                 OR COALESCE(json_type(c.payload_json,'$.labels'),'missing')!='array'
                 OR COALESCE(json_type(c.payload_json,'$.tags'),'missing')!='array'
                 OR COALESCE(json_type(c.payload_json,'$.sourceLinks'),'missing')!='array'
                 OR COALESCE(json_type(c.payload_json,'$.externalKeys'),'missing')!='array'
                 OR EXISTS(
                   SELECT 1 FROM json_each(c.payload_json,'$.journalEntries') j
                   LEFT JOIN accounts a ON a.id=json_extract(j.value,'$.accountId')
                   WHERE COALESCE(json_type(j.value,'$.id'),'missing')!='text'
                     OR json_extract(j.value,'$.id')=''
                     OR COALESCE(json_type(j.value,'$.transactionId'),'missing')!='text'
                     OR json_extract(j.value,'$.transactionId')!=c.entity_id
                     OR COALESCE(json_type(j.value,'$.accountId'),'missing')!='text'
                     OR COALESCE(json_type(j.value,'$.entrySide'),'missing')!='text'
                     OR json_extract(j.value,'$.entrySide') NOT IN ('DEBIT','CREDIT')
                     OR COALESCE(json_type(j.value,'$.amountJpy'),'missing')!='integer'
                     OR json_extract(j.value,'$.amountJpy')<=0
                     OR COALESCE(json_type(j.value,'$.lineNumber'),'missing')!='integer'
                     OR json_extract(j.value,'$.lineNumber')<=0
                     OR COALESCE(json_type(j.value,'$.createdAt'),'missing')!='text'
                     OR json_extract(j.value,'$.createdAt') NOT GLOB '????-??-??T??:??:??*Z'
                     OR ((a.id IS NULL OR a.household_id!=c.household_id)
                       AND c.capture_sequence=(
                         SELECT max(current.capture_sequence)
                         FROM sync_local_change_capture current
                         WHERE current.household_id=c.household_id
                           AND current.entity_kind=c.entity_kind
                           AND current.entity_id=c.entity_id
                       ))
                 )
                 OR json_array_length(c.payload_json,'$.journalEntries')!=(
                   SELECT count(DISTINCT json_extract(j.value,'$.lineNumber'))
                   FROM json_each(c.payload_json,'$.journalEntries') j
                 )
                 OR EXISTS(SELECT 1 FROM json_each(c.payload_json,'$.labels') l
                           WHERE l.type!='text' OR trim(l.value)='')
                 OR EXISTS(SELECT 1 FROM json_each(c.payload_json,'$.tags') tag
                           WHERE tag.type!='text' OR trim(tag.value)='')
                 OR EXISTS(
                   SELECT 1 FROM json_each(c.payload_json,'$.sourceLinks') s
                   WHERE COALESCE(json_type(s.value,'$.transactionId'),'missing')!='text'
                     OR json_extract(s.value,'$.transactionId')!=c.entity_id
                     OR COALESCE(json_type(s.value,'$.sourceRecordId'),'missing')!='text'
                     OR json_extract(s.value,'$.sourceRecordId')=''
                     OR COALESCE(json_type(s.value,'$.candidateId'),'missing') NOT IN ('text','null')
                 )
                 OR EXISTS(
                   SELECT 1 FROM json_each(c.payload_json,'$.externalKeys') k
                   WHERE COALESCE(json_type(k.value,'$.householdId'),'missing')!='text'
                     OR json_extract(k.value,'$.householdId')!=c.household_id
                     OR COALESCE(json_type(k.value,'$.transactionId'),'missing')!='text'
                     OR json_extract(k.value,'$.transactionId')!=c.entity_id
                     OR COALESCE(json_type(k.value,'$.externalSource'),'missing')!='text'
                     OR COALESCE(json_type(k.value,'$.externalId'),'missing')!='text'
                     OR json_extract(k.value,'$.externalId')=''
                     OR COALESCE(json_type(k.value,'$.factHash'),'missing')!='text'
                     OR length(json_extract(k.value,'$.factHash'))!=64
                     OR json_extract(k.value,'$.factHash') GLOB '*[^0-9a-f]*'
                     OR COALESCE(json_type(k.value,'$.createdAt'),'missing')!='text'
                     OR json_extract(k.value,'$.createdAt') NOT GLOB '????-??-??T??:??:??*Z'
                 )
                 OR (json_extract(c.payload_json,'$.status')='POSTED' AND (
                   json_array_length(c.payload_json,'$.journalEntries')<2
                   OR COALESCE((SELECT SUM(
                     CASE json_extract(j.value,'$.entrySide')
                       WHEN 'DEBIT' THEN json_extract(j.value,'$.amountJpy')
                       WHEN 'CREDIT' THEN -json_extract(j.value,'$.amountJpy')
                       ELSE 1 END)
                     FROM json_each(c.payload_json,'$.journalEntries') j),1)!=0
                 ))
               ))
             ) LIMIT 1",
        )?;
        if schema_version >= 34 {
            reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.operation='UPSERT'
               AND c.entity_kind IN ('MONTHLY_BUDGET_PLAN','CLASSIFICATION_RULE',
                                     'ACCOUNT_GROUP','CARD_SETTLEMENT_MAPPING')
               AND c.capture_sequence=(
                 SELECT max(latest.capture_sequence) FROM sync_local_change_capture latest
                 WHERE latest.household_id=c.household_id
                   AND latest.entity_kind=c.entity_kind AND latest.entity_id=c.entity_id
               ) AND (
                 (c.entity_kind='MONTHLY_BUDGET_PLAN' AND EXISTS(
                   SELECT 1 FROM json_each(c.payload_json,'$.budgets') b
                   LEFT JOIN accounts a ON a.id=json_extract(b.value,'$.categoryAccountId')
                   WHERE a.id IS NULL OR a.household_id!=c.household_id OR a.account_kind!='EXPENSE'))
                 OR (c.entity_kind='CLASSIFICATION_RULE' AND NOT EXISTS(
                   SELECT 1 FROM accounts a
                   WHERE a.id=json_extract(c.payload_json,'$.categoryAccountId')
                     AND a.household_id=c.household_id AND a.account_kind='EXPENSE'))
                 OR (c.entity_kind='ACCOUNT_GROUP' AND EXISTS(
                   SELECT 1 FROM json_each(c.payload_json,'$.members') m
                   LEFT JOIN accounts a ON a.id=json_extract(m.value,'$.accountId')
                   WHERE a.id IS NULL OR a.household_id!=c.household_id))
                 OR (c.entity_kind='CARD_SETTLEMENT_MAPPING' AND NOT EXISTS(
                   SELECT 1 FROM accounts card JOIN accounts bank
                   WHERE card.id=json_extract(c.payload_json,'$.cardAccountId')
                     AND bank.id=json_extract(c.payload_json,'$.bankAccountId')
                     AND card.household_id=c.household_id AND bank.household_id=c.household_id
                     AND card.account_kind='LIABILITY' AND card.account_subtype='CREDIT_CARD'
                     AND bank.account_kind='ASSET' AND bank.account_subtype='BANK'
                     AND card.is_archived=0 AND bank.is_archived=0))
               ) LIMIT 1",
            )?;
            reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.operation='UPSERT' AND (
               (c.entity_kind='MONTHLY_BUDGET_PLAN' AND EXISTS(
                 SELECT 1 FROM json_each(c.payload_json,'$.budgets') a
                 JOIN json_each(c.payload_json,'$.budgets') b ON b.key=a.key+1
                 WHERE json_extract(a.value,'$.month')>json_extract(b.value,'$.month')
                    OR (json_extract(a.value,'$.month')=json_extract(b.value,'$.month')
                        AND json_extract(a.value,'$.categoryAccountId')>
                            json_extract(b.value,'$.categoryAccountId'))))
               OR (c.entity_kind='CLASSIFICATION_RULE' AND (
                 EXISTS(SELECT 1 FROM json_each(c.payload_json,'$.labels') a
                        JOIN json_each(c.payload_json,'$.labels') b ON b.key=a.key+1
                        WHERE a.value>b.value)
                 OR EXISTS(SELECT 1 FROM json_each(c.payload_json,'$.tags') a
                           JOIN json_each(c.payload_json,'$.tags') b ON b.key=a.key+1
                           WHERE a.value>b.value)))
               OR (c.entity_kind='ACCOUNT_GROUP' AND EXISTS(
                 SELECT 1 FROM json_each(c.payload_json,'$.members') a
                 JOIN json_each(c.payload_json,'$.members') b ON b.key=a.key+1
                 WHERE json_extract(a.value,'$.sortOrder')>json_extract(b.value,'$.sortOrder')
                    OR (json_extract(a.value,'$.sortOrder')=json_extract(b.value,'$.sortOrder')
                        AND json_extract(a.value,'$.accountId')>json_extract(b.value,'$.accountId'))))
             ) LIMIT 1",
            )?;
        }
    }
    if schema_version >= 34 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind IN (
               'MONTHLY_BUDGET_PLAN','SAVINGS_GOAL','CLASSIFICATION_RULE','ACCOUNT_GROUP',
               'CARD_SETTLEMENT_MAPPING','DASHBOARD_PREFERENCES','DELIMITED_PARSER_PROFILE'
             ) AND (
               COALESCE(json_type(c.payload_json,'$.recordKind'),'missing')!='text'
               OR json_extract(c.payload_json,'$.recordKind')!=c.entity_kind
               OR COALESCE(json_type(c.payload_json,'$.householdId'),'missing')!='text'
               OR json_extract(c.payload_json,'$.householdId')!=c.household_id
               OR c.operation NOT IN ('UPSERT','DELETE')
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind='MONTHLY_BUDGET_PLAN' AND (
               c.entity_id!=c.household_id OR c.operation!='UPSERT'
               OR COALESCE(json_type(c.payload_json,'$.budgets'),'missing')!='array'
               OR EXISTS(
                 SELECT 1 FROM json_each(c.payload_json,'$.budgets') b
                 WHERE COALESCE(json_type(b.value,'$.householdId'),'missing')!='text'
                   OR json_extract(b.value,'$.householdId')!=c.household_id
                   OR COALESCE(json_type(b.value,'$.month'),'missing')!='text'
                   OR json_extract(b.value,'$.month') NOT GLOB '????-??'
                   OR substr(json_extract(b.value,'$.month'),6,2) NOT BETWEEN '01' AND '12'
                   OR COALESCE(json_type(b.value,'$.categoryAccountId'),'missing')!='text'
                   OR trim(json_extract(b.value,'$.categoryAccountId'))=''
                   OR COALESCE(json_type(b.value,'$.budgetJpy'),'missing')!='integer'
                   OR json_extract(b.value,'$.budgetJpy')<0
                   OR COALESCE(json_type(b.value,'$.createdAt'),'missing')!='text'
                   OR COALESCE(json_type(b.value,'$.updatedAt'),'missing')!='text'
               )
               OR json_array_length(c.payload_json,'$.budgets')!=(
                 SELECT count(DISTINCT json_extract(b.value,'$.month')||char(0)||
                                       json_extract(b.value,'$.categoryAccountId'))
                 FROM json_each(c.payload_json,'$.budgets') b
               )
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind='SAVINGS_GOAL' AND (
               COALESCE(json_type(c.payload_json,'$.id'),'missing')!='text'
               OR json_extract(c.payload_json,'$.id')!=c.entity_id
               OR (c.operation='UPSERT' AND (
                 COALESCE(json_type(c.payload_json,'$.name'),'missing')!='text'
                 OR trim(json_extract(c.payload_json,'$.name'))=''
                 OR COALESCE(json_type(c.payload_json,'$.targetJpy'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.targetJpy')<=0
                 OR COALESCE(json_type(c.payload_json,'$.savedJpy'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.savedJpy')<0
                 OR COALESCE(json_type(c.payload_json,'$.targetDate'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.targetDate') NOT GLOB '????-??-??'
                 OR COALESCE(json_type(c.payload_json,'$.status'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.status') NOT IN ('ACTIVE','PAUSED','COMPLETED','CANCELLED')
                 OR COALESCE(json_type(c.payload_json,'$.createdAt'),'missing')!='text'
                 OR COALESCE(json_type(c.payload_json,'$.updatedAt'),'missing')!='text'
               ))
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind='CLASSIFICATION_RULE' AND (
               COALESCE(json_type(c.payload_json,'$.id'),'missing')!='text'
               OR json_extract(c.payload_json,'$.id')!=c.entity_id
               OR (c.operation='UPSERT' AND (
                 COALESCE(json_type(c.payload_json,'$.name'),'missing')!='text'
                 OR trim(json_extract(c.payload_json,'$.name'))=''
                 OR COALESCE(json_type(c.payload_json,'$.priority'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.priority') NOT BETWEEN 0 AND 1000000
                 OR COALESCE(json_type(c.payload_json,'$.isEnabled'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.isEnabled') NOT IN (0,1)
                 OR COALESCE(json_type(c.payload_json,'$.merchantContains'),'missing') NOT IN ('text','null')
                 OR COALESCE(json_type(c.payload_json,'$.descriptionContains'),'missing') NOT IN ('text','null')
                 OR (COALESCE(trim(json_extract(c.payload_json,'$.merchantContains')),'')=''
                     AND COALESCE(trim(json_extract(c.payload_json,'$.descriptionContains')),'')='')
                 OR COALESCE(json_type(c.payload_json,'$.categoryAccountId'),'missing')!='text'
                 OR COALESCE(json_type(c.payload_json,'$.labels'),'missing')!='array'
                 OR COALESCE(json_type(c.payload_json,'$.tags'),'missing')!='array'
                 OR EXISTS(SELECT 1 FROM json_each(c.payload_json,'$.labels') v
                           WHERE v.type!='text' OR trim(v.value)='')
                 OR EXISTS(SELECT 1 FROM json_each(c.payload_json,'$.tags') v
                           WHERE v.type!='text' OR trim(v.value)='')
                 OR json_array_length(c.payload_json,'$.labels')!=(
                      SELECT count(DISTINCT v.value) FROM json_each(c.payload_json,'$.labels') v)
                 OR json_array_length(c.payload_json,'$.tags')!=(
                      SELECT count(DISTINCT v.value) FROM json_each(c.payload_json,'$.tags') v)
                 OR COALESCE(json_type(c.payload_json,'$.createdAt'),'missing')!='text'
                 OR COALESCE(json_type(c.payload_json,'$.updatedAt'),'missing')!='text'
               ))
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind='ACCOUNT_GROUP' AND (
               COALESCE(json_type(c.payload_json,'$.id'),'missing')!='text'
               OR json_extract(c.payload_json,'$.id')!=c.entity_id
               OR (c.operation='UPSERT' AND (
                 COALESCE(json_type(c.payload_json,'$.name'),'missing')!='text'
                 OR trim(json_extract(c.payload_json,'$.name'))=''
                 OR COALESCE(json_type(c.payload_json,'$.groupKind'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.groupKind') NOT IN (
                   'FAMILY','PERSONAL','DAILY_SPENDING','INVESTMENT','BUSINESS','TAX','EDUCATION','CUSTOM')
                 OR COALESCE(json_type(c.payload_json,'$.sortOrder'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.sortOrder')<0
                 OR COALESCE(json_type(c.payload_json,'$.members'),'missing')!='array'
                 OR EXISTS(
                   SELECT 1 FROM json_each(c.payload_json,'$.members') m
                   WHERE COALESCE(json_type(m.value,'$.householdId'),'missing')!='text'
                     OR json_extract(m.value,'$.householdId')!=c.household_id
                     OR COALESCE(json_type(m.value,'$.accountGroupId'),'missing')!='text'
                     OR json_extract(m.value,'$.accountGroupId')!=c.entity_id
                     OR COALESCE(json_type(m.value,'$.accountId'),'missing')!='text'
                     OR COALESCE(json_type(m.value,'$.sortOrder'),'missing')!='integer'
                     OR json_extract(m.value,'$.sortOrder')<0
                 )
                 OR json_array_length(c.payload_json,'$.members')!=(
                   SELECT count(DISTINCT json_extract(m.value,'$.accountId'))
                   FROM json_each(c.payload_json,'$.members') m)
                 OR json_array_length(c.payload_json,'$.members')!=(
                   SELECT count(DISTINCT json_extract(m.value,'$.sortOrder'))
                   FROM json_each(c.payload_json,'$.members') m)
                 OR COALESCE(json_type(c.payload_json,'$.createdAt'),'missing')!='text'
                 OR COALESCE(json_type(c.payload_json,'$.updatedAt'),'missing')!='text'
               ))
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind='CARD_SETTLEMENT_MAPPING' AND (
               COALESCE(json_type(c.payload_json,'$.cardAccountId'),'missing')!='text'
               OR json_extract(c.payload_json,'$.cardAccountId')!=c.entity_id
               OR (c.operation='UPSERT' AND (
                 COALESCE(json_type(c.payload_json,'$.bankAccountId'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.bankAccountId')=c.entity_id
                 OR COALESCE(json_type(c.payload_json,'$.createdAt'),'missing')!='text'
                 OR COALESCE(json_type(c.payload_json,'$.updatedAt'),'missing')!='text'
               ))
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind='DASHBOARD_PREFERENCES' AND (
               c.entity_id!=c.household_id
               OR (c.operation='UPSERT' AND (
                 COALESCE(json_type(c.payload_json,'$.dashboardTemplate'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.dashboardTemplate') NOT IN (
                   'FINANCIAL_OVERVIEW','HOUSEHOLD_LEDGER','ASSETS_LIABILITIES',
                   'CARD_RECONCILIATION','CASH_FLOW')
                 OR COALESCE(json_type(c.payload_json,'$.theme'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.theme') NOT IN ('SYSTEM','LIGHT','DARK')
                 OR COALESCE(json_type(c.payload_json,'$.density'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.density') NOT IN ('COMFORTABLE','COMPACT')
                 OR COALESCE(json_type(c.payload_json,'$.createdAt'),'missing')!='text'
                 OR COALESCE(json_type(c.payload_json,'$.updatedAt'),'missing')!='text'
               ))
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM sync_local_change_capture c
             WHERE c.entity_kind='DELIMITED_PARSER_PROFILE' AND (
               COALESCE(json_type(c.payload_json,'$.id'),'missing')!='text'
               OR json_extract(c.payload_json,'$.id')!=c.entity_id
               OR (c.operation='UPSERT' AND (
                 COALESCE(json_type(c.payload_json,'$.name'),'missing')!='text'
                 OR trim(json_extract(c.payload_json,'$.name'))=''
                 OR COALESCE(json_type(c.payload_json,'$.delimiter'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.delimiter') NOT IN ('AUTO','COMMA','TAB','SEMICOLON')
                 OR COALESCE(json_type(c.payload_json,'$.encoding'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.encoding') NOT IN ('AUTO','UTF8','CP932')
                 OR COALESCE(json_type(c.payload_json,'$.headerRow'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.headerRow') NOT BETWEEN 1 AND 1000
                 OR COALESCE(json_type(c.payload_json,'$.dateColumn'),'missing')!='text'
                 OR trim(json_extract(c.payload_json,'$.dateColumn'))=''
                 OR COALESCE(json_type(c.payload_json,'$.dateFormat'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.dateFormat') NOT IN (
                   'AUTO','YYYY_MM_DD','YYYYMMDD','MM_DD_YYYY','DD_MM_YYYY')
                 OR COALESCE(json_type(c.payload_json,'$.amountMode'),'missing')!='text'
                 OR json_extract(c.payload_json,'$.amountMode') NOT IN ('SIGNED','DEBIT_CREDIT')
                 OR COALESCE(json_type(c.payload_json,'$.descriptionColumn'),'missing') NOT IN ('text','null')
                 OR COALESCE(json_type(c.payload_json,'$.payeeColumn'),'missing') NOT IN ('text','null')
                 OR (COALESCE(trim(json_extract(c.payload_json,'$.descriptionColumn')),'')=''
                     AND COALESCE(trim(json_extract(c.payload_json,'$.payeeColumn')),'')='')
                 OR COALESCE(json_type(c.payload_json,'$.externalIdColumn'),'missing') NOT IN ('text','null')
                 OR COALESCE(json_type(c.payload_json,'$.accountHintColumn'),'missing') NOT IN ('text','null')
                 OR COALESCE(json_type(c.payload_json,'$.isEnabled'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.isEnabled') NOT IN (0,1)
                 OR COALESCE(json_type(c.payload_json,'$.priority'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.priority') NOT BETWEEN 0 AND 10000
                 OR COALESCE(json_type(c.payload_json,'$.version'),'missing')!='integer'
                 OR json_extract(c.payload_json,'$.version')<=0
                 OR (json_extract(c.payload_json,'$.amountMode')='SIGNED' AND (
                   COALESCE(json_type(c.payload_json,'$.signedPositiveDirection'),'missing')!='text'
                   OR json_extract(c.payload_json,'$.signedPositiveDirection') NOT IN ('IN','OUT')
                   OR COALESCE(json_type(c.payload_json,'$.signedAmountColumn'),'missing')!='text'
                   OR trim(json_extract(c.payload_json,'$.signedAmountColumn'))=''
                   OR json_type(c.payload_json,'$.debitColumn')!='null'
                   OR json_type(c.payload_json,'$.creditColumn')!='null'))
                 OR (json_extract(c.payload_json,'$.amountMode')='DEBIT_CREDIT' AND (
                   json_type(c.payload_json,'$.signedPositiveDirection')!='null'
                   OR json_type(c.payload_json,'$.signedAmountColumn')!='null'
                   OR COALESCE(json_type(c.payload_json,'$.debitColumn'),'missing')!='text'
                   OR trim(json_extract(c.payload_json,'$.debitColumn'))=''
                   OR COALESCE(json_type(c.payload_json,'$.creditColumn'),'missing')!='text'
                   OR trim(json_extract(c.payload_json,'$.creditColumn'))=''))
                 OR COALESCE(json_type(c.payload_json,'$.createdAt'),'missing')!='text'
                 OR COALESCE(json_type(c.payload_json,'$.updatedAt'),'missing')!='text'
               ))
             ) LIMIT 1",
        )?;
    }
    if schema_version >= 22 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM transactions WHERE calculation_target NOT IN (0,1) LIMIT 1",
        )?;
    }
    if schema_version >= 23 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM card_settlement_bank_mappings m
             LEFT JOIN accounts card ON card.id=m.card_account_id
             LEFT JOIN accounts bank ON bank.id=m.bank_account_id
             WHERE card.id IS NULL OR bank.id IS NULL
                OR card.household_id != m.household_id
                OR bank.household_id != m.household_id
                OR card.is_archived != 0 OR card.account_kind != 'LIABILITY'
                OR card.account_subtype != 'CREDIT_CARD'
                OR bank.is_archived != 0 OR bank.account_kind != 'ASSET'
                OR bank.account_subtype != 'BANK' LIMIT 1",
        )?;
    }
    if schema_version >= 24 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM transaction_external_keys k
             LEFT JOIN transactions t ON t.id=k.transaction_id
             WHERE t.id IS NULL OR t.household_id!=k.household_id LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM transaction_candidates
             WHERE (external_source IS NULL AND external_fact_hash IS NOT NULL)
                OR (external_source IS NOT NULL AND (external_transaction_id IS NULL OR external_fact_hash IS NULL))
                OR (suggested_transaction_type='TRANSFER' AND calculation_target!=0) LIMIT 1",
        )?;
    }
    if schema_version >= 25 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM receipt_candidate_links rcl
             LEFT JOIN transaction_candidates c ON c.id=rcl.candidate_id
             LEFT JOIN transactions t ON t.id=rcl.transaction_id
             WHERE c.id IS NULL OR t.id IS NULL
                OR c.household_id!=rcl.household_id
                OR t.household_id!=rcl.household_id
                OR t.status!='POSTED'
                OR t.transaction_type NOT IN ('EXPENSE','CARD_PURCHASE')
                OR c.receipt_resolution_status!='LINKED'
                OR c.receipt_resolved_at IS NULL
                OR c.review_status!='EXCLUDED'
                OR abs(julianday(t.occurred_on)-julianday(c.occurred_on))>3
                OR (
                    SELECT COALESCE(SUM(CASE WHEN a.account_kind='EXPENSE' AND je.entry_side='DEBIT'
                                        THEN je.amount_jpy ELSE 0 END),0)
                    FROM journal_entries je JOIN accounts a ON a.id=je.account_id
                    WHERE je.transaction_id=t.id
                )!=c.amount_jpy
                OR NOT EXISTS (
                    SELECT 1 FROM candidate_sources cs
                    JOIN source_records sr ON sr.id=cs.source_record_id
                    JOIN source_documents sd ON sd.id=sr.source_document_id
                    JOIN import_runs ir ON ir.id=sd.import_run_id
                    WHERE cs.candidate_id=c.id AND ir.adapter_id='receipt-text-v2'
                ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM transaction_candidates c
             WHERE c.receipt_resolution_status='LINKED'
               AND NOT EXISTS (
                 SELECT 1 FROM receipt_candidate_links rcl WHERE rcl.candidate_id=c.id
               ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM receipt_candidate_links rcl
             WHERE NOT EXISTS (
               SELECT 1 FROM transaction_sources ts
               WHERE ts.transaction_id=rcl.transaction_id
                 AND ts.candidate_id=rcl.candidate_id
             ) OR EXISTS (
               SELECT 1 FROM candidate_sources cs
               WHERE cs.candidate_id=rcl.candidate_id
                 AND NOT EXISTS (
                   SELECT 1 FROM transaction_sources ts
                   WHERE ts.transaction_id=rcl.transaction_id
                     AND ts.candidate_id=rcl.candidate_id
                     AND ts.source_record_id=cs.source_record_id
                 )
             ) LIMIT 1",
        )?;
    }
    if schema_version >= 27 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM card_payments cp
             LEFT JOIN card_statements cs ON cs.id=cp.statement_id
             LEFT JOIN transactions t ON t.id=cp.bank_transaction_id
             WHERE cp.confirmed_at IS NOT NULL AND (
                cs.id IS NULL
                OR cp.confirmed_at NOT GLOB '????-??-??T??:??:??*Z'
                OR cs.household_id!=cp.household_id
                OR cs.card_account_id!=cp.card_account_id
                OR t.id IS NULL OR t.household_id!=cp.household_id
                OR t.status!='POSTED' OR t.transaction_type!='CARD_PAYMENT'
                OR cp.reconciliation_status!='FULLY_RECONCILED'
                OR cp.payment_on<cs.period_end
                OR cp.payment_on>date(cs.period_end,'+120 days')
                OR cp.payment_amount_jpy!=(
                    SELECT COALESCE(SUM(je.amount_jpy),0)
                    FROM journal_entries je
                    WHERE je.transaction_id=t.id
                      AND je.account_id=cs.card_account_id
                      AND je.entry_side='DEBIT'
                )
                OR 1!=(
                    SELECT COUNT(DISTINCT je.account_id)
                    FROM journal_entries je JOIN accounts a ON a.id=je.account_id
                    WHERE je.transaction_id=t.id AND je.entry_side='DEBIT'
                      AND a.account_kind='LIABILITY' AND a.account_subtype='CREDIT_CARD'
                )
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM card_statements cs
             WHERE cs.reconciliation_status != CASE
               WHEN (SELECT COALESCE(SUM(cp.payment_amount_jpy),0)
                     FROM card_payments cp
                     WHERE cp.statement_id=cs.id AND cp.confirmed_at IS NOT NULL)=0
                 THEN 'UNMATCHED'
               WHEN (SELECT COALESCE(SUM(cp.payment_amount_jpy),0)
                     FROM card_payments cp
                     WHERE cp.statement_id=cs.id AND cp.confirmed_at IS NOT NULL)<cs.statement_amount_jpy
                 THEN 'PARTIALLY_RECONCILED'
               WHEN (SELECT COALESCE(SUM(cp.payment_amount_jpy),0)
                     FROM card_payments cp
                     WHERE cp.statement_id=cs.id AND cp.confirmed_at IS NOT NULL)=cs.statement_amount_jpy
                 THEN 'FULLY_RECONCILED'
               ELSE 'OVERPAID' END LIMIT 1",
        )?;
    }
    if schema_version >= 28 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM watched_file_inbox i
             LEFT JOIN watched_folders wf ON wf.id=i.watched_folder_id
             LEFT JOIN import_runs ir ON ir.id=i.import_run_id
             WHERE wf.id IS NULL OR wf.household_id!=i.household_id
                OR wf.is_enabled!=1
                OR (i.state='STAGED' AND (
                    ir.id IS NULL OR ir.household_id!=i.household_id))
                OR (i.state!='STAGED' AND i.import_run_id IS NOT NULL)
                OR (i.state='PROCESSING') != (
                    i.lease_token IS NOT NULL AND i.lease_expires_at IS NOT NULL
                    AND i.processing_origin_state IS NOT NULL)
                OR (i.state='FAILED') != (i.last_error_code IS NOT NULL)
                OR length(i.id)!=64 OR i.id GLOB '*[^0-9a-f]*'
                OR length(i.fingerprint)!=64 OR i.fingerprint GLOB '*[^0-9a-f]*'
                OR i.relative_path IN ('.','..')
                OR i.relative_path LIKE '/%' OR i.relative_path LIKE '%/'
                OR instr(i.relative_path,'\\')>0
                OR i.relative_path LIKE './%' OR i.relative_path LIKE '../%'
                OR i.relative_path LIKE '%/./%' OR i.relative_path LIKE '%/../%'
                OR i.relative_path LIKE '%/.' OR i.relative_path LIKE '%/..'
                OR i.relative_path LIKE '%//%'
             LIMIT 1",
        )?;
    }
    if schema_version >= 29 {
        let allowed_templates = if schema_version >= 30 {
            "'FINANCIAL_OVERVIEW','HOUSEHOLD_LEDGER','ASSETS_LIABILITIES',
             'CARD_RECONCILIATION','CASH_FLOW'"
        } else {
            "'FINANCIAL_OVERVIEW','HOUSEHOLD_LEDGER','ASSETS_LIABILITIES',
             'CARD_RECONCILIATION'"
        };
        reject_if_exists(
            connection,
            &format!(
                "SELECT 1 FROM dashboard_preferences p
             LEFT JOIN households h ON h.id=p.household_id
             WHERE h.id IS NULL
                OR p.dashboard_template NOT IN ({allowed_templates})
                OR p.theme NOT IN ('SYSTEM','LIGHT','DARK')
                OR p.density NOT IN ('COMFORTABLE','COMPACT')
                OR p.created_at NOT GLOB '????-??-??T??:??:??*Z'
                OR p.updated_at NOT GLOB '????-??-??T??:??:??*Z'
             LIMIT 1"
            ),
        )?;
    }
    if schema_version >= 40 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM dashboard_template_layouts l
             LEFT JOIN households h ON h.id=l.household_id
             WHERE h.id IS NULL
                OR l.dashboard_template NOT IN (
                  'FINANCIAL_OVERVIEW','HOUSEHOLD_LEDGER','ASSETS_LIABILITIES',
                  'CARD_RECONCILIATION','CASH_FLOW')
                OR l.created_at NOT GLOB '????-??-??T??:??:??*Z'
                OR l.updated_at NOT GLOB '????-??-??T??:??:??*Z'
                OR json_valid(l.widget_order)!=1
                OR json_type(l.widget_order)!='array'
                OR json_array_length(l.widget_order)!=4
                OR (SELECT count(DISTINCT value) FROM json_each(l.widget_order))!=4
                OR EXISTS(SELECT 1 FROM json_each(l.widget_order)
                          WHERE type!='text' OR value NOT IN ('TREND','SPENDING','RECENT','CARDS'))
                OR json_valid(l.hidden_widgets)!=1
                OR json_type(l.hidden_widgets)!='array'
                OR json_array_length(l.hidden_widgets)>
                   CASE WHEN l.dashboard_template='CASH_FLOW' THEN 2 ELSE 3 END
                OR (SELECT count(DISTINCT value) FROM json_each(l.hidden_widgets))
                   !=json_array_length(l.hidden_widgets)
                OR EXISTS(SELECT 1 FROM json_each(l.hidden_widgets)
                          WHERE type!='text' OR value NOT IN ('TREND','SPENDING','RECENT','CARDS')
                             OR (l.dashboard_template='CASH_FLOW' AND value='SPENDING'))
             LIMIT 1",
        )?;
    }
    if schema_version >= 42 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM dashboard_template_layouts l
             LEFT JOIN dashboard_preferences p ON p.household_id=l.household_id
             WHERE p.household_id IS NULL LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM dashboard_preferences p
             WHERE (SELECT count(*) FROM dashboard_template_layouts l
                    WHERE l.household_id=p.household_id)!=5
                OR (SELECT count(DISTINCT l.dashboard_template)
                    FROM dashboard_template_layouts l
                    WHERE l.household_id=p.household_id)!=5
             LIMIT 1",
        )?;
    }
    if schema_version >= 2 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM source_documents sd \
             JOIN import_runs ir ON ir.id = sd.import_run_id \
             WHERE sd.household_id != ir.household_id LIMIT 1",
        )?;
    }
    if schema_version >= 3 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM transaction_candidates tc \
             JOIN accounts a ON a.id = tc.account_id \
             WHERE tc.household_id != a.household_id LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM candidate_sources cs \
             JOIN transaction_candidates tc ON tc.id = cs.candidate_id \
             JOIN source_records sr ON sr.id = cs.source_record_id \
             JOIN source_documents sd ON sd.id = sr.source_document_id \
             WHERE tc.household_id != sd.household_id LIMIT 1",
        )?;
    }
    if schema_version >= 4 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM journal_entries je \
             JOIN transactions t ON t.id = je.transaction_id \
             JOIN accounts a ON a.id = je.account_id \
             WHERE t.household_id != a.household_id LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM transactions t \
             JOIN journal_entries je ON je.transaction_id = t.id \
             GROUP BY t.id \
             HAVING sum(CASE je.entry_side \
                         WHEN 'DEBIT' THEN je.amount_jpy \
                         ELSE -je.amount_jpy END) != 0 LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM transaction_sources ts \
             JOIN transactions t ON t.id = ts.transaction_id \
             JOIN source_records sr ON sr.id = ts.source_record_id \
             JOIN source_documents sd ON sd.id = sr.source_document_id \
             LEFT JOIN transaction_candidates tc ON tc.id = ts.candidate_id \
             WHERE t.household_id != sd.household_id \
                OR (tc.id IS NOT NULL AND t.household_id != tc.household_id) \
             LIMIT 1",
        )?;
    }
    if schema_version >= 5 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM card_statements cs \
             JOIN accounts a ON a.id = cs.card_account_id \
             WHERE cs.household_id != a.household_id LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM card_statement_transactions cst \
             JOIN card_statements cs ON cs.id = cst.statement_id \
             JOIN transactions t ON t.id = cst.transaction_id \
             WHERE cs.household_id != t.household_id LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM card_payments cp \
             JOIN accounts a ON a.id = cp.card_account_id \
             JOIN transactions t ON t.id = cp.bank_transaction_id \
             LEFT JOIN card_statements cs ON cs.id = cp.statement_id \
             WHERE cp.household_id != a.household_id \
                OR cp.household_id != t.household_id \
                OR (cs.id IS NOT NULL AND (cp.household_id != cs.household_id \
                    OR cp.card_account_id != cs.card_account_id)) \
             LIMIT 1",
        )?;
    }
    if schema_version >= 6 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM staged_card_statements scs \
             JOIN import_runs ir ON ir.id = scs.import_run_id \
             JOIN accounts a ON a.id = scs.card_account_id \
             WHERE scs.household_id != ir.household_id \
                OR scs.household_id != a.household_id LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM staged_card_statement_candidates scsc \
             JOIN staged_card_statements scs ON scs.id = scsc.statement_id \
             JOIN transaction_candidates tc ON tc.id = scsc.candidate_id \
             WHERE scs.household_id != tc.household_id LIMIT 1",
        )?;
    }
    if schema_version >= 7 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM monthly_category_budgets b \
             JOIN accounts a ON a.id = b.category_account_id \
             WHERE b.household_id != a.household_id \
                OR a.account_kind != 'EXPENSE' LIMIT 1",
        )?;
    }
    if schema_version >= 17 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM households h
             WHERE NOT EXISTS (
                 SELECT 1 FROM household_members m
                 WHERE m.household_id = h.id AND m.status = 'ACTIVE'
             ) LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM accounts a
             LEFT JOIN household_members m ON m.id = a.owner_member_id
             WHERE (a.ownership_kind = 'HOUSEHOLD' AND a.owner_member_id IS NOT NULL)
                OR (a.ownership_kind = 'MEMBER' AND (
                    m.id IS NULL OR m.household_id != a.household_id OR m.status != 'ACTIVE'
                ))
                OR (a.visibility = 'PERSONAL' AND a.ownership_kind != 'MEMBER')
             LIMIT 1",
        )?;
    }
    if schema_version >= 18 {
        for query in [
            "SELECT 1 FROM transactions r
             LEFT JOIN household_members attributed ON attributed.id = r.attributed_member_id
             LEFT JOIN household_members audience ON audience.id = r.audience_member_id
             WHERE r.attribution_kind NOT IN ('HOUSEHOLD', 'MEMBER')
                OR r.audience_visibility NOT IN ('SHARED', 'PERSONAL')
                OR (r.attribution_kind = 'HOUSEHOLD' AND r.attributed_member_id IS NOT NULL)
                OR (r.attribution_kind = 'MEMBER' AND (attributed.id IS NULL
                    OR attributed.household_id != r.household_id))
                OR (r.audience_visibility = 'SHARED' AND r.audience_member_id IS NOT NULL)
                OR (r.audience_visibility = 'PERSONAL' AND (audience.id IS NULL
                    OR audience.household_id != r.household_id)) LIMIT 1",
            "SELECT 1 FROM transaction_candidates r
             LEFT JOIN household_members attributed ON attributed.id = r.attributed_member_id
             LEFT JOIN household_members audience ON audience.id = r.audience_member_id
             WHERE r.attribution_kind NOT IN ('HOUSEHOLD', 'MEMBER')
                OR r.audience_visibility NOT IN ('SHARED', 'PERSONAL')
                OR (r.attribution_kind = 'HOUSEHOLD' AND r.attributed_member_id IS NOT NULL)
                OR (r.attribution_kind = 'MEMBER' AND (attributed.id IS NULL
                    OR attributed.household_id != r.household_id))
                OR (r.audience_visibility = 'SHARED' AND r.audience_member_id IS NOT NULL)
                OR (r.audience_visibility = 'PERSONAL' AND (audience.id IS NULL
                    OR audience.household_id != r.household_id)) LIMIT 1",
            "SELECT 1 FROM source_documents r
             LEFT JOIN household_members audience ON audience.id = r.audience_member_id
             WHERE r.audience_visibility NOT IN ('SHARED', 'PERSONAL')
                OR (r.audience_visibility = 'SHARED' AND r.audience_member_id IS NOT NULL)
                OR (r.audience_visibility = 'PERSONAL' AND (audience.id IS NULL
                    OR audience.household_id != r.household_id)) LIMIT 1",
        ] {
            reject_if_exists(connection, query)?;
        }
    }
    if schema_version >= 19 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM delimited_parser_profiles p
             WHERE p.delimiter NOT IN ('AUTO', 'COMMA', 'TAB', 'SEMICOLON')
                OR p.encoding NOT IN ('AUTO', 'UTF8', 'CP932')
                OR p.date_format NOT IN (
                    'AUTO', 'YYYY_MM_DD', 'YYYYMMDD', 'MM_DD_YYYY', 'DD_MM_YYYY'
                )
                OR p.amount_mode NOT IN ('SIGNED', 'DEBIT_CREDIT')
                OR (p.signed_positive_direction IS NOT NULL
                    AND p.signed_positive_direction NOT IN ('IN', 'OUT'))
                OR p.header_row NOT BETWEEN 1 AND 1000
                OR p.priority NOT BETWEEN 0 AND 10000
                OR p.version <= 0
                OR p.is_enabled NOT IN (0, 1)
                OR length(trim(p.name)) NOT BETWEEN 1 AND 120
                OR length(trim(p.date_column)) NOT BETWEEN 1 AND 120
                OR (p.description_column IS NULL AND p.payee_column IS NULL)
                OR (p.amount_mode = 'SIGNED' AND (
                    p.signed_positive_direction IS NULL
                    OR p.signed_amount_column IS NULL OR p.debit_column IS NOT NULL
                    OR p.credit_column IS NOT NULL))
                OR (p.amount_mode = 'DEBIT_CREDIT' AND (
                    p.signed_positive_direction IS NOT NULL
                    OR p.signed_amount_column IS NOT NULL OR p.debit_column IS NULL
                    OR p.credit_column IS NULL))
                OR p.updated_at < p.created_at
                OR EXISTS (
                    SELECT 1 FROM json_each(json_array(
                        p.date_column, p.description_column, p.payee_column,
                        p.signed_amount_column, p.debit_column, p.credit_column,
                        p.external_id_column, p.account_hint_column
                    )) mapped
                    WHERE mapped.value IS NOT NULL
                    GROUP BY trim(mapped.value) HAVING count(*) > 1
                )
             LIMIT 1",
        )?;
    }
    if schema_version >= 20 {
        for query in [
            "SELECT 1 FROM brokerage_events e
             WHERE (e.event_type != 'MERGER' AND (
                       e.merger_cash_amount IS NOT NULL
                    OR e.merger_cash_currency IS NOT NULL
                    OR e.merger_stock_cost_basis_ratio IS NOT NULL
                    OR e.source_to_target_fx_rate IS NOT NULL
                    OR e.source_to_cash_fx_rate IS NOT NULL))
                OR (e.event_type = 'MERGER' AND (
                       (length(trim(COALESCE(e.target_instrument_code, ''))) = 0
                        AND length(trim(COALESCE(e.target_instrument_name, ''))) = 0)
                    OR e.target_currency IS NULL
                    OR length(e.target_currency) != 3
                    OR e.target_currency GLOB '*[^A-Z]*'
                    OR e.corporate_action_ratio IS NULL
                    OR e.corporate_action_ratio <= 0
                    OR e.merger_stock_cost_basis_ratio IS NULL
                    OR e.merger_stock_cost_basis_ratio <= 0
                    OR e.merger_stock_cost_basis_ratio > 1
                    OR (e.target_currency = e.currency
                        AND e.source_to_target_fx_rate IS NOT NULL)
                    OR (e.target_currency != e.currency AND (
                        e.source_to_target_fx_rate IS NULL
                        OR e.source_to_target_fx_rate <= 0
                        OR e.source_to_target_fx_rate > 1.0e12))
                    OR (e.merger_cash_amount IS NULL AND (
                        e.merger_cash_currency IS NOT NULL
                        OR e.source_to_cash_fx_rate IS NOT NULL
                        OR e.merger_stock_cost_basis_ratio != 1))
                    OR (e.merger_cash_amount IS NOT NULL AND (
                        e.merger_cash_amount <= 0 OR e.merger_cash_amount > 1.0e18
                        OR e.merger_cash_currency IS NULL
                        OR length(e.merger_cash_currency) != 3
                        OR e.merger_cash_currency GLOB '*[^A-Z]*'
                        OR e.merger_stock_cost_basis_ratio >= 1
                        OR (e.merger_cash_currency = e.currency
                            AND e.source_to_cash_fx_rate IS NOT NULL)
                        OR (e.merger_cash_currency != e.currency AND (
                            e.source_to_cash_fx_rate IS NULL
                            OR e.source_to_cash_fx_rate <= 0
                            OR e.source_to_cash_fx_rate > 1.0e12))))))
             LIMIT 1",
            "SELECT 1 FROM brokerage_events e
             WHERE (e.event_type != 'MERGER' AND EXISTS (
                       SELECT 1 FROM brokerage_event_legs l
                       WHERE l.brokerage_event_id = e.id AND l.currency != e.currency))
                OR (e.event_type = 'MERGER' AND (
                       e.gross_amount != 0 OR e.fee_amount != 0
                    OR e.tax_amount != 0 OR e.settlement_amount != 0
                    OR (SELECT count(*) FROM brokerage_event_legs l
                        WHERE l.brokerage_event_id = e.id) !=
                       CASE WHEN e.merger_cash_amount IS NULL THEN 2 ELSE 4 END
                    OR (SELECT count(*) FROM brokerage_event_legs l
                        WHERE l.brokerage_event_id = e.id AND l.leg_kind = 'SECURITY'
                          AND l.currency = e.currency AND l.signed_amount = 0
                          AND l.signed_quantity < 0
                          AND ((length(trim(e.instrument_code)) > 0
                                AND l.instrument_code = e.instrument_code)
                            OR (length(trim(e.instrument_code)) = 0
                                AND length(trim(e.instrument_name)) > 0
                                AND l.instrument_name = e.instrument_name))) != 1
                    OR (SELECT count(*) FROM brokerage_event_legs l
                        WHERE l.brokerage_event_id = e.id AND l.leg_kind = 'SECURITY'
                          AND l.currency = e.target_currency AND l.signed_amount = 0
                          AND l.signed_quantity > 0
                          AND ((length(trim(COALESCE(e.target_instrument_code, ''))) > 0
                                AND l.instrument_code = e.target_instrument_code)
                            OR (length(trim(COALESCE(e.target_instrument_code, ''))) = 0
                                AND l.instrument_name = e.target_instrument_name))) != 1
                    OR abs(
                        (SELECT l.signed_quantity FROM brokerage_event_legs l
                         WHERE l.brokerage_event_id = e.id AND l.leg_kind = 'SECURITY'
                           AND l.signed_quantity > 0 LIMIT 1)
                        + (SELECT l.signed_quantity FROM brokerage_event_legs l
                           WHERE l.brokerage_event_id = e.id AND l.leg_kind = 'SECURITY'
                             AND l.signed_quantity < 0 LIMIT 1) * e.corporate_action_ratio
                       ) > 0.000001
                    OR (e.merger_cash_amount IS NOT NULL AND (
                        (SELECT count(*) FROM brokerage_event_legs l
                         WHERE l.brokerage_event_id = e.id AND l.leg_kind = 'CASH'
                           AND l.currency = e.merger_cash_currency
                           AND abs(l.signed_amount - e.merger_cash_amount) <= 0.000001
                           AND l.signed_quantity IS NULL) != 1
                        OR (SELECT count(*) FROM brokerage_event_legs l
                            WHERE l.brokerage_event_id = e.id AND l.leg_kind = 'ADJUSTMENT'
                              AND l.currency = e.merger_cash_currency
                              AND abs(l.signed_amount + e.merger_cash_amount) <= 0.000001
                              AND l.signed_quantity IS NULL) != 1))))
             LIMIT 1",
            "SELECT 1 FROM brokerage_events e
             JOIN brokerage_event_legs l ON l.brokerage_event_id = e.id
             WHERE e.event_type = 'MERGER'
             GROUP BY e.id, l.currency
             HAVING abs(sum(l.signed_amount)) > 0.000001
             LIMIT 1",
        ] {
            reject_if_exists(connection, query)?;
        }
    }
    if schema_version >= 21 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM aggregate_asset_snapshots snapshot
             JOIN source_documents document ON document.id = snapshot.source_document_id
             LEFT JOIN source_records record
               ON record.source_document_id = snapshot.source_document_id
              AND record.row_number = snapshot.source_row
             WHERE snapshot.household_id != document.household_id
                OR record.id IS NULL LIMIT 1",
        )?;
    }
    if schema_version >= 53 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM google_drive_connections c
             LEFT JOIN households h ON h.id=c.household_id
             WHERE h.id IS NULL
                OR c.oauth_scope!='https://www.googleapis.com/auth/drive.readonly'
                OR (c.change_page_token IS NOT NULL AND c.start_page_token IS NULL)
                OR ((c.root_folder_id IS NULL)!=(c.root_folder_name IS NULL))
                OR (c.status IN ('SELECTING_FOLDER','CONNECTED') AND c.google_account_id IS NULL)
                OR (c.status='CONNECTED' AND (c.root_folder_id IS NULL
                    OR c.change_page_token IS NULL))
             LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM google_drive_nodes n
             LEFT JOIN google_drive_connections c ON c.id=n.connection_id
             WHERE c.id IS NULL
                OR ((n.mime_type='application/vnd.google-apps.folder')!=n.is_folder)
                OR (n.is_folder=1 AND (n.byte_size IS NOT NULL
                    OR n.md5_checksum IS NOT NULL OR n.can_download!=0))
             LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM google_drive_sync_schedules s
             LEFT JOIN google_drive_connections c ON c.id=s.connection_id
             WHERE c.id IS NULL
                OR ((s.last_result='RUNNING')!=(s.lease_token IS NOT NULL))
                OR ((s.lease_token IS NULL)!=(s.lease_expires_at IS NULL))
             LIMIT 1",
        )?;
    }
    if schema_version >= 54 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM google_drive_inbox i
             LEFT JOIN google_drive_connections c ON c.id=i.connection_id
             LEFT JOIN google_drive_nodes n
               ON n.connection_id=i.connection_id AND n.file_id=i.file_id
             LEFT JOIN import_runs r ON r.id=i.import_run_id
             WHERE c.id IS NULL OR c.household_id!=i.household_id
                OR n.file_id IS NULL OR n.is_folder!=0
                OR (i.import_run_id IS NOT NULL AND r.household_id!=i.household_id)
             LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM google_drive_source_links l
             LEFT JOIN google_drive_inbox i ON i.id=l.inbox_id
             LEFT JOIN source_documents d ON d.id=l.source_document_id
             WHERE i.id IS NULL OR d.id IS NULL OR i.household_id!=d.household_id
                OR i.state!='STAGED' OR i.import_run_id!=d.import_run_id
                OR i.content_sha256 IS NULL OR i.content_sha256!=d.sha256
             LIMIT 1",
        )?;
    }
    if schema_version >= 55 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM google_drive_connections c
             WHERE c.root_resource_key IS NOT NULL AND (
                 c.root_folder_id IS NULL
                 OR length(c.root_resource_key) NOT BETWEEN 1 AND 256
                 OR c.root_resource_key GLOB '*[^0-9A-Za-z_-]*'
             ) LIMIT 1",
        )?;
    }
    if schema_version >= 57 {
        reject_if_exists(
            connection,
            "SELECT 1 FROM gmail_connections c
             LEFT JOIN households h ON h.id=c.household_id
             WHERE h.id IS NULL
                OR c.oauth_scope!='https://www.googleapis.com/auth/gmail.readonly'
                OR ((c.label_id IS NULL)!=(c.label_name IS NULL))
                OR (c.history_id IS NOT NULL AND c.start_history_id IS NULL)
                OR (c.status='CONNECTED' AND (c.google_account_id IS NULL
                    OR c.label_id IS NULL OR c.history_id IS NULL))
             LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM gmail_sync_schedules s
             LEFT JOIN gmail_connections c ON c.id=s.connection_id
             WHERE c.id IS NULL
                OR ((s.last_result='RUNNING')!=(s.lease_token IS NOT NULL))
                OR ((s.lease_token IS NULL)!=(s.lease_expires_at IS NULL))
             LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM gmail_inbox i
             LEFT JOIN gmail_connections c ON c.id=i.connection_id
             LEFT JOIN import_runs r ON r.id=i.import_run_id
             WHERE c.id IS NULL OR c.household_id!=i.household_id
                OR (i.import_run_id IS NOT NULL AND r.household_id!=i.household_id)
             LIMIT 1",
        )?;
        reject_if_exists(
            connection,
            "SELECT 1 FROM gmail_source_links l
             LEFT JOIN gmail_inbox i ON i.id=l.inbox_id
             LEFT JOIN source_documents d ON d.id=l.source_document_id
             WHERE i.id IS NULL OR d.id IS NULL OR i.household_id!=d.household_id
                OR d.source_type!='GMAIL' OR i.state!='STAGED'
                OR i.import_run_id!=d.import_run_id
                OR i.content_sha256 IS NULL OR i.content_sha256!=d.sha256
             LIMIT 1",
        )?;
    }
    Ok(())
}

fn reject_if_exists(connection: &Connection, query: &str) -> Result<(), PersistenceError> {
    if connection
        .query_row(query, [], |_| Ok(true))
        .optional()?
        .unwrap_or(false)
    {
        return Err(invalid_restored_database());
    }
    Ok(())
}

fn is_canonical_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn invalid_restored_database() -> PersistenceError {
    PersistenceError::Database(rusqlite::Error::InvalidQuery)
}

fn restrict_directory_permissions(path: &std::path::Path) -> Result<(), PersistenceError> {
    private_fs::secure_directory(path).map_err(|_| PersistenceError::Directory)
}

fn restrict_file_permissions(path: &std::path::Path) -> Result<(), PersistenceError> {
    private_fs::secure_file(path).map_err(|_| PersistenceError::Directory)
}

fn restrict_database_file_permissions(
    database_path: &std::path::Path,
) -> Result<(), PersistenceError> {
    restrict_file_permissions(database_path)?;
    // WAL and shared-memory sidecars contain encrypted pages/coordination data,
    // but keep their OS permissions as strict as the main database as defense in
    // depth. SQLite may recreate them, so this runs on every application start.
    let database_name = database_path.to_string_lossy();
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{database_name}{suffix}"));
        if sidecar.exists() {
            restrict_file_permissions(&sidecar)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_KEY: &[u8] = b"test-only-key-material-at-least-32-bytes";

    #[test]
    fn all_migrations_apply_and_integrity_is_valid() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                assert_eq!(schema_version(connection)?, MIGRATIONS.len() as i64);
                assert!(integrity_check(connection)?);
                Ok(())
            })
            .expect("database should remain readable");
    }

    #[test]
    fn migration_70_preserves_released_connectors_evidence_and_posted_provenance() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        configure_connection(&connection).expect("connection configuration");
        Migrations::new(MIGRATIONS[..69].to_vec())
            .to_latest(&mut connection)
            .expect("released schema 69");
        connection
            .execute_batch(&format!(
                "INSERT INTO households(id,name) VALUES('family','Family');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('bank','family','Bank','ASSET','BANK'),
                       ('expense','family','Expense','EXPENSE','OTHER');

                 INSERT INTO import_runs(id,household_id,status,adapter_id,adapter_version)
                 VALUES('drive-run','family','POSTED','test','1'),
                       ('gmail-run','family','REVIEW_REQUIRED','test','1'),
                       ('folder-run','family','REVIEW_REQUIRED','test','1');
                 INSERT INTO source_documents
                   (id,household_id,import_run_id,source_type,original_filename,media_type,
                    byte_size,sha256,storage_path)
                 VALUES('drive-doc','family','drive-run','GOOGLE_DRIVE','drive.csv','text/csv',10,
                        '{drive_sha}','vault://{drive_sha}'),
                       ('gmail-doc','family','gmail-run','GMAIL','message.eml','message/rfc822',20,
                        '{gmail_sha}','vault://{gmail_sha}'),
                       ('folder-doc','family','folder-run','LOCAL_FOLDER','folder.csv','text/csv',30,
                        '{folder_sha}','vault://{folder_sha}');
                 INSERT INTO source_records(id,source_document_id,row_number,record_hash,raw_payload_json)
                 VALUES('drive-record','drive-doc',1,'{record_sha}','{{}}'),
                       ('gmail-record','gmail-doc',1,'{gmail_record_sha}','{{}}'),
                       ('folder-record','folder-doc',1,'{folder_record_sha}','{{}}');
                 INSERT INTO transaction_candidates
                   (id,household_id,account_id,occurred_on,amount_jpy,direction,review_status)
                 VALUES('drive-candidate','family','bank','2026-08-25',100,'OUT','POSTED');
                 INSERT INTO candidate_sources(candidate_id,source_record_id,evidence_role)
                 VALUES('drive-candidate','drive-record','PRIMARY');
                 INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status)
                 VALUES('posted-transaction','family','2026-08-25','EXPENSE','POSTED');
                 INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                 VALUES('posted-debit','posted-transaction','expense','DEBIT',100,1),
                       ('posted-credit','posted-transaction','bank','CREDIT',100,2);
                 INSERT INTO transaction_sources(transaction_id,source_record_id,candidate_id)
                 VALUES('posted-transaction','drive-record','drive-candidate');

                 INSERT INTO google_drive_connections(id,household_id,client_id_fingerprint,status)
                 VALUES('drive','family','{drive_fingerprint}','AUTHORIZING');
                 INSERT INTO google_drive_sync_schedules(connection_id,enabled,interval_minutes,last_result)
                 VALUES('drive',0,30,'DISABLED');
                 INSERT INTO google_drive_nodes
                   (connection_id,file_id,name,mime_type,generation_fingerprint,is_folder,can_download)
                 VALUES('drive','drive-file','drive.csv','text/csv','{drive_generation}',0,1);
                 INSERT INTO google_drive_inbox
                   (id,household_id,connection_id,file_id,generation_fingerprint,file_name,media_type,
                    content_sha256,state,import_run_id)
                 VALUES('{drive_inbox}','family','drive','drive-file','{drive_generation}',
                        'drive.csv','text/csv','{drive_sha}','STAGED','drive-run');
                 INSERT INTO google_drive_source_links(inbox_id,source_document_id)
                 VALUES('{drive_inbox}','drive-doc');

                 INSERT INTO gmail_connections(id,household_id,client_id_fingerprint,status)
                 VALUES('gmail','family','{gmail_fingerprint}','AUTHORIZING');
                 INSERT INTO gmail_sync_schedules(connection_id,enabled,interval_minutes,last_result)
                 VALUES('gmail',0,30,'DISABLED');
                 INSERT INTO gmail_inbox
                   (id,household_id,connection_id,provider_message_id,generation_fingerprint,
                    message_history_id,internal_date_ms,file_name,content_sha256,state,import_run_id)
                 VALUES('{gmail_inbox}','family','gmail','message','{gmail_generation}',
                        '1',1,'message.eml','{gmail_sha}','STAGED','gmail-run');
                 INSERT INTO gmail_source_links(inbox_id,source_document_id)
                 VALUES('{gmail_inbox}','gmail-doc');

                 INSERT INTO watched_folders(id,household_id,label,canonical_path,source_type,provider)
                 VALUES('folder','family','Inbox','/device/inbox','LOCAL_FOLDER','LOCAL');
                 INSERT INTO watched_file_inbox
                   (id,household_id,watched_folder_id,relative_path,file_name,media_type,byte_size,
                    fingerprint,state,import_run_id)
                 VALUES('{folder_inbox}','family','folder','folder.csv','folder.csv','text/csv',30,
                        '{folder_generation}','STAGED','folder-run');",
                drive_sha = "1".repeat(64),
                gmail_sha = "2".repeat(64),
                folder_sha = "3".repeat(64),
                record_sha = "4".repeat(64),
                gmail_record_sha = "5".repeat(64),
                folder_record_sha = "6".repeat(64),
                drive_fingerprint = "a".repeat(64),
                gmail_fingerprint = "b".repeat(64),
                drive_generation = "c".repeat(64),
                gmail_generation = "d".repeat(64),
                folder_generation = "e".repeat(64),
                drive_inbox = "7".repeat(64),
                gmail_inbox = "8".repeat(64),
                folder_inbox = "9".repeat(64),
            ))
            .expect("seed released connector and provenance graph");

        let snapshots = [
            "SELECT id,name,base_currency,created_at,updated_at FROM households ORDER BY id",
            "SELECT id,household_id,name,account_kind,account_subtype,is_archived FROM accounts ORDER BY id",
            "SELECT id,household_id,status,adapter_id,adapter_version,started_at,completed_at FROM import_runs ORDER BY id",
            "SELECT id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path FROM source_documents ORDER BY id",
            "SELECT id,source_document_id,row_number,record_hash,raw_payload_json FROM source_records ORDER BY id",
            "SELECT id,household_id,account_id,occurred_on,amount_jpy,direction,review_status FROM transaction_candidates ORDER BY id",
            "SELECT candidate_id,source_record_id,evidence_role FROM candidate_sources ORDER BY candidate_id,source_record_id",
            "SELECT id,household_id,occurred_on,transaction_type,status FROM transactions ORDER BY id",
            "SELECT id,transaction_id,account_id,entry_side,amount_jpy,line_number FROM journal_entries ORDER BY id",
            "SELECT transaction_id,source_record_id,candidate_id FROM transaction_sources ORDER BY transaction_id,source_record_id",
            "SELECT id,household_id,status,client_id_fingerprint FROM google_drive_connections ORDER BY id",
            "SELECT connection_id,enabled,interval_minutes,last_result FROM google_drive_sync_schedules ORDER BY connection_id",
            "SELECT connection_id,file_id,name,mime_type,generation_fingerprint,is_folder,can_download FROM google_drive_nodes ORDER BY connection_id,file_id",
            "SELECT id,household_id,connection_id,file_id,generation_fingerprint,state,import_run_id FROM google_drive_inbox ORDER BY id",
            "SELECT inbox_id,source_document_id,evidence_role,linked_at FROM google_drive_source_links ORDER BY inbox_id,source_document_id",
            "SELECT id,household_id,status,client_id_fingerprint FROM gmail_connections ORDER BY id",
            "SELECT connection_id,enabled,interval_minutes,last_result FROM gmail_sync_schedules ORDER BY connection_id",
            "SELECT id,household_id,connection_id,provider_message_id,generation_fingerprint,state,import_run_id FROM gmail_inbox ORDER BY id",
            "SELECT inbox_id,source_document_id,evidence_role,linked_at FROM gmail_source_links ORDER BY inbox_id,source_document_id",
            "SELECT id,household_id,label,canonical_path,source_type,provider,is_enabled FROM watched_folders ORDER BY id",
            "SELECT id,household_id,watched_folder_id,relative_path,fingerprint,state,import_run_id FROM watched_file_inbox ORDER BY id",
        ];
        let before = snapshots
            .iter()
            .map(|query| selected_values(&connection, query))
            .collect::<Vec<_>>();

        Migrations::new(MIGRATIONS.to_vec())
            .to_latest(&mut connection)
            .expect("migrate released database to latest");

        let after = snapshots
            .iter()
            .map(|query| selected_values(&connection, query))
            .collect::<Vec<_>>();
        assert_eq!(after, before);
        for table in ["connector_bindings", "connector_binding_accounts"] {
            assert_eq!(
                connection
                    .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .unwrap(),
                0,
                "{table} starts empty"
            );
        }
        assert_eq!(schema_version(&connection).unwrap(), 70);
        assert!(integrity_check(&connection).unwrap());
    }

    fn selected_values(connection: &Connection, query: &str) -> Vec<Vec<rusqlite::types::Value>> {
        let mut statement = connection.prepare(query).unwrap();
        let column_count = statement.column_count();
        statement
            .query_map([], |row| {
                (0..column_count)
                    .map(|column| row.get(column))
                    .collect::<rusqlite::Result<Vec<rusqlite::types::Value>>>()
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    }

    #[test]
    fn migration_69_backfills_japanese_expense_categories_without_overwriting_accounts() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('legacy','Legacy')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                     VALUES('legacy-household-goods','legacy','日用品（カスタム）','EXPENSE','OTHER')",
                    [],
                )?;
                connection.execute_batch(include_str!(
                    "../migrations/0069_japanese_expense_categories.sql"
                ))?;
                let count: i64 = connection.query_row(
                    "SELECT count(*) FROM accounts WHERE household_id='legacy' AND account_kind='EXPENSE'",
                    [],
                    |row| row.get(0),
                )?;
                let preserved: String = connection.query_row(
                    "SELECT name FROM accounts WHERE id='legacy-household-goods'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(count, 9);
                assert_eq!(preserved, "日用品（カスタム）");
                Ok(())
            })
            .expect("category backfill should be idempotent");
    }

    #[test]
    fn migration_51_backfills_local_watched_folder_source_and_enforces_pairs() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        Migrations::new(MIGRATIONS[..50].to_vec())
            .to_latest(&mut connection)
            .unwrap();
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('family','Family');
                 INSERT INTO watched_folders(id,household_id,label,canonical_path)
                 VALUES('folder','family','Inbox','/private/inbox');",
            )
            .unwrap();

        Migrations::new(MIGRATIONS.to_vec())
            .to_latest(&mut connection)
            .unwrap();

        let pair: (String, String) = connection
            .query_row(
                "SELECT source_type,provider FROM watched_folders WHERE id='folder'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(pair, ("LOCAL_FOLDER".to_owned(), "LOCAL".to_owned()));
        assert!(connection
            .execute(
                "UPDATE watched_folders SET source_type='ICLOUD_PICKER',provider='ICLOUD'
                 WHERE id='folder'",
                [],
            )
            .is_ok());
        assert!(connection
            .execute(
                "UPDATE watched_folders SET provider='LOCAL' WHERE id='folder'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE watched_folders SET source_type='GOOGLE_DRIVE' WHERE id='folder'",
                [],
            )
            .is_err());
    }

    #[test]
    fn migrations_53_and_54_support_authorization_then_bounded_remote_inbox() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        Migrations::new(MIGRATIONS[..52].to_vec())
            .to_latest(&mut connection)
            .unwrap();
        connection
            .execute(
                "INSERT INTO households(id,name) VALUES('family','Family')",
                [],
            )
            .unwrap();

        Migrations::new(MIGRATIONS.to_vec())
            .to_latest(&mut connection)
            .unwrap();
        let hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        connection
            .execute_batch(&format!(
                "INSERT INTO google_drive_connections
               (id,household_id,client_id_fingerprint,status)
             VALUES('drive','family','{hash}','AUTHORIZING');
             UPDATE google_drive_connections
             SET google_account_id='google-user',root_folder_id='root',
                 root_folder_name='KakeFlow',status='SELECTING_FOLDER';
             UPDATE google_drive_connections
             SET start_page_token='start',change_page_token='change',status='CONNECTED';
             INSERT INTO google_drive_nodes
               (connection_id,file_id,parent_file_id,name,mime_type,byte_size,
                md5_checksum,drive_version,generation_fingerprint,is_folder,can_download)
             VALUES('drive','file','root','statement.csv','text/csv',123,
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','7','{hash}',0,1);
             INSERT INTO google_drive_inbox
               (id,household_id,connection_id,file_id,generation_fingerprint,
                file_name,media_type,remote_byte_size,state)
             VALUES('{hash}','family','drive','file','{hash}',
               'statement.csv','text/csv',123,'DISCOVERED');"
            ))
            .unwrap();

        assert!(connection
            .execute(
                "UPDATE google_drive_connections SET root_folder_name=NULL WHERE id='drive'",
                [],
            )
            .is_err());
        let second = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        connection.execute(
            "UPDATE google_drive_nodes
             SET generation_fingerprint=?1,drive_version='8' WHERE connection_id='drive' AND file_id='file'",
            [second],
        ).unwrap();
        connection
            .execute(
                "INSERT INTO google_drive_inbox
               (id,household_id,connection_id,file_id,generation_fingerprint,
                file_name,media_type,state)
             VALUES(?1,'family','drive','file',?1,'statement.csv','text/csv','DISCOVERED')",
                [second],
            )
            .unwrap();
        assert_eq!(connection.query_row(
            "SELECT count(*) FROM google_drive_inbox WHERE connection_id='drive' AND file_id='file'",
            [], |row| row.get::<_, i64>(0),
        ).unwrap(), 2);
        assert!(connection
            .execute(
                "INSERT INTO google_drive_inbox
                   (id,household_id,connection_id,file_id,generation_fingerprint,
                    file_name,media_type,state)
                 VALUES(?1,'family','drive','file',?1,'old.csv','text/csv','DISCOVERED')",
                ["cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"],
            )
            .is_err());
        assert!(validate_restored_semantics(&connection, 54).is_ok());
    }

    #[test]
    fn migration_55_preserves_a_bounded_root_resource_key() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        Migrations::new(MIGRATIONS[..54].to_vec())
            .to_latest(&mut connection)
            .unwrap();
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('family','Family');
                 INSERT INTO google_drive_connections
                   (id,household_id,google_account_id,client_id_fingerprint,
                    root_folder_id,root_folder_name,status,start_page_token,change_page_token)
                 VALUES('drive','family','user',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    'root','Root','CONNECTED','start','change');",
            )
            .unwrap();

        Migrations::new(MIGRATIONS.to_vec())
            .to_latest(&mut connection)
            .unwrap();
        connection
            .execute(
                "UPDATE google_drive_connections
                 SET root_resource_key='0-Key_123' WHERE id='drive'",
                [],
            )
            .unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT root_resource_key FROM google_drive_connections WHERE id='drive'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "0-Key_123"
        );
        assert!(connection
            .execute(
                "UPDATE google_drive_connections SET root_resource_key='bad key' WHERE id='drive'",
                [],
            )
            .is_err());
        assert!(validate_restored_semantics(&connection, 55).is_ok());
    }

    #[test]
    fn migration_56_preserves_sources_and_adds_icloud_and_google_drive_types() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        Migrations::new(MIGRATIONS[..55].to_vec())
            .to_latest(&mut connection)
            .unwrap();
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('family','Family');
                 INSERT INTO import_runs(id,household_id,status) VALUES
                   ('existing-run','family','REVIEW_REQUIRED'),
                   ('icloud-run','family','REVIEW_REQUIRED'),
                   ('drive-run','family','REVIEW_REQUIRED'),
                   ('invalid-run','family','REVIEW_REQUIRED');
                 INSERT INTO source_documents
                   (id,household_id,import_run_id,source_type,original_filename,
                    media_type,byte_size,sha256,storage_path)
                 VALUES('existing','family','existing-run','MANUAL_UPLOAD','old.csv',
                    'text/csv',1,
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    'vault://old');",
            )
            .unwrap();

        Migrations::new(MIGRATIONS.to_vec())
            .to_latest(&mut connection)
            .unwrap();

        for (id, run, source_type, hash) in [
            (
                "icloud",
                "icloud-run",
                "ICLOUD_PICKER",
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ),
            (
                "drive",
                "drive-run",
                "GOOGLE_DRIVE",
                "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            ),
        ] {
            connection
                .execute(
                    "INSERT INTO source_documents
                       (id,household_id,import_run_id,source_type,original_filename,
                        media_type,byte_size,sha256,storage_path)
                     VALUES(?1,'family',?2,?3,'source.csv','text/csv',1,?4,'vault://source')",
                    rusqlite::params![id, run, source_type, hash],
                )
                .unwrap();
        }
        assert_eq!(
            connection
                .query_row(
                    "SELECT source_type FROM source_documents WHERE id='existing'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "MANUAL_UPLOAD"
        );
        assert!(connection
            .execute(
                "INSERT INTO source_documents
                   (id,household_id,import_run_id,source_type,original_filename,
                    media_type,byte_size,sha256,storage_path)
                 VALUES('invalid','family','invalid-run','REMOTE_UNKNOWN','bad.csv','text/csv',1,
                    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
                    'vault://bad')",
                [],
            )
            .is_err());
        let foreign_key_issues: i64 = connection
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_key_issues, 0);
    }

    #[test]
    fn restored_semantics_reject_invalid_google_drive_root_resource_key() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('family','Family');
                     INSERT INTO google_drive_connections
                       (id,household_id,google_account_id,client_id_fingerprint,
                        root_folder_id,root_folder_name,status,start_page_token,change_page_token,
                        root_resource_key)
                     VALUES('drive','family','user',
                        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                        'root','Root','CONNECTED','start','change','0-Key_123');
                     PRAGMA ignore_check_constraints=ON;
                     UPDATE google_drive_connections
                     SET root_resource_key='invalid resource key' WHERE id='drive';
                     PRAGMA ignore_check_constraints=OFF;",
                )?;
                assert!(validate_restored_semantics(connection, 55).is_err());
                Ok(())
            })
            .expect("restore semantic audit should execute");
    }

    #[test]
    fn restored_semantics_reject_google_drive_cross_household_inbox_scope() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state.with_connection(|connection| {
            let hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            connection.execute_batch(&format!(
                "INSERT INTO households(id,name) VALUES('family','Family'),('other','Other');
                 INSERT INTO google_drive_connections
                   (id,household_id,google_account_id,client_id_fingerprint,
                    root_folder_id,root_folder_name,status,start_page_token,change_page_token)
                 VALUES('drive','family','user','{hash}','root','Root','CONNECTED','start','change');
                 INSERT INTO google_drive_nodes
                   (connection_id,file_id,name,mime_type,generation_fingerprint,is_folder,can_download)
                 VALUES('drive','file','statement.csv','text/csv','{hash}',0,1);
                 INSERT INTO google_drive_inbox
                   (id,household_id,connection_id,file_id,generation_fingerprint,
                    file_name,media_type,state)
                 VALUES('{hash}','family','drive','file','{hash}','statement.csv','text/csv','DISCOVERED');
                 DROP TRIGGER trg_google_drive_inbox_scope_update;
                 UPDATE google_drive_inbox SET household_id='other' WHERE id='{hash}';"
            ))?;
            assert!(validate_restored_semantics(connection, 54).is_err());
            Ok(())
        }).expect("restore semantic audit should execute");
    }

    #[test]
    fn restored_semantics_reject_gmail_cross_household_inbox_scope() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                let hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
                connection.execute_batch(&format!(
                    "INSERT INTO households(id,name) VALUES('family','Family'),('other','Other');
                 INSERT INTO gmail_connections
                   (id,household_id,google_account_id,account_email,client_id_fingerprint,
                    label_id,label_name,status,start_history_id,history_id)
                 VALUES('gmail','family','user','user@example.com','{hash}',
                    'Label_1','KakeFlow','CONNECTED','100','100');
                 INSERT INTO gmail_inbox
                   (id,household_id,connection_id,provider_message_id,generation_fingerprint,
                    message_history_id,internal_date_ms,file_name,state)
                 VALUES('{hash}','family','gmail','message-1','{hash}',
                    '101',1784064000000,'message.eml','DISCOVERED');
                 DROP TRIGGER trg_gmail_inbox_identity_immutable;
                 UPDATE gmail_inbox SET household_id='other' WHERE id='{hash}';"
                ))?;
                assert!(validate_restored_semantics(connection, 57).is_err());
                Ok(())
            })
            .expect("restore semantic audit should execute");
    }

    #[test]
    fn migration_47_quarantines_accepted_v1_outbound_lineage() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        Migrations::new(MIGRATIONS[..46].to_vec())
            .to_latest(&mut connection)
            .unwrap();
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('migration-family','Family');
                 INSERT INTO household_members(id,household_id,display_name,status,sort_order)
                   VALUES('migration-member-a','migration-family','A','ACTIVE',99);
                 INSERT INTO family_delivery_connections(
                   household_id,endpoint,remote_principal_id,local_member_id,local_member_name,state)
                   VALUES('migration-family','https://relay.example','principal-a','migration-member-a','A','CONNECTED');
                 INSERT INTO family_delivery_partition_state(
                   household_id,audience_key,visibility,member_id,member_key,dirty)
                   VALUES('migration-family','SHARED','SHARED',NULL,'',0);
                 INSERT INTO family_delivery_deliveries(
                   delivery_id,household_id,audience_key,artifact_id,package_sha256,
                   origin_device_id,visibility,member_id,item_count,excluded_count,
                   package_bytes,state,accepted_at)
                   VALUES('delivery','migration-family','SHARED','artifact',
                     'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                     'device-a','SHARED',NULL,1,0,NULL,'RELAY_ACCEPTED',
                     '2026-07-14T00:00:00Z');",
            )
            .unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0047_family_planning_configuration.sql"
            ))
            .unwrap();
        let state: String = connection
            .query_row(
                "SELECT state FROM family_delivery_outbound_lineage_state
                 WHERE household_id='migration-family' AND audience_key='SHARED'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "LEGACY_UNKNOWN");
        let schema: String = connection
            .query_row(
                "SELECT artifact_schema FROM family_delivery_deliveries WHERE delivery_id='delivery'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(schema, "FAMILY_AUDIENCE_PARTITION_V1");
    }

    #[test]
    fn migration_48_preserves_aliases_and_backfills_card_source_origin() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        Migrations::new(MIGRATIONS[..47].to_vec())
            .to_latest(&mut connection)
            .unwrap();
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('family','Family');
                 INSERT INTO household_members(id,household_id,display_name,status,sort_order)
                 VALUES('member','family','Member','ACTIVE',1);
                 INSERT INTO family_delivery_connections(
                   household_id,endpoint,remote_principal_id,local_member_id,local_member_name,state)
                 VALUES('family','https://relay.example','principal','member','Member','CONNECTED');
                 INSERT INTO family_delivery_partition_state(
                   household_id,audience_key,visibility,member_id,member_key,dirty)
                 VALUES('family','SHARED','SHARED',NULL,'',0);
                 INSERT INTO family_delivery_deliveries(
                   delivery_id,household_id,audience_key,artifact_id,package_sha256,
                   origin_device_id,visibility,member_id,item_count,excluded_count,
                   package_bytes,state,artifact_schema)
                 VALUES('delivery-v2','family','SHARED','artifact-v2',
                   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                   'origin-a','SHARED',NULL,1,0,x'01','FAILED_RETRYABLE',
                   'FAMILY_AUDIENCE_PARTITION_V2');
                 INSERT INTO family_delivery_inbound(
                   artifact_id,household_id,sequence,package_sha256,created_at,
                   origin_device_id,sender_membership_id,sender_member_id,sender_member_name,
                   visibility,member_id,member_key,member_name,byte_size,artifact_schema,state)
                 VALUES('inbound-v2','family',1,
                   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                   '2026-07-14T00:00:00Z','origin-a','membership-a','member','Member',
                   'SHARED',NULL,'',NULL,1,'FAMILY_AUDIENCE_PARTITION_V2','AVAILABLE');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('card','family','Card','LIABILITY','CREDIT_CARD');
                 INSERT INTO import_runs(id,household_id,status) VALUES('local-run','family','POSTED');
                 INSERT INTO source_documents(
                   id,household_id,import_run_id,source_type,original_filename,media_type,
                   byte_size,sha256,storage_path)
                 VALUES('local-doc','family','local-run','OTHER','card.csv','text/csv',1,
                   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','a');
                 INSERT INTO evidence_import_run_aliases(
                   household_id,origin_installation_id,portable_import_run_id,local_import_run_id)
                 VALUES('family','origin-a','portable-run','local-run');
                 INSERT INTO evidence_source_document_aliases(
                   household_id,origin_installation_id,portable_document_id,
                   portable_import_run_id,local_document_id,content_sha256)
                 VALUES('family','origin-a','portable-doc','portable-run','local-doc',
                   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
                 INSERT INTO card_statements(
                   id,household_id,card_account_id,period_start,period_end,statement_amount_jpy)
                 VALUES('statement','family','card','2026-06-01','2026-06-30',1000);
                 INSERT INTO card_statement_portable_source_refs(statement_id,source_document_id)
                 VALUES('statement','portable-doc');",
            )
            .unwrap();
        Migrations::new(MIGRATIONS.to_vec())
            .to_latest(&mut connection)
            .unwrap();
        let source: (String, String, String) = connection
            .query_row(
                "SELECT household_id,origin_installation_id,source_document_id
                 FROM card_statement_portable_source_refs WHERE statement_id='statement'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            source,
            (
                "family".to_owned(),
                "origin-a".to_owned(),
                "portable-doc".to_owned()
            )
        );
        let payload_origin: String = connection
            .query_row(
                "SELECT json_extract(payload_json,'$.sourceOriginInstallationId')
                 FROM sync_card_statement_aggregate_payloads WHERE statement_id='statement'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(payload_origin, "origin-a");
        let preserved_delivery_schema: String = connection
            .query_row(
                "SELECT artifact_schema FROM family_delivery_deliveries
                 WHERE delivery_id='delivery-v2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preserved_delivery_schema, "FAMILY_AUDIENCE_PARTITION_V2");
        let preserved_inbound: (String, Option<Vec<u8>>) = connection
            .query_row(
                "SELECT artifact_schema,pending_package_bytes FROM family_delivery_inbound
                 WHERE artifact_id='inbound-v2'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            preserved_inbound,
            ("FAMILY_AUDIENCE_PARTITION_V2".to_owned(), None)
        );
        connection
            .execute_batch(
                "INSERT INTO family_snapshot_sets(
                   snapshot_set_id,target_household_id,source_installation_id,
                   source_principal_id,publisher_member_id,source_revision,set_sha256,
                   manifest_json,state,record_count,conflict_count,delete_count,
                   source_created_at,schema_version)
                 VALUES('snapshot-v3','family','origin-a','principal','member',1,
                   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
                   '{}','REVIEW_REQUIRED',0,0,0,'2026-07-14T00:00:00Z',3);
                 INSERT INTO family_delivery_deliveries(
                   delivery_id,household_id,audience_key,artifact_id,package_sha256,
                   origin_device_id,visibility,member_id,item_count,excluded_count,
                   package_bytes,state,artifact_schema)
                 VALUES('delivery-v3','family','SHARED','artifact-v3',
                   'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                   'origin-a','SHARED',NULL,1,0,x'02','FAILED_RETRYABLE',
                   'FAMILY_AUDIENCE_PARTITION_V3');
                 INSERT INTO family_delivery_inbound(
                   artifact_id,household_id,sequence,package_sha256,created_at,
                   origin_device_id,sender_membership_id,sender_member_id,sender_member_name,
                   visibility,member_id,member_key,member_name,byte_size,artifact_schema,state,
                   pending_package_bytes)
                 VALUES('inbound-v3','family',2,
                   'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
                   '2026-07-14T00:00:00Z','origin-a','membership-a','member','Member',
                   'SHARED',NULL,'',NULL,1,'FAMILY_AUDIENCE_PARTITION_V3','AVAILABLE',x'03');",
            )
            .unwrap();
        let pending: Vec<u8> = connection
            .query_row(
                "SELECT pending_package_bytes FROM family_delivery_inbound
                 WHERE artifact_id='inbound-v3'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending, vec![3]);
        assert!(connection
            .execute(
                "UPDATE family_delivery_inbound SET pending_package_bytes=x''
                 WHERE artifact_id='inbound-v3'",
                [],
            )
            .is_err());
        assert!(integrity_check(&connection).unwrap());
    }

    #[test]
    fn migration_49_preserves_legacy_delivery_digests_and_enforces_transport_groups() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        Migrations::new(MIGRATIONS[..48].to_vec())
            .to_latest(&mut connection)
            .unwrap();
        let inner = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        connection
            .execute_batch(&format!(
                "INSERT INTO households(id,name) VALUES('family-49','Family');
                 INSERT INTO household_members(id,household_id,display_name,status,sort_order)
                   VALUES('member-49','family-49','Member','ACTIVE',1);
                 INSERT INTO family_delivery_connections(
                   household_id,endpoint,remote_principal_id,local_member_id,local_member_name,state)
                   VALUES('family-49','https://relay.example','principal','member-49','Member','CONNECTED');
                 INSERT INTO family_delivery_partition_state(
                   household_id,audience_key,visibility,member_id,member_key,dirty)
                   VALUES('family-49','SHARED','SHARED',NULL,'',0);
                 INSERT INTO family_delivery_deliveries(
                   delivery_id,household_id,audience_key,artifact_id,package_sha256,
                   origin_device_id,visibility,member_id,item_count,excluded_count,
                   package_bytes,state,artifact_schema)
                   VALUES('delivery-49','family-49','SHARED','artifact-49','{inner}',
                   'origin-local','SHARED',NULL,1,0,x'01','FAILED_RETRYABLE',
                   'FAMILY_AUDIENCE_PARTITION_V3');
                 INSERT INTO family_delivery_inbound(
                   artifact_id,household_id,sequence,package_sha256,created_at,
                   origin_device_id,sender_membership_id,sender_member_id,sender_member_name,
                   visibility,member_id,member_key,member_name,byte_size,artifact_schema,state)
                   VALUES('inbound-49','family-49',1,'{inner}','2026-07-14T00:00:00Z',
                   'origin-remote','membership','member-49','Member','SHARED',NULL,'',NULL,1,
                   'FAMILY_AUDIENCE_PARTITION_V3','AVAILABLE');"
            ))
            .unwrap();
        Migrations::new(MIGRATIONS.to_vec())
            .to_latest(&mut connection)
            .unwrap();
        let legacy: (String, Option<String>, Option<String>, Option<String>) = connection
            .query_row(
                "SELECT package_sha256,envelope_schema,transport_sha256,recipient_set_digest
                 FROM family_delivery_inbound WHERE artifact_id='inbound-49'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(legacy, (inner.into(), None, None, None));
        assert!(connection
            .execute(
                "UPDATE family_delivery_inbound SET envelope_schema='KFE1'
                 WHERE artifact_id='inbound-49'",
                [],
            )
            .is_err());
        let transport = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let recipients = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
        connection
            .execute(
                "UPDATE family_delivery_inbound SET envelope_schema='KFE1',
                   transport_sha256=?1,recipient_set_digest=?2 WHERE artifact_id='inbound-49'",
                [transport, recipients],
            )
            .unwrap();
    }

    #[test]
    fn migration_thirty_six_preserves_v1_packages_and_captures_card_aggregates() {
        const DIGEST: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        configure_connection(&connection).expect("connection configuration");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_version(&mut connection, 35)
            .expect("schema thirty five");
        connection
            .execute_batch(&format!(
                "INSERT INTO households(id,name) VALUES('family','Family');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('card','family','Card','LIABILITY','CREDIT_CARD'),
                       ('bank','family','Bank','ASSET','BANK');
                 INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status)
                 VALUES('purchase-1','family','2026-07-01','CARD_PURCHASE','DRAFT'),
                       ('purchase-2','family','2026-07-02','CARD_PURCHASE','DRAFT'),
                       ('payment-tx','family','2026-07-27','CARD_PAYMENT','DRAFT');
                 INSERT INTO card_statements(
                   id,household_id,card_account_id,period_start,period_end,payment_due_on,
                   statement_amount_jpy,reconciliation_status)
                 VALUES('statement','family','card','2026-06-01','2026-06-30','2026-07-27',
                        3000,'UNMATCHED');
                 INSERT INTO card_statement_transactions(
                   statement_id,transaction_id,statement_line_number,billed_amount_jpy)
                 VALUES('statement','purchase-2',2,2000),('statement','purchase-1',1,1000);
                 INSERT INTO card_payments(
                   id,household_id,statement_id,bank_transaction_id,card_account_id,
                   payment_amount_jpy,payment_on,match_score_bps,reconciliation_status)
                 VALUES('payment','family','statement','payment-tx','card',3000,
                        '2026-07-27',9000,'POSSIBLE_MATCH');
                 INSERT INTO change_packages(
                   package_id,target_household_id,source_installation_id,source_principal_id,
                   source_revision,snapshot_sha256,manifest_json,package_sha256,state,
                   record_count,create_count,source_created_at,staged_at,reviewed_at,updated_at)
                 VALUES('v1-package','family','device','principal',1,'{DIGEST}','{{}}','{DIGEST}',
                        'REJECTED',1,1,'2026-07-13T00:00:00Z',
                        '2026-07-13T00:00:00Z','2026-07-13T00:00:01Z',
                        '2026-07-13T00:00:01Z');
                 INSERT INTO change_package_records(
                   package_id,record_order,entity_kind,entity_id,operation,
                   canonical_payload_json,payload_sha256,review_state,resolution)
                 VALUES('v1-package',0,'ACCOUNT','bank','UPSERT',
                        '{{\"recordKind\":\"ACCOUNT\",\"id\":\"bank\"}}','{DIGEST}',
                        'CREATE','APPLY_INCOMING');"
            ))
            .expect("schema-35 fixture");

        migrations
            .to_version(&mut connection, 36)
            .expect("schema thirty six");

        assert_eq!(
            connection
                .query_row(
                    "SELECT schema_version FROM change_packages WHERE package_id='v1-package'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT entity_kind FROM change_package_records
                     WHERE package_id='v1-package' AND record_order=0",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "ACCOUNT"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sync_local_change_capture
                     WHERE entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT')",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT json_extract(payload_json,'$.lines[0].transactionId')
                     FROM sync_card_statement_aggregate_payloads WHERE statement_id='statement'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "purchase-1"
        );

        connection
            .execute(
                "INSERT INTO change_packages(
                   package_id,schema_version,target_household_id,source_installation_id,
                   source_principal_id,source_revision,snapshot_sha256,manifest_json,
                   package_sha256,state,record_count,create_count,source_created_at)
                 VALUES('v2-package',2,'family','device-2','principal',1,?1,'{}',?1,
                        'STAGED',1,1,'2026-07-13T00:00:00Z')",
                [DIGEST],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO change_package_records(
                   package_id,record_order,entity_kind,entity_id,operation,
                   canonical_payload_json,payload_sha256,review_state,resolution)
                 VALUES('v2-package',0,'CARD_STATEMENT','statement','UPSERT',
                        '{\"recordKind\":\"CARD_STATEMENT\",\"id\":\"statement\"}',?1,
                        'CREATE','APPLY_INCOMING')",
                [DIGEST],
            )
            .unwrap();
        assert!(connection
            .execute(
                "UPDATE change_packages SET schema_version=1 WHERE package_id='v2-package'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "INSERT INTO change_package_records(
                   package_id,record_order,entity_kind,entity_id,operation,
                   canonical_payload_json,payload_sha256,review_state,resolution)
                 VALUES('v1-package',1,'CARD_PAYMENT','payment','UPSERT',
                        '{\"recordKind\":\"CARD_PAYMENT\",\"id\":\"payment\"}',?1,
                        'CREATE','APPLY_INCOMING')",
                [DIGEST],
            )
            .is_err());

        connection
            .execute(
                "INSERT INTO card_statement_portable_source_refs(statement_id,source_document_id)
                 VALUES('statement','portable-document')",
                [],
            )
            .unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT json_extract(payload_json,'$.sourceDocumentId')
                     FROM sync_card_statement_aggregate_payloads WHERE statement_id='statement'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "portable-document"
        );
        connection
            .execute_batch(&format!(
                "INSERT INTO import_runs(id,household_id,status) VALUES('run','family','POSTED');
                 INSERT INTO source_documents(
                   id,household_id,import_run_id,source_type,original_filename,media_type,
                   byte_size,sha256,storage_path)
                 VALUES('actual-document','family','run','MANUAL_UPLOAD','card.csv','text/csv',
                        1,'{DIGEST}','documents/card.csv');
                 UPDATE card_statements SET source_document_id='actual-document'
                 WHERE id='statement';"
            ))
            .unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT json_extract(payload_json,'$.sourceDocumentId')
                     FROM sync_card_statement_aggregate_payloads WHERE statement_id='statement'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "actual-document"
        );
        connection
            .execute(
                "UPDATE card_statement_transactions SET billed_amount_jpy=1100
                 WHERE statement_id='statement' AND transaction_id='purchase-1'",
                [],
            )
            .unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT json_extract(payload_json,'$.lines[0].billedAmountJpy')
                     FROM sync_local_change_capture
                     WHERE entity_kind='CARD_STATEMENT' AND entity_id='statement'
                     ORDER BY capture_sequence DESC LIMIT 1",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1100
        );
        connection
            .execute(
                "UPDATE card_payments SET match_score_bps=9500 WHERE id='payment'",
                [],
            )
            .unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT json_extract(payload_json,'$.matchScoreBps')
                     FROM sync_local_change_capture
                     WHERE entity_kind='CARD_PAYMENT' AND entity_id='payment'
                     ORDER BY capture_sequence DESC LIMIT 1",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            9500
        );
        connection
            .execute("DELETE FROM card_payments WHERE id='payment'", [])
            .unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT operation FROM sync_local_change_capture
                     WHERE entity_kind='CARD_PAYMENT' AND entity_id='payment'
                     ORDER BY capture_sequence DESC LIMIT 1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "DELETE"
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
        assert!(integrity_check(&connection).unwrap());
    }

    #[test]
    fn migration_thirty_eight_guards_v3_and_captures_portfolio_aggregates() {
        const DIGEST: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(&format!(
                    "INSERT INTO households(id,name) VALUES('family','Family');
                     INSERT INTO sync_devices(id,display_name,platform)
                     VALUES('device-b','Device B','MACOS');
                     INSERT INTO sync_principals(id,display_name)
                     VALUES('principal-b','Principal B');
                     INSERT INTO household_principal_bindings(household_id,principal_id)
                     VALUES('family','principal-b');
                     INSERT INTO local_sync_contexts(household_id,device_id,principal_id)
                     VALUES('family','device-b','principal-b');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                     VALUES('broker','family','Broker','ASSET','SECURITIES');
                     INSERT INTO import_runs(id,household_id,status)
                     VALUES('run','family','POSTED');
                     INSERT INTO source_documents(
                       id,household_id,import_run_id,source_type,original_filename,media_type,
                       byte_size,sha256,storage_path)
                     VALUES('local-document','family','run','MANUAL_UPLOAD','assets.csv',
                            'text/csv',1,'{DIGEST}','documents/assets.csv');
                     INSERT INTO source_records(
                       id,source_document_id,row_number,record_hash,raw_payload_json)
                     VALUES('row-1','local-document',1,'{DIGEST}','{{}}');
                     INSERT INTO investment_portable_source_refs(
                       entity_kind,entity_id,household_id,origin_installation_id,
                       source_document_id,source_row)
                     VALUES('PORTFOLIO_SNAPSHOT','snapshot','family','device-a',
                            'origin-document',NULL);
                     INSERT INTO portfolio_snapshots(
                       id,household_id,account_id,source_document_id,as_of,
                       market_value_jpy,cash_value_jpy)
                     VALUES('snapshot','family','broker','local-document','2026-07-13',1000,100);
                     INSERT INTO portfolio_asset_classes(
                       id,portfolio_snapshot_id,name,market_value_jpy,source_row)
                     VALUES('class','snapshot','Listed stocks',900,1);
                     INSERT INTO investment_fx_rates(
                       id,household_id,rate_date,base_currency,quote_currency,rate,
                       source_kind,provider,source_document_id,source_row,observed_at)
                     VALUES('manual-fx','family','2026-07-13','USD','JPY',150,
                            'MANUAL','User',NULL,NULL,'2026-07-13T00:00:00Z');"
                ))?;

                assert_eq!(
                    connection.query_row(
                        "SELECT json_extract(payload_json,'$.sourceDocumentId')
                         FROM sync_portfolio_snapshot_payloads WHERE snapshot_id='snapshot'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "origin-document"
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT json_extract(payload_json,'$.sourceOriginInstallationId')
                         FROM sync_portfolio_snapshot_payloads WHERE snapshot_id='snapshot'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "device-a"
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT json_extract(payload_json,'$.sourceOriginInstallationId')
                         FROM sync_investment_fx_rate_payloads WHERE rate_id='manual-fx'",
                        [],
                        |row| row.get::<_, Option<String>>(0),
                    )?,
                    None
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT json_extract(payload_json,'$.assetClasses[0].marketValueJpy')
                         FROM sync_local_change_capture
                         WHERE entity_kind='PORTFOLIO_SNAPSHOT' AND entity_id='snapshot'
                         ORDER BY capture_sequence DESC LIMIT 1",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    900
                );
                assert!(connection
                    .execute(
                        "UPDATE investment_portable_source_refs
                         SET source_document_id='different'
                         WHERE entity_kind='PORTFOLIO_SNAPSHOT' AND entity_id='snapshot'",
                        [],
                    )
                    .is_err());

                connection.execute(
                    "INSERT INTO change_packages(
                       package_id,schema_version,target_household_id,source_installation_id,
                       source_principal_id,source_revision,snapshot_sha256,manifest_json,
                       package_sha256,state,record_count,create_count,source_created_at)
                     VALUES('v2-package',2,'family','device','principal',1,?1,'{}',?1,
                            'STAGED',1,1,'2026-07-13T00:00:00Z')",
                    [DIGEST],
                )?;
                assert!(connection
                    .execute(
                        "INSERT INTO change_package_records(
                           package_id,record_order,entity_kind,entity_id,operation,
                           canonical_payload_json,payload_sha256,review_state,resolution)
                         VALUES('v2-package',0,'PORTFOLIO_SNAPSHOT','snapshot','UPSERT',
                                '{\"recordKind\":\"PORTFOLIO_SNAPSHOT\",\"id\":\"snapshot\"}',?1,
                                'CREATE','APPLY_INCOMING')",
                        [DIGEST],
                    )
                    .is_err());
                connection.execute(
                    "UPDATE change_packages SET schema_version=3 WHERE package_id='v2-package'",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO change_package_records(
                       package_id,record_order,entity_kind,entity_id,operation,
                       canonical_payload_json,payload_sha256,review_state,resolution)
                     VALUES('v2-package',0,'PORTFOLIO_SNAPSHOT','snapshot','UPSERT',
                            '{\"recordKind\":\"PORTFOLIO_SNAPSHOT\",\"id\":\"snapshot\"}',?1,
                            'CREATE','APPLY_INCOMING')",
                    [DIGEST],
                )?;
                assert!(connection
                    .execute(
                        "UPDATE change_packages SET schema_version=2
                         WHERE package_id='v2-package'",
                        [],
                    )
                    .is_err());
                assert!(integrity_check(connection)?);
                Ok(())
            })
            .expect("schema 38 investment fixture should remain valid");
    }

    #[test]
    fn change_package_schema_guards_capture_and_preserves_portable_source_links() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('family','Family');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                     VALUES('bank','family','Bank','ASSET','BANK');
                     INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status)
                     VALUES('tx','family','2026-07-13','ADJUSTMENT','DRAFT');",
                )?;
                let before: i64 = connection.query_row(
                    "SELECT count(*) FROM sync_local_change_capture",
                    [],
                    |row| row.get(0),
                )?;
                connection.execute(
                    "INSERT INTO sync_apply_guard(household_id,package_id)
                     VALUES('family','package-1')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO transaction_portable_source_links(
                       transaction_id,source_record_id,candidate_id)
                     VALUES('tx','source-1','candidate-1')",
                    [],
                )?;
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM sync_local_change_capture",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    before
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT json_extract(payload_json,'$.sourceLinks[0].sourceRecordId')
                         FROM sync_transaction_aggregate_payloads WHERE transaction_id='tx'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "source-1"
                );
                connection.execute(
                    "DELETE FROM sync_apply_guard WHERE household_id='family'",
                    [],
                )?;
                connection.execute(
                    "UPDATE transaction_portable_source_links SET candidate_id='candidate-2'
                     WHERE transaction_id='tx' AND source_record_id='source-1'",
                    [],
                )?;
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM sync_local_change_capture",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    before + 1
                );
                assert!(integrity_check(connection)?);
                Ok(())
            })
            .expect("package schema should remain valid");
    }

    #[test]
    fn change_package_lineage_is_unique_and_household_delete_cascades() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                const DIGEST_A: &str =
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
                const DIGEST_B: &str =
                    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('family','Family');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                     VALUES('bank','family','Bank','ASSET','BANK');
                     INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status)
                     VALUES('tx','family','2026-07-13','ADJUSTMENT','DRAFT');
                     INSERT INTO transaction_portable_source_links(transaction_id,source_record_id)
                     VALUES('tx','source-1');",
                )?;
                connection.execute(
                    "INSERT INTO change_packages(
                       package_id,target_household_id,source_installation_id,source_revision,
                       source_principal_id,snapshot_sha256,manifest_json,package_sha256,
                       state,record_count,create_count,source_created_at,
                       staged_at,reviewed_at,applied_at,updated_at)
                     VALUES('package-1','family','source-device',1,'source-principal',?1,'{}',?1,
                       'APPLIED',1,1,'2026-07-13T00:00:00Z',
                       '2026-07-13T00:00:00Z','2026-07-13T01:00:00Z',
                       '2026-07-13T01:00:00Z','2026-07-13T01:00:00Z')",
                    [DIGEST_A],
                )?;
                connection.execute(
                    "INSERT INTO change_package_records(
                       package_id,record_order,entity_kind,entity_id,operation,
                       canonical_payload_json,payload_sha256,review_state,resolution)
                     VALUES('package-1',0,'ACCOUNT','bank','UPSERT',
                       '{\"recordKind\":\"ACCOUNT\",\"id\":\"bank\"}',?1,'CREATE','APPLY_INCOMING')",
                    [DIGEST_A],
                )?;
                connection.execute(
                    "INSERT INTO applied_change_packages(
                       package_id,source_installation_id,household_id,source_revision,snapshot_sha256)
                     VALUES('package-1','source-device','family',1,?1)",
                    [DIGEST_A],
                )?;
                connection.execute(
                    "INSERT INTO sync_replica_entity_heads(
                       household_id,entity_kind,entity_id,source_installation_id,package_id,
                       source_revision,operation,payload_sha256)
                     VALUES('family','ACCOUNT','bank','source-device','package-1',1,'UPSERT',?1)",
                    [DIGEST_A],
                )?;

                connection.execute(
                    "INSERT INTO change_packages(
                       package_id,target_household_id,source_installation_id,source_revision,
                       source_principal_id,snapshot_sha256,manifest_json,package_sha256,
                       state,record_count,source_created_at,
                       staged_at,reviewed_at,applied_at,updated_at)
                     VALUES('package-equivocation','family','source-device',1,'source-principal',?1,
                       '{}',?1,'APPLIED',0,'2026-07-13T00:00:00Z',
                       '2026-07-13T00:00:00Z','2026-07-13T01:00:00Z',
                       '2026-07-13T01:00:00Z','2026-07-13T01:00:00Z')",
                    [DIGEST_B],
                )?;
                assert!(connection.execute(
                    "INSERT INTO applied_change_packages(
                       package_id,source_installation_id,household_id,source_revision,snapshot_sha256)
                     VALUES('package-equivocation','source-device','family',1,?1)",
                    [DIGEST_B],
                ).is_err());

                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('guard-family','Guard family');
                     INSERT INTO sync_apply_guard(household_id,package_id)
                     VALUES('guard-family','package-guard');
                     DELETE FROM households WHERE id='guard-family';",
                )?;
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM sync_apply_guard WHERE household_id='guard-family'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    0
                );
                connection.execute("DELETE FROM households WHERE id='family'", [])?;
                for table in [
                    "change_packages",
                    "change_package_records",
                    "applied_change_packages",
                    "sync_replica_entity_heads",
                    "sync_apply_guard",
                    "transaction_portable_source_links",
                ] {
                    let sql = format!("SELECT count(*) FROM {table}");
                    assert_eq!(
                        connection.query_row(&sql, [], |row| row.get::<_, i64>(0))?,
                        0,
                        "{table} should cascade or clean up"
                    );
                }
                assert!(integrity_check(connection)?);
                Ok(())
            })
            .expect("package lineage should remain valid");
    }

    #[test]
    fn restored_semantics_reject_invalid_dashboard_preferences() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES ('family','Family')",
                    [],
                )?;
                connection.execute_batch(
                    "PRAGMA ignore_check_constraints=ON;
                     INSERT INTO dashboard_preferences(
                       household_id,dashboard_template,theme,density,created_at,updated_at)
                     VALUES('family','UNKNOWN','SYSTEM','COMFORTABLE',
                       '2026-07-13T00:00:00.000Z','2026-07-13T00:00:00.000Z');
                     PRAGMA ignore_check_constraints=OFF;",
                )?;
                assert!(validate_restored_semantics(connection, 29).is_err());
                connection.execute("DELETE FROM dashboard_preferences", [])?;
                connection.execute_batch(
                    "PRAGMA ignore_check_constraints=ON;
                     INSERT INTO dashboard_preferences(
                       household_id,dashboard_template,theme,density,created_at,updated_at)
                     VALUES('family','FINANCIAL_OVERVIEW','SYSTEM','COMFORTABLE',
                       'not-a-time','2026-07-13T00:00:00.000Z');
                     PRAGMA ignore_check_constraints=OFF;",
                )?;
                assert!(validate_restored_semantics(connection, 29).is_err());
                Ok(())
            })
            .expect("database should remain readable");
    }

    #[test]
    fn restored_semantics_reject_invalid_dashboard_template_layouts() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES ('family','Family')",
                    [],
                )?;
                connection.execute_batch(
                    "PRAGMA ignore_check_constraints=ON;
                     INSERT INTO dashboard_template_layouts(
                       household_id,dashboard_template,widget_order,hidden_widgets)
                     VALUES('family','CASH_FLOW',
                       '[\"TREND\",\"RECENT\",\"CARDS\",\"SPENDING\"]',
                       '[\"SPENDING\"]');
                     PRAGMA ignore_check_constraints=OFF;",
                )?;
                assert!(validate_restored_semantics(connection, 40).is_err());
                Ok(())
            })
            .expect("database should remain readable");
    }

    #[test]
    fn restored_semantics_require_complete_dashboard_layout_graph_at_schema_42() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES ('family','Family')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO dashboard_preferences(
                       household_id,dashboard_template,theme,density)
                     VALUES('family','FINANCIAL_OVERVIEW','SYSTEM','COMFORTABLE')",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 42).is_err());
                connection.execute_batch(
                    "INSERT INTO dashboard_template_layouts(
                       household_id,dashboard_template,widget_order,hidden_widgets)
                     VALUES
                      ('family','FINANCIAL_OVERVIEW','[\"TREND\",\"SPENDING\",\"RECENT\",\"CARDS\"]','[]'),
                      ('family','HOUSEHOLD_LEDGER','[\"SPENDING\",\"RECENT\",\"TREND\",\"CARDS\"]','[]'),
                      ('family','ASSETS_LIABILITIES','[\"TREND\",\"SPENDING\",\"CARDS\",\"RECENT\"]','[]'),
                      ('family','CARD_RECONCILIATION','[\"CARDS\",\"RECENT\",\"TREND\",\"SPENDING\"]','[]'),
                      ('family','CASH_FLOW','[\"TREND\",\"RECENT\",\"CARDS\",\"SPENDING\"]','[]');",
                )?;
                assert!(validate_restored_semantics(connection, 42).is_ok());
                connection.execute(
                    "DELETE FROM dashboard_preferences WHERE household_id='family'",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 42).is_err());
                Ok(())
            })
            .expect("database should remain readable");
    }

    #[test]
    fn migration_42_preserves_legacy_package_rows_and_accepts_schema_four() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        configure_connection(&connection).expect("connection configuration");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_version(&mut connection, 41)
            .expect("schema forty one");
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('f1','One'),('f2','Two'),('f3','Three');
                 INSERT INTO change_packages(
                   package_id,schema_version,target_household_id,source_installation_id,
                   source_principal_id,source_revision,snapshot_sha256,manifest_json,
                   package_sha256,state,record_count,unchanged_count,source_created_at,
                   staged_at,reviewed_at,applied_at,updated_at)
                 VALUES
                  ('p1',1,'f1','device', 'principal',1,
                   '0000000000000000000000000000000000000000000000000000000000000000','{}',
                   '1111111111111111111111111111111111111111111111111111111111111111',
                   'REJECTED',1,1,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z',NULL,'2026-07-01T00:00:00.000Z'),
                  ('p2',2,'f2','device', 'principal',2,
                   '2222222222222222222222222222222222222222222222222222222222222222','{}',
                   '3333333333333333333333333333333333333333333333333333333333333333',
                   'APPLIED',1,1,'2026-07-02T00:00:00.000Z','2026-07-02T00:00:00.000Z','2026-07-02T00:00:00.000Z','2026-07-02T00:00:00.000Z','2026-07-02T00:00:00.000Z'),
                  ('p3',3,'f3','device', 'principal',3,
                   '4444444444444444444444444444444444444444444444444444444444444444','{}',
                   '5555555555555555555555555555555555555555555555555555555555555555',
                   'REJECTED',1,1,'2026-07-03T00:00:00.000Z','2026-07-03T00:00:00.000Z','2026-07-03T00:00:00.000Z',NULL,'2026-07-03T00:00:00.000Z');
                 INSERT INTO change_package_records(
                   package_id,record_order,entity_kind,entity_id,operation,
                   canonical_payload_json,payload_sha256,review_state,resolution,
                   current_payload_sha256)
                 VALUES
                  ('p1',0,'DASHBOARD_PREFERENCES','f1','UPSERT',
                   '{\"recordKind\":\"DASHBOARD_PREFERENCES\",\"householdId\":\"f1\"}',
                   '6666666666666666666666666666666666666666666666666666666666666666','UNCHANGED','SKIP',
                   '6666666666666666666666666666666666666666666666666666666666666666'),
                  ('p2',0,'DASHBOARD_PREFERENCES','f2','UPSERT',
                   '{\"recordKind\":\"DASHBOARD_PREFERENCES\",\"householdId\":\"f2\"}',
                   '7777777777777777777777777777777777777777777777777777777777777777','UNCHANGED','SKIP',
                   '7777777777777777777777777777777777777777777777777777777777777777'),
                  ('p3',0,'DASHBOARD_PREFERENCES','f3','UPSERT',
                   '{\"recordKind\":\"DASHBOARD_PREFERENCES\",\"householdId\":\"f3\"}',
                   '8888888888888888888888888888888888888888888888888888888888888888','UNCHANGED','SKIP',
                   '8888888888888888888888888888888888888888888888888888888888888888');
                 INSERT INTO applied_change_packages(
                   package_id,source_installation_id,household_id,source_revision,
                   snapshot_sha256,applied_at)
                 VALUES('p2','device','f2',2,
                   '2222222222222222222222222222222222222222222222222222222222222222',
                   '2026-07-02T00:00:00.000Z');
                 INSERT INTO sync_replica_entity_heads(
                   household_id,entity_kind,entity_id,source_installation_id,package_id,
                   source_revision,operation,payload_sha256)
                 VALUES
                  ('f1','DASHBOARD_PREFERENCES','f1','device','p1',1,'UPSERT','6666666666666666666666666666666666666666666666666666666666666666'),
                  ('f2','DASHBOARD_PREFERENCES','f2','device','p2',2,'UPSERT','7777777777777777777777777777777777777777777777777777777777777777'),
                  ('f3','DASHBOARD_PREFERENCES','f3','device','p3',3,'UPSERT','8888888888888888888888888888888888888888888888888888888888888888');",
            )
            .expect("legacy lineage");
        migrations
            .to_latest(&mut connection)
            .expect("schema forty two");
        assert_eq!(
            connection
                .query_row(
                    "SELECT group_concat(schema_version,'') FROM
                     (SELECT schema_version FROM change_packages ORDER BY package_id)",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "123"
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM change_package_records", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            3
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM applied_change_packages", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sync_replica_entity_heads",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            3
        );
        connection
            .execute(
                "INSERT INTO change_packages(
                   package_id,schema_version,target_household_id,source_installation_id,
                   source_principal_id,source_revision,snapshot_sha256,manifest_json,
                   package_sha256,state,record_count,source_created_at,staged_at,reviewed_at)
                 VALUES('p4',4,'f1','other','principal',4,
                   '9999999999999999999999999999999999999999999999999999999999999999','{}',
                   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                   'REJECTED',0,'2026-07-04T00:00:00.000Z','2026-07-04T00:00:00.000Z','2026-07-04T00:00:00.000Z')",
                [],
            )
            .expect("schema four accepted");
    }

    #[test]
    fn migration_63_preserves_schema_four_lineage_and_gates_recurring_aggregates() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        configure_connection(&connection).expect("connection configuration");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_version(&mut connection, 62)
            .expect("schema sixty two");
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('f1','One'),('f2','Two'),('f3','Three');
                 INSERT INTO change_packages(
                   package_id,schema_version,target_household_id,source_installation_id,
                   source_principal_id,source_revision,snapshot_sha256,manifest_json,
                   package_sha256,state,record_count,unchanged_count,source_created_at,
                   staged_at,reviewed_at,applied_at,updated_at)
                 VALUES('legacy-v4',4,'f1','device','principal',1,
                   '0000000000000000000000000000000000000000000000000000000000000000','{}',
                   '1111111111111111111111111111111111111111111111111111111111111111',
                   'APPLIED',1,1,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z',
                   '2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z');
                 INSERT INTO change_package_records(
                   package_id,record_order,entity_kind,entity_id,operation,
                   canonical_payload_json,payload_sha256,review_state,resolution,
                   current_payload_sha256)
                 VALUES('legacy-v4',0,'HOUSEHOLD','f1','UPSERT',
                   '{\"id\":\"f1\",\"recordKind\":\"HOUSEHOLD\"}',
                   '2222222222222222222222222222222222222222222222222222222222222222',
                   'UNCHANGED','SKIP',
                   '2222222222222222222222222222222222222222222222222222222222222222');
                 INSERT INTO applied_change_packages(
                   package_id,source_installation_id,household_id,source_revision,
                   snapshot_sha256,applied_at)
                 VALUES('legacy-v4','device','f1',1,
                   '0000000000000000000000000000000000000000000000000000000000000000',
                   '2026-07-01T00:00:00.000Z');
                 INSERT INTO sync_replica_entity_heads(
                   household_id,entity_kind,entity_id,source_installation_id,package_id,
                   source_revision,operation,payload_sha256)
                 VALUES('f1','HOUSEHOLD','f1','device','legacy-v4',1,'UPSERT',
                   '2222222222222222222222222222222222222222222222222222222222222222');",
            )
            .expect("legacy schema-four lineage");

        migrations
            .to_version(&mut connection, 63)
            .expect("schema sixty three");
        assert_eq!(
            connection
                .query_row(
                    "SELECT
                       (SELECT count(*) FROM change_packages WHERE package_id='legacy-v4'),
                       (SELECT count(*) FROM change_package_records WHERE package_id='legacy-v4'),
                       (SELECT count(*) FROM applied_change_packages WHERE package_id='legacy-v4'),
                       (SELECT count(*) FROM sync_replica_entity_heads WHERE package_id='legacy-v4')",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?,
                              row.get::<_, i64>(2)?, row.get::<_, i64>(3)?)),
                )
                .unwrap(),
            (1, 1, 1, 1)
        );

        let insert_package = |connection: &Connection, id: &str, household: &str, schema: i64| {
            connection.execute(
                "INSERT INTO change_packages(
                   package_id,schema_version,target_household_id,source_installation_id,
                   source_principal_id,source_revision,snapshot_sha256,manifest_json,
                   package_sha256,state,record_count,unchanged_count,source_created_at,
                   staged_at,reviewed_at,updated_at)
                 VALUES(?1,?2,?3,'other','principal',?2,
                   '3333333333333333333333333333333333333333333333333333333333333333','{}',
                   '4444444444444444444444444444444444444444444444444444444444444444',
                   'REJECTED',1,1,'2026-07-02T00:00:00.000Z','2026-07-02T00:00:00.000Z',
                   '2026-07-02T00:00:00.000Z','2026-07-02T00:00:00.000Z')",
                rusqlite::params![id, schema, household],
            )
        };
        insert_package(&connection, "new-v5", "f2", 5).expect("schema five package");
        insert_package(&connection, "old-v4", "f3", 4).expect("schema four package");
        let payload = "{\"recordKind\":\"RECURRING_SERIES_PREFERENCES\",\"householdId\":\"f2\",\"preferences\":[]}";
        connection
            .execute(
                "INSERT INTO change_package_records(
                   package_id,record_order,entity_kind,entity_id,operation,
                   canonical_payload_json,payload_sha256,review_state,resolution,
                   current_payload_sha256)
                 VALUES('new-v5',0,'RECURRING_SERIES_PREFERENCES','f2','UPSERT',?1,
                   '5555555555555555555555555555555555555555555555555555555555555555',
                   'UNCHANGED','SKIP',
                   '5555555555555555555555555555555555555555555555555555555555555555')",
                [payload],
            )
            .expect("schema five recurring aggregate");
        assert!(connection
            .execute(
                "INSERT INTO change_package_records(
                   package_id,record_order,entity_kind,entity_id,operation,
                   canonical_payload_json,payload_sha256,review_state,resolution,
                   current_payload_sha256)
                 VALUES('old-v4',0,'RECURRING_SERIES_PREFERENCES','f3','UPSERT',
                   '{\"recordKind\":\"RECURRING_SERIES_PREFERENCES\",\"householdId\":\"f3\",\"preferences\":[]}',
                   '6666666666666666666666666666666666666666666666666666666666666666',
                   'UNCHANGED','SKIP',
                   '6666666666666666666666666666666666666666666666666666666666666666')",
                [],
            )
            .is_err());
    }

    #[test]
    fn migration_64_preserves_v3_delivery_and_gates_family_recurring_preferences() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        configure_connection(&connection).expect("connection configuration");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_version(&mut connection, 63)
            .expect("schema sixty three");
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('family-64','Family');
                 INSERT INTO household_members(id,household_id,display_name,status,sort_order)
                 VALUES('member-64','family-64','Member','ACTIVE',1);
                 INSERT INTO family_delivery_connections(
                   household_id,endpoint,remote_principal_id,local_member_id,local_member_name,state)
                 VALUES('family-64','https://relay.example','principal','member-64','Member','CONNECTED');
                 INSERT INTO family_delivery_partition_state(
                   household_id,audience_key,visibility,member_id,member_key,dirty)
                 VALUES
                   ('family-64','SHARED','SHARED',NULL,'',0),
                   ('family-64','PERSONAL:member-64','PERSONAL','member-64','member-64',0);
                 INSERT INTO family_snapshot_sets(
                   snapshot_set_id,target_household_id,source_installation_id,
                   source_principal_id,publisher_member_id,source_revision,set_sha256,
                   manifest_json,state,record_count,conflict_count,delete_count,
                   source_created_at,reviewed_at,schema_version)
                 VALUES('legacy-v3','family-64','origin-v3','principal','member-64',1,
                   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                   '{}','REJECTED',0,0,0,'2026-07-14T00:00:00Z','2026-07-14T00:00:00Z',3);
                 INSERT INTO family_snapshot_partitions(
                   snapshot_set_id,partition_order,visibility,member_id,member_key,package_id,
                   snapshot_sha256,package_sha256,authoritative_kinds_json,record_count)
                 VALUES('legacy-v3',0,'SHARED',NULL,'','partition-v3-64',
                   '3434343434343434343434343434343434343434343434343434343434343434',
                   '3535353535353535353535353535353535353535353535353535353535353535',
                   '[]',0);
                 INSERT INTO family_delivery_deliveries(
                   delivery_id,household_id,audience_key,artifact_id,package_sha256,
                   origin_device_id,visibility,member_id,item_count,excluded_count,
                   package_bytes,state,artifact_schema)
                 VALUES('delivery-v3-64','family-64','SHARED','artifact-v3-64',
                   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                   'origin-v3','SHARED',NULL,0,0,x'4b464633','FAILED_RETRYABLE',
                   'FAMILY_AUDIENCE_PARTITION_V3');
                 INSERT INTO family_delivery_inbound(
                   artifact_id,household_id,sequence,package_sha256,created_at,
                   origin_device_id,sender_membership_id,sender_member_id,sender_member_name,
                   visibility,member_id,member_key,member_name,byte_size,artifact_schema,state,
                   pending_package_bytes)
                 VALUES('inbound-v3-64','family-64',1,
                   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                   '2026-07-14T00:00:00Z','origin-v3','membership-v3','member-64','Member',
                   'SHARED',NULL,'',NULL,4,'FAMILY_AUDIENCE_PARTITION_V3','AVAILABLE',x'4b464633');",
            )
            .expect("legacy family v3 state");

        migrations
            .to_version(&mut connection, 64)
            .expect("schema sixty four");
        assert_eq!(
            connection
                .query_row(
                    "SELECT
                       (SELECT schema_version FROM family_snapshot_sets WHERE snapshot_set_id='legacy-v3'),
                       (SELECT artifact_schema FROM family_delivery_deliveries WHERE delivery_id='delivery-v3-64'),
                       (SELECT hex(pending_package_bytes) FROM family_delivery_inbound WHERE artifact_id='inbound-v3-64')",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
                )
                .unwrap(),
            (3, "FAMILY_AUDIENCE_PARTITION_V3".to_owned(), "4B464633".to_owned())
        );

        connection
            .execute_batch(
                "INSERT INTO family_snapshot_sets(
                   snapshot_set_id,target_household_id,source_installation_id,
                   source_principal_id,publisher_member_id,source_revision,set_sha256,
                   manifest_json,state,record_count,conflict_count,delete_count,
                   source_created_at,schema_version)
                 VALUES('current-v4','family-64','origin-v4','principal','member-64',2,
                   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
                   '{}','REVIEW_REQUIRED',1,0,0,'2026-07-15T00:00:00Z',4);
                 INSERT INTO family_snapshot_partitions(
                   snapshot_set_id,partition_order,visibility,member_id,member_key,package_id,
                   snapshot_sha256,package_sha256,authoritative_kinds_json,record_count)
                 VALUES('current-v4',0,'SHARED',NULL,'','partition-v4',
                   'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                   'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
                   '[\"RECURRING_SERIES_PREFERENCES\"]',1);
                 INSERT INTO family_snapshot_records(
                   snapshot_set_id,partition_order,record_order,entity_kind,entity_id,operation,
                   canonical_payload_json,payload_sha256,review_state,resolution)
                 VALUES('current-v4',0,0,'RECURRING_SERIES_PREFERENCES','family-64','UPSERT',
                   '{\"recordKind\":\"RECURRING_SERIES_PREFERENCES\",\"householdId\":\"family-64\",\"preferences\":[]}',
                   '1111111111111111111111111111111111111111111111111111111111111111',
                   'CREATE','APPLY_INCOMING');
                 INSERT INTO family_delivery_deliveries(
                   delivery_id,household_id,audience_key,artifact_id,package_sha256,
                   origin_device_id,visibility,member_id,item_count,excluded_count,
                   package_bytes,state,artifact_schema)
                 VALUES('delivery-v4-64','family-64','SHARED','artifact-v4-64',
                   '2222222222222222222222222222222222222222222222222222222222222222',
                   'origin-v4','SHARED',NULL,1,0,x'4b464634','FAILED_RETRYABLE',
                   'FAMILY_AUDIENCE_PARTITION_V4');",
            )
            .expect("family v4 state");
        assert!(connection
            .execute(
                "INSERT INTO family_snapshot_records(
                   snapshot_set_id,partition_order,record_order,entity_kind,entity_id,operation,
                   canonical_payload_json,payload_sha256,review_state,resolution)
                 VALUES('legacy-v3',0,0,'RECURRING_SERIES_PREFERENCES','family-64','UPSERT',
                   '{}','3333333333333333333333333333333333333333333333333333333333333333',
                   'CREATE','APPLY_INCOMING')",
                [],
            )
            .is_err());

        connection
            .execute(
                "INSERT INTO recurring_series_preferences(
                   household_id,normalized_payee,decision) VALUES('family-64','netflix','CONFIRMED')",
                [],
            )
            .expect("local recurring preference");
        assert_eq!(
            connection
                .query_row(
                    "SELECT group_concat(audience_key || ':' || dirty, ',')
                     FROM (SELECT audience_key,dirty FROM family_delivery_partition_state
                           WHERE household_id='family-64' ORDER BY audience_key)",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "PERSONAL:member-64:0,SHARED:1"
        );
        connection
            .execute_batch(
                "UPDATE family_delivery_partition_state SET dirty=0 WHERE household_id='family-64';
                 INSERT INTO sync_apply_guard(household_id,package_id) VALUES('family-64','apply-v4');
                 UPDATE recurring_series_preferences SET decision='IGNORED'
                 WHERE household_id='family-64' AND normalized_payee='netflix';",
            )
            .expect("guarded family apply");
        assert_eq!(
            connection
                .query_row(
                    "SELECT sum(dirty) FROM family_delivery_partition_state WHERE household_id='family-64'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        assert!(integrity_check(&connection).unwrap());
    }

    #[test]
    fn migration_65_installs_immutable_card_payment_correction_audit() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                let objects: i64 = connection.query_row(
                    "SELECT count(*) FROM sqlite_master
                     WHERE (type='table' AND name='card_payment_link_corrections')
                        OR (type='trigger' AND name IN (
                          'card_payment_link_corrections_immutable_update',
                          'card_payment_link_corrections_immutable_delete',
                          'card_payments_confirmed_link_immutable'))",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(objects, 4);
                connection.execute(
                    "INSERT INTO card_payment_link_corrections(
                       id,household_id,statement_id,payment_id,bank_transaction_id,
                       previous_confirmed_at,correction_kind)
                     VALUES('0123456789abcdef0123456789abcdef','family','statement','payment',
                       'bank-transaction','2026-07-15T00:00:00.000Z','UNLINK')",
                    [],
                )?;
                assert!(connection
                    .execute(
                        "UPDATE card_payment_link_corrections
                         SET statement_id='other' WHERE payment_id='payment'",
                        [],
                    )
                    .is_err());
                assert!(connection
                    .execute(
                        "DELETE FROM card_payment_link_corrections WHERE payment_id='payment'",
                        [],
                    )
                    .is_err());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn migration_thirty_preserves_dashboard_preferences_and_adds_cash_flow() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        configure_connection(&connection).expect("connection configuration");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_version(&mut connection, 29)
            .expect("schema twenty nine");
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES ('family','Family');
                 INSERT INTO dashboard_preferences(
                   household_id,dashboard_template,theme,density,created_at,updated_at)
                 VALUES('family','ASSETS_LIABILITIES','DARK','COMPACT',
                   '2026-07-01T00:00:00.000Z','2026-07-02T00:00:00.000Z');",
            )
            .expect("legacy preference");
        migrations
            .to_version(&mut connection, 30)
            .expect("schema thirty");
        let preserved: (String, String, String, String) = connection
            .query_row(
                "SELECT dashboard_template,theme,density,updated_at
                 FROM dashboard_preferences WHERE household_id='family'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("preserved preference");
        assert_eq!(
            preserved,
            (
                "ASSETS_LIABILITIES".to_owned(),
                "DARK".to_owned(),
                "COMPACT".to_owned(),
                "2026-07-02T00:00:00.000Z".to_owned(),
            )
        );
        connection
            .execute(
                "UPDATE dashboard_preferences SET dashboard_template='CASH_FLOW'
                 WHERE household_id='family'",
                [],
            )
            .expect("cash flow template");
        assert!(validate_restored_semantics(&connection, 30).is_ok());
        assert!(connection
            .execute(
                "UPDATE dashboard_preferences SET dashboard_template='UNKNOWN'
                 WHERE household_id='family'",
                [],
            )
            .is_err());
    }

    #[test]
    fn migration_thirty_three_preserves_capture_links_and_sequence_monotonicity() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        configure_connection(&connection).expect("connection configuration");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_version(&mut connection, 32)
            .expect("schema thirty two");
        connection
            .execute(
                "INSERT INTO households(id,name) VALUES('family','Family')",
                [],
            )
            .unwrap();
        crate::sync_foundation::get_local_status(&connection, "family").unwrap();
        connection
            .execute(
                "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('processed','family','Processed','ASSET','BANK'),
                       ('expense','family','Expense','EXPENSE','OTHER')",
                [],
            )
            .unwrap();
        crate::sync_foundation::get_local_status(&connection, "family").unwrap();
        connection
            .execute_batch(
                "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status)
                 VALUES('legacy-tx','family','2026-07-13','EXPENSE','POSTED');
                 INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                 VALUES('legacy-d','legacy-tx','expense','DEBIT',1000,1),
                       ('legacy-c','legacy-tx','processed','CREDIT',1000,2);",
            )
            .unwrap();
        crate::sync_foundation::get_local_status(&connection, "family").unwrap();
        connection
            .execute(
                "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('pending','family','Pending','ASSET','BANK')",
                [],
            )
            .unwrap();
        let before_max: i64 = connection
            .query_row(
                "SELECT max(capture_sequence) FROM sync_local_change_capture",
                [],
                |row| row.get(0),
            )
            .unwrap();

        migrations
            .to_version(&mut connection, 33)
            .expect("schema thirty three");
        let counts: (i64, i64) = connection
            .query_row(
                "SELECT count(*),sum(processed_envelope_id IS NULL)
                 FROM sync_local_change_capture",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts, (11, 11));
        assert!(validate_restored_semantics(&connection, 33).is_ok());
        assert_eq!(
            connection
                .query_row(
                    "SELECT json_extract(payload_json,'$.recordKind')
                     FROM sync_local_change_capture WHERE entity_id='legacy-tx'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "TRANSACTION_AGGREGATE"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sync_change_envelopes
                     WHERE entity_kind IN ('HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION')
                       AND json_extract(canonical_payload_json,'$.recordKind') IS NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        let dependency_payloads: (String, String, String) = connection
            .query_row(
                "SELECT
                   (SELECT json_extract(payload_json,'$.recordKind')
                    FROM sync_local_change_capture WHERE entity_kind='HOUSEHOLD'
                    ORDER BY capture_sequence DESC LIMIT 1),
                   (SELECT json_extract(payload_json,'$.createdAt')
                    FROM sync_local_change_capture WHERE entity_kind='HOUSEHOLD_MEMBER'
                    ORDER BY capture_sequence DESC LIMIT 1),
                   (SELECT json_extract(payload_json,'$.currency')
                    FROM sync_local_change_capture WHERE entity_kind='ACCOUNT' AND entity_id='processed'
                    ORDER BY capture_sequence DESC LIMIT 1)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(dependency_payloads.0, "HOUSEHOLD");
        assert!(dependency_payloads.1.ends_with('Z'));
        assert_eq!(dependency_payloads.2, "JPY");
        connection
            .execute(
                "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('new','family','New','ASSET','BANK')",
                [],
            )
            .unwrap();
        let after_max: i64 = connection
            .query_row(
                "SELECT max(capture_sequence) FROM sync_local_change_capture",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(after_max > before_max);
    }

    #[test]
    fn restored_semantics_validate_only_final_pending_ledger_snapshot_and_require_balance() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "BEGIN;
                     INSERT INTO households(id,name) VALUES('family','Family');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                     VALUES('bank','family','Bank','ASSET','BANK'),
                           ('food','family','Food','EXPENSE','OTHER');
                     INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status)
                     VALUES('tx','family','2026-07-13','EXPENSE','POSTED');
                     INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                     VALUES('d','tx','food','DEBIT',4200,1),('c','tx','bank','CREDIT',4200,2);
                     COMMIT;",
                )?;
                // Earlier pending snapshots are partial by design; only the
                // latest state for an entity is a replay candidate.
                assert!(validate_restored_semantics(connection, 33).is_ok());
                connection.execute(
                    "UPDATE sync_local_change_capture
                     SET payload_json=json_remove(payload_json,'$.status')
                     WHERE capture_sequence=(
                       SELECT max(capture_sequence) FROM sync_local_change_capture
                       WHERE entity_kind='TRANSACTION' AND entity_id='tx'
                         AND processed_envelope_id IS NULL
                     )",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 33).is_err());
                connection.execute(
                    "UPDATE sync_local_change_capture
                     SET payload_json=(SELECT payload_json FROM sync_transaction_aggregate_payloads
                                       WHERE transaction_id='tx')
                     WHERE capture_sequence=(
                       SELECT max(capture_sequence) FROM sync_local_change_capture
                       WHERE entity_kind='TRANSACTION' AND entity_id='tx'
                         AND processed_envelope_id IS NULL
                     )",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 33).is_ok());
                connection.execute(
                    "UPDATE sync_local_change_capture
                     SET payload_json=json_set(payload_json,'$.journalEntries[0].amountJpy',4201)
                     WHERE capture_sequence=(
                       SELECT max(capture_sequence) FROM sync_local_change_capture
                       WHERE entity_kind='TRANSACTION' AND entity_id='tx'
                         AND processed_envelope_id IS NULL
                     )",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 33).is_err());
                Ok(())
            })
            .expect("restore semantic audit should execute");
    }

    #[test]
    fn ledger_aggregate_replays_with_production_schema_foreign_keys() {
        let source = AppState::in_memory(TEST_KEY).expect("source schema");
        let payload_json = source
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('family','Family');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                     VALUES('bank','family','Bank','ASSET','BANK'),
                           ('food','family','Food','EXPENSE','OTHER');
                     INSERT INTO transactions(id,household_id,occurred_on,transaction_type,payee,status)
                     VALUES('tx','family','2026-07-13','EXPENSE','Market','POSTED');
                     INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                     VALUES('tx-d','tx','food','DEBIT',4200,1),('tx-c','tx','bank','CREDIT',4200,2);
                     INSERT INTO transaction_labels VALUES('tx','RECURRING');
                     INSERT INTO transaction_tags VALUES('tx','family');
                     INSERT INTO transaction_external_keys(
                       household_id,external_source,external_id,fact_hash,transaction_id)
                     VALUES('family','MONEY_FORWARD_ME','mf-1',
                       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','tx');",
                )?;
                crate::sync_foundation::get_local_status(connection, "family").unwrap();
                let envelope = crate::sync_foundation::list_pending_envelopes(connection, "family", 50)
                    .unwrap()
                    .into_iter()
                    .find(|item| item.entity_kind == "TRANSACTION" && item.entity_id == "tx")
                    .expect("transaction envelope");
                Ok(envelope.canonical_payload_json)
            })
            .unwrap();

        let destination = AppState::in_memory(TEST_KEY).expect("destination schema");
        destination
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('family','Family');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                     VALUES('bank','family','Bank','ASSET','BANK'),
                           ('food','family','Food','EXPENSE','OTHER');",
                )?;
                let payload: serde_json::Value = serde_json::from_str(&payload_json).unwrap();
                let string = |key: &str| payload.get(key).and_then(serde_json::Value::as_str);
                connection.execute(
                    "INSERT INTO transactions(
                       id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,
                       calculation_target,attribution_kind,attributed_member_id,
                       audience_visibility,audience_member_id,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                    rusqlite::params![
                        string("id"), string("householdId"), string("occurredOn"),
                        string("postedOn"), string("transactionType"), string("payee"),
                        string("description"), string("status"),
                        payload["calculationTarget"].as_i64(), string("attributionKind"),
                        string("attributedMemberId"), string("audienceVisibility"),
                        string("audienceMemberId"), string("createdAt"), string("updatedAt")
                    ],
                )?;
                for entry in payload["journalEntries"].as_array().unwrap() {
                    connection.execute(
                        "INSERT INTO journal_entries(
                           id,transaction_id,account_id,entry_side,amount_jpy,line_number,created_at)
                         VALUES(?1,?2,?3,?4,?5,?6,?7)",
                        rusqlite::params![
                            entry["id"].as_str(), entry["transactionId"].as_str(),
                            entry["accountId"].as_str(), entry["entrySide"].as_str(),
                            entry["amountJpy"].as_i64(), entry["lineNumber"].as_i64(),
                            entry["createdAt"].as_str()
                        ],
                    )?;
                }
                for label in payload["labels"].as_array().unwrap() {
                    connection.execute(
                        "INSERT INTO transaction_labels VALUES(?1,?2)",
                        rusqlite::params![string("id"), label.as_str()],
                    )?;
                }
                for tag in payload["tags"].as_array().unwrap() {
                    connection.execute(
                        "INSERT INTO transaction_tags VALUES(?1,?2)",
                        rusqlite::params![string("id"), tag.as_str()],
                    )?;
                }
                for key in payload["externalKeys"].as_array().unwrap() {
                    connection.execute(
                        "INSERT INTO transaction_external_keys VALUES(?1,?2,?3,?4,?5,?6)",
                        rusqlite::params![
                            key["householdId"].as_str(), key["externalSource"].as_str(),
                            key["externalId"].as_str(), key["factHash"].as_str(),
                            key["transactionId"].as_str(), key["createdAt"].as_str()
                        ],
                    )?;
                }
                assert!(validate_restored_semantics(connection, 33).is_ok());
                let restored: (i64, String, String, String) = connection.query_row(
                    "SELECT
                       SUM(CASE entry_side WHEN 'DEBIT' THEN amount_jpy ELSE -amount_jpy END),
                       group_concat(id,','),
                       (SELECT group_concat(label,',') FROM transaction_labels WHERE transaction_id='tx'),
                       (SELECT group_concat(tag,',') FROM transaction_tags WHERE transaction_id='tx')
                     FROM (SELECT * FROM journal_entries WHERE transaction_id='tx' ORDER BY line_number)",
                    [],
                    |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
                )?;
                assert_eq!(restored, (0,"tx-d,tx-c".into(),"RECURRING".into(),"family".into()));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn restored_semantics_reject_invalid_watched_file_inbox_scope_and_paths() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                let id = "a".repeat(64);
                let fingerprint = "b".repeat(64);
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES ('one','One'),('two','Two');
                     INSERT INTO watched_folders(id,household_id,label,canonical_path) VALUES
                       ('folder-one','one','Inbox','/one'),
                       ('folder-two','two','Inbox','/two');",
                )?;
                connection.execute(
                    "INSERT INTO watched_file_inbox(
                       id,household_id,watched_folder_id,relative_path,file_name,
                       media_type,byte_size,modified_unix_ms,fingerprint,state)
                     VALUES(?1,'one','folder-one','bank.csv','bank.csv','text/csv',1,1,?2,'DISCOVERED')",
                    rusqlite::params![id, fingerprint],
                )?;
                assert!(validate_restored_semantics(connection, 28).is_ok());

                connection.execute_batch(
                    "DROP TRIGGER watched_file_inbox_scope_update;
                     UPDATE watched_file_inbox SET household_id='two';",
                )?;
                assert!(validate_restored_semantics(connection, 28).is_err());
                connection.execute("UPDATE watched_file_inbox SET household_id='one'", [])?;

                connection.execute_batch(
                    "PRAGMA ignore_check_constraints=ON;
                     UPDATE watched_file_inbox SET relative_path='../outside.csv';
                     PRAGMA ignore_check_constraints=OFF;",
                )?;
                assert!(validate_restored_semantics(connection, 28).is_err());
                Ok(())
            })
            .expect("restore semantic audit should execute");
    }

    #[test]
    fn migration_twenty_two_backfills_included_target_and_enforces_boolean_domain() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        configure_connection(&connection).expect("connection configuration");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_version(&mut connection, 21)
            .expect("schema twenty one");
        connection
            .execute_batch(
                "INSERT INTO households (id,name) VALUES ('family','Family');
                 INSERT INTO transactions
                   (id,household_id,occurred_on,transaction_type,status)
                 VALUES ('legacy','family','2026-07-01','EXPENSE','POSTED');",
            )
            .expect("legacy transaction");
        migrations
            .to_version(&mut connection, 22)
            .expect("schema twenty two");
        let target: i64 = connection
            .query_row(
                "SELECT calculation_target FROM transactions WHERE id='legacy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(target, 1);
        assert!(connection
            .execute(
                "UPDATE transactions SET calculation_target=2 WHERE id='legacy'",
                [],
            )
            .is_err());
    }

    #[test]
    fn restored_semantics_reject_invalid_card_settlement_bank_mapping_scope() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        let result = state.with_connection(|connection| {
            connection.execute_batch(
                "INSERT INTO households (id,name) VALUES ('family','Family'),('other','Other');
                 INSERT INTO accounts
                   (id,household_id,name,account_kind,account_subtype,currency)
                 VALUES
                   ('card','family','Card','LIABILITY','CREDIT_CARD','JPY'),
                   ('foreign-bank','other','Bank','ASSET','BANK','JPY');
                 INSERT INTO card_settlement_bank_mappings
                   (household_id,card_account_id,bank_account_id)
                 VALUES ('family','card','foreign-bank');",
            )?;
            validate_restored_semantics(connection, 23)
        });
        assert!(result.is_err());
    }

    #[test]
    fn restored_semantics_require_cumulative_card_payment_shape_and_derived_status() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households (id,name) VALUES ('family','Family');
                     INSERT INTO accounts
                       (id,household_id,name,account_kind,account_subtype,currency)
                     VALUES ('card','family','Card','LIABILITY','CREDIT_CARD','JPY'),
                            ('bank','family','Bank','ASSET','BANK','JPY');
                     INSERT INTO transactions
                       (id,household_id,occurred_on,transaction_type,status)
                     VALUES ('payment-tx','family','2026-07-27','CARD_PAYMENT','POSTED');
                     INSERT INTO journal_entries
                       (id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                     VALUES ('debit','payment-tx','card','DEBIT',100000,1),
                            ('credit','payment-tx','bank','CREDIT',100000,2);
                     INSERT INTO card_statements
                       (id,household_id,card_account_id,period_start,period_end,
                        statement_amount_jpy,reconciliation_status)
                     VALUES ('statement','family','card','2026-06-01','2026-06-30',
                             100000,'FULLY_RECONCILED');
                     INSERT INTO card_payments
                       (id,household_id,statement_id,bank_transaction_id,card_account_id,
                        payment_amount_jpy,payment_on,match_score_bps,reconciliation_status,confirmed_at)
                     VALUES ('payment','family','statement','payment-tx','card',100000,
                             '2026-07-27',10000,'FULLY_RECONCILED','2026-07-27T00:00:00Z');",
                )?;
                assert!(validate_restored_semantics(connection, 27).is_ok());

                connection.execute(
                    "UPDATE card_statements SET reconciliation_status='UNMATCHED'
                     WHERE id='statement'",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 27).is_err());
                connection.execute(
                    "UPDATE card_statements SET reconciliation_status='FULLY_RECONCILED'
                     WHERE id='statement'",
                    [],
                )?;

                connection.execute_batch(
                    "DROP TRIGGER card_payments_confirmed_link_immutable;
                     DROP TRIGGER card_payments_confirmed_shape_update;
                     UPDATE card_payments SET payment_on='2026-06-29' WHERE id='payment';",
                )?;
                assert!(validate_restored_semantics(connection, 27).is_err());
                Ok(())
            })
            .expect("restore semantic audit should execute");
    }

    #[test]
    fn migration_seventeen_backfills_members_and_shared_household_accounts() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        configure_connection(&connection).expect("connection configuration");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_version(&mut connection, 16)
            .expect("schema sixteen");
        connection
            .execute_batch(
                "INSERT INTO households (id, name) VALUES ('family', 'Family');
                 INSERT INTO accounts
                   (id, household_id, name, account_kind, account_subtype)
                 VALUES ('family-bank', 'family', 'Bank', 'ASSET', 'BANK');",
            )
            .expect("legacy rows");

        migrations
            .to_version(&mut connection, 17)
            .expect("schema seventeen");
        let member: (String, String, String, i64) = connection
            .query_row(
                "SELECT id, display_name, status, sort_order FROM household_members
                 WHERE household_id = 'family'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            member,
            (
                "family-member-primary".into(),
                "Primary member".into(),
                "ACTIVE".into(),
                0
            )
        );
        let ownership: (String, Option<String>, String) = connection
            .query_row(
                "SELECT ownership_kind, owner_member_id, visibility FROM accounts
                 WHERE id = 'family-bank'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(ownership, ("HOUSEHOLD".into(), None, "SHARED".into()));
        connection
            .execute(
                "INSERT INTO household_members
                   (id, household_id, display_name, status, sort_order)
                 VALUES ('family-alice', 'family', 'Alice', 'ACTIVE', 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE accounts SET ownership_kind = 'MEMBER',
                    owner_member_id = 'family-alice', visibility = 'PERSONAL'
                 WHERE id = 'family-bank'",
                [],
            )
            .expect("same-household active member may own a personal account");
        assert!(connection
            .execute(
                "UPDATE household_members SET status = 'ARCHIVED' WHERE id = 'family-alice'",
                [],
            )
            .is_err());

        connection
            .execute(
                "INSERT INTO households (id, name) VALUES ('new', 'New')",
                [],
            )
            .expect("new household");
        let created_members: i64 = connection
            .query_row(
                "SELECT count(*) FROM household_members WHERE household_id = 'new'
                   AND id = 'new-member-primary' AND status = 'ACTIVE'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(created_members, 1);
        assert!(connection
            .execute(
                "UPDATE accounts SET owner_member_id = 'new-member-primary'
                 WHERE id = 'family-bank'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "DELETE FROM household_members WHERE id = 'new-member-primary'",
                [],
            )
            .is_err());
        connection
            .execute("DELETE FROM households WHERE id = 'new'", [])
            .expect("household cascade remains valid");
        let cascaded_members: i64 = connection
            .query_row(
                "SELECT count(*) FROM household_members WHERE household_id = 'new'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cascaded_members, 0);
    }

    #[test]
    fn migration_eighteen_backfills_scopes_and_allows_archived_history() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        configure_connection(&connection).expect("connection configuration");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_version(&mut connection, 17)
            .expect("schema seventeen");
        let hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        connection
            .execute_batch(&format!(
                "INSERT INTO households (id, name) VALUES ('family', 'Family');
                 INSERT INTO household_members
                   (id, household_id, display_name, status, sort_order)
                 VALUES ('family-active', 'family', 'Active', 'ACTIVE', 1);
                 UPDATE household_members SET status = 'ARCHIVED'
                   WHERE id = 'family-member-primary';
                 INSERT INTO import_runs (id, household_id, status)
                   VALUES ('run', 'family', 'REVIEW_REQUIRED');
                 INSERT INTO source_documents
                   (id, household_id, import_run_id, source_type, original_filename,
                    media_type, byte_size, sha256, storage_path)
                 VALUES ('document', 'family', 'run', 'MANUAL_UPLOAD', 'source.csv',
                    'text/csv', 1, '{hash}', 'vault://{hash}');
                 INSERT INTO transaction_candidates
                   (id, household_id, occurred_on, amount_jpy, direction)
                 VALUES ('candidate', 'family', '2026-07-13', 100, 'OUT');
                 INSERT INTO transactions
                   (id, household_id, occurred_on, transaction_type)
                 VALUES ('transaction', 'family', '2026-07-13', 'EXPENSE');"
            ))
            .expect("schema seventeen rows");

        migrations
            .to_version(&mut connection, 18)
            .expect("schema eighteen");
        for table in ["transactions", "transaction_candidates"] {
            let scope: (String, Option<String>, String, Option<String>) = connection
                .query_row(
                    &format!(
                        "SELECT attribution_kind, attributed_member_id,
                                audience_visibility, audience_member_id FROM {table}"
                    ),
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .unwrap();
            assert_eq!(scope, ("HOUSEHOLD".into(), None, "SHARED".into(), None));
            assert!(connection
                .execute(
                    &format!("UPDATE {table} SET attribution_kind = 'MEMBER'"),
                    [],
                )
                .is_err());
        }
        assert!(connection
            .execute(
                "UPDATE source_documents SET audience_member_id = 'family-member-primary'",
                [],
            )
            .is_err());
        connection
            .execute_batch(
                "UPDATE transactions SET attribution_kind = 'MEMBER',
                    attributed_member_id = 'family-member-primary';
                 UPDATE transaction_candidates SET audience_visibility = 'PERSONAL',
                    audience_member_id = 'family-member-primary';
                 UPDATE source_documents SET audience_visibility = 'PERSONAL',
                    audience_member_id = 'family-member-primary';",
            )
            .expect("archived members remain valid historical references");
        assert!(validate_restored_semantics(&connection, 18).is_ok());
        let transaction_audience: String = connection
            .query_row("SELECT audience_visibility FROM transactions", [], |row| {
                row.get(0)
            })
            .unwrap();
        let source_audience: String = connection
            .query_row(
                "SELECT audience_visibility FROM source_documents",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(transaction_audience, "SHARED");
        assert_eq!(source_audience, "PERSONAL");
    }

    #[test]
    fn restored_semantics_reject_cross_household_transaction_and_source_scopes() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                let hash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
                connection.execute_batch(&format!(
                    "INSERT INTO households (id, name) VALUES ('one', 'One'), ('two', 'Two');
                     INSERT INTO import_runs (id, household_id, status)
                       VALUES ('run', 'one', 'REVIEW_REQUIRED');
                     INSERT INTO source_documents
                       (id, household_id, import_run_id, source_type, original_filename,
                        media_type, byte_size, sha256, storage_path)
                     VALUES ('document', 'one', 'run', 'MANUAL_UPLOAD', 'source.csv',
                        'text/csv', 1, '{hash}', 'vault://{hash}');
                     INSERT INTO transaction_candidates
                       (id, household_id, occurred_on, amount_jpy, direction)
                     VALUES ('candidate', 'one', '2026-07-13', 100, 'OUT');
                     INSERT INTO transactions
                       (id, household_id, occurred_on, transaction_type)
                     VALUES ('transaction', 'one', '2026-07-13', 'EXPENSE');
                     DROP TRIGGER trg_transactions_scope_update;
                     DROP TRIGGER trg_candidates_scope_update;
                     DROP TRIGGER trg_source_documents_audience_update;
                     UPDATE transactions SET attribution_kind = 'MEMBER',
                        attributed_member_id = 'two-member-primary';"
                ))?;
                assert!(validate_restored_semantics(connection, 18).is_err());
                connection.execute(
                    "UPDATE transactions SET attribution_kind = 'HOUSEHOLD',
                     attributed_member_id = NULL",
                    [],
                )?;
                connection.execute(
                    "UPDATE transaction_candidates SET audience_visibility = 'PERSONAL',
                     audience_member_id = 'two-member-primary'",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 18).is_err());
                connection.execute(
                    "UPDATE transaction_candidates SET audience_visibility = 'SHARED',
                     audience_member_id = NULL",
                    [],
                )?;
                connection.execute(
                    "UPDATE source_documents SET audience_visibility = 'PERSONAL',
                     audience_member_id = 'two-member-primary'",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 18).is_err());
                Ok(())
            })
            .expect("test database should remain queryable");
    }

    #[test]
    fn restored_semantics_reject_invalid_delimited_parser_profiles() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households (id, name) VALUES ('family', 'Family');
                     INSERT INTO delimited_parser_profiles
                       (id, household_id, name, delimiter, encoding, header_row,
                        date_column, date_format, description_column, amount_mode,
                        signed_positive_direction, signed_amount_column, is_enabled, priority)
                     VALUES ('profile', 'family', 'Profile', 'AUTO', 'AUTO', 1,
                        'Date', 'AUTO', 'Description', 'SIGNED', 'OUT', 'Amount', 1, 10);",
                )?;
                assert!(validate_restored_semantics(connection, 19).is_ok());

                connection.execute_batch(
                    "PRAGMA ignore_check_constraints = ON;
                     UPDATE delimited_parser_profiles SET payee_column = ' Date '
                     WHERE id = 'profile';",
                )?;
                assert!(validate_restored_semantics(connection, 19).is_err());

                connection.execute_batch(
                    "UPDATE delimited_parser_profiles
                       SET payee_column = NULL, debit_column = 'Debit'
                     WHERE id = 'profile';",
                )?;
                assert!(validate_restored_semantics(connection, 19).is_err());
                connection.execute_batch("PRAGMA ignore_check_constraints = OFF;")?;
                Ok(())
            })
            .expect("test database should remain queryable");
    }

    #[test]
    fn restored_semantics_reject_invalid_mixed_currency_mergers() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                let hash = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
                connection.execute_batch(&format!(
                    "INSERT INTO households (id, name) VALUES ('family', 'Family');
                     INSERT INTO accounts
                       (id, household_id, name, account_kind, account_subtype)
                     VALUES ('broker', 'family', 'Broker', 'ASSET', 'SECURITIES');
                     INSERT INTO import_runs (id, household_id, status)
                     VALUES ('run', 'family', 'REVIEW_REQUIRED');
                     INSERT INTO source_documents
                       (id, household_id, import_run_id, source_type, original_filename,
                        media_type, byte_size, sha256, storage_path)
                     VALUES ('document', 'family', 'run', 'MANUAL_UPLOAD', 'merger.csv',
                        'text/csv', 1, '{hash}', 'vault://{hash}');
                     INSERT INTO brokerage_events
                       (id, household_id, account_id, source_document_id, source_row,
                        event_type, trade_date, instrument_code, instrument_name,
                        brokerage_account_type, currency, gross_amount, fee_amount,
                        tax_amount, settlement_amount, reconciliation_status,
                        reconciliation_difference, raw_transaction_type,
                        corporate_action_ratio, target_instrument_code,
                        target_instrument_name, target_currency, merger_cash_amount,
                        merger_cash_currency, merger_stock_cost_basis_ratio,
                        source_to_target_fx_rate, source_to_cash_fx_rate)
                     VALUES ('merger', 'family', 'broker', 'document', 1, 'MERGER',
                        '2026-07-13', 'OLD', 'Old', 'TAXABLE', 'USD', 0, 0, 0, 0,
                        'BALANCED', 0, 'MERGER', 0.5, 'NEW', 'New', 'JPY', 25,
                        'EUR', 0.75, 150, 0.9);
                     INSERT INTO brokerage_event_legs
                       (id, brokerage_event_id, line_number, leg_kind, signed_amount,
                        currency, instrument_code, instrument_name, signed_quantity, description)
                     VALUES
                       ('source', 'merger', 1, 'SECURITY', 0, 'USD', 'OLD', 'Old', -2, 'Source'),
                       ('target', 'merger', 2, 'SECURITY', 0, 'JPY', 'NEW', 'New', 1, 'Target'),
                       ('cash', 'merger', 3, 'CASH', 25, 'EUR', NULL, NULL, NULL, 'Cash'),
                       ('offset', 'merger', 4, 'ADJUSTMENT', -25, 'EUR', NULL, NULL, NULL, 'Offset');"
                ))?;
                assert!(validate_restored_semantics(connection, 20).is_ok());

                connection.execute_batch(
                    "PRAGMA ignore_check_constraints = ON;
                     UPDATE brokerage_events SET source_to_target_fx_rate = NULL
                     WHERE id = 'merger';",
                )?;
                assert!(validate_restored_semantics(connection, 20).is_err());

                connection.execute(
                    "UPDATE brokerage_events SET source_to_target_fx_rate = 150
                     WHERE id = 'merger'",
                    [],
                )?;
                connection.execute(
                    "UPDATE brokerage_event_legs SET currency = 'USD' WHERE id = 'cash'",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 20).is_err());
                connection.execute_batch("PRAGMA ignore_check_constraints = OFF;")?;
                Ok(())
            })
            .expect("test database should remain queryable");
    }

    #[test]
    fn restored_semantics_reject_invalid_member_account_ownership() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households (id, name) VALUES ('one', 'One'), ('two', 'Two');
                     INSERT INTO accounts
                       (id, household_id, name, account_kind, account_subtype)
                     VALUES ('one-bank', 'one', 'Bank', 'ASSET', 'BANK');
                     DROP TRIGGER trg_accounts_owner_update;
                     UPDATE accounts SET ownership_kind = 'MEMBER',
                         owner_member_id = 'two-member-primary'
                     WHERE household_id = 'one';",
                )?;
                assert!(validate_restored_semantics(connection, 17).is_err());

                connection.execute(
                    "UPDATE accounts SET ownership_kind = 'HOUSEHOLD', owner_member_id = NULL
                     WHERE household_id = 'one'",
                    [],
                )?;
                connection.execute_batch(
                    "DROP TRIGGER trg_household_member_archive_last_active;
                     UPDATE household_members SET status = 'ARCHIVED'
                     WHERE household_id = 'one';",
                )?;
                assert!(validate_restored_semantics(connection, 17).is_err());
                Ok(())
            })
            .expect("test database should remain queryable");
    }

    #[test]
    fn restored_semantics_reject_cross_household_aggregate_asset_source() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households (id, name) VALUES ('one', 'One'), ('two', 'Two');
                     INSERT INTO import_runs (id, household_id, status)
                       VALUES ('run', 'one', 'POSTED');
                     INSERT INTO source_documents
                       (id, household_id, import_run_id, source_type, original_filename,
                        media_type, byte_size, sha256, storage_path)
                       VALUES ('document', 'one', 'run', 'MANUAL_UPLOAD', 'assets.csv',
                        'text/csv', 1,
                        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                        'assets.enc');
                     INSERT INTO source_records
                       (id, source_document_id, row_number, record_hash, raw_payload_json)
                       VALUES ('record', 'document', 2,
                        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                        '{}');
                     INSERT INTO aggregate_asset_snapshots
                       (id, household_id, source_document_id, source_row, as_of, total_assets_jpy)
                       VALUES ('snapshot', 'one', 'document', 2, '2026-07-31', 100);
                     DROP TRIGGER aggregate_asset_snapshot_source_owner_update;
                     UPDATE aggregate_asset_snapshots SET household_id = 'two'
                       WHERE id = 'snapshot';",
                )?;
                assert!(validate_restored_semantics(connection, 21).is_err());
                Ok(())
            })
            .expect("test database should remain queryable");
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        let result = state.with_connection(|connection| {
            connection.execute(
                "INSERT INTO accounts \
                 (id, household_id, name, account_kind, account_subtype, currency) \
                 VALUES ('account', 'missing', 'Test', 'ASSET', 'BANK', 'JPY')",
                [],
            )?;
            Ok(())
        });
        assert!(result.is_err());
    }

    #[test]
    fn financial_amounts_require_integer_jpy_storage() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households (id, name) VALUES ('household', 'Test')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO accounts \
                     (id, household_id, name, account_kind, account_subtype, currency) \
                     VALUES ('account', 'household', 'Bank', 'ASSET', 'BANK', 'JPY')",
                    [],
                )?;
                let invalid = connection.execute(
                    "INSERT INTO transaction_candidates \
                     (id, household_id, account_id, occurred_on, amount_jpy, direction) \
                     VALUES ('candidate', 'household', 'account', '2026-07-12', 1.5, 'OUT')",
                    [],
                );
                assert!(invalid.is_err());
                Ok(())
            })
            .expect("test setup should succeed");
    }

    #[test]
    fn planning_schema_enforces_integer_jpy_and_goal_status_constraints() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households (id, name) VALUES ('household', 'Test');
                     INSERT INTO accounts
                       (id, household_id, name, account_kind, account_subtype, currency)
                     VALUES ('expense', 'household', 'Expense', 'EXPENSE', 'OTHER', 'JPY');",
                )?;
                assert!(connection
                    .execute(
                        "INSERT INTO monthly_category_budgets
                           (household_id, month, category_account_id, budget_jpy)
                         VALUES ('household', '2026-07', 'expense', 1.5)",
                        [],
                    )
                    .is_err());
                assert!(connection
                    .execute(
                        "INSERT INTO savings_goals
                           (id, household_id, name, target_jpy, saved_jpy, target_date, status)
                         VALUES ('real-goal', 'household', 'Goal', 1000.5, 0,
                                 '2027-01-01', 'ACTIVE')",
                        [],
                    )
                    .is_err());
                assert!(connection
                    .execute(
                        "INSERT INTO savings_goals
                           (id, household_id, name, target_jpy, saved_jpy, target_date, status)
                         VALUES ('bad-status', 'household', 'Goal', 1000, 0,
                                 '2027-01-01', 'UNKNOWN')",
                        [],
                    )
                    .is_err());
                Ok(())
            })
            .expect("planning constraints should be queryable");
    }

    #[test]
    fn candidate_can_retain_multiple_source_rows() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households (id, name) VALUES ('household', 'Test');
                     INSERT INTO import_runs (id, household_id, status)
                     VALUES ('run', 'household', 'REVIEW_REQUIRED');
                     INSERT INTO source_documents
                       (id, household_id, import_run_id, source_type, original_filename,
                        media_type, byte_size, sha256, storage_path)
                     VALUES
                       ('document', 'household', 'run', 'MANUAL_UPLOAD', 'paypay.csv',
                        'text/csv', 128, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                        'raw/paypay.csv');
                     INSERT INTO source_records
                       (id, source_document_id, row_number, record_hash, raw_payload_json)
                     VALUES
                       ('row-1', 'document', 1,
                        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '{}'),
                       ('row-2', 'document', 2,
                        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', '{}');
                     INSERT INTO transaction_candidates
                       (id, household_id, occurred_on, amount_jpy, direction)
                     VALUES ('candidate', 'household', '2026-07-12', 998, 'OUT');
                     INSERT INTO candidate_sources (candidate_id, source_record_id, evidence_role)
                     VALUES
                       ('candidate', 'row-1', 'PRIMARY'),
                       ('candidate', 'row-2', 'FUNDING_LEG');",
                )?;
                let source_count: i64 = connection.query_row(
                    "SELECT count(*) FROM candidate_sources WHERE candidate_id = 'candidate'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(source_count, 2);
                Ok(())
            })
            .expect("multi-row evidence should be retained");
    }

    #[test]
    fn restored_source_documents_are_bounded_and_deduplicated_without_hiding_conflicts() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        let hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households (id, name) VALUES ('one', 'One'), ('two', 'Two');
                     INSERT INTO import_runs (id, household_id, status)
                     VALUES ('run-one', 'one', 'POSTED'), ('run-two', 'two', 'POSTED');",
                )?;
                for (id, household, run) in [
                    ("document-one", "one", "run-one"),
                    ("document-two", "two", "run-two"),
                ] {
                    connection.execute(
                        "INSERT INTO source_documents
                         (id, household_id, import_run_id, source_type, original_filename,
                          media_type, byte_size, sha256, storage_path)
                         VALUES (?1, ?2, ?3, 'MANUAL_UPLOAD', 'source.bin',
                                 'application/octet-stream', 12, ?4, ?5)",
                        rusqlite::params![id, household, run, hash, format!("vault://{hash}")],
                    )?;
                }

                let documents = collect_source_documents(connection, 6, 2, 1)?;
                assert_eq!(documents.len(), 1);
                assert_eq!(documents[0].sha256, hash);
                assert_eq!(documents[0].byte_size, 12);
                assert!(collect_source_documents(connection, 6, 1, 1).is_err());
                assert!(collect_source_documents(connection, 6, 2, 0).is_err());

                connection.execute(
                    "UPDATE source_documents SET media_type = 'text/plain'
                     WHERE id = 'document-two'",
                    [],
                )?;
                assert!(collect_source_documents(connection, 6, 2, 1).is_err());
                Ok(())
            })
            .expect("source-document aggregation should be deterministic");
    }

    #[test]
    fn restored_semantics_reject_cross_household_journal_accounts() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households (id, name) VALUES ('one', 'One'), ('two', 'Two');
                     INSERT INTO accounts
                       (id, household_id, name, account_kind, account_subtype)
                     VALUES ('account-two', 'two', 'Bank', 'ASSET', 'BANK');
                     INSERT INTO transactions
                       (id, household_id, occurred_on, transaction_type)
                     VALUES ('transaction-one', 'one', '2026-07-12', 'ADJUSTMENT');
                     INSERT INTO journal_entries
                       (id, transaction_id, account_id, entry_side, amount_jpy, line_number)
                     VALUES
                       ('debit', 'transaction-one', 'account-two', 'DEBIT', 100, 1),
                       ('credit', 'transaction-one', 'account-two', 'CREDIT', 100, 2);",
                )?;
                assert!(validate_restored_semantics(connection, 6).is_err());
                Ok(())
            })
            .expect("test database should remain queryable");
    }

    #[test]
    fn restored_semantics_reject_unbalanced_journals() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households (id, name) VALUES ('household', 'Household');
                     INSERT INTO accounts
                       (id, household_id, name, account_kind, account_subtype)
                     VALUES
                       ('asset', 'household', 'Bank', 'ASSET', 'BANK'),
                       ('expense', 'household', 'Expense', 'EXPENSE', 'OTHER');
                     INSERT INTO transactions
                       (id, household_id, occurred_on, transaction_type)
                     VALUES ('transaction', 'household', '2026-07-12', 'EXPENSE');
                     INSERT INTO journal_entries
                       (id, transaction_id, account_id, entry_side, amount_jpy, line_number)
                     VALUES
                       ('debit', 'transaction', 'expense', 'DEBIT', 100, 1),
                       ('credit', 'transaction', 'asset', 'CREDIT', 99, 2);",
                )?;
                assert!(validate_restored_semantics(connection, 6).is_err());
                Ok(())
            })
            .expect("test database should remain queryable");
    }

    #[test]
    fn restored_semantics_reject_cross_household_staged_card_relations() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households (id, name) VALUES ('one', 'One'), ('two', 'Two');
                     INSERT INTO import_runs (id, household_id, status)
                     VALUES ('run-one', 'one', 'REVIEW_REQUIRED');
                     INSERT INTO accounts
                       (id, household_id, name, account_kind, account_subtype)
                     VALUES ('card-one', 'one', 'Card', 'LIABILITY', 'CREDIT_CARD');
                     INSERT INTO staged_card_statements
                       (id, import_run_id, household_id, card_account_id, issuer,
                        period_start, period_end, statement_amount_jpy)
                     VALUES ('statement', 'run-one', 'two', 'card-one', 'Issuer',
                             '2026-07-01', '2026-07-31', 100);",
                )?;
                assert!(validate_restored_semantics(connection, 6).is_err());
                Ok(())
            })
            .expect("test database should remain queryable");
    }

    #[test]
    fn restored_semantics_reject_invalid_planning_account_relations() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households (id, name) VALUES ('one', 'One'), ('two', 'Two');
                     INSERT INTO accounts
                       (id, household_id, name, account_kind, account_subtype)
                     VALUES ('expense-two', 'two', 'Expense', 'EXPENSE', 'OTHER'),
                            ('bank-one', 'one', 'Bank', 'ASSET', 'BANK');
                     INSERT INTO monthly_category_budgets
                       (household_id, month, category_account_id, budget_jpy)
                     VALUES ('one', '2026-07', 'expense-two', 1000);",
                )?;
                assert!(validate_restored_semantics(connection, 7).is_err());

                connection.execute("DELETE FROM monthly_category_budgets", [])?;
                connection.execute(
                    "INSERT INTO monthly_category_budgets
                       (household_id, month, category_account_id, budget_jpy)
                     VALUES ('one', '2026-07', 'bank-one', 1000)",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 7).is_err());
                Ok(())
            })
            .expect("test database should remain queryable");
    }

    #[test]
    fn valid_schema_one_database_remains_restorable() {
        let test_directory = std::env::temp_dir().join(format!(
            "kakeflow-legacy-restore-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should follow epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&test_directory).expect("test directory");
        let database_path = test_directory.join("kakeflow.db");
        let connection = Connection::open(&database_path).expect("legacy database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        connection
            .execute_batch(include_str!("../migrations/0001_household_accounts.sql"))
            .expect("schema one");
        connection
            .pragma_update(None, "user_version", 1)
            .expect("schema version");
        connection
            .execute(
                "INSERT INTO households (id, name) VALUES ('legacy', 'Legacy')",
                [],
            )
            .expect("legacy household");
        drop(connection);

        let restored = validate_existing_database(&database_path, TEST_KEY)
            .expect("schema one should validate without querying newer tables");
        assert_eq!(restored.schema_version, 1);
        assert_eq!(restored.household_count, 1);
        assert!(restored.source_documents.is_empty());
        let _ = fs::remove_dir_all(test_directory);
    }

    #[test]
    fn file_database_is_encrypted_at_rest() {
        let test_directory = std::env::temp_dir().join(format!(
            "kakeflow-encryption-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should follow epoch")
                .as_nanos()
        ));
        let database_path = test_directory.join("kakeflow.db");

        let state = AppState::open_with_key(database_path.clone(), TEST_KEY)
            .expect("encrypted database should open");
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households (id, name) VALUES ('family', 'Family')",
                    [],
                )?;
                Ok(())
            })
            .unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for path in [
                database_path.clone(),
                PathBuf::from(format!("{}-wal", database_path.to_string_lossy())),
                PathBuf::from(format!("{}-shm", database_path.to_string_lossy())),
            ] {
                if path.exists() {
                    let mode = fs::metadata(path)
                        .expect("database file metadata should be readable")
                        .permissions()
                        .mode();
                    assert_eq!(
                        mode & 0o077,
                        0,
                        "database files must not be group/world accessible"
                    );
                }
            }
        }
        drop(state);

        let unkeyed = Connection::open(&database_path).expect("file should exist");
        let read_without_key =
            unkeyed.query_row("SELECT name FROM sqlite_master LIMIT 1", [], |row| {
                row.get::<_, String>(0)
            });
        assert!(read_without_key.is_err());

        let restored = validate_existing_database(&database_path, TEST_KEY)
            .expect("the correct restored key should validate the database");
        assert_eq!(restored.schema_version, MIGRATIONS.len() as i64);
        assert_eq!(restored.household_count, 1);
        assert!(restored.source_documents.is_empty());
        assert!(validate_existing_database(&database_path, b"wrong key").is_err());

        let _ = fs::remove_dir_all(test_directory);
    }

    #[test]
    fn portable_restore_clears_device_local_folder_google_drive_and_gmail_grants() {
        let test_directory = std::env::temp_dir().join(format!(
            "kakeflow-device-state-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should follow epoch")
                .as_nanos()
        ));
        let database_path = test_directory.join("kakeflow.db");
        let state =
            AppState::open_with_key(database_path.clone(), TEST_KEY).expect("open database");
        state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households (id, name) VALUES ('family', 'Family')", [])?;
                connection.execute_batch(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                     VALUES('bank','family','Bank','ASSET','BANK'),
                           ('expense','family','Expense','EXPENSE','OTHER');
                     INSERT INTO import_runs(id,household_id,status,adapter_id,adapter_version)
                     VALUES('run','family','POSTED','test','1');
                     INSERT INTO source_documents
                       (id,household_id,import_run_id,source_type,original_filename,media_type,
                        byte_size,sha256,storage_path)
                     VALUES('document','family','run','MANUAL_UPLOAD','statement.csv','text/csv',10,
                            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                            'vault://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
                     INSERT INTO source_records(id,source_document_id,row_number,record_hash,raw_payload_json)
                     VALUES('record','document',1,
                            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','{}');
                     INSERT INTO transaction_candidates
                       (id,household_id,account_id,occurred_on,amount_jpy,direction,review_status)
                     VALUES('candidate','family','bank','2026-08-25',100,'OUT','POSTED');
                     INSERT INTO candidate_sources(candidate_id,source_record_id,evidence_role)
                     VALUES('candidate','record','PRIMARY');
                     INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status)
                     VALUES('transaction','family','2026-08-25','EXPENSE','POSTED');
                     INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                     VALUES('debit','transaction','expense','DEBIT',100,1),
                           ('credit','transaction','bank','CREDIT',100,2);
                     INSERT INTO transaction_sources(transaction_id,source_record_id,candidate_id)
                     VALUES('transaction','record','candidate');",
                )?;
                connection.execute(
                    "INSERT INTO watched_folders (id, household_id, label, canonical_path) VALUES ('folder', 'family', 'Inbox', '/device/private/inbox')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO google_drive_connections
                       (id,household_id,client_id_fingerprint,status)
                     VALUES('drive','family',?1,'AUTHORIZING')",
                    ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
                )?;
                connection.execute(
                    "INSERT INTO gmail_connections
                       (id,household_id,client_id_fingerprint,status)
                     VALUES('gmail','family',?1,'AUTHORIZING')",
                    ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
                )?;
                connection.execute_batch(
                    "INSERT INTO connector_bindings
                       (household_id,connector_kind,connection_key,version)
                     VALUES('family','GOOGLE_DRIVE','drive',1),
                           ('family','GMAIL','gmail',1),
                           ('family','WATCHED_FOLDER','folder',1),
                           ('family','MANUAL_IMPORT','manual-import',1);
                     INSERT INTO connector_binding_accounts
                       (household_id,connector_kind,connection_key,account_id)
                     VALUES('family','GOOGLE_DRIVE','drive','bank'),
                           ('family','GMAIL','gmail','bank'),
                           ('family','WATCHED_FOLDER','folder','bank'),
                           ('family','MANUAL_IMPORT','manual-import','bank');",
                )?;
                Ok(())
            })
            .expect("seed watched folder");
        drop(state);

        clear_restored_device_local_state(&database_path, TEST_KEY).expect("clear device state");

        let connection = Connection::open(&database_path).expect("reopen database");
        apply_key(&connection, TEST_KEY).expect("apply key");
        let count: i64 = connection
            .query_row("SELECT count(*) FROM watched_folders", [], |row| row.get(0))
            .expect("count watched folders");
        assert_eq!(count, 0);
        let drive_count: i64 = connection
            .query_row("SELECT count(*) FROM google_drive_connections", [], |row| {
                row.get(0)
            })
            .expect("count Google Drive connections");
        assert_eq!(drive_count, 0);
        let gmail_count: i64 = connection
            .query_row("SELECT count(*) FROM gmail_connections", [], |row| {
                row.get(0)
            })
            .expect("count Gmail connections");
        assert_eq!(gmail_count, 0);
        let binding_count: i64 = connection
            .query_row("SELECT count(*) FROM connector_bindings", [], |row| {
                row.get(0)
            })
            .expect("count connector bindings");
        assert_eq!(binding_count, 0);
        for table in [
            "source_documents",
            "source_records",
            "transaction_candidates",
            "transactions",
            "journal_entries",
            "transaction_sources",
        ] {
            assert_eq!(
                connection
                    .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .expect("count preserved provenance"),
                if table == "journal_entries" { 2 } else { 1 },
                "{table} must survive portable restore"
            );
        }
        drop(connection);
        let _ = fs::remove_dir_all(test_directory);
    }

    #[test]
    fn migration_thirty_four_bootstraps_planning_config_and_preserves_capture_links() {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        apply_key(&connection, TEST_KEY).expect("SQLCipher key");
        configure_connection(&connection).expect("connection configuration");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_version(&mut connection, 33)
            .expect("schema thirty three");
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('family','Family');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('bank','family','Bank','ASSET','BANK'),
                       ('card','family','Card','LIABILITY','CREDIT_CARD'),
                       ('food','family','Food','EXPENSE','OTHER');",
            )
            .unwrap();
        crate::sync_foundation::get_local_status(&connection, "family").unwrap();
        let processed_before: i64 = connection
            .query_row(
                "SELECT count(*) FROM sync_local_change_capture
                 WHERE processed_envelope_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let envelopes_before: i64 = connection
            .query_row("SELECT count(*) FROM sync_change_envelopes", [], |row| {
                row.get(0)
            })
            .unwrap();
        let max_before: i64 = connection
            .query_row(
                "SELECT max(capture_sequence) FROM sync_local_change_capture",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // These rows deliberately predate schema-34 triggers and therefore
        // exercise the migration bootstrap rather than ordinary write capture.
        connection
            .execute_batch(
                "INSERT INTO monthly_category_budgets(household_id,month,category_account_id,budget_jpy)
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
                   description_column,payee_column,amount_mode,signed_positive_direction,
                   signed_amount_column,debit_column,credit_column,is_enabled,priority,version)
                 VALUES('profile','family','Bank CSV','COMMA','CP932',2,'Date','YYYY_MM_DD',
                   'Description',NULL,'SIGNED','OUT','Amount',NULL,NULL,1,5,2);",
            )
            .unwrap();

        migrations
            .to_version(&mut connection, 34)
            .expect("schema thirty four");
        let planning_kinds =
            "'MONTHLY_BUDGET_PLAN','SAVINGS_GOAL','CLASSIFICATION_RULE','ACCOUNT_GROUP',
             'CARD_SETTLEMENT_MAPPING','DASHBOARD_PREFERENCES','DELIMITED_PARSER_PROFILE'";
        let bootstrap: (i64, i64, i64) = connection
            .query_row(
                &format!(
                    "SELECT count(*),min(capture_sequence),
                            sum(processed_envelope_id IS NULL)
                     FROM sync_local_change_capture WHERE entity_kind IN ({planning_kinds})"
                ),
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(bootstrap.0, 7);
        assert_eq!(bootstrap.2, 7);
        assert!(bootstrap.1 > max_before);
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sync_local_change_capture
                     WHERE processed_envelope_id IS NOT NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            processed_before
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM sync_change_envelopes", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            envelopes_before
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sync_local_change_capture c
                     JOIN sync_change_envelopes e ON e.envelope_id=c.processed_envelope_id
                     WHERE c.operation!=e.operation OR c.payload_json!=e.canonical_payload_json",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );

        crate::sync_foundation::get_local_status(&connection, "family").unwrap();
        assert_eq!(
            connection
                .query_row(
                    &format!(
                        "SELECT count(*) FROM sync_change_envelopes
                         WHERE entity_kind IN ({planning_kinds})"
                    ),
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            7
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sync_local_change_capture
                     WHERE processed_envelope_id IS NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    fn seed_complete_planning_config(connection: &Connection) -> rusqlite::Result<()> {
        connection.execute_batch(
            "INSERT INTO households(id,name) VALUES('family','Family');
             INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
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
               signed_amount_column,debit_column,credit_column,external_id_column,
               account_hint_column,is_enabled,priority,version)
             VALUES('profile','family','Bank CSV','COMMA','CP932',2,'Date','YYYY_MM_DD',
               'Description',NULL,'SIGNED','OUT','Amount',NULL,NULL,'External ID',
               'Account',1,5,2);",
        )
    }

    fn apply_planning_config_upsert(
        connection: &Connection,
        kind: &str,
        payload_json: &str,
    ) -> rusqlite::Result<()> {
        let payload: serde_json::Value =
            serde_json::from_str(payload_json).map_err(|_| rusqlite::Error::InvalidQuery)?;
        let text = |key: &str| payload.get(key).and_then(serde_json::Value::as_str);
        match kind {
            "MONTHLY_BUDGET_PLAN" => {
                connection.execute(
                    "DELETE FROM monthly_category_budgets WHERE household_id=?1",
                    [text("householdId")],
                )?;
                for budget in payload["budgets"].as_array().unwrap() {
                    connection.execute(
                        "INSERT INTO monthly_category_budgets(
                           household_id,month,category_account_id,budget_jpy,created_at,updated_at)
                         VALUES(?1,?2,?3,?4,?5,?6)",
                        rusqlite::params![
                            budget["householdId"].as_str(),
                            budget["month"].as_str(),
                            budget["categoryAccountId"].as_str(),
                            budget["budgetJpy"].as_i64(),
                            budget["createdAt"].as_str(),
                            budget["updatedAt"].as_str()
                        ],
                    )?;
                }
            }
            "SAVINGS_GOAL" => {
                connection.execute(
                    "INSERT INTO savings_goals(
                       id,household_id,name,target_jpy,saved_jpy,target_date,status,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
                     ON CONFLICT(id) DO UPDATE SET name=excluded.name,target_jpy=excluded.target_jpy,
                       saved_jpy=excluded.saved_jpy,target_date=excluded.target_date,
                       status=excluded.status,updated_at=excluded.updated_at",
                    rusqlite::params![
                        text("id"), text("householdId"), text("name"),
                        payload["targetJpy"].as_i64(), payload["savedJpy"].as_i64(),
                        text("targetDate"), text("status"), text("createdAt"), text("updatedAt")
                    ],
                )?;
            }
            "CLASSIFICATION_RULE" => {
                connection.execute(
                    "INSERT INTO classification_rules(
                       id,household_id,name,priority,is_enabled,merchant_contains,
                       description_contains,category_account_id,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                     ON CONFLICT(id) DO UPDATE SET name=excluded.name,priority=excluded.priority,
                       is_enabled=excluded.is_enabled,merchant_contains=excluded.merchant_contains,
                       description_contains=excluded.description_contains,
                       category_account_id=excluded.category_account_id,updated_at=excluded.updated_at",
                    rusqlite::params![
                        text("id"), text("householdId"), text("name"), payload["priority"].as_i64(),
                        payload["isEnabled"].as_i64(), text("merchantContains"),
                        text("descriptionContains"), text("categoryAccountId"),
                        text("createdAt"), text("updatedAt")
                    ],
                )?;
                connection.execute(
                    "DELETE FROM classification_rule_labels WHERE rule_id=?1",
                    [text("id")],
                )?;
                connection.execute(
                    "DELETE FROM classification_rule_tags WHERE rule_id=?1",
                    [text("id")],
                )?;
                for label in payload["labels"].as_array().unwrap() {
                    connection.execute(
                        "INSERT INTO classification_rule_labels VALUES(?1,?2)",
                        rusqlite::params![text("id"), label.as_str()],
                    )?;
                }
                for tag in payload["tags"].as_array().unwrap() {
                    connection.execute(
                        "INSERT INTO classification_rule_tags VALUES(?1,?2)",
                        rusqlite::params![text("id"), tag.as_str()],
                    )?;
                }
            }
            "ACCOUNT_GROUP" => {
                connection.execute(
                    "INSERT INTO account_groups(
                       id,household_id,name,group_kind,sort_order,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7)
                     ON CONFLICT(id) DO UPDATE SET name=excluded.name,group_kind=excluded.group_kind,
                       sort_order=excluded.sort_order,updated_at=excluded.updated_at",
                    rusqlite::params![
                        text("id"), text("householdId"), text("name"), text("groupKind"),
                        payload["sortOrder"].as_i64(), text("createdAt"), text("updatedAt")
                    ],
                )?;
                connection.execute(
                    "DELETE FROM account_group_members WHERE account_group_id=?1",
                    [text("id")],
                )?;
                for member in payload["members"].as_array().unwrap() {
                    connection.execute(
                        "INSERT INTO account_group_members(
                           household_id,account_group_id,account_id,sort_order) VALUES(?1,?2,?3,?4)",
                        rusqlite::params![
                            member["householdId"].as_str(), member["accountGroupId"].as_str(),
                            member["accountId"].as_str(), member["sortOrder"].as_i64()
                        ],
                    )?;
                }
            }
            "CARD_SETTLEMENT_MAPPING" => {
                connection.execute(
                    "INSERT INTO card_settlement_bank_mappings(
                       household_id,card_account_id,bank_account_id,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,?5)
                     ON CONFLICT(household_id,card_account_id) DO UPDATE SET
                       bank_account_id=excluded.bank_account_id,updated_at=excluded.updated_at",
                    rusqlite::params![
                        text("householdId"),
                        text("cardAccountId"),
                        text("bankAccountId"),
                        text("createdAt"),
                        text("updatedAt")
                    ],
                )?;
            }
            "DASHBOARD_PREFERENCES" => {
                connection.execute(
                    "INSERT INTO dashboard_preferences(
                       household_id,dashboard_template,theme,density,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,?5,?6)
                     ON CONFLICT(household_id) DO UPDATE SET
                       dashboard_template=excluded.dashboard_template,theme=excluded.theme,
                       density=excluded.density,updated_at=excluded.updated_at",
                    rusqlite::params![
                        text("householdId"),
                        text("dashboardTemplate"),
                        text("theme"),
                        text("density"),
                        text("createdAt"),
                        text("updatedAt")
                    ],
                )?;
            }
            "DELIMITED_PARSER_PROFILE" => {
                connection.execute(
                    "INSERT INTO delimited_parser_profiles(
                       id,household_id,name,delimiter,encoding,header_row,date_column,date_format,
                       description_column,payee_column,amount_mode,signed_positive_direction,
                       signed_amount_column,debit_column,credit_column,external_id_column,
                       account_hint_column,is_enabled,priority,version,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)
                     ON CONFLICT(id) DO UPDATE SET name=excluded.name,delimiter=excluded.delimiter,
                       encoding=excluded.encoding,header_row=excluded.header_row,
                       date_column=excluded.date_column,date_format=excluded.date_format,
                       description_column=excluded.description_column,payee_column=excluded.payee_column,
                       amount_mode=excluded.amount_mode,signed_positive_direction=excluded.signed_positive_direction,
                       signed_amount_column=excluded.signed_amount_column,debit_column=excluded.debit_column,
                       credit_column=excluded.credit_column,external_id_column=excluded.external_id_column,
                       account_hint_column=excluded.account_hint_column,is_enabled=excluded.is_enabled,
                       priority=excluded.priority,version=excluded.version,updated_at=excluded.updated_at",
                    rusqlite::params![
                        text("id"), text("householdId"), text("name"), text("delimiter"),
                        text("encoding"), payload["headerRow"].as_i64(), text("dateColumn"),
                        text("dateFormat"), text("descriptionColumn"), text("payeeColumn"),
                        text("amountMode"), text("signedPositiveDirection"), text("signedAmountColumn"),
                        text("debitColumn"), text("creditColumn"), text("externalIdColumn"),
                        text("accountHintColumn"), payload["isEnabled"].as_i64(),
                        payload["priority"].as_i64(), payload["version"].as_i64(),
                        text("createdAt"), text("updatedAt")
                    ],
                )?;
            }
            _ => return Err(rusqlite::Error::InvalidQuery),
        }
        Ok(())
    }

    #[test]
    fn restored_semantics_accept_complete_planning_captures_and_reject_malformed_payloads() {
        let state = AppState::in_memory(TEST_KEY).expect("migrations should apply");
        state
            .with_connection(|connection| {
                seed_complete_planning_config(connection)?;
                assert!(validate_restored_semantics(connection, 34).is_ok());

                connection.execute(
                    "UPDATE sync_local_change_capture
                     SET payload_json=json_set(payload_json,'$.budgets[0].budgetJpy',-1)
                     WHERE capture_sequence=(SELECT max(capture_sequence)
                       FROM sync_local_change_capture
                       WHERE entity_kind='MONTHLY_BUDGET_PLAN' AND entity_id='family')",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 34).is_err());
                connection.execute(
                    "UPDATE sync_local_change_capture
                     SET payload_json=(SELECT payload_json FROM sync_monthly_budget_plan_payloads
                                       WHERE household_id='family')
                     WHERE capture_sequence=(SELECT max(capture_sequence)
                       FROM sync_local_change_capture
                       WHERE entity_kind='MONTHLY_BUDGET_PLAN' AND entity_id='family')",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 34).is_ok());

                connection.execute(
                    "UPDATE sync_local_change_capture
                     SET payload_json=json_set(payload_json,'$.debitColumn','Debit')
                     WHERE capture_sequence=(SELECT max(capture_sequence)
                       FROM sync_local_change_capture
                       WHERE entity_kind='DELIMITED_PARSER_PROFILE' AND entity_id='profile')",
                    [],
                )?;
                assert!(validate_restored_semantics(connection, 34).is_err());
                Ok(())
            })
            .expect("restore validation should remain queryable");
    }

    #[test]
    fn planning_config_upserts_replay_into_second_production_schema() {
        let source = AppState::in_memory(TEST_KEY).expect("source schema");
        let envelopes = source
            .with_connection(|connection| {
                seed_complete_planning_config(connection)?;
                crate::sync_foundation::get_local_status(connection, "family").unwrap();
                Ok(
                    crate::sync_foundation::list_pending_envelopes(connection, "family", 100)
                        .unwrap()
                        .into_iter()
                        .filter(|item| {
                            matches!(
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
                        .collect::<Vec<_>>(),
                )
            })
            .unwrap();
        assert_eq!(envelopes.len(), 7);
        assert!(envelopes
            .windows(2)
            .all(|pair| pair[0].origin_sequence < pair[1].origin_sequence));

        let destination = AppState::in_memory(TEST_KEY).expect("destination schema");
        destination
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('family','Family');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                     VALUES('bank','family','Bank','ASSET','BANK'),
                           ('card','family','Card','LIABILITY','CREDIT_CARD'),
                           ('food','family','Food','EXPENSE','OTHER'),
                           ('travel','family','Travel','EXPENSE','OTHER');",
                )?;
                for envelope in &envelopes {
                    assert_eq!(envelope.operation, "UPSERT");
                    apply_planning_config_upsert(
                        connection,
                        &envelope.entity_kind,
                        &envelope.canonical_payload_json,
                    )?;
                }
                assert!(validate_restored_semantics(connection, 34).is_ok());
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*),sum(budget_jpy) FROM monthly_category_budgets
                         WHERE household_id='family'",
                        [],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                    )?,
                    (2, 80_000)
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT target_jpy||':'||saved_jpy||':'||status FROM savings_goals WHERE id='goal'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "500000:100000:ACTIVE"
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT
                           (SELECT group_concat(label,',') FROM classification_rule_labels WHERE rule_id='rule'),
                           (SELECT group_concat(tag,',') FROM classification_rule_tags WHERE rule_id='rule')",
                        [],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                    )?,
                    ("Recurring,Reviewed".to_owned(), "family,weekly".to_owned())
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT group_concat(account_id,',') FROM
                           (SELECT account_id FROM account_group_members
                            WHERE account_group_id='group' ORDER BY sort_order)",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "bank,food"
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT bank_account_id FROM card_settlement_bank_mappings
                         WHERE card_account_id='card'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "bank"
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT dashboard_template||':'||theme||':'||density
                         FROM dashboard_preferences WHERE household_id='family'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "CASH_FLOW:DARK:COMPACT"
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT amount_mode||':'||signed_positive_direction||':'||version
                         FROM delimited_parser_profiles WHERE id='profile'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "SIGNED:OUT:2"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn origin_qualified_evidence_aliases_accept_colliding_portable_ids() {
        let state = AppState::in_memory(TEST_KEY).unwrap();
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('family','Family');
                     INSERT INTO import_runs(id,household_id,status)
                     VALUES('local-run-a','family','POSTED'),('local-run-b','family','POSTED');
                     INSERT INTO source_documents(
                       id,household_id,import_run_id,source_type,original_filename,media_type,
                       byte_size,sha256,storage_path)
                     VALUES
                       ('local-doc-a','family','local-run-a','OTHER','a.csv','text/csv',1,
                        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','a'),
                       ('local-doc-b','family','local-run-b','OTHER','b.csv','text/csv',1,
                        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','b');
                     INSERT INTO source_records(
                       id,source_document_id,row_number,record_hash,raw_payload_json)
                     VALUES
                       ('local-row-a','local-doc-a',1,
                        '1111111111111111111111111111111111111111111111111111111111111111','{}'),
                       ('local-row-b','local-doc-b',1,
                        '2222222222222222222222222222222222222222222222222222222222222222','{}');
                     INSERT INTO evidence_import_run_aliases(
                       household_id,origin_installation_id,portable_import_run_id,local_import_run_id)
                     VALUES('family','origin-a','run-1','local-run-a'),
                           ('family','origin-b','run-1','local-run-b');
                     INSERT INTO evidence_source_document_aliases(
                       household_id,origin_installation_id,portable_document_id,
                       portable_import_run_id,local_document_id,content_sha256)
                     VALUES
                       ('family','origin-a','doc-1','run-1','local-doc-a',
                        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
                       ('family','origin-b','doc-1','run-1','local-doc-b',
                        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
                     INSERT INTO evidence_source_record_aliases(
                       household_id,origin_installation_id,portable_document_id,
                       portable_record_id,local_record_id,record_hash)
                     VALUES
                       ('family','origin-a','doc-1','row-1','local-row-a',
                        '1111111111111111111111111111111111111111111111111111111111111111'),
                       ('family','origin-b','doc-1','row-1','local-row-b',
                        '2222222222222222222222222222222222222222222222222222222222222222');",
                )?;
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM evidence_source_record_aliases
                         WHERE household_id='family' AND portable_record_id='row-1'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    2
                );
                assert!(connection
                    .execute(
                        "INSERT INTO evidence_source_document_aliases(
                           household_id,origin_installation_id,portable_document_id,
                           portable_import_run_id,local_document_id,content_sha256)
                         VALUES('family','origin-a','doc-1','run-1','local-doc-b',?1)",
                        ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
                    )
                    .is_err());
                Ok(())
            })
            .unwrap();
    }
}
