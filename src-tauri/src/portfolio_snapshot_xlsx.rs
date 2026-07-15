use crate::portfolio::{
    AssetClassDto, FxRateSnapshotDto, PortfolioError, PortfolioSnapshotDetailDto,
    PositionSnapshotDto,
};
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, Worksheet, XlsxError};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;
use thiserror::Error;

const MAX_XLSX_BYTES: usize = 8 * 1024 * 1024;
const MAX_CELL_TEXT_CHARS: usize = 512;
const MAX_ASSET_CLASS_ROWS: usize = 1_000;
const MAX_POSITION_ROWS: usize = 20_000;
const MAX_FX_RATE_ROWS: usize = 256;
const MAX_DATA_ROWS: usize = 25_000;
const MAX_EXACT_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_EXCEL_NUMBER: f64 = 9_007_199_254_740_991.0;
const XLSX_SHEET_COUNT: u8 = 4;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortfolioSnapshotXlsxRequest {
    pub household_id: String,
    pub snapshot_id: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PortfolioSnapshotXlsxError {
    #[error("portfolio snapshot workbook input is invalid")]
    Invalid,
    #[error("portfolio snapshot was not found")]
    NotFound,
    #[error("portfolio snapshot workbook is unavailable")]
    Unavailable,
}

impl PortfolioSnapshotXlsxError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::Invalid => "Portfolio snapshot workbook data is invalid",
            Self::NotFound => "The requested portfolio snapshot was not found",
            Self::Unavailable => "Portfolio snapshot workbook is temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone)]
pub struct PortfolioSnapshotXlsxDocument {
    pub file_name: String,
    pub media_type: &'static str,
    pub row_count: u32,
    pub byte_size: u32,
    bytes: Vec<u8>,
}

impl PortfolioSnapshotXlsxDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSnapshotXlsxSavedDto {
    pub file_name: String,
    pub row_count: u32,
    pub byte_size: u32,
    pub sheet_count: u8,
}

struct WorkbookFormats {
    title: Format,
    header: Format,
    label: Format,
    jpy: Format,
    decimal: Format,
    integer: Format,
    blank: Format,
}

impl WorkbookFormats {
    fn new() -> Self {
        let border = FormatBorder::Thin;
        Self {
            title: Format::new()
                .set_bold()
                .set_font_size(18)
                .set_font_color(Color::White)
                .set_background_color(Color::RGB(0x17324D)),
            header: Format::new()
                .set_bold()
                .set_font_color(Color::White)
                .set_background_color(Color::RGB(0x376A87))
                .set_border(border)
                .set_align(FormatAlign::Center),
            label: Format::new()
                .set_bold()
                .set_background_color(Color::RGB(0xEAF1F5))
                .set_border(border),
            jpy: Format::new()
                .set_num_format("[$¥-ja-JP]#,##0;[Red]-[$¥-ja-JP]#,##0")
                .set_border(border),
            decimal: Format::new()
                .set_num_format("#,##0.##########")
                .set_border(border),
            integer: Format::new().set_num_format("#,##0").set_border(border),
            blank: Format::new().set_border(border),
        }
    }
}

pub fn generate_portfolio_snapshot_xlsx(
    connection: &rusqlite::Connection,
    request: &PortfolioSnapshotXlsxRequest,
) -> Result<PortfolioSnapshotXlsxDocument, PortfolioSnapshotXlsxError> {
    if !valid_id(&request.household_id) || !valid_id(&request.snapshot_id) {
        return Err(PortfolioSnapshotXlsxError::Invalid);
    }
    let snapshot =
        crate::portfolio::get_snapshot(connection, &request.household_id, &request.snapshot_id)
            .map_err(map_portfolio_error)?;
    generate_portfolio_snapshot_xlsx_from_snapshot(request, &snapshot)
}

pub fn generate_portfolio_snapshot_xlsx_from_snapshot(
    request: &PortfolioSnapshotXlsxRequest,
    snapshot: &PortfolioSnapshotDetailDto,
) -> Result<PortfolioSnapshotXlsxDocument, PortfolioSnapshotXlsxError> {
    validate_snapshot(request, snapshot)?;
    let mut workbook = Workbook::new();
    let formats = WorkbookFormats::new();
    write_summary_sheet(&mut workbook, request, snapshot, &formats).map_err(workbook_error)?;
    write_asset_classes_sheet(&mut workbook, snapshot, &formats).map_err(workbook_error)?;
    write_positions_sheet(&mut workbook, snapshot, &formats).map_err(workbook_error)?;
    write_fx_rates_sheet(&mut workbook, snapshot, &formats).map_err(workbook_error)?;
    let bytes = workbook.save_to_buffer().map_err(workbook_error)?;
    if bytes.len() > MAX_XLSX_BYTES || bytes.len() > u32::MAX as usize {
        return Err(PortfolioSnapshotXlsxError::Invalid);
    }
    Ok(PortfolioSnapshotXlsxDocument {
        file_name: format!("kakeflow-portfolio-snapshot-{}.xlsx", request.snapshot_id),
        media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        row_count: 12
            + snapshot.asset_classes.len() as u32
            + snapshot.positions.len() as u32
            + snapshot.fx_rates.len() as u32,
        byte_size: bytes.len() as u32,
        bytes,
    })
}

pub fn save_portfolio_snapshot_xlsx_document(
    document: &PortfolioSnapshotXlsxDocument,
    destination: Option<&Path>,
) -> Result<Option<PortfolioSnapshotXlsxSavedDto>, PortfolioSnapshotXlsxError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.bytes())
        .map_err(|_| PortfolioSnapshotXlsxError::Unavailable)?;
    Ok(Some(PortfolioSnapshotXlsxSavedDto {
        file_name: document.file_name.clone(),
        row_count: document.row_count,
        byte_size: document.byte_size,
        sheet_count: XLSX_SHEET_COUNT,
    }))
}

