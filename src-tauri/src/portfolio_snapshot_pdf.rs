use crate::monthly_review_pdf::{
    add_text, draw_rect, format_jpy, install_japanese_font, normalize_pdf_identifiers, paginate,
    push, rgb, LineStyle, PdfLine,
};
use crate::portfolio::{
    AssetClassDto, FxRateSnapshotDto, PortfolioError, PortfolioSnapshotDetailDto,
    PositionSnapshotDto,
};
use crate::portfolio_snapshot_xlsx::PortfolioSnapshotXlsxRequest;
use printpdf::{
    FontId, Mm, Op, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point, Pt, TextItem,
};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::Path;
use thiserror::Error;

const MAX_PDF_BYTES: usize = 16 * 1024 * 1024;
const MAX_CELL_TEXT_CHARS: usize = 512;
const MAX_RENDER_ROWS: usize = 320;
const MAX_ASSET_CLASSES: usize = 64;
const MAX_POSITIONS: usize = 192;
const MAX_FX_RATES: usize = 64;
const MAX_PDF_PAGES: usize = 16;
const MAX_EXACT_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_EXACT_NUMBER: f64 = 9_007_199_254_740_991.0;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PortfolioSnapshotPdfError {
    #[error("portfolio snapshot PDF input is invalid")]
    Invalid,
    #[error("portfolio snapshot was not found")]
    NotFound,
    #[error("portfolio snapshot PDF is unavailable")]
    Unavailable,
}

impl PortfolioSnapshotPdfError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::Invalid => "Portfolio snapshot PDF data is invalid",
            Self::NotFound => "The requested portfolio snapshot was not found",
            Self::Unavailable => "Portfolio snapshot PDF is temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone)]
pub struct PortfolioSnapshotPdfDocument {
    pub file_name: String,
    pub media_type: &'static str,
    pub page_count: u16,
    pub byte_size: u32,
    bytes: Vec<u8>,
}

impl PortfolioSnapshotPdfDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSnapshotPdfSavedDto {
    pub file_name: String,
    pub page_count: u16,
    pub byte_size: u32,
}

pub fn generate_portfolio_snapshot_pdf(
    connection: &rusqlite::Connection,
    request: &PortfolioSnapshotXlsxRequest,
) -> Result<PortfolioSnapshotPdfDocument, PortfolioSnapshotPdfError> {
    if !valid_id(&request.household_id) || !valid_id(&request.snapshot_id) {
        return Err(PortfolioSnapshotPdfError::Invalid);
    }
    // The requested id is passed through verbatim. This export never resolves or
    // substitutes the latest snapshot.
    let snapshot =
        crate::portfolio::get_snapshot(connection, &request.household_id, &request.snapshot_id)
            .map_err(map_portfolio_error)?;
    generate_portfolio_snapshot_pdf_from_snapshot(request, &snapshot)
}

pub fn generate_portfolio_snapshot_pdf_from_snapshot(
    request: &PortfolioSnapshotXlsxRequest,
    snapshot: &PortfolioSnapshotDetailDto,
) -> Result<PortfolioSnapshotPdfDocument, PortfolioSnapshotPdfError> {
    validate_snapshot(request, snapshot)?;
    let pages = paginate(report_groups(request, snapshot)?);
    if pages.is_empty() || pages.len() > MAX_PDF_PAGES || pages.len() > u16::MAX as usize {
        return Err(PortfolioSnapshotPdfError::Invalid);
    }
    let mut pdf = PdfDocument::new("KakeFlow Portfolio Snapshot");
    let font_id =
        install_japanese_font(&mut pdf).map_err(|_| PortfolioSnapshotPdfError::Unavailable)?;
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
                (index == 0).then_some(snapshot),
            )
        })
        .collect::<Vec<_>>();
    let mut warnings = Vec::new();
    let mut bytes = pdf
        .with_pages(rendered)
        .save(&PdfSaveOptions::default(), &mut warnings);
    normalize_pdf_identifiers(&mut bytes).map_err(|_| PortfolioSnapshotPdfError::Unavailable)?;
    if !bytes.starts_with(b"%PDF-")
        || bytes.len() > MAX_PDF_BYTES
        || bytes.len() > u32::MAX as usize
    {
        return Err(PortfolioSnapshotPdfError::Invalid);
    }
    Ok(PortfolioSnapshotPdfDocument {
        file_name: format!("kakeflow-portfolio-snapshot-{}.pdf", request.snapshot_id),
        media_type: "application/pdf",
        page_count,
        byte_size: bytes.len() as u32,
        bytes,
    })
}

