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

describe('financial calendar platform boundary', () => {
  it('invokes the isolated calendar command and validates nested events', async () => {
    const response = {
      month: '2026-07', asOf: '2026-07-31', budget, goals, dataQuality,
      days: [{ date: '2026-07-27', accrualIncomeJpy: 0, accrualExpenseJpy: 0, cashInflowJpy: 0, cashOutflowJpy: 70_000, postedTransactionCount: 1, noSpendDay: true, events: [{ kind: 'CARD_PAYMENT_DUE', id: 'statement', title: 'Card', amountJpy: 70_000, status: 'POSSIBLE_MATCH' }] }],
    }
    const invoke = vi.fn(async () => response) as unknown as FinancialCalendarInvoke
    const platform = createFinancialCalendarPlatform(invoke)
    await expect(platform.getCalendar({ householdId: 'family', accountGroupId: 'daily', month: '2026-07', asOf: '2026-07-31' })).resolves.toEqual(response)
    expect(invoke).toHaveBeenCalledWith('financial_calendar_query', { request: { householdId: 'family', accountGroupId: 'daily', month: '2026-07', asOf: '2026-07-31' } })
  })

  it('invokes and parses monthly and yearly financial reports', async () => {
    const monthly = { period: '2026-07', ...sharedReport, priorMonth: { ...metrics, expenseJpy: 40_000 }, vsPriorMonth: deltas }
    const yearly = { period: '2026', ...sharedReport, months: [{ month: '2026-07', ...metrics }] }
    const invoke = vi.fn(async (command: string) => command === 'financial_report_monthly_query' ? monthly : yearly) as unknown as FinancialCalendarInvoke
    const platform = createFinancialCalendarPlatform(invoke)
    await expect(platform.getMonthlyReport({ householdId: 'family', month: '2026-07' })).resolves.toEqual(monthly)
    await expect(platform.getYearlyReport({ householdId: 'family', year: '2026' })).resolves.toEqual(yearly)
    expect(invoke).toHaveBeenNthCalledWith(1, 'financial_report_monthly_query', { request: { householdId: 'family', month: '2026-07' } })
    expect(invoke).toHaveBeenNthCalledWith(2, 'financial_report_yearly_query', { request: { householdId: 'family', year: '2026' } })
  })

  it('rejects malformed financial responses at the desktop boundary', async () => {
    const invoke = vi.fn(async () => ({ month: '2026-07', asOf: '2026-07-31', days: [{ events: [{ kind: 'UNKNOWN' }] }], budget, goals, dataQuality })) as unknown as FinancialCalendarInvoke
    await expect(createFinancialCalendarPlatform(invoke).getCalendar({ householdId: 'family', month: '2026-07' })).rejects.toThrow(TypeError)
  })
})
