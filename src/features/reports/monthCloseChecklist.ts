import type { FinancialCalendarDto } from '../calendar/financialCalendarPlatform'

/** Days without a new import after which the month is flagged as possibly missing data. */
export const STALE_IMPORT_DAYS = 7

export type MonthCloseTarget = 'import' | 'budgets'

export interface MonthCloseItem {
  readonly id: 'review-imports' | 'failed-imports' | 'in-progress-imports' | 'fresh-data' | 'budget-set' | 'over-budget'
  readonly done: boolean
  /** Count shown next to the item when something is outstanding (0 when done or not applicable). */
  readonly count: number
  readonly target: MonthCloseTarget
}

export interface MonthCloseChecklist {
  readonly items: readonly MonthCloseItem[]
  readonly doneCount: number
  readonly total: number
  readonly complete: boolean
}

/** What is left to do before a month can be treated as closed, derived from the calendar's data-quality and budget summaries. */
export function monthCloseChecklist(calendar: Pick<FinancialCalendarDto, 'dataQuality' | 'budget'>): MonthCloseChecklist {
  const { dataQuality: quality, budget } = calendar
  const noImports = quality.totalImports === 0
  const stale = noImports || quality.staleDays == null || quality.staleDays > STALE_IMPORT_DAYS
  const items: MonthCloseItem[] = [
    { id: 'review-imports', done: quality.reviewRequiredImports === 0, count: quality.reviewRequiredImports, target: 'import' },
    { id: 'failed-imports', done: quality.failedImports === 0, count: quality.failedImports, target: 'import' },
    { id: 'in-progress-imports', done: quality.inProgressImports === 0, count: quality.inProgressImports, target: 'import' },
    { id: 'fresh-data', done: !stale, count: noImports ? 0 : (quality.staleDays ?? 0), target: 'import' },
    { id: 'budget-set', done: budget.categoryCount > 0, count: 0, target: 'budgets' },
    { id: 'over-budget', done: budget.overBudgetCount === 0, count: budget.overBudgetCount, target: 'budgets' },
  ]
  const doneCount = items.filter((item) => item.done).length
  return { items, doneCount, total: items.length, complete: doneCount === items.length }
}
