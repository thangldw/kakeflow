use crate::financial_calendar::{
    yearly_report, AnnualMonthStatus, FinancialCalendarError, YearlyFinancialReportDto,
    YearlyFinancialReportRequest,
};
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, Worksheet, XlsxError};
use serde::Serialize;
use std::path::Path;

const MAX_XLSX_BYTES: usize = 8 * 1024 * 1024;
const MAX_CELL_TEXT_CHARS: usize = 512;
const MAX_DRIVER_ROWS: usize = 32;
const XLSX_SHEET_COUNT: u8 = 4;
const EXCEL_MAX_EXACT_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone)]
pub struct AnnualReviewXlsxDocument {
    pub file_name: String,
    pub media_type: &'static str,
    pub row_count: u32,
    pub byte_size: u32,
    bytes: Vec<u8>,
}

impl AnnualReviewXlsxDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnnualReviewXlsxSavedDto {
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

pub fn generate_annual_review_xlsx(
    connection: &rusqlite::Connection,
    request: &YearlyFinancialReportRequest,
) -> Result<AnnualReviewXlsxDocument, FinancialCalendarError> {
    let report = yearly_report(connection, request)?;
    generate_annual_review_xlsx_from_report(request, &report)
}

pub fn generate_annual_review_xlsx_from_report(
    request: &YearlyFinancialReportRequest,
    report: &YearlyFinancialReportDto,
) -> Result<AnnualReviewXlsxDocument, FinancialCalendarError> {
    if report.months.len() != 12
        || report.top_category_drivers.len() + report.top_merchant_drivers.len() > MAX_DRIVER_ROWS
    {
        return Err(FinancialCalendarError::InvalidInput(
            "Annual review workbook data is invalid",
        ));
    }

    let mut workbook = Workbook::new();
    let formats = WorkbookFormats::new();
    write_summary_sheet(&mut workbook, request, report, &formats).map_err(workbook_error)?;
    write_monthly_sheet(&mut workbook, report, &formats).map_err(workbook_error)?;
    write_drivers_sheet(&mut workbook, report, &formats).map_err(workbook_error)?;
    write_health_sheet(&mut workbook, report, &formats).map_err(workbook_error)?;

    let bytes = workbook.save_to_buffer().map_err(workbook_error)?;
    if bytes.len() > MAX_XLSX_BYTES || bytes.len() > u32::MAX as usize {
        return Err(FinancialCalendarError::InvalidInput(
            "Annual review workbook is too large",
        ));
    }
    Ok(AnnualReviewXlsxDocument {
        file_name: format!(
            "kakeflow-annual-household-review-{}-as-of-{}.xlsx",
            report.period, report.as_of
        ),
        media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        row_count: workbook_data_row_count(report),
        byte_size: bytes.len() as u32,
        bytes,
    })
}

pub fn save_annual_review_xlsx_document(
    document: &AnnualReviewXlsxDocument,
    destination: Option<&Path>,
) -> Result<Option<AnnualReviewXlsxSavedDto>, FinancialCalendarError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.bytes())
        .map_err(|_| FinancialCalendarError::Unavailable)?;
    Ok(Some(AnnualReviewXlsxSavedDto {
        file_name: document.file_name.clone(),
        row_count: document.row_count,
        byte_size: document.byte_size,
        sheet_count: XLSX_SHEET_COUNT,
    }))
}

