//! Payment reminders: a bill's deadline the user confirmed, with an optional amount.
//!
//! Device-local and independent of the ledger (see migration 0075). Open reminders are listed soonest first, and
//! the most recent finished ones stay visible briefly so a mistaken tick can be undone.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_LISTED: i64 = 200;
const MAX_DONE_LISTED: i64 = 20;

#[derive(Debug, Error)]
pub enum PaymentReminderError {
    #[error("payment reminder database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("payment reminder input is invalid")]
    InvalidInput,
    #[error("payment reminder was not found")]
    NotFound,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentReminderDto {
    pub id: String,
    pub household_id: String,
    pub due_on: String,
    pub label: String,
    pub amount_jpy: Option<i64>,
    pub done: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentReminderInput {
    pub household_id: String,
    pub due_on: String,
    pub label: String,
    pub amount_jpy: Option<i64>,
}

fn valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        value[..4].parse::<i32>(),
        value[5..7].parse::<u32>(),
        value[8..].parse::<u32>(),
    ) else {
        return false;
    };
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    year >= 2000 && (1..=days).contains(&day)
}

fn valid_household(id: &str) -> bool {
    !id.trim().is_empty() && id.len() <= 128
}

fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PaymentReminderDto> {
    Ok(PaymentReminderDto {
        id: row.get(0)?,
        household_id: row.get(1)?,
        due_on: row.get(2)?,
        label: row.get(3)?,
        amount_jpy: row.get(4)?,
        done: row.get::<_, String>(5)? == "DONE",
    })
}

const COLUMNS: &str = "id, household_id, due_on, label, amount_jpy, status";

/// Open reminders soonest first, then the most recently finished ones.
pub fn list(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<PaymentReminderDto>, PaymentReminderError> {
    if !valid_household(household_id) {
        return Err(PaymentReminderError::InvalidInput);
    }
    let mut reminders = connection
        .prepare(&format!(
            "SELECT {COLUMNS} FROM payment_reminders
              WHERE household_id = ?1 AND status = 'OPEN'
              ORDER BY due_on, created_at, id LIMIT ?2"
        ))?
        .query_map(params![household_id, MAX_LISTED], row)?
        .collect::<Result<Vec<_>, _>>()?;
    let done = connection
        .prepare(&format!(
            "SELECT {COLUMNS} FROM payment_reminders
              WHERE household_id = ?1 AND status = 'DONE'
              ORDER BY done_at DESC, id LIMIT ?2"
        ))?
        .query_map(params![household_id, MAX_DONE_LISTED], row)?
        .collect::<Result<Vec<_>, _>>()?;
    reminders.extend(done);
    Ok(reminders)
}

pub fn create(
    connection: &Connection,
    input: &PaymentReminderInput,
) -> Result<PaymentReminderDto, PaymentReminderError> {
    let label = input.label.trim();
    let label_units = label.chars().count();
    if !valid_household(&input.household_id)
        || !valid_date(&input.due_on)
        || !(1..=200).contains(&label_units)
        || input
            .amount_jpy
            .is_some_and(|amount| !(0..=100_000_000_000).contains(&amount))
    {
        return Err(PaymentReminderError::InvalidInput);
    }
    let id: String = connection.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
    connection.execute(
        "INSERT INTO payment_reminders (id, household_id, due_on, label, amount_jpy)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id,
            input.household_id,
            input.due_on,
            label,
            input.amount_jpy
        ],
    )?;
    Ok(PaymentReminderDto {
        id,
        household_id: input.household_id.clone(),
        due_on: input.due_on.clone(),
        label: label.to_owned(),
        amount_jpy: input.amount_jpy,
        done: false,
    })
}

/// Marks a reminder paid, or open again.
pub fn set_done(
    connection: &Connection,
    household_id: &str,
    id: &str,
    done: bool,
) -> Result<(), PaymentReminderError> {
    if !valid_household(household_id) || id.len() != 32 {
        return Err(PaymentReminderError::InvalidInput);
    }
    let changed = connection.execute(
        "UPDATE payment_reminders
            SET status = ?3,
                done_at = CASE WHEN ?3 = 'DONE' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END
          WHERE id = ?1 AND household_id = ?2",
        params![id, household_id, if done { "DONE" } else { "OPEN" }],
    )?;
    if changed == 0 {
        return Err(PaymentReminderError::NotFound);
    }
    Ok(())
}

