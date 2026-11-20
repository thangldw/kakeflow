//! A one-transaction evidence dossier as a PDF: the entry, its journal lines, and — for every linked source —
//! the original file's name, type, size, SHA-256, when it was imported, and the source row's own hash.
//!
//! Provenance only: the document states what KakeFlow recorded, so a reader can re-hash the original file and
//! compare. It does not assert that the amount is correct.

use crate::monthly_review_pdf::{
    add_text, draw_rect, format_jpy, install_japanese_font, normalize_pdf_identifiers, rgb,
};
use crate::transaction_ledger_pdf::wrap_text;
use printpdf::{Mm, PdfDocument, PdfPage, PdfSaveOptions};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use thiserror::Error;

const MAX_SOURCES: usize = 40;
const MAX_JOURNAL_LINES: usize = 40;
const MAX_PDF_BYTES: usize = 8 * 1024 * 1024;
pub(crate) const PAGE_W: f32 = 210.0;
pub(crate) const PAGE_H: f32 = 297.0;
pub(crate) const MARGIN: f32 = 15.0;
const BOTTOM: f32 = 18.0;

#[derive(Debug, Error)]
pub enum EvidenceDossierError {
    #[error("evidence dossier input is invalid")]
    InvalidInput,
    #[error("transaction was not found")]
    NotFound,
    #[error("evidence dossier is too large")]
    TooLarge,
    #[error("evidence dossier is unavailable")]
    Unavailable,
}