fn write_summary_sheet(
    workbook: &mut Workbook,
    request: &YearlyFinancialReportRequest,
    report: &YearlyFinancialReportDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Summary")?;
    sheet.set_column_width(0, 24)?;
    sheet.set_column_width(1, 24)?;
    sheet.set_column_width(2, 18)?;
    sheet.set_column_width(3, 18)?;
    sheet.set_column_width(4, 16)?;
    write_text(sheet, 0, 0, "年次家計レビュー", &formats.title)?;
    for (row, (label, value)) in [
        ("対象年", report.period.as_str()),
        ("基準日", report.as_of.as_str()),
        (
            "比較対象の最終月",
            report.through_month.as_deref().unwrap_or("—"),
        ),
        (
            "年間ステータス",
            if report.is_complete_year {
                "COMPLETE"
            } else {
                "THROUGH_COMPLETE_MONTHS"
            },
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
    ]
    .into_iter()
    .enumerate()
    {
        write_text(sheet, row as u32 + 2, 0, label, &formats.label)?;
        write_text(sheet, row as u32 + 2, 1, value, &Format::new())?;
    }

    let header_row = 11;
    write_headers(
        sheet,
        header_row,
        &["指標", "当年", "前年同期間", "増減", "増減率"],
        &formats.header,
    )?;
    let metrics = [
        (
            "収入",
            report.current_comparable.income_jpy,
            report.prior_year_comparable.income_jpy,
            report.vs_prior_year_comparable.income.amount_jpy,
            report.vs_prior_year_comparable.income.rate_bps,
        ),
        (
            "支出",
            report.current_comparable.expense_jpy,
            report.prior_year_comparable.expense_jpy,
            report.vs_prior_year_comparable.expense.amount_jpy,
            report.vs_prior_year_comparable.expense.rate_bps,
        ),
        (
            "貯蓄",
            report.current_comparable.savings_jpy,
            report.prior_year_comparable.savings_jpy,
            report.vs_prior_year_comparable.savings.amount_jpy,
            report.vs_prior_year_comparable.savings.rate_bps,
        ),
    ];
    for (index, (label, current, previous, delta, rate)) in metrics.into_iter().enumerate() {
        let row = header_row + 1 + index as u32;
        write_text(sheet, row, 0, label, &formats.label)?;
        write_i64(sheet, row, 1, current, &formats.yen)?;
        write_i64(sheet, row, 2, previous, &formats.yen)?;
        write_i64(sheet, row, 3, delta, &formats.yen)?;
        write_optional_rate(sheet, row, 4, rate, &formats.percent)?;
    }
    let row = header_row + 4;
    write_text(sheet, row, 0, "貯蓄率", &formats.label)?;
    write_optional_rate(
        sheet,
        row,
        1,
        report.current_comparable.savings_rate_bps,
        &formats.percent,
    )?;
    write_optional_rate(
        sheet,
        row,
        2,
        report.prior_year_comparable.savings_rate_bps,
        &formats.percent,
    )?;
    write_text(sheet, row, 3, "—", &Format::new())?;
    write_text(sheet, row, 4, "—", &Format::new())?;
    let row = header_row + 5;
    write_text(sheet, row, 0, "確定取引件数", &formats.label)?;
    write_u64(
        sheet,
        row,
        1,
        report.current_comparable.posted_transaction_count,
        &formats.integer,
    )?;
    write_u64(
        sheet,
        row,
        2,
        report.prior_year_comparable.posted_transaction_count,
        &formats.integer,
    )?;
    sheet.set_freeze_panes(header_row + 1, 1)?;
    Ok(())
}

fn write_monthly_sheet(
    workbook: &mut Workbook,
    report: &YearlyFinancialReportDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Monthly")?;
    for (column, width) in [18.0, 16.0, 18.0, 18.0, 18.0, 14.0, 16.0]
        .into_iter()
        .enumerate()
    {
        sheet.set_column_width(column as u16, width)?;
    }
    write_headers(
        sheet,
        0,
        &[
            "月",
            "状態",
            "収入",
            "支出",
            "貯蓄",
            "貯蓄率",
            "確定取引件数",
        ],
        &formats.header,
    )?;
    for (index, point) in report.months.iter().enumerate() {
        let row = index as u32 + 1;
        write_text(sheet, row, 0, &point.month, &Format::new())?;
        write_text(sheet, row, 1, month_status(point.status), &Format::new())?;
        write_i64(sheet, row, 2, point.metrics.income_jpy, &formats.yen)?;
        write_i64(sheet, row, 3, point.metrics.expense_jpy, &formats.yen)?;
        write_i64(sheet, row, 4, point.metrics.savings_jpy, &formats.yen)?;
        write_optional_rate(
            sheet,
            row,
            5,
            point.metrics.savings_rate_bps,
            &formats.percent,
        )?;
        write_u64(
            sheet,
            row,
            6,
            point.metrics.posted_transaction_count,
            &formats.integer,
        )?;
    }
    sheet.set_freeze_panes(1, 0)?;
    sheet.autofilter(0, 0, report.months.len() as u32, 6)?;
    Ok(())
}

fn write_drivers_sheet(
    workbook: &mut Workbook,
    report: &YearlyFinancialReportDto,
    formats: &WorkbookFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Drivers")?;
    for (column, width) in [18.0, 30.0, 28.0, 18.0, 18.0, 18.0].into_iter().enumerate() {
        sheet.set_column_width(column as u16, width)?;
    }
    write_headers(
        sheet,
        0,
        &["種別", "名称", "ID", "当年", "前年同期間", "増減"],
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
        row += 1;
    }
    for driver in &report.top_merchant_drivers {
        write_text(sheet, row, 0, "MERCHANT", &Format::new())?;
        write_text(sheet, row, 1, &driver.merchant, &Format::new())?;
        write_text(sheet, row, 2, "", &Format::new())?;
        write_i64(sheet, row, 3, driver.current_jpy, &formats.yen)?;
        write_i64(sheet, row, 4, driver.previous_jpy, &formats.yen)?;
        write_i64(sheet, row, 5, driver.delta_jpy, &formats.yen)?;
        row += 1;
    }
    sheet.set_freeze_panes(1, 0)?;
    if row > 1 {
        sheet.autofilter(0, 0, row - 1, 5)?;
    }
    Ok(())
}

fn write_health_sheet(
    workbook: &mut Workbook,
    report: &YearlyFinancialReportDto,
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
        "計算対象の確定取引と完了した暦月だけを年間KPIと前年同期間比に使用します。",
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
            "Annual review workbook cell is too long".to_owned(),
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
            "Annual review workbook number is too large".to_owned(),
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
            "Annual review workbook number is too large".to_owned(),
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
            sheet.write_number_with_format(row, column, value as f64 / 10_000.0, format)?;
        }
        None => {
            sheet.write_string(row, column, "—")?;
        }
    }
    Ok(())
}

