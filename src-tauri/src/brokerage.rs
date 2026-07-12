use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

const BALANCE_TOLERANCE: f64 = 0.000_001;
const MAX_MERGER_CASH_AMOUNT: f64 = 1.0e18;
const MAX_MERGER_FX_RATE: f64 = 1.0e12;

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
    #[serde(default)]
    pub corporate_action_ratio: Option<f64>,
    #[serde(default)]
    pub target_instrument_code: Option<String>,
    #[serde(default)]
    pub target_instrument_name: Option<String>,
    #[serde(default)]
    pub target_currency: Option<String>,
    #[serde(default)]
    pub cost_basis_allocation_ratio: Option<f64>,
    #[serde(default)]
    pub subscription_amount: Option<f64>,
    #[serde(default)]
    pub cash_in_lieu_amount: Option<f64>,
    #[serde(default)]
    pub cash_in_lieu_quantity: Option<f64>,
    #[serde(default)]
    pub merger_cash_amount: Option<f64>,
    #[serde(default)]
    pub merger_cash_currency: Option<String>,
    #[serde(default)]
    pub merger_stock_cost_basis_ratio: Option<f64>,
    #[serde(default)]
    pub source_to_target_fx_rate: Option<f64>,
    #[serde(default)]
    pub source_to_cash_fx_rate: Option<f64>,
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
    pub corporate_action_ratio: Option<f64>,
    pub target_instrument_code: Option<String>,
    pub target_instrument_name: Option<String>,
    pub target_currency: Option<String>,
    pub cost_basis_allocation_ratio: Option<f64>,
    pub subscription_amount: Option<f64>,
    pub cash_in_lieu_amount: Option<f64>,
    pub cash_in_lieu_quantity: Option<f64>,
    pub merger_cash_amount: Option<f64>,
    pub merger_cash_currency: Option<String>,
    pub merger_stock_cost_basis_ratio: Option<f64>,
    pub source_to_target_fx_rate: Option<f64>,
    pub source_to_cash_fx_rate: Option<f64>,
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
            "INSERT INTO brokerage_events (id, household_id, account_id, source_document_id, source_row, event_type, trade_date, settlement_date, instrument_code, instrument_name, brokerage_account_type, currency, quantity, unit_price, gross_amount, fee_amount, tax_amount, settlement_amount, reconciliation_status, reconciliation_difference, affects_household_expense, raw_transaction_type, corporate_action_ratio, target_instrument_code, target_instrument_name, target_currency, cost_basis_allocation_ratio, subscription_amount, cash_in_lieu_amount, cash_in_lieu_quantity, merger_cash_amount, merger_cash_currency, merger_stock_cost_basis_ratio, source_to_target_fx_rate, source_to_cash_fx_rate) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, 0, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34)",
            params![event.id, input.household_id, input.account_id, input.source_document_id, event.source_row, event.event_type, event.trade_date, event.settlement_date, event.instrument_code, event.instrument_name, event.account_type, event.currency, event.quantity, event.unit_price, event.gross_amount, event.fee_amount, event.tax_amount, event.settlement_amount, event.reconciliation_status, event.reconciliation_difference, event.raw_transaction_type, event.corporate_action_ratio, event.target_instrument_code, event.target_instrument_name, event.target_currency, event.cost_basis_allocation_ratio, event.subscription_amount, event.cash_in_lieu_amount, event.cash_in_lieu_quantity, event.merger_cash_amount, event.merger_cash_currency, event.merger_stock_cost_basis_ratio, event.source_to_target_fx_rate, event.source_to_cash_fx_rate],
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
        "SELECT e.id, e.account_id, a.name, e.source_document_id, e.source_row, e.event_type, e.trade_date, e.settlement_date, e.instrument_code, e.instrument_name, e.brokerage_account_type, e.currency, e.quantity, e.unit_price, e.gross_amount, e.fee_amount, e.tax_amount, e.settlement_amount, e.reconciliation_status, e.reconciliation_difference, e.affects_household_expense, e.raw_transaction_type, e.corporate_action_ratio, e.target_instrument_code, e.target_instrument_name, e.target_currency, e.cost_basis_allocation_ratio, e.subscription_amount, e.cash_in_lieu_amount, e.cash_in_lieu_quantity, e.merger_cash_amount, e.merger_cash_currency, e.merger_stock_cost_basis_ratio, e.source_to_target_fx_rate, e.source_to_cash_fx_rate
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
                    corporate_action_ratio: row.get(22)?,
                    target_instrument_code: row.get(23)?,
                    target_instrument_name: row.get(24)?,
                    target_currency: row.get(25)?,
                    cost_basis_allocation_ratio: row.get(26)?,
                    subscription_amount: row.get(27)?,
                    cash_in_lieu_amount: row.get(28)?,
                    cash_in_lieu_quantity: row.get(29)?,
                    merger_cash_amount: row.get(30)?,
                    merger_cash_currency: row.get(31)?,
                    merger_stock_cost_basis_ratio: row.get(32)?,
                    source_to_target_fx_rate: row.get(33)?,
                    source_to_cash_fx_rate: row.get(34)?,
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
        {
            let total = totals.entry(event.currency.clone()).or_insert_with(|| {
                BrokerageCurrencyTotalsDto {
                    currency: event.currency.clone(),
                    ..Default::default()
                }
            });
            match event.event_type.as_str() {
                "BUY" | "RIGHTS_SUBSCRIPTION" => total.buy_gross += event.gross_amount,
                "SELL" | "CASH_IN_LIEU" => total.sell_gross += event.gross_amount,
                "DIVIDEND" => total.dividend_gross += event.gross_amount,
                "FEE" if event.fee_amount == 0.0 => total.fees += event.gross_amount,
                "TAX" if event.tax_amount == 0.0 => total.taxes += event.gross_amount,
                "DEPOSIT" => total.deposits += event.settlement_amount,
                "WITHDRAWAL" => total.withdrawals += event.settlement_amount,
                _ => {}
            }
            total.fees += event.fee_amount;
            total.taxes += event.tax_amount;
        }
        for leg in event.legs.iter().filter(|leg| leg.kind == "CASH") {
            let total =
                totals
                    .entry(leg.currency.clone())
                    .or_insert_with(|| BrokerageCurrencyTotalsDto {
                        currency: leg.currency.clone(),
                        ..Default::default()
                    });
            total.net_cash_movement += leg.signed_amount;
        }
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
        "SPLIT",
        "REVERSE_SPLIT",
        "MERGER",
        "SPIN_OFF",
        "RIGHTS_SUBSCRIPTION",
        "CASH_IN_LIEU",
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
    let ratio_action = matches!(
        event.event_type.as_str(),
        "SPLIT" | "REVERSE_SPLIT" | "MERGER" | "SPIN_OFF" | "RIGHTS_SUBSCRIPTION"
    );
    let complex_action = matches!(
        event.event_type.as_str(),
        "SPIN_OFF" | "RIGHTS_SUBSCRIPTION" | "CASH_IN_LIEU"
    );
    if ratio_action
        != event
            .corporate_action_ratio
            .is_some_and(|ratio| ratio.is_finite() && ratio > 0.0)
        || (!ratio_action
            && (event.target_instrument_code.is_some()
                || event.target_instrument_name.is_some()
                || event.target_currency.is_some()))
        || event
            .target_currency
            .as_deref()
            .is_some_and(|value| !valid_currency(value))
        || event.event_type != "MERGER"
            && event
                .target_currency
                .as_deref()
                .is_some_and(|value| value != event.currency)
        || matches!(event.event_type.as_str(), "SPLIT" | "REVERSE_SPLIT")
            && (event.target_instrument_code.is_some()
                || event.target_instrument_name.is_some()
                || event.target_currency.is_some())
        || matches!(event.event_type.as_str(), "MERGER" | "SPIN_OFF")
            && (event
                .target_instrument_code
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
                && event
                    .target_instrument_name
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .is_empty())
        || !matches!(event.event_type.as_str(), "SPIN_OFF")
            && event.cost_basis_allocation_ratio.is_some()
        || event.event_type == "SPIN_OFF"
            && !event
                .cost_basis_allocation_ratio
                .is_some_and(|ratio| ratio.is_finite() && (0.0..=1.0).contains(&ratio))
        || !matches!(event.event_type.as_str(), "RIGHTS_SUBSCRIPTION")
            && event.subscription_amount.is_some()
        || event.event_type == "RIGHTS_SUBSCRIPTION"
            && !event
                .subscription_amount
                .is_some_and(|amount| amount.is_finite() && amount > 0.0)
        || !matches!(event.event_type.as_str(), "CASH_IN_LIEU")
            && (event.cash_in_lieu_amount.is_some() || event.cash_in_lieu_quantity.is_some())
        || event.event_type == "CASH_IN_LIEU"
            && (!event
                .cash_in_lieu_amount
                .is_some_and(|amount| amount.is_finite() && amount > 0.0)
                || !event
                    .cash_in_lieu_quantity
                    .is_some_and(|quantity| quantity.is_finite() && quantity > 0.0))
        || !complex_action
            && (event.cost_basis_allocation_ratio.is_some()
                || event.subscription_amount.is_some()
                || event.cash_in_lieu_amount.is_some()
                || event.cash_in_lieu_quantity.is_some())
        || event.event_type == "MERGER" && !valid_merger_terms(event)
        || event.event_type != "MERGER"
            && (event.merger_cash_amount.is_some()
                || event.merger_cash_currency.is_some()
                || event.merger_stock_cost_basis_ratio.is_some()
                || event.source_to_target_fx_rate.is_some()
                || event.source_to_cash_fx_rate.is_some())
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
    let mut balances = BTreeMap::<&str, f64>::new();
    for leg in &event.legs {
        if !leg_ids.insert(leg.id.as_str())
            || leg.id.trim().is_empty()
            || !leg_kinds.contains(&leg.kind.as_str())
            || !valid_currency(&leg.currency)
            || event.event_type != "MERGER" && leg.currency != event.currency
            || !leg.signed_amount.is_finite()
            || leg.signed_quantity.is_some_and(|value| !value.is_finite())
            || leg.description.trim().is_empty()
        {
            return false;
        }
        *balances.entry(&leg.currency).or_default() += leg.signed_amount;
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
        "SPLIT" | "REVERSE_SPLIT" | "SPIN_OFF" => {
            event.gross_amount == 0.0
                && event.fee_amount == 0.0
                && event.tax_amount == 0.0
                && event.settlement_amount == 0.0
                && event
                    .legs
                    .iter()
                    .filter(|leg| leg.kind == "SECURITY")
                    .count()
                    == 2
                && event.legs.iter().any(|leg| {
                    leg.kind == "SECURITY" && leg.signed_quantity.is_some_and(|value| value < 0.0)
                })
                && event.legs.iter().any(|leg| {
                    leg.kind == "SECURITY" && leg.signed_quantity.is_some_and(|value| value > 0.0)
                })
        }
        "MERGER" => valid_merger_legs(event),
        "RIGHTS_SUBSCRIPTION" => {
            event.subscription_amount == Some(event.gross_amount)
                && event.settlement_amount == event.gross_amount
                && has("SECURITY", true)
                && has("CASH", false)
        }
        "CASH_IN_LIEU" => {
            event.cash_in_lieu_amount == Some(event.gross_amount)
                && event.settlement_amount == event.gross_amount
                && has("SECURITY", false)
                && has("CASH", true)
        }
        _ => false,
    };
    balances
        .values()
        .all(|balance| balance.abs() <= BALANCE_TOLERANCE)
        && semantic_legs
}