pub fn save_portfolio_snapshot_pdf_document(
    document: &PortfolioSnapshotPdfDocument,
    destination: Option<&Path>,
) -> Result<Option<PortfolioSnapshotPdfSavedDto>, PortfolioSnapshotPdfError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.bytes())
        .map_err(|_| PortfolioSnapshotPdfError::Unavailable)?;
    Ok(Some(PortfolioSnapshotPdfSavedDto {
        file_name: document.file_name.clone(),
        page_count: document.page_count,
        byte_size: document.byte_size,
    }))
}

fn report_groups(
    request: &PortfolioSnapshotXlsxRequest,
    snapshot: &PortfolioSnapshotDetailDto,
) -> Result<Vec<Vec<PdfLine>>, PortfolioSnapshotPdfError> {
    let summary = &snapshot.summary;
    let mut executive = Vec::new();
    pdf_push(
        &mut executive,
        LineStyle::Title,
        "ポートフォリオ・スナップショット",
    )?;
    pdf_push(&mut executive, LineStyle::Section, "Executive Summary")?;
    pdf_push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 選択Snapshot {}（{}）/ 証券口座 {}。",
            summary.id, summary.as_of, summary.account_name
        ),
    )?;
    pdf_push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• Snapshot時価総額 {}、現金残高 {}。",
            format_jpy(summary.market_value_jpy),
            format_jpy(summary.cash_value_jpy)
        ),
    )?;
    pdf_push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• 含み損益 {} / 実現損益 {}。",
            optional_jpy(summary.unrealized_pnl_jpy),
            optional_jpy(summary.realized_pnl_jpy)
        ),
    )?;
    pdf_push(
        &mut executive,
        LineStyle::Body,
        &format!(
            "• Position {}件、Snapshot-local FX {}件 / Source {}。",
            summary.position_count, summary.fx_rate_count, summary.source_document_id
        ),
    )?;

    let mut overview = Vec::new();
    pdf_push(&mut overview, LineStyle::Title, "Snapshot概要・資産クラス")?;
    for (label, value) in [
        ("世帯ID", request.household_id.as_str()),
        ("Snapshot ID", summary.id.as_str()),
        ("証券口座ID", summary.account_id.as_str()),
        ("証券口座名", summary.account_name.as_str()),
        ("Source Document", summary.source_document_id.as_str()),
        ("Snapshot As Of", summary.as_of.as_str()),
    ] {
        pdf_push(&mut overview, LineStyle::Body, &format!("{label}: {value}"))?;
    }
    for (label, value, available) in [
        ("時価総額 JPY", Some(summary.market_value_jpy), true),
        ("現金残高 JPY", Some(summary.cash_value_jpy), true),
        (
            "含み損益 JPY",
            summary.unrealized_pnl_jpy,
            summary.unrealized_pnl_jpy.is_some(),
        ),
        (
            "実現損益 JPY",
            summary.realized_pnl_jpy,
            summary.realized_pnl_jpy.is_some(),
        ),
    ] {
        pdf_push(
            &mut overview,
            LineStyle::Body,
            &format!(
                "{label}: {} [{}]",
                optional_jpy(value),
                availability(available)
            ),
        )?;
    }
    pdf_push(&mut overview, LineStyle::Section, "資産クラス")?;
    if snapshot.asset_classes.is_empty() {
        pdf_push(&mut overview, LineStyle::Body, "該当データなし")?;
    }
    for item in &snapshot.asset_classes {
        pdf_push(
            &mut overview,
            LineStyle::Body,
            &format!(
                "{} [{}]: 時価 {} / 含み損益 {} [{}]",
                item.name,
                item.id,
                format_jpy(item.market_value_jpy),
                optional_jpy(item.unrealized_pnl_jpy),
                availability(item.unrealized_pnl_jpy.is_some())
            ),
        )?;
        pdf_push(
            &mut overview,
            LineStyle::Body,
            &format!("Source {}#{}", summary.source_document_id, item.source_row),
        )?;
    }

    let mut positions = Vec::new();
    pdf_push(&mut positions, LineStyle::Title, "Position明細・Lineage")?;
    if snapshot.positions.is_empty() {
        pdf_push(&mut positions, LineStyle::Body, "該当データなし")?;
    }
    for item in &snapshot.positions {
        push_position(&mut positions, item, &summary.source_document_id)?;
    }

    let mut fx = Vec::new();
    pdf_push(&mut fx, LineStyle::Title, "Snapshot FX・制約")?;
    pdf_push(&mut fx, LineStyle::Section, "Snapshot-local FX rates")?;
    if snapshot.fx_rates.is_empty() {
        pdf_push(&mut fx, LineStyle::Body, "該当データなし")?;
    }
    for item in &snapshot.fx_rates {
        pdf_push(
            &mut fx,
            LineStyle::Body,
            &format!(
                "{} [{}]: {}/{} = {}",
                item.id,
                summary.id,
                item.base_currency,
                item.quote_currency,
                format_number(item.rate)
            ),
        )?;
        pdf_push(
            &mut fx,
            LineStyle::Body,
            &format!("Source {}#{}", summary.source_document_id, item.source_row),
        )?;
    }
    pdf_push(&mut fx, LineStyle::Section, "証跡と集計範囲")?;
    for note in [
        "Snapshot IDはリクエスト指定だけを使用します。",
        "latest snapshotを自動選択しません。",
        "各行はSnapshotのSource Document/Rowを保持します。",
        "NOT_PROVIDEDはsource欠損です。0で補完しません。",
        "FX rateは選択Snapshot内のsource値です。現在・外部レートではありません。",
        "取引イベント・FIFO・performanceは対象外です。",
        "ROI、TWR、IRR、将来予測を表しません。",
        "時価・価格・損益はsource値だけです。",
        "current/live valuationを推定しません。",
        "含み損益の欠損時は、単価・価格・FXから推定しません。",
    ] {
        pdf_push(&mut fx, LineStyle::Body, note)?;
    }
    Ok(vec![executive, overview, positions, fx])
}

