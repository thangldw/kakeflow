use crate::account_groups_export::{
    canonical_export_table, AccountGroupExportError, ExportCsvRequest, ExportKind,
};
use rust_xlsxwriter::{
    Color, ExcelDateTime, Format, FormatAlign, FormatBorder, Workbook, Worksheet, XlsxError,
};
use serde::Serialize;
use std::path::Path;

const MAX_XLSX_BYTES: usize = 32 * 1024 * 1024;
const MAX_ROWS: usize = 100_000;
const MAX_COLUMNS: usize = 19;
const MAX_CELLS: usize = MAX_ROWS * MAX_COLUMNS;
const MAX_CELL_TEXT_CHARS: usize = 4_096;
const MAX_EXACT_INTEGER: u64 = 9_007_199_254_740_991;
const SHEET_COUNT: u8 = 2;

#[derive(Debug, Clone)]
pub struct TransactionLedgerXlsxDocument {
    pub file_name: String,
    pub row_count: u32,
    pub byte_size: u32,
    bytes: Vec<u8>,
}

impl TransactionLedgerXlsxDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransactionLedgerXlsxSavedDto {
    pub file_name: String,
    pub row_count: u32,
    pub byte_size: u32,
    pub sheet_count: u8,
}

struct Formats {
    header: Format,
    text: Format,
    date: Format,
    jpy: Format,
    boolean: Format,
    scope_label: Format,
    scope_value: Format,
    integer: Format,
}

impl Formats {
    fn new() -> Self {
        let border = FormatBorder::Thin;
        Self {
            header: Format::new()
                .set_bold()
                .set_font_color(Color::White)
                .set_background_color(Color::RGB(0x376A87))
                .set_border(border)
                .set_align(FormatAlign::Center),
            text: Format::new().set_border(border),
            date: Format::new()
                .set_num_format("yyyy-mm-dd")
                .set_border(border),
            jpy: Format::new()
                .set_num_format("[$¥-ja-JP]#,##0;[Red]-[$¥-ja-JP]#,##0")
                .set_border(border),
            boolean: Format::new()
                .set_border(border)
                .set_align(FormatAlign::Center),
            scope_label: Format::new()
                .set_bold()
                .set_background_color(Color::RGB(0xEAF1F5))
                .set_border(border),
            scope_value: Format::new().set_border(border),
            integer: Format::new().set_num_format("#,##0").set_border(border),
        }
    }
}

pub fn generate_transaction_ledger_xlsx(
    connection: &rusqlite::Connection,
    request: &ExportCsvRequest,
) -> Result<TransactionLedgerXlsxDocument, AccountGroupExportError> {
    if request.export_kind != ExportKind::Transactions {
        return Err(AccountGroupExportError::InvalidInput(
            "Transaction ledger workbook only supports transaction exports",
        ));
    }
    let table = canonical_export_table(connection, request)?;
    if table.header.len() != MAX_COLUMNS
        || table.rows.len() > MAX_ROWS
        || table.rows.len().saturating_mul(table.header.len()) > MAX_CELLS
        || table.rows.iter().any(|row| row.len() != table.header.len())
        || table
            .rows
            .iter()
            .flatten()
            .any(|value| value.chars().count() > MAX_CELL_TEXT_CHARS)
    {
        return Err(AccountGroupExportError::TooLarge);
    }

    let formats = Formats::new();
    let mut workbook = Workbook::new();
    write_transactions_sheet(&mut workbook, &table.header, &table.rows, &formats)
        .map_err(workbook_error)?;
    write_scope_sheet(&mut workbook, request, table.rows.len(), &formats)
        .map_err(workbook_error)?;
    let bytes = workbook.save_to_buffer().map_err(workbook_error)?;
    if bytes.len() > MAX_XLSX_BYTES || bytes.len() > u32::MAX as usize {
        return Err(AccountGroupExportError::TooLarge);
    }
    let group_suffix = request
        .group_id
        .as_deref()
        .map(|id| format!("-{id}"))
        .unwrap_or_default();
    Ok(TransactionLedgerXlsxDocument {
        file_name: format!(
            "kakeflow-transactions-{from}-{to}{group_suffix}.xlsx",
            from = request.from_date,
            to = request.to_date
        ),
        row_count: table.rows.len() as u32,
        byte_size: bytes.len() as u32,
        bytes,
    })
}

pub fn save_transaction_ledger_xlsx_document(
    document: &TransactionLedgerXlsxDocument,
    destination: Option<&Path>,
) -> Result<Option<TransactionLedgerXlsxSavedDto>, AccountGroupExportError> {
    let Some(destination) = destination else {
        return Ok(None);
    };
    std::fs::write(destination, document.bytes())
        .map_err(|_| AccountGroupExportError::Unavailable)?;
    Ok(Some(TransactionLedgerXlsxSavedDto {
        file_name: document.file_name.clone(),
        row_count: document.row_count,
        byte_size: document.byte_size,
        sheet_count: SHEET_COUNT,
    }))
}

