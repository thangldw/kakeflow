//! Own-account transfer pair decisions.
//!
//! The webview proposes pairs (equal amount, opposite direction, different
//! accounts). This module records the user's decision and, for LINK, retypes
//! both legs as a calculation-excluded TRANSFER in one SQLite transaction. The
//! journal entries are never touched, so balances, evidence and lineage stay as
//! imported. The decision log is device-local and append-only (migration 0073).

use crate::read_model::RepositoryError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const MAX_ID_LEN: usize = 128;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferPairDecisionDto {
    pub pair_key: String,
    pub out_transaction_id: String,
    pub in_transaction_id: String,
    /// `REJECTED` or `LINKED`; cleared pairs are not listed.
    pub state: String,
    pub decided_at: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransferPairAction {
    Reject,
    Link,
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

struct Leg {
    transaction_type: String,
    calculation_target: i64,
    money_accounts: BTreeSet<String>,
    total_debit: i64,
    card_linked: bool,
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
            "SELECT je.account_id, a.account_kind, je.entry_side, je.amount_jpy
             FROM journal_entries je JOIN accounts a ON a.id = je.account_id
             WHERE je.transaction_id = ?1",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(db)?;
    let mut money_accounts = BTreeSet::new();
    let mut total_debit = 0_i64;
    for row in rows {
        let (account_id, kind, side, amount) = row.map_err(db)?;
        if kind == "ASSET" || kind == "LIABILITY" {
            money_accounts.insert(account_id);
        }
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
    })
}

type Previous = (String, i64, String, i64);

fn latest(
    connection: &Connection,
    household_id: &str,
    key: &str,
) -> Result<Option<(String, Option<Previous>)>, RepositoryError> {
    connection
        .query_row(
            "SELECT decision, previous_out_type, previous_out_calculation_target,
                    previous_in_type, previous_in_calculation_target
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
                Ok((row.get::<_, String>(0)?, previous))
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
) -> Result<(), RepositoryError> {
    connection
        .execute(
            "INSERT INTO transfer_pair_decisions(
               id, household_id, out_transaction_id, in_transaction_id, pair_key, decision,
               previous_out_type, previous_out_calculation_target,
               previous_in_type, previous_in_calculation_target)
             VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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
    let out = load_leg(&transaction, &input.household_id, &input.out_transaction_id)?;
    let inn = load_leg(&transaction, &input.household_id, &input.in_transaction_id)?;
    let current = latest(&transaction, &input.household_id, &key)?;
    let state = current.as_ref().map(|(decision, _)| decision.as_str());

    match input.action {
        TransferPairAction::Reject => match state {
            Some("LINKED") => {
                return Err(RepositoryError::InvalidInput(
                    "Clear the transfer link before rejecting the pair",
                ))
            }
            Some("REJECTED") => {}
            _ => insert_decision(&transaction, input, &key, "REJECTED", None)?,
        },
        TransferPairAction::Link => {
            if state == Some("LINKED") {
                return Err(RepositoryError::InvalidInput("The pair is already linked"));
            }
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
            retype_as_transfer(&transaction, &input.household_id, &input.out_transaction_id)?;
            retype_as_transfer(&transaction, &input.household_id, &input.in_transaction_id)?;
            insert_decision(&transaction, input, &key, "LINKED", Some((&out, &inn)))?;
        }
        TransferPairAction::Clear => match current {
            None => {}
            Some((decision, _)) if decision == "CLEARED" => {}
            Some((decision, previous)) => {
                if decision == "LINKED" {
                    let (out_type, out_target, in_type, in_target) =
                        previous.ok_or(RepositoryError::Unavailable)?;
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
                insert_decision(&transaction, input, &key, "CLEARED", None)?;
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
            .execute_batch(
                "CREATE TABLE accounts (id TEXT PRIMARY KEY, account_kind TEXT NOT NULL);
                 CREATE TABLE transactions (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL, status TEXT NOT NULL,
                   transaction_type TEXT NOT NULL, calculation_target INTEGER NOT NULL,
                   updated_at TEXT NOT NULL DEFAULT '2026-07-01T00:00:00Z');
                 CREATE TABLE journal_entries (
                   id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, account_id TEXT NOT NULL,
                   entry_side TEXT NOT NULL, amount_jpy INTEGER NOT NULL);
                 CREATE TABLE card_payments (bank_transaction_id TEXT);
                 CREATE TABLE card_statement_transactions (transaction_id TEXT);
                 INSERT INTO accounts VALUES ('bank-a','ASSET'),('bank-b','ASSET'),('food','EXPENSE'),('salary','INCOME');
                 -- Leg out: expense paid from bank-a. Leg in: income received in bank-b.
                 INSERT INTO transactions VALUES ('out-1','family','POSTED','EXPENSE',1,'2026-07-01T00:00:00Z');
                 INSERT INTO journal_entries VALUES ('e1','out-1','food','DEBIT',50000),('e2','out-1','bank-a','CREDIT',50000);
                 INSERT INTO transactions VALUES ('in-1','family','POSTED','INCOME',1,'2026-07-01T00:00:00Z');
                 INSERT INTO journal_entries VALUES ('e3','in-1','bank-b','DEBIT',50000),('e4','in-1','salary','CREDIT',50000);",
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
    /// Real-schema check: the retype and its undo must pass the production triggers.
    #[test]
    fn link_and_clear_work_on_the_migrated_schema() {
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
                Ok(())
            })
            .unwrap();
    }
}
