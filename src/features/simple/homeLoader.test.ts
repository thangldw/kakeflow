import { describe, expect, it, vi } from 'vitest'
import type { DashboardMonthlyTotalsDto, MonthlyCategoryBudgetDto, SavingsGoalDto } from '../../platform/types'
import { loadSimpleHome, type HomeClient } from './homeLoader'

const NOW = new Date('2026-11-14T03:00:00Z')

const budget = (month: string, categoryAccountId: string, categoryName: string, budgetJpy: number): MonthlyCategoryBudgetDto => ({
  householdId: 'family', month, categoryAccountId, categoryName, budgetJpy, actualJpy: 0, remainingJpy: budgetJpy,
})

const dashboard = (overrides: Partial<DashboardMonthlyTotalsDto> = {}): DashboardMonthlyTotalsDto => ({
  month: '2026-11', accountingBasis: 'ACCRUAL', incomeJpy: 250_000, expenseJpy: 112_400, savingsJpy: 137_600, postedTransactionCount: 12,
  netWorthAsOf: '2026-11-14', assetsJpy: 0, liabilitiesJpy: 0, netWorthJpy: 0, accrualTrend: [], cashFlowTrend: [],
  expenseCategories: [
    { accountId: 'food', name: '食費', amountJpy: 40_000 },
    { accountId: 'daily', name: '日用品', amountJpy: 24_500 },
  ],
  ...overrides,
})

const goal = (id: string, targetDate: string, status: SavingsGoalDto['status'] = 'ACTIVE'): SavingsGoalDto => ({
  id, householdId: 'family', name: `goal-${id}`, targetJpy: 300_000, savedJpy: 120_000, targetDate, status,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
})

function fakeClient(options: {
  budgetsByMonth?: Record<string, readonly MonthlyCategoryBudgetDto[]>
  goals?: readonly SavingsGoalDto[]
  dashboard?: () => Promise<DashboardMonthlyTotalsDto>
} = {}) {
  return {
    queryDashboard: vi.fn(options.dashboard ?? (async () => dashboard())),
    listBudgets: vi.fn(async (_householdId: string, month: string) => options.budgetsByMonth?.[month] ?? []),
    listSavingsGoals: vi.fn(async () => options.goals ?? []),
    updateSavingsGoal: vi.fn(async (input: SavingsGoalDto) => input),
  } satisfies HomeClient
}

describe('loadSimpleHome', () => {
  it('reads the whole household on the accrual basis and uses the month\'s own budgets', async () => {
    const client = fakeClient({ budgetsByMonth: { '2026-11': [budget('2026-11', 'food', '食費', 60_000), budget('2026-11', 'daily', '日用品', 20_000)] } })
    const data = await loadSimpleHome(client, 'family', '2026-11', NOW)
    expect(client.queryDashboard).toHaveBeenCalledWith({ householdId: 'family', accountGroupId: null, attributionScope: { kind: 'ALL' }, month: '2026-11', accountingBasis: 'ACCRUAL' })
    expect(client.listBudgets).toHaveBeenCalledTimes(1)
    expect(data.remaining.basis).toBe('BUDGET')
    expect(data.remaining.budgetMonth).toBe('2026-11')
    expect(data.remaining.totalBudgetJpy).toBe(80_000)
    expect(data.remaining.mostOver).toEqual({ name: '日用品', overJpy: 4_500 })
    expect(data.goal).toBeNull()
  })

  it('falls back to the nearest earlier month with budgets, read one month at a time', async () => {
    const client = fakeClient({ budgetsByMonth: {
      '2026-09': [budget('2026-09', 'food', '食費', 60_000), budget('2026-09', 'daily', '日用品', 30_000)],
      '2026-08': [budget('2026-08', 'food', '食費', 1)],
    } })
    const data = await loadSimpleHome(client, 'family', '2026-11', NOW)
    expect(client.listBudgets.mock.calls.map((call) => call[1])).toEqual(['2026-11', '2026-10', '2026-09'])
    expect(data.remaining.budgetMonth).toBe('2026-09')
    expect(data.remaining.totalBudgetJpy).toBe(90_000)
    // September's budget amounts are compared with November's spending.
    expect(data.remaining.spentJpy).toBe(112_400)
    expect(data.remaining.unbudgetedSpentJpy).toBe(112_400 - 64_500)
    expect(data.remaining.mostOver).toBeNull()
  })

  it('uses income minus spending when no month in the last 12 has budgets', async () => {
    const client = fakeClient()
    const data = await loadSimpleHome(client, 'family', '2026-11', NOW)
    expect(client.listBudgets).toHaveBeenCalledTimes(13)
    expect(data.remaining.basis).toBe('INCOME_MINUS_EXPENSE')
    expect(data.remaining.remainingJpy).toBe(137_600)
  })

  it('picks the active goal with the nearest target date and ignores other statuses', async () => {
    const client = fakeClient({ goals: [
      goal('far', '2028-01-31'),
      goal('done', '2026-12-01', 'COMPLETED'),
      goal('paused', '2026-12-15', 'PAUSED'),
      goal('near', '2027-03-31'),
    ] })
    const data = await loadSimpleHome(client, 'family', '2026-11', NOW)
    expect(data.goal?.id).toBe('near')
  })

  it('returns no goal when only completed goals exist', async () => {
    const client = fakeClient({ goals: [goal('done', '2026-12-01', 'COMPLETED')] })
    expect((await loadSimpleHome(client, 'family', '2026-11', NOW)).goal).toBeNull()
  })

  it('computes the per-day allowance from the given time', async () => {
    const client = fakeClient({ budgetsByMonth: { '2026-11': [budget('2026-11', 'food', '食費', 155_000)] } })
    const data = await loadSimpleHome(client, 'family', '2026-11', NOW)
    expect(data.remaining.remainingJpy).toBe(42_600)
    expect(data.remaining.perDayJpy).toBe(2_505)
  })

  it('rejects when the dashboard cannot be read', async () => {
    const client = fakeClient({ dashboard: async () => { throw new Error('offline') } })
    await expect(loadSimpleHome(client, 'family', '2026-11', NOW)).rejects.toThrow('offline')
  })
})