fn write_summary_sheet(
    workbook: &mut Workbook,
    request: &PortfolioSnapshotXlsxRequest,
    snapshot: &PortfolioSnapshotDetailDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Summary")?;
    sheet.set_column_width(0, 26)?;
    sheet.set_column_width(1, 32)?;
    sheet.set_column_width(2, 18)?;
    write_text(
        sheet,
        0,
        0,
        "ポートフォリオ・スナップショット",
        &formats.title,
    )?;
    for (index, (label, value)) in [
        ("世帯ID", request.household_id.as_str()),
        ("Snapshot ID", snapshot.summary.id.as_str()),
        ("証券口座ID", snapshot.summary.account_id.as_str()),
        ("証券口座名", snapshot.summary.account_name.as_str()),
        (
            "Source Document",
            snapshot.summary.source_document_id.as_str(),
        ),
        ("Snapshot As Of", snapshot.summary.as_of.as_str()),
    ]
    .into_iter()
    .enumerate()
    {
        write_text(sheet, index as u32 + 2, 0, label, &formats.label)?;
        write_text(sheet, index as u32 + 2, 1, value, &Format::new())?;
    }
    let mut row = 8;
    for (label, value) in [
        ("時価総額 JPY", snapshot.summary.market_value_jpy),
        ("現金残高 JPY", snapshot.summary.cash_value_jpy),
    ] {
        write_text(sheet, row, 0, label, &formats.label)?;
        write_i64(sheet, row, 1, value, &formats.jpy)?;
        write_text(sheet, row, 2, "AVAILABLE", &Format::new())?;
        row += 1;
    }
    for (label, value) in [
        ("含み損益 JPY", snapshot.summary.unrealized_pnl_jpy),
        ("実現損益 JPY", snapshot.summary.realized_pnl_jpy),
    ] {
        write_text(sheet, row, 0, label, &formats.label)?;
        write_optional_i64(sheet, row, 1, value, &formats.jpy, &formats.blank)?;
        write_status(sheet, row, 2, value.is_some())?;
        row += 1;
    }
    for (label, value) in [
        ("Position Count", snapshot.summary.position_count),
        ("Snapshot FX Rate Count", snapshot.summary.fx_rate_count),
    ] {
        write_text(sheet, row, 0, label, &formats.label)?;
        write_u32(sheet, row, 1, value, &formats.integer)?;
        write_text(sheet, row, 2, "AVAILABLE", &Format::new())?;
        row += 1;
    }
    sheet.set_freeze_panes(2, 0)?;
    Ok(())
}