fn valid_merger_terms(event: &ImportBrokerageEventInput) -> bool {
    let Some(target_currency) = event.target_currency.as_deref() else {
        return false;
    };
    if event
        .target_instrument_code
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
        && event
            .target_instrument_name
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
        || !valid_currency(target_currency)
        || !valid_conditional_fx_rate(
            event.source_to_target_fx_rate,
            target_currency != event.currency,
        )
    {
        return false;
    }
    match (
        event.merger_cash_amount,
        event.merger_cash_currency.as_deref(),
    ) {
        (None, None) => {
            event.merger_stock_cost_basis_ratio == Some(1.0)
                && event.source_to_cash_fx_rate.is_none()
        }
        (Some(amount), Some(cash_currency)) => {
            amount.is_finite()
                && amount > 0.0
                && amount <= MAX_MERGER_CASH_AMOUNT
                && valid_currency(cash_currency)
                && event
                    .merger_stock_cost_basis_ratio
                    .is_some_and(|ratio| ratio.is_finite() && ratio > 0.0 && ratio < 1.0)
                && valid_conditional_fx_rate(
                    event.source_to_cash_fx_rate,
                    cash_currency != event.currency,
                )
        }
        _ => false,
    }
}

fn valid_conditional_fx_rate(rate: Option<f64>, required: bool) -> bool {
    match (rate, required) {
        (Some(value), true) => value.is_finite() && value > 0.0 && value <= MAX_MERGER_FX_RATE,
        (None, false) => true,
        _ => false,
    }
}

