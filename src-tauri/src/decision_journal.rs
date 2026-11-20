//! Decision journal: a big decision written down with its reason and expectation, and later reviewed against
//! what actually happened. Device-local and independent of the ledger (see migration 0077).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_UNREVIEWED: i64 = 200;
const MAX_REVIEWED: i64 = 30;

#[derive(Debug, Error)]
pub enum DecisionJournalError {
    #[error("decision journal database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("decision journal input is invalid")]
    InvalidInput,
    #[error("decision was not found")]
    NotFound,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DecisionDto {
    pub id: String,
    pub household_id: String,
    pub decided_on: String,
    pub title: String,
    pub amount_jpy: Option<i64>,
    pub reason: String,
    pub expectation: String,
    pub review_on: String,
    pub outcome: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionInput {
    pub household_id: String,
    pub decided_on: String,
    pub title: String,
    pub amount_jpy: Option<i64>,
    pub reason: String,
    pub expectation: String,
    pub review_on: String,
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

const COLUMNS: &str =
    "id, household_id, decided_on, title, amount_jpy, reason, expectation, review_on, outcome";

fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DecisionDto> {
    Ok(DecisionDto {
        id: row.get(0)?,
        household_id: row.get(1)?,
        decided_on: row.get(2)?,
        title: row.get(3)?,
        amount_jpy: row.get(4)?,
        reason: row.get(5)?,
        expectation: row.get(6)?,
        review_on: row.get(7)?,
        outcome: row.get(8)?,
    })
}

/// Decisions still waiting for a review (soonest review first), then the most recently reviewed ones.
pub fn list(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<DecisionDto>, DecisionJournalError> {
    if !valid_household(household_id) {
        return Err(DecisionJournalError::InvalidInput);
    }
    let mut decisions = connection
        .prepare(&format!(
            "SELECT {COLUMNS} FROM decision_journal
              WHERE household_id = ?1 AND outcome IS NULL
              ORDER BY review_on, created_at, id LIMIT ?2"
        ))?
        .query_map(params![household_id, MAX_UNREVIEWED], row)?
        .collect::<Result<Vec<_>, _>>()?;
    let reviewed = connection
        .prepare(&format!(
            "SELECT {COLUMNS} FROM decision_journal
              WHERE household_id = ?1 AND outcome IS NOT NULL
              ORDER BY reviewed_at DESC, id LIMIT ?2"
        ))?
        .query_map(params![household_id, MAX_REVIEWED], row)?
        .collect::<Result<Vec<_>, _>>()?;
    decisions.extend(reviewed);
    Ok(decisions)
}

pub fn create(
    connection: &Connection,
    input: &DecisionInput,
) -> Result<DecisionDto, DecisionJournalError> {
    let title = input.title.trim();
    let reason = input.reason.trim();
    let expectation = input.expectation.trim();
    if !valid_household(&input.household_id)
        || !valid_date(&input.decided_on)
        || !valid_date(&input.review_on)
        || input.review_on < input.decided_on
        || !(1..=120).contains(&title.chars().count())
        || reason.chars().count() > 1000
        || expectation.chars().count() > 1000
        || input
            .amount_jpy
            .is_some_and(|amount| !(0..=100_000_000_000).contains(&amount))
    {
        return Err(DecisionJournalError::InvalidInput);
    }
    let id: String = connection.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
    connection.execute(
        "INSERT INTO decision_journal
           (id, household_id, decided_on, title, amount_jpy, reason, expectation, review_on)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            input.household_id,
            input.decided_on,
            title,
            input.amount_jpy,
            reason,
            expectation,
            input.review_on
        ],
    )?;
    Ok(DecisionDto {
        id,
        household_id: input.household_id.clone(),
        decided_on: input.decided_on.clone(),
        title: title.to_owned(),
        amount_jpy: input.amount_jpy,
        reason: reason.to_owned(),
        expectation: expectation.to_owned(),
        review_on: input.review_on.clone(),
        outcome: None,
    })
}

/// Writes what actually happened. A decision is reviewed once; to change the note, delete and re-enter it.
pub fn record_outcome(
    connection: &Connection,
    household_id: &str,
    id: &str,
    outcome: &str,
) -> Result<(), DecisionJournalError> {
    let outcome = outcome.trim();
    if !valid_household(household_id)
        || id.len() != 32
        || !(1..=1000).contains(&outcome.chars().count())
    {
        return Err(DecisionJournalError::InvalidInput);
    }
    let changed = connection.execute(
        "UPDATE decision_journal
            SET outcome = ?3, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?1 AND household_id = ?2 AND outcome IS NULL",
        params![id, household_id, outcome],
    )?;
    if changed == 0 {
        return Err(DecisionJournalError::NotFound);
    }
    Ok(())
}

pub fn delete(
    connection: &Connection,
    household_id: &str,
    id: &str,
) -> Result<(), DecisionJournalError> {
    if !valid_household(household_id) || id.len() != 32 {
        return Err(DecisionJournalError::InvalidInput);
    }
    let existing: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM decision_journal WHERE id = ?1 AND household_id = ?2",
            params![id, household_id],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_none() {
        return Err(DecisionJournalError::NotFound);
    }
    connection.execute(
        "DELETE FROM decision_journal WHERE id = ?1 AND household_id = ?2",
        params![id, household_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    fn with_db(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(&[10_u8; 32]).expect("migrations");
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

    fn input(title: &str, review_on: &str) -> DecisionInput {
        DecisionInput {
            household_id: "family".into(),
            decided_on: "2026-11-20".into(),
            title: title.into(),
            amount_jpy: Some(1_200_000),
            reason: "古くなった".into(),
            expectation: "10年使える".into(),
            review_on: review_on.into(),
        }
    }

    #[test]
    fn unreviewed_decisions_list_by_review_date_then_reviewed_ones() {
        with_db(|c| {
            let late = create(c, &input("車", "2027-11-20")).unwrap();
            let soon = create(c, &input("エアコン", "2027-05-01")).unwrap();
            let done = create(c, &input("PC", "2027-01-01")).unwrap();
            record_outcome(c, "family", &done.id, "満足している").unwrap();
            let listed = list(c, "family").unwrap();
            let ids: Vec<_> = listed.iter().map(|d| d.id.as_str()).collect();
            assert_eq!(ids, [soon.id.as_str(), late.id.as_str(), done.id.as_str()]);
            assert_eq!(listed[2].outcome.as_deref(), Some("満足している"));
            assert!(listed[0].outcome.is_none());
        });
    }

    #[test]
    fn an_outcome_can_be_written_only_once_and_only_by_its_household() {
        with_db(|c| {
            let d = create(c, &input("車", "2027-11-20")).unwrap();
            assert!(matches!(
                record_outcome(c, "other", &d.id, "x"),
                Err(DecisionJournalError::NotFound)
            ));
            record_outcome(c, "family", &d.id, "よかった").unwrap();
            assert!(matches!(
                record_outcome(c, "family", &d.id, "やっぱり"),
                Err(DecisionJournalError::NotFound)
            ));
            assert!(matches!(
                record_outcome(c, "family", &d.id, "  "),
                Err(DecisionJournalError::InvalidInput)
            ));
        });
    }

    #[test]
    fn delete_is_scoped_and_removes_the_entry() {
        with_db(|c| {
            let d = create(c, &input("車", "2027-11-20")).unwrap();
            assert!(list(c, "other").unwrap().is_empty());
            assert!(matches!(
                delete(c, "other", &d.id),
                Err(DecisionJournalError::NotFound)
            ));
            delete(c, "family", &d.id).unwrap();
            assert!(list(c, "family").unwrap().is_empty());
        });
    }

    #[test]
    fn rejects_invalid_input() {
        with_db(|c| {
            assert!(create(c, &input("  ", "2027-11-20")).is_err());
            assert!(create(c, &input(&"あ".repeat(121), "2027-11-20")).is_err());
            assert!(create(c, &input("x", "2026-11-19")).is_err());
            assert!(create(c, &input("x", "2027-02-30")).is_err());
            let mut long = input("x", "2027-11-20");
            long.reason = "あ".repeat(1001);
            assert!(create(c, &long).is_err());
            let mut negative = input("x", "2027-11-20");
            negative.amount_jpy = Some(-1);
            assert!(create(c, &negative).is_err());
            let mut bad = input("x", "2027-11-20");
            bad.household_id = String::new();
            assert!(create(c, &bad).is_err());
            assert!(list(c, "").is_err());
            assert!(create(c, &input("x", "2026-11-20")).is_ok());
        });
    }

    #[test]
    fn the_table_is_device_local_with_no_sync_capture_trigger() {
        with_db(|c| {
            let triggers: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='decision_journal'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(triggers, 0);
        });
    }
}
