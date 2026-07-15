use crate::portfolio::{PortfolioError, PortfolioSnapshotDetailDto};
use crate::portfolio_snapshot_xlsx::{validate_snapshot, PortfolioSnapshotXlsxRequest};
use serde::Serialize;
use std::path::Path;
use thiserror::Error;

const MAX_CSV_BYTES: usize = 16 * 1024 * 1024;
const MAX_CSV_ROWS: usize = 25_001;

const HEADER: [&str; 31] = [
    "record_type",
    "snapshot_id",
    "household_id",
    "account_id",
    "account_name",
    "as_of",
    "source_document_id",
    "source_row",
    "record_id",
    "name",
    "product_type",
    "account_type",
    "instrument_code",
    "currency",
    "quantity",
    "quantity_status",
    "average_cost",
    "average_cost_status",
    "market_price",
    "market_price_status",
    "market_value_jpy",
    "market_value_status",
    "cash_value_jpy",
    "unrealized_pnl_jpy",
    "unrealized_pnl_status",
    "realized_pnl_jpy",
    "realized_pnl_status",
    "base_currency",
    "quote_currency",
    "fx_rate",
    "fx_rate_status",
];

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PortfolioSnapshotCsvError {
    #[error("portfolio snapshot CSV input is invalid")]
    Invalid,
    #[error("portfolio snapshot was not found")]
    NotFound,
    #[error("portfolio snapshot CSV is unavailable")]
    Unavailable,
}

impl PortfolioSnapshotCsvError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::Invalid => "Portfolio snapshot CSV data is invalid",
            Self::NotFound => "The requested portfolio snapshot was not found",
            Self::Unavailable => "Portfolio snapshot CSV is temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone)]
pub struct PortfolioSnapshotCsvDocument {
    pub file_name: String,
    pub media_type: &'static str,
    pub row_count: u32,
    pub byte_size: u32,
    utf8_bom_csv: String,
}

impl PortfolioSnapshotCsvDocument {
    pub fn csv(&self) -> &str {
        &self.utf8_bom_csv
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSnapshotCsvSavedDto {
    pub file_name: String,
    pub row_count: u32,
    pub byte_size: u32,
}

pub fn generate_portfolio_snapshot_csv(
    connection: &rusqlite::Connection,
    request: &PortfolioSnapshotXlsxRequest,
) -> Result<PortfolioSnapshotCsvDocument, PortfolioSnapshotCsvError> {
    let snapshot =
        crate::portfolio::get_snapshot(connection, &request.household_id, &request.snapshot_id)
            .map_err(map_portfolio_error)?;
    generate_portfolio_snapshot_csv_from_snapshot(request, &snapshot)
}

pub fn generate_portfolio_snapshot_csv_from_snapshot(
    request: &PortfolioSnapshotXlsxRequest,
    snapshot: &PortfolioSnapshotDetailDto,
) -> Result<PortfolioSnapshotCsvDocument, PortfolioSnapshotCsvError> {
    validate_snapshot(request, snapshot).map_err(|_| PortfolioSnapshotCsvError::Invalid)?;
    let row_count =
        1 + snapshot.asset_classes.len() + snapshot.positions.len() + snapshot.fx_rates.len();
    if row_count > MAX_CSV_ROWS || row_count > u32::MAX as usize {
        return Err(PortfolioSnapshotCsvError::Invalid);
    }

    let mut output = String::from('\u{feff}');
    append_row(&mut output, &HEADER)?;
    append_row(&mut output, &summary_row(request, snapshot))?;
    for item in &snapshot.asset_classes {
        let mut row = base_row("ASSET_CLASS", request, snapshot);
        row[7] = item.source_row.to_string();
        row[8] = item.id.clone();
        row[9] = item.name.clone();
        row[20] = item.market_value_jpy.to_string();
        row[21] = "AVAILABLE".to_owned();
        set_optional_i64(&mut row, 23, 24, item.unrealized_pnl_jpy);
        append_row(&mut output, &row)?;
    }
    for item in &snapshot.positions {
        let mut row = base_row("POSITION", request, snapshot);
        row[7] = item.source_row.to_string();
        row[8] = item.id.clone();
        row[9] = item.instrument_name.clone();
        row[10] = item.product_type.clone();
        row[11] = item.account_type.clone();
        row[12] = item.instrument_code.clone();
        row[13] = item.currency.clone();
        set_optional_f64(&mut row, 14, 15, item.quantity);
        set_optional_f64(&mut row, 16, 17, item.average_cost);
        set_optional_f64(&mut row, 18, 19, item.market_price);
        set_optional_i64(&mut row, 20, 21, item.market_value_jpy);
        set_optional_i64(&mut row, 23, 24, item.unrealized_pnl_jpy);
        set_optional_i64(&mut row, 25, 26, item.realized_pnl_jpy);
        append_row(&mut output, &row)?;
    }
    for item in &snapshot.fx_rates {
        let mut row = base_row("FX_RATE", request, snapshot);
        row[7] = item.source_row.to_string();
        row[8] = item.id.clone();
        row[27] = item.base_currency.clone();
        row[28] = item.quote_currency.clone();
        row[29] = decimal(item.rate);
        row[30] = "AVAILABLE".to_owned();
        append_row(&mut output, &row)?;
    }
    if output.len() > MAX_CSV_BYTES || output.len() > u32::MAX as usize {
        return Err(PortfolioSnapshotCsvError::Invalid);
    }
    Ok(PortfolioSnapshotCsvDocument {
        file_name: format!("kakeflow-portfolio-snapshot-{}.csv", request.snapshot_id),
        media_type: "text/csv;charset=utf-8",
        row_count: row_count as u32,
        byte_size: output.len() as u32,
        utf8_bom_csv: output,
    })
}

pub fn save_portfolio_snapshot_csv_document(
    document: &PortfolioSnapshotCsvDocument,
    destination: Option<&Path>,
) -> Result<Option<PortfolioSnapshotCsvSavedDto>, PortfolioSnapshotCsvError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.csv().as_bytes())
        .map_err(|_| PortfolioSnapshotCsvError::Unavailable)?;
    Ok(Some(PortfolioSnapshotCsvSavedDto {
        file_name: document.file_name.clone(),
        row_count: document.row_count,
        byte_size: document.byte_size,
    }))
}

