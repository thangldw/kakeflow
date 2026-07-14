use crate::financial_calendar::{
    yearly_report, AnnualMonthStatus, FinancialCalendarError, YearlyFinancialReportDto,
    YearlyFinancialReportRequest,
};
use crate::monthly_review_pdf::{
    add_text, draw_rect, format_jpy, format_rate, install_japanese_font, normalize_pdf_identifiers,
    paginate, push, rgb, LineStyle, PdfLine,
};
use printpdf::{
    FontId, Line, LinePoint, Mm, Op, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point,
    Pt, TextItem,
};
use serde::Serialize;
use std::path::Path;

const MAX_PDF_BYTES: usize = 16 * 1024 * 1024;
const MAX_CELL_TEXT_CHARS: usize = 512;
const MAX_DRIVER_ROWS_PER_KIND: usize = 8;
const MAX_PDF_PAGES: usize = 16;
const MAX_EXACT_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_ABSOLUTE_RATE_BPS: u64 = 1_000_000;

#[derive(Debug, Clone)]
pub struct AnnualReviewPdfDocument {
    pub file_name: String,
    pub media_type: &'static str,
    pub page_count: u16,
    pub byte_size: u32,
    bytes: Vec<u8>,
}

impl AnnualReviewPdfDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnnualReviewPdfSavedDto {
    pub file_name: String,
    pub page_count: u16,
    pub byte_size: u32,
}

pub fn generate_annual_review_pdf(
    connection: &rusqlite::Connection,
    request: &YearlyFinancialReportRequest,
) -> Result<AnnualReviewPdfDocument, FinancialCalendarError> {
    let report = yearly_report(connection, request)?;
    generate_annual_review_pdf_from_report(request, &report)
}

pub fn generate_annual_review_pdf_from_report(
    request: &YearlyFinancialReportRequest,
    report: &YearlyFinancialReportDto,
) -> Result<AnnualReviewPdfDocument, FinancialCalendarError> {
    validate_report(request, report)?;
    let pages = paginate(report_groups(request, report)?);
    if pages.is_empty() || pages.len() > MAX_PDF_PAGES || pages.len() > u16::MAX as usize {
        return Err(invalid());
    }

    let mut pdf = PdfDocument::new("KakeFlow Annual Household Review");
    let font_id = install_japanese_font(&mut pdf)?;
    let page_count = pages.len() as u16;
    let rendered = pages
        .into_iter()
        .enumerate()
        .map(|(index, lines)| {
            render_page(
                lines,
                index + 1,
                page_count as usize,
                &font_id,
                (index == 0).then_some(report),
            )
        })
        .collect::<Vec<_>>();
    let mut warnings = Vec::new();
    let mut bytes = pdf
        .with_pages(rendered)
        .save(&PdfSaveOptions::default(), &mut warnings);
    normalize_pdf_identifiers(&mut bytes)?;
    if !bytes.starts_with(b"%PDF-")
        || bytes.len() > MAX_PDF_BYTES
        || bytes.len() > u32::MAX as usize
    {
        return Err(invalid());
    }
    Ok(AnnualReviewPdfDocument {
        file_name: format!(
            "kakeflow-annual-household-review-{}-as-of-{}.pdf",
            report.period, report.as_of
        ),
        media_type: "application/pdf",
        page_count,
        byte_size: bytes.len() as u32,
        bytes,
    })
}

pub fn save_annual_review_pdf_document(
    document: &AnnualReviewPdfDocument,
    destination: Option<&Path>,
) -> Result<Option<AnnualReviewPdfSavedDto>, FinancialCalendarError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.bytes())
        .map_err(|_| FinancialCalendarError::Unavailable)?;
    Ok(Some(AnnualReviewPdfSavedDto {
        file_name: document.file_name.clone(),
        page_count: document.page_count,
        byte_size: document.byte_size,
    }))
}