fn valid_merger_legs(event: &ImportBrokerageEventInput) -> bool {
    if event.gross_amount != 0.0
        || event.fee_amount != 0.0
        || event.tax_amount != 0.0
        || event.settlement_amount != 0.0
    {
        return false;
    }
    let Some(target_currency) = event.target_currency.as_deref() else {
        return false;
    };
    let source_security = event.legs.iter().filter(|leg| {
        leg.kind == "SECURITY"
            && leg.currency == event.currency
            && leg.signed_amount == 0.0
            && leg.signed_quantity.is_some_and(|quantity| quantity < 0.0)
            && instrument_matches(
                leg,
                Some(event.instrument_code.as_str()),
                Some(event.instrument_name.as_str()),
            )
    });
    let target_security = event.legs.iter().filter(|leg| {
        leg.kind == "SECURITY"
            && leg.currency == target_currency
            && leg.signed_amount == 0.0
            && leg.signed_quantity.is_some_and(|quantity| quantity > 0.0)
            && instrument_matches(
                leg,
                event.target_instrument_code.as_deref(),
                event.target_instrument_name.as_deref(),
            )
    });
    let source_quantities = source_security
        .map(|leg| leg.signed_quantity.unwrap_or_default())
        .collect::<Vec<_>>();
    let target_quantities = target_security
        .map(|leg| leg.signed_quantity.unwrap_or_default())
        .collect::<Vec<_>>();
    if source_quantities.len() != 1 || target_quantities.len() != 1 {
        return false;
    }
    let expected_target = -source_quantities[0] * event.corporate_action_ratio.unwrap_or_default();
    if (target_quantities[0] - expected_target).abs() > BALANCE_TOLERANCE {
        return false;
    }
    match (
        event.merger_cash_amount,
        event.merger_cash_currency.as_deref(),
    ) {
        (None, None) => event.legs.len() == 2,
        (Some(amount), Some(currency)) => {
            event.legs.len() == 4
                && event
                    .legs
                    .iter()
                    .filter(|leg| {
                        leg.kind == "CASH"
                            && leg.currency == currency
                            && (leg.signed_amount - amount).abs() <= BALANCE_TOLERANCE
                            && leg.signed_quantity.is_none()
                    })
                    .count()
                    == 1
                && event
                    .legs
                    .iter()
                    .filter(|leg| {
                        leg.kind == "ADJUSTMENT"
                            && leg.currency == currency
                            && (leg.signed_amount + amount).abs() <= BALANCE_TOLERANCE
                            && leg.signed_quantity.is_none()
                    })
                    .count()
                    == 1
        }
        _ => false,
    }
}

