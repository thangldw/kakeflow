//! Month-by-month spending per expense category over a trailing window — the real history a "what if I had
//! spent less on X" calculation is applied to. Read-only; whole household, posted transactions that count
//! toward calculations. Refunds net against the category they were booked to.

use std::collections::BTreeMap;

use rusqlite::{params, Connection};
use serde::Serialize;
use thiserror::Error;

const MAX_MONTHS: u32 = 24;
const MAX_CATEGORIES: usize = 200;

#[derive(Debug, Error)]
pub enum CategoryHistoryError {
    #[error("category history database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("category history request is invalid")]
    InvalidRequest,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryHistoryRowDto {
    pub account_id: String,
    pub name: String,
    /// One amount per entry of `months`, oldest first; 0 where the category had no activity.
    pub monthly_jpy: Vec<i64>,
    pub total_jpy: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryHistoryDto {
    pub months: Vec<String>,
    /// Largest total first.
    pub categories: Vec<CategoryHistoryRowDto>,
}

fn parse_month(value: &str) -> Option<(i32, u32)> {
    let bytes = value.as_bytes();
    if bytes.len() != 7 || bytes[4] != b'-' {
        return None;
    }
    let year: i32 = value[..4].parse().ok()?;
    let month: u32 = value[5..].parse().ok()?;
    ((2000..=2100).contains(&year) && (1..=12).contains(&month)).then_some((year, month))
}

fn month_list(through: (i32, u32), count: u32) -> Vec<String> {
    let (mut year, mut month) = through;
    let mut months = Vec::with_capacity(count as usize);
    for _ in 0..count {
        months.push(format!("{year:04}-{month:02}"));
        if month == 1 {
            year -= 1;
            month = 12;
        } else {
            month -= 1;
        }
    }
    months.reverse();
    months
}

pub fn category_history(
    connection: &Connection,
    household_id: &str,
    through_month: &str,
    months: u32,
) -> Result<CategoryHistoryDto, CategoryHistoryError> {
    let through = parse_month(through_month).ok_or(CategoryHistoryError::InvalidRequest)?;
    if household_id.trim().is_empty()
        || household_id.len() > 128
        || !(1..=MAX_MONTHS).contains(&months)
    {
        return Err(CategoryHistoryError::InvalidRequest);
    }
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
    let mut statement = connection.prepare(
        "SELECT substr(t.occurred_on, 1, 7), a.id, a.name,
                SUM(CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END)
           FROM transactions t
           JOIN journal_entries je ON je.transaction_id = t.id
           JOIN accounts a ON a.id = je.account_id AND a.account_kind = 'EXPENSE'
          WHERE t.household_id = ?1 AND t.status = 'POSTED' AND t.calculation_target = 1
            AND t.occurred_on >= ?2 AND t.occurred_on < ?3
          GROUP BY substr(t.occurred_on, 1, 7), a.id, a.name",
    )?;
    let rows = statement
        .query_map(params![household_id, first, after], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut by_account: BTreeMap<String, CategoryHistoryRowDto> = BTreeMap::new();
    for (month, id, name, amount) in rows {
        let Some(position) = labels.iter().position(|label| *label == month) else {
            continue;
        };
        let entry = by_account
            .entry(id.clone())
            .or_insert_with(|| CategoryHistoryRowDto {
                account_id: id,
                name,
                monthly_jpy: vec![0; labels.len()],
                total_jpy: 0,
            });
        entry.monthly_jpy[position] += amount;
        entry.total_jpy += amount;
    }
    let mut categories: Vec<_> = by_account.into_values().collect();
    categories.sort_by(|left, right| {
        right
            .total_jpy
            .cmp(&left.total_jpy)
            .then_with(|| left.name.cmp(&right.name))
    });
    categories.truncate(MAX_CATEGORIES);
    Ok(CategoryHistoryDto {
        months: labels,
        categories,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    fn with_db(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(&[5_u8; 32]).expect("migrations");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('home','Home'),('other','Other');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES
                       ('cash','home','現金','ASSET','CASH'),
                       ('food','home','食費','EXPENSE','OTHER'),
                       ('fun','home','娯楽','EXPENSE','OTHER');",
                )?;
                test(connection);
                Ok(())
            })
            .expect("body");
    }

    fn add(connection: &Connection, id: &str, row: (&str, &str, &str, i64, &str, i64)) {
        let (household, date, status, target, account, amount) = row;
        connection
            .execute(
                "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status,calculation_target)
                 VALUES(?1,?2,?3,'EXPENSE',?4,?5)",
                params![id, household, date, status, target],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                 VALUES(?1,?2,?3,'DEBIT',?4,1),(?5,?2,'cash','CREDIT',?4,2)",
                params![format!("{id}d"), id, account, amount, format!("{id}c")],
            )
            .unwrap();
    }

    #[test]
    fn totals_each_category_per_month_oldest_first_and_orders_by_total() {
        with_db(|c| {
            add(c, "a", ("home", "2026-09-10", "POSTED", 1, "food", 1000));
            add(c, "b", ("home", "2026-09-20", "POSTED", 1, "food", 500));
            add(c, "c", ("home", "2026-11-02", "POSTED", 1, "food", 700));
            add(c, "d", ("home", "2026-10-05", "POSTED", 1, "fun", 3000));
            let history = category_history(c, "home", "2026-11", 3).unwrap();
            assert_eq!(history.months, ["2026-09", "2026-10", "2026-11"]);
            assert_eq!(history.categories[0].name, "娯楽");
            assert_eq!(history.categories[0].monthly_jpy, [0, 3000, 0]);
            assert_eq!(history.categories[1].monthly_jpy, [1500, 0, 700]);
            assert_eq!(history.categories[1].total_jpy, 2200);
        });
    }

    #[test]
    fn ignores_drafts_voids_excluded_transactions_other_households_and_out_of_window() {
        with_db(|c| {
            add(c, "a", ("home", "2026-11-02", "DRAFT", 1, "food", 100));
            add(c, "b", ("home", "2026-11-03", "VOID", 1, "food", 100));
            add(c, "c", ("home", "2026-11-04", "POSTED", 0, "food", 100));
            add(c, "d", ("other", "2026-11-05", "POSTED", 1, "food", 100));
            add(c, "e", ("home", "2026-08-31", "POSTED", 1, "food", 100));
            add(c, "f", ("home", "2026-12-01", "POSTED", 1, "food", 100));
            let history = category_history(c, "home", "2026-11", 2).unwrap();
            assert!(history.categories.is_empty());
        });
    }

    #[test]
    fn the_window_crosses_a_year_boundary() {
        with_db(|c| {
            add(c, "a", ("home", "2025-12-15", "POSTED", 1, "food", 400));
            let history = category_history(c, "home", "2026-02", 3).unwrap();
            assert_eq!(history.months, ["2025-12", "2026-01", "2026-02"]);
            assert_eq!(history.categories[0].monthly_jpy, [400, 0, 0]);
        });
    }

    #[test]
    fn rejects_invalid_requests() {
        with_db(|c| {
            assert!(category_history(c, "home", "2026-13", 3).is_err());
            assert!(category_history(c, "home", "26-11", 3).is_err());
            assert!(category_history(c, "home", "2026-11", 0).is_err());
            assert!(category_history(c, "home", "2026-11", 25).is_err());
            assert!(category_history(c, " ", "2026-11", 3).is_err());
        });
    }
}
