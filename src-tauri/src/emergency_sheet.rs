//! A one-page "if something happens to me" sheet: the household's accounts and confirmed regular payments from
//! the ledger, how to restore the backup, and blank lines to fill in by hand (contacts, where the passphrase and
//! backup are kept). It deliberately contains no secret: the passphrase and any key are never written here, and
//! the blank lines are for a note of *where* they are, on paper.

use crate::evidence_dossier::{heading, line, Layout, MARGIN, PAGE_H, PAGE_W};
use crate::monthly_review_pdf::{
    add_text, draw_rect, install_japanese_font, normalize_pdf_identifiers, rgb,
};
use printpdf::{Mm, PdfDocument, PdfPage, PdfSaveOptions};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use thiserror::Error;

const MAX_ACCOUNTS: usize = 80;
const MAX_PAYEES: usize = 80;
const MAX_PDF_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum EmergencySheetError {
    #[error("emergency sheet input is invalid")]
    InvalidInput,
    #[error("household was not found")]
    NotFound,
    #[error("emergency sheet is too large")]
    TooLarge,
    #[error("emergency sheet is unavailable")]
    Unavailable,
}

impl EmergencySheetError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput => "The household could not be identified",
            Self::NotFound => "The household was not found",
            Self::TooLarge => "This household has too many accounts for one sheet",
            Self::Unavailable => "The emergency sheet is temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetAccount {
    pub name: String,
    pub kind: String,
    pub subtype: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetData {
    pub household_name: String,
    pub accounts: Vec<SheetAccount>,
    pub regular_payees: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct EmergencySheetDocument {
    pub file_name: String,
    bytes: Vec<u8>,
}

impl EmergencySheetDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmergencySheetSavedDto {
    pub file_name: String,
    pub byte_size: u32,
}

pub fn load_sheet(
    connection: &Connection,
    household_id: &str,
) -> Result<SheetData, EmergencySheetError> {
    if household_id.trim().is_empty() || household_id.len() > 128 {
        return Err(EmergencySheetError::InvalidInput);
    }
    let db = |_| EmergencySheetError::Unavailable;
    let household_name: String = connection
        .query_row(
            "SELECT name FROM households WHERE id = ?1",
            params![household_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?
        .ok_or(EmergencySheetError::NotFound)?;
    let accounts = connection
        .prepare(
            "SELECT name, account_kind, account_subtype FROM accounts
              WHERE household_id = ?1 AND is_archived = 0 AND account_kind IN ('ASSET', 'LIABILITY')
              ORDER BY account_kind, account_subtype, name LIMIT ?2",
        )
        .map_err(db)?
        .query_map(params![household_id, MAX_ACCOUNTS as i64 + 1], |row| {
            Ok(SheetAccount {
                name: row.get(0)?,
                kind: row.get(1)?,
                subtype: row.get(2)?,
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let regular_payees = connection
        .prepare(
            "SELECT normalized_payee FROM recurring_series_preferences
              WHERE household_id = ?1 AND decision = 'CONFIRMED'
              ORDER BY normalized_payee LIMIT ?2",
        )
        .map_err(db)?
        .query_map(params![household_id, MAX_PAYEES as i64 + 1], |row| {
            row.get(0)
        })
        .map_err(db)?
        .collect::<Result<Vec<String>, _>>()
        .map_err(db)?;
    if accounts.len() > MAX_ACCOUNTS || regular_payees.len() > MAX_PAYEES {
        return Err(EmergencySheetError::TooLarge);
    }
    Ok(SheetData {
        household_name,
        accounts,
        regular_payees,
    })
}

fn kind_label(account: &SheetAccount) -> &'static str {
    match (account.kind.as_str(), account.subtype.as_str()) {
        (_, "BANK") => "銀行口座",
        (_, "CASH") => "現金",
        (_, "WALLET") => "電子マネー・ウォレット",
        (_, "SECURITIES") => "証券口座",
        (_, "CREDIT_CARD") => "クレジットカード",
        ("LIABILITY", _) => "負債・ローン",
        _ => "その他の資産",
    }
}

pub fn render_sheet(
    data: &SheetData,
    generated_on: &str,
) -> Result<EmergencySheetDocument, EmergencySheetError> {
    let mut pdf = PdfDocument::new("KakeFlow Emergency Sheet");
    let font = install_japanese_font(&mut pdf).map_err(|_| EmergencySheetError::Unavailable)?;
    let mut layout = Layout::new();

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
        "緊急時の連絡・手順シート",
        rgb(0.96, 0.98, 1.0),
    );
    add_text(
        layout.ops(),
        &font,
        MARGIN,
        PAGE_H - 23.0,
        9.0,
        &format!("{}   作成日 {generated_on}", data.household_name),
        rgb(0.78, 0.86, 0.9),
    );
    layout.y = PAGE_H - 36.0;

    line(&mut layout, &font, 8.5, "このシートには暗証番号・パスフレーズ・鍵は書かないでください。「どこに保管しているか」だけを手書きで記入し、安全な場所に保管してください。", 0.0);

    heading(
        &mut layout,
        &font,
        "口座・カード（KakeFlow に登録されているもの）",
    );
    if data.accounts.is_empty() {
        line(
            &mut layout,
            &font,
            9.0,
            "登録されている口座はありません。",
            0.0,
        );
    }
    for account in &data.accounts {
        line(
            &mut layout,
            &font,
            9.0,
            &format!("・{}（{}）", account.name, kind_label(account)),
            0.0,
        );
    }

    heading(&mut layout, &font, "定期的な支払い（確認済み）");
    if data.regular_payees.is_empty() {
        line(
            &mut layout,
            &font,
            9.0,
            "確認済みの定期的な支払いはありません。",
            0.0,
        );
    }
    for payee in &data.regular_payees {
        line(&mut layout, &font, 9.0, &format!("・{payee}"), 0.0);
    }

    heading(&mut layout, &font, "データの復元方法");
    for step in [
        "1. KakeFlow を起動し、「設定」を開く。",
        "2. 「バックアップを選択して復元」で、保管しているバックアップファイルを選ぶ。",
        "3. 「復元用パスフレーズ」を入力する（パスフレーズは下の保管場所で確認）。",
    ] {
        line(&mut layout, &font, 9.0, step, 0.0);
    }

    for title in [
        "連絡先（家族・税理士・金融機関など）",
        "バックアップファイルの保管場所",
        "パスフレーズを保管している場所（パスフレーズ自体は書かない）",
        "その他のメモ",
    ] {
        heading(&mut layout, &font, title);
        for _ in 0..4 {
            layout.ensure(9.0);
            let y = layout.y - 8.0;
            draw_rect(
                layout.ops(),
                MARGIN,
                y,
                PAGE_W - 2.0 * MARGIN,
                0.2,
                rgb(0.55, 0.58, 0.62),
            );
            layout.y = y;
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
    normalize_pdf_identifiers(&mut bytes).map_err(|_| EmergencySheetError::Unavailable)?;
    if !bytes.starts_with(b"%PDF-") || bytes.len() > MAX_PDF_BYTES {
        return Err(EmergencySheetError::TooLarge);
    }
    Ok(EmergencySheetDocument {
        file_name: format!("kakeflow-emergency-sheet-{generated_on}.pdf"),
        bytes,
    })
}

pub fn generate_emergency_sheet(
    connection: &Connection,
    household_id: &str,
    generated_on: &str,
) -> Result<EmergencySheetDocument, EmergencySheetError> {
    render_sheet(&load_sheet(connection, household_id)?, generated_on)
}

pub fn save_emergency_sheet(
    document: &EmergencySheetDocument,
    destination: &std::path::Path,
) -> Result<EmergencySheetSavedDto, EmergencySheetError> {
    std::fs::write(destination, document.bytes()).map_err(|_| EmergencySheetError::Unavailable)?;
    Ok(EmergencySheetSavedDto {
        file_name: document.file_name.clone(),
        byte_size: document.bytes.len() as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    fn with_db(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(&[2_u8; 32]).expect("migrations");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('home','山田家'),('other','Other');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES
                       ('bank','home','メイン銀行','ASSET','BANK'),
                       ('card','home','楽天カード','LIABILITY','CREDIT_CARD'),
                       ('food','home','食費','EXPENSE','OTHER'),
                       ('x','other','他人の口座','ASSET','BANK');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,is_archived)
                       VALUES('old','home','閉じた口座','ASSET','BANK',1);
                     INSERT INTO recurring_series_preferences(household_id,normalized_payee,decision)
                       VALUES('home','netflix','CONFIRMED'),('home','spam','IGNORED'),('other','zzz','CONFIRMED');",
                )?;
                test(connection);
                Ok(())
            })
            .expect("body");
    }

    #[test]
    fn lists_only_this_households_open_asset_and_liability_accounts_and_confirmed_payees() {
        with_db(|c| {
            let data = load_sheet(c, "home").unwrap();
            assert_eq!(data.household_name, "山田家");
            let names: Vec<_> = data.accounts.iter().map(|a| a.name.as_str()).collect();
            assert_eq!(names, ["メイン銀行", "楽天カード"]);
            assert_eq!(data.regular_payees, ["netflix"]);
        });
    }

    #[test]
    fn renders_a_reproducible_pdf() {
        with_db(|c| {
            let document = generate_emergency_sheet(c, "home", "2026-11-20").unwrap();
            assert!(document.bytes().starts_with(b"%PDF-"));
            assert_eq!(
                document.file_name,
                "kakeflow-emergency-sheet-2026-11-20.pdf"
            );
            assert_eq!(
                document.bytes(),
                generate_emergency_sheet(c, "home", "2026-11-20")
                    .unwrap()
                    .bytes()
            );
        });
    }

    #[test]
    fn an_empty_household_still_renders() {
        with_db(|c| {
            c.execute("INSERT INTO households(id,name) VALUES('empty','空')", [])
                .unwrap();
            let data = load_sheet(c, "empty").unwrap();
            assert!(data.accounts.is_empty() && data.regular_payees.is_empty());
            assert!(render_sheet(&data, "2026-11-20")
                .unwrap()
                .bytes()
                .starts_with(b"%PDF-"));
        });
    }

    #[test]
    fn rejects_unknown_and_blank_households() {
        with_db(|c| {
            assert!(matches!(
                load_sheet(c, "nope"),
                Err(EmergencySheetError::NotFound)
            ));
            assert!(matches!(
                load_sheet(c, " "),
                Err(EmergencySheetError::InvalidInput)
            ));
        });
    }
}
