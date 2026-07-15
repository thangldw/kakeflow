use crate::{
    account_groups_export::{
        canonical_export_table, AccountGroupExportError, ExportCsvRequest, ExportKind,
    },
    monthly_review_pdf::{
        add_text, draw_rect, format_jpy, install_japanese_font, normalize_pdf_identifiers, rgb,
    },
};
use printpdf::{FontId, Mm, Op, PdfDocument, PdfPage, PdfSaveOptions};
use serde::Serialize;
use std::path::Path;

const MAX_PDF_BYTES: usize = 32 * 1024 * 1024;
const MAX_PDF_ROWS: usize = 500;
const MAX_PDF_PAGES: usize = 128;
const MAX_CELL_TEXT_CHARS: usize = 512;
const DETAIL_TOP_MM: f32 = 181.0;
const DETAIL_BOTTOM_MM: f32 = 15.0;
const MAIN_LINE_HEIGHT_MM: f32 = 3.4;
const META_LINE_HEIGHT_MM: f32 = 3.0;
const COLUMN_X: [f32; 9] = [10.0, 30.0, 50.0, 78.0, 120.0, 172.0, 198.0, 224.0, 267.0];
const COLUMN_WIDTH: [f32; 9] = [20.0, 20.0, 28.0, 42.0, 52.0, 26.0, 26.0, 43.0, 12.0];
const COLUMN_WRAP_UNITS: [usize; 9] = [16, 16, 23, 35, 43, 21, 21, 35, 8];
const COLUMN_LABELS: [&str; 9] = [
    "利用日",
    "計上日",
    "取引種別",
    "支払先",
    "摘要",
    "金額 (JPY)",
    "状態",
    "カテゴリ",
    "集計",
];

#[derive(Debug, Clone)]
pub struct TransactionLedgerPdfDocument {
    pub file_name: String,
    pub media_type: &'static str,
    pub row_count: u32,
    pub page_count: u16,
    pub byte_size: u32,
    bytes: Vec<u8>,
}

impl TransactionLedgerPdfDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransactionLedgerPdfSavedDto {
    pub file_name: String,
    pub row_count: u32,
    pub page_count: u16,
    pub byte_size: u32,
}

#[derive(Debug, Clone)]
struct RenderedRow {
    main: Vec<Vec<String>>,
    metadata: Vec<String>,
    height_mm: f32,
}

pub fn generate_transaction_ledger_pdf(
    connection: &rusqlite::Connection,
    request: &ExportCsvRequest,
) -> Result<TransactionLedgerPdfDocument, AccountGroupExportError> {
    if request.export_kind != ExportKind::Transactions {
        return Err(AccountGroupExportError::InvalidInput(
            "Transaction ledger PDF only supports transaction exports",
        ));
    }
    let table = canonical_export_table(connection, request)?;
    if table.header.len() != 19
        || table.rows.len() > MAX_PDF_ROWS
        || table.rows.iter().any(|row| row.len() != table.header.len())
        || table
            .rows
            .iter()
            .flatten()
            .any(|value| value.chars().count() > MAX_CELL_TEXT_CHARS)
    {
        return Err(AccountGroupExportError::TooLarge);
    }

    let rendered_rows = table
        .rows
        .iter()
        .map(|row| render_row(row))
        .collect::<Result<Vec<_>, _>>()?;
    let detail_pages = paginate_rows(rendered_rows)?;
    let page_count = 1usize
        .checked_add(detail_pages.len())
        .filter(|count| *count <= MAX_PDF_PAGES && *count <= u16::MAX as usize)
        .ok_or(AccountGroupExportError::TooLarge)?;

    let mut pdf = PdfDocument::new("KakeFlow Transaction Ledger");
    let font_id =
        install_japanese_font(&mut pdf).map_err(|_| AccountGroupExportError::Unavailable)?;
    let mut pages = Vec::with_capacity(page_count);
    pages.push(render_cover(
        request,
        table.rows.len(),
        page_count,
        &font_id,
    ));
    pages.extend(
        detail_pages
            .into_iter()
            .enumerate()
            .map(|(index, rows)| render_detail_page(rows, index + 2, page_count, &font_id)),
    );
    let mut warnings = Vec::new();
    let mut bytes = pdf
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut warnings);
    normalize_pdf_identifiers(&mut bytes).map_err(|_| AccountGroupExportError::Unavailable)?;
    if !bytes.starts_with(b"%PDF-")
        || bytes.len() > MAX_PDF_BYTES
        || bytes.len() > u32::MAX as usize
    {
        return Err(AccountGroupExportError::TooLarge);
    }
    let group_suffix = request
        .group_id
        .as_deref()
        .map(|id| format!("-{id}"))
        .unwrap_or_default();
    Ok(TransactionLedgerPdfDocument {
        file_name: format!(
            "kakeflow-transactions-{from}-{to}{group_suffix}.pdf",
            from = request.from_date,
            to = request.to_date,
        ),
        media_type: "application/pdf",
        row_count: table.rows.len() as u32,
        page_count: page_count as u16,
        byte_size: bytes.len() as u32,
        bytes,
    })
}

