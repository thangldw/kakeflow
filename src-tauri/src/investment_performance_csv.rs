use crate::investment_performance::{
    self, InvestmentPerformanceDto, InvestmentPerformanceError, InvestmentPerformanceRequest,
};
use crate::investment_performance_xlsx::{unallocated_corporate_action_ids, validate_report};
use serde::Serialize;
use std::path::Path;
use thiserror::Error;

const MAX_CSV_BYTES: usize = 16 * 1024 * 1024;
const MAX_CSV_ROWS: usize = 25_003;

const HEADER: [&str; 36] = [
    "record_type",
    "household_id",
    "account_scope",
    "date_from",
    "date_to",
    "cost_basis_method",
    "currency_policy",
    "event_id",
    "related_event_id",
    "account_id",
    "instrument_code",
    "instrument_name",
    "currency",
    "event_on",
    "related_on",
    "quantity",
    "buy_gross",
    "sell_gross",
    "realized_pnl",
    "realized_pnl_status",
    "dividend_gross",
    "fees",
    "taxes",
    "allocated_cost_basis",
    "allocated_net_proceeds",
    "source_document_id",
    "source_row",
    "related_source_document_id",
    "related_source_row",
    "action_type",
    "target_instrument_code",
    "source_currency",
    "source_cost_basis",
    "conversion_rate",
    "cash_amount",
    "note",
];

const DISCLOSURES: [&str; 3] = [
    "Amounts remain separated by event currency and are not FX-converted.",
    "Uncovered sales, skipped events, and unallocated corporate actions can affect completeness.",
    "This export does not represent current market value, unrealized P&L, allocation, ROI, TWR, IRR, or forecast metrics.",
];

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InvestmentPerformanceCsvError {
    #[error("investment performance CSV input is invalid")]
    Invalid,
    #[error("investment account is outside the household")]
    Scope,
    #[error("investment performance CSV is unavailable")]
    Unavailable,
}

impl InvestmentPerformanceCsvError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::Invalid => "Investment performance CSV data is invalid",
            Self::Scope => "Investment account was not found",
            Self::Unavailable => "Investment performance CSV is temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone)]
pub struct InvestmentPerformanceCsvDocument {
    pub file_name: String,
    pub media_type: &'static str,
    pub row_count: u32,
    pub byte_size: u32,
    utf8_bom_csv: String,
}