fn summary_row(
    request: &PortfolioSnapshotXlsxRequest,
    snapshot: &PortfolioSnapshotDetailDto,
) -> Vec<String> {
    let mut row = base_row("SUMMARY", request, snapshot);
    row[8] = snapshot.summary.id.clone();
    row[20] = snapshot.summary.market_value_jpy.to_string();
    row[21] = "AVAILABLE".to_owned();
    row[22] = snapshot.summary.cash_value_jpy.to_string();
    set_optional_i64(&mut row, 23, 24, snapshot.summary.unrealized_pnl_jpy);
    set_optional_i64(&mut row, 25, 26, snapshot.summary.realized_pnl_jpy);
    row
}

fn base_row(
    record_type: &str,
    request: &PortfolioSnapshotXlsxRequest,
    snapshot: &PortfolioSnapshotDetailDto,
) -> Vec<String> {
    let mut row = vec![String::new(); HEADER.len()];
    row[0] = record_type.to_owned();
    row[1] = snapshot.summary.id.clone();
    row[2] = request.household_id.clone();
    row[3] = snapshot.summary.account_id.clone();
    row[4] = snapshot.summary.account_name.clone();
    row[5] = snapshot.summary.as_of.clone();
    row[6] = snapshot.summary.source_document_id.clone();
    row
}

fn set_optional_i64(
    row: &mut [String],
    value_index: usize,
    status_index: usize,
    value: Option<i64>,
) {
    if let Some(value) = value {
        row[value_index] = value.to_string();
        row[status_index] = "AVAILABLE".to_owned();
    } else {
        row[status_index] = "NOT_PROVIDED".to_owned();
    }
}

fn set_optional_f64(
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
) -> Result<(), PortfolioSnapshotCsvError> {
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
            return Err(PortfolioSnapshotCsvError::Invalid);
        }
    }
    output.push_str("\r\n");
    if output.len() > MAX_CSV_BYTES {
        return Err(PortfolioSnapshotCsvError::Invalid);
    }
    Ok(())
}