fn month_status(status: AnnualMonthStatus) -> &'static str {
    match status {
        AnnualMonthStatus::Complete => "COMPLETE",
        AnnualMonthStatus::Partial => "PARTIAL",
        AnnualMonthStatus::Future => "FUTURE",
    }
}

fn workbook_data_row_count(report: &YearlyFinancialReportDto) -> u32 {
    // Metadata/KPIs, twelve monthly points, driver rows, health metrics, and
    // the two explicit limitation disclosures. Header and title rows are not
    // counted so the value remains a stable count of exported data records.
    13 + report.months.len() as u32
        + report.top_category_drivers.len() as u32
        + report.top_merchant_drivers.len() as u32
        + 27
        + 2
}

fn workbook_error(error: XlsxError) -> FinancialCalendarError {
    match error {
        XlsxError::ParameterError(_) => {
            FinancialCalendarError::InvalidInput("Annual review workbook data is invalid")
        }
        _ => FinancialCalendarError::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::financial_calendar::{
        AnnualMonthPointDto, BudgetStatusDto, CategoryDriverDto, DataQualitySummaryDto,
        GoalProgressSummaryDto, MerchantDriverDto, MetricDeltaDto, MetricDeltaSetDto,
        PeriodMetricsDto, ReconciliationSummaryDto,
    };
    use crate::record_scope::AttributionScope;
    use std::io::Read;
    use tempfile::tempdir;
    use zip::ZipArchive;

    fn report() -> YearlyFinancialReportDto {
        let current = PeriodMetricsDto {
            income_jpy: 5_000_000,
            expense_jpy: 3_200_000,
            savings_jpy: 1_800_000,
            savings_rate_bps: Some(3_600),
            posted_transaction_count: 123,
        };
        let prior = PeriodMetricsDto {
            income_jpy: 4_800_000,
            expense_jpy: 3_000_000,
            savings_jpy: 1_800_000,
            savings_rate_bps: Some(3_750),
            posted_transaction_count: 118,
        };
        let delta = MetricDeltaSetDto {
            income: MetricDeltaDto {
                amount_jpy: 200_000,
                rate_bps: Some(417),
            },
            expense: MetricDeltaDto {
                amount_jpy: 200_000,
                rate_bps: Some(667),
            },
            savings: MetricDeltaDto {
                amount_jpy: 0,
                rate_bps: Some(0),
            },
        };
        let months = (1..=12)
            .map(|month| AnnualMonthPointDto {
                month: format!("2026-{month:02}"),
                status: if month <= 6 {
                    AnnualMonthStatus::Complete
                } else if month == 7 {
                    AnnualMonthStatus::Partial
                } else {
                    AnnualMonthStatus::Future
                },
                metrics: if month <= 6 {
                    PeriodMetricsDto {
                        income_jpy: 500_000,
                        expense_jpy: 320_000,
                        savings_jpy: 180_000,
                        savings_rate_bps: Some(3_600),
                        posted_transaction_count: 20,
                    }
                } else {
                    PeriodMetricsDto::default()
                },
            })
            .collect();
        YearlyFinancialReportDto {
            period: "2026".to_owned(),
            as_of: "2026-07-14".to_owned(),
            through_month: Some("2026-06".to_owned()),
            completed_month_count: 6,
            is_complete_year: false,
            current_comparable: current.clone(),
            prior_year_comparable: prior.clone(),
            vs_prior_year_comparable: delta.clone(),
            current: current.clone(),
            prior_year: prior.clone(),
            vs_prior_year: delta,
            months,
            top_category_drivers: vec![CategoryDriverDto {
                id: "food".to_owned(),
                name: "食費".to_owned(),
                current_jpy: 700_000,
                previous_jpy: 620_000,
                delta_jpy: 80_000,
            }],
            top_merchant_drivers: vec![MerchantDriverDto {
                merchant: "生協".to_owned(),
                current_jpy: 240_000,
                previous_jpy: 200_000,
                delta_jpy: 40_000,
            }],
            budget: BudgetStatusDto {
                budget_jpy: 3_500_000,
                actual_jpy: 3_200_000,
                remaining_jpy: 300_000,
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
                total_statements: 6,
                fully_reconciled: 5,
                possible_matches: 0,
                partially_reconciled: 0,
                unmatched: 1,
                mismatch_count: 0,
                payment_total_jpy: 840_000,
            },
        }
    }

    fn request() -> YearlyFinancialReportRequest {
        YearlyFinancialReportRequest {
            household_id: "family".to_owned(),
            account_group_id: Some("daily-spending".to_owned()),
            attribution_scope: AttributionScope::Member {
                member_id: "member-1".to_owned(),
            },
            year: "2026".to_owned(),
            as_of: "2026-07-14".to_owned(),
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
    fn xlsx_has_expected_sheets_scope_japanese_strings_and_typed_numbers() {
        let document = generate_annual_review_xlsx_from_report(&request(), &report()).unwrap();
        assert_eq!(
            document.media_type,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        assert_eq!(document.byte_size as usize, document.bytes().len());
        assert_eq!(document.row_count, 56);
        assert!(document.bytes().starts_with(b"PK"));

        let workbook = zip_entry(document.bytes(), "xl/workbook.xml");
        for sheet in ["Summary", "Monthly", "Drivers", "Health"] {
            assert!(workbook.contains(&format!("name=\"{sheet}\"")));
        }
        let strings = zip_entry(document.bytes(), "xl/sharedStrings.xml");
        for value in [
            "年次家計レビュー",
            "食費",
            "生協",
            "family",
            "daily-spending",
            "MEMBER",
            "member-1",
            "COMPLETE",
            "PARTIAL",
            "FUTURE",
        ] {
            assert!(strings.contains(value), "missing shared string {value}");
        }
        let summary = zip_entry(document.bytes(), "xl/worksheets/sheet1.xml");
        assert!(summary.contains("<c r=\"B13\" s="));
        assert!(summary.contains("<v>5000000</v>"));
        assert!(!summary.contains("<c r=\"B13\" t=\"s\""));
        let monthly = zip_entry(document.bytes(), "xl/worksheets/sheet2.xml");
        assert!(monthly.contains("<v>500000</v>"));
        assert!(monthly.contains("<autoFilter ref=\"A1:G13\""));
    }

    #[test]
    fn cancellation_does_not_write_and_explicit_destination_is_valid_xlsx() {
        let document = generate_annual_review_xlsx_from_report(&request(), &report()).unwrap();
        let directory = tempdir().unwrap();
        let destination = directory.path().join("review.xlsx");
        assert_eq!(
            save_annual_review_xlsx_document(&document, None).unwrap(),
            None
        );
        assert!(!destination.exists());
        let saved = save_annual_review_xlsx_document(&document, Some(&destination))
            .unwrap()
            .unwrap();
        assert_eq!(saved.sheet_count, 4);
        assert_eq!(std::fs::read(&destination).unwrap(), document.bytes());
    }

    #[test]
    fn generator_rejects_wrong_month_count_and_inexact_numbers() {
        let mut invalid = report();
        invalid.months.pop();
        assert!(generate_annual_review_xlsx_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.current_comparable.income_jpy = EXCEL_MAX_EXACT_INTEGER as i64 + 1;
        assert!(generate_annual_review_xlsx_from_report(&request(), &invalid).is_err());
    }
}
