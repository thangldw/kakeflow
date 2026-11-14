import { describe, expect, it } from 'vitest'
import type { DashboardExpenseCategoryDto, MonthlyCategoryBudgetDto } from '../../platform/types'
import { computeRemainingToSpend, daysLeftInMonth, previousMonths, tokyoDate } from './homeMath'

function budget(id: string, budgetJpy: number, month = '2026-11'): MonthlyCategoryBudgetDto {
  // actualJpy is deliberately wrong: the math must ignore it and use categoryActuals.
  return { householdId: 'h', month, categoryAccountId: id, categoryName: `name-${id}`, budgetJpy, actualJpy: 999_999, remainingJpy: 0 }
}
function actual(id: string, amountJpy: number): DashboardExpenseCategoryDto {
  return { accountId: id, name: `name-${id}`, amountJpy }
}

const budgets = [budget('a', 60_000), budget('b', 45_000), budget('c', 15_000), budget('d', 20_000), budget('e', 15_000)]
const base = { month: '2026-11', today: '2026-11-14', budgetMonth: '2026-11', budgets, categoryActuals: [] as DashboardExpenseCategoryDto[], expenseJpy: 112_400, incomeJpy: 250_000 }

function allNumbersFinite(value: object) {
  return Object.values(value).every((v) => typeof v !== 'number' || Number.isFinite(v))
}

describe('computeRemainingToSpend', () => {
  it('computes remaining and per-day from the budget total', () => {
    const r = computeRemainingToSpend(base)
    expect(r.basis).toBe('BUDGET')
    expect(r.budgetMonth).toBe('2026-11')
    expect(r.totalBudgetJpy).toBe(155_000)
    expect(r.spentJpy).toBe(112_400)
    expect(r.remainingJpy).toBe(42_600)
    expect(r.overByJpy).toBe(0)
    expect(r.perDayJpy).toBe(2505)
    expect(r.usedRatio).toBeCloseTo(0.725, 3)
  })

  it('finds the budgeted category with the largest overspend', () => {
    const r = computeRemainingToSpend({ ...base, categoryActuals: [actual('a', 30_000), actual('d', 24_500), actual('e', 16_000)] })
    expect(r.mostOver).toEqual({ name: 'name-d', overJpy: 4500 })
  })

  it('has no mostOver when nothing exceeds its budget', () => {
    const r = computeRemainingToSpend({ ...base, categoryActuals: [actual('a', 30_000)] })
    expect(r.mostOver).toBeNull()
  })

  it('reports spending in categories without a budget row', () => {
    const r = computeRemainingToSpend({ ...base, categoryActuals: [actual('a', 30_000), actual('z', 5_000)], expenseJpy: 35_000 })
    expect(r.unbudgetedSpentJpy).toBe(5_000)
  })

  it('goes negative when over budget and has no per-day figure', () => {
    const r = computeRemainingToSpend({ ...base, expenseJpy: 170_000 })
    expect(r.remainingJpy).toBe(-15_000)
    expect(r.overByJpy).toBe(15_000)
    expect(r.perDayJpy).toBeNull()
    expect(r.usedRatio).toBe(1)
  })

  it('has no per-day figure for a past month', () => {
    const r = computeRemainingToSpend({ ...base, month: '2026-10', budgetMonth: '2026-10' })
    expect(r.basis).toBe('BUDGET')
    expect(r.perDayJpy).toBeNull()
  })

  it('falls back to income minus expense when there are no budgets', () => {
    const r = computeRemainingToSpend({ ...base, budgets: [], budgetMonth: null })
    expect(r.basis).toBe('INCOME_MINUS_EXPENSE')
    expect(r.budgetMonth).toBeNull()
    expect(r.remainingJpy).toBe(137_600)
    expect(r.perDayJpy).toBeNull()
    expect(r.totalBudgetJpy).toBe(0)
    expect(r.usedRatio).toBe(0)
    expect(r.mostOver).toBeNull()
    expect(r.unbudgetedSpentJpy).toBe(0)
  })

  it('returns all zeros without NaN for an empty month', () => {
    const r = computeRemainingToSpend({ ...base, budgets: [], budgetMonth: null, expenseJpy: 0, incomeJpy: 0 })
    expect(r).toEqual({ basis: 'INCOME_MINUS_EXPENSE', budgetMonth: null, totalBudgetJpy: 0, spentJpy: 0, unbudgetedSpentJpy: 0, remainingJpy: 0, overByJpy: 0, usedRatio: 0, perDayJpy: null, mostOver: null })
    expect(allNumbersFinite(r)).toBe(true)
  })

  it('handles a zero budget total without NaN or Infinity', () => {
    const zero = [budget('a', 0)]
    const idle = computeRemainingToSpend({ ...base, budgets: zero, expenseJpy: 0 })
    expect(idle.usedRatio).toBe(0)
    const spent = computeRemainingToSpend({ ...base, budgets: zero, expenseJpy: 3_000 })
    expect(spent.usedRatio).toBe(1)
    expect(spent.remainingJpy).toBe(-3_000)
    expect(allNumbersFinite(idle)).toBe(true)
    expect(allNumbersFinite(spent)).toBe(true)
  })

  it('uses categoryActuals for fallback budgets from an earlier month', () => {
    const fallback = budgets.map((b) => ({ ...b, month: '2026-10' }))
    const r = computeRemainingToSpend({ ...base, budgetMonth: '2026-10', budgets: fallback, categoryActuals: [actual('d', 24_500)] })
    expect(r.budgetMonth).toBe('2026-10')
    expect(r.mostOver).toEqual({ name: 'name-d', overJpy: 4500 })
  })
})

describe('daysLeftInMonth', () => {
  it('counts days remaining including today', () => {
    expect(daysLeftInMonth('2026-11-30')).toBe(1)
    expect(daysLeftInMonth('2026-11-01')).toBe(30)
    expect(daysLeftInMonth('2027-02-28')).toBe(1)
    expect(daysLeftInMonth('2028-02-28')).toBe(2)
  })
})

describe('previousMonths', () => {
  it('returns earlier months, nearest first, across year boundaries', () => {
    expect(previousMonths('2026-02', 3)).toEqual(['2026-01', '2025-12', '2025-11'])
    expect(previousMonths('2026-11', 0)).toEqual([])
  })
})

describe('tokyoDate', () => {
  it('returns the Asia/Tokyo calendar date', () => {
    expect(tokyoDate(new Date('2026-11-14T15:30:00Z'))).toBe('2026-11-15')
    expect(tokyoDate(new Date('2026-11-14T14:59:00Z'))).toBe('2026-11-14')
  })
})
