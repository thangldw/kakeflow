use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fmt};

use crate::record_scope::{
    attribution_shape_is_valid, audience_shape_is_valid, validate_attribution_scope,
    AttributionKind, AttributionScope, AttributionScopeValidationError, AudienceVisibility,
};

const MAX_PAGE_SIZE: u32 = 100;
const MAX_HOUSEHOLD_ID_LEN: usize = 48;
const MAX_LOOKUP_ID_LEN: usize = 64;
const MAX_NAME_LEN: usize = 80;
const MAX_RELATIONSHIP_LABEL_LEN: usize = 40;
const MAX_SEARCH_LEN: usize = 200;
const MAX_TRANSACTION_TEXT_LEN: usize = 16_384;
const MAX_MANUAL_ENTRIES: usize = 128;
const MAX_TRANSACTION_EVIDENCE: usize = 1_024;
const MAX_RULE_VALUES: usize = 32;
const MAX_RULE_TEXT_LEN: usize = 200;
const MAX_PLANNING_JPY: i64 = 9_000_000_000_000_000;
const CANONICAL_ACCOUNTS: &[(&str, &str, &str, &str)] = &[
    ("bank", "Bank", "ASSET", "BANK"),
    ("cash", "Cash", "ASSET", "CASH"),
    ("wallet", "Wallet", "ASSET", "WALLET"),
    ("card", "Credit Card", "LIABILITY", "CREDIT_CARD"),
    ("rakuten-card", "Rakuten Card", "LIABILITY", "CREDIT_CARD"),
    (
        "amazon-card",
        "Amazon Mastercard",
        "LIABILITY",
        "CREDIT_CARD",
    ),
    ("income", "Income", "INCOME", "OTHER"),
    ("groceries", "Groceries", "EXPENSE", "OTHER"),
    ("housing", "Housing", "EXPENSE", "OTHER"),
    ("utilities", "Utilities", "EXPENSE", "OTHER"),
    ("transport", "Transport", "EXPENSE", "OTHER"),
    ("healthcare", "Healthcare", "EXPENSE", "OTHER"),
    ("entertainment", "Entertainment", "EXPENSE", "OTHER"),
    ("other-expense", "Other Expense", "EXPENSE", "OTHER"),
];

#[derive(Debug)]
pub enum RepositoryError {
    InvalidInput(&'static str),
    NotFound,
    Conflict,
    InUse,
    Unavailable,
}

impl RepositoryError {
    /// A stable, non-sensitive message suitable for returning to the webview.
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput(message) => message,
            Self::NotFound => "The requested record was not found",
            Self::Conflict => "The record already exists",
            Self::InUse => "The account is required or still in use",
            Self::Unavailable => "Financial data is temporarily unavailable",
        }
    }
}

impl fmt::Display for RepositoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.public_message())
    }
}

impl std::error::Error for RepositoryError {}

fn map_database_error(error: rusqlite::Error) -> RepositoryError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if matches!(
                details.code,
                ErrorCode::ConstraintViolation
                    | ErrorCode::DatabaseBusy
                    | ErrorCode::DatabaseLocked
            ) =>
        {
            if details.code == ErrorCode::ConstraintViolation {
                RepositoryError::Conflict
            } else {
                RepositoryError::Unavailable
            }
        }
        _ => RepositoryError::Unavailable,
    }
}

fn validate_account_group_scope(
    connection: &Connection,
    household_id: &str,
    group_id: Option<&str>,
) -> Result<(), RepositoryError> {
    crate::account_groups_export::validate_account_group_scope(connection, household_id, group_id)
        .map_err(|error| match error {
            crate::account_groups_export::AccountGroupExportError::InvalidInput(message) => {
                RepositoryError::InvalidInput(message)
            }
            crate::account_groups_export::AccountGroupExportError::NotFound => {
                RepositoryError::NotFound
            }
            _ => RepositoryError::Unavailable,
        })
}

