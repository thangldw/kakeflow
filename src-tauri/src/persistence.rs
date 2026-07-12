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
    if cipher_version.as_deref().map_or(true, str::is_empty) {
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
                assert_eq!(schema_version(connection)?, 8);
                assert!(integrity_check(connection)?);
                Ok(())
            })
            .expect("database should remain readable");
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
}
