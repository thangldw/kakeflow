use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fmt};

const MAX_PAGE_SIZE: u32 = 100;
const MAX_HOUSEHOLD_ID_LEN: usize = 48;
const MAX_LOOKUP_ID_LEN: usize = 64;
const MAX_NAME_LEN: usize = 80;
const MAX_SEARCH_LEN: usize = 200;
const MAX_TRANSACTION_TEXT_LEN: usize = 16_384;
const MAX_MANUAL_ENTRIES: usize = 128;
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
            "SELECT id, name, account_kind, account_subtype, currency
             FROM accounts WHERE household_id = ?1 AND is_archived = 0
             ORDER BY account_kind, account_subtype, name, id",
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
    connection
        .execute(
            "INSERT INTO accounts
               (id, household_id, name, account_kind, account_subtype, currency)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                input.id,
                input.household_id,
                name,
                input.account_kind.as_sql_value(),
                input.account_subtype.as_sql_value(),
                input.currency.as_sql_value()
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
            "SELECT id, name, account_kind, account_subtype, currency
             FROM accounts
             WHERE id = ?1 AND household_id = ?2 AND is_archived = 0",
            params![account_id, household_id],
            |row| {
                Ok(AccountDto {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    account_kind: row.get(2)?,
                    account_subtype: row.get(3)?,
                    currency: row.get(4)?,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionPageRequest {
    pub household_id: String,
    pub accounting_basis: AccountingBasis,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub search: Option<String>,
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
    pub debit_account_id: Option<String>,
    pub debit_account_name: Option<String>,
    pub credit_account_id: Option<String>,
    pub credit_account_name: Option<String>,
    pub category_account_id: Option<String>,
    pub category_name: Option<String>,
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

    let basis = request.accounting_basis.as_sql_value();
    let search = search_pattern(request.search.as_deref())?;
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
                    ))",
            params![
                request.household_id,
                request.from_date,
                request.to_date,
                basis,
                search
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
                     ORDER BY je.line_number LIMIT 1)
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
             ORDER BY t.occurred_on DESC, t.created_at DESC, t.id DESC
             LIMIT ?6 OFFSET ?7",
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
    pub entries: Vec<ManualJournalEntryInput>,
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
    let transaction = connection
        .unchecked_transaction()
        .map_err(map_database_error)?;
    for entry in &input.entries {
        let account_exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts
                 WHERE id = ?1 AND household_id = ?2 AND is_archived = 0 AND currency = 'JPY')",
                params![entry.account_id, input.household_id],
                |row| row.get(0),
            )
            .map_err(map_database_error)?;
        if !account_exists {
            return Err(RepositoryError::NotFound);
        }
    }

    transaction
        .execute(
            "INSERT INTO transactions
               (id, household_id, occurred_on, posted_on, transaction_type, payee, description, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'POSTED')",
            params![
                input.id,
                input.household_id,
                input.occurred_on,
                input.posted_on,
                input.transaction_type.as_sql_value(),
                input.payee,
                input.description
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
            accounting_basis: AccountingBasis::Accrual,
            from_date: Some(input.occurred_on.clone()),
            to_date: Some(input.occurred_on.clone()),
            search: Some(input.id.clone()),
            page: 1,
            page_size: 1,
        },
    )?;
    page.items
        .into_iter()
        .next()
        .ok_or(RepositoryError::NotFound)
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
) -> Result<DashboardMonthlyTotalsDto, RepositoryError> {
    validate_id(household_id, MAX_LOOKUP_ID_LEN)?;
    validate_month(connection, month)?;
    ensure_household_exists(connection, household_id)?;
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
                   AND t.occurred_on >= ?2 AND t.occurred_on < date(?2, '+1 month')
                   AND t.transaction_type != 'CARD_PAYMENT'",
                params![household_id, start],
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
                     AND t.occurred_on >= ?2 AND t.occurred_on < date(?2, '+1 month')
                     AND t.transaction_type NOT IN ('CARD_PURCHASE', 'TRANSFER')
                   GROUP BY t.id
                 )
                 SELECT
                   COALESCE(SUM(CASE WHEN asset_delta > 0 THEN asset_delta ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN asset_delta < 0 THEN -asset_delta ELSE 0 END), 0),
                   count(*)
                 FROM cash_by_transaction",
                params![household_id, start],
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
               AND t.occurred_on < date(?2, '+1 month')",
            params![household_id, start],
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
              AND t.occurred_on >= months.month_start
              AND t.occurred_on < date(months.month_start, '+1 month')
              AND t.transaction_type != 'CARD_PAYMENT'
             LEFT JOIN journal_entries je ON je.transaction_id = t.id
             LEFT JOIN accounts a ON a.id = je.account_id
             GROUP BY months.month_start
             ORDER BY months.month_start",
        )
        .map_err(map_database_error)?;
    let accrual_trend = trend_statement
        .query_map(params![household_id, start], |row| {
            Ok(DashboardAccrualTrendPointDto {
                month: row.get(0)?,
                income_jpy: row.get(1)?,
                expense_jpy: row.get(2)?,
            })
        })
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
               AND t.occurred_on >= ?2 AND t.occurred_on < date(?2, '+1 month')
               AND t.transaction_type != 'CARD_PAYMENT'
             GROUP BY a.id, a.name
             HAVING SUM(CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END) != 0
             ORDER BY 3 DESC, a.name ASC, a.id ASC",
        )
        .map_err(map_database_error)?;
    let expense_categories = categories_statement
        .query_map(params![household_id, start], |row| {
            Ok(DashboardExpenseCategoryDto {
                account_id: row.get(0)?,
                name: row.get(1)?,
                amount_jpy: row.get(2)?,
            })
        })
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
                 CREATE TABLE accounts (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   name TEXT NOT NULL, account_kind TEXT NOT NULL, account_subtype TEXT NOT NULL,
                   currency TEXT NOT NULL, masked_identifier TEXT,
                   is_archived INTEGER NOT NULL DEFAULT 0,
                   updated_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z',
                   UNIQUE(household_id, name)
                 );
                 CREATE TABLE transactions (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   occurred_on TEXT NOT NULL, posted_on TEXT, transaction_type TEXT NOT NULL,
                   payee TEXT, description TEXT, status TEXT NOT NULL,
                   created_at TEXT NOT NULL DEFAULT '2026-07-12T00:00:00Z'
                 );
                 CREATE TABLE journal_entries (
                   id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id),
                   account_id TEXT NOT NULL REFERENCES accounts(id), entry_side TEXT NOT NULL,
                   amount_jpy INTEGER NOT NULL, line_number INTEGER NOT NULL
                 );
                 CREATE TABLE import_runs (id TEXT PRIMARY KEY, household_id TEXT, status TEXT);
                 CREATE TABLE source_documents (id TEXT PRIMARY KEY, household_id TEXT, import_run_id TEXT);
                 CREATE TABLE source_records (id TEXT PRIMARY KEY, source_document_id TEXT);
                 CREATE TABLE transaction_candidates (
                   id TEXT PRIMARY KEY, household_id TEXT, account_id TEXT REFERENCES accounts(id),
                   review_status TEXT);
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
                 VALUES ('family', '2026-07', 'budget-account', 1);",
            )
            .unwrap();

        for id in [
            "posted-account",
            "candidate-account",
            "statement-account",
            "payment-account",
            "staged-account",
            "budget-account",
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
                accounting_basis: AccountingBasis::Accrual,
                from_date: None,
                to_date: None,
                search: None,
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
                    accounting_basis: AccountingBasis::Accrual,
                    from_date: None,
                    to_date: None,
                    search: None,
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

        let accrual_totals =
            dashboard_monthly_totals(&connection, "family", "2026-07", AccountingBasis::Accrual)
                .unwrap();
        let cash_totals =
            dashboard_monthly_totals(&connection, "family", "2026-07", AccountingBasis::Cash)
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
                accounting_basis: AccountingBasis::Accrual,
                from_date: None,
                to_date: None,
                search: None,
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
                    accounting_basis: AccountingBasis::Accrual,
                    from_date: None,
                    to_date: None,
                    search: None,
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
                accounting_basis: AccountingBasis::Accrual,
                from_date: None,
                to_date: None,
                search: Some("Groceries".into()),
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
                ..TransactionPageRequest {
                    household_id: "family".into(),
                    accounting_basis: AccountingBasis::Accrual,
                    from_date: None,
                    to_date: None,
                    search: None,
                    page: 1,
                    page_size: 20,
                }
            },
        )
        .unwrap();
        assert_eq!(literal_wildcard.total_items, 0);
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

        let totals =
            dashboard_monthly_totals(&connection, "empty", "2026-02", AccountingBasis::Accrual)
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
                accounting_basis: AccountingBasis::Accrual,
                from_date: None,
                to_date: None,
                search: None,
                page: 1,
                page_size: 101,
            },
        );
        assert!(matches!(result, Err(RepositoryError::InvalidInput(_))));
    }
}
