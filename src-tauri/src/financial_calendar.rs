use crate::persistence::AppState;
use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

const MAX_ID_LEN: usize = 64;
const TOP_DRIVER_LIMIT: i64 = 8;

#[derive(Debug)]
pub enum FinancialCalendarError {
    InvalidInput(&'static str),
    NotFound,
    Unavailable,
}

impl FinancialCalendarError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput(message) => message,
            Self::NotFound => "The requested household was not found",
            Self::Unavailable => "Financial calendar data is temporarily unavailable",
        }
    }
}

impl fmt::Display for FinancialCalendarError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.public_message())
    }
}

fn db_error(error: rusqlite::Error) -> FinancialCalendarError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if matches!(
                details.code,
                ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked
            ) =>
        {
            FinancialCalendarError::Unavailable
        }
        _ => FinancialCalendarError::Unavailable,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialCalendarRequest {
    pub household_id: String,
    pub account_group_id: Option<String>,
    pub month: String,
    pub as_of: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyFinancialReportRequest {
    pub household_id: String,
    pub account_group_id: Option<String>,
    pub month: String,
    pub as_of: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YearlyFinancialReportRequest {
    pub household_id: String,
    pub account_group_id: Option<String>,
    pub year: String,
    pub as_of: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FinancialCalendarEventKind {
    CashInflow,
    CashOutflow,
    CardClosing,
    CardPaymentDue,
    CardPayment,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FinancialCalendarEventDto {
    pub kind: FinancialCalendarEventKind,
    pub id: String,
    pub title: String,
    pub amount_jpy: i64,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FinancialCalendarDayDto {
    pub date: String,
    pub accrual_income_jpy: i64,
    pub accrual_expense_jpy: i64,
    pub cash_inflow_jpy: i64,
    pub cash_outflow_jpy: i64,
    pub posted_transaction_count: u64,
    pub no_spend_day: bool,
    pub events: Vec<FinancialCalendarEventDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BudgetStatusDto {
    pub budget_jpy: i64,
    pub actual_jpy: i64,
    pub remaining_jpy: i64,
    pub utilization_bps: Option<i64>,
    pub category_count: u64,
    pub over_budget_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoalProgressSummaryDto {
    pub active_count: u64,
    pub target_jpy: i64,
    pub saved_jpy: i64,
    pub remaining_jpy: i64,
    pub due_within_period_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DataQualitySummaryDto {
    pub total_imports: u64,
    pub posted_imports: u64,
    pub review_required_imports: u64,
    pub failed_imports: u64,
    pub in_progress_imports: u64,
    pub import_completion_bps: Option<i64>,
    pub latest_imported_at: Option<String>,
    pub stale_days: Option<i64>,
    pub has_unresolved_imports: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FinancialCalendarDto {
    pub month: String,
    pub as_of: String,
    pub days: Vec<FinancialCalendarDayDto>,
    pub budget: BudgetStatusDto,
    pub goals: GoalProgressSummaryDto,
    pub data_quality: DataQualitySummaryDto,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PeriodMetricsDto {
    pub income_jpy: i64,
    pub expense_jpy: i64,
    pub savings_jpy: i64,
    pub savings_rate_bps: Option<i64>,
    pub posted_transaction_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetricDeltaDto {
    pub amount_jpy: i64,
    pub rate_bps: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetricDeltaSetDto {
    pub income: MetricDeltaDto,
    pub expense: MetricDeltaDto,
    pub savings: MetricDeltaDto,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryDriverDto {
    pub id: String,
    pub name: String,
    pub current_jpy: i64,
    pub previous_jpy: i64,
    pub delta_jpy: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MerchantDriverDto {
    pub merchant: String,
    pub current_jpy: i64,
    pub previous_jpy: i64,
    pub delta_jpy: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationSummaryDto {
    pub total_statements: u64,
    pub fully_reconciled: u64,
    pub possible_matches: u64,
    pub partially_reconciled: u64,
    pub unmatched: u64,
    pub mismatch_count: u64,
    pub payment_total_jpy: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyFinancialReportDto {
    pub period: String,
    pub current: PeriodMetricsDto,
    pub prior_month: PeriodMetricsDto,
    pub prior_year: PeriodMetricsDto,
    pub vs_prior_month: MetricDeltaSetDto,
    pub vs_prior_year: MetricDeltaSetDto,
    pub top_category_drivers: Vec<CategoryDriverDto>,
    pub top_merchant_drivers: Vec<MerchantDriverDto>,
    pub budget: BudgetStatusDto,
    pub goals: GoalProgressSummaryDto,
    pub data_quality: DataQualitySummaryDto,
    pub reconciliation: ReconciliationSummaryDto,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct YearlyFinancialReportDto {
    pub period: String,
    pub current: PeriodMetricsDto,
    pub prior_year: PeriodMetricsDto,
    pub vs_prior_year: MetricDeltaSetDto,
    pub months: Vec<MonthlyReportPointDto>,
    pub top_category_drivers: Vec<CategoryDriverDto>,
    pub top_merchant_drivers: Vec<MerchantDriverDto>,
    pub budget: BudgetStatusDto,
    pub goals: GoalProgressSummaryDto,
    pub data_quality: DataQualitySummaryDto,
    pub reconciliation: ReconciliationSummaryDto,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyReportPointDto {
    pub month: String,
    #[serde(flatten)]
    pub metrics: PeriodMetricsDto,
}

#[derive(Default)]
struct DailyAccumulator {
    income_jpy: i64,
    expense_jpy: i64,
    cash_inflow_jpy: i64,
    cash_outflow_jpy: i64,
    transaction_count: u64,
    events: Vec<FinancialCalendarEventDto>,
}

pub fn financial_calendar(
    connection: &Connection,
    request: &FinancialCalendarRequest,
) -> Result<FinancialCalendarDto, FinancialCalendarError> {
    validate_household(connection, &request.household_id)?;
    validate_account_group_scope(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
    )?;
    let start = month_start(connection, &request.month)?;
    let end = date_shift(connection, &start, "+1 month")?;
    let as_of = resolve_as_of(connection, request.as_of.as_deref())?;
    let mut days = calendar_days(connection, &start, &end)?;

    let mut statement = connection
        .prepare(
            "SELECT t.id, t.occurred_on, t.transaction_type,
               COALESCE(NULLIF(trim(t.payee), ''), NULLIF(trim(t.description), ''), t.transaction_type),
               COALESCE(SUM(CASE WHEN a.account_kind = 'INCOME'
                 THEN CASE je.entry_side WHEN 'CREDIT' THEN je.amount_jpy ELSE -je.amount_jpy END ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN a.account_kind = 'EXPENSE'
                 THEN CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN a.account_kind = 'ASSET'
                 THEN CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END ELSE 0 END), 0)
             FROM transactions t
             LEFT JOIN journal_entries je ON je.transaction_id = t.id
             LEFT JOIN accounts a ON a.id = je.account_id
             WHERE t.household_id = ?1 AND t.status = 'POSTED'
               AND t.occurred_on >= ?2 AND t.occurred_on < ?3
               AND (?4 IS NULL OR EXISTS (
                 SELECT 1 FROM journal_entries scope_je JOIN account_group_members scope_gm
                   ON scope_gm.account_id = scope_je.account_id AND scope_gm.household_id = t.household_id
                 WHERE scope_je.transaction_id = t.id AND scope_gm.account_group_id = ?4))
             GROUP BY t.id, t.occurred_on, t.transaction_type, t.payee, t.description
             ORDER BY t.occurred_on, t.id",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map(
            params![request.household_id, start, end, request.account_group_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .map_err(db_error)?;
    for row in rows {
        let (id, date, transaction_type, title, income, expense, asset_delta) =
            row.map_err(db_error)?;
        let day = days
            .get_mut(&date)
            .ok_or(FinancialCalendarError::Unavailable)?;
        day.income_jpy += income;
        day.expense_jpy += expense;
        day.transaction_count += 1;
        if asset_delta > 0 {
            day.cash_inflow_jpy += asset_delta;
            day.events.push(FinancialCalendarEventDto {
                kind: FinancialCalendarEventKind::CashInflow,
                id,
                title,
                amount_jpy: asset_delta,
                status: Some(transaction_type),
            });
        } else if asset_delta < 0 {
            day.cash_outflow_jpy += -asset_delta;
            day.events.push(FinancialCalendarEventDto {
                kind: FinancialCalendarEventKind::CashOutflow,
                id,
                title,
                amount_jpy: -asset_delta,
                status: Some(transaction_type),
            });
        }
    }
    append_card_events(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
        &start,
        &end,
        &mut days,
    )?;

    let days = days
        .into_iter()
        .map(|(date, mut day)| {
            day.events.sort_by(|left, right| {
                event_rank(&left.kind)
                    .cmp(&event_rank(&right.kind))
                    .then_with(|| left.title.cmp(&right.title))
                    .then_with(|| left.id.cmp(&right.id))
            });
            FinancialCalendarDayDto {
                no_spend_day: date <= as_of && day.expense_jpy <= 0,
                date,
                accrual_income_jpy: day.income_jpy,
                accrual_expense_jpy: day.expense_jpy,
                cash_inflow_jpy: day.cash_inflow_jpy,
                cash_outflow_jpy: day.cash_outflow_jpy,
                posted_transaction_count: day.transaction_count,
                events: day.events,
            }
        })
        .collect();
    Ok(FinancialCalendarDto {
        month: request.month.clone(),
        as_of: as_of.clone(),
        days,
        budget: budget_status(connection, &request.household_id, &start, &end)?,
        goals: goals_summary(connection, &request.household_id, &start, &end)?,
        data_quality: data_quality(connection, &request.household_id, &as_of)?,
    })
}

pub fn monthly_report(
    connection: &Connection,
    request: &MonthlyFinancialReportRequest,
) -> Result<MonthlyFinancialReportDto, FinancialCalendarError> {
    validate_household(connection, &request.household_id)?;
    validate_account_group_scope(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
    )?;
    let start = month_start(connection, &request.month)?;
    let end = date_shift(connection, &start, "+1 month")?;
    let prior_month_start = date_shift(connection, &start, "-1 month")?;
    let prior_year_start = date_shift(connection, &start, "-1 year")?;
    let prior_year_end = date_shift(connection, &end, "-1 year")?;
    let as_of = resolve_as_of(connection, request.as_of.as_deref())?;
    let current = period_metrics(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
        &start,
        &end,
    )?;
    let prior_month = period_metrics(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
        &prior_month_start,
        &start,
    )?;
    let prior_year = period_metrics(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
        &prior_year_start,
        &prior_year_end,
    )?;
    Ok(MonthlyFinancialReportDto {
        period: request.month.clone(),
        vs_prior_month: metric_deltas(&current, &prior_month),
        vs_prior_year: metric_deltas(&current, &prior_year),
        top_category_drivers: category_drivers(
            connection,
            &request.household_id,
            request.account_group_id.as_deref(),
            &start,
            &end,
            &prior_month_start,
            &start,
        )?,
        top_merchant_drivers: merchant_drivers(
            connection,
            &request.household_id,
            request.account_group_id.as_deref(),
            &start,
            &end,
            &prior_month_start,
            &start,
        )?,
        budget: budget_status(connection, &request.household_id, &start, &end)?,
        goals: goals_summary(connection, &request.household_id, &start, &end)?,
        data_quality: data_quality(connection, &request.household_id, &as_of)?,
        reconciliation: reconciliation_summary(
            connection,
            &request.household_id,
            request.account_group_id.as_deref(),
            &start,
            &end,
        )?,
        current,
        prior_month,
        prior_year,
    })
}

pub fn yearly_report(
    connection: &Connection,
    request: &YearlyFinancialReportRequest,
) -> Result<YearlyFinancialReportDto, FinancialCalendarError> {
    validate_household(connection, &request.household_id)?;
    validate_account_group_scope(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
    )?;
    let start = year_start(connection, &request.year)?;
    let end = date_shift(connection, &start, "+1 year")?;
    let prior_start = date_shift(connection, &start, "-1 year")?;
    let as_of = resolve_as_of(connection, request.as_of.as_deref())?;
    let current = period_metrics(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
        &start,
        &end,
    )?;
    let prior_year = period_metrics(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
        &prior_start,
        &start,
    )?;
    let months = (0..12)
        .map(|offset| {
            let month_start = date_shift(connection, &start, &format!("+{offset} months"))?;
            let month_end = date_shift(connection, &month_start, "+1 month")?;
            Ok(MonthlyReportPointDto {
                month: month_start[..7].to_owned(),
                metrics: period_metrics(
                    connection,
                    &request.household_id,
                    request.account_group_id.as_deref(),
                    &month_start,
                    &month_end,
                )?,
            })
        })
        .collect::<Result<Vec<_>, FinancialCalendarError>>()?;
    Ok(YearlyFinancialReportDto {
        period: request.year.clone(),
        vs_prior_year: metric_deltas(&current, &prior_year),
        months,
        top_category_drivers: category_drivers(
            connection,
            &request.household_id,
            request.account_group_id.as_deref(),
            &start,
            &end,
            &prior_start,
            &start,
        )?,
        top_merchant_drivers: merchant_drivers(
            connection,
            &request.household_id,
            request.account_group_id.as_deref(),
            &start,
            &end,
            &prior_start,
            &start,
        )?,
        budget: budget_status(connection, &request.household_id, &start, &end)?,
        goals: goals_summary(connection, &request.household_id, &start, &end)?,
        data_quality: data_quality(connection, &request.household_id, &as_of)?,
        reconciliation: reconciliation_summary(
            connection,
            &request.household_id,
            request.account_group_id.as_deref(),
            &start,
            &end,
        )?,
        current,
        prior_year,
    })
}

fn calendar_days(
    connection: &Connection,
    start: &str,
    end: &str,
) -> Result<BTreeMap<String, DailyAccumulator>, FinancialCalendarError> {
    let mut statement = connection
        .prepare(
            "WITH RECURSIVE days(day) AS (
               SELECT ?1 UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < date(?2, '-1 day')
             ) SELECT day FROM days",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map(params![start, end], |row| row.get::<_, String>(0))
        .map_err(db_error)?;
    let mut days = BTreeMap::new();
    for date in rows {
        days.insert(date.map_err(db_error)?, DailyAccumulator::default());
    }
    Ok(days)
}

fn append_card_events(
    connection: &Connection,
    household_id: &str,
    account_group_id: Option<&str>,
    start: &str,
    end: &str,
    days: &mut BTreeMap<String, DailyAccumulator>,
) -> Result<(), FinancialCalendarError> {
    let mut statements = connection
        .prepare(
            "SELECT cs.id, a.name, cs.period_end, cs.payment_due_on,
                    cs.statement_amount_jpy, cs.reconciliation_status
             FROM card_statements cs JOIN accounts a ON a.id = cs.card_account_id
             WHERE cs.household_id = ?1 AND
               ((cs.period_end >= ?2 AND cs.period_end < ?3) OR
                (cs.payment_due_on >= ?2 AND cs.payment_due_on < ?3))
               AND (?4 IS NULL OR EXISTS (
                 SELECT 1 FROM account_group_members gm WHERE gm.household_id = cs.household_id
                   AND gm.account_group_id = ?4 AND gm.account_id = cs.card_account_id))
             ORDER BY cs.period_end, cs.id",
        )
        .map_err(db_error)?;
    let rows = statements
        .query_map(params![household_id, start, end, account_group_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(db_error)?;
    for row in rows {
        let (id, card_name, closing_on, due_on, amount, status) = row.map_err(db_error)?;
        if let Some(day) = days.get_mut(&closing_on) {
            day.events.push(FinancialCalendarEventDto {
                kind: FinancialCalendarEventKind::CardClosing,
                id: id.clone(),
                title: card_name.clone(),
                amount_jpy: amount,
                status: Some(status.clone()),
            });
        }
        if let Some(day) = due_on.as_ref().and_then(|date| days.get_mut(date)) {
            day.events.push(FinancialCalendarEventDto {
                kind: FinancialCalendarEventKind::CardPaymentDue,
                id,
                title: card_name,
                amount_jpy: amount,
                status: Some(status),
            });
        }
    }
    let mut payments = connection
        .prepare(
            "SELECT cp.id, a.name, cp.payment_on, cp.payment_amount_jpy, cp.reconciliation_status
             FROM card_payments cp JOIN accounts a ON a.id = cp.card_account_id
             WHERE cp.household_id = ?1 AND cp.payment_on >= ?2 AND cp.payment_on < ?3
               AND (?4 IS NULL OR EXISTS (
                 SELECT 1 FROM account_group_members gm WHERE gm.household_id = cp.household_id
                   AND gm.account_group_id = ?4 AND (gm.account_id = cp.card_account_id OR EXISTS (
                     SELECT 1 FROM journal_entries payment_je
                     WHERE payment_je.transaction_id = cp.bank_transaction_id
                       AND payment_je.account_id = gm.account_id))))
             ORDER BY cp.payment_on, cp.id",
        )
        .map_err(db_error)?;
    let rows = payments
        .query_map(params![household_id, start, end, account_group_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(db_error)?;
    for row in rows {
        let (id, title, date, amount, status) = row.map_err(db_error)?;
        if let Some(day) = days.get_mut(&date) {
            day.events.push(FinancialCalendarEventDto {
                kind: FinancialCalendarEventKind::CardPayment,
                id,
                title,
                amount_jpy: amount,
                status: Some(status),
            });
        }
    }
    Ok(())
}

fn period_metrics(
    connection: &Connection,
    household_id: &str,
    account_group_id: Option<&str>,
    start: &str,
    end: &str,
) -> Result<PeriodMetricsDto, FinancialCalendarError> {
    let (income, expense, count): (i64, i64, u64) = connection
        .query_row(
            "SELECT
               COALESCE(SUM(CASE WHEN a.account_kind = 'INCOME'
                 THEN CASE je.entry_side WHEN 'CREDIT' THEN je.amount_jpy ELSE -je.amount_jpy END ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN a.account_kind = 'EXPENSE'
                 THEN CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END ELSE 0 END), 0),
               count(DISTINCT t.id)
             FROM transactions t
             LEFT JOIN journal_entries je ON je.transaction_id = t.id
             LEFT JOIN accounts a ON a.id = je.account_id
             WHERE t.household_id = ?1 AND t.status = 'POSTED'
               AND t.occurred_on >= ?2 AND t.occurred_on < ?3
               AND t.transaction_type != 'CARD_PAYMENT'
               AND (?4 IS NULL OR EXISTS (
                 SELECT 1 FROM journal_entries scope_je JOIN account_group_members scope_gm
                   ON scope_gm.account_id = scope_je.account_id AND scope_gm.household_id = t.household_id
                 WHERE scope_je.transaction_id = t.id AND scope_gm.account_group_id = ?4))",
            params![household_id, start, end, account_group_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(db_error)?;
    let savings = income - expense;
    Ok(PeriodMetricsDto {
        income_jpy: income,
        expense_jpy: expense,
        savings_jpy: savings,
        savings_rate_bps: ratio_bps(savings, income),
        posted_transaction_count: count,
    })
}

fn budget_status(
    connection: &Connection,
    household_id: &str,
    start: &str,
    end: &str,
) -> Result<BudgetStatusDto, FinancialCalendarError> {
    let (budget, actual, categories, over): (i64, i64, u64, u64) = connection
        .query_row(
            "WITH actuals AS (
               SELECT strftime('%Y-%m', t.occurred_on) AS month, a.id AS category_id,
                 SUM(CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END) AS actual
               FROM transactions t JOIN journal_entries je ON je.transaction_id = t.id
               JOIN accounts a ON a.id = je.account_id AND a.account_kind = 'EXPENSE'
               WHERE t.household_id = ?1 AND t.status = 'POSTED'
                 AND t.occurred_on >= ?2 AND t.occurred_on < ?3
               GROUP BY strftime('%Y-%m', t.occurred_on), a.id
             ), scoped AS (
               SELECT b.budget_jpy, COALESCE(x.actual, 0) actual
               FROM monthly_category_budgets b
               LEFT JOIN actuals x ON x.month = b.month AND x.category_id = b.category_account_id
               WHERE b.household_id = ?1 AND b.month >= substr(?2, 1, 7) AND b.month < substr(?3, 1, 7)
             ) SELECT COALESCE(SUM(budget_jpy),0), COALESCE(SUM(actual),0), count(*),
                 COALESCE(SUM(CASE WHEN actual > budget_jpy THEN 1 ELSE 0 END),0) FROM scoped",
            params![household_id, start, end],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(db_error)?;
    Ok(BudgetStatusDto {
        budget_jpy: budget,
        actual_jpy: actual,
        remaining_jpy: budget - actual,
        utilization_bps: ratio_bps(actual, budget),
        category_count: categories,
        over_budget_count: over,
    })
}

fn goals_summary(
    connection: &Connection,
    household_id: &str,
    period_start: &str,
    period_end: &str,
) -> Result<GoalProgressSummaryDto, FinancialCalendarError> {
    let (count, target, saved, due): (u64, i64, i64, u64) = connection
        .query_row(
            "SELECT count(*), COALESCE(SUM(target_jpy),0), COALESCE(SUM(saved_jpy),0),
               COALESCE(SUM(CASE WHEN target_date >= ?2 AND target_date < ?3 THEN 1 ELSE 0 END),0)
             FROM savings_goals WHERE household_id = ?1 AND status = 'ACTIVE'",
            params![household_id, period_start, period_end],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(db_error)?;
    Ok(GoalProgressSummaryDto {
        active_count: count,
        target_jpy: target,
        saved_jpy: saved,
        remaining_jpy: target.saturating_sub(saved),
        due_within_period_count: due,
    })
}

fn data_quality(
    connection: &Connection,
    household_id: &str,
    as_of: &str,
) -> Result<DataQualitySummaryDto, FinancialCalendarError> {
    let (total, posted, review, failed, in_progress, latest, stale_days): (
        u64,
        u64,
        u64,
        u64,
        u64,
        Option<String>,
        Option<i64>,
    ) = connection
        .query_row(
            "SELECT count(*),
               COALESCE(SUM(CASE WHEN status = 'POSTED' THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN status = 'REVIEW_REQUIRED' THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN status IN ('DISCOVERED','EXTRACTING') THEN 1 ELSE 0 END),0),
               (SELECT MAX(sd.imported_at) FROM source_documents sd WHERE sd.household_id = ?1),
               CASE WHEN (SELECT MAX(sd.imported_at) FROM source_documents sd WHERE sd.household_id = ?1) IS NULL THEN NULL
                    ELSE MAX(0, CAST(julianday(?2) - julianday(date(
                      (SELECT MAX(sd.imported_at) FROM source_documents sd WHERE sd.household_id = ?1)
                    )) AS INTEGER)) END
             FROM import_runs WHERE household_id = ?1 AND status != 'ROLLED_BACK'",
            params![household_id, as_of],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .map_err(db_error)?;
    Ok(DataQualitySummaryDto {
        total_imports: total,
        posted_imports: posted,
        review_required_imports: review,
        failed_imports: failed,
        in_progress_imports: in_progress,
        import_completion_bps: ratio_bps(posted as i64, total as i64),
        latest_imported_at: latest,
        stale_days,
        has_unresolved_imports: review + failed + in_progress > 0,
    })
}

fn reconciliation_summary(
    connection: &Connection,
    household_id: &str,
    account_group_id: Option<&str>,
    start: &str,
    end: &str,
) -> Result<ReconciliationSummaryDto, FinancialCalendarError> {
    connection
        .query_row(
            "SELECT count(*),
               COALESCE(SUM(CASE WHEN reconciliation_status = 'FULLY_RECONCILED' THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN reconciliation_status = 'POSSIBLE_MATCH' THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN reconciliation_status = 'PARTIALLY_RECONCILED' THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN reconciliation_status = 'UNMATCHED' THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN reconciliation_status IN ('OVERPAID','UNDERPAID') THEN 1 ELSE 0 END),0),
               COALESCE((SELECT SUM(cp.payment_amount_jpy) FROM card_payments cp
                 WHERE cp.household_id = ?1 AND cp.payment_on >= ?2 AND cp.payment_on < ?3
                   AND (?4 IS NULL OR EXISTS (SELECT 1 FROM account_group_members gm
                     WHERE gm.household_id = cp.household_id AND gm.account_group_id = ?4
                       AND (gm.account_id = cp.card_account_id OR EXISTS (
                         SELECT 1 FROM journal_entries payment_je
                         WHERE payment_je.transaction_id = cp.bank_transaction_id
                           AND payment_je.account_id = gm.account_id))))),0)
             FROM card_statements cs WHERE household_id = ?1 AND period_end >= ?2 AND period_end < ?3
               AND (?4 IS NULL OR EXISTS (SELECT 1 FROM account_group_members gm
                 WHERE gm.household_id = cs.household_id AND gm.account_group_id = ?4
                   AND gm.account_id = cs.card_account_id))",
            params![household_id, start, end, account_group_id],
            |row| {
                Ok(ReconciliationSummaryDto {
                    total_statements: row.get(0)?,
                    fully_reconciled: row.get(1)?,
                    possible_matches: row.get(2)?,
                    partially_reconciled: row.get(3)?,
                    unmatched: row.get(4)?,
                    mismatch_count: row.get(5)?,
                    payment_total_jpy: row.get(6)?,
                })
            },
        )
        .map_err(db_error)
}

fn category_drivers(
    connection: &Connection,
    household_id: &str,
    account_group_id: Option<&str>,
    current_start: &str,
    current_end: &str,
    previous_start: &str,
    previous_end: &str,
) -> Result<Vec<CategoryDriverDto>, FinancialCalendarError> {
    let mut statement = connection
        .prepare(
            "WITH totals AS (
               SELECT a.id, a.name,
                 SUM(CASE WHEN t.occurred_on >= ?2 AND t.occurred_on < ?3
                   THEN CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END ELSE 0 END) current_jpy,
                 SUM(CASE WHEN t.occurred_on >= ?4 AND t.occurred_on < ?5
                   THEN CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END ELSE 0 END) previous_jpy
               FROM transactions t JOIN journal_entries je ON je.transaction_id = t.id
               JOIN accounts a ON a.id = je.account_id AND a.account_kind = 'EXPENSE'
               WHERE t.household_id = ?1 AND t.status = 'POSTED'
                 AND ((t.occurred_on >= ?2 AND t.occurred_on < ?3) OR
                      (t.occurred_on >= ?4 AND t.occurred_on < ?5))
                 AND (?6 IS NULL OR EXISTS (
                   SELECT 1 FROM journal_entries scope_je JOIN account_group_members scope_gm
                     ON scope_gm.account_id = scope_je.account_id AND scope_gm.household_id = t.household_id
                   WHERE scope_je.transaction_id = t.id AND scope_gm.account_group_id = ?6))
               GROUP BY a.id, a.name
             ) SELECT id, name, current_jpy, previous_jpy, current_jpy - previous_jpy
               FROM totals ORDER BY abs(current_jpy - previous_jpy) DESC, current_jpy DESC, name LIMIT ?7",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map(
            params![
                household_id,
                current_start,
                current_end,
                previous_start,
                previous_end,
                account_group_id,
                TOP_DRIVER_LIMIT
            ],
            |row| {
                Ok(CategoryDriverDto {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    current_jpy: row.get(2)?,
                    previous_jpy: row.get(3)?,
                    delta_jpy: row.get(4)?,
                })
            },
        )
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

fn merchant_drivers(
    connection: &Connection,
    household_id: &str,
    account_group_id: Option<&str>,
    current_start: &str,
    current_end: &str,
    previous_start: &str,
    previous_end: &str,
) -> Result<Vec<MerchantDriverDto>, FinancialCalendarError> {
    let mut statement = connection
        .prepare(
            "WITH tx_expense AS (
               SELECT t.id, t.occurred_on,
                 COALESCE(NULLIF(trim(t.payee), ''), NULLIF(trim(t.description), ''), 'Unspecified') merchant,
                 SUM(CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END) amount
               FROM transactions t JOIN journal_entries je ON je.transaction_id = t.id
               JOIN accounts a ON a.id = je.account_id AND a.account_kind = 'EXPENSE'
               WHERE t.household_id = ?1 AND t.status = 'POSTED'
                 AND ((t.occurred_on >= ?2 AND t.occurred_on < ?3) OR
                      (t.occurred_on >= ?4 AND t.occurred_on < ?5))
                 AND (?6 IS NULL OR EXISTS (
                   SELECT 1 FROM journal_entries scope_je JOIN account_group_members scope_gm
                     ON scope_gm.account_id = scope_je.account_id AND scope_gm.household_id = t.household_id
                   WHERE scope_je.transaction_id = t.id AND scope_gm.account_group_id = ?6))
               GROUP BY t.id, t.occurred_on, t.payee, t.description
             ), totals AS (
               SELECT merchant,
                 SUM(CASE WHEN occurred_on >= ?2 AND occurred_on < ?3 THEN amount ELSE 0 END) current_jpy,
                 SUM(CASE WHEN occurred_on >= ?4 AND occurred_on < ?5 THEN amount ELSE 0 END) previous_jpy
               FROM tx_expense GROUP BY merchant
             ) SELECT merchant, current_jpy, previous_jpy, current_jpy - previous_jpy
               FROM totals ORDER BY abs(current_jpy - previous_jpy) DESC, current_jpy DESC, merchant LIMIT ?7",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map(
            params![
                household_id,
                current_start,
                current_end,
                previous_start,
                previous_end,
                account_group_id,
                TOP_DRIVER_LIMIT
            ],
            |row| {
                Ok(MerchantDriverDto {
                    merchant: row.get(0)?,
                    current_jpy: row.get(1)?,
                    previous_jpy: row.get(2)?,
                    delta_jpy: row.get(3)?,
                })
            },
        )
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

fn metric_deltas(current: &PeriodMetricsDto, previous: &PeriodMetricsDto) -> MetricDeltaSetDto {
    MetricDeltaSetDto {
        income: metric_delta(current.income_jpy, previous.income_jpy),
        expense: metric_delta(current.expense_jpy, previous.expense_jpy),
        savings: metric_delta(current.savings_jpy, previous.savings_jpy),
    }
}

fn metric_delta(current: i64, previous: i64) -> MetricDeltaDto {
    MetricDeltaDto {
        amount_jpy: current.saturating_sub(previous),
        rate_bps: ratio_bps(current.saturating_sub(previous), previous.abs()),
    }
}

fn ratio_bps(numerator: i64, denominator: i64) -> Option<i64> {
    if denominator == 0 {
        return None;
    }
    let ratio = (i128::from(numerator) * 10_000) / i128::from(denominator);
    Some(ratio.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64)
}

fn validate_household(
    connection: &Connection,
    household_id: &str,
) -> Result<(), FinancialCalendarError> {
    if household_id.is_empty()
        || household_id.len() > MAX_ID_LEN
        || !household_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
    {
        return Err(FinancialCalendarError::InvalidInput(
            "Household identifier is invalid",
        ));
    }
    let exists = connection
        .query_row(
            "SELECT 1 FROM households WHERE id = ?1",
            [household_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(db_error)?
        .is_some();
    if !exists {
        return Err(FinancialCalendarError::NotFound);
    }
    Ok(())
}

fn validate_account_group_scope(
    connection: &Connection,
    household_id: &str,
    group_id: Option<&str>,
) -> Result<(), FinancialCalendarError> {
    crate::account_groups_export::validate_account_group_scope(connection, household_id, group_id)
        .map_err(|error| match error {
            crate::account_groups_export::AccountGroupExportError::InvalidInput(message) => {
                FinancialCalendarError::InvalidInput(message)
            }
            crate::account_groups_export::AccountGroupExportError::NotFound => {
                FinancialCalendarError::NotFound
            }
            _ => FinancialCalendarError::Unavailable,
        })
}

fn month_start(connection: &Connection, month: &str) -> Result<String, FinancialCalendarError> {
    if month.len() != 7 || !month.is_ascii() {
        return Err(FinancialCalendarError::InvalidInput("Month is invalid"));
    }
    let candidate = format!("{month}-01");
    let normalized: Option<String> = connection
        .query_row("SELECT date(?1)", [&candidate], |row| row.get(0))
        .map_err(db_error)?;
    if normalized.as_deref() != Some(candidate.as_str()) {
        return Err(FinancialCalendarError::InvalidInput("Month is invalid"));
    }
    Ok(candidate)
}

fn year_start(connection: &Connection, year: &str) -> Result<String, FinancialCalendarError> {
    if year.len() != 4 || !year.bytes().all(|value| value.is_ascii_digit()) {
        return Err(FinancialCalendarError::InvalidInput("Year is invalid"));
    }
    let candidate = format!("{year}-01-01");
    let normalized: Option<String> = connection
        .query_row("SELECT date(?1)", [&candidate], |row| row.get(0))
        .map_err(db_error)?;
    if normalized.as_deref() != Some(candidate.as_str()) {
        return Err(FinancialCalendarError::InvalidInput("Year is invalid"));
    }
    Ok(candidate)
}

fn resolve_as_of(
    connection: &Connection,
    requested: Option<&str>,
) -> Result<String, FinancialCalendarError> {
    match requested {
        Some(value) if value.len() == 10 => {
            let normalized: Option<String> = connection
                .query_row("SELECT date(?1)", [value], |row| row.get(0))
                .map_err(db_error)?;
            if normalized.as_deref() == Some(value) {
                Ok(value.to_owned())
            } else {
                Err(FinancialCalendarError::InvalidInput(
                    "As-of date is invalid",
                ))
            }
        }
        Some(_) => Err(FinancialCalendarError::InvalidInput(
            "As-of date is invalid",
        )),
        None => connection
            .query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
            .map_err(db_error),
    }
}

fn date_shift(
    connection: &Connection,
    date: &str,
    modifier: &str,
) -> Result<String, FinancialCalendarError> {
    connection
        .query_row("SELECT date(?1, ?2)", params![date, modifier], |row| {
            row.get(0)
        })
        .map_err(db_error)
}

fn event_rank(kind: &FinancialCalendarEventKind) -> u8 {
    match kind {
        FinancialCalendarEventKind::CardPaymentDue => 0,
        FinancialCalendarEventKind::CardClosing => 1,
        FinancialCalendarEventKind::CardPayment => 2,
        FinancialCalendarEventKind::CashOutflow => 3,
        FinancialCalendarEventKind::CashInflow => 4,
    }
}

// Commands keep this feature independent from the central platform client.
#[tauri::command]
pub fn financial_calendar_query(
    state: tauri::State<'_, AppState>,
    request: FinancialCalendarRequest,
) -> Result<FinancialCalendarDto, String> {
    let result = state.with_connection(|connection| Ok(financial_calendar(connection, &request)));
    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(error.public_message().to_owned()),
        Err(_) => Err("Financial calendar data is temporarily unavailable".to_owned()),
    }
}

#[tauri::command]
pub fn financial_report_monthly_query(
    state: tauri::State<'_, AppState>,
    request: MonthlyFinancialReportRequest,
) -> Result<MonthlyFinancialReportDto, String> {
    let result = state.with_connection(|connection| Ok(monthly_report(connection, &request)));
    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(error.public_message().to_owned()),
        Err(_) => Err("Financial calendar data is temporarily unavailable".to_owned()),
    }
}

#[tauri::command]
pub fn financial_report_yearly_query(
    state: tauri::State<'_, AppState>,
    request: YearlyFinancialReportRequest,
) -> Result<YearlyFinancialReportDto, String> {
    let result = state.with_connection(|connection| Ok(yearly_report(connection, &request)));
    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(error.public_message().to_owned()),
        Err(_) => Err("Financial calendar data is temporarily unavailable".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON;
                 CREATE TABLE households (id TEXT PRIMARY KEY, name TEXT);
                 CREATE TABLE accounts (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   name TEXT NOT NULL, account_kind TEXT NOT NULL, account_subtype TEXT NOT NULL
                 );
                 CREATE TABLE transactions (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   occurred_on TEXT NOT NULL, transaction_type TEXT NOT NULL,
                   payee TEXT, description TEXT, status TEXT NOT NULL
                 );
                 CREATE TABLE journal_entries (
                   id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id),
                   account_id TEXT NOT NULL REFERENCES accounts(id), entry_side TEXT NOT NULL,
                   amount_jpy INTEGER NOT NULL
                 );
                 CREATE TABLE card_statements (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   card_account_id TEXT NOT NULL REFERENCES accounts(id), period_start TEXT NOT NULL,
                   period_end TEXT NOT NULL, payment_due_on TEXT, statement_amount_jpy INTEGER NOT NULL,
                   reconciliation_status TEXT NOT NULL
                 );
                 CREATE TABLE card_payments (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
                   statement_id TEXT, bank_transaction_id TEXT NOT NULL REFERENCES transactions(id),
                   card_account_id TEXT NOT NULL REFERENCES accounts(id), payment_amount_jpy INTEGER NOT NULL,
                   payment_on TEXT NOT NULL, reconciliation_status TEXT NOT NULL
                 );
                 CREATE TABLE monthly_category_budgets (
                   household_id TEXT NOT NULL, month TEXT NOT NULL, category_account_id TEXT NOT NULL,
                   budget_jpy INTEGER NOT NULL
                 );
                 CREATE TABLE savings_goals (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL, target_jpy INTEGER NOT NULL,
                   saved_jpy INTEGER NOT NULL, target_date TEXT NOT NULL, status TEXT NOT NULL
                 );
                 CREATE TABLE import_runs (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL, status TEXT NOT NULL,
                   started_at TEXT NOT NULL
                 );
                 CREATE TABLE source_documents (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL, imported_at TEXT NOT NULL
                 );
                 CREATE TABLE account_groups (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL,
                   group_kind TEXT NOT NULL, sort_order INTEGER NOT NULL
                 );
                 CREATE TABLE account_group_members (
                   household_id TEXT NOT NULL, account_group_id TEXT NOT NULL,
                   account_id TEXT NOT NULL, sort_order INTEGER NOT NULL
                 );
                 INSERT INTO households VALUES ('family','Family');
                 INSERT INTO accounts VALUES
                   ('bank','family','Bank','ASSET','BANK'),
                   ('income','family','Income','INCOME','OTHER'),
                   ('groceries','family','Groceries','EXPENSE','OTHER'),
                   ('card','family','Card','LIABILITY','CREDIT_CARD');",
            )
            .unwrap();
        add_transaction(
            &connection,
            "income-jul",
            "2026-07-05",
            "INCOME",
            "Salary",
            "bank",
            "DEBIT",
            "income",
            "CREDIT",
            300_000,
        );
        add_transaction(
            &connection,
            "card-jul",
            "2026-07-10",
            "CARD_PURCHASE",
            "Market",
            "groceries",
            "DEBIT",
            "card",
            "CREDIT",
            50_000,
        );
        add_transaction(
            &connection,
            "cash-jul",
            "2026-07-12",
            "EXPENSE",
            "Cafe",
            "groceries",
            "DEBIT",
            "bank",
            "CREDIT",
            20_000,
        );
        add_transaction(
            &connection,
            "payment-jul",
            "2026-07-27",
            "CARD_PAYMENT",
            "Card payment",
            "card",
            "DEBIT",
            "bank",
            "CREDIT",
            70_000,
        );
        add_transaction(
            &connection,
            "income-jun",
            "2026-06-05",
            "INCOME",
            "Salary",
            "bank",
            "DEBIT",
            "income",
            "CREDIT",
            250_000,
        );
        add_transaction(
            &connection,
            "expense-jun",
            "2026-06-11",
            "EXPENSE",
            "Market",
            "groceries",
            "DEBIT",
            "bank",
            "CREDIT",
            40_000,
        );
        add_transaction(
            &connection,
            "income-prev",
            "2025-07-05",
            "INCOME",
            "Salary",
            "bank",
            "DEBIT",
            "income",
            "CREDIT",
            280_000,
        );
        add_transaction(
            &connection,
            "expense-prev",
            "2025-07-11",
            "EXPENSE",
            "Market",
            "groceries",
            "DEBIT",
            "bank",
            "CREDIT",
            45_000,
        );
        connection.execute_batch(
            "INSERT INTO card_statements VALUES
               ('statement','family','card','2026-06-16','2026-07-15','2026-07-27',70000,'POSSIBLE_MATCH');
             INSERT INTO card_payments VALUES
               ('payment','family','statement','payment-jul','card',70000,'2026-07-27','FULLY_RECONCILED');
             INSERT INTO monthly_category_budgets VALUES ('family','2026-07','groceries',60000);
             INSERT INTO monthly_category_budgets VALUES ('family','2026-06','groceries',50000);
             INSERT INTO savings_goals VALUES ('goal','family',100000,20000,'2026-07-31','ACTIVE');
             INSERT INTO import_runs VALUES
               ('posted','family','POSTED','2026-07-12T10:00:00Z'),
               ('review','family','REVIEW_REQUIRED','2026-07-13T10:00:00Z');
             INSERT INTO source_documents VALUES ('document','family','2026-07-13T10:00:00Z');",
        ).unwrap();
        connection
    }

    #[allow(clippy::too_many_arguments)]
    fn add_transaction(
        connection: &Connection,
        id: &str,
        date: &str,
        kind: &str,
        payee: &str,
        debit_account: &str,
        debit_side: &str,
        credit_account: &str,
        credit_side: &str,
        amount: i64,
    ) {
        connection
            .execute(
                "INSERT INTO transactions VALUES (?1,'family',?2,?3,?4,NULL,'POSTED')",
                params![id, date, kind, payee],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO journal_entries VALUES (?1,?2,?3,?4,?5)",
                params![format!("{id}-d"), id, debit_account, debit_side, amount],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO journal_entries VALUES (?1,?2,?3,?4,?5)",
                params![format!("{id}-c"), id, credit_account, credit_side, amount],
            )
            .unwrap();
    }

    #[test]
    fn calendar_combines_accrual_cash_card_budget_goal_and_quality_events() {
        let connection = database();
        let result = financial_calendar(
            &connection,
            &FinancialCalendarRequest {
                household_id: "family".into(),
                account_group_id: None,
                month: "2026-07".into(),
                as_of: Some("2026-07-31".into()),
            },
        )
        .unwrap();
        assert_eq!(result.days.len(), 31);
        let card_purchase = &result.days[9];
        assert_eq!(card_purchase.accrual_expense_jpy, 50_000);
        assert_eq!(card_purchase.cash_outflow_jpy, 0);
        assert!(!card_purchase.no_spend_day);
        let cash_purchase = &result.days[11];
        assert_eq!(cash_purchase.accrual_expense_jpy, 20_000);
        assert_eq!(cash_purchase.cash_outflow_jpy, 20_000);
        let payment = &result.days[26];
        assert_eq!(payment.cash_outflow_jpy, 70_000);
        assert!(payment
            .events
            .iter()
            .any(|event| event.kind == FinancialCalendarEventKind::CardPaymentDue));
        assert!(payment
            .events
            .iter()
            .any(|event| event.kind == FinancialCalendarEventKind::CardPayment));
        assert_eq!(result.budget.budget_jpy, 60_000);
        assert_eq!(result.budget.actual_jpy, 70_000);
        assert_eq!(result.budget.over_budget_count, 1);
        assert_eq!(result.goals.remaining_jpy, 80_000);
        assert_eq!(result.goals.due_within_period_count, 1);
        assert_eq!(result.data_quality.import_completion_bps, Some(5_000));
        assert!(result.data_quality.has_unresolved_imports);
    }

    #[test]
    fn monthly_report_compares_periods_and_excludes_card_settlement_from_expense() {
        let connection = database();
        let result = monthly_report(
            &connection,
            &MonthlyFinancialReportRequest {
                household_id: "family".into(),
                account_group_id: None,
                month: "2026-07".into(),
                as_of: Some("2026-07-31".into()),
            },
        )
        .unwrap();
        assert_eq!(result.current.income_jpy, 300_000);
        assert_eq!(result.current.expense_jpy, 70_000);
        assert_eq!(result.current.savings_jpy, 230_000);
        assert_eq!(result.current.savings_rate_bps, Some(7_666));
        assert_eq!(result.prior_month.expense_jpy, 40_000);
        assert_eq!(result.prior_year.expense_jpy, 45_000);
        assert_eq!(result.vs_prior_month.expense.amount_jpy, 30_000);
        assert_eq!(result.top_category_drivers[0].id, "groceries");
        assert_eq!(result.reconciliation.total_statements, 1);
        assert_eq!(result.reconciliation.possible_matches, 1);
        assert_eq!(result.reconciliation.payment_total_jpy, 70_000);
    }

    #[test]
    fn yearly_report_returns_twelve_authoritative_months() {
        let connection = database();
        let result = yearly_report(
            &connection,
            &YearlyFinancialReportRequest {
                household_id: "family".into(),
                account_group_id: None,
                year: "2026".into(),
                as_of: Some("2026-12-31".into()),
            },
        )
        .unwrap();
        assert_eq!(result.months.len(), 12);
        assert_eq!(result.months[5].month, "2026-06");
        assert_eq!(result.months[5].metrics.expense_jpy, 40_000);
        assert_eq!(result.months[6].metrics.expense_jpy, 70_000);
        assert_eq!(result.current.income_jpy, 550_000);
        assert_eq!(result.prior_year.income_jpy, 280_000);
    }

    #[test]
    fn saved_account_group_scopes_calendar_and_reports_without_duplicate_transactions() {
        let connection = database();
        connection
            .execute_batch(
                "INSERT INTO account_groups VALUES ('spending','family','Spending','CUSTOM',0);
                 INSERT INTO account_group_members VALUES
                   ('family','spending','groceries',0),
                   ('family','spending','card',1);
                 INSERT INTO households VALUES ('other','Other');
                 INSERT INTO account_groups VALUES ('foreign','other','Foreign','CUSTOM',0);",
            )
            .unwrap();
        let calendar = financial_calendar(
            &connection,
            &FinancialCalendarRequest {
                household_id: "family".into(),
                account_group_id: Some("spending".into()),
                month: "2026-07".into(),
                as_of: Some("2026-07-31".into()),
            },
        )
        .unwrap();
        assert_eq!(calendar.days[9].posted_transaction_count, 1);
        assert_eq!(calendar.days[9].accrual_expense_jpy, 50_000);
        assert_eq!(calendar.days[11].posted_transaction_count, 1);
        assert_eq!(calendar.days[4].posted_transaction_count, 0);

        let report = monthly_report(
            &connection,
            &MonthlyFinancialReportRequest {
                household_id: "family".into(),
                account_group_id: Some("spending".into()),
                month: "2026-07".into(),
                as_of: Some("2026-07-31".into()),
            },
        )
        .unwrap();
        assert_eq!(report.current.income_jpy, 0);
        assert_eq!(report.current.expense_jpy, 70_000);
        assert_eq!(report.current.posted_transaction_count, 2);

        assert!(matches!(
            yearly_report(
                &connection,
                &YearlyFinancialReportRequest {
                    household_id: "family".into(),
                    account_group_id: Some("foreign".into()),
                    year: "2026".into(),
                    as_of: None,
                }
            ),
            Err(FinancialCalendarError::NotFound)
        ));
    }

    #[test]
    fn rejects_noncanonical_periods_and_missing_households() {
        let connection = database();
        let invalid_month = financial_calendar(
            &connection,
            &FinancialCalendarRequest {
                household_id: "family".into(),
                account_group_id: None,
                month: "2026-13".into(),
                as_of: None,
            },
        );
        assert!(matches!(
            invalid_month,
            Err(FinancialCalendarError::InvalidInput(_))
        ));
        let missing = yearly_report(
            &connection,
            &YearlyFinancialReportRequest {
                household_id: "missing".into(),
                account_group_id: None,
                year: "2026".into(),
                as_of: None,
            },
        );
        assert!(matches!(missing, Err(FinancialCalendarError::NotFound)));
    }
}
