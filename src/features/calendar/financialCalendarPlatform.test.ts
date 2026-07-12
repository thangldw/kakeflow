import { describe, expect, it, vi } from 'vitest'

import { createFinancialCalendarPlatform } from './financialCalendarPlatform'
import type { FinancialCalendarInvoke } from './financialCalendarPlatform'

const budget = { budgetJpy: 60_000, actualJpy: 70_000, remainingJpy: -10_000, utilizationBps: 11_666, categoryCount: 1, overBudgetCount: 1 }
const goals = { activeCount: 1, targetJpy: 100_000, savedJpy: 20_000, remainingJpy: 80_000, dueWithinPeriodCount: 1 }
const dataQuality = { totalImports: 2, postedImports: 1, reviewRequiredImports: 1, failedImports: 0, inProgressImports: 0, importCompletionBps: 5_000, latestImportedAt: '2026-07-13T10:00:00Z', staleDays: 0, hasUnresolvedImports: true }
const metrics = { incomeJpy: 300_000, expenseJpy: 70_000, savingsJpy: 230_000, savingsRateBps: 7_666, postedTransactionCount: 3 }
const deltas = { income: { amountJpy: 50_000, rateBps: 2_000 }, expense: { amountJpy: 30_000, rateBps: 7_500 }, savings: { amountJpy: 20_000, rateBps: 952 } }
const reconciliation = { totalStatements: 1, fullyReconciled: 0, possibleMatches: 1, partiallyReconciled: 0, unmatched: 0, mismatchCount: 0, paymentTotalJpy: 70_000 }
const sharedReport = {
  current: metrics, priorYear: { ...metrics, incomeJpy: 280_000 }, vsPriorYear: deltas,
  topCategoryDrivers: [{ id: 'groceries', name: 'Groceries', currentJpy: 70_000, previousJpy: 40_000, deltaJpy: 30_000 }],
  topMerchantDrivers: [{ merchant: 'Market', currentJpy: 50_000, previousJpy: 40_000, deltaJpy: 10_000 }],
  budget, goals, dataQuality, reconciliation,
}

const annualCurrent = { incomeJpy: 600_000, expenseJpy: 300_000, savingsJpy: 300_000, savingsRateBps: 5_000, postedTransactionCount: 12 }
const annualPrior = { incomeJpy: 540_000, expenseJpy: 300_000, savingsJpy: 240_000, savingsRateBps: 4_444, postedTransactionCount: 12 }
const annualDelta = { income: { amountJpy: 60_000, rateBps: 1_111 }, expense: { amountJpy: 0, rateBps: 0 }, savings: { amountJpy: 60_000, rateBps: 2_500 } }
const annualMonths = Array.from({ length: 12 }, (_, index) => ({
  month: `2026-${String(index + 1).padStart(2, '0')}`,
  status: index < 6 ? 'COMPLETE' : index === 6 ? 'PARTIAL' : 'FUTURE',
  incomeJpy: index < 6 ? 100_000 : 0, expenseJpy: index < 6 ? 50_000 : 0,
  savingsJpy: index < 6 ? 50_000 : 0, savingsRateBps: index < 6 ? 5_000 : null,
  postedTransactionCount: index < 6 ? 2 : 0,
}))
const annual = {
  period: '2026', asOf: '2026-07-31', throughMonth: '2026-06', completedMonthCount: 6, isCompleteYear: false,
  currentComparable: annualCurrent, priorYearComparable: annualPrior, vsPriorYearComparable: annualDelta,
  current: annualCurrent, priorYear: annualPrior, vsPriorYear: annualDelta, months: annualMonths,
  topCategoryDrivers: [], topMerchantDrivers: [], budget, goals, dataQuality, reconciliation,
}