pub fn save_transaction_ledger_pdf_document(
    document: &TransactionLedgerPdfDocument,
    destination: Option<&Path>,
) -> Result<Option<TransactionLedgerPdfSavedDto>, AccountGroupExportError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.bytes())
        .map_err(|_| AccountGroupExportError::Unavailable)?;
    Ok(Some(TransactionLedgerPdfSavedDto {
        file_name: document.file_name.clone(),
        row_count: document.row_count,
        page_count: document.page_count,
        byte_size: document.byte_size,
    }))
}

fn render_row(row: &[String]) -> Result<RenderedRow, AccountGroupExportError> {
    let amount = row[6].parse::<i64>().map_err(|_| invalid_pdf())?;
    let calculation_target = match row[8].as_str() {
        "true" => "対象",
        "false" => "対象外",
        _ => return Err(invalid_pdf()),
    };
    let main_values = [
        row[1].as_str(),
        empty_as_dash(&row[2]),
        row[3].as_str(),
        empty_as_dash(&row[4]),
        empty_as_dash(&row[5]),
        &format_jpy(amount),
        row[7].as_str(),
        empty_as_dash(&row[14]),
        calculation_target,
    ];
    let main = main_values
        .iter()
        .zip(COLUMN_WRAP_UNITS)
        .map(|(value, width)| wrap_text(value, width))
        .collect::<Vec<_>>();
    let main_lines = main.iter().map(Vec::len).max().unwrap_or(1);
    let attribution = if row[18].is_empty() {
        row[17].clone()
    } else {
        format!("{}:{}", row[17], row[18])
    };
    let metadata_text = format!(
        "取引ID: {}  |  借方: {} ({})  |  貸方: {} ({})  |  カテゴリID: {}  |  基準: {}  |  グループ: {}  |  帰属: {}",
        row[0],
        empty_as_dash(&row[10]),
        empty_as_dash(&row[9]),
        empty_as_dash(&row[12]),
        empty_as_dash(&row[11]),
        empty_as_dash(&row[13]),
        row[15],
        empty_as_dash(&row[16]),
        attribution,
    );
    let metadata = wrap_text(&metadata_text, 190);
    let height_mm =
        4.0 + main_lines as f32 * MAIN_LINE_HEIGHT_MM + metadata.len() as f32 * META_LINE_HEIGHT_MM;
    if height_mm > DETAIL_TOP_MM - DETAIL_BOTTOM_MM {
        return Err(AccountGroupExportError::TooLarge);
    }
    Ok(RenderedRow {
        main,
        metadata,
        height_mm,
    })
}