fn report_groups(
    request: &YearlyFinancialReportRequest,
    report: &YearlyFinancialReportDto,
) -> Result<Vec<Vec<PdfLine>>, FinancialCalendarError> {
    let mut executive = Vec::new();
    push(&mut executive, LineStyle::Title, "年次家計レビュー")?;
    push(&mut executive, LineStyle::Section, "Executive Summary")?;
    push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 比較可能期間の貯蓄は {}、貯蓄率は {}です。",
            format_jpy(report.current_comparable.savings_jpy),
            format_rate(report.current_comparable.savings_rate_bps)
        ),
    )?;
    push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 支出は前年同期間比 {}（{}）です。",
            format_jpy(report.vs_prior_year_comparable.expense.amount_jpy),
            format_rate(report.vs_prior_year_comparable.expense.rate_bps)
        ),
    )?;
    push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 予算残額は {}、予算使用率は {}です。",
            format_jpy(report.budget.remaining_jpy),
            format_rate(report.budget.utilization_bps)
        ),
    )?;
    push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 完了月 {}か月、確認待ち取込 {}件、未照合明細 {}件です。",
            report.completed_month_count,
            report.data_quality.review_required_imports,
            report.reconciliation.unmatched
        ),
    )?;

    let mut comparison = Vec::new();
    push(&mut comparison, LineStyle::Title, "期間比較・月次明細")?;
    for (label, value) in [
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
    ] {
        push(
            &mut comparison,
            LineStyle::Body,
            &format!("{label}: {value}"),
        )?;
    }
    push(&mut comparison, LineStyle::Section, "当年 / 前年同期間")?;
    for (label, current, prior, delta, rate) in [
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
    ] {
        push(
            &mut comparison,
            LineStyle::Body,
            &format!(
                "{label}: 当年 {} / 前年同期間 {} / 増減 {} ({})",
                format_jpy(current),
                format_jpy(prior),
                format_jpy(delta),
                format_rate(rate)
            ),
        )?;
    }
    push(&mut comparison, LineStyle::Section, "12か月推移データ")?;
    for month in &report.months {
        push(
            &mut comparison,
            LineStyle::Body,
            &format!(
                "{} [{}]: 収入 {} / 支出 {} / 貯蓄 {} / 貯蓄率 {} / 確定取引 {}件",
                month.month,
                month_status(month.status),
                format_jpy(month.metrics.income_jpy),
                format_jpy(month.metrics.expense_jpy),
                format_jpy(month.metrics.savings_jpy),
                format_rate(month.metrics.savings_rate_bps),
                month.metrics.posted_transaction_count
            ),
        )?;
    }

    let mut planning = Vec::new();
    push(&mut planning, LineStyle::Title, "ドライバー・予算・目標")?;
    push(
        &mut planning,
        LineStyle::Section,
        "カテゴリードライバー（前年同期間比較）",
    )?;
    if report.top_category_drivers.is_empty() {
        push(&mut planning, LineStyle::Body, "該当データなし")?;
    }
    for item in &report.top_category_drivers {
        push(
            &mut planning,
            LineStyle::Body,
            &format!(
                "{} [{}]: 当年 {} / 前年同期間 {} / 増減 {}",
                item.name,
                item.id,
                format_jpy(item.current_jpy),
                format_jpy(item.previous_jpy),
                format_jpy(item.delta_jpy)
            ),
        )?;
    }
    push(
        &mut planning,
        LineStyle::Section,
        "加盟店ドライバー（前年同期間比較）",
    )?;
    if report.top_merchant_drivers.is_empty() {
        push(&mut planning, LineStyle::Body, "該当データなし")?;
    }
    for item in &report.top_merchant_drivers {
        push(
            &mut planning,
            LineStyle::Body,
            &format!(
                "{}: 当年 {} / 前年同期間 {} / 増減 {}",
                item.merchant,
                format_jpy(item.current_jpy),
                format_jpy(item.previous_jpy),
                format_jpy(item.delta_jpy)
            ),
        )?;
    }
    push(&mut planning, LineStyle::Section, "予算")?;
    for line in [
        format!("予算: {}", format_jpy(report.budget.budget_jpy)),
        format!("実績: {}", format_jpy(report.budget.actual_jpy)),
        format!("残額: {}", format_jpy(report.budget.remaining_jpy)),
        format!("予算使用率: {}", format_rate(report.budget.utilization_bps)),
        format!("カテゴリー数: {}", report.budget.category_count),
        format!("予算超過数: {}", report.budget.over_budget_count),
    ] {
        push(&mut planning, LineStyle::Body, &line)?;
    }
    push(&mut planning, LineStyle::Section, "貯蓄目標（世帯全体）")?;
    for line in [
        format!("有効目標数: {}", report.goals.active_count),
        format!("目標額: {}", format_jpy(report.goals.target_jpy)),
        format!("貯蓄済み: {}", format_jpy(report.goals.saved_jpy)),
        format!("残額: {}", format_jpy(report.goals.remaining_jpy)),
        format!("期限間近の目標: {}", report.goals.due_within_period_count),
    ] {
        push(&mut planning, LineStyle::Body, &line)?;
    }

    let mut health = Vec::new();
    push(&mut health, LineStyle::Title, "品質・照合・次のアクション")?;
    push(&mut health, LineStyle::Section, "データ品質（世帯全体）")?;
    for line in [
        format!("取込総数: {}", report.data_quality.total_imports),
        format!("反映済み取込: {}", report.data_quality.posted_imports),
        format!(
            "確認待ち取込: {}",
            report.data_quality.review_required_imports
        ),
        format!("失敗取込: {}", report.data_quality.failed_imports),
        format!("処理中取込: {}", report.data_quality.in_progress_imports),
        format!(
            "取込完了率: {}",
            format_rate(report.data_quality.import_completion_bps)
        ),
        format!(
            "最終取込: {}",
            report
                .data_quality
                .latest_imported_at
                .as_deref()
                .unwrap_or("—")
        ),
        format!(
            "最終取込からの日数: {}",
            report
                .data_quality
                .stale_days
                .map_or_else(|| "—".to_owned(), |value| value.to_string())
        ),
    ] {
        push(&mut health, LineStyle::Body, &line)?;
    }
    push(&mut health, LineStyle::Section, "カード照合")?;
    for line in [
        format!("カード明細総数: {}", report.reconciliation.total_statements),
        format!("照合済み: {}", report.reconciliation.fully_reconciled),
        format!("照合候補: {}", report.reconciliation.possible_matches),
        format!("部分照合: {}", report.reconciliation.partially_reconciled),
        format!("未照合: {}", report.reconciliation.unmatched),
        format!("不一致: {}", report.reconciliation.mismatch_count),
        format!(
            "銀行引落合計: {}",
            format_jpy(report.reconciliation.payment_total_jpy)
        ),
    ] {
        push(&mut health, LineStyle::Body, &line)?;
    }
    push(&mut health, LineStyle::Section, "推奨アクション")?;
    for action in recommended_actions(report) {
        push(&mut health, LineStyle::Body, &format!("• {action}"))?;
    }
    push(&mut health, LineStyle::Section, "集計範囲と制約")?;
    for caveat in [
        "比較は基準日時点で完了した月までの前年同期間比較です。PARTIAL/FUTURE月は年間比較から除外します。",
        "月次推移のFUTUREは未確定の0値であり、実績ゼロを意味しません。",
        "計算対象の確定取引だけを集計し、未取込・確認待ち・失敗データは含みません。",
        "目標・データ品質は世帯全体の値です。",
        "銀行引落によるカード支払は支出に二重計上しません。",
    ] {
        push(&mut health, LineStyle::Body, caveat)?;
    }
    Ok(vec![executive, comparison, planning, health])
}

