use crate::investment_performance::{
    self, CorporateActionAllocationDto, InvestmentPerformanceDto, InvestmentPerformanceError,
    InvestmentPerformanceRequest, RealizedAllocationDto, UncoveredSaleDto,
};
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, Worksheet, XlsxError};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::Path;
use thiserror::Error;

const MAX_XLSX_BYTES: usize = 8 * 1024 * 1024;
const MAX_CELL_TEXT_CHARS: usize = 512;
const MAX_DATA_ROWS: usize = 25_000;
const MAX_EXCEL_NUMBER: f64 = 9_007_199_254_740_991.0;
const XLSX_SHEET_COUNT: u8 = 4;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InvestmentPerformanceXlsxError {
    #[error("investment performance workbook input is invalid")]
    Invalid,
    #[error("investment account is outside the household")]
    Scope,
    #[error("investment performance workbook is unavailable")]
    Unavailable,
}

impl InvestmentPerformanceXlsxError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::Invalid => "Investment performance workbook data is invalid",
            Self::Scope => "Investment account was not found",
            Self::Unavailable => "Investment performance workbook is temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone)]
pub struct InvestmentPerformanceXlsxDocument {
    pub file_name: String,
    pub media_type: &'static str,
    pub row_count: u32,
    pub byte_size: u32,
    bytes: Vec<u8>,
}

impl InvestmentPerformanceXlsxDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentPerformanceXlsxSavedDto {
    pub file_name: String,
    pub row_count: u32,
    pub byte_size: u32,
    pub sheet_count: u8,
}

struct WorkbookFormats {
    title: Format,
    header: Format,
    label: Format,
    money: Format,
    decimal: Format,
    integer: Format,
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
            money: Format::new()
                .set_num_format("#,##0.00########;[Red]-#,##0.00########")
                .set_border(border),
            decimal: Format::new()
                .set_num_format("#,##0.##########")
                .set_border(border),
            integer: Format::new().set_num_format("#,##0").set_border(border),
        }
    }
}

pub fn generate_investment_performance_xlsx(
    connection: &rusqlite::Connection,
    request: &InvestmentPerformanceRequest,
) -> Result<InvestmentPerformanceXlsxDocument, InvestmentPerformanceXlsxError> {
    let report = investment_performance::query_performance(connection, request).map_err(
        |error| match error {
            InvestmentPerformanceError::Invalid => InvestmentPerformanceXlsxError::Invalid,
            InvestmentPerformanceError::Scope => InvestmentPerformanceXlsxError::Scope,
            InvestmentPerformanceError::Database => InvestmentPerformanceXlsxError::Unavailable,
        },
    )?;
    generate_investment_performance_xlsx_from_report(request, &report)
}

pub fn generate_investment_performance_xlsx_from_report(
    request: &InvestmentPerformanceRequest,
    report: &InvestmentPerformanceDto,
) -> Result<InvestmentPerformanceXlsxDocument, InvestmentPerformanceXlsxError> {
    validate_report(request, report)?;
    let mut workbook = Workbook::new();
    let formats = WorkbookFormats::new();
    write_summary_sheet(&mut workbook, request, report, &formats).map_err(workbook_error)?;
    write_realized_sheet(&mut workbook, report, &formats).map_err(workbook_error)?;
    write_corporate_actions_sheet(&mut workbook, report, &formats).map_err(workbook_error)?;
    write_exceptions_sheet(&mut workbook, report, &formats).map_err(workbook_error)?;
    let bytes = workbook.save_to_buffer().map_err(workbook_error)?;
    if bytes.len() > MAX_XLSX_BYTES || bytes.len() > u32::MAX as usize {
        return Err(InvestmentPerformanceXlsxError::Invalid);
    }
    let year = &request.date_from.as_deref().expect("validated dateFrom")[0..4];
    Ok(InvestmentPerformanceXlsxDocument {
        file_name: format!("kakeflow-investment-performance-{year}.xlsx"),
        media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        row_count: data_row_count(report),
        byte_size: bytes.len() as u32,
        bytes,
    })
}

pub fn save_investment_performance_xlsx_document(
    document: &InvestmentPerformanceXlsxDocument,
    destination: Option<&Path>,
) -> Result<Option<InvestmentPerformanceXlsxSavedDto>, InvestmentPerformanceXlsxError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.bytes())
        .map_err(|_| InvestmentPerformanceXlsxError::Unavailable)?;
    Ok(Some(InvestmentPerformanceXlsxSavedDto {
        file_name: document.file_name.clone(),
        row_count: document.row_count,
        byte_size: document.byte_size,
        sheet_count: XLSX_SHEET_COUNT,
    }))
}