fn paginate_rows(rows: Vec<RenderedRow>) -> Result<Vec<Vec<RenderedRow>>, AccountGroupExportError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let mut pages = Vec::new();
    let mut page = Vec::new();
    let mut remaining = DETAIL_TOP_MM - DETAIL_BOTTOM_MM;
    for row in rows {
        if !page.is_empty() && row.height_mm > remaining {
            pages.push(std::mem::take(&mut page));
            remaining = DETAIL_TOP_MM - DETAIL_BOTTOM_MM;
        }
        if row.height_mm > remaining {
            return Err(AccountGroupExportError::TooLarge);
        }
        remaining -= row.height_mm;
        page.push(row);
    }
    if !page.is_empty() {
        pages.push(page);
    }
    // Greedy pagination can leave a single orphan row on the final page even
    // when the preceding page can be split into two balanced, readable pages.
    // Rebalance adjacent pages from the end without changing source order or
    // splitting any transaction row.
    if pages.len() >= 2 {
        for right_index in (1..pages.len()).rev() {
            loop {
                let left_index = right_index - 1;
                if pages[right_index].len() + 1 >= pages[left_index].len() {
                    break;
                }
                let Some(candidate_height) = pages[left_index].last().map(|row| row.height_mm)
                else {
                    break;
                };
                let right_height = pages[right_index]
                    .iter()
                    .map(|row| row.height_mm)
                    .sum::<f32>();
                if right_height + candidate_height > DETAIL_TOP_MM - DETAIL_BOTTOM_MM {
                    break;
                }
                let candidate = pages[left_index].pop().expect("row exists");
                pages[right_index].insert(0, candidate);
            }
        }
    }
    if pages.len() + 1 > MAX_PDF_PAGES {
        return Err(AccountGroupExportError::TooLarge);
    }
    Ok(pages)
}

fn render_cover(
    request: &ExportCsvRequest,
    row_count: usize,
    total_pages: usize,
    font_id: &FontId,
) -> PdfPage {
    let mut ops = Vec::new();
    draw_rect(&mut ops, 0.0, 174.0, 297.0, 36.0, rgb(0.08, 0.18, 0.26));
    add_text(
        &mut ops,
        font_id,
        14.0,
        194.0,
        20.0,
        "取引台帳 / Transaction Ledger",
        rgb(0.96, 0.98, 1.0),
    );
    add_text(
        &mut ops,
        font_id,
        14.0,
        181.5,
        9.0,
        &format!("{} - {}", request.from_date, request.to_date),
        rgb(0.78, 0.86, 0.90),
    );
    let scope = [
        ("確定取引", format!("{row_count}件")),
        ("計上基準", request.accounting_basis.as_sql().to_owned()),
        (
            "口座グループ",
            request.group_id.clone().unwrap_or_else(|| "ALL".to_owned()),
        ),
        (
            "家族内帰属",
            request.attribution_scope.sql_kind().to_owned(),
        ),
        (
            "帰属メンバー",
            request
                .attribution_scope
                .member_id()
                .unwrap_or("-")
                .to_owned(),
        ),
        ("世帯ID", request.household_id.clone()),
    ];
    for (index, (label, value)) in scope.iter().enumerate() {
        let column = index % 3;
        let row = index / 3;
        let x = 14.0 + column as f32 * 92.0;
        let y = 139.0 - row as f32 * 35.0;
        draw_rect(&mut ops, x, y, 86.0, 28.0, rgb(0.94, 0.96, 0.97));
        add_text(
            &mut ops,
            font_id,
            x + 4.0,
            y + 18.0,
            7.5,
            label,
            rgb(0.38, 0.43, 0.47),
        );
        for (line, text) in wrap_text(value, 48).into_iter().take(2).enumerate() {
            add_text(
                &mut ops,
                font_id,
                x + 4.0,
                y + 8.5 - line as f32 * 4.2,
                9.0,
                &text,
                rgb(0.08, 0.18, 0.26),
            );
        }
    }
    add_text(
        &mut ops,
        font_id,
        14.0,
        61.0,
        11.0,
        "集計と監査の前提",
        rgb(0.10, 0.19, 0.27),
    );
    for (index, line) in [
        "• CSV / Excelと同じ検証済みの確定取引テーブルを使用しています。",
        "• 発生ベースではカード購入を計上し、銀行のカード支払を支出に二重計上しません。",
        "• 資金移動ベースでは実際の入出金を表示し、カード購入そのものは除外します。",
        "• 未確認候補、未取込ファイル、確認待ちOCRはこの台帳に含まれません。",
    ]
    .iter()
    .enumerate()
    {
        add_text(
            &mut ops,
            font_id,
            14.0,
            50.0 - index as f32 * 8.0,
            8.0,
            line,
            rgb(0.22, 0.27, 0.30),
        );
    }
    add_footer(&mut ops, 1, total_pages, font_id);
    PdfPage::new(Mm(297.0), Mm(210.0), ops)
}