fn recommended_actions(report: &YearlyFinancialReportDto) -> Vec<String> {
    let mut actions = Vec::new();
    let unresolved = report.data_quality.review_required_imports
        + report.data_quality.failed_imports
        + report.data_quality.in_progress_imports;
    if unresolved > 0 {
        actions.push(format!("未解決の取込 {unresolved}件を確認する。"));
    }
    let card_issues = report.reconciliation.possible_matches
        + report.reconciliation.partially_reconciled
        + report.reconciliation.unmatched
        + report.reconciliation.mismatch_count;
    if card_issues > 0 {
        actions.push(format!("カード照合の要確認 {card_issues}件を解消する。"));
    }
    if report.budget.over_budget_count > 0 {
        actions.push(format!(
            "予算超過 {}カテゴリーの支出ドライバーを見直す。",
            report.budget.over_budget_count
        ));
    }
    if report.goals.due_within_period_count > 0 {
        actions.push(format!(
            "期限間近の貯蓄目標 {}件の積立計画を確認する。",
            report.goals.due_within_period_count
        ));
    }
    if actions.is_empty() {
        actions.push("未解決項目はありません。次年度の予算と目標を更新する。".to_owned());
    }
    actions
}

fn render_page(
    lines: Vec<PdfLine>,
    page: usize,
    total: usize,
    font_id: &FontId,
    executive_report: Option<&YearlyFinancialReportDto>,
) -> PdfPage {
    let mut ops = Vec::new();
    if let Some(report) = executive_report {
        render_executive_visuals(&mut ops, report, font_id);
    }
    let mut y = 282.0_f32;
    for (index, line) in lines.into_iter().enumerate() {
        let (size, height) = match line.style {
            LineStyle::Title => (18.0, 10.0),
            LineStyle::Section => (12.0, 8.0),
            LineStyle::Body => (9.0, 5.8),
        };
        let color = if executive_report.is_some() && index <= 1 {
            rgb(0.96, 0.98, 1.0)
        } else if matches!(line.style, LineStyle::Title | LineStyle::Section) {
            rgb(0.10, 0.19, 0.27)
        } else {
            rgb(0.16, 0.19, 0.22)
        };
        ops.extend([
            Op::SetFillColor { col: color },
            Op::StartTextSection,
            Op::SetTextCursor {
                pos: Point::new(Mm(15.0), Mm(y)),
            },
            Op::SetFont {
                font: PdfFontHandle::External(font_id.clone()),
                size: Pt(size),
            },
            Op::ShowText {
                items: vec![TextItem::Text(line.text)],
            },
            Op::EndTextSection,
        ]);
        y -= height;
    }
    add_text(
        &mut ops,
        font_id,
        168.0,
        9.0,
        8.0,
        &format!("KakeFlow  {page}/{total}"),
        rgb(0.38, 0.42, 0.46),
    );
    PdfPage::new(Mm(210.0), Mm(297.0), ops)
}

