//! Warranty list: what was bought, how long it is covered, and when the cover ends. Device-local and independent
//! of the ledger (see migration 0078).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_ROWS: i64 = 300;

#[derive(Debug, Error)]
pub enum WarrantyError {
    #[error("warranty database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("warranty input is invalid")]
    InvalidInput,
    #[error("warranty was not found")]
    NotFound,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WarrantyDto {
    pub id: String,
    pub household_id: String,
    pub item: String,
    pub store: String,
    pub purchased_on: String,
    pub warranty_months: i64,
    pub expires_on: String,
    pub amount_jpy: Option<i64>,
    pub note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarrantyInput {
    pub household_id: String,
    pub item: String,
    pub store: String,
    pub purchased_on: String,
    pub warranty_months: i64,
    pub amount_jpy: Option<i64>,
    pub note: String,
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        _ => 28,
    }
}

fn parse_date(value: &str) -> Option<(i32, u32, u32)> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year = value[..4].parse::<i32>().ok()?;
    let month = value[5..7].parse::<u32>().ok()?;
    let day = value[8..].parse::<u32>().ok()?;
    if year < 2000 || !(1..=12).contains(&month) || !(1..=days_in_month(year, month)).contains(&day)
    {
        return None;
    }
    Some((year, month, day))
}

/// The last day of cover: the purchase date plus the warranty length, clamped to the end of a shorter month.
fn expiry(purchased_on: &str, months: i64) -> Option<String> {
    let (year, month, day) = parse_date(purchased_on)?;
    let total = i64::from(year) * 12 + i64::from(month) - 1 + months;
    let (new_year, new_month) = (
        i32::try_from(total.div_euclid(12)).ok()?,
        (total.rem_euclid(12) + 1) as u32,
    );
    let new_day = day.min(days_in_month(new_year, new_month));
    Some(format!("{new_year:04}-{new_month:02}-{new_day:02}"))
}

fn valid_household(id: &str) -> bool {
    !id.trim().is_empty() && id.len() <= 128
}

const COLUMNS: &str =
    "id, household_id, item, store, purchased_on, warranty_months, expires_on, amount_jpy, note";

fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WarrantyDto> {
    Ok(WarrantyDto {
        id: row.get(0)?,
        household_id: row.get(1)?,
        item: row.get(2)?,
        store: row.get(3)?,
        purchased_on: row.get(4)?,
        warranty_months: row.get(5)?,
        expires_on: row.get(6)?,
        amount_jpy: row.get(7)?,
        note: row.get(8)?,
    })
}