fn render_detail_page(
    rows: Vec<RenderedRow>,
    page: usize,
    total_pages: usize,
    font_id: &FontId,
) -> PdfPage {
    let mut ops = Vec::new();
    draw_rect(&mut ops, 0.0, 191.0, 297.0, 19.0, rgb(0.08, 0.18, 0.26));
    add_text(
        &mut ops,
        font_id,
        10.0,
        199.0,
        11.0,
        "確定取引明細",
        rgb(0.96, 0.98, 1.0),
    );
    draw_rect(&mut ops, 10.0, 181.0, 269.0, 8.0, rgb(0.19, 0.47, 0.50));
    for ((x, width), label) in COLUMN_X.iter().zip(COLUMN_WIDTH).zip(COLUMN_LABELS) {
        add_text(
            &mut ops,
            font_id,
            *x + 1.0,
            183.8,
            6.2,
            label,
            rgb(0.96, 0.98, 1.0),
        );
        draw_rect(
            &mut ops,
            *x + width - 0.2,
            181.0,
            0.2,
            8.0,
            rgb(0.40, 0.66, 0.67),
        );
    }

    let mut y = DETAIL_TOP_MM;
    for (row_index, row) in rows.into_iter().enumerate() {
        let bottom = y - row.height_mm;
        let background = if row_index.is_multiple_of(2) {
            rgb(0.97, 0.98, 0.98)
        } else {
            rgb(1.0, 1.0, 1.0)
        };
        draw_rect(&mut ops, 10.0, bottom, 269.0, row.height_mm, background);
        let main_lines = row.main.iter().map(Vec::len).max().unwrap_or(1);
        for (column, lines) in row.main.iter().enumerate() {
            for (line_index, text) in lines.iter().enumerate() {
                add_text(
                    &mut ops,
                    font_id,
                    COLUMN_X[column] + 1.0,
                    y - 3.2 - line_index as f32 * MAIN_LINE_HEIGHT_MM,
                    6.0,
                    text,
                    rgb(0.14, 0.18, 0.21),
                );
            }
        }
        let metadata_top = y - 3.2 - main_lines as f32 * MAIN_LINE_HEIGHT_MM;
        for (line_index, text) in row.metadata.iter().enumerate() {
            add_text(
                &mut ops,
                font_id,
                11.0,
                metadata_top - line_index as f32 * META_LINE_HEIGHT_MM,
                5.4,
                text,
                rgb(0.39, 0.44, 0.47),
            );
        }
        draw_rect(&mut ops, 10.0, bottom, 269.0, 0.2, rgb(0.82, 0.86, 0.87));
        y = bottom;
    }
    add_footer(&mut ops, page, total_pages, font_id);
    PdfPage::new(Mm(297.0), Mm(210.0), ops)
}

fn add_footer(ops: &mut Vec<Op>, page: usize, total: usize, font_id: &FontId) {
    add_text(
        ops,
        font_id,
        244.0,
        7.0,
        7.5,
        &format!("KakeFlow  {page}/{total}"),
        rgb(0.38, 0.42, 0.46),
    );
}