pub fn delete(
    connection: &Connection,
    household_id: &str,
    id: &str,
) -> Result<(), PaymentReminderError> {
    if !valid_household(household_id) || id.len() != 32 {
        return Err(PaymentReminderError::InvalidInput);
    }
    let existing: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM payment_reminders WHERE id = ?1 AND household_id = ?2",
            params![id, household_id],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_none() {
        return Err(PaymentReminderError::NotFound);
    }
    connection.execute(
        "DELETE FROM payment_reminders WHERE id = ?1 AND household_id = ?2",
        params![id, household_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    fn with_db(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(&[9_u8; 32]).expect("migrations");
        state
            .with_connection(|connection| {
                connection
                    .execute("INSERT INTO households (id, name) VALUES ('family', 'Family'), ('other', 'Other')", [])?;
                test(connection);
                Ok(())
            })
            .expect("test body");
    }

    fn input(label: &str, due_on: &str, amount: Option<i64>) -> PaymentReminderInput {
        PaymentReminderInput {
            household_id: "family".into(),
            due_on: due_on.into(),
            label: label.into(),
            amount_jpy: amount,
        }
    }

    #[test]
    fn open_reminders_list_soonest_first_and_finished_ones_follow() {
        with_db(|c| {
            let late = create(c, &input("電気代", "2026-12-25", Some(8200))).unwrap();
            let early = create(c, &input("カード", "2026-12-10", None)).unwrap();
            let paid = create(c, &input("水道", "2026-11-30", Some(3000))).unwrap();
            set_done(c, "family", &paid.id, true).unwrap();
            let listed = list(c, "family").unwrap();
            let ids: Vec<_> = listed.iter().map(|r| r.id.as_str()).collect();
            assert_eq!(ids, [early.id.as_str(), late.id.as_str(), paid.id.as_str()]);
            assert!(!listed[0].done && listed[2].done);
        });
    }

    #[test]
    fn a_finished_reminder_can_be_reopened() {
        with_db(|c| {
            let reminder = create(c, &input("電気代", "2026-12-25", None)).unwrap();
            set_done(c, "family", &reminder.id, true).unwrap();
            assert!(list(c, "family").unwrap()[0].done);
            set_done(c, "family", &reminder.id, false).unwrap();
            assert!(!list(c, "family").unwrap()[0].done);
        });
    }

    #[test]
    fn reminders_are_scoped_to_their_household() {
        with_db(|c| {
            let reminder = create(c, &input("電気代", "2026-12-25", None)).unwrap();
            assert!(list(c, "other").unwrap().is_empty());
            assert!(matches!(
                set_done(c, "other", &reminder.id, true),
                Err(PaymentReminderError::NotFound)
            ));
            assert!(matches!(
                delete(c, "other", &reminder.id),
                Err(PaymentReminderError::NotFound)
            ));
            delete(c, "family", &reminder.id).unwrap();
            assert!(list(c, "family").unwrap().is_empty());
        });
    }

    #[test]
    fn rejects_invalid_input() {
        with_db(|c| {
            assert!(create(c, &input("   ", "2026-12-25", None)).is_err());
            assert!(create(c, &input(&"あ".repeat(201), "2026-12-25", None)).is_err());
            assert!(create(c, &input("x", "2026-02-30", None)).is_err());
            assert!(create(c, &input("x", "2026-13-01", None)).is_err());
            assert!(create(c, &input("x", "26-12-25", None)).is_err());
            assert!(create(c, &input("x", "2026-12-25", Some(-1))).is_err());
            assert!(create(c, &input("x", "2026-12-25", Some(100_000_000_001))).is_err());
            let mut bad = input("x", "2026-12-25", None);
            bad.household_id = String::new();
            assert!(create(c, &bad).is_err());
            assert!(list(c, "").is_err());
            assert!(create(c, &input("x", "2024-02-29", None)).is_ok());
        });
    }

    #[test]
    fn the_table_is_device_local_with_no_sync_capture_trigger() {
        with_db(|c| {
            let captured: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='payment_reminders'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(captured, 0);
        });
    }
}