fn render_executive_visuals(
    ops: &mut Vec<Op>,
    report: &YearlyFinancialReportDto,
    font_id: &FontId,
) {
    draw_rect(ops, 0.0, 267.0, 210.0, 30.0, rgb(0.08, 0.18, 0.26));
    draw_rect(ops, 15.0, 232.0, 180.0, 0.7, rgb(0.19, 0.47, 0.50));
    let cards = [
        ("比較期間の収入", report.current_comparable.income_jpy),
        ("比較期間の支出", report.current_comparable.expense_jpy),
        ("比較期間の貯蓄", report.current_comparable.savings_jpy),
        ("予算残額", report.budget.remaining_jpy),
    ];
    for (index, (label, value)) in cards.into_iter().enumerate() {
        let x = 15.0 + index as f32 * 46.0;
        draw_rect(ops, x, 197.0, 42.0, 25.0, rgb(0.94, 0.96, 0.97));
        add_text(
            ops,
            font_id,
            x + 3.0,
            214.0,
            7.2,
            label,
            rgb(0.35, 0.40, 0.44),
        );
        add_text(
            ops,
            font_id,
            x + 3.0,
            204.0,
            10.0,
            &format_jpy(value),
            rgb(0.08, 0.18, 0.26),
        );
    }
    add_text(
        ops,
        font_id,
        15.0,
        185.0,
        11.0,
        "12か月の収入・支出・貯蓄推移",
        rgb(0.10, 0.19, 0.27),
    );
    render_trend_chart(ops, report, font_id);
}

