//! Possible duplicate charges across the whole ledger: two posted spending transactions with the same payee and
//! the same amount a few days apart. A flag for the user to look at, never a conclusion — two real purchases can
//! look identical — and nothing is changed or merged. Small amounts are ignored because repeated small purchases
//! (two coffees) are normal.

use rusqlite::{params, Connection};
use serde::Serialize;
use thiserror::Error;

const MAX_LISTED: u32 = 50;
const MAX_WINDOW_DAYS: i64 = 14;
const MAX_MIN_AMOUNT_JPY: i64 = 100_000_000;

#[derive(Debug, Error)]
pub enum DuplicateChargeError {
    #[error("duplicate charge database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("duplicate charge request is invalid")]
    InvalidRequest,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateChargeDto {
    pub first_transaction_id: String,
    pub second_transaction_id: String,
    pub first_on: String,
    pub second_on: String,
    pub payee: String,
    pub amount_jpy: i64,
    pub days_apart: i64,
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
  SELECT t.id, t.occurred_on, lower(trim(t.payee)) AS payee_key, trim(t.payee) AS payee,
         COALESCE((SELECT SUM(je.amount_jpy) FROM journal_entries je
                    WHERE je.transaction_id = t.id AND je.entry_side = 'DEBIT'), 0) AS total_jpy
    FROM transactions t
   WHERE t.household_id = ?1 AND t.status = 'POSTED'
     AND t.transaction_type IN ('EXPENSE', 'CARD_PURCHASE', 'FEE')
     AND t.payee IS NOT NULL AND trim(t.payee) <> ''
)
SELECT a.id, b.id, a.occurred_on, b.occurred_on, a.payee, a.total_jpy,
       CAST(julianday(b.occurred_on) - julianday(a.occurred_on) AS INTEGER) AS days_apart
  FROM spending a JOIN spending b
    ON a.payee_key = b.payee_key AND a.total_jpy = b.total_jpy
   AND (a.occurred_on < b.occurred_on OR (a.occurred_on = b.occurred_on AND a.id < b.id))
 WHERE a.total_jpy >= ?2
   AND julianday(b.occurred_on) - julianday(a.occurred_on) <= ?3
   AND (substr(a.occurred_on, 1, 7) = ?4 OR substr(b.occurred_on, 1, 7) = ?4)
 ORDER BY a.total_jpy DESC, b.occurred_on DESC, a.id, b.id
 LIMIT ?5";

/// Pairs of posted spending with the same payee and amount no more than `window_days` apart, where at least one
/// falls in `month`, largest amount first. Only amounts of at least `min_amount_jpy` are considered.
pub fn possible_duplicate_charges(
    connection: &Connection,
    household_id: &str,
    month: &str,
    min_amount_jpy: i64,
    window_days: i64,
    limit: u32,
) -> Result<Vec<DuplicateChargeDto>, DuplicateChargeError> {
    if household_id.trim().is_empty()
        || household_id.len() > 128
        || !valid_month(month)
        || !(0..=MAX_MIN_AMOUNT_JPY).contains(&min_amount_jpy)
        || !(0..=MAX_WINDOW_DAYS).contains(&window_days)
        || !(1..=MAX_LISTED).contains(&limit)
    {
        return Err(DuplicateChargeError::InvalidRequest);
    }
    let mut statement = connection.prepare(SQL)?;
    let rows = statement
        .query_map(
            params![household_id, min_amount_jpy, window_days, month, limit],
            |row| {
                Ok(DuplicateChargeDto {
                    first_transaction_id: row.get(0)?,
                    second_transaction_id: row.get(1)?,
                    first_on: row.get(2)?,
                    second_on: row.get(3)?,
                    payee: row.get(4)?,
                    amount_jpy: row.get(5)?,
                    days_apart: row.get(6)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    fn with_db(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(&[6_u8; 32]).expect("migrations");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('home','Home'),('other','Other');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES
                       ('cash','home','現金','ASSET','CASH'),('food','home','食費','EXPENSE','OTHER'),
                       ('ocash','other','現金','ASSET','CASH'),('ofood','other','食費','EXPENSE','OTHER');",
                )?;
                test(connection);
                Ok(())
            })
            .expect("body");
    }

    fn add(
        c: &Connection,
        id: &str,
        household: &str,
        date: &str,
        status: &str,
        payee: Option<&str>,
        amount: i64,
    ) {
        let (cash, food) = if household == "home" {
            ("cash", "food")
        } else {
            ("ocash", "ofood")
        };
        c.execute(
            "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,payee,status) VALUES(?1,?2,?3,'EXPENSE',?4,?5)",
            params![id, household, date, payee, status],
        )
        .unwrap();
        c.execute(
            "INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number) VALUES(?1,?2,?3,'DEBIT',?4,1),(?5,?2,?6,'CREDIT',?4,2)",
            params![format!("{id}d"), id, food, amount, format!("{id}c"), cash],
        )
        .unwrap();
    }

    #[test]
    fn flags_same_payee_and_amount_within_the_window_ignoring_case_and_spacing() {
        with_db(|c| {
            add(
                c,
                "a",
                "home",
                "2026-11-02",
                "POSTED",
                Some("Amazon"),
                4_980,
            );
            add(
                c,
                "b",
                "home",
                "2026-11-04",
                "POSTED",
                Some("  amazon "),
                4_980,
            );
            let found = possible_duplicate_charges(c, "home", "2026-11", 1_000, 3, 10).unwrap();
            assert_eq!(found.len(), 1);
            assert_eq!(
                (
                    found[0].first_transaction_id.as_str(),
                    found[0].second_transaction_id.as_str()
                ),
                ("a", "b")
            );
            assert_eq!((found[0].amount_jpy, found[0].days_apart), (4_980, 2));
        });
    }

    #[test]
    fn does_not_flag_different_amounts_payees_or_dates_too_far_apart() {
        with_db(|c| {
            add(
                c,
                "a",
                "home",
                "2026-11-02",
                "POSTED",
                Some("Amazon"),
                4_980,
            );
            add(
                c,
                "b",
                "home",
                "2026-11-03",
                "POSTED",
                Some("Amazon"),
                4_981,
            );
            add(c, "c", "home", "2026-11-03", "POSTED", Some("楽天"), 4_980);
            add(
                c,
                "d",
                "home",
                "2026-11-20",
                "POSTED",
                Some("Amazon"),
                4_980,
            );
            assert!(
                possible_duplicate_charges(c, "home", "2026-11", 1_000, 3, 10)
                    .unwrap()
                    .is_empty()
            );
        });
    }

    #[test]
    fn ignores_small_amounts_drafts_voids_blank_payees_and_other_households() {
        with_db(|c| {
            add(c, "s1", "home", "2026-11-02", "POSTED", Some("カフェ"), 400);
            add(c, "s2", "home", "2026-11-02", "POSTED", Some("カフェ"), 400);
            add(c, "d1", "home", "2026-11-02", "POSTED", Some("店"), 3_000);
            add(c, "d2", "home", "2026-11-03", "DRAFT", Some("店"), 3_000);
            add(c, "v1", "home", "2026-11-05", "POSTED", Some("店2"), 3_000);
            add(c, "v2", "home", "2026-11-05", "VOID", Some("店2"), 3_000);
            add(c, "n1", "home", "2026-11-06", "POSTED", None, 3_000);
            add(c, "n2", "home", "2026-11-06", "POSTED", None, 3_000);
            add(c, "o1", "other", "2026-11-06", "POSTED", Some("X"), 3_000);
            add(c, "o2", "other", "2026-11-06", "POSTED", Some("X"), 3_000);
            assert!(
                possible_duplicate_charges(c, "home", "2026-11", 1_000, 3, 10)
                    .unwrap()
                    .is_empty()
            );
        });
    }

    #[test]
    fn a_pair_straddling_a_month_boundary_shows_in_either_month_and_same_day_pairs_are_ordered() {
        with_db(|c| {
            add(c, "a", "home", "2026-10-31", "POSTED", Some("電力"), 8_000);
            add(c, "b", "home", "2026-11-01", "POSTED", Some("電力"), 8_000);
            add(c, "x", "home", "2026-11-10", "POSTED", Some("店"), 9_000);
            add(c, "y", "home", "2026-11-10", "POSTED", Some("店"), 9_000);
            assert_eq!(
                possible_duplicate_charges(c, "home", "2026-10", 1_000, 3, 10)
                    .unwrap()
                    .len(),
                1
            );
            let nov = possible_duplicate_charges(c, "home", "2026-11", 1_000, 3, 10).unwrap();
            assert_eq!(nov.len(), 2);
            assert_eq!(nov[0].amount_jpy, 9_000);
            assert_eq!(
                (
                    nov[0].first_transaction_id.as_str(),
                    nov[0].second_transaction_id.as_str(),
                    nov[0].days_apart
                ),
                ("x", "y", 0)
            );
        });
    }

    #[test]
    fn validates_input() {
        with_db(|c| {
            assert!(possible_duplicate_charges(c, " ", "2026-11", 0, 3, 5).is_err());
            assert!(possible_duplicate_charges(c, "home", "2026-13", 0, 3, 5).is_err());
            assert!(possible_duplicate_charges(c, "home", "2026-11", -1, 3, 5).is_err());
            assert!(possible_duplicate_charges(c, "home", "2026-11", 0, 15, 5).is_err());
            assert!(possible_duplicate_charges(c, "home", "2026-11", 0, 3, 0).is_err());
            assert!(possible_duplicate_charges(c, "home", "2026-11", 0, 3, 51).is_err());
        });
    }
}
