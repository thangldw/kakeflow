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
    fn in_memory(key: &[u8]) -> Result<Self, PersistenceError> {
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
        transaction.execute("DELETE FROM watched_folders", [])?;
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
    fn portable_restore_clears_device_local_watched_folder_grants() {
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
                connection.execute(
                    "INSERT INTO watched_folders (id, household_id, label, canonical_path) VALUES ('folder', 'family', 'Inbox', '/device/private/inbox')",
                    [],
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
        drop(connection);
        let _ = fs::remove_dir_all(test_directory);
    }
}