fn render_trend_chart(ops: &mut Vec<Op>, report: &YearlyFinancialReportDto, font_id: &FontId) {
    let plot_left = 24.0_f32;
    let plot_right = 194.0_f32;
    let plot_bottom = 103.0_f32;
    let plot_top = 174.0_f32;
    let included = report
        .months
        .iter()
        .filter(|month| month.status == AnnualMonthStatus::Complete)
        .collect::<Vec<_>>();
    let min_value = included
        .iter()
        .flat_map(|month| {
            [
                month.metrics.income_jpy,
                month.metrics.expense_jpy,
                month.metrics.savings_jpy,
            ]
        })
        .min()
        .unwrap_or(0)
        .min(0);
    let max_value = included
        .iter()
        .flat_map(|month| {
            [
                month.metrics.income_jpy,
                month.metrics.expense_jpy,
                month.metrics.savings_jpy,
            ]
        })
        .max()
        .unwrap_or(1)
        .max(1);
    let span = (max_value as f64 - min_value as f64).max(1.0);
    let x_for = |index: usize| plot_left + index as f32 * (plot_right - plot_left) / 11.0;
    let y_for = |value: i64| {
        plot_bottom + ((value as f64 - min_value as f64) / span) as f32 * (plot_top - plot_bottom)
    };
    let zero_y = y_for(0);
    draw_rect(
        ops,
        plot_left,
        zero_y,
        plot_right - plot_left,
        0.45,
        rgb(0.62, 0.65, 0.67),
    );
    for (label, selector, color) in [
        ("収入", 0_usize, rgb(0.19, 0.47, 0.50)),
        ("支出", 1_usize, rgb(0.43, 0.52, 0.58)),
        ("貯蓄", 2_usize, rgb(0.68, 0.73, 0.76)),
    ] {
        let points = report
            .months
            .iter()
            .enumerate()
            .filter(|(_, month)| month.status == AnnualMonthStatus::Complete)
            .map(|(index, month)| {
                let values = [
                    month.metrics.income_jpy,
                    month.metrics.expense_jpy,
                    month.metrics.savings_jpy,
                ];
                LinePoint {
                    p: Point::new(Mm(x_for(index)), Mm(y_for(values[selector]))),
                    bezier: false,
                }
            })
            .collect::<Vec<_>>();
        if points.len() >= 2 {
            ops.push(Op::SetOutlineColor { col: color.clone() });
            ops.push(Op::SetOutlineThickness { pt: Pt(1.2) });
            ops.push(Op::DrawLine {
                line: Line {
                    points,
                    is_closed: false,
                },
            });
        }
        let legend_x = 15.0 + selector as f32 * 28.0;
        draw_rect(ops, legend_x, 94.5, 6.0, 2.2, color);
        add_text(
            ops,
            font_id,
            legend_x + 8.0,
            94.3,
            7.3,
            label,
            rgb(0.28, 0.32, 0.35),
        );
    }
    for (index, month) in report.months.iter().enumerate() {
        let x = x_for(index);
        if month.status != AnnualMonthStatus::Complete {
            draw_rect(ops, x - 0.8, zero_y - 0.8, 1.6, 1.6, rgb(0.78, 0.80, 0.82));
        } else {
            for (value, color) in [
                (month.metrics.income_jpy, rgb(0.19, 0.47, 0.50)),
                (month.metrics.expense_jpy, rgb(0.43, 0.52, 0.58)),
                (month.metrics.savings_jpy, rgb(0.68, 0.73, 0.76)),
            ] {
                draw_rect(ops, x - 0.65, y_for(value) - 0.65, 1.3, 1.3, color);
            }
        }
        add_text(
            ops,
            font_id,
            x - 2.2,
            99.0,
            6.7,
            &format!("{:02}", index + 1),
            rgb(0.42, 0.46, 0.49),
        );
    }
    add_text(
        ops,
        font_id,
        109.0,
        94.3,
        7.0,
        "灰色点: PARTIAL/FUTURE（未確定）",
        rgb(0.42, 0.46, 0.49),
    );
}

