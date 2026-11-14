import type { MonthlyCategoryBudgetDto, PlatformClient, SavingsGoalDto } from '../../platform/types'
import { computeRemainingToSpend, previousMonths, tokyoDate, type RemainingToSpend } from './homeMath'

export type HomeClient = Pick<PlatformClient, 'listBudgets' | 'queryDashboard' | 'listSavingsGoals' | 'updateSavingsGoal'>

export interface SimpleHomeData {
  readonly remaining: RemainingToSpend
  readonly goal: SavingsGoalDto | null
}

/** How many earlier months are searched for budgets when the month has none. */
const BUDGET_LOOKBACK_MONTHS = 12

/**
 * Budgets for `month`, or else for the nearest earlier month that has any.
 * Months are read one at a time so the search stops at the first hit. Nothing is written.
 */
async function findBudgets(client: HomeClient, householdId: string, month: string): Promise<{ month: string | null; budgets: readonly MonthlyCategoryBudgetDto[] }> {
  for (const candidate of [month, ...previousMonths(month, BUDGET_LOOKBACK_MONTHS)]) {
    const budgets = await client.listBudgets(householdId, candidate)
    if (budgets.length > 0) return { month: candidate, budgets }
  }
  return { month: null, budgets: [] }
}

/** The active goal with the nearest target date. */
function nearestActiveGoal(goals: readonly SavingsGoalDto[]): SavingsGoalDto | null {
  return goals
    .filter((goal) => goal.status === 'ACTIVE')
    .reduce<SavingsGoalDto | null>((nearest, goal) => nearest === null || goal.targetDate < nearest.targetDate ? goal : nearest, null)
}

/** Figures for the Simple Home: always the whole household, accrual basis. Rejects if any read fails. */
export async function loadSimpleHome(client: HomeClient, householdId: string, month: string, now: Date = new Date()): Promise<SimpleHomeData> {
  const [dashboard, found, goals] = await Promise.all([
    client.queryDashboard({ householdId, accountGroupId: null, attributionScope: { kind: 'ALL' }, month, accountingBasis: 'ACCRUAL' }),
    findBudgets(client, householdId, month),
    client.listSavingsGoals(householdId),
  ])
  const remaining = computeRemainingToSpend({
    month,
    today: tokyoDate(now),
    budgetMonth: found.month,
    budgets: found.budgets,
    categoryActuals: dashboard.expenseCategories,
    expenseJpy: dashboard.expenseJpy,
    incomeJpy: dashboard.incomeJpy,
  })
  return { remaining, goal: nearestActiveGoal(goals) }
}
