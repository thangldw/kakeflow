use crate::financial_calendar::{
    monthly_report, FinancialCalendarError, MonthlyFinancialReportDto,
    MonthlyFinancialReportRequest,
};
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, Worksheet, XlsxError};
use serde::Serialize;
use std::path::Path;

const MAX_XLSX_BYTES: usize = 8 * 1024 * 1024;
const MAX_CELL_TEXT_CHARS: usize = 512;
const MAX_DRIVER_ROWS_PER_KIND: usize = 8;
const XLSX_SHEET_COUNT: u8 = 4;
const EXCEL_MAX_EXACT_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone)]
pub struct MonthlyReviewXlsxDocument {
    pub file_name: String,
    pub media_type: &'static str,
    pub row_count: u32,
    pub byte_size: u32,
    bytes: Vec<u8>,
}

impl MonthlyReviewXlsxDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyReviewXlsxSavedDto {
    pub file_name: String,
    pub row_count: u32,
    pub byte_size: u32,
    pub sheet_count: u8,
}

struct WorkbookFormats {
    title: Format,
    section: Format,
    header: Format,
    label: Format,
    yen: Format,
    integer: Format,
    percent: Format,
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
            section: Format::new()
                .set_bold()
                .set_font_color(Color::White)
                .set_background_color(Color::RGB(0x2E6F75)),
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
            yen: Format::new()
                .set_num_format("[$¥-ja-JP]#,##0;[Red]-[$¥-ja-JP]#,##0")
                .set_border(border),
            integer: Format::new().set_num_format("#,##0").set_border(border),
            percent: Format::new()
                .set_num_format("0.0%;[Red]-0.0%")
                .set_border(border),
        }
    }
}

pub fn generate_monthly_review_xlsx(
    connection: &rusqlite::Connection,
    request: &MonthlyFinancialReportRequest,
) -> Result<MonthlyReviewXlsxDocument, FinancialCalendarError> {
    let report = monthly_report(connection, request)?;
    generate_monthly_review_xlsx_from_report(request, &report)
}

pub fn generate_monthly_review_xlsx_from_report(
    request: &MonthlyFinancialReportRequest,
    report: &MonthlyFinancialReportDto,
) -> Result<MonthlyReviewXlsxDocument, FinancialCalendarError> {
    if !is_iso_month(&request.month)
        || report.period != request.month
        || request
            .as_of
            .as_deref()
            .is_some_and(|date| !is_iso_date(date))
        || report.top_category_drivers.len() > MAX_DRIVER_ROWS_PER_KIND
        || report.top_merchant_drivers.len() > MAX_DRIVER_ROWS_PER_KIND
    {
        return Err(FinancialCalendarError::InvalidInput(
            "Monthly review workbook data is invalid",
        ));
    }

    let mut workbook = Workbook::new();
    let formats = WorkbookFormats::new();
    write_summary_sheet(&mut workbook, request, report, &formats).map_err(workbook_error)?;
    write_comparisons_sheet(&mut workbook, report, &formats).map_err(workbook_error)?;
    write_drivers_sheet(&mut workbook, report, &formats).map_err(workbook_error)?;
    write_health_sheet(&mut workbook, report, &formats).map_err(workbook_error)?;

    let bytes = workbook.save_to_buffer().map_err(workbook_error)?;
    if bytes.len() > MAX_XLSX_BYTES || bytes.len() > u32::MAX as usize {
        return Err(FinancialCalendarError::InvalidInput(
            "Monthly review workbook is too large",
        ));
    }
    let as_of_suffix = request
        .as_of
        .as_deref()
        .map(|date| format!("-data-quality-as-of-{date}"))
        .unwrap_or_default();
    Ok(MonthlyReviewXlsxDocument {
        file_name: format!(
            "kakeflow-monthly-household-review-{}{as_of_suffix}.xlsx",
            report.period
        ),
        media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        row_count: workbook_data_row_count(report),
        byte_size: bytes.len() as u32,
        bytes,
    })
}