fn write_summary_sheet(
    workbook: &mut Workbook,
    request: &InvestmentPerformanceRequest,
    report: &InvestmentPerformanceDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Summary")?;
    for (column, width) in [24.0, 28.0, 18.0, 18.0, 18.0, 18.0, 18.0]
        .into_iter()
        .enumerate()
    {
        sheet.set_column_width(column as u16, width)?;
    }
    write_text(sheet, 0, 0, "投資パフォーマンス", &formats.title)?;
    for (index, (label, value)) in [
        ("世帯ID", request.household_id.as_str()),
        (
            "対象期間（開始）",
            request.date_from.as_deref().expect("validated dateFrom"),
        ),
        (
            "対象期間（終了）",
            request.date_to.as_deref().expect("validated dateTo"),
        ),
        (
            "証券口座ID",
            request
                .account_id
                .as_deref()
                .unwrap_or("ALL_SECURITIES_ACCOUNTS"),
        ),
        ("原価計算方式", report.cost_basis_method),
        ("通貨ポリシー", "NATIVE_CURRENCIES_SEPARATE_NO_FX"),
    ]
    .into_iter()
    .enumerate()
    {
        write_text(sheet, index as u32 + 2, 0, label, &formats.label)?;
        write_text(sheet, index as u32 + 2, 1, value, &Format::new())?;
    }
    let header_row = 8;
    write_headers(
        sheet,
        header_row,
        &[
            "通貨",
            "購入総額",
            "売却総額",
            "実現損益",
            "配当総額",
            "手数料",
            "税金",
        ],
        &formats.header,
    )?;
    for (index, total) in report.totals_by_currency.iter().enumerate() {
        let row = header_row + 1 + index as u32;
        write_text(sheet, row, 0, &total.currency, &Format::new())?;
        for (column, value) in [
            total.buy_gross,
            total.sell_gross,
            total.realized_pnl,
            total.dividend_gross,
            total.fees,
            total.taxes,
        ]
        .into_iter()
        .enumerate()
        {
            write_number(sheet, row, column as u16 + 1, value, &formats.money)?;
        }
    }
    sheet.set_freeze_panes(header_row + 1, 1)?;
    if !report.totals_by_currency.is_empty() {
        sheet.autofilter(8, 0, 8 + report.totals_by_currency.len() as u32, 6)?;
    }
    Ok(())
}

fn write_realized_sheet(
    workbook: &mut Workbook,
    report: &InvestmentPerformanceDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Realized")?;
    set_uniform_widths(sheet, 16, 20)?;
    write_headers(
        sheet,
        0,
        &[
            "売却イベントID",
            "購入イベントID",
            "口座ID",
            "銘柄コード",
            "銘柄名",
            "通貨",
            "売却日",
            "取得日",
            "数量",
            "配賦原価",
            "純売却収入",
            "実現損益",
            "購入Source Document",
            "購入Source Row",
            "売却Source Document",
            "売却Source Row",
        ],
        &formats.header,
    )?;
    for (index, item) in report.realized_allocations.iter().enumerate() {
        write_realized_row(sheet, index as u32 + 1, item, formats)?;
    }
    finish_table(sheet, report.realized_allocations.len(), 15)
}

fn write_realized_row(
    sheet: &mut Worksheet,
    row: u32,
    item: &RealizedAllocationDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    for (column, value) in [
        item.sell_event_id.as_str(),
        item.buy_event_id.as_str(),
        item.account_id.as_str(),
        item.instrument_code.as_str(),
        item.instrument_name.as_str(),
        item.currency.as_str(),
        item.sold_on.as_str(),
        item.acquired_on.as_str(),
    ]
    .into_iter()
    .enumerate()
    {
        write_text(sheet, row, column as u16, value, &Format::new())?;
    }
    write_number(sheet, row, 8, item.quantity, &formats.decimal)?;
    write_number(sheet, row, 9, item.allocated_cost_basis, &formats.money)?;
    write_number(sheet, row, 10, item.allocated_net_proceeds, &formats.money)?;
    write_number(sheet, row, 11, item.realized_pnl, &formats.money)?;
    write_text(sheet, row, 12, &item.buy_source_document_id, &Format::new())?;
    write_i64(sheet, row, 13, item.buy_source_row, &formats.integer)?;
    write_text(
        sheet,
        row,
        14,
        &item.sell_source_document_id,
        &Format::new(),
    )?;
    write_i64(sheet, row, 15, item.sell_source_row, &formats.integer)?;
    Ok(())
}

