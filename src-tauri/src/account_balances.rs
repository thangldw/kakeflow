//! The balance the ledger says each cash-like account holds on a date, so it can be compared by hand with the
//! balance the bank, wallet or purse really shows. A difference is a prompt to look for a missing, duplicated or
//! mistyped transaction; this module only reports the ledger side and changes nothing.

use rusqlite::{params, Connection};
use serde::Serialize;
use thiserror::Error;

const MAX_ACCOUNTS: i64 = 200;

#[derive(Debug, Error)]
pub enum AccountBalanceError {
    #[error("account balance database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("account balance request is invalid")]
    InvalidRequest,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountBalanceDto {
    pub account_id: String,
    pub name: String,
    pub subtype: String,
    pub balance_jpy: i64,
}

fn valid_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
        && matches!(
            &date[5..7],
            "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12"
        )
        && matches!(date[8..].parse::<u32>(), Ok(1..=31))
}

/// Ledger balance (debits minus credits of posted entries dated on or before `as_of`) for each open bank, cash
/// and wallet account of the household, in name order.
pub fn ledger_balances(
    connection: &Connection,
    household_id: &str,
    as_of: &str,
) -> Result<Vec<AccountBalanceDto>, AccountBalanceError> {
    if household_id.trim().is_empty() || household_id.len() > 128 || !valid_date(as_of) {
        return Err(AccountBalanceError::InvalidRequest);
    }
    let rows = connection
        .prepare(
            "SELECT a.id, a.name, a.account_subtype,
                    COALESCE(SUM(CASE WHEN t.id IS NULL THEN 0
                                      WHEN je.entry_side = 'DEBIT' THEN je.amount_jpy
                                      ELSE -je.amount_jpy END), 0)
               FROM accounts a
               LEFT JOIN journal_entries je ON je.account_id = a.id
               LEFT JOIN transactions t ON t.id = je.transaction_id
                    AND t.status = 'POSTED' AND t.occurred_on <= ?2
              WHERE a.household_id = ?1 AND a.is_archived = 0 AND a.account_kind = 'ASSET'
                AND a.account_subtype IN ('BANK', 'CASH', 'WALLET')
              GROUP BY a.id
              ORDER BY a.name, a.id LIMIT ?3",
        )?
        .query_map(params![household_id, as_of, MAX_ACCOUNTS], |row| {
            Ok(AccountBalanceDto {
                account_id: row.get(0)?,
                name: row.get(1)?,
                subtype: row.get(2)?,
                balance_jpy: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    fn with_db(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(&[9_u8; 32]).expect("migrations");
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('home','Home'),('other','Other');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES
                       ('bank','home','銀行','ASSET','BANK'),('cash','home','現金','ASSET','CASH'),
                       ('empty','home','空の財布','ASSET','WALLET'),
                       ('sec','home','証券','ASSET','SECURITIES'),('card','home','カード','LIABILITY','CREDIT_CARD'),
                       ('food','home','食費','EXPENSE','OTHER'),('pay','home','給与','INCOME','OTHER'),
                       ('obank','other','他銀行','ASSET','BANK');
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,is_archived)
                       VALUES('old','home','閉鎖','ASSET','BANK',1);",
                )?;
                test(connection);
                Ok(())
            })
            .expect("body");
    }

    fn add(c: &Connection, id: &str, date: &str, status: &str, lines: &[(&str, &str, i64)]) {
        c.execute(
            "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status) VALUES(?1,'home',?2,'EXPENSE',?3)",
            params![id, date, status],
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
    fn sums_posted_entries_up_to_the_date_for_open_cash_like_accounts_only() {
        with_db(|c| {
            add(
                c,
                "salary",
                "2026-11-01",
                "POSTED",
                &[("bank", "DEBIT", 300_000), ("pay", "CREDIT", 300_000)],
            );
            add(
                c,
                "food",
                "2026-11-05",
                "POSTED",
                &[("food", "DEBIT", 4_000), ("bank", "CREDIT", 4_000)],
            );
            add(
                c,
                "later",
                "2026-11-25",
                "POSTED",
                &[("food", "DEBIT", 9_000), ("bank", "CREDIT", 9_000)],
            );
            add(
                c,
                "draft",
                "2026-11-06",
                "DRAFT",
                &[("food", "DEBIT", 7_000), ("bank", "CREDIT", 7_000)],
            );
            add(
                c,
                "void",
                "2026-11-07",
                "VOID",
                &[("food", "DEBIT", 6_000), ("bank", "CREDIT", 6_000)],
            );
            add(
                c,
                "wd",
                "2026-11-08",
                "POSTED",
                &[("cash", "DEBIT", 10_000), ("bank", "CREDIT", 10_000)],
            );
            let balances = ledger_balances(c, "home", "2026-11-20").unwrap();
            let get = |id: &str| {
                balances
                    .iter()
                    .find(|b| b.account_id == id)
                    .map(|b| b.balance_jpy)
            };
            assert_eq!(get("bank"), Some(300_000 - 4_000 - 10_000));
            assert_eq!(get("cash"), Some(10_000));
            assert_eq!(get("empty"), Some(0));
            for excluded in ["sec", "card", "food", "pay", "old", "obank"] {
                assert_eq!(get(excluded), None, "{excluded}");
            }
            assert_eq!(
                balances.iter().map(|b| b.name.as_str()).collect::<Vec<_>>(),
                ["現金", "空の財布", "銀行"]
            );
            assert_eq!(
                ledger_balances(c, "home", "2026-12-31")
                    .unwrap()
                    .iter()
                    .find(|b| b.account_id == "bank")
                    .unwrap()
                    .balance_jpy,
                300_000 - 4_000 - 10_000 - 9_000
            );
        });
    }

    #[test]
    fn validates_input() {
        with_db(|c| {
            assert!(ledger_balances(c, " ", "2026-11-20").is_err());
            assert!(ledger_balances(c, "home", "2026-13-20").is_err());
            assert!(ledger_balances(c, "home", "2026-11-1").is_err());
            assert!(ledger_balances(c, "home", "2026-11-40").is_err());
            assert!(ledger_balances(c, "nope", "2026-11-20").unwrap().is_empty());
        });
    }
}
