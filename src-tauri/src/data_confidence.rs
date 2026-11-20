//! How well each month's spending is backed by evidence.
//!
//! A number on screen looks equally certain whether it came from a scanned receipt, an imported statement row, or a
//! hand-typed entry. This classifies the month's posted spending by what stands behind it:
//! - `DocumentAndImport`: both a receipt/scan (image or PDF) and an imported row (CSV, OFX, QIF, ...) are linked;
//! - `Document`: a receipt or scan (image or PDF) is linked;
//! - `Import`: an imported statement row is linked;
//! - `Manual`: nothing is linked, the user typed it.
//!
//! This reports provenance, not correctness: a linked document is not proof the amount is right, and it never
//! claims a transaction was matched against a bank statement. Read-only.

use rusqlite::{params, Connection};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DataConfidenceError {
    #[error("data confidence database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("data confidence request is invalid")]
    InvalidRequest,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceLevel {
    DocumentAndImport,
    Document,
    Import,
    Manual,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceBucketDto {
    pub level: EvidenceLevel,
    pub transactions: u64,
    pub amount_jpy: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DataConfidenceDto {
    pub month: String,
    /// Always the four levels, in the order of the enum, including empty ones.
    pub buckets: Vec<EvidenceBucketDto>,
    pub total_transactions: u64,
    pub total_amount_jpy: i64,
    /// Share of the month's spending (by yen) that has any linked evidence, in basis points; 0 for an empty month.
    pub evidenced_share_bps: u32,
}

fn valid_month(month: &str) -> bool {
    let bytes = month.as_bytes();
    bytes.len() == 7
        && bytes[4] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && matches!(
            &month[5..],
            "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12"
        )
}

const SQL: &str = "
WITH spending AS (
  SELECT t.id,
         COALESCE((SELECT SUM(je.amount_jpy) FROM journal_entries je
                    WHERE je.transaction_id = t.id AND je.entry_side = 'DEBIT'), 0) AS amount_jpy,
         EXISTS (SELECT 1 FROM transaction_sources ts
                   JOIN source_records sr ON sr.id = ts.source_record_id
                   JOIN source_documents sd ON sd.id = sr.source_document_id
                  WHERE ts.transaction_id = t.id
                    AND (sd.media_type LIKE 'image/%' OR sd.media_type = 'application/pdf')) AS has_document,
         EXISTS (SELECT 1 FROM transaction_sources ts
                   JOIN source_records sr ON sr.id = ts.source_record_id
                   JOIN source_documents sd ON sd.id = sr.source_document_id
                  WHERE ts.transaction_id = t.id
                    AND NOT (sd.media_type LIKE 'image/%' OR sd.media_type = 'application/pdf')) AS has_import
    FROM transactions t
   WHERE t.household_id = ?1 AND t.status = 'POSTED'
     AND t.transaction_type IN ('EXPENSE', 'CARD_PURCHASE', 'FEE')
     AND substr(t.occurred_on, 1, 7) = ?2
)
SELECT CASE WHEN has_document AND has_import THEN 0
            WHEN has_document THEN 1
            WHEN has_import THEN 2
            ELSE 3 END AS level,
       COUNT(*), COALESCE(SUM(amount_jpy), 0)
  FROM spending GROUP BY level";

pub fn confidence_for_month(
    connection: &Connection,
    household_id: &str,
    month: &str,
) -> Result<DataConfidenceDto, DataConfidenceError> {
    if household_id.trim().is_empty() || household_id.len() > 128 || !valid_month(month) {
        return Err(DataConfidenceError::InvalidRequest);
    }
    let mut counts = [(0_u64, 0_i64); 4];
    let mut statement = connection.prepare(SQL)?;
    let rows = statement.query_map(params![household_id, month], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    for row in rows {
        let (level, transactions, amount) = row?;
        let slot = usize::try_from(level)
            .ok()
            .and_then(|index| counts.get_mut(index));
        if let Some(slot) = slot {
            *slot = (u64::try_from(transactions).unwrap_or(0), amount);
        }
    }
    let levels = [
        EvidenceLevel::DocumentAndImport,
        EvidenceLevel::Document,
        EvidenceLevel::Import,
        EvidenceLevel::Manual,
    ];
    let buckets: Vec<EvidenceBucketDto> = levels
        .iter()
        .zip(counts)
        .map(|(level, (transactions, amount_jpy))| EvidenceBucketDto {
            level: *level,
            transactions,
            amount_jpy,
        })
        .collect();
    let total_transactions = buckets.iter().map(|bucket| bucket.transactions).sum();
    let total_amount_jpy: i64 = buckets.iter().map(|bucket| bucket.amount_jpy).sum();
    let manual_amount = buckets[3].amount_jpy;
    let evidenced_share_bps = if total_amount_jpy > 0 {
        let evidenced = i128::from(total_amount_jpy - manual_amount);
        u32::try_from(evidenced * 10_000 / i128::from(total_amount_jpy)).unwrap_or(0)
    } else {
        0
    };
    Ok(DataConfidenceDto {
        month: month.to_owned(),
        buckets,
        total_transactions,
        total_amount_jpy,
        evidenced_share_bps,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE transactions(id TEXT PRIMARY KEY, household_id TEXT NOT NULL,
                   occurred_on TEXT NOT NULL, status TEXT NOT NULL, transaction_type TEXT NOT NULL);
                 CREATE TABLE journal_entries(id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL,
                   entry_side TEXT NOT NULL, amount_jpy INTEGER NOT NULL);
                 CREATE TABLE source_documents(id TEXT PRIMARY KEY, media_type TEXT NOT NULL);
                 CREATE TABLE source_records(id TEXT PRIMARY KEY, source_document_id TEXT NOT NULL);
                 CREATE TABLE transaction_sources(transaction_id TEXT NOT NULL, source_record_id TEXT NOT NULL);
                 INSERT INTO source_documents VALUES ('receipt','image/jpeg'),('scan','application/pdf'),('stmt','text/csv');
                 INSERT INTO source_records VALUES ('r-receipt','receipt'),('r-scan','scan'),('r-stmt','stmt');",
            )
            .unwrap();
        connection
    }

    fn spend(
        connection: &Connection,
        id: &str,
        kind: &str,
        status: &str,
        on: &str,
        amount: i64,
        sources: &[&str],
    ) {
        connection
            .execute(
                "INSERT INTO transactions VALUES (?1, 'h1', ?2, ?3, ?4)",
                params![id, on, status, kind],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO journal_entries VALUES (?1, ?2, 'DEBIT', ?3)",
                params![format!("{id}-d"), id, amount],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO journal_entries VALUES (?1, ?2, 'CREDIT', ?3)",
                params![format!("{id}-c"), id, amount],
            )
            .unwrap();
        for source in sources {
            connection
                .execute(
                    "INSERT INTO transaction_sources VALUES (?1, ?2)",
                    params![id, source],
                )
                .unwrap();
        }
    }

    fn bucket(report: &DataConfidenceDto, level: EvidenceLevel) -> (u64, i64) {
        let found = report
            .buckets
            .iter()
            .find(|bucket| bucket.level == level)
            .unwrap();
        (found.transactions, found.amount_jpy)
    }

    #[test]
    fn classifies_spending_by_the_evidence_behind_it() {
        let c = database();
        spend(
            &c,
            "both",
            "EXPENSE",
            "POSTED",
            "2026-11-02",
            4000,
            &["r-receipt", "r-stmt"],
        );
        spend(
            &c,
            "doc",
            "CARD_PURCHASE",
            "POSTED",
            "2026-11-03",
            2000,
            &["r-scan"],
        );
        spend(&c, "imp", "FEE", "POSTED", "2026-11-04", 1000, &["r-stmt"]);
        spend(&c, "hand", "EXPENSE", "POSTED", "2026-11-05", 3000, &[]);
        let report = confidence_for_month(&c, "h1", "2026-11").unwrap();
        assert_eq!(bucket(&report, EvidenceLevel::DocumentAndImport), (1, 4000));
        assert_eq!(bucket(&report, EvidenceLevel::Document), (1, 2000));
        assert_eq!(bucket(&report, EvidenceLevel::Import), (1, 1000));
        assert_eq!(bucket(&report, EvidenceLevel::Manual), (1, 3000));
        assert_eq!(
            (report.total_transactions, report.total_amount_jpy),
            (4, 10_000)
        );
        assert_eq!(report.evidenced_share_bps, 7000);
        assert_eq!(report.buckets.len(), 4);
    }

    #[test]
    fn ignores_other_months_unposted_and_non_spending_transactions() {
        let c = database();
        spend(&c, "old", "EXPENSE", "POSTED", "2026-10-31", 500, &[]);
        spend(&c, "void", "EXPENSE", "VOID", "2026-11-02", 500, &[]);
        spend(&c, "draft", "EXPENSE", "DRAFT", "2026-11-02", 500, &[]);
        spend(&c, "income", "INCOME", "POSTED", "2026-11-02", 500, &[]);
        spend(&c, "transfer", "TRANSFER", "POSTED", "2026-11-02", 500, &[]);
        let report = confidence_for_month(&c, "h1", "2026-11").unwrap();
        assert_eq!((report.total_transactions, report.total_amount_jpy), (0, 0));
        assert_eq!(report.evidenced_share_bps, 0);
        assert_eq!(report.buckets.len(), 4);
    }

    #[test]
    fn a_transaction_with_many_linked_rows_is_counted_once() {
        let c = database();
        spend(
            &c,
            "multi",
            "EXPENSE",
            "POSTED",
            "2026-11-02",
            900,
            &["r-receipt", "r-scan", "r-stmt"],
        );
        let report = confidence_for_month(&c, "h1", "2026-11").unwrap();
        assert_eq!(bucket(&report, EvidenceLevel::DocumentAndImport), (1, 900));
        assert_eq!(report.total_transactions, 1);
    }

    #[test]
    fn rejects_bad_requests() {
        let c = database();
        assert!(confidence_for_month(&c, "", "2026-11").is_err());
        assert!(confidence_for_month(&c, "h1", "2026-13").is_err());
        assert!(confidence_for_month(&c, "h1", "2026/11").is_err());
        assert!(confidence_for_month(&c, "h1", "202611").is_err());
    }

    #[test]
    fn the_query_is_valid_against_the_real_migrated_schema() {
        let directory = tempfile::tempdir().unwrap();
        let state = crate::persistence::AppState::open_with_key(
            directory.path().join("kakeflow.db"),
            &[7_u8; 32],
        )
        .unwrap();
        let report = state
            .with_connection(|connection| {
                Ok(confidence_for_month(connection, "household", "2026-11").unwrap())
            })
            .unwrap();
        assert_eq!(report.total_transactions, 0);
        assert_eq!(report.buckets.len(), 4);
    }
}
