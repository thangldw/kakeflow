use crate::connector_control::ConnectorKind;
use rusqlite::{
    params, Connection, ErrorCode, OptionalExtension, Transaction, TransactionBehavior,
};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;
use thiserror::Error;

const MAX_HOUSEHOLD_ID_BYTES: usize = 128;
const MAX_CONNECTION_KEY_BYTES: usize = 128;
const MAX_ACCOUNT_ID_BYTES: usize = 64;
const MAX_PROFILE_ID_BYTES: usize = 64;
const MAX_ALLOWED_ACCOUNTS: usize = 256;
const MAX_SAFE_VERSION: u64 = 9_007_199_254_740_991;

#[derive(Debug, Error)]
pub enum ConnectorBindingError {
    #[error("invalid connector binding: {0}")]
    InvalidInput(&'static str),
    #[error("connector binding was not found")]
    NotFound,
    #[error("connector binding changed; reload it and try again")]
    Conflict,
    #[error("connector binding scope is invalid")]
    ScopeMismatch,
    #[error("connector binding account limit exceeded")]
    LimitExceeded,
    #[error("connector binding changed after review")]
    ImportBindingChanged,
    #[error("connector bindings are temporarily unavailable")]
    Database(#[source] rusqlite::Error),
}

impl ConnectorBindingError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput(message) => message,
            Self::NotFound => "The connector binding was not found",
            Self::Conflict => "The connector binding changed; reload it and try again",
            Self::ScopeMismatch => "The connector binding scope is invalid",
            Self::LimitExceeded => "A connector can allow at most 256 accounts",
            Self::ImportBindingChanged => {
                "The connector binding changed; reload and review the import"
            }
            Self::Database(_) => "Connector bindings are temporarily unavailable",
        }
    }
}