fn write_asset_classes_sheet(
    workbook: &mut Workbook,
    snapshot: &PortfolioSnapshotDetailDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("AssetClasses")?;
    set_widths(sheet, &[20.0, 32.0, 20.0, 20.0, 16.0, 24.0, 14.0])?;
    write_headers(
        sheet,
        &[
            "ID",
            "資産クラス",
            "時価総額 JPY",
            "含み損益 JPY",
            "損益状態",
            "Source Document",
            "Source Row",
        ],
        formats,
    )?;
    for (index, item) in snapshot.asset_classes.iter().enumerate() {
        let row = index as u32 + 1;
        write_text(sheet, row, 0, &item.id, &Format::new())?;
        write_text(sheet, row, 1, &item.name, &Format::new())?;
        write_i64(sheet, row, 2, item.market_value_jpy, &formats.jpy)?;
        write_optional_i64(
            sheet,
            row,
            3,
            item.unrealized_pnl_jpy,
            &formats.jpy,
            &formats.blank,
        )?;
        write_status(sheet, row, 4, item.unrealized_pnl_jpy.is_some())?;
        write_text(
            sheet,
            row,
            5,
            &snapshot.summary.source_document_id,
            &Format::new(),
        )?;
        write_u32(sheet, row, 6, item.source_row, &formats.integer)?;
    }
    finish_table(sheet, snapshot.asset_classes.len(), 6)
}

fn write_positions_sheet(
    workbook: &mut Workbook,
    snapshot: &PortfolioSnapshotDetailDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Positions")?;
    set_widths(sheet, &[20.0; 20])?;
    sheet.set_column_width(4, 30)?;
    write_headers(
        sheet,
        &[
            "ID",
            "商品種別",
            "口座種別",
            "銘柄コード",
            "銘柄名",
            "通貨",
            "数量",
            "数量状態",
            "平均取得単価",
            "平均単価状態",
            "市場価格",
            "価格状態",
            "時価総額 JPY",
            "時価状態",
            "含み損益 JPY",
            "含み損益状態",
            "実現損益 JPY",
            "実現損益状態",
            "Source Document",
            "Source Row",
        ],
        formats,
    )?;
    for (index, item) in snapshot.positions.iter().enumerate() {
        write_position_row(
            sheet,
            index as u32 + 1,
            item,
            &snapshot.summary.source_document_id,
            formats,
        )?;
    }
    finish_table(sheet, snapshot.positions.len(), 19)
}

fn write_position_row(
    sheet: &mut Worksheet,
    row: u32,
    item: &PositionSnapshotDto,
    source_document_id: &str,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    for (column, value) in [
        item.id.as_str(),
        item.product_type.as_str(),
        item.account_type.as_str(),
        item.instrument_code.as_str(),
        item.instrument_name.as_str(),
        item.currency.as_str(),
    ]
    .into_iter()
    .enumerate()
    {
        write_text(sheet, row, column as u16, value, &Format::new())?;
    }
    write_optional_f64(
        sheet,
        row,
        6,
        item.quantity,
        &formats.decimal,
        &formats.blank,
    )?;
    write_status(sheet, row, 7, item.quantity.is_some())?;
    write_optional_f64(
        sheet,
        row,
        8,
        item.average_cost,
        &formats.decimal,
        &formats.blank,
    )?;
    write_status(sheet, row, 9, item.average_cost.is_some())?;
    write_optional_f64(
        sheet,
        row,
        10,
        item.market_price,
        &formats.decimal,
        &formats.blank,
    )?;
    write_status(sheet, row, 11, item.market_price.is_some())?;
    write_optional_i64(
        sheet,
        row,
        12,
        item.market_value_jpy,
        &formats.jpy,
        &formats.blank,
    )?;
    write_status(sheet, row, 13, item.market_value_jpy.is_some())?;
    write_optional_i64(
        sheet,
        row,
        14,
        item.unrealized_pnl_jpy,
        &formats.jpy,
        &formats.blank,
    )?;
    write_status(sheet, row, 15, item.unrealized_pnl_jpy.is_some())?;
    write_optional_i64(
        sheet,
        row,
        16,
        item.realized_pnl_jpy,
        &formats.jpy,
        &formats.blank,
    )?;
    write_status(sheet, row, 17, item.realized_pnl_jpy.is_some())?;
    write_text(sheet, row, 18, source_document_id, &Format::new())?;
    write_u32(sheet, row, 19, item.source_row, &formats.integer)?;
    Ok(())
}

