use crate::persistence::AppState;
use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

const MAX_ID_LEN: usize = 64;
const DEFAULT_HORIZON_DAYS: u16 = 45;
const MAX_HORIZON_DAYS: u16 = 365;
const MAX_COVERAGE_STATEMENTS: usize = 10_000;

#[derive(Debug)]
pub enum CardSettlementMappingError {
    InvalidInput(&'static str),
    NotFound,
    Conflict,
    Unavailable,
}

impl CardSettlementMappingError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput(message) => message,
            Self::NotFound => "The requested card settlement mapping was not found",
            Self::Conflict => "The card settlement mapping conflicts with existing data",
            Self::Unavailable => "Card settlement coverage is temporarily unavailable",
        }
    }
}

impl fmt::Display for CardSettlementMappingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.public_message())
    }
}

fn db_error(error: rusqlite::Error) -> CardSettlementMappingError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == ErrorCode::ConstraintViolation =>
        {
            CardSettlementMappingError::Conflict
        }
        _ => CardSettlementMappingError::Unavailable,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCardSettlementBankMappingInput {
    pub household_id: String,
    pub card_account_id: String,
    pub bank_account_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCardSettlementBankMappingInput {
    pub household_id: String,
    pub card_account_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CardSettlementBankMappingDto {
    pub household_id: String,
    pub card_account_id: String,
    pub card_account_name: String,
    pub bank_account_id: String,
    pub bank_account_name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSettlementBalanceCoverageRequest {
    pub household_id: String,
    pub as_of: String,
    pub horizon_days: Option<u16>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CardSettlementCoverageStatus {
    Covered,
    Shortfall,
    Overdue,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CardSettlementCoverageStatementDto {
    pub statement_id: String,
    pub card_account_id: String,
    pub card_account_name: String,
    pub payment_due_on: String,
    pub statement_amount_jpy: i64,
    pub paid_amount_jpy: i64,
    pub outstanding_amount_jpy: i64,
    pub projected_bank_balance_jpy: i64,
    pub shortfall_jpy: i64,
    pub status: CardSettlementCoverageStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CardSettlementBankCoverageDto {
    pub bank_account_id: String,
    pub bank_account_name: String,
    pub balance_as_of_jpy: i64,
    pub projected_ending_balance_jpy: i64,
    pub max_shortfall_jpy: i64,
    pub statements: Vec<CardSettlementCoverageStatementDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UnmappedCardSettlementStatus {
    Unmapped,
    Overdue,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnmappedCardSettlementDto {
    pub statement_id: String,
    pub card_account_id: String,
    pub card_account_name: String,
    pub payment_due_on: String,
    pub statement_amount_jpy: i64,
    pub paid_amount_jpy: i64,
    pub outstanding_amount_jpy: i64,
    pub status: UnmappedCardSettlementStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissingDueCardSettlementDto {
    pub statement_id: String,
    pub card_account_id: String,
    pub card_account_name: String,
    pub statement_amount_jpy: i64,
    pub paid_amount_jpy: i64,
    pub outstanding_amount_jpy: i64,
    pub mapping_configured: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CardSettlementBalanceCoverageDto {
    pub as_of: String,
    pub history_from: String,
    pub horizon_through: String,
    pub horizon_days: u16,
    pub banks: Vec<CardSettlementBankCoverageDto>,
    pub unmapped_statements: Vec<UnmappedCardSettlementDto>,
    pub missing_due_statements: Vec<MissingDueCardSettlementDto>,
}

#[derive(Debug)]
struct StatementRow {
    statement_id: String,
    card_account_id: String,
    card_account_name: String,
    payment_due_on: String,
    statement_amount_jpy: i64,
    paid_amount_jpy: i64,
    outstanding_amount_jpy: i64,
    bank_account_id: Option<String>,
    bank_account_name: Option<String>,
}

pub fn list_mappings(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<CardSettlementBankMappingDto>, CardSettlementMappingError> {
    validate_id(household_id)?;
    ensure_household(connection, household_id)?;
    let mut statement = connection
        .prepare(
            "SELECT m.household_id,m.card_account_id,card.name,m.bank_account_id,bank.name,
                    m.created_at,m.updated_at
             FROM card_settlement_bank_mappings m
             JOIN accounts card ON card.id=m.card_account_id
             JOIN accounts bank ON bank.id=m.bank_account_id
             WHERE m.household_id=?1 ORDER BY card.name,card.id",
        )
        .map_err(db_error)?;
    let result = statement
        .query_map([household_id], |row| {
            Ok(CardSettlementBankMappingDto {
                household_id: row.get(0)?,
                card_account_id: row.get(1)?,
                card_account_name: row.get(2)?,
                bank_account_id: row.get(3)?,
                bank_account_name: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error);
    result
}

pub fn upsert_mapping(
    connection: &Connection,
    input: &UpsertCardSettlementBankMappingInput,
) -> Result<CardSettlementBankMappingDto, CardSettlementMappingError> {
    validate_id(&input.household_id)?;
    validate_id(&input.card_account_id)?;
    validate_id(&input.bank_account_id)?;
    ensure_household(connection, &input.household_id)?;
    validate_account(
        connection,
        &input.household_id,
        &input.card_account_id,
        "LIABILITY",
        "CREDIT_CARD",
    )?;
    validate_account(
        connection,
        &input.household_id,
        &input.bank_account_id,
        "ASSET",
        "BANK",
    )?;
    connection
        .execute(
            "INSERT INTO card_settlement_bank_mappings
               (household_id,card_account_id,bank_account_id)
             VALUES (?1,?2,?3)
             ON CONFLICT(household_id,card_account_id) DO UPDATE SET
               bank_account_id=excluded.bank_account_id,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![
                input.household_id,
                input.card_account_id,
                input.bank_account_id
            ],
        )
        .map_err(db_error)?;
    list_mappings(connection, &input.household_id)?
        .into_iter()
        .find(|mapping| mapping.card_account_id == input.card_account_id)
        .ok_or(CardSettlementMappingError::Unavailable)
}

pub fn delete_mapping(
    connection: &Connection,
    input: &DeleteCardSettlementBankMappingInput,
) -> Result<(), CardSettlementMappingError> {
    validate_id(&input.household_id)?;
    validate_id(&input.card_account_id)?;
    ensure_household(connection, &input.household_id)?;
    let affected = connection
        .execute(
            "DELETE FROM card_settlement_bank_mappings
             WHERE household_id=?1 AND card_account_id=?2",
            params![input.household_id, input.card_account_id],
        )
        .map_err(db_error)?;
    if affected == 0 {
        Err(CardSettlementMappingError::NotFound)
    } else {
        Ok(())
    }
}

pub fn balance_coverage(
    connection: &Connection,
    request: &CardSettlementBalanceCoverageRequest,
) -> Result<CardSettlementBalanceCoverageDto, CardSettlementMappingError> {
    validate_id(&request.household_id)?;
    ensure_household(connection, &request.household_id)?;
    let as_of = validate_date(connection, &request.as_of)?;
    let horizon_days = request.horizon_days.unwrap_or(DEFAULT_HORIZON_DAYS);
    if horizon_days > MAX_HORIZON_DAYS {
        return Err(CardSettlementMappingError::InvalidInput(
            "Coverage horizon must not exceed 365 days",
        ));
    }
    let horizon_through = shift_date(connection, &as_of, &format!("+{horizon_days} days"))?;
    let statements = read_statements(connection, &request.household_id, &as_of, &horizon_through)?;
    if statements.len() > MAX_COVERAGE_STATEMENTS {
        return Err(CardSettlementMappingError::InvalidInput(
            "Card settlement coverage has too many statements",
        ));
    }
    let history_from = statements
        .first()
        .map(|statement| statement.payment_due_on.clone())
        .unwrap_or_else(|| as_of.clone());
    let missing_due_statements =
        read_missing_due_statements(connection, &request.household_id, &as_of)?;
    let mut banks: BTreeMap<String, CardSettlementBankCoverageDto> = BTreeMap::new();
    let mut unmapped = Vec::new();
    for row in statements {
        let Some(bank_account_id) = row.bank_account_id.clone() else {
            unmapped.push(UnmappedCardSettlementDto {
                statement_id: row.statement_id,
                card_account_id: row.card_account_id,
                card_account_name: row.card_account_name,
                status: if row.payment_due_on < as_of {
                    UnmappedCardSettlementStatus::Overdue
                } else {
                    UnmappedCardSettlementStatus::Unmapped
                },
                payment_due_on: row.payment_due_on,
                statement_amount_jpy: row.statement_amount_jpy,
                paid_amount_jpy: row.paid_amount_jpy,
                outstanding_amount_jpy: row.outstanding_amount_jpy,
            });
            continue;
        };
        let bank_name = row
            .bank_account_name
            .clone()
            .ok_or(CardSettlementMappingError::Unavailable)?;
        if !banks.contains_key(&bank_account_id) {
            let balance =
                bank_balance(connection, &request.household_id, &bank_account_id, &as_of)?;
            banks.insert(
                bank_account_id.clone(),
                CardSettlementBankCoverageDto {
                    bank_account_id: bank_account_id.clone(),
                    bank_account_name: bank_name,
                    balance_as_of_jpy: balance,
                    projected_ending_balance_jpy: balance,
                    max_shortfall_jpy: 0,
                    statements: Vec::new(),
                },
            );
        }
        let bank = banks
            .get_mut(&bank_account_id)
            .ok_or(CardSettlementMappingError::Unavailable)?;
        bank.projected_ending_balance_jpy = bank
            .projected_ending_balance_jpy
            .saturating_sub(row.outstanding_amount_jpy);
        let shortfall = bank.projected_ending_balance_jpy.saturating_neg().max(0);
        bank.max_shortfall_jpy = bank.max_shortfall_jpy.max(shortfall);
        let status = if row.payment_due_on < as_of {
            CardSettlementCoverageStatus::Overdue
        } else if shortfall > 0 {
            CardSettlementCoverageStatus::Shortfall
        } else {
            CardSettlementCoverageStatus::Covered
        };
        bank.statements.push(CardSettlementCoverageStatementDto {
            statement_id: row.statement_id,
            card_account_id: row.card_account_id,
            card_account_name: row.card_account_name,
            payment_due_on: row.payment_due_on,
            statement_amount_jpy: row.statement_amount_jpy,
            paid_amount_jpy: row.paid_amount_jpy,
            outstanding_amount_jpy: row.outstanding_amount_jpy,
            projected_bank_balance_jpy: bank.projected_ending_balance_jpy,
            shortfall_jpy: shortfall,
            status,
        });
    }
    Ok(CardSettlementBalanceCoverageDto {
        as_of,
        history_from,
        horizon_through,
        horizon_days,
        banks: banks.into_values().collect(),
        unmapped_statements: unmapped,
        missing_due_statements,
    })
}

fn read_statements(
    connection: &Connection,
    household_id: &str,
    as_of: &str,
    horizon_through: &str,
) -> Result<Vec<StatementRow>, CardSettlementMappingError> {
    let mut statement = connection
        .prepare(
            "SELECT cs.id,cs.card_account_id,card.name,cs.payment_due_on,
                    cs.statement_amount_jpy,
                    COALESCE(SUM(cp.payment_amount_jpy),0),
                    MAX(cs.statement_amount_jpy-COALESCE(SUM(cp.payment_amount_jpy),0),0),
                    mapping.bank_account_id,bank.name
             FROM card_statements cs
             JOIN accounts card ON card.id=cs.card_account_id
             LEFT JOIN card_payments cp ON cp.statement_id=cs.id
               AND cp.payment_on<=?2
               AND cp.reconciliation_status IN
                 ('FULLY_RECONCILED','PARTIALLY_RECONCILED','MANUAL_OVERRIDE','OVERPAID','UNDERPAID')
             LEFT JOIN card_settlement_bank_mappings mapping
               ON mapping.household_id=cs.household_id AND mapping.card_account_id=cs.card_account_id
             LEFT JOIN accounts bank ON bank.id=mapping.bank_account_id
             WHERE cs.household_id=?1 AND cs.payment_due_on IS NOT NULL
               AND cs.payment_due_on<=?3
             GROUP BY cs.id,cs.card_account_id,card.name,cs.payment_due_on,
                      cs.statement_amount_jpy,mapping.bank_account_id,bank.name
             HAVING MAX(cs.statement_amount_jpy-COALESCE(SUM(cp.payment_amount_jpy),0),0)>0
             ORDER BY cs.payment_due_on,cs.id LIMIT 10001",
        )
        .map_err(db_error)?;
    let result = statement
        .query_map(params![household_id, as_of, horizon_through], |row| {
            Ok(StatementRow {
                statement_id: row.get(0)?,
                card_account_id: row.get(1)?,
                card_account_name: row.get(2)?,
                payment_due_on: row.get(3)?,
                statement_amount_jpy: row.get(4)?,
                paid_amount_jpy: row.get(5)?,
                outstanding_amount_jpy: row.get(6)?,
                bank_account_id: row.get(7)?,
                bank_account_name: row.get(8)?,
            })
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error);
    result
}

fn read_missing_due_statements(
    connection: &Connection,
    household_id: &str,
    as_of: &str,
) -> Result<Vec<MissingDueCardSettlementDto>, CardSettlementMappingError> {
    let mut statement = connection
        .prepare(
            "SELECT cs.id,cs.card_account_id,card.name,cs.statement_amount_jpy,
                    COALESCE(SUM(cp.payment_amount_jpy),0),
                    MAX(cs.statement_amount_jpy-COALESCE(SUM(cp.payment_amount_jpy),0),0),
                    CASE WHEN mapping.card_account_id IS NULL THEN 0 ELSE 1 END
             FROM card_statements cs JOIN accounts card ON card.id=cs.card_account_id
             LEFT JOIN card_payments cp ON cp.statement_id=cs.id
               AND cp.payment_on<=?2
               AND cp.reconciliation_status IN
                 ('FULLY_RECONCILED','PARTIALLY_RECONCILED','MANUAL_OVERRIDE','OVERPAID','UNDERPAID')
             LEFT JOIN card_settlement_bank_mappings mapping
               ON mapping.household_id=cs.household_id AND mapping.card_account_id=cs.card_account_id
             WHERE cs.household_id=?1 AND cs.payment_due_on IS NULL
             GROUP BY cs.id,cs.card_account_id,card.name,cs.statement_amount_jpy,mapping.card_account_id
             HAVING MAX(cs.statement_amount_jpy-COALESCE(SUM(cp.payment_amount_jpy),0),0)>0
             ORDER BY cs.id LIMIT 10001",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map(params![household_id, as_of], |row| {
            Ok(MissingDueCardSettlementDto {
                statement_id: row.get(0)?,
                card_account_id: row.get(1)?,
                card_account_name: row.get(2)?,
                statement_amount_jpy: row.get(3)?,
                paid_amount_jpy: row.get(4)?,
                outstanding_amount_jpy: row.get(5)?,
                mapping_configured: row.get(6)?,
            })
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    if rows.len() > MAX_COVERAGE_STATEMENTS {
        Err(CardSettlementMappingError::InvalidInput(
            "Card settlement coverage has too many statements",
        ))
    } else {
        Ok(rows)
    }
}

fn bank_balance(
    connection: &Connection,
    household_id: &str,
    bank_account_id: &str,
    as_of: &str,
) -> Result<i64, CardSettlementMappingError> {
    connection
        .query_row(
            "SELECT COALESCE(SUM(CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END),0)
             FROM transactions t JOIN journal_entries je ON je.transaction_id=t.id
             WHERE t.household_id=?1 AND t.status='POSTED' AND t.occurred_on<=?2
               AND je.account_id=?3",
            params![household_id, as_of, bank_account_id],
            |row| row.get(0),
        )
        .map_err(db_error)
}

fn validate_id(value: &str) -> Result<(), CardSettlementMappingError> {
    if value.is_empty()
        || value.len() > MAX_ID_LEN
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Err(CardSettlementMappingError::InvalidInput(
            "Identifier is invalid",
        ))
    } else {
        Ok(())
    }
}

fn ensure_household(
    connection: &Connection,
    household_id: &str,
) -> Result<(), CardSettlementMappingError> {
    connection
        .query_row(
            "SELECT 1 FROM households WHERE id=?1",
            [household_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(db_error)?
        .ok_or(CardSettlementMappingError::NotFound)
}

fn validate_account(
    connection: &Connection,
    household_id: &str,
    account_id: &str,
    kind: &str,
    subtype: &str,
) -> Result<(), CardSettlementMappingError> {
    connection
        .query_row(
            "SELECT 1 FROM accounts WHERE id=?1 AND household_id=?2
               AND account_kind=?3 AND account_subtype=?4 AND is_archived=0",
            params![account_id, household_id, kind, subtype],
            |_| Ok(()),
        )
        .optional()
        .map_err(db_error)?
        .ok_or(CardSettlementMappingError::InvalidInput(
            "Settlement mapping account is invalid",
        ))
}

fn validate_date(
    connection: &Connection,
    value: &str,
) -> Result<String, CardSettlementMappingError> {
    if value.len() != 10 || !value.is_ascii() {
        return Err(CardSettlementMappingError::InvalidInput(
            "As-of date is invalid",
        ));
    }
    let normalized: Option<String> = connection
        .query_row("SELECT date(?1)", [value], |row| row.get(0))
        .map_err(db_error)?;
    if normalized.as_deref() == Some(value) {
        Ok(value.to_owned())
    } else {
        Err(CardSettlementMappingError::InvalidInput(
            "As-of date is invalid",
        ))
    }
}

fn shift_date(
    connection: &Connection,
    value: &str,
    modifier: &str,
) -> Result<String, CardSettlementMappingError> {
    connection
        .query_row("SELECT date(?1,?2)", params![value, modifier], |row| {
            row.get(0)
        })
        .map_err(db_error)
}

fn command_result<T>(
    state: &tauri::State<'_, AppState>,
    operation: impl FnOnce(&Connection) -> Result<T, CardSettlementMappingError>,
) -> Result<T, String> {
    match state.with_connection(|connection| Ok(operation(connection))) {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(error.public_message().to_owned()),
        Err(_) => Err(CardSettlementMappingError::Unavailable
            .public_message()
            .to_owned()),
    }
}

#[tauri::command]
pub fn card_settlement_bank_mappings_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<CardSettlementBankMappingDto>, String> {
    command_result(&state, |connection| {
        list_mappings(connection, &household_id)
    })
}

#[tauri::command]
pub fn card_settlement_bank_mapping_upsert(
    state: tauri::State<'_, AppState>,
    input: UpsertCardSettlementBankMappingInput,
) -> Result<CardSettlementBankMappingDto, String> {
    command_result(&state, |connection| upsert_mapping(connection, &input))
}

#[tauri::command]
pub fn card_settlement_bank_mapping_delete(
    state: tauri::State<'_, AppState>,
    input: DeleteCardSettlementBankMappingInput,
) -> Result<(), String> {
    command_result(&state, |connection| delete_mapping(connection, &input))
}

#[tauri::command]
pub fn card_settlement_balance_coverage_query(
    state: tauri::State<'_, AppState>,
    request: CardSettlementBalanceCoverageRequest,
) -> Result<CardSettlementBalanceCoverageDto, String> {
    command_result(&state, |connection| balance_coverage(connection, &request))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON;
                 CREATE TABLE households(id TEXT PRIMARY KEY);
                 CREATE TABLE accounts(
                   id TEXT PRIMARY KEY,household_id TEXT NOT NULL REFERENCES households(id),
                   name TEXT NOT NULL,account_kind TEXT NOT NULL,account_subtype TEXT NOT NULL,
                   is_archived INTEGER NOT NULL DEFAULT 0);
                 CREATE TABLE transactions(
                   id TEXT PRIMARY KEY,household_id TEXT NOT NULL REFERENCES households(id),
                   occurred_on TEXT NOT NULL,status TEXT NOT NULL,
                   calculation_target INTEGER NOT NULL DEFAULT 1);
                 CREATE TABLE journal_entries(
                   id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL REFERENCES transactions(id),
                   account_id TEXT NOT NULL REFERENCES accounts(id),entry_side TEXT NOT NULL,
                   amount_jpy INTEGER NOT NULL);
                 CREATE TABLE card_statements(
                   id TEXT PRIMARY KEY,household_id TEXT NOT NULL REFERENCES households(id),
                   card_account_id TEXT NOT NULL REFERENCES accounts(id),payment_due_on TEXT,
                   statement_amount_jpy INTEGER NOT NULL,reconciliation_status TEXT NOT NULL);
                 CREATE TABLE card_payments(
                   id TEXT PRIMARY KEY,statement_id TEXT,payment_amount_jpy INTEGER NOT NULL,
                   payment_on TEXT NOT NULL,reconciliation_status TEXT NOT NULL);
                 INSERT INTO households VALUES ('family'),('other');
                 INSERT INTO accounts VALUES
                   ('bank','family','Main bank','ASSET','BANK',0),
                   ('card-a','family','Card A','LIABILITY','CREDIT_CARD',0),
                   ('card-b','family','Card B','LIABILITY','CREDIT_CARD',0),
                   ('card-unmapped','family','Card Unmapped','LIABILITY','CREDIT_CARD',0),
                   ('wrong','family','Cash','ASSET','CASH',0),
                   ('archived-bank','family','Old bank','ASSET','BANK',1),
                   ('other-bank','other','Other bank','ASSET','BANK',0),
                   ('other-card','other','Other card','LIABILITY','CREDIT_CARD',0);",
            )
            .unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0023_card_settlement_bank_mappings.sql"
            ))
            .unwrap();
        connection
    }

    fn mapping(card: &str, bank: &str) -> UpsertCardSettlementBankMappingInput {
        UpsertCardSettlementBankMappingInput {
            household_id: "family".into(),
            card_account_id: card.into(),
            bank_account_id: bank.into(),
        }
    }

    #[test]
    fn explicit_mappings_project_multiple_cards_cumulatively_and_keep_unmapped_separate() {
        let connection = database();
        upsert_mapping(&connection, &mapping("card-a", "bank")).unwrap();
        upsert_mapping(&connection, &mapping("card-b", "bank")).unwrap();
        connection
            .execute_batch(
                "INSERT INTO transactions VALUES ('deposit','family','2026-07-01','POSTED',0);
                 INSERT INTO journal_entries VALUES ('deposit-d','deposit','bank','DEBIT',100000);
                 INSERT INTO card_statements VALUES
                   ('s1','family','card-a','2026-07-20',60000,'PARTIALLY_RECONCILED'),
                   ('s2','family','card-b','2026-07-25',80000,'UNMATCHED'),
                   ('s3','family','card-unmapped','2026-07-22',20000,'UNMATCHED'),
                   ('done','family','card-a','2026-07-18',999999,'FULLY_RECONCILED');
                 INSERT INTO card_payments VALUES
                   ('partial','s1',10000,'2026-07-10','FULLY_RECONCILED'),
                   ('future','s1',20000,'2026-07-14','FULLY_RECONCILED'),
                   ('unconfirmed','s1',30000,'2026-07-10','POSSIBLE_MATCH'),
                   ('done-paid','done',999999,'2026-07-10','FULLY_RECONCILED');",
            )
            .unwrap();
        let result = balance_coverage(
            &connection,
            &CardSettlementBalanceCoverageRequest {
                household_id: "family".into(),
                as_of: "2026-07-13".into(),
                horizon_days: None,
            },
        )
        .unwrap();
        assert_eq!(result.horizon_days, 45);
        assert_eq!(result.banks.len(), 1);
        let bank = &result.banks[0];
        assert_eq!(bank.balance_as_of_jpy, 100_000);
        assert_eq!(bank.statements[0].paid_amount_jpy, 10_000);
        assert_eq!(bank.statements[0].outstanding_amount_jpy, 50_000);
        assert_eq!(bank.statements[0].projected_bank_balance_jpy, 50_000);
        assert_eq!(
            bank.statements[0].status,
            CardSettlementCoverageStatus::Covered
        );
        assert_eq!(bank.statements[1].projected_bank_balance_jpy, -30_000);
        assert_eq!(bank.statements[1].shortfall_jpy, 30_000);
        assert_eq!(
            bank.statements[1].status,
            CardSettlementCoverageStatus::Shortfall
        );
        assert_eq!(bank.projected_ending_balance_jpy, -30_000);
        assert_eq!(bank.max_shortfall_jpy, 30_000);
        assert_eq!(result.unmapped_statements.len(), 1);
        assert_eq!(result.unmapped_statements[0].statement_id, "s3");
    }

    #[test]
    fn mapping_crud_rejects_wrong_type_archived_and_cross_household_accounts() {
        let connection = database();
        let created = upsert_mapping(&connection, &mapping("card-a", "bank")).unwrap();
        assert_eq!(created.bank_account_name, "Main bank");
        assert_eq!(list_mappings(&connection, "family").unwrap().len(), 1);
        assert!(matches!(
            upsert_mapping(&connection, &mapping("card-a", "wrong")),
            Err(CardSettlementMappingError::InvalidInput(_))
        ));
        assert!(matches!(
            upsert_mapping(&connection, &mapping("card-a", "archived-bank")),
            Err(CardSettlementMappingError::InvalidInput(_))
        ));
        assert!(matches!(
            upsert_mapping(&connection, &mapping("card-a", "other-bank")),
            Err(CardSettlementMappingError::InvalidInput(_))
        ));
        delete_mapping(
            &connection,
            &DeleteCardSettlementBankMappingInput {
                household_id: "family".into(),
                card_account_id: "card-a".into(),
            },
        )
        .unwrap();
        assert!(list_mappings(&connection, "family").unwrap().is_empty());
    }

    #[test]
    fn all_overdue_and_missing_due_obligations_are_disclosed_and_horizon_is_validated() {
        let connection = database();
        upsert_mapping(&connection, &mapping("card-a", "bank")).unwrap();
        connection
            .execute_batch(
                "INSERT INTO card_statements VALUES
                   ('overdue','family','card-a','2026-07-01',1000,'UNMATCHED'),
                   ('too-old','family','card-a','2025-01-01',1000,'UNMATCHED'),
                   ('undated','family','card-a',NULL,1000,'UNMATCHED');",
            )
            .unwrap();
        let result = balance_coverage(
            &connection,
            &CardSettlementBalanceCoverageRequest {
                household_id: "family".into(),
                as_of: "2026-07-13".into(),
                horizon_days: Some(0),
            },
        )
        .unwrap();
        assert_eq!(result.history_from, "2025-01-01");
        assert_eq!(result.banks[0].statements.len(), 2);
        assert!(result.banks[0]
            .statements
            .iter()
            .all(|statement| statement.status == CardSettlementCoverageStatus::Overdue));
        assert_eq!(result.missing_due_statements.len(), 1);
        assert_eq!(result.missing_due_statements[0].statement_id, "undated");
        assert!(result.missing_due_statements[0].mapping_configured);
        assert!(matches!(
            balance_coverage(
                &connection,
                &CardSettlementBalanceCoverageRequest {
                    household_id: "family".into(),
                    as_of: "2026-07-13".into(),
                    horizon_days: Some(366),
                }
            ),
            Err(CardSettlementMappingError::InvalidInput(_))
        ));
    }
}
