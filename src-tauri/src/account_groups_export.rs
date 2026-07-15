use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fmt;

use crate::record_scope::{
    validate_attribution_scope, AttributionScope, AttributionScopeValidationError,
};

const MAX_ID_LEN: usize = 64;
const MAX_NAME_LEN: usize = 120;
const MAX_GROUPS: usize = 1_000;
const MAX_GROUP_ACCOUNTS: usize = 10_000;
const MAX_EXPORT_ROWS: usize = 100_000;
const MAX_EXPORT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug)]
pub enum AccountGroupExportError {
    InvalidInput(&'static str),
    NotFound,
    Conflict,
    TooLarge,
    Unavailable,
}

impl AccountGroupExportError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput(message) => message,
            Self::NotFound => "The requested account group was not found",
            Self::Conflict => "The account group could not be saved because it conflicts with existing data",
            Self::TooLarge => "The selected export is too large; choose a shorter date range or a smaller account group",
            Self::Unavailable => "Account groups and exports are temporarily unavailable",
        }
    }
}

impl fmt::Display for AccountGroupExportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.public_message())
    }
}

fn db_error(error: rusqlite::Error) -> AccountGroupExportError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == ErrorCode::ConstraintViolation =>
        {
            AccountGroupExportError::Conflict
        }
        _ => AccountGroupExportError::Unavailable,
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccountGroupKind {
    Family,
    Personal,
    DailySpending,
    Investment,
    Business,
    Tax,
    Education,
    Custom,
}