fn write_fx_rates_sheet(
    workbook: &mut Workbook,
    snapshot: &PortfolioSnapshotDetailDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("FXRates")?;
    set_widths(sheet, &[22.0, 18.0, 18.0, 20.0, 24.0, 14.0])?;
    write_headers(
        sheet,
        &[
            "ID",
            "Base Currency",
            "Quote Currency",
            "Snapshot Rate",
            "Source Document",
            "Source Row",
        ],
        formats,
    )?;
    for (index, item) in snapshot.fx_rates.iter().enumerate() {
        let row = index as u32 + 1;
        write_text(sheet, row, 0, &item.id, &Format::new())?;
        write_text(sheet, row, 1, &item.base_currency, &Format::new())?;
        write_text(sheet, row, 2, &item.quote_currency, &Format::new())?;
        write_f64(sheet, row, 3, item.rate, &formats.decimal)?;
        write_text(
            sheet,
            row,
            4,
            &snapshot.summary.source_document_id,
            &Format::new(),
        )?;
        write_u32(sheet, row, 5, item.source_row, &formats.integer)?;
    }
    finish_table(sheet, snapshot.fx_rates.len(), 5)
}

pub(crate) fn validate_snapshot(
    request: &PortfolioSnapshotXlsxRequest,
    snapshot: &PortfolioSnapshotDetailDto,
) -> Result<(), PortfolioSnapshotXlsxError> {
    let row_count =
        snapshot.asset_classes.len() + snapshot.positions.len() + snapshot.fx_rates.len();
    let summary = &snapshot.summary;
    if !valid_id(&request.household_id)
        || !valid_id(&request.snapshot_id)
        || summary.id != request.snapshot_id
        || !valid_id(&summary.id)
        || !valid_id(&summary.account_id)
        || !valid_id(&summary.source_document_id)
        || !valid_text(&summary.account_name, false)
        || summary.as_of.len() < 10
        || summary.as_of.chars().count() > 40
        || summary
            .as_of
            .get(0..10)
            .is_none_or(|date| !is_iso_date(date))
        || !valid_nonnegative_jpy(summary.market_value_jpy)
        || !valid_nonnegative_jpy(summary.cash_value_jpy)
        || !summary.unrealized_pnl_jpy.is_none_or(valid_jpy)
        || !summary.realized_pnl_jpy.is_none_or(valid_jpy)
        || summary.position_count as usize != snapshot.positions.len()
        || summary.fx_rate_count as usize != snapshot.fx_rates.len()
        || snapshot.asset_classes.len() > MAX_ASSET_CLASS_ROWS
        || snapshot.positions.len() > MAX_POSITION_ROWS
        || snapshot.fx_rates.len() > MAX_FX_RATE_ROWS
        || row_count > MAX_DATA_ROWS
        || !unique_ids(snapshot.asset_classes.iter().map(|item| item.id.as_str()))
        || !unique_ids(snapshot.positions.iter().map(|item| item.id.as_str()))
        || !unique_ids(snapshot.fx_rates.iter().map(|item| item.id.as_str()))
        || !snapshot.asset_classes.iter().all(validate_asset_class)
        || !snapshot.positions.iter().all(validate_position)
        || !snapshot.fx_rates.iter().all(validate_fx_rate)
    {
        return Err(PortfolioSnapshotXlsxError::Invalid);
    }
    Ok(())
}

fn validate_asset_class(item: &AssetClassDto) -> bool {
    valid_id(&item.id)
        && valid_text(&item.name, false)
        && valid_nonnegative_jpy(item.market_value_jpy)
        && item.unrealized_pnl_jpy.is_none_or(valid_jpy)
        && valid_source_row(item.source_row)
}

fn validate_position(item: &PositionSnapshotDto) -> bool {
    valid_id(&item.id)
        && valid_text(&item.product_type, true)
        && valid_text(&item.account_type, true)
        && valid_text(&item.instrument_code, true)
        && valid_text(&item.instrument_name, false)
        && valid_currency(&item.currency)
        && [item.quantity, item.average_cost, item.market_price]
            .into_iter()
            .flatten()
            .all(|value| valid_f64(value) && value >= 0.0)
        && item.market_value_jpy.is_none_or(valid_nonnegative_jpy)
        && item.unrealized_pnl_jpy.is_none_or(valid_jpy)
        && item.realized_pnl_jpy.is_none_or(valid_jpy)
        && valid_source_row(item.source_row)
}

fn validate_fx_rate(item: &FxRateSnapshotDto) -> bool {
    valid_id(&item.id)
        && valid_currency(&item.base_currency)
        && valid_currency(&item.quote_currency)
        && item.quote_currency == "JPY"
        && valid_f64(item.rate)
        && item.rate > 0.0
        && valid_source_row(item.source_row)
}