describe('financial calendar platform boundary', () => {
  it('invokes the isolated calendar command and validates nested events', async () => {
    const response = {
      month: '2026-07', asOf: '2026-07-31', budget, goals, dataQuality,
      days: [{ date: '2026-07-27', accrualIncomeJpy: 0, accrualExpenseJpy: 0, cashInflowJpy: 0, cashOutflowJpy: 70_000, postedTransactionCount: 1, noSpendDay: true, events: [{ kind: 'CARD_PAYMENT_DUE', id: 'statement', title: 'Card', amountJpy: 70_000, status: 'POSSIBLE_MATCH' }] }],
    }
    const invoke = vi.fn(async () => response) as unknown as FinancialCalendarInvoke
    const platform = createFinancialCalendarPlatform(invoke)
    await expect(platform.getCalendar({ householdId: 'family', accountGroupId: 'daily', attributionScope: { kind: 'MEMBER', memberId: 'taro' }, month: '2026-07', asOf: '2026-07-31' })).resolves.toEqual(response)
    expect(invoke).toHaveBeenCalledWith('financial_calendar_query', { request: { householdId: 'family', accountGroupId: 'daily', attributionScope: { kind: 'MEMBER', memberId: 'taro' }, month: '2026-07', asOf: '2026-07-31' } })
  })

  it('invokes and parses monthly and yearly financial reports', async () => {
    const monthly = { period: '2026-07', ...sharedReport, priorMonth: { ...metrics, expenseJpy: 40_000 }, vsPriorMonth: deltas }
    const invoke = vi.fn(async (command: string) => command === 'financial_report_monthly_query' ? monthly : annual) as unknown as FinancialCalendarInvoke
    const platform = createFinancialCalendarPlatform(invoke)
    await expect(platform.getMonthlyReport({ householdId: 'family', attributionScope: { kind: 'ALL' }, month: '2026-07' })).resolves.toEqual(monthly)
    await expect(platform.getYearlyReport({ householdId: 'family', attributionScope: { kind: 'HOUSEHOLD_COMMON' }, year: '2026', asOf: '2026-07-31' })).resolves.toEqual(annual)
    expect(invoke).toHaveBeenNthCalledWith(1, 'financial_report_monthly_query', { request: { householdId: 'family', attributionScope: { kind: 'ALL' }, month: '2026-07' } })
    expect(invoke).toHaveBeenNthCalledWith(2, 'financial_report_yearly_query', { request: { householdId: 'family', attributionScope: { kind: 'HOUSEHOLD_COMMON' }, year: '2026', asOf: '2026-07-31' } })
  })

  it('saves the exact annual scope and rejects inconsistent annual windows', async () => {
    const saved = { fileName: 'kakeflow-annual-review-2026.csv', rowCount: 6, byteSize: 800 }
    const invoke = vi.fn(async (command: string) => command === 'annual_household_review_csv_save' ? saved : annual) as unknown as FinancialCalendarInvoke
    const platform = createFinancialCalendarPlatform(invoke)
    const request = { householdId: 'family', accountGroupId: 'daily', attributionScope: { kind: 'MEMBER' as const, memberId: 'taro' }, year: '2026', asOf: '2026-07-31' }
    await expect(platform.saveAnnualReviewCsv(request)).resolves.toEqual(saved)
    expect(invoke).toHaveBeenCalledWith('annual_household_review_csv_save', { request })

    const bad = vi.fn(async () => ({ ...annual, completedMonthCount: 7 })) as unknown as FinancialCalendarInvoke
    await expect(createFinancialCalendarPlatform(bad).getYearlyReport(request)).rejects.toThrow('completed months')
    const badAlias = vi.fn(async () => ({ ...annual, current: { ...annualCurrent, expenseJpy: 1, savingsJpy: 599_999, savingsRateBps: 9_999 } })) as unknown as FinancialCalendarInvoke
    await expect(createFinancialCalendarPlatform(badAlias).getYearlyReport(request)).rejects.toThrow('legacy aliases')
    const badFuture = vi.fn(async () => ({ ...annual, months: annualMonths.map((point, index) => index === 8 ? { ...point, incomeJpy: 1, savingsJpy: 1, savingsRateBps: 10_000 } : point) })) as unknown as FinancialCalendarInvoke
    await expect(createFinancialCalendarPlatform(badFuture).getYearlyReport(request)).rejects.toThrow('future month')
  })

  it('rejects malformed financial responses at the desktop boundary', async () => {
    const invoke = vi.fn(async () => ({ month: '2026-07', asOf: '2026-07-31', days: [{ events: [{ kind: 'UNKNOWN' }] }], budget, goals, dataQuality })) as unknown as FinancialCalendarInvoke
    await expect(createFinancialCalendarPlatform(invoke).getCalendar({ householdId: 'family', attributionScope: { kind: 'ALL' }, month: '2026-07' })).rejects.toThrow(TypeError)
  })
})