fn validate_report(
    request: &YearlyFinancialReportRequest,
    report: &YearlyFinancialReportDto,
) -> Result<(), FinancialCalendarError> {
    if !is_year(&request.year)
        || !is_iso_date(&request.as_of)
        || report.period != request.year
        || report.as_of != request.as_of
        || report.months.len() != 12
        || report.top_category_drivers.len() > MAX_DRIVER_ROWS_PER_KIND
        || report.top_merchant_drivers.len() > MAX_DRIVER_ROWS_PER_KIND
        || report.current != report.current_comparable
        || report.prior_year != report.prior_year_comparable
        || report.vs_prior_year != report.vs_prior_year_comparable
    {
        return Err(invalid());
    }
    for (index, month) in report.months.iter().enumerate() {
        if month.month != format!("{}-{:02}", report.period, index + 1) {
            return Err(invalid());
        }
    }
    let completed = report
        .months
        .iter()
        .filter(|month| month.status == AnnualMonthStatus::Complete)
        .count();
    let expected_through = report
        .months
        .iter()
        .rev()
        .find(|month| month.status == AnnualMonthStatus::Complete)
        .map(|month| month.month.as_str());
    if completed != report.completed_month_count as usize
        || report.is_complete_year != (completed == 12)
        || report.through_month.as_deref() != expected_through
        || report
            .through_month
            .as_deref()
            .is_some_and(|month| !is_iso_month(month) || !month.starts_with(&report.period))
    {
        return Err(invalid());
    }
    let mut seen_non_complete = false;
    let mut seen_partial = false;
    let mut seen_future = false;
    for month in &report.months {
        match month.status {
            AnnualMonthStatus::Complete if seen_non_complete => return Err(invalid()),
            AnnualMonthStatus::Complete => {}
            AnnualMonthStatus::Partial if seen_partial || seen_future => return Err(invalid()),
            AnnualMonthStatus::Partial => {
                seen_non_complete = true;
                seen_partial = true;
            }
            AnnualMonthStatus::Future => {
                if month.metrics.income_jpy != 0
                    || month.metrics.expense_jpy != 0
                    || month.metrics.savings_jpy != 0
                    || month.metrics.savings_rate_bps.is_some()
                    || month.metrics.posted_transaction_count != 0
                {
                    return Err(invalid());
                }
                seen_non_complete = true;
                seen_future = true;
            }
        }
    }
    for value in all_amounts(report) {
        if value.unsigned_abs() > MAX_EXACT_INTEGER {
            return Err(invalid());
        }
    }
    for value in all_counts(report) {
        if value > MAX_EXACT_INTEGER {
            return Err(invalid());
        }
    }
    for rate in all_rates(report).into_iter().flatten() {
        if rate.unsigned_abs() > MAX_ABSOLUTE_RATE_BPS {
            return Err(invalid());
        }
    }
    for value in all_text(request, report) {
        if value.chars().count() > MAX_CELL_TEXT_CHARS {
            return Err(invalid());
        }
    }
    Ok(())
}