fn write_corporate_actions_sheet(
    workbook: &mut Workbook,
    report: &InvestmentPerformanceDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("CorporateActions")?;
    set_uniform_widths(sheet, 19, 20)?;
    write_headers(
        sheet,
        0,
        &[
            "Action Event ID",
            "Action Type",
            "Action Date",
            "Action Source Document",
            "Action Source Row",
            "Source Buy Event ID",
            "Source Buy Document",
            "Source Buy Row",
            "From Instrument",
            "Target Instrument",
            "Source Currency",
            "Source Cost Basis",
            "Conversion Rate",
            "Currency",
            "Quantity",
            "Allocated Cost Basis",
            "Cash Amount",
            "Realized P&L",
        ],
        &formats.header,
    )?;
    for (index, item) in report.corporate_action_allocations.iter().enumerate() {
        write_corporate_action_row(sheet, index as u32 + 1, item, formats)?;
    }
    finish_table(sheet, report.corporate_action_allocations.len(), 17)
}

fn write_corporate_action_row(
    sheet: &mut Worksheet,
    row: u32,
    item: &CorporateActionAllocationDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    for (column, value) in [
        item.action_event_id.as_str(),
        item.action_type.as_str(),
        item.action_on.as_str(),
        item.action_source_document_id.as_str(),
    ]
    .into_iter()
    .enumerate()
    {
        write_text(sheet, row, column as u16, value, &Format::new())?;
    }
    write_i64(sheet, row, 4, item.action_source_row, &formats.integer)?;
    write_optional_text(sheet, row, 5, item.source_buy_event_id.as_deref())?;
    write_optional_text(sheet, row, 6, item.source_buy_source_document_id.as_deref())?;
    write_optional_i64(sheet, row, 7, item.source_buy_source_row, &formats.integer)?;
    write_text(sheet, row, 8, &item.from_instrument_code, &Format::new())?;
    write_text(sheet, row, 9, &item.target_instrument_code, &Format::new())?;
    write_optional_text(sheet, row, 10, item.source_currency.as_deref())?;
    write_optional_number(sheet, row, 11, item.source_cost_basis, &formats.money)?;
    write_optional_number(sheet, row, 12, item.conversion_rate, &formats.decimal)?;
    write_text(sheet, row, 13, &item.currency, &Format::new())?;
    write_number(sheet, row, 14, item.quantity, &formats.decimal)?;
    write_number(sheet, row, 15, item.allocated_cost_basis, &formats.money)?;
    write_number(sheet, row, 16, item.cash_amount, &formats.money)?;
    write_optional_number(sheet, row, 17, item.realized_pnl, &formats.money)?;
    Ok(())
}

fn write_exceptions_sheet(
    workbook: &mut Workbook,
    report: &InvestmentPerformanceDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Exceptions")?;
    set_uniform_widths(sheet, 11, 22)?;
    sheet.set_column_width(10, 52)?;
    write_headers(
        sheet,
        0,
        &[
            "種別",
            "イベントID",
            "口座ID",
            "銘柄コード",
            "銘柄名",
            "通貨",
            "日付",
            "数量",
            "Source Document",
            "Source Row",
            "注記",
        ],
        &formats.header,
    )?;
    let mut row = 1;
    for item in &report.uncovered_sales {
        write_uncovered_sale_row(sheet, row, item, formats)?;
        row += 1;
    }
    for event_id in &report.skipped_event_ids {
        write_text(sheet, row, 0, "SKIPPED_EVENT", &Format::new())?;
        write_text(sheet, row, 1, event_id, &Format::new())?;
        write_text(sheet, row, 10, "計算から除外されたイベント", &Format::new())?;
        row += 1;
    }
    for event_id in unallocated_corporate_action_ids(report) {
        write_text(
            sheet,
            row,
            0,
            "UNALLOCATED_CORPORATE_ACTION",
            &Format::new(),
        )?;
        write_text(sheet, row, 1, event_id, &Format::new())?;
        write_text(
            sheet,
            row,
            10,
            "CorporateActionsに配賦行がありません",
            &Format::new(),
        )?;
        row += 1;
    }
    for note in [
        "金額はイベントの原通貨ごとに分離され、FX換算されません。",
        "未カバー売却とスキップイベントは集計の完全性に影響する可能性があります。",
        "この出力は保有時価、未実現損益、資産配分、投資リターンを表しません。",
    ] {
        write_text(sheet, row, 0, "DISCLOSURE", &Format::new())?;
        write_text(sheet, row, 10, note, &Format::new())?;
        row += 1;
    }
    finish_table(sheet, row.saturating_sub(1) as usize, 10)
}