fn instrument_matches(
    leg: &ImportBrokerageLegInput,
    expected_code: Option<&str>,
    expected_name: Option<&str>,
) -> bool {
    expected_code
        .filter(|value| !value.trim().is_empty())
        .map_or_else(
            || {
                expected_name
                    .filter(|value| !value.trim().is_empty())
                    .is_some_and(|value| leg.instrument_name.as_deref() == Some(value))
            },
            |value| leg.instrument_code.as_deref() == Some(value),
        )
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
            include_str!("../migrations/0013_investment_performance.sql"),
            include_str!("../migrations/0014_investment_corporate_actions_fx.sql"),
            include_str!("../migrations/0016_complex_corporate_actions.sql"),
            include_str!("../migrations/0020_mixed_currency_mergers.sql"),
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
            corporate_action_ratio: None,
            target_instrument_code: None,
            target_instrument_name: None,
            target_currency: None,
            cost_basis_allocation_ratio: None,
            subscription_amount: None,
            cash_in_lieu_amount: None,
            cash_in_lieu_quantity: None,
            merger_cash_amount: None,
            merger_cash_currency: None,
            merger_stock_cost_basis_ratio: None,
            source_to_target_fx_rate: None,
            source_to_cash_fx_rate: None,
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

    fn merger(id: &str, row: i64) -> ImportBrokerageEventInput {
        let mut merger = event(id, row, "MERGER");
        merger.currency = "USD".into();
        merger.quantity = None;
        merger.unit_price = None;
        merger.gross_amount = 0.0;
        merger.fee_amount = 0.0;
        merger.tax_amount = 0.0;
        merger.settlement_amount = 0.0;
        merger.corporate_action_ratio = Some(0.5);
        merger.target_instrument_code = Some("TM".into());
        merger.target_instrument_name = Some("Toyota ADR successor".into());
        merger.target_currency = Some("JPY".into());
        merger.merger_stock_cost_basis_ratio = Some(1.0);
        merger.source_to_target_fx_rate = Some(150.0);
        merger.legs = vec![
            ImportBrokerageLegInput {
                id: format!("{id}-source"),
                kind: "SECURITY".into(),
                signed_amount: 0.0,
                currency: "USD".into(),
                instrument_code: Some("7203".into()),
                instrument_name: Some("Toyota".into()),
                signed_quantity: Some(-2.0),
                description: "Source shares".into(),
            },
            ImportBrokerageLegInput {
                id: format!("{id}-target"),
                kind: "SECURITY".into(),
                signed_amount: 0.0,
                currency: "JPY".into(),
                instrument_code: Some("TM".into()),
                instrument_name: Some("Toyota ADR successor".into()),
                signed_quantity: Some(1.0),
                description: "Target shares".into(),
            },
        ];
        merger
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
    fn imports_a_zero_value_split_with_explicit_ratio() {
        let connection = connection();
        let mut split = event("split", 2, "SPLIT");
        split.quantity = None;
        split.unit_price = None;
        split.gross_amount = 0.0;
        split.fee_amount = 0.0;
        split.settlement_amount = 0.0;
        split.corporate_action_ratio = Some(2.0);
        split.legs = vec![
            ImportBrokerageLegInput {
                id: "split-old".into(),
                kind: "SECURITY".into(),
                signed_amount: 0.0,
                currency: "JPY".into(),
                instrument_code: Some("7203".into()),
                instrument_name: Some("Toyota".into()),
                signed_quantity: Some(-1.0),
                description: "Old units".into(),
            },
            ImportBrokerageLegInput {
                id: "split-new".into(),
                kind: "SECURITY".into(),
                signed_amount: 0.0,
                currency: "JPY".into(),
                instrument_code: Some("7203".into()),
                instrument_name: Some("Toyota".into()),
                signed_quantity: Some(2.0),
                description: "New units".into(),
            },
        ];
        import_events(
            &connection,
            &ImportBrokerageEventsInput {
                household_id: "home".into(),
                account_id: "broker".into(),
                source_document_id: "doc".into(),
                events: vec![split],
            },
        )
        .unwrap();
        let history = query_history(
            &connection,
            &BrokerageHistoryRequest {
                household_id: "home".into(),
                account_id: None,
                date_from: None,
                date_to: None,
            },
        )
        .unwrap();
        assert_eq!(history.events[0].event_type, "SPLIT");
        assert_eq!(history.events[0].corporate_action_ratio, Some(2.0));
        assert_eq!(history.totals_by_currency[0].net_cash_movement, 0.0);
    }

    #[test]
    fn validates_and_persists_all_stock_and_mixed_currency_mergers() {
        let connection = connection();
        let all_stock = merger("all-stock", 2);
        assert!(validate_event(&all_stock));

        let mut mixed = merger("mixed", 3);
        mixed.merger_cash_amount = Some(25.0);
        mixed.merger_cash_currency = Some("EUR".into());
        mixed.merger_stock_cost_basis_ratio = Some(0.75);
        mixed.source_to_cash_fx_rate = Some(0.9);
        mixed.legs.extend([
            ImportBrokerageLegInput {
                id: "mixed-cash".into(),
                kind: "CASH".into(),
                signed_amount: 25.0,
                currency: "EUR".into(),
                instrument_code: None,
                instrument_name: None,
                signed_quantity: None,
                description: "Cash consideration".into(),
            },
            ImportBrokerageLegInput {
                id: "mixed-cash-offset".into(),
                kind: "ADJUSTMENT".into(),
                signed_amount: -25.0,
                currency: "EUR".into(),
                instrument_code: None,
                instrument_name: None,
                signed_quantity: None,
                description: "Merger consideration offset".into(),
            },
        ]);
        assert!(validate_event(&mixed));

        import_events(
            &connection,
            &ImportBrokerageEventsInput {
                household_id: "home".into(),
                account_id: "broker".into(),
                source_document_id: "doc".into(),
                events: vec![all_stock, mixed],
            },
        )
        .unwrap();
        let history = query_history(
            &connection,
            &BrokerageHistoryRequest {
                household_id: "home".into(),
                account_id: None,
                date_from: None,
                date_to: None,
            },
        )
        .unwrap();
        let persisted = history
            .events
            .iter()
            .find(|event| event.id == "mixed")
            .unwrap();
        assert_eq!(persisted.merger_cash_amount, Some(25.0));
        assert_eq!(persisted.merger_cash_currency.as_deref(), Some("EUR"));
        assert_eq!(persisted.merger_stock_cost_basis_ratio, Some(0.75));
        assert_eq!(persisted.source_to_target_fx_rate, Some(150.0));
        assert_eq!(persisted.source_to_cash_fx_rate, Some(0.9));
        let eur = history
            .totals_by_currency
            .iter()
            .find(|total| total.currency == "EUR")
            .unwrap();
        let usd = history
            .totals_by_currency
            .iter()
            .find(|total| total.currency == "USD")
            .unwrap();
        assert_eq!(eur.net_cash_movement, 25.0);
        assert_eq!(usd.net_cash_movement, 0.0);
    }

    #[test]
    fn rejects_incomplete_or_non_merger_allocation_terms() {
        let mut candidate = merger("invalid", 2);
        candidate.source_to_target_fx_rate = None;
        assert!(!validate_event(&candidate));
        candidate.source_to_target_fx_rate = Some(f64::INFINITY);
        assert!(!validate_event(&candidate));
        candidate.source_to_target_fx_rate = Some(150.0);
        candidate.merger_cash_amount = Some(25.0);
        assert!(!validate_event(&candidate));
        candidate.merger_cash_currency = Some("USD".into());
        candidate.merger_stock_cost_basis_ratio = Some(1.0);
        assert!(!validate_event(&candidate));

        let mut same_currency = merger("same-currency", 3);
        same_currency.target_currency = Some("USD".into());
        same_currency.legs[1].currency = "USD".into();
        same_currency.source_to_target_fx_rate = None;
        assert!(validate_event(&same_currency));
        same_currency.source_to_target_fx_rate = Some(1.0);
        assert!(!validate_event(&same_currency));

        let mut buy = event("buy-with-merger-terms", 4, "BUY");
        buy.merger_stock_cost_basis_ratio = Some(1.0);
        assert!(!validate_event(&buy));
    }

    #[test]
    fn complex_actions_require_explicit_allocation_inputs() {
        let mut spin = event("spin", 2, "SPIN_OFF");
        spin.quantity = None;
        spin.unit_price = None;
        spin.gross_amount = 0.0;
        spin.fee_amount = 0.0;
        spin.settlement_amount = 0.0;
        spin.corporate_action_ratio = Some(0.25);
        spin.target_instrument_code = Some("CHILD".into());
        spin.target_instrument_name = Some("Child".into());
        spin.target_currency = Some("JPY".into());
        spin.cost_basis_allocation_ratio = Some(0.2);
        spin.legs = vec![
            ImportBrokerageLegInput {
                id: "spin-old".into(),
                kind: "SECURITY".into(),
                signed_amount: 0.0,
                currency: "JPY".into(),
                instrument_code: Some("7203".into()),
                instrument_name: Some("Toyota".into()),
                signed_quantity: Some(-1.0),
                description: "Parent units".into(),
            },
            ImportBrokerageLegInput {
                id: "spin-new".into(),
                kind: "SECURITY".into(),
                signed_amount: 0.0,
                currency: "JPY".into(),
                instrument_code: Some("CHILD".into()),
                instrument_name: Some("Child".into()),
                signed_quantity: Some(0.25),
                description: "Child units".into(),
            },
        ];
        assert!(validate_event(&spin));
        let mut missing = spin.clone();
        missing.cost_basis_allocation_ratio = None;
        assert!(!validate_event(&missing));

        let mut rights = event("rights", 3, "RIGHTS_SUBSCRIPTION");
        rights.corporate_action_ratio = Some(0.1);
        rights.subscription_amount = Some(5_000.0);
        rights.gross_amount = 5_000.0;
        rights.settlement_amount = 5_000.0;
        rights.fee_amount = 0.0;
        rights.legs = vec![
            ImportBrokerageLegInput {
                id: "rights-security".into(),
                kind: "SECURITY".into(),
                signed_amount: 5_000.0,
                currency: "JPY".into(),
                instrument_code: Some("7203".into()),
                instrument_name: Some("Toyota".into()),
                signed_quantity: Some(0.1),
                description: "Subscribed units".into(),
            },
            ImportBrokerageLegInput {
                id: "rights-cash".into(),
                kind: "CASH".into(),
                signed_amount: -5_000.0,
                currency: "JPY".into(),
                instrument_code: None,
                instrument_name: None,
                signed_quantity: None,
                description: "Subscription cash".into(),
            },
        ];
        assert!(validate_event(&rights));

        let mut cash = event("cash", 4, "CASH_IN_LIEU");
        cash.quantity = None;
        cash.unit_price = None;
        cash.fee_amount = 0.0;
        cash.gross_amount = 900.0;
        cash.settlement_amount = 900.0;
        cash.cash_in_lieu_amount = Some(900.0);
        cash.cash_in_lieu_quantity = Some(0.5);
        cash.legs = vec![
            ImportBrokerageLegInput {
                id: "cash-security".into(),
                kind: "SECURITY".into(),
                signed_amount: -900.0,
                currency: "JPY".into(),
                instrument_code: Some("7203".into()),
                instrument_name: Some("Toyota".into()),
                signed_quantity: Some(-0.5),
                description: "Fraction disposed".into(),
            },
            ImportBrokerageLegInput {
                id: "cash-cash".into(),
                kind: "CASH".into(),
                signed_amount: 900.0,
                currency: "JPY".into(),
                instrument_code: None,
                instrument_name: None,
                signed_quantity: None,
                description: "Cash proceeds".into(),
            },
        ];
        assert!(validate_event(&cash));
        cash.cash_in_lieu_quantity = None;
        assert!(!validate_event(&cash));
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
