use crate::financial_calendar::{
    monthly_report, FinancialCalendarError, MonthlyFinancialReportDto,
    MonthlyFinancialReportRequest,
};
use printpdf::{
    Color, FontId, Mm, Op, PaintMode, ParsedFont, PdfDocument, PdfFont, PdfFontHandle, PdfPage,
    PdfSaveOptions, Point, Pt, Rect, Rgb, TextItem,
};
use serde::Serialize;
use std::path::Path;

const NOTO_SANS_JP: &[u8] = include_bytes!("../generated-resources/fonts/NotoSansJP-wght.ttf");
const MAX_PDF_BYTES: usize = 16 * 1024 * 1024;
const MAX_CELL_TEXT_CHARS: usize = 512;
const MAX_RENDER_CHARS_PER_LINE: usize = 72;
const MAX_DRIVER_ROWS_PER_KIND: usize = 8;
const MAX_PDF_PAGES: usize = 16;
const MAX_EXACT_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone)]
pub struct MonthlyReviewPdfDocument {
    pub file_name: String,
    pub media_type: &'static str,
    pub page_count: u16,
    pub byte_size: u32,
    bytes: Vec<u8>,
}

impl MonthlyReviewPdfDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyReviewPdfSavedDto {
    pub file_name: String,
    pub page_count: u16,
    pub byte_size: u32,
}

#[derive(Clone, Copy)]
enum LineStyle {
    Title,
    Section,
    Body,
}

#[derive(Clone)]
struct PdfLine {
    style: LineStyle,
    text: String,
}

pub fn generate_monthly_review_pdf(
    connection: &rusqlite::Connection,
    request: &MonthlyFinancialReportRequest,
) -> Result<MonthlyReviewPdfDocument, FinancialCalendarError> {
    let report = monthly_report(connection, request)?;
    generate_monthly_review_pdf_from_report(request, &report)
}

pub fn generate_monthly_review_pdf_from_report(
    request: &MonthlyFinancialReportRequest,
    report: &MonthlyFinancialReportDto,
) -> Result<MonthlyReviewPdfDocument, FinancialCalendarError> {
    validate_report(request, report)?;
    let groups = report_groups(request, report)?;
    let pages = paginate(groups);
    if pages.is_empty() || pages.len() > MAX_PDF_PAGES || pages.len() > u16::MAX as usize {
        return Err(invalid());
    }

    let mut font_warnings = Vec::new();
    let font = ParsedFont::from_bytes(NOTO_SANS_JP, 0, &mut font_warnings)
        .ok_or(FinancialCalendarError::Unavailable)?;
    let mut pdf = PdfDocument::new("KakeFlow Monthly Household Review");
    // A stable resource id makes the generated object graph reproducible. `add_font`
    // intentionally assigns a random id, which is useful for document merging but not
    // for an export whose bytes are expected to be deterministic.
    let font_id = FontId("KakeFlowNotoSansJP".to_owned());
    pdf.resources
        .fonts
        .map
        .insert(font_id.clone(), PdfFont::new(font));
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
    let mut save_warnings = Vec::new();
    let mut bytes = pdf
        .with_pages(rendered)
        .save(&PdfSaveOptions::default(), &mut save_warnings);
    normalize_pdf_identifiers(&mut bytes)?;
    if !bytes.starts_with(b"%PDF-")
        || bytes.len() > MAX_PDF_BYTES
        || bytes.len() > u32::MAX as usize
    {
        return Err(invalid());
    }
    let as_of_suffix = request
        .as_of
        .as_deref()
        .map(|date| format!("-data-quality-as-of-{date}"))
        .unwrap_or_default();
    Ok(MonthlyReviewPdfDocument {
        file_name: format!(
            "kakeflow-monthly-household-review-{}{as_of_suffix}.pdf",
            report.period
        ),
        media_type: "application/pdf",
        page_count,
        byte_size: bytes.len() as u32,
        bytes,
    })
}

