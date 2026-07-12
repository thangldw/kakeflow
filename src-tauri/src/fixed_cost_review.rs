use crate::persistence::AppState;
use crate::record_scope::{validate_attribution_scope, AttributionScope};
use crate::recurring_analytics::{
    detect_recurring_cadence_pattern, detect_stable_recurring_pattern, normalize_payee,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const COMPLETE_MONTHS: i64 = 6;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FixedCostReviewRequest {
    pub household_id: String,
    #[serde(default)]
    pub account_group_id: Option<String>,
    #[serde(default)]
    pub attribution_scope: AttributionScope,
    pub as_of: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FixedCostSegment {
    Housing,
    Insurance,
    Electricity,
    Gas,
    Water,
    Internet,
    Mobile,
    SubscriptionsOther,
    OtherRecurring,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FixedCostMonthlyPointDto {
    pub month: String,
    pub total_jpy: i64,
    pub recurring_payee_count: u32,
    pub transaction_count: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FixedCostPayeeDto {
    pub normalized_payee: String,
    pub display_payee: String,
    pub expense_category_names: Vec<String>,
    pub cadence: String,
    pub typical_amount_jpy: i64,
    pub latest_amount_jpy: i64,
    pub latest_payment_on: String,
    pub occurrence_count: u32,
    pub confidence_bps: u16,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FixedCostSegmentDto {
    pub segment: FixedCostSegment,
    pub monthly_points: Vec<FixedCostMonthlyPointDto>,
    pub recent_three_average_jpy: i64,
    pub previous_three_average_jpy: i64,
    pub change_jpy: i64,
    pub change_rate_bps: Option<i32>,
    pub annualized_jpy: i64,
    pub recurring_payee_count: u32,
    pub transaction_count: u32,
    pub latest_payment_on: Option<String>,
    pub top_payees: Vec<FixedCostPayeeDto>,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FixedCostTotalsDto {
    pub recent_three_average_jpy: i64,
    pub previous_three_average_jpy: i64,
    pub change_jpy: i64,
    pub change_rate_bps: Option<i32>,
    pub annualized_jpy: i64,
    pub recurring_payee_count: u32,
    pub transaction_count: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FixedCostCoverageDto {
    pub complete_month_count: u8,
    pub observed_month_count: u8,
    pub confirmed_transaction_count: u32,
    pub recurring_transaction_count: u32,
    pub unclassified_recurring_payee_count: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FixedCostReviewDto {
    pub as_of: String,
    pub history_from: String,
    pub history_through: String,
    pub monthly_points: Vec<FixedCostMonthlyPointDto>,
    pub segments: Vec<FixedCostSegmentDto>,
    pub totals: FixedCostTotalsDto,
    pub coverage: FixedCostCoverageDto,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone)]
struct Observation {
    transaction_id: String,
    occurred_on: String,
    day: i64,
    month: String,
    normalized_payee: String,
    display_payee: String,
    amount_jpy: i64,
    category_names: Vec<String>,
}

#[derive(Debug, Clone)]
struct RecurringPayee {
    segment: FixedCostSegment,
    dto: FixedCostPayeeDto,
    observations: Vec<Observation>,
}

pub fn query_fixed_cost_review(
    connection: &Connection,
    request: &FixedCostReviewRequest,
) -> Result<FixedCostReviewDto, String> {
    validate_request(connection, request)?;
    let current_month = &request.as_of[..7];
    let first_month = shift_month(current_month, -COMPLETE_MONTHS)?;
    let last_month = shift_month(current_month, -1)?;
    let history_from = format!("{first_month}-01");
    let history_through = end_of_month(&last_month)?;
    // Detection needs enough history for three annual observations (two intervals),
    // while every reported amount remains confined to the six completed months.
    let detection_from = format!("{}-01", shift_month(current_month, -36)?);
    let months = (0..COMPLETE_MONTHS)
        .map(|offset| shift_month(&first_month, offset))
        .collect::<Result<Vec<_>, _>>()?;

    let detection_observations =
        read_observations(connection, request, &detection_from, &history_through)?;
    let observations = detection_observations
        .iter()
        .filter(|item| item.occurred_on.as_str() >= history_from.as_str())
        .cloned()
        .collect::<Vec<_>>();
    let observed_month_count = observations
        .iter()
        .map(|item| item.month.as_str())
        .collect::<BTreeSet<_>>()
        .len() as u8;
    let confirmed_transaction_count = observations.len() as u32;
    let recurring =
        detect_recurring_payees(&detection_observations, &history_from, &history_through);
    let recurring_transaction_count = recurring
        .iter()
        .map(|item| item.observations.len() as u32)
        .sum();
    let unclassified_recurring_payee_count = recurring
        .iter()
        .filter(|item| item.segment == FixedCostSegment::OtherRecurring)
        .count() as u32;

    let monthly_points = monthly_points(&months, recurring.iter());
    let mut by_segment = BTreeMap::<FixedCostSegment, Vec<&RecurringPayee>>::new();
    for item in &recurring {
        by_segment.entry(item.segment).or_default().push(item);
    }
    let segments = by_segment
        .into_iter()
        .map(|(segment, payees)| build_segment(segment, &months, &payees))
        .collect::<Vec<_>>();
    let totals = totals(
        &monthly_points,
        recurring.len() as u32,
        recurring_transaction_count,
        recurring
            .iter()
            .map(|item| annualized_payee(&item.dto))
            .fold(0_i64, i64::saturating_add),
    );

    Ok(FixedCostReviewDto {
        as_of: request.as_of.clone(),
        history_from,
        history_through,
        monthly_points,
        segments,
        totals,
        coverage: FixedCostCoverageDto {
            complete_month_count: COMPLETE_MONTHS as u8,
            observed_month_count,
            confirmed_transaction_count,
            recurring_transaction_count,
            unclassified_recurring_payee_count,
        },
        limitations: vec![
            "Only posted expense and card-purchase entries in the six complete calendar months before the as-of month are analyzed".to_owned(),
            "Recurring detection is deterministic: OTHER_RECURRING requires stable amounts, while recognized fixed-cost segments may accept variable amounts with strong cadence and lower confidence".to_owned(),
            "Cadence detection may inspect up to 36 prior complete months so annual patterns can be identified, but all displayed totals use only the six-month reporting window".to_owned(),
            "Segments are inferred from payee and expense-category text and may require user review".to_owned(),
            "This review reports observed costs only and does not estimate market prices or potential savings".to_owned(),
            "Three-month averages use integer JPY division and therefore discard fractional yen".to_owned(),
        ],
    })
}

fn validate_request(
    connection: &Connection,
    request: &FixedCostReviewRequest,
) -> Result<(), String> {
    if request.household_id.trim().is_empty() || request.household_id.len() > 64 {
        return Err("Household is required".to_owned());
    }
    if parse_iso_day(&request.as_of).is_none() {
        return Err("Invalid as-of date".to_owned());
    }
    let household_exists = connection
        .query_row(
            "SELECT 1 FROM households WHERE id = ?1",
            [&request.household_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(unavailable)?
        .is_some();
    if !household_exists {
        return Err("The requested household was not found".to_owned());
    }
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
    .map_err(|error| error.to_string())
}

fn read_observations(
    connection: &Connection,
    request: &FixedCostReviewRequest,
    from: &str,
    through: &str,
) -> Result<Vec<Observation>, String> {
    let mut statement = connection
        .prepare(
            "SELECT t.id, t.occurred_on,
                    COALESCE(NULLIF(TRIM(t.payee), ''), NULLIF(TRIM(t.description), ''), 'Unknown'),
                    SUM(e.amount_jpy),
                    (SELECT json_group_array(name) FROM (
                        SELECT DISTINCT category.name AS name
                        FROM journal_entries category_entry
                        JOIN accounts category ON category.id = category_entry.account_id
                        WHERE category_entry.transaction_id = t.id
                          AND category_entry.entry_side = 'DEBIT'
                          AND category.household_id = t.household_id
                          AND category.account_kind = 'EXPENSE'
                        ORDER BY category.name))
             FROM transactions t
             JOIN journal_entries e ON e.transaction_id = t.id AND e.entry_side = 'DEBIT'
             JOIN accounts a ON a.id = e.account_id AND a.household_id = t.household_id
                            AND a.account_kind = 'EXPENSE'
             WHERE t.household_id = ?1 AND t.status = 'POSTED'
               AND t.transaction_type IN ('EXPENSE','CARD_PURCHASE')
               AND t.occurred_on BETWEEN ?2 AND ?3
               AND (?4 IS NULL OR EXISTS (
                    SELECT 1 FROM journal_entries scope_je
                    JOIN account_group_members scope_gm
                      ON scope_gm.account_id = scope_je.account_id
                     AND scope_gm.household_id = t.household_id
                    WHERE scope_je.transaction_id = t.id
                      AND scope_gm.account_group_id = ?4))
               AND (?5 = 'ALL'
                    OR (?5 = 'HOUSEHOLD_COMMON' AND t.attribution_kind = 'HOUSEHOLD')
                    OR (?5 = 'MEMBER' AND t.attribution_kind = 'MEMBER'
                        AND t.attributed_member_id = ?6))
             GROUP BY t.id, t.occurred_on, t.payee, t.description
             HAVING SUM(e.amount_jpy) > 0
             ORDER BY t.occurred_on, t.id",
        )
        .map_err(unavailable)?;
    let rows = statement
        .query_map(
            params![
                request.household_id,
                from,
                through,
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
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(unavailable)?;
    let mut result = Vec::new();
    for row in rows {
        let (transaction_id, occurred_on, display_payee, amount_jpy, categories) =
            row.map_err(unavailable)?;
        let Some(day) = parse_iso_day(&occurred_on) else {
            continue;
        };
        let normalized_payee = normalize_payee(&display_payee);
        result.push(Observation {
            transaction_id,
            month: occurred_on[..7].to_owned(),
            occurred_on,
            day,
            normalized_payee,
            display_payee,
            amount_jpy,
            category_names: serde_json::from_str(&categories)
                .map_err(|_| "Fixed cost review is temporarily unavailable".to_owned())?,
        });
    }
    Ok(result)
}

fn detect_recurring_payees(
    observations: &[Observation],
    metric_from: &str,
    metric_through: &str,
) -> Vec<RecurringPayee> {
    let mut groups = BTreeMap::<String, Vec<&Observation>>::new();
    for observation in observations
        .iter()
        .filter(|item| !item.normalized_payee.is_empty() && item.normalized_payee != "unknown")
    {
        groups
            .entry(observation.normalized_payee.clone())
            .or_default()
            .push(observation);
    }
    let mut recurring = Vec::new();
    for (normalized_payee, group) in groups {
        let days = group.iter().map(|item| item.day).collect::<Vec<_>>();
        let amounts = group.iter().map(|item| item.amount_jpy).collect::<Vec<_>>();
        let latest = *group.last().unwrap();
        let category_names = group
            .iter()
            .flat_map(|item| item.category_names.iter().cloned())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let segment = classify_segment(&latest.display_payee, &category_names);
        let pattern = detect_stable_recurring_pattern(&days, &amounts).or_else(|| {
            if segment == FixedCostSegment::OtherRecurring {
                return None;
            }
            let mut pattern = detect_recurring_cadence_pattern(&days, &amounts)?;
            pattern.reasons.push(
                "Recognized fixed-cost segment allows variable payment amounts; cadence is stable but amount stability is not claimed"
                    .to_owned(),
            );
            Some(pattern)
        });
        let Some(pattern) = pattern else { continue };
        let metric_observations = group
            .iter()
            .filter(|item| item.occurred_on.as_str() >= metric_from)
            .map(|item| (*item).clone())
            .collect::<Vec<_>>();
        if latest.day + pattern.median_interval_days
            <= parse_iso_day(metric_through).unwrap_or(i64::MAX)
        {
            continue;
        }
        recurring.push(RecurringPayee {
            segment,
            dto: FixedCostPayeeDto {
                normalized_payee,
                display_payee: latest.display_payee.clone(),
                expense_category_names: category_names,
                cadence: pattern.cadence.to_owned(),
                typical_amount_jpy: pattern.typical_amount_jpy,
                latest_amount_jpy: latest.amount_jpy,
                latest_payment_on: latest.occurred_on.clone(),
                occurrence_count: group.len() as u32,
                confidence_bps: pattern.confidence_bps,
                reasons: pattern.reasons,
            },
            observations: metric_observations,
        });
    }
    recurring.sort_by(|left, right| {
        right
            .dto
            .typical_amount_jpy
            .cmp(&left.dto.typical_amount_jpy)
            .then(left.dto.normalized_payee.cmp(&right.dto.normalized_payee))
    });
    recurring
}

fn classify_segment(payee: &str, categories: &[String]) -> FixedCostSegment {
    classify_text(&categories.join(" "))
        .or_else(|| classify_text(payee))
        .unwrap_or(FixedCostSegment::OtherRecurring)
}

fn classify_text(value: &str) -> Option<FixedCostSegment> {
    let text = value.to_lowercase();
    let tokens = text
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect::<BTreeSet<_>>();
    let has_token = |needles: &[&str]| needles.iter().any(|needle| tokens.contains(needle));
    let contains = |needles: &[&str]| needles.iter().any(|needle| text.contains(needle));
    if contains(&["家賃", "住宅", "ローン"]) || has_token(&["rent", "housing", "mortgage"]) {
        Some(FixedCostSegment::Housing)
    } else if contains(&["保険", "共済"]) || has_token(&["insurance"]) {
        Some(FixedCostSegment::Insurance)
    } else if contains(&["電気", "電力"]) || has_token(&["electric", "electricity", "tepco"]) {
        Some(FixedCostSegment::Electricity)
    } else if contains(&["ガス"]) || has_token(&["gas"]) {
        Some(FixedCostSegment::Gas)
    } else if contains(&["水道"]) || has_token(&["water"]) {
        Some(FixedCostSegment::Water)
    } else if contains(&["インターネット", "光回線", "プロバイダ"])
        || has_token(&["internet", "broadband", "wifi"])
    {
        Some(FixedCostSegment::Internet)
    } else if contains(&["携帯", "楽天モバイル"])
        || has_token(&["mobile", "cellular", "docomo", "softbank", "au"])
    {
        Some(FixedCostSegment::Mobile)
    } else if contains(&[
        "subscription",
        "netflix",
        "spotify",
        "adobe",
        "amazon prime",
        "youtube premium",
        "サブスク",
    ]) {
        Some(FixedCostSegment::SubscriptionsOther)
    } else {
        None
    }
}

fn monthly_points<'a>(
    months: &[String],
    payees: impl Iterator<Item = &'a RecurringPayee>,
) -> Vec<FixedCostMonthlyPointDto> {
    let mut values = months
        .iter()
        .map(|month| {
            (
                month.clone(),
                (0_i64, BTreeSet::<String>::new(), BTreeSet::<String>::new()),
            )
        })
        .collect::<BTreeMap<_, _>>();
    for payee in payees {
        for item in &payee.observations {
            if let Some((total, payee_ids, transactions)) = values.get_mut(&item.month) {
                *total += item.amount_jpy;
                payee_ids.insert(payee.dto.normalized_payee.clone());
                transactions.insert(item.transaction_id.clone());
            }
        }
    }
    values
        .into_iter()
        .map(
            |(month, (total_jpy, payees, transactions))| FixedCostMonthlyPointDto {
                month,
                total_jpy,
                recurring_payee_count: payees.len() as u32,
                transaction_count: transactions.len() as u32,
            },
        )
        .collect()
}

fn build_segment(
    segment: FixedCostSegment,
    months: &[String],
    payees: &[&RecurringPayee],
) -> FixedCostSegmentDto {
    let points = monthly_points(months, payees.iter().copied());
    let (previous, recent, change, rate) = period_change(&points);
    let mut top_payees = payees
        .iter()
        .map(|item| item.dto.clone())
        .collect::<Vec<_>>();
    top_payees.sort_by(|left, right| {
        right
            .typical_amount_jpy
            .cmp(&left.typical_amount_jpy)
            .then(left.normalized_payee.cmp(&right.normalized_payee))
    });
    top_payees.truncate(5);
    FixedCostSegmentDto {
        segment,
        monthly_points: points,
        recent_three_average_jpy: recent,
        previous_three_average_jpy: previous,
        change_jpy: change,
        change_rate_bps: rate,
        annualized_jpy: payees
            .iter()
            .map(|item| annualized_payee(&item.dto))
            .fold(0_i64, i64::saturating_add),
        recurring_payee_count: payees.len() as u32,
        transaction_count: payees
            .iter()
            .map(|item| item.observations.len() as u32)
            .sum(),
        latest_payment_on: payees
            .iter()
            .map(|item| item.dto.latest_payment_on.as_str())
            .max()
            .map(str::to_owned),
        top_payees,
        reasons: vec![
            "Segment assignment uses deterministic payee and expense-category text rules"
                .to_owned(),
            "Three-month averages use observed recurring payments, not estimated market prices"
                .to_owned(),
        ],
    }
}

fn totals(
    points: &[FixedCostMonthlyPointDto],
    payee_count: u32,
    transaction_count: u32,
    annualized_jpy: i64,
) -> FixedCostTotalsDto {
    let (previous, recent, change, rate) = period_change(points);
    FixedCostTotalsDto {
        recent_three_average_jpy: recent,
        previous_three_average_jpy: previous,
        change_jpy: change,
        change_rate_bps: rate,
        annualized_jpy,
        recurring_payee_count: payee_count,
        transaction_count,
    }
}

fn annualized_payee(payee: &FixedCostPayeeDto) -> i64 {
    let factor = match payee.cadence.as_str() {
        "WEEKLY" => 52,
        "BIWEEKLY" => 26,
        "MONTHLY" => 12,
        "QUARTERLY" => 4,
        "ANNUAL" => 1,
        _ => 0,
    };
    payee.typical_amount_jpy.saturating_mul(factor)
}

fn period_change(points: &[FixedCostMonthlyPointDto]) -> (i64, i64, i64, Option<i32>) {
    let previous = points
        .iter()
        .take(3)
        .map(|item| item.total_jpy)
        .sum::<i64>()
        / 3;
    let recent = points
        .iter()
        .skip(3)
        .map(|item| item.total_jpy)
        .sum::<i64>()
        / 3;
    let change = recent.saturating_sub(previous);
    let rate = (previous != 0).then(|| {
        (change.saturating_mul(10_000) / previous).clamp(i32::MIN as i64, i32::MAX as i64) as i32
    });
    (previous, recent, change, rate)
}

fn shift_month(value: &str, offset: i64) -> Result<String, String> {
    if value.len() != 7 || &value[4..5] != "-" {
        return Err("Invalid month".to_owned());
    }
    let year = value[..4]
        .parse::<i64>()
        .map_err(|_| "Invalid month".to_owned())?;
    let month = value[5..]
        .parse::<i64>()
        .map_err(|_| "Invalid month".to_owned())?;
    if !(1..=12).contains(&month) {
        return Err("Invalid month".to_owned());
    }
    let index = year * 12 + month - 1 + offset;
    Ok(format!(
        "{:04}-{:02}",
        index.div_euclid(12),
        index.rem_euclid(12) + 1
    ))
}

fn end_of_month(month: &str) -> Result<String, String> {
    let next = shift_month(month, 1)?;
    let day = parse_iso_day(&format!("{next}-01")).ok_or_else(|| "Invalid month".to_owned())?;
    Ok(format_iso_day(day - 1))
}

fn parse_iso_day(value: &str) -> Option<i64> {
    if value.len() != 10 || &value[4..5] != "-" || &value[7..8] != "-" {
        return None;
    }
    let year = value[..4].parse::<i32>().ok()?;
    let month = value[5..7].parse::<u32>().ok()?;
    let day = value[8..].parse::<u32>().ok()?;
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    Some(days_from_civil(year, month, day))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => 31,
    }
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - i32::from(month <= 2);
    let era = (year as i64).div_euclid(400);
    let yoe = year as i64 - era * 400;
    let adjusted = month as i64 + if month > 2 { -3 } else { 9 };
    let doy = (153 * adjusted + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn format_iso_day(day: i64) -> String {
    let shifted = day + 719_468;
    let era = shifted.div_euclid(146_097);
    let doe = shifted - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = (yoe + era * 400) as i32;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let date = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (mp + if mp < 10 { 3 } else { -9 }) as u32;
    year += i32::from(month <= 2);
    format!("{year:04}-{month:02}-{date:02}")
}

fn unavailable(_: rusqlite::Error) -> String {
    "Fixed cost review is temporarily unavailable".to_owned()
}

#[tauri::command]
pub fn fixed_cost_review_query(
    state: tauri::State<'_, AppState>,
    request: FixedCostReviewRequest,
) -> Result<FixedCostReviewDto, String> {
    state
        .with_connection(|connection| Ok(query_fixed_cost_review(connection, &request)))
        .map_err(|_| "Fixed cost review is temporarily unavailable".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE households(id TEXT PRIMARY KEY);
             CREATE TABLE household_members(id TEXT PRIMARY KEY, household_id TEXT, status TEXT);
             CREATE TABLE accounts(id TEXT PRIMARY KEY, household_id TEXT, name TEXT, account_kind TEXT);
             CREATE TABLE transactions(id TEXT PRIMARY KEY, household_id TEXT, occurred_on TEXT, transaction_type TEXT, payee TEXT, description TEXT, status TEXT, attribution_kind TEXT, attributed_member_id TEXT);
             CREATE TABLE journal_entries(transaction_id TEXT, account_id TEXT, entry_side TEXT, amount_jpy INTEGER);
             CREATE TABLE account_groups(id TEXT PRIMARY KEY, household_id TEXT);
             CREATE TABLE account_group_members(household_id TEXT, account_group_id TEXT, account_id TEXT);
             INSERT INTO households VALUES('family'),('other');
             INSERT INTO household_members VALUES('alice','family','ARCHIVED'),('bob','family','ACTIVE'),('foreign','other','ACTIVE');
             INSERT INTO accounts VALUES
                ('bank','family','Bank','ASSET'),
                ('housing','family','Housing','EXPENSE'),
                ('housing-comma','family','Housing, Shared','EXPENSE'),
                ('utilities','family','Utilities','EXPENSE'),
                ('subscriptions','family','Subscriptions','EXPENSE'),
                ('personal','family','Mobile','EXPENSE'),
                ('excluded','family','Other','EXPENSE');
             INSERT INTO account_groups VALUES('daily','family'),('foreign-group','other');
             INSERT INTO account_group_members VALUES
                ('family','daily','bank'),('family','daily','housing'),
                ('family','daily','housing-comma'),
                ('family','daily','utilities'),('family','daily','subscriptions'),
                ('family','daily','personal');",
        ).unwrap();
        connection
    }

    #[allow(clippy::too_many_arguments)]
    fn add_expense(
        connection: &Connection,
        id: &str,
        date: &str,
        payee: Option<&str>,
        status: &str,
        attribution: &str,
        member_id: Option<&str>,
        entries: &[(&str, i64)],
    ) {
        connection
            .execute(
                "INSERT INTO transactions VALUES(?1,'family',?2,'EXPENSE',?3,NULL,?4,?5,?6)",
                params![id, date, payee, status, attribution, member_id],
            )
            .unwrap();
        for (account, amount) in entries {
            connection
                .execute(
                    "INSERT INTO journal_entries VALUES(?1,?2,'DEBIT',?3)",
                    params![id, account, amount],
                )
                .unwrap();
        }
        connection
            .execute(
                "INSERT INTO journal_entries VALUES(?1,'bank','CREDIT',?2)",
                params![id, entries.iter().map(|item| item.1).sum::<i64>()],
            )
            .unwrap();
    }

    fn request() -> FixedCostReviewRequest {
        FixedCostReviewRequest {
            household_id: "family".into(),
            account_group_id: None,
            attribution_scope: AttributionScope::All,
            as_of: "2026-07-13".into(),
        }
    }

    #[test]
    fn reports_exact_six_complete_months_and_counts_split_transactions_once() {
        let connection = connection();
        for (index, month) in (1..=6).enumerate() {
            let amount = if month <= 3 { 100_000 } else { 110_000 };
            let entries = if index == 0 {
                vec![("housing-comma", 60_000), ("utilities", 40_000)]
            } else {
                vec![("housing", amount)]
            };
            add_expense(
                &connection,
                &format!("rent-{month}"),
                &format!("2026-{month:02}-05"),
                Some("Landlord"),
                "POSTED",
                "HOUSEHOLD",
                None,
                &entries,
            );
        }
        add_expense(
            &connection,
            "partial-current",
            "2026-07-01",
            Some("Landlord"),
            "POSTED",
            "HOUSEHOLD",
            None,
            &[("housing", 999_999)],
        );
        add_expense(
            &connection,
            "void",
            "2026-06-02",
            Some("Landlord"),
            "VOID",
            "HOUSEHOLD",
            None,
            &[("housing", 500_000)],
        );
        connection
            .execute(
                "UPDATE transactions SET transaction_type = 'CARD_PURCHASE' WHERE id = 'rent-6'",
                [],
            )
            .unwrap();

        let result = query_fixed_cost_review(&connection, &request()).unwrap();
        assert_eq!(result.history_from, "2026-01-01");
        assert_eq!(result.history_through, "2026-06-30");
        assert_eq!(result.monthly_points.len(), 6);
        assert_eq!(result.monthly_points[0].month, "2026-01");
        assert_eq!(result.monthly_points[0].total_jpy, 100_000);
        assert_eq!(result.monthly_points[0].transaction_count, 1);
        assert_eq!(result.monthly_points[5].month, "2026-06");
        assert_eq!(result.coverage.complete_month_count, 6);
        assert_eq!(result.coverage.confirmed_transaction_count, 6);
        let housing = result
            .segments
            .iter()
            .find(|item| item.segment == FixedCostSegment::Housing)
            .unwrap();
        assert_eq!(housing.previous_three_average_jpy, 100_000);
        assert_eq!(housing.recent_three_average_jpy, 110_000);
        assert_eq!(housing.change_jpy, 10_000);
        assert_eq!(housing.change_rate_bps, Some(1_000));
        assert_eq!(housing.annualized_jpy, 1_260_000);
        assert_eq!(housing.transaction_count, 6);
        assert_eq!(
            housing.top_payees[0].expense_category_names,
            ["Housing", "Housing, Shared", "Utilities"]
        );
        assert!(result
            .limitations
            .iter()
            .any(|item| item.contains("does not estimate")));
    }

    #[test]
    fn annual_detection_uses_long_history_but_metrics_use_only_reporting_window() {
        let connection = connection();
        for (id, date) in [
            ("insurance-2023", "2023-12-15"),
            ("insurance-2024", "2024-12-15"),
            ("insurance-2025", "2025-12-15"),
        ] {
            add_expense(
                &connection,
                id,
                date,
                Some("Life Insurance"),
                "POSTED",
                "HOUSEHOLD",
                None,
                &[("utilities", 120_000)],
            );
        }
        let result = query_fixed_cost_review(&connection, &request()).unwrap();
        let insurance = result
            .segments
            .iter()
            .find(|item| item.segment == FixedCostSegment::Insurance)
            .unwrap();
        assert_eq!(insurance.top_payees[0].cadence, "ANNUAL");
        assert_eq!(insurance.top_payees[0].occurrence_count, 3);
        assert_eq!(insurance.transaction_count, 0);
        assert!(insurance
            .monthly_points
            .iter()
            .all(|item| item.total_jpy == 0));
        assert_eq!(insurance.latest_payment_on.as_deref(), Some("2025-12-15"));
        assert_eq!(insurance.annualized_jpy, 120_000);
        assert_eq!(result.totals.annualized_jpy, 120_000);
        assert_eq!(result.coverage.confirmed_transaction_count, 0);
        assert_eq!(result.coverage.recurring_transaction_count, 0);
    }

    #[test]
    fn account_and_archived_member_scopes_combine_without_leaking_other_rows() {
        let connection = connection();
        for month in 1..=6 {
            add_expense(
                &connection,
                &format!("alice-{month}"),
                &format!("2026-{month:02}-10"),
                Some("Insurance Vendor"),
                "POSTED",
                "MEMBER",
                Some("alice"),
                &[("personal", 5_000)],
            );
            add_expense(
                &connection,
                &format!("bob-{month}"),
                &format!("2026-{month:02}-11"),
                Some("Netflix"),
                "POSTED",
                "MEMBER",
                Some("bob"),
                &[("excluded", 20_000)],
            );
        }
        let result = query_fixed_cost_review(
            &connection,
            &FixedCostReviewRequest {
                account_group_id: Some("daily".into()),
                attribution_scope: AttributionScope::Member {
                    member_id: "alice".into(),
                },
                ..request()
            },
        )
        .unwrap();
        assert_eq!(result.segments.len(), 1);
        assert_eq!(result.segments[0].segment, FixedCostSegment::Mobile);
        assert_eq!(result.totals.recent_three_average_jpy, 5_000);
        assert_eq!(result.coverage.confirmed_transaction_count, 6);
    }

    #[test]
    fn excludes_irregular_and_unknown_payees_and_returns_zero_months_truthfully() {
        let connection = connection();
        for (id, date, amount) in [
            ("odd-1", "2026-01-01", 1_000),
            ("odd-2", "2026-01-20", 9_000),
            ("odd-3", "2026-05-20", 2_000),
        ] {
            add_expense(
                &connection,
                id,
                date,
                Some("Odd Merchant"),
                "POSTED",
                "HOUSEHOLD",
                None,
                &[("utilities", amount)],
            );
        }
        for month in 1..=3 {
            add_expense(
                &connection,
                &format!("unknown-{month}"),
                &format!("2026-{month:02}-05"),
                None,
                "POSTED",
                "HOUSEHOLD",
                None,
                &[("utilities", 3_000)],
            );
        }
        for (index, transaction_type) in ["CARD_PAYMENT", "TRANSFER", "REFUND"].iter().enumerate() {
            let id = format!("excluded-type-{index}");
            add_expense(
                &connection,
                &id,
                &format!("2026-0{}-15", index + 1),
                Some("Netflix"),
                "POSTED",
                "HOUSEHOLD",
                None,
                &[("subscriptions", 8_000)],
            );
            connection
                .execute(
                    "UPDATE transactions SET transaction_type = ?1 WHERE id = ?2",
                    params![transaction_type, id],
                )
                .unwrap();
        }
        let result = query_fixed_cost_review(&connection, &request()).unwrap();
        assert!(result.segments.is_empty());
        assert_eq!(result.monthly_points.len(), 6);
        assert!(result.monthly_points.iter().all(|item| item.total_jpy == 0));
        assert_eq!(result.totals.change_rate_bps, None);
        assert_eq!(result.coverage.confirmed_transaction_count, 6);
        assert_eq!(result.coverage.recurring_transaction_count, 0);
    }

    #[test]
    fn annualization_uses_cadence_and_zero_previous_baseline_has_no_rate() {
        let connection = connection();
        let start = parse_iso_day("2026-01-02").unwrap();
        for index in 0..26 {
            add_expense(
                &connection,
                &format!("weekly-{index}"),
                &format_iso_day(start + index * 7),
                Some("Weekly Subscription"),
                "POSTED",
                "HOUSEHOLD",
                None,
                &[("subscriptions", 1_000)],
            );
        }
        for (month, date) in [(4, "2026-04-30"), (5, "2026-05-31"), (6, "2026-06-30")] {
            add_expense(
                &connection,
                &format!("recent-{month}"),
                date,
                Some("Netflix"),
                "POSTED",
                "HOUSEHOLD",
                None,
                &[("subscriptions", 1_500)],
            );
        }
        let result = query_fixed_cost_review(&connection, &request()).unwrap();
        let subscriptions = result
            .segments
            .iter()
            .find(|item| item.segment == FixedCostSegment::SubscriptionsOther)
            .unwrap();
        let weekly = subscriptions
            .top_payees
            .iter()
            .find(|item| item.cadence == "WEEKLY")
            .unwrap();
        assert_eq!(annualized_payee(weekly), 52_000);
        assert_eq!(subscriptions.annualized_jpy, 70_000);
        let source =
            read_observations(&connection, &request(), "2026-01-01", "2026-06-30").unwrap();
        let detected = detect_recurring_payees(&source, "2026-01-01", "2026-06-30");
        let netflix_points = monthly_points(
            &[
                "2026-01".into(),
                "2026-02".into(),
                "2026-03".into(),
                "2026-04".into(),
                "2026-05".into(),
                "2026-06".into(),
            ],
            detected
                .iter()
                .filter(|item| item.dto.normalized_payee == "netflix"),
        );
        let (_, _, _, rate) = period_change(&netflix_points);
        assert_eq!(rate, None);
    }

    #[test]
    fn fixed_utility_accepts_variable_amounts_but_still_requires_recurring_cadence() {
        let connection = connection();
        for (month, amount) in [8_000, 20_000, 10_000, 18_000, 9_000, 21_000]
            .into_iter()
            .enumerate()
        {
            add_expense(
                &connection,
                &format!("electric-{month}"),
                &format!("2026-{:02}-12", month + 1),
                Some("Tokyo Electricity"),
                "POSTED",
                "HOUSEHOLD",
                None,
                &[("utilities", amount)],
            );
        }
        for (index, date) in ["2026-01-01", "2026-01-20", "2026-05-20"]
            .into_iter()
            .enumerate()
        {
            add_expense(
                &connection,
                &format!("irregular-electric-{index}"),
                date,
                Some("Osaka Electricity"),
                "POSTED",
                "HOUSEHOLD",
                None,
                &[("utilities", 7_000)],
            );
        }
        let result = query_fixed_cost_review(&connection, &request()).unwrap();
        let electricity = result
            .segments
            .iter()
            .find(|item| item.segment == FixedCostSegment::Electricity)
            .unwrap();
        assert_eq!(electricity.recurring_payee_count, 1);
        assert_eq!(electricity.top_payees[0].display_payee, "Tokyo Electricity");
        assert_eq!(electricity.top_payees[0].typical_amount_jpy, 14_000);
        assert_eq!(electricity.annualized_jpy, 168_000);
        assert!(electricity.top_payees[0]
            .reasons
            .iter()
            .any(|reason| reason.contains("variable payment amounts")));
    }

    #[test]
    fn stale_series_are_dropped_and_short_ascii_keywords_do_not_match_substrings() {
        let connection = connection();
        for (index, date) in ["2025-11-10", "2025-12-10", "2026-01-10"]
            .into_iter()
            .enumerate()
        {
            add_expense(
                &connection,
                &format!("stale-{index}"),
                date,
                Some("Old Netflix"),
                "POSTED",
                "HOUSEHOLD",
                None,
                &[("subscriptions", 1_000)],
            );
        }
        for month in 1..=6 {
            add_expense(
                &connection,
                &format!("parent-{month}"),
                &format!("2026-{month:02}-05"),
                Some("Parent Club"),
                "POSTED",
                "HOUSEHOLD",
                None,
                &[("excluded", 2_000)],
            );
            add_expense(
                &connection,
                &format!("vegas-{month}"),
                &format!("2026-{month:02}-06"),
                Some("Vegas Gym"),
                "POSTED",
                "HOUSEHOLD",
                None,
                &[("excluded", 3_000)],
            );
        }
        let result = query_fixed_cost_review(&connection, &request()).unwrap();
        assert!(result.segments.iter().all(|item| !matches!(
            item.segment,
            FixedCostSegment::Housing
                | FixedCostSegment::Gas
                | FixedCostSegment::SubscriptionsOther
        )));
        let other = result
            .segments
            .iter()
            .find(|item| item.segment == FixedCostSegment::OtherRecurring)
            .unwrap();
        assert_eq!(other.recurring_payee_count, 2);
        assert_eq!(result.totals.recurring_payee_count, 2);
    }

    #[test]
    fn six_month_boundary_crosses_year_and_includes_leap_day() {
        let connection = connection();
        let result = query_fixed_cost_review(
            &connection,
            &FixedCostReviewRequest {
                as_of: "2024-03-15".into(),
                ..request()
            },
        )
        .unwrap();
        assert_eq!(result.history_from, "2023-09-01");
        assert_eq!(result.history_through, "2024-02-29");
        assert_eq!(
            result
                .monthly_points
                .iter()
                .map(|item| item.month.as_str())
                .collect::<Vec<_>>(),
            ["2023-09", "2023-10", "2023-11", "2023-12", "2024-01", "2024-02"]
        );
    }

    #[test]
    fn rejects_invalid_household_group_and_member_scope() {
        let connection = connection();
        assert_eq!(
            query_fixed_cost_review(
                &connection,
                &FixedCostReviewRequest {
                    household_id: "missing".into(),
                    ..request()
                }
            )
            .unwrap_err(),
            "The requested household was not found"
        );
        assert_eq!(
            query_fixed_cost_review(
                &connection,
                &FixedCostReviewRequest {
                    account_group_id: Some("foreign-group".into()),
                    ..request()
                }
            )
            .unwrap_err(),
            "The requested account group was not found"
        );
        assert_eq!(
            query_fixed_cost_review(
                &connection,
                &FixedCostReviewRequest {
                    attribution_scope: AttributionScope::Member {
                        member_id: "foreign".into()
                    },
                    ..request()
                }
            )
            .unwrap_err(),
            "Attribution member was not found in the household"
        );
        assert_eq!(
            query_fixed_cost_review(
                &connection,
                &FixedCostReviewRequest {
                    as_of: "2026-02-29".into(),
                    ..request()
                }
            )
            .unwrap_err(),
            "Invalid as-of date"
        );
    }
}