fn write_transactions_sheet(
    workbook: &mut Workbook,
    header: &[&str],
    rows: &[Vec<String>],
    formats: &Formats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Transactions")?;
    for (column, label) in header.iter().enumerate() {
        sheet.write_string_with_format(0, column as u16, *label, &formats.header)?;
    }
    for (row_index, row) in rows.iter().enumerate() {
        let excel_row = row_index as u32 + 1;
        for (column, value) in row.iter().enumerate() {
            match column {
                1 => write_date(sheet, excel_row, column as u16, value, &formats.date)?,
                2 if value.is_empty() => {
                    sheet.write_blank(excel_row, column as u16, &formats.date)?;
                }
                2 => write_date(sheet, excel_row, column as u16, value, &formats.date)?,
                6 => {
                    let amount = value.parse::<i64>().map_err(|_| {
                        XlsxError::ParameterError("Transaction amount is invalid".to_owned())
                    })?;
                    if amount.unsigned_abs() > MAX_EXACT_INTEGER {
                        return Err(XlsxError::ParameterError(
                            "Transaction amount exceeds Excel exact-integer range".to_owned(),
                        ));
                    }
                    sheet.write_number_with_format(
                        excel_row,
                        column as u16,
                        amount as f64,
                        &formats.jpy,
                    )?;
                }
                8 => {
                    let included = value.parse::<bool>().map_err(|_| {
                        XlsxError::ParameterError("Calculation target is invalid".to_owned())
                    })?;
                    sheet.write_boolean_with_format(
                        excel_row,
                        column as u16,
                        included,
                        &formats.boolean,
                    )?;
                }
                _ => {
                    sheet.write_string_with_format(
                        excel_row,
                        column as u16,
                        value,
                        &formats.text,
                    )?;
                }
            }
        }
    }
    sheet.set_freeze_panes(1, 0)?;
    if !rows.is_empty() {
        sheet.autofilter(0, 0, rows.len() as u32, (header.len() - 1) as u16)?;
    }
    for (column, width) in [
        20.0, 12.0, 12.0, 18.0, 22.0, 32.0, 15.0, 14.0, 14.0, 20.0, 22.0, 20.0, 22.0, 20.0, 22.0,
        14.0, 18.0, 20.0, 22.0,
    ]
    .iter()
    .enumerate()
    {
        sheet.set_column_width(column as u16, *width)?;
    }
    Ok(())
}

fn write_scope_sheet(
    workbook: &mut Workbook,
    request: &ExportCsvRequest,
    row_count: usize,
    formats: &Formats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Scope")?;
    sheet.write_string_with_format(0, 0, "field", &formats.header)?;
    sheet.write_string_with_format(0, 1, "value", &formats.header)?;
    let text_rows = [
        ("household_id", request.household_id.as_str()),
        ("accounting_basis", request.accounting_basis.as_sql()),
        (
            "account_group_id",
            request.group_id.as_deref().unwrap_or("ALL"),
        ),
        ("attribution_scope", request.attribution_scope.sql_kind()),
        (
            "attribution_member_id",
            request.attribution_scope.member_id().unwrap_or(""),
        ),
    ];
    for (index, (label, value)) in text_rows.iter().enumerate() {
        let row = index as u32 + 1;
        sheet.write_string_with_format(row, 0, *label, &formats.scope_label)?;
        sheet.write_string_with_format(row, 1, *value, &formats.scope_value)?;
    }
    for (offset, (label, value)) in [
        ("from_date", request.from_date.as_str()),
        ("to_date", request.to_date.as_str()),
    ]
    .iter()
    .enumerate()
    {
        let row = text_rows.len() as u32 + offset as u32 + 1;
        sheet.write_string_with_format(row, 0, *label, &formats.scope_label)?;
        write_date(sheet, row, 1, value, &formats.date)?;
    }
    let row = text_rows.len() as u32 + 3;
    sheet.write_string_with_format(row, 0, "confirmed_only", &formats.scope_label)?;
    sheet.write_boolean_with_format(row, 1, true, &formats.boolean)?;
    sheet.write_string_with_format(row + 1, 0, "row_count", &formats.scope_label)?;
    sheet.write_number_with_format(row + 1, 1, row_count as f64, &formats.integer)?;
    sheet.set_freeze_panes(1, 0)?;
    sheet.set_column_width(0, 24)?;
    sheet.set_column_width(1, 32)?;
    Ok(())
}

