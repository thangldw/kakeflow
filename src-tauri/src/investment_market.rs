//! Dated, source-auditable market prices and native-currency valuation.
//!
//! A valuation only uses an observation effective on or before its `as_of`
//! date. Missing prices remain explicit and currencies are never combined.

use crate::investment_performance::{self, InvestmentHoldingsRequest};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InvestmentMarketError {
    #[error("investment market-price input is invalid")]
    Invalid,
    #[error("investment market-price source is outside the household")]
    Scope,
    #[error("investment market-price data could not be stored or calculated")]
    Database,
}

impl InvestmentMarketError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::Invalid => "Investment market-price data is invalid",
            Self::Scope => "Investment market-price source was not found",
            Self::Database => "Investment market valuation is unavailable",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportInvestmentMarketPricesInput {
    pub household_id: String,
    pub prices: Vec<ImportInvestmentMarketPriceInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportInvestmentMarketPriceInput {
    pub id: String,
    pub price_date: String,
    pub instrument_code: String,
    pub instrument_name: String,
    pub currency: String,
    pub unit_price: f64,
    pub source_kind: String,
    pub provider: String,
    pub source_document_id: Option<String>,
    pub source_row: Option<i64>,
    pub observed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentMarketPriceImportSummaryDto {
    pub imported_price_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvestmentMarketPricesRequest {
    pub household_id: String,
    pub instrument_code: Option<String>,
    pub currency: Option<String>,
    pub through: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentMarketPriceDto {
    pub id: String,
    pub price_date: String,
    pub instrument_code: String,
    pub instrument_name: String,
    pub currency: String,
    pub unit_price: f64,
    pub source_kind: String,
    pub provider: String,
    pub source_document_id: Option<String>,
    pub source_row: Option<i64>,
    pub observed_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvestmentValuationRequest {
    pub household_id: String,
    pub account_id: Option<String>,
    pub as_of: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentValuedPositionDto {
    pub account_id: String,
    pub account_name: String,
    pub instrument_code: String,
    pub instrument_name: String,
    pub currency: String,
    pub quantity: f64,
    pub cost_basis: f64,
    pub price: Option<InvestmentMarketPriceDto>,
    pub market_value: Option<f64>,
    pub unrealized_pnl: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentValuationCurrencyDto {
    pub currency: String,
    pub market_value: f64,
    pub cost_basis: f64,
    pub unrealized_pnl: f64,
    pub valued_position_count: i64,
    pub missing_price_position_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentValuationDto {
    pub as_of: String,
    pub cost_basis_method: &'static str,
    pub positions: Vec<InvestmentValuedPositionDto>,
    pub totals_by_currency: Vec<InvestmentValuationCurrencyDto>,
    pub missing_price_instrument_codes: Vec<String>,
}

pub fn import_prices(
    connection: &Connection,
    input: &ImportInvestmentMarketPricesInput,
) -> Result<InvestmentMarketPriceImportSummaryDto, InvestmentMarketError> {
    validate_import(input)?;
    let transaction = connection.unchecked_transaction().map_err(db_error)?;
    for price in &input.prices {
        if let Some(document_id) = &price.source_document_id {
            let source_exists = transaction
                .query_row(
                    "SELECT 1 FROM source_documents WHERE id=?1 AND household_id=?2",
                    params![document_id, input.household_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(db_error)?
                .is_some();
            if !source_exists {
                return Err(InvestmentMarketError::Scope);
            }
        }
        transaction.execute(
            "INSERT INTO investment_market_prices(id,household_id,price_date,instrument_code,instrument_name,currency,unit_price,source_kind,provider,source_document_id,source_row,observed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![price.id, input.household_id, price.price_date, price.instrument_code, price.instrument_name, price.currency, price.unit_price, price.source_kind, price.provider, price.source_document_id, price.source_row, price.observed_at],
        ).map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)?;
    Ok(InvestmentMarketPriceImportSummaryDto {
        imported_price_count: input.prices.len() as i64,
    })
}

pub fn query_prices(
    connection: &Connection,
    request: &InvestmentMarketPricesRequest,
) -> Result<Vec<InvestmentMarketPriceDto>, InvestmentMarketError> {
    validate_query(request)?;
    let mut statement = connection.prepare(
        "SELECT id,price_date,instrument_code,instrument_name,currency,unit_price,source_kind,provider,source_document_id,source_row,observed_at FROM (
            SELECT id,price_date,instrument_code,instrument_name,currency,unit_price,source_kind,provider,source_document_id,source_row,observed_at
            FROM investment_market_prices
            WHERE household_id=?1 AND (?2 IS NULL OR instrument_code=?2) AND (?3 IS NULL OR currency=?3) AND (?4 IS NULL OR price_date<=?4)
            UNION ALL
            SELECT 'portfolio:' || position.id,substr(snapshot.as_of,1,10),position.instrument_code,position.instrument_name,position.currency,position.market_price,'PORTFOLIO_SNAPSHOT','assetbalance',snapshot.source_document_id,position.source_row,snapshot.as_of
            FROM position_snapshots position
            JOIN portfolio_snapshots snapshot ON snapshot.id=position.portfolio_snapshot_id
            WHERE snapshot.household_id=?1 AND (?2 IS NULL OR position.instrument_code=?2) AND (?3 IS NULL OR position.currency=?3)
              AND position.market_price IS NOT NULL AND position.market_price>0
              AND (?4 IS NULL OR substr(snapshot.as_of,1,10)<=?4)
        ) ORDER BY price_date DESC,id DESC"
    ).map_err(db_error)?;
    let rows = statement
        .query_map(
            params![
                request.household_id,
                request.instrument_code,
                request.currency,
                request.through
            ],
            map_price,
        )
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

pub fn query_valuation(
    connection: &Connection,
    request: &InvestmentValuationRequest,
) -> Result<InvestmentValuationDto, InvestmentMarketError> {
    if request.household_id.trim().is_empty() || !valid_date(&request.as_of) {
        return Err(InvestmentMarketError::Invalid);
    }
    let holdings = investment_performance::query_holdings(
        connection,
        &InvestmentHoldingsRequest {
            household_id: request.household_id.clone(),
            account_id: request.account_id.clone(),
            as_of: request.as_of.clone(),
        },
    )
    .map_err(|error| match error {
        investment_performance::InvestmentPerformanceError::Invalid => {
            InvestmentMarketError::Invalid
        }
        investment_performance::InvestmentPerformanceError::Scope => InvestmentMarketError::Scope,
        investment_performance::InvestmentPerformanceError::Database => {
            InvestmentMarketError::Database
        }
    })?;

    let mut totals = BTreeMap::<String, InvestmentValuationCurrencyDto>::new();
    let mut missing = Vec::new();
    let mut positions = Vec::with_capacity(holdings.positions.len());
    for position in holdings.positions {
        let price = latest_price(
            connection,
            &request.household_id,
            &position.instrument_code,
            &position.currency,
            &request.as_of,
        )?;
        let (market_value, unrealized_pnl) = price
            .as_ref()
            .map(|price| {
                let value = position.quantity * price.unit_price;
                (Some(value), Some(value - position.cost_basis))
            })
            .unwrap_or((None, None));
        let total = totals.entry(position.currency.clone()).or_insert_with(|| {
            InvestmentValuationCurrencyDto {
                currency: position.currency.clone(),
                ..Default::default()
            }
        });
        if let (Some(value), Some(pnl)) = (market_value, unrealized_pnl) {
            total.market_value += value;
            total.cost_basis += position.cost_basis;
            total.unrealized_pnl += pnl;
            total.valued_position_count += 1;
        } else {
            total.missing_price_position_count += 1;
            missing.push(position.instrument_code.clone());
        }
        positions.push(InvestmentValuedPositionDto {
            account_id: position.account_id,
            account_name: position.account_name,
            instrument_code: position.instrument_code,
            instrument_name: position.instrument_name,
            currency: position.currency,
            quantity: position.quantity,
            cost_basis: position.cost_basis,
            price,
            market_value,
            unrealized_pnl,
        });
    }
    missing.sort();
    missing.dedup();
    Ok(InvestmentValuationDto {
        as_of: request.as_of.clone(),
        cost_basis_method: holdings.cost_basis_method,
        positions,
        totals_by_currency: totals.into_values().collect(),
        missing_price_instrument_codes: missing,
    })
}

fn latest_price(
    connection: &Connection,
    household_id: &str,
    instrument_code: &str,
    currency: &str,
    through: &str,
) -> Result<Option<InvestmentMarketPriceDto>, InvestmentMarketError> {
    if instrument_code.trim().is_empty() {
        return Ok(None);
    }
    connection
        .query_row(
            "SELECT id,price_date,instrument_code,instrument_name,currency,unit_price,source_kind,provider,source_document_id,source_row,observed_at FROM (
                SELECT id,price_date,instrument_code,instrument_name,currency,unit_price,source_kind,provider,source_document_id,source_row,observed_at
                FROM investment_market_prices
                WHERE household_id=?1 AND instrument_code=?2 AND currency=?3 AND price_date<=?4
                UNION ALL
                SELECT 'portfolio:' || position.id,substr(snapshot.as_of,1,10),position.instrument_code,position.instrument_name,position.currency,position.market_price,'PORTFOLIO_SNAPSHOT','assetbalance',snapshot.source_document_id,position.source_row,snapshot.as_of
                FROM position_snapshots position
                JOIN portfolio_snapshots snapshot ON snapshot.id=position.portfolio_snapshot_id
                WHERE snapshot.household_id=?1 AND position.instrument_code=?2 AND position.currency=?3
                  AND position.market_price IS NOT NULL AND position.market_price>0
                  AND substr(snapshot.as_of,1,10)<=?4
            ) ORDER BY price_date DESC,id DESC LIMIT 1",
            params![household_id, instrument_code, currency, through],
            map_price,
        )
        .optional()
        .map_err(db_error)
}

fn map_price(row: &rusqlite::Row<'_>) -> rusqlite::Result<InvestmentMarketPriceDto> {
    Ok(InvestmentMarketPriceDto {
        id: row.get(0)?,
        price_date: row.get(1)?,
        instrument_code: row.get(2)?,
        instrument_name: row.get(3)?,
        currency: row.get(4)?,
        unit_price: row.get(5)?,
        source_kind: row.get(6)?,
        provider: row.get(7)?,
        source_document_id: row.get(8)?,
        source_row: row.get(9)?,
        observed_at: row.get(10)?,
    })
}

fn validate_import(input: &ImportInvestmentMarketPricesInput) -> Result<(), InvestmentMarketError> {
    const SOURCE_KINDS: [&str; 5] = [
        "BROKERAGE_STATEMENT",
        "PORTFOLIO_SNAPSHOT",
        "MANUAL",
        "EXCHANGE_CLOSE",
        "OFFICIAL_REFERENCE",
    ];
    let mut ids = BTreeSet::new();
    if input.household_id.trim().is_empty() || input.prices.is_empty() {
        return Err(InvestmentMarketError::Invalid);
    }
    for price in &input.prices {
        if !ids.insert(price.id.as_str())
            || price.id.trim().is_empty()
            || !valid_date(&price.price_date)
            || price.instrument_code.trim().is_empty()
            || !valid_currency(&price.currency)
            || !price.unit_price.is_finite()
            || price.unit_price <= 0.0
            || !SOURCE_KINDS.contains(&price.source_kind.as_str())
            || price.provider.trim().is_empty()
            || price.observed_at.trim().is_empty()
            || price.source_document_id.is_some() != price.source_row.is_some()
            || price.source_row.is_some_and(|row| row <= 0)
        {
            return Err(InvestmentMarketError::Invalid);
        }
    }
    Ok(())
}

fn validate_query(request: &InvestmentMarketPricesRequest) -> Result<(), InvestmentMarketError> {
    if request.household_id.trim().is_empty()
        || request
            .instrument_code
            .as_deref()
            .is_some_and(|code| code.trim().is_empty())
        || request
            .currency
            .as_deref()
            .is_some_and(|currency| !valid_currency(currency))
        || request
            .through
            .as_deref()
            .is_some_and(|date| !valid_date(date))
    {
        Err(InvestmentMarketError::Invalid)
    } else {
        Ok(())
    }
}

fn valid_currency(value: &str) -> bool {
    value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_uppercase())
}

fn valid_date(value: &str) -> bool {
    if value.len() != 10 || value.as_bytes()[4] != b'-' || value.as_bytes()[7] != b'-' {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        value[0..4].parse::<u32>(),
        value[5..7].parse::<u32>(),
        value[8..10].parse::<u32>(),
    ) else {
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

fn db_error(_: rusqlite::Error) -> InvestmentMarketError {
    InvestmentMarketError::Database
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
            include_str!("../migrations/0010_portfolio_snapshots.sql"),
            include_str!("../migrations/0012_brokerage_events.sql"),
            include_str!("../migrations/0013_investment_performance.sql"),
            include_str!("../migrations/0014_investment_corporate_actions_fx.sql"),
            include_str!("../migrations/0015_investment_market_prices.sql"),
        ] {
            connection.execute_batch(migration).unwrap();
        }
        connection
            .execute(
                "INSERT INTO households(id,name) VALUES('home','Home'),('other','Other')",
                [],
            )
            .unwrap();
        connection.execute("INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES('broker','home','Broker','ASSET','SECURITIES')", []).unwrap();
        connection
            .execute(
                "INSERT INTO import_runs(id,household_id,status) VALUES('run','home','POSTED'),('other-run','other','POSTED')",
                [],
            )
            .unwrap();
        connection.execute("INSERT INTO source_documents(id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path) VALUES('doc','home','run','MANUAL_UPLOAD','prices.csv','text/csv',1,?1,'prices.enc'),('other-doc','other','other-run','MANUAL_UPLOAD','other.csv','text/csv',1,?2,'other.enc')", params!["a".repeat(64), "b".repeat(64)]).unwrap();
        connection
    }

    fn insert_buy(connection: &Connection, id: &str, row: i64, code: &str, currency: &str) {
        connection.execute(
            "INSERT INTO brokerage_events(id,household_id,account_id,source_document_id,source_row,event_type,trade_date,instrument_code,instrument_name,brokerage_account_type,currency,quantity,unit_price,gross_amount,fee_amount,tax_amount,settlement_amount,reconciliation_status,reconciliation_difference,raw_transaction_type) VALUES(?1,'home','broker','doc',?2,'BUY','2026-01-01',?3,?3,'TAXABLE',?4,10,10,100,0,0,100,'BALANCED',0,'BUY')",
            params![id, row, code, currency],
        ).unwrap();
    }

    fn price(
        id: &str,
        date: &str,
        code: &str,
        currency: &str,
        unit_price: f64,
    ) -> ImportInvestmentMarketPriceInput {
        ImportInvestmentMarketPriceInput {
            id: id.into(),
            price_date: date.into(),
            instrument_code: code.into(),
            instrument_name: code.into(),
            currency: currency.into(),
            unit_price,
            source_kind: "OFFICIAL_REFERENCE".into(),
            provider: "Exchange".into(),
            source_document_id: None,
            source_row: None,
            observed_at: format!("{date}T16:00:00Z"),
        }
    }

    #[test]
    fn valuation_uses_latest_price_not_after_as_of_and_exposes_provenance() {
        let connection = connection();
        insert_buy(&connection, "buy", 1, "ABC", "JPY");
        import_prices(
            &connection,
            &ImportInvestmentMarketPricesInput {
                household_id: "home".into(),
                prices: vec![
                    price("old", "2026-06-29", "ABC", "JPY", 12.0),
                    price("effective", "2026-06-30", "ABC", "JPY", 15.0),
                    price("future", "2026-07-01", "ABC", "JPY", 99.0),
                ],
            },
        )
        .unwrap();
        let result = query_valuation(
            &connection,
            &InvestmentValuationRequest {
                household_id: "home".into(),
                account_id: None,
                as_of: "2026-06-30".into(),
            },
        )
        .unwrap();
        assert_eq!(result.positions[0].price.as_ref().unwrap().id, "effective");
        assert_eq!(
            result.positions[0].price.as_ref().unwrap().provider,
            "Exchange"
        );
        assert_eq!(result.positions[0].market_value, Some(150.0));
        assert_eq!(result.positions[0].unrealized_pnl, Some(50.0));
        assert_eq!(result.totals_by_currency[0].market_value, 150.0);
        assert!(result.missing_price_instrument_codes.is_empty());
    }

    #[test]
    fn missing_and_wrong_currency_prices_are_never_invented_or_combined() {
        let connection = connection();
        insert_buy(&connection, "jpy-buy", 1, "ABC", "JPY");
        insert_buy(&connection, "usd-buy", 2, "XYZ", "USD");
        import_prices(
            &connection,
            &ImportInvestmentMarketPricesInput {
                household_id: "home".into(),
                prices: vec![price("wrong-currency", "2026-06-30", "XYZ", "JPY", 1500.0)],
            },
        )
        .unwrap();
        let result = query_valuation(
            &connection,
            &InvestmentValuationRequest {
                household_id: "home".into(),
                account_id: None,
                as_of: "2026-06-30".into(),
            },
        )
        .unwrap();
        assert!(result
            .positions
            .iter()
            .all(|position| position.market_value.is_none()));
        assert_eq!(result.totals_by_currency.len(), 2);
        assert!(result
            .totals_by_currency
            .iter()
            .all(|total| total.missing_price_position_count == 1));
        assert_eq!(result.missing_price_instrument_codes, ["ABC", "XYZ"]);
    }

    #[test]
    fn source_scope_failure_rolls_back_the_whole_batch() {
        let connection = connection();
        let mut valid = price("valid", "2026-06-30", "ABC", "JPY", 15.0);
        valid.source_document_id = Some("doc".into());
        valid.source_row = Some(2);
        let mut invalid = price("invalid", "2026-06-30", "XYZ", "JPY", 20.0);
        invalid.source_document_id = Some("other-doc".into());
        invalid.source_row = Some(3);
        let error = import_prices(
            &connection,
            &ImportInvestmentMarketPricesInput {
                household_id: "home".into(),
                prices: vec![valid, invalid],
            },
        )
        .unwrap_err();
        assert_eq!(error, InvestmentMarketError::Scope);
        let count: i64 = connection
            .query_row("SELECT count(*) FROM investment_market_prices", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn valuation_reuses_latest_assetbalance_position_price_with_provenance() {
        let connection = connection();
        insert_buy(&connection, "buy", 1, "ABC", "JPY");
        connection.execute("INSERT INTO portfolio_snapshots(id,household_id,account_id,source_document_id,as_of,market_value_jpy,cash_value_jpy) VALUES('snapshot','home','broker','doc','2026-06-29T14:30:00+09:00',140,0)", []).unwrap();
        connection.execute("INSERT INTO position_snapshots(id,portfolio_snapshot_id,product_type,account_type,instrument_code,instrument_name,quantity,average_cost,market_price,market_value_jpy,currency,source_row) VALUES('position','snapshot','Stock','TAXABLE','ABC','Acme',10,10,14,140,'JPY',9)", []).unwrap();
        let result = query_valuation(
            &connection,
            &InvestmentValuationRequest {
                household_id: "home".into(),
                account_id: None,
                as_of: "2026-06-30".into(),
            },
        )
        .unwrap();
        let price = result.positions[0].price.as_ref().unwrap();
        assert_eq!(price.id, "portfolio:position");
        assert_eq!(price.price_date, "2026-06-29");
        assert_eq!(price.source_kind, "PORTFOLIO_SNAPSHOT");
        assert_eq!(price.provider, "assetbalance");
        assert_eq!(price.source_document_id.as_deref(), Some("doc"));
        assert_eq!(price.source_row, Some(9));
        assert_eq!(result.positions[0].market_value, Some(140.0));
        let history = query_prices(
            &connection,
            &InvestmentMarketPricesRequest {
                household_id: "home".into(),
                instrument_code: Some("ABC".into()),
                currency: Some("JPY".into()),
                through: Some("2026-06-30".into()),
            },
        )
        .unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "portfolio:position");
    }

    #[test]
    fn rejects_invalid_calendar_dates_and_non_finite_prices() {
        let connection = connection();
        let mut invalid = price("bad", "2026-02-30", "ABC", "JPY", f64::NAN);
        invalid.observed_at = "2026-02-28T16:00:00Z".into();
        assert_eq!(
            import_prices(
                &connection,
                &ImportInvestmentMarketPricesInput {
                    household_id: "home".into(),
                    prices: vec![invalid],
                }
            )
            .unwrap_err(),
            InvestmentMarketError::Invalid
        );
    }
}