fn write_uncovered_sale_row(
    sheet: &mut Worksheet,
    row: u32,
    item: &UncoveredSaleDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    write_text(sheet, row, 0, "UNCOVERED_SALE", &Format::new())?;
    for (column, value) in [
        item.sell_event_id.as_str(),
        item.account_id.as_str(),
        item.instrument_code.as_str(),
        item.instrument_name.as_str(),
        item.currency.as_str(),
        item.sold_on.as_str(),
    ]
    .into_iter()
    .enumerate()
    {
        write_text(sheet, row, column as u16 + 1, value, &Format::new())?;
    }
    write_number(sheet, row, 7, item.uncovered_quantity, &formats.decimal)?;
    write_text(sheet, row, 8, &item.source_document_id, &Format::new())?;
    write_i64(sheet, row, 9, item.source_row, &formats.integer)?;
    Ok(())
}

fn unallocated_corporate_action_ids(report: &InvestmentPerformanceDto) -> Vec<&str> {
    let allocated = report
        .corporate_action_allocations
        .iter()
        .map(|item| item.action_event_id.as_str())
        .collect::<BTreeSet<_>>();
    report
        .corporate_action_event_ids
        .iter()
        .map(String::as_str)
        .filter(|id| !allocated.contains(id))
        .collect()
}

fn validate_report(
    request: &InvestmentPerformanceRequest,
    report: &InvestmentPerformanceDto,
) -> Result<(), InvestmentPerformanceXlsxError> {
    let row_count = report.totals_by_currency.len()
        + report.realized_allocations.len()
        + report.corporate_action_allocations.len()
        + report.uncovered_sales.len()
        + report.skipped_event_ids.len()
        + report.corporate_action_event_ids.len();
    let annual_period = request
        .date_from
        .as_deref()
        .zip(request.date_to.as_deref())
        .is_some_and(|(from, to)| {
            is_iso_date(from)
                && is_iso_date(to)
                && from[0..4] == to[0..4]
                && &from[4..] == "-01-01"
                && &to[4..] == "-12-31"
        });
    if request.household_id.trim().is_empty()
        || request.household_id.chars().count() > MAX_CELL_TEXT_CHARS
        || request.account_id.as_deref().is_some_and(|value| {
            value.trim().is_empty() || value.chars().count() > MAX_CELL_TEXT_CHARS
        })
        || !annual_period
        || report.date_from != request.date_from
        || report.date_to != request.date_to
        || report.cost_basis_method != "FIFO"
        || row_count > MAX_DATA_ROWS
        || !validate_totals(report)
        || !report.realized_allocations.iter().all(validate_realized)
        || !report.uncovered_sales.iter().all(validate_uncovered_sale)
        || !report
            .corporate_action_allocations
            .iter()
            .all(validate_corporate_action)
        || report
            .skipped_event_ids
            .iter()
            .chain(report.corporate_action_event_ids.iter())
            .any(|id| id.trim().is_empty() || id.chars().count() > MAX_CELL_TEXT_CHARS)
    {
        return Err(InvestmentPerformanceXlsxError::Invalid);
    }
    Ok(())
}

fn validate_totals(report: &InvestmentPerformanceDto) -> bool {
    let mut currencies = BTreeSet::new();
    report.totals_by_currency.iter().all(|total| {
        valid_currency(&total.currency)
            && currencies.insert(total.currency.as_str())
            && [
                total.buy_gross,
                total.sell_gross,
                total.realized_pnl,
                total.dividend_gross,
                total.fees,
                total.taxes,
            ]
            .into_iter()
            .all(valid_number)
    })
}

