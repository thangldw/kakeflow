//! Own-account transfer pair decisions.
//!
//! The webview proposes pairs (equal amount, opposite direction, different
//! accounts). This module records the user's decision. LINK retypes both legs as
//! a calculation-excluded TRANSFER and leaves the journals untouched. MERGE
//! turns the pair into one transfer journal (debit the receiving account, credit
//! the paying account) on the paying leg, voids the receiving leg without deleting
//! it, and copies its evidence links to the surviving transaction; a snapshot makes
//! CLEAR an exact undo. Every action is one SQLite transaction. The decision log
//! is device-local and append-only (migrations 0073 and 0074).

use crate::read_model::RepositoryError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const MAX_ID_LEN: usize = 128;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferPairDecisionDto {
    pub pair_key: String,
    pub out_transaction_id: String,
    pub in_transaction_id: String,
    /// `REJECTED`, `LINKED` or `MERGED`; cleared pairs are not listed.
    pub state: String,
    pub decided_at: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransferPairAction {
    Reject,
    Link,
    Merge,
    Clear,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPairDecisionInput {
    pub household_id: String,
    pub out_transaction_id: String,
    pub in_transaction_id: String,
    pub action: TransferPairAction,
}

/// Order-independent pair identity; must match `rejectionKey` in `src/domain/transferMatching.ts`.
pub fn pair_key(first: &str, second: &str) -> String {
    if first < second {
        format!("{first}|{second}")
    } else {
        format!("{second}|{first}")
    }
}

fn db(_: rusqlite::Error) -> RepositoryError {
    RepositoryError::Unavailable
}

fn validate_id(value: &str) -> Result<(), RepositoryError> {
    if value.trim().is_empty()
        || value.len() > MAX_ID_LEN
        || value.chars().any(|c| c.is_control() || c == '|')
    {
        return Err(RepositoryError::InvalidInput("Identifier is invalid"));
    }
    Ok(())
}

struct Entry {
    id: String,
    account_id: String,
    is_money: bool,
    side: String,
    amount: i64,
    line_number: i64,
}

struct Leg {
    transaction_type: String,
    calculation_target: i64,
    money_accounts: BTreeSet<String>,
    total_debit: i64,
    card_linked: bool,
    entries: Vec<Entry>,
}

fn load_leg(connection: &Connection, household_id: &str, id: &str) -> Result<Leg, RepositoryError> {
    let (transaction_type, calculation_target): (String, i64) = connection
        .query_row(
            "SELECT transaction_type, calculation_target FROM transactions
             WHERE id = ?1 AND household_id = ?2 AND status = 'POSTED'",
            params![id, household_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?
        .ok_or(RepositoryError::NotFound)?;
    let mut statement = connection
        .prepare(
            "SELECT je.account_id, a.account_kind, je.entry_side, je.amount_jpy, je.id, je.line_number
             FROM journal_entries je JOIN accounts a ON a.id = je.account_id
             WHERE je.transaction_id = ?1
             ORDER BY je.line_number, je.id",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(db)?;
    let mut money_accounts = BTreeSet::new();
    let mut total_debit = 0_i64;
    let mut entries = Vec::new();
    for row in rows {
        let (account_id, kind, side, amount, entry_id, line_number) = row.map_err(db)?;
        let is_money = kind == "ASSET" || kind == "LIABILITY";
        if is_money {
            money_accounts.insert(account_id.clone());
        }
        entries.push(Entry {
            id: entry_id,
            account_id,
            is_money,
            side: side.clone(),
            amount,
            line_number,
        });
        if side == "DEBIT" {
            total_debit = total_debit
                .checked_add(amount)
                .ok_or(RepositoryError::Unavailable)?;
        }
    }
    let card_linked: bool = connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM card_payments WHERE bank_transaction_id = ?1
               UNION ALL
               SELECT 1 FROM card_statement_transactions WHERE transaction_id = ?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(db)?;
    Ok(Leg {
        transaction_type,
        calculation_target,
        money_accounts,
        total_debit,
        card_linked,
        entries,
    })
}

type Previous = (String, i64, String, i64);

struct Latest {
    decision: String,
    previous: Option<Previous>,
    snapshot: Option<String>,
}

fn latest(
    connection: &Connection,
    household_id: &str,
    key: &str,
) -> Result<Option<Latest>, RepositoryError> {
    connection
        .query_row(
            "SELECT decision, previous_out_type, previous_out_calculation_target,
                    previous_in_type, previous_in_calculation_target, snapshot_json
             FROM transfer_pair_decisions
             WHERE household_id = ?1 AND pair_key = ?2
             ORDER BY rowid DESC LIMIT 1",
            params![household_id, key],
            |row| {
                let previous = match (
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ) {
                    (Some(a), Some(b), Some(c), Some(d)) => Some((a, b, c, d)),
                    _ => None,
                };
                Ok(Latest {
                    decision: row.get::<_, String>(0)?,
                    previous,
                    snapshot: row.get::<_, Option<String>>(5)?,
                })
            },
        )
        .optional()
        .map_err(db)
}

pub fn list_decisions(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<TransferPairDecisionDto>, RepositoryError> {
    validate_id(household_id)?;
    let mut statement = connection
        .prepare(
            "SELECT d.pair_key, d.out_transaction_id, d.in_transaction_id, d.decision, d.decided_at
             FROM transfer_pair_decisions d
             WHERE d.household_id = ?1
               AND d.rowid = (SELECT max(x.rowid) FROM transfer_pair_decisions x
                              WHERE x.household_id = d.household_id AND x.pair_key = d.pair_key)
               AND d.decision <> 'CLEARED'
             ORDER BY d.decided_at, d.pair_key",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([household_id], |row| {
            Ok(TransferPairDecisionDto {
                pair_key: row.get(0)?,
                out_transaction_id: row.get(1)?,
                in_transaction_id: row.get(2)?,
                state: row.get(3)?,
                decided_at: row.get(4)?,
            })
        })
        .map_err(db)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db)
}

fn insert_decision(
    connection: &Connection,
    input: &TransferPairDecisionInput,
    key: &str,
    decision: &str,
    previous: Option<(&Leg, &Leg)>,
    snapshot: Option<&str>,
) -> Result<(), RepositoryError> {
    connection
        .execute(
            "INSERT INTO transfer_pair_decisions(
               id, household_id, out_transaction_id, in_transaction_id, pair_key, decision,
               previous_out_type, previous_out_calculation_target,
               previous_in_type, previous_in_calculation_target, snapshot_json)
             VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                input.household_id,
                input.out_transaction_id,
                input.in_transaction_id,
                key,
                decision,
                previous.map(|(out, _)| out.transaction_type.clone()),
                previous.map(|(out, _)| out.calculation_target),
                previous.map(|(_, inn)| inn.transaction_type.clone()),
                previous.map(|(_, inn)| inn.calculation_target),
                snapshot,
            ],
        )
        .map_err(db)?;
    Ok(())
}

fn retype_as_transfer(
    connection: &Connection,
    household_id: &str,
    id: &str,
) -> Result<(), RepositoryError> {
    let changed = connection
        .execute(
            "UPDATE transactions
             SET transaction_type = 'TRANSFER', calculation_target = 0,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1 AND household_id = ?2 AND status = 'POSTED'",
            params![id, household_id],
        )
        .map_err(db)?;
    if changed == 1 {
        Ok(())
    } else {
        Err(RepositoryError::NotFound)
    }
}

/// Restores a leg only while it still looks exactly as the link left it, so a
/// later manual edit is never overwritten.
fn restore_leg(
    connection: &Connection,
    household_id: &str,
    id: &str,
    previous_type: &str,
    previous_target: i64,
) -> Result<(), RepositoryError> {
    connection
        .execute(
            "UPDATE transactions
             SET transaction_type = ?3, calculation_target = ?4,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1 AND household_id = ?2 AND status = 'POSTED'
               AND transaction_type = 'TRANSFER' AND calculation_target = 0",
            params![id, household_id, previous_type, previous_target],
        )
        .map_err(db)?;
    Ok(())
}

fn validate_transfer_legs(out: &Leg, inn: &Leg) -> Result<(), RepositoryError> {
    if out.card_linked || inn.card_linked {
        return Err(RepositoryError::InvalidInput(
            "Card-linked transactions must be changed through reconciliation",
        ));
    }
    if out.transaction_type == "TRANSFER" || inn.transaction_type == "TRANSFER" {
        return Err(RepositoryError::InvalidInput("A leg is already a transfer"));
    }
    if out.total_debit <= 0 || out.total_debit != inn.total_debit {
        return Err(RepositoryError::InvalidInput(
            "Transfer legs must have equal amounts",
        ));
    }
    if out.money_accounts.is_empty()
        || inn.money_accounts.is_empty()
        || !out.money_accounts.is_disjoint(&inn.money_accounts)
    {
        return Err(RepositoryError::InvalidInput(
            "Transfer legs must move money between different accounts",
        ));
    }
    Ok(())
}

/// The single money-account entry of a simple leg, on the expected side.
fn only_money_entry<'a>(leg: &'a Leg, side: &str) -> Result<&'a Entry, RepositoryError> {
    let mut money = leg.entries.iter().filter(|entry| entry.is_money);
    match (money.next(), money.next()) {
        (Some(entry), None) if entry.side == side && entry.amount == leg.total_debit => Ok(entry),
        _ => Err(RepositoryError::InvalidInput(
            "Only simple two-account transactions can be merged",
        )),
    }
}