pub fn save_monthly_review_xlsx_document(
    document: &MonthlyReviewXlsxDocument,
    destination: Option<&Path>,
) -> Result<Option<MonthlyReviewXlsxSavedDto>, FinancialCalendarError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.bytes())
        .map_err(|_| FinancialCalendarError::Unavailable)?;
    Ok(Some(MonthlyReviewXlsxSavedDto {
        file_name: document.file_name.clone(),
        row_count: document.row_count,
        byte_size: document.byte_size,
        sheet_count: XLSX_SHEET_COUNT,
    }))
}

fn write_summary_sheet(
    workbook: &mut Workbook,
    request: &MonthlyFinancialReportRequest,
    report: &MonthlyFinancialReportDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Summary")?;
    for (column, width) in [24.0, 18.0, 18.0, 18.0, 15.0, 18.0, 18.0, 15.0]
        .into_iter()
        .enumerate()
    {
        sheet.set_column_width(column as u16, width)?;
    }
    write_text(sheet, 0, 0, "月次家計レビュー", &formats.title)?;
    for (row, (label, value)) in [
        ("対象月", report.period.as_str()),
        (
            "データ品質基準日",
            request.as_of.as_deref().unwrap_or("自動解決"),
        ),
        ("世帯ID", request.household_id.as_str()),
        (
            "口座グループID",
            request.account_group_id.as_deref().unwrap_or("ALL"),
        ),
        ("家族内帰属", request.attribution_scope.sql_kind()),
        (
            "帰属メンバーID",
            request.attribution_scope.member_id().unwrap_or("—"),
        ),
        ("比較軸", "前月・前年同月"),
        ("スコープ境界", "目標・データ品質は世帯全体"),
    ]
    .into_iter()
    .enumerate()
    {
        write_text(sheet, row as u32 + 2, 0, label, &formats.label)?;
        write_text(sheet, row as u32 + 2, 1, value, &Format::new())?;
    }

    let header_row = 10;
    write_headers(sheet, header_row, &["指標", "当月"], &formats.header)?;
    for (index, (label, current)) in [
        ("収入", report.current.income_jpy),
        ("支出", report.current.expense_jpy),
        ("貯蓄", report.current.savings_jpy),
    ]
    .into_iter()
    .enumerate()
    {
        let row = header_row + 1 + index as u32;
        write_text(sheet, row, 0, label, &formats.label)?;
        write_i64(sheet, row, 1, current, &formats.yen)?;
    }
    let row = header_row + 4;
    write_text(sheet, row, 0, "貯蓄率", &formats.label)?;
    write_optional_rate(
        sheet,
        row,
        1,
        report.current.savings_rate_bps,
        &formats.percent,
    )?;
    let row = header_row + 5;
    write_text(sheet, row, 0, "確定取引件数", &formats.label)?;
    write_u64(
        sheet,
        row,
        1,
        report.current.posted_transaction_count,
        &formats.integer,
    )?;
    sheet.set_freeze_panes(header_row + 1, 1)?;
    Ok(())
}