fn validate_realized(item: &RealizedAllocationDto) -> bool {
    all_nonempty([
        item.sell_event_id.as_str(),
        item.buy_event_id.as_str(),
        item.account_id.as_str(),
        item.instrument_name.as_str(),
        item.buy_source_document_id.as_str(),
        item.sell_source_document_id.as_str(),
    ]) && valid_currency(&item.currency)
        && is_iso_date(&item.sold_on)
        && is_iso_date(&item.acquired_on)
        && item.acquired_on <= item.sold_on
        && item.quantity > 0.0
        && [
            item.quantity,
            item.allocated_cost_basis,
            item.allocated_net_proceeds,
            item.realized_pnl,
        ]
        .into_iter()
        .all(valid_number)
        && item.buy_source_row > 0
        && item.sell_source_row > 0
}

fn validate_uncovered_sale(item: &UncoveredSaleDto) -> bool {
    all_nonempty([
        item.sell_event_id.as_str(),
        item.account_id.as_str(),
        item.instrument_name.as_str(),
        item.source_document_id.as_str(),
    ]) && valid_currency(&item.currency)
        && is_iso_date(&item.sold_on)
        && item.uncovered_quantity > 0.0
        && valid_number(item.uncovered_quantity)
        && item.source_row > 0
}

fn validate_corporate_action(item: &CorporateActionAllocationDto) -> bool {
    let buy_provenance_count = [
        item.source_buy_event_id.is_some(),
        item.source_buy_source_document_id.is_some(),
        item.source_buy_source_row.is_some(),
    ]
    .into_iter()
    .filter(|present| *present)
    .count();
    let source_cost_count = [
        item.source_currency.is_some(),
        item.source_cost_basis.is_some(),
    ]
    .into_iter()
    .filter(|present| *present)
    .count();
    let merger = matches!(item.action_type.as_str(), "MERGER_STOCK" | "MERGER_CASH");
    all_nonempty([
        item.action_event_id.as_str(),
        item.action_type.as_str(),
        item.action_source_document_id.as_str(),
        item.from_instrument_code.as_str(),
        item.target_instrument_code.as_str(),
    ]) && matches!(
        item.action_type.as_str(),
        "SPIN_OFF" | "RIGHTS_SUBSCRIPTION" | "CASH_IN_LIEU" | "MERGER_STOCK" | "MERGER_CASH"
    ) && is_iso_date(&item.action_on)
        && valid_currency(&item.currency)
        && item.source_currency.as_deref().is_none_or(valid_currency)
        && item.action_source_row > 0
        && matches!(buy_provenance_count, 0 | 3)
        && item.source_buy_source_row.is_none_or(|row| row > 0)
        && matches!(source_cost_count, 0 | 2)
        && item
            .conversion_rate
            .is_none_or(|value| value > 0.0 && valid_number(value))
        && item.quantity >= 0.0
        && [item.quantity, item.allocated_cost_basis, item.cash_amount]
            .into_iter()
            .all(valid_number)
        && item.source_cost_basis.is_none_or(valid_number)
        && item.realized_pnl.is_none_or(valid_number)
        && (!merger
            || (buy_provenance_count == 3
                && source_cost_count == 2
                && item.source_cost_basis.is_some_and(|value| value >= 0.0)
                && (item.source_currency.as_deref() == Some(item.currency.as_str()))
                    == item.conversion_rate.is_none()))
}

fn all_nonempty<const N: usize>(values: [&str; N]) -> bool {
    values
        .into_iter()
        .all(|value| !value.trim().is_empty() && value.chars().count() <= MAX_CELL_TEXT_CHARS)
}

fn valid_currency(value: &str) -> bool {
    value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_uppercase())
}

fn valid_number(value: f64) -> bool {
    value.is_finite() && value.abs() <= MAX_EXCEL_NUMBER
}

fn data_row_count(report: &InvestmentPerformanceDto) -> u32 {
    6 + report.totals_by_currency.len() as u32
        + report.realized_allocations.len() as u32
        + report.corporate_action_allocations.len() as u32
        + report.uncovered_sales.len() as u32
        + report.skipped_event_ids.len() as u32
        + unallocated_corporate_action_ids(report).len() as u32
        + 3
}

fn set_uniform_widths(
    sheet: &mut Worksheet,
    column_count: u16,
    width: u16,
) -> Result<(), XlsxError> {
    for column in 0..column_count {
        sheet.set_column_width(column, width)?;
    }
    Ok(())
}

fn finish_table(
    sheet: &mut Worksheet,
    row_count: usize,
    last_column: u16,
) -> Result<(), XlsxError> {
    sheet.set_freeze_panes(1, 0)?;
    if row_count > 0 {
        sheet.autofilter(0, 0, row_count as u32, last_column)?;
    }
    Ok(())
}