impl EvidenceDossierError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput => "The transaction could not be identified",
            Self::NotFound => "The transaction was not found",
            Self::TooLarge => "This transaction has too many linked sources for one dossier",
            Self::Unavailable => "The evidence dossier is temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DossierTransaction {
    pub id: String,
    pub occurred_on: String,
    pub posted_on: Option<String>,
    pub transaction_type: String,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DossierJournalLine {
    pub side: String,
    pub account: String,
    pub amount_jpy: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DossierSource {
    pub filename: String,
    pub media_type: String,
    pub byte_size: i64,
    pub sha256: String,
    pub source_type: String,
    pub imported_at: String,
    pub source_modified_at: Option<String>,
    pub row_number: i64,
    pub record_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dossier {
    pub transaction: DossierTransaction,
    pub journal: Vec<DossierJournalLine>,
    pub sources: Vec<DossierSource>,
}

#[derive(Debug, Clone)]
pub struct EvidenceDossierDocument {
    pub file_name: String,
    pub source_count: u32,
    bytes: Vec<u8>,
}

impl EvidenceDossierDocument {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceDossierSavedDto {
    pub file_name: String,
    pub source_count: u32,
    pub byte_size: u32,
}

pub fn load_dossier(
    connection: &Connection,
    household_id: &str,
    transaction_id: &str,
) -> Result<Dossier, EvidenceDossierError> {
    if household_id.trim().is_empty()
        || household_id.len() > 128
        || transaction_id.trim().is_empty()
        || transaction_id.len() > 128
    {
        return Err(EvidenceDossierError::InvalidInput);
    }
    let db = |_| EvidenceDossierError::Unavailable;
    let transaction = connection
        .query_row(
            "SELECT id, occurred_on, posted_on, transaction_type, payee, description, status, created_at
               FROM transactions WHERE id = ?1 AND household_id = ?2",
            params![transaction_id, household_id],
            |row| {
                Ok(DossierTransaction {
                    id: row.get(0)?,
                    occurred_on: row.get(1)?,
                    posted_on: row.get(2)?,
                    transaction_type: row.get(3)?,
                    payee: row.get(4)?,
                    description: row.get(5)?,
                    status: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(db)?
        .ok_or(EvidenceDossierError::NotFound)?;
    let journal = connection
        .prepare(
            "SELECT j.entry_side, a.name, j.amount_jpy
               FROM journal_entries j JOIN accounts a ON a.id = j.account_id
              WHERE j.transaction_id = ?1 ORDER BY j.line_number LIMIT ?2",
        )
        .map_err(db)?
        .query_map(
            params![transaction_id, MAX_JOURNAL_LINES as i64 + 1],
            |row| {
                Ok(DossierJournalLine {
                    side: row.get(0)?,
                    account: row.get(1)?,
                    amount_jpy: row.get(2)?,
                })
            },
        )
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let sources = connection
        .prepare(
            "SELECT d.original_filename, d.media_type, d.byte_size, d.sha256, d.source_type,
                    d.imported_at, d.source_modified_at, r.row_number, r.record_hash
               FROM transaction_sources ts
               JOIN source_records r ON r.id = ts.source_record_id
               JOIN source_documents d ON d.id = r.source_document_id
              WHERE ts.transaction_id = ?1
              ORDER BY d.imported_at, d.sha256, r.row_number LIMIT ?2",
        )
        .map_err(db)?
        .query_map(params![transaction_id, MAX_SOURCES as i64 + 1], |row| {
            Ok(DossierSource {
                filename: row.get(0)?,
                media_type: row.get(1)?,
                byte_size: row.get(2)?,
                sha256: row.get(3)?,
                source_type: row.get(4)?,
                imported_at: row.get(5)?,
                source_modified_at: row.get(6)?,
                row_number: row.get(7)?,
                record_hash: row.get(8)?,
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    if journal.len() > MAX_JOURNAL_LINES || sources.len() > MAX_SOURCES {
        return Err(EvidenceDossierError::TooLarge);
    }
    Ok(Dossier {
        transaction,
        journal,
        sources,
    })
}

pub(crate) struct Layout {
    pub(crate) finished: Vec<Vec<printpdf::Op>>,
    pub(crate) current: Vec<printpdf::Op>,
    pub(crate) y: f32,
}

impl Layout {
    pub(crate) fn new() -> Self {
        Self {
            finished: Vec::new(),
            current: Vec::new(),
            y: PAGE_H - MARGIN,
        }
    }

    pub(crate) fn ops(&mut self) -> &mut Vec<printpdf::Op> {
        &mut self.current
    }

    pub(crate) fn ensure(&mut self, height: f32) {
        if self.y - height < BOTTOM {
            self.finished.push(std::mem::take(&mut self.current));
            self.y = PAGE_H - MARGIN;
        }
    }
}

pub(crate) fn line(
    layout: &mut Layout,
    font: &printpdf::FontId,
    size: f32,
    text: &str,
    indent: f32,
) {
    let step = size * 0.5 + 1.6;
    // A4 portrait at ~3mm/char for 9pt Latin: about 150 units across the usable width.
    let units = (((PAGE_W - 2.0 * MARGIN - indent) / (size * 0.18)) as usize).max(20);
    for part in wrap_text(text, units) {
        layout.ensure(step);
        let y = layout.y - step;
        add_text(
            layout.ops(),
            font,
            MARGIN + indent,
            y,
            size,
            &part,
            rgb(0.1, 0.1, 0.12),
        );
        layout.y = y;
    }
}

pub(crate) fn heading(layout: &mut Layout, font: &printpdf::FontId, text: &str) {
    layout.ensure(14.0);
    layout.y -= 4.0;
    let y = layout.y - 6.0;
    draw_rect(
        layout.ops(),
        MARGIN,
        y - 1.5,
        PAGE_W - 2.0 * MARGIN,
        7.5,
        rgb(0.9, 0.93, 0.96),
    );
    add_text(
        layout.ops(),
        font,
        MARGIN + 2.0,
        y,
        11.0,
        text,
        rgb(0.08, 0.18, 0.26),
    );
    layout.y = y - 2.0;
}

pub fn render_dossier(
    dossier: &Dossier,
    generated_on: &str,
) -> Result<EvidenceDossierDocument, EvidenceDossierError> {
    let mut pdf = PdfDocument::new("KakeFlow Evidence Dossier");
    let font = install_japanese_font(&mut pdf).map_err(|_| EvidenceDossierError::Unavailable)?;
    let mut layout = Layout::new();
    let tx = &dossier.transaction;

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
        "証拠書類 / Evidence Dossier",
        rgb(0.96, 0.98, 1.0),
    );
    add_text(
        layout.ops(),
        &font,
        MARGIN,
        PAGE_H - 23.0,
        9.0,
        &format!("作成日 {generated_on}"),
        rgb(0.78, 0.86, 0.9),
    );
    layout.y = PAGE_H - 36.0;

    heading(&mut layout, &font, "取引");
    line(&mut layout, &font, 9.0, &format!("取引ID: {}", tx.id), 0.0);
    line(
        &mut layout,
        &font,
        9.0,
        &format!(
            "日付: {}   計上日: {}",
            tx.occurred_on,
            tx.posted_on.as_deref().unwrap_or("-")
        ),
        0.0,
    );
    line(
        &mut layout,
        &font,
        9.0,
        &format!("種別: {}   状態: {}", tx.transaction_type, tx.status),
        0.0,
    );
    line(
        &mut layout,
        &font,
        9.0,
        &format!("支払先: {}", tx.payee.as_deref().unwrap_or("-")),
        0.0,
    );
    line(
        &mut layout,
        &font,
        9.0,
        &format!("摘要: {}", tx.description.as_deref().unwrap_or("-")),
        0.0,
    );
    line(
        &mut layout,
        &font,
        9.0,
        &format!("台帳登録: {}", tx.created_at),
        0.0,
    );

    heading(&mut layout, &font, "仕訳");
    if dossier.journal.is_empty() {
        line(&mut layout, &font, 9.0, "仕訳はありません。", 0.0);
    }
    for entry in &dossier.journal {
        let side = if entry.side == "DEBIT" {
            "借方"
        } else {
            "貸方"
        };
        line(
            &mut layout,
            &font,
            9.0,
            &format!(
                "{side}  {}  {}",
                entry.account,
                format_jpy(entry.amount_jpy)
            ),
            0.0,
        );
    }

    heading(
        &mut layout,
        &font,
        &format!(
            "根拠となる原本・取り込み明細（{}件）",
            dossier.sources.len()
        ),
    );
    if dossier.sources.is_empty() {
        line(
            &mut layout,
            &font,
            9.0,
            "この取引に紐づく原本はありません（手入力）。",
            0.0,
        );
    }
    for (index, source) in dossier.sources.iter().enumerate() {
        layout.y -= 2.0;
        line(
            &mut layout,
            &font,
            9.5,
            &format!("{}. {}", index + 1, source.filename),
            0.0,
        );
        line(
            &mut layout,
            &font,
            8.0,
            &format!(
                "種類: {} / {}   サイズ: {} バイト",
                source.source_type, source.media_type, source.byte_size
            ),
            5.0,
        );
        line(
            &mut layout,
            &font,
            8.0,
            &format!(
                "取り込み: {}   元ファイル更新: {}",
                source.imported_at,
                source.source_modified_at.as_deref().unwrap_or("-")
            ),
            5.0,
        );
        line(
            &mut layout,
            &font,
            8.0,
            &format!("ファイル SHA-256: {}", source.sha256),
            5.0,
        );
        line(
            &mut layout,
            &font,
            8.0,
            &format!(
                "明細行 {} のハッシュ: {}",
                source.row_number, source.record_hash
            ),
            5.0,
        );
    }

    heading(&mut layout, &font, "確認方法");
    line(&mut layout, &font, 8.5, "原本ファイルの SHA-256 を計算し、上記の値と一致することを確認してください。一致すれば、取り込み時から変更されていません。", 0.0);
    line(&mut layout, &font, 8.5, "この書類は KakeFlow が記録した事実のみを示します。金額が正しいことを保証するものではありません。", 0.0);

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
    normalize_pdf_identifiers(&mut bytes).map_err(|_| EvidenceDossierError::Unavailable)?;
    if !bytes.starts_with(b"%PDF-") || bytes.len() > MAX_PDF_BYTES {
        return Err(EvidenceDossierError::TooLarge);
    }
    let short: String = tx
        .id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(12)
        .collect();
    Ok(EvidenceDossierDocument {
        file_name: format!("kakeflow-dossier-{}-{short}.pdf", tx.occurred_on),
        source_count: dossier.sources.len() as u32,
        bytes,
    })
}

pub fn generate_evidence_dossier(
    connection: &Connection,
    household_id: &str,
    transaction_id: &str,
    generated_on: &str,
) -> Result<EvidenceDossierDocument, EvidenceDossierError> {
    render_dossier(
        &load_dossier(connection, household_id, transaction_id)?,
        generated_on,
    )
}

pub fn save_evidence_dossier(
    document: &EvidenceDossierDocument,
    destination: &std::path::Path,
) -> Result<EvidenceDossierSavedDto, EvidenceDossierError> {
    std::fs::write(destination, document.bytes()).map_err(|_| EvidenceDossierError::Unavailable)?;
    Ok(EvidenceDossierSavedDto {
        file_name: document.file_name.clone(),
        source_count: document.source_count,
        byte_size: document.bytes.len() as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    fn seed(connection: &Connection) {
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('home','Home'),('other','Other');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                   VALUES('cash','home','現金','ASSET','CASH'),('food','home','食費','EXPENSE','OTHER');
                 INSERT INTO import_runs(id,household_id,adapter_id,status) VALUES('run','home','receipt','POSTED');
                 INSERT INTO source_documents(id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path)
                   VALUES('doc','home','run','CAMERA_SCAN','receipt.png','image/png',1234,
                          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','x');
                 INSERT INTO source_records(id,source_document_id,row_number,record_hash,raw_payload_json)
                   VALUES('rec','doc',1,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','{}');
                 INSERT INTO transactions(id,household_id,occurred_on,transaction_type,payee,description,status)
                   VALUES('tx1','home','2026-11-03','EXPENSE','スーパー','夕食','POSTED'),
                         ('tx2','home','2026-11-04','EXPENSE','手入力店','','POSTED');
                 INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                   VALUES('j1','tx1','food','DEBIT',1200,1),('j2','tx1','cash','CREDIT',1200,2);
                 INSERT INTO transaction_sources(transaction_id,source_record_id) VALUES('tx1','rec');",
            )
            .expect("seed");
    }

    fn with_seeded(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(&[7_u8; 32]).expect("migrations");
        state
            .with_connection(|connection| {
                seed(connection);
                test(connection);
                Ok(())
            })
            .expect("body");
    }

    #[test]
    fn loads_the_entry_its_journal_and_the_source_hashes() {
        with_seeded(|c| {
            let dossier = load_dossier(c, "home", "tx1").unwrap();
            assert_eq!(dossier.transaction.payee.as_deref(), Some("スーパー"));
            assert_eq!(dossier.journal.len(), 2);
            assert_eq!(dossier.journal[0].account, "食費");
            assert_eq!(dossier.sources.len(), 1);
            assert_eq!(dossier.sources[0].filename, "receipt.png");
            assert_eq!(dossier.sources[0].sha256, "a".repeat(64));
            assert_eq!(dossier.sources[0].record_hash, "b".repeat(64));
        });
    }

    #[test]
    fn a_manual_entry_has_no_sources_and_still_renders() {
        with_seeded(|c| {
            let dossier = load_dossier(c, "home", "tx2").unwrap();
            assert!(dossier.sources.is_empty());
            let document = render_dossier(&dossier, "2026-11-20").unwrap();
            assert!(document.bytes().starts_with(b"%PDF-"));
            assert_eq!(document.source_count, 0);
        });
    }

    #[test]
    fn renders_a_pdf_for_a_sourced_entry_with_a_stable_file_name() {
        with_seeded(|c| {
            let document = generate_evidence_dossier(c, "home", "tx1", "2026-11-20").unwrap();
            assert!(document.bytes().starts_with(b"%PDF-"));
            assert_eq!(document.file_name, "kakeflow-dossier-2026-11-03-tx1.pdf");
            assert_eq!(document.source_count, 1);
            let again = generate_evidence_dossier(c, "home", "tx1", "2026-11-20").unwrap();
            assert_eq!(document.bytes(), again.bytes(), "output is reproducible");
        });
    }

    #[test]
    fn rejects_other_households_missing_ids_and_blank_input() {
        with_seeded(|c| {
            assert!(matches!(
                load_dossier(c, "other", "tx1"),
                Err(EvidenceDossierError::NotFound)
            ));
            assert!(matches!(
                load_dossier(c, "home", "nope"),
                Err(EvidenceDossierError::NotFound)
            ));
            assert!(matches!(
                load_dossier(c, "", "tx1"),
                Err(EvidenceDossierError::InvalidInput)
            ));
            assert!(matches!(
                load_dossier(c, "home", " "),
                Err(EvidenceDossierError::InvalidInput)
            ));
        });
    }

    #[test]
    fn long_text_wraps_onto_more_pages_instead_of_overflowing() {
        let mut dossier = Dossier {
            transaction: DossierTransaction {
                id: "tx".into(),
                occurred_on: "2026-11-03".into(),
                posted_on: None,
                transaction_type: "EXPENSE".into(),
                payee: Some("あ".repeat(400)),
                description: None,
                status: "POSTED".into(),
                created_at: "2026-11-03T00:00:00Z".into(),
            },
            journal: vec![],
            sources: vec![],
        };
        for index in 0..MAX_SOURCES {
            dossier.sources.push(DossierSource {
                filename: format!("file-{index}.pdf"),
                media_type: "application/pdf".into(),
                byte_size: 10,
                sha256: "c".repeat(64),
                source_type: "PDF".into(),
                imported_at: "2026-11-03T00:00:00Z".into(),
                source_modified_at: None,
                row_number: 1,
                record_hash: "d".repeat(64),
            });
        }
        let full = render_dossier(&dossier, "2026-11-20").unwrap();
        dossier.sources.truncate(1);
        let small = render_dossier(&dossier, "2026-11-20").unwrap();
        // Forty sources need more pages than one; the long payee wraps rather than being cut off.
        assert!(full.bytes().len() > small.bytes().len());
    }
}
