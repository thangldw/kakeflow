use crate::investment_performance::{
    self, CorporateActionAllocationDto, InvestmentPerformanceDto, InvestmentPerformanceError,
    InvestmentPerformanceRequest, RealizedAllocationDto, UncoveredSaleDto,
};
use crate::monthly_review_pdf::{
    add_text, draw_rect, install_japanese_font, normalize_pdf_identifiers, paginate, push, rgb,
    LineStyle, PdfLine,
};
use printpdf::{
    FontId, Mm, Op, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point, Pt, TextItem,
};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::Path;
use thiserror::Error;

const MAX_PDF_BYTES: usize = 16 * 1024 * 1024;
const MAX_CELL_TEXT_CHARS: usize = 512;
const MAX_DATA_ROWS: usize = 320;
const MAX_CURRENCIES: usize = 8;
const MAX_PDF_PAGES: usize = 16;
const MAX_EXACT_NUMBER: f64 = 9_007_199_254_740_991.0;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InvestmentPerformancePdfError {
    #[error("investment performance PDF input is invalid")]
    Invalid,
    #[error("investment account is outside the household")]
    Scope,
    #[error("investment performance PDF is unavailable")]
    Unavailable,
}

impl InvestmentPerformancePdfError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::Invalid => "Investment performance PDF data is invalid",
            Self::Scope => "Investment account was not found",
            Self::Unavailable => "Investment performance PDF is temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone)]
pub struct InvestmentPerformancePdfDocument {
    pub file_name: String,
    pub media_type: &'static str,
    pub page_count: u16,
    pub byte_size: u32,
    bytes: Vec<u8>,
}

impl InvestmentPerformancePdfDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentPerformancePdfSavedDto {
    pub file_name: String,
    pub page_count: u16,
    pub byte_size: u32,
}

pub fn generate_investment_performance_pdf(
    connection: &rusqlite::Connection,
    request: &InvestmentPerformanceRequest,
) -> Result<InvestmentPerformancePdfDocument, InvestmentPerformancePdfError> {
    let report = investment_performance::query_performance(connection, request).map_err(
        |error| match error {
            InvestmentPerformanceError::Invalid => InvestmentPerformancePdfError::Invalid,
            InvestmentPerformanceError::Scope => InvestmentPerformancePdfError::Scope,
            InvestmentPerformanceError::Database => InvestmentPerformancePdfError::Unavailable,
        },
    )?;
    generate_investment_performance_pdf_from_report(request, &report)
}

pub fn generate_investment_performance_pdf_from_report(
    request: &InvestmentPerformanceRequest,
    report: &InvestmentPerformanceDto,
) -> Result<InvestmentPerformancePdfDocument, InvestmentPerformancePdfError> {
    validate_report(request, report)?;
    let pages = paginate(report_groups(request, report)?);
    if pages.is_empty() || pages.len() > MAX_PDF_PAGES || pages.len() > u16::MAX as usize {
        return Err(InvestmentPerformancePdfError::Invalid);
    }
    let mut pdf = PdfDocument::new("KakeFlow Investment Performance");
    let font_id =
        install_japanese_font(&mut pdf).map_err(|_| InvestmentPerformancePdfError::Unavailable)?;
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
    normalize_pdf_identifiers(&mut bytes)
        .map_err(|_| InvestmentPerformancePdfError::Unavailable)?;
    if !bytes.starts_with(b"%PDF-")
        || bytes.len() > MAX_PDF_BYTES
        || bytes.len() > u32::MAX as usize
    {
        return Err(InvestmentPerformancePdfError::Invalid);
    }
    let year = &request.date_from.as_deref().expect("validated dateFrom")[0..4];
    Ok(InvestmentPerformancePdfDocument {
        file_name: format!("kakeflow-investment-performance-{year}.pdf"),
        media_type: "application/pdf",
        page_count,
        byte_size: bytes.len() as u32,
        bytes,
    })
}