impl AccountGroupKind {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Family => "FAMILY",
            Self::Personal => "PERSONAL",
            Self::DailySpending => "DAILY_SPENDING",
            Self::Investment => "INVESTMENT",
            Self::Business => "BUSINESS",
            Self::Tax => "TAX",
            Self::Education => "EDUCATION",
            Self::Custom => "CUSTOM",
        }
    }

    fn from_sql(value: &str) -> Result<Self, rusqlite::Error> {
        match value {
            "FAMILY" => Ok(Self::Family),
            "PERSONAL" => Ok(Self::Personal),
            "DAILY_SPENDING" => Ok(Self::DailySpending),
            "INVESTMENT" => Ok(Self::Investment),
            "BUSINESS" => Ok(Self::Business),
            "TAX" => Ok(Self::Tax),
            "EDUCATION" => Ok(Self::Education),
            "CUSTOM" => Ok(Self::Custom),
            _ => Err(rusqlite::Error::InvalidQuery),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountGroupDto {
    pub id: String,
    pub household_id: String,
    pub name: String,
    pub group_kind: AccountGroupKind,
    pub sort_order: u32,
    pub account_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccountGroupInput {
    pub id: String,
    pub household_id: String,
    pub name: String,
    pub group_kind: AccountGroupKind,
    pub account_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountGroupInput {
    pub group_id: String,
    pub household_id: String,
    pub name: String,
    pub group_kind: AccountGroupKind,
    pub account_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderAccountGroupsInput {
    pub household_id: String,
    pub ordered_group_ids: Vec<String>,
}

pub fn list_account_groups(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<AccountGroupDto>, AccountGroupExportError> {
    validate_id(household_id)?;
    ensure_household(connection, household_id)?;
    let mut statement = connection
        .prepare(
            "SELECT id, household_id, name, group_kind, sort_order, created_at, updated_at
             FROM account_groups WHERE household_id = ?1 ORDER BY sort_order, id",
        )
        .map_err(db_error)?;
    let groups = statement
        .query_map([household_id], |row| {
            let raw_kind: String = row.get(3)?;
            Ok(AccountGroupDto {
                id: row.get(0)?,
                household_id: row.get(1)?,
                name: row.get(2)?,
                group_kind: AccountGroupKind::from_sql(&raw_kind)?,
                sort_order: row.get(4)?,
                account_ids: Vec::new(),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    groups
        .into_iter()
        .map(|mut group| {
            group.account_ids = list_group_account_ids(connection, household_id, &group.id)?;
            Ok(group)
        })
        .collect()
}

pub fn create_account_group(
    connection: &Connection,
    input: &CreateAccountGroupInput,
) -> Result<AccountGroupDto, AccountGroupExportError> {
    validate_group_input(
        &input.id,
        &input.household_id,
        &input.name,
        &input.account_ids,
    )?;
    ensure_household(connection, &input.household_id)?;
    let transaction = connection.unchecked_transaction().map_err(db_error)?;
    ensure_accounts(&transaction, &input.household_id, &input.account_ids)?;
    let next_order: u32 = transaction
        .query_row(
            "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM account_groups WHERE household_id = ?1",
            [&input.household_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    transaction
        .execute(
            "INSERT INTO account_groups (id, household_id, name, group_kind, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                input.id,
                input.household_id,
                input.name.trim(),
                input.group_kind.as_sql(),
                next_order
            ],
        )
        .map_err(db_error)?;
    replace_members(
        &transaction,
        &input.household_id,
        &input.id,
        &input.account_ids,
    )?;
    transaction.commit().map_err(db_error)?;
    get_account_group(connection, &input.household_id, &input.id)
}

pub fn update_account_group(
    connection: &Connection,
    input: &UpdateAccountGroupInput,
) -> Result<AccountGroupDto, AccountGroupExportError> {
    validate_group_input(
        &input.group_id,
        &input.household_id,
        &input.name,
        &input.account_ids,
    )?;
    let transaction = connection.unchecked_transaction().map_err(db_error)?;
    ensure_accounts(&transaction, &input.household_id, &input.account_ids)?;
    let changed = transaction
        .execute(
            "UPDATE account_groups SET name = ?3, group_kind = ?4,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND household_id = ?2",
            params![
                input.group_id,
                input.household_id,
                input.name.trim(),
                input.group_kind.as_sql()
            ],
        )
        .map_err(db_error)?;
    if changed != 1 {
        return Err(AccountGroupExportError::NotFound);
    }
    replace_members(
        &transaction,
        &input.household_id,
        &input.group_id,
        &input.account_ids,
    )?;
    transaction.commit().map_err(db_error)?;
    get_account_group(connection, &input.household_id, &input.group_id)
}

pub fn delete_account_group(
    connection: &Connection,
    household_id: &str,
    group_id: &str,
) -> Result<(), AccountGroupExportError> {
    validate_id(household_id)?;
    validate_id(group_id)?;
    let transaction = connection.unchecked_transaction().map_err(db_error)?;
    let removed_order: Option<u32> = transaction
        .query_row(
            "SELECT sort_order FROM account_groups WHERE household_id = ?1 AND id = ?2",
            params![household_id, group_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    let Some(removed_order) = removed_order else {
        return Err(AccountGroupExportError::NotFound);
    };
    transaction
        .execute(
            "DELETE FROM account_groups WHERE household_id = ?1 AND id = ?2",
            params![household_id, group_id],
        )
        .map_err(db_error)?;
    transaction
        .execute(
            "UPDATE account_groups SET sort_order = sort_order + 1000000
             WHERE household_id = ?1 AND sort_order > ?2",
            params![household_id, removed_order],
        )
        .map_err(db_error)?;
    transaction
        .execute(
            "UPDATE account_groups SET sort_order = sort_order - 1000001
             WHERE household_id = ?1 AND sort_order > 1000000",
            [household_id],
        )
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)
}

pub fn reorder_account_groups(
    connection: &Connection,
    input: &ReorderAccountGroupsInput,
) -> Result<Vec<AccountGroupDto>, AccountGroupExportError> {
    validate_id(&input.household_id)?;
    if input.ordered_group_ids.len() > MAX_GROUPS {
        return Err(AccountGroupExportError::InvalidInput(
            "Too many account groups",
        ));
    }
    validate_unique_ids(&input.ordered_group_ids, MAX_GROUPS)?;
    ensure_household(connection, &input.household_id)?;
    let existing_count: usize = connection
        .query_row(
            "SELECT count(*) FROM account_groups WHERE household_id = ?1",
            [&input.household_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if existing_count != input.ordered_group_ids.len() {
        return Err(AccountGroupExportError::InvalidInput(
            "Account group order must include every group exactly once",
        ));
    }
    let transaction = connection.unchecked_transaction().map_err(db_error)?;
    // Move to a disjoint range first so the unique household/order index cannot
    // be violated while swapping two existing positions.
    transaction
        .execute(
            "UPDATE account_groups SET sort_order = sort_order + 1000000 WHERE household_id = ?1",
            [&input.household_id],
        )
        .map_err(db_error)?;
    for (index, group_id) in input.ordered_group_ids.iter().enumerate() {
        let changed = transaction
            .execute(
                "UPDATE account_groups SET sort_order = ?3,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE household_id = ?1 AND id = ?2",
                params![input.household_id, group_id, index as u32],
            )
            .map_err(db_error)?;
        if changed != 1 {
            return Err(AccountGroupExportError::InvalidInput(
                "Account group order contains an unknown group",
            ));
        }
    }
    transaction.commit().map_err(db_error)?;
    list_account_groups(connection, &input.household_id)
}

fn get_account_group(
    connection: &Connection,
    household_id: &str,
    group_id: &str,
) -> Result<AccountGroupDto, AccountGroupExportError> {
    let mut group = connection
        .query_row(
            "SELECT id, household_id, name, group_kind, sort_order, created_at, updated_at
             FROM account_groups WHERE household_id = ?1 AND id = ?2",
            params![household_id, group_id],
            |row| {
                let raw_kind: String = row.get(3)?;
                Ok(AccountGroupDto {
                    id: row.get(0)?,
                    household_id: row.get(1)?,
                    name: row.get(2)?,
                    group_kind: AccountGroupKind::from_sql(&raw_kind)?,
                    sort_order: row.get(4)?,
                    account_ids: Vec::new(),
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(db_error)?
        .ok_or(AccountGroupExportError::NotFound)?;
    group.account_ids = list_group_account_ids(connection, household_id, group_id)?;
    Ok(group)
}

fn list_group_account_ids(
    connection: &Connection,
    household_id: &str,
    group_id: &str,
) -> Result<Vec<String>, AccountGroupExportError> {
    let mut statement = connection
        .prepare(
            "SELECT account_id FROM account_group_members
             WHERE household_id = ?1 AND account_group_id = ?2
             ORDER BY sort_order, account_id",
        )
        .map_err(db_error)?;
    let result = statement
        .query_map(params![household_id, group_id], |row| row.get(0))
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error);
    result
}

fn replace_members(
    connection: &Connection,
    household_id: &str,
    group_id: &str,
    account_ids: &[String],
) -> Result<(), AccountGroupExportError> {
    connection
        .execute(
            "DELETE FROM account_group_members WHERE household_id = ?1 AND account_group_id = ?2",
            params![household_id, group_id],
        )
        .map_err(db_error)?;
    for (index, account_id) in account_ids.iter().enumerate() {
        connection
            .execute(
                "INSERT INTO account_group_members
                 (household_id, account_group_id, account_id, sort_order)
                 VALUES (?1, ?2, ?3, ?4)",
                params![household_id, group_id, account_id, index as u32],
            )
            .map_err(db_error)?;
    }
    Ok(())
}

fn ensure_accounts(
    connection: &Connection,
    household_id: &str,
    account_ids: &[String],
) -> Result<(), AccountGroupExportError> {
    for account_id in account_ids {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts
                 WHERE household_id = ?1 AND id = ?2 AND is_archived = 0)",
                params![household_id, account_id],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        if !exists {
            return Err(AccountGroupExportError::InvalidInput(
                "Account group contains an unavailable account",
            ));
        }
    }
    Ok(())
}

fn ensure_household(
    connection: &Connection,
    household_id: &str,
) -> Result<(), AccountGroupExportError> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM households WHERE id = ?1)",
            [household_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if exists {
        Ok(())
    } else {
        Err(AccountGroupExportError::NotFound)
    }
}

fn validate_group_input(
    id: &str,
    household_id: &str,
    name: &str,
    account_ids: &[String],
) -> Result<(), AccountGroupExportError> {
    validate_id(id)?;
    validate_id(household_id)?;
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_NAME_LEN || trimmed.chars().any(char::is_control) {
        return Err(AccountGroupExportError::InvalidInput(
            "Account group name is invalid",
        ));
    }
    if account_ids.len() > MAX_GROUP_ACCOUNTS {
        return Err(AccountGroupExportError::InvalidInput(
            "Account group contains too many accounts",
        ));
    }
    validate_unique_ids(account_ids, MAX_GROUP_ACCOUNTS)
}

fn validate_unique_ids(ids: &[String], maximum: usize) -> Result<(), AccountGroupExportError> {
    if ids.len() > maximum {
        return Err(AccountGroupExportError::InvalidInput(
            "Too many identifiers",
        ));
    }
    let mut sorted = ids.to_vec();
    for id in &sorted {
        validate_id(id)?;
    }
    sorted.sort_unstable();
    if sorted.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(AccountGroupExportError::InvalidInput(
            "Identifiers must be unique",
        ));
    }
    Ok(())
}

fn validate_id(value: &str) -> Result<(), AccountGroupExportError> {
    if value.is_empty()
        || value.len() > MAX_ID_LEN
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Err(AccountGroupExportError::InvalidInput(
            "Identifier is invalid",
        ))
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExportKind {
    Transactions,
    PortfolioSnapshots,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExportAccountingBasis {
    Accrual,
    Cash,
}

impl ExportAccountingBasis {
    pub(crate) fn as_sql(self) -> &'static str {
        match self {
            Self::Accrual => "ACCRUAL",
            Self::Cash => "CASH",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCsvRequest {
    pub household_id: String,
    pub export_kind: ExportKind,
    pub accounting_basis: ExportAccountingBasis,
    pub group_id: Option<String>,
    #[serde(default)]
    pub attribution_scope: AttributionScope,
    pub from_date: String,
    pub to_date: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportCsvDto {
    pub file_name: String,
    pub media_type: &'static str,
    pub row_count: u32,
    pub byte_size: u32,
    pub utf8_bom_csv: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportSavedDto {
    pub file_name: String,
    pub row_count: u32,
    pub byte_size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExportTable {
    pub file_stem: &'static str,
    pub header: Vec<&'static str>,
    pub rows: Vec<Vec<String>>,
}

pub fn generate_csv(
    connection: &Connection,
    request: &ExportCsvRequest,
) -> Result<ExportCsvDto, AccountGroupExportError> {
    let table = canonical_export_table(connection, request)?;
    let mut output = String::from('\u{feff}');
    append_csv_row(&mut output, &table.header)?;
    for row in &table.rows {
        append_csv_row(&mut output, row)?;
    }
    if output.len() > MAX_EXPORT_BYTES {
        return Err(AccountGroupExportError::TooLarge);
    }
    let group_suffix = request
        .group_id
        .as_deref()
        .map(|id| format!("-{id}"))
        .unwrap_or_default();
    let file_name = format!(
        "kakeflow-{file_stem}-{from}-{to}{group_suffix}.csv",
        file_stem = table.file_stem,
        from = request.from_date,
        to = request.to_date
    );
    Ok(ExportCsvDto {
        file_name,
        media_type: "text/csv;charset=utf-8",
        row_count: table.rows.len() as u32,
        byte_size: output.len() as u32,
        utf8_bom_csv: output,
    })
}

pub(crate) fn canonical_export_table(
    connection: &Connection,
    request: &ExportCsvRequest,
) -> Result<ExportTable, AccountGroupExportError> {
    validate_export_request(connection, request)?;
    let table = match request.export_kind {
        ExportKind::Transactions => ExportTable {
            file_stem: "transactions",
            header: vec![
                "transaction_id",
                "occurred_on",
                "posted_on",
                "transaction_type",
                "payee",
                "description",
                "amount_jpy",
                "status",
                "calculation_target",
                "debit_account_id",
                "debit_account_name",
                "credit_account_id",
                "credit_account_name",
                "category_account_id",
                "category_name",
                "accounting_basis",
                "account_group_id",
                "attribution_scope",
                "attribution_member_id",
            ],
            rows: export_transaction_rows(connection, request)?,
        },
        ExportKind::PortfolioSnapshots => ExportTable {
            file_stem: "portfolio-snapshots",
            header: vec![
                "snapshot_id",
                "as_of",
                "account_id",
                "account_name",
                "market_value_jpy",
                "cash_value_jpy",
                "unrealized_pnl_jpy",
                "realized_pnl_jpy",
                "position_count",
                "fx_rate_count",
                "accounting_basis",
                "account_group_id",
            ],
            rows: export_portfolio_rows(connection, request)?,
        },
    };
    if table.rows.len() > MAX_EXPORT_ROWS {
        return Err(AccountGroupExportError::TooLarge);
    }
    Ok(table)
}

fn validate_export_request(
    connection: &Connection,
    request: &ExportCsvRequest,
) -> Result<(), AccountGroupExportError> {
    validate_id(&request.household_id)?;
    validate_date(connection, &request.from_date)?;
    validate_date(connection, &request.to_date)?;
    if request.from_date > request.to_date {
        return Err(AccountGroupExportError::InvalidInput(
            "Export start date must not be after end date",
        ));
    }
    ensure_household(connection, &request.household_id)?;
    validate_account_group_scope(
        connection,
        &request.household_id,
        request.group_id.as_deref(),
    )?;
    if request.export_kind == ExportKind::Transactions {
        validate_attribution_scope(
            connection,
            &request.household_id,
            &request.attribution_scope,
        )
        .map_err(|error| match error {
            AttributionScopeValidationError::InvalidMemberId => {
                AccountGroupExportError::InvalidInput("Attribution member is invalid")
            }
            AttributionScopeValidationError::MemberNotFound => AccountGroupExportError::NotFound,
            AttributionScopeValidationError::Database => AccountGroupExportError::Unavailable,
        })?;
    }
    Ok(())
}

/// Validates the canonical saved-account-group scope used by exports and read models.
/// A missing scope intentionally preserves the legacy whole-household behaviour.
pub fn validate_account_group_scope(
    connection: &Connection,
    household_id: &str,
    group_id: Option<&str>,
) -> Result<(), AccountGroupExportError> {
    let Some(group_id) = group_id else {
        return Ok(());
    };
    validate_id(group_id)?;
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM account_groups WHERE household_id = ?1 AND id = ?2)",
            params![household_id, group_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if exists {
        Ok(())
    } else {
        Err(AccountGroupExportError::NotFound)
    }
}

fn validate_date(connection: &Connection, value: &str) -> Result<(), AccountGroupExportError> {
    if value.len() != 10
        || value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
        || value
            .bytes()
            .enumerate()
            .any(|(index, byte)| !matches!(index, 4 | 7) && !byte.is_ascii_digit())
    {
        return Err(AccountGroupExportError::InvalidInput(
            "Export date is invalid",
        ));
    }
    let canonical: Option<String> = connection
        .query_row("SELECT date(?1)", [value], |row| row.get(0))
        .map_err(db_error)?;
    if canonical.as_deref() != Some(value) {
        return Err(AccountGroupExportError::InvalidInput(
            "Export date is invalid",
        ));
    }
    Ok(())
}

fn export_transaction_rows(
    connection: &Connection,
    request: &ExportCsvRequest,
) -> Result<Vec<Vec<String>>, AccountGroupExportError> {
    let basis = request.accounting_basis.as_sql();
    let mut statement = connection
        .prepare(
            "SELECT t.id, t.occurred_on, COALESCE(t.posted_on, ''), t.transaction_type,
                    COALESCE(t.payee, ''), COALESCE(t.description, ''),
                    COALESCE((SELECT SUM(amount_jpy) FROM journal_entries
                              WHERE transaction_id = t.id AND entry_side = 'DEBIT'), 0),
                    t.status, CASE t.calculation_target WHEN 1 THEN 'true' ELSE 'false' END,
                    COALESCE((SELECT a.id FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                              WHERE je.transaction_id = t.id AND je.entry_side = 'DEBIT'
                              ORDER BY je.line_number LIMIT 1), ''),
                    COALESCE((SELECT a.name FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                              WHERE je.transaction_id = t.id AND je.entry_side = 'DEBIT'
                              ORDER BY je.line_number LIMIT 1), ''),
                    COALESCE((SELECT a.id FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                              WHERE je.transaction_id = t.id AND je.entry_side = 'CREDIT'
                              ORDER BY je.line_number LIMIT 1), ''),
                    COALESCE((SELECT a.name FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                              WHERE je.transaction_id = t.id AND je.entry_side = 'CREDIT'
                              ORDER BY je.line_number LIMIT 1), ''),
                    COALESCE((SELECT a.id FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                              WHERE je.transaction_id = t.id AND a.account_kind IN ('EXPENSE', 'INCOME')
                              ORDER BY je.line_number LIMIT 1), ''),
                    COALESCE((SELECT a.name FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                              WHERE je.transaction_id = t.id AND a.account_kind IN ('EXPENSE', 'INCOME')
                              ORDER BY je.line_number LIMIT 1), '')
             FROM transactions t
             WHERE t.household_id = ?1 AND t.status = 'POSTED'
               AND t.occurred_on >= ?2 AND t.occurred_on <= ?3
               AND (?4 != 'ACCRUAL' OR t.transaction_type != 'CARD_PAYMENT')
               AND (?4 != 'CASH' OR t.transaction_type != 'CARD_PURCHASE')
               AND (?5 IS NULL OR EXISTS (
                    SELECT 1 FROM journal_entries scope_je
                    JOIN account_group_members scope_gm
                      ON scope_gm.account_id = scope_je.account_id
                     AND scope_gm.household_id = t.household_id
                    WHERE scope_je.transaction_id = t.id AND scope_gm.account_group_id = ?5))
               AND (?6 = 'ALL'
                    OR (?6 = 'HOUSEHOLD_COMMON' AND t.attribution_kind = 'HOUSEHOLD')
                    OR (?6 = 'MEMBER' AND t.attribution_kind = 'MEMBER'
                        AND t.attributed_member_id = ?7))
             ORDER BY t.occurred_on, t.created_at, t.id
             LIMIT ?8",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map(
            params![
                request.household_id,
                request.from_date,
                request.to_date,
                basis,
                request.group_id,
                request.attribution_scope.sql_kind(),
                request.attribution_scope.member_id(),
                (MAX_EXPORT_ROWS + 1) as i64
            ],
            |row| {
                let amount: i64 = row.get(6)?;
                let mut values = Vec::with_capacity(19);
                for index in 0..6 {
                    values.push(row.get(index)?);
                }
                values.push(amount.to_string());
                for index in 7..15 {
                    values.push(row.get(index)?);
                }
                values.push(basis.to_owned());
                values.push(request.group_id.clone().unwrap_or_default());
                values.push(request.attribution_scope.sql_kind().to_owned());
                values.push(
                    request
                        .attribution_scope
                        .member_id()
                        .unwrap_or_default()
                        .to_owned(),
                );
                Ok(values)
            },
        )
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    if rows.len() > MAX_EXPORT_ROWS {
        Err(AccountGroupExportError::TooLarge)
    } else {
        Ok(rows)
    }
}

fn export_portfolio_rows(
    connection: &Connection,
    request: &ExportCsvRequest,
) -> Result<Vec<Vec<String>>, AccountGroupExportError> {
    let basis = request.accounting_basis.as_sql();
    let mut statement = connection
        .prepare(
            "SELECT p.id, p.as_of, p.account_id, a.name, p.market_value_jpy,
                    p.cash_value_jpy, p.unrealized_pnl_jpy, p.realized_pnl_jpy,
                    (SELECT count(*) FROM position_snapshots x WHERE x.portfolio_snapshot_id = p.id),
                    (SELECT count(*) FROM portfolio_fx_rates x WHERE x.portfolio_snapshot_id = p.id)
             FROM portfolio_snapshots p JOIN accounts a ON a.id = p.account_id
             WHERE p.household_id = ?1
               AND substr(p.as_of, 1, 10) >= ?2 AND substr(p.as_of, 1, 10) <= ?3
               AND (?4 IS NULL OR EXISTS (
                    SELECT 1 FROM account_group_members gm
                    WHERE gm.household_id = p.household_id
                      AND gm.account_group_id = ?4 AND gm.account_id = p.account_id))
             ORDER BY p.as_of, p.id LIMIT ?5",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map(
            params![
                request.household_id,
                request.from_date,
                request.to_date,
                request.group_id,
                (MAX_EXPORT_ROWS + 1) as i64
            ],
            |row| {
                let mut values = Vec::with_capacity(12);
                for index in 0..6 {
                    let value: rusqlite::types::Value = row.get(index)?;
                    values.push(sql_value_to_string(value));
                }
                for index in 6..10 {
                    let value: Option<i64> = row.get(index)?;
                    values.push(value.map(|item| item.to_string()).unwrap_or_default());
                }
                values.push(basis.to_owned());
                values.push(request.group_id.clone().unwrap_or_default());
                Ok(values)
            },
        )
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    if rows.len() > MAX_EXPORT_ROWS {
        Err(AccountGroupExportError::TooLarge)
    } else {
        Ok(rows)
    }
}

fn sql_value_to_string(value: rusqlite::types::Value) -> String {
    match value {
        rusqlite::types::Value::Null => String::new(),
        rusqlite::types::Value::Integer(value) => value.to_string(),
        rusqlite::types::Value::Real(value) => value.to_string(),
        rusqlite::types::Value::Text(value) => value,
        rusqlite::types::Value::Blob(_) => String::new(),
    }
}

fn append_csv_row(
    output: &mut String,
    fields: &[impl AsRef<str>],
) -> Result<(), AccountGroupExportError> {
    for (index, field) in fields.iter().enumerate() {
        if index > 0 {
            output.push(',');
        }
        let field = field.as_ref();
        if field
            .chars()
            .any(|character| matches!(character, ',' | '"' | '\r' | '\n'))
        {
            output.push('"');
            for character in field.chars() {
                if character == '"' {
                    output.push('"');
                }
                output.push(character);
            }
            output.push('"');
        } else {
            output.push_str(field);
        }
        if output.len() > MAX_EXPORT_BYTES {
            return Err(AccountGroupExportError::TooLarge);
        }
    }
    output.push_str("\r\n");
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
               id TEXT PRIMARY KEY, household_id TEXT NOT NULL,
               display_name TEXT NOT NULL, status TEXT NOT NULL
             ) STRICT;
             CREATE TABLE accounts(
               id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
               name TEXT NOT NULL, account_kind TEXT NOT NULL, is_archived INTEGER NOT NULL
             ) STRICT;
             CREATE TABLE transactions(
               id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
               occurred_on TEXT NOT NULL, posted_on TEXT, transaction_type TEXT NOT NULL,
               payee TEXT, description TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
               attribution_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD', attributed_member_id TEXT,
               calculation_target INTEGER NOT NULL DEFAULT 1 CHECK(calculation_target IN (0,1))
             ) STRICT;
             CREATE TABLE journal_entries(
               id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id),
               account_id TEXT NOT NULL REFERENCES accounts(id), entry_side TEXT NOT NULL,
               amount_jpy INTEGER NOT NULL, line_number INTEGER NOT NULL
             ) STRICT;
             CREATE TABLE portfolio_snapshots(
               id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
               account_id TEXT NOT NULL REFERENCES accounts(id), as_of TEXT NOT NULL,
               market_value_jpy INTEGER NOT NULL, cash_value_jpy INTEGER NOT NULL,
               unrealized_pnl_jpy INTEGER, realized_pnl_jpy INTEGER
             ) STRICT;
             CREATE TABLE position_snapshots(id TEXT PRIMARY KEY, portfolio_snapshot_id TEXT NOT NULL) STRICT;
             CREATE TABLE portfolio_fx_rates(id TEXT PRIMARY KEY, portfolio_snapshot_id TEXT NOT NULL) STRICT;",
        ).unwrap();
        connection
            .execute_batch(include_str!("../migrations/0011_account_groups.sql"))
            .unwrap();
        connection
            .execute_batch(
                "INSERT INTO households VALUES ('home'), ('other');
             INSERT INTO household_members VALUES
               ('home-member', 'home', 'Home member', 'ARCHIVED'),
               ('other-member', 'other', 'Other member', 'ARCHIVED');
             INSERT INTO accounts VALUES
               ('bank', 'home', 'Bank', 'ASSET', 0),
               ('food', 'home', 'Food', 'EXPENSE', 0),
               ('card', 'home', 'Card', 'LIABILITY', 0),
               ('broker', 'home', 'Brokerage', 'ASSET', 0),
               ('foreign', 'other', 'Foreign', 'ASSET', 0);",
            )
            .unwrap();
        connection
    }

    fn create_input(id: &str, accounts: &[&str]) -> CreateAccountGroupInput {
        CreateAccountGroupInput {
            id: id.into(),
            household_id: "home".into(),
            name: id.into(),
            group_kind: AccountGroupKind::Custom,
            account_ids: accounts.iter().map(|value| (*value).into()).collect(),
        }
    }

    #[test]
    fn account_group_crud_preserves_group_and_member_order() {
        let connection = database();
        let first =
            create_account_group(&connection, &create_input("daily", &["bank", "food"])).unwrap();
        let second =
            create_account_group(&connection, &create_input("invest", &["broker"])).unwrap();
        assert_eq!(first.sort_order, 0);
        assert_eq!(first.account_ids, ["bank", "food"]);
        assert_eq!(second.sort_order, 1);

        let updated = update_account_group(
            &connection,
            &UpdateAccountGroupInput {
                group_id: "daily".into(),
                household_id: "home".into(),
                name: "Daily spending".into(),
                group_kind: AccountGroupKind::DailySpending,
                account_ids: vec!["food".into(), "bank".into()],
            },
        )
        .unwrap();
        assert_eq!(updated.account_ids, ["food", "bank"]);
        let reordered = reorder_account_groups(
            &connection,
            &ReorderAccountGroupsInput {
                household_id: "home".into(),
                ordered_group_ids: vec!["invest".into(), "daily".into()],
            },
        )
        .unwrap();
        assert_eq!(
            reordered
                .iter()
                .map(|group| group.id.as_str())
                .collect::<Vec<_>>(),
            ["invest", "daily"]
        );
        delete_account_group(&connection, "home", "invest").unwrap();
        assert_eq!(
            list_account_groups(&connection, "home").unwrap()[0].sort_order,
            0
        );
    }

    #[test]
    fn rejects_cross_household_membership_atomically() {
        let connection = database();
        let result = create_account_group(&connection, &create_input("invalid", &["foreign"]));
        assert!(matches!(
            result,
            Err(AccountGroupExportError::InvalidInput(_))
        ));
        let count: u32 = connection
            .query_row("SELECT count(*) FROM account_groups", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);

        create_account_group(&connection, &create_input("valid", &["bank"])).unwrap();
        let direct_cross_scope = connection.execute(
            "INSERT INTO account_group_members
             (household_id, account_group_id, account_id, sort_order)
             VALUES ('home', 'valid', 'foreign', 1)",
            [],
        );
        assert!(direct_cross_scope.is_err());
    }

    #[test]
    fn transaction_csv_is_bom_prefixed_scoped_escaped_and_basis_aware() {
        let connection = database();
        create_account_group(&connection, &create_input("daily", &["bank", "food"])).unwrap();
        connection.execute_batch(
            "INSERT INTO transactions VALUES
               ('purchase', 'home', '2026-07-01', NULL, 'CARD_PURCHASE', 'Shop, \"Tokyo\"', 'line 1
line 2', 'POSTED', '2026-07-01T00:00:00Z', 'MEMBER', 'home-member', 0),
               ('included', 'home', '2026-07-02', NULL, 'EXPENSE', 'Cafe', NULL, 'POSTED', '2026-07-02T00:00:00Z', 'MEMBER', 'home-member', 1),
               ('payment', 'home', '2026-07-10', NULL, 'CARD_PAYMENT', 'Card', NULL, 'POSTED', '2026-07-10T00:00:00Z', 'HOUSEHOLD', NULL, 1),
               ('outside', 'other', '2026-07-01', NULL, 'EXPENSE', 'Other', NULL, 'POSTED', '2026-07-01T00:00:00Z', 'HOUSEHOLD', NULL, 1);
             INSERT INTO journal_entries VALUES
               ('p1', 'purchase', 'food', 'DEBIT', 1200, 1), ('p2', 'purchase', 'card', 'CREDIT', 1200, 2),
               ('i1', 'included', 'food', 'DEBIT', 500, 1), ('i2', 'included', 'bank', 'CREDIT', 500, 2),
               ('c1', 'payment', 'card', 'DEBIT', 1200, 1), ('c2', 'payment', 'bank', 'CREDIT', 1200, 2),
               ('o1', 'outside', 'foreign', 'DEBIT', 1, 1);",
        ).unwrap();
        let export = generate_csv(
            &connection,
            &ExportCsvRequest {
                household_id: "home".into(),
                export_kind: ExportKind::Transactions,
                accounting_basis: ExportAccountingBasis::Accrual,
                group_id: Some("daily".into()),
                attribution_scope: AttributionScope::All,
                from_date: "2026-07-01".into(),
                to_date: "2026-07-31".into(),
            },
        )
        .unwrap();
        assert!(export.utf8_bom_csv.starts_with('\u{feff}'));
        assert_eq!(export.row_count, 2);
        assert!(export.utf8_bom_csv.contains("calculation_target"));
        assert!(export.utf8_bom_csv.contains(",POSTED,false,"));
        assert!(export.utf8_bom_csv.contains(",POSTED,true,"));
        assert!(export.utf8_bom_csv.contains("\"Shop, \"\"Tokyo\"\"\""));
        assert!(export.utf8_bom_csv.contains("\"line 1\nline 2\""));
        assert!(!export.utf8_bom_csv.contains("payment,2026"));
        assert!(!export.utf8_bom_csv.contains("outside,2026"));
        let member_export = generate_csv(
            &connection,
            &ExportCsvRequest {
                household_id: "home".into(),
                export_kind: ExportKind::Transactions,
                accounting_basis: ExportAccountingBasis::Accrual,
                group_id: Some("daily".into()),
                attribution_scope: AttributionScope::Member {
                    member_id: "home-member".into(),
                },
                from_date: "2026-07-01".into(),
                to_date: "2026-07-31".into(),
            },
        )
        .unwrap();
        assert_eq!(member_export.row_count, 2);
        assert!(member_export
            .utf8_bom_csv
            .contains(",MEMBER,home-member\r\n"));
        let common_export = generate_csv(
            &connection,
            &ExportCsvRequest {
                household_id: "home".into(),
                export_kind: ExportKind::Transactions,
                accounting_basis: ExportAccountingBasis::Accrual,
                group_id: Some("daily".into()),
                attribution_scope: AttributionScope::HouseholdCommon,
                from_date: "2026-07-01".into(),
                to_date: "2026-07-31".into(),
            },
        )
        .unwrap();
        assert_eq!(common_export.row_count, 0);
    }

    #[test]
    fn portfolio_csv_obeys_account_group_and_date_scope() {
        let connection = database();
        create_account_group(&connection, &create_input("invest", &["broker"])).unwrap();
        connection.execute_batch(
            "INSERT INTO portfolio_snapshots VALUES
              ('snap', 'home', 'broker', '2026-07-12T14:00:00+09:00', 1750000, 250000, 125000, 10000);
             INSERT INTO position_snapshots VALUES ('position', 'snap');
             INSERT INTO portfolio_fx_rates VALUES ('fx', 'snap');",
        ).unwrap();
        let export = generate_csv(
            &connection,
            &ExportCsvRequest {
                household_id: "home".into(),
                export_kind: ExportKind::PortfolioSnapshots,
                accounting_basis: ExportAccountingBasis::Accrual,
                group_id: Some("invest".into()),
                attribution_scope: AttributionScope::Member {
                    member_id: "missing".into(),
                },
                from_date: "2026-07-01".into(),
                to_date: "2026-07-31".into(),
            },
        )
        .unwrap();
        assert_eq!(export.row_count, 1);
        assert!(export.utf8_bom_csv.contains("snap,2026-07-12T14:00:00+09:00,broker,Brokerage,1750000,250000,125000,10000,1,1,ACCRUAL,invest"));
    }

    #[test]
    fn export_rejects_invalid_dates_and_foreign_groups() {
        let connection = database();
        create_account_group(&connection, &create_input("daily", &["bank"])).unwrap();
        let mut request = ExportCsvRequest {
            household_id: "home".into(),
            export_kind: ExportKind::Transactions,
            accounting_basis: ExportAccountingBasis::Cash,
            group_id: Some("daily".into()),
            attribution_scope: AttributionScope::All,
            from_date: "2026-02-30".into(),
            to_date: "2026-03-01".into(),
        };
        assert!(matches!(
            generate_csv(&connection, &request),
            Err(AccountGroupExportError::InvalidInput(_))
        ));
        request.from_date = "2026-02-01".into();
        request.group_id = Some("missing".into());
        assert!(matches!(
            generate_csv(&connection, &request),
            Err(AccountGroupExportError::NotFound)
        ));
    }
}