fn all_amounts(report: &YearlyFinancialReportDto) -> Vec<i64> {
    let mut values = Vec::new();
    for metrics in [&report.current_comparable, &report.prior_year_comparable] {
        values.extend([metrics.income_jpy, metrics.expense_jpy, metrics.savings_jpy]);
    }
    for delta in [
        &report.vs_prior_year_comparable.income,
        &report.vs_prior_year_comparable.expense,
        &report.vs_prior_year_comparable.savings,
    ] {
        values.push(delta.amount_jpy);
    }
    for month in &report.months {
        values.extend([
            month.metrics.income_jpy,
            month.metrics.expense_jpy,
            month.metrics.savings_jpy,
        ]);
    }
    for item in &report.top_category_drivers {
        values.extend([item.current_jpy, item.previous_jpy, item.delta_jpy]);
    }
    for item in &report.top_merchant_drivers {
        values.extend([item.current_jpy, item.previous_jpy, item.delta_jpy]);
    }
    values.extend([
        report.budget.budget_jpy,
        report.budget.actual_jpy,
        report.budget.remaining_jpy,
        report.goals.target_jpy,
        report.goals.saved_jpy,
        report.goals.remaining_jpy,
        report.reconciliation.payment_total_jpy,
    ]);
    values
}

fn all_counts(report: &YearlyFinancialReportDto) -> Vec<u64> {
    let mut values = vec![
        report.current_comparable.posted_transaction_count,
        report.prior_year_comparable.posted_transaction_count,
        report.budget.category_count,
        report.budget.over_budget_count,
        report.goals.active_count,
        report.goals.due_within_period_count,
        report.data_quality.total_imports,
        report.data_quality.posted_imports,
        report.data_quality.review_required_imports,
        report.data_quality.failed_imports,
        report.data_quality.in_progress_imports,
        report.reconciliation.total_statements,
        report.reconciliation.fully_reconciled,
        report.reconciliation.possible_matches,
        report.reconciliation.partially_reconciled,
        report.reconciliation.unmatched,
        report.reconciliation.mismatch_count,
    ];
    values.extend(
        report
            .months
            .iter()
            .map(|month| month.metrics.posted_transaction_count),
    );
    values
}

fn all_rates(report: &YearlyFinancialReportDto) -> Vec<Option<i64>> {
    let mut values = vec![
        report.current_comparable.savings_rate_bps,
        report.prior_year_comparable.savings_rate_bps,
        report.vs_prior_year_comparable.income.rate_bps,
        report.vs_prior_year_comparable.expense.rate_bps,
        report.vs_prior_year_comparable.savings.rate_bps,
        report.budget.utilization_bps,
        report.data_quality.import_completion_bps,
    ];
    values.extend(
        report
            .months
            .iter()
            .map(|month| month.metrics.savings_rate_bps),
    );
    values
}

fn all_text<'a>(
    request: &'a YearlyFinancialReportRequest,
    report: &'a YearlyFinancialReportDto,
) -> Vec<&'a str> {
    let mut values = vec![
        request.household_id.as_str(),
        request.year.as_str(),
        request.as_of.as_str(),
        report.period.as_str(),
        report.as_of.as_str(),
    ];
    if let Some(value) = request.account_group_id.as_deref() {
        values.push(value);
    }
    if let Some(value) = request.attribution_scope.member_id() {
        values.push(value);
    }
    if let Some(value) = report.through_month.as_deref() {
        values.push(value);
    }
    if let Some(value) = report.data_quality.latest_imported_at.as_deref() {
        values.push(value);
    }
    for item in &report.top_category_drivers {
        values.extend([item.id.as_str(), item.name.as_str()]);
    }
    for item in &report.top_merchant_drivers {
        values.push(item.merchant.as_str());
    }
    values
}

fn month_status(status: AnnualMonthStatus) -> &'static str {
    match status {
        AnnualMonthStatus::Complete => "COMPLETE",
        AnnualMonthStatus::Partial => "PARTIAL",
        AnnualMonthStatus::Future => "FUTURE",
    }
}

fn is_year(value: &str) -> bool {
    value.len() == 4 && value.bytes().all(|byte| byte.is_ascii_digit()) && value != "0000"
}

