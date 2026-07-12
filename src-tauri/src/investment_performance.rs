//! Source-auditable investment performance derived from brokerage events.
//!
//! KakeFlow uses FIFO (first-in, first-out) consistently. Acquisition fees and
//! taxes are capitalized into lot cost; disposal fees and taxes reduce proceeds.
//! Every amount remains in its event currency. The engine never invents an FX
//! rate or combines unlike currencies.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use thiserror::Error;

const EPSILON: f64 = 0.000_001;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InvestmentPerformanceError {
    #[error("investment performance request is invalid")]
    Invalid,
    #[error("the investment account is outside the household")]
    Scope,
    #[error("investment performance could not be calculated")]
    Database,
}

impl InvestmentPerformanceError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::Invalid => "Investment performance request is invalid",
            Self::Scope => "Investment account was not found",
            Self::Database => "Investment performance is unavailable",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvestmentHoldingsRequest {
    pub household_id: String,
    pub account_id: Option<String>,
    pub as_of: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvestmentPerformanceRequest {
    pub household_id: String,
    pub account_id: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentHoldingsDto {
    pub as_of: String,
    pub cost_basis_method: &'static str,
    pub positions: Vec<InvestmentPositionDto>,
    pub open_lots: Vec<InvestmentLotDto>,
    pub realized_allocations: Vec<RealizedAllocationDto>,
    pub uncovered_sales: Vec<UncoveredSaleDto>,
    pub skipped_event_ids: Vec<String>,
    pub corporate_action_event_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentPositionDto {
    pub account_id: String,
    pub account_name: String,
    pub instrument_code: String,
    pub instrument_name: String,
    pub currency: String,
    pub quantity: f64,
    pub cost_basis: f64,
    pub average_cost: f64,
    pub open_lot_count: i64,
    pub source_buy_event_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentLotDto {
    pub buy_event_id: String,
    pub account_id: String,
    pub instrument_code: String,
    pub instrument_name: String,
    pub currency: String,
    pub acquired_on: String,
    pub original_quantity: f64,
    pub remaining_quantity: f64,
    pub unit_cost: f64,
    pub remaining_cost_basis: f64,
    pub source_document_id: String,
    pub source_row: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealizedAllocationDto {
    pub sell_event_id: String,
    pub buy_event_id: String,
    pub account_id: String,
    pub instrument_code: String,
    pub instrument_name: String,
    pub currency: String,
    pub sold_on: String,
    pub acquired_on: String,
    pub quantity: f64,
    pub allocated_cost_basis: f64,
    pub allocated_net_proceeds: f64,
    pub realized_pnl: f64,
    pub buy_source_document_id: String,
    pub buy_source_row: i64,
    pub sell_source_document_id: String,
    pub sell_source_row: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UncoveredSaleDto {
    pub sell_event_id: String,
    pub account_id: String,
    pub instrument_code: String,
    pub instrument_name: String,
    pub currency: String,
    pub sold_on: String,
    pub uncovered_quantity: f64,
    pub source_document_id: String,
    pub source_row: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentPerformanceDto {
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub cost_basis_method: &'static str,
    pub totals_by_currency: Vec<InvestmentPeriodCurrencyDto>,
    pub realized_allocations: Vec<RealizedAllocationDto>,
    pub uncovered_sales: Vec<UncoveredSaleDto>,
    pub skipped_event_ids: Vec<String>,
    pub corporate_action_event_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentPeriodCurrencyDto {
    pub currency: String,
    pub buy_gross: f64,
    pub sell_gross: f64,
    pub realized_pnl: f64,
    pub dividend_gross: f64,
    pub fees: f64,
    pub taxes: f64,
}

#[derive(Debug, Clone)]
struct TradeEvent {
    id: String,
    account_id: String,
    account_name: String,
    source_document_id: String,
    source_row: i64,
    event_type: String,
    event_date: String,
    instrument_code: String,
    instrument_name: String,
    currency: String,
    quantity: Option<f64>,
    gross_amount: f64,
    fee_amount: f64,
    tax_amount: f64,
    corporate_action_ratio: Option<f64>,
    target_instrument_code: Option<String>,
    target_instrument_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct InstrumentKey {
    account_id: String,
    currency: String,
    identity: String,
}

#[derive(Debug, Clone)]
struct LotState {
    event_id: String,
    account_id: String,
    instrument_code: String,
    instrument_name: String,
    currency: String,
    acquired_on: String,
    original_quantity: f64,
    remaining_quantity: f64,
    unit_cost: f64,
    source_document_id: String,
    source_row: i64,
}

#[derive(Debug, Default)]
struct Analysis {
    open_lots: BTreeMap<InstrumentKey, VecDeque<LotState>>,
    allocations: Vec<RealizedAllocationDto>,
    uncovered_sales: Vec<UncoveredSaleDto>,
    skipped_event_ids: Vec<String>,
    corporate_action_event_ids: Vec<String>,
}

pub fn query_holdings(
    connection: &Connection,
    request: &InvestmentHoldingsRequest,
) -> Result<InvestmentHoldingsDto, InvestmentPerformanceError> {
    validate_holdings_request(request)?;
    validate_scope(
        connection,
        &request.household_id,
        request.account_id.as_deref(),
    )?;
    let events = read_events(
        connection,
        &request.household_id,
        request.account_id.as_deref(),
        Some(&request.as_of),
    )?;
    let analysis = analyze(&events);
    let positions = build_positions(&analysis.open_lots, &events);
    let open_lots = analysis
        .open_lots
        .into_values()
        .flatten()
        .filter(|lot| lot.remaining_quantity > EPSILON)
        .map(lot_dto)
        .collect();
    Ok(InvestmentHoldingsDto {
        as_of: request.as_of.clone(),
        cost_basis_method: "FIFO",
        positions,
        open_lots,
        realized_allocations: analysis.allocations,
        uncovered_sales: analysis.uncovered_sales,
        skipped_event_ids: analysis.skipped_event_ids,
        corporate_action_event_ids: analysis.corporate_action_event_ids,
    })
}

pub fn query_performance(
    connection: &Connection,
    request: &InvestmentPerformanceRequest,
) -> Result<InvestmentPerformanceDto, InvestmentPerformanceError> {
    validate_performance_request(request)?;
    validate_scope(
        connection,
        &request.household_id,
        request.account_id.as_deref(),
    )?;
    // FIFO requires acquisition history before date_from, so only date_to limits the source scan.
    let events = read_events(
        connection,
        &request.household_id,
        request.account_id.as_deref(),
        request.date_to.as_deref(),
    )?;
    let analysis = analyze(&events);
    let in_period = |date: &str| {
        request.date_from.as_deref().is_none_or(|from| date >= from)
            && request.date_to.as_deref().is_none_or(|to| date <= to)
    };
    let mut totals = BTreeMap::<String, InvestmentPeriodCurrencyDto>::new();
    for event in events.iter().filter(|event| in_period(&event.event_date)) {
        let total =
            totals
                .entry(event.currency.clone())
                .or_insert_with(|| InvestmentPeriodCurrencyDto {
                    currency: event.currency.clone(),
                    ..Default::default()
                });
        match event.event_type.as_str() {
            "BUY" => total.buy_gross += event.gross_amount,
            "SELL" => total.sell_gross += event.gross_amount,
            "DIVIDEND" => total.dividend_gross += event.gross_amount,
            _ => {}
        }
        total.fees += event.fee_amount;
        total.taxes += event.tax_amount;
        if event.event_type == "FEE" && event.fee_amount == 0.0 {
            total.fees += event.gross_amount;
        }
        if event.event_type == "TAX" && event.tax_amount == 0.0 {
            total.taxes += event.gross_amount;
        }
    }
    let allocations = analysis
        .allocations
        .into_iter()
        .filter(|item| in_period(&item.sold_on))
        .collect::<Vec<_>>();
    for allocation in &allocations {
        let total = totals
            .entry(allocation.currency.clone())
            .or_insert_with(|| InvestmentPeriodCurrencyDto {
                currency: allocation.currency.clone(),
                ..Default::default()
            });
        total.realized_pnl += allocation.realized_pnl;
    }
    Ok(InvestmentPerformanceDto {
        date_from: request.date_from.clone(),
        date_to: request.date_to.clone(),
        cost_basis_method: "FIFO",
        totals_by_currency: totals.into_values().collect(),
        realized_allocations: allocations,
        uncovered_sales: analysis
            .uncovered_sales
            .into_iter()
            .filter(|item| in_period(&item.sold_on))
            .collect(),
        skipped_event_ids: analysis.skipped_event_ids,
        corporate_action_event_ids: analysis.corporate_action_event_ids,
    })
}

fn analyze(events: &[TradeEvent]) -> Analysis {
    let mut result = Analysis::default();
    for event in events {
        if matches!(
            event.event_type.as_str(),
            "SPLIT" | "REVERSE_SPLIT" | "MERGER"
        ) {
            apply_corporate_action(&mut result, event);
            continue;
        }
        if !matches!(event.event_type.as_str(), "BUY" | "SELL") {
            continue;
        }
        let Some(quantity) = event
            .quantity
            .filter(|value| value.is_finite() && *value > EPSILON)
        else {
            result.skipped_event_ids.push(event.id.clone());
            continue;
        };
        let key = instrument_key(event);
        if event.event_type == "BUY" {
            let total_cost = event.gross_amount + event.fee_amount + event.tax_amount;
            result
                .open_lots
                .entry(key)
                .or_default()
                .push_back(LotState {
                    event_id: event.id.clone(),
                    account_id: event.account_id.clone(),
                    instrument_code: event.instrument_code.clone(),
                    instrument_name: event.instrument_name.clone(),
                    currency: event.currency.clone(),
                    acquired_on: event.event_date.clone(),
                    original_quantity: quantity,
                    remaining_quantity: quantity,
                    unit_cost: total_cost / quantity,
                    source_document_id: event.source_document_id.clone(),
                    source_row: event.source_row,
                });
            continue;
        }
        let net_proceeds = event.gross_amount - event.fee_amount - event.tax_amount;
        let unit_proceeds = net_proceeds / quantity;
        let mut remaining_sale = quantity;
        let lots = result.open_lots.entry(key).or_default();
        while remaining_sale > EPSILON {
            let Some(lot) = lots.front_mut() else { break };
            let allocated_quantity = remaining_sale.min(lot.remaining_quantity);
            let allocated_cost_basis = allocated_quantity * lot.unit_cost;
            let allocated_net_proceeds = allocated_quantity * unit_proceeds;
            result.allocations.push(RealizedAllocationDto {
                sell_event_id: event.id.clone(),
                buy_event_id: lot.event_id.clone(),
                account_id: event.account_id.clone(),
                instrument_code: event.instrument_code.clone(),
                instrument_name: event.instrument_name.clone(),
                currency: event.currency.clone(),
                sold_on: event.event_date.clone(),
                acquired_on: lot.acquired_on.clone(),
                quantity: allocated_quantity,
                allocated_cost_basis,
                allocated_net_proceeds,
                realized_pnl: allocated_net_proceeds - allocated_cost_basis,
                buy_source_document_id: lot.source_document_id.clone(),
                buy_source_row: lot.source_row,
                sell_source_document_id: event.source_document_id.clone(),
                sell_source_row: event.source_row,
            });
            lot.remaining_quantity -= allocated_quantity;
            remaining_sale -= allocated_quantity;
            if lot.remaining_quantity <= EPSILON {
                lots.pop_front();
            }
        }
        if remaining_sale > EPSILON {
            result.uncovered_sales.push(UncoveredSaleDto {
                sell_event_id: event.id.clone(),
                account_id: event.account_id.clone(),
                instrument_code: event.instrument_code.clone(),
                instrument_name: event.instrument_name.clone(),
                currency: event.currency.clone(),
                sold_on: event.event_date.clone(),
                uncovered_quantity: remaining_sale,
                source_document_id: event.source_document_id.clone(),
                source_row: event.source_row,
            });
        }
    }
    result
}

fn apply_corporate_action(result: &mut Analysis, event: &TradeEvent) {
    let Some(ratio) = event
        .corporate_action_ratio
        .filter(|ratio| ratio.is_finite() && *ratio > EPSILON)
    else {
        result.skipped_event_ids.push(event.id.clone());
        return;
    };
    let old_key = instrument_key(event);
    let Some(mut lots) = result.open_lots.remove(&old_key) else {
        result.skipped_event_ids.push(event.id.clone());
        return;
    };
    let is_merger = event.event_type == "MERGER";
    let target_code = if is_merger {
        event.target_instrument_code.as_deref().unwrap_or("")
    } else {
        &event.instrument_code
    };
    let target_name = if is_merger {
        event.target_instrument_name.as_deref().unwrap_or("")
    } else {
        &event.instrument_name
    };
    let identity = if target_code.trim().is_empty() {
        format!("NAME:{}", target_name.trim().to_uppercase())
    } else {
        format!("CODE:{}", target_code.trim().to_uppercase())
    };
    let target_key = InstrumentKey {
        account_id: event.account_id.clone(),
        currency: event.currency.clone(),
        identity,
    };
    for lot in &mut lots {
        lot.original_quantity *= ratio;
        lot.remaining_quantity *= ratio;
        lot.unit_cost /= ratio;
        lot.instrument_code = target_code.to_owned();
        lot.instrument_name = target_name.to_owned();
    }
    let target = result.open_lots.entry(target_key).or_default();
    target.append(&mut lots);
    let mut ordered = target.drain(..).collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        (&left.acquired_on, left.source_row, &left.event_id).cmp(&(
            &right.acquired_on,
            right.source_row,
            &right.event_id,
        ))
    });
    target.extend(ordered);
    result.corporate_action_event_ids.push(event.id.clone());
}

fn build_positions(
    lots: &BTreeMap<InstrumentKey, VecDeque<LotState>>,
    events: &[TradeEvent],
) -> Vec<InvestmentPositionDto> {
    let account_names = events
        .iter()
        .map(|event| (event.account_id.as_str(), event.account_name.as_str()))
        .collect::<BTreeMap<_, _>>();
    lots.values()
        .filter_map(|queue| {
            let first = queue.front()?;
            let quantity = queue.iter().map(|lot| lot.remaining_quantity).sum::<f64>();
            if quantity <= EPSILON {
                return None;
            }
            let cost_basis = queue
                .iter()
                .map(|lot| lot.remaining_quantity * lot.unit_cost)
                .sum::<f64>();
            Some(InvestmentPositionDto {
                account_id: first.account_id.clone(),
                account_name: account_names
                    .get(first.account_id.as_str())
                    .copied()
                    .unwrap_or("")
                    .to_owned(),
                instrument_code: first.instrument_code.clone(),
                instrument_name: first.instrument_name.clone(),
                currency: first.currency.clone(),
                quantity,
                cost_basis,
                average_cost: cost_basis / quantity,
                open_lot_count: queue.len() as i64,
                source_buy_event_ids: queue.iter().map(|lot| lot.event_id.clone()).collect(),
            })
        })
        .collect()
}

fn lot_dto(lot: LotState) -> InvestmentLotDto {
    InvestmentLotDto {
        buy_event_id: lot.event_id,
        account_id: lot.account_id,
        instrument_code: lot.instrument_code,
        instrument_name: lot.instrument_name,
        currency: lot.currency,
        acquired_on: lot.acquired_on,
        original_quantity: lot.original_quantity,
        remaining_quantity: lot.remaining_quantity,
        unit_cost: lot.unit_cost,
        remaining_cost_basis: lot.remaining_quantity * lot.unit_cost,
        source_document_id: lot.source_document_id,
        source_row: lot.source_row,
    }
}

fn instrument_key(event: &TradeEvent) -> InstrumentKey {
    let identity = if event.instrument_code.trim().is_empty() {
        format!("NAME:{}", event.instrument_name.trim().to_uppercase())
    } else {
        format!("CODE:{}", event.instrument_code.trim().to_uppercase())
    };
    InstrumentKey {
        account_id: event.account_id.clone(),
        currency: event.currency.clone(),
        identity,
    }
}

fn read_events(
    connection: &Connection,
    household_id: &str,
    account_id: Option<&str>,
    through: Option<&str>,
) -> Result<Vec<TradeEvent>, InvestmentPerformanceError> {
    let mut statement = connection.prepare(
        "SELECT event_id, account_id, account_name, source_document_id, source_row, event_type, event_date, instrument_code, instrument_name, currency, quantity, gross_amount, fee_amount, tax_amount, corporate_action_ratio, target_instrument_code, target_instrument_name
         FROM investment_trade_events_v1
         WHERE household_id = ?1 AND (?2 IS NULL OR account_id = ?2) AND (?3 IS NULL OR event_date <= ?3)
         ORDER BY event_date, source_row, event_id"
    ).map_err(db_error)?;
    let rows = statement
        .query_map(params![household_id, account_id, through], |row| {
            Ok(TradeEvent {
                id: row.get(0)?,
                account_id: row.get(1)?,
                account_name: row.get(2)?,
                source_document_id: row.get(3)?,
                source_row: row.get(4)?,
                event_type: row.get(5)?,
                event_date: row.get(6)?,
                instrument_code: row.get(7)?,
                instrument_name: row.get(8)?,
                currency: row.get(9)?,
                quantity: row.get(10)?,
                gross_amount: row.get(11)?,
                fee_amount: row.get(12)?,
                tax_amount: row.get(13)?,
                corporate_action_ratio: row.get(14)?,
                target_instrument_code: row.get(15)?,
                target_instrument_name: row.get(16)?,
            })
        })
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

fn validate_scope(
    connection: &Connection,
    household_id: &str,
    account_id: Option<&str>,
) -> Result<(), InvestmentPerformanceError> {
    if let Some(account_id) = account_id {
        let valid: Option<i64> = connection.query_row(
            "SELECT 1 FROM accounts WHERE id = ?1 AND household_id = ?2 AND account_subtype = 'SECURITIES'",
            params![account_id, household_id], |row| row.get(0),
        ).optional().map_err(db_error)?;
        if valid.is_none() {
            return Err(InvestmentPerformanceError::Scope);
        }
    }
    Ok(())
}

fn validate_holdings_request(
    request: &InvestmentHoldingsRequest,
) -> Result<(), InvestmentPerformanceError> {
    if request.household_id.trim().is_empty() || !valid_date(&request.as_of) {
        Err(InvestmentPerformanceError::Invalid)
    } else {
        Ok(())
    }
}

fn validate_performance_request(
    request: &InvestmentPerformanceRequest,
) -> Result<(), InvestmentPerformanceError> {
    if request.household_id.trim().is_empty()
        || request
            .date_from
            .as_deref()
            .is_some_and(|date| !valid_date(date))
        || request
            .date_to
            .as_deref()
            .is_some_and(|date| !valid_date(date))
        || request
            .date_from
            .as_ref()
            .zip(request.date_to.as_ref())
            .is_some_and(|(from, to)| from > to)
    {
        Err(InvestmentPerformanceError::Invalid)
    } else {
        Ok(())
    }
}

fn valid_date(date: &str) -> bool {
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

fn db_error(_: rusqlite::Error) -> InvestmentPerformanceError {
    InvestmentPerformanceError::Database
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
        ] {
            connection.execute_batch(migration).unwrap();
        }
        connection
            .execute("INSERT INTO households(id,name) VALUES('home','Home')", [])
            .unwrap();
        connection.execute("INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES('broker','home','Broker','ASSET','SECURITIES')", []).unwrap();
        connection
            .execute(
                "INSERT INTO import_runs(id,household_id,status) VALUES('run','home','POSTED')",
                [],
            )
            .unwrap();
        for index in 1..=4 {
            connection.execute("INSERT INTO source_documents(id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path) VALUES(?1,'home','run','MANUAL_UPLOAD',?2,'text/csv',1,?3,?4)", params![format!("doc{index}"), format!("{index}.csv"), format!("{index:064}"), format!("{index}.enc")]).unwrap();
        }
        connection
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_event(
        connection: &Connection,
        id: &str,
        doc: &str,
        row: i64,
        event_type: &str,
        date: &str,
        currency: &str,
        quantity: Option<f64>,
        gross: f64,
        fee: f64,
        tax: f64,
    ) {
        connection.execute(
            "INSERT INTO brokerage_events(id,household_id,account_id,source_document_id,source_row,event_type,trade_date,instrument_code,instrument_name,brokerage_account_type,currency,quantity,unit_price,gross_amount,fee_amount,tax_amount,settlement_amount,reconciliation_status,reconciliation_difference,raw_transaction_type) VALUES(?1,'home','broker',?2,?3,?4,?5,'ABC','Acme','TAXABLE',?6,?7,NULL,?8,?9,?10,?8,'BALANCED',0,?4)",
            params![id, doc, row, event_type, date, currency, quantity, gross, fee, tax],
        ).unwrap();
    }

    #[test]
    fn fifo_allocates_oldest_lots_and_capitalizes_trading_costs() {
        let connection = connection();
        insert_event(
            &connection,
            "buy-1",
            "doc1",
            1,
            "BUY",
            "2026-01-01",
            "JPY",
            Some(10.0),
            1000.0,
            10.0,
            0.0,
        );
        insert_event(
            &connection,
            "buy-2",
            "doc2",
            2,
            "BUY",
            "2026-02-01",
            "JPY",
            Some(10.0),
            2000.0,
            0.0,
            0.0,
        );
        insert_event(
            &connection,
            "sell",
            "doc3",
            3,
            "SELL",
            "2026-03-01",
            "JPY",
            Some(15.0),
            3000.0,
            15.0,
            0.0,
        );
        let result = query_holdings(
            &connection,
            &InvestmentHoldingsRequest {
                household_id: "home".into(),
                account_id: None,
                as_of: "2026-12-31".into(),
            },
        )
        .unwrap();
        assert_eq!(result.cost_basis_method, "FIFO");
        assert_eq!(result.realized_allocations.len(), 2);
        assert!((result.realized_allocations[0].realized_pnl - 980.0).abs() < EPSILON);
        assert!((result.realized_allocations[1].realized_pnl + 5.0).abs() < EPSILON);
        assert_eq!(result.positions.len(), 1);
        assert!((result.positions[0].quantity - 5.0).abs() < EPSILON);
        assert!((result.positions[0].cost_basis - 1000.0).abs() < EPSILON);
        assert_eq!(result.open_lots[0].buy_event_id, "buy-2");
    }

    #[test]
    fn split_and_merger_preserve_fifo_cost_without_realized_gain() {
        let connection = connection();
        insert_event(
            &connection,
            "buy-1",
            "doc1",
            1,
            "BUY",
            "2026-01-01",
            "JPY",
            Some(10.0),
            1000.0,
            0.0,
            0.0,
        );
        connection.execute(
            "INSERT INTO brokerage_events(id,household_id,account_id,source_document_id,source_row,event_type,trade_date,instrument_code,instrument_name,brokerage_account_type,currency,quantity,unit_price,gross_amount,fee_amount,tax_amount,settlement_amount,reconciliation_status,reconciliation_difference,raw_transaction_type,corporate_action_ratio) VALUES('split','home','broker','doc2',2,'SPLIT','2026-02-01','ABC','Acme','TAXABLE','JPY',NULL,NULL,0,0,0,0,'BALANCED',0,'株式分割',2)", [],
        ).unwrap();
        connection.execute(
            "INSERT INTO brokerage_events(id,household_id,account_id,source_document_id,source_row,event_type,trade_date,instrument_code,instrument_name,brokerage_account_type,currency,quantity,unit_price,gross_amount,fee_amount,tax_amount,settlement_amount,reconciliation_status,reconciliation_difference,raw_transaction_type,corporate_action_ratio,target_instrument_code,target_instrument_name,target_currency) VALUES('merger','home','broker','doc3',3,'MERGER','2026-03-01','ABC','Acme','TAXABLE','JPY',NULL,NULL,0,0,0,0,'BALANCED',0,'合併','0.5','XYZ','Combined','JPY')", [],
        ).unwrap();
        let result = query_holdings(
            &connection,
            &InvestmentHoldingsRequest {
                household_id: "home".into(),
                account_id: None,
                as_of: "2026-12-31".into(),
            },
        )
        .unwrap();
        assert_eq!(result.positions.len(), 1);
        assert_eq!(result.positions[0].instrument_code, "XYZ");
        assert!((result.positions[0].quantity - 10.0).abs() < EPSILON);
        assert!((result.positions[0].cost_basis - 1000.0).abs() < EPSILON);
        assert!((result.positions[0].average_cost - 100.0).abs() < EPSILON);
        assert!(result.realized_allocations.is_empty());
        assert_eq!(result.corporate_action_event_ids, ["split", "merger"]);
    }

    #[test]
    fn period_query_uses_prior_buys_and_never_combines_currencies() {
        let connection = connection();
        insert_event(
            &connection,
            "jpy-buy",
            "doc1",
            1,
            "BUY",
            "2025-01-01",
            "JPY",
            Some(2.0),
            200.0,
            0.0,
            0.0,
        );
        insert_event(
            &connection,
            "jpy-sell",
            "doc2",
            2,
            "SELL",
            "2026-03-01",
            "JPY",
            Some(1.0),
            150.0,
            0.0,
            0.0,
        );
        insert_event(
            &connection,
            "usd-div",
            "doc3",
            3,
            "DIVIDEND",
            "2026-03-02",
            "USD",
            None,
            10.0,
            1.0,
            2.0,
        );
        let result = query_performance(
            &connection,
            &InvestmentPerformanceRequest {
                household_id: "home".into(),
                account_id: None,
                date_from: Some("2026-01-01".into()),
                date_to: Some("2026-12-31".into()),
            },
        )
        .unwrap();
        assert_eq!(result.totals_by_currency.len(), 2);
        let jpy = result
            .totals_by_currency
            .iter()
            .find(|item| item.currency == "JPY")
            .unwrap();
        assert!((jpy.realized_pnl - 50.0).abs() < EPSILON);
        let usd = result
            .totals_by_currency
            .iter()
            .find(|item| item.currency == "USD")
            .unwrap();
        assert_eq!(usd.dividend_gross, 10.0);
        assert_eq!(usd.fees, 1.0);
        assert_eq!(usd.taxes, 2.0);
    }

    #[test]
    fn reports_uncovered_and_unusable_trades_instead_of_inventing_cost_basis() {
        let connection = connection();
        insert_event(
            &connection,
            "bad-buy",
            "doc1",
            1,
            "BUY",
            "2026-01-01",
            "JPY",
            None,
            100.0,
            0.0,
            0.0,
        );
        insert_event(
            &connection,
            "sell",
            "doc2",
            2,
            "SELL",
            "2026-02-01",
            "JPY",
            Some(2.0),
            300.0,
            0.0,
            0.0,
        );
        let result = query_holdings(
            &connection,
            &InvestmentHoldingsRequest {
                household_id: "home".into(),
                account_id: Some("broker".into()),
                as_of: "2026-12-31".into(),
            },
        )
        .unwrap();
        assert_eq!(result.skipped_event_ids, vec!["bad-buy"]);
        assert_eq!(result.uncovered_sales[0].sell_event_id, "sell");
        assert_eq!(result.uncovered_sales[0].uncovered_quantity, 2.0);
        assert!(result.realized_allocations.is_empty());
    }
}
