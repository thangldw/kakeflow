import { describe, expect, it } from 'vitest'
import { monthCloseChecklist } from './monthCloseChecklist'

const quality = { totalImports: 5, postedImports: 5, reviewRequiredImports: 0, failedImports: 0, inProgressImports: 0, importCompletionBps: 10000, latestImportedAt: '2026-11-18', staleDays: 1, hasUnresolvedImports: false }
const budget = { budgetJpy: 200000, actualJpy: 150000, remainingJpy: 50000, utilizationBps: 7500, categoryCount: 6, overBudgetCount: 0 }

describe('monthCloseChecklist', () => {
  it('is complete when imports are settled, data is fresh and the budget is set and respected', () => {
    const result = monthCloseChecklist({ dataQuality: quality, budget })
    expect(result).toMatchObject({ doneCount: 6, total: 6, complete: true })
  })

  it('lists outstanding imports with counts', () => {
    const result = monthCloseChecklist({ dataQuality: { ...quality, reviewRequiredImports: 3, failedImports: 1, inProgressImports: 2 }, budget })
    const byId = Object.fromEntries(result.items.map((item) => [item.id, item]))
    expect(byId['review-imports']).toMatchObject({ done: false, count: 3 })
    expect(byId['failed-imports']).toMatchObject({ done: false, count: 1 })
    expect(byId['in-progress-imports']).toMatchObject({ done: false, count: 2 })
    expect(result.complete).toBe(false)
  })

  it('flags stale data after a week and a month with no imports at all', () => {
    expect(monthCloseChecklist({ dataQuality: { ...quality, staleDays: 8 }, budget }).items.find((i) => i.id === 'fresh-data')).toMatchObject({ done: false, count: 8 })
    expect(monthCloseChecklist({ dataQuality: { ...quality, staleDays: 7 }, budget }).items.find((i) => i.id === 'fresh-data')?.done).toBe(true)
    const none = monthCloseChecklist({ dataQuality: { ...quality, totalImports: 0, staleDays: null, latestImportedAt: null }, budget })
    expect(none.items.find((i) => i.id === 'fresh-data')).toMatchObject({ done: false, count: 0 })
  })

  it('asks for a budget and reports overspent categories', () => {
    const result = monthCloseChecklist({ dataQuality: quality, budget: { ...budget, categoryCount: 0, overBudgetCount: 2 } })
    expect(result.items.find((i) => i.id === 'budget-set')?.done).toBe(false)
    expect(result.items.find((i) => i.id === 'over-budget')).toMatchObject({ done: false, count: 2, target: 'budgets' })
  })
})
