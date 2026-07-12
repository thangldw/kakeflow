use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

const BALANCE_TOLERANCE: f64 = 0.000_001;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum BrokerageError {
    #[error("brokerage input is invalid")]
    Invalid,
    #[error("the brokerage account or source document is outside the household")]
    Scope,
    #[error("the brokerage import conflicts with existing source rows")]
    Conflict,
    #[error("database operation failed")]
    Database,
}

impl BrokerageError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::Invalid => "Brokerage data is invalid or unbalanced",
            Self::Scope => "Brokerage account or source document was not found",
            Self::Conflict => "Brokerage source rows were already imported",
            Self::Database => "Brokerage data could not be stored",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportBrokerageEventsInput {
    pub household_id: String,
    pub account_id: String,
    pub source_document_id: String,
    pub events: Vec<ImportBrokerageEventInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportBrokerageEventInput {
    pub id: String,
    pub source_row: i64,
    pub event_type: String,
    pub trade_date: Option<String>,
    pub settlement_date: Option<String>,
    pub instrument_code: String,
    pub instrument_name: String,
    pub account_type: String,
    pub currency: String,
    pub quantity: Option<f64>,
    pub unit_price: Option<f64>,
    pub gross_amount: f64,
    pub fee_amount: f64,
    pub tax_amount: f64,
    pub settlement_amount: f64,
    pub reconciliation_status: String,
    pub reconciliation_difference: f64,
    pub affects_household_expense: bool,
    pub raw_transaction_type: String,
    pub legs: Vec<ImportBrokerageLegInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportBrokerageLegInput {
    pub id: String,
    pub kind: String,
    pub signed_amount: f64,
    pub currency: String,
    pub instrument_code: Option<String>,
    pub instrument_name: Option<String>,
    pub signed_quantity: Option<f64>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerageImportSummaryDto {
    pub source_document_id: String,
    pub imported_event_count: i64,
    pub imported_leg_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrokerageHistoryRequest {
    pub household_id: String,
    pub account_id: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerageHistoryDto {
    pub events: Vec<BrokerageEventDto>,
    pub totals_by_currency: Vec<BrokerageCurrencyTotalsDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerageEventDto {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub source_document_id: String,
    pub source_row: i64,
    pub event_type: String,
    pub trade_date: Option<String>,
    pub settlement_date: Option<String>,
    pub instrument_code: String,
    pub instrument_name: String,
    pub account_type: String,
    pub currency: String,
    pub quantity: Option<f64>,
    pub unit_price: Option<f64>,
    pub gross_amount: f64,
    pub fee_amount: f64,
    pub tax_amount: f64,
    pub settlement_amount: f64,
    pub reconciliation_status: String,
    pub reconciliation_difference: f64,
    pub affects_household_expense: bool,
    pub raw_transaction_type: String,
    pub legs: Vec<BrokerageLegDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerageLegDto {
    pub id: String,
    pub line_number: i64,
    pub kind: String,
    pub signed_amount: f64,
    pub currency: String,
    pub instrument_code: Option<String>,
    pub instrument_name: Option<String>,
    pub signed_quantity: Option<f64>,
    pub description: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerageCurrencyTotalsDto {
    pub currency: String,
    pub buy_gross: f64,
    pub sell_gross: f64,
    pub dividend_gross: f64,
    pub fees: f64,
    pub taxes: f64,
    pub deposits: f64,
    pub withdrawals: f64,
    pub net_cash_movement: f64,
}

pub fn import_events(
    connection: &Connection,
    input: &ImportBrokerageEventsInput,
) -> Result<BrokerageImportSummaryDto, BrokerageError> {
    validate_batch(input)?;
    let transaction = connection.unchecked_transaction().map_err(db_error)?;
    validate_scope(&transaction, input)?;
    let mut leg_count = 0_i64;
    for event in &input.events {
        transaction.execute(
            "INSERT INTO brokerage_events (id, household_id, account_id, source_document_id, source_row, event_type, trade_date, settlement_date, instrument_code, instrument_name, brokerage_account_type, currency, quantity, unit_price, gross_amount, fee_amount, tax_amount, settlement_amount, reconciliation_status, reconciliation_difference, affects_household_expense, raw_transaction_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, 0, ?21)",
            params![event.id, input.household_id, input.account_id, input.source_document_id, event.source_row, event.event_type, event.trade_date, event.settlement_date, event.instrument_code, event.instrument_name, event.account_type, event.currency, event.quantity, event.unit_price, event.gross_amount, event.fee_amount, event.tax_amount, event.settlement_amount, event.reconciliation_status, event.reconciliation_difference, event.raw_transaction_type],
        ).map_err(insert_error)?;
        for (index, leg) in event.legs.iter().enumerate() {
            transaction.execute(
                "INSERT INTO brokerage_event_legs (id, brokerage_event_id, line_number, leg_kind, signed_amount, currency, instrument_code, instrument_name, signed_quantity, description) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![leg.id, event.id, index as i64 + 1, leg.kind, leg.signed_amount, leg.currency, leg.instrument_code, leg.instrument_name, leg.signed_quantity, leg.description],
            ).map_err(insert_error)?;
            leg_count += 1;
        }
    }
    transaction.commit().map_err(db_error)?;
    Ok(BrokerageImportSummaryDto {
        source_document_id: input.source_document_id.clone(),
        imported_event_count: input.events.len() as i64,
        imported_leg_count: leg_count,
    })
}

pub fn query_history(
    connection: &Connection,
    request: &BrokerageHistoryRequest,
) -> Result<BrokerageHistoryDto, BrokerageError> {
    validate_history_request(request)?;
    if let Some(account_id) = &request.account_id {
        let valid: Option<i64> = connection.query_row(
            "SELECT 1 FROM accounts WHERE id = ?1 AND household_id = ?2 AND account_subtype = 'SECURITIES'",
            params![account_id, request.household_id], |row| row.get(0),
        ).optional().map_err(db_error)?;
        if valid.is_none() {
            return Err(BrokerageError::Scope);
        }
    }
    let mut statement = connection.prepare(
        "SELECT e.id, e.account_id, a.name, e.source_document_id, e.source_row, e.event_type, e.trade_date, e.settlement_date, e.instrument_code, e.instrument_name, e.brokerage_account_type, e.currency, e.quantity, e.unit_price, e.gross_amount, e.fee_amount, e.tax_amount, e.settlement_amount, e.reconciliation_status, e.reconciliation_difference, e.affects_household_expense, e.raw_transaction_type
         FROM brokerage_events e JOIN accounts a ON a.id = e.account_id
         WHERE e.household_id = ?1
           AND (?2 IS NULL OR e.account_id = ?2)
           AND (?3 IS NULL OR COALESCE(e.trade_date, e.settlement_date) >= ?3)
           AND (?4 IS NULL OR COALESCE(e.trade_date, e.settlement_date) <= ?4)
         ORDER BY COALESCE(e.trade_date, e.settlement_date) DESC, e.source_row DESC, e.id DESC"
    ).map_err(db_error)?;
    let rows = statement
        .query_map(
            params![
                request.household_id,
                request.account_id,
                request.date_from,
                request.date_to
            ],
            |row| {
                Ok(BrokerageEventDto {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    account_name: row.get(2)?,
                    source_document_id: row.get(3)?,
                    source_row: row.get(4)?,
                    event_type: row.get(5)?,
                    trade_date: row.get(6)?,
                    settlement_date: row.get(7)?,
                    instrument_code: row.get(8)?,
                    instrument_name: row.get(9)?,
                    account_type: row.get(10)?,
                    currency: row.get(11)?,
                    quantity: row.get(12)?,
                    unit_price: row.get(13)?,
                    gross_amount: row.get(14)?,
                    fee_amount: row.get(15)?,
                    tax_amount: row.get(16)?,
                    settlement_amount: row.get(17)?,
                    reconciliation_status: row.get(18)?,
                    reconciliation_difference: row.get(19)?,
                    affects_household_expense: row.get::<_, i64>(20)? != 0,
                    raw_transaction_type: row.get(21)?,
                    legs: Vec::new(),
                })
            },
        )
        .map_err(db_error)?;
    let mut events = rows.collect::<Result<Vec<_>, _>>().map_err(db_error)?;
    for event in &mut events {
        event.legs = read_legs(connection, &event.id)?;
    }
    let totals_by_currency = calculate_totals(&events);
    Ok(BrokerageHistoryDto {
        events,
        totals_by_currency,
    })
}

fn read_legs(
    connection: &Connection,
    event_id: &str,
) -> Result<Vec<BrokerageLegDto>, BrokerageError> {
    let mut statement = connection.prepare(
        "SELECT id, line_number, leg_kind, signed_amount, currency, instrument_code, instrument_name, signed_quantity, description FROM brokerage_event_legs WHERE brokerage_event_id = ?1 ORDER BY line_number"
    ).map_err(db_error)?;
    let rows = statement
        .query_map([event_id], |row| {
            Ok(BrokerageLegDto {
                id: row.get(0)?,
                line_number: row.get(1)?,
                kind: row.get(2)?,
                signed_amount: row.get(3)?,
                currency: row.get(4)?,
                instrument_code: row.get(5)?,
                instrument_name: row.get(6)?,
                signed_quantity: row.get(7)?,
                description: row.get(8)?,
            })
        })
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

fn calculate_totals(events: &[BrokerageEventDto]) -> Vec<BrokerageCurrencyTotalsDto> {
    let mut totals = BTreeMap::<String, BrokerageCurrencyTotalsDto>::new();
    for event in events {
        let total =
            totals
                .entry(event.currency.clone())
                .or_insert_with(|| BrokerageCurrencyTotalsDto {
                    currency: event.currency.clone(),
                    ..Default::default()
                });
        match event.event_type.as_str() {
            "BUY" => total.buy_gross += event.gross_amount,
            "SELL" => total.sell_gross += event.gross_amount,
            "DIVIDEND" => total.dividend_gross += event.gross_amount,
            "FEE" if event.fee_amount == 0.0 => total.fees += event.gross_amount,
            "TAX" if event.tax_amount == 0.0 => total.taxes += event.gross_amount,
            "DEPOSIT" => total.deposits += event.settlement_amount,
            "WITHDRAWAL" => total.withdrawals += event.settlement_amount,
            _ => {}
        }
        total.fees += event.fee_amount;
        total.taxes += event.tax_amount;
        total.net_cash_movement += event
            .legs
            .iter()
            .filter(|leg| leg.kind == "CASH")
            .map(|leg| leg.signed_amount)
            .sum::<f64>();
    }
    totals.into_values().collect()
}

fn validate_batch(input: &ImportBrokerageEventsInput) -> Result<(), BrokerageError> {
    if input.household_id.trim().is_empty()
        || input.account_id.trim().is_empty()
        || input.source_document_id.trim().is_empty()
        || input.events.is_empty()
    {
        return Err(BrokerageError::Invalid);
    }
    let mut ids = std::collections::BTreeSet::new();
    let mut rows = std::collections::BTreeSet::new();
    for event in &input.events {
        if !ids.insert(event.id.as_str())
            || !rows.insert(event.source_row)
            || !validate_event(event)
        {
            return Err(BrokerageError::Invalid);
        }
    }
    Ok(())
}

fn validate_event(event: &ImportBrokerageEventInput) -> bool {
    let event_types = [
        "BUY",
        "SELL",
        "DIVIDEND",
        "FEE",
        "TAX",
        "DEPOSIT",
        "WITHDRAWAL",
    ];
    let statuses = ["BALANCED", "ADJUSTED"];
    if event.id.trim().is_empty()
        || event.source_row <= 0
        || !event_types.contains(&event.event_type.as_str())
        || !statuses.contains(&event.reconciliation_status.as_str())
        || event.affects_household_expense
        || !valid_currency(&event.currency)
        || event.raw_transaction_type.trim().is_empty()
        || event.legs.len() < 2
    {
        return false;
    }
    if !valid_date(&event.trade_date)
        || !valid_date(&event.settlement_date)
        || event.trade_date.is_none() && event.settlement_date.is_none()
    {
        return false;
    }
    let amounts = [
        event.gross_amount,
        event.fee_amount,
        event.tax_amount,
        event.settlement_amount,
        event.reconciliation_difference,
    ];
    if amounts.iter().any(|value| !value.is_finite())
        || event.gross_amount < 0.0
        || event.fee_amount < 0.0
        || event.tax_amount < 0.0
        || event.settlement_amount < 0.0
    {
        return false;
    }
    if event
        .quantity
        .is_some_and(|value| !value.is_finite() || value < 0.0)
        || event
            .unit_price
            .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        return false;
    }
    let leg_kinds = [
        "SECURITY",
        "CASH",
        "INVESTMENT_INCOME",
        "INVESTMENT_EXPENSE",
        "INVESTMENT_TAX",
        "TRANSFER",
        "ADJUSTMENT",
    ];
    let mut leg_ids = std::collections::BTreeSet::new();
    let mut balance = 0.0;
    for leg in &event.legs {
        if !leg_ids.insert(leg.id.as_str())
            || leg.id.trim().is_empty()
            || !leg_kinds.contains(&leg.kind.as_str())
            || leg.currency != event.currency
            || !leg.signed_amount.is_finite()
            || leg.signed_quantity.is_some_and(|value| !value.is_finite())
            || leg.description.trim().is_empty()
        {
            return false;
        }
        balance += leg.signed_amount;
    }
    let has = |kind: &str, positive: bool| {
        event
            .legs
            .iter()
            .any(|leg| leg.kind == kind && (leg.signed_amount > 0.0) == positive)
    };
    let semantic_legs = match event.event_type.as_str() {
        "BUY" => has("SECURITY", true) && has("CASH", false),
        "SELL" => has("SECURITY", false) && has("CASH", true),
        "DIVIDEND" => has("INVESTMENT_INCOME", false) && has("CASH", true),
        "FEE" => has("INVESTMENT_EXPENSE", true) && has("CASH", false),
        "TAX" => has("INVESTMENT_TAX", true) && has("CASH", false),
        "DEPOSIT" => has("CASH", true) && has("TRANSFER", false),
        "WITHDRAWAL" => has("CASH", false) && has("TRANSFER", true),
        _ => false,
    };
    balance.abs() <= BALANCE_TOLERANCE && semantic_legs
}

fn validate_scope(
    connection: &Connection,
    input: &ImportBrokerageEventsInput,
) -> Result<(), BrokerageError> {
    let account: Option<i64> = connection.query_row(
        "SELECT 1 FROM accounts WHERE id = ?1 AND household_id = ?2 AND account_subtype = 'SECURITIES' AND is_archived = 0",
        params![input.account_id, input.household_id], |row| row.get(0),
    ).optional().map_err(db_error)?;
    let document: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM source_documents WHERE id = ?1 AND household_id = ?2",
            params![input.source_document_id, input.household_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    if account.is_none() || document.is_none() {
        Err(BrokerageError::Scope)
    } else {
        Ok(())
    }
}

fn validate_history_request(request: &BrokerageHistoryRequest) -> Result<(), BrokerageError> {
    if request.household_id.trim().is_empty()
        || !valid_date(&request.date_from)
        || !valid_date(&request.date_to)
        || request
            .date_from
            .as_ref()
            .zip(request.date_to.as_ref())
            .is_some_and(|(from, to)| from > to)
    {
        Err(BrokerageError::Invalid)
    } else {
        Ok(())
    }
}

fn valid_currency(value: &str) -> bool {
    value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_uppercase())
}
fn valid_date(value: &Option<String>) -> bool {
    let Some(date) = value.as_deref() else {
        return true;
    };
    if date.len() != 10 || date.as_bytes()[4] != b'-' || date.as_bytes()[7] != b'-' {
        return false;
    }
    let Ok(year) = date[0..4].parse::<u32>() else {
        return false;
    };
    let Ok(month) = date[5..7].parse::<u32>() else {
        return false;
    };
    let Ok(day) = date[8..10].parse::<u32>() else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let maximum = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day > 0 && day <= maximum
}
fn db_error(_: rusqlite::Error) -> BrokerageError {
    BrokerageError::Database
}
fn insert_error(error: rusqlite::Error) -> BrokerageError {
    if matches!(error, rusqlite::Error::SqliteFailure(ref details, _) if details.code == rusqlite::ErrorCode::ConstraintViolation)
    {
        BrokerageError::Conflict
    } else {
        BrokerageError::Database
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        for migration in [
            include_str!("../migrations/0001_household_accounts.sql"),
            include_str!("../migrations/0002_import_provenance.sql"),
            include_str!("../migrations/0012_brokerage_events.sql"),
        ] {
            connection.execute_batch(migration).unwrap();
        }
        connection
            .execute(
                "INSERT INTO households (id,name) VALUES ('home','Home')",
                [],
            )
            .unwrap();
        connection.execute("INSERT INTO accounts (id,household_id,name,account_kind,account_subtype) VALUES ('broker','home','Broker','ASSET','SECURITIES')", []).unwrap();
        connection.execute("INSERT INTO import_runs (id,household_id,status) VALUES ('run','home','REVIEW_REQUIRED')", []).unwrap();
        connection.execute("INSERT INTO source_documents (id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path) VALUES ('doc','home','run','MANUAL_UPLOAD','trades.csv','text/csv',1,?1,'x')", ["a".repeat(64)]).unwrap();
        connection
    }

    fn event(id: &str, row: i64, event_type: &str) -> ImportBrokerageEventInput {
        ImportBrokerageEventInput {
            id: id.into(),
            source_row: row,
            event_type: event_type.into(),
            trade_date: Some("2026-07-01".into()),
            settlement_date: Some("2026-07-03".into()),
            instrument_code: "7203".into(),
            instrument_name: "Toyota".into(),
            account_type: "特定".into(),
            currency: "JPY".into(),
            quantity: Some(10.0),
            unit_price: Some(1000.0),
            gross_amount: 10000.0,
            fee_amount: 100.0,
            tax_amount: 0.0,
            settlement_amount: 10100.0,
            reconciliation_status: "BALANCED".into(),
            reconciliation_difference: 0.0,
            affects_household_expense: false,
            raw_transaction_type: event_type.into(),
            legs: vec![
                ImportBrokerageLegInput {
                    id: format!("{id}-1"),
                    kind: "SECURITY".into(),
                    signed_amount: 10000.0,
                    currency: "JPY".into(),
                    instrument_code: Some("7203".into()),
                    instrument_name: Some("Toyota".into()),
                    signed_quantity: Some(10.0),
                    description: "Security".into(),
                },
                ImportBrokerageLegInput {
                    id: format!("{id}-2"),
                    kind: "CASH".into(),
                    signed_amount: -10100.0,
                    currency: "JPY".into(),
                    instrument_code: None,
                    instrument_name: None,
                    signed_quantity: None,
                    description: "Cash".into(),
                },
                ImportBrokerageLegInput {
                    id: format!("{id}-3"),
                    kind: "INVESTMENT_EXPENSE".into(),
                    signed_amount: 100.0,
                    currency: "JPY".into(),
                    instrument_code: None,
                    instrument_name: None,
                    signed_quantity: None,
                    description: "Fee".into(),
                },
            ],
        }
    }

    #[test]
    fn imports_balanced_events_atomically_and_reads_performance_facts() {
        let connection = connection();
        let input = ImportBrokerageEventsInput {
            household_id: "home".into(),
            account_id: "broker".into(),
            source_document_id: "doc".into(),
            events: vec![event("buy", 2, "BUY")],
        };
        let summary = import_events(&connection, &input).unwrap();
        assert_eq!(summary.imported_event_count, 1);
        let history = query_history(
            &connection,
            &BrokerageHistoryRequest {
                household_id: "home".into(),
                account_id: Some("broker".into()),
                date_from: None,
                date_to: None,
            },
        )
        .unwrap();
        assert_eq!(history.events[0].legs.len(), 3);
        assert!(!history.events[0].affects_household_expense);
        assert_eq!(history.totals_by_currency[0].buy_gross, 10000.0);
        assert_eq!(history.totals_by_currency[0].fees, 100.0);
        assert_eq!(history.totals_by_currency[0].net_cash_movement, -10100.0);
    }

    #[test]
    fn rejects_unbalanced_batch_without_partial_writes() {
        let connection = connection();
        let valid = event("valid", 2, "BUY");
        let mut invalid = event("invalid", 3, "BUY");
        invalid.legs[1].signed_amount = -10000.0;
        let input = ImportBrokerageEventsInput {
            household_id: "home".into(),
            account_id: "broker".into(),
            source_document_id: "doc".into(),
            events: vec![valid, invalid],
        };
        assert!(matches!(
            import_events(&connection, &input),
            Err(BrokerageError::Invalid)
        ));
        let count: i64 = connection
            .query_row("SELECT count(*) FROM brokerage_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn duplicate_source_row_conflict_rolls_back_entire_batch() {
        let connection = connection();
        let first = ImportBrokerageEventsInput {
            household_id: "home".into(),
            account_id: "broker".into(),
            source_document_id: "doc".into(),
            events: vec![event("first", 2, "BUY")],
        };
        import_events(&connection, &first).unwrap();
        let second = ImportBrokerageEventsInput {
            household_id: "home".into(),
            account_id: "broker".into(),
            source_document_id: "doc".into(),
            events: vec![event("new", 4, "BUY"), event("duplicate", 2, "BUY")],
        };
        assert!(matches!(
            import_events(&connection, &second),
            Err(BrokerageError::Conflict)
        ));
        let count: i64 = connection
            .query_row("SELECT count(*) FROM brokerage_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn enforces_semantic_balancing_for_every_event_type() {
        let cases = [
            ("BUY", "SECURITY", 100.0, "CASH", -100.0),
            ("SELL", "SECURITY", -100.0, "CASH", 100.0),
            ("DIVIDEND", "INVESTMENT_INCOME", -100.0, "CASH", 100.0),
            ("FEE", "INVESTMENT_EXPENSE", 100.0, "CASH", -100.0),
            ("TAX", "INVESTMENT_TAX", 100.0, "CASH", -100.0),
            ("DEPOSIT", "CASH", 100.0, "TRANSFER", -100.0),
            ("WITHDRAWAL", "CASH", -100.0, "TRANSFER", 100.0),
        ];
        for (event_type, first_kind, first_amount, second_kind, second_amount) in cases {
            let mut candidate = event(event_type, 2, event_type);
            candidate.event_type = event_type.into();
            candidate.legs = vec![
                ImportBrokerageLegInput {
                    id: "one".into(),
                    kind: first_kind.into(),
                    signed_amount: first_amount,
                    currency: "JPY".into(),
                    instrument_code: None,
                    instrument_name: None,
                    signed_quantity: None,
                    description: "first".into(),
                },
                ImportBrokerageLegInput {
                    id: "two".into(),
                    kind: second_kind.into(),
                    signed_amount: second_amount,
                    currency: "JPY".into(),
                    instrument_code: None,
                    instrument_name: None,
                    signed_quantity: None,
                    description: "second".into(),
                },
            ];
            assert!(
                validate_event(&candidate),
                "{event_type} must accept its canonical legs"
            );
            candidate.legs[0].kind = "ADJUSTMENT".into();
            assert!(
                !validate_event(&candidate),
                "{event_type} must reject semantically unrelated balanced legs"
            );
        }
    }
}
