//! Explicit, provenance-preserving FX observations for investment reporting.
//!
//! Native brokerage events are never rewritten. A reporting query first
//! derives native-currency FIFO totals, then converts every bucket with one
//! auditable rate effective on or before `fx_as_of`. The query fails atomically
//! when any required rate is absent.

use crate::investment_performance::{
    self, InvestmentPerformanceRequest, InvestmentPeriodCurrencyDto,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InvestmentFxError {
    #[error("investment FX input is invalid")]
    Invalid,
    #[error("investment FX source is outside the household")]
    Scope,
    #[error("a required investment FX rate is missing")]
    MissingRate,
    #[error("investment FX data could not be stored or calculated")]
    Database,
}

impl InvestmentFxError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::Invalid => "Investment FX data is invalid",
            Self::Scope => "Investment FX source was not found",
            Self::MissingRate => {
                "A required FX rate is missing; native-currency totals were not converted"
            }
            Self::Database => "Investment FX reporting is unavailable",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportInvestmentFxRatesInput {
    pub household_id: String,
    pub rates: Vec<ImportInvestmentFxRateInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportInvestmentFxRateInput {
    pub id: String,
    pub rate_date: String,
    pub base_currency: String,
    pub quote_currency: String,
    pub rate: f64,
    pub source_kind: String,
    pub provider: String,
    pub source_document_id: Option<String>,
    pub source_row: Option<i64>,
    pub observed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentFxImportSummaryDto {
    pub imported_rate_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvestmentFxRatesRequest {
    pub household_id: String,
    pub base_currency: Option<String>,
    pub quote_currency: Option<String>,
    pub through: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentFxRateDto {
    pub id: String,
    pub rate_date: String,
    pub base_currency: String,
    pub quote_currency: String,
    pub rate: f64,
    pub source_kind: String,
    pub provider: String,
    pub source_document_id: Option<String>,
    pub source_row: Option<i64>,
    pub observed_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvestmentReportingRequest {
    pub household_id: String,
    pub account_id: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub reporting_currency: String,
    pub fx_as_of: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertedInvestmentTotalsDto {
    pub currency: String,
    pub buy_gross: f64,
    pub sell_gross: f64,
    pub realized_pnl: f64,
    pub dividend_gross: f64,
    pub fees: f64,
    pub taxes: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentFxConversionDto {
    pub original_currency: String,
    pub reporting_currency: String,
    pub rate: f64,
    pub rate_id: String,
    pub rate_date: String,
    pub inverted: bool,
    pub source_kind: String,
    pub provider: String,
    pub source_document_id: Option<String>,
    pub source_row: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentReportingDto {
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub fx_as_of: String,
    pub original_totals_by_currency: Vec<InvestmentPeriodCurrencyDto>,
    pub converted_totals: ConvertedInvestmentTotalsDto,
    pub conversions: Vec<InvestmentFxConversionDto>,
}

pub fn import_rates(
    connection: &Connection,
    input: &ImportInvestmentFxRatesInput,
) -> Result<InvestmentFxImportSummaryDto, InvestmentFxError> {
    validate_import(input)?;
    let transaction = connection.unchecked_transaction().map_err(db_error)?;
    for item in &input.rates {
        if let Some(document_id) = &item.source_document_id {
            let valid: Option<i64> = transaction
                .query_row(
                    "SELECT 1 FROM source_documents WHERE id=?1 AND household_id=?2",
                    params![document_id, input.household_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(db_error)?;
            if valid.is_none() {
                return Err(InvestmentFxError::Scope);
            }
        }
        transaction.execute(
            "INSERT INTO investment_fx_rates(id,household_id,rate_date,base_currency,quote_currency,rate,source_kind,provider,source_document_id,source_row,observed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![item.id, input.household_id, item.rate_date, item.base_currency, item.quote_currency, item.rate, item.source_kind, item.provider, item.source_document_id, item.source_row, item.observed_at],
        ).map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)?;
    Ok(InvestmentFxImportSummaryDto {
        imported_rate_count: input.rates.len() as i64,
    })
}

pub fn query_rates(
    connection: &Connection,
    request: &InvestmentFxRatesRequest,
) -> Result<Vec<InvestmentFxRateDto>, InvestmentFxError> {
    if request.household_id.trim().is_empty()
        || request
            .base_currency
            .as_deref()
            .is_some_and(|v| !valid_currency(v))
        || request
            .quote_currency
            .as_deref()
            .is_some_and(|v| !valid_currency(v))
        || request.through.as_deref().is_some_and(|v| !valid_date(v))
    {
        return Err(InvestmentFxError::Invalid);
    }
    let mut statement = connection.prepare(
        "SELECT id,rate_date,base_currency,quote_currency,rate,source_kind,provider,source_document_id,source_row,observed_at FROM investment_fx_rates WHERE household_id=?1 AND (?2 IS NULL OR base_currency=?2) AND (?3 IS NULL OR quote_currency=?3) AND (?4 IS NULL OR rate_date<=?4) ORDER BY rate_date DESC,id DESC"
    ).map_err(db_error)?;
    let rows = statement
        .query_map(
            params![
                request.household_id,
                request.base_currency,
                request.quote_currency,
                request.through
            ],
            map_rate,
        )
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

pub fn query_reporting(
    connection: &Connection,
    request: &InvestmentReportingRequest,
) -> Result<InvestmentReportingDto, InvestmentFxError> {
    if request.household_id.trim().is_empty()
        || !valid_currency(&request.reporting_currency)
        || !valid_date(&request.fx_as_of)
        || request.date_from.as_deref().is_some_and(|v| !valid_date(v))
        || request.date_to.as_deref().is_some_and(|v| !valid_date(v))
    {
        return Err(InvestmentFxError::Invalid);
    }
    let native = investment_performance::query_performance(
        connection,
        &InvestmentPerformanceRequest {
            household_id: request.household_id.clone(),
            account_id: request.account_id.clone(),
            date_from: request.date_from.clone(),
            date_to: request.date_to.clone(),
        },
    )
    .map_err(|error| match error {
        investment_performance::InvestmentPerformanceError::Scope => InvestmentFxError::Scope,
        investment_performance::InvestmentPerformanceError::Invalid => InvestmentFxError::Invalid,
        investment_performance::InvestmentPerformanceError::Database => InvestmentFxError::Database,
    })?;
    let mut converted = ConvertedInvestmentTotalsDto {
        currency: request.reporting_currency.clone(),
        ..Default::default()
    };
    let mut conversions = Vec::new();
    for total in &native.totals_by_currency {
        let conversion = resolve_rate(
            connection,
            &request.household_id,
            &total.currency,
            &request.reporting_currency,
            &request.fx_as_of,
        )?;
        converted.buy_gross += total.buy_gross * conversion.rate;
        converted.sell_gross += total.sell_gross * conversion.rate;
        converted.realized_pnl += total.realized_pnl * conversion.rate;
        converted.dividend_gross += total.dividend_gross * conversion.rate;
        converted.fees += total.fees * conversion.rate;
        converted.taxes += total.taxes * conversion.rate;
        conversions.push(conversion);
    }
    Ok(InvestmentReportingDto {
        date_from: request.date_from.clone(),
        date_to: request.date_to.clone(),
        fx_as_of: request.fx_as_of.clone(),
        original_totals_by_currency: native.totals_by_currency,
        converted_totals: converted,
        conversions,
    })
}

fn resolve_rate(
    connection: &Connection,
    household: &str,
    base: &str,
    quote: &str,
    through: &str,
) -> Result<InvestmentFxConversionDto, InvestmentFxError> {
    if base == quote {
        return Ok(InvestmentFxConversionDto {
            original_currency: base.into(),
            reporting_currency: quote.into(),
            rate: 1.0,
            rate_id: "IDENTITY".into(),
            rate_date: through.into(),
            inverted: false,
            source_kind: "IDENTITY".into(),
            provider: "KakeFlow".into(),
            source_document_id: None,
            source_row: None,
        });
    }
    let direct = latest_rate(connection, household, base, quote, through)?;
    if let Some(rate) = direct {
        return Ok(conversion(rate, base, quote, false));
    }
    let inverse = latest_rate(connection, household, quote, base, through)?
        .ok_or(InvestmentFxError::MissingRate)?;
    Ok(conversion(inverse, base, quote, true))
}

fn latest_rate(
    connection: &Connection,
    household: &str,
    base: &str,
    quote: &str,
    through: &str,
) -> Result<Option<InvestmentFxRateDto>, InvestmentFxError> {
    connection.query_row(
        "SELECT id,rate_date,base_currency,quote_currency,rate,source_kind,provider,source_document_id,source_row,observed_at FROM investment_fx_rates WHERE household_id=?1 AND base_currency=?2 AND quote_currency=?3 AND rate_date<=?4 ORDER BY rate_date DESC,id DESC LIMIT 1",
        params![household, base, quote, through], map_rate,
    ).optional().map_err(db_error)
}

fn conversion(
    rate: InvestmentFxRateDto,
    original: &str,
    reporting: &str,
    inverted: bool,
) -> InvestmentFxConversionDto {
    InvestmentFxConversionDto {
        original_currency: original.into(),
        reporting_currency: reporting.into(),
        rate: if inverted { 1.0 / rate.rate } else { rate.rate },
        rate_id: rate.id,
        rate_date: rate.rate_date,
        inverted,
        source_kind: rate.source_kind,
        provider: rate.provider,
        source_document_id: rate.source_document_id,
        source_row: rate.source_row,
    }
}

fn map_rate(row: &rusqlite::Row<'_>) -> rusqlite::Result<InvestmentFxRateDto> {
    Ok(InvestmentFxRateDto {
        id: row.get(0)?,
        rate_date: row.get(1)?,
        base_currency: row.get(2)?,
        quote_currency: row.get(3)?,
        rate: row.get(4)?,
        source_kind: row.get(5)?,
        provider: row.get(6)?,
        source_document_id: row.get(7)?,
        source_row: row.get(8)?,
        observed_at: row.get(9)?,
    })
}

fn validate_import(input: &ImportInvestmentFxRatesInput) -> Result<(), InvestmentFxError> {
    let kinds = [
        "BROKERAGE_STATEMENT",
        "PORTFOLIO_SNAPSHOT",
        "MANUAL",
        "OFFICIAL_REFERENCE",
    ];
    let mut ids = std::collections::BTreeSet::new();
    if input.household_id.trim().is_empty() || input.rates.is_empty() {
        return Err(InvestmentFxError::Invalid);
    }
    for item in &input.rates {
        if !ids.insert(item.id.as_str())
            || item.id.trim().is_empty()
            || !valid_date(&item.rate_date)
            || !valid_currency(&item.base_currency)
            || !valid_currency(&item.quote_currency)
            || item.base_currency == item.quote_currency
            || !item.rate.is_finite()
            || item.rate <= 0.0
            || !kinds.contains(&item.source_kind.as_str())
            || item.provider.trim().is_empty()
            || item.observed_at.trim().is_empty()
            || item.source_document_id.is_some() != item.source_row.is_some()
            || item.source_row.is_some_and(|row| row <= 0)
        {
            return Err(InvestmentFxError::Invalid);
        }
    }
    Ok(())
}

fn valid_currency(value: &str) -> bool {
    value.len() == 3 && value.bytes().all(|b| b.is_ascii_uppercase())
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
    let max = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day > 0 && day <= max
}
fn db_error(_: rusqlite::Error) -> InvestmentFxError {
    InvestmentFxError::Database
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        for migration in [
            include_str!("../migrations/0001_household_accounts.sql"),
            include_str!("../migrations/0002_import_provenance.sql"),
            include_str!("../migrations/0012_brokerage_events.sql"),
            include_str!("../migrations/0013_investment_performance.sql"),
            include_str!("../migrations/0014_investment_corporate_actions_fx.sql"),
        ] {
            c.execute_batch(migration).unwrap();
        }
        c.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])
            .unwrap();
        c.execute("INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES('broker','home','Broker','ASSET','SECURITIES')", []).unwrap();
        c.execute(
            "INSERT INTO import_runs(id,household_id,status) VALUES('run','home','POSTED')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO source_documents(id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path) VALUES('doc','home','run','MANUAL_UPLOAD','fx.csv','text/csv',1,?1,'fx.enc')", ["a".repeat(64)]).unwrap();
        c.execute("INSERT INTO brokerage_events(id,household_id,account_id,source_document_id,source_row,event_type,trade_date,instrument_code,instrument_name,brokerage_account_type,currency,quantity,unit_price,gross_amount,fee_amount,tax_amount,settlement_amount,reconciliation_status,reconciliation_difference,raw_transaction_type) VALUES('buy','home','broker','doc',1,'BUY','2026-01-01','ABC','Acme','TAXABLE','USD',1,10,10,0,0,10,'BALANCED',0,'BUY')", []).unwrap();
        c
    }

    #[test]
    fn reporting_preserves_native_totals_and_exposes_rate_provenance() {
        let c = connection();
        import_rates(
            &c,
            &ImportInvestmentFxRatesInput {
                household_id: "home".into(),
                rates: vec![ImportInvestmentFxRateInput {
                    id: "usd-jpy".into(),
                    rate_date: "2026-12-30".into(),
                    base_currency: "USD".into(),
                    quote_currency: "JPY".into(),
                    rate: 150.0,
                    source_kind: "OFFICIAL_REFERENCE".into(),
                    provider: "BOJ".into(),
                    source_document_id: None,
                    source_row: None,
                    observed_at: "2026-12-30T12:00:00Z".into(),
                }],
            },
        )
        .unwrap();
        let result = query_reporting(
            &c,
            &InvestmentReportingRequest {
                household_id: "home".into(),
                account_id: None,
                date_from: None,
                date_to: None,
                reporting_currency: "JPY".into(),
                fx_as_of: "2026-12-31".into(),
            },
        )
        .unwrap();
        assert_eq!(result.original_totals_by_currency[0].currency, "USD");
        assert_eq!(result.original_totals_by_currency[0].buy_gross, 10.0);
        assert_eq!(result.converted_totals.buy_gross, 1500.0);
        assert_eq!(result.conversions[0].rate_id, "usd-jpy");
        assert_eq!(result.conversions[0].provider, "BOJ");
    }

    #[test]
    fn reporting_refuses_to_invent_a_missing_rate() {
        let c = connection();
        let error = query_reporting(
            &c,
            &InvestmentReportingRequest {
                household_id: "home".into(),
                account_id: None,
                date_from: None,
                date_to: None,
                reporting_currency: "JPY".into(),
                fx_as_of: "2026-12-31".into(),
            },
        )
        .unwrap_err();
        assert_eq!(error, InvestmentFxError::MissingRate);
    }
}
