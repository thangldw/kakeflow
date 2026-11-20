import type { FinancialCalendarDto } from '../calendar/financialCalendarPlatform'
import type { PaymentReminderDto } from '../../platform/types'

export const MAX_ACTIONS = 3
/** A bill or card payment is called out once it is due within this many days. */
export const DUE_SOON_DAYS = 7

export type MonthlyActionTarget = 'import' | 'budgets' | 'goals' | 'calendar'

/** One concrete thing to do. Every number comes straight from the data it names; nothing is estimated except `budget-pace`, which says so. */
export type MonthlyAction =
  | { readonly id: 'overdue-reminder'; readonly urgency: 1; readonly target: 'calendar'; readonly label: string; readonly daysOverdue: number; readonly amountJpy: number | null }
  | { readonly id: 'card-payment-due'; readonly urgency: 2; readonly target: 'calendar'; readonly label: string; readonly dueOn: string; readonly daysLeft: number; readonly amountJpy: number }
  | { readonly id: 'reminder-due-soon'; readonly urgency: 2; readonly target: 'calendar'; readonly label: string; readonly dueOn: string; readonly daysLeft: number; readonly amountJpy: number | null }
  | { readonly id: 'review-imports'; readonly urgency: 3; readonly target: 'import'; readonly count: number }
  | { readonly id: 'over-budget'; readonly urgency: 4; readonly target: 'budgets'; readonly count: number }
  | { readonly id: 'budget-pace'; readonly urgency: 5; readonly target: 'budgets'; readonly projectedJpy: number; readonly budgetJpy: number }
  | { readonly id: 'goals-due'; readonly urgency: 6; readonly target: 'goals'; readonly count: number }

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/**
 * The few things most worth doing now, most urgent first (at most three). Facts only: overdue or soon-due
 * bills and card payments, imports waiting for review, categories already over budget, and — only when the
 * month is under way — a straight-line projection of spending against the budget, which is labelled as a pace.
 */
export function monthlyActions(
  calendar: Pick<FinancialCalendarDto, 'asOf' | 'month' | 'days' | 'budget' | 'goals' | 'dataQuality'>,
  reminders: readonly PaymentReminderDto[],
): readonly MonthlyAction[] {
  const today = calendar.asOf
  const actions: MonthlyAction[] = []

  for (const reminder of reminders) {
    if (reminder.done) continue
    const daysLeft = daysBetween(today, reminder.dueOn)
    if (daysLeft < 0) actions.push({ id: 'overdue-reminder', urgency: 1, target: 'calendar', label: reminder.label, daysOverdue: -daysLeft, amountJpy: reminder.amountJpy })
    else if (daysLeft <= DUE_SOON_DAYS) actions.push({ id: 'reminder-due-soon', urgency: 2, target: 'calendar', label: reminder.label, dueOn: reminder.dueOn, daysLeft, amountJpy: reminder.amountJpy })
  }

  for (const day of calendar.days) {
    const daysLeft = daysBetween(today, day.date)
    if (daysLeft < 0 || daysLeft > DUE_SOON_DAYS) continue
    for (const event of day.events) {
      if (event.kind === 'CARD_PAYMENT_DUE' && event.amountJpy > 0) {
        actions.push({ id: 'card-payment-due', urgency: 2, target: 'calendar', label: event.title, dueOn: day.date, daysLeft, amountJpy: event.amountJpy })
      }
    }
  }

  if (calendar.dataQuality.reviewRequiredImports > 0) {
    actions.push({ id: 'review-imports', urgency: 3, target: 'import', count: calendar.dataQuality.reviewRequiredImports })
  }
  if (calendar.budget.overBudgetCount > 0) {
    actions.push({ id: 'over-budget', urgency: 4, target: 'budgets', count: calendar.budget.overBudgetCount })
  }

  const elapsed = calendar.days.filter((day) => day.date <= today).length
  const total = calendar.days.length
  const inMonth = calendar.asOf.startsWith(calendar.month)
  if (inMonth && calendar.budget.budgetJpy > 0 && elapsed >= 7 && elapsed < total && calendar.budget.overBudgetCount === 0) {
    const projected = Math.round((calendar.budget.actualJpy / elapsed) * total)
    if (projected > calendar.budget.budgetJpy) {
      actions.push({ id: 'budget-pace', urgency: 5, target: 'budgets', projectedJpy: projected, budgetJpy: calendar.budget.budgetJpy })
    }
  }

  if (calendar.goals.dueWithinPeriodCount > 0) {
    actions.push({ id: 'goals-due', urgency: 6, target: 'goals', count: calendar.goals.dueWithinPeriodCount })
  }

  // Stable: equal urgency keeps the order found (reminders by list order, then calendar order).
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => left.action.urgency - right.action.urgency || left.index - right.index)
    .slice(0, MAX_ACTIONS)
    .map(({ action }) => action)
}