fn validate_read_attribution_scope(
    connection: &Connection,
    household_id: &str,
    scope: &AttributionScope,
) -> Result<(), RepositoryError> {
    validate_attribution_scope(connection, household_id, scope).map_err(|error| match error {
        AttributionScopeValidationError::InvalidMemberId => {
            RepositoryError::InvalidInput("Invalid attribution member")
        }
        AttributionScopeValidationError::MemberNotFound => RepositoryError::NotFound,
        AttributionScopeValidationError::Database => RepositoryError::Unavailable,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdDto {
    pub id: String,
    pub name: String,
    pub base_currency: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHouseholdInput {
    pub id: String,
    pub name: String,
}

pub fn list_households(connection: &Connection) -> Result<Vec<HouseholdDto>, RepositoryError> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, base_currency, created_at
             FROM households
             ORDER BY created_at ASC, id ASC",
        )
        .map_err(map_database_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(HouseholdDto {
                id: row.get(0)?,
                name: row.get(1)?,
                base_currency: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(map_database_error)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)
}

pub fn create_household(
    connection: &Connection,
    input: &CreateHouseholdInput,
) -> Result<HouseholdDto, RepositoryError> {
    validate_id(&input.id, MAX_HOUSEHOLD_ID_LEN)?;
    let name = validate_name(&input.name)?;

    let transaction = connection
        .unchecked_transaction()
        .map_err(map_database_error)?;
    let already_exists = transaction
        .query_row(
            "SELECT 1 FROM households WHERE id = ?1",
            [&input.id],
            |_| Ok(()),
        )
        .optional()
        .map_err(map_database_error)?
        .is_some();
    if already_exists {
        return Err(RepositoryError::Conflict);
    }

    transaction
        .execute(
            "INSERT INTO households (id, name, base_currency) VALUES (?1, ?2, 'JPY')",
            params![input.id, name],
        )
        .map_err(map_database_error)?;

    // These accounts are intentionally generic. Institution-specific accounts can
    // be added after import detection without changing the canonical ledger shape.
    for (suffix, account_name, kind, subtype) in CANONICAL_ACCOUNTS {
        let account_id = format!("{}-{suffix}", input.id);
        transaction
            .execute(
                "INSERT INTO accounts
                 (id, household_id, name, account_kind, account_subtype, currency)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'JPY')",
                params![account_id, input.id, account_name, kind, subtype],
            )
            .map_err(map_database_error)?;
    }

    let household = transaction
        .query_row(
            "SELECT id, name, base_currency, created_at FROM households WHERE id = ?1",
            [&input.id],
            |row| {
                Ok(HouseholdDto {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    base_currency: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .map_err(map_database_error)?;
    transaction.commit().map_err(map_database_error)?;
    Ok(household)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDto {
    pub id: String,
    pub name: String,
    pub account_kind: String,
    pub account_subtype: String,
    pub currency: String,
    pub ownership_kind: String,
    pub owner_member_id: Option<String>,
    pub owner_member_name: Option<String>,
    pub visibility: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdMemberDto {
    pub id: String,
    pub household_id: String,
    pub display_name: String,
    pub relationship_label: Option<String>,
    pub status: String,
    pub sort_order: u32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHouseholdMemberInput {
    pub id: String,
    pub household_id: String,
    pub display_name: String,
    pub relationship_label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHouseholdMemberInput {
    pub household_id: String,
    pub member_id: String,
    pub display_name: String,
    pub relationship_label: Option<String>,
    pub sort_order: u32,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccountOwnershipKind {
    Household,
    Member,
}

impl AccountOwnershipKind {
    fn as_sql_value(self) -> &'static str {
        match self {
            Self::Household => "HOUSEHOLD",
            Self::Member => "MEMBER",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccountVisibility {
    Shared,
    Personal,
}

impl AccountVisibility {
    fn as_sql_value(self) -> &'static str {
        match self {
            Self::Shared => "SHARED",
            Self::Personal => "PERSONAL",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountOwnershipInput {
    pub household_id: String,
    pub account_id: String,
    pub ownership_kind: AccountOwnershipKind,
    pub owner_member_id: Option<String>,
    pub visibility: AccountVisibility,
}

pub fn list_household_members(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<HouseholdMemberDto>, RepositoryError> {
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    ensure_household_exists(connection, household_id)?;
    let mut statement = connection
        .prepare(
            "SELECT id, household_id, display_name, relationship_label, status,
                    sort_order, created_at, updated_at
             FROM household_members WHERE household_id = ?1
             ORDER BY sort_order, id",
        )
        .map_err(map_database_error)?;
    let members = statement
        .query_map([household_id], household_member_from_row)
        .map_err(map_database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)?;
    Ok(members)
}

pub fn create_household_member(
    connection: &Connection,
    input: &CreateHouseholdMemberInput,
) -> Result<HouseholdMemberDto, RepositoryError> {
    validate_id(&input.id, MAX_LOOKUP_ID_LEN)?;
    validate_id(&input.household_id, MAX_LOOKUP_ID_LEN)?;
    let display_name = validate_member_name(&input.display_name)?;
    let relationship_label = validate_relationship_label(input.relationship_label.as_deref())?;
    ensure_household_exists(connection, &input.household_id)?;
    let sort_order: u32 = connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM household_members WHERE household_id = ?1",
            [&input.household_id],
            |row| row.get(0),
        )
        .map_err(map_database_error)?;
    connection
        .execute(
            "INSERT INTO household_members
             (id, household_id, display_name, relationship_label, status, sort_order)
             VALUES (?1, ?2, ?3, ?4, 'ACTIVE', ?5)",
            params![
                input.id,
                input.household_id,
                display_name,
                relationship_label,
                sort_order
            ],
        )
        .map_err(map_database_error)?;
    get_household_member(connection, &input.household_id, &input.id)
}

pub fn update_household_member(
    connection: &Connection,
    input: &UpdateHouseholdMemberInput,
) -> Result<HouseholdMemberDto, RepositoryError> {
    validate_id(&input.household_id, MAX_LOOKUP_ID_LEN)?;
    validate_id(&input.member_id, MAX_LOOKUP_ID_LEN)?;
    let display_name = validate_member_name(&input.display_name)?;
    let relationship_label = validate_relationship_label(input.relationship_label.as_deref())?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(map_database_error)?;
    let mut ordered = list_member_ids(&transaction, &input.household_id)?;
    let old_index = ordered
        .iter()
        .position(|id| id == &input.member_id)
        .ok_or(RepositoryError::NotFound)?;
    let target = usize::try_from(input.sort_order)
        .map_err(|_| RepositoryError::InvalidInput("Invalid member order"))?;
    if target >= ordered.len() {
        return Err(RepositoryError::InvalidInput("Invalid member order"));
    }
    ordered.remove(old_index);
    ordered.insert(target, input.member_id.clone());
    transaction
        .execute(
            "UPDATE household_members SET display_name = ?1, relationship_label = ?2,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?3 AND household_id = ?4",
            params![
                display_name,
                relationship_label,
                input.member_id,
                input.household_id
            ],
        )
        .map_err(map_database_error)?;
    transaction
        .execute(
            "UPDATE household_members SET sort_order = sort_order + 1000000
             WHERE household_id = ?1",
            [&input.household_id],
        )
        .map_err(map_database_error)?;
    for (index, member_id) in ordered.iter().enumerate() {
        transaction
            .execute(
                "UPDATE household_members SET sort_order = ?1 WHERE household_id = ?2 AND id = ?3",
                params![index as u32, input.household_id, member_id],
            )
            .map_err(map_database_error)?;
    }
    transaction.commit().map_err(map_database_error)?;
    get_household_member(connection, &input.household_id, &input.member_id)
}

pub fn archive_household_member(
    connection: &Connection,
    household_id: &str,
    member_id: &str,
) -> Result<(), RepositoryError> {
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    validate_id(member_id, MAX_LOOKUP_ID_LEN)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(map_database_error)?;
    let status: String = transaction
        .query_row(
            "SELECT status FROM household_members WHERE household_id = ?1 AND id = ?2",
            params![household_id, member_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(map_database_error)?
        .ok_or(RepositoryError::NotFound)?;
    if status != "ACTIVE" {
        return Err(RepositoryError::Conflict);
    }
    let active_count: u32 = transaction
        .query_row(
            "SELECT count(*) FROM household_members WHERE household_id = ?1 AND status = 'ACTIVE'",
            [household_id],
            |row| row.get(0),
        )
        .map_err(map_database_error)?;
    if active_count <= 1 {
        return Err(RepositoryError::InUse);
    }
    let owns_account: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM accounts WHERE household_id = ?1 AND owner_member_id = ?2)",
            params![household_id, member_id],
            |row| row.get(0),
        )
        .map_err(map_database_error)?;
    if owns_account {
        return Err(RepositoryError::InUse);
    }
    transaction
        .execute(
            "UPDATE household_members SET status = 'ARCHIVED',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE household_id = ?1 AND id = ?2 AND status = 'ACTIVE'",
            params![household_id, member_id],
        )
        .map_err(map_database_error)?;
    transaction.commit().map_err(map_database_error)
}

pub fn update_account_ownership(
    connection: &Connection,
    input: &UpdateAccountOwnershipInput,
) -> Result<AccountDto, RepositoryError> {
    validate_id(&input.household_id, MAX_LOOKUP_ID_LEN)?;
    validate_id(&input.account_id, MAX_LOOKUP_ID_LEN)?;
    validate_account_ownership(
        connection,
        &input.household_id,
        input.ownership_kind,
        input.owner_member_id.as_deref(),
        input.visibility,
    )?;
    let changed = connection
        .execute(
            "UPDATE accounts SET ownership_kind = ?1, owner_member_id = ?2, visibility = ?3,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE household_id = ?4 AND id = ?5 AND is_archived = 0",
            params![
                input.ownership_kind.as_sql_value(),
                input.owner_member_id,
                input.visibility.as_sql_value(),
                input.household_id,
                input.account_id
            ],
        )
        .map_err(map_database_error)?;
    if changed != 1 {
        return Err(RepositoryError::NotFound);
    }
    find_active_account(connection, &input.household_id, &input.account_id)
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccountKind {
    Asset,
    Liability,
    Equity,
    Income,
    Expense,
}

impl AccountKind {
    fn as_sql_value(self) -> &'static str {
        match self {
            Self::Asset => "ASSET",
            Self::Liability => "LIABILITY",
            Self::Equity => "EQUITY",
            Self::Income => "INCOME",
            Self::Expense => "EXPENSE",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccountSubtype {
    Bank,
    Cash,
    Wallet,
    Securities,
    CreditCard,
    Receivable,
    Other,
}

impl AccountSubtype {
    fn as_sql_value(self) -> &'static str {
        match self {
            Self::Bank => "BANK",
            Self::Cash => "CASH",
            Self::Wallet => "WALLET",
            Self::Securities => "SECURITIES",
            Self::CreditCard => "CREDIT_CARD",
            Self::Receivable => "RECEIVABLE",
            Self::Other => "OTHER",
        }
    }

    fn is_valid_for(self, kind: AccountKind) -> bool {
        match kind {
            AccountKind::Asset => matches!(
                self,
                Self::Bank
                    | Self::Cash
                    | Self::Wallet
                    | Self::Securities
                    | Self::Receivable
                    | Self::Other
            ),
            AccountKind::Liability => matches!(self, Self::CreditCard | Self::Other),
            AccountKind::Equity | AccountKind::Income | AccountKind::Expense => self == Self::Other,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum AccountCurrency {
    #[serde(rename = "JPY")]
    Jpy,
}

impl AccountCurrency {
    fn as_sql_value(self) -> &'static str {
        match self {
            Self::Jpy => "JPY",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccountInput {
    pub id: String,
    pub household_id: String,
    pub name: String,
    pub account_kind: AccountKind,
    pub account_subtype: AccountSubtype,
    pub currency: AccountCurrency,
    pub ownership_kind: AccountOwnershipKind,
    pub owner_member_id: Option<String>,
    pub visibility: AccountVisibility,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAccountInput {
    pub household_id: String,
    pub account_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveAccountInput {
    pub household_id: String,
    pub account_id: String,
}

pub fn list_accounts(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<AccountDto>, RepositoryError> {
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    ensure_household_exists(connection, household_id)?;
    let mut statement = connection
        .prepare(
            "SELECT a.id, a.name, a.account_kind, a.account_subtype, a.currency,
                    a.ownership_kind, a.owner_member_id, m.display_name, a.visibility
             FROM accounts a
             LEFT JOIN household_members m ON m.id = a.owner_member_id
             WHERE a.household_id = ?1 AND a.is_archived = 0
             ORDER BY a.account_kind, a.account_subtype, a.name, a.id",
        )
        .map_err(map_database_error)?;
    let rows = statement
        .query_map([household_id], |row| {
            Ok(AccountDto {
                id: row.get(0)?,
                name: row.get(1)?,
                account_kind: row.get(2)?,
                account_subtype: row.get(3)?,
                currency: row.get(4)?,
                ownership_kind: row.get(5)?,
                owner_member_id: row.get(6)?,
                owner_member_name: row.get(7)?,
                visibility: row.get(8)?,
            })
        })
        .map_err(map_database_error)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(map_database_error)
}

pub fn create_account(
    connection: &Connection,
    input: &CreateAccountInput,
) -> Result<AccountDto, RepositoryError> {
    validate_id(&input.id, MAX_LOOKUP_ID_LEN)?;
    validate_id(&input.household_id, MAX_LOOKUP_ID_LEN)?;
    let name = validate_account_name(&input.name)?;
    if !input.account_subtype.is_valid_for(input.account_kind) {
        return Err(RepositoryError::InvalidInput(
            "Invalid account kind and subtype",
        ));
    }
    ensure_household_exists(connection, &input.household_id)?;
    validate_account_ownership(
        connection,
        &input.household_id,
        input.ownership_kind,
        input.owner_member_id.as_deref(),
        input.visibility,
    )?;
    connection
        .execute(
            "INSERT INTO accounts
               (id, household_id, name, account_kind, account_subtype, currency,
                ownership_kind, owner_member_id, visibility)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                input.id,
                input.household_id,
                name,
                input.account_kind.as_sql_value(),
                input.account_subtype.as_sql_value(),
                input.currency.as_sql_value(),
                input.ownership_kind.as_sql_value(),
                input.owner_member_id,
                input.visibility.as_sql_value()
            ],
        )
        .map_err(map_database_error)?;
    find_active_account(connection, &input.household_id, &input.id)
}

pub fn rename_account(
    connection: &Connection,
    input: &RenameAccountInput,
) -> Result<AccountDto, RepositoryError> {
    validate_id(&input.household_id, MAX_LOOKUP_ID_LEN)?;
    validate_id(&input.account_id, MAX_LOOKUP_ID_LEN)?;
    let name = validate_account_name(&input.name)?;
    let changed = connection
        .execute(
            "UPDATE accounts SET name = ?1,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?2 AND household_id = ?3 AND is_archived = 0",
            params![name, input.account_id, input.household_id],
        )
        .map_err(map_database_error)?;
    if changed != 1 {
        return Err(RepositoryError::NotFound);
    }
    find_active_account(connection, &input.household_id, &input.account_id)
}

pub fn archive_account(
    connection: &Connection,
    input: &ArchiveAccountInput,
) -> Result<(), RepositoryError> {
    validate_id(&input.household_id, MAX_LOOKUP_ID_LEN)?;
    validate_id(&input.account_id, MAX_LOOKUP_ID_LEN)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(map_database_error)?;
    find_active_account(&transaction, &input.household_id, &input.account_id)?;
    if is_canonical_account(&input.household_id, &input.account_id) {
        return Err(RepositoryError::InUse);
    }
    let referenced: bool = transaction
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM journal_entries je
               JOIN transactions t ON t.id = je.transaction_id
               WHERE je.account_id = ?1 AND t.household_id = ?2 AND t.status = 'POSTED'
               UNION ALL
               SELECT 1 FROM transaction_candidates tc
               WHERE tc.account_id = ?1 AND tc.household_id = ?2
                 AND tc.review_status IN ('PENDING', 'READY')
               UNION ALL
               SELECT 1 FROM card_statements cs
               WHERE cs.card_account_id = ?1 AND cs.household_id = ?2
               UNION ALL
               SELECT 1 FROM card_payments cp
               WHERE cp.card_account_id = ?1 AND cp.household_id = ?2
               UNION ALL
               SELECT 1 FROM staged_card_statements scs
               WHERE scs.card_account_id = ?1 AND scs.household_id = ?2
               UNION ALL
               SELECT 1 FROM monthly_category_budgets b
               WHERE b.category_account_id = ?1 AND b.household_id = ?2
               UNION ALL
               SELECT 1 FROM card_settlement_bank_mappings m
               WHERE m.household_id = ?2
                 AND (m.card_account_id = ?1 OR m.bank_account_id = ?1)
             )",
            params![input.account_id, input.household_id],
            |row| row.get(0),
        )
        .map_err(map_database_error)?;
    if referenced {
        return Err(RepositoryError::InUse);
    }
    let changed = transaction
        .execute(
            "UPDATE accounts SET is_archived = 1,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND household_id = ?2 AND is_archived = 0",
            params![input.account_id, input.household_id],
        )
        .map_err(map_database_error)?;
    if changed != 1 {
        return Err(RepositoryError::NotFound);
    }
    transaction.commit().map_err(map_database_error)
}

fn find_active_account(
    connection: &Connection,
    household_id: &str,
    account_id: &str,
) -> Result<AccountDto, RepositoryError> {
    connection
        .query_row(
            "SELECT a.id, a.name, a.account_kind, a.account_subtype, a.currency,
                    a.ownership_kind, a.owner_member_id, m.display_name, a.visibility
             FROM accounts a
             LEFT JOIN household_members m ON m.id = a.owner_member_id
             WHERE a.id = ?1 AND a.household_id = ?2 AND a.is_archived = 0",
            params![account_id, household_id],
            |row| {
                Ok(AccountDto {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    account_kind: row.get(2)?,
                    account_subtype: row.get(3)?,
                    currency: row.get(4)?,
                    ownership_kind: row.get(5)?,
                    owner_member_id: row.get(6)?,
                    owner_member_name: row.get(7)?,
                    visibility: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(map_database_error)?
        .ok_or(RepositoryError::NotFound)
}

fn is_canonical_account(household_id: &str, account_id: &str) -> bool {
    CANONICAL_ACCOUNTS
        .iter()
        .any(|(suffix, _, _, _)| account_id == format!("{household_id}-{suffix}"))
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccountingBasis {
    Accrual,
    Cash,
}

impl AccountingBasis {
    fn as_sql_value(self) -> &'static str {
        match self {
            Self::Accrual => "ACCRUAL",
            Self::Cash => "CASH",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CalculationTargetFilter {
    All,
    Included,
    Excluded,
}

impl CalculationTargetFilter {
    fn as_sql_value(self) -> &'static str {
        match self {
            Self::All => "ALL",
            Self::Included => "INCLUDED",
            Self::Excluded => "EXCLUDED",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionPageRequest {
    pub household_id: String,
    pub account_group_id: Option<String>,
    #[serde(default)]
    pub attribution_scope: AttributionScope,
    pub accounting_basis: AccountingBasis,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub search: Option<String>,
    pub calculation_target_filter: Option<CalculationTargetFilter>,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionRowDto {
    pub id: String,
    pub occurred_on: String,
    pub posted_on: Option<String>,
    pub transaction_type: String,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub amount_jpy: i64,
    pub status: String,
    pub calculation_target: bool,
    pub debit_account_id: Option<String>,
    pub debit_account_name: Option<String>,
    pub credit_account_id: Option<String>,
    pub credit_account_name: Option<String>,
    pub category_account_id: Option<String>,
    pub category_name: Option<String>,
    pub attribution_kind: String,
    pub attributed_member_id: Option<String>,
    pub attributed_member_name: Option<String>,
    pub audience_visibility: String,
    pub audience_member_id: Option<String>,
    pub audience_member_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionPageDto {
    pub items: Vec<TransactionRowDto>,
    pub page: u32,
    pub page_size: u32,
    pub total_items: u64,
    pub total_pages: u32,
}

pub fn list_transactions(
    connection: &Connection,
    request: &TransactionPageRequest,
) -> Result<TransactionPageDto, RepositoryError> {
    validate_id(&request.household_id, MAX_LOOKUP_ID_LEN)?;
    if request.page == 0 {
        return Err(RepositoryError::InvalidInput("Page must be at least 1"));
    }
    if request.page_size == 0 || request.page_size > MAX_PAGE_SIZE {
        return Err(RepositoryError::InvalidInput(
            "Page size must be between 1 and 100",
        ));
    }
    validate_optional_date(connection, request.from_date.as_deref())?;
    validate_optional_date(connection, request.to_date.as_deref())?;
    if matches!((&request.from_date, &request.to_date), (Some(from), Some(to)) if from > to) {
        return Err(RepositoryError::InvalidInput(
            "Start date must not be after end date",
        ));
    }
    ensure_household_exists(connection, &request.household_id)?;
    validate_account_group_scope(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
    )?;
    validate_read_attribution_scope(
        connection,
        &request.household_id,
        &request.attribution_scope,
    )?;

    let basis = request.accounting_basis.as_sql_value();
    let search = search_pattern(request.search.as_deref())?;
    let calculation_target_filter = request
        .calculation_target_filter
        .unwrap_or(CalculationTargetFilter::All)
        .as_sql_value();
    let total_items: u64 = connection
        .query_row(
            "SELECT count(*)
             FROM transactions t
             WHERE t.household_id = ?1
               AND t.status = 'POSTED'
               AND (?2 IS NULL OR t.occurred_on >= ?2)
               AND (?3 IS NULL OR t.occurred_on <= ?3)
               AND (?4 != 'ACCRUAL' OR t.transaction_type != 'CARD_PAYMENT')
               AND (?4 != 'CASH' OR t.transaction_type != 'CARD_PURCHASE')
               AND (?5 IS NULL
                    OR t.id LIKE ?5 ESCAPE '!' COLLATE NOCASE
                    OR t.payee LIKE ?5 ESCAPE '!' COLLATE NOCASE
                    OR t.description LIKE ?5 ESCAPE '!' COLLATE NOCASE
                    OR EXISTS (
                      SELECT 1 FROM journal_entries search_je
                      JOIN accounts search_a ON search_a.id = search_je.account_id
                      WHERE search_je.transaction_id = t.id
                        AND search_a.household_id = t.household_id
                        AND search_a.name LIKE ?5 ESCAPE '!' COLLATE NOCASE
                    ))
               AND (?6 IS NULL OR EXISTS (
                    SELECT 1 FROM journal_entries scope_je
                    JOIN account_group_members scope_gm
                      ON scope_gm.account_id = scope_je.account_id
                     AND scope_gm.household_id = t.household_id
                    WHERE scope_je.transaction_id = t.id
                      AND scope_gm.account_group_id = ?6))
               AND (?7 = 'ALL'
                    OR (?7 = 'HOUSEHOLD_COMMON' AND t.attribution_kind = 'HOUSEHOLD')
                    OR (?7 = 'MEMBER' AND t.attribution_kind = 'MEMBER'
                        AND t.attributed_member_id = ?8))
               AND (?9 = 'ALL'
                    OR (?9 = 'INCLUDED' AND t.calculation_target = 1)
                    OR (?9 = 'EXCLUDED' AND t.calculation_target = 0))",
            params![
                request.household_id,
                request.from_date,
                request.to_date,
                basis,
                search,
                request.account_group_id,
                request.attribution_scope.sql_kind(),
                request.attribution_scope.member_id(),
                calculation_target_filter
            ],
            |row| row.get(0),
        )
        .map_err(map_database_error)?;

    let offset = u64::from(request.page - 1) * u64::from(request.page_size);
    let mut statement = connection
        .prepare(
            "SELECT t.id, t.occurred_on, t.posted_on, t.transaction_type,
                    t.payee, t.description,
                    COALESCE((SELECT SUM(amount_jpy) FROM journal_entries
                              WHERE transaction_id = t.id AND entry_side = 'DEBIT'), 0),
                    t.status,
                    (SELECT a.id FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                     WHERE je.transaction_id = t.id AND je.entry_side = 'DEBIT'
                     ORDER BY je.line_number LIMIT 1),
                    (SELECT a.name FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                     WHERE je.transaction_id = t.id AND je.entry_side = 'DEBIT'
                     ORDER BY je.line_number LIMIT 1),
                    (SELECT a.id FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                     WHERE je.transaction_id = t.id AND je.entry_side = 'CREDIT'
                     ORDER BY je.line_number LIMIT 1),
                    (SELECT a.name FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                     WHERE je.transaction_id = t.id AND je.entry_side = 'CREDIT'
                     ORDER BY je.line_number LIMIT 1),
                    (SELECT a.id FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                     WHERE je.transaction_id = t.id AND a.account_kind IN ('EXPENSE', 'INCOME')
                     ORDER BY je.line_number LIMIT 1),
                    (SELECT a.name FROM journal_entries je JOIN accounts a ON a.id = je.account_id
                     WHERE je.transaction_id = t.id AND a.account_kind IN ('EXPENSE', 'INCOME')
                     ORDER BY je.line_number LIMIT 1),
                    t.calculation_target,
                    t.attribution_kind, t.attributed_member_id, attributed.display_name,
                    t.audience_visibility, t.audience_member_id, audience.display_name
             FROM transactions t
             LEFT JOIN household_members attributed ON attributed.id = t.attributed_member_id
             LEFT JOIN household_members audience ON audience.id = t.audience_member_id
             WHERE t.household_id = ?1
               AND t.status = 'POSTED'
               AND (?2 IS NULL OR t.occurred_on >= ?2)
               AND (?3 IS NULL OR t.occurred_on <= ?3)
               AND (?4 != 'ACCRUAL' OR t.transaction_type != 'CARD_PAYMENT')
               AND (?4 != 'CASH' OR t.transaction_type != 'CARD_PURCHASE')
               AND (?5 IS NULL
                    OR t.id LIKE ?5 ESCAPE '!' COLLATE NOCASE
                    OR t.payee LIKE ?5 ESCAPE '!' COLLATE NOCASE
                    OR t.description LIKE ?5 ESCAPE '!' COLLATE NOCASE
                    OR EXISTS (
                      SELECT 1 FROM journal_entries search_je
                      JOIN accounts search_a ON search_a.id = search_je.account_id
                      WHERE search_je.transaction_id = t.id
                        AND search_a.household_id = t.household_id
                        AND search_a.name LIKE ?5 ESCAPE '!' COLLATE NOCASE
                    ))
               AND (?6 IS NULL OR EXISTS (
                    SELECT 1 FROM journal_entries scope_je
                    JOIN account_group_members scope_gm
                      ON scope_gm.account_id = scope_je.account_id
                     AND scope_gm.household_id = t.household_id
                    WHERE scope_je.transaction_id = t.id
                      AND scope_gm.account_group_id = ?6))
               AND (?7 = 'ALL'
                    OR (?7 = 'HOUSEHOLD_COMMON' AND t.attribution_kind = 'HOUSEHOLD')
                    OR (?7 = 'MEMBER' AND t.attribution_kind = 'MEMBER'
                        AND t.attributed_member_id = ?8))
               AND (?9 = 'ALL'
                    OR (?9 = 'INCLUDED' AND t.calculation_target = 1)
                    OR (?9 = 'EXCLUDED' AND t.calculation_target = 0))
             ORDER BY t.occurred_on DESC, t.created_at DESC, t.id DESC
             LIMIT ?10 OFFSET ?11",
        )
        .map_err(map_database_error)?;
    let rows = statement
        .query_map(
            params![
                request.household_id,
                request.from_date,
                request.to_date,
                basis,
                search,
                request.account_group_id,
                request.attribution_scope.sql_kind(),
                request.attribution_scope.member_id(),
                calculation_target_filter,
                i64::from(request.page_size),
                offset as i64
            ],
            |row| {
                Ok(TransactionRowDto {
                    id: row.get(0)?,
                    occurred_on: row.get(1)?,
                    posted_on: row.get(2)?,
                    transaction_type: row.get(3)?,
                    payee: row.get(4)?,
                    description: row.get(5)?,
                    amount_jpy: row.get(6)?,
                    status: row.get(7)?,
                    debit_account_id: row.get(8)?,
                    debit_account_name: row.get(9)?,
                    credit_account_id: row.get(10)?,
                    credit_account_name: row.get(11)?,
                    category_account_id: row.get(12)?,
                    category_name: row.get(13)?,
                    calculation_target: row.get(14)?,
                    attribution_kind: row.get(15)?,
                    attributed_member_id: row.get(16)?,
                    attributed_member_name: row.get(17)?,
                    audience_visibility: row.get(18)?,
                    audience_member_id: row.get(19)?,
                    audience_member_name: row.get(20)?,
                })
            },
        )
        .map_err(map_database_error)?;
    let items = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)?;
    let total_pages = if total_items == 0 {
        0
    } else {
        ((total_items - 1) / u64::from(request.page_size) + 1) as u32
    };
    Ok(TransactionPageDto {
        items,
        page: request.page,
        page_size: request.page_size,
        total_items,
        total_pages,
    })
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ManualTransactionType {
    Expense,
    Income,
    Transfer,
    CardPurchase,
    CardPayment,
    Refund,
    Fee,
    Interest,
    Adjustment,
}

impl ManualTransactionType {
    fn as_sql_value(self) -> &'static str {
        match self {
            Self::Expense => "EXPENSE",
            Self::Income => "INCOME",
            Self::Transfer => "TRANSFER",
            Self::CardPurchase => "CARD_PURCHASE",
            Self::CardPayment => "CARD_PAYMENT",
            Self::Refund => "REFUND",
            Self::Fee => "FEE",
            Self::Interest => "INTEREST",
            Self::Adjustment => "ADJUSTMENT",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ManualEntrySide {
    Debit,
    Credit,
}

impl ManualEntrySide {
    fn as_sql_value(self) -> &'static str {
        match self {
            Self::Debit => "DEBIT",
            Self::Credit => "CREDIT",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualJournalEntryInput {
    pub id: String,
    pub account_id: String,
    pub side: ManualEntrySide,
    pub amount_jpy: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateManualTransactionInput {
    pub id: String,
    pub household_id: String,
    pub occurred_on: String,
    pub posted_on: Option<String>,
    pub transaction_type: ManualTransactionType,
    pub payee: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub attribution_kind: AttributionKind,
    #[serde(default)]
    pub attributed_member_id: Option<String>,
    #[serde(default)]
    pub audience_visibility: AudienceVisibility,
    #[serde(default)]
    pub audience_member_id: Option<String>,
    pub entries: Vec<ManualJournalEntryInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePostedTransactionInput {
    pub household_id: String,
    pub transaction_id: String,
    pub occurred_on: String,
    pub posted_on: Option<String>,
    pub transaction_type: ManualTransactionType,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub calculation_target: bool,
    #[serde(default)]
    pub attribution_kind: AttributionKind,
    #[serde(default)]
    pub attributed_member_id: Option<String>,
    #[serde(default)]
    pub audience_visibility: AudienceVisibility,
    #[serde(default)]
    pub audience_member_id: Option<String>,
    pub entries: Vec<ManualJournalEntryInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionJournalEntryDto {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub account_kind: String,
    pub side: String,
    pub amount_jpy: i64,
    pub line_number: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionSourceEvidenceDto {
    pub source_record_id: String,
    pub source_document_id: String,
    pub source_type: String,
    pub original_filename: String,
    pub media_type: String,
    pub row_number: u64,
    pub imported_at: String,
    pub evidence_role: String,
    pub audience_visibility: String,
    pub audience_member_id: Option<String>,
    pub audience_member_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionDetailDto {
    pub id: String,
    pub household_id: String,
    pub occurred_on: String,
    pub posted_on: Option<String>,
    pub transaction_type: String,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub status: String,
    pub calculation_target: bool,
    pub created_at: String,
    pub updated_at: String,
    pub editable: bool,
    pub attribution_kind: String,
    pub attributed_member_id: Option<String>,
    pub attributed_member_name: Option<String>,
    pub audience_visibility: String,
    pub audience_member_id: Option<String>,
    pub audience_member_name: Option<String>,
    pub entries: Vec<TransactionJournalEntryDto>,
    pub source_evidence: Vec<TransactionSourceEvidenceDto>,
}

pub fn get_transaction_detail(
    connection: &Connection,
    household_id: &str,
    transaction_id: &str,
) -> Result<TransactionDetailDto, RepositoryError> {
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    validate_id(transaction_id, MAX_LOOKUP_ID_LEN)?;
    ensure_household_exists(connection, household_id)?;

    let mut detail = connection
        .query_row(
            "SELECT t.id, t.household_id, t.occurred_on, t.posted_on,
                    t.transaction_type, t.payee, t.description, t.status,
                    t.created_at, t.updated_at, 1, t.calculation_target,
                    t.attribution_kind, t.attributed_member_id, attributed.display_name,
                    t.audience_visibility, t.audience_member_id, audience.display_name
             FROM transactions t
             LEFT JOIN household_members attributed ON attributed.id = t.attributed_member_id
             LEFT JOIN household_members audience ON audience.id = t.audience_member_id
             WHERE t.id = ?1 AND t.household_id = ?2 AND t.status = 'POSTED'",
            params![transaction_id, household_id],
            |row| {
                Ok(TransactionDetailDto {
                    id: row.get(0)?,
                    household_id: row.get(1)?,
                    occurred_on: row.get(2)?,
                    posted_on: row.get(3)?,
                    transaction_type: row.get(4)?,
                    payee: row.get(5)?,
                    description: row.get(6)?,
                    status: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    editable: row.get(10)?,
                    calculation_target: row.get(11)?,
                    attribution_kind: row.get(12)?,
                    attributed_member_id: row.get(13)?,
                    attributed_member_name: row.get(14)?,
                    audience_visibility: row.get(15)?,
                    audience_member_id: row.get(16)?,
                    audience_member_name: row.get(17)?,
                    entries: Vec::new(),
                    source_evidence: Vec::new(),
                })
            },
        )
        .optional()
        .map_err(map_database_error)?
        .ok_or(RepositoryError::NotFound)?;

    let mut entries = connection
        .prepare(
            "SELECT je.id, a.id, a.name, a.account_kind, je.entry_side,
                    je.amount_jpy, je.line_number
             FROM journal_entries je
             JOIN accounts a ON a.id = je.account_id
             WHERE je.transaction_id = ?1 AND a.household_id = ?2
             ORDER BY je.line_number, je.id
             LIMIT ?3",
        )
        .map_err(map_database_error)?;
    detail.entries = entries
        .query_map(
            params![
                transaction_id,
                household_id,
                i64::try_from(MAX_MANUAL_ENTRIES + 1).expect("entry limit fits SQLite integer")
            ],
            |row| {
                Ok(TransactionJournalEntryDto {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    account_name: row.get(2)?,
                    account_kind: row.get(3)?,
                    side: row.get(4)?,
                    amount_jpy: row.get(5)?,
                    line_number: row.get(6)?,
                })
            },
        )
        .map_err(map_database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)?;
    if detail.entries.len() > MAX_MANUAL_ENTRIES {
        return Err(RepositoryError::Unavailable);
    }

    let mut evidence = connection
        .prepare(
            "SELECT sr.id, sd.id, sd.source_type, sd.original_filename,
                    sd.media_type, sr.row_number, sd.imported_at,
                    COALESCE(cs.evidence_role, 'PRIMARY'),
                    sd.audience_visibility, sd.audience_member_id, audience.display_name
             FROM transaction_sources ts
             JOIN source_records sr ON sr.id = ts.source_record_id
             JOIN source_documents sd ON sd.id = sr.source_document_id
             LEFT JOIN candidate_sources cs
               ON cs.candidate_id = ts.candidate_id
              AND cs.source_record_id = ts.source_record_id
             LEFT JOIN household_members audience ON audience.id = sd.audience_member_id
             WHERE ts.transaction_id = ?1 AND sd.household_id = ?2
             ORDER BY sd.imported_at, sd.id, sr.row_number, sr.id
             LIMIT ?3",
        )
        .map_err(map_database_error)?;
    detail.source_evidence = evidence
        .query_map(
            params![
                transaction_id,
                household_id,
                i64::try_from(MAX_TRANSACTION_EVIDENCE + 1)
                    .expect("evidence limit fits SQLite integer")
            ],
            |row| {
                Ok(TransactionSourceEvidenceDto {
                    source_record_id: row.get(0)?,
                    source_document_id: row.get(1)?,
                    source_type: row.get(2)?,
                    original_filename: row.get(3)?,
                    media_type: row.get(4)?,
                    row_number: row.get(5)?,
                    imported_at: row.get(6)?,
                    evidence_role: row.get(7)?,
                    audience_visibility: row.get(8)?,
                    audience_member_id: row.get(9)?,
                    audience_member_name: row.get(10)?,
                })
            },
        )
        .map_err(map_database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)?;
    if detail.source_evidence.len() > MAX_TRANSACTION_EVIDENCE {
        return Err(RepositoryError::Unavailable);
    }
    Ok(detail)
}

pub fn create_manual_transaction(
    connection: &Connection,
    input: &CreateManualTransactionInput,
) -> Result<TransactionRowDto, RepositoryError> {
    validate_id(&input.id, MAX_LOOKUP_ID_LEN)?;
    validate_id(&input.household_id, MAX_LOOKUP_ID_LEN)?;
    validate_optional_date(connection, Some(&input.occurred_on))?;
    validate_optional_date(connection, input.posted_on.as_deref())?;
    validate_optional_transaction_text(input.payee.as_deref())?;
    validate_optional_transaction_text(input.description.as_deref())?;
    if input.entries.len() < 2 || input.entries.len() > MAX_MANUAL_ENTRIES {
        return Err(RepositoryError::InvalidInput(
            "A transaction requires 2 to 128 entries",
        ));
    }

    let mut entry_ids = HashSet::new();
    let mut debit = 0_i64;
    let mut credit = 0_i64;
    for entry in &input.entries {
        validate_id(&entry.id, MAX_LOOKUP_ID_LEN)?;
        validate_id(&entry.account_id, MAX_LOOKUP_ID_LEN)?;
        if !entry_ids.insert(entry.id.as_str())
            || entry.amount_jpy <= 0
            || entry.amount_jpy > MAX_PLANNING_JPY
        {
            return Err(RepositoryError::InvalidInput("Invalid journal entry"));
        }
        let total = match entry.side {
            ManualEntrySide::Debit => &mut debit,
            ManualEntrySide::Credit => &mut credit,
        };
        *total = total
            .checked_add(entry.amount_jpy)
            .ok_or(RepositoryError::InvalidInput("Journal amount is too large"))?;
    }
    if debit != credit {
        return Err(RepositoryError::InvalidInput(
            "Journal debits and credits must balance",
        ));
    }

    ensure_household_exists(connection, &input.household_id)?;
    validate_transaction_scope(
        connection,
        &input.household_id,
        input.attribution_kind,
        input.attributed_member_id.as_deref(),
        input.audience_visibility,
        input.audience_member_id.as_deref(),
    )?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(map_database_error)?;
    validate_transaction_account_shape(
        &transaction,
        &input.household_id,
        input.transaction_type,
        &input.entries,
    )?;

    transaction
        .execute(
            "INSERT INTO transactions
               (id, household_id, occurred_on, posted_on, transaction_type, payee, description,
                status, attribution_kind, attributed_member_id,
                audience_visibility, audience_member_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'POSTED', ?8, ?9, ?10, ?11)",
            params![
                input.id,
                input.household_id,
                input.occurred_on,
                input.posted_on,
                input.transaction_type.as_sql_value(),
                input.payee,
                input.description,
                input.attribution_kind.as_sql(),
                input.attributed_member_id,
                input.audience_visibility.as_sql(),
                input.audience_member_id
            ],
        )
        .map_err(map_database_error)?;
    for (index, entry) in input.entries.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO journal_entries
                   (id, transaction_id, account_id, entry_side, amount_jpy, line_number)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    entry.id,
                    input.id,
                    entry.account_id,
                    entry.side.as_sql_value(),
                    entry.amount_jpy,
                    i64::try_from(index + 1)
                        .map_err(|_| RepositoryError::InvalidInput("Too many journal entries"))?
                ],
            )
            .map_err(map_database_error)?;
    }
    transaction.commit().map_err(map_database_error)?;

    let page = list_transactions(
        connection,
        &TransactionPageRequest {
            household_id: input.household_id.clone(),
            account_group_id: None,
            attribution_scope: AttributionScope::All,
            accounting_basis: if input.transaction_type == ManualTransactionType::CardPayment {
                AccountingBasis::Cash
            } else {
                AccountingBasis::Accrual
            },
            from_date: Some(input.occurred_on.clone()),
            to_date: Some(input.occurred_on.clone()),
            search: Some(input.id.clone()),
            calculation_target_filter: None,
            page: 1,
            page_size: 1,
        },
    )?;
    page.items
        .into_iter()
        .next()
        .ok_or(RepositoryError::NotFound)
}

pub fn update_posted_transaction(
    connection: &Connection,
    input: &UpdatePostedTransactionInput,
) -> Result<TransactionDetailDto, RepositoryError> {
    validate_id(&input.household_id, MAX_LOOKUP_ID_LEN)?;
    validate_id(&input.transaction_id, MAX_LOOKUP_ID_LEN)?;
    validate_optional_date(connection, Some(&input.occurred_on))?;
    validate_optional_date(connection, input.posted_on.as_deref())?;
    validate_optional_transaction_text(input.payee.as_deref())?;
    validate_optional_transaction_text(input.description.as_deref())?;
    validate_manual_entries(&input.entries)?;
    ensure_household_exists(connection, &input.household_id)?;
    validate_transaction_scope(
        connection,
        &input.household_id,
        input.attribution_kind,
        input.attributed_member_id.as_deref(),
        input.audience_visibility,
        input.audience_member_id.as_deref(),
    )?;

    let current = get_transaction_detail(connection, &input.household_id, &input.transaction_id)?;

    let transaction = connection
        .unchecked_transaction()
        .map_err(map_database_error)?;
    let exists = transaction
        .query_row(
            "SELECT 1
             FROM transactions t
             WHERE t.id = ?1 AND t.household_id = ?2 AND t.status = 'POSTED'",
            params![input.transaction_id, input.household_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(map_database_error)?;
    if exists.is_none() {
        return Err(RepositoryError::NotFound);
    }
    let reconciliation_linked: bool = transaction
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM card_payments WHERE bank_transaction_id = ?1
               UNION ALL
               SELECT 1 FROM card_statement_transactions WHERE transaction_id = ?1
             )",
            [&input.transaction_id],
            |row| row.get(0),
        )
        .map_err(map_database_error)?;
    if reconciliation_linked {
        let fields_unchanged = current.occurred_on == input.occurred_on
            && current.posted_on == input.posted_on
            && current.transaction_type == input.transaction_type.as_sql_value()
            && current.payee == input.payee
            && current.description == input.description
            && current.attribution_kind == input.attribution_kind.as_sql()
            && current.attributed_member_id == input.attributed_member_id
            && current.audience_visibility == input.audience_visibility.as_sql()
            && current.audience_member_id == input.audience_member_id
            && current.entries.len() == input.entries.len()
            && current
                .entries
                .iter()
                .zip(&input.entries)
                .all(|(stored, submitted)| {
                    stored.id == submitted.id
                        && stored.account_id == submitted.account_id
                        && stored.side == submitted.side.as_sql_value()
                        && stored.amount_jpy == submitted.amount_jpy
                });
        if !fields_unchanged {
            return Err(RepositoryError::InvalidInput(
                "Card-linked transactions must be changed through reconciliation",
            ));
        }
        transaction
            .execute(
                "UPDATE transactions SET calculation_target=?1,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE id=?2 AND household_id=?3 AND status='POSTED'",
                params![
                    input.calculation_target,
                    input.transaction_id,
                    input.household_id
                ],
            )
            .map_err(map_database_error)?;
        transaction.commit().map_err(map_database_error)?;
        return get_transaction_detail(connection, &input.household_id, &input.transaction_id);
    }
    validate_transaction_account_shape(
        &transaction,
        &input.household_id,
        input.transaction_type,
        &input.entries,
    )?;

    transaction
        .execute(
            "UPDATE transactions
             SET occurred_on = ?1, posted_on = ?2, transaction_type = ?3,
                 payee = ?4, description = ?5, attribution_kind = ?6,
                 attributed_member_id = ?7, audience_visibility = ?8,
                 audience_member_id = ?9, calculation_target = ?10,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?11 AND household_id = ?12 AND status = 'POSTED'",
            params![
                input.occurred_on,
                input.posted_on,
                input.transaction_type.as_sql_value(),
                input.payee,
                input.description,
                input.attribution_kind.as_sql(),
                input.attributed_member_id,
                input.audience_visibility.as_sql(),
                input.audience_member_id,
                input.calculation_target,
                input.transaction_id,
                input.household_id
            ],
        )
        .map_err(map_database_error)?;
    transaction
        .execute(
            "DELETE FROM journal_entries WHERE transaction_id = ?1",
            [&input.transaction_id],
        )
        .map_err(map_database_error)?;
    for (index, entry) in input.entries.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO journal_entries
                   (id, transaction_id, account_id, entry_side, amount_jpy, line_number)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    entry.id,
                    input.transaction_id,
                    entry.account_id,
                    entry.side.as_sql_value(),
                    entry.amount_jpy,
                    i64::try_from(index + 1)
                        .map_err(|_| RepositoryError::InvalidInput("Too many journal entries"))?
                ],
            )
            .map_err(map_database_error)?;
    }
    transaction.commit().map_err(map_database_error)?;
    get_transaction_detail(connection, &input.household_id, &input.transaction_id)
}

fn validate_manual_entries(entries: &[ManualJournalEntryInput]) -> Result<(), RepositoryError> {
    if entries.len() < 2 || entries.len() > MAX_MANUAL_ENTRIES {
        return Err(RepositoryError::InvalidInput(
            "A transaction requires 2 to 128 entries",
        ));
    }
    let mut entry_ids = HashSet::new();
    let mut debit = 0_i64;
    let mut credit = 0_i64;
    for entry in entries {
        validate_id(&entry.id, MAX_LOOKUP_ID_LEN)?;
        validate_id(&entry.account_id, MAX_LOOKUP_ID_LEN)?;
        if !entry_ids.insert(entry.id.as_str())
            || entry.amount_jpy <= 0
            || entry.amount_jpy > MAX_PLANNING_JPY
        {
            return Err(RepositoryError::InvalidInput("Invalid journal entry"));
        }
        let total = match entry.side {
            ManualEntrySide::Debit => &mut debit,
            ManualEntrySide::Credit => &mut credit,
        };
        *total = total
            .checked_add(entry.amount_jpy)
            .ok_or(RepositoryError::InvalidInput("Journal amount is too large"))?;
    }
    if debit != credit {
        return Err(RepositoryError::InvalidInput(
            "Journal debits and credits must balance",
        ));
    }
    Ok(())
}

fn validate_transaction_account_shape(
    connection: &Connection,
    household_id: &str,
    transaction_type: ManualTransactionType,
    entries: &[ManualJournalEntryInput],
) -> Result<(), RepositoryError> {
    let mut shapes = Vec::with_capacity(entries.len());
    for entry in entries {
        let account = connection
            .query_row(
                "SELECT account_kind, account_subtype FROM accounts
                 WHERE id = ?1 AND household_id = ?2 AND is_archived = 0 AND currency = 'JPY'",
                params![entry.account_id, household_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(map_database_error)?
            .ok_or(RepositoryError::NotFound)?;
        shapes.push((entry.side, account.0, account.1));
    }
    let has = |side: ManualEntrySide, kind: &str, subtype: Option<&str>| {
        shapes.iter().any(|shape| {
            shape.0 == side && shape.1 == kind && subtype.is_none_or(|value| shape.2 == value)
        })
    };
    let valid = match transaction_type {
        ManualTransactionType::Expense
        | ManualTransactionType::Fee
        | ManualTransactionType::Interest => has(ManualEntrySide::Debit, "EXPENSE", None),
        ManualTransactionType::Income => has(ManualEntrySide::Credit, "INCOME", None),
        ManualTransactionType::CardPurchase => {
            has(ManualEntrySide::Debit, "EXPENSE", None)
                && has(ManualEntrySide::Credit, "LIABILITY", Some("CREDIT_CARD"))
        }
        ManualTransactionType::CardPayment => {
            has(ManualEntrySide::Debit, "LIABILITY", Some("CREDIT_CARD"))
                && has(ManualEntrySide::Credit, "ASSET", Some("BANK"))
        }
        ManualTransactionType::Transfer
        | ManualTransactionType::Refund
        | ManualTransactionType::Adjustment => true,
    };
    if !valid {
        return Err(RepositoryError::InvalidInput(
            "Journal accounts do not match the transaction type",
        ));
    }
    Ok(())
}

fn search_pattern(search: Option<&str>) -> Result<Option<String>, RepositoryError> {
    let Some(search) = search.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if search.chars().count() > MAX_SEARCH_LEN || search.chars().any(char::is_control) {
        return Err(RepositoryError::InvalidInput("Search text is invalid"));
    }
    let escaped = search
        .replace('!', "!!")
        .replace('%', "!%")
        .replace('_', "!_");
    Ok(Some(format!("%{escaped}%")))
}

fn validate_optional_transaction_text(value: Option<&str>) -> Result<(), RepositoryError> {
    if value.is_some_and(|value| {
        value.len() > MAX_TRANSACTION_TEXT_LEN
            || value.contains('\0')
            || value
                .chars()
                .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    }) {
        return Err(RepositoryError::InvalidInput("Transaction text is invalid"));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardAccrualTrendPointDto {
    pub month: String,
    pub income_jpy: i64,
    pub expense_jpy: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardExpenseCategoryDto {
    pub account_id: String,
    pub name: String,
    pub amount_jpy: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMonthlyTotalsDto {
    pub month: String,
    pub accounting_basis: AccountingBasis,
    pub income_jpy: i64,
    pub expense_jpy: i64,
    pub savings_jpy: i64,
    pub posted_transaction_count: u64,
    pub net_worth_as_of: String,
    pub assets_jpy: i64,
    pub liabilities_jpy: i64,
    pub net_worth_jpy: i64,
    pub accrual_trend: Vec<DashboardAccrualTrendPointDto>,
    pub expense_categories: Vec<DashboardExpenseCategoryDto>,
}

pub fn dashboard_monthly_totals(
    connection: &Connection,
    household_id: &str,
    month: &str,
    accounting_basis: AccountingBasis,
    account_group_id: Option<&str>,
    attribution_scope: &AttributionScope,
) -> Result<DashboardMonthlyTotalsDto, RepositoryError> {
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    validate_month(connection, month)?;
    ensure_household_exists(connection, household_id)?;
    validate_account_group_scope(connection, household_id, account_group_id)?;
    validate_read_attribution_scope(connection, household_id, attribution_scope)?;
    let start = format!("{month}-01");

    let (income_jpy, expense_jpy, posted_transaction_count): (i64, i64, u64) =
        match accounting_basis {
            AccountingBasis::Accrual => connection.query_row(
                "SELECT
                   COALESCE(SUM(CASE WHEN a.account_kind = 'INCOME'
                     THEN CASE je.entry_side WHEN 'CREDIT' THEN je.amount_jpy ELSE -je.amount_jpy END
                     ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN a.account_kind = 'EXPENSE'
                     THEN CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END
                     ELSE 0 END), 0),
                   count(DISTINCT t.id)
                 FROM transactions t
                 LEFT JOIN journal_entries je ON je.transaction_id = t.id
                 LEFT JOIN accounts a ON a.id = je.account_id
                 WHERE t.household_id = ?1 AND t.status = 'POSTED'
                   AND t.calculation_target = 1
                   AND t.occurred_on >= ?2 AND t.occurred_on < date(?2, '+1 month')
                   AND t.transaction_type != 'CARD_PAYMENT'
                   AND (?3 IS NULL OR EXISTS (
                     SELECT 1 FROM journal_entries scope_je JOIN account_group_members scope_gm
                       ON scope_gm.account_id = scope_je.account_id AND scope_gm.household_id = t.household_id
                     WHERE scope_je.transaction_id = t.id AND scope_gm.account_group_id = ?3))
                   AND (?4 = 'ALL'
                     OR (?4 = 'HOUSEHOLD_COMMON' AND t.attribution_kind = 'HOUSEHOLD')
                     OR (?4 = 'MEMBER' AND t.attribution_kind = 'MEMBER'
                       AND t.attributed_member_id = ?5))",
                params![household_id, start, account_group_id,
                    attribution_scope.sql_kind(), attribution_scope.member_id()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ),
            AccountingBasis::Cash => connection.query_row(
                "WITH cash_by_transaction AS (
                   SELECT t.id, t.transaction_type,
                     COALESCE(SUM(CASE
                       WHEN a.account_kind = 'ASSET' AND je.entry_side = 'DEBIT' THEN je.amount_jpy
                       WHEN a.account_kind = 'ASSET' AND je.entry_side = 'CREDIT' THEN -je.amount_jpy
                       ELSE 0 END), 0) AS asset_delta
                   FROM transactions t
                   LEFT JOIN journal_entries je ON je.transaction_id = t.id
                   LEFT JOIN accounts a ON a.id = je.account_id
                   WHERE t.household_id = ?1 AND t.status = 'POSTED'
                     AND t.calculation_target = 1
                     AND t.occurred_on >= ?2 AND t.occurred_on < date(?2, '+1 month')
                     AND t.transaction_type NOT IN ('CARD_PURCHASE', 'TRANSFER')
                     AND (?3 IS NULL OR EXISTS (
                       SELECT 1 FROM journal_entries scope_je JOIN account_group_members scope_gm
                         ON scope_gm.account_id = scope_je.account_id AND scope_gm.household_id = t.household_id
                       WHERE scope_je.transaction_id = t.id AND scope_gm.account_group_id = ?3))
                     AND (?4 = 'ALL'
                       OR (?4 = 'HOUSEHOLD_COMMON' AND t.attribution_kind = 'HOUSEHOLD')
                       OR (?4 = 'MEMBER' AND t.attribution_kind = 'MEMBER'
                         AND t.attributed_member_id = ?5))
                   GROUP BY t.id
                 )
                 SELECT
                   COALESCE(SUM(CASE WHEN asset_delta > 0 THEN asset_delta ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN asset_delta < 0 THEN -asset_delta ELSE 0 END), 0),
                   count(*)
                 FROM cash_by_transaction",
                params![household_id, start, account_group_id,
                    attribution_scope.sql_kind(), attribution_scope.member_id()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ),
        }
        .map_err(map_database_error)?;

    let (net_worth_as_of, assets_jpy, liabilities_jpy): (String, i64, i64) = connection
        .query_row(
            "SELECT date(?2, '+1 month', '-1 day'),
               COALESCE(SUM(CASE WHEN a.account_kind = 'ASSET'
                 THEN CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END
                 ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN a.account_kind = 'LIABILITY'
                 THEN CASE je.entry_side WHEN 'CREDIT' THEN je.amount_jpy ELSE -je.amount_jpy END
                 ELSE 0 END), 0)
             FROM transactions t
             LEFT JOIN journal_entries je ON je.transaction_id = t.id
             LEFT JOIN accounts a ON a.id = je.account_id
             WHERE t.household_id = ?1 AND t.status = 'POSTED'
               AND t.occurred_on < date(?2, '+1 month')
               AND (?3 IS NULL OR EXISTS (
                 SELECT 1 FROM journal_entries scope_je JOIN account_group_members scope_gm
                   ON scope_gm.account_id = scope_je.account_id AND scope_gm.household_id = t.household_id
                 WHERE scope_je.transaction_id = t.id AND scope_gm.account_group_id = ?3))",
            params![household_id, start, account_group_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(map_database_error)?;

    let mut trend_statement = connection
        .prepare(
            "WITH RECURSIVE months(month_start) AS (
               SELECT date(?2, '-5 months')
               UNION ALL
               SELECT date(month_start, '+1 month') FROM months
                 WHERE month_start < date(?2)
             )
             SELECT strftime('%Y-%m', months.month_start),
               COALESCE(SUM(CASE WHEN a.account_kind = 'INCOME'
                 THEN CASE je.entry_side WHEN 'CREDIT' THEN je.amount_jpy ELSE -je.amount_jpy END
                 ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN a.account_kind = 'EXPENSE'
                 THEN CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END
                 ELSE 0 END), 0)
             FROM months
             LEFT JOIN transactions t
               ON t.household_id = ?1 AND t.status = 'POSTED'
              AND t.calculation_target = 1
              AND t.occurred_on >= months.month_start
              AND t.occurred_on < date(months.month_start, '+1 month')
              AND t.transaction_type != 'CARD_PAYMENT'
              AND (?3 IS NULL OR EXISTS (
                SELECT 1 FROM journal_entries scope_je JOIN account_group_members scope_gm
                  ON scope_gm.account_id = scope_je.account_id AND scope_gm.household_id = t.household_id
                WHERE scope_je.transaction_id = t.id AND scope_gm.account_group_id = ?3))
              AND (?4 = 'ALL'
                OR (?4 = 'HOUSEHOLD_COMMON' AND t.attribution_kind = 'HOUSEHOLD')
                OR (?4 = 'MEMBER' AND t.attribution_kind = 'MEMBER'
                  AND t.attributed_member_id = ?5))
             LEFT JOIN journal_entries je ON je.transaction_id = t.id
             LEFT JOIN accounts a ON a.id = je.account_id
             GROUP BY months.month_start
             ORDER BY months.month_start",
        )
        .map_err(map_database_error)?;
    let accrual_trend = trend_statement
        .query_map(
            params![
                household_id,
                start,
                account_group_id,
                attribution_scope.sql_kind(),
                attribution_scope.member_id()
            ],
            |row| {
                Ok(DashboardAccrualTrendPointDto {
                    month: row.get(0)?,
                    income_jpy: row.get(1)?,
                    expense_jpy: row.get(2)?,
                })
            },
        )
        .map_err(map_database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)?;

    let mut categories_statement = connection
        .prepare(
            "SELECT a.id, a.name,
               SUM(CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END)
             FROM transactions t
             JOIN journal_entries je ON je.transaction_id = t.id
             JOIN accounts a ON a.id = je.account_id AND a.account_kind = 'EXPENSE'
             WHERE t.household_id = ?1 AND t.status = 'POSTED'
               AND t.calculation_target = 1
               AND t.occurred_on >= ?2 AND t.occurred_on < date(?2, '+1 month')
               AND t.transaction_type != 'CARD_PAYMENT'
               AND (?3 IS NULL OR EXISTS (
                 SELECT 1 FROM journal_entries scope_je JOIN account_group_members scope_gm
                   ON scope_gm.account_id = scope_je.account_id AND scope_gm.household_id = t.household_id
                 WHERE scope_je.transaction_id = t.id AND scope_gm.account_group_id = ?3))
               AND (?4 = 'ALL'
                 OR (?4 = 'HOUSEHOLD_COMMON' AND t.attribution_kind = 'HOUSEHOLD')
                 OR (?4 = 'MEMBER' AND t.attribution_kind = 'MEMBER'
                   AND t.attributed_member_id = ?5))
             GROUP BY a.id, a.name
             HAVING SUM(CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END) != 0
             ORDER BY 3 DESC, a.name ASC, a.id ASC",
        )
        .map_err(map_database_error)?;
    let expense_categories = categories_statement
        .query_map(
            params![
                household_id,
                start,
                account_group_id,
                attribution_scope.sql_kind(),
                attribution_scope.member_id()
            ],
            |row| {
                Ok(DashboardExpenseCategoryDto {
                    account_id: row.get(0)?,
                    name: row.get(1)?,
                    amount_jpy: row.get(2)?,
                })
            },
        )
        .map_err(map_database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)?;

    Ok(DashboardMonthlyTotalsDto {
        month: month.to_owned(),
        accounting_basis,
        income_jpy,
        expense_jpy,
        savings_jpy: income_jpy - expense_jpy,
        posted_transaction_count,
        net_worth_as_of,
        assets_jpy,
        liabilities_jpy,
        net_worth_jpy: assets_jpy - liabilities_jpy,
        accrual_trend,
        expense_categories,
    })
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyCategoryBudgetDto {
    pub household_id: String,
    pub month: String,
    pub category_account_id: String,
    pub category_name: String,
    pub budget_jpy: i64,
    pub actual_jpy: i64,
    pub remaining_jpy: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertMonthlyCategoryBudgetInput {
    pub household_id: String,
    pub month: String,
    pub category_account_id: String,
    pub budget_jpy: i64,
}

pub fn list_monthly_category_budgets(
    connection: &Connection,
    household_id: &str,
    month: &str,
) -> Result<Vec<MonthlyCategoryBudgetDto>, RepositoryError> {
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    validate_month(connection, month)?;
    ensure_household_exists(connection, household_id)?;
    let month_start = format!("{month}-01");
    let mut statement = connection
        .prepare(
            "WITH actuals AS (
               SELECT je.account_id,
                 COALESCE(SUM(CASE je.entry_side
                   WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END), 0) AS actual_jpy
               FROM transactions t
               JOIN journal_entries je ON je.transaction_id = t.id
               JOIN accounts expense
                 ON expense.id = je.account_id AND expense.account_kind = 'EXPENSE'
               WHERE t.household_id = ?1 AND expense.household_id = ?1
                 AND t.status = 'POSTED'
                 AND t.calculation_target = 1
                 AND t.occurred_on >= ?3 AND t.occurred_on < date(?3, '+1 month')
                 AND t.transaction_type != 'CARD_PAYMENT'
               GROUP BY je.account_id
             )
             SELECT b.household_id, b.month, b.category_account_id, a.name,
                    b.budget_jpy, COALESCE(actuals.actual_jpy, 0),
                    b.budget_jpy - COALESCE(actuals.actual_jpy, 0)
             FROM monthly_category_budgets b
             JOIN accounts a
               ON a.id = b.category_account_id AND a.household_id = b.household_id
             LEFT JOIN actuals ON actuals.account_id = b.category_account_id
             WHERE b.household_id = ?1 AND b.month = ?2
             ORDER BY a.name ASC, a.id ASC",
        )
        .map_err(map_database_error)?;
    let rows = statement
        .query_map(params![household_id, month, month_start], |row| {
            Ok(MonthlyCategoryBudgetDto {
                household_id: row.get(0)?,
                month: row.get(1)?,
                category_account_id: row.get(2)?,
                category_name: row.get(3)?,
                budget_jpy: row.get(4)?,
                actual_jpy: row.get(5)?,
                remaining_jpy: row.get(6)?,
            })
        })
        .map_err(map_database_error)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)
}

pub fn upsert_monthly_category_budget(
    connection: &Connection,
    input: &UpsertMonthlyCategoryBudgetInput,
) -> Result<MonthlyCategoryBudgetDto, RepositoryError> {
    validate_id(&input.household_id, MAX_LOOKUP_ID_LEN)?;
    validate_id(&input.category_account_id, MAX_LOOKUP_ID_LEN)?;
    validate_month(connection, &input.month)?;
    validate_jpy(input.budget_jpy, true)?;
    ensure_household_exists(connection, &input.household_id)?;
    let is_active_expense_account = connection
        .query_row(
            "SELECT 1 FROM accounts
             WHERE id = ?1 AND household_id = ?2
               AND account_kind = 'EXPENSE' AND is_archived = 0",
            params![input.category_account_id, input.household_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(map_database_error)?
        .is_some();
    if !is_active_expense_account {
        return Err(RepositoryError::NotFound);
    }

    connection
        .execute(
            "INSERT INTO monthly_category_budgets
               (household_id, month, category_account_id, budget_jpy)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(household_id, month, category_account_id) DO UPDATE SET
               budget_jpy = excluded.budget_jpy,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            params![
                input.household_id,
                input.month,
                input.category_account_id,
                input.budget_jpy
            ],
        )
        .map_err(map_database_error)?;

    list_monthly_category_budgets(connection, &input.household_id, &input.month)?
        .into_iter()
        .find(|budget| budget.category_account_id == input.category_account_id)
        .ok_or(RepositoryError::Unavailable)
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SavingsGoalStatus {
    Active,
    Paused,
    Completed,
    Cancelled,
}

impl SavingsGoalStatus {
    fn as_sql_value(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Paused => "PAUSED",
            Self::Completed => "COMPLETED",
            Self::Cancelled => "CANCELLED",
        }
    }

    fn from_sql_value(value: &str) -> Result<Self, RepositoryError> {
        match value {
            "ACTIVE" => Ok(Self::Active),
            "PAUSED" => Ok(Self::Paused),
            "COMPLETED" => Ok(Self::Completed),
            "CANCELLED" => Ok(Self::Cancelled),
            _ => Err(RepositoryError::Unavailable),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavingsGoalDto {
    pub id: String,
    pub household_id: String,
    pub name: String,
    pub target_jpy: i64,
    pub saved_jpy: i64,
    pub target_date: String,
    pub status: SavingsGoalStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSavingsGoalInput {
    pub id: String,
    pub household_id: String,
    pub name: String,
    pub target_jpy: i64,
    pub saved_jpy: i64,
    pub target_date: String,
    pub status: SavingsGoalStatus,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSavingsGoalInput {
    pub id: String,
    pub household_id: String,
    pub name: String,
    pub target_jpy: i64,
    pub saved_jpy: i64,
    pub target_date: String,
    pub status: SavingsGoalStatus,
}

pub fn list_savings_goals(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<SavingsGoalDto>, RepositoryError> {
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    ensure_household_exists(connection, household_id)?;
    let mut statement = connection
        .prepare(
            "SELECT id, household_id, name, target_jpy, saved_jpy, target_date,
                    status, created_at, updated_at
             FROM savings_goals
             WHERE household_id = ?1
             ORDER BY CASE status
               WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1
               WHEN 'COMPLETED' THEN 2 ELSE 3 END,
               target_date ASC, name ASC, id ASC",
        )
        .map_err(map_database_error)?;
    let rows = statement
        .query_map([household_id], savings_goal_from_row)
        .map_err(map_database_error)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)
}

pub fn create_savings_goal(
    connection: &Connection,
    input: &CreateSavingsGoalInput,
) -> Result<SavingsGoalDto, RepositoryError> {
    let name = validate_savings_goal_input(
        connection,
        &input.id,
        &input.household_id,
        &input.name,
        input.target_jpy,
        input.saved_jpy,
        &input.target_date,
    )?;
    ensure_household_exists(connection, &input.household_id)?;
    connection
        .execute(
            "INSERT INTO savings_goals
               (id, household_id, name, target_jpy, saved_jpy, target_date, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                input.id,
                input.household_id,
                name,
                input.target_jpy,
                input.saved_jpy,
                input.target_date,
                input.status.as_sql_value()
            ],
        )
        .map_err(map_database_error)?;
    get_savings_goal(connection, &input.household_id, &input.id)
}

pub fn update_savings_goal(
    connection: &Connection,
    input: &UpdateSavingsGoalInput,
) -> Result<SavingsGoalDto, RepositoryError> {
    let name = validate_savings_goal_input(
        connection,
        &input.id,
        &input.household_id,
        &input.name,
        input.target_jpy,
        input.saved_jpy,
        &input.target_date,
    )?;
    ensure_household_exists(connection, &input.household_id)?;
    let changed = connection
        .execute(
            "UPDATE savings_goals
             SET name = ?3, target_jpy = ?4, saved_jpy = ?5,
                 target_date = ?6, status = ?7,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND household_id = ?2",
            params![
                input.id,
                input.household_id,
                name,
                input.target_jpy,
                input.saved_jpy,
                input.target_date,
                input.status.as_sql_value()
            ],
        )
        .map_err(map_database_error)?;
    if changed == 0 {
        return Err(RepositoryError::NotFound);
    }
    get_savings_goal(connection, &input.household_id, &input.id)
}

pub fn delete_savings_goal(
    connection: &Connection,
    household_id: &str,
    goal_id: &str,
) -> Result<(), RepositoryError> {
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    validate_id(goal_id, MAX_LOOKUP_ID_LEN)?;
    ensure_household_exists(connection, household_id)?;
    let changed = connection
        .execute(
            "DELETE FROM savings_goals WHERE id = ?1 AND household_id = ?2",
            params![goal_id, household_id],
        )
        .map_err(map_database_error)?;
    if changed == 0 {
        return Err(RepositoryError::NotFound);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationRuleDto {
    pub id: String,
    pub household_id: String,
    pub name: String,
    pub priority: i64,
    pub is_enabled: bool,
    pub merchant_contains: Option<String>,
    pub description_contains: Option<String>,
    pub category_account_id: String,
    pub category_name: String,
    pub labels: Vec<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClassificationRuleInput {
    pub id: String,
    pub household_id: String,
    pub name: String,
    pub priority: i64,
    pub is_enabled: bool,
    pub merchant_contains: Option<String>,
    pub description_contains: Option<String>,
    pub category_account_id: String,
    pub labels: Vec<String>,
    pub tags: Vec<String>,
}

pub type UpdateClassificationRuleInput = CreateClassificationRuleInput;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationPreviewInput {
    pub household_id: String,
    pub merchant: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationPreviewDto {
    pub winning_rule_id: Option<String>,
    pub matches: Vec<ClassificationRuleDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyClassificationRuleInput {
    pub household_id: String,
    pub transaction_id: String,
    pub rule_id: String,
    /// Optimistic concurrency token returned by transaction_detail_get.
    pub expected_transaction_updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedClassificationDto {
    pub transaction_id: String,
    pub rule_id: String,
    pub category_account_id: String,
    pub category_name: String,
    pub labels: Vec<String>,
    pub tags: Vec<String>,
    pub transaction_updated_at: String,
}

pub fn list_classification_rules(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<ClassificationRuleDto>, RepositoryError> {
    validate_id(household_id, MAX_HOUSEHOLD_ID_LEN)?;
    ensure_household_exists(connection, household_id)?;
    let mut statement = connection
        .prepare(
            "SELECT r.id, r.household_id, r.name, r.priority, r.is_enabled,
                    r.merchant_contains, r.description_contains, r.category_account_id,
                    a.name, r.created_at, r.updated_at
             FROM classification_rules r
             JOIN accounts a ON a.id = r.category_account_id
             WHERE r.household_id = ?1
             ORDER BY r.priority ASC, r.id ASC",
        )
        .map_err(map_database_error)?;
    let rows = statement
        .query_map([household_id], rule_from_row)
        .map_err(map_database_error)?;
    let mut rules = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)?;
    for rule in &mut rules {
        rule.labels = rule_values(connection, "classification_rule_labels", "label", &rule.id)?;
        rule.tags = rule_values(connection, "classification_rule_tags", "tag", &rule.id)?;
    }
    Ok(rules)
}

pub fn create_classification_rule(
    connection: &Connection,
    input: &CreateClassificationRuleInput,
) -> Result<ClassificationRuleDto, RepositoryError> {
    let normalized = validate_classification_rule(connection, input)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(map_database_error)?;
    transaction
        .execute(
            "INSERT INTO classification_rules
             (id, household_id, name, priority, is_enabled, merchant_contains,
              description_contains, category_account_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                input.id,
                input.household_id,
                normalized.name,
                input.priority,
                input.is_enabled,
                normalized.merchant,
                normalized.description,
                input.category_account_id
            ],
        )
        .map_err(map_database_error)?;
    replace_rule_values(
        &transaction,
        &input.id,
        &normalized.labels,
        &normalized.tags,
    )?;
    transaction.commit().map_err(map_database_error)?;
    get_classification_rule(connection, &input.household_id, &input.id)
}

pub fn update_classification_rule(
    connection: &Connection,
    input: &UpdateClassificationRuleInput,
) -> Result<ClassificationRuleDto, RepositoryError> {
    let normalized = validate_classification_rule(connection, input)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(map_database_error)?;
    let changed = transaction
        .execute(
            "UPDATE classification_rules
             SET name = ?3, priority = ?4, is_enabled = ?5, merchant_contains = ?6,
                 description_contains = ?7, category_account_id = ?8,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND household_id = ?2",
            params![
                input.id,
                input.household_id,
                normalized.name,
                input.priority,
                input.is_enabled,
                normalized.merchant,
                normalized.description,
                input.category_account_id
            ],
        )
        .map_err(map_database_error)?;
    if changed != 1 {
        return Err(RepositoryError::NotFound);
    }
    replace_rule_values(
        &transaction,
        &input.id,
        &normalized.labels,
        &normalized.tags,
    )?;
    transaction.commit().map_err(map_database_error)?;
    get_classification_rule(connection, &input.household_id, &input.id)
}

pub fn delete_classification_rule(
    connection: &Connection,
    household_id: &str,
    rule_id: &str,
) -> Result<(), RepositoryError> {
    validate_id(household_id, MAX_HOUSEHOLD_ID_LEN)?;
    validate_id(rule_id, MAX_LOOKUP_ID_LEN)?;
    let changed = connection
        .execute(
            "DELETE FROM classification_rules WHERE id = ?1 AND household_id = ?2",
            params![rule_id, household_id],
        )
        .map_err(map_database_error)?;
    if changed != 1 {
        return Err(RepositoryError::NotFound);
    }
    Ok(())
}

pub fn preview_classification_rules(
    connection: &Connection,
    input: &ClassificationPreviewInput,
) -> Result<ClassificationPreviewDto, RepositoryError> {
    validate_id(&input.household_id, MAX_HOUSEHOLD_ID_LEN)?;
    validate_optional_rule_text(input.merchant.as_deref())?;
    validate_optional_rule_text(input.description.as_deref())?;
    let matches = list_classification_rules(connection, &input.household_id)?
        .into_iter()
        .filter(|rule| {
            rule.is_enabled
                && rule_matches(
                    rule,
                    input.merchant.as_deref(),
                    input.description.as_deref(),
                )
        })
        .collect::<Vec<_>>();
    Ok(ClassificationPreviewDto {
        winning_rule_id: matches.first().map(|rule| rule.id.clone()),
        matches,
    })
}

/// Applies only an enabled rule that still matches a posted transaction. The
/// caller must provide the exact updated_at value it reviewed; stale writes and
/// split expense entries are rejected rather than guessed.
pub fn apply_classification_rule(
    connection: &Connection,
    input: &ApplyClassificationRuleInput,
) -> Result<AppliedClassificationDto, RepositoryError> {
    validate_id(&input.household_id, MAX_HOUSEHOLD_ID_LEN)?;
    validate_id(&input.transaction_id, MAX_LOOKUP_ID_LEN)?;
    validate_id(&input.rule_id, MAX_LOOKUP_ID_LEN)?;
    let rule = get_classification_rule(connection, &input.household_id, &input.rule_id)?;
    if !rule.is_enabled {
        return Err(RepositoryError::Conflict);
    }
    let transaction = connection
        .unchecked_transaction()
        .map_err(map_database_error)?;
    let (merchant, description, updated_at): (Option<String>, Option<String>, String) = transaction
        .query_row(
            "SELECT payee, description, updated_at FROM transactions
             WHERE id = ?1 AND household_id = ?2 AND status = 'POSTED'",
            params![input.transaction_id, input.household_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(map_database_error)?
        .ok_or(RepositoryError::NotFound)?;
    if updated_at != input.expected_transaction_updated_at
        || !rule_matches(&rule, merchant.as_deref(), description.as_deref())
    {
        return Err(RepositoryError::Conflict);
    }
    let expense_entries = transaction
        .query_row(
            "SELECT count(*) FROM journal_entries e JOIN accounts a ON a.id = e.account_id
             WHERE e.transaction_id = ?1 AND a.account_kind = 'EXPENSE'",
            [&input.transaction_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(map_database_error)?;
    if expense_entries != 1 {
        return Err(RepositoryError::Conflict);
    }
    let previous_category: String = transaction
        .query_row(
            "SELECT e.account_id FROM journal_entries e JOIN accounts a ON a.id = e.account_id
             WHERE e.transaction_id = ?1 AND a.account_kind = 'EXPENSE'",
            [&input.transaction_id],
            |row| row.get(0),
        )
        .map_err(map_database_error)?;
    transaction
        .execute(
            "UPDATE journal_entries SET account_id = ?2 WHERE transaction_id = ?1
         AND account_id = ?3",
            params![
                input.transaction_id,
                rule.category_account_id,
                previous_category
            ],
        )
        .map_err(map_database_error)?;
    transaction
        .execute(
            "DELETE FROM transaction_labels WHERE transaction_id = ?1",
            [&input.transaction_id],
        )
        .map_err(map_database_error)?;
    transaction
        .execute(
            "DELETE FROM transaction_tags WHERE transaction_id = ?1",
            [&input.transaction_id],
        )
        .map_err(map_database_error)?;
    for label in &rule.labels {
        transaction
            .execute(
                "INSERT INTO transaction_labels (transaction_id, label) VALUES (?1, ?2)",
                params![input.transaction_id, label],
            )
            .map_err(map_database_error)?;
    }
    for tag in &rule.tags {
        transaction
            .execute(
                "INSERT INTO transaction_tags (transaction_id, tag) VALUES (?1, ?2)",
                params![input.transaction_id, tag],
            )
            .map_err(map_database_error)?;
    }
    transaction.execute(
        "INSERT INTO classification_rule_applications
         (household_id, transaction_id, rule_id, previous_category_account_id, applied_category_account_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![input.household_id, input.transaction_id, input.rule_id, previous_category, rule.category_account_id],
    ).map_err(map_database_error)?;
    transaction
        .execute(
            "UPDATE transactions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1 AND household_id = ?2 AND updated_at = ?3",
            params![
                input.transaction_id,
                input.household_id,
                input.expected_transaction_updated_at
            ],
        )
        .map_err(map_database_error)?;
    let transaction_updated_at = transaction
        .query_row(
            "SELECT updated_at FROM transactions WHERE id = ?1",
            [&input.transaction_id],
            |row| row.get(0),
        )
        .map_err(map_database_error)?;
    transaction.commit().map_err(map_database_error)?;
    Ok(AppliedClassificationDto {
        transaction_id: input.transaction_id.clone(),
        rule_id: input.rule_id.clone(),
        category_account_id: rule.category_account_id,
        category_name: rule.category_name,
        labels: rule.labels,
        tags: rule.tags,
        transaction_updated_at,
    })
}

struct NormalizedRuleInput<'a> {
    name: &'a str,
    merchant: Option<&'a str>,
    description: Option<&'a str>,
    labels: Vec<String>,
    tags: Vec<String>,
}

fn validate_classification_rule<'a>(
    connection: &Connection,
    input: &'a CreateClassificationRuleInput,
) -> Result<NormalizedRuleInput<'a>, RepositoryError> {
    validate_id(&input.id, MAX_LOOKUP_ID_LEN)?;
    validate_id(&input.household_id, MAX_HOUSEHOLD_ID_LEN)?;
    let name = validate_name(&input.name)?;
    if !(0..=1_000_000).contains(&input.priority) {
        return Err(RepositoryError::InvalidInput("Invalid rule priority"));
    }
    let merchant = trim_optional_rule_text(input.merchant_contains.as_deref())?;
    let description = trim_optional_rule_text(input.description_contains.as_deref())?;
    if merchant.is_none() && description.is_none() {
        return Err(RepositoryError::InvalidInput(
            "A rule match condition is required",
        ));
    }
    ensure_household_exists(connection, &input.household_id)?;
    let category_kind: Option<String> = connection.query_row(
        "SELECT account_kind FROM accounts WHERE id = ?1 AND household_id = ?2 AND is_archived = 0",
        params![input.category_account_id, input.household_id], |row| row.get(0)
    ).optional().map_err(map_database_error)?;
    if category_kind.as_deref() != Some("EXPENSE") {
        return Err(RepositoryError::InvalidInput(
            "Rule category must be an active expense account",
        ));
    }
    Ok(NormalizedRuleInput {
        name,
        merchant,
        description,
        labels: normalize_rule_values(&input.labels)?,
        tags: normalize_rule_values(&input.tags)?,
    })
}

fn validate_optional_rule_text(value: Option<&str>) -> Result<(), RepositoryError> {
    trim_optional_rule_text(value).map(|_| ())
}
fn trim_optional_rule_text(value: Option<&str>) -> Result<Option<&str>, RepositoryError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > MAX_RULE_TEXT_LEN
        || trimmed.chars().any(char::is_control)
    {
        return Err(RepositoryError::InvalidInput("Invalid rule match text"));
    }
    Ok(Some(trimmed))
}

fn normalize_rule_values(values: &[String]) -> Result<Vec<String>, RepositoryError> {
    if values.len() > MAX_RULE_VALUES {
        return Err(RepositoryError::InvalidInput(
            "Too many rule labels or tags",
        ));
    }
    let mut normalized = Vec::with_capacity(values.len());
    for value in values {
        let value = value.trim();
        if value.is_empty()
            || value.chars().count() > MAX_NAME_LEN
            || value.chars().any(char::is_control)
        {
            return Err(RepositoryError::InvalidInput("Invalid rule label or tag"));
        }
        if !normalized.iter().any(|existing| existing == value) {
            normalized.push(value.to_owned());
        }
    }
    normalized.sort();
    Ok(normalized)
}

fn rule_matches(
    rule: &ClassificationRuleDto,
    merchant: Option<&str>,
    description: Option<&str>,
) -> bool {
    fn contains(value: Option<&str>, needle: Option<&str>) -> bool {
        match needle {
            None => true,
            Some(needle) => value
                .map(|value| value.to_lowercase().contains(&needle.to_lowercase()))
                .unwrap_or(false),
        }
    }
    contains(merchant, rule.merchant_contains.as_deref())
        && contains(description, rule.description_contains.as_deref())
}

fn get_classification_rule(
    connection: &Connection,
    household_id: &str,
    rule_id: &str,
) -> Result<ClassificationRuleDto, RepositoryError> {
    let mut rule = connection
        .query_row(
            "SELECT r.id, r.household_id, r.name, r.priority, r.is_enabled,
                r.merchant_contains, r.description_contains, r.category_account_id,
                a.name, r.created_at, r.updated_at
         FROM classification_rules r JOIN accounts a ON a.id = r.category_account_id
         WHERE r.id = ?1 AND r.household_id = ?2",
            params![rule_id, household_id],
            rule_from_row,
        )
        .optional()
        .map_err(map_database_error)?
        .ok_or(RepositoryError::NotFound)?;
    rule.labels = rule_values(connection, "classification_rule_labels", "label", rule_id)?;
    rule.tags = rule_values(connection, "classification_rule_tags", "tag", rule_id)?;
    Ok(rule)
}

fn rule_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClassificationRuleDto> {
    Ok(ClassificationRuleDto {
        id: row.get(0)?,
        household_id: row.get(1)?,
        name: row.get(2)?,
        priority: row.get(3)?,
        is_enabled: row.get(4)?,
        merchant_contains: row.get(5)?,
        description_contains: row.get(6)?,
        category_account_id: row.get(7)?,
        category_name: row.get(8)?,
        labels: vec![],
        tags: vec![],
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn rule_values(
    connection: &Connection,
    table: &str,
    column: &str,
    rule_id: &str,
) -> Result<Vec<String>, RepositoryError> {
    let sql = format!("SELECT {column} FROM {table} WHERE rule_id = ?1 ORDER BY {column}");
    let mut statement = connection.prepare(&sql).map_err(map_database_error)?;
    let rows = statement
        .query_map([rule_id], |row| row.get(0))
        .map_err(map_database_error)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)
}

fn replace_rule_values(
    connection: &Connection,
    rule_id: &str,
    labels: &[String],
    tags: &[String],
) -> Result<(), RepositoryError> {
    connection
        .execute(
            "DELETE FROM classification_rule_labels WHERE rule_id = ?1",
            [rule_id],
        )
        .map_err(map_database_error)?;
    connection
        .execute(
            "DELETE FROM classification_rule_tags WHERE rule_id = ?1",
            [rule_id],
        )
        .map_err(map_database_error)?;
    for label in labels {
        connection
            .execute(
                "INSERT INTO classification_rule_labels (rule_id, label) VALUES (?1, ?2)",
                params![rule_id, label],
            )
            .map_err(map_database_error)?;
    }
    for tag in tags {
        connection
            .execute(
                "INSERT INTO classification_rule_tags (rule_id, tag) VALUES (?1, ?2)",
                params![rule_id, tag],
            )
            .map_err(map_database_error)?;
    }
    Ok(())
}

fn get_savings_goal(
    connection: &Connection,
    household_id: &str,
    goal_id: &str,
) -> Result<SavingsGoalDto, RepositoryError> {
    connection
        .query_row(
            "SELECT id, household_id, name, target_jpy, saved_jpy, target_date,
                    status, created_at, updated_at
             FROM savings_goals WHERE id = ?1 AND household_id = ?2",
            params![goal_id, household_id],
            savings_goal_from_row,
        )
        .optional()
        .map_err(map_database_error)?
        .ok_or(RepositoryError::NotFound)
}

fn savings_goal_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavingsGoalDto> {
    let status: String = row.get(6)?;
    let status =
        SavingsGoalStatus::from_sql_value(&status).map_err(|_| rusqlite::Error::InvalidQuery)?;
    Ok(SavingsGoalDto {
        id: row.get(0)?,
        household_id: row.get(1)?,
        name: row.get(2)?,
        target_jpy: row.get(3)?,
        saved_jpy: row.get(4)?,
        target_date: row.get(5)?,
        status,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn validate_savings_goal_input<'a>(
    connection: &Connection,
    goal_id: &str,
    household_id: &str,
    name: &'a str,
    target_jpy: i64,
    saved_jpy: i64,
    target_date: &str,
) -> Result<&'a str, RepositoryError> {
    validate_id(goal_id, MAX_LOOKUP_ID_LEN)?;
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    let name = validate_savings_goal_name(name)?;
    validate_jpy(target_jpy, false)?;
    validate_jpy(saved_jpy, true)?;
    validate_optional_date(connection, Some(target_date))?;
    Ok(name)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRunCountsDto {
    pub total_runs: u64,
    pub discovered: u64,
    pub extracting: u64,
    pub review_required: u64,
    pub posted: u64,
    pub failed: u64,
    pub rolled_back: u64,
    pub source_documents: u64,
    pub source_records: u64,
    pub pending_candidates: u64,
    pub ready_candidates: u64,
}

pub fn import_run_counts(
    connection: &Connection,
    household_id: &str,
) -> Result<ImportRunCountsDto, RepositoryError> {
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    ensure_household_exists(connection, household_id)?;
    connection
        .query_row(
            "SELECT
               (SELECT count(*) FROM import_runs WHERE household_id = ?1),
               (SELECT count(*) FROM import_runs WHERE household_id = ?1 AND status = 'DISCOVERED'),
               (SELECT count(*) FROM import_runs WHERE household_id = ?1 AND status = 'EXTRACTING'),
               (SELECT count(*) FROM import_runs WHERE household_id = ?1 AND status = 'REVIEW_REQUIRED'),
               (SELECT count(*) FROM import_runs WHERE household_id = ?1 AND status = 'POSTED'),
               (SELECT count(*) FROM import_runs WHERE household_id = ?1 AND status = 'FAILED'),
               (SELECT count(*) FROM import_runs WHERE household_id = ?1 AND status = 'ROLLED_BACK'),
               (SELECT count(*) FROM source_documents WHERE household_id = ?1),
               (SELECT count(*) FROM source_records sr
                  JOIN source_documents sd ON sd.id = sr.source_document_id
                 WHERE sd.household_id = ?1),
               (SELECT count(*) FROM transaction_candidates WHERE household_id = ?1 AND review_status = 'PENDING'),
               (SELECT count(*) FROM transaction_candidates WHERE household_id = ?1 AND review_status = 'READY')",
            [household_id],
            |row| {
                Ok(ImportRunCountsDto {
                    total_runs: row.get(0)?,
                    discovered: row.get(1)?,
                    extracting: row.get(2)?,
                    review_required: row.get(3)?,
                    posted: row.get(4)?,
                    failed: row.get(5)?,
                    rolled_back: row.get(6)?,
                    source_documents: row.get(7)?,
                    source_records: row.get(8)?,
                    pending_candidates: row.get(9)?,
                    ready_candidates: row.get(10)?,
                })
            },
        )
        .map_err(map_database_error)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSettlementDto {
    pub id: String,
    pub card_account_id: String,
    pub card_name: String,
    pub masked_identifier: Option<String>,
    pub period_start: String,
    pub period_end: String,
    pub payment_due_on: Option<String>,
    pub statement_amount_jpy: i64,
    pub detail_amount_jpy: i64,
    pub line_count: u64,
    pub payment_id: Option<String>,
    pub bank_transaction_id: Option<String>,
    pub payment_amount_jpy: Option<i64>,
    pub payment_on: Option<String>,
    pub match_score_bps: Option<i64>,
    pub reconciliation_status: String,
}

pub fn list_card_settlements(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<CardSettlementDto>, RepositoryError> {
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    ensure_household_exists(connection, household_id)?;
    let mut statement = connection
        .prepare(
            "WITH line_totals AS (
               SELECT statement_id, count(*) AS line_count, COALESCE(sum(billed_amount_jpy), 0) AS detail_total
               FROM card_statement_transactions GROUP BY statement_id
             )
             SELECT cs.id, cs.card_account_id, a.name, a.masked_identifier,
                    cs.period_start, cs.period_end, cs.payment_due_on, cs.statement_amount_jpy,
                    COALESCE(lt.detail_total, 0), COALESCE(lt.line_count, 0),
                    cp.id, cp.bank_transaction_id, cp.payment_amount_jpy, cp.payment_on,
                    cp.match_score_bps, cs.reconciliation_status
             FROM card_statements cs
             JOIN accounts a ON a.id = cs.card_account_id
             LEFT JOIN line_totals lt ON lt.statement_id = cs.id
             LEFT JOIN card_payments cp ON cp.statement_id = cs.id
             WHERE cs.household_id = ?1
             ORDER BY cs.period_end DESC, cs.id DESC",
        )
        .map_err(map_database_error)?;
    let rows = statement
        .query_map([household_id], |row| {
            Ok(CardSettlementDto {
                id: row.get(0)?,
                card_account_id: row.get(1)?,
                card_name: row.get(2)?,
                masked_identifier: row.get(3)?,
                period_start: row.get(4)?,
                period_end: row.get(5)?,
                payment_due_on: row.get(6)?,
                statement_amount_jpy: row.get(7)?,
                detail_amount_jpy: row.get(8)?,
                line_count: row.get(9)?,
                payment_id: row.get(10)?,
                bank_transaction_id: row.get(11)?,
                payment_amount_jpy: row.get(12)?,
                payment_on: row.get(13)?,
                match_score_bps: row.get(14)?,
                reconciliation_status: row.get(15)?,
            })
        })
        .map_err(map_database_error)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(map_database_error)
}

fn validate_id(value: &str, max_len: usize) -> Result<(), RepositoryError> {
    if value.is_empty()
        || value.len() > max_len
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(RepositoryError::InvalidInput("Invalid identifier"));
    }
    Ok(())
}

fn validate_name(value: &str) -> Result<&str, RepositoryError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > MAX_NAME_LEN
        || trimmed.chars().any(char::is_control)
    {
        return Err(RepositoryError::InvalidInput("Invalid household name"));
    }
    Ok(trimmed)
}

fn validate_account_name(value: &str) -> Result<&str, RepositoryError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > MAX_NAME_LEN
        || trimmed.chars().any(char::is_control)
    {
        return Err(RepositoryError::InvalidInput("Invalid account name"));
    }
    Ok(trimmed)
}

fn validate_member_name(value: &str) -> Result<&str, RepositoryError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > MAX_NAME_LEN
        || trimmed.chars().any(char::is_control)
    {
        return Err(RepositoryError::InvalidInput("Invalid member name"));
    }
    Ok(trimmed)
}

fn validate_relationship_label(value: Option<&str>) -> Result<Option<&str>, RepositoryError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > MAX_RELATIONSHIP_LABEL_LEN
        || trimmed.chars().any(char::is_control)
    {
        return Err(RepositoryError::InvalidInput(
            "Invalid member relationship label",
        ));
    }
    Ok(Some(trimmed))
}

fn validate_account_ownership(
    connection: &Connection,
    household_id: &str,
    ownership_kind: AccountOwnershipKind,
    owner_member_id: Option<&str>,
    visibility: AccountVisibility,
) -> Result<(), RepositoryError> {
    match (ownership_kind, owner_member_id, visibility) {
        (AccountOwnershipKind::Household, None, AccountVisibility::Shared)
        | (AccountOwnershipKind::Member, Some(_), _) => {}
        _ => return Err(RepositoryError::InvalidInput("Invalid account ownership")),
    }
    if let Some(member_id) = owner_member_id {
        validate_id(member_id, MAX_LOOKUP_ID_LEN)?;
        let active: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM household_members
                 WHERE id = ?1 AND household_id = ?2 AND status = 'ACTIVE')",
                params![member_id, household_id],
                |row| row.get(0),
            )
            .map_err(map_database_error)?;
        if !active {
            return Err(RepositoryError::InvalidInput("Invalid account owner"));
        }
    }
    Ok(())
}

fn validate_transaction_scope(
    connection: &Connection,
    household_id: &str,
    attribution_kind: AttributionKind,
    attributed_member_id: Option<&str>,
    audience_visibility: AudienceVisibility,
    audience_member_id: Option<&str>,
) -> Result<(), RepositoryError> {
    if !attribution_shape_is_valid(attribution_kind, attributed_member_id)
        || !audience_shape_is_valid(audience_visibility, audience_member_id)
    {
        return Err(RepositoryError::InvalidInput(
            "Invalid transaction attribution or audience",
        ));
    }
    for member_id in [attributed_member_id, audience_member_id]
        .into_iter()
        .flatten()
    {
        validate_id(member_id, MAX_LOOKUP_ID_LEN)?;
        let belongs: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM household_members
                 WHERE id = ?1 AND household_id = ?2)",
                params![member_id, household_id],
                |row| row.get(0),
            )
            .map_err(map_database_error)?;
        if !belongs {
            return Err(RepositoryError::InvalidInput("Invalid transaction member"));
        }
    }
    Ok(())
}

fn household_member_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HouseholdMemberDto> {
    Ok(HouseholdMemberDto {
        id: row.get(0)?,
        household_id: row.get(1)?,
        display_name: row.get(2)?,
        relationship_label: row.get(3)?,
        status: row.get(4)?,
        sort_order: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn get_household_member(
    connection: &Connection,
    household_id: &str,
    member_id: &str,
) -> Result<HouseholdMemberDto, RepositoryError> {
    connection
        .query_row(
            "SELECT id, household_id, display_name, relationship_label, status,
                    sort_order, created_at, updated_at
             FROM household_members WHERE household_id = ?1 AND id = ?2",
            params![household_id, member_id],
            household_member_from_row,
        )
        .optional()
        .map_err(map_database_error)?
        .ok_or(RepositoryError::NotFound)
}

fn list_member_ids(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<String>, RepositoryError> {
    ensure_household_exists(connection, household_id)?;
    let mut statement = connection
        .prepare("SELECT id FROM household_members WHERE household_id = ?1 ORDER BY sort_order, id")
        .map_err(map_database_error)?;
    let member_ids = statement
        .query_map([household_id], |row| row.get(0))
        .map_err(map_database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_database_error)?;
    Ok(member_ids)
}

fn validate_savings_goal_name(value: &str) -> Result<&str, RepositoryError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > MAX_NAME_LEN
        || trimmed.chars().any(char::is_control)
    {
        return Err(RepositoryError::InvalidInput("Invalid savings goal name"));
    }
    Ok(trimmed)
}

fn validate_jpy(value: i64, allow_zero: bool) -> Result<(), RepositoryError> {
    let minimum = if allow_zero { 0 } else { 1 };
    if value < minimum || value > MAX_PLANNING_JPY {
        return Err(RepositoryError::InvalidInput("Invalid JPY amount"));
    }
    Ok(())
}

fn validate_optional_date(
    connection: &Connection,
    value: Option<&str>,
) -> Result<(), RepositoryError> {
    if let Some(value) = value {
        let valid: bool = connection
            .query_row(
                "SELECT COALESCE(strftime('%Y-%m-%d', date(?1, '+0 days')) = ?1, 0)",
                [value],
                |row| row.get(0),
            )
            .map_err(map_database_error)?;
        if value.len() != 10 || !valid {
            return Err(RepositoryError::InvalidInput(
                "Date must use a valid YYYY-MM-DD value",
            ));
        }
    }
    Ok(())
}

fn validate_month(connection: &Connection, value: &str) -> Result<(), RepositoryError> {
    if value.len() != 7 {
        return Err(RepositoryError::InvalidInput(
            "Month must use a valid YYYY-MM value",
        ));
    }
    let first_day = format!("{value}-01");
    let valid: bool = connection
        .query_row(
            "SELECT COALESCE(strftime('%Y-%m-%d', date(?1, '+0 days')) = ?1, 0)",
            [&first_day],
            |row| row.get(0),
        )
        .map_err(map_database_error)?;
    if !valid {
        return Err(RepositoryError::InvalidInput(
            "Month must use a valid YYYY-MM value",
        ));
    }
    Ok(())
}

fn ensure_household_exists(
    connection: &Connection,
    household_id: &str,
) -> Result<(), RepositoryError> {
    connection
        .query_row(
            "SELECT 1 FROM households WHERE id = ?1",
            [household_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(map_database_error)?
        .ok_or(RepositoryError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE households (
                   id TEXT PRIMARY KEY, name TEXT NOT NULL, base_currency TEXT NOT NULL DEFAULT 'JPY',
                   created_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z'
                 );
                 CREATE TABLE household_members (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   display_name TEXT NOT NULL, relationship_label TEXT,
                   status TEXT NOT NULL DEFAULT 'ACTIVE', sort_order INTEGER NOT NULL,
                   created_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z',
                   updated_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z',
                   UNIQUE(household_id, sort_order)
                 );
                 CREATE TRIGGER trg_household_primary_member_insert
                 AFTER INSERT ON households BEGIN
                   INSERT INTO household_members
                     (id, household_id, display_name, status, sort_order)
                   VALUES (NEW.id || '-member-primary', NEW.id, 'Primary member', 'ACTIVE', 0);
                 END;
                 CREATE TABLE accounts (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   name TEXT NOT NULL, account_kind TEXT NOT NULL, account_subtype TEXT NOT NULL,
                   currency TEXT NOT NULL, masked_identifier TEXT,
                   owner_member_id TEXT REFERENCES household_members(id),
                   ownership_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD',
                   visibility TEXT NOT NULL DEFAULT 'SHARED',
                   is_archived INTEGER NOT NULL DEFAULT 0,
                   updated_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z',
                   UNIQUE(household_id, name)
                 );
                 CREATE TABLE transactions (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   occurred_on TEXT NOT NULL, posted_on TEXT, transaction_type TEXT NOT NULL,
                   payee TEXT, description TEXT, status TEXT NOT NULL,
                   attribution_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD',
                   attributed_member_id TEXT,
                   audience_visibility TEXT NOT NULL DEFAULT 'SHARED',
                   audience_member_id TEXT,
                   calculation_target INTEGER NOT NULL DEFAULT 1 CHECK(calculation_target IN (0,1)),
                   created_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z',
                   updated_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z'
                 );
                 CREATE TABLE journal_entries (
                   id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id),
                   account_id TEXT NOT NULL REFERENCES accounts(id), entry_side TEXT NOT NULL,
                   amount_jpy INTEGER NOT NULL, line_number INTEGER NOT NULL
                 );
                 CREATE TABLE account_groups (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   name TEXT NOT NULL, group_kind TEXT NOT NULL, sort_order INTEGER NOT NULL
                 );
                 CREATE TABLE account_group_members (
                   household_id TEXT NOT NULL, account_group_id TEXT NOT NULL REFERENCES account_groups(id),
                   account_id TEXT NOT NULL REFERENCES accounts(id), sort_order INTEGER NOT NULL,
                   PRIMARY KEY (account_group_id, account_id)
                 );
                 CREATE TABLE card_settlement_bank_mappings (
                   household_id TEXT NOT NULL, card_account_id TEXT NOT NULL,
                   bank_account_id TEXT NOT NULL,
                   PRIMARY KEY(household_id,card_account_id)
                 );
                 CREATE TABLE import_runs (id TEXT PRIMARY KEY, household_id TEXT, status TEXT);
                 CREATE TABLE source_documents (
                   id TEXT PRIMARY KEY, household_id TEXT, import_run_id TEXT,
                   source_type TEXT, original_filename TEXT, media_type TEXT,
                   byte_size INTEGER, sha256 TEXT, storage_path TEXT,
                   source_modified_at TEXT,
                   audience_visibility TEXT NOT NULL DEFAULT 'SHARED',
                   audience_member_id TEXT,
                   imported_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z');
                 CREATE TABLE source_records (
                   id TEXT PRIMARY KEY, source_document_id TEXT, row_number INTEGER,
                   record_hash TEXT, raw_payload_json TEXT,
                   created_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z');
                 CREATE TABLE transaction_candidates (
                   id TEXT PRIMARY KEY, household_id TEXT, account_id TEXT REFERENCES accounts(id),
                   review_status TEXT,
                   attribution_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD',
                   attributed_member_id TEXT,
                   audience_visibility TEXT NOT NULL DEFAULT 'SHARED',
                   audience_member_id TEXT);
                 CREATE TABLE candidate_sources (
                   candidate_id TEXT NOT NULL, source_record_id TEXT NOT NULL,
                   evidence_role TEXT NOT NULL DEFAULT 'PRIMARY',
                   PRIMARY KEY(candidate_id, source_record_id));
                 CREATE TABLE transaction_sources (
                   transaction_id TEXT NOT NULL, source_record_id TEXT NOT NULL,
                   candidate_id TEXT, PRIMARY KEY(transaction_id, source_record_id));
                 CREATE TABLE card_statements (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL, card_account_id TEXT NOT NULL,
                   period_start TEXT NOT NULL, period_end TEXT NOT NULL, payment_due_on TEXT,
                   statement_amount_jpy INTEGER NOT NULL, reconciliation_status TEXT NOT NULL);
                 CREATE TABLE card_statement_transactions (
                   statement_id TEXT NOT NULL, transaction_id TEXT NOT NULL, statement_line_number INTEGER NOT NULL,
                   billed_amount_jpy INTEGER NOT NULL, PRIMARY KEY(statement_id,transaction_id));
                 CREATE TABLE card_payments (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL, statement_id TEXT,
                   bank_transaction_id TEXT NOT NULL, card_account_id TEXT NOT NULL,
                   payment_amount_jpy INTEGER NOT NULL, payment_on TEXT NOT NULL,
                   match_score_bps INTEGER, reconciliation_status TEXT NOT NULL);
                 CREATE TABLE staged_card_statements (
                   id TEXT PRIMARY KEY, import_run_id TEXT NOT NULL, household_id TEXT NOT NULL,
                   card_account_id TEXT NOT NULL REFERENCES accounts(id), issuer TEXT NOT NULL,
                   period_start TEXT NOT NULL, period_end TEXT NOT NULL, payment_due_on TEXT,
                   statement_amount_jpy INTEGER NOT NULL);
                 CREATE TABLE monthly_category_budgets (
                   household_id TEXT NOT NULL REFERENCES households(id), month TEXT NOT NULL,
                   category_account_id TEXT NOT NULL REFERENCES accounts(id), budget_jpy INTEGER NOT NULL,
                   created_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z',
                   updated_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z',
                   PRIMARY KEY(household_id, month, category_account_id));
                 CREATE TABLE savings_goals (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   name TEXT NOT NULL, target_jpy INTEGER NOT NULL, saved_jpy INTEGER NOT NULL,
                   target_date TEXT NOT NULL, status TEXT NOT NULL,
                   created_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z',
                   updated_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z');",
            )
            .expect("compatible schema");
        connection
            .execute_batch(include_str!("../migrations/0009_classification_rules.sql"))
            .expect("classification rule schema");
        connection
    }

    #[test]
    fn creating_household_seeds_canonical_accounts_atomically() {
        let connection = database();
        let household = create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".to_owned(),
                name: "  Family  ".to_owned(),
            },
        )
        .expect("household should be created");
        assert_eq!(household.name, "Family");
        let count: i64 = connection
            .query_row(
                "SELECT count(*) FROM accounts WHERE household_id = 'family'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 14);
        let members = list_household_members(&connection, "family").unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].id, "family-member-primary");
        assert_eq!(members[0].status, "ACTIVE");
        assert!(list_accounts(&connection, "family")
            .unwrap()
            .iter()
            .all(|account| {
                account.ownership_kind == "HOUSEHOLD"
                    && account.owner_member_id.is_none()
                    && account.visibility == "SHARED"
            }));
    }

    #[test]
    fn member_lifecycle_and_account_ownership_are_household_scoped() {
        let connection = database();
        for id in ["family", "other"] {
            create_household(
                &connection,
                &CreateHouseholdInput {
                    id: id.into(),
                    name: id.into(),
                },
            )
            .unwrap();
        }
        let member = create_household_member(
            &connection,
            &CreateHouseholdMemberInput {
                id: "family-alice".into(),
                household_id: "family".into(),
                display_name: " Alice ".into(),
                relationship_label: Some("本人".into()),
            },
        )
        .unwrap();
        assert_eq!(member.display_name, "Alice");
        assert_eq!(member.sort_order, 1);

        let member = update_household_member(
            &connection,
            &UpdateHouseholdMemberInput {
                household_id: "family".into(),
                member_id: member.id.clone(),
                display_name: "Alice A.".into(),
                relationship_label: Some("本人".into()),
                sort_order: 0,
            },
        )
        .unwrap();
        assert_eq!(member.sort_order, 0);
        assert_eq!(
            list_household_members(&connection, "family").unwrap()[1].sort_order,
            1
        );

        let account = create_account(
            &connection,
            &CreateAccountInput {
                id: "family-alice-bank".into(),
                household_id: "family".into(),
                name: "Alice Bank".into(),
                account_kind: AccountKind::Asset,
                account_subtype: AccountSubtype::Bank,
                currency: AccountCurrency::Jpy,
                ownership_kind: AccountOwnershipKind::Member,
                owner_member_id: Some(member.id.clone()),
                visibility: AccountVisibility::Shared,
            },
        )
        .unwrap();
        assert_eq!(account.owner_member_name.as_deref(), Some("Alice A."));
        assert_eq!(account.visibility, "SHARED");
        let personal = update_account_ownership(
            &connection,
            &UpdateAccountOwnershipInput {
                household_id: "family".into(),
                account_id: account.id.clone(),
                ownership_kind: AccountOwnershipKind::Member,
                owner_member_id: Some(member.id.clone()),
                visibility: AccountVisibility::Personal,
            },
        )
        .unwrap();
        assert_eq!(personal.visibility, "PERSONAL");
        assert!(matches!(
            archive_household_member(&connection, "family", &member.id),
            Err(RepositoryError::InUse)
        ));
        assert!(matches!(
            update_account_ownership(
                &connection,
                &UpdateAccountOwnershipInput {
                    household_id: "family".into(),
                    account_id: account.id.clone(),
                    ownership_kind: AccountOwnershipKind::Member,
                    owner_member_id: Some("other-member-primary".into()),
                    visibility: AccountVisibility::Personal,
                }
            ),
            Err(RepositoryError::InvalidInput(_))
        ));
        assert!(matches!(
            update_account_ownership(
                &connection,
                &UpdateAccountOwnershipInput {
                    household_id: "family".into(),
                    account_id: account.id.clone(),
                    ownership_kind: AccountOwnershipKind::Household,
                    owner_member_id: None,
                    visibility: AccountVisibility::Personal,
                }
            ),
            Err(RepositoryError::InvalidInput(_))
        ));
        update_account_ownership(
            &connection,
            &UpdateAccountOwnershipInput {
                household_id: "family".into(),
                account_id: account.id,
                ownership_kind: AccountOwnershipKind::Household,
                owner_member_id: None,
                visibility: AccountVisibility::Shared,
            },
        )
        .unwrap();
        archive_household_member(&connection, "family", &member.id).unwrap();
        assert_eq!(
            list_household_members(&connection, "family").unwrap()[0].status,
            "ARCHIVED"
        );
        assert!(matches!(
            archive_household_member(&connection, "family", "family-member-primary"),
            Err(RepositoryError::InUse)
        ));
    }

    fn create_test_account(connection: &Connection, household_id: &str, id: &str) -> AccountDto {
        create_account(
            connection,
            &CreateAccountInput {
                id: id.to_owned(),
                household_id: household_id.to_owned(),
                name: format!("Account {id}"),
                account_kind: AccountKind::Asset,
                account_subtype: AccountSubtype::Bank,
                currency: AccountCurrency::Jpy,
                ownership_kind: AccountOwnershipKind::Household,
                owner_member_id: None,
                visibility: AccountVisibility::Shared,
            },
        )
        .expect("custom account")
    }

    fn manual_expense(
        id: &str,
        household_id: &str,
        amount_jpy: i64,
    ) -> CreateManualTransactionInput {
        CreateManualTransactionInput {
            id: id.into(),
            household_id: household_id.into(),
            occurred_on: "2026-07-12".into(),
            posted_on: None,
            transaction_type: ManualTransactionType::Expense,
            payee: Some(format!("Coffee {id}")),
            description: Some("Manual entry".into()),
            attribution_kind: AttributionKind::Household,
            attributed_member_id: None,
            audience_visibility: AudienceVisibility::Shared,
            audience_member_id: None,
            entries: vec![
                ManualJournalEntryInput {
                    id: format!("{id}-debit"),
                    account_id: format!("{household_id}-groceries"),
                    side: ManualEntrySide::Debit,
                    amount_jpy,
                },
                ManualJournalEntryInput {
                    id: format!("{id}-credit"),
                    account_id: format!("{household_id}-bank"),
                    side: ManualEntrySide::Credit,
                    amount_jpy,
                },
            ],
        }
    }

    #[test]
    fn account_lifecycle_validates_types_and_keeps_lists_active_only() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        let created = create_account(
            &connection,
            &CreateAccountInput {
                id: "family-savings".into(),
                household_id: "family".into(),
                name: "  Savings  ".into(),
                account_kind: AccountKind::Asset,
                account_subtype: AccountSubtype::Bank,
                currency: AccountCurrency::Jpy,
                ownership_kind: AccountOwnershipKind::Household,
                owner_member_id: None,
                visibility: AccountVisibility::Shared,
            },
        )
        .unwrap();
        assert_eq!(created.name, "Savings");
        assert_eq!(created.account_kind, "ASSET");
        assert_eq!(created.account_subtype, "BANK");
        assert_eq!(created.currency, "JPY");

        let renamed = rename_account(
            &connection,
            &RenameAccountInput {
                household_id: "family".into(),
                account_id: created.id.clone(),
                name: "  Emergency Savings  ".into(),
            },
        )
        .unwrap();
        assert_eq!(renamed.name, "Emergency Savings");
        assert!(list_accounts(&connection, "family")
            .unwrap()
            .iter()
            .any(|account| account.id == created.id));

        archive_account(
            &connection,
            &ArchiveAccountInput {
                household_id: "family".into(),
                account_id: created.id.clone(),
            },
        )
        .unwrap();
        assert!(!list_accounts(&connection, "family")
            .unwrap()
            .iter()
            .any(|account| account.id == created.id));
        assert!(matches!(
            rename_account(
                &connection,
                &RenameAccountInput {
                    household_id: "family".into(),
                    account_id: created.id,
                    name: "Unavailable".into(),
                }
            ),
            Err(RepositoryError::NotFound)
        ));

        assert!(matches!(
            create_account(
                &connection,
                &CreateAccountInput {
                    id: "family-invalid".into(),
                    household_id: "family".into(),
                    name: "Invalid".into(),
                    account_kind: AccountKind::Expense,
                    account_subtype: AccountSubtype::Bank,
                    currency: AccountCurrency::Jpy,
                    ownership_kind: AccountOwnershipKind::Household,
                    owner_member_id: None,
                    visibility: AccountVisibility::Shared,
                }
            ),
            Err(RepositoryError::InvalidInput(_))
        ));
    }

    #[test]
    fn account_mutations_are_strictly_household_scoped() {
        let connection = database();
        for id in ["one", "two"] {
            create_household(
                &connection,
                &CreateHouseholdInput {
                    id: id.into(),
                    name: id.into(),
                },
            )
            .unwrap();
        }
        create_test_account(&connection, "one", "one-custom");

        assert!(matches!(
            rename_account(
                &connection,
                &RenameAccountInput {
                    household_id: "two".into(),
                    account_id: "one-custom".into(),
                    name: "Cross household".into(),
                }
            ),
            Err(RepositoryError::NotFound)
        ));
        assert!(matches!(
            archive_account(
                &connection,
                &ArchiveAccountInput {
                    household_id: "two".into(),
                    account_id: "one-custom".into(),
                }
            ),
            Err(RepositoryError::NotFound)
        ));
        assert_eq!(
            find_active_account(&connection, "one", "one-custom")
                .unwrap()
                .name,
            "Account one-custom"
        );
    }

    #[test]
    fn account_archive_rejects_required_and_referenced_accounts() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        assert!(matches!(
            archive_account(
                &connection,
                &ArchiveAccountInput {
                    household_id: "family".into(),
                    account_id: "family-bank".into(),
                }
            ),
            Err(RepositoryError::InUse)
        ));

        for id in [
            "posted-account",
            "candidate-account",
            "statement-account",
            "payment-account",
            "staged-account",
            "budget-account",
            "mapped-card-account",
            "mapped-bank-account",
        ] {
            create_test_account(&connection, "family", id);
        }
        connection
            .execute_batch(
                "INSERT INTO transactions
                   (id, household_id, occurred_on, transaction_type, status)
                 VALUES ('posted', 'family', '2026-07-12', 'ADJUSTMENT', 'POSTED');
                 INSERT INTO journal_entries
                   (id, transaction_id, account_id, entry_side, amount_jpy, line_number)
                 VALUES ('entry', 'posted', 'posted-account', 'DEBIT', 1, 1);
                 INSERT INTO transaction_candidates
                   (id, household_id, account_id, review_status)
                 VALUES ('candidate', 'family', 'candidate-account', 'READY');
                 INSERT INTO card_statements
                   (id, household_id, card_account_id, period_start, period_end,
                    statement_amount_jpy, reconciliation_status)
                 VALUES ('statement', 'family', 'statement-account', '2026-07-01',
                         '2026-07-31', 1, 'UNMATCHED');
                 INSERT INTO card_payments
                   (id, household_id, bank_transaction_id, card_account_id,
                    payment_amount_jpy, payment_on, reconciliation_status)
                 VALUES ('payment', 'family', 'posted', 'payment-account', 1,
                         '2026-07-31', 'UNMATCHED');
                 INSERT INTO staged_card_statements
                   (id, import_run_id, household_id, card_account_id, issuer,
                    period_start, period_end, statement_amount_jpy)
                 VALUES ('staged', 'run', 'family', 'staged-account', 'Issuer',
                         '2026-07-01', '2026-07-31', 1);
                 INSERT INTO monthly_category_budgets
                   (household_id, month, category_account_id, budget_jpy)
                 VALUES ('family', '2026-07', 'budget-account', 1);
                 INSERT INTO card_settlement_bank_mappings
                   (household_id,card_account_id,bank_account_id)
                 VALUES ('family','mapped-card-account','mapped-bank-account');",
            )
            .unwrap();

        for id in [
            "posted-account",
            "candidate-account",
            "statement-account",
            "payment-account",
            "staged-account",
            "budget-account",
            "mapped-card-account",
            "mapped-bank-account",
        ] {
            assert!(matches!(
                archive_account(
                    &connection,
                    &ArchiveAccountInput {
                        household_id: "family".into(),
                        account_id: id.into(),
                    }
                ),
                Err(RepositoryError::InUse)
            ));
        }
    }

    #[test]
    fn draft_journal_and_inactive_candidate_do_not_block_account_archive() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        create_test_account(&connection, "family", "family-unused");
        connection
            .execute_batch(
                "INSERT INTO transactions
                   (id, household_id, occurred_on, transaction_type, status)
                 VALUES ('draft', 'family', '2026-07-12', 'ADJUSTMENT', 'DRAFT');
                 INSERT INTO journal_entries
                   (id, transaction_id, account_id, entry_side, amount_jpy, line_number)
                 VALUES ('draft-entry', 'draft', 'family-unused', 'DEBIT', 1, 1);
                 INSERT INTO transaction_candidates
                   (id, household_id, account_id, review_status)
                 VALUES ('excluded', 'family', 'family-unused', 'EXCLUDED');",
            )
            .unwrap();
        archive_account(
            &connection,
            &ArchiveAccountInput {
                household_id: "family".into(),
                account_id: "family-unused".into(),
            },
        )
        .unwrap();
    }

    #[test]
    fn accounting_basis_filters_card_events_without_double_counting() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".to_owned(),
                name: "Family".to_owned(),
            },
        )
        .unwrap();
        connection
            .execute_batch(
                "INSERT INTO transactions (id, household_id, occurred_on, transaction_type, status)
                   VALUES ('purchase', 'family', '2026-07-01', 'CARD_PURCHASE', 'POSTED'),
                          ('payment', 'family', '2026-07-27', 'CARD_PAYMENT', 'POSTED'),
                          ('salary', 'family', '2026-07-25', 'INCOME', 'POSTED'),
                          ('rent', 'family', '2026-07-03', 'EXPENSE', 'POSTED');
                 INSERT INTO journal_entries (id, transaction_id, account_id, entry_side, amount_jpy, line_number)
                   VALUES ('j1', 'purchase', 'family-groceries', 'DEBIT', 1000, 1),
                          ('j2', 'purchase', 'family-card', 'CREDIT', 1000, 2),
                          ('j3', 'payment', 'family-card', 'DEBIT', 1000, 1),
                          ('j4', 'payment', 'family-bank', 'CREDIT', 1000, 2),
                          ('j5', 'salary', 'family-bank', 'DEBIT', 3000, 1),
                          ('j6', 'salary', 'family-income', 'CREDIT', 3000, 2),
                          ('j7', 'rent', 'family-housing', 'DEBIT', 500, 1),
                          ('j8', 'rent', 'family-bank', 'CREDIT', 500, 2);",
            )
            .unwrap();

        let accrual = list_transactions(
            &connection,
            &TransactionPageRequest {
                household_id: "family".to_owned(),
                account_group_id: None,
                attribution_scope: AttributionScope::All,
                accounting_basis: AccountingBasis::Accrual,
                from_date: None,
                to_date: None,
                search: None,
                calculation_target_filter: None,
                page: 1,
                page_size: 20,
            },
        )
        .unwrap();
        let cash = list_transactions(
            &connection,
            &TransactionPageRequest {
                accounting_basis: AccountingBasis::Cash,
                ..TransactionPageRequest {
                    household_id: "family".to_owned(),
                    account_group_id: None,
                    attribution_scope: AttributionScope::All,
                    accounting_basis: AccountingBasis::Accrual,
                    from_date: None,
                    to_date: None,
                    search: None,
                    calculation_target_filter: None,
                    page: 1,
                    page_size: 20,
                }
            },
        )
        .unwrap();
        assert_eq!(accrual.total_items, 3);
        assert!(accrual.items.iter().all(|item| item.id != "payment"));
        assert_eq!(cash.total_items, 3);
        assert!(cash.items.iter().all(|item| item.id != "purchase"));

        let accrual_totals = dashboard_monthly_totals(
            &connection,
            "family",
            "2026-07",
            AccountingBasis::Accrual,
            None,
            &AttributionScope::All,
        )
        .unwrap();
        let cash_totals = dashboard_monthly_totals(
            &connection,
            "family",
            "2026-07",
            AccountingBasis::Cash,
            None,
            &AttributionScope::All,
        )
        .unwrap();
        assert_eq!(accrual_totals.income_jpy, 3000);
        assert_eq!(accrual_totals.expense_jpy, 1500);
        assert_eq!(accrual_totals.savings_jpy, 1500);
        assert_eq!(accrual_totals.posted_transaction_count, 3);
        assert_eq!(cash_totals.income_jpy, 3000);
        assert_eq!(cash_totals.expense_jpy, 1500);
        assert_eq!(cash_totals.savings_jpy, 1500);
        assert_eq!(cash_totals.posted_transaction_count, 3);

        assert_eq!(accrual_totals.net_worth_as_of, "2026-07-31");
        assert_eq!(accrual_totals.assets_jpy, 1500);
        assert_eq!(accrual_totals.liabilities_jpy, 0);
        assert_eq!(accrual_totals.net_worth_jpy, 1500);
        assert_eq!(accrual_totals.accrual_trend.len(), 6);
        let july = accrual_totals.accrual_trend.last().unwrap();
        assert_eq!(july.month, "2026-07");
        assert_eq!(july.income_jpy, 3000);
        assert_eq!(july.expense_jpy, 1500);
        assert_eq!(accrual_totals.expense_categories.len(), 2);
        assert_eq!(
            accrual_totals.expense_categories[0].account_id,
            "family-groceries"
        );
        assert_eq!(accrual_totals.expense_categories[0].amount_jpy, 1000);
        assert_eq!(
            accrual_totals.expense_categories[1].account_id,
            "family-housing"
        );
        assert_eq!(accrual_totals.expense_categories[1].amount_jpy, 500);

        // The new analytical fields have accrual/as-of semantics regardless of
        // which basis is selected for the headline monthly cash-flow totals.
        assert_eq!(cash_totals.net_worth_jpy, accrual_totals.net_worth_jpy);
        assert_eq!(cash_totals.accrual_trend.last().unwrap().expense_jpy, 1500);
        assert_eq!(cash_totals.expense_categories.len(), 2);

        connection
            .execute_batch(
                "INSERT INTO account_groups VALUES ('purchase-scope','family','Purchase','CUSTOM',0);
                 INSERT INTO account_group_members VALUES
                   ('family','purchase-scope','family-groceries',0),
                   ('family','purchase-scope','family-card',1);
                 INSERT INTO households (id,name) VALUES ('other','Other');
                 INSERT INTO account_groups VALUES ('foreign-scope','other','Foreign','CUSTOM',0);",
            )
            .unwrap();
        let scoped = list_transactions(
            &connection,
            &TransactionPageRequest {
                household_id: "family".into(),
                account_group_id: Some("purchase-scope".into()),
                attribution_scope: AttributionScope::All,
                accounting_basis: AccountingBasis::Accrual,
                from_date: None,
                to_date: None,
                search: None,
                calculation_target_filter: None,
                page: 1,
                page_size: 20,
            },
        )
        .unwrap();
        assert_eq!(scoped.total_items, 1);
        assert_eq!(scoped.items[0].id, "purchase");
        let scoped_totals = dashboard_monthly_totals(
            &connection,
            "family",
            "2026-07",
            AccountingBasis::Accrual,
            Some("purchase-scope"),
            &AttributionScope::All,
        )
        .unwrap();
        assert_eq!(scoped_totals.posted_transaction_count, 1);
        assert_eq!(scoped_totals.expense_jpy, 1000);
        assert!(matches!(
            dashboard_monthly_totals(
                &connection,
                "family",
                "2026-07",
                AccountingBasis::Accrual,
                Some("foreign-scope"),
                &AttributionScope::All,
            ),
            Err(RepositoryError::NotFound)
        ));
    }

    #[test]
    fn transaction_query_supports_pagination_search_and_account_category_projection() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        for id in ["manual-1", "manual-2", "manual-3"] {
            create_manual_transaction(&connection, &manual_expense(id, "family", 1_000)).unwrap();
        }

        let first_page = list_transactions(
            &connection,
            &TransactionPageRequest {
                household_id: "family".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::All,
                accounting_basis: AccountingBasis::Accrual,
                from_date: None,
                to_date: None,
                search: None,
                calculation_target_filter: None,
                page: 1,
                page_size: 2,
            },
        )
        .unwrap();
        let second_page = list_transactions(
            &connection,
            &TransactionPageRequest {
                page: 2,
                ..TransactionPageRequest {
                    household_id: "family".into(),
                    account_group_id: None,
                    attribution_scope: AttributionScope::All,
                    accounting_basis: AccountingBasis::Accrual,
                    from_date: None,
                    to_date: None,
                    search: None,
                    calculation_target_filter: None,
                    page: 1,
                    page_size: 2,
                }
            },
        )
        .unwrap();
        assert_eq!(first_page.total_items, 3);
        assert_eq!(first_page.total_pages, 2);
        assert_eq!(first_page.items.len(), 2);
        assert_eq!(second_page.items.len(), 1);

        let searched = list_transactions(
            &connection,
            &TransactionPageRequest {
                household_id: "family".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::All,
                accounting_basis: AccountingBasis::Accrual,
                from_date: None,
                to_date: None,
                search: Some("Groceries".into()),
                calculation_target_filter: None,
                page: 1,
                page_size: 20,
            },
        )
        .unwrap();
        assert_eq!(searched.total_items, 3);
        let row = &searched.items[0];
        assert_eq!(row.debit_account_id.as_deref(), Some("family-groceries"));
        assert_eq!(row.debit_account_name.as_deref(), Some("Groceries"));
        assert_eq!(row.credit_account_id.as_deref(), Some("family-bank"));
        assert_eq!(row.credit_account_name.as_deref(), Some("Bank"));
        assert_eq!(row.category_account_id.as_deref(), Some("family-groceries"));
        assert_eq!(row.category_name.as_deref(), Some("Groceries"));

        let literal_wildcard = list_transactions(
            &connection,
            &TransactionPageRequest {
                search: Some("%".into()),
                calculation_target_filter: None,
                ..TransactionPageRequest {
                    household_id: "family".into(),
                    account_group_id: None,
                    attribution_scope: AttributionScope::All,
                    accounting_basis: AccountingBasis::Accrual,
                    from_date: None,
                    to_date: None,
                    search: None,
                    calculation_target_filter: None,
                    page: 1,
                    page_size: 20,
                }
            },
        )
        .unwrap();
        assert_eq!(literal_wildcard.total_items, 0);
    }

    #[test]
    fn attribution_scope_filters_transactions_and_dashboard_but_not_net_worth() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        create_household_member(
            &connection,
            &CreateHouseholdMemberInput {
                id: "family-alice".into(),
                household_id: "family".into(),
                display_name: "Alice".into(),
                relationship_label: None,
            },
        )
        .unwrap();
        archive_household_member(&connection, "family", "family-alice").unwrap();
        create_manual_transaction(&connection, &manual_expense("common", "family", 100)).unwrap();
        let mut alice_grocery = manual_expense("alice-grocery", "family", 200);
        alice_grocery.attribution_kind = AttributionKind::Member;
        alice_grocery.attributed_member_id = Some("family-alice".into());
        create_manual_transaction(&connection, &alice_grocery).unwrap();
        let mut alice_housing = manual_expense("alice-housing", "family", 300);
        alice_housing.attribution_kind = AttributionKind::Member;
        alice_housing.attributed_member_id = Some("family-alice".into());
        alice_housing.entries[0].account_id = "family-housing".into();
        create_manual_transaction(&connection, &alice_housing).unwrap();
        connection
            .execute_batch(
                "INSERT INTO account_groups VALUES ('groceries','family','Groceries','CUSTOM',0);
                 INSERT INTO account_group_members VALUES
                   ('family','groceries','family-groceries',0);",
            )
            .unwrap();

        let alice_scope = AttributionScope::Member {
            member_id: "family-alice".into(),
        };
        let alice = list_transactions(
            &connection,
            &TransactionPageRequest {
                household_id: "family".into(),
                account_group_id: None,
                attribution_scope: alice_scope.clone(),
                accounting_basis: AccountingBasis::Accrual,
                from_date: None,
                to_date: None,
                search: None,
                calculation_target_filter: None,
                page: 1,
                page_size: 20,
            },
        )
        .unwrap();
        assert_eq!(alice.total_items, 2);
        let common = list_transactions(
            &connection,
            &TransactionPageRequest {
                attribution_scope: AttributionScope::HouseholdCommon,
                ..TransactionPageRequest {
                    household_id: "family".into(),
                    account_group_id: None,
                    attribution_scope: AttributionScope::All,
                    accounting_basis: AccountingBasis::Accrual,
                    from_date: None,
                    to_date: None,
                    search: None,
                    calculation_target_filter: None,
                    page: 1,
                    page_size: 20,
                }
            },
        )
        .unwrap();
        assert_eq!(common.total_items, 1);
        let intersected = list_transactions(
            &connection,
            &TransactionPageRequest {
                household_id: "family".into(),
                account_group_id: Some("groceries".into()),
                attribution_scope: alice_scope.clone(),
                accounting_basis: AccountingBasis::Accrual,
                from_date: None,
                to_date: None,
                search: None,
                calculation_target_filter: None,
                page: 1,
                page_size: 20,
            },
        )
        .unwrap();
        assert_eq!(intersected.total_items, 1);
        assert_eq!(intersected.items[0].id, "alice-grocery");

        let dashboard = dashboard_monthly_totals(
            &connection,
            "family",
            "2026-07",
            AccountingBasis::Accrual,
            None,
            &alice_scope,
        )
        .unwrap();
        assert_eq!(dashboard.expense_jpy, 500);
        assert_eq!(dashboard.posted_transaction_count, 2);
        assert_eq!(dashboard.net_worth_jpy, -600);
        assert_eq!(dashboard.accrual_trend.last().unwrap().expense_jpy, 500);
        assert_eq!(dashboard.expense_categories.len(), 2);

        assert!(matches!(
            list_transactions(
                &connection,
                &TransactionPageRequest {
                    attribution_scope: AttributionScope::Member {
                        member_id: "foreign-member".into()
                    },
                    ..TransactionPageRequest {
                        household_id: "family".into(),
                        account_group_id: None,
                        attribution_scope: AttributionScope::All,
                        accounting_basis: AccountingBasis::Accrual,
                        from_date: None,
                        to_date: None,
                        search: None,
                        calculation_target_filter: None,
                        page: 1,
                        page_size: 20,
                    }
                }
            ),
            Err(RepositoryError::NotFound)
        ));
    }

    #[test]
    fn manual_transaction_posts_balanced_integer_jpy_atomically() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();

        let row =
            create_manual_transaction(&connection, &manual_expense("manual", "family", 1_234))
                .unwrap();
        assert_eq!(row.id, "manual");
        assert_eq!(row.status, "POSTED");
        assert_eq!(row.amount_jpy, 1_234);
        let entry_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM journal_entries WHERE transaction_id = 'manual'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(entry_count, 2);
    }

    #[test]
    fn manual_transaction_rejects_cross_household_accounts_without_partial_write() {
        let connection = database();
        for household_id in ["one", "two"] {
            create_household(
                &connection,
                &CreateHouseholdInput {
                    id: household_id.into(),
                    name: household_id.into(),
                },
            )
            .unwrap();
        }
        let mut input = manual_expense("cross", "one", 500);
        input.entries[1].account_id = "two-bank".into();
        assert!(matches!(
            create_manual_transaction(&connection, &input),
            Err(RepositoryError::NotFound)
        ));
        let transaction_count: i64 = connection
            .query_row("SELECT count(*) FROM transactions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(transaction_count, 0);
    }

    #[test]
    fn transaction_attribution_and_audience_are_explicit_independent_history() {
        let connection = database();
        for household_id in ["family", "other"] {
            create_household(
                &connection,
                &CreateHouseholdInput {
                    id: household_id.into(),
                    name: household_id.into(),
                },
            )
            .unwrap();
        }
        create_household_member(
            &connection,
            &CreateHouseholdMemberInput {
                id: "family-alice".into(),
                household_id: "family".into(),
                display_name: "Alice".into(),
                relationship_label: None,
            },
        )
        .unwrap();
        archive_household_member(&connection, "family", "family-alice").unwrap();

        let mut input = manual_expense("alice-spend", "family", 800);
        input.attribution_kind = AttributionKind::Member;
        input.attributed_member_id = Some("family-alice".into());
        input.audience_visibility = AudienceVisibility::Shared;
        let row = create_manual_transaction(&connection, &input).unwrap();
        assert_eq!(row.attribution_kind, "MEMBER");
        assert_eq!(row.attributed_member_name.as_deref(), Some("Alice"));
        assert_eq!(row.audience_visibility, "SHARED");
        assert!(row.audience_member_id.is_none());

        let mut update = update_from_manual(&input);
        update.audience_visibility = AudienceVisibility::Personal;
        update.audience_member_id = Some("family-alice".into());
        let detail = update_posted_transaction(&connection, &update).unwrap();
        assert_eq!(detail.attribution_kind, "MEMBER");
        assert_eq!(detail.audience_visibility, "PERSONAL");
        assert_eq!(detail.audience_member_name.as_deref(), Some("Alice"));

        let before: i64 = connection
            .query_row("SELECT count(*) FROM transactions", [], |row| row.get(0))
            .unwrap();
        let mut foreign = manual_expense("foreign-scope", "family", 100);
        foreign.attribution_kind = AttributionKind::Member;
        foreign.attributed_member_id = Some("other-member-primary".into());
        assert!(matches!(
            create_manual_transaction(&connection, &foreign),
            Err(RepositoryError::InvalidInput(_))
        ));
        let mut malformed = manual_expense("malformed-scope", "family", 100);
        malformed.audience_visibility = AudienceVisibility::Personal;
        assert!(matches!(
            create_manual_transaction(&connection, &malformed),
            Err(RepositoryError::InvalidInput(_))
        ));
        let after: i64 = connection
            .query_row("SELECT count(*) FROM transactions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(after, before);
    }

    #[test]
    fn manual_transaction_rejects_unbalanced_and_duplicate_entries_atomically() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();

        let mut unbalanced = manual_expense("unbalanced", "family", 500);
        unbalanced.entries[1].amount_jpy = 499;
        assert!(matches!(
            create_manual_transaction(&connection, &unbalanced),
            Err(RepositoryError::InvalidInput(_))
        ));

        let mut duplicate = manual_expense("duplicate", "family", 500);
        duplicate.entries[1].id = duplicate.entries[0].id.clone();
        assert!(matches!(
            create_manual_transaction(&connection, &duplicate),
            Err(RepositoryError::InvalidInput(_))
        ));
        let transaction_count: i64 = connection
            .query_row("SELECT count(*) FROM transactions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(transaction_count, 0);
    }

    #[test]
    fn manual_transaction_type_requires_matching_account_shape() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        let mut mislabeled = manual_expense("mislabeled", "family", 1_000);
        mislabeled.transaction_type = ManualTransactionType::CardPayment;
        assert!(matches!(
            create_manual_transaction(&connection, &mislabeled),
            Err(RepositoryError::InvalidInput(_))
        ));

        let valid = CreateManualTransactionInput {
            entries: vec![
                ManualJournalEntryInput {
                    id: "payment-debit".into(),
                    account_id: "family-card".into(),
                    side: ManualEntrySide::Debit,
                    amount_jpy: 1_000,
                },
                ManualJournalEntryInput {
                    id: "payment-credit".into(),
                    account_id: "family-bank".into(),
                    side: ManualEntrySide::Credit,
                    amount_jpy: 1_000,
                },
            ],
            transaction_type: ManualTransactionType::CardPayment,
            ..manual_expense("payment", "family", 1_000)
        };
        assert!(create_manual_transaction(&connection, &valid).is_ok());
    }

    fn update_from_manual(input: &CreateManualTransactionInput) -> UpdatePostedTransactionInput {
        UpdatePostedTransactionInput {
            household_id: input.household_id.clone(),
            transaction_id: input.id.clone(),
            occurred_on: input.occurred_on.clone(),
            posted_on: input.posted_on.clone(),
            transaction_type: input.transaction_type,
            payee: input.payee.clone(),
            description: input.description.clone(),
            calculation_target: true,
            attribution_kind: input.attribution_kind,
            attributed_member_id: input.attributed_member_id.clone(),
            audience_visibility: input.audience_visibility,
            audience_member_id: input.audience_member_id.clone(),
            entries: input.entries.clone(),
        }
    }

    #[test]
    fn transaction_detail_returns_ordered_journal_without_private_source_data() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        create_manual_transaction(&connection, &manual_expense("manual", "family", 1_234)).unwrap();

        let detail = get_transaction_detail(&connection, "family", "manual").unwrap();
        assert!(detail.editable);
        assert_eq!(detail.entries.len(), 2);
        assert_eq!(detail.entries[0].side, "DEBIT");
        assert_eq!(detail.entries[0].account_name, "Groceries");
        assert_eq!(detail.entries[1].line_number, 2);
        assert!(detail.source_evidence.is_empty());
        assert!(matches!(
            get_transaction_detail(&connection, "other", "manual"),
            Err(RepositoryError::NotFound)
        ));
    }

    #[test]
    fn posted_transaction_update_supports_split_entries_atomically() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        let original = manual_expense("manual", "family", 1_000);
        create_manual_transaction(&connection, &original).unwrap();

        let mut update = update_from_manual(&original);
        update.occurred_on = "2026-07-13".into();
        update.payee = Some("Split shop".into());
        update.entries = vec![
            ManualJournalEntryInput {
                id: "split-grocery".into(),
                account_id: "family-groceries".into(),
                side: ManualEntrySide::Debit,
                amount_jpy: 700,
            },
            ManualJournalEntryInput {
                id: "split-transport".into(),
                account_id: "family-transport".into(),
                side: ManualEntrySide::Debit,
                amount_jpy: 300,
            },
            ManualJournalEntryInput {
                id: "split-bank".into(),
                account_id: "family-bank".into(),
                side: ManualEntrySide::Credit,
                amount_jpy: 1_000,
            },
        ];
        let detail = update_posted_transaction(&connection, &update).unwrap();
        assert_eq!(detail.occurred_on, "2026-07-13");
        assert_eq!(detail.payee.as_deref(), Some("Split shop"));
        assert_eq!(detail.entries.len(), 3);
        assert_eq!(
            detail
                .entries
                .iter()
                .map(|entry| entry.amount_jpy)
                .sum::<i64>(),
            2_000
        );

        let mut invalid = update;
        invalid.payee = Some("Must not persist".into());
        invalid.entries[2].amount_jpy = 999;
        assert!(matches!(
            update_posted_transaction(&connection, &invalid),
            Err(RepositoryError::InvalidInput(_))
        ));
        let unchanged = get_transaction_detail(&connection, "family", "manual").unwrap();
        assert_eq!(unchanged.payee.as_deref(), Some("Split shop"));
        assert_eq!(unchanged.entries.len(), 3);
    }

    #[test]
    fn imported_transaction_edits_preserve_safe_source_provenance() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        let original = manual_expense("imported", "family", 500);
        create_manual_transaction(&connection, &original).unwrap();
        connection
            .execute_batch(
                "INSERT INTO import_runs (id, household_id, status)
                   VALUES ('run', 'family', 'POSTED');
                 INSERT INTO source_documents
                   (id, household_id, import_run_id, source_type, original_filename,
                    media_type, byte_size, sha256, storage_path)
                   VALUES ('doc', 'family', 'run', 'MANUAL_UPLOAD', 'statement.csv',
                           'text/csv', 123, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                           '/private/vault/secret.bin');
                 INSERT INTO source_records
                   (id, source_document_id, row_number, record_hash, raw_payload_json)
                   VALUES ('record', 'doc', 7,
                           'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                           '{\"secret\":\"must-not-leak\"}');
                 INSERT INTO transaction_candidates (id, household_id, review_status)
                   VALUES ('candidate', 'family', 'POSTED');
                 INSERT INTO candidate_sources (candidate_id, source_record_id, evidence_role)
                   VALUES ('candidate', 'record', 'SUPPORTING');
                 INSERT INTO transaction_sources (transaction_id, source_record_id, candidate_id)
                   VALUES ('imported', 'record', 'candidate');",
            )
            .unwrap();

        let detail = get_transaction_detail(&connection, "family", "imported").unwrap();
        assert!(detail.editable);
        assert_eq!(detail.source_evidence.len(), 1);
        let evidence = &detail.source_evidence[0];
        assert_eq!(evidence.original_filename, "statement.csv");
        assert_eq!(evidence.row_number, 7);
        assert_eq!(evidence.evidence_role, "SUPPORTING");

        let mut update = update_from_manual(&original);
        update.payee = Some("Corrected merchant".into());
        update.entries[0].account_id = "family-housing".into();
        let updated = update_posted_transaction(&connection, &update).unwrap();
        assert_eq!(updated.payee.as_deref(), Some("Corrected merchant"));
        assert_eq!(updated.entries[0].account_id, "family-housing");
        assert_eq!(updated.source_evidence.len(), 1);
        assert_eq!(updated.source_evidence[0].source_record_id, "record");
        let source_links: i64 = connection
            .query_row(
                "SELECT count(*) FROM transaction_sources
                 WHERE transaction_id = 'imported' AND source_record_id = 'record'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(source_links, 1);
    }

    #[test]
    fn posted_transaction_update_is_household_scoped() {
        let connection = database();
        for id in ["one", "two"] {
            create_household(
                &connection,
                &CreateHouseholdInput {
                    id: id.into(),
                    name: id.into(),
                },
            )
            .unwrap();
        }
        let original = manual_expense("manual", "one", 100);
        create_manual_transaction(&connection, &original).unwrap();
        let mut update = update_from_manual(&original);
        update.household_id = "two".into();
        assert!(matches!(
            update_posted_transaction(&connection, &update),
            Err(RepositoryError::NotFound)
        ));
    }

    #[test]
    fn posted_transaction_update_rolls_back_after_entry_identifier_conflict() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        let original = manual_expense("first", "family", 100);
        create_manual_transaction(&connection, &original).unwrap();
        create_manual_transaction(&connection, &manual_expense("second", "family", 200)).unwrap();

        let mut update = update_from_manual(&original);
        update.payee = Some("Must roll back".into());
        update.entries[0].id = "second-debit".into();
        assert!(matches!(
            update_posted_transaction(&connection, &update),
            Err(RepositoryError::Conflict)
        ));

        let unchanged = get_transaction_detail(&connection, "family", "first").unwrap();
        assert_eq!(unchanged.payee.as_deref(), Some("Coffee first"));
        assert_eq!(unchanged.entries[0].id, "first-debit");
        assert_eq!(unchanged.entries.len(), 2);
    }

    #[test]
    fn posted_transaction_update_rejects_card_reconciliation_links() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        let original = manual_expense("linked", "family", 1_000);
        create_manual_transaction(&connection, &original).unwrap();
        connection
            .execute_batch(
                "INSERT INTO card_statements
                   (id, household_id, card_account_id, period_start, period_end,
                    statement_amount_jpy, reconciliation_status)
                 VALUES ('statement', 'family', 'family-card', '2026-07-01',
                         '2026-07-31', 1000, 'UNMATCHED');
                 INSERT INTO card_statement_transactions
                   (statement_id, transaction_id, statement_line_number, billed_amount_jpy)
                 VALUES ('statement', 'linked', 1, 1000);",
            )
            .unwrap();

        let mut update = update_from_manual(&original);
        update.payee = Some("Must remain unchanged".into());
        assert!(matches!(
            update_posted_transaction(&connection, &update),
            Err(RepositoryError::InvalidInput(_))
        ));
        let unchanged = get_transaction_detail(&connection, "family", "linked").unwrap();
        assert_eq!(unchanged.payee.as_deref(), Some("Coffee linked"));

        let mut target_only = update_from_manual(&original);
        target_only.calculation_target = false;
        let toggled = update_posted_transaction(&connection, &target_only).unwrap();
        assert!(!toggled.calculation_target);
        assert_eq!(toggled.entries.len(), 2);
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM card_statement_transactions
                     WHERE statement_id='statement' AND transaction_id='linked'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn dashboard_returns_complete_zero_series_for_empty_household() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "empty".to_owned(),
                name: "Empty".to_owned(),
            },
        )
        .unwrap();

        let totals = dashboard_monthly_totals(
            &connection,
            "empty",
            "2026-02",
            AccountingBasis::Accrual,
            None,
            &AttributionScope::All,
        )
        .unwrap();

        assert_eq!(totals.income_jpy, 0);
        assert_eq!(totals.expense_jpy, 0);
        assert_eq!(totals.savings_jpy, 0);
        assert_eq!(totals.posted_transaction_count, 0);
        assert_eq!(totals.net_worth_as_of, "2026-02-28");
        assert_eq!(totals.assets_jpy, 0);
        assert_eq!(totals.liabilities_jpy, 0);
        assert_eq!(totals.net_worth_jpy, 0);
        assert_eq!(totals.expense_categories.len(), 0);
        let months = totals
            .accrual_trend
            .iter()
            .map(|point| point.month.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            months,
            vec!["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]
        );
        assert!(totals
            .accrual_trend
            .iter()
            .all(|point| point.income_jpy == 0 && point.expense_jpy == 0));
    }

    #[test]
    fn monthly_budgets_upsert_and_derive_actuals_from_posted_ledger_entries() {
        let connection = database();
        for (id, name) in [("family", "Family"), ("other", "Other")] {
            create_household(
                &connection,
                &CreateHouseholdInput {
                    id: id.to_owned(),
                    name: name.to_owned(),
                },
            )
            .unwrap();
        }
        connection
            .execute_batch(
                "INSERT INTO transactions (id, household_id, occurred_on, transaction_type, status)
                   VALUES ('july-expense', 'family', '2026-07-03', 'EXPENSE', 'POSTED'),
                          ('july-refund', 'family', '2026-07-04', 'REFUND', 'POSTED'),
                          ('june-expense', 'family', '2026-06-30', 'EXPENSE', 'POSTED'),
                          ('void-expense', 'family', '2026-07-05', 'EXPENSE', 'VOID'),
                          ('card-payment', 'family', '2026-07-06', 'CARD_PAYMENT', 'POSTED'),
                          ('other-expense', 'other', '2026-07-03', 'EXPENSE', 'POSTED');
                 INSERT INTO journal_entries
                   (id, transaction_id, account_id, entry_side, amount_jpy, line_number)
                   VALUES ('j1', 'july-expense', 'family-groceries', 'DEBIT', 1200, 1),
                          ('j2', 'july-expense', 'family-bank', 'CREDIT', 1200, 2),
                          ('j3', 'july-refund', 'family-groceries', 'CREDIT', 200, 1),
                          ('j4', 'july-refund', 'family-bank', 'DEBIT', 200, 2),
                          ('j5', 'june-expense', 'family-groceries', 'DEBIT', 900, 1),
                          ('j6', 'june-expense', 'family-bank', 'CREDIT', 900, 2),
                          ('j7', 'void-expense', 'family-groceries', 'DEBIT', 500, 1),
                          ('j8', 'void-expense', 'family-bank', 'CREDIT', 500, 2),
                          ('j9', 'card-payment', 'family-groceries', 'DEBIT', 700, 1),
                          ('j10', 'card-payment', 'family-bank', 'CREDIT', 700, 2),
                          ('j11', 'other-expense', 'other-groceries', 'DEBIT', 8000, 1),
                          ('j12', 'other-expense', 'other-bank', 'CREDIT', 8000, 2);",
            )
            .unwrap();

        let created = upsert_monthly_category_budget(
            &connection,
            &UpsertMonthlyCategoryBudgetInput {
                household_id: "family".into(),
                month: "2026-07".into(),
                category_account_id: "family-groceries".into(),
                budget_jpy: 3_000,
            },
        )
        .unwrap();
        assert_eq!(created.actual_jpy, 1_000);
        assert_eq!(created.remaining_jpy, 2_000);

        let updated = upsert_monthly_category_budget(
            &connection,
            &UpsertMonthlyCategoryBudgetInput {
                budget_jpy: 750,
                ..UpsertMonthlyCategoryBudgetInput {
                    household_id: "family".into(),
                    month: "2026-07".into(),
                    category_account_id: "family-groceries".into(),
                    budget_jpy: 0,
                }
            },
        )
        .unwrap();
        assert_eq!(updated.actual_jpy, 1_000);
        assert_eq!(updated.remaining_jpy, -250);
        assert_eq!(
            list_monthly_category_budgets(&connection, "family", "2026-07").unwrap(),
            vec![updated]
        );
        assert!(
            list_monthly_category_budgets(&connection, "family", "2026-06")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn planning_repository_enforces_household_and_expense_account_isolation() {
        let connection = database();
        for id in ["one", "two"] {
            create_household(
                &connection,
                &CreateHouseholdInput {
                    id: id.into(),
                    name: id.into(),
                },
            )
            .unwrap();
        }

        let cross_household = upsert_monthly_category_budget(
            &connection,
            &UpsertMonthlyCategoryBudgetInput {
                household_id: "one".into(),
                month: "2026-07".into(),
                category_account_id: "two-groceries".into(),
                budget_jpy: 1_000,
            },
        );
        assert!(matches!(cross_household, Err(RepositoryError::NotFound)));
        let asset_account = upsert_monthly_category_budget(
            &connection,
            &UpsertMonthlyCategoryBudgetInput {
                household_id: "one".into(),
                month: "2026-07".into(),
                category_account_id: "one-bank".into(),
                budget_jpy: 1_000,
            },
        );
        assert!(matches!(asset_account, Err(RepositoryError::NotFound)));

        create_savings_goal(
            &connection,
            &CreateSavingsGoalInput {
                id: "goal-one".into(),
                household_id: "one".into(),
                name: "Emergency fund".into(),
                target_jpy: 100_000,
                saved_jpy: 10_000,
                target_date: "2027-01-31".into(),
                status: SavingsGoalStatus::Active,
            },
        )
        .unwrap();
        assert!(list_savings_goals(&connection, "two").unwrap().is_empty());
        assert!(matches!(
            delete_savings_goal(&connection, "two", "goal-one"),
            Err(RepositoryError::NotFound)
        ));
        assert_eq!(list_savings_goals(&connection, "one").unwrap().len(), 1);
    }

    #[test]
    fn savings_goal_create_update_delete_lifecycle_is_validated() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();

        let created = create_savings_goal(
            &connection,
            &CreateSavingsGoalInput {
                id: "trip-2027".into(),
                household_id: "family".into(),
                name: "  Family trip  ".into(),
                target_jpy: 1_000_000,
                saved_jpy: 680_000,
                target_date: "2027-07-01".into(),
                status: SavingsGoalStatus::Active,
            },
        )
        .unwrap();
        assert_eq!(created.name, "Family trip");
        assert_eq!(created.status, SavingsGoalStatus::Active);

        let updated = update_savings_goal(
            &connection,
            &UpdateSavingsGoalInput {
                id: "trip-2027".into(),
                household_id: "family".into(),
                name: "Family trip 2027".into(),
                target_jpy: 1_200_000,
                saved_jpy: 1_250_000,
                target_date: "2027-08-01".into(),
                status: SavingsGoalStatus::Completed,
            },
        )
        .unwrap();
        assert_eq!(updated.target_jpy, 1_200_000);
        assert_eq!(updated.saved_jpy, 1_250_000);
        assert_eq!(updated.status, SavingsGoalStatus::Completed);
        assert_eq!(
            list_savings_goals(&connection, "family").unwrap(),
            vec![updated]
        );

        delete_savings_goal(&connection, "family", "trip-2027").unwrap();
        assert!(list_savings_goals(&connection, "family")
            .unwrap()
            .is_empty());
        assert!(matches!(
            delete_savings_goal(&connection, "family", "trip-2027"),
            Err(RepositoryError::NotFound)
        ));
    }

    #[test]
    fn planning_inputs_reject_invalid_names_dates_identifiers_and_jpy() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();

        for budget_jpy in [-1, MAX_PLANNING_JPY + 1] {
            assert!(matches!(
                upsert_monthly_category_budget(
                    &connection,
                    &UpsertMonthlyCategoryBudgetInput {
                        household_id: "family".into(),
                        month: "2026-07".into(),
                        category_account_id: "family-groceries".into(),
                        budget_jpy,
                    }
                ),
                Err(RepositoryError::InvalidInput(_))
            ));
        }
        assert!(matches!(
            list_monthly_category_budgets(&connection, "family", "2026-13"),
            Err(RepositoryError::InvalidInput(_))
        ));

        let valid = CreateSavingsGoalInput {
            id: "goal".into(),
            household_id: "family".into(),
            name: "Goal".into(),
            target_jpy: 1_000,
            saved_jpy: 0,
            target_date: "2027-01-01".into(),
            status: SavingsGoalStatus::Active,
        };
        for invalid in [
            CreateSavingsGoalInput {
                name: " \n ".into(),
                ..valid.clone()
            },
            CreateSavingsGoalInput {
                target_jpy: 0,
                ..valid.clone()
            },
            CreateSavingsGoalInput {
                saved_jpy: -1,
                ..valid.clone()
            },
            CreateSavingsGoalInput {
                target_date: "2027-02-30".into(),
                ..valid.clone()
            },
            CreateSavingsGoalInput {
                id: "bad id".into(),
                ..valid.clone()
            },
        ] {
            assert!(matches!(
                create_savings_goal(&connection, &invalid),
                Err(RepositoryError::InvalidInput(_))
            ));
        }
    }

    #[test]
    fn card_settlement_read_model_keeps_line_totals_separate_from_payment() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        connection.execute_batch(
            "INSERT INTO transactions (id, household_id, occurred_on, transaction_type, status)
               VALUES ('purchase-1','family','2026-06-01','CARD_PURCHASE','POSTED'),
                      ('purchase-2','family','2026-06-02','CARD_PURCHASE','POSTED'),
                      ('bank-payment','family','2026-07-27','CARD_PAYMENT','POSTED');
             INSERT INTO card_statements
               (id, household_id, card_account_id, period_start, period_end, statement_amount_jpy, reconciliation_status)
               VALUES ('statement','family','family-rakuten-card','2026-06-01','2026-06-30',3000,'POSSIBLE_MATCH');
             INSERT INTO card_statement_transactions
               (statement_id,transaction_id,statement_line_number,billed_amount_jpy)
               VALUES ('statement','purchase-1',1,1000),('statement','purchase-2',2,2000);
             INSERT INTO card_payments
               (id,household_id,statement_id,bank_transaction_id,card_account_id,payment_amount_jpy,payment_on,match_score_bps,reconciliation_status)
               VALUES ('payment','family','statement','bank-payment','family-rakuten-card',3000,'2026-07-27',8000,'POSSIBLE_MATCH');",
        ).unwrap();

        let rows = list_card_settlements(&connection, "family").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].line_count, 2);
        assert_eq!(rows[0].detail_amount_jpy, 3000);
        assert_eq!(rows[0].payment_amount_jpy, Some(3000));
        assert_eq!(rows[0].reconciliation_status, "POSSIBLE_MATCH");
    }

    #[test]
    fn rejects_invalid_dates_and_oversized_pages() {
        let connection = database();
        assert!(matches!(
            validate_optional_date(&connection, Some("2026-02-31")),
            Err(RepositoryError::InvalidInput(_))
        ));
        let result = list_transactions(
            &connection,
            &TransactionPageRequest {
                household_id: "family".to_owned(),
                account_group_id: None,
                attribution_scope: AttributionScope::All,
                accounting_basis: AccountingBasis::Accrual,
                from_date: None,
                to_date: None,
                search: None,
                calculation_target_filter: None,
                page: 1,
                page_size: 101,
            },
        );
        assert!(matches!(result, Err(RepositoryError::InvalidInput(_))));
    }

    fn grocery_rule(household_id: &str) -> CreateClassificationRuleInput {
        CreateClassificationRuleInput {
            id: format!("{household_id}-coffee-rule"),
            household_id: household_id.into(),
            name: "Coffee shops".into(),
            priority: 10,
            is_enabled: true,
            merchant_contains: Some("coffee".into()),
            description_contains: None,
            category_account_id: format!("{household_id}-entertainment"),
            labels: vec!["Recurring".into()],
            tags: vec!["#work".into(), "#work".into()],
        }
    }

    #[test]
    fn classification_rule_lifecycle_and_preview_are_ordered_and_scoped() {
        let connection = database();
        for id in ["family", "other"] {
            create_household(
                &connection,
                &CreateHouseholdInput {
                    id: id.into(),
                    name: id.into(),
                },
            )
            .unwrap();
        }
        let created = create_classification_rule(&connection, &grocery_rule("family")).unwrap();
        assert_eq!(created.labels, vec!["Recurring"]);
        assert_eq!(created.tags, vec!["#work"]);
        assert!(list_classification_rules(&connection, "other")
            .unwrap()
            .is_empty());

        let preview = preview_classification_rules(
            &connection,
            &ClassificationPreviewInput {
                household_id: "family".into(),
                merchant: Some("TOKYO COFFEE BAR".into()),
                description: None,
            },
        )
        .unwrap();
        assert_eq!(
            preview.winning_rule_id.as_deref(),
            Some("family-coffee-rule")
        );

        let mut updated = grocery_rule("family");
        updated.name = "Cafe".into();
        updated.is_enabled = false;
        let updated = update_classification_rule(&connection, &updated).unwrap();
        assert_eq!(updated.name, "Cafe");
        assert!(preview_classification_rules(
            &connection,
            &ClassificationPreviewInput {
                household_id: "family".into(),
                merchant: Some("Coffee".into()),
                description: None,
            }
        )
        .unwrap()
        .matches
        .is_empty());
        assert!(matches!(
            delete_classification_rule(&connection, "other", &updated.id),
            Err(RepositoryError::NotFound)
        ));
        delete_classification_rule(&connection, "family", &updated.id).unwrap();
    }

    #[test]
    fn classification_apply_requires_match_fresh_version_and_single_expense_entry() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        create_manual_transaction(&connection, &manual_expense("coffee-tx", "family", 800))
            .unwrap();
        create_classification_rule(&connection, &grocery_rule("family")).unwrap();
        let detail = get_transaction_detail(&connection, "family", "coffee-tx").unwrap();
        let applied = apply_classification_rule(
            &connection,
            &ApplyClassificationRuleInput {
                household_id: "family".into(),
                transaction_id: "coffee-tx".into(),
                rule_id: "family-coffee-rule".into(),
                expected_transaction_updated_at: detail.updated_at.clone(),
            },
        )
        .unwrap();
        assert_eq!(applied.category_account_id, "family-entertainment");
        assert_eq!(applied.labels, vec!["Recurring"]);
        let category: String = connection
            .query_row(
                "SELECT e.account_id FROM journal_entries e JOIN accounts a ON a.id=e.account_id
             WHERE e.transaction_id='coffee-tx' AND a.account_kind='EXPENSE'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(category, "family-entertainment");
        assert!(matches!(
            apply_classification_rule(
                &connection,
                &ApplyClassificationRuleInput {
                    household_id: "family".into(),
                    transaction_id: "coffee-tx".into(),
                    rule_id: "family-coffee-rule".into(),
                    expected_transaction_updated_at: detail.updated_at,
                }
            ),
            Err(RepositoryError::Conflict)
        ));
    }

    #[test]
    fn calculation_target_filters_household_analytics_but_preserves_ledger_and_balances() {
        let connection = database();
        create_household(
            &connection,
            &CreateHouseholdInput {
                id: "family".into(),
                name: "Family".into(),
            },
        )
        .unwrap();
        let included = manual_expense("included", "family", 1_000);
        let excluded = manual_expense("excluded", "family", 2_000);
        assert!(
            create_manual_transaction(&connection, &included)
                .unwrap()
                .calculation_target
        );
        create_manual_transaction(&connection, &excluded).unwrap();
        let mut update = update_from_manual(&excluded);
        update.calculation_target = false;
        let detail = update_posted_transaction(&connection, &update).unwrap();
        assert!(!detail.calculation_target);
        assert_eq!(detail.entries.len(), 2);

        connection
            .execute(
                "INSERT INTO monthly_category_budgets
                   (household_id,month,category_account_id,budget_jpy)
                 VALUES ('family','2026-07','family-groceries',5000)",
                [],
            )
            .unwrap();
        let dashboard = dashboard_monthly_totals(
            &connection,
            "family",
            "2026-07",
            AccountingBasis::Accrual,
            None,
            &AttributionScope::All,
        )
        .unwrap();
        assert_eq!(dashboard.expense_jpy, 1_000);
        assert_eq!(dashboard.posted_transaction_count, 1);
        assert_eq!(dashboard.assets_jpy, -3_000);
        assert_eq!(dashboard.net_worth_jpy, -3_000);
        assert_eq!(
            list_monthly_category_budgets(&connection, "family", "2026-07").unwrap()[0].actual_jpy,
            1_000
        );

        let request = |filter| TransactionPageRequest {
            household_id: "family".into(),
            account_group_id: None,
            attribution_scope: AttributionScope::All,
            accounting_basis: AccountingBasis::Accrual,
            from_date: None,
            to_date: None,
            search: None,
            calculation_target_filter: Some(filter),
            page: 1,
            page_size: 20,
        };
        assert_eq!(
            list_transactions(&connection, &request(CalculationTargetFilter::All))
                .unwrap()
                .total_items,
            2
        );
        assert_eq!(
            list_transactions(&connection, &request(CalculationTargetFilter::Included))
                .unwrap()
                .items[0]
                .id,
            "included"
        );
        assert_eq!(
            list_transactions(&connection, &request(CalculationTargetFilter::Excluded))
                .unwrap()
                .items[0]
                .id,
            "excluded"
        );
    }
}
