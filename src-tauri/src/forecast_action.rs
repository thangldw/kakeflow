use crate::card_settlement_mapping::{
    balance_coverage, CardSettlementBalanceCoverageRequest, CardSettlementCoverageStatus,
};
use crate::persistence::AppState;
use crate::record_scope::{validate_attribution_scope, AttributionScope};
use crate::recurring_analytics::{
    query_financial_intelligence, FinancialIntelligenceRequest, RecurringItemDto,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const HISTORY_MONTHS: i64 = 3;
const FORECAST_MONTHS: i64 = 3;
const MAX_ACTION_ITEMS: usize = 100;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastActionRequest {
    pub household_id: String,
    pub as_of: String,
    #[serde(default)]
    pub account_group_id: Option<String>,
    #[serde(default)]
    pub attribution_scope: AttributionScope,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForecastActionDto {
    pub as_of: String,
    pub forecast_from: String,
    pub forecast_through: String,
    pub opening_cash_jpy: i64,
    pub assumptions: ForecastAssumptionsDto,
    pub months: Vec<ForecastMonthDto>,
    pub actions: Vec<ActionItemDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForecastAssumptionsDto {
    pub history_from: String,
    pub history_through: String,
    pub history_months: u8,
    pub average_monthly_income_jpy: i64,
    pub average_monthly_expense_jpy: i64,
    pub average_monthly_non_recurring_expense_jpy: i64,
    pub average_monthly_cash_change_before_card_payments_jpy: i64,
    pub recurring_monthly_expense_jpy: i64,
    pub recurring_item_count: u32,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForecastMonthDto {
    pub month: String,
    pub opening_cash_jpy: i64,
    pub projected_income_jpy: i64,
    pub projected_non_recurring_expense_jpy: i64,
    pub projected_recurring_expense_jpy: i64,
    pub projected_savings_jpy: i64,
    pub projected_cash_change_before_card_payments_jpy: i64,
    pub known_card_payments_jpy: i64,
    pub projected_cash_change_jpy: i64,
    pub closing_cash_jpy: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActionPriority {
    Critical,
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActionKind {
    ImportReview,
    ImportFailed,
    CardMismatch,
    CardPaymentDue,
    CardBalanceShortfall,
    CardMappingRequired,
    BudgetOverrun,
    GoalDue,
    SpendingAnomaly,
    RecurringPriceChange,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActionItemDto {
    pub id: String,
    pub kind: ActionKind,
    pub priority: ActionPriority,
    pub title: String,
    pub detail: String,
    pub due_on: Option<String>,
    pub amount_jpy: Option<i64>,
    pub entity_id: Option<String>,
    pub reasons: Vec<String>,
}

#[derive(Default)]
struct HistoricalTotals {
    income: i64,
    expense: i64,
    cash_change_before_card_payments: i64,
}

pub fn query_forecast_action(
    connection: &Connection,
    request: &ForecastActionRequest,
) -> Result<ForecastActionDto, String> {
    validate_request(request)?;
    let as_of_day = parse_iso_day(&request.as_of).ok_or_else(|| "Invalid as-of date".to_owned())?;
    let (year, month, _) = civil_from_days(as_of_day);
    let current_month = format!("{year:04}-{month:02}");
    let forecast_from = shift_month(&current_month, 1)?;
    let forecast_through = shift_month(&forecast_from, FORECAST_MONTHS - 1)?;
    let history_through = shift_month(&current_month, -1)?;
    let history_from = shift_month(&history_through, -(HISTORY_MONTHS - 1))?;
    let history_start = format!("{history_from}-01");
    let history_end = end_of_month(&history_through)?;

    ensure_household(connection, &request.household_id)?;
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
    let intelligence = query_financial_intelligence(
        connection,
        &FinancialIntelligenceRequest {
            household_id: request.household_id.clone(),
            as_of: request.as_of.clone(),
            account_group_id: request.account_group_id.clone(),
            attribution_scope: request.attribution_scope.clone(),
        },
    )?;
    let recurring_monthly_expense = intelligence
        .recurring_items
        .iter()
        .map(monthly_recurring_amount)
        .sum::<i64>();
    let historical = historical_totals(
        connection,
        &request.household_id,
        &history_start,
        &history_end,
        request.account_group_id.as_deref(),
        &request.attribution_scope,
    )?;
    let average_income = historical.income / HISTORY_MONTHS;
    let average_expense = historical.expense / HISTORY_MONTHS;
    let average_non_recurring = average_expense
        .saturating_sub(recurring_monthly_expense)
        .max(0);
    let average_cash_change = historical.cash_change_before_card_payments / HISTORY_MONTHS;
    let opening_cash = cash_balance(
        connection,
        &request.household_id,
        &request.as_of,
        request.account_group_id.as_deref(),
    )?;

    let mut months = Vec::with_capacity(FORECAST_MONTHS as usize);
    let mut cash = opening_cash;
    for offset in 0..FORECAST_MONTHS {
        let forecast_month = shift_month(&forecast_from, offset)?;
        let known_card_payments = known_card_payments(
            connection,
            &request.household_id,
            &forecast_month,
            request.account_group_id.as_deref(),
            &request.attribution_scope,
        )?;
        let projected_savings = average_income
            .saturating_sub(average_non_recurring)
            .saturating_sub(recurring_monthly_expense);
        let projected_cash_change = average_cash_change.saturating_sub(known_card_payments);
        let closing_cash = cash.saturating_add(projected_cash_change);
        months.push(ForecastMonthDto {
            month: forecast_month,
            opening_cash_jpy: cash,
            projected_income_jpy: average_income,
            projected_non_recurring_expense_jpy: average_non_recurring,
            projected_recurring_expense_jpy: recurring_monthly_expense,
            projected_savings_jpy: projected_savings,
            projected_cash_change_before_card_payments_jpy: average_cash_change,
            known_card_payments_jpy: known_card_payments,
            projected_cash_change_jpy: projected_cash_change,
            closing_cash_jpy: closing_cash,
        });
        cash = closing_cash;
    }

    let actions = action_items(
        connection,
        request,
        as_of_day,
        &current_month,
        &intelligence,
    )?;
    Ok(ForecastActionDto {
        as_of: request.as_of.clone(),
        forecast_from,
        forecast_through,
        opening_cash_jpy: opening_cash,
        assumptions: ForecastAssumptionsDto {
            history_from,
            history_through,
            history_months: HISTORY_MONTHS as u8,
            average_monthly_income_jpy: average_income,
            average_monthly_expense_jpy: average_expense,
            average_monthly_non_recurring_expense_jpy: average_non_recurring,
            average_monthly_cash_change_before_card_payments_jpy: average_cash_change,
            recurring_monthly_expense_jpy: recurring_monthly_expense,
            recurring_item_count: intelligence.recurring_items.len() as u32,
            reasons: {
                let mut reasons = vec![
                "Income, expense, and cash baselines are simple averages of the three completed calendar months before the as-of month".to_owned(),
                "Savings uses posted accrual income and expense; card settlement is not counted as expense again".to_owned(),
                "Cash change excludes historical card payments, then subtracts known unreconciled statement amounts in their due month".to_owned(),
                "Recurring estimates come only from explainable patterns in this household's posted ledger".to_owned(),
                ];
                if request.attribution_scope.sql_kind() != "ALL" {
                    reasons.push("Forecast history is filtered by transaction attribution. Card statements with exact linked transactions are selected by that attribution, while each selected or unlinked statement remains a household-wide payment because settlement amounts cannot be allocated reliably by member".to_owned());
                    reasons.push("Opening cash is an account balance fact and remains household-wide or account-group-wide; transaction attribution does not partition account balances".to_owned());
                }
                reasons
            },
        },
        months,
        actions,
    })
}

fn validate_request(request: &ForecastActionRequest) -> Result<(), String> {
    if request.household_id.trim().is_empty() || request.household_id.len() > 64 {
        return Err("Household is required".to_owned());
    }
    if parse_iso_day(&request.as_of).is_none() {
        return Err("Invalid as-of date".to_owned());
    }
    Ok(())
}

fn ensure_household(connection: &Connection, household_id: &str) -> Result<(), String> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM households WHERE id = ?1",
            [household_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(unavailable)?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err("The requested household was not found".to_owned())
    }
}

fn historical_totals(
    connection: &Connection,
    household_id: &str,
    from: &str,
    through: &str,
    account_group_id: Option<&str>,
    attribution_scope: &AttributionScope,
) -> Result<HistoricalTotals, String> {
    connection
        .query_row(
            "SELECT
               COALESCE(SUM(CASE WHEN a.account_kind = 'INCOME' AND e.entry_side = 'CREDIT'
                                 THEN e.amount_jpy ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN a.account_kind = 'EXPENSE' AND e.entry_side = 'DEBIT'
                                  AND t.transaction_type IN ('EXPENSE','CARD_PURCHASE','FEE','INTEREST')
                                 THEN e.amount_jpy ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN a.account_kind = 'ASSET'
                                  AND a.account_subtype IN ('BANK','CASH','WALLET')
                                  AND t.transaction_type <> 'CARD_PAYMENT'
                                 THEN CASE e.entry_side WHEN 'DEBIT' THEN e.amount_jpy ELSE -e.amount_jpy END
                                 ELSE 0 END), 0)
             FROM transactions t
             JOIN journal_entries e ON e.transaction_id = t.id
             JOIN accounts a ON a.id = e.account_id AND a.household_id = t.household_id
             WHERE t.household_id = ?1 AND t.status = 'POSTED'
               AND t.calculation_target = 1
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
                        AND t.attributed_member_id = ?6))",
            params![
                household_id,
                from,
                through,
                account_group_id,
                attribution_scope.sql_kind(),
                attribution_scope.member_id()
            ],
            |row| {
                Ok(HistoricalTotals {
                    income: row.get(0)?,
                    expense: row.get(1)?,
                    cash_change_before_card_payments: row.get(2)?,
                })
            },
        )
        .map_err(unavailable)
}

fn cash_balance(
    connection: &Connection,
    household_id: &str,
    as_of: &str,
    account_group_id: Option<&str>,
) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COALESCE(SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount_jpy ELSE -e.amount_jpy END), 0)
             FROM journal_entries e
             JOIN transactions t ON t.id = e.transaction_id AND t.status = 'POSTED'
             JOIN accounts a ON a.id = e.account_id AND a.household_id = t.household_id
             WHERE t.household_id = ?1 AND t.occurred_on <= ?2
               AND a.account_kind = 'ASSET' AND a.account_subtype IN ('BANK','CASH','WALLET')
               AND (?3 IS NULL OR EXISTS (
                    SELECT 1 FROM journal_entries scope_je
                    JOIN account_group_members scope_gm
                      ON scope_gm.account_id = scope_je.account_id
                     AND scope_gm.household_id = t.household_id
                    WHERE scope_je.transaction_id = t.id
                      AND scope_gm.account_group_id = ?3))",
            params![household_id, as_of, account_group_id],
            |row| row.get(0),
        )
        .map_err(unavailable)
}

fn known_card_payments(
    connection: &Connection,
    household_id: &str,
    month: &str,
    account_group_id: Option<&str>,
    attribution_scope: &AttributionScope,
) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COALESCE(SUM(MAX(cs.statement_amount_jpy - COALESCE(p.paid_jpy, 0), 0)), 0)
             FROM card_statements cs
             LEFT JOIN (
               SELECT statement_id, SUM(payment_amount_jpy) paid_jpy
               FROM card_payments WHERE statement_id IS NOT NULL GROUP BY statement_id
             ) p ON p.statement_id = cs.id
             WHERE cs.household_id = ?1 AND substr(cs.payment_due_on, 1, 7) = ?2
               AND cs.reconciliation_status <> 'FULLY_RECONCILED'
               AND (?3 IS NULL OR EXISTS (
                    SELECT 1 FROM account_group_members scope_gm
                    WHERE scope_gm.household_id = cs.household_id
                      AND scope_gm.account_group_id = ?3
                      AND scope_gm.account_id = cs.card_account_id))
               AND (?4 = 'ALL'
                    OR NOT EXISTS (
                        SELECT 1 FROM card_statement_transactions any_cst
                        WHERE any_cst.statement_id = cs.id)
                    OR EXISTS (
                        SELECT 1 FROM card_statement_transactions scoped_cst
                        JOIN transactions scoped_t ON scoped_t.id = scoped_cst.transaction_id
                        WHERE scoped_cst.statement_id = cs.id
                          AND scoped_t.household_id = cs.household_id
                          AND ((?4 = 'HOUSEHOLD_COMMON' AND scoped_t.attribution_kind = 'HOUSEHOLD')
                               OR (?4 = 'MEMBER' AND scoped_t.attribution_kind = 'MEMBER'
                                   AND scoped_t.attributed_member_id = ?5))))",
            params![
                household_id,
                month,
                account_group_id,
                attribution_scope.sql_kind(),
                attribution_scope.member_id()
            ],
            |row| row.get(0),
        )
        .map_err(unavailable)
}