fn db_error(error: rusqlite::Error) -> ConnectorBindingError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == ErrorCode::ConstraintViolation =>
        {
            ConnectorBindingError::Conflict
        }
        _ => ConnectorBindingError::Database(error),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorBindingDto {
    pub household_id: String,
    pub connector_kind: ConnectorKind,
    pub connection_key: String,
    pub allowed_account_ids: Vec<String>,
    pub parser_profile_id: Option<String>,
    pub parser_profile_version: Option<u64>,
    pub version: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpsertConnectorBindingInput {
    pub household_id: String,
    pub connector_kind: ConnectorKind,
    pub connection_key: String,
    pub allowed_account_ids: Vec<String>,
    pub parser_profile_id: Option<String>,
    pub parser_profile_version: Option<u64>,
    pub expected_version: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeleteConnectorBindingInput {
    pub household_id: String,
    pub connector_kind: ConnectorKind,
    pub connection_key: String,
    pub expected_version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBindingExpectation {
    pub connector_kind: ConnectorKind,
    pub connection_key: String,
    pub version: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ConnectorKindInput {
    GoogleDrive,
    Gmail,
    WatchedFolder,
    ManualImport,
}

impl From<ConnectorKindInput> for ConnectorKind {
    fn from(value: ConnectorKindInput) -> Self {
        match value {
            ConnectorKindInput::GoogleDrive => Self::GoogleDrive,
            ConnectorKindInput::Gmail => Self::Gmail,
            ConnectorKindInput::WatchedFolder => Self::WatchedFolder,
            ConnectorKindInput::ManualImport => Self::ManualImport,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpsertConnectorBindingWire {
    household_id: String,
    connector_kind: ConnectorKindInput,
    connection_key: String,
    allowed_account_ids: Vec<String>,
    parser_profile_id: Option<String>,
    parser_profile_version: Option<u64>,
    expected_version: Option<u64>,
}

impl<'de> Deserialize<'de> for UpsertConnectorBindingInput {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = UpsertConnectorBindingWire::deserialize(deserializer)?;
        Ok(Self {
            household_id: wire.household_id,
            connector_kind: wire.connector_kind.into(),
            connection_key: wire.connection_key,
            allowed_account_ids: wire.allowed_account_ids,
            parser_profile_id: wire.parser_profile_id,
            parser_profile_version: wire.parser_profile_version,
            expected_version: wire.expected_version,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteConnectorBindingWire {
    household_id: String,
    connector_kind: ConnectorKindInput,
    connection_key: String,
    expected_version: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportBindingExpectationWire {
    connector_kind: ConnectorKindInput,
    connection_key: String,
    version: u64,
}

impl<'de> Deserialize<'de> for DeleteConnectorBindingInput {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = DeleteConnectorBindingWire::deserialize(deserializer)?;
        Ok(Self {
            household_id: wire.household_id,
            connector_kind: wire.connector_kind.into(),
            connection_key: wire.connection_key,
            expected_version: wire.expected_version,
        })
    }
}

impl<'de> Deserialize<'de> for ImportBindingExpectation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = ImportBindingExpectationWire::deserialize(deserializer)?;
        Ok(Self {
            connector_kind: wire.connector_kind.into(),
            connection_key: wire.connection_key,
            version: wire.version,
        })
    }
}

pub fn list_bindings(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<ConnectorBindingDto>, ConnectorBindingError> {
    validate_identifier(
        household_id,
        MAX_HOUSEHOLD_ID_BYTES,
        "Household ID is invalid",
    )?;
    ensure_household(connection, household_id)?;
    let mut statement = connection
        .prepare(
            "SELECT household_id,connector_kind,connection_key,parser_profile_id,
                    parser_profile_version,version,created_at,updated_at
             FROM connector_bindings WHERE household_id=?1
             ORDER BY CASE connector_kind
               WHEN 'GOOGLE_DRIVE' THEN 0 WHEN 'GMAIL' THEN 1
               WHEN 'WATCHED_FOLDER' THEN 2 ELSE 3 END, connection_key",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map([household_id], |row| {
            let kind: String = row.get(1)?;
            Ok((
                row.get::<_, String>(0)?,
                connector_kind_from_sql(&kind)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<u64>>(4)?,
                row.get::<_, u64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            ))
        })
        .map_err(db_error)?;
    rows.map(|row| {
        let (
            household_id,
            connector_kind,
            connection_key,
            parser_profile_id,
            parser_profile_version,
            version,
            created_at,
            updated_at,
        ) = row.map_err(db_error)?;
        let allowed_account_ids =
            load_account_ids(connection, &household_id, connector_kind, &connection_key)?;
        Ok(ConnectorBindingDto {
            household_id,
            connector_kind,
            connection_key,
            allowed_account_ids,
            parser_profile_id,
            parser_profile_version,
            version,
            created_at,
            updated_at,
        })
    })
    .collect()
}

pub fn upsert_binding(
    connection: &Connection,
    input: &UpsertConnectorBindingInput,
) -> Result<ConnectorBindingDto, ConnectorBindingError> {
    let account_ids = validate_upsert(input)?;
    let transaction =
        Transaction::new_unchecked(connection, TransactionBehavior::Immediate).map_err(db_error)?;
    validate_scope(
        &transaction,
        &input.household_id,
        input.connector_kind,
        &input.connection_key,
        &account_ids,
        input.parser_profile_id.as_deref(),
        input.parser_profile_version,
    )?;
    let existing_version = current_version(
        &transaction,
        &input.household_id,
        input.connector_kind,
        &input.connection_key,
    )?;
    match (existing_version, input.expected_version) {
        (None, None) => {
            transaction
                .execute(
                    "INSERT INTO connector_bindings
                       (household_id,connector_kind,connection_key,parser_profile_id,
                        parser_profile_version,version)
                     VALUES(?1,?2,?3,?4,?5,1)",
                    params![
                        input.household_id,
                        connector_kind_sql(input.connector_kind),
                        input.connection_key,
                        input.parser_profile_id,
                        input.parser_profile_version,
                    ],
                )
                .map_err(db_error)?;
        }
        (Some(_), None) => return Err(ConnectorBindingError::Conflict),
        (None, Some(_)) => return Err(ConnectorBindingError::NotFound),
        (Some(current), Some(expected)) if current != expected => {
            return Err(ConnectorBindingError::Conflict)
        }
        (Some(_), Some(expected)) => {
            let changed = transaction
                .execute(
                    "UPDATE connector_bindings SET parser_profile_id=?4,
                         parser_profile_version=?5,version=version+1,
                         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE household_id=?1 AND connector_kind=?2 AND connection_key=?3
                       AND version=?6",
                    params![
                        input.household_id,
                        connector_kind_sql(input.connector_kind),
                        input.connection_key,
                        input.parser_profile_id,
                        input.parser_profile_version,
                        expected,
                    ],
                )
                .map_err(db_error)?;
            if changed != 1 {
                return Err(ConnectorBindingError::Conflict);
            }
            transaction
                .execute(
                    "DELETE FROM connector_binding_accounts
                     WHERE household_id=?1 AND connector_kind=?2 AND connection_key=?3",
                    params![
                        input.household_id,
                        connector_kind_sql(input.connector_kind),
                        input.connection_key,
                    ],
                )
                .map_err(db_error)?;
        }
    }
    for account_id in account_ids {
        transaction
            .execute(
                "INSERT INTO connector_binding_accounts
                   (household_id,connector_kind,connection_key,account_id)
                 VALUES(?1,?2,?3,?4)",
                params![
                    input.household_id,
                    connector_kind_sql(input.connector_kind),
                    input.connection_key,
                    account_id,
                ],
            )
            .map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)?;
    get_binding(
        connection,
        &input.household_id,
        input.connector_kind,
        &input.connection_key,
    )
}

pub fn delete_binding(
    connection: &Connection,
    input: &DeleteConnectorBindingInput,
) -> Result<(), ConnectorBindingError> {
    validate_identity(
        &input.household_id,
        input.connector_kind,
        &input.connection_key,
    )?;
    validate_version(input.expected_version)?;
    let changed = connection
        .execute(
            "DELETE FROM connector_bindings
             WHERE household_id=?1 AND connector_kind=?2 AND connection_key=?3 AND version=?4",
            params![
                input.household_id,
                connector_kind_sql(input.connector_kind),
                input.connection_key,
                input.expected_version,
            ],
        )
        .map_err(db_error)?;
    if changed == 1 {
        return Ok(());
    }
    if current_version(
        connection,
        &input.household_id,
        input.connector_kind,
        &input.connection_key,
    )?
    .is_some()
    {
        Err(ConnectorBindingError::Conflict)
    } else {
        Err(ConnectorBindingError::NotFound)
    }
}

pub fn delete_active_binding(
    connection: &Connection,
    household_id: &str,
    connector_kind: ConnectorKind,
    connection_key: &str,
) -> Result<(), ConnectorBindingError> {
    validate_identity(household_id, connector_kind, connection_key)?;
    connection
        .execute(
            "DELETE FROM connector_bindings
             WHERE household_id=?1 AND connector_kind=?2 AND connection_key=?3",
            params![
                household_id,
                connector_kind_sql(connector_kind),
                connection_key
            ],
        )
        .map_err(db_error)?;
    Ok(())
}

pub fn review_binding_expectation(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<ImportBindingExpectation>, ConnectorBindingError> {
    validate_identifier(run_id, MAX_CONNECTION_KEY_BYTES, "Import run ID is invalid")?;
    let household_id: String = connection
        .query_row(
            "SELECT household_id FROM import_runs WHERE id=?1",
            [run_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?
        .ok_or(ConnectorBindingError::ImportBindingChanged)?;
    let Some((connector_kind, connection_key)) =
        resolve_run_connector(connection, run_id, &household_id)?
    else {
        return Ok(None);
    };
    Ok(
        load_binding_optional(connection, &household_id, connector_kind, &connection_key)?.map(
            |binding| ImportBindingExpectation {
                connector_kind,
                connection_key,
                version: binding.version,
            },
        ),
    )
}

pub fn validate_import_binding_at_review(
    connection: &Connection,
    run_id: &str,
    expected: Option<&ImportBindingExpectation>,
) -> Result<(), ConnectorBindingError> {
    validate_identifier(run_id, MAX_CONNECTION_KEY_BYTES, "Import run ID is invalid")?;
    let (household_id, adapter_id, adapter_version): (String, Option<String>, Option<String>) =
        connection
            .query_row(
                "SELECT household_id,adapter_id,adapter_version FROM import_runs WHERE id=?1",
                [run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(db_error)?
            .ok_or(ConnectorBindingError::ImportBindingChanged)?;
    let resolved = resolve_run_connector(connection, run_id, &household_id)?;
    let Some((connector_kind, connection_key)) = resolved else {
        return if expected.is_none() {
            Ok(())
        } else {
            Err(ConnectorBindingError::ImportBindingChanged)
        };
    };
    if let Some(expected) = expected {
        validate_identity(
            &household_id,
            expected.connector_kind,
            &expected.connection_key,
        )?;
        validate_version(expected.version)?;
        if expected.connector_kind != connector_kind || expected.connection_key != connection_key {
            return Err(ConnectorBindingError::ImportBindingChanged);
        }
    }
    let binding =
        load_binding_optional(connection, &household_id, connector_kind, &connection_key)?;
    let Some(binding) = binding else {
        return if expected.is_none() {
            Ok(())
        } else {
            Err(ConnectorBindingError::ImportBindingChanged)
        };
    };
    let Some(expected) = expected else {
        return Err(ConnectorBindingError::ImportBindingChanged);
    };
    if binding.version != expected.version {
        return Err(ConnectorBindingError::ImportBindingChanged);
    }
    if binding.allowed_account_ids.is_empty()
        || !connector_exists(connection, &household_id, connector_kind, &connection_key)?
    {
        return Err(ConnectorBindingError::ImportBindingChanged);
    }
    for account_id in &binding.allowed_account_ids {
        if !active_account_exists(connection, &household_id, account_id)? {
            return Err(ConnectorBindingError::ImportBindingChanged);
        }
    }
    let invalid_candidate: bool = connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM transaction_candidates tc
               WHERE tc.review_status IN ('PENDING','READY')
                 AND EXISTS(
                   SELECT 1 FROM candidate_sources cs
                   JOIN source_records sr ON sr.id=cs.source_record_id
                   JOIN source_documents sd ON sd.id=sr.source_document_id
                   WHERE cs.candidate_id=tc.id AND sd.import_run_id=?1
                     AND sd.household_id=?2
                 )
                 AND (tc.household_id!=?2 OR tc.account_id IS NULL OR NOT EXISTS(
                   SELECT 1 FROM connector_binding_accounts a
                   WHERE a.household_id=?2 AND a.connector_kind=?3 AND a.connection_key=?4
                     AND a.account_id=tc.account_id
                 ))
             )",
            params![
                run_id,
                household_id,
                connector_kind_sql(connector_kind),
                connection_key,
            ],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if invalid_candidate {
        return Err(ConnectorBindingError::ImportBindingChanged);
    }
    if let (Some(profile_id), Some(profile_version)) = (
        binding.parser_profile_id.as_deref(),
        binding.parser_profile_version,
    ) {
        let current_profile: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM delimited_parser_profiles
                   WHERE id=?1 AND household_id=?2 AND version=?3 AND is_enabled=1
                 )",
                params![profile_id, household_id, profile_version],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        if !current_profile
            || adapter_id.as_deref() != Some("custom-delimited-v1")
            || adapter_version.as_deref()
                != Some(format!("{profile_id}@{profile_version}").as_str())
        {
            return Err(ConnectorBindingError::ImportBindingChanged);
        }
    }
    Ok(())
}

fn resolve_run_connector(
    connection: &Connection,
    run_id: &str,
    household_id: &str,
) -> Result<Option<(ConnectorKind, String)>, ConnectorBindingError> {
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT household_id,source_type FROM source_documents
             WHERE import_run_id=?1 ORDER BY household_id,source_type",
        )
        .map_err(db_error)?;
    let source_scopes = statement
        .query_map([run_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    if source_scopes.len() != 1 || source_scopes[0].0 != household_id {
        return Err(ConnectorBindingError::ImportBindingChanged);
    }
    match source_scopes[0].1.as_str() {
        "MANUAL_UPLOAD" => Ok(Some((ConnectorKind::ManualImport, "manual-import".into()))),
        "GOOGLE_DRIVE" => resolve_native_key(
            connection,
            "google_drive_inbox",
            "connection_id",
            ConnectorKind::GoogleDrive,
            run_id,
            household_id,
        ),
        "GMAIL" => resolve_native_key(
            connection,
            "gmail_inbox",
            "connection_id",
            ConnectorKind::Gmail,
            run_id,
            household_id,
        ),
        "LOCAL_FOLDER" | "ICLOUD_PICKER" => resolve_native_key(
            connection,
            "watched_file_inbox",
            "watched_folder_id",
            ConnectorKind::WatchedFolder,
            run_id,
            household_id,
        ),
        _ => Ok(None),
    }
}

fn resolve_native_key(
    connection: &Connection,
    table: &str,
    key_column: &str,
    kind: ConnectorKind,
    run_id: &str,
    household_id: &str,
) -> Result<Option<(ConnectorKind, String)>, ConnectorBindingError> {
    let query = format!(
        "SELECT DISTINCT {key_column} FROM {table}
         WHERE import_run_id=?1 AND household_id=?2 AND state='STAGED'
         ORDER BY {key_column} LIMIT 2"
    );
    let mut statement = connection.prepare(&query).map_err(db_error)?;
    let keys = statement
        .query_map(params![run_id, household_id], |row| row.get::<_, String>(0))
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    match keys.as_slice() {
        [key] => Ok(Some((kind, key.clone()))),
        _ => Err(ConnectorBindingError::ImportBindingChanged),
    }
}

fn validate_upsert(
    input: &UpsertConnectorBindingInput,
) -> Result<Vec<String>, ConnectorBindingError> {
    validate_identity(
        &input.household_id,
        input.connector_kind,
        &input.connection_key,
    )?;
    if input.allowed_account_ids.is_empty() {
        return Err(ConnectorBindingError::InvalidInput(
            "Choose at least one allowed account",
        ));
    }
    if input.allowed_account_ids.len() > MAX_ALLOWED_ACCOUNTS {
        return Err(ConnectorBindingError::LimitExceeded);
    }
    if input.parser_profile_id.is_some() != input.parser_profile_version.is_some() {
        return Err(ConnectorBindingError::InvalidInput(
            "Parser profile ID and version must be provided together",
        ));
    }
    if let Some(profile_id) = input.parser_profile_id.as_deref() {
        validate_identifier(
            profile_id,
            MAX_PROFILE_ID_BYTES,
            "Parser profile ID is invalid",
        )?;
    }
    if let Some(version) = input.parser_profile_version {
        validate_version(version)?;
    }
    if let Some(version) = input.expected_version {
        validate_version(version)?;
        if version == MAX_SAFE_VERSION {
            return Err(ConnectorBindingError::Conflict);
        }
    }
    let mut account_ids = BTreeSet::new();
    for account_id in &input.allowed_account_ids {
        validate_identifier(account_id, MAX_ACCOUNT_ID_BYTES, "Account ID is invalid")?;
        if !account_ids.insert(account_id.clone()) {
            return Err(ConnectorBindingError::InvalidInput(
                "Allowed account IDs must be unique",
            ));
        }
    }
    Ok(account_ids.into_iter().collect())
}

fn validate_identity(
    household_id: &str,
    connector_kind: ConnectorKind,
    connection_key: &str,
) -> Result<(), ConnectorBindingError> {
    validate_identifier(
        household_id,
        MAX_HOUSEHOLD_ID_BYTES,
        "Household ID is invalid",
    )?;
    validate_identifier(
        connection_key,
        MAX_CONNECTION_KEY_BYTES,
        "Connection key is invalid",
    )?;
    if connector_kind == ConnectorKind::ManualImport && connection_key != "manual-import" {
        return Err(ConnectorBindingError::InvalidInput(
            "Manual import connection key is invalid",
        ));
    }
    Ok(())
}

fn validate_identifier(
    value: &str,
    maximum: usize,
    message: &'static str,
) -> Result<(), ConnectorBindingError> {
    if value.is_empty()
        || value.len() > maximum
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(ConnectorBindingError::InvalidInput(message));
    }
    Ok(())
}

fn validate_version(version: u64) -> Result<(), ConnectorBindingError> {
    if version == 0 || version > MAX_SAFE_VERSION {
        return Err(ConnectorBindingError::InvalidInput("Version is invalid"));
    }
    Ok(())
}

fn validate_scope(
    connection: &Connection,
    household_id: &str,
    connector_kind: ConnectorKind,
    connection_key: &str,
    account_ids: &[String],
    parser_profile_id: Option<&str>,
    parser_profile_version: Option<u64>,
) -> Result<(), ConnectorBindingError> {
    ensure_household(connection, household_id)?;
    if !connector_exists(connection, household_id, connector_kind, connection_key)? {
        return Err(ConnectorBindingError::ScopeMismatch);
    }
    for account_id in account_ids {
        if !active_account_exists(connection, household_id, account_id)? {
            return Err(ConnectorBindingError::ScopeMismatch);
        }
    }
    if let (Some(profile_id), Some(profile_version)) = (parser_profile_id, parser_profile_version) {
        let profile_exists: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM delimited_parser_profiles
                   WHERE id=?1 AND household_id=?2 AND version=?3 AND is_enabled=1
                 )",
                params![profile_id, household_id, profile_version],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        if !profile_exists {
            return Err(ConnectorBindingError::ScopeMismatch);
        }
    }
    Ok(())
}

fn ensure_household(
    connection: &Connection,
    household_id: &str,
) -> Result<(), ConnectorBindingError> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM households WHERE id=?1)",
            [household_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if exists {
        Ok(())
    } else {
        Err(ConnectorBindingError::ScopeMismatch)
    }
}

fn active_account_exists(
    connection: &Connection,
    household_id: &str,
    account_id: &str,
) -> Result<bool, ConnectorBindingError> {
    connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM accounts
               WHERE id=?1 AND household_id=?2 AND is_archived=0
             )",
            params![account_id, household_id],
            |row| row.get(0),
        )
        .map_err(db_error)
}

fn connector_exists(
    connection: &Connection,
    household_id: &str,
    connector_kind: ConnectorKind,
    connection_key: &str,
) -> Result<bool, ConnectorBindingError> {
    if connector_kind == ConnectorKind::ManualImport {
        return Ok(connection_key == "manual-import");
    }
    let (table, key_column) = match connector_kind {
        ConnectorKind::GoogleDrive => ("google_drive_connections", "id"),
        ConnectorKind::Gmail => ("gmail_connections", "id"),
        ConnectorKind::WatchedFolder => ("watched_folders", "id"),
        ConnectorKind::ManualImport => unreachable!(),
    };
    let query =
        format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE {key_column}=?1 AND household_id=?2)");
    connection
        .query_row(&query, params![connection_key, household_id], |row| {
            row.get(0)
        })
        .map_err(db_error)
}

fn current_version(
    connection: &Connection,
    household_id: &str,
    connector_kind: ConnectorKind,
    connection_key: &str,
) -> Result<Option<u64>, ConnectorBindingError> {
    connection
        .query_row(
            "SELECT version FROM connector_bindings
             WHERE household_id=?1 AND connector_kind=?2 AND connection_key=?3",
            params![
                household_id,
                connector_kind_sql(connector_kind),
                connection_key
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)
}

fn get_binding(
    connection: &Connection,
    household_id: &str,
    connector_kind: ConnectorKind,
    connection_key: &str,
) -> Result<ConnectorBindingDto, ConnectorBindingError> {
    load_binding_optional(connection, household_id, connector_kind, connection_key)?
        .ok_or(ConnectorBindingError::NotFound)
}

fn load_binding_optional(
    connection: &Connection,
    household_id: &str,
    connector_kind: ConnectorKind,
    connection_key: &str,
) -> Result<Option<ConnectorBindingDto>, ConnectorBindingError> {
    let row = connection
        .query_row(
            "SELECT parser_profile_id,parser_profile_version,version,created_at,updated_at
             FROM connector_bindings
             WHERE household_id=?1 AND connector_kind=?2 AND connection_key=?3",
            params![
                household_id,
                connector_kind_sql(connector_kind),
                connection_key
            ],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<u64>>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()
        .map_err(db_error)?;
    let Some((parser_profile_id, parser_profile_version, version, created_at, updated_at)) = row
    else {
        return Ok(None);
    };
    Ok(Some(ConnectorBindingDto {
        household_id: household_id.into(),
        connector_kind,
        connection_key: connection_key.into(),
        allowed_account_ids: load_account_ids(
            connection,
            household_id,
            connector_kind,
            connection_key,
        )?,
        parser_profile_id,
        parser_profile_version,
        version,
        created_at,
        updated_at,
    }))
}

fn load_account_ids(
    connection: &Connection,
    household_id: &str,
    connector_kind: ConnectorKind,
    connection_key: &str,
) -> Result<Vec<String>, ConnectorBindingError> {
    let mut statement = connection
        .prepare(
            "SELECT account_id FROM connector_binding_accounts
             WHERE household_id=?1 AND connector_kind=?2 AND connection_key=?3
             ORDER BY account_id",
        )
        .map_err(db_error)?;
    let account_ids = statement
        .query_map(
            params![
                household_id,
                connector_kind_sql(connector_kind),
                connection_key
            ],
            |row| row.get(0),
        )
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    Ok(account_ids)
}

fn connector_kind_sql(kind: ConnectorKind) -> &'static str {
    match kind {
        ConnectorKind::GoogleDrive => "GOOGLE_DRIVE",
        ConnectorKind::Gmail => "GMAIL",
        ConnectorKind::WatchedFolder => "WATCHED_FOLDER",
        ConnectorKind::ManualImport => "MANUAL_IMPORT",
    }
}

fn connector_kind_from_sql(value: &str) -> rusqlite::Result<ConnectorKind> {
    match value {
        "GOOGLE_DRIVE" => Ok(ConnectorKind::GoogleDrive),
        "GMAIL" => Ok(ConnectorKind::Gmail),
        "WATCHED_FOLDER" => Ok(ConnectorKind::WatchedFolder),
        "MANUAL_IMPORT" => Ok(ConnectorKind::ManualImport),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        connector_control::ConnectorKind, gmail_store, google_drive_command_service,
        persistence::AppState, watched_folders,
    };
    use rusqlite::{params, Connection};

    const TEST_KEY: &[u8] = b"connector-binding-test-key-material-32";
    const HASH_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const HASH_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn with_database(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(TEST_KEY).expect("migrate binding database");
        state
            .with_connection(|connection| {
                seed_control_plane(connection);
                test(connection);
                Ok(())
            })
            .expect("run binding test");
    }

    fn validate_import_binding(
        connection: &Connection,
        run_id: &str,
    ) -> Result<(), ConnectorBindingError> {
        let expected = review_binding_expectation(connection, run_id)?;
        validate_import_binding_at_review(connection, run_id, expected.as_ref())
    }

    fn seed_control_plane(connection: &Connection) {
        connection
            .execute_batch(&format!(
                "INSERT INTO households(id,name) VALUES('family','Family'),('other','Other');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,is_archived)
                 VALUES('bank','family','Bank','ASSET','BANK',0),
                       ('reserve','family','Reserve','ASSET','BANK',0),
                       ('expense','family','Expense','EXPENSE','OTHER',0),
                       ('archived','family','Archived','ASSET','BANK',1),
                       ('other-bank','other','Other bank','ASSET','BANK',0);
                 INSERT INTO google_drive_connections(id,household_id,client_id_fingerprint,status)
                 VALUES('drive','family','{HASH_A}','AUTHORIZING'),
                       ('other-drive','other','{HASH_B}','AUTHORIZING');
                 INSERT INTO gmail_connections(id,household_id,client_id_fingerprint,status)
                 VALUES('gmail','family','{HASH_A}','AUTHORIZING');
                 INSERT INTO watched_folders(id,household_id,label,canonical_path,source_type,provider)
                 VALUES('folder','family','Inbox','/device/inbox','LOCAL_FOLDER','LOCAL');
                 INSERT INTO delimited_parser_profiles
                   (id,household_id,name,delimiter,encoding,header_row,date_column,date_format,
                    description_column,amount_mode,signed_positive_direction,signed_amount_column,
                    is_enabled,priority,version)
                 VALUES('profile','family','Bank CSV','COMMA','UTF8',1,'date','YYYY_MM_DD',
                        'description','SIGNED','OUT','amount',1,1,1),
                       ('other-profile','other','Other CSV','COMMA','UTF8',1,'date','YYYY_MM_DD',
                        'description','SIGNED','OUT','amount',1,1,1);"
            ))
            .expect("seed connector control plane");
    }

    fn input(kind: ConnectorKind, key: &str, accounts: Vec<String>) -> UpsertConnectorBindingInput {
        UpsertConnectorBindingInput {
            household_id: "family".into(),
            connector_kind: kind,
            connection_key: key.into(),
            allowed_account_ids: accounts,
            parser_profile_id: None,
            parser_profile_version: None,
            expected_version: None,
        }
    }

    #[test]
    fn allowed_accounts_are_explicit_unique_and_bounded_at_256() {
        with_database(|connection| {
            let one = upsert_binding(
                connection,
                &input(
                    ConnectorKind::ManualImport,
                    "manual-import",
                    vec!["bank".into()],
                ),
            )
            .expect("one account is valid");
            assert_eq!(one.allowed_account_ids, vec!["bank"]);

            assert!(matches!(
                upsert_binding(
                    connection,
                    &input(ConnectorKind::GoogleDrive, "drive", Vec::new())
                ),
                Err(ConnectorBindingError::InvalidInput(_))
            ));
            assert!(matches!(
                upsert_binding(
                    connection,
                    &input(
                        ConnectorKind::GoogleDrive,
                        "drive",
                        vec!["bank".into(), "bank".into()],
                    )
                ),
                Err(ConnectorBindingError::InvalidInput(_))
            ));

            let mut account_ids = Vec::new();
            for index in 0..256 {
                let account_id = format!("account-{index:03}");
                connection
                    .execute(
                        "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                         VALUES(?1,'family',?2,'ASSET','BANK')",
                        params![account_id, format!("Account {index:03}")],
                    )
                    .unwrap();
                account_ids.push(account_id);
            }
            let maximum = upsert_binding(
                connection,
                &input(ConnectorKind::GoogleDrive, "drive", account_ids.clone()),
            )
            .expect("256 accounts are valid");
            assert_eq!(maximum.allowed_account_ids.len(), 256);

            connection
                .execute(
                    "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                     VALUES('account-256','family','Account 256','ASSET','BANK')",
                    [],
                )
                .unwrap();
            account_ids.push("account-256".into());
            assert!(matches!(
                upsert_binding(
                    connection,
                    &input(ConnectorKind::Gmail, "gmail", account_ids)
                ),
                Err(ConnectorBindingError::LimitExceeded)
            ));
        });
    }

    #[test]
    fn create_update_and_delete_are_optimistically_versioned() {
        with_database(|connection| {
            let created = upsert_binding(
                connection,
                &input(
                    ConnectorKind::ManualImport,
                    "manual-import",
                    vec!["bank".into()],
                ),
            )
            .unwrap();
            assert_eq!(created.version, 1);
            assert_eq!(
                list_bindings(connection, "family").unwrap(),
                vec![created.clone()]
            );

            assert!(matches!(
                upsert_binding(
                    connection,
                    &input(
                        ConnectorKind::ManualImport,
                        "manual-import",
                        vec!["reserve".into()],
                    )
                ),
                Err(ConnectorBindingError::Conflict)
            ));

            let mut update = input(
                ConnectorKind::ManualImport,
                "manual-import",
                vec!["reserve".into()],
            );
            update.expected_version = Some(1);
            let updated = upsert_binding(connection, &update).unwrap();
            assert_eq!(updated.version, 2);
            assert_eq!(updated.allowed_account_ids, vec!["reserve"]);
            assert!(matches!(
                upsert_binding(connection, &update),
                Err(ConnectorBindingError::Conflict)
            ));

            let stale_delete = DeleteConnectorBindingInput {
                household_id: "family".into(),
                connector_kind: ConnectorKind::ManualImport,
                connection_key: "manual-import".into(),
                expected_version: 1,
            };
            assert!(matches!(
                delete_binding(connection, &stale_delete),
                Err(ConnectorBindingError::Conflict)
            ));
            delete_binding(
                connection,
                &DeleteConnectorBindingInput {
                    expected_version: 2,
                    ..stale_delete.clone()
                },
            )
            .unwrap();
            assert!(list_bindings(connection, "family").unwrap().is_empty());
            assert!(matches!(
                delete_binding(
                    connection,
                    &DeleteConnectorBindingInput {
                        expected_version: 2,
                        ..stale_delete
                    }
                ),
                Err(ConnectorBindingError::NotFound)
            ));
        });
    }

    #[test]
    fn account_connector_and_parser_scope_is_fail_closed() {
        with_database(|connection| {
            for (mut value, expected) in [
                (
                    input(
                        ConnectorKind::ManualImport,
                        "manual-import",
                        vec!["archived".into()],
                    ),
                    "archived account",
                ),
                (
                    input(
                        ConnectorKind::ManualImport,
                        "manual-import",
                        vec!["other-bank".into()],
                    ),
                    "cross-household account",
                ),
                (
                    input(
                        ConnectorKind::GoogleDrive,
                        "other-drive",
                        vec!["bank".into()],
                    ),
                    "cross-household connector",
                ),
                (
                    input(
                        ConnectorKind::GoogleDrive,
                        "missing-drive",
                        vec!["bank".into()],
                    ),
                    "unknown connector",
                ),
            ] {
                assert!(
                    matches!(
                        upsert_binding(connection, &value),
                        Err(ConnectorBindingError::ScopeMismatch)
                    ),
                    "{expected}"
                );
                value.expected_version = Some(1);
            }

            let mut profile = input(
                ConnectorKind::ManualImport,
                "manual-import",
                vec!["bank".into()],
            );
            profile.parser_profile_id = Some("other-profile".into());
            profile.parser_profile_version = Some(1);
            assert!(matches!(
                upsert_binding(connection, &profile),
                Err(ConnectorBindingError::ScopeMismatch)
            ));

            profile.parser_profile_id = Some("profile".into());
            profile.parser_profile_version = None;
            assert!(matches!(
                upsert_binding(connection, &profile),
                Err(ConnectorBindingError::InvalidInput(_))
            ));
        });
    }

    #[test]
    fn schema_triggers_reject_cross_scope_connector_profile_and_account_rows() {
        with_database(|connection| {
            assert!(connection
                .execute(
                    "INSERT INTO connector_bindings
                       (household_id,connector_kind,connection_key,version)
                     VALUES('family','GOOGLE_DRIVE','other-drive',1)",
                    [],
                )
                .is_err());
            assert!(connection
                .execute(
                    "INSERT INTO connector_bindings
                       (household_id,connector_kind,connection_key,parser_profile_id,
                        parser_profile_version,version)
                     VALUES('family','MANUAL_IMPORT','manual-import','other-profile',1,1)",
                    [],
                )
                .is_err());
            connection
                .execute(
                    "INSERT INTO connector_bindings
                       (household_id,connector_kind,connection_key,version)
                     VALUES('family','MANUAL_IMPORT','manual-import',1)",
                    [],
                )
                .unwrap();
            for account_id in ["other-bank", "archived"] {
                assert!(connection
                    .execute(
                        "INSERT INTO connector_binding_accounts
                           (household_id,connector_kind,connection_key,account_id)
                         VALUES('family','MANUAL_IMPORT','manual-import',?1)",
                        [account_id],
                    )
                    .is_err());
            }
            connection
                .execute(
                    "INSERT INTO connector_binding_accounts
                       (household_id,connector_kind,connection_key,account_id)
                     VALUES('family','MANUAL_IMPORT','manual-import','bank')",
                    [],
                )
                .unwrap();
            assert!(connection
                .execute(
                    "UPDATE connector_bindings SET version=3
                     WHERE household_id='family' AND connector_kind='MANUAL_IMPORT'
                       AND connection_key='manual-import'",
                    [],
                )
                .is_err());
        });
    }

    #[test]
    fn binding_account_identity_update_cannot_bypass_the_256_account_limit() {
        with_database(|connection| {
            connection
                .execute_batch(
                    "INSERT INTO connector_bindings
                       (household_id,connector_kind,connection_key,version)
                     VALUES('family','GOOGLE_DRIVE','drive',1),
                           ('family','MANUAL_IMPORT','manual-import',1);",
                )
                .unwrap();
            for index in 0..257 {
                let account_id = format!("move-account-{index:03}");
                connection
                    .execute(
                        "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                         VALUES(?1,'family',?2,'ASSET','BANK')",
                        params![account_id, format!("Move account {index:03}")],
                    )
                    .unwrap();
                let (kind, key) = if index < 256 {
                    ("GOOGLE_DRIVE", "drive")
                } else {
                    ("MANUAL_IMPORT", "manual-import")
                };
                connection
                    .execute(
                        "INSERT INTO connector_binding_accounts
                           (household_id,connector_kind,connection_key,account_id)
                         VALUES('family',?1,?2,?3)",
                        params![kind, key, account_id],
                    )
                    .unwrap();
            }

            let moved = connection.execute(
                "UPDATE connector_binding_accounts
                 SET connector_kind='GOOGLE_DRIVE',connection_key='drive'
                 WHERE household_id='family' AND connector_kind='MANUAL_IMPORT'
                   AND connection_key='manual-import' AND account_id='move-account-256'",
                [],
            );
            assert!(moved.is_err(), "binding account identity must be immutable");
            assert_eq!(
                connection
                    .query_row(
                        "SELECT count(*) FROM connector_binding_accounts
                         WHERE household_id='family' AND connector_kind='GOOGLE_DRIVE'
                           AND connection_key='drive'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                256
            );
            assert_eq!(
                connection
                    .query_row(
                        "SELECT count(*) FROM connector_binding_accounts
                         WHERE household_id='family' AND connector_kind='MANUAL_IMPORT'
                           AND connection_key='manual-import'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                1
            );
        });
    }

    #[test]
    fn staged_source_links_resolve_all_connector_kinds_exactly() {
        with_database(|connection| {
            for (kind, key) in [
                (ConnectorKind::GoogleDrive, "drive"),
                (ConnectorKind::Gmail, "gmail"),
                (ConnectorKind::WatchedFolder, "folder"),
                (ConnectorKind::ManualImport, "manual-import"),
            ] {
                upsert_binding(connection, &input(kind, key, vec!["bank".into()])).unwrap();
            }
            seed_import_run(connection, "drive-run", "GOOGLE_DRIVE", "bank", '1');
            seed_import_run(connection, "gmail-run", "GMAIL", "bank", '2');
            seed_import_run(connection, "folder-run", "LOCAL_FOLDER", "bank", '3');
            seed_import_run(connection, "manual-run", "MANUAL_UPLOAD", "bank", '4');
            seed_staged_inbox_links(connection);

            for run in ["drive-run", "gmail-run", "folder-run", "manual-run"] {
                validate_import_binding(connection, run).expect(run);
            }

            connection
                .execute(
                    "UPDATE transaction_candidates SET account_id='reserve'
                     WHERE id='gmail-run-candidate'",
                    [],
                )
                .unwrap();
            assert!(matches!(
                validate_import_binding(connection, "gmail-run"),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));
            connection
                .execute(
                    "UPDATE transaction_candidates SET account_id='bank'
                     WHERE id='gmail-run-candidate'",
                    [],
                )
                .unwrap();
            connection
                .execute("UPDATE accounts SET is_archived=1 WHERE id='bank'", [])
                .unwrap();
            assert!(matches!(
                validate_import_binding(connection, "manual-run"),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));
        });
    }

    #[test]
    fn reviewed_binding_version_fails_closed_after_update_or_delete() {
        with_database(|connection| {
            let created = upsert_binding(
                connection,
                &input(
                    ConnectorKind::ManualImport,
                    "manual-import",
                    vec!["bank".into()],
                ),
            )
            .unwrap();
            seed_import_run(connection, "reviewed-run", "MANUAL_UPLOAD", "bank", '9');
            let expected = review_binding_expectation(connection, "reviewed-run")
                .unwrap()
                .expect("bound review expectation");
            assert_eq!(expected.version, created.version);
            validate_import_binding_at_review(connection, "reviewed-run", Some(&expected)).unwrap();

            delete_active_binding(
                connection,
                "family",
                ConnectorKind::ManualImport,
                "manual-import",
            )
            .unwrap();
            assert!(matches!(
                validate_import_binding_at_review(connection, "reviewed-run", Some(&expected)),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));

            let recreated = upsert_binding(
                connection,
                &input(
                    ConnectorKind::ManualImport,
                    "manual-import",
                    vec!["bank".into()],
                ),
            )
            .unwrap();
            let mut update = input(
                ConnectorKind::ManualImport,
                "manual-import",
                vec!["bank".into()],
            );
            update.expected_version = Some(recreated.version);
            upsert_binding(connection, &update).unwrap();
            assert!(matches!(
                validate_import_binding_at_review(connection, "reviewed-run", Some(&expected)),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));
        });
    }

    #[test]
    fn unbound_manual_review_remains_valid_but_cannot_ignore_a_later_binding() {
        with_database(|connection| {
            seed_import_run(connection, "unbound-run", "MANUAL_UPLOAD", "bank", '0');
            assert_eq!(
                review_binding_expectation(connection, "unbound-run").unwrap(),
                None
            );
            validate_import_binding_at_review(connection, "unbound-run", None).unwrap();

            upsert_binding(
                connection,
                &input(
                    ConnectorKind::ManualImport,
                    "manual-import",
                    vec!["bank".into()],
                ),
            )
            .unwrap();
            assert!(matches!(
                validate_import_binding_at_review(connection, "unbound-run", None),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));
        });
    }

    #[test]
    fn reviewed_binding_expectation_is_identity_exact_and_version_bounded() {
        with_database(|connection| {
            upsert_binding(
                connection,
                &input(
                    ConnectorKind::ManualImport,
                    "manual-import",
                    vec!["bank".into()],
                ),
            )
            .unwrap();
            seed_import_run(connection, "bounded-run", "MANUAL_UPLOAD", "bank", '7');
            for expected in [
                ImportBindingExpectation {
                    connector_kind: ConnectorKind::Gmail,
                    connection_key: "manual-import".into(),
                    version: 1,
                },
                ImportBindingExpectation {
                    connector_kind: ConnectorKind::ManualImport,
                    connection_key: "other".into(),
                    version: 1,
                },
                ImportBindingExpectation {
                    connector_kind: ConnectorKind::ManualImport,
                    connection_key: "manual-import".into(),
                    version: 0,
                },
                ImportBindingExpectation {
                    connector_kind: ConnectorKind::ManualImport,
                    connection_key: "manual-import".into(),
                    version: MAX_SAFE_VERSION + 1,
                },
            ] {
                assert!(validate_import_binding_at_review(
                    connection,
                    "bounded-run",
                    Some(&expected)
                )
                .is_err());
            }
        });
    }

    #[test]
    fn missing_or_ambiguous_native_inbox_links_fail_closed() {
        with_database(|connection| {
            seed_import_run(connection, "missing-link-run", "GOOGLE_DRIVE", "bank", '6');
            assert!(matches!(
                validate_import_binding(connection, "missing-link-run"),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));

            seed_import_run(
                connection,
                "ambiguous-link-run",
                "GOOGLE_DRIVE",
                "bank",
                '7',
            );
            connection
                .execute(
                    "INSERT INTO google_drive_connections
                       (id,household_id,client_id_fingerprint,status)
                     VALUES('drive-two','family',?1,'AUTHORIZING')",
                    [HASH_B],
                )
                .unwrap();
            connection
                .execute_batch(&format!(
                    "INSERT INTO google_drive_nodes
                       (connection_id,file_id,name,mime_type,generation_fingerprint,is_folder,can_download)
                     VALUES('drive','ambiguous-one','one.csv','text/csv','{first}',0,1),
                           ('drive-two','ambiguous-two','two.csv','text/csv','{second}',0,1);
                     INSERT INTO google_drive_inbox
                       (id,household_id,connection_id,file_id,generation_fingerprint,file_name,
                        media_type,content_sha256,state,import_run_id)
                     VALUES('{first}','family','drive','ambiguous-one','{first}','one.csv',
                            'text/csv','{source_sha}','STAGED','ambiguous-link-run'),
                           ('{second}','family','drive-two','ambiguous-two','{second}','two.csv',
                            'text/csv','{source_sha}','STAGED','ambiguous-link-run');",
                    first = "d".repeat(64),
                    second = "e".repeat(64),
                    source_sha = "7".repeat(64),
                ))
                .unwrap();
            assert!(matches!(
                validate_import_binding(connection, "ambiguous-link-run"),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));
        });
    }

    #[test]
    fn mixed_source_kinds_and_connections_in_one_run_fail_closed() {
        with_database(|connection| {
            seed_import_run(connection, "mixed-run", "GOOGLE_DRIVE", "bank", '8');
            connection
                .execute_batch(&format!(
                    "INSERT INTO source_documents
                       (id,household_id,import_run_id,source_type,original_filename,media_type,
                        byte_size,sha256,storage_path,audience_visibility)
                     VALUES('mixed-gmail-document','family','mixed-run','GMAIL','message.eml',
                            'message/rfc822',10,'{gmail_sha}','vault://{gmail_sha}','SHARED');
                     INSERT INTO source_records
                       (id,source_document_id,row_number,record_hash,raw_payload_json)
                     VALUES('mixed-gmail-record','mixed-gmail-document',1,'{record_hash}','{{}}');
                     INSERT INTO candidate_sources(candidate_id,source_record_id,evidence_role)
                     VALUES('mixed-run-candidate','mixed-gmail-record','SUPPORTING');
                     INSERT INTO google_drive_nodes
                       (connection_id,file_id,name,mime_type,generation_fingerprint,is_folder,can_download)
                     VALUES('drive','mixed-drive','drive.csv','text/csv','{drive_inbox}',0,1);
                     INSERT INTO google_drive_inbox
                       (id,household_id,connection_id,file_id,generation_fingerprint,file_name,
                        media_type,content_sha256,state,import_run_id)
                     VALUES('{drive_inbox}','family','drive','mixed-drive','{drive_inbox}',
                            'drive.csv','text/csv','{drive_sha}','STAGED','mixed-run');
                     INSERT INTO gmail_inbox
                       (id,household_id,connection_id,provider_message_id,generation_fingerprint,
                        message_history_id,internal_date_ms,file_name,content_sha256,state,import_run_id)
                     VALUES('{gmail_inbox}','family','gmail','mixed-message','{gmail_inbox}',
                            '1',1,'message.eml','{gmail_sha}','STAGED','mixed-run');",
                    gmail_sha = "9".repeat(64),
                    record_hash = "f".repeat(64),
                    drive_inbox = "d".repeat(64),
                    drive_sha = "8".repeat(64),
                    gmail_inbox = "e".repeat(64),
                ))
                .unwrap();
            assert!(matches!(
                validate_import_binding(connection, "mixed-run"),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));
        });
    }

    #[test]
    fn a_cross_household_source_mapping_cannot_hide_behind_a_valid_native_link() {
        with_database(|connection| {
            upsert_binding(
                connection,
                &input(ConnectorKind::GoogleDrive, "drive", vec!["bank".into()]),
            )
            .unwrap();
            seed_import_run(connection, "cross-source-run", "GOOGLE_DRIVE", "bank", '6');
            connection
                .execute_batch(&format!(
                    "INSERT INTO google_drive_nodes
                       (connection_id,file_id,name,mime_type,generation_fingerprint,is_folder,can_download)
                     VALUES('drive','cross-source','drive.csv','text/csv','{inbox_id}',0,1);
                     INSERT INTO google_drive_inbox
                       (id,household_id,connection_id,file_id,generation_fingerprint,file_name,
                        media_type,content_sha256,state,import_run_id)
                     VALUES('{inbox_id}','family','drive','cross-source','{inbox_id}',
                            'drive.csv','text/csv','{family_sha}','STAGED','cross-source-run');
                     INSERT INTO source_documents
                       (id,household_id,import_run_id,source_type,original_filename,media_type,
                        byte_size,sha256,storage_path,audience_visibility)
                     VALUES('cross-household-document','other','cross-source-run','GOOGLE_DRIVE',
                            'other.csv','text/csv',10,'{other_sha}','vault://{other_sha}','SHARED');
                     INSERT INTO source_records
                       (id,source_document_id,row_number,record_hash,raw_payload_json)
                     VALUES('cross-household-record','cross-household-document',1,'{record_hash}','{{}}');
                     INSERT INTO candidate_sources(candidate_id,source_record_id,evidence_role)
                     VALUES('cross-source-run-candidate','cross-household-record','SUPPORTING');",
                    inbox_id = "d".repeat(64),
                    family_sha = "6".repeat(64),
                    other_sha = "7".repeat(64),
                    record_hash = "e".repeat(64),
                ))
                .unwrap();

            assert!(matches!(
                validate_import_binding(connection, "cross-source-run"),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));
        });
    }

    #[test]
    fn parser_deletion_or_version_change_invalidates_exact_bound_parser() {
        with_database(|connection| {
            let mut binding = input(
                ConnectorKind::ManualImport,
                "manual-import",
                vec!["bank".into()],
            );
            binding.parser_profile_id = Some("profile".into());
            binding.parser_profile_version = Some(1);
            upsert_binding(connection, &binding).unwrap();
            seed_import_run(connection, "parser-run", "MANUAL_UPLOAD", "bank", '5');
            connection
                .execute(
                    "UPDATE import_runs SET adapter_id='custom-delimited-v1',
                         adapter_version='profile@1' WHERE id='parser-run'",
                    [],
                )
                .unwrap();
            validate_import_binding(connection, "parser-run").unwrap();

            connection
                .execute(
                    "UPDATE import_runs SET adapter_version='profile@01' WHERE id='parser-run'",
                    [],
                )
                .unwrap();
            assert!(matches!(
                validate_import_binding(connection, "parser-run"),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));
            connection
                .execute(
                    "UPDATE import_runs SET adapter_id='test',adapter_version='profile@1'
                     WHERE id='parser-run'",
                    [],
                )
                .unwrap();
            assert!(matches!(
                validate_import_binding(connection, "parser-run"),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));
            connection
                .execute(
                    "UPDATE import_runs SET adapter_id='custom-delimited-v1'
                     WHERE id='parser-run'",
                    [],
                )
                .unwrap();

            connection
                .execute(
                    "UPDATE delimited_parser_profiles SET version=2 WHERE id='profile'",
                    [],
                )
                .unwrap();
            assert!(matches!(
                validate_import_binding(connection, "parser-run"),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));
            connection
                .execute(
                    "DELETE FROM delimited_parser_profiles WHERE id='profile'",
                    [],
                )
                .unwrap();
            assert!(matches!(
                validate_import_binding(connection, "parser-run"),
                Err(ConnectorBindingError::ImportBindingChanged)
            ));
        });
    }

    #[test]
    fn connector_disconnect_and_folder_removal_clear_only_active_bindings() {
        with_database(|connection| {
            for (kind, key) in [
                (ConnectorKind::GoogleDrive, "drive"),
                (ConnectorKind::Gmail, "gmail"),
                (ConnectorKind::WatchedFolder, "folder"),
                (ConnectorKind::ManualImport, "manual-import"),
            ] {
                upsert_binding(connection, &input(kind, key, vec!["bank".into()])).unwrap();
            }

            google_drive_command_service::disconnect(connection, "family", "drive").unwrap();
            gmail_store::disconnect(connection, "family", "gmail").unwrap();
            watched_folders::remove(connection, "family", "folder").unwrap();

            let remaining = list_bindings(connection, "family").unwrap();
            assert_eq!(remaining.len(), 1);
            assert_eq!(remaining[0].connector_kind, ConnectorKind::ManualImport);
        });
    }

    fn seed_import_run(
        connection: &Connection,
        run_id: &str,
        source_type: &str,
        account_id: &str,
        sha_digit: char,
    ) {
        let document_id = format!("{run_id}-document");
        let record_id = format!("{run_id}-record");
        let candidate_id = format!("{run_id}-candidate");
        let sha = sha_digit.to_string().repeat(64);
        connection
            .execute(
                "INSERT INTO import_runs(id,household_id,status,adapter_id,adapter_version)
                 VALUES(?1,'family','REVIEW_REQUIRED','test','1')",
                [run_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO source_documents
                   (id,household_id,import_run_id,source_type,original_filename,media_type,
                    byte_size,sha256,storage_path,audience_visibility)
                 VALUES(?1,'family',?2,?3,'statement.csv','text/csv',10,?4,?5,'SHARED')",
                params![
                    document_id,
                    run_id,
                    source_type,
                    sha,
                    format!("vault://{sha}")
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO source_records(id,source_document_id,row_number,record_hash,raw_payload_json)
                 VALUES(?1,?2,1,?3,'{}')",
                params![record_id, document_id, HASH_A],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO transaction_candidates
                   (id,household_id,account_id,occurred_on,amount_jpy,direction,review_status)
                 VALUES(?1,'family',?2,'2026-08-25',100,'OUT','READY')",
                params![candidate_id, account_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO candidate_sources(candidate_id,source_record_id,evidence_role)
                 VALUES(?1,?2,'PRIMARY')",
                params![candidate_id, record_id],
            )
            .unwrap();
    }

    fn seed_staged_inbox_links(connection: &Connection) {
        connection
            .execute_batch(&format!(
                "INSERT INTO google_drive_nodes
                   (connection_id,file_id,name,mime_type,generation_fingerprint,is_folder,can_download)
                 VALUES('drive','drive-file','drive.csv','text/csv','{HASH_A}',0,1);
                 INSERT INTO google_drive_inbox
                   (id,household_id,connection_id,file_id,generation_fingerprint,file_name,media_type,
                    content_sha256,state,import_run_id)
                 VALUES('{HASH_A}','family','drive','drive-file','{HASH_A}','drive.csv','text/csv',
                        '{drive_sha}','STAGED','drive-run');
                 INSERT INTO gmail_inbox
                   (id,household_id,connection_id,provider_message_id,generation_fingerprint,
                    message_history_id,internal_date_ms,file_name,content_sha256,state,import_run_id)
                 VALUES('{HASH_B}','family','gmail','message','{HASH_B}','1',1,'message.eml',
                        '{gmail_sha}','STAGED','gmail-run');
                 INSERT INTO watched_file_inbox
                   (id,household_id,watched_folder_id,relative_path,file_name,media_type,byte_size,
                    fingerprint,state,import_run_id)
                 VALUES('{watched_id}','family','folder','folder.csv','folder.csv','text/csv',10,
                        '{watched_id}','STAGED','folder-run');",
                drive_sha = "1".repeat(64),
                gmail_sha = "2".repeat(64),
                watched_id = "c".repeat(64),
            ))
            .unwrap();
    }
}