fn write_headers(
    sheet: &mut Worksheet,
    row: u32,
    values: &[&str],
    format: &Format,
) -> Result<(), XlsxError> {
    for (column, value) in values.iter().enumerate() {
        write_text(sheet, row, column as u16, value, format)?;
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
            "Investment performance workbook cell is too long".to_owned(),
        ));
    }
    sheet.write_string_with_format(row, column, value, format)?;
    Ok(())
}

fn write_optional_text(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: Option<&str>,
) -> Result<(), XlsxError> {
    write_text(sheet, row, column, value.unwrap_or("—"), &Format::new())
}

fn write_number(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: f64,
    format: &Format,
) -> Result<(), XlsxError> {
    if !value.is_finite() || value.abs() > MAX_EXCEL_NUMBER {
        return Err(XlsxError::ParameterError(
            "Investment performance workbook number is invalid".to_owned(),
        ));
    }
    sheet.write_number_with_format(row, column, value, format)?;
    Ok(())
}

fn write_optional_number(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: Option<f64>,
    format: &Format,
) -> Result<(), XlsxError> {
    match value {
        Some(value) => write_number(sheet, row, column, value, format),
        None => write_text(sheet, row, column, "—", &Format::new()),
    }
}

fn write_i64(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: i64,
    format: &Format,
) -> Result<(), XlsxError> {
    write_number(sheet, row, column, value as f64, format)
}