pub fn save_investment_performance_pdf_document(
    document: &InvestmentPerformancePdfDocument,
    destination: Option<&Path>,
) -> Result<Option<InvestmentPerformancePdfSavedDto>, InvestmentPerformancePdfError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.bytes())
        .map_err(|_| InvestmentPerformancePdfError::Unavailable)?;
    Ok(Some(InvestmentPerformancePdfSavedDto {
        file_name: document.file_name.clone(),
        page_count: document.page_count,
        byte_size: document.byte_size,
    }))
}

fn report_groups(
    request: &InvestmentPerformanceRequest,
    report: &InvestmentPerformanceDto,
) -> Result<Vec<Vec<PdfLine>>, InvestmentPerformancePdfError> {
    let mut executive = Vec::new();
    pdf_push(&mut executive, LineStyle::Title, "投資パフォーマンス")?;
    pdf_push(&mut executive, LineStyle::Section, "Executive Summary")?;
    pdf_push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 対象期間 {}〜{}、証券口座 {}、原価計算方式 {}。",
            report.date_from.as_deref().unwrap_or("—"),
            report.date_to.as_deref().unwrap_or("—"),
            request
                .account_id
                .as_deref()
                .unwrap_or("ALL_SECURITIES_ACCOUNTS"),
            report.cost_basis_method
        ),
    )?;
    pdf_push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 通貨別実現損益: {}",
            if report.totals_by_currency.is_empty() {
                "該当データなし".to_owned()
            } else {
                report
                    .totals_by_currency
                    .iter()
                    .map(|item| format_native(item.realized_pnl, &item.currency))
                    .collect::<Vec<_>>()
                    .join(" / ")
            }
        ),
    )?;
    pdf_push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 実現配賦 {}件、Corporate Action配賦 {}件。",
            report.realized_allocations.len(),
            report.corporate_action_allocations.len()
        ),
    )?;
    pdf_push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 例外: 未カバー売却 {}件、スキップ {}件、未配賦Corporate Action {}件。",
            report.uncovered_sales.len(),
            report.skipped_event_ids.len(),
            unallocated_corporate_action_ids(report).len()
        ),
    )?;

    let mut summary = Vec::new();
    pdf_push(&mut summary, LineStyle::Title, "期間・スコープ・通貨別集計")?;
    for (label, value) in [
        ("世帯ID", request.household_id.as_str()),
        (
            "証券口座ID",
            request
                .account_id
                .as_deref()
                .unwrap_or("ALL_SECURITIES_ACCOUNTS"),
        ),
        (
            "対象期間（開始）",
            request.date_from.as_deref().unwrap_or("—"),
        ),
        (
            "対象期間（終了）",
            request.date_to.as_deref().unwrap_or("—"),
        ),
        ("原価計算方式", report.cost_basis_method),
        ("通貨ポリシー", "NATIVE_CURRENCIES_SEPARATE_NO_FX"),
    ] {
        pdf_push(&mut summary, LineStyle::Body, &format!("{label}: {value}"))?;
    }
    pdf_push(&mut summary, LineStyle::Section, "原通貨別KPI")?;
    if report.totals_by_currency.is_empty() {
        pdf_push(&mut summary, LineStyle::Body, "該当データなし")?;
    }
    for item in &report.totals_by_currency {
        pdf_push(
            &mut summary,
            LineStyle::Section,
            &format!("{} — native currency", item.currency),
        )?;
        pdf_push(
            &mut summary,
            LineStyle::Body,
            &format!(
                "購入 {} / 売却 {} / 実現損益 {}",
                format_number(item.buy_gross),
                format_number(item.sell_gross),
                format_number(item.realized_pnl)
            ),
        )?;
        pdf_push(
            &mut summary,
            LineStyle::Body,
            &format!(
                "配当 {} / 手数料 {} / 税金 {}",
                format_number(item.dividend_gross),
                format_number(item.fees),
                format_number(item.taxes)
            ),
        )?;
    }

    let mut realized = Vec::new();
    pdf_push(&mut realized, LineStyle::Title, "実現損益配賦・証跡")?;
    if report.realized_allocations.is_empty() {
        pdf_push(&mut realized, LineStyle::Body, "該当データなし")?;
    }
    for item in &report.realized_allocations {
        push_realized(&mut realized, item)?;
    }

    let mut actions = Vec::new();
    pdf_push(
        &mut actions,
        LineStyle::Title,
        "Corporate Actions・例外・制約",
    )?;
    pdf_push(&mut actions, LineStyle::Section, "Corporate Action配賦")?;
    if report.corporate_action_allocations.is_empty() {
        pdf_push(&mut actions, LineStyle::Body, "該当データなし")?;
    }
    for item in &report.corporate_action_allocations {
        push_corporate_action(&mut actions, item)?;
    }
    pdf_push(&mut actions, LineStyle::Section, "未カバー売却")?;
    if report.uncovered_sales.is_empty() {
        pdf_push(&mut actions, LineStyle::Body, "該当データなし")?;
    }
    for item in &report.uncovered_sales {
        push_uncovered(&mut actions, item)?;
    }
    pdf_push(&mut actions, LineStyle::Section, "スキップイベント")?;
    if report.skipped_event_ids.is_empty() {
        pdf_push(&mut actions, LineStyle::Body, "該当データなし")?;
    }
    for event_id in &report.skipped_event_ids {
        pdf_push(
            &mut actions,
            LineStyle::Body,
            &format!("SKIPPED_EVENT: {event_id} / 計算から除外"),
        )?;
    }
    pdf_push(&mut actions, LineStyle::Section, "未配賦Corporate Action")?;
    let unallocated = unallocated_corporate_action_ids(report);
    if unallocated.is_empty() {
        pdf_push(&mut actions, LineStyle::Body, "該当データなし")?;
    }
    for event_id in unallocated {
        pdf_push(
            &mut actions,
            LineStyle::Body,
            &format!("UNALLOCATED_CORPORATE_ACTION: {event_id} / 配賦行なし"),
        )?;
    }
    pdf_push(&mut actions, LineStyle::Section, "証跡と集計範囲")?;
    for note in [
        "全ての実現配賦、未カバー売却、Corporate Action配賦はSource DocumentとSource Rowを保持します。",
        "金額はイベントの原通貨ごとに分離され、FX換算・異通貨合算されません。",
        "未カバー売却、スキップイベント、未配賦Corporate Actionは集計の完全性に影響します。",
        "この出力はROI、TWR、IRR、保有時価、未実現損益、資産配分、投資リターン、将来予測を表しません。",
        "購入手数料・税はFIFO原価へ、売却手数料・税は純売却収入へ反映されます。",
    ] {
        pdf_push(&mut actions, LineStyle::Body, note)?;
    }
    Ok(vec![executive, summary, realized, actions])
}