fn is_iso_month(value: &str) -> bool {
    value.len() == 7
        && value.as_bytes().get(4) == Some(&b'-')
        && is_year(&value[..4])
        && value[5..]
            .parse::<u8>()
            .is_ok_and(|month| (1..=12).contains(&month))
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

fn invalid() -> FinancialCalendarError {
    FinancialCalendarError::InvalidInput("Annual review PDF data is invalid")
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
    use tempfile::tempdir;

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
                        income_jpy: 430_000 + month as i64 * 20_000,
                        expense_jpy: 270_000 + month as i64 * 10_000,
                        savings_jpy: 160_000 + month as i64 * 10_000,
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
            current,
            prior_year: prior,
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

    #[test]
    fn annual_pdf_is_deterministic_extractable_japanese_and_complete() {
        let first = generate_annual_review_pdf_from_report(&request(), &report()).unwrap();
        let second = generate_annual_review_pdf_from_report(&request(), &report()).unwrap();
        if let Ok(path) = std::env::var("KAKEFLOW_ANNUAL_PDF_FIXTURE") {
            std::fs::write(path, first.bytes()).unwrap();
        }
        assert_eq!(first.bytes(), second.bytes());
        assert_eq!(first.media_type, "application/pdf");
        assert_eq!(
            first.file_name,
            "kakeflow-annual-household-review-2026-as-of-2026-07-14.pdf"
        );
        assert!(first.bytes().starts_with(b"%PDF-"));
        assert!(first.page_count >= 4);
        assert_eq!(first.byte_size as usize, first.bytes().len());
        let pages = pdf_extract::extract_text_from_mem_by_pages(first.bytes()).unwrap();
        assert_eq!(pages.len(), first.page_count as usize);
        let text = pages.join("\n");
        for value in [
            "年次家計レビュー",
            "Executive Summary",
            "12か月の収入・支出・貯蓄推移",
            "2026-12 [FUTURE]",
            "食費",
            "生協",
            "推奨アクション",
            "PARTIAL/FUTURE月は年間比較から除外します",
            "銀行引落によるカード支払は支出に二重計上しません",
            "¥840,000",
        ] {
            assert!(text.contains(value), "missing extracted text {value}");
        }
    }

    #[test]
    fn annual_pdf_cancellation_and_save_are_safe() {
        let document = generate_annual_review_pdf_from_report(&request(), &report()).unwrap();
        assert_eq!(
            save_annual_review_pdf_document(&document, None).unwrap(),
            None
        );
        let directory = tempdir().unwrap();
        let destination = directory.path().join("annual.pdf");
        let saved = save_annual_review_pdf_document(&document, Some(&destination))
            .unwrap()
            .unwrap();
        assert_eq!(saved.page_count, document.page_count);
        assert_eq!(saved.byte_size, document.byte_size);
        assert_eq!(std::fs::read(destination).unwrap(), document.bytes());
    }

    #[test]
    fn annual_pdf_rejects_bad_bounds_structure_and_aliases() {
        let mut invalid_request = request();
        invalid_request.year = "0000".to_owned();
        assert!(generate_annual_review_pdf_from_report(&invalid_request, &report()).is_err());
        let mut invalid_request = request();
        invalid_request.as_of = "2026-02-30".to_owned();
        assert!(generate_annual_review_pdf_from_report(&invalid_request, &report()).is_err());
        let mut invalid = report();
        invalid.months.pop();
        assert!(generate_annual_review_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.months[1].month = "2026-12".to_owned();
        assert!(generate_annual_review_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.current.income_jpy += 1;
        assert!(generate_annual_review_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.top_category_drivers = vec![invalid.top_category_drivers[0].clone(); 9];
        assert!(generate_annual_review_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.top_merchant_drivers[0].merchant = "店".repeat(MAX_CELL_TEXT_CHARS + 1);
        assert!(generate_annual_review_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.current_comparable.income_jpy = MAX_EXACT_INTEGER as i64 + 1;
        invalid.current.income_jpy = invalid.current_comparable.income_jpy;
        assert!(generate_annual_review_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.budget.utilization_bps = Some(MAX_ABSOLUTE_RATE_BPS as i64 + 1);
        assert!(generate_annual_review_pdf_from_report(&request(), &invalid).is_err());
    }
}