fn wrap_text(value: &str, max_units: usize) -> Vec<String> {
    let normalized = value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let normalized = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    let normalized = if normalized.is_empty() {
        "-".to_owned()
    } else {
        normalized
    };
    let mut lines = Vec::new();
    let mut line = String::new();
    let mut units = 0usize;
    for character in normalized.chars() {
        let character_units = if character.is_ascii() { 1 } else { 2 };
        if !line.is_empty() && units + character_units > max_units {
            lines.push(std::mem::take(&mut line));
            units = 0;
        }
        line.push(character);
        units += character_units;
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

fn empty_as_dash(value: &str) -> &str {
    if value.is_empty() {
        "-"
    } else {
        value
    }
}

fn invalid_pdf() -> AccountGroupExportError {
    AccountGroupExportError::InvalidInput("Transaction ledger PDF data is invalid")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{account_groups_export::ExportAccountingBasis, record_scope::AttributionScope};
    use rusqlite::{params, Connection};
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE households(id TEXT PRIMARY KEY, name TEXT);
             CREATE TABLE household_members(id TEXT PRIMARY KEY, household_id TEXT, display_name TEXT, status TEXT);
             CREATE TABLE accounts(id TEXT PRIMARY KEY, household_id TEXT, name TEXT, account_kind TEXT, account_subtype TEXT);
             CREATE TABLE account_groups(id TEXT PRIMARY KEY, household_id TEXT, name TEXT, group_kind TEXT, sort_order INTEGER, created_at TEXT, updated_at TEXT);
             CREATE TABLE account_group_members(household_id TEXT, account_group_id TEXT, account_id TEXT, sort_order INTEGER);
             CREATE TABLE transactions(id TEXT PRIMARY KEY, household_id TEXT, occurred_on TEXT, posted_on TEXT, transaction_type TEXT, payee TEXT, description TEXT, status TEXT, calculation_target INTEGER, attribution_kind TEXT, attributed_member_id TEXT, created_at TEXT);
             CREATE TABLE journal_entries(id TEXT PRIMARY KEY, transaction_id TEXT, account_id TEXT, line_number INTEGER, entry_side TEXT, amount_jpy INTEGER);
             INSERT INTO households VALUES('home','Home');
             INSERT INTO household_members VALUES('taro','home','Taro','ACTIVE');
             INSERT INTO accounts VALUES('bank','home','Bank','ASSET','BANK'),('food','home','食費','EXPENSE','OTHER');
             INSERT INTO account_groups VALUES('daily','home','Daily','DAILY_SPENDING',0,'2026-01-01','2026-01-01');
             INSERT INTO account_group_members VALUES('home','daily','bank',0),('home','daily','food',1);
             INSERT INTO transactions VALUES('tx-1','home','2026-07-12','2026-07-13','EXPENSE','生協','食料品と日用品','POSTED',1,'MEMBER','taro','2026-07-12T10:00:00Z');
             INSERT INTO journal_entries VALUES('je-1','tx-1','food',0,'DEBIT',1200),('je-2','tx-1','bank',1,'CREDIT',1200);",
        ).unwrap();
        for index in 2..=16 {
            let occurred_on = format!("2026-07-{index:02}");
            let transaction_id = format!("tx-{index}");
            let description = if index == 8 {
                "家族の週末まとめ買い・軽減税率対象商品を含む長い摘要テキスト"
            } else {
                "食料品と日用品"
            };
            connection.execute(
                "INSERT INTO transactions VALUES(?1,'home',?2,NULL,'EXPENSE',?3,?4,'POSTED',?5,'MEMBER','taro',?6)",
                params![
                    transaction_id,
                    occurred_on,
                    format!("地域の生活協同組合 第{index}店舗"),
                    description,
                    i64::from(index % 3 != 0),
                    format!("2026-07-{index:02}T10:00:00Z"),
                ],
            ).unwrap();
            connection
                .execute(
                    "INSERT INTO journal_entries VALUES(?1,?2,'food',0,'DEBIT',?3)",
                    params![
                        format!("je-{index}-d"),
                        transaction_id,
                        i64::from(index) * 100
                    ],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO journal_entries VALUES(?1,?2,'bank',1,'CREDIT',?3)",
                    params![
                        format!("je-{index}-c"),
                        transaction_id,
                        i64::from(index) * 100
                    ],
                )
                .unwrap();
        }
        connection
    }

    fn request() -> ExportCsvRequest {
        ExportCsvRequest {
            household_id: "home".into(),
            export_kind: ExportKind::Transactions,
            accounting_basis: ExportAccountingBasis::Accrual,
            group_id: Some("daily".into()),
            attribution_scope: AttributionScope::Member {
                member_id: "taro".into(),
            },
            from_date: "2026-07-01".into(),
            to_date: "2026-07-31".into(),
        }
    }

    #[test]
    fn pdf_uses_exact_canonical_scope_and_is_deterministic() {
        let connection = database();
        let table = canonical_export_table(&connection, &request()).unwrap();
        let balanced_pages = paginate_rows(
            table
                .rows
                .iter()
                .map(|row| render_row(row))
                .collect::<Result<Vec<_>, _>>()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            balanced_pages.iter().map(Vec::len).collect::<Vec<_>>(),
            vec![8, 8]
        );
        let first = generate_transaction_ledger_pdf(&connection, &request()).unwrap();
        let second = generate_transaction_ledger_pdf(&connection, &request()).unwrap();
        assert_eq!(first.row_count as usize, table.rows.len());
        assert_eq!(
            first.file_name,
            "kakeflow-transactions-2026-07-01-2026-07-31-daily.pdf"
        );
        assert_eq!(first.media_type, "application/pdf");
        assert_eq!(first.row_count, 16);
        assert!(first.page_count >= 3);
        assert_eq!(first.byte_size as usize, first.bytes().len());
        assert_eq!(
            Sha256::digest(first.bytes()),
            Sha256::digest(second.bytes())
        );
        if let Ok(destination) = std::env::var("KAKEFLOW_TRANSACTION_LEDGER_PDF_FIXTURE") {
            let destination = std::path::PathBuf::from(destination);
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(destination, first.bytes()).unwrap();
        }
        let pages = pdf_extract::extract_text_from_mem_by_pages(first.bytes()).unwrap();
        assert_eq!(pages.len(), first.page_count as usize);
        let text = pages.join("\n");
        for expected in [
            "Transaction Ledger",
            "ACCRUAL",
            "daily",
            "MEMBER",
            "taro",
            "tx-1",
            "EXPENSE",
            "1,200",
        ] {
            assert!(text.contains(expected), "missing {expected}");
        }
    }

    #[test]
    fn pdf_rejects_wrong_export_and_preserves_cancel_and_save() {
        let connection = database();
        let mut wrong = request();
        wrong.export_kind = ExportKind::PortfolioSnapshots;
        assert!(matches!(
            generate_transaction_ledger_pdf(&connection, &wrong),
            Err(AccountGroupExportError::InvalidInput(_))
        ));
        let document = generate_transaction_ledger_pdf(&connection, &request()).unwrap();
        assert_eq!(
            save_transaction_ledger_pdf_document(&document, None).unwrap(),
            None
        );
        let directory = tempdir().unwrap();
        let path = directory.path().join(&document.file_name);
        let saved = save_transaction_ledger_pdf_document(&document, Some(&path))
            .unwrap()
            .unwrap();
        assert_eq!(saved.row_count, 16);
        assert_eq!(saved.page_count, document.page_count);
        assert_eq!(std::fs::read(path).unwrap(), document.bytes());
    }
}