fn monthly_recurring_amount(item: &RecurringItemDto) -> i64 {
    match item.cadence.as_str() {
        "WEEKLY" => item.typical_amount_jpy.saturating_mul(52) / 12,
        "BIWEEKLY" => item.typical_amount_jpy.saturating_mul(26) / 12,
        "MONTHLY" => item.typical_amount_jpy,
        "QUARTERLY" => item.typical_amount_jpy / 3,
        "ANNUAL" => item.typical_amount_jpy / 12,
        _ => 0,
    }
}

fn action_items(
    connection: &Connection,
    request: &ForecastActionRequest,
    as_of_day: i64,
    current_month: &str,
    intelligence: &crate::recurring_analytics::FinancialIntelligenceDto,
) -> Result<Vec<ActionItemDto>, String> {
    let mut actions = Vec::new();
    // Import runs and savings goals are household-level entities without an account
    // association, so their warnings remain visible while an account group is selected.
    append_import_actions(connection, &request.household_id, &mut actions)?;
    append_card_actions(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
        &request.attribution_scope,
        as_of_day,
        &mut actions,
    )?;
    append_card_balance_shortfall_actions(
        connection,
        &request.household_id,
        &format_iso_day(as_of_day),
        &mut actions,
    )?;
    append_budget_actions(
        connection,
        &request.household_id,
        request.account_group_id.as_deref(),
        &request.attribution_scope,
        current_month,
        &mut actions,
    )?;
    append_goal_actions(connection, &request.household_id, as_of_day, &mut actions)?;

    for anomaly in intelligence.anomalies.iter().take(20) {
        actions.push(ActionItemDto {
            id: format!("anomaly:{}", anomaly.transaction_id),
            kind: ActionKind::SpendingAnomaly,
            priority: if anomaly.score_bps >= 8_000 {
                ActionPriority::High
            } else {
                ActionPriority::Medium
            },
            title: format!("Review unusual spending at {}", anomaly.display_payee),
            detail: format!(
                "¥{} compared with the historical median of ¥{}",
                anomaly.amount_jpy, anomaly.baseline_amount_jpy
            ),
            due_on: Some(anomaly.occurred_on.clone()),
            amount_jpy: Some(anomaly.amount_jpy),
            entity_id: Some(anomaly.transaction_id.clone()),
            reasons: anomaly.reasons.clone(),
        });
    }
    for item in intelligence
        .recurring_items
        .iter()
        .filter(|item| item.price_change_bps.is_some())
        .take(20)
    {
        actions.push(ActionItemDto {
            id: format!("recurring-price:{}", item.normalized_payee),
            kind: ActionKind::RecurringPriceChange,
            priority: ActionPriority::Medium,
            title: format!("Recurring price changed at {}", item.display_payee),
            detail: format!(
                "Latest ¥{}; typical ¥{}",
                item.latest_amount_jpy, item.typical_amount_jpy
            ),
            due_on: Some(item.next_expected_on.clone()),
            amount_jpy: Some(item.latest_amount_jpy),
            entity_id: None,
            reasons: item.reasons.clone(),
        });
    }
    actions.sort_by(|left, right| {
        priority_rank(&left.priority)
            .cmp(&priority_rank(&right.priority))
            .then(left.due_on.cmp(&right.due_on))
            .then(left.id.cmp(&right.id))
    });
    actions.truncate(MAX_ACTION_ITEMS);
    Ok(actions)
}

