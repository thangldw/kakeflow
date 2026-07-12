import { describe, expect, it, vi } from 'vitest'

import { createForecastActionPlatform, parseForecastAction } from './forecastActionPlatform'
import type { ForecastActionInvoke } from './forecastActionPlatform'

const response = {
  asOf: '2026-07-13', forecastFrom: '2026-08', forecastThrough: '2026-10', openingCashJpy: 500_000,
  assumptions: {
    historyFrom: '2026-04', historyThrough: '2026-06', historyMonths: 3,
    averageMonthlyIncomeJpy: 300_000, averageMonthlyExpenseJpy: 180_000,
    averageMonthlyNonRecurringExpenseJpy: 170_000, averageMonthlyCashChangeBeforeCardPaymentsJpy: 120_000,
    recurringMonthlyExpenseJpy: 10_000, recurringItemCount: 2, reasons: ['Three completed months'],
  },
  months: [{
    month: '2026-08', openingCashJpy: 500_000, projectedIncomeJpy: 300_000,
    projectedNonRecurringExpenseJpy: 170_000, projectedRecurringExpenseJpy: 10_000,
    projectedSavingsJpy: 120_000, projectedCashChangeBeforeCardPaymentsJpy: 120_000,
    knownCardPaymentsJpy: 50_000, projectedCashChangeJpy: 70_000, closingCashJpy: 570_000,
  }],
  actions: [{
    id: 'card:s1', kind: 'CARD_PAYMENT_DUE', priority: 'HIGH', title: 'Upcoming card payment',
    detail: 'Statement is due', dueOn: '2026-08-27', amountJpy: 50_000, entityId: 's1', reasons: ['Known statement'],
  }],
}

describe('forecast action platform', () => {
  it('invokes the household-scoped command and validates the response', async () => {
    const invoke = vi.fn(async () => response) as unknown as ForecastActionInvoke
    const result = await createForecastActionPlatform(invoke).query({ householdId: 'family', asOf: '2026-07-13' })
    expect(invoke).toHaveBeenCalledWith('forecast_action_query', { request: { householdId: 'family', asOf: '2026-07-13' } })
    expect(result.months[0].projectedSavingsJpy).toBe(120_000)
    expect(result.actions[0].kind).toBe('CARD_PAYMENT_DUE')
  })

  it('rejects malformed nested financial values and enum drift', () => {
    expect(() => parseForecastAction({ ...response, months: [{ ...response.months[0], closingCashJpy: 1.5 }] })).toThrow('closingCashJpy')
    expect(() => parseForecastAction({ ...response, actions: [{ ...response.actions[0], priority: 'URGENT' }] })).toThrow('priority')
    expect(() => parseForecastAction({ ...response, forecastThrough: '2026-13' })).toThrow('forecastThrough')
  })
})