fn push_realized(
    lines: &mut Vec<PdfLine>,
    item: &RealizedAllocationDto,
) -> Result<(), InvestmentPerformancePdfError> {
    pdf_push(
        lines,
        LineStyle::Section,
        &format!(
            "{} {} / {} / 売却 {}",
            item.instrument_code, item.instrument_name, item.currency, item.sold_on
        ),
    )?;
    pdf_push(
        lines,
        LineStyle::Body,
        &format!(
            "数量 {} / 配賦原価 {} / 純売却収入 {} / 実現損益 {}",
            format_number(item.quantity),
            format_native(item.allocated_cost_basis, &item.currency),
            format_native(item.allocated_net_proceeds, &item.currency),
            format_native(item.realized_pnl, &item.currency)
        ),
    )?;
    pdf_push(
        lines,
        LineStyle::Body,
        &format!(
            "FIFO: BUY {} ({}, {}#{}) → SELL {} ({}#{}) / 口座 {}",
            item.buy_event_id,
            item.acquired_on,
            item.buy_source_document_id,
            item.buy_source_row,
            item.sell_event_id,
            item.sell_source_document_id,
            item.sell_source_row,
            item.account_id
        ),
    )
}

fn push_corporate_action(
    lines: &mut Vec<PdfLine>,
    item: &CorporateActionAllocationDto,
) -> Result<(), InvestmentPerformancePdfError> {
    pdf_push(
        lines,
        LineStyle::Section,
        &format!(
            "{} [{}] / {}",
            item.action_event_id, item.action_type, item.action_on
        ),
    )?;
    pdf_push(
        lines,
        LineStyle::Body,
        &format!(
            "{} → {} / 数量 {} / 配賦原価 {}",
            item.from_instrument_code,
            item.target_instrument_code,
            format_number(item.quantity),
            format_native(item.allocated_cost_basis, &item.currency)
        ),
    )?;
    pdf_push(
        lines,
        LineStyle::Body,
        &format!(
            "現金 {} / 実現損益 {} / Source {}#{}",
            format_native(item.cash_amount, &item.currency),
            item.realized_pnl
                .map(|value| format_native(value, &item.currency))
                .unwrap_or_else(|| "—".to_owned()),
            item.action_source_document_id,
            item.action_source_row
        ),
    )?;
    if let Some(buy_id) = item.source_buy_event_id.as_deref() {
        pdf_push(
            lines,
            LineStyle::Body,
            &format!(
                "Source BUY {} / {}#{}",
                buy_id,
                item.source_buy_source_document_id.as_deref().unwrap_or("—"),
                item.source_buy_source_row
                    .map_or_else(|| "—".to_owned(), |value| value.to_string())
            ),
        )?;
        pdf_push(
            lines,
            LineStyle::Body,
            &format!(
                "Source cost {} / conversion rate {}",
                item.source_cost_basis
                    .zip(item.source_currency.as_deref())
                    .map(|(value, currency)| format_native(value, currency))
                    .unwrap_or_else(|| "—".to_owned()),
                item.conversion_rate
                    .map(format_number)
                    .unwrap_or_else(|| "—".to_owned())
            ),
        )?;
    }
    Ok(())
}