fn push_position(
    lines: &mut Vec<PdfLine>,
    item: &PositionSnapshotDto,
    source_document_id: &str,
) -> Result<(), PortfolioSnapshotPdfError> {
    pdf_push(
        lines,
        LineStyle::Section,
        &format!(
            "{} {} [{}] / {} / {}",
            item.instrument_code,
            item.instrument_name,
            item.id,
            item.product_type,
            item.account_type
        ),
    )?;
    pdf_push(
        lines,
        LineStyle::Body,
        &format!(
            "通貨 {} / 数量 {} [{}]",
            item.currency,
            optional_number(item.quantity),
            availability(item.quantity.is_some())
        ),
    )?;
    pdf_push(
        lines,
        LineStyle::Body,
        &format!(
            "平均取得単価 {} [{}] / 市場価格 {} [{}]",
            optional_number(item.average_cost),
            availability(item.average_cost.is_some()),
            optional_number(item.market_price),
            availability(item.market_price.is_some())
        ),
    )?;
    pdf_push(
        lines,
        LineStyle::Body,
        &format!(
            "時価 {} [{}] / 含み損益 {} [{}]",
            optional_jpy(item.market_value_jpy),
            availability(item.market_value_jpy.is_some()),
            optional_jpy(item.unrealized_pnl_jpy),
            availability(item.unrealized_pnl_jpy.is_some())
        ),
    )?;
    pdf_push(
        lines,
        LineStyle::Body,
        &format!(
            "実現損益 {} [{}]",
            optional_jpy(item.realized_pnl_jpy),
            availability(item.realized_pnl_jpy.is_some())
        ),
    )?;
    pdf_push(
        lines,
        LineStyle::Body,
        &format!("Source {}#{}", source_document_id, item.source_row),
    )
}