fn append_card_balance_shortfall_actions(
    connection: &Connection,
    household_id: &str,
    as_of: &str,
    actions: &mut Vec<ActionItemDto>,
) -> Result<(), String> {
    let coverage = balance_coverage(
        connection,
        &CardSettlementBalanceCoverageRequest {
            household_id: household_id.to_owned(),
            as_of: as_of.to_owned(),
            horizon_days: None,
        },
    )
    .map_err(|error| error.public_message().to_owned())?;
    for bank in coverage.banks {
        if bank.max_shortfall_jpy <= 0 {
            continue;
        }
        let due_on = bank
            .statements
            .iter()
            .find(|statement| statement.shortfall_jpy > 0)
            .map(|statement| statement.payment_due_on.clone());
        let has_overdue_shortfall = bank.statements.iter().any(|statement| {
            statement.shortfall_jpy > 0 && statement.status == CardSettlementCoverageStatus::Overdue
        });
        actions.push(ActionItemDto {
            id: format!("card-balance-shortfall:{}", bank.bank_account_id),
            kind: ActionKind::CardBalanceShortfall,
            priority: if has_overdue_shortfall {
                ActionPriority::Critical
            } else {
                ActionPriority::High
            },
            title: format!(
                "Fund {} for upcoming card settlements",
                bank.bank_account_name
            ),
            detail: format!(
                "Projected mapped card settlements exceed the bank balance by ¥{}",
                bank.max_shortfall_jpy
            ),
            due_on,
            amount_jpy: Some(bank.max_shortfall_jpy),
            entity_id: Some(bank.bank_account_id),
            reasons: vec![
                "This household-wide warning uses only explicit card-to-bank mappings".to_owned(),
                "Bank balance includes every posted journal entry regardless of calculation target"
                    .to_owned(),
            ],
        });
    }
    for statement in coverage.unmapped_statements {
        actions.push(ActionItemDto {
            id: format!("card-mapping-required:{}", statement.statement_id),
            kind: ActionKind::CardMappingRequired,
            priority: if statement.status
                == crate::card_settlement_mapping::UnmappedCardSettlementStatus::Overdue
            {
                ActionPriority::Critical
            } else {
                ActionPriority::High
            },
            title: format!("Choose a payment bank for {}", statement.card_account_name),
            detail: format!(
                "¥{} remains outstanding, but no explicit card-to-bank mapping exists",
                statement.outstanding_amount_jpy
            ),
            due_on: Some(statement.payment_due_on),
            amount_jpy: Some(statement.outstanding_amount_jpy),
            entity_id: Some(statement.card_account_id),
            reasons: vec![
                "KakeFlow never guesses card settlement bank relationships".to_owned(),
                "This warning is household-wide and independent of analytical filters".to_owned(),
            ],
        });
    }
    for statement in coverage.missing_due_statements {
        actions.push(ActionItemDto {
            id: format!("card-due-date-required:{}", statement.statement_id),
            kind: ActionKind::CardMappingRequired,
            priority: ActionPriority::High,
            title: format!("Add a payment due date for {}", statement.card_account_name),
            detail: format!(
                "¥{} remains outstanding but cannot be projected without a due date",
                statement.outstanding_amount_jpy
            ),
            due_on: None,
            amount_jpy: Some(statement.outstanding_amount_jpy),
            entity_id: Some(statement.card_account_id),
            reasons: vec![
                if statement.mapping_configured {
                    "A bank mapping exists, but the statement payment due date is missing"
                        .to_owned()
                } else {
                    "Both a bank mapping and statement payment due date are required".to_owned()
                },
                "The undated obligation is disclosed but excluded from chronological projection"
                    .to_owned(),
            ],
        });
    }
    Ok(())
}