fn push_uncovered(
    lines: &mut Vec<PdfLine>,
    item: &UncoveredSaleDto,
) -> Result<(), InvestmentPerformancePdfError> {
    pdf_push(
        lines,
        LineStyle::Section,
        &format!(
            "{} / {} {}",
            item.sell_event_id, item.instrument_code, item.instrument_name
        ),
    )?;
    pdf_push(
        lines,
        LineStyle::Body,
        &format!(
            "{} / 売却 {} / 数量 {} / 口座 {}",
            item.currency,
            item.sold_on,
            format_number(item.uncovered_quantity),
            item.account_id
        ),
    )?;
    pdf_push(
        lines,
        LineStyle::Body,
        &format!("Source {}#{}", item.source_document_id, item.source_row),
    )
}

fn pdf_push(
    lines: &mut Vec<PdfLine>,
    style: LineStyle,
    value: &str,
) -> Result<(), InvestmentPerformancePdfError> {
    push(lines, style, value).map_err(|_| InvestmentPerformancePdfError::Invalid)
}

fn render_page(
    lines: Vec<PdfLine>,
    page: usize,
    total: usize,
    font_id: &FontId,
    executive_report: Option<&InvestmentPerformanceDto>,
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
    report: &InvestmentPerformanceDto,
    font_id: &FontId,
) {
    draw_rect(ops, 0.0, 267.0, 210.0, 30.0, rgb(0.08, 0.18, 0.26));
    draw_rect(ops, 15.0, 232.0, 180.0, 0.7, rgb(0.19, 0.47, 0.50));
    let exception_count = report.uncovered_sales.len()
        + report.skipped_event_ids.len()
        + unallocated_corporate_action_ids(report).len();
    let cards = [
        ("原通貨", report.totals_by_currency.len()),
        ("実現配賦", report.realized_allocations.len()),
        ("Action配賦", report.corporate_action_allocations.len()),
        ("例外", exception_count),
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
            12.0,
            &value.to_string(),
            rgb(0.08, 0.18, 0.26),
        );
    }
    add_text(
        ops,
        font_id,
        15.0,
        185.0,
        11.0,
        "通貨別の購入・売却（各通貨内スケール）",
        rgb(0.10, 0.19, 0.27),
    );
    for (index, item) in report.totals_by_currency.iter().take(4).enumerate() {
        let top = 170.0 - index as f32 * 18.0;
        let scale = item.buy_gross.abs().max(item.sell_gross.abs()).max(1.0) as f32;
        add_text(
            ops,
            font_id,
            15.0,
            top + 1.0,
            8.0,
            &format!(
                "{}  実現損益 {} / 配当 {}",
                item.currency,
                format_number(item.realized_pnl),
                format_number(item.dividend_gross)
            ),
            rgb(0.25, 0.29, 0.32),
        );
        for (row, (label, value, color)) in [
            ("購入", item.buy_gross, rgb(0.19, 0.47, 0.50)),
            ("売却", item.sell_gross, rgb(0.43, 0.52, 0.58)),
        ]
        .into_iter()
        .enumerate()
        {
            let y = top - 5.0 - row as f32 * 5.5;
            add_text(
                ops,
                font_id,
                15.0,
                y + 0.7,
                7.0,
                label,
                rgb(0.35, 0.39, 0.42),
            );
            draw_rect(
                ops,
                29.0,
                y,
                (value.abs() as f32 / scale * 75.0).max(0.6),
                3.7,
                color,
            );
            add_text(
                ops,
                font_id,
                108.0,
                y + 0.7,
                7.0,
                &format_native(value, &item.currency),
                rgb(0.35, 0.39, 0.42),
            );
        }
    }
    if report.totals_by_currency.len() > 4 {
        add_text(
            ops,
            font_id,
            15.0,
            96.0,
            7.0,
            "残りの通貨は次ページの原通貨別KPIに記載",
            rgb(0.42, 0.46, 0.49),
        );
    }
}

