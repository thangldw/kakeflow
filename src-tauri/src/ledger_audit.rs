//! Read-only audit of the double-entry ledger's own invariants.
//!
//! SQLite's `integrity_check` proves the file is not corrupt; this proves the books still make sense:
//! every posted transaction balances, has at least two lines, and only touches accounts of its own household.
//! It never writes. Findings are capped so a badly damaged database cannot produce an unbounded response.

use rusqlite::{params, Connection};
use serde::Serialize;
use thiserror::Error;

const MAX_FINDINGS: usize = 200;

#[derive(Debug, Error)]
pub enum LedgerAuditError {
    #[error("ledger audit database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("ledger audit household is invalid")]
    InvalidHousehold,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LedgerAuditFindingKind {
    /// A posted transaction whose debits and credits differ.
    UnbalancedJournal,
    /// A posted transaction with fewer than two journal lines.
    TooFewEntries,
    /// A journal line on an account that belongs to a different household than its transaction.
    CrossHouseholdAccount,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LedgerAuditFindingDto {
    pub kind: LedgerAuditFindingKind,
    pub transaction_id: String,
    pub occurred_on: String,
    /// Debit and credit totals in yen; for the other kinds these are the transaction's totals for context.
    pub debit_total_jpy: i64,
    pub credit_total_jpy: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LedgerAuditReportDto {
    pub posted_transactions: u64,
    pub journal_entries: u64,
    pub findings: Vec<LedgerAuditFindingDto>,
    /// True when more findings exist than were returned.
    pub truncated: bool,
    pub ok: bool,
}

pub fn audit_household(
    connection: &Connection,
    household_id: &str,
) -> Result<LedgerAuditReportDto, LedgerAuditError> {
    if household_id.trim().is_empty() || household_id.len() > 128 {
        return Err(LedgerAuditError::InvalidHousehold);
    }

    let posted_transactions: i64 = connection.query_row(
        "SELECT count(*) FROM transactions WHERE household_id = ?1 AND status = 'POSTED'",
        params![household_id],
        |row| row.get(0),
    )?;
    let journal_entries: i64 = connection.query_row(
        "SELECT count(*) FROM journal_entries je
           JOIN transactions t ON t.id = je.transaction_id
          WHERE t.household_id = ?1 AND t.status = 'POSTED'",
        params![household_id],
        |row| row.get(0),
    )?;

    let mut findings = Vec::new();
    let mut truncated = false;
    let mut collect = |kind: LedgerAuditFindingKind, sql: &str| -> Result<(), LedgerAuditError> {
        let mut statement = connection.prepare(sql)?;
        let rows = statement.query_map(params![household_id, MAX_FINDINGS as i64 + 1], |row| {
            Ok(LedgerAuditFindingDto {
                kind,
                transaction_id: row.get(0)?,
                occurred_on: row.get(1)?,
                debit_total_jpy: row.get(2)?,
                credit_total_jpy: row.get(3)?,
            })
        })?;
        for row in rows {
            if findings.len() >= MAX_FINDINGS {
                truncated = true;
                break;
            }
            findings.push(row?);
        }
        Ok(())
    };

    // Per-transaction totals, then the three checks over them.
    const TOTALS: &str = "SELECT t.id AS id, t.occurred_on AS occurred_on,
            COALESCE(SUM(CASE WHEN je.entry_side = 'DEBIT' THEN je.amount_jpy END), 0) AS debit,
            COALESCE(SUM(CASE WHEN je.entry_side = 'CREDIT' THEN je.amount_jpy END), 0) AS credit,
            COUNT(je.id) AS lines
       FROM transactions t LEFT JOIN journal_entries je ON je.transaction_id = t.id
      WHERE t.household_id = ?1 AND t.status = 'POSTED'
      GROUP BY t.id";
    collect(
        LedgerAuditFindingKind::UnbalancedJournal,
        &format!("SELECT id, occurred_on, debit, credit FROM ({TOTALS}) WHERE lines >= 2 AND debit <> credit ORDER BY occurred_on, id LIMIT ?2"),
    )?;
    collect(
        LedgerAuditFindingKind::TooFewEntries,
        &format!("SELECT id, occurred_on, debit, credit FROM ({TOTALS}) WHERE lines < 2 ORDER BY occurred_on, id LIMIT ?2"),
    )?;
    collect(
        LedgerAuditFindingKind::CrossHouseholdAccount,
        "SELECT DISTINCT t.id, t.occurred_on, 0, 0
           FROM transactions t
           JOIN journal_entries je ON je.transaction_id = t.id
           JOIN accounts a ON a.id = je.account_id
          WHERE t.household_id = ?1 AND t.status = 'POSTED' AND a.household_id <> t.household_id
          ORDER BY t.occurred_on, t.id LIMIT ?2",
    )?;

    let ok = findings.is_empty();
    Ok(LedgerAuditReportDto {
        posted_transactions: posted_transactions.max(0) as u64,
        journal_entries: journal_entries.max(0) as u64,
        findings,
        truncated,
        ok,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE accounts(id TEXT PRIMARY KEY, household_id TEXT NOT NULL);
                 CREATE TABLE transactions(id TEXT PRIMARY KEY, household_id TEXT NOT NULL,
                   occurred_on TEXT NOT NULL, status TEXT NOT NULL);
                 CREATE TABLE journal_entries(id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL,
                   account_id TEXT NOT NULL, entry_side TEXT NOT NULL, amount_jpy INTEGER NOT NULL);
                 INSERT INTO accounts VALUES ('cash','h1'),('food','h1'),('other-cash','h2');",
            )
            .unwrap();
        connection
    }

    fn transaction(connection: &Connection, id: &str, status: &str, lines: &[(&str, &str, i64)]) {
        connection
            .execute(
                "INSERT INTO transactions VALUES (?1, 'h1', '2026-11-01', ?2)",
                params![id, status],
            )
            .unwrap();
        for (index, (account, side, amount)) in lines.iter().enumerate() {
            connection
                .execute(
                    "INSERT INTO journal_entries VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![format!("{id}-{index}"), id, account, side, amount],
                )
                .unwrap();
        }
    }

    #[test]
    fn a_clean_ledger_passes() {
        let connection = database();
        transaction(
            &connection,
            "t1",
            "POSTED",
            &[("food", "DEBIT", 1000), ("cash", "CREDIT", 1000)],
        );
        transaction(
            &connection,
            "t2",
            "POSTED",
            &[
                ("food", "DEBIT", 300),
                ("food", "DEBIT", 200),
                ("cash", "CREDIT", 500),
            ],
        );
        let report = audit_household(&connection, "h1").unwrap();
        assert!(report.ok);
        assert_eq!((report.posted_transactions, report.journal_entries), (2, 5));
        assert!(report.findings.is_empty() && !report.truncated);
    }

    #[test]
    fn finds_unbalanced_short_and_cross_household_transactions() {
        let connection = database();
        transaction(
            &connection,
            "unbalanced",
            "POSTED",
            &[("food", "DEBIT", 1000), ("cash", "CREDIT", 900)],
        );
        transaction(&connection, "single", "POSTED", &[("food", "DEBIT", 1000)]);
        transaction(&connection, "empty", "POSTED", &[]);
        transaction(
            &connection,
            "cross",
            "POSTED",
            &[("food", "DEBIT", 50), ("other-cash", "CREDIT", 50)],
        );
        let report = audit_household(&connection, "h1").unwrap();
        assert!(!report.ok);
        let found: Vec<_> = report
            .findings
            .iter()
            .map(|f| (f.kind, f.transaction_id.as_str()))
            .collect();
        assert_eq!(
            found,
            vec![
                (LedgerAuditFindingKind::UnbalancedJournal, "unbalanced"),
                (LedgerAuditFindingKind::TooFewEntries, "empty"),
                (LedgerAuditFindingKind::TooFewEntries, "single"),
                (LedgerAuditFindingKind::CrossHouseholdAccount, "cross"),
            ]
        );
        let unbalanced = &report.findings[0];
        assert_eq!(
            (unbalanced.debit_total_jpy, unbalanced.credit_total_jpy),
            (1000, 900)
        );
    }

    #[test]
    fn ignores_void_and_draft_transactions_and_other_households() {
        let connection = database();
        transaction(&connection, "void", "VOID", &[("food", "DEBIT", 1000)]);
        transaction(&connection, "draft", "DRAFT", &[]);
        connection
            .execute(
                "INSERT INTO transactions VALUES ('foreign', 'h2', '2026-11-01', 'POSTED')",
                [],
            )
            .unwrap();
        let report = audit_household(&connection, "h1").unwrap();
        assert!(report.ok);
        assert_eq!(report.posted_transactions, 0);
    }

    #[test]
    fn caps_findings_and_reports_truncation() {
        let connection = database();
        for index in 0..(MAX_FINDINGS + 25) {
            transaction(
                &connection,
                &format!("t{index:04}"),
                "POSTED",
                &[("food", "DEBIT", 10), ("cash", "CREDIT", 9)],
            );
        }
        let report = audit_household(&connection, "h1").unwrap();
        assert_eq!(report.findings.len(), MAX_FINDINGS);
        assert!(report.truncated && !report.ok);
    }

    #[test]
    fn rejects_an_empty_or_oversized_household_id() {
        let connection = database();
        assert!(matches!(
            audit_household(&connection, " "),
            Err(LedgerAuditError::InvalidHousehold)
        ));
        assert!(matches!(
            audit_household(&connection, &"x".repeat(129)),
            Err(LedgerAuditError::InvalidHousehold)
        ));
    }
}