impl InvestmentPerformanceCsvDocument {
    pub fn csv(&self) -> &str {
        &self.utf8_bom_csv
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentPerformanceCsvSavedDto {
    pub file_name: String,
    pub row_count: u32,
    pub byte_size: u32,
}

pub fn generate_investment_performance_csv(
    connection: &rusqlite::Connection,
    request: &InvestmentPerformanceRequest,
) -> Result<InvestmentPerformanceCsvDocument, InvestmentPerformanceCsvError> {
    let report = investment_performance::query_performance(connection, request)
        .map_err(map_performance_error)?;
    generate_investment_performance_csv_from_report(request, &report)
}

pub fn generate_investment_performance_csv_from_report(
    request: &InvestmentPerformanceRequest,
    report: &InvestmentPerformanceDto,
) -> Result<InvestmentPerformanceCsvDocument, InvestmentPerformanceCsvError> {
    validate_report(request, report).map_err(|_| InvestmentPerformanceCsvError::Invalid)?;
    let unallocated = unallocated_corporate_action_ids(report);
    let row_count = report.totals_by_currency.len()
        + report.realized_allocations.len()
        + report.corporate_action_allocations.len()
        + report.uncovered_sales.len()
        + report.skipped_event_ids.len()
        + unallocated.len()
        + DISCLOSURES.len();
    if row_count == 0 || row_count > MAX_CSV_ROWS || row_count > u32::MAX as usize {
        return Err(InvestmentPerformanceCsvError::Invalid);
    }

    let mut output = String::from('\u{feff}');
    append_row(&mut output, &HEADER)?;
    for total in &report.totals_by_currency {
        let mut row = base_row("CURRENCY_TOTAL", request, report);
        row[12] = total.currency.clone();
        row[16] = decimal(total.buy_gross);
        row[17] = decimal(total.sell_gross);
        row[18] = decimal(total.realized_pnl);
        row[19] = "AVAILABLE".to_owned();
        row[20] = decimal(total.dividend_gross);
        row[21] = decimal(total.fees);
        row[22] = decimal(total.taxes);
        append_row(&mut output, &row)?;
    }
    for item in &report.realized_allocations {
        let mut row = base_row("REALIZED_ALLOCATION", request, report);
        row[7] = item.sell_event_id.clone();
        row[8] = item.buy_event_id.clone();
        row[9] = item.account_id.clone();
        row[10] = item.instrument_code.clone();
        row[11] = item.instrument_name.clone();
        row[12] = item.currency.clone();
        row[13] = item.sold_on.clone();
        row[14] = item.acquired_on.clone();
        row[15] = decimal(item.quantity);
        row[18] = decimal(item.realized_pnl);
        row[19] = "AVAILABLE".to_owned();
        row[23] = decimal(item.allocated_cost_basis);
        row[24] = decimal(item.allocated_net_proceeds);
        row[25] = item.sell_source_document_id.clone();
        row[26] = item.sell_source_row.to_string();
        row[27] = item.buy_source_document_id.clone();
        row[28] = item.buy_source_row.to_string();
        append_row(&mut output, &row)?;
    }
    for item in &report.corporate_action_allocations {
        let mut row = base_row("CORPORATE_ACTION_ALLOCATION", request, report);
        row[7] = item.action_event_id.clone();
        row[8] = item.source_buy_event_id.clone().unwrap_or_default();
        row[10] = item.from_instrument_code.clone();
        row[12] = item.currency.clone();
        row[13] = item.action_on.clone();
        row[15] = decimal(item.quantity);
        set_optional_number(&mut row, 18, 19, item.realized_pnl);
        row[23] = decimal(item.allocated_cost_basis);
        row[25] = item.action_source_document_id.clone();
        row[26] = item.action_source_row.to_string();
        row[27] = item
            .source_buy_source_document_id
            .clone()
            .unwrap_or_default();
        row[28] = item
            .source_buy_source_row
            .map(|value| value.to_string())
            .unwrap_or_default();
        row[29] = item.action_type.clone();
        row[30] = item.target_instrument_code.clone();
        row[31] = item.source_currency.clone().unwrap_or_default();
        row[32] = item.source_cost_basis.map(decimal).unwrap_or_default();
        row[33] = item.conversion_rate.map(decimal).unwrap_or_default();
        row[34] = decimal(item.cash_amount);
        append_row(&mut output, &row)?;
    }
    for item in &report.uncovered_sales {
        let mut row = base_row("UNCOVERED_SALE", request, report);
        row[7] = item.sell_event_id.clone();
        row[9] = item.account_id.clone();
        row[10] = item.instrument_code.clone();
        row[11] = item.instrument_name.clone();
        row[12] = item.currency.clone();
        row[13] = item.sold_on.clone();
        row[15] = decimal(item.uncovered_quantity);
        row[25] = item.source_document_id.clone();
        row[26] = item.source_row.to_string();
        row[35] = "Sale quantity without covered FIFO cost basis.".to_owned();
        append_row(&mut output, &row)?;
    }
    for event_id in &report.skipped_event_ids {
        let mut row = base_row("SKIPPED_EVENT", request, report);
        row[7] = event_id.clone();
        row[35] = "Event was excluded from the FIFO calculation.".to_owned();
        append_row(&mut output, &row)?;
    }
    for event_id in unallocated {
        let mut row = base_row("UNALLOCATED_CORPORATE_ACTION", request, report);
        row[7] = event_id.to_owned();
        row[35] = "Corporate action has no allocation row.".to_owned();
        append_row(&mut output, &row)?;
    }
    for note in DISCLOSURES {
        let mut row = base_row("DISCLOSURE", request, report);
        row[35] = note.to_owned();
        append_row(&mut output, &row)?;
    }
    if output.len() > MAX_CSV_BYTES || output.len() > u32::MAX as usize {
        return Err(InvestmentPerformanceCsvError::Invalid);
    }
    let year = &request.date_from.as_deref().expect("validated dateFrom")[0..4];
    Ok(InvestmentPerformanceCsvDocument {
        file_name: format!("kakeflow-investment-performance-{year}.csv"),
        media_type: "text/csv;charset=utf-8",
        row_count: row_count as u32,
        byte_size: output.len() as u32,
        utf8_bom_csv: output,
    })
}

pub fn save_investment_performance_csv_document(
    document: &InvestmentPerformanceCsvDocument,
    destination: Option<&Path>,
) -> Result<Option<InvestmentPerformanceCsvSavedDto>, InvestmentPerformanceCsvError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.csv().as_bytes())
        .map_err(|_| InvestmentPerformanceCsvError::Unavailable)?;
    Ok(Some(InvestmentPerformanceCsvSavedDto {
        file_name: document.file_name.clone(),
        row_count: document.row_count,
        byte_size: document.byte_size,
    }))
}

