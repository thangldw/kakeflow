use crate::persistence::AppState;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptMatchRequest {
    pub household_id: String,
    pub candidate_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmReceiptMatchRequest {
    pub household_id: String,
    pub candidate_id: String,
    pub transaction_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptMatchSuggestionDto {
    pub candidate_id: String,
    pub transaction_id: String,
    pub occurred_on: String,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub transaction_type: String,
    pub amount_jpy: i64,
    pub day_difference: i64,
    pub merchant_similarity_bps: i64,
    pub score_bps: i64,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptMatchConfirmationDto {
    pub run_id: String,
    pub candidate_id: String,
    pub transaction_id: String,
    pub resolution_status: String,
    pub evidence_count: u64,
    pub run_status: String,
}

#[derive(Debug)]
struct Candidate {
    run_id: String,
    occurred_on: String,
    amount_jpy: i64,
    merchant: String,
    status: String,
}

fn valid_id(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 255 || value.chars().any(char::is_control) {
        Err("Identifier is invalid".into())
    } else {
        Ok(())
    }
}

fn candidate(connection: &Connection, household: &str, id: &str) -> Result<Candidate, String> {
    connection.query_row(
        "SELECT ir.id,c.occurred_on,c.amount_jpy,COALESCE(c.merchant_raw,''),c.review_status
         FROM transaction_candidates c JOIN candidate_sources cs ON cs.candidate_id=c.id
         JOIN source_records sr ON sr.id=cs.source_record_id JOIN source_documents sd ON sd.id=sr.source_document_id
         JOIN import_runs ir ON ir.id=sd.import_run_id
         WHERE c.id=?1 AND c.household_id=?2 AND ir.adapter_id='receipt-text-v2'
         ORDER BY sr.row_number LIMIT 1",
        params![id, household],
        |row| Ok(Candidate { run_id: row.get(0)?, occurred_on: row.get(1)?, amount_jpy: row.get(2)?, merchant: row.get(3)?, status: row.get(4)? }),
    ).optional().map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?
      .ok_or_else(|| "Reviewable receipt candidate was not found".to_owned())
}

fn normalized(value: &str) -> Vec<char> {
    value
        .to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn similarity(left: &str, right: &str) -> i64 {
    let left = normalized(left);
    let right = normalized(right);
    if left.is_empty() || right.is_empty() {
        return 0;
    }
    if left == right {
        return 10_000;
    }
    let pairs = |value: &[char]| {
        value
            .windows(2)
            .map(|pair| (pair[0], pair[1]))
            .collect::<HashSet<_>>()
    };
    let a = pairs(&left);
    let b = pairs(&right);
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    20_000 * a.intersection(&b).count() as i64 / (a.len() + b.len()) as i64
}

pub fn suggest(
    connection: &Connection,
    request: &ReceiptMatchRequest,
) -> Result<Vec<ReceiptMatchSuggestionDto>, String> {
    valid_id(&request.household_id)?;
    valid_id(&request.candidate_id)?;
    let candidate = candidate(connection, &request.household_id, &request.candidate_id)?;
    if !matches!(candidate.status.as_str(), "PENDING" | "READY") {
        return Ok(Vec::new());
    }
    let linked: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM receipt_candidate_links WHERE candidate_id=?1)",
            [&request.candidate_id],
            |row| row.get(0),
        )
        .map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
    if linked {
        return Ok(Vec::new());
    }
    let mut query = connection.prepare(
        "SELECT t.id,t.occurred_on,t.payee,t.description,t.transaction_type,
                SUM(CASE WHEN a.account_kind='EXPENSE' AND je.entry_side='DEBIT' THEN je.amount_jpy ELSE 0 END),
                CAST(abs(julianday(t.occurred_on)-julianday(?3)) AS INTEGER)
         FROM transactions t JOIN journal_entries je ON je.transaction_id=t.id JOIN accounts a ON a.id=je.account_id
         WHERE t.household_id=?1 AND t.status='POSTED' AND t.transaction_type IN ('EXPENSE','CARD_PURCHASE')
           AND abs(julianday(t.occurred_on)-julianday(?3))<=3
         GROUP BY t.id,t.occurred_on,t.payee,t.description,t.transaction_type
         HAVING SUM(CASE WHEN a.account_kind='EXPENSE' AND je.entry_side='DEBIT' THEN je.amount_jpy ELSE 0 END)=?2
         ORDER BY abs(julianday(t.occurred_on)-julianday(?3)),t.id LIMIT 200"
    ).map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
    let rows = query
        .query_map(
            params![
                request.household_id,
                candidate.amount_jpy,
                candidate.occurred_on
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
    let mut result = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?
        .into_iter()
        .map(|(id, date, payee, description, kind, amount, days)| {
            let merchant = similarity(&candidate.merchant, payee.as_deref().unwrap_or(""));
            let date_score = match days {
                0 => 3000,
                1 => 2500,
                2 => 2000,
                _ => 1500,
            };
            ReceiptMatchSuggestionDto {
                candidate_id: request.candidate_id.clone(),
                transaction_id: id,
                occurred_on: date,
                payee,
                description,
                transaction_type: kind,
                amount_jpy: amount,
                day_difference: days,
                merchant_similarity_bps: merchant,
                score_bps: 5000 + date_score + merchant * 2000 / 10000,
                reasons: vec![
                    "Exact receipt and posted-expense amount".into(),
                    format!("Date difference: {days} day(s)"),
                    format!("Merchant similarity: {}%", merchant / 100),
                ],
            }
        })
        .collect::<Vec<_>>();
    result.sort_by(|a, b| {
        b.score_bps
            .cmp(&a.score_bps)
            .then(a.transaction_id.cmp(&b.transaction_id))
    });
    result.truncate(10);
    Ok(result)
}

fn valid_target(
    connection: &Connection,
    household: &str,
    transaction: &str,
    date: &str,
    amount: i64,
) -> Result<bool, String> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM transactions t JOIN journal_entries je ON je.transaction_id=t.id JOIN accounts a ON a.id=je.account_id
         WHERE t.id=?1 AND t.household_id=?2 AND t.status='POSTED' AND t.transaction_type IN ('EXPENSE','CARD_PURCHASE')
           AND abs(julianday(t.occurred_on)-julianday(?3))<=3 GROUP BY t.id
         HAVING SUM(CASE WHEN a.account_kind='EXPENSE' AND je.entry_side='DEBIT' THEN je.amount_jpy ELSE 0 END)=?4)",
        params![transaction,household,date,amount], |row| row.get(0)
    ).map_err(|_| "Receipt matching is temporarily unavailable".to_owned())
}

pub fn confirm(
    connection: &Connection,
    request: &ConfirmReceiptMatchRequest,
) -> Result<ReceiptMatchConfirmationDto, String> {
    valid_id(&request.household_id)?;
    valid_id(&request.candidate_id)?;
    valid_id(&request.transaction_id)?;
    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
    let candidate = candidate(&tx, &request.household_id, &request.candidate_id)?;
    if let Some(existing) = tx
        .query_row(
            "SELECT transaction_id FROM receipt_candidate_links WHERE candidate_id=?1",
            [&request.candidate_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?
    {
        if existing != request.transaction_id {
            return Err("Receipt candidate is already linked to another transaction".into());
        }
        let evidence = tx.query_row("SELECT count(*) FROM transaction_sources WHERE transaction_id=?1 AND candidate_id=?2",params![existing,request.candidate_id],|row| row.get(0)).map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
        let run_status = tx
            .query_row(
                "SELECT status FROM import_runs WHERE id=?1",
                [&candidate.run_id],
                |row| row.get(0),
            )
            .map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
        tx.commit()
            .map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
        return Ok(ReceiptMatchConfirmationDto {
            run_id: candidate.run_id,
            candidate_id: request.candidate_id.clone(),
            transaction_id: existing,
            resolution_status: "LINKED".into(),
            evidence_count: evidence,
            run_status,
        });
    }
    if !matches!(candidate.status.as_str(), "PENDING" | "READY") {
        return Err("Receipt candidate is no longer reviewable".into());
    }
    if !valid_target(
        &tx,
        &request.household_id,
        &request.transaction_id,
        &candidate.occurred_on,
        candidate.amount_jpy,
    )? {
        return Err("Selected transaction is not a valid receipt match".into());
    }
    tx.execute("INSERT INTO receipt_candidate_links(candidate_id,household_id,transaction_id) VALUES(?1,?2,?3)",params![request.candidate_id,request.household_id,request.transaction_id]).map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
    tx.execute("INSERT OR IGNORE INTO transaction_sources(transaction_id,source_record_id,candidate_id) SELECT ?1,source_record_id,?2 FROM candidate_sources WHERE candidate_id=?2",params![request.transaction_id,request.candidate_id]).map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
    tx.execute("UPDATE transaction_candidates SET review_status='EXCLUDED',receipt_resolution_status='LINKED',receipt_resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1",[&request.candidate_id]).map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
    let remaining:i64=tx.query_row("SELECT count(DISTINCT c.id) FROM transaction_candidates c JOIN candidate_sources cs ON cs.candidate_id=c.id JOIN source_records sr ON sr.id=cs.source_record_id JOIN source_documents sd ON sd.id=sr.source_document_id WHERE sd.import_run_id=?1 AND c.review_status IN ('PENDING','READY')",[&candidate.run_id],|row|row.get(0)).map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
    let run_status = if remaining == 0 {
        "POSTED"
    } else {
        "REVIEW_REQUIRED"
    };
    if remaining == 0 {
        tx.execute("UPDATE import_runs SET status='POSTED',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1",[&candidate.run_id]).map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
    }
    let evidence = tx
        .query_row(
            "SELECT count(*) FROM transaction_sources WHERE transaction_id=?1 AND candidate_id=?2",
            params![request.transaction_id, request.candidate_id],
            |row| row.get(0),
        )
        .map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
    tx.commit()
        .map_err(|_| "Receipt matching is temporarily unavailable".to_owned())?;
    Ok(ReceiptMatchConfirmationDto {
        run_id: candidate.run_id,
        candidate_id: request.candidate_id.clone(),
        transaction_id: request.transaction_id.clone(),
        resolution_status: "LINKED".into(),
        evidence_count: evidence,
        run_status: run_status.into(),
    })
}

#[tauri::command]
pub fn receipt_match_suggestions(
    state: tauri::State<'_, AppState>,
    request: ReceiptMatchRequest,
) -> Result<Vec<ReceiptMatchSuggestionDto>, String> {
    match state.with_connection(|connection| Ok(suggest(connection, &request))) {
        Ok(result) => result,
        Err(_) => Err("Receipt matching is temporarily unavailable".into()),
    }
}

#[tauri::command]
pub fn receipt_match_confirm(
    state: tauri::State<'_, AppState>,
    request: ConfirmReceiptMatchRequest,
) -> Result<ReceiptMatchConfirmationDto, String> {
    match state.with_connection(|connection| Ok(confirm(connection, &request))) {
        Ok(result) => result,
        Err(_) => Err("Receipt matching is temporarily unavailable".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE households(id TEXT PRIMARY KEY);
             CREATE TABLE accounts(id TEXT PRIMARY KEY,household_id TEXT,account_kind TEXT);
             CREATE TABLE import_runs(id TEXT PRIMARY KEY,household_id TEXT,status TEXT,adapter_id TEXT,completed_at TEXT);
             CREATE TABLE source_documents(id TEXT PRIMARY KEY,household_id TEXT,import_run_id TEXT);
             CREATE TABLE source_records(id TEXT PRIMARY KEY,source_document_id TEXT,row_number INTEGER);
             CREATE TABLE transaction_candidates(id TEXT PRIMARY KEY,household_id TEXT,occurred_on TEXT,amount_jpy INTEGER,merchant_raw TEXT,review_status TEXT);
             CREATE TABLE candidate_sources(candidate_id TEXT,source_record_id TEXT,evidence_role TEXT,PRIMARY KEY(candidate_id,source_record_id));
             CREATE TABLE transactions(id TEXT PRIMARY KEY,household_id TEXT,occurred_on TEXT,transaction_type TEXT,payee TEXT,description TEXT,status TEXT);
             CREATE TABLE journal_entries(id TEXT PRIMARY KEY,transaction_id TEXT,account_id TEXT,entry_side TEXT,amount_jpy INTEGER);
             CREATE TABLE transaction_sources(transaction_id TEXT,source_record_id TEXT,candidate_id TEXT,PRIMARY KEY(transaction_id,source_record_id));
             INSERT INTO households VALUES('family'),('other');
             INSERT INTO accounts VALUES('expense','family','EXPENSE'),('card','family','LIABILITY'),('other-expense','other','EXPENSE');
             INSERT INTO import_runs VALUES('receipt-run','family','REVIEW_REQUIRED','receipt-text-v2',NULL);
             INSERT INTO source_documents VALUES('receipt-doc','family','receipt-run');
             INSERT INTO source_records VALUES('receipt-row','receipt-doc',1);
             INSERT INTO transaction_candidates VALUES('receipt','family','2026-07-11',1000,'STORE','READY');
             INSERT INTO candidate_sources VALUES('receipt','receipt-row','PRIMARY');
             INSERT INTO transactions VALUES('purchase','family','2026-07-12','CARD_PURCHASE','Store',NULL,'POSTED');
             INSERT INTO journal_entries VALUES('purchase-d','purchase','expense','DEBIT',1000),('purchase-c','purchase','card','CREDIT',1000);"
        ).unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0025_receipt_evidence_linking.sql"
            ))
            .unwrap();
        connection
    }

    #[test]
    fn suggests_and_idempotently_links_receipt_without_changing_journal() {
        let connection = database();
        let request = ReceiptMatchRequest {
            household_id: "family".into(),
            candidate_id: "receipt".into(),
        };
        let suggestions = suggest(&connection, &request).unwrap();
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].transaction_id, "purchase");
        assert_eq!(suggestions[0].amount_jpy, 1000);
        assert_eq!(suggestions[0].day_difference, 1);
        assert_eq!(suggestions[0].merchant_similarity_bps, 10_000);
        let journal_before: i64 = connection
            .query_row("SELECT count(*) FROM journal_entries", [], |row| row.get(0))
            .unwrap();
        let confirm_request = ConfirmReceiptMatchRequest {
            household_id: "family".into(),
            candidate_id: "receipt".into(),
            transaction_id: "purchase".into(),
        };
        let linked = confirm(&connection, &confirm_request).unwrap();
        assert_eq!(linked.resolution_status, "LINKED");
        assert_eq!(linked.run_status, "POSTED");
        assert_eq!(linked.evidence_count, 1);
        assert_eq!(confirm(&connection, &confirm_request).unwrap(), linked);
        let journal_after: i64 = connection
            .query_row("SELECT count(*) FROM journal_entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal_before, journal_after);
        let state:(String,String)=connection.query_row("SELECT review_status,receipt_resolution_status FROM transaction_candidates WHERE id='receipt'",[],|row|Ok((row.get(0)?,row.get(1)?))).unwrap();
        assert_eq!(state, ("EXCLUDED".into(), "LINKED".into()));
        assert!(suggest(&connection, &request).unwrap().is_empty());
    }

    #[test]
    fn rejects_cross_household_or_nonmatching_targets_atomically() {
        let connection = database();
        connection.execute_batch("INSERT INTO transactions VALUES('other','other','2026-07-11','EXPENSE','Store',NULL,'POSTED'); INSERT INTO journal_entries VALUES('other-d','other','other-expense','DEBIT',1000); INSERT INTO transactions VALUES('wrong-amount','family','2026-07-11','EXPENSE','Store',NULL,'POSTED'); INSERT INTO journal_entries VALUES('wrong-amount-d','wrong-amount','expense','DEBIT',999);").unwrap();
        let cross = ConfirmReceiptMatchRequest {
            household_id: "family".into(),
            candidate_id: "receipt".into(),
            transaction_id: "other".into(),
        };
        assert!(confirm(&connection, &cross).is_err());
        let wrong_amount = ConfirmReceiptMatchRequest {
            household_id: "family".into(),
            candidate_id: "receipt".into(),
            transaction_id: "wrong-amount".into(),
        };
        assert!(confirm(&connection, &wrong_amount).is_err());
        let links: i64 = connection
            .query_row("SELECT count(*) FROM receipt_candidate_links", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(links, 0);
    }
}
