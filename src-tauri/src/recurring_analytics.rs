use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const HISTORY_DAYS: i64 = 366;
const RECENT_ANOMALY_DAYS: i64 = 31;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialIntelligenceRequest {
    pub household_id: String,
    pub as_of: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FinancialIntelligenceDto {
    pub as_of: String,
    pub history_from: String,
    pub recurring_items: Vec<RecurringItemDto>,
    pub anomalies: Vec<SpendingAnomalyDto>,
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
    pub reasons: Vec<String>,
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

pub fn query_financial_intelligence(
    connection: &Connection,
    request: &FinancialIntelligenceRequest,
) -> Result<FinancialIntelligenceDto, String> {
    if request.household_id.trim().is_empty() || request.household_id.len() > 64 {
        return Err("Household is required".to_owned());
    }
    let as_of_day = parse_iso_day(&request.as_of).ok_or_else(|| "Invalid as-of date".to_owned())?;
    let history_from = format_iso_day(as_of_day - HISTORY_DAYS);

    let mut statement = connection
        .prepare(
            "SELECT t.id, t.occurred_on, COALESCE(NULLIF(TRIM(t.payee), ''), \
                    NULLIF(TRIM(t.description), ''), 'Unknown'), SUM(e.amount_jpy) \
             FROM transactions t \
             JOIN journal_entries e ON e.transaction_id = t.id AND e.side = 'DEBIT' \
             JOIN accounts a ON a.id = e.account_id AND a.account_kind = 'EXPENSE' \
             WHERE t.household_id = ?1 AND t.status = 'POSTED' \
               AND t.transaction_type IN ('EXPENSE', 'CARD_PURCHASE') \
               AND t.occurred_on >= ?2 AND t.occurred_on <= ?3 \
             GROUP BY t.id, t.occurred_on, t.payee, t.description \
             HAVING SUM(e.amount_jpy) > 0 \
             ORDER BY t.occurred_on, t.id",
        )
        .map_err(|_| "Financial intelligence is temporarily unavailable".to_owned())?;
    let rows = statement
        .query_map(
            params![request.household_id, history_from, request.as_of],
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

    Ok(analyze(&request.as_of, as_of_day, observations))
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
        anomalies,
    }
}

fn detect_recurring(
    normalized_payee: &str,
    group: &[&ExpenseObservation],
) -> Option<RecurringItemDto> {
    if group.len() < 3 {
        return None;
    }
    let intervals: Vec<i64> = group
        .windows(2)
        .map(|pair| pair[1].day - pair[0].day)
        .collect();
    let median_interval = median(&intervals);
    let (cadence, cadence_min, cadence_max) = cadence_for(median_interval)?;
    let matching_intervals = intervals
        .iter()
        .filter(|interval| **interval >= cadence_min && **interval <= cadence_max)
        .count();
    if matching_intervals * 3 < intervals.len() * 2 {
        return None;
    }

    let amounts: Vec<i64> = group.iter().map(|item| item.amount_jpy).collect();
    let typical_amount = median(&amounts);
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
    let confidence = (5_000 + cadence_ratio_bps / 4 + amount_ratio_bps / 4).min(10_000) as u16;
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
    let next_expected_on = if cadence == "MONTHLY" {
        add_months(&latest.occurred_on, 1)
            .unwrap_or_else(|| format_iso_day(latest.day + median_interval))
    } else {
        format_iso_day(latest.day + median_interval)
    };
    let mut reasons = vec![format!(
        "{} of {} intervals match a {} cadence",
        matching_intervals,
        intervals.len(),
        cadence.to_lowercase()
    )];
    reasons.push(format!(
        "{} of {} amounts are within ¥{} of the typical amount",
        stable_amounts,
        amounts.len(),
        amount_tolerance
    ));
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
        cadence: cadence.to_owned(),
        median_interval_days: median_interval as u32,
        typical_amount_jpy: typical_amount,
        latest_amount_jpy: latest.amount_jpy,
        last_seen_on: latest.occurred_on.clone(),
        next_expected_on,
        confidence_bps: confidence,
        price_change_bps,
        reasons,
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
    if sorted.len() % 2 == 0 {
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
                "CREATE TABLE transactions (id TEXT PRIMARY KEY, household_id TEXT, occurred_on TEXT, \
                    transaction_type TEXT, payee TEXT, description TEXT, status TEXT); \
                 CREATE TABLE accounts (id TEXT PRIMARY KEY, account_kind TEXT); \
                 CREATE TABLE journal_entries (transaction_id TEXT, account_id TEXT, side TEXT, amount_jpy INTEGER); \
                 INSERT INTO accounts VALUES ('expense', 'EXPENSE'), ('bank', 'ASSET');",
            )
            .unwrap();
        connection
    }

    #[test]
    fn query_excludes_refunds_transfers_void_rows_and_non_expense_legs() {
        let connection = test_connection();
        connection.execute_batch(
            "INSERT INTO transactions VALUES
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
            },
        )
        .unwrap();
        assert_eq!(result.recurring_items.len(), 1);
        assert_eq!(result.recurring_items[0].occurrence_count, 3);
        assert!(result.anomalies.is_empty());
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
