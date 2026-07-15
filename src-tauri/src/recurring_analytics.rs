use crate::record_scope::{validate_attribution_scope, AttributionScope};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

const HISTORY_DAYS: i64 = 366;
const RECENT_ANOMALY_DAYS: i64 = 31;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialIntelligenceRequest {
    pub household_id: String,
    pub as_of: String,
    #[serde(default)]
    pub account_group_id: Option<String>,
    #[serde(default)]
    pub attribution_scope: AttributionScope,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FinancialIntelligenceDto {
    pub as_of: String,
    pub history_from: String,
    pub recurring_items: Vec<RecurringItemDto>,
    pub ignored_recurring_items: Vec<RecurringItemDto>,
    pub anomalies: Vec<SpendingAnomalyDto>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecurringDecisionStatus {
    AutoDetected,
    Confirmed,
    Ignored,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringItemDto {
    pub normalized_payee: String,
    pub display_payee: String,
    pub occurrence_count: u32,
    pub cadence: String,
    pub median_interval_days: u32,
    pub typical_amount_jpy: i64,
    pub latest_amount_jpy: i64,
    pub last_seen_on: String,
    pub next_expected_on: String,
    pub confidence_bps: u16,
    pub price_change_bps: Option<i32>,
    pub decision_status: RecurringDecisionStatus,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecurringPreferenceDecision {
    Confirmed,
    Ignored,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringSeriesPreferenceDto {
    pub household_id: String,
    pub normalized_payee: String,
    pub decision: RecurringPreferenceDecision,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpsertRecurringSeriesPreferenceInput {
    pub household_id: String,
    pub normalized_payee: String,
    pub decision: RecurringPreferenceDecision,
    #[serde(default)]
    pub expected_version: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteRecurringSeriesPreferenceInput {
    pub household_id: String,
    pub normalized_payee: String,
    pub expected_version: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpendingAnomalyDto {
    pub transaction_id: String,
    pub occurred_on: String,
    pub normalized_payee: String,
    pub display_payee: String,
    pub amount_jpy: i64,
    pub baseline_amount_jpy: i64,
    pub baseline_sample_count: u32,
    pub score_bps: u16,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone)]
struct ExpenseObservation {
    transaction_id: String,
    occurred_on: String,
    day: i64,
    normalized_payee: String,
    display_payee: String,
    amount_jpy: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct StableRecurringPattern {
    pub cadence: &'static str,
    pub median_interval_days: i64,
    pub typical_amount_jpy: i64,
    pub confidence_bps: u16,
    pub reasons: Vec<String>,
}

pub fn query_financial_intelligence(
    connection: &Connection,
    request: &FinancialIntelligenceRequest,
) -> Result<FinancialIntelligenceDto, String> {
    if request.household_id.trim().is_empty() || request.household_id.len() > 64 {
        return Err("Household is required".to_owned());
    }
    let as_of_day = parse_iso_day(&request.as_of).ok_or_else(|| "Invalid as-of date".to_owned())?;
    let history_from = format_iso_day(as_of_day - HISTORY_DAYS);
    crate::account_groups_export::validate_account_group_scope(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
    )
    .map_err(|error| error.public_message().to_owned())?;
    validate_attribution_scope(
        connection,
        &request.household_id,
        &request.attribution_scope,
    )
    .map_err(|error| error.to_string())?;

    let mut statement = connection
        .prepare(
            "SELECT t.id, t.occurred_on, COALESCE(NULLIF(TRIM(t.payee), ''), \
                    NULLIF(TRIM(t.description), ''), 'Unknown'), SUM(e.amount_jpy) \
             FROM transactions t \
             JOIN journal_entries e ON e.transaction_id = t.id AND e.entry_side = 'DEBIT' \
             JOIN accounts a ON a.id = e.account_id AND a.account_kind = 'EXPENSE' \
             WHERE t.household_id = ?1 AND t.status = 'POSTED' \
               AND t.calculation_target = 1 \
               AND t.transaction_type IN ('EXPENSE', 'CARD_PURCHASE') \
               AND t.occurred_on >= ?2 AND t.occurred_on <= ?3 \
               AND (?4 IS NULL OR EXISTS ( \
                    SELECT 1 FROM journal_entries scope_je \
                    JOIN account_group_members scope_gm \
                      ON scope_gm.account_id = scope_je.account_id \
                     AND scope_gm.household_id = t.household_id \
                    WHERE scope_je.transaction_id = t.id \
                      AND scope_gm.account_group_id = ?4)) \
               AND (?5 = 'ALL' \
                    OR (?5 = 'HOUSEHOLD_COMMON' AND t.attribution_kind = 'HOUSEHOLD') \
                    OR (?5 = 'MEMBER' AND t.attribution_kind = 'MEMBER' \
                        AND t.attributed_member_id = ?6)) \
             GROUP BY t.id, t.occurred_on, t.payee, t.description \
             HAVING SUM(e.amount_jpy) > 0 \
             ORDER BY t.occurred_on, t.id",
        )
        .map_err(|_| "Financial intelligence is temporarily unavailable".to_owned())?;
    let rows = statement
        .query_map(
            params![
                request.household_id,
                history_from,
                request.as_of,
                request.account_group_id,
                request.attribution_scope.sql_kind(),
                request.attribution_scope.member_id()
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|_| "Financial intelligence is temporarily unavailable".to_owned())?;

    let mut observations = Vec::new();
    for row in rows {
        let (transaction_id, occurred_on, display_payee, amount_jpy) =
            row.map_err(|_| "Financial intelligence is temporarily unavailable".to_owned())?;
        let Some(day) = parse_iso_day(&occurred_on) else {
            continue;
        };
        let normalized_payee = normalize_payee(&display_payee);
        if normalized_payee.is_empty() || normalized_payee == "unknown" {
            continue;
        }
        observations.push(ExpenseObservation {
            transaction_id,
            occurred_on,
            day,
            normalized_payee,
            display_payee,
            amount_jpy,
        });
    }

    let mut result = analyze(&request.as_of, as_of_day, observations);
    apply_recurring_preferences(connection, &request.household_id, &mut result)?;
    Ok(result)
}

fn analyze(
    as_of: &str,
    as_of_day: i64,
    observations: Vec<ExpenseObservation>,
) -> FinancialIntelligenceDto {
    let mut by_payee: BTreeMap<String, Vec<&ExpenseObservation>> = BTreeMap::new();
    for observation in &observations {
        by_payee
            .entry(observation.normalized_payee.clone())
            .or_default()
            .push(observation);
    }

    let mut recurring_items = Vec::new();
    for (normalized_payee, group) in &by_payee {
        if let Some(item) = detect_recurring(normalized_payee, group) {
            recurring_items.push(item);
        }
    }
    recurring_items.sort_by(|left, right| {
        right
            .confidence_bps
            .cmp(&left.confidence_bps)
            .then(left.next_expected_on.cmp(&right.next_expected_on))
            .then(left.normalized_payee.cmp(&right.normalized_payee))
    });

    let recent_from = as_of_day - RECENT_ANOMALY_DAYS;
    let mut anomalies = Vec::new();
    for current in observations.iter().filter(|item| item.day >= recent_from) {
        let payee_prior: Vec<i64> = by_payee
            .get(&current.normalized_payee)
            .into_iter()
            .flatten()
            .filter(|item| item.day < current.day)
            .map(|item| item.amount_jpy)
            .collect();
        let payee_baseline = (payee_prior.len() >= 3).then(|| median(&payee_prior));
        let payee_is_anomalous = payee_baseline.is_some_and(|baseline| {
            baseline > 0
                && current.amount_jpy.saturating_sub(baseline) >= 1_000
                && current.amount_jpy >= baseline.saturating_mul(3) / 2
        });

        let household_prior: Vec<i64> = observations
            .iter()
            .filter(|item| item.day < current.day)
            .map(|item| item.amount_jpy)
            .collect();
        let household_baseline = (household_prior.len() >= 8).then(|| median(&household_prior));
        let household_is_anomalous = household_baseline.is_some_and(|baseline| {
            let deviations: Vec<i64> = household_prior
                .iter()
                .map(|amount| (*amount - baseline).abs())
                .collect();
            let mad = median(&deviations);
            baseline > 0
                && current.amount_jpy.saturating_sub(baseline) >= 5_000
                && current.amount_jpy >= baseline.saturating_mul(3)
                && current.amount_jpy >= baseline.saturating_add(mad.saturating_mul(6))
        });
        if !payee_is_anomalous && !household_is_anomalous {
            continue;
        }

        let (baseline, baseline_count, scope) = if payee_is_anomalous {
            (
                payee_baseline.unwrap_or_default(),
                payee_prior.len(),
                "this payee",
            )
        } else {
            (
                household_baseline.unwrap_or_default(),
                household_prior.len(),
                "household expenses",
            )
        };
        let ratio_bps = current.amount_jpy.saturating_mul(10_000) / baseline;
        let score = (5_000_i64 + (ratio_bps - 15_000).max(0) / 2).clamp(5_000, 10_000) as u16;
        anomalies.push(SpendingAnomalyDto {
            transaction_id: current.transaction_id.clone(),
            occurred_on: current.occurred_on.clone(),
            normalized_payee: current.normalized_payee.clone(),
            display_payee: current.display_payee.clone(),
            amount_jpy: current.amount_jpy,
            baseline_amount_jpy: baseline,
            baseline_sample_count: baseline_count as u32,
            score_bps: score,
            reasons: vec![format!(
                "Amount is {}% of the median for {} across {} earlier transactions",
                ratio_bps / 100,
                scope,
                baseline_count
            )],
        });
    }
    anomalies.sort_by(|left, right| {
        right
            .score_bps
            .cmp(&left.score_bps)
            .then(right.occurred_on.cmp(&left.occurred_on))
            .then(left.transaction_id.cmp(&right.transaction_id))
    });

    FinancialIntelligenceDto {
        as_of: as_of.to_owned(),
        history_from: format_iso_day(as_of_day - HISTORY_DAYS),
        recurring_items,
        ignored_recurring_items: Vec::new(),
        anomalies,
    }
}

fn detect_recurring(
    normalized_payee: &str,
    group: &[&ExpenseObservation],
) -> Option<RecurringItemDto> {
    let days = group.iter().map(|item| item.day).collect::<Vec<_>>();
    let amounts: Vec<i64> = group.iter().map(|item| item.amount_jpy).collect();
    let pattern = detect_stable_recurring_pattern(&days, &amounts)?;
    let latest = *group.last()?;
    let prior_typical = median(&amounts[..amounts.len() - 1]);
    let price_change_bps = if prior_typical > 0
        && latest.amount_jpy - prior_typical >= 100
        && latest.amount_jpy >= prior_typical * 105 / 100
    {
        Some(((latest.amount_jpy - prior_typical) * 10_000 / prior_typical) as i32)
    } else {
        None
    };
    let next_expected_on = if pattern.cadence == "MONTHLY" {
        add_months(&latest.occurred_on, 1)
            .unwrap_or_else(|| format_iso_day(latest.day + pattern.median_interval_days))
    } else {
        format_iso_day(latest.day + pattern.median_interval_days)
    };
    let mut reasons = pattern.reasons.clone();
    if let Some(change) = price_change_bps {
        reasons.push(format!(
            "Latest amount increased {}% from the earlier median",
            change / 100
        ));
    }

    Some(RecurringItemDto {
        normalized_payee: normalized_payee.to_owned(),
        display_payee: latest.display_payee.clone(),
        occurrence_count: group.len() as u32,
        cadence: pattern.cadence.to_owned(),
        median_interval_days: pattern.median_interval_days as u32,
        typical_amount_jpy: pattern.typical_amount_jpy,
        latest_amount_jpy: latest.amount_jpy,
        last_seen_on: latest.occurred_on.clone(),
        next_expected_on,
        confidence_bps: pattern.confidence_bps,
        price_change_bps,
        decision_status: RecurringDecisionStatus::AutoDetected,
        reasons,
    })
}

pub fn list_recurring_series_preferences(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<RecurringSeriesPreferenceDto>, String> {
    validate_household_id(household_id)?;
    ensure_household(connection, household_id)?;
    let mut statement = connection
        .prepare(
            "SELECT household_id,normalized_payee,decision,version,created_at,updated_at
             FROM recurring_series_preferences WHERE household_id=?1
             ORDER BY normalized_payee",
        )
        .map_err(unavailable)?;
    let preferences = statement
        .query_map([household_id], preference_from_row)
        .map_err(unavailable)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(unavailable)?;
    Ok(preferences)
}

pub fn upsert_recurring_series_preference(
    connection: &Connection,
    input: &UpsertRecurringSeriesPreferenceInput,
) -> Result<RecurringSeriesPreferenceDto, String> {
    validate_household_id(&input.household_id)?;
    validate_normalized_payee(&input.normalized_payee)?;
    if input.expected_version.is_some_and(|version| version < 1) {
        return Err("Invalid recurring preference version".to_owned());
    }
    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(unavailable)?;
    ensure_household(&tx, &input.household_id)?;
    let current_version = tx
        .query_row(
            "SELECT version FROM recurring_series_preferences
             WHERE household_id=?1 AND normalized_payee=?2",
            params![input.household_id, input.normalized_payee],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(unavailable)?;
    match (current_version, input.expected_version) {
        (None, None) => {
            tx.execute(
                "INSERT INTO recurring_series_preferences
                 (household_id,normalized_payee,decision)
                 VALUES(?1,?2,?3)",
                params![
                    input.household_id,
                    input.normalized_payee,
                    input.decision.as_sql()
                ],
            )
            .map_err(unavailable)?;
        }
        (Some(current), Some(expected)) if current == expected => {
            let changed = tx
                .execute(
                    "UPDATE recurring_series_preferences
                     SET decision=?3,version=version+1,
                         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE household_id=?1 AND normalized_payee=?2 AND version=?4",
                    params![
                        input.household_id,
                        input.normalized_payee,
                        input.decision.as_sql(),
                        expected
                    ],
                )
                .map_err(unavailable)?;
            if changed != 1 {
                return Err("Recurring preference changed after review".to_owned());
            }
        }
        _ => return Err("Recurring preference changed after review".to_owned()),
    }
    let result = get_preference(&tx, &input.household_id, &input.normalized_payee)?;
    tx.commit().map_err(unavailable)?;
    Ok(result)
}

pub fn delete_recurring_series_preference(
    connection: &Connection,
    input: &DeleteRecurringSeriesPreferenceInput,
) -> Result<(), String> {
    validate_household_id(&input.household_id)?;
    validate_normalized_payee(&input.normalized_payee)?;
    if input.expected_version < 1 {
        return Err("Invalid recurring preference version".to_owned());
    }
    let changed = connection
        .execute(
            "DELETE FROM recurring_series_preferences
             WHERE household_id=?1 AND normalized_payee=?2 AND version=?3",
            params![
                input.household_id,
                input.normalized_payee,
                input.expected_version
            ],
        )
        .map_err(unavailable)?;
    if changed != 1 {
        return Err("Recurring preference changed after review".to_owned());
    }
    Ok(())
}

pub(crate) fn ignored_normalized_payees(
    connection: &Connection,
    household_id: &str,
) -> Result<HashSet<String>, String> {
    Ok(list_recurring_series_preferences(connection, household_id)?
        .into_iter()
        .filter(|item| item.decision == RecurringPreferenceDecision::Ignored)
        .map(|item| item.normalized_payee)
        .collect())
}

fn apply_recurring_preferences(
    connection: &Connection,
    household_id: &str,
    result: &mut FinancialIntelligenceDto,
) -> Result<(), String> {
    let preferences = list_recurring_series_preferences(connection, household_id)?
        .into_iter()
        .map(|item| (item.normalized_payee, item.decision))
        .collect::<BTreeMap<_, _>>();
    let mut active = Vec::new();
    let mut ignored = Vec::new();
    for mut item in result.recurring_items.drain(..) {
        match preferences.get(&item.normalized_payee) {
            Some(RecurringPreferenceDecision::Confirmed) => {
                item.decision_status = RecurringDecisionStatus::Confirmed;
                active.push(item);
            }
            Some(RecurringPreferenceDecision::Ignored) => {
                item.decision_status = RecurringDecisionStatus::Ignored;
                ignored.push(item);
            }
            None => active.push(item),
        }
    }
    result.recurring_items = active;
    result.ignored_recurring_items = ignored;
    Ok(())
}

impl RecurringPreferenceDecision {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Confirmed => "CONFIRMED",
            Self::Ignored => "IGNORED",
        }
    }
}

fn preference_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecurringSeriesPreferenceDto> {
    let decision = match row.get::<_, String>(2)?.as_str() {
        "CONFIRMED" => RecurringPreferenceDecision::Confirmed,
        "IGNORED" => RecurringPreferenceDecision::Ignored,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok(RecurringSeriesPreferenceDto {
        household_id: row.get(0)?,
        normalized_payee: row.get(1)?,
        decision,
        version: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn get_preference(
    connection: &Connection,
    household_id: &str,
    normalized_payee: &str,
) -> Result<RecurringSeriesPreferenceDto, String> {
    connection
        .query_row(
            "SELECT household_id,normalized_payee,decision,version,created_at,updated_at
             FROM recurring_series_preferences WHERE household_id=?1 AND normalized_payee=?2",
            params![household_id, normalized_payee],
            preference_from_row,
        )
        .map_err(unavailable)
}

fn validate_household_id(household_id: &str) -> Result<(), String> {
    if household_id.trim().is_empty() || household_id.len() > 64 {
        Err("Household is required".to_owned())
    } else {
        Ok(())
    }
}

fn ensure_household(connection: &Connection, household_id: &str) -> Result<(), String> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM households WHERE id=?1",
            [household_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(unavailable)?
        .is_some();
    exists
        .then_some(())
        .ok_or_else(|| "Household was not found".to_owned())
}

fn validate_normalized_payee(value: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.len() > 512
        || value.chars().any(char::is_control)
        || normalize_payee(value) != value
    {
        Err("Invalid normalized payee".to_owned())
    } else {
        Ok(())
    }
}

fn unavailable(_: rusqlite::Error) -> String {
    "Recurring preferences are temporarily unavailable".to_owned()
}

pub(crate) fn detect_stable_recurring_pattern(
    sorted_days: &[i64],
    amounts: &[i64],
) -> Option<StableRecurringPattern> {
    if sorted_days.len() < 3 || sorted_days.len() != amounts.len() {
        return None;
    }
    let intervals = sorted_days
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .collect::<Vec<_>>();
    let median_interval = median(&intervals);
    let (cadence, cadence_min, cadence_max) = cadence_for(median_interval)?;
    let matching_intervals = intervals
        .iter()
        .filter(|interval| **interval >= cadence_min && **interval <= cadence_max)
        .count();
    if matching_intervals * 3 < intervals.len() * 2 {
        return None;
    }
    let typical_amount = median(amounts);
    let amount_tolerance = (typical_amount.abs() * 15 / 100).max(200);
    let stable_amounts = amounts
        .iter()
        .filter(|amount| (**amount - typical_amount).abs() <= amount_tolerance)
        .count();
    if stable_amounts * 3 < amounts.len() * 2 {
        return None;
    }
    let cadence_ratio_bps = matching_intervals as i64 * 10_000 / intervals.len() as i64;
    let amount_ratio_bps = stable_amounts as i64 * 10_000 / amounts.len() as i64;
    Some(StableRecurringPattern {
        cadence,
        median_interval_days: median_interval,
        typical_amount_jpy: typical_amount,
        confidence_bps: (5_000 + cadence_ratio_bps / 4 + amount_ratio_bps / 4).min(10_000) as u16,
        reasons: vec![
            format!(
                "{} of {} intervals match a {} cadence",
                matching_intervals,
                intervals.len(),
                cadence.to_lowercase()
            ),
            format!(
                "{} of {} amounts are within ¥{} of the typical amount",
                stable_amounts,
                amounts.len(),
                amount_tolerance
            ),
        ],
    })
}

pub(crate) fn detect_recurring_cadence_pattern(
    sorted_days: &[i64],
    amounts: &[i64],
) -> Option<StableRecurringPattern> {
    if sorted_days.len() < 3 || sorted_days.len() != amounts.len() {
        return None;
    }
    let intervals = sorted_days
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .collect::<Vec<_>>();
    let median_interval = median(&intervals);
    let (cadence, cadence_min, cadence_max) = cadence_for(median_interval)?;
    let matching_intervals = intervals
        .iter()
        .filter(|interval| **interval >= cadence_min && **interval <= cadence_max)
        .count();
    if matching_intervals * 3 < intervals.len() * 2 {
        return None;
    }
    let cadence_ratio_bps = matching_intervals as i64 * 10_000 / intervals.len() as i64;
    Some(StableRecurringPattern {
        cadence,
        median_interval_days: median_interval,
        typical_amount_jpy: median(amounts),
        confidence_bps: (5_000 + cadence_ratio_bps / 4).min(7_500) as u16,
        reasons: vec![format!(
            "{} of {} intervals match a {} cadence",
            matching_intervals,
            intervals.len(),
            cadence.to_lowercase()
        )],
    })
}

fn cadence_for(days: i64) -> Option<(&'static str, i64, i64)> {
    match days {
        6..=8 => Some(("WEEKLY", 6, 8)),
        13..=15 => Some(("BIWEEKLY", 13, 15)),
        25..=35 => Some(("MONTHLY", 25, 35)),
        80..=100 => Some(("QUARTERLY", 80, 100)),
        350..=380 => Some(("ANNUAL", 350, 380)),
        _ => None,
    }
}

pub fn normalize_payee(value: &str) -> String {
    let mut normalized = String::new();
    let mut previous_space = true;
    let mut in_digits = false;
    for character in value.trim().to_lowercase().chars() {
        if character.is_ascii_digit() {
            if !in_digits {
                if !previous_space && !normalized.is_empty() {
                    normalized.push(' ');
                }
                normalized.push('#');
                previous_space = false;
            }
            in_digits = true;
        } else if character.is_alphanumeric() {
            normalized.push(character);
            previous_space = false;
            in_digits = false;
        } else {
            in_digits = false;
            if !previous_space && !normalized.is_empty() {
                normalized.push(' ');
                previous_space = true;
            }
        }
    }
    normalized.trim().to_owned()
}

fn median(values: &[i64]) -> i64 {
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    if sorted.len().is_multiple_of(2) {
        (sorted[sorted.len() / 2 - 1] + sorted[sorted.len() / 2]) / 2
    } else {
        sorted[sorted.len() / 2]
    }
}

fn parse_iso_day(value: &str) -> Option<i64> {
    if value.len() != 10 || &value[4..5] != "-" || &value[7..8] != "-" {
        return None;
    }
    let year = value[0..4].parse::<i32>().ok()?;
    let month = value[5..7].parse::<u32>().ok()?;
    let day = value[8..10].parse::<u32>().ok()?;
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    Some(days_from_civil(year, month, day))
}

fn add_months(value: &str, months: u32) -> Option<String> {
    let day_number = parse_iso_day(value)?;
    let (year, month, day) = civil_from_days(day_number);
    let month_index = year as i64 * 12 + month as i64 - 1 + months as i64;
    let next_year = month_index.div_euclid(12) as i32;
    let next_month = month_index.rem_euclid(12) as u32 + 1;
    let next_day = day.min(days_in_month(next_year, next_month));
    Some(format!("{next_year:04}-{next_month:02}-{next_day:02}"))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => 31,
    }
}

// Howard Hinnant's civil-calendar conversion, shifted to Unix epoch days.
fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - i32::from(month <= 2);
    let era = (year as i64).div_euclid(400);
    let yoe = year as i64 - era * 400;
    let adjusted_month = month as i64 + if month > 2 { -3 } else { 9 };
    let doy = (153 * adjusted_month + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(day: i64) -> (i32, u32, u32) {
    let shifted = day + 719_468;
    let era = shifted.div_euclid(146_097);
    let doe = shifted - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = (yoe + era * 400) as i32;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (mp + if mp < 10 { 3 } else { -9 }) as u32;
    year += i32::from(month <= 2);
    (year, month, day)
}

fn format_iso_day(day: i64) -> String {
    let (year, month, day) = civil_from_days(day);
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation(id: &str, date: &str, payee: &str, amount: i64) -> ExpenseObservation {
        ExpenseObservation {
            transaction_id: id.to_owned(),
            occurred_on: date.to_owned(),
            day: parse_iso_day(date).unwrap(),
            normalized_payee: normalize_payee(payee),
            display_payee: payee.to_owned(),
            amount_jpy: amount,
        }
    }

    #[test]
    fn detects_monthly_subscription_and_predicts_calendar_date() {
        let result = analyze(
            "2026-07-31",
            parse_iso_day("2026-07-31").unwrap(),
            vec![
                observation("n1", "2026-04-30", "NETFLIX.COM 1234", 1_490),
                observation("n2", "2026-05-31", "Netflix.com 9876", 1_490),
                observation("n3", "2026-06-30", "NETFLIX COM 4567", 1_490),
                observation("n4", "2026-07-31", "Netflix.com 1111", 1_590),
            ],
        );
        let recurring = &result.recurring_items[0];
        assert_eq!(recurring.normalized_payee, "netflix com #");
        assert_eq!(recurring.cadence, "MONTHLY");
        assert_eq!(recurring.next_expected_on, "2026-08-31");
        assert_eq!(recurring.price_change_bps, Some(671));
        assert!(recurring
            .reasons
            .iter()
            .any(|reason| reason.contains("increased")));
    }

    #[test]
    fn sparse_or_irregular_history_is_not_called_recurring_or_anomalous() {
        let result = analyze(
            "2026-07-31",
            parse_iso_day("2026-07-31").unwrap(),
            vec![
                observation("a", "2026-06-01", "One-off", 1_000),
                observation("b", "2026-07-20", "One-off", 9_000),
            ],
        );
        assert!(result.recurring_items.is_empty());
        assert!(result.anomalies.is_empty());
    }

    #[test]
    fn flags_recent_payee_spike_with_explainable_baseline() {
        let result = analyze(
            "2026-07-31",
            parse_iso_day("2026-07-31").unwrap(),
            vec![
                observation("g1", "2026-03-10", "Grocery", 5_000),
                observation("g2", "2026-04-10", "Grocery", 5_200),
                observation("g3", "2026-05-10", "Grocery", 4_900),
                observation("g4", "2026-06-10", "Grocery", 5_100),
                observation("spike", "2026-07-20", "Grocery", 15_000),
            ],
        );
        assert_eq!(result.anomalies.len(), 1);
        assert_eq!(result.anomalies[0].transaction_id, "spike");
        assert_eq!(result.anomalies[0].baseline_amount_jpy, 5_050);
        assert_eq!(result.anomalies[0].baseline_sample_count, 4);
        assert!(result.anomalies[0].reasons[0].contains("median"));
    }

    #[test]
    fn flags_new_payee_only_when_household_baseline_is_robust() {
        let mut observations: Vec<_> = (1..=8)
            .map(|month| {
                observation(
                    &format!("base-{month}"),
                    &format!("2025-{month:02}-10"),
                    &format!("shop-{month}"),
                    2_000 + month as i64 * 10,
                )
            })
            .collect();
        observations.push(observation(
            "new-large",
            "2026-07-20",
            "New merchant",
            25_000,
        ));
        let result = analyze(
            "2026-07-31",
            parse_iso_day("2026-07-31").unwrap(),
            observations,
        );
        assert_eq!(result.anomalies.len(), 1);
        assert_eq!(result.anomalies[0].transaction_id, "new-large");
        assert_eq!(result.anomalies[0].baseline_sample_count, 8);
        assert!(result.anomalies[0].reasons[0].contains("household expenses"));
    }

    fn test_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE households (id TEXT PRIMARY KEY); \
                 CREATE TABLE recurring_series_preferences (household_id TEXT NOT NULL, normalized_payee TEXT NOT NULL, \
                    decision TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, \
                    created_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z', \
                    updated_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z', \
                    PRIMARY KEY(household_id,normalized_payee)); \
                 CREATE TABLE transactions (id TEXT PRIMARY KEY, household_id TEXT, occurred_on TEXT, \
                    transaction_type TEXT, payee TEXT, description TEXT, status TEXT, \
                    attribution_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD', attributed_member_id TEXT, \
                    calculation_target INTEGER NOT NULL DEFAULT 1 CHECK(calculation_target IN (0,1))); \
                 CREATE TABLE accounts (id TEXT PRIMARY KEY, household_id TEXT, account_kind TEXT); \
                 CREATE TABLE journal_entries (transaction_id TEXT, account_id TEXT, entry_side TEXT, amount_jpy INTEGER); \
                 CREATE TABLE account_groups (id TEXT PRIMARY KEY, household_id TEXT); \
                 CREATE TABLE account_group_members (household_id TEXT, account_group_id TEXT, account_id TEXT); \
                 CREATE TABLE household_members (id TEXT PRIMARY KEY, household_id TEXT, status TEXT); \
                 INSERT INTO households VALUES ('family'),('other'); \
                 INSERT INTO accounts VALUES ('expense', 'family', 'EXPENSE'), ('bank', 'family', 'ASSET'), \
                    ('excluded-expense', 'family', 'EXPENSE'), ('excluded-bank', 'family', 'ASSET'); \
                 INSERT INTO account_groups VALUES ('daily', 'family'), ('foreign', 'other'); \
                 INSERT INTO account_group_members VALUES ('family', 'daily', 'expense'); \
                 INSERT INTO household_members VALUES ('alice', 'family', 'ACTIVE'), \
                    ('archived', 'family', 'ARCHIVED'), ('foreign-member', 'other', 'ACTIVE');",
            )
            .unwrap();
        connection
    }

    fn preference_input(
        decision: RecurringPreferenceDecision,
        expected_version: Option<i64>,
    ) -> UpsertRecurringSeriesPreferenceInput {
        UpsertRecurringSeriesPreferenceInput {
            household_id: "family".into(),
            normalized_payee: "rent".into(),
            decision,
            expected_version,
        }
    }

    fn add_monthly_rent(connection: &Connection) {
        connection
            .execute_batch(
                "INSERT INTO transactions
                 (id,household_id,occurred_on,transaction_type,payee,description,status)
                 VALUES ('r1','family','2026-05-01','EXPENSE','Rent',NULL,'POSTED'),
                        ('r2','family','2026-06-01','EXPENSE','Rent',NULL,'POSTED'),
                        ('r3','family','2026-07-01','EXPENSE','Rent',NULL,'POSTED');
                 INSERT INTO journal_entries VALUES
                    ('r1','expense','DEBIT',1000),('r2','expense','DEBIT',1000),
                    ('r3','expense','DEBIT',1000);",
            )
            .unwrap();
    }

    #[test]
    fn recurring_preference_lifecycle_is_versioned_and_household_scoped() {
        let connection = test_connection();
        let created = upsert_recurring_series_preference(
            &connection,
            &preference_input(RecurringPreferenceDecision::Confirmed, None),
        )
        .unwrap();
        assert_eq!(created.version, 1);
        assert_eq!(created.decision, RecurringPreferenceDecision::Confirmed);
        assert!(upsert_recurring_series_preference(
            &connection,
            &preference_input(RecurringPreferenceDecision::Ignored, None),
        )
        .is_err());
        let updated = upsert_recurring_series_preference(
            &connection,
            &preference_input(RecurringPreferenceDecision::Ignored, Some(1)),
        )
        .unwrap();
        assert_eq!(updated.version, 2);
        assert_eq!(updated.decision, RecurringPreferenceDecision::Ignored);
        let other = upsert_recurring_series_preference(
            &connection,
            &UpsertRecurringSeriesPreferenceInput {
                household_id: "other".into(),
                normalized_payee: "rent".into(),
                decision: RecurringPreferenceDecision::Confirmed,
                expected_version: None,
            },
        )
        .unwrap();
        assert_eq!(other.version, 1);
        assert!(delete_recurring_series_preference(
            &connection,
            &DeleteRecurringSeriesPreferenceInput {
                household_id: "family".into(),
                normalized_payee: "rent".into(),
                expected_version: 1,
            },
        )
        .is_err());
        delete_recurring_series_preference(
            &connection,
            &DeleteRecurringSeriesPreferenceInput {
                household_id: "family".into(),
                normalized_payee: "rent".into(),
                expected_version: 2,
            },
        )
        .unwrap();
        assert!(list_recurring_series_preferences(&connection, "family")
            .unwrap()
            .is_empty());
        assert_eq!(
            list_recurring_series_preferences(&connection, "other")
                .unwrap()
                .len(),
            1
        );
        assert!(list_recurring_series_preferences(&connection, "missing").is_err());
    }

    #[test]
    fn recurring_preference_migration_enforces_decision_version_and_payee_constraints() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON;
                 CREATE TABLE households(id TEXT PRIMARY KEY);
                 INSERT INTO households VALUES('family');",
            )
            .unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0062_recurring_series_preferences.sql"
            ))
            .unwrap();
        assert!(connection
            .execute(
                "INSERT INTO recurring_series_preferences
                 (household_id,normalized_payee,decision) VALUES('family','rent','CONFIRMED')",
                [],
            )
            .is_ok());
        assert!(connection
            .execute(
                "INSERT INTO recurring_series_preferences
                 (household_id,normalized_payee,decision) VALUES('family','bad','AUTO_DETECTED')",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE recurring_series_preferences SET version=0 WHERE household_id='family'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "INSERT INTO recurring_series_preferences
                 (household_id,normalized_payee,decision) VALUES('family',' ','IGNORED')",
                [],
            )
            .is_err());
    }

    #[test]
    fn ignored_series_is_returned_for_management_but_removed_from_active_scope() {
        let connection = test_connection();
        add_monthly_rent(&connection);
        upsert_recurring_series_preference(
            &connection,
            &preference_input(RecurringPreferenceDecision::Ignored, None),
        )
        .unwrap();
        let request = FinancialIntelligenceRequest {
            household_id: "family".into(),
            as_of: "2026-07-31".into(),
            account_group_id: Some("daily".into()),
            attribution_scope: AttributionScope::HouseholdCommon,
        };
        let ignored = query_financial_intelligence(&connection, &request).unwrap();
        assert!(ignored.recurring_items.is_empty());
        assert_eq!(ignored.ignored_recurring_items.len(), 1);
        assert_eq!(
            ignored.ignored_recurring_items[0].decision_status,
            RecurringDecisionStatus::Ignored
        );
        let confirmed = upsert_recurring_series_preference(
            &connection,
            &preference_input(RecurringPreferenceDecision::Confirmed, Some(1)),
        )
        .unwrap();
        assert_eq!(confirmed.version, 2);
        let active = query_financial_intelligence(&connection, &request).unwrap();
        assert_eq!(active.recurring_items.len(), 1);
        assert!(active.ignored_recurring_items.is_empty());
        assert_eq!(
            active.recurring_items[0].decision_status,
            RecurringDecisionStatus::Confirmed
        );
        assert_eq!(active.recurring_items[0].typical_amount_jpy, 1_000);
    }

    #[test]
    fn query_excludes_refunds_transfers_void_rows_and_non_expense_legs() {
        let connection = test_connection();
        connection.execute_batch(
            "INSERT INTO transactions (id,household_id,occurred_on,transaction_type,payee,description,status) VALUES
                ('e1','family','2026-05-01','EXPENSE','Rent',NULL,'POSTED'),
                ('e2','family','2026-06-01','EXPENSE','Rent',NULL,'POSTED'),
                ('e3','family','2026-07-01','CARD_PURCHASE','Rent',NULL,'POSTED'),
                ('refund','family','2026-07-02','REFUND','Rent',NULL,'POSTED'),
                ('transfer','family','2026-07-03','TRANSFER','Rent',NULL,'POSTED'),
                ('void','family','2026-07-04','EXPENSE','Rent',NULL,'VOID');
             INSERT INTO journal_entries VALUES
                ('e1','expense','DEBIT',1000), ('e2','expense','DEBIT',1000), ('e3','expense','DEBIT',1000),
                ('refund','expense','CREDIT',1000), ('transfer','expense','DEBIT',1000),
                ('void','expense','DEBIT',1000), ('e1','bank','CREDIT',1000);"
        ).unwrap();
        let result = query_financial_intelligence(
            &connection,
            &FinancialIntelligenceRequest {
                household_id: "family".into(),
                as_of: "2026-07-31".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::default(),
            },
        )
        .unwrap();
        assert_eq!(result.recurring_items.len(), 1);
        assert_eq!(result.recurring_items[0].occurrence_count, 3);
        assert!(result.anomalies.is_empty());
    }

    #[test]
    fn calculation_target_excludes_posted_rows_from_recurring_and_anomaly_models() {
        let connection = test_connection();
        connection
            .execute_batch(
                "INSERT INTO transactions
                   (id,household_id,occurred_on,transaction_type,payee,description,status,calculation_target)
                 VALUES
                   ('e1','family','2026-05-01','EXPENSE','Rent',NULL,'POSTED',0),
                   ('e2','family','2026-06-01','EXPENSE','Rent',NULL,'POSTED',0),
                   ('e3','family','2026-07-01','EXPENSE','Rent',NULL,'POSTED',0);
                 INSERT INTO journal_entries VALUES
                   ('e1','expense','DEBIT',1000),('e2','expense','DEBIT',1000),
                   ('e3','expense','DEBIT',50000);",
            )
            .unwrap();
        let result = query_financial_intelligence(
            &connection,
            &FinancialIntelligenceRequest {
                household_id: "family".into(),
                as_of: "2026-07-31".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::All,
            },
        )
        .unwrap();
        assert!(result.recurring_items.is_empty());
        assert!(result.anomalies.is_empty());
    }

    #[test]
    fn account_group_uses_any_entry_membership_without_duplicate_observations() {
        let connection = test_connection();
        connection.execute_batch(
            "INSERT INTO account_group_members VALUES ('family','daily','bank');
             INSERT INTO transactions (id,household_id,occurred_on,transaction_type,payee,description,status) VALUES
                ('included-1','family','2026-05-01','EXPENSE','Rent',NULL,'POSTED'),
                ('included-2','family','2026-06-01','EXPENSE','Rent',NULL,'POSTED'),
                ('included-3','family','2026-07-01','EXPENSE','Rent',NULL,'POSTED'),
                ('excluded','family','2026-07-02','EXPENSE','Other',NULL,'POSTED');
             INSERT INTO journal_entries VALUES
                ('included-1','expense','DEBIT',1000),('included-1','bank','CREDIT',1000),
                ('included-2','expense','DEBIT',1000),('included-2','bank','CREDIT',1000),
                ('included-3','expense','DEBIT',1000),('included-3','bank','CREDIT',1000),
                ('excluded','excluded-expense','DEBIT',9000),('excluded','excluded-bank','CREDIT',9000);",
        ).unwrap();

        let result = query_financial_intelligence(
            &connection,
            &FinancialIntelligenceRequest {
                household_id: "family".into(),
                as_of: "2026-07-31".into(),
                account_group_id: Some("daily".into()),
                attribution_scope: AttributionScope::default(),
            },
        )
        .unwrap();

        assert_eq!(result.recurring_items.len(), 1);
        assert_eq!(result.recurring_items[0].occurrence_count, 3);
        assert!(result.anomalies.is_empty());
    }

    #[test]
    fn account_group_scope_rejects_cross_household_group_and_null_is_legacy() {
        let connection = test_connection();
        let missing = query_financial_intelligence(
            &connection,
            &FinancialIntelligenceRequest {
                household_id: "family".into(),
                as_of: "2026-07-31".into(),
                account_group_id: Some("foreign".into()),
                attribution_scope: AttributionScope::default(),
            },
        );
        assert_eq!(
            missing.unwrap_err(),
            "The requested account group was not found"
        );

        let legacy = query_financial_intelligence(
            &connection,
            &FinancialIntelligenceRequest {
                household_id: "family".into(),
                as_of: "2026-07-31".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::default(),
            },
        );
        assert!(legacy.is_ok());
    }

    #[test]
    fn attribution_scope_separates_common_and_member_history_and_accepts_archived_members() {
        let connection = test_connection();
        connection.execute_batch(
            "INSERT INTO transactions
                (id,household_id,occurred_on,transaction_type,payee,description,status,attribution_kind,attributed_member_id)
              VALUES
                ('common-1','family','2026-05-01','EXPENSE','Common Rent',NULL,'POSTED','HOUSEHOLD',NULL),
                ('common-2','family','2026-06-01','EXPENSE','Common Rent',NULL,'POSTED','HOUSEHOLD',NULL),
                ('common-3','family','2026-07-01','EXPENSE','Common Rent',NULL,'POSTED','HOUSEHOLD',NULL),
                ('member-1','family','2026-05-02','EXPENSE','Archived Plan',NULL,'POSTED','MEMBER','archived'),
                ('member-2','family','2026-06-02','EXPENSE','Archived Plan',NULL,'POSTED','MEMBER','archived'),
                ('member-3','family','2026-07-02','EXPENSE','Archived Plan',NULL,'POSTED','MEMBER','archived');
             INSERT INTO journal_entries VALUES
                ('common-1','expense','DEBIT',1000),('common-2','expense','DEBIT',1000),('common-3','expense','DEBIT',1000),
                ('member-1','expense','DEBIT',2000),('member-2','expense','DEBIT',2000),('member-3','expense','DEBIT',2000);",
        ).unwrap();

        let common = query_financial_intelligence(
            &connection,
            &FinancialIntelligenceRequest {
                household_id: "family".into(),
                as_of: "2026-07-31".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::HouseholdCommon,
            },
        )
        .unwrap();
        assert_eq!(common.recurring_items.len(), 1);
        assert_eq!(common.recurring_items[0].display_payee, "Common Rent");

        let archived = query_financial_intelligence(
            &connection,
            &FinancialIntelligenceRequest {
                household_id: "family".into(),
                as_of: "2026-07-31".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::Member {
                    member_id: "archived".into(),
                },
            },
        )
        .unwrap();
        assert_eq!(archived.recurring_items.len(), 1);
        assert_eq!(archived.recurring_items[0].display_payee, "Archived Plan");

        let foreign = query_financial_intelligence(
            &connection,
            &FinancialIntelligenceRequest {
                household_id: "family".into(),
                as_of: "2026-07-31".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::Member {
                    member_id: "foreign-member".into(),
                },
            },
        );
        assert_eq!(
            foreign.unwrap_err(),
            "Attribution member was not found in the household"
        );
    }

    #[test]
    fn date_math_handles_leap_year_and_month_end() {
        assert_eq!(
            format_iso_day(parse_iso_day("2024-02-29").unwrap()),
            "2024-02-29"
        );
        assert_eq!(add_months("2026-01-31", 1).as_deref(), Some("2026-02-28"));
        assert!(parse_iso_day("2026-02-29").is_none());
    }
}
