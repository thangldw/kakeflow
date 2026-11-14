import { rollEnvelopes } from '../../domain/envelopeBudget'
import type { MonthlyCategoryBudgetDto } from '../../platform/types'

export interface EnvelopeMonthData {
  readonly month: string
  readonly incomeJpy: number
  readonly budgets: readonly MonthlyCategoryBudgetDto[]
}

export interface EnvelopeViewRow {
  readonly categoryAccountId: string
  readonly categoryName: string
  readonly carryInJpy: number
  readonly assignedJpy: number
  readonly activityJpy: number
  readonly availableJpy: number
}

export interface EnvelopeView {
  readonly month: string
  readonly startMonth: string
  readonly readyToAssignJpy: number
  readonly rows: readonly EnvelopeViewRow[]
}

/**
 * Carry-over view over already ledger-backed budgets. Rolling starts at the
 * first month that has any budget, so months before budgeting began never
 * produce a phantom overspend. Only categories with a budget row contribute
 * activity; spending in unbudgeted categories is not tracked here.
 */
export function buildEnvelopeView(months: readonly EnvelopeMonthData[], selectedMonth: string): EnvelopeView | null {
  const ordered = [...months].filter((item) => item.month <= selectedMonth).sort((left, right) => left.month.localeCompare(right.month))
  const first = ordered.findIndex((item) => item.budgets.length > 0)
  if (first < 0) return null
  const window = ordered.slice(first)
  const names = new Map<string, string>()
  for (const item of window) for (const budget of item.budgets) names.set(budget.categoryAccountId, budget.categoryName)
  const rolled = rollEnvelopes(window.map((item) => ({
    month: item.month,
    incomeJpy: item.incomeJpy,
    envelopes: item.budgets.map((budget) => ({ categoryId: budget.categoryAccountId, assignedJpy: budget.budgetJpy, activityJpy: budget.actualJpy })),
  })))
  const last = rolled.at(-1)!
  return {
    month: last.month,
    startMonth: window[0].month,
    readyToAssignJpy: last.readyToAssignJpy,
    rows: last.envelopes.map((state) => ({
      categoryAccountId: state.categoryId, categoryName: names.get(state.categoryId) ?? state.categoryId,
      carryInJpy: state.carryInJpy, assignedJpy: state.assignedJpy, activityJpy: state.activityJpy, availableJpy: state.availableJpy,
    })),
  }
}

/**
 * What a category can hand to another one this month without becoming overspent
 * itself. Must match `move_monthly_budget` in the Rust read model.
 */
export function movableJpy(row: Pick<EnvelopeViewRow, 'assignedJpy' | 'activityJpy'>): number {
  return Math.min(row.assignedJpy, Math.max(0, row.assignedJpy - row.activityJpy))
}