fn pdf_push(
    lines: &mut Vec<PdfLine>,
    style: LineStyle,
    value: &str,
) -> Result<(), PortfolioSnapshotPdfError> {
    push(lines, style, value).map_err(|_| PortfolioSnapshotPdfError::Invalid)
}

fn render_page(
    lines: Vec<PdfLine>,
    page: usize,
    total: usize,
    font_id: &FontId,
    executive_snapshot: Option<&PortfolioSnapshotDetailDto>,
) -> PdfPage {
    let mut ops = Vec::new();
    if let Some(snapshot) = executive_snapshot {
        render_executive_visuals(&mut ops, snapshot, font_id);
    }
    let mut y = 282.0_f32;
    for (index, line) in lines.into_iter().enumerate() {
        let (size, height) = match line.style {
            LineStyle::Title => (18.0, 10.0),
            LineStyle::Section => (12.0, 8.0),
            LineStyle::Body => (9.0, 5.8),
        };
        let color = if executive_snapshot.is_some() && index <= 1 {
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
    snapshot: &PortfolioSnapshotDetailDto,
    font_id: &FontId,
) {
    let summary = &snapshot.summary;
    draw_rect(ops, 0.0, 267.0, 210.0, 30.0, rgb(0.08, 0.18, 0.26));
    draw_rect(ops, 15.0, 232.0, 180.0, 0.7, rgb(0.19, 0.47, 0.50));
    for (index, (label, value)) in [
        ("Snapshot時価", format_jpy(summary.market_value_jpy)),
        ("現金残高", format_jpy(summary.cash_value_jpy)),
        ("Positions", summary.position_count.to_string()),
        ("Snapshot FX", summary.fx_rate_count.to_string()),
    ]
    .into_iter()
    .enumerate()
    {
        let x = 15.0 + index as f32 * 46.0;
        draw_rect(ops, x, 197.0, 42.0, 25.0, rgb(0.94, 0.96, 0.97));
        add_text(
            ops,
            font_id,
            x + 3.0,
            214.0,
            7.7,
            label,
            rgb(0.35, 0.40, 0.44),
        );
        add_text(
            ops,
            font_id,
            x + 3.0,
            204.0,
            10.2,
            &value,
            rgb(0.08, 0.18, 0.26),
        );
    }
    add_text(
        ops,
        font_id,
        15.0,
        185.0,
        11.0,
        "資産クラス時価（Snapshot source values）",
        rgb(0.10, 0.19, 0.27),
    );
    let max_value = snapshot
        .asset_classes
        .iter()
        .map(|item| item.market_value_jpy)
        .max()
        .unwrap_or(1)
        .max(1) as f32;
    for (index, item) in snapshot.asset_classes.iter().take(8).enumerate() {
        let y = 171.0 - index as f32 * 8.2;
        add_text(
            ops,
            font_id,
            15.0,
            y + 0.8,
            7.2,
            &item.name,
            rgb(0.30, 0.34, 0.37),
        );
        draw_rect(
            ops,
            61.0,
            y,
            item.market_value_jpy as f32 / max_value * 70.0,
            4.2,
            rgb(0.19, 0.47, 0.50),
        );
        add_text(
            ops,
            font_id,
            136.0,
            y + 0.8,
            7.2,
            &format_jpy(item.market_value_jpy),
            rgb(0.30, 0.34, 0.37),
        );
    }
    if snapshot.asset_classes.is_empty() {
        add_text(
            ops,
            font_id,
            15.0,
            168.0,
            8.0,
            "該当データなし",
            rgb(0.42, 0.46, 0.49),
        );
    } else if snapshot.asset_classes.len() > 8 {
        add_text(
            ops,
            font_id,
            15.0,
            103.0,
            7.0,
            "残りの資産クラスは次ページに記載",
            rgb(0.42, 0.46, 0.49),
        );
    }
}

fn validate_snapshot(
    request: &PortfolioSnapshotXlsxRequest,
    snapshot: &PortfolioSnapshotDetailDto,
) -> Result<(), PortfolioSnapshotPdfError> {
    let summary = &snapshot.summary;
    let row_count =
        snapshot.asset_classes.len() + snapshot.positions.len() + snapshot.fx_rates.len();
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
        || snapshot.asset_classes.len() > MAX_ASSET_CLASSES
        || snapshot.positions.len() > MAX_POSITIONS
        || snapshot.fx_rates.len() > MAX_FX_RATES
        || row_count > MAX_RENDER_ROWS
        || !unique_ids(snapshot.asset_classes.iter().map(|item| item.id.as_str()))
        || !unique_ids(snapshot.positions.iter().map(|item| item.id.as_str()))
        || !unique_ids(snapshot.fx_rates.iter().map(|item| item.id.as_str()))
        || !snapshot.asset_classes.iter().all(validate_asset_class)
        || !snapshot.positions.iter().all(validate_position)
        || !snapshot.fx_rates.iter().all(validate_fx_rate)
    {
        return Err(PortfolioSnapshotPdfError::Invalid);
    }
    Ok(())
}

fn validate_asset_class(item: &AssetClassDto) -> bool {
    valid_id(&item.id)
        && valid_text(&item.name, false)
        && valid_nonnegative_jpy(item.market_value_jpy)
        && item.unrealized_pnl_jpy.is_none_or(valid_jpy)
        && item.source_row > 0
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
        && item.source_row > 0
}

fn validate_fx_rate(item: &FxRateSnapshotDto) -> bool {
    valid_id(&item.id)
        && valid_currency(&item.base_currency)
        && valid_currency(&item.quote_currency)
        && item.quote_currency == "JPY"
        && valid_f64(item.rate)
        && item.rate > 0.0
        && item.source_row > 0
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

fn valid_jpy(value: i64) -> bool {
    value.unsigned_abs() <= MAX_EXACT_INTEGER
}

fn valid_nonnegative_jpy(value: i64) -> bool {
    value >= 0 && valid_jpy(value)
}

fn valid_f64(value: f64) -> bool {
    value.is_finite() && value.abs() <= MAX_EXACT_NUMBER
}

fn availability(available: bool) -> &'static str {
    if available {
        "AVAILABLE"
    } else {
        "NOT_PROVIDED"
    }
}

fn optional_jpy(value: Option<i64>) -> String {
    value.map(format_jpy).unwrap_or_else(|| "—".to_owned())
}

fn optional_number(value: Option<f64>) -> String {
    value.map(format_number).unwrap_or_else(|| "—".to_owned())
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

fn map_portfolio_error(error: PortfolioError) -> PortfolioSnapshotPdfError {
    match error {
        PortfolioError::InvalidInput(_) => PortfolioSnapshotPdfError::Invalid,
        PortfolioError::NotFound => PortfolioSnapshotPdfError::NotFound,
        PortfolioError::Conflict | PortfolioError::Unavailable => {
            PortfolioSnapshotPdfError::Unavailable
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::portfolio::{PortfolioSnapshotSummaryDto, PositionSnapshotDto};
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
                account_name: "証券口座".to_owned(),
                source_document_id: "assetbalance-doc".to_owned(),
                as_of: "2026-07-12T14:47:56+09:00".to_owned(),
                market_value_jpy: 2_500_000,
                cash_value_jpy: 300_000,
                unrealized_pnl_jpy: Some(250_000),
                realized_pnl_jpy: None,
                position_count: 2,
                fx_rate_count: 1,
            },
            asset_classes: vec![
                AssetClassDto {
                    id: "class-stock".to_owned(),
                    name: "国内株式".to_owned(),
                    market_value_jpy: 2_200_000,
                    unrealized_pnl_jpy: None,
                    source_row: 5,
                },
                AssetClassDto {
                    id: "class-cash".to_owned(),
                    name: "現金".to_owned(),
                    market_value_jpy: 300_000,
                    unrealized_pnl_jpy: None,
                    source_row: 6,
                },
            ],
            positions: vec![
                PositionSnapshotDto {
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
                },
                PositionSnapshotDto {
                    id: "position-missing".to_owned(),
                    product_type: "投資信託".to_owned(),
                    account_type: "NISA".to_owned(),
                    instrument_code: "".to_owned(),
                    instrument_name: "価格未提供ファンド".to_owned(),
                    quantity: None,
                    average_cost: None,
                    market_price: None,
                    market_value_jpy: None,
                    unrealized_pnl_jpy: None,
                    realized_pnl_jpy: None,
                    currency: "USD".to_owned(),
                    source_row: 13,
                },
            ],
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
    fn portfolio_snapshot_pdf_is_deterministic_extractable_and_snapshot_only() {
        let first = generate_portfolio_snapshot_pdf_from_snapshot(&request(), &snapshot()).unwrap();
        let second =
            generate_portfolio_snapshot_pdf_from_snapshot(&request(), &snapshot()).unwrap();
        if let Ok(path) = std::env::var("KAKEFLOW_PORTFOLIO_SNAPSHOT_PDF_FIXTURE") {
            std::fs::write(path, first.bytes()).unwrap();
        }
        assert_eq!(first.bytes(), second.bytes());
        assert_eq!(first.media_type, "application/pdf");
        assert_eq!(
            first.file_name,
            "kakeflow-portfolio-snapshot-snapshot-20260712.pdf"
        );
        assert!(first.bytes().starts_with(b"%PDF-"));
        assert!(first.page_count >= 4);
        assert_eq!(first.byte_size as usize, first.bytes().len());
        let pages = pdf_extract::extract_text_from_mem_by_pages(first.bytes()).unwrap();
        assert_eq!(pages.len(), first.page_count as usize);
        let text = pages.join("\n");
        for value in [
            "ポートフォリオ・スナップショット",
            "Executive Summary",
            "snapshot-20260712",
            "assetbalance-doc#5",
            "トヨタ自動車",
            "assetbalance-doc#12",
            "NOT_PROVIDED",
            "USD/JPY = 159.25",
            "latest snapshotを自動選択しません",
            "ROI、TWR、IRR、将来予測を表しません",
            "current/live valuationを推定しません",
        ] {
            assert!(text.contains(value), "missing extracted text {value}");
        }
        assert!(!text.contains("推定含み損益"));
    }

    #[test]
    fn portfolio_snapshot_pdf_cancel_and_save_are_safe() {
        let document =
            generate_portfolio_snapshot_pdf_from_snapshot(&request(), &snapshot()).unwrap();
        assert_eq!(
            save_portfolio_snapshot_pdf_document(&document, None).unwrap(),
            None
        );
        let directory = tempdir().unwrap();
        let destination = directory.path().join("snapshot.pdf");
        let saved = save_portfolio_snapshot_pdf_document(&document, Some(&destination))
            .unwrap()
            .unwrap();
        assert_eq!(saved.page_count, document.page_count);
        assert_eq!(saved.byte_size, document.byte_size);
        assert_eq!(std::fs::read(destination).unwrap(), document.bytes());
    }

    #[test]
    fn portfolio_snapshot_pdf_rejects_wrong_selection_counts_and_bounds() {
        let mut invalid = snapshot();
        invalid.summary.id = "latest".to_owned();
        assert!(generate_portfolio_snapshot_pdf_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.summary.position_count = 3;
        assert!(generate_portfolio_snapshot_pdf_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.fx_rates[0].rate = f64::NAN;
        assert!(generate_portfolio_snapshot_pdf_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.positions[0].source_row = 0;
        assert!(generate_portfolio_snapshot_pdf_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.fx_rates[0].quote_currency = "USD".to_owned();
        assert!(generate_portfolio_snapshot_pdf_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.asset_classes.push(invalid.asset_classes[0].clone());
        assert!(generate_portfolio_snapshot_pdf_from_snapshot(&request(), &invalid).is_err());
        let mut invalid = snapshot();
        invalid.positions = (0..=MAX_POSITIONS)
            .map(|index| {
                let mut item = snapshot().positions.remove(0);
                item.id = format!("p{index}");
                item
            })
            .collect();
        invalid.summary.position_count = invalid.positions.len() as u32;
        assert!(generate_portfolio_snapshot_pdf_from_snapshot(&request(), &invalid).is_err());
    }
}