fn write_date(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: &str,
    format: &Format,
) -> Result<(), XlsxError> {
    let year = value.get(0..4).and_then(|part| part.parse::<u16>().ok());
    let month = value.get(5..7).and_then(|part| part.parse::<u8>().ok());
    let day = value.get(8..10).and_then(|part| part.parse::<u8>().ok());
    let (Some(year), Some(month), Some(day)) = (year, month, day) else {
        return Err(XlsxError::ParameterError(
            "Transaction date is invalid".to_owned(),
        ));
    };
    let date = ExcelDateTime::from_ymd(year, month, day)?;
    sheet.write_datetime_with_format(row, column, &date, format)?;
    Ok(())
}

fn workbook_error(error: XlsxError) -> AccountGroupExportError {
    match error {
        XlsxError::ParameterError(_) => {
            AccountGroupExportError::InvalidInput("Transaction ledger workbook data is invalid")
        }
        _ => AccountGroupExportError::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::record_scope::AttributionScope;
    use rusqlite::Connection;
    use std::io::Read;

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
             INSERT INTO transactions VALUES('tx-1','home','2026-07-12','2026-07-13','EXPENSE','Market','食料品','POSTED',1,'MEMBER','taro','2026-07-12T10:00:00Z');
             INSERT INTO journal_entries VALUES('je-1','tx-1','food',0,'DEBIT',1200),('je-2','tx-1','bank',1,'CREDIT',1200);"
        ).unwrap();
        connection
    }

    fn request() -> ExportCsvRequest {
        ExportCsvRequest {
            household_id: "home".into(),
            export_kind: ExportKind::Transactions,
            accounting_basis: crate::account_groups_export::ExportAccountingBasis::Accrual,
            group_id: Some("daily".into()),
            attribution_scope: AttributionScope::Member {
                member_id: "taro".into(),
            },
            from_date: "2026-07-01".into(),
            to_date: "2026-07-31".into(),
        }
    }

    #[test]
    fn workbook_uses_canonical_rows_typed_cells_and_exact_scope() {
        let connection = database();
        let request = request();
        let table = canonical_export_table(&connection, &request).unwrap();
        let document = generate_transaction_ledger_xlsx(&connection, &request).unwrap();
        assert_eq!(document.row_count as usize, table.rows.len());
        assert!(document.file_name.ends_with("-daily.xlsx"));
        assert_eq!(document.byte_size as usize, document.bytes().len());

        let cursor = std::io::Cursor::new(document.bytes());
        let mut archive = zip::ZipArchive::new(cursor).unwrap();
        let mut workbook_xml = String::new();
        archive
            .by_name("xl/workbook.xml")
            .unwrap()
            .read_to_string(&mut workbook_xml)
            .unwrap();
        assert!(workbook_xml.contains("Transactions"));
        assert!(workbook_xml.contains("Scope"));
        let mut transactions_xml = String::new();
        archive
            .by_name("xl/worksheets/sheet1.xml")
            .unwrap()
            .read_to_string(&mut transactions_xml)
            .unwrap();
        assert!(transactions_xml.contains("<autoFilter"));
        assert!(transactions_xml.contains("<pane ySplit=\"1\""));
        assert!(transactions_xml.contains("<c r=\"G2\" s="));
        assert!(transactions_xml.contains("<v>1200</v>"));
        assert!(transactions_xml.contains("<c r=\"I2\" s="));
        assert!(transactions_xml.contains(" t=\"b\""));
        let mut shared = String::new();
        archive
            .by_name("xl/sharedStrings.xml")
            .unwrap()
            .read_to_string(&mut shared)
            .unwrap();
        for expected in [
            "household_id",
            "home",
            "accounting_basis",
            "ACCRUAL",
            "attribution_scope",
            "MEMBER",
            "taro",
            "食料品",
        ] {
            assert!(shared.contains(expected), "missing {expected}");
        }
    }

    #[test]
    fn workbook_rejects_non_transaction_exports_and_preserves_cancel() {
        let connection = database();
        let mut portfolio_request = request();
        portfolio_request.export_kind = ExportKind::PortfolioSnapshots;
        assert!(matches!(
            generate_transaction_ledger_xlsx(&connection, &portfolio_request),
            Err(AccountGroupExportError::InvalidInput(_))
        ));
        let document = generate_transaction_ledger_xlsx(&connection, &request()).unwrap();
        assert_eq!(
            save_transaction_ledger_xlsx_document(&document, None).unwrap(),
            None
        );

        connection
            .execute(
                "UPDATE journal_entries SET amount_jpy = 9007199254740992",
                [],
            )
            .unwrap();
        assert!(matches!(
            generate_transaction_ledger_xlsx(&connection, &request()),
            Err(AccountGroupExportError::InvalidInput(_))
        ));
    }
}