fn append_import_actions(
    connection: &Connection,
    household_id: &str,
    actions: &mut Vec<ActionItemDto>,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(
            "SELECT status, COUNT(*) FROM import_runs WHERE household_id = ?1
         AND status IN ('REVIEW_REQUIRED','FAILED') GROUP BY status ORDER BY status",
        )
        .map_err(unavailable)?;
    let rows = statement
        .query_map([household_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(unavailable)?;
    for row in rows {
        let (status, count) = row.map_err(unavailable)?;
        let failed = status == "FAILED";
        actions.push(ActionItemDto {
            id: format!("imports:{}", status.to_lowercase()),
            kind: if failed {
                ActionKind::ImportFailed
            } else {
                ActionKind::ImportReview
            },
            priority: if failed {
                ActionPriority::High
            } else {
                ActionPriority::Medium
            },
            title: if failed {
                "Resolve failed imports".to_owned()
            } else {
                "Review imported transactions".to_owned()
            },
            detail: format!(
                "{count} import run(s) are {}",
                status.to_lowercase().replace('_', " ")
            ),
            due_on: None,
            amount_jpy: None,
            entity_id: None,
            reasons: vec![
                "Unresolved source data is excluded from confirmed financial totals".to_owned(),
            ],
        });
    }
    Ok(())
}

fn append_card_actions(
    connection: &Connection,
    household_id: &str,
    account_group_id: Option<&str>,
    attribution_scope: &AttributionScope,
    as_of_day: i64,
    actions: &mut Vec<ActionItemDto>,
) -> Result<(), String> {
    let through = format_iso_day(as_of_day + 90);
    let mut statement = connection.prepare(
        "SELECT cs.id, a.name, cs.payment_due_on, cs.statement_amount_jpy,
                cs.reconciliation_status, COALESCE(SUM(cp.payment_amount_jpy), 0)
         FROM card_statements cs JOIN accounts a ON a.id = cs.card_account_id
         LEFT JOIN card_payments cp ON cp.statement_id = cs.id
         WHERE cs.household_id = ?1 AND cs.reconciliation_status <> 'FULLY_RECONCILED'
           AND (cs.payment_due_on IS NULL OR cs.payment_due_on <= ?2)
           AND (?3 IS NULL OR EXISTS (
                SELECT 1 FROM account_group_members scope_gm
                WHERE scope_gm.household_id = cs.household_id
                  AND scope_gm.account_group_id = ?3
                  AND scope_gm.account_id = cs.card_account_id))
           AND (?4 = 'ALL'
                OR NOT EXISTS (
                    SELECT 1 FROM card_statement_transactions any_cst
                    WHERE any_cst.statement_id = cs.id)
                OR EXISTS (
                    SELECT 1 FROM card_statement_transactions scoped_cst
                    JOIN transactions scoped_t ON scoped_t.id = scoped_cst.transaction_id
                    WHERE scoped_cst.statement_id = cs.id
                      AND scoped_t.household_id = cs.household_id
                      AND ((?4 = 'HOUSEHOLD_COMMON' AND scoped_t.attribution_kind = 'HOUSEHOLD')
                           OR (?4 = 'MEMBER' AND scoped_t.attribution_kind = 'MEMBER'
                               AND scoped_t.attributed_member_id = ?5))))
         GROUP BY cs.id, a.name, cs.payment_due_on, cs.statement_amount_jpy, cs.reconciliation_status
         ORDER BY cs.payment_due_on, cs.id"
    ).map_err(unavailable)?;
    let rows = statement
        .query_map(
            params![
                household_id,
                through,
                account_group_id,
                attribution_scope.sql_kind(),
                attribution_scope.member_id()
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .map_err(unavailable)?;
    for row in rows {
        let (id, account, due_on, amount, status, paid) = row.map_err(unavailable)?;
        let remaining = amount.saturating_sub(paid).max(0);
        let due_day = due_on.as_deref().and_then(parse_iso_day);
        let mismatch = matches!(
            status.as_str(),
            "PARTIALLY_RECONCILED" | "OVERPAID" | "UNDERPAID" | "POSSIBLE_MATCH"
        );
        let overdue = due_day.is_some_and(|day| day < as_of_day);
        actions.push(ActionItemDto {
            id: format!("card:{id}"),
            kind: if mismatch { ActionKind::CardMismatch } else { ActionKind::CardPaymentDue },
            priority: if overdue { ActionPriority::Critical } else if mismatch { ActionPriority::High } else { ActionPriority::Medium },
            title: if mismatch { format!("Reconcile {account} statement") } else { format!("Upcoming {account} payment") },
            detail: format!("Status {status}; ¥{remaining} remains against statement ¥{amount}"),
            due_on, amount_jpy: Some(remaining), entity_id: Some(id),
            reasons: {
                let mut reasons = vec!["Card settlement changes cash and liability, but must not be counted as a second expense".to_owned()];
                if attribution_scope.sql_kind() != "ALL" {
                    reasons.push("Linked statement transactions determine attribution relevance when available; this amount remains the household-wide statement balance because payments cannot be allocated reliably by member".to_owned());
                }
                reasons
            },
        });
    }
    Ok(())
}

fn append_budget_actions(
    connection: &Connection,
    household_id: &str,
    account_group_id: Option<&str>,
    attribution_scope: &AttributionScope,
    month: &str,
    actions: &mut Vec<ActionItemDto>,
) -> Result<(), String> {
    let mut statement = connection.prepare(
        "SELECT b.category_account_id, a.name, b.budget_jpy,
                COALESCE(SUM(CASE WHEN t.status = 'POSTED' AND t.transaction_type IN ('EXPENSE','CARD_PURCHASE','FEE','INTEREST') AND e.entry_side = 'DEBIT' THEN e.amount_jpy ELSE 0 END), 0) actual
         FROM monthly_category_budgets b JOIN accounts a ON a.id = b.category_account_id
         LEFT JOIN journal_entries e ON e.account_id = b.category_account_id
         LEFT JOIN transactions t ON t.id = e.transaction_id AND t.household_id = b.household_id AND substr(t.occurred_on,1,7) = b.month
            AND t.calculation_target = 1
            AND (?4 = 'ALL'
                 OR (?4 = 'HOUSEHOLD_COMMON' AND t.attribution_kind = 'HOUSEHOLD')
                 OR (?4 = 'MEMBER' AND t.attribution_kind = 'MEMBER'
                     AND t.attributed_member_id = ?5))
         WHERE b.household_id = ?1 AND b.month = ?2
           AND (?3 IS NULL OR EXISTS (
                SELECT 1 FROM account_group_members scope_gm
                WHERE scope_gm.household_id = b.household_id
                  AND scope_gm.account_group_id = ?3
                  AND scope_gm.account_id = b.category_account_id))
         GROUP BY b.category_account_id, a.name, b.budget_jpy HAVING actual > b.budget_jpy
         ORDER BY actual - b.budget_jpy DESC"
    ).map_err(unavailable)?;
    let rows = statement
        .query_map(
            params![
                household_id,
                month,
                account_group_id,
                attribution_scope.sql_kind(),
                attribution_scope.member_id()
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(unavailable)?;
    for row in rows {
        let (id, name, budget, actual) = row.map_err(unavailable)?;
        let over = actual - budget;
        actions.push(ActionItemDto {
            id: format!("budget:{month}:{id}"),
            kind: ActionKind::BudgetOverrun,
            priority: ActionPriority::High,
            title: format!("{name} is over budget"),
            detail: format!("Spent ¥{actual} against ¥{budget}"),
            due_on: Some(end_of_month(month)?),
            amount_jpy: Some(over),
            entity_id: Some(id),
            reasons: vec![
                if attribution_scope.sql_kind() == "ALL" {
                    "Budget actuals use confirmed accrual expense entries for this category".to_owned()
                } else {
                    "Budget actuals use the selected transaction attribution, compared with the household category budget because budgets do not carry member attribution".to_owned()
                },
            ],
        });
    }
    Ok(())
}

fn append_goal_actions(
    connection: &Connection,
    household_id: &str,
    as_of_day: i64,
    actions: &mut Vec<ActionItemDto>,
) -> Result<(), String> {
    let through = format_iso_day(as_of_day + 90);
    let mut statement = connection.prepare("SELECT id, name, target_jpy, saved_jpy, target_date FROM savings_goals WHERE household_id = ?1 AND status = 'ACTIVE' AND target_date <= ?2 ORDER BY target_date, id").map_err(unavailable)?;
    let rows = statement
        .query_map(params![household_id, through], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(unavailable)?;
    for row in rows {
        let (id, name, target, saved, due) = row.map_err(unavailable)?;
        let remaining = target.saturating_sub(saved).max(0);
        let overdue = parse_iso_day(&due).is_some_and(|day| day < as_of_day);
        actions.push(ActionItemDto {
            id: format!("goal:{id}"),
            kind: ActionKind::GoalDue,
            priority: if overdue {
                ActionPriority::High
            } else {
                ActionPriority::Medium
            },
            title: format!("Savings goal due: {name}"),
            detail: format!("¥{remaining} remains toward ¥{target}"),
            due_on: Some(due),
            amount_jpy: Some(remaining),
            entity_id: Some(id),
            reasons: vec!["Goal is active and its target date is within 90 days".to_owned()],
        });
    }
    Ok(())
}

fn priority_rank(priority: &ActionPriority) -> u8 {
    match priority {
        ActionPriority::Critical => 0,
        ActionPriority::High => 1,
        ActionPriority::Medium => 2,
        ActionPriority::Low => 3,
    }
}
fn unavailable(_: rusqlite::Error) -> String {
    "Forecast and action data is temporarily unavailable".to_owned()
}

fn shift_month(value: &str, offset: i64) -> Result<String, String> {
    if value.len() != 7 || &value[4..5] != "-" {
        return Err("Invalid month".to_owned());
    }
    let year = value[0..4]
        .parse::<i64>()
        .map_err(|_| "Invalid month".to_owned())?;
    let month = value[5..7]
        .parse::<i64>()
        .map_err(|_| "Invalid month".to_owned())?;
    if !(1..=12).contains(&month) {
        return Err("Invalid month".to_owned());
    }
    let index = year
        .saturating_mul(12)
        .saturating_add(month - 1)
        .saturating_add(offset);
    Ok(format!(
        "{:04}-{:02}",
        index.div_euclid(12),
        index.rem_euclid(12) + 1
    ))
}
fn end_of_month(month: &str) -> Result<String, String> {
    let next = shift_month(month, 1)?;
    let next_day =
        parse_iso_day(&format!("{next}-01")).ok_or_else(|| "Invalid month".to_owned())?;
    Ok(format_iso_day(next_day - 1))
}
fn parse_iso_day(value: &str) -> Option<i64> {
    if value.len() != 10 || &value[4..5] != "-" || &value[7..8] != "-" {
        return None;
    }
    let y = value[0..4].parse::<i32>().ok()?;
    let m = value[5..7].parse::<u32>().ok()?;
    let d = value[8..10].parse::<u32>().ok()?;
    if !(1..=12).contains(&m) || d == 0 || d > days_in_month(y, m) {
        return None;
    }
    Some(days_from_civil(y, m, d))
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
    era * 146097 + doe - 719468
}
fn civil_from_days(day: i64) -> (i32, u32, u32) {
    let shifted = day + 719468;
    let era = shifted.div_euclid(146097);
    let doe = shifted - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = (yoe + era * 400) as i32;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (mp + if mp < 10 { 3 } else { -9 }) as u32;
    year += i32::from(month <= 2);
    (year, month, day)
}
fn format_iso_day(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

#[tauri::command]
pub fn forecast_action_query(
    state: tauri::State<'_, AppState>,
    request: ForecastActionRequest,
) -> Result<ForecastActionDto, String> {
    state
        .with_connection(|connection| Ok(query_forecast_action(connection, &request)))
        .map_err(|_| "Forecast and action data is temporarily unavailable".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE households(id TEXT PRIMARY KEY);
             CREATE TABLE accounts(id TEXT PRIMARY KEY, household_id TEXT, name TEXT, account_kind TEXT, account_subtype TEXT, is_archived INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE transactions(id TEXT PRIMARY KEY, household_id TEXT, occurred_on TEXT, transaction_type TEXT, payee TEXT, description TEXT, status TEXT, attribution_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD', attributed_member_id TEXT, calculation_target INTEGER NOT NULL DEFAULT 1 CHECK(calculation_target IN (0,1)));
             CREATE TABLE journal_entries(transaction_id TEXT, account_id TEXT, entry_side TEXT, amount_jpy INTEGER);
             CREATE TABLE import_runs(id TEXT, household_id TEXT, status TEXT);
             CREATE TABLE card_statements(id TEXT, household_id TEXT, card_account_id TEXT, payment_due_on TEXT, statement_amount_jpy INTEGER, reconciliation_status TEXT);
             CREATE TABLE card_payments(id TEXT, household_id TEXT, statement_id TEXT, payment_amount_jpy INTEGER, payment_on TEXT, reconciliation_status TEXT);
             CREATE TABLE monthly_category_budgets(household_id TEXT, month TEXT, category_account_id TEXT, budget_jpy INTEGER);
             CREATE TABLE savings_goals(id TEXT, household_id TEXT, name TEXT, target_jpy INTEGER, saved_jpy INTEGER, target_date TEXT, status TEXT);
             CREATE TABLE account_groups(id TEXT PRIMARY KEY, household_id TEXT);
             CREATE TABLE account_group_members(household_id TEXT, account_group_id TEXT, account_id TEXT);
             CREATE TABLE household_members(id TEXT PRIMARY KEY, household_id TEXT, status TEXT);
             CREATE TABLE card_statement_transactions(statement_id TEXT, transaction_id TEXT, billed_amount_jpy INTEGER);
             INSERT INTO households VALUES ('family'), ('other');
             INSERT INTO accounts VALUES ('bank','family','Bank','ASSET','BANK',0),('income','family','Salary','INCOME','OTHER',0),('expense','family','Food','EXPENSE','OTHER',0),('card','family','Card','LIABILITY','CREDIT_CARD',0),('excluded-bank','family','Other Bank','ASSET','BANK',0),('excluded-income','family','Other Income','INCOME','OTHER',0),('excluded-expense','family','Other Expense','EXPENSE','OTHER',0),('excluded-card','family','Other Card','LIABILITY','CREDIT_CARD',0),('other-expense','other','Other','EXPENSE','OTHER',0);
             INSERT INTO account_groups VALUES ('daily','family'),('foreign','other');
             INSERT INTO account_group_members VALUES ('family','daily','bank'),('family','daily','expense'),('family','daily','card');
             INSERT INTO household_members VALUES ('alice','family','ACTIVE'),('archived','family','ARCHIVED'),('foreign-member','other','ACTIVE');"
        ).unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0023_card_settlement_bank_mappings.sql"
            ))
            .unwrap();
        connection
    }

    fn add_month(connection: &Connection, month: u32, income: i64, expense: i64) {
        connection.execute_batch(&format!(
            "INSERT INTO transactions (id,household_id,occurred_on,transaction_type,payee,description,status) VALUES ('income-{month}','family','2026-{month:02}-01','INCOME','Employer',NULL,'POSTED');
             INSERT INTO journal_entries VALUES ('income-{month}','bank','DEBIT',{income}),('income-{month}','income','CREDIT',{income});
             INSERT INTO transactions (id,household_id,occurred_on,transaction_type,payee,description,status) VALUES ('expense-{month}','family','2026-{month:02}-10','EXPENSE','Grocer',NULL,'POSTED');
             INSERT INTO journal_entries VALUES ('expense-{month}','expense','DEBIT',{expense}),('expense-{month}','bank','CREDIT',{expense});"
        )).unwrap();
    }

    #[test]
    fn forecasts_three_months_from_confirmed_history_and_known_card_due() {
        let connection = connection();
        for month in 4..=6 {
            add_month(&connection, month, 300_000, 100_000);
        }
        connection.execute_batch(
            "INSERT INTO card_statements VALUES ('statement','family','card','2026-08-27',60000,'UNMATCHED');
             INSERT INTO transactions (id,household_id,occurred_on,transaction_type,payee,description,status) VALUES ('other','other','2026-06-01','INCOME','Other',NULL,'POSTED');
             INSERT INTO journal_entries VALUES ('other','other-expense','DEBIT',999999);"
        ).unwrap();
        let result = query_forecast_action(
            &connection,
            &ForecastActionRequest {
                household_id: "family".into(),
                as_of: "2026-07-13".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::default(),
            },
        )
        .unwrap();
        assert_eq!(result.forecast_from, "2026-08");
        assert_eq!(result.forecast_through, "2026-10");
        assert_eq!(result.months.len(), 3);
        assert_eq!(result.assumptions.average_monthly_income_jpy, 300_000);
        assert_eq!(result.assumptions.average_monthly_expense_jpy, 100_000);
        assert_eq!(result.months[0].known_card_payments_jpy, 60_000);
        assert_eq!(result.months[0].projected_cash_change_jpy, 140_000);
        assert_eq!(
            result.months[1].opening_cash_jpy,
            result.months[0].closing_cash_jpy
        );
    }

    #[test]
    fn calculation_target_excludes_forecast_history_and_budget_actual_but_keeps_cash_and_card_due()
    {
        let connection = connection();
        for month in 4..=6 {
            add_month(&connection, month, 300_000, 100_000);
        }
        connection
            .execute_batch(
                "UPDATE transactions SET calculation_target=0;
                 INSERT INTO card_statements VALUES
                   ('statement','family','card','2026-08-27',60000,'UNMATCHED');
                 INSERT INTO monthly_category_budgets VALUES
                   ('family','2026-07','expense',1000);
                 INSERT INTO transactions
                   (id,household_id,occurred_on,transaction_type,payee,description,status,calculation_target)
                 VALUES ('excluded-july','family','2026-07-02','EXPENSE','Grocer',NULL,'POSTED',0);
                 INSERT INTO journal_entries VALUES
                   ('excluded-july','expense','DEBIT',5000),
                   ('excluded-july','bank','CREDIT',5000);",
            )
            .unwrap();
        let result = query_forecast_action(
            &connection,
            &ForecastActionRequest {
                household_id: "family".into(),
                as_of: "2026-07-13".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::All,
            },
        )
        .unwrap();
        assert_eq!(result.assumptions.average_monthly_income_jpy, 0);
        assert_eq!(result.assumptions.average_monthly_expense_jpy, 0);
        assert_eq!(result.months[0].opening_cash_jpy, 595_000);
        assert_eq!(result.months[0].known_card_payments_jpy, 60_000);
        assert!(!result
            .actions
            .iter()
            .any(|action| action.kind == ActionKind::BudgetOverrun));
    }

    #[test]
    fn action_center_uses_explicit_mapping_and_discloses_projection_gaps() {
        let connection = connection();
        connection
            .execute_batch(
                "INSERT INTO card_settlement_bank_mappings VALUES
                   ('family','card','bank','2026-07-01','2026-07-01');
                 INSERT INTO card_statements VALUES
                   ('mapped','family','card','2026-07-20',10000,'UNMATCHED'),
                   ('unmapped','family','excluded-card','2026-07-21',20000,'UNMATCHED'),
                   ('missing-due','family','card',NULL,30000,'UNMATCHED');",
            )
            .unwrap();
        let result = query_forecast_action(
            &connection,
            &ForecastActionRequest {
                household_id: "family".into(),
                as_of: "2026-07-13".into(),
                account_group_id: Some("daily".into()),
                attribution_scope: AttributionScope::Member {
                    member_id: "alice".into(),
                },
            },
        )
        .unwrap();
        assert!(result.actions.iter().any(|action| {
            action.kind == ActionKind::CardBalanceShortfall && action.amount_jpy == Some(10_000)
        }));
        assert!(result.actions.iter().any(|action| {
            action.kind == ActionKind::CardMappingRequired
                && action.id == "card-mapping-required:unmapped"
        }));
        assert!(result.actions.iter().any(|action| {
            action.kind == ActionKind::CardMappingRequired
                && action.id == "card-due-date-required:missing-due"
        }));
    }

    #[test]
    fn action_center_is_household_scoped_prioritized_and_explainable() {
        let connection = connection();
        for month in 4..=6 {
            add_month(&connection, month, 100_000, 10_000);
        }
        connection.execute_batch(
            "INSERT INTO import_runs VALUES ('review','family','REVIEW_REQUIRED'),('failed','family','FAILED'),('foreign','other','FAILED');
             INSERT INTO card_statements VALUES ('late','family','card','2026-07-01',50000,'UNDERPAID');
             INSERT INTO monthly_category_budgets VALUES ('family','2026-07','expense',1000);
             INSERT INTO transactions (id,household_id,occurred_on,transaction_type,payee,description,status) VALUES ('july-expense','family','2026-07-02','EXPENSE','Grocer',NULL,'POSTED');
             INSERT INTO journal_entries VALUES ('july-expense','expense','DEBIT',5000),('july-expense','bank','CREDIT',5000);
             INSERT INTO savings_goals VALUES ('goal','family','Trip',100000,20000,'2026-08-01','ACTIVE');"
        ).unwrap();
        let result = query_forecast_action(
            &connection,
            &ForecastActionRequest {
                household_id: "family".into(),
                as_of: "2026-07-13".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::default(),
            },
        )
        .unwrap();
        assert_eq!(result.actions[0].priority, ActionPriority::Critical);
        assert!(result
            .actions
            .iter()
            .any(|item| item.kind == ActionKind::ImportFailed && item.detail.starts_with('1')));
        assert!(result
            .actions
            .iter()
            .any(|item| item.kind == ActionKind::BudgetOverrun && item.amount_jpy == Some(4_000)));
        assert!(result.actions.iter().all(|item| !item.reasons.is_empty()));
    }

    #[test]
    fn account_group_scopes_forecast_and_account_actions_without_join_duplication() {
        let connection = connection();
        for month in 4..=6 {
            add_month(&connection, month, 300_000, 100_000);
            connection.execute_batch(&format!(
                "INSERT INTO transactions (id,household_id,occurred_on,transaction_type,payee,description,status) VALUES ('excluded-income-{month}','family','2026-{month:02}-02','INCOME','Other Employer',NULL,'POSTED');
                 INSERT INTO journal_entries VALUES ('excluded-income-{month}','excluded-bank','DEBIT',900000),('excluded-income-{month}','excluded-income','CREDIT',900000);
                 INSERT INTO transactions (id,household_id,occurred_on,transaction_type,payee,description,status) VALUES ('excluded-expense-{month}','family','2026-{month:02}-11','EXPENSE','Other Merchant',NULL,'POSTED');
                 INSERT INTO journal_entries VALUES ('excluded-expense-{month}','excluded-expense','DEBIT',800000),('excluded-expense-{month}','excluded-bank','CREDIT',800000);"
            )).unwrap();
        }
        connection.execute_batch(
            "INSERT INTO card_statements VALUES ('included-statement','family','card','2026-08-27',60000,'UNMATCHED'),('excluded-statement','family','excluded-card','2026-08-27',900000,'UNMATCHED');
             INSERT INTO monthly_category_budgets VALUES ('family','2026-07','expense',1000),('family','2026-07','excluded-expense',1000);
             INSERT INTO transactions (id,household_id,occurred_on,transaction_type,payee,description,status) VALUES ('included-july','family','2026-07-02','EXPENSE','Grocer',NULL,'POSTED'),('excluded-july','family','2026-07-02','EXPENSE','Other',NULL,'POSTED');
             INSERT INTO journal_entries VALUES ('included-july','expense','DEBIT',5000),('included-july','bank','CREDIT',5000),('excluded-july','excluded-expense','DEBIT',9000),('excluded-july','excluded-bank','CREDIT',9000);",
        ).unwrap();

        let scoped = query_forecast_action(
            &connection,
            &ForecastActionRequest {
                household_id: "family".into(),
                as_of: "2026-07-13".into(),
                account_group_id: Some("daily".into()),
                attribution_scope: AttributionScope::default(),
            },
        )
        .unwrap();

        assert_eq!(scoped.assumptions.average_monthly_income_jpy, 300_000);
        assert_eq!(scoped.assumptions.average_monthly_expense_jpy, 100_000);
        assert_eq!(scoped.months[0].known_card_payments_jpy, 60_000);
        assert!(scoped.actions.iter().any(|item| {
            item.kind == ActionKind::BudgetOverrun && item.entity_id.as_deref() == Some("expense")
        }));
        assert!(scoped.actions.iter().all(|item| {
            item.entity_id.as_deref() != Some("excluded-expense")
                && item.entity_id.as_deref() != Some("excluded-statement")
        }));

        let legacy = query_forecast_action(
            &connection,
            &ForecastActionRequest {
                household_id: "family".into(),
                as_of: "2026-07-13".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::default(),
            },
        )
        .unwrap();
        assert_eq!(legacy.assumptions.average_monthly_income_jpy, 1_200_000);
        assert_eq!(legacy.months[0].known_card_payments_jpy, 960_000);
    }

    #[test]
    fn attribution_scope_filters_history_and_linked_card_relevance_but_not_opening_balance() {
        let connection = connection();
        for month in 4..=6 {
            add_month(&connection, month, 300_000, 100_000);
            connection.execute_batch(&format!(
                "INSERT INTO transactions
                    (id,household_id,occurred_on,transaction_type,payee,description,status,attribution_kind,attributed_member_id)
                 VALUES
                    ('alice-income-{month}','family','2026-{month:02}-03','INCOME','Alice Employer',NULL,'POSTED','MEMBER','alice'),
                    ('alice-expense-{month}','family','2026-{month:02}-12','EXPENSE','Alice Plan',NULL,'POSTED','MEMBER','alice');
                 INSERT INTO journal_entries VALUES
                    ('alice-income-{month}','bank','DEBIT',50000),('alice-income-{month}','income','CREDIT',50000),
                    ('alice-expense-{month}','expense','DEBIT',20000),('alice-expense-{month}','bank','CREDIT',20000);"
            )).unwrap();
        }
        connection.execute_batch(
            "INSERT INTO card_statements VALUES
                ('alice-statement','family','card','2026-08-27',60000,'UNMATCHED'),
                ('common-statement','family','card','2026-08-27',70000,'UNMATCHED'),
                ('unlinked-statement','family','card','2026-08-27',80000,'UNMATCHED');
             INSERT INTO transactions
                (id,household_id,occurred_on,transaction_type,payee,description,status,attribution_kind,attributed_member_id)
             VALUES
                ('alice-card-purchase','family','2026-07-01','CARD_PURCHASE','Alice Shop',NULL,'POSTED','MEMBER','alice'),
                ('common-card-purchase','family','2026-07-01','CARD_PURCHASE','Common Shop',NULL,'POSTED','HOUSEHOLD',NULL);
             INSERT INTO card_statement_transactions VALUES
                ('alice-statement','alice-card-purchase',60000),
                ('common-statement','common-card-purchase',70000);",
        ).unwrap();

        let member = query_forecast_action(
            &connection,
            &ForecastActionRequest {
                household_id: "family".into(),
                as_of: "2026-07-13".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::Member {
                    member_id: "alice".into(),
                },
            },
        )
        .unwrap();
        assert_eq!(member.assumptions.average_monthly_income_jpy, 50_000);
        assert_eq!(member.assumptions.average_monthly_expense_jpy, 20_000);
        assert_eq!(member.opening_cash_jpy, 690_000);
        assert_eq!(member.months[0].known_card_payments_jpy, 140_000);
        assert!(member.actions.iter().any(|item| {
            item.entity_id.as_deref() == Some("alice-statement")
                && item
                    .reasons
                    .iter()
                    .any(|reason| reason.contains("household-wide"))
        }));
        assert!(member
            .actions
            .iter()
            .any(|item| item.entity_id.as_deref() == Some("unlinked-statement")));
        assert!(member
            .actions
            .iter()
            .all(|item| item.entity_id.as_deref() != Some("common-statement")));
        assert!(member
            .assumptions
            .reasons
            .iter()
            .any(|reason| reason.contains("Opening cash")));

        let common = query_forecast_action(
            &connection,
            &ForecastActionRequest {
                household_id: "family".into(),
                as_of: "2026-07-13".into(),
                account_group_id: None,
                attribution_scope: AttributionScope::HouseholdCommon,
            },
        )
        .unwrap();
        assert_eq!(common.assumptions.average_monthly_income_jpy, 300_000);
        assert_eq!(common.assumptions.average_monthly_expense_jpy, 100_000);
        assert_eq!(common.opening_cash_jpy, member.opening_cash_jpy);
        assert_eq!(common.months[0].known_card_payments_jpy, 150_000);
    }

    #[test]
    fn rejects_invalid_or_cross_household_requests() {
        let connection = connection();
        assert_eq!(
            query_forecast_action(
                &connection,
                &ForecastActionRequest {
                    household_id: "missing".into(),
                    as_of: "2026-07-13".into(),
                    account_group_id: None,
                    attribution_scope: AttributionScope::default(),
                }
            )
            .unwrap_err(),
            "The requested household was not found"
        );
        assert_eq!(
            query_forecast_action(
                &connection,
                &ForecastActionRequest {
                    household_id: "family".into(),
                    as_of: "2026-02-29".into(),
                    account_group_id: None,
                    attribution_scope: AttributionScope::default(),
                }
            )
            .unwrap_err(),
            "Invalid as-of date"
        );
        assert_eq!(
            query_forecast_action(
                &connection,
                &ForecastActionRequest {
                    household_id: "family".into(),
                    as_of: "2026-07-13".into(),
                    account_group_id: Some("foreign".into()),
                    attribution_scope: AttributionScope::default(),
                }
            )
            .unwrap_err(),
            "The requested account group was not found"
        );
        assert_eq!(
            query_forecast_action(
                &connection,
                &ForecastActionRequest {
                    household_id: "family".into(),
                    as_of: "2026-07-13".into(),
                    account_group_id: None,
                    attribution_scope: AttributionScope::Member {
                        member_id: "foreign-member".into(),
                    },
                }
            )
            .unwrap_err(),
            "Attribution member was not found in the household"
        );
    }
}