fn write_comparisons_sheet(
    workbook: &mut Workbook,
    report: &MonthlyFinancialReportDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Comparisons")?;
    for (column, width) in [24.0, 18.0, 18.0, 18.0, 15.0, 18.0, 18.0, 15.0]
        .into_iter()
        .enumerate()
    {
        sheet.set_column_width(column as u16, width)?;
    }
    write_headers(
        sheet,
        0,
        &[
            "指標",
            "当月",
            "前月",
            "前月比増減",
            "前月比率",
            "前年同月",
            "前年同月比増減",
            "前年同月比率",
        ],
        &formats.header,
    )?;
    for (
        index,
        (label, current, prior_month, prior_year, mom_amount, mom_rate, yoy_amount, yoy_rate),
    ) in [
        (
            "収入",
            report.current.income_jpy,
            report.prior_month.income_jpy,
            report.prior_year.income_jpy,
            report.vs_prior_month.income.amount_jpy,
            report.vs_prior_month.income.rate_bps,
            report.vs_prior_year.income.amount_jpy,
            report.vs_prior_year.income.rate_bps,
        ),
        (
            "支出",
            report.current.expense_jpy,
            report.prior_month.expense_jpy,
            report.prior_year.expense_jpy,
            report.vs_prior_month.expense.amount_jpy,
            report.vs_prior_month.expense.rate_bps,
            report.vs_prior_year.expense.amount_jpy,
            report.vs_prior_year.expense.rate_bps,
        ),
        (
            "貯蓄",
            report.current.savings_jpy,
            report.prior_month.savings_jpy,
            report.prior_year.savings_jpy,
            report.vs_prior_month.savings.amount_jpy,
            report.vs_prior_month.savings.rate_bps,
            report.vs_prior_year.savings.amount_jpy,
            report.vs_prior_year.savings.rate_bps,
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let row = index as u32 + 1;
        write_text(sheet, row, 0, label, &formats.label)?;
        write_i64(sheet, row, 1, current, &formats.yen)?;
        write_i64(sheet, row, 2, prior_month, &formats.yen)?;
        write_i64(sheet, row, 3, mom_amount, &formats.yen)?;
        write_optional_rate(sheet, row, 4, mom_rate, &formats.percent)?;
        write_i64(sheet, row, 5, prior_year, &formats.yen)?;
        write_i64(sheet, row, 6, yoy_amount, &formats.yen)?;
        write_optional_rate(sheet, row, 7, yoy_rate, &formats.percent)?;
    }
    let row = 4;
    write_text(sheet, row, 0, "貯蓄率", &formats.label)?;
    write_optional_rate(
        sheet,
        row,
        1,
        report.current.savings_rate_bps,
        &formats.percent,
    )?;
    write_optional_rate(
        sheet,
        row,
        2,
        report.prior_month.savings_rate_bps,
        &formats.percent,
    )?;
    write_dash(sheet, row, 3)?;
    write_dash(sheet, row, 4)?;
    write_optional_rate(
        sheet,
        row,
        5,
        report.prior_year.savings_rate_bps,
        &formats.percent,
    )?;
    write_dash(sheet, row, 6)?;
    write_dash(sheet, row, 7)?;
    let row = 5;
    write_text(sheet, row, 0, "確定取引件数", &formats.label)?;
    write_u64(
        sheet,
        row,
        1,
        report.current.posted_transaction_count,
        &formats.integer,
    )?;
    write_u64(
        sheet,
        row,
        2,
        report.prior_month.posted_transaction_count,
        &formats.integer,
    )?;
    write_dash(sheet, row, 3)?;
    write_dash(sheet, row, 4)?;
    write_u64(
        sheet,
        row,
        5,
        report.prior_year.posted_transaction_count,
        &formats.integer,
    )?;
    write_dash(sheet, row, 6)?;
    write_dash(sheet, row, 7)?;
    sheet.set_freeze_panes(1, 1)?;
    Ok(())
}

fn write_drivers_sheet(
    workbook: &mut Workbook,
    report: &MonthlyFinancialReportDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Drivers")?;
    for (column, width) in [18.0, 30.0, 28.0, 18.0, 18.0, 18.0, 20.0]
        .into_iter()
        .enumerate()
    {
        sheet.set_column_width(column as u16, width)?;
    }
    write_headers(
        sheet,
        0,
        &["種別", "名称", "ID", "当月", "前月", "増減", "比較軸"],
        &formats.header,
    )?;
    let mut row = 1;
    for driver in &report.top_category_drivers {
        write_text(sheet, row, 0, "CATEGORY", &Format::new())?;
        write_text(sheet, row, 1, &driver.name, &Format::new())?;
        write_text(sheet, row, 2, &driver.id, &Format::new())?;
        write_i64(sheet, row, 3, driver.current_jpy, &formats.yen)?;
        write_i64(sheet, row, 4, driver.previous_jpy, &formats.yen)?;
        write_i64(sheet, row, 5, driver.delta_jpy, &formats.yen)?;
        write_text(sheet, row, 6, "PRIOR_MONTH", &Format::new())?;
        row += 1;
    }
    for driver in &report.top_merchant_drivers {
        write_text(sheet, row, 0, "MERCHANT", &Format::new())?;
        write_text(sheet, row, 1, &driver.merchant, &Format::new())?;
        write_text(sheet, row, 2, "", &Format::new())?;
        write_i64(sheet, row, 3, driver.current_jpy, &formats.yen)?;
        write_i64(sheet, row, 4, driver.previous_jpy, &formats.yen)?;
        write_i64(sheet, row, 5, driver.delta_jpy, &formats.yen)?;
        write_text(sheet, row, 6, "PRIOR_MONTH", &Format::new())?;
        row += 1;
    }
    sheet.set_freeze_panes(1, 0)?;
    if row > 1 {
        sheet.autofilter(0, 0, row - 1, 6)?;
    }
    Ok(())
}

fn write_health_sheet(
    workbook: &mut Workbook,
    report: &MonthlyFinancialReportDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Health")?;
    sheet.set_column_width(0, 22)?;
    sheet.set_column_width(1, 30)?;
    sheet.set_column_width(2, 20)?;
    sheet.set_column_width(3, 46)?;
    write_headers(
        sheet,
        0,
        &["セクション", "指標", "値", "注記"],
        &formats.header,
    )?;
    let mut row = 1;
    for (section, metric, value, note) in [
        ("予算", "予算", report.budget.budget_jpy, ""),
        ("予算", "実績", report.budget.actual_jpy, ""),
        ("予算", "残額", report.budget.remaining_jpy, ""),
        ("目標", "目標額", report.goals.target_jpy, ""),
        ("目標", "貯蓄済み", report.goals.saved_jpy, ""),
        ("目標", "残額", report.goals.remaining_jpy, ""),
        (
            "カード照合",
            "引落合計",
            report.reconciliation.payment_total_jpy,
            "銀行引落は支出に二重計上しません",
        ),
    ] {
        write_text(sheet, row, 0, section, &Format::new())?;
        write_text(sheet, row, 1, metric, &formats.label)?;
        write_i64(sheet, row, 2, value, &formats.yen)?;
        write_text(sheet, row, 3, note, &Format::new())?;
        row += 1;
    }
    for (section, metric, value) in [
        ("予算", "カテゴリー数", report.budget.category_count),
        ("予算", "予算超過数", report.budget.over_budget_count),
        ("目標", "有効目標数", report.goals.active_count),
        (
            "目標",
            "期限間近の目標",
            report.goals.due_within_period_count,
        ),
        (
            "カード照合",
            "カード明細総数",
            report.reconciliation.total_statements,
        ),
        (
            "カード照合",
            "照合済みカード明細",
            report.reconciliation.fully_reconciled,
        ),
        (
            "カード照合",
            "照合候補",
            report.reconciliation.possible_matches,
        ),
        (
            "カード照合",
            "部分照合",
            report.reconciliation.partially_reconciled,
        ),
        (
            "カード照合",
            "未照合カード明細",
            report.reconciliation.unmatched,
        ),
        ("カード照合", "不一致", report.reconciliation.mismatch_count),
        ("データ品質", "取込総数", report.data_quality.total_imports),
        (
            "データ品質",
            "反映済み取込",
            report.data_quality.posted_imports,
        ),
        (
            "データ品質",
            "確認待ち取込",
            report.data_quality.review_required_imports,
        ),
        ("データ品質", "失敗取込", report.data_quality.failed_imports),
        (
            "データ品質",
            "処理中取込",
            report.data_quality.in_progress_imports,
        ),
    ] {
        write_text(sheet, row, 0, section, &Format::new())?;
        write_text(sheet, row, 1, metric, &formats.label)?;
        write_u64(sheet, row, 2, value, &formats.integer)?;
        row += 1;
    }
    for (section, metric, value) in [
        ("予算", "予算使用率", report.budget.utilization_bps),
        (
            "データ品質",
            "取込完了率",
            report.data_quality.import_completion_bps,
        ),
    ] {
        write_text(sheet, row, 0, section, &Format::new())?;
        write_text(sheet, row, 1, metric, &formats.label)?;
        write_optional_rate(sheet, row, 2, value, &formats.percent)?;
        row += 1;
    }
    write_text(sheet, row, 0, "データ品質", &Format::new())?;
    write_text(sheet, row, 1, "最終取込", &formats.label)?;
    write_text(
        sheet,
        row,
        2,
        report
            .data_quality
            .latest_imported_at
            .as_deref()
            .unwrap_or("—"),
        &Format::new(),
    )?;
    row += 1;
    write_text(sheet, row, 0, "データ品質", &Format::new())?;
    write_text(sheet, row, 1, "最終取込からの日数", &formats.label)?;
    match report.data_quality.stale_days {
        Some(value) => write_i64(sheet, row, 2, value, &formats.integer)?,
        None => write_text(sheet, row, 2, "—", &Format::new())?,
    }
    row += 1;
    write_text(sheet, row, 0, "データ品質", &Format::new())?;
    write_text(sheet, row, 1, "未解決の取込", &formats.label)?;
    write_text(
        sheet,
        row,
        2,
        if report.data_quality.has_unresolved_imports {
            "YES"
        } else {
            "NO"
        },
        &Format::new(),
    )?;
    row += 1;
    write_text(sheet, row + 1, 0, "集計範囲と制約", &formats.section)?;
    write_text(
        sheet,
        row + 2,
        0,
        "計算対象の確定取引だけを当月・前月・前年同月の比較に使用します。",
        &Format::new(),
    )?;
    write_text(
        sheet,
        row + 3,
        0,
        "未取込・確認待ち・失敗したデータは集計に含まれません。",
        &Format::new(),
    )?;
    sheet.set_freeze_panes(1, 0)?;
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
            "Monthly review workbook cell is too long".to_owned(),
        ));
    }
    sheet.write_string_with_format(row, column, value, format)?;
    Ok(())
}