fn write_optional_i64(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: Option<i64>,
    format: &Format,
) -> Result<(), XlsxError> {
    match value {
        Some(value) => write_i64(sheet, row, column, value, format),
        None => write_text(sheet, row, column, "—", &Format::new()),
    }
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

fn workbook_error(error: XlsxError) -> InvestmentPerformanceXlsxError {
    match error {
        XlsxError::ParameterError(_) => InvestmentPerformanceXlsxError::Invalid,
        _ => InvestmentPerformanceXlsxError::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::investment_performance::{InvestmentPeriodCurrencyDto, RealizedAllocationDto};
    use std::io::Read;
    use tempfile::tempdir;
    use zip::ZipArchive;

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
                instrument_name: "トヨタ自動車".to_owned(),
                currency: "JPY".to_owned(),
                sold_on: "2026-06-10".to_owned(),
                acquired_on: "2026-01-10".to_owned(),
                quantity: 10.0,
                allocated_cost_basis: 100_000.0,
                allocated_net_proceeds: 118_500.0,
                realized_pnl: 18_500.0,
                buy_source_document_id: "doc-buy".to_owned(),
                buy_source_row: 12,
                sell_source_document_id: "doc-sell".to_owned(),
                sell_source_row: 8,
            }],
            uncovered_sales: vec![UncoveredSaleDto {
                sell_event_id: "sell-uncovered".to_owned(),
                account_id: "brokerage".to_owned(),
                instrument_code: "MISSING".to_owned(),
                instrument_name: "未カバー銘柄".to_owned(),
                currency: "USD".to_owned(),
                sold_on: "2026-07-01".to_owned(),
                uncovered_quantity: 2.5,
                source_document_id: "doc-uncovered".to_owned(),
                source_row: 21,
            }],
            skipped_event_ids: vec!["skipped-1".to_owned()],
            corporate_action_event_ids: vec!["split-1".to_owned(), "merger-unallocated".to_owned()],
            corporate_action_allocations: vec![CorporateActionAllocationDto {
                action_event_id: "split-1".to_owned(),
                action_type: "MERGER_STOCK".to_owned(),
                action_on: "2026-04-01".to_owned(),
                action_source_document_id: "doc-action".to_owned(),
                action_source_row: 14,
                source_buy_event_id: Some("buy-1".to_owned()),
                source_buy_source_document_id: Some("doc-buy".to_owned()),
                source_buy_source_row: Some(12),
                from_instrument_code: "7203".to_owned(),
                target_instrument_code: "7203".to_owned(),
                source_currency: Some("USD".to_owned()),
                source_cost_basis: Some(50_000.0),
                conversion_rate: Some(2.0),
                currency: "JPY".to_owned(),
                quantity: 20.0,
                allocated_cost_basis: 100_000.0,
                cash_amount: 0.0,
                realized_pnl: None,
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
    fn workbook_has_four_truthful_sheets_typed_numbers_and_exceptions() {
        let document =
            generate_investment_performance_xlsx_from_report(&request(), &report()).unwrap();
        assert_eq!(document.row_count, 15);
        assert_eq!(
            document.file_name,
            "kakeflow-investment-performance-2026.xlsx"
        );
        assert_eq!(document.byte_size as usize, document.bytes().len());
        assert!(document.bytes().starts_with(b"PK"));
        let workbook = zip_entry(document.bytes(), "xl/workbook.xml");
        for sheet in ["Summary", "Realized", "CorporateActions", "Exceptions"] {
            assert!(workbook.contains(&format!("name=\"{sheet}\"")));
        }
        let strings = zip_entry(document.bytes(), "xl/sharedStrings.xml");
        for value in [
            "投資パフォーマンス",
            "family",
            "NATIVE_CURRENCIES_SEPARATE_NO_FX",
            "トヨタ自動車",
            "UNALLOCATED_CORPORATE_ACTION",
            "merger-unallocated",
        ] {
            assert!(strings.contains(value), "missing string {value}");
        }
        let mut all_accounts_request = request();
        all_accounts_request.account_id = None;
        let all_accounts =
            generate_investment_performance_xlsx_from_report(&all_accounts_request, &report())
                .unwrap();
        assert!(zip_entry(all_accounts.bytes(), "xl/sharedStrings.xml")
            .contains("ALL_SECURITIES_ACCOUNTS"));
        let summary = zip_entry(document.bytes(), "xl/worksheets/sheet1.xml");
        assert!(summary.contains("<v>100000</v>"));
        assert!(!summary.contains("<c r=\"B10\" t=\"s\""));
        let realized = zip_entry(document.bytes(), "xl/worksheets/sheet2.xml");
        assert!(realized.contains("<v>118500</v>"));
        let corporate = zip_entry(document.bytes(), "xl/worksheets/sheet3.xml");
        assert!(corporate.contains("<v>2</v>"));
        let exceptions = zip_entry(document.bytes(), "xl/worksheets/sheet4.xml");
        assert!(exceptions.contains("<v>2.5</v>"));
    }

    #[test]
    fn cancellation_does_not_write_and_save_returns_bounded_metadata() {
        let document =
            generate_investment_performance_xlsx_from_report(&request(), &report()).unwrap();
        assert_eq!(
            save_investment_performance_xlsx_document(&document, None).unwrap(),
            None
        );
        let directory = tempdir().unwrap();
        let destination = directory.path().join("investment.xlsx");
        let saved = save_investment_performance_xlsx_document(&document, Some(&destination))
            .unwrap()
            .unwrap();
        assert_eq!(saved.sheet_count, 4);
        assert_eq!(saved.row_count, 15);
        assert_eq!(std::fs::read(destination).unwrap(), document.bytes());
    }

    #[test]
    fn generator_rejects_mismatch_invalid_dates_non_finite_and_oversized_text() {
        let mut invalid = report();
        invalid.date_to = Some("2027-01-01".to_owned());
        assert!(generate_investment_performance_xlsx_from_report(&request(), &invalid).is_err());
        let mut invalid_request = request();
        invalid_request.date_to = Some("2026-02-30".to_owned());
        assert!(
            generate_investment_performance_xlsx_from_report(&invalid_request, &report()).is_err()
        );
        let mut invalid_request = request();
        invalid_request.date_from = None;
        assert!(
            generate_investment_performance_xlsx_from_report(&invalid_request, &report()).is_err()
        );
        let mut invalid_request = request();
        invalid_request.account_id = Some(" ".to_owned());
        assert!(
            generate_investment_performance_xlsx_from_report(&invalid_request, &report()).is_err()
        );
        let mut invalid = report();
        invalid.totals_by_currency[0].buy_gross = f64::NAN;
        assert!(generate_investment_performance_xlsx_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.totals_by_currency[0].buy_gross = MAX_EXCEL_NUMBER + 2.0;
        assert!(generate_investment_performance_xlsx_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.skipped_event_ids[0] = "x".repeat(MAX_CELL_TEXT_CHARS + 1);
        assert!(generate_investment_performance_xlsx_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.skipped_event_ids = (0..=MAX_DATA_ROWS).map(|index| index.to_string()).collect();
        assert!(generate_investment_performance_xlsx_from_report(&request(), &invalid).is_err());
    }
}
