import { describe, expect, it } from 'vitest'
import { projectScenario } from './scenarioModel'
import type { ForecastMonthDto } from './forecastActionPlatform'

const month = (name: string, closingCashJpy: number): ForecastMonthDto => ({
  month: name, openingCashJpy: 0, projectedIncomeJpy: 0, projectedNonRecurringExpenseJpy: 0, projectedRecurringExpenseJpy: 0,
  projectedSavingsJpy: 0, projectedCashChangeBeforeCardPaymentsJpy: 0, knownCardPaymentsJpy: 0, projectedCashChangeJpy: 0, closingCashJpy,
})
const base = [month('2026-08', 300_000), month('2026-09', 320_000), month('2026-10', 340_000)]
const none = { monthlyIncomeDeltaJpy: 0, monthlyExpenseDeltaJpy: 0, oneTimeOutflowJpy: 0 }

describe('scenario projection', () => {
  it('is the identity for zero adjustments', () => {
    const result = projectScenario(base, none)
    expect(result.months.map((item) => item.scenarioClosingCashJpy)).toEqual([300_000, 320_000, 340_000])
    expect(result.endingDeltaJpy).toBe(0)
    expect(result.firstNegativeMonth).toBeNull()
  })

  it('accumulates monthly deltas and applies a one-time outflow to the first month only', () => {
    const result = projectScenario(base, { monthlyIncomeDeltaJpy: 20_000, monthlyExpenseDeltaJpy: 5_000, oneTimeOutflowJpy: 100_000 })
    expect(result.months.map((item) => item.deltaJpy)).toEqual([-85_000, -70_000, -55_000])
    expect(result.months.map((item) => item.scenarioClosingCashJpy)).toEqual([215_000, 250_000, 285_000])
    expect(result.lowestMonth).toBe('2026-08')
    expect(result.lowestClosingCashJpy).toBe(215_000)
  })

  it('reports the first month that goes negative', () => {
    const result = projectScenario(base, { monthlyIncomeDeltaJpy: 0, monthlyExpenseDeltaJpy: 200_000, oneTimeOutflowJpy: 0 })
    expect(result.firstNegativeMonth).toBe('2026-09')
    expect(result.endingDeltaJpy).toBe(-600_000)
  })

  it('rejects fractional yen and negative one-time outflows and does not mutate input', () => {
    expect(() => projectScenario(base, { ...none, monthlyIncomeDeltaJpy: 1.5 })).toThrow(RangeError)
    expect(() => projectScenario(base, { ...none, oneTimeOutflowJpy: -1 })).toThrow(RangeError)
    expect(base[0].closingCashJpy).toBe(300_000)
    expect(projectScenario([], none)).toMatchObject({ months: [], lowestMonth: null, firstNegativeMonth: null, endingDeltaJpy: 0 })
  })
})