fn write_i64(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: i64,
    format: &Format,
) -> Result<(), XlsxError> {
    if value.unsigned_abs() > EXCEL_MAX_EXACT_INTEGER {
        return Err(XlsxError::ParameterError(
            "Monthly review workbook number is too large".to_owned(),
        ));
    }
    sheet.write_number_with_format(row, column, value as f64, format)?;
    Ok(())
}

fn write_u64(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: u64,
    format: &Format,
) -> Result<(), XlsxError> {
    if value > EXCEL_MAX_EXACT_INTEGER {
        return Err(XlsxError::ParameterError(
            "Monthly review workbook number is too large".to_owned(),
        ));
    }
    sheet.write_number_with_format(row, column, value as f64, format)?;
    Ok(())
}

fn write_optional_rate(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    rate_bps: Option<i64>,
    format: &Format,
) -> Result<(), XlsxError> {
    match rate_bps {
        Some(value) => {
            if value.unsigned_abs() > EXCEL_MAX_EXACT_INTEGER {
                return Err(XlsxError::ParameterError(
                    "Monthly review workbook rate is too large".to_owned(),
                ));
            }
            sheet.write_number_with_format(row, column, value as f64 / 10_000.0, format)?;
        }
        None => {
            sheet.write_string(row, column, "—")?;
        }
    }
    Ok(())
}