fn validate_report(
    request: &InvestmentPerformanceRequest,
    report: &InvestmentPerformanceDto,
) -> Result<(), InvestmentPerformancePdfError> {
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
        || report.totals_by_currency.len() > MAX_CURRENCIES
        || !validate_totals(report)
        || !report.realized_allocations.iter().all(validate_realized)
        || !report.uncovered_sales.iter().all(validate_uncovered)
        || !report
            .corporate_action_allocations
            .iter()
            .all(validate_corporate_action)
        || report
            .skipped_event_ids
            .iter()
            .chain(report.corporate_action_event_ids.iter())
            .any(|id| !valid_text(id))
    {
        return Err(InvestmentPerformancePdfError::Invalid);
    }
    Ok(())
}

fn validate_totals(report: &InvestmentPerformanceDto) -> bool {
    let mut currencies = BTreeSet::new();
    report.totals_by_currency.iter().all(|item| {
        valid_currency(&item.currency)
            && currencies.insert(item.currency.as_str())
            && [
                item.buy_gross,
                item.sell_gross,
                item.realized_pnl,
                item.dividend_gross,
                item.fees,
                item.taxes,
            ]
            .into_iter()
            .all(valid_number)
    })
}

fn validate_realized(item: &RealizedAllocationDto) -> bool {
    [
        item.sell_event_id.as_str(),
        item.buy_event_id.as_str(),
        item.account_id.as_str(),
        item.instrument_name.as_str(),
        item.buy_source_document_id.as_str(),
        item.sell_source_document_id.as_str(),
    ]
    .into_iter()
    .all(valid_text)
        && optional_text_valid(&item.instrument_code)
        && valid_currency(&item.currency)
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

fn validate_uncovered(item: &UncoveredSaleDto) -> bool {
    [
        item.sell_event_id.as_str(),
        item.account_id.as_str(),
        item.instrument_name.as_str(),
        item.source_document_id.as_str(),
    ]
    .into_iter()
    .all(valid_text)
        && optional_text_valid(&item.instrument_code)
        && valid_currency(&item.currency)
        && is_iso_date(&item.sold_on)
        && item.uncovered_quantity > 0.0
        && valid_number(item.uncovered_quantity)
        && item.source_row > 0
}

fn validate_corporate_action(item: &CorporateActionAllocationDto) -> bool {
    let buy_count = [
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
    [
        item.action_event_id.as_str(),
        item.action_type.as_str(),
        item.action_source_document_id.as_str(),
        item.from_instrument_code.as_str(),
        item.target_instrument_code.as_str(),
    ]
    .into_iter()
    .all(valid_text)
        && matches!(
            item.action_type.as_str(),
            "SPIN_OFF" | "RIGHTS_SUBSCRIPTION" | "CASH_IN_LIEU" | "MERGER_STOCK" | "MERGER_CASH"
        )
        && is_iso_date(&item.action_on)
        && valid_currency(&item.currency)
        && item.source_currency.as_deref().is_none_or(valid_currency)
        && item.action_source_row > 0
        && matches!(buy_count, 0 | 3)
        && item.source_buy_event_id.as_deref().is_none_or(valid_text)
        && item
            .source_buy_source_document_id
            .as_deref()
            .is_none_or(valid_text)
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
            || (buy_count == 3
                && source_cost_count == 2
                && item.source_cost_basis.is_some_and(|value| value >= 0.0)
                && (item.source_currency.as_deref() == Some(item.currency.as_str()))
                    == item.conversion_rate.is_none()))
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

fn valid_text(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= MAX_CELL_TEXT_CHARS
}

fn optional_text_valid(value: &str) -> bool {
    value.chars().count() <= MAX_CELL_TEXT_CHARS
}

fn valid_currency(value: &str) -> bool {
    value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_uppercase())
}

fn valid_number(value: f64) -> bool {
    value.is_finite() && value.abs() <= MAX_EXACT_NUMBER
}

fn format_native(value: f64, currency: &str) -> String {
    format!("{currency} {}", format_number(value))
}

fn format_number(value: f64) -> String {
    let sign = if value < 0.0 { "-" } else { "" };
    let raw = format!("{:.8}", value.abs());
    let raw = raw.trim_end_matches('0').trim_end_matches('.');
    let (whole, decimal) = raw.split_once('.').unwrap_or((raw, ""));
    let mut grouped = String::new();
    for (index, character) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(character);
    }
    if decimal.is_empty() {
        format!("{sign}{grouped}")
    } else {
        format!("{sign}{grouped}.{decimal}")
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::investment_performance::{InvestmentPeriodCurrencyDto, RealizedAllocationDto};
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
            totals_by_currency: vec![
                InvestmentPeriodCurrencyDto {
                    currency: "JPY".to_owned(),
                    buy_gross: 100_000.0,
                    sell_gross: 120_000.0,
                    realized_pnl: 18_500.0,
                    dividend_gross: 2_000.0,
                    fees: 1_000.0,
                    taxes: 500.0,
                },
                InvestmentPeriodCurrencyDto {
                    currency: "USD".to_owned(),
                    buy_gross: 2_000.0,
                    sell_gross: 2_450.0,
                    realized_pnl: 410.25,
                    dividend_gross: 80.0,
                    fees: 25.0,
                    taxes: 14.75,
                },
            ],
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
            corporate_action_event_ids: vec![
                "merger-1".to_owned(),
                "merger-unallocated".to_owned(),
            ],
            corporate_action_allocations: vec![CorporateActionAllocationDto {
                action_event_id: "merger-1".to_owned(),
                action_type: "MERGER_STOCK".to_owned(),
                action_on: "2026-04-01".to_owned(),
                action_source_document_id: "doc-action".to_owned(),
                action_source_row: 14,
                source_buy_event_id: Some("buy-1".to_owned()),
                source_buy_source_document_id: Some("doc-buy".to_owned()),
                source_buy_source_row: Some(12),
                from_instrument_code: "7203".to_owned(),
                target_instrument_code: "7203N".to_owned(),
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

    #[test]
    fn investment_performance_pdf_is_deterministic_extractable_and_truthful() {
        let first = generate_investment_performance_pdf_from_report(&request(), &report()).unwrap();
        let second =
            generate_investment_performance_pdf_from_report(&request(), &report()).unwrap();
        if let Ok(path) = std::env::var("KAKEFLOW_INVESTMENT_PERFORMANCE_PDF_FIXTURE") {
            std::fs::write(path, first.bytes()).unwrap();
        }
        assert_eq!(first.bytes(), second.bytes());
        assert_eq!(first.media_type, "application/pdf");
        assert_eq!(first.file_name, "kakeflow-investment-performance-2026.pdf");
        assert!(first.bytes().starts_with(b"%PDF-"));
        assert!(first.page_count >= 4);
        assert_eq!(first.byte_size as usize, first.bytes().len());
        let pages = pdf_extract::extract_text_from_mem_by_pages(first.bytes()).unwrap();
        assert_eq!(pages.len(), first.page_count as usize);
        let text = pages.join("\n");
        for value in [
            "投資パフォーマンス",
            "Executive Summary",
            "NATIVE_CURRENCIES_SEPARATE_NO_FX",
            "JPY 18,500",
            "USD 410.25",
            "トヨタ自動車",
            "doc-buy#12",
            "UNALLOCATED_CORPORATE_ACTION",
            "merger-unallocated",
            "ROI、TWR、IRR、保有時価、未実現損益、資産配分、投資リターン、将来予測を表しません",
        ] {
            assert!(text.contains(value), "missing extracted text {value}");
        }
        assert!(!text.contains("総合ROI"));
    }

    #[test]
    fn investment_performance_pdf_cancel_and_save_are_safe() {
        let document =
            generate_investment_performance_pdf_from_report(&request(), &report()).unwrap();
        assert_eq!(
            save_investment_performance_pdf_document(&document, None).unwrap(),
            None
        );
        let directory = tempdir().unwrap();
        let destination = directory.path().join("investment.pdf");
        let saved = save_investment_performance_pdf_document(&document, Some(&destination))
            .unwrap()
            .unwrap();
        assert_eq!(saved.page_count, document.page_count);
        assert_eq!(saved.byte_size, document.byte_size);
        assert_eq!(std::fs::read(destination).unwrap(), document.bytes());
    }

    #[test]
    fn investment_performance_pdf_rejects_invalid_truth_boundary_and_bounds() {
        let mut invalid_request = request();
        invalid_request.date_to = Some("2026-02-30".to_owned());
        assert!(
            generate_investment_performance_pdf_from_report(&invalid_request, &report()).is_err()
        );
        let mut invalid_request = request();
        invalid_request.account_id = Some(" ".to_owned());
        assert!(
            generate_investment_performance_pdf_from_report(&invalid_request, &report()).is_err()
        );
        let mut invalid = report();
        invalid.cost_basis_method = "AVERAGE";
        assert!(generate_investment_performance_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.totals_by_currency[0].buy_gross = f64::NAN;
        assert!(generate_investment_performance_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.totals_by_currency[0].currency = "JPY".repeat(MAX_CURRENCIES + 1);
        assert!(generate_investment_performance_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.skipped_event_ids[0] = "x".repeat(MAX_CELL_TEXT_CHARS + 1);
        assert!(generate_investment_performance_pdf_from_report(&request(), &invalid).is_err());
        let mut invalid = report();
        invalid.skipped_event_ids = (0..=MAX_DATA_ROWS).map(|index| index.to_string()).collect();
        assert!(generate_investment_performance_pdf_from_report(&request(), &invalid).is_err());
    }
}