/// Soonest-ending cover first (already-ended ones come first, which is where the eye should go).
pub fn list(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<WarrantyDto>, WarrantyError> {
    if !valid_household(household_id) {
        return Err(WarrantyError::InvalidInput);
    }
    let rows = connection
        .prepare(&format!(
            "SELECT {COLUMNS} FROM warranties WHERE household_id = ?1
              ORDER BY expires_on, created_at, id LIMIT ?2"
        ))?
        .query_map(params![household_id, MAX_ROWS], row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn create(
    connection: &Connection,
    input: &WarrantyInput,
) -> Result<WarrantyDto, WarrantyError> {
    let item = input.item.trim();
    let store = input.store.trim();
    let note = input.note.trim();
    let expires_on = expiry(&input.purchased_on, input.warranty_months);
    let Some(expires_on) = expires_on else {
        return Err(WarrantyError::InvalidInput);
    };
    if !valid_household(&input.household_id)
        || !(1..=120).contains(&item.chars().count())
        || store.chars().count() > 120
        || note.chars().count() > 500
        || !(1..=120).contains(&input.warranty_months)
        || input
            .amount_jpy
            .is_some_and(|amount| !(0..=100_000_000_000).contains(&amount))
    {
        return Err(WarrantyError::InvalidInput);
    }
    let id: String = connection.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
    connection.execute(
        "INSERT INTO warranties
           (id, household_id, item, store, purchased_on, warranty_months, expires_on, amount_jpy, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            input.household_id,
            item,
            store,
            input.purchased_on,
            input.warranty_months,
            expires_on,
            input.amount_jpy,
            note
        ],
    )?;
    Ok(WarrantyDto {
        id,
        household_id: input.household_id.clone(),
        item: item.to_owned(),
        store: store.to_owned(),
        purchased_on: input.purchased_on.clone(),
        warranty_months: input.warranty_months,
        expires_on,
        amount_jpy: input.amount_jpy,
        note: note.to_owned(),
    })
}

pub fn delete(connection: &Connection, household_id: &str, id: &str) -> Result<(), WarrantyError> {
    if !valid_household(household_id) || id.len() != 32 {
        return Err(WarrantyError::InvalidInput);
    }
    let existing: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM warranties WHERE id = ?1 AND household_id = ?2",
            params![id, household_id],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_none() {
        return Err(WarrantyError::NotFound);
    }
    connection.execute(
        "DELETE FROM warranties WHERE id = ?1 AND household_id = ?2",
        params![id, household_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    fn with_db(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(&[11_u8; 32]).expect("migrations");
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households (id, name) VALUES ('family', 'Family'), ('other', 'Other')",
                    [],
                )?;
                test(connection);
                Ok(())
            })
            .expect("test body");
    }

    fn input(item: &str, purchased_on: &str, months: i64) -> WarrantyInput {
        WarrantyInput {
            household_id: "family".into(),
            item: item.into(),
            store: "ヨドバシ".into(),
            purchased_on: purchased_on.into(),
            warranty_months: months,
            amount_jpy: Some(80_000),
            note: String::new(),
        }
    }

    #[test]
    fn expiry_adds_months_and_clamps_to_month_end() {
        assert_eq!(expiry("2026-11-20", 12).as_deref(), Some("2027-11-20"));
        assert_eq!(expiry("2026-01-31", 1).as_deref(), Some("2026-02-28"));
        assert_eq!(expiry("2023-12-31", 2).as_deref(), Some("2024-02-29"));
        assert_eq!(expiry("2026-11-20", 120).as_deref(), Some("2036-11-20"));
        assert_eq!(expiry("2026-02-30", 12), None);
        assert_eq!(expiry("garbage", 12), None);
    }

    #[test]
    fn list_orders_by_expiry_and_is_scoped_to_the_household() {
        with_db(|c| {
            let long = create(c, &input("冷蔵庫", "2026-01-10", 60)).unwrap();
            let short = create(c, &input("掃除機", "2026-06-01", 12)).unwrap();
            let ids: Vec<_> = list(c, "family")
                .unwrap()
                .into_iter()
                .map(|w| w.id)
                .collect();
            assert_eq!(ids, [short.id.clone(), long.id.clone()]);
            assert_eq!(short.expires_on, "2027-06-01");
            assert!(list(c, "other").unwrap().is_empty());
        });
    }

    #[test]
    fn delete_is_scoped_and_removes_the_entry() {
        with_db(|c| {
            let w = create(c, &input("TV", "2026-05-05", 24)).unwrap();
            assert!(matches!(
                delete(c, "other", &w.id),
                Err(WarrantyError::NotFound)
            ));
            delete(c, "family", &w.id).unwrap();
            assert!(list(c, "family").unwrap().is_empty());
        });
    }

    #[test]
    fn rejects_invalid_input() {
        with_db(|c| {
            assert!(create(c, &input("  ", "2026-05-05", 12)).is_err());
            assert!(create(c, &input("x", "2026-05-05", 0)).is_err());
            assert!(create(c, &input("x", "2026-05-05", 121)).is_err());
            assert!(create(c, &input("x", "2026-13-05", 12)).is_err());
            let mut negative = input("x", "2026-05-05", 12);
            negative.amount_jpy = Some(-1);
            assert!(create(c, &negative).is_err());
            let mut long = input("x", "2026-05-05", 12);
            long.note = "あ".repeat(501);
            assert!(create(c, &long).is_err());
            assert!(list(c, "").is_err());
            assert!(create(c, &input("x", "2026-05-05", 12)).is_ok());
        });
    }

    #[test]
    fn the_table_is_device_local_with_no_sync_capture_trigger() {
        with_db(|c| {
            let triggers: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='warranties'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(triggers, 0);
        });
    }
}
