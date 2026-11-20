//! A self-prepared income and spending statement for a trailing window of months, as a PDF.
//!
//! Each month shows income and spending from the household's own posted ledger, and the larger income entries
//! are listed with the original file (name and SHA-256) they came from when one is linked, so a reader can
//! re-hash that file and compare. This is a record the household prepared itself, not a certificate from a
//! third party, and the document says so on its face.

use crate::category_history::{month_list, parse_month};
use crate::evidence_dossier::{heading, line, Layout, MARGIN, PAGE_H, PAGE_W};
use crate::monthly_review_pdf::{
    add_text, draw_rect, format_jpy, install_japanese_font, normalize_pdf_identifiers, rgb,
};
use printpdf::{Mm, PdfDocument, PdfPage, PdfSaveOptions};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::BTreeMap;
use thiserror::Error;

const MAX_MONTHS: u32 = 24;
const MAX_INCOME_ITEMS: i64 = 40;
const MAX_PDF_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum IncomeStatementError {
    #[error("income statement input is invalid")]
    InvalidInput,
    #[error("household was not found")]
    NotFound,
    #[error("income statement is too large")]
    TooLarge,
    #[error("income statement is unavailable")]
    Unavailable,
}

impl IncomeStatementError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput => "The income statement request is invalid",
            Self::NotFound => "The household was not found",
            Self::TooLarge => "The income statement is too large",
            Self::Unavailable => "The income statement is temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonthRow {
    pub month: String,
    pub income_jpy: i64,
    pub expense_jpy: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncomeItem {
    pub occurred_on: String,
    pub payee: Option<String>,
    pub amount_jpy: i64,
    /// (file name, SHA-256) of the first linked original, when there is one.
    pub evidence: Option<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Statement {
    pub household_name: String,
    pub months: Vec<MonthRow>,
    pub items: Vec<IncomeItem>,
}

#[derive(Debug, Clone)]
pub struct IncomeStatementDocument {
    pub file_name: String,
    bytes: Vec<u8>,
}

impl IncomeStatementDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IncomeStatementSavedDto {
    pub file_name: String,
    pub byte_size: u32,
}

pub fn load_statement(
    connection: &Connection,
    household_id: &str,
    through_month: &str,
    months: u32,
) -> Result<Statement, IncomeStatementError> {
    let through = parse_month(through_month).ok_or(IncomeStatementError::InvalidInput)?;
    if household_id.trim().is_empty()
        || household_id.len() > 128
        || !(1..=MAX_MONTHS).contains(&months)
    {
        return Err(IncomeStatementError::InvalidInput);
    }
    let db = |_| IncomeStatementError::Unavailable;
    let household_name: String = connection
        .query_row(
            "SELECT name FROM households WHERE id = ?1",
            params![household_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?
        .ok_or(IncomeStatementError::NotFound)?;
    let labels = month_list(through, months);
    let first = format!("{}-01", labels[0]);
    let after = {
        let (year, month) = if through.1 == 12 {
            (through.0 + 1, 1)
        } else {
            (through.0, through.1 + 1)
        };
        format!("{year:04}-{month:02}-01")
    };
    let mut totals: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    let rows = connection
        .prepare(
            "SELECT substr(t.occurred_on, 1, 7),
                    SUM(CASE WHEN a.account_kind = 'INCOME'
                             THEN CASE je.entry_side WHEN 'CREDIT' THEN je.amount_jpy ELSE -je.amount_jpy END
                             ELSE 0 END),
                    SUM(CASE WHEN a.account_kind = 'EXPENSE'
                             THEN CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END
                             ELSE 0 END)
               FROM transactions t
               JOIN journal_entries je ON je.transaction_id = t.id
               JOIN accounts a ON a.id = je.account_id
              WHERE t.household_id = ?1 AND t.status = 'POSTED' AND t.calculation_target = 1
                AND t.occurred_on >= ?2 AND t.occurred_on < ?3
              GROUP BY substr(t.occurred_on, 1, 7)",
        )
        .map_err(db)?
        .query_map(params![household_id, first, after], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    for (month, income, expense) in rows {
        totals.insert(month, (income, expense));
    }
    let month_rows = labels
        .iter()
        .map(|month| {
            let (income_jpy, expense_jpy) = totals.get(month).copied().unwrap_or((0, 0));
            MonthRow {
                month: month.clone(),
                income_jpy,
                expense_jpy,
            }
        })
        .collect();
    let items = connection
        .prepare(
            "SELECT t.occurred_on, t.payee,
                    SUM(CASE a.account_kind WHEN 'INCOME'
                          THEN CASE je.entry_side WHEN 'CREDIT' THEN je.amount_jpy ELSE -je.amount_jpy END
                          ELSE 0 END) AS income_jpy,
                    (SELECT sd.original_filename || char(9) || sd.sha256
                       FROM transaction_sources ts
                       JOIN source_records sr ON sr.id = ts.source_record_id
                       JOIN source_documents sd ON sd.id = sr.source_document_id
                      WHERE ts.transaction_id = t.id
                      ORDER BY sd.imported_at, sd.sha256 LIMIT 1)
               FROM transactions t
               JOIN journal_entries je ON je.transaction_id = t.id
               JOIN accounts a ON a.id = je.account_id
              WHERE t.household_id = ?1 AND t.status = 'POSTED' AND t.calculation_target = 1
                AND t.occurred_on >= ?2 AND t.occurred_on < ?3
              GROUP BY t.id
             HAVING income_jpy > 0
              ORDER BY income_jpy DESC, t.occurred_on, t.id LIMIT ?4",
        )
        .map_err(db)?
        .query_map(params![household_id, first, after, MAX_INCOME_ITEMS], |row| {
            let evidence: Option<String> = row.get(3)?;
            Ok(IncomeItem {
                occurred_on: row.get(0)?,
                payee: row.get(1)?,
                amount_jpy: row.get(2)?,
                evidence: evidence.and_then(|value| {
                    value
                        .split_once('\t')
                        .map(|(name, hash)| (name.to_owned(), hash.to_owned()))
                }),
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    Ok(Statement {
        household_name,
        months: month_rows,
        items,
    })
}

pub fn render_statement(
    statement: &Statement,
    generated_on: &str,
) -> Result<IncomeStatementDocument, IncomeStatementError> {
    let mut pdf = PdfDocument::new("KakeFlow Income and Spending Statement");
    let font = install_japanese_font(&mut pdf).map_err(|_| IncomeStatementError::Unavailable)?;
    let mut layout = Layout::new();
    let (first, last) = (
        statement
            .months
            .first()
            .map(|row| row.month.as_str())
            .unwrap_or("-"),
        statement
            .months
            .last()
            .map(|row| row.month.as_str())
            .unwrap_or("-"),
    );

    draw_rect(
        layout.ops(),
        0.0,
        PAGE_H - 30.0,
        PAGE_W,
        30.0,
        rgb(0.08, 0.18, 0.26),
    );
    add_text(
        layout.ops(),
        &font,
        MARGIN,
        PAGE_H - 15.0,
        18.0,
        "収支のまとめ（自己作成）",
        rgb(0.96, 0.98, 1.0),
    );
    add_text(
        layout.ops(),
        &font,
        MARGIN,
        PAGE_H - 23.0,
        9.0,
        &format!(
            "{}   {first} ～ {last}   作成日 {generated_on}",
            statement.household_name
        ),
        rgb(0.78, 0.86, 0.9),
    );
    layout.y = PAGE_H - 36.0;

    line(&mut layout, &font, 8.5, "この書類は、世帯自身が KakeFlow の帳簿から作成した記録です。第三者が証明したものではなく、公的な証明書ではありません。裏付けとなる原本は、下記のファイル名と SHA-256 で照合できます。", 0.0);

    heading(&mut layout, &font, "月別の収入と支出");
    let (mut total_income, mut total_expense) = (0_i64, 0_i64);
    for row in &statement.months {
        total_income += row.income_jpy;
        total_expense += row.expense_jpy;
        line(
            &mut layout,
            &font,
            9.0,
            &format!(
                "{}    収入 {}    支出 {}    差引 {}",
                row.month,
                format_jpy(row.income_jpy),
                format_jpy(row.expense_jpy),
                format_jpy(row.income_jpy - row.expense_jpy)
            ),
            0.0,
        );
    }
    line(
        &mut layout,
        &font,
        9.5,
        &format!(
            "合計    収入 {}    支出 {}    差引 {}",
            format_jpy(total_income),
            format_jpy(total_expense),
            format_jpy(total_income - total_expense)
        ),
        0.0,
    );

    heading(
        &mut layout,
        &font,
        &format!("主な収入（金額の大きい順・{}件まで）", MAX_INCOME_ITEMS),
    );
    if statement.items.is_empty() {
        line(
            &mut layout,
            &font,
            9.0,
            "この期間に記録された収入はありません。",
            0.0,
        );
    }
    for item in &statement.items {
        line(
            &mut layout,
            &font,
            9.0,
            &format!(
                "{}  {}  {}",
                item.occurred_on,
                item.payee.as_deref().unwrap_or("-"),
                format_jpy(item.amount_jpy)
            ),
            0.0,
        );
        match &item.evidence {
            Some((name, hash)) => {
                line(&mut layout, &font, 8.0, &format!("原本: {name}"), 5.0);
                line(&mut layout, &font, 8.0, &format!("SHA-256: {hash}"), 5.0);
            }
            None => line(&mut layout, &font, 8.0, "原本の紐づけなし（手入力）", 5.0),
        }
    }

    let mut all_pages = layout.finished;
    all_pages.push(layout.current);
    let total = all_pages.len();
    let mut pages = Vec::with_capacity(total);
    for (index, mut ops) in all_pages.into_iter().enumerate() {
        add_text(
            &mut ops,
            &font,
            PAGE_W - MARGIN - 18.0,
            8.0,
            8.0,
            &format!("{} / {}", index + 1, total),
            rgb(0.4, 0.4, 0.45),
        );
        pages.push(PdfPage::new(Mm(PAGE_W), Mm(PAGE_H), ops));
    }
    let mut warnings = Vec::new();
    let mut bytes = pdf
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut warnings);
    normalize_pdf_identifiers(&mut bytes).map_err(|_| IncomeStatementError::Unavailable)?;
    if !bytes.starts_with(b"%PDF-") || bytes.len() > MAX_PDF_BYTES {
        return Err(IncomeStatementError::TooLarge);
    }
    Ok(IncomeStatementDocument {
        file_name: format!("kakeflow-income-statement-{first}-{last}.pdf"),
        bytes,
    })
}

pub fn generate_income_statement(
    connection: &Connection,
    household_id: &str,
    through_month: &str,
    months: u32,
    generated_on: &str,
) -> Result<IncomeStatementDocument, IncomeStatementError> {
    render_statement(
        &load_statement(connection, household_id, through_month, months)?,
        generated_on,
    )
}

pub fn save_income_statement(
    document: &IncomeStatementDocument,
    destination: &std::path::Path,
) -> Result<IncomeStatementSavedDto, IncomeStatementError> {
    std::fs::write(destination, document.bytes()).map_err(|_| IncomeStatementError::Unavailable)?;
    Ok(IncomeStatementSavedDto {
        file_name: document.file_name.clone(),
        byte_size: document.bytes.len() as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    fn with_db(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(&[4_u8; 32]).expect("migrations");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('home','山田家'),('other','Other');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES
                       ('bank','home','銀行','ASSET','BANK'),
                       ('pay','home','給与','INCOME','OTHER'),
                       ('food','home','食費','EXPENSE','OTHER');
                     INSERT INTO import_runs(id,household_id,adapter_id,status) VALUES('run','home','x','POSTED');
                     INSERT INTO source_documents(id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path)
                       VALUES('doc','home','run','MANUAL_UPLOAD','給与明細.pdf','application/pdf',9,
                              'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','x');
                     INSERT INTO source_records(id,source_document_id,row_number,record_hash,raw_payload_json)
                       VALUES('rec','doc',1,'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','{}');",
                )?;
                test(connection);
                Ok(())
            })
            .expect("body");
    }

    fn add(
        c: &Connection,
        id: &str,
        date: &str,
        status: &str,
        target: i64,
        lines: &[(&str, &str, i64)],
    ) {
        c.execute(
            "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,payee,status,calculation_target)
             VALUES(?1,'home',?2,'INCOME','会社',?3,?4)",
            params![id, date, status, target],
        )
        .unwrap();
        for (n, (account, side, amount)) in lines.iter().enumerate() {
            c.execute(
                "INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number) VALUES(?1,?2,?3,?4,?5,?6)",
                params![format!("{id}{n}"), id, account, side, amount, n as i64 + 1],
            )
            .unwrap();
        }
    }

    #[test]
    fn totals_income_and_spending_per_month_and_links_the_original() {
        with_db(|c| {
            add(
                c,
                "i1",
                "2026-10-25",
                "POSTED",
                1,
                &[("bank", "DEBIT", 300_000), ("pay", "CREDIT", 300_000)],
            );
            add(
                c,
                "i2",
                "2026-11-25",
                "POSTED",
                1,
                &[("bank", "DEBIT", 310_000), ("pay", "CREDIT", 310_000)],
            );
            add(
                c,
                "e1",
                "2026-11-03",
                "POSTED",
                1,
                &[("food", "DEBIT", 5_000), ("bank", "CREDIT", 5_000)],
            );
            c.execute("INSERT INTO transaction_sources(transaction_id,source_record_id) VALUES('i2','rec')", []).unwrap();
            let statement = load_statement(c, "home", "2026-11", 2).unwrap();
            assert_eq!(
                statement.months,
                [
                    MonthRow {
                        month: "2026-10".into(),
                        income_jpy: 300_000,
                        expense_jpy: 0
                    },
                    MonthRow {
                        month: "2026-11".into(),
                        income_jpy: 310_000,
                        expense_jpy: 5_000
                    },
                ]
            );
            assert_eq!(statement.items[0].amount_jpy, 310_000);
            assert_eq!(
                statement.items[0].evidence,
                Some(("給与明細.pdf".into(), "c".repeat(64)))
            );
            assert_eq!(statement.items[1].evidence, None);
            assert_eq!(statement.items.len(), 2);
        });
    }

    #[test]
    fn ignores_drafts_voids_excluded_transactions_other_months_and_other_households() {
        with_db(|c| {
            add(
                c,
                "d",
                "2026-11-01",
                "DRAFT",
                1,
                &[("bank", "DEBIT", 1_000), ("pay", "CREDIT", 1_000)],
            );
            add(
                c,
                "v",
                "2026-11-02",
                "VOID",
                1,
                &[("bank", "DEBIT", 1_000), ("pay", "CREDIT", 1_000)],
            );
            add(
                c,
                "x",
                "2026-11-03",
                "POSTED",
                0,
                &[("bank", "DEBIT", 1_000), ("pay", "CREDIT", 1_000)],
            );
            add(
                c,
                "o",
                "2026-08-03",
                "POSTED",
                1,
                &[("bank", "DEBIT", 1_000), ("pay", "CREDIT", 1_000)],
            );
            let statement = load_statement(c, "home", "2026-11", 2).unwrap();
            assert!(statement.items.is_empty());
            assert!(statement
                .months
                .iter()
                .all(|row| row.income_jpy == 0 && row.expense_jpy == 0));
            assert!(matches!(
                load_statement(c, "other", "2026-11", 2).map(|s| s.items.len()),
                Ok(0)
            ));
        });
    }

    #[test]
    fn renders_a_reproducible_pdf_and_validates_input() {
        with_db(|c| {
            add(
                c,
                "i1",
                "2026-11-25",
                "POSTED",
                1,
                &[("bank", "DEBIT", 300_000), ("pay", "CREDIT", 300_000)],
            );
            let document =
                generate_income_statement(c, "home", "2026-11", 12, "2026-11-20").unwrap();
            assert!(document.bytes().starts_with(b"%PDF-"));
            assert_eq!(
                document.file_name,
                "kakeflow-income-statement-2025-12-2026-11.pdf"
            );
            assert_eq!(
                document.bytes(),
                generate_income_statement(c, "home", "2026-11", 12, "2026-11-20")
                    .unwrap()
                    .bytes()
            );
            assert!(matches!(
                load_statement(c, "nope", "2026-11", 3),
                Err(IncomeStatementError::NotFound)
            ));
            assert!(matches!(
                load_statement(c, "home", "2026-13", 3),
                Err(IncomeStatementError::InvalidInput)
            ));
            assert!(matches!(
                load_statement(c, "home", "2026-11", 0),
                Err(IncomeStatementError::InvalidInput)
            ));
            assert!(matches!(
                load_statement(c, "home", "2026-11", 25),
                Err(IncomeStatementError::InvalidInput)
            ));
            assert!(matches!(
                load_statement(c, " ", "2026-11", 3),
                Err(IncomeStatementError::InvalidInput)
            ));
        });
    }
}