fn base_row(
    record_type: &str,
    request: &InvestmentPerformanceRequest,
    report: &InvestmentPerformanceDto,
) -> Vec<String> {
    let mut row = vec![String::new(); HEADER.len()];
    row[0] = record_type.to_owned();
    row[1] = request.household_id.clone();
    row[2] = request
        .account_id
        .clone()
        .unwrap_or_else(|| "ALL_SECURITIES_ACCOUNTS".to_owned());
    row[3] = report.date_from.clone().unwrap_or_default();
    row[4] = report.date_to.clone().unwrap_or_default();
    row[5] = report.cost_basis_method.to_owned();
    row[6] = "NATIVE_CURRENCIES_SEPARATE_NO_FX".to_owned();
    row
}

fn set_optional_number(
    row: &mut [String],
    value_index: usize,
    status_index: usize,
    value: Option<f64>,
) {
    if let Some(value) = value {
        row[value_index] = decimal(value);
        row[status_index] = "AVAILABLE".to_owned();
    } else {
        row[status_index] = "NOT_PROVIDED".to_owned();
    }
}

fn decimal(value: f64) -> String {
    value.to_string()
}

fn append_row(
    output: &mut String,
    fields: &[impl AsRef<str>],
) -> Result<(), InvestmentPerformanceCsvError> {
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
        if output.len() > MAX_CSV_BYTES {
            return Err(InvestmentPerformanceCsvError::Invalid);
        }
    }
    output.push_str("\r\n");
    if output.len() > MAX_CSV_BYTES {
        return Err(InvestmentPerformanceCsvError::Invalid);
    }
    Ok(())
}