fn map_portfolio_error(error: PortfolioError) -> PortfolioSnapshotCsvError {
    match error {
        PortfolioError::InvalidInput(_) => PortfolioSnapshotCsvError::Invalid,
        PortfolioError::NotFound => PortfolioSnapshotCsvError::NotFound,
        PortfolioError::Conflict | PortfolioError::Unavailable => {
            PortfolioSnapshotCsvError::Unavailable
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::portfolio::{
        AssetClassDto, FxRateSnapshotDto, PortfolioSnapshotSummaryDto, PositionSnapshotDto,
    };
    use tempfile::tempdir;

    fn request() -> PortfolioSnapshotXlsxRequest {
        PortfolioSnapshotXlsxRequest {
            household_id: "family".to_owned(),
            snapshot_id: "snapshot-20260712".to_owned(),
        }
    }

    fn snapshot() -> PortfolioSnapshotDetailDto {
        PortfolioSnapshotDetailDto {
            summary: PortfolioSnapshotSummaryDto {
                id: "snapshot-20260712".to_owned(),
                account_id: "brokerage".to_owned(),
                account_name: "証券,口座".to_owned(),
                source_document_id: "assetbalance-doc".to_owned(),
                as_of: "2026-07-12T14:47:56+09:00".to_owned(),
                market_value_jpy: 2_500_000,
                cash_value_jpy: 300_000,
                unrealized_pnl_jpy: Some(250_000),
                realized_pnl_jpy: None,
                position_count: 1,
                fx_rate_count: 1,
            },
            asset_classes: vec![AssetClassDto {
                id: "class-stock".to_owned(),
                name: "国内株式".to_owned(),
                market_value_jpy: 2_200_000,
                unrealized_pnl_jpy: None,
                source_row: 5,
            }],
            positions: vec![PositionSnapshotDto {
                id: "position-7203".to_owned(),
                product_type: "株式".to_owned(),
                account_type: "特定".to_owned(),
                instrument_code: "7203".to_owned(),
                instrument_name: "トヨタ\"自動車".to_owned(),
                quantity: Some(100.5),
                average_cost: Some(20_000.0),
                market_price: None,
                market_value_jpy: Some(2_200_000),
                unrealized_pnl_jpy: Some(190_000),
                realized_pnl_jpy: None,
                currency: "JPY".to_owned(),
                source_row: 12,
            }],
            fx_rates: vec![FxRateSnapshotDto {
                id: "fx-usd".to_owned(),
                base_currency: "USD".to_owned(),
                quote_currency: "JPY".to_owned(),
                rate: 159.25,
                source_row: 20,
            }],
        }
    }

    #[test]
    fn selected_snapshot_csv_contains_all_grains_null_statuses_and_lineage() {
        let document =
            generate_portfolio_snapshot_csv_from_snapshot(&request(), &snapshot()).unwrap();
        assert_eq!(
            document.file_name,
            "kakeflow-portfolio-snapshot-snapshot-20260712.csv"
        );
        assert_eq!(document.media_type, "text/csv;charset=utf-8");
        assert_eq!(document.row_count, 4);
        assert_eq!(document.byte_size as usize, document.csv().len());
        assert!(document.csv().starts_with('\u{feff}'));
        assert_eq!(document.csv().matches("\r\n").count(), 5);
        for value in [
            "SUMMARY",
            "ASSET_CLASS",
            "POSITION",
            "FX_RATE",
            "assetbalance-doc",
            "NOT_PROVIDED",
            "159.25",
            "100.5",
        ] {
            assert!(document.csv().contains(value), "missing {value}");
        }
        assert!(document.csv().contains("\"証券,口座\""));
        assert!(document.csv().contains("\"トヨタ\"\"自動車\""));
        assert!(document.csv().contains(",12,position-7203,"));
        assert!(document.csv().contains(",20,fx-usd,"));
    }

    #[test]
    fn cancellation_does_not_write_and_destination_matches_generated_csv() {
        let document =
            generate_portfolio_snapshot_csv_from_snapshot(&request(), &snapshot()).unwrap();
        assert_eq!(
            save_portfolio_snapshot_csv_document(&document, None).unwrap(),
            None
        );
        let directory = tempdir().unwrap();
        let destination = directory.path().join("snapshot.csv");
        let saved = save_portfolio_snapshot_csv_document(&document, Some(&destination))
            .unwrap()
            .unwrap();
        assert_eq!(saved.row_count, 4);
        assert_eq!(
            std::fs::read_to_string(destination).unwrap(),
            document.csv()
        );
    }

    #[test]
    fn selected_snapshot_csv_reuses_strict_snapshot_validation() {
        let mut invalid_request = request();
        invalid_request.snapshot_id = "other".to_owned();
        assert!(
            generate_portfolio_snapshot_csv_from_snapshot(&invalid_request, &snapshot()).is_err()
        );
        let mut invalid = snapshot();
        invalid.summary.position_count = 2;
        assert!(generate_portfolio_snapshot_csv_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.fx_rates[0].rate = f64::NAN;
        assert!(generate_portfolio_snapshot_csv_from_snapshot(&request(), &invalid).is_err());
    }
}
