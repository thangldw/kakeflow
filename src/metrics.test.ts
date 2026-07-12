import { describe, expect, it } from 'vitest'
import { budgetUsage, currentMonthMetrics, savings, savingsRate } from './metrics'
import { categoryData } from './data'

describe('financial metric invariants', () => {
  it('derives the expense KPI from its category breakdown', () => {
    expect(currentMonthMetrics.expense).toBe(categoryData.reduce((total, item) => total + item.amount, 0))
  })

  it('derives savings and ratios from the same monthly facts', () => {
    expect(savings).toBe(currentMonthMetrics.income - currentMonthMetrics.expense)
    expect(savingsRate).toBeCloseTo(savings / currentMonthMetrics.income)
    expect(budgetUsage).toBeCloseTo(currentMonthMetrics.expense / currentMonthMetrics.budget)
  })
})