fn map_performance_error(error: InvestmentPerformanceError) -> InvestmentPerformanceCsvError {
    match error {
        InvestmentPerformanceError::Invalid => InvestmentPerformanceCsvError::Invalid,
        InvestmentPerformanceError::Scope => InvestmentPerformanceCsvError::Scope,
        InvestmentPerformanceError::Database => InvestmentPerformanceCsvError::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::investment_performance::{
        CorporateActionAllocationDto, InvestmentPeriodCurrencyDto, RealizedAllocationDto,
        UncoveredSaleDto,
    };
    use tempfile::tempdir;

    fn request() -> InvestmentPerformanceRequest {
        InvestmentPerformanceRequest {
            household_id: "family".to_owned(),
            account_id: Some("brokerage".to_owned()),
            date_from: Some("2026-01-01".to_owned()),
            date_to: Some("2026-12-31".to_owned()),
        }
    }

    fn report() -> InvestmentPerformanceDto {
        InvestmentPerformanceDto {
            date_from: Some("2026-01-01".to_owned()),
            date_to: Some("2026-12-31".to_owned()),
            cost_basis_method: "FIFO",
            totals_by_currency: vec![InvestmentPeriodCurrencyDto {
                currency: "JPY".to_owned(),
                buy_gross: 100_000.0,
                sell_gross: 120_000.0,
                realized_pnl: 18_500.0,
                dividend_gross: 2_000.0,
                fees: 1_000.0,
                taxes: 500.0,
            }],
            realized_allocations: vec![RealizedAllocationDto {
                sell_event_id: "sell-1".to_owned(),
                buy_event_id: "buy-1".to_owned(),
                account_id: "brokerage".to_owned(),
                instrument_code: "7203".to_owned(),
                instrument_name: "トヨタ,\"自動車\"".to_owned(),
                currency: "JPY".to_owned(),
                sold_on: "2026-06-10".to_owned(),
                acquired_on: "2026-01-10".to_owned(),
                quantity: 10.0,
                allocated_cost_basis: 100_000.0,
                allocated_net_proceeds: 118_500.0,
                realized_pnl: 18_500.0,
                buy_source_document_id: "doc-buy".to_owned(),
                buy_source_row: 4,
                sell_source_document_id: "doc-sell".to_owned(),
                sell_source_row: 8,
            }],
            uncovered_sales: vec![UncoveredSaleDto {
                sell_event_id: "sell-uncovered".to_owned(),
                account_id: "brokerage".to_owned(),
                instrument_code: "9984".to_owned(),
                instrument_name: "ソフトバンクグループ".to_owned(),
                currency: "JPY".to_owned(),
                sold_on: "2026-07-01".to_owned(),
                uncovered_quantity: 2.0,
                source_document_id: "doc-uncovered".to_owned(),
                source_row: 12,
            }],
            skipped_event_ids: vec!["fee-unsupported".to_owned()],
            corporate_action_event_ids: vec!["spin-1".to_owned(), "split-unallocated".to_owned()],
            corporate_action_allocations: vec![CorporateActionAllocationDto {
                action_event_id: "spin-1".to_owned(),
                action_type: "SPIN_OFF".to_owned(),
                action_on: "2026-04-01".to_owned(),
                action_source_document_id: "doc-action".to_owned(),
                action_source_row: 20,
                source_buy_event_id: None,
                source_buy_source_document_id: None,
                source_buy_source_row: None,
                from_instrument_code: "7203".to_owned(),
                target_instrument_code: "7203B".to_owned(),
                source_currency: None,
                source_cost_basis: None,
                conversion_rate: None,
                currency: "JPY".to_owned(),
                quantity: 1.0,
                allocated_cost_basis: 0.0,
                cash_amount: 0.0,
                realized_pnl: None,
            }],
        }
    }

    #[test]
    fn annual_csv_contains_all_performance_grains_provenance_and_disclosures() {
        let document =
            generate_investment_performance_csv_from_report(&request(), &report()).unwrap();
        assert_eq!(
            document.file_name,
            "kakeflow-investment-performance-2026.csv"
        );
        assert_eq!(document.media_type, "text/csv;charset=utf-8");
        assert_eq!(document.row_count, 9);
        assert_eq!(document.byte_size as usize, document.csv().len());
        assert!(document.csv().starts_with('\u{feff}'));
        assert_eq!(document.csv().matches("\r\n").count(), 10);
        for value in [
            "CURRENCY_TOTAL",
            "REALIZED_ALLOCATION",
            "CORPORATE_ACTION_ALLOCATION",
            "UNCOVERED_SALE",
            "SKIPPED_EVENT",
            "UNALLOCATED_CORPORATE_ACTION",
            "DISCLOSURE",
            "NATIVE_CURRENCIES_SEPARATE_NO_FX",
            "doc-buy",
            "doc-sell",
            "NOT_PROVIDED",
        ] {
            assert!(document.csv().contains(value), "missing {value}");
        }
        assert!(document.csv().contains("\"トヨタ,\"\"自動車\"\"\""));
        assert!(document.csv().contains("sell-1,buy-1,brokerage,7203"));
    }

    #[test]
    fn annual_csv_cancel_and_save_leave_generated_content_unchanged() {
        let document =
            generate_investment_performance_csv_from_report(&request(), &report()).unwrap();
        assert_eq!(
            save_investment_performance_csv_document(&document, None).unwrap(),
            None
        );
        let directory = tempdir().unwrap();
        let destination = directory.path().join("performance.csv");
        let saved = save_investment_performance_csv_document(&document, Some(&destination))
            .unwrap()
            .unwrap();
        assert_eq!(saved.row_count, 9);
        assert_eq!(
            std::fs::read_to_string(destination).unwrap(),
            document.csv()
        );
    }

    #[test]
    fn annual_csv_reuses_strict_annual_fifo_report_validation() {
        let mut invalid_request = request();
        invalid_request.date_to = Some("2027-12-31".to_owned());
        assert!(
            generate_investment_performance_csv_from_report(&invalid_request, &report()).is_err()
        );
        let mut invalid = report();
        invalid.totals_by_currency[0].realized_pnl = f64::NAN;
        assert!(generate_investment_performance_csv_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.realized_allocations[0].buy_source_row = 0;
        assert!(generate_investment_performance_csv_from_report(&request(), &invalid).is_err());
    }
}