fn unique_ids<'a>(mut values: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = BTreeSet::new();
    values.all(|value| seen.insert(value))
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_text(value: &str, allow_empty: bool) -> bool {
    (allow_empty || !value.trim().is_empty()) && value.chars().count() <= MAX_CELL_TEXT_CHARS
}

fn valid_currency(value: &str) -> bool {
    value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_uppercase())
}

fn valid_source_row(value: u32) -> bool {
    value > 0
}

fn valid_jpy(value: i64) -> bool {
    value.unsigned_abs() <= MAX_EXACT_INTEGER
}

fn valid_nonnegative_jpy(value: i64) -> bool {
    value >= 0 && valid_jpy(value)
}

fn valid_f64(value: f64) -> bool {
    value.is_finite() && value.abs() <= MAX_EXCEL_NUMBER
}

fn is_iso_date(value: &str) -> bool {
    if value.len() != 10
        || value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
    {
        return false;
    }
    let Ok(year) = value[0..4].parse::<u16>() else {
        return false;
    };
    let Ok(month) = value[5..7].parse::<u8>() else {
        return false;
    };
    let Ok(day) = value[8..10].parse::<u8>() else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

fn set_widths(sheet: &mut Worksheet, widths: &[f64]) -> Result<(), XlsxError> {
    for (column, width) in widths.iter().enumerate() {
        sheet.set_column_width(column as u16, *width)?;
    }
    Ok(())
}

fn write_headers(
    sheet: &mut Worksheet,
    values: &[&str],
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    for (column, value) in values.iter().enumerate() {
        write_text(sheet, 0, column as u16, value, &formats.header)?;
    }
    Ok(())
}

fn finish_table(sheet: &mut Worksheet, rows: usize, last_column: u16) -> Result<(), XlsxError> {
    sheet.set_freeze_panes(1, 0)?;
    if rows > 0 {
        sheet.autofilter(0, 0, rows as u32, last_column)?;
    }
    Ok(())
}

fn write_text(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: &str,
    format: &Format,
) -> Result<(), XlsxError> {
    if value.chars().count() > MAX_CELL_TEXT_CHARS {
        return Err(XlsxError::ParameterError(
            "Portfolio snapshot workbook cell is too long".to_owned(),
        ));
    }
    sheet.write_string_with_format(row, column, value, format)?;
    Ok(())
}

fn write_status(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    available: bool,
) -> Result<(), XlsxError> {
    write_text(
        sheet,
        row,
        column,
        if available {
            "AVAILABLE"
        } else {
            "NOT_PROVIDED"
        },
        &Format::new(),
    )
}

fn write_i64(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: i64,
    format: &Format,
) -> Result<(), XlsxError> {
    if !valid_jpy(value) {
        return Err(XlsxError::ParameterError(
            "Portfolio snapshot workbook integer is invalid".to_owned(),
        ));
    }
    sheet.write_number_with_format(row, column, value as f64, format)?;
    Ok(())
}

fn write_u32(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: u32,
    format: &Format,
) -> Result<(), XlsxError> {
    sheet.write_number_with_format(row, column, value as f64, format)?;
    Ok(())
}

fn write_f64(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: f64,
    format: &Format,
) -> Result<(), XlsxError> {
    if !valid_f64(value) {
        return Err(XlsxError::ParameterError(
            "Portfolio snapshot workbook decimal is invalid".to_owned(),
        ));
    }
    sheet.write_number_with_format(row, column, value, format)?;
    Ok(())
}

fn write_optional_i64(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: Option<i64>,
    format: &Format,
    blank: &Format,
) -> Result<(), XlsxError> {
    match value {
        Some(value) => write_i64(sheet, row, column, value, format),
        None => {
            sheet.write_blank(row, column, blank)?;
            Ok(())
        }
    }
}

fn write_optional_f64(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: Option<f64>,
    format: &Format,
    blank: &Format,
) -> Result<(), XlsxError> {
    match value {
        Some(value) => write_f64(sheet, row, column, value, format),
        None => {
            sheet.write_blank(row, column, blank)?;
            Ok(())
        }
    }
}

fn map_portfolio_error(error: PortfolioError) -> PortfolioSnapshotXlsxError {
    match error {
        PortfolioError::InvalidInput(_) => PortfolioSnapshotXlsxError::Invalid,
        PortfolioError::NotFound => PortfolioSnapshotXlsxError::NotFound,
        PortfolioError::Conflict | PortfolioError::Unavailable => {
            PortfolioSnapshotXlsxError::Unavailable
        }
    }
}

fn workbook_error(error: XlsxError) -> PortfolioSnapshotXlsxError {
    match error {
        XlsxError::ParameterError(_) => PortfolioSnapshotXlsxError::Invalid,
        _ => PortfolioSnapshotXlsxError::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::portfolio::{PortfolioSnapshotSummaryDto, PositionSnapshotDto};
    use std::io::Read;
    use tempfile::tempdir;
    use zip::ZipArchive;

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
                account_name: "証券口座".to_owned(),
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
                instrument_name: "トヨタ自動車".to_owned(),
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

    fn zip_entry(bytes: &[u8], name: &str) -> String {
        let mut archive = ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut entry = archive.by_name(name).unwrap();
        let mut output = String::new();
        entry.read_to_string(&mut output).unwrap();
        output
    }

    #[test]
    fn workbook_has_four_snapshot_only_sheets_typed_values_and_null_statuses() {
        let document =
            generate_portfolio_snapshot_xlsx_from_snapshot(&request(), &snapshot()).unwrap();
        assert_eq!(document.row_count, 15);
        assert!(document.bytes().starts_with(b"PK"));
        assert_eq!(document.byte_size as usize, document.bytes().len());
        let workbook = zip_entry(document.bytes(), "xl/workbook.xml");
        for sheet in ["Summary", "AssetClasses", "Positions", "FXRates"] {
            assert!(workbook.contains(&format!("name=\"{sheet}\"")));
        }
        let strings = zip_entry(document.bytes(), "xl/sharedStrings.xml");
        for value in [
            "ポートフォリオ・スナップショット",
            "assetbalance-doc",
            "NOT_PROVIDED",
            "国内株式",
            "トヨタ自動車",
            "Snapshot Rate",
        ] {
            assert!(strings.contains(value), "missing string {value}");
        }
        let summary = zip_entry(document.bytes(), "xl/worksheets/sheet1.xml");
        assert!(summary.contains("<v>2500000</v>"));
        assert!(!summary.contains("<c r=\"B9\" t=\"s\""));
        let positions = zip_entry(document.bytes(), "xl/worksheets/sheet3.xml");
        assert!(positions.contains("<v>100.5</v>"));
        assert!(positions.contains("<v>2200000</v>"));
        let fx = zip_entry(document.bytes(), "xl/worksheets/sheet4.xml");
        assert!(fx.contains("<v>159.25</v>"));
    }

    #[test]
    fn cancellation_does_not_write_and_destination_matches_generated_bytes() {
        let document =
            generate_portfolio_snapshot_xlsx_from_snapshot(&request(), &snapshot()).unwrap();
        assert_eq!(
            save_portfolio_snapshot_xlsx_document(&document, None).unwrap(),
            None
        );
        let directory = tempdir().unwrap();
        let destination = directory.path().join("snapshot.xlsx");
        let saved = save_portfolio_snapshot_xlsx_document(&document, Some(&destination))
            .unwrap()
            .unwrap();
        assert_eq!(saved.sheet_count, 4);
        assert_eq!(saved.row_count, 15);
        assert_eq!(std::fs::read(destination).unwrap(), document.bytes());
    }

    #[test]
    fn generator_rejects_wrong_snapshot_counts_nonfinite_rows_and_oversized_data() {
        let mut invalid = snapshot();
        invalid.summary.id = "another".to_owned();
        assert!(generate_portfolio_snapshot_xlsx_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.summary.position_count = 2;
        assert!(generate_portfolio_snapshot_xlsx_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.fx_rates[0].rate = f64::NAN;
        assert!(generate_portfolio_snapshot_xlsx_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.positions[0].source_row = 0;
        assert!(generate_portfolio_snapshot_xlsx_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.fx_rates[0].quote_currency = "USD".to_owned();
        assert!(generate_portfolio_snapshot_xlsx_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.asset_classes.push(invalid.asset_classes[0].clone());
        assert!(generate_portfolio_snapshot_xlsx_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.summary.as_of = "2026-02-30T00:00:00Z".to_owned();
        assert!(generate_portfolio_snapshot_xlsx_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.positions = (0..=MAX_POSITION_ROWS)
            .map(|index| {
                let mut item = snapshot().positions.remove(0);
                item.id = format!("p{index}");
                item
            })
            .collect();
        invalid.summary.position_count = invalid.positions.len() as u32;
        assert!(generate_portfolio_snapshot_xlsx_from_snapshot(&request(), &invalid).is_err());
    }
}