fn write_dash(sheet: &mut Worksheet, row: u32, column: u16) -> Result<(), XlsxError> {
    sheet.write_string(row, column, "—")?;
    Ok(())
}

fn is_iso_month(value: &str) -> bool {
    value.len() == 7
        && value.as_bytes().get(4) == Some(&b'-')
        && value
            .bytes()
            .enumerate()
            .all(|(index, byte)| index == 4 || byte.is_ascii_digit())
        && value[5..7]
            .parse::<u8>()
            .is_ok_and(|month| (1..=12).contains(&month))
}

fn is_iso_date(value: &str) -> bool {
    if !(value.len() == 10
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value
            .bytes()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit()))
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

fn workbook_data_row_count(report: &MonthlyFinancialReportDto) -> u32 {
    // Summary metadata/KPIs, comparison rows, driver rows, complete health
    // disclosures, and two explicit limitations. Header and title rows are not counted.
    18 + report.top_category_drivers.len() as u32
        + report.top_merchant_drivers.len() as u32
        + 27
        + 2
}

fn workbook_error(error: XlsxError) -> FinancialCalendarError {
    match error {
        XlsxError::ParameterError(_) => {
            FinancialCalendarError::InvalidInput("Monthly review workbook data is invalid")
        }
        _ => FinancialCalendarError::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::financial_calendar::{
        BudgetStatusDto, CategoryDriverDto, DataQualitySummaryDto, GoalProgressSummaryDto,
        MerchantDriverDto, MetricDeltaDto, MetricDeltaSetDto, PeriodMetricsDto,
        ReconciliationSummaryDto,
    };
    use crate::record_scope::AttributionScope;
    use std::io::Read;
    use tempfile::tempdir;
    use zip::ZipArchive;

    fn metrics(income: i64, expense: i64, count: u64) -> PeriodMetricsDto {
        PeriodMetricsDto {
            income_jpy: income,
            expense_jpy: expense,
            savings_jpy: income - expense,
            savings_rate_bps: Some((income - expense) * 10_000 / income),
            posted_transaction_count: count,
        }
    }

    fn deltas(current: &PeriodMetricsDto, prior: &PeriodMetricsDto) -> MetricDeltaSetDto {
        MetricDeltaSetDto {
            income: MetricDeltaDto {
                amount_jpy: current.income_jpy - prior.income_jpy,
                rate_bps: Some(1_111),
            },
            expense: MetricDeltaDto {
                amount_jpy: current.expense_jpy - prior.expense_jpy,
                rate_bps: Some(667),
            },
            savings: MetricDeltaDto {
                amount_jpy: current.savings_jpy - prior.savings_jpy,
                rate_bps: Some(2_000),
            },
        }
    }

    fn report() -> MonthlyFinancialReportDto {
        let current = metrics(500_000, 320_000, 20);
        let prior_month = metrics(450_000, 300_000, 18);
        let prior_year = metrics(480_000, 310_000, 19);
        MonthlyFinancialReportDto {
            period: "2026-07".to_owned(),
            as_of: "2026-07-31".to_owned(),
            vs_prior_month: deltas(&current, &prior_month),
            vs_prior_year: deltas(&current, &prior_year),
            current,
            prior_month,
            prior_year,
            top_category_drivers: vec![CategoryDriverDto {
                id: "food".to_owned(),
                name: "食費".to_owned(),
                current_jpy: 70_000,
                previous_jpy: 60_000,
                delta_jpy: 10_000,
            }],
            top_merchant_drivers: vec![MerchantDriverDto {
                merchant: "生協".to_owned(),
                current_jpy: 50_000,
                previous_jpy: 40_000,
                delta_jpy: 10_000,
            }],
            budget: BudgetStatusDto {
                budget_jpy: 350_000,
                actual_jpy: 320_000,
                remaining_jpy: 30_000,
                utilization_bps: Some(9_143),
                category_count: 8,
                over_budget_count: 1,
            },
            goals: GoalProgressSummaryDto {
                active_count: 2,
                target_jpy: 2_000_000,
                saved_jpy: 900_000,
                remaining_jpy: 1_100_000,
                due_within_period_count: 1,
            },
            data_quality: DataQualitySummaryDto {
                total_imports: 20,
                posted_imports: 18,
                review_required_imports: 1,
                failed_imports: 1,
                in_progress_imports: 0,
                import_completion_bps: Some(9_000),
                latest_imported_at: Some("2026-07-13T10:00:00Z".to_owned()),
                stale_days: Some(1),
                has_unresolved_imports: true,
            },
            reconciliation: ReconciliationSummaryDto {
                total_statements: 2,
                fully_reconciled: 1,
                possible_matches: 1,
                partially_reconciled: 0,
                unmatched: 0,
                mismatch_count: 0,
                payment_total_jpy: 204_987,
            },
        }
    }

    fn request() -> MonthlyFinancialReportRequest {
        MonthlyFinancialReportRequest {
            household_id: "family".to_owned(),
            account_group_id: Some("daily-spending".to_owned()),
            attribution_scope: AttributionScope::Member {
                member_id: "member-1".to_owned(),
            },
            month: "2026-07".to_owned(),
            as_of: Some("2026-07-14".to_owned()),
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
    fn xlsx_has_expected_sheets_scope_comparisons_japanese_and_typed_values() {
        let document = generate_monthly_review_xlsx_from_report(&request(), &report()).unwrap();
        assert_eq!(
            document.media_type,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        assert_eq!(document.row_count, 49);
        assert_eq!(document.byte_size as usize, document.bytes().len());
        assert!(document.bytes().starts_with(b"PK"));
        assert_eq!(
            document.file_name,
            "kakeflow-monthly-household-review-2026-07-data-quality-as-of-2026-07-14.xlsx"
        );

        let workbook = zip_entry(document.bytes(), "xl/workbook.xml");
        for sheet in ["Summary", "Comparisons", "Drivers", "Health"] {
            assert!(workbook.contains(&format!("name=\"{sheet}\"")));
        }
        let strings = zip_entry(document.bytes(), "xl/sharedStrings.xml");
        for value in [
            "月次家計レビュー",
            "2026-07",
            "2026-07-14",
            "family",
            "daily-spending",
            "MEMBER",
            "member-1",
            "前月・前年同月",
            "目標・データ品質は世帯全体",
            "食費",
            "生協",
            "PRIOR_MONTH",
            "取込完了率",
            "未解決の取込",
        ] {
            assert!(strings.contains(value), "missing shared string {value}");
        }
        let summary = zip_entry(document.bytes(), "xl/worksheets/sheet1.xml");
        assert!(summary.contains("<c r=\"B12\" s="));
        assert!(summary.contains("<v>500000</v>"));
        assert!(!summary.contains("<c r=\"B12\" t=\"s\""));
        let comparisons = zip_entry(document.bytes(), "xl/worksheets/sheet2.xml");
        for value in ["500000", "450000", "50000", "480000", "20000"] {
            assert!(
                comparisons.contains(&format!("<v>{value}</v>")),
                "missing typed comparison value {value}"
            );
        }
        assert!(comparisons.contains("<c r=\"B2\" s="));
        assert!(!comparisons.contains("<c r=\"B2\" t=\"s\""));
        let drivers = zip_entry(document.bytes(), "xl/worksheets/sheet3.xml");
        assert!(drivers.contains("<v>70000</v>"));
        assert!(drivers.contains("<autoFilter ref=\"A1:G3\""));
        let health = zip_entry(document.bytes(), "xl/worksheets/sheet4.xml");
        for value in ["350000", "320000", "204987", "20", "18"] {
            assert!(
                health.contains(&format!("<v>{value}</v>")),
                "missing typed health value {value}"
            );
        }
    }

    #[test]
    fn cancellation_does_not_write_and_explicit_destination_is_valid_xlsx() {
        let document = generate_monthly_review_xlsx_from_report(&request(), &report()).unwrap();
        let directory = tempdir().unwrap();
        let destination = directory.path().join("monthly.xlsx");
        assert_eq!(
            save_monthly_review_xlsx_document(&document, None).unwrap(),
            None
        );
        assert!(!destination.exists());
        let saved = save_monthly_review_xlsx_document(&document, Some(&destination))
            .unwrap()
            .unwrap();
        assert_eq!(saved.sheet_count, 4);
        assert_eq!(saved.row_count, 49);
        assert_eq!(std::fs::read(&destination).unwrap(), document.bytes());
    }

    #[test]
    fn generator_rejects_period_mismatch_invalid_as_of_and_inexact_numbers() {
        let mut invalid_request = request();
        invalid_request.month = "2026-13".to_owned();
        assert!(generate_monthly_review_xlsx_from_report(&invalid_request, &report()).is_err());
        let mut invalid_request = request();
        invalid_request.as_of = Some("../../escape".to_owned());
        assert!(generate_monthly_review_xlsx_from_report(&invalid_request, &report()).is_err());
        let mut invalid_request = request();
        invalid_request.as_of = Some("2026-02-30".to_owned());
        assert!(generate_monthly_review_xlsx_from_report(&invalid_request, &report()).is_err());
        let mut invalid = report();
        invalid.current.income_jpy = EXCEL_MAX_EXACT_INTEGER as i64 + 1;
        assert!(generate_monthly_review_xlsx_from_report(&request(), &invalid).is_err());
    }
}