fn normalize_pdf_identifiers(bytes: &mut [u8]) -> Result<(), FinancialCalendarError> {
    let marker = b"/ID[(";
    let Some(start) = bytes
        .windows(marker.len())
        .position(|window| window == marker)
    else {
        return Err(FinancialCalendarError::Unavailable);
    };
    let mut cursor = start + marker.len();
    for _ in 0..2 {
        let Some(end_offset) = bytes[cursor..].iter().position(|byte| *byte == b')') else {
            return Err(FinancialCalendarError::Unavailable);
        };
        let end = cursor + end_offset;
        bytes[cursor..end].fill(b'0');
        cursor = end + 1;
        if bytes.get(cursor) == Some(&b'(') {
            cursor += 1;
        }
    }
    Ok(())
}

pub fn save_monthly_review_pdf_document(
    document: &MonthlyReviewPdfDocument,
    destination: Option<&Path>,
) -> Result<Option<MonthlyReviewPdfSavedDto>, FinancialCalendarError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.bytes())
        .map_err(|_| FinancialCalendarError::Unavailable)?;
    Ok(Some(MonthlyReviewPdfSavedDto {
        file_name: document.file_name.clone(),
        page_count: document.page_count,
        byte_size: document.byte_size,
    }))
}

fn report_groups(
    request: &MonthlyFinancialReportRequest,
    report: &MonthlyFinancialReportDto,
) -> Result<Vec<Vec<PdfLine>>, FinancialCalendarError> {
    let mut executive = Vec::new();
    push(
        &mut executive,
        LineStyle::Title,
        &format!("月次家計レビュー {}", report.period),
    )?;
    push(&mut executive, LineStyle::Section, "Executive Summary")?;
    push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 当月の貯蓄は {}、貯蓄率は {}です。",
            format_jpy(report.current.savings_jpy),
            format_rate(report.current.savings_rate_bps)
        ),
    )?;
    push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 支出は前月比 {}（{}）です。",
            format_jpy(report.vs_prior_month.expense.amount_jpy),
            format_rate(report.vs_prior_month.expense.rate_bps)
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
            "• 確認待ち取込 {}件、失敗取込 {}件、カード照合候補 {}件です。",
            report.data_quality.review_required_imports,
            report.data_quality.failed_imports,
            report.reconciliation.possible_matches
        ),
    )?;

    let mut overview = Vec::new();
    push(&mut overview, LineStyle::Title, "主要指標・期間比較")?;
    push(
        &mut overview,
        LineStyle::Body,
        &format!("対象月: {}", report.period),
    )?;
    push(&mut overview, LineStyle::Body, "集計基準: 発生ベース")?;
    push(
        &mut overview,
        LineStyle::Body,
        &format!(
            "データ品質基準日: {}",
            request.as_of.as_deref().unwrap_or("自動解決")
        ),
    )?;
    push(
        &mut overview,
        LineStyle::Body,
        &format!("世帯ID: {}", request.household_id),
    )?;
    push(
        &mut overview,
        LineStyle::Body,
        &format!(
            "口座グループID: {}",
            request.account_group_id.as_deref().unwrap_or("ALL")
        ),
    )?;
    push(
        &mut overview,
        LineStyle::Body,
        &format!("家族内帰属: {}", request.attribution_scope.sql_kind()),
    )?;
    push(
        &mut overview,
        LineStyle::Body,
        &format!(
            "帰属メンバーID: {}",
            request.attribution_scope.member_id().unwrap_or("—")
        ),
    )?;
    push(&mut overview, LineStyle::Body, "比較軸: 前月・前年同月")?;
    push(
        &mut overview,
        LineStyle::Body,
        "スコープ境界: 目標・データ品質は世帯全体",
    )?;
    push(&mut overview, LineStyle::Section, "当月の主要指標")?;
    for (label, value) in [
        ("収入", report.current.income_jpy),
        ("支出", report.current.expense_jpy),
        ("貯蓄", report.current.savings_jpy),
    ] {
        push(
            &mut overview,
            LineStyle::Body,
            &format!("{label}: {}", format_jpy(value)),
        )?;
    }
    push(
        &mut overview,
        LineStyle::Body,
        &format!("貯蓄率: {}", format_rate(report.current.savings_rate_bps)),
    )?;
    push(
        &mut overview,
        LineStyle::Body,
        &format!("確定取引件数: {}", report.current.posted_transaction_count),
    )?;
    push(&mut overview, LineStyle::Section, "比較")?;
    for (label, current, prior_month, mom, prior_year, yoy) in [
        (
            "収入",
            report.current.income_jpy,
            report.prior_month.income_jpy,
            &report.vs_prior_month.income,
            report.prior_year.income_jpy,
            &report.vs_prior_year.income,
        ),
        (
            "支出",
            report.current.expense_jpy,
            report.prior_month.expense_jpy,
            &report.vs_prior_month.expense,
            report.prior_year.expense_jpy,
            &report.vs_prior_year.expense,
        ),
        (
            "貯蓄",
            report.current.savings_jpy,
            report.prior_month.savings_jpy,
            &report.vs_prior_month.savings,
            report.prior_year.savings_jpy,
            &report.vs_prior_year.savings,
        ),
    ] {
        push(
            &mut overview,
            LineStyle::Body,
            &format!(
                "{label}: 当月 {} / 前月 {} / 前月比 {} ({}) / 前年同月 {} / 前年同月比 {} ({})",
                format_jpy(current),
                format_jpy(prior_month),
                format_jpy(mom.amount_jpy),
                format_rate(mom.rate_bps),
                format_jpy(prior_year),
                format_jpy(yoy.amount_jpy),
                format_rate(yoy.rate_bps)
            ),
        )?;
    }

    let mut planning = Vec::new();
    push(
        &mut planning,
        LineStyle::Title,
        "支出ドライバー・予算・目標",
    )?;
    push(
        &mut planning,
        LineStyle::Section,
        "カテゴリードライバー（比較軸: PRIOR_MONTH）",
    )?;
    if report.top_category_drivers.is_empty() {
        push(&mut planning, LineStyle::Body, "該当データなし")?;
    }
    for item in &report.top_category_drivers {
        push(
            &mut planning,
            LineStyle::Body,
            &format!(
                "{} [{}]: 当月 {} / 前月 {} / 増減 {}",
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
        "加盟店ドライバー（比較軸: PRIOR_MONTH）",
    )?;
    if report.top_merchant_drivers.is_empty() {
        push(&mut planning, LineStyle::Body, "該当データなし")?;
    }
    for item in &report.top_merchant_drivers {
        push(
            &mut planning,
            LineStyle::Body,
            &format!(
                "{}: 当月 {} / 前月 {} / 増減 {}",
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
    push(&mut health, LineStyle::Title, "データ品質・カード照合")?;
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
        format!(
            "未解決の取込: {}",
            if report.data_quality.has_unresolved_imports {
                "YES"
            } else {
                "NO"
            }
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
    let mut action_count = 0_u8;
    if report.data_quality.review_required_imports > 0 || report.data_quality.failed_imports > 0 {
        push(
            &mut health,
            LineStyle::Body,
            "• 確認待ち・失敗した取込を確認し、当月データを確定してください。",
        )?;
        action_count += 1;
    }
    if report.reconciliation.possible_matches > 0
        || report.reconciliation.partially_reconciled > 0
        || report.reconciliation.mismatch_count > 0
    {
        push(
            &mut health,
            LineStyle::Body,
            "• カード照合候補と不一致を確認し、銀行引落との対応を確定してください。",
        )?;
        action_count += 1;
    }
    if report.budget.over_budget_count > 0 {
        push(
            &mut health,
            LineStyle::Body,
            "• 予算超過カテゴリーの取引を開き、翌月予算または支出計画を見直してください。",
        )?;
        action_count += 1;
    }
    if action_count == 0 {
        push(
            &mut health,
            LineStyle::Body,
            "• 現時点で優先対応はありません。次回取込後に再確認してください。",
        )?;
    }
    push(
        &mut health,
        LineStyle::Section,
        "次回レビューで確認すること",
    )?;
    push(
        &mut health,
        LineStyle::Body,
        "当月の未解決取込とカード照合候補が解消したかを確認します。",
    )?;
    push(&mut health, LineStyle::Section, "集計範囲と制約")?;
    push(
        &mut health,
        LineStyle::Body,
        "銀行引落によるカード支払は支出に二重計上しません。",
    )?;
    push(
        &mut health,
        LineStyle::Body,
        "計算対象の確定取引だけを当月・前月・前年同月の比較に使用します。",
    )?;
    push(
        &mut health,
        LineStyle::Body,
        "未取込・確認待ち・失敗したデータは集計に含まれません。",
    )?;
    Ok(vec![executive, overview, planning, health])
}

fn push(
    lines: &mut Vec<PdfLine>,
    style: LineStyle,
    value: &str,
) -> Result<(), FinancialCalendarError> {
    if value.chars().count() > MAX_CELL_TEXT_CHARS {
        return Err(invalid());
    }
    let characters = value.chars().collect::<Vec<_>>();
    if characters.is_empty() {
        lines.push(PdfLine {
            style,
            text: " ".to_owned(),
        });
        return Ok(());
    }
    for chunk in characters.chunks(MAX_RENDER_CHARS_PER_LINE) {
        lines.push(PdfLine {
            style,
            text: chunk.iter().collect(),
        });
    }
    Ok(())
}

fn paginate(groups: Vec<Vec<PdfLine>>) -> Vec<Vec<PdfLine>> {
    let mut pages = Vec::new();
    for group in groups {
        let mut page = Vec::new();
        let mut remaining_mm = 264.0_f32;
        for line in group {
            let height = line_height_mm(line.style);
            if !page.is_empty() && remaining_mm - height < 15.0 {
                pages.push(std::mem::take(&mut page));
                remaining_mm = 264.0;
            }
            remaining_mm -= height;
            page.push(line);
        }
        if !page.is_empty() {
            pages.push(page);
        }
    }
    pages
}

fn render_page(
    lines: Vec<PdfLine>,
    page: usize,
    total: usize,
    font_id: &printpdf::FontId,
    executive_report: Option<&MonthlyFinancialReportDto>,
) -> PdfPage {
    let mut ops = Vec::new();
    if let Some(report) = executive_report {
        render_executive_visuals(&mut ops, report, font_id);
    }
    let mut y = 282.0_f32;
    for (line_index, line) in lines.into_iter().enumerate() {
        let (size, height) = match line.style {
            LineStyle::Title => (18.0, 10.0),
            LineStyle::Section => (12.0, 8.0),
            LineStyle::Body => (9.0, 5.8),
        };
        let text_color = if executive_report.is_some() && line_index <= 1 {
            rgb(0.96, 0.98, 1.0)
        } else if matches!(line.style, LineStyle::Title | LineStyle::Section) {
            rgb(0.10, 0.19, 0.27)
        } else {
            rgb(0.16, 0.19, 0.22)
        };
        ops.extend([
            Op::SetFillColor { col: text_color },
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
    ops.extend([
        Op::SetFillColor {
            col: rgb(0.38, 0.42, 0.46),
        },
        Op::StartTextSection,
        Op::SetTextCursor {
            pos: Point::new(Mm(168.0), Mm(9.0)),
        },
        Op::SetFont {
            font: PdfFontHandle::External(font_id.clone()),
            size: Pt(8.0),
        },
        Op::ShowText {
            items: vec![TextItem::Text(format!("KakeFlow  {page}/{total}"))],
        },
        Op::EndTextSection,
    ]);
    PdfPage::new(Mm(210.0), Mm(297.0), ops)
}

fn render_executive_visuals(
    ops: &mut Vec<Op>,
    report: &MonthlyFinancialReportDto,
    font_id: &FontId,
) {
    draw_rect(ops, 0.0, 267.0, 210.0, 30.0, rgb(0.08, 0.18, 0.26));
    draw_rect(ops, 15.0, 232.0, 180.0, 0.7, rgb(0.19, 0.47, 0.50));

    let cards = [
        ("収入", report.current.income_jpy),
        ("支出", report.current.expense_jpy),
        ("貯蓄", report.current.savings_jpy),
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
            8.0,
            label,
            rgb(0.35, 0.40, 0.44),
        );
        add_text(
            ops,
            font_id,
            x + 3.0,
            204.0,
            11.0,
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
        "当月・前月・前年同月の比較",
        rgb(0.10, 0.19, 0.27),
    );
    let series = [
        ("当月", rgb(0.19, 0.47, 0.50)),
        ("前月", rgb(0.43, 0.52, 0.58)),
        ("前年", rgb(0.68, 0.73, 0.76)),
    ];
    let metrics = [
        (
            "収入",
            [
                report.current.income_jpy,
                report.prior_month.income_jpy,
                report.prior_year.income_jpy,
            ],
        ),
        (
            "支出",
            [
                report.current.expense_jpy,
                report.prior_month.expense_jpy,
                report.prior_year.expense_jpy,
            ],
        ),
        (
            "貯蓄",
            [
                report.current.savings_jpy,
                report.prior_month.savings_jpy,
                report.prior_year.savings_jpy,
            ],
        ),
    ];
    let max_abs = metrics
        .iter()
        .flat_map(|(_, values)| values)
        .map(|value| value.unsigned_abs())
        .max()
        .unwrap_or(1)
        .max(1) as f32;
    let baseline_x = 88.0_f32;
    draw_rect(ops, baseline_x, 105.0, 0.45, 70.0, rgb(0.55, 0.59, 0.62));
    for (metric_index, (metric, values)) in metrics.into_iter().enumerate() {
        for (series_index, ((period, color), value)) in series.iter().zip(values).enumerate() {
            let row = metric_index * 3 + series_index;
            let y = 168.0 - row as f32 * 7.0;
            add_text(
                ops,
                font_id,
                15.0,
                y + 0.8,
                7.5,
                &format!("{metric} {period}"),
                rgb(0.26, 0.30, 0.33),
            );
            let width = value.unsigned_abs() as f32 / max_abs * 38.0;
            let x = if value < 0 {
                baseline_x - width
            } else {
                baseline_x
            };
            draw_rect(ops, x, y, width.max(0.6), 4.1, color.clone());
            add_text(
                ops,
                font_id,
                130.0,
                y + 0.8,
                7.5,
                &format_jpy(value),
                rgb(0.26, 0.30, 0.33),
            );
        }
    }
    add_text(
        ops,
        font_id,
        baseline_x - 2.0,
        100.0,
        7.0,
        "0",
        rgb(0.42, 0.46, 0.49),
    );
}

fn draw_rect(ops: &mut Vec<Op>, x: f32, y: f32, width: f32, height: f32, color: Color) {
    let mut rect = Rect::from_xywh(
        Mm(x).into_pt(),
        Mm(y).into_pt(),
        Mm(width).into_pt(),
        Mm(height).into_pt(),
    );
    rect.mode = Some(PaintMode::Fill);
    ops.push(Op::SetFillColor { col: color });
    ops.push(Op::DrawPolygon {
        polygon: rect.to_polygon(),
    });
}

fn add_text(
    ops: &mut Vec<Op>,
    font_id: &FontId,
    x: f32,
    y: f32,
    size: f32,
    text: &str,
    color: Color,
) {
    ops.extend([
        Op::SetFillColor { col: color },
        Op::StartTextSection,
        Op::SetTextCursor {
            pos: Point::new(Mm(x), Mm(y)),
        },
        Op::SetFont {
            font: PdfFontHandle::External(font_id.clone()),
            size: Pt(size),
        },
        Op::ShowText {
            items: vec![TextItem::Text(text.to_owned())],
        },
        Op::EndTextSection,
    ]);
}

fn rgb(r: f32, g: f32, b: f32) -> Color {
    Color::Rgb(Rgb {
        r,
        g,
        b,
        icc_profile: None,
    })
}

fn line_height_mm(style: LineStyle) -> f32 {
    match style {
        LineStyle::Title => 10.0,
        LineStyle::Section => 8.0,
        LineStyle::Body => 5.8,
    }
}

fn format_jpy(value: i64) -> String {
    let sign = if value < 0 { "-" } else { "" };
    let digits = value.unsigned_abs().to_string();
    let mut grouped = String::new();
    for (index, character) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(character);
    }
    format!("{sign}¥{grouped}")
}

fn format_rate(value: Option<i64>) -> String {
    value.map_or_else(
        || "—".to_owned(),
        |bps| {
            let sign = if bps < 0 { "-" } else { "" };
            let absolute = bps.unsigned_abs();
            format!("{sign}{}.{:01}%", absolute / 100, (absolute % 100) / 10)
        },
    )
}

fn validate_report(
    request: &MonthlyFinancialReportRequest,
    report: &MonthlyFinancialReportDto,
) -> Result<(), FinancialCalendarError> {
    if !is_iso_month(&request.month)
        || report.period != request.month
        || request
            .as_of
            .as_deref()
            .is_some_and(|date| !is_iso_date(date))
        || report.top_category_drivers.len() > MAX_DRIVER_ROWS_PER_KIND
        || report.top_merchant_drivers.len() > MAX_DRIVER_ROWS_PER_KIND
    {
        return Err(invalid());
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
    for value in all_text(request, report) {
        if value.chars().count() > MAX_CELL_TEXT_CHARS {
            return Err(invalid());
        }
    }
    Ok(())
}

fn all_amounts(report: &MonthlyFinancialReportDto) -> Vec<i64> {
    let mut values = vec![
        report.current.income_jpy,
        report.current.expense_jpy,
        report.current.savings_jpy,
        report.prior_month.income_jpy,
        report.prior_month.expense_jpy,
        report.prior_month.savings_jpy,
        report.prior_year.income_jpy,
        report.prior_year.expense_jpy,
        report.prior_year.savings_jpy,
        report.vs_prior_month.income.amount_jpy,
        report.vs_prior_month.expense.amount_jpy,
        report.vs_prior_month.savings.amount_jpy,
        report.vs_prior_year.income.amount_jpy,
        report.vs_prior_year.expense.amount_jpy,
        report.vs_prior_year.savings.amount_jpy,
        report.budget.budget_jpy,
        report.budget.actual_jpy,
        report.budget.remaining_jpy,
        report.goals.target_jpy,
        report.goals.saved_jpy,
        report.goals.remaining_jpy,
        report.reconciliation.payment_total_jpy,
    ];
    for item in &report.top_category_drivers {
        values.extend([item.current_jpy, item.previous_jpy, item.delta_jpy]);
    }
    for item in &report.top_merchant_drivers {
        values.extend([item.current_jpy, item.previous_jpy, item.delta_jpy]);
    }
    values
}

fn all_counts(report: &MonthlyFinancialReportDto) -> Vec<u64> {
    vec![
        report.current.posted_transaction_count,
        report.prior_month.posted_transaction_count,
        report.prior_year.posted_transaction_count,
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
    ]
}

fn all_text<'a>(
    request: &'a MonthlyFinancialReportRequest,
    report: &'a MonthlyFinancialReportDto,
) -> Vec<&'a str> {
    let mut values = vec![request.household_id.as_str(), report.period.as_str()];
    if let Some(value) = request.account_group_id.as_deref() {
        values.push(value);
    }
    if let Some(value) = request.attribution_scope.member_id() {
        values.push(value);
    }
    if let Some(value) = request.as_of.as_deref() {
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
    FinancialCalendarError::InvalidInput("Monthly review PDF data is invalid")
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
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

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

    #[test]
    fn pdf_is_deterministic_extractable_japanese_and_complete() {
        let first = generate_monthly_review_pdf_from_report(&request(), &report()).unwrap();
        let second = generate_monthly_review_pdf_from_report(&request(), &report()).unwrap();
        assert_eq!(first.media_type, "application/pdf");
        assert_eq!(
            first.file_name,
            "kakeflow-monthly-household-review-2026-07-data-quality-as-of-2026-07-14.pdf"
        );
        assert_eq!(first.bytes(), second.bytes());
        assert!(first.bytes().starts_with(b"%PDF-"));
        assert_eq!(
            format!("{:x}", Sha256::digest(NOTO_SANS_JP)),
            "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f"
        );
        assert!(first
            .bytes()
            .windows(b"KakeFlowNotoSansJP".len())
            .any(|window| window == b"KakeFlowNotoSansJP"));
        assert!(first.page_count >= 3);
        assert_eq!(first.byte_size as usize, first.bytes().len());
        if let Ok(destination) = std::env::var("KAKEFLOW_MONTHLY_REVIEW_PDF_FIXTURE") {
            let destination = std::path::PathBuf::from(destination);
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(destination, first.bytes()).unwrap();
        }
        let pages = pdf_extract::extract_text_from_mem_by_pages(first.bytes()).unwrap();
        assert_eq!(pages.len(), first.page_count as usize);
        let text = pages.join("\n");
        for value in [
            "月次家計レビュー",
            "Executive Summary",
            "当月・前月・前年同月の比較",
            "食費",
            "生協",
            "PRIOR_MONTH",
            "目標・データ品質は世帯全体",
            "銀行引落によるカード支払は支出に二重計上しません",
            "¥204,987",
        ] {
            assert!(text.contains(value), "missing extracted text {value}");
        }
    }

    #[test]
    fn cancellation_does_not_write_and_destination_matches_pdf() {
        let document = generate_monthly_review_pdf_from_report(&request(), &report()).unwrap();
        assert_eq!(
            save_monthly_review_pdf_document(&document, None).unwrap(),
            None
        );
        let directory = tempdir().unwrap();
        let destination = directory.path().join("monthly.pdf");
        let saved = save_monthly_review_pdf_document(&document, Some(&destination))
            .unwrap()
            .unwrap();
        assert_eq!(saved.page_count, document.page_count);
        assert_eq!(saved.byte_size, document.byte_size);
        assert_eq!(std::fs::read(destination).unwrap(), document.bytes());
    }

    #[test]
    fn generator_rejects_bad_period_date_long_text_driver_bound_and_large_number() {
        let mut invalid_request = request();
        invalid_request.month = "2026-13".to_owned();
        assert!(generate_monthly_review_pdf_from_report(&invalid_request, &report()).is_err());
        let mut invalid_request = request();
        invalid_request.as_of = Some("2026-02-30".to_owned());
        assert!(generate_monthly_review_pdf_from_report(&invalid_request, &report()).is_err());
        let mut invalid = report();
        invalid.top_merchant_drivers[0].merchant = "店".repeat(MAX_CELL_TEXT_CHARS + 1);
        assert!(generate_monthly_review_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.top_category_drivers = vec![invalid.top_category_drivers[0].clone(); 9];
        assert!(generate_monthly_review_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.current.income_jpy = MAX_EXACT_INTEGER as i64 + 1;
        assert!(generate_monthly_review_pdf_from_report(&request(), &invalid).is_err());
    }
}