fn new_id(connection: &Connection) -> Result<String, RepositoryError> {
    connection
        .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))
        .map_err(db)
}

fn merge_pair(
    connection: &Connection,
    input: &TransferPairDecisionInput,
    key: &str,
    out: &Leg,
    inn: &Leg,
) -> Result<(), RepositoryError> {
    validate_transfer_legs(out, inn)?;
    let paying = only_money_entry(out, "CREDIT")?;
    let receiving = only_money_entry(inn, "DEBIT")?;
    let (debit_id, credit_id) = (new_id(connection)?, new_id(connection)?);

    let added: Vec<String> = {
        let mut statement = connection
            .prepare(
                "SELECT source_record_id FROM transaction_sources
                 WHERE transaction_id = ?2
                   AND source_record_id NOT IN
                     (SELECT source_record_id FROM transaction_sources WHERE transaction_id = ?1)
                 ORDER BY source_record_id",
            )
            .map_err(db)?;
        let rows = statement
            .query_map(
                params![input.out_transaction_id, input.in_transaction_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    let snapshot = json!({
        "survivor": {
            "id": input.out_transaction_id,
            "type": out.transaction_type,
            "calculationTarget": out.calculation_target,
            "entries": out.entries.iter().map(|entry| json!({
                "id": entry.id, "accountId": entry.account_id, "side": entry.side,
                "amountJpy": entry.amount, "lineNumber": entry.line_number,
            })).collect::<Vec<_>>(),
            "mergedEntries": [
                {"id": debit_id, "accountId": receiving.account_id, "side": "DEBIT", "amountJpy": out.total_debit},
                {"id": credit_id, "accountId": paying.account_id, "side": "CREDIT", "amountJpy": out.total_debit},
            ],
        },
        "voided": {
            "id": input.in_transaction_id,
            "type": inn.transaction_type,
            "calculationTarget": inn.calculation_target,
        },
        "addedSourceRecordIds": added,
    })
    .to_string();

    let amount = out.total_debit;
    connection
        .execute(
            "UPDATE transactions
             SET transaction_type = 'TRANSFER', calculation_target = 0,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1 AND household_id = ?2 AND status = 'POSTED'",
            params![input.out_transaction_id, input.household_id],
        )
        .map_err(db)?;
    connection
        .execute(
            "DELETE FROM journal_entries WHERE transaction_id = ?1",
            [&input.out_transaction_id],
        )
        .map_err(db)?;
    for (entry_id, account_id, side, line) in [
        (&debit_id, &receiving.account_id, "DEBIT", 1_i64),
        (&credit_id, &paying.account_id, "CREDIT", 2_i64),
    ] {
        connection
            .execute(
                "INSERT INTO journal_entries
                   (id, transaction_id, account_id, entry_side, amount_jpy, line_number)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    entry_id,
                    input.out_transaction_id,
                    account_id,
                    side,
                    amount,
                    line
                ],
            )
            .map_err(db)?;
    }
    for record_id in &added {
        connection
            .execute(
                "INSERT INTO transaction_sources(transaction_id, source_record_id, candidate_id)
                 VALUES (?1, ?2, NULL)",
                params![input.out_transaction_id, record_id],
            )
            .map_err(db)?;
    }
    let voided = connection
        .execute(
            "UPDATE transactions
             SET status = 'VOID', calculation_target = 0,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1 AND household_id = ?2 AND status = 'POSTED'",
            params![input.in_transaction_id, input.household_id],
        )
        .map_err(db)?;
    if voided != 1 {
        return Err(RepositoryError::NotFound);
    }
    insert_decision(
        connection,
        input,
        key,
        "MERGED",
        Some((out, inn)),
        Some(&snapshot),
    )
}

/// Exact undo of a merge. It refuses (changing nothing) when the merged
/// transaction or the voided leg was touched after the merge.
fn undo_merge(
    connection: &Connection,
    input: &TransferPairDecisionInput,
    key: &str,
    snapshot_text: &str,
) -> Result<(), RepositoryError> {
    let unsafe_undo =
        RepositoryError::InvalidInput("The merge was edited afterwards; undo is no longer safe");
    let snapshot: Value =
        serde_json::from_str(snapshot_text).map_err(|_| RepositoryError::Unavailable)?;
    let text = |value: &Value| {
        value
            .as_str()
            .map(str::to_owned)
            .ok_or(RepositoryError::Unavailable)
    };
    let number = |value: &Value| value.as_i64().ok_or(RepositoryError::Unavailable);
    let survivor_id = text(&snapshot["survivor"]["id"])?;
    let voided_id = text(&snapshot["voided"]["id"])?;

    // Compare content, not just ids: an edit can keep the entry ids and change the accounts or amounts.
    let mut merged_entries: Vec<(String, String, String, i64)> = snapshot["survivor"]
        ["mergedEntries"]
        .as_array()
        .ok_or(RepositoryError::Unavailable)?
        .iter()
        .map(|entry| {
            Ok((
                text(&entry["id"])?,
                text(&entry["accountId"])?,
                text(&entry["side"])?,
                number(&entry["amountJpy"])?,
            ))
        })
        .collect::<Result<_, RepositoryError>>()?;
    merged_entries.sort();
    let current_entries: Vec<(String, String, String, i64)> = {
        let mut statement = connection
            .prepare(
                "SELECT id, account_id, entry_side, amount_jpy FROM journal_entries
                 WHERE transaction_id = ?1 ORDER BY id",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([&survivor_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(db)?;
        rows.collect::<Result<_, _>>().map_err(db)?
    };
    let survivor_state: Option<(String, i64)> = connection
        .query_row(
            "SELECT transaction_type, calculation_target FROM transactions
             WHERE id = ?1 AND household_id = ?2 AND status = 'POSTED'",
            params![survivor_id, input.household_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    let voided_is_void: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM transactions
                           WHERE id = ?1 AND household_id = ?2 AND status = 'VOID')",
            params![voided_id, input.household_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if survivor_state != Some(("TRANSFER".to_owned(), 0))
        || current_entries != merged_entries
        || !voided_is_void
    {
        return Err(unsafe_undo);
    }

    connection
        .execute(
            "UPDATE transactions
             SET transaction_type = ?3, calculation_target = ?4,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1 AND household_id = ?2",
            params![
                survivor_id,
                input.household_id,
                text(&snapshot["survivor"]["type"])?,
                number(&snapshot["survivor"]["calculationTarget"])?
            ],
        )
        .map_err(db)?;
    connection
        .execute(
            "DELETE FROM journal_entries WHERE transaction_id = ?1",
            [&survivor_id],
        )
        .map_err(db)?;
    for entry in snapshot["survivor"]["entries"]
        .as_array()
        .ok_or(RepositoryError::Unavailable)?
    {
        connection
            .execute(
                "INSERT INTO journal_entries
                   (id, transaction_id, account_id, entry_side, amount_jpy, line_number)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    text(&entry["id"])?,
                    survivor_id,
                    text(&entry["accountId"])?,
                    text(&entry["side"])?,
                    number(&entry["amountJpy"])?,
                    number(&entry["lineNumber"])?
                ],
            )
            .map_err(db)?;
    }
    for record_id in snapshot["addedSourceRecordIds"]
        .as_array()
        .ok_or(RepositoryError::Unavailable)?
    {
        connection
            .execute(
                "DELETE FROM transaction_sources WHERE transaction_id = ?1 AND source_record_id = ?2",
                params![survivor_id, text(record_id)?],
            )
            .map_err(db)?;
    }
    connection
        .execute(
            "UPDATE transactions
             SET status = 'POSTED', calculation_target = ?3,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1 AND household_id = ?2 AND status = 'VOID'",
            params![
                voided_id,
                input.household_id,
                number(&snapshot["voided"]["calculationTarget"])?
            ],
        )
        .map_err(db)?;
    insert_decision(connection, input, key, "CLEARED", None, None)
}

pub fn decide(
    connection: &Connection,
    input: &TransferPairDecisionInput,
) -> Result<Vec<TransferPairDecisionDto>, RepositoryError> {
    validate_id(&input.household_id)?;
    validate_id(&input.out_transaction_id)?;
    validate_id(&input.in_transaction_id)?;
    if input.out_transaction_id == input.in_transaction_id {
        return Err(RepositoryError::InvalidInput(
            "A transfer needs two different transactions",
        ));
    }
    let key = pair_key(&input.out_transaction_id, &input.in_transaction_id);
    let transaction = connection.unchecked_transaction().map_err(db)?;
    let current = latest(&transaction, &input.household_id, &key)?;
    let state = current.as_ref().map(|latest| latest.decision.as_str());
    let load_legs = || -> Result<(Leg, Leg), RepositoryError> {
        Ok((
            load_leg(&transaction, &input.household_id, &input.out_transaction_id)?,
            load_leg(&transaction, &input.household_id, &input.in_transaction_id)?,
        ))
    };

    match input.action {
        TransferPairAction::Reject => {
            if matches!(state, Some("LINKED") | Some("MERGED")) {
                return Err(RepositoryError::InvalidInput(
                    "Clear the transfer link or merge before rejecting the pair",
                ));
            }
            let _ = load_legs()?;
            if state != Some("REJECTED") {
                insert_decision(&transaction, input, &key, "REJECTED", None, None)?;
            }
        }
        TransferPairAction::Link | TransferPairAction::Merge => {
            if matches!(state, Some("LINKED") | Some("MERGED")) {
                return Err(RepositoryError::InvalidInput("The pair is already linked"));
            }
            let (out, inn) = load_legs()?;
            if input.action == TransferPairAction::Link {
                validate_transfer_legs(&out, &inn)?;
                retype_as_transfer(&transaction, &input.household_id, &input.out_transaction_id)?;
                retype_as_transfer(&transaction, &input.household_id, &input.in_transaction_id)?;
                insert_decision(
                    &transaction,
                    input,
                    &key,
                    "LINKED",
                    Some((&out, &inn)),
                    None,
                )?;
            } else {
                merge_pair(&transaction, input, &key, &out, &inn)?;
            }
        }
        TransferPairAction::Clear => match current {
            None => {}
            Some(latest) if latest.decision == "CLEARED" => {}
            Some(latest) if latest.decision == "MERGED" => {
                let snapshot = latest.snapshot.ok_or(RepositoryError::Unavailable)?;
                undo_merge(&transaction, input, &key, &snapshot)?;
            }
            Some(latest) => {
                if latest.decision == "LINKED" {
                    let (out_type, out_target, in_type, in_target) =
                        latest.previous.ok_or(RepositoryError::Unavailable)?;
                    restore_leg(
                        &transaction,
                        &input.household_id,
                        &input.out_transaction_id,
                        &out_type,
                        out_target,
                    )?;
                    restore_leg(
                        &transaction,
                        &input.household_id,
                        &input.in_transaction_id,
                        &in_type,
                        in_target,
                    )?;
                }
                insert_decision(&transaction, input, &key, "CLEARED", None, None)?;
            }
        },
    }
    transaction.commit().map_err(db)?;
    list_decisions(connection, &input.household_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(include_str!(
                "../migrations/0073_transfer_pair_decisions.sql"
            ))
            .expect("decision table");
        connection
            .execute_batch(include_str!("../migrations/0074_transfer_pair_merges.sql"))
            .expect("merge columns");
        connection
            .execute_batch(
                "CREATE TABLE accounts (id TEXT PRIMARY KEY, account_kind TEXT NOT NULL);
                 CREATE TABLE transactions (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL, status TEXT NOT NULL,
                   transaction_type TEXT NOT NULL, calculation_target INTEGER NOT NULL,
                   updated_at TEXT NOT NULL DEFAULT '2026-07-01T00:00:00Z');
                 CREATE TABLE journal_entries (
                   id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, account_id TEXT NOT NULL,
                   entry_side TEXT NOT NULL, amount_jpy INTEGER NOT NULL, line_number INTEGER NOT NULL);
                 CREATE TABLE transaction_sources (
                   transaction_id TEXT NOT NULL, source_record_id TEXT NOT NULL, candidate_id TEXT,
                   PRIMARY KEY (transaction_id, source_record_id));
                 CREATE TABLE card_payments (bank_transaction_id TEXT);
                 CREATE TABLE card_statement_transactions (transaction_id TEXT);
                 INSERT INTO accounts VALUES ('bank-a','ASSET'),('bank-b','ASSET'),('food','EXPENSE'),('salary','INCOME');
                 -- Leg out: expense paid from bank-a. Leg in: income received in bank-b.
                 INSERT INTO transactions VALUES ('out-1','family','POSTED','EXPENSE',1,'2026-07-01T00:00:00Z');
                 INSERT INTO journal_entries VALUES ('e1','out-1','food','DEBIT',50000,1),('e2','out-1','bank-a','CREDIT',50000,2);
                 INSERT INTO transaction_sources VALUES ('out-1','rec-out',NULL);
                 INSERT INTO transactions VALUES ('in-1','family','POSTED','INCOME',1,'2026-07-01T00:00:00Z');
                 INSERT INTO journal_entries VALUES ('e3','in-1','bank-b','DEBIT',50000,1),('e4','in-1','salary','CREDIT',50000,2);
                 INSERT INTO transaction_sources VALUES ('in-1','rec-in',NULL),('in-1','rec-out',NULL);",
            )
            .expect("fixture");
        connection
    }

    fn input(action: TransferPairAction) -> TransferPairDecisionInput {
        TransferPairDecisionInput {
            household_id: "family".into(),
            out_transaction_id: "out-1".into(),
            in_transaction_id: "in-1".into(),
            action,
        }
    }

    fn leg_state(connection: &Connection, id: &str) -> (String, i64) {
        connection
            .query_row(
                "SELECT transaction_type, calculation_target FROM transactions WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap()
    }

    #[test]
    fn pair_key_is_order_independent_and_matches_the_typescript_contract() {
        assert_eq!(pair_key("b", "a"), "a|b");
        assert_eq!(pair_key("a", "b"), "a|b");
    }

    #[test]
    fn link_retypes_both_legs_atomically_without_touching_journals_and_clear_restores_them() {
        let connection = database();
        let listed = decide(&connection, &input(TransferPairAction::Link)).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].state, "LINKED");
        assert_eq!(listed[0].pair_key, "in-1|out-1");
        assert_eq!(leg_state(&connection, "out-1"), ("TRANSFER".to_owned(), 0));
        assert_eq!(leg_state(&connection, "in-1"), ("TRANSFER".to_owned(), 0));
        let journal_rows: i64 = connection
            .query_row("SELECT count(*) FROM journal_entries", [], |r| r.get(0))
            .unwrap();
        assert_eq!(journal_rows, 4);

        assert!(
            decide(&connection, &input(TransferPairAction::Link)).is_err(),
            "already linked"
        );
        assert!(
            decide(&connection, &input(TransferPairAction::Reject)).is_err(),
            "must clear first"
        );

        let cleared = decide(&connection, &input(TransferPairAction::Clear)).unwrap();
        assert!(cleared.is_empty());
        assert_eq!(leg_state(&connection, "out-1"), ("EXPENSE".to_owned(), 1));
        assert_eq!(leg_state(&connection, "in-1"), ("INCOME".to_owned(), 1));
    }

    #[test]
    fn clear_does_not_overwrite_a_leg_edited_after_the_link() {
        let connection = database();
        decide(&connection, &input(TransferPairAction::Link)).unwrap();
        connection
            .execute(
                "UPDATE transactions SET transaction_type = 'ADJUSTMENT' WHERE id = 'out-1'",
                [],
            )
            .unwrap();
        decide(&connection, &input(TransferPairAction::Clear)).unwrap();
        assert_eq!(leg_state(&connection, "out-1").0, "ADJUSTMENT");
        assert_eq!(leg_state(&connection, "in-1"), ("INCOME".to_owned(), 1));
    }

    #[test]
    fn reject_is_idempotent_listed_and_can_be_cleared() {
        let connection = database();
        decide(&connection, &input(TransferPairAction::Reject)).unwrap();
        let listed = decide(&connection, &input(TransferPairAction::Reject)).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].state, "REJECTED");
        let rows: i64 = connection
            .query_row("SELECT count(*) FROM transfer_pair_decisions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(rows, 1, "a repeated reject must not append a duplicate row");
        assert_eq!(leg_state(&connection, "out-1"), ("EXPENSE".to_owned(), 1));
        assert!(decide(&connection, &input(TransferPairAction::Clear))
            .unwrap()
            .is_empty());
        assert_eq!(
            decide(&connection, &input(TransferPairAction::Link)).unwrap()[0].state,
            "LINKED"
        );
    }

    #[test]
    fn link_rejects_unsafe_pairs_without_partial_writes() {
        let connection = database();
        connection
            .execute(
                "UPDATE journal_entries SET amount_jpy = 49999 WHERE id IN ('e3','e4')",
                [],
            )
            .unwrap();
        assert!(
            decide(&connection, &input(TransferPairAction::Link)).is_err(),
            "unequal amounts"
        );

        connection
            .execute(
                "UPDATE journal_entries SET amount_jpy = 50000 WHERE id IN ('e3','e4')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE journal_entries SET account_id = 'bank-a' WHERE id = 'e3'",
                [],
            )
            .unwrap();
        assert!(
            decide(&connection, &input(TransferPairAction::Link)).is_err(),
            "same account"
        );
        connection
            .execute(
                "UPDATE journal_entries SET account_id = 'bank-b' WHERE id = 'e3'",
                [],
            )
            .unwrap();

        connection
            .execute("INSERT INTO card_payments VALUES ('in-1')", [])
            .unwrap();
        assert!(
            decide(&connection, &input(TransferPairAction::Link)).is_err(),
            "card linked"
        );
        connection.execute("DELETE FROM card_payments", []).unwrap();

        connection
            .execute(
                "UPDATE transactions SET household_id = 'other' WHERE id = 'in-1'",
                [],
            )
            .unwrap();
        assert!(
            matches!(
                decide(&connection, &input(TransferPairAction::Link)),
                Err(RepositoryError::NotFound)
            ),
            "cross household"
        );

        assert_eq!(leg_state(&connection, "out-1"), ("EXPENSE".to_owned(), 1));
        let rows: i64 = connection
            .query_row("SELECT count(*) FROM transfer_pair_decisions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn identical_ids_and_bad_identifiers_are_rejected() {
        let connection = database();
        let mut same = input(TransferPairAction::Reject);
        same.in_transaction_id = "out-1".into();
        assert!(decide(&connection, &same).is_err());
        let mut bad = input(TransferPairAction::Reject);
        bad.in_transaction_id = "in|1".into();
        assert!(decide(&connection, &bad).is_err());
        assert!(list_decisions(&connection, " ").is_err());
    }

    #[test]
    fn decision_rows_are_append_only() {
        let connection = database();
        decide(&connection, &input(TransferPairAction::Reject)).unwrap();
        assert!(connection
            .execute(
                "UPDATE transfer_pair_decisions SET decision = 'CLEARED'",
                []
            )
            .is_err());
        assert!(connection
            .execute("DELETE FROM transfer_pair_decisions", [])
            .is_err());
    }
    fn entries_of(connection: &Connection, id: &str) -> Vec<(String, String, i64)> {
        let mut statement = connection
            .prepare("SELECT account_id, entry_side, amount_jpy FROM journal_entries WHERE transaction_id = ?1 ORDER BY line_number")
            .unwrap();
        statement
            .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn sources_of(connection: &Connection, id: &str) -> Vec<String> {
        let mut statement = connection
            .prepare("SELECT source_record_id FROM transaction_sources WHERE transaction_id = ?1 ORDER BY 1")
            .unwrap();
        statement
            .query_map([id], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn status_of(connection: &Connection, id: &str) -> (String, i64) {
        connection
            .query_row(
                "SELECT status, calculation_target FROM transactions WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap()
    }

    #[test]
    fn merge_makes_one_transfer_journal_voids_the_other_leg_keeps_evidence_and_undoes_exactly() {
        let connection = database();
        let listed = decide(&connection, &input(TransferPairAction::Merge)).unwrap();
        assert_eq!(listed[0].state, "MERGED");

        assert_eq!(leg_state(&connection, "out-1"), ("TRANSFER".to_owned(), 0));
        assert_eq!(
            entries_of(&connection, "out-1"),
            vec![
                ("bank-b".to_owned(), "DEBIT".to_owned(), 50000),
                ("bank-a".to_owned(), "CREDIT".to_owned(), 50000)
            ]
        );
        assert_eq!(status_of(&connection, "in-1"), ("VOID".to_owned(), 0));
        assert_eq!(
            entries_of(&connection, "in-1").len(),
            2,
            "the voided leg keeps its journal"
        );
        assert_eq!(
            sources_of(&connection, "out-1"),
            vec!["rec-in".to_owned(), "rec-out".to_owned()]
        );
        assert_eq!(
            sources_of(&connection, "in-1"),
            vec!["rec-in".to_owned(), "rec-out".to_owned()]
        );

        assert!(decide(&connection, &input(TransferPairAction::Link)).is_err());
        assert!(decide(&connection, &input(TransferPairAction::Merge)).is_err());
        assert!(decide(&connection, &input(TransferPairAction::Reject)).is_err());

        assert!(decide(&connection, &input(TransferPairAction::Clear))
            .unwrap()
            .is_empty());
        assert_eq!(leg_state(&connection, "out-1"), ("EXPENSE".to_owned(), 1));
        assert_eq!(
            entries_of(&connection, "out-1"),
            vec![
                ("food".to_owned(), "DEBIT".to_owned(), 50000),
                ("bank-a".to_owned(), "CREDIT".to_owned(), 50000)
            ]
        );
        let ids: Vec<String> = connection
            .prepare("SELECT id FROM journal_entries WHERE transaction_id = 'out-1' ORDER BY line_number")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            ids,
            vec!["e1".to_owned(), "e2".to_owned()],
            "original entry ids are restored"
        );
        assert_eq!(sources_of(&connection, "out-1"), vec!["rec-out".to_owned()]);
        assert_eq!(status_of(&connection, "in-1"), ("POSTED".to_owned(), 1));
    }

    #[test]
    fn undo_refuses_when_the_merge_was_edited_and_works_again_once_the_edit_is_reverted() {
        let connection = database();
        decide(&connection, &input(TransferPairAction::Merge)).unwrap();
        // Same entry ids, different amounts: an id-only check would miss this.
        connection
            .execute(
                "UPDATE journal_entries SET amount_jpy = 49999 WHERE transaction_id = 'out-1'",
                [],
            )
            .unwrap();
        assert!(matches!(
            decide(&connection, &input(TransferPairAction::Clear)),
            Err(RepositoryError::InvalidInput(_))
        ));
        assert!(decide(&connection, &input(TransferPairAction::Reject)).is_err());
        assert_eq!(
            leg_state(&connection, "out-1"),
            ("TRANSFER".to_owned(), 0),
            "a refused undo changes nothing"
        );
        assert_eq!(status_of(&connection, "in-1").0, "VOID");

        connection
            .execute(
                "UPDATE journal_entries SET amount_jpy = 50000 WHERE transaction_id = 'out-1'",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE transactions SET status = 'POSTED' WHERE id = 'in-1'",
                [],
            )
            .unwrap();
        assert!(
            decide(&connection, &input(TransferPairAction::Clear)).is_err(),
            "voided leg was touched"
        );
        connection
            .execute(
                "UPDATE transactions SET status = 'VOID' WHERE id = 'in-1'",
                [],
            )
            .unwrap();
        assert!(decide(&connection, &input(TransferPairAction::Clear))
            .unwrap()
            .is_empty());
        assert_eq!(leg_state(&connection, "out-1"), ("EXPENSE".to_owned(), 1));
    }

    #[test]
    fn merge_refuses_complex_or_unsafe_legs_without_partial_writes() {
        let connection = database();
        // A second money entry on the paying leg: not a simple two-account transaction.
        connection
            .execute_batch(
                "INSERT INTO accounts VALUES ('bank-c','ASSET');
             UPDATE journal_entries SET amount_jpy = 30000 WHERE id = 'e2';
             INSERT INTO journal_entries VALUES ('e5','out-1','bank-c','CREDIT',20000,3);",
            )
            .unwrap();
        assert!(decide(&connection, &input(TransferPairAction::Merge)).is_err());
        connection.execute_batch("DELETE FROM journal_entries WHERE id = 'e5'; UPDATE journal_entries SET amount_jpy = 50000 WHERE id = 'e2';").unwrap();

        // Wrong direction: the "paying" leg's money entry is a debit.
        connection
            .execute(
                "UPDATE journal_entries SET entry_side = 'DEBIT' WHERE id = 'e2'",
                [],
            )
            .unwrap();
        assert!(decide(&connection, &input(TransferPairAction::Merge)).is_err());
        connection
            .execute(
                "UPDATE journal_entries SET entry_side = 'CREDIT' WHERE id = 'e2'",
                [],
            )
            .unwrap();

        // Unequal amounts and shared accounts are refused as for LINK.
        connection
            .execute(
                "UPDATE journal_entries SET amount_jpy = 49999 WHERE transaction_id = 'in-1'",
                [],
            )
            .unwrap();
        assert!(decide(&connection, &input(TransferPairAction::Merge)).is_err());
        connection
            .execute(
                "UPDATE journal_entries SET amount_jpy = 50000 WHERE transaction_id = 'in-1'",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE journal_entries SET account_id = 'bank-a' WHERE id = 'e3'",
                [],
            )
            .unwrap();
        assert!(decide(&connection, &input(TransferPairAction::Merge)).is_err());
        connection
            .execute(
                "UPDATE journal_entries SET account_id = 'bank-b' WHERE id = 'e3'",
                [],
            )
            .unwrap();

        assert_eq!(leg_state(&connection, "out-1"), ("EXPENSE".to_owned(), 1));
        assert_eq!(status_of(&connection, "in-1"), ("POSTED".to_owned(), 1));
        assert_eq!(entries_of(&connection, "out-1").len(), 2);
        let rows: i64 = connection
            .query_row("SELECT count(*) FROM transfer_pair_decisions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(rows, 0);
    }

    /// Real-schema check: the retype and its undo must pass the production triggers.
    #[test]
    fn link_merge_and_clear_work_on_the_migrated_schema() {
        use crate::persistence::AppState;
        use crate::read_model::{
            create_account, create_household, create_manual_transaction, get_transaction_detail,
        };
        use serde_json::json;

        let state = AppState::in_memory(b"test-only-key-material-at-least-32-bytes")
            .expect("migrations should apply");
        state
            .with_connection(|connection| {
                create_household(connection, &serde_json::from_value(json!({"id":"family","name":"Family"})).unwrap()).unwrap();
                for (id, kind, subtype) in [
                    ("bank-a", "ASSET", "BANK"),
                    ("bank-b", "ASSET", "BANK"),
                    ("food", "EXPENSE", "OTHER"),
                    ("salary", "INCOME", "OTHER"),
                ] {
                    create_account(
                        connection,
                        &serde_json::from_value(json!({
                            "id": id, "householdId": "family", "name": id, "accountKind": kind,
                            "accountSubtype": subtype, "currency": "JPY", "ownershipKind": "HOUSEHOLD",
                            "ownerMemberId": null, "visibility": "SHARED"
                        }))
                        .unwrap(),
                    )
                    .unwrap();
                }
                let post = |id: &str, kind: &str, debit: &str, credit: &str| {
                    create_manual_transaction(
                        connection,
                        &serde_json::from_value(json!({
                            "id": id, "householdId": "family", "occurredOn": "2026-07-01", "postedOn": null,
                            "transactionType": kind, "payee": "振込", "description": null,
                            "entries": [
                                {"id": format!("{id}-d"), "accountId": debit, "side": "DEBIT", "amountJpy": 50000},
                                {"id": format!("{id}-c"), "accountId": credit, "side": "CREDIT", "amountJpy": 50000}
                            ]
                        }))
                        .unwrap(),
                    )
                    .unwrap();
                };
                post("out-1", "EXPENSE", "food", "bank-a");
                post("in-1", "INCOME", "bank-b", "salary");

                let listed = decide(connection, &input(TransferPairAction::Link)).unwrap();
                assert_eq!(listed[0].state, "LINKED");
                for id in ["out-1", "in-1"] {
                    let detail = get_transaction_detail(connection, "family", id).unwrap();
                    assert_eq!(detail.transaction_type, "TRANSFER");
                    assert!(!detail.calculation_target);
                    assert_eq!(detail.entries.len(), 2, "journal untouched");
                }
                decide(connection, &input(TransferPairAction::Clear)).unwrap();
                assert_eq!(get_transaction_detail(connection, "family", "out-1").unwrap().transaction_type, "EXPENSE");
                assert!(get_transaction_detail(connection, "family", "in-1").unwrap().calculation_target);

                // MERGE and its exact undo through the production triggers.
                let merged = decide(connection, &input(TransferPairAction::Merge)).unwrap();
                assert_eq!(merged[0].state, "MERGED");
                let survivor = get_transaction_detail(connection, "family", "out-1").unwrap();
                assert_eq!(survivor.transaction_type, "TRANSFER");
                assert!(!survivor.calculation_target);
                let shape: Vec<(String, String, i64)> = survivor
                    .entries
                    .iter()
                    .map(|entry| (entry.account_id.clone(), entry.side.clone(), entry.amount_jpy))
                    .collect();
                assert_eq!(
                    shape,
                    vec![
                        ("bank-b".to_owned(), "DEBIT".to_owned(), 50000),
                        ("bank-a".to_owned(), "CREDIT".to_owned(), 50000)
                    ]
                );
                let voided: String = connection
                    .query_row("SELECT status FROM transactions WHERE id = 'in-1'", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(voided, "VOID");
                decide(connection, &input(TransferPairAction::Clear)).unwrap();
                let restored = get_transaction_detail(connection, "family", "out-1").unwrap();
                assert_eq!(restored.transaction_type, "EXPENSE");
                assert_eq!(restored.entries.len(), 2);
                assert!(restored.entries.iter().any(|entry| entry.account_id == "food" && entry.side == "DEBIT"));
                let posted: String = connection
                    .query_row("SELECT status FROM transactions WHERE id = 'in-1'", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(posted, "POSTED");
                Ok(())
            })
            .unwrap();
    }
}
