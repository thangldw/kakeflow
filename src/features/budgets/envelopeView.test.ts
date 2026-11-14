import { describe, expect, it } from 'vitest'
import type { MonthlyCategoryBudgetDto } from '../../platform/types'
import { buildEnvelopeView, movableJpy } from './envelopeView'

const budget = (categoryAccountId: string, categoryName: string, month: string, budgetJpy: number, actualJpy: number): MonthlyCategoryBudgetDto =>
  ({ householdId: 'h', month, categoryAccountId, categoryName, budgetJpy, actualJpy, remainingJpy: budgetJpy - actualJpy })

describe('envelope carry-over view', () => {
  it('rolls balances and the unassigned pool from the first budgeted month', () => {
    const view = buildEnvelopeView([
      { month: '2026-08', incomeJpy: 400_000, budgets: [budget('food', '食費', '2026-08', 60_000, 45_000)] },
      { month: '2026-09', incomeJpy: 400_000, budgets: [budget('food', '食費', '2026-09', 60_000, 70_000)] },
    ], '2026-09')!
    expect(view.startMonth).toBe('2026-08')
    expect(view.readyToAssignJpy).toBe(800_000 - 120_000)
    expect(view.rows).toEqual([{ categoryAccountId: 'food', categoryName: '食費', carryInJpy: 15_000, assignedJpy: 60_000, activityJpy: 70_000, availableJpy: 5_000 }])
  })

  it('ignores months before budgeting began so they cannot create phantom overspend', () => {
    const view = buildEnvelopeView([
      { month: '2026-07', incomeJpy: 300_000, budgets: [] },
      { month: '2026-08', incomeJpy: 300_000, budgets: [budget('rent', '住居', '2026-08', 100_000, 100_000)] },
    ], '2026-08')!
    expect(view.startMonth).toBe('2026-08')
    expect(view.readyToAssignJpy).toBe(200_000)
  })

  it('keeps an overspent envelope negative and returns null without any budget or after the selected month', () => {
    const over = buildEnvelopeView([{ month: '2026-08', incomeJpy: 0, budgets: [budget('fun', '娯楽', '2026-08', 10_000, 25_000)] }], '2026-08')!
    expect(over.rows[0].availableJpy).toBe(-15_000)
    expect(buildEnvelopeView([{ month: '2026-08', incomeJpy: 1, budgets: [] }], '2026-08')).toBeNull()
    expect(buildEnvelopeView([{ month: '2026-09', incomeJpy: 1, budgets: [budget('a', 'A', '2026-09', 1, 0)] }], '2026-08')).toBeNull()
    expect(buildEnvelopeView([], '2026-08')).toBeNull()
  })
})

describe('movable budget', () => {
  it('is what is left this month, capped by the assigned amount, and never negative', () => {
    expect(movableJpy({ assignedJpy: 5_000, activityJpy: 1_000 })).toBe(4_000)
    expect(movableJpy({ assignedJpy: 5_000, activityJpy: 9_000 })).toBe(0)
    expect(movableJpy({ assignedJpy: 5_000, activityJpy: -300 })).toBe(5_000)
    expect(movableJpy({ assignedJpy: 0, activityJpy: 0 })).toBe(0)
  })
})

describe('card payment envelopes in the view', () => {
  const food = (month: string, budgetJpy: number, actualJpy: number) => budget('food', '食費', month, budgetJpy, actualJpy)

  it('builds reserved, owed and gap per card from budgets and card activity', () => {
    const view = buildEnvelopeView([
      { month: '2026-08', incomeJpy: 100_000, budgets: [food('2026-08', 50_000, 30_000)], cardActivity: { month: '2026-08', cards: [{ cardAccountId: 'visa', cardName: 'Visa', owedJpy: 30_000, paymentsJpy: 0 }], activities: [{ categoryAccountId: 'food', cardAccountId: 'visa', amountJpy: 30_000 }] } },
      { month: '2026-09', incomeJpy: 100_000, budgets: [food('2026-09', 10_000, 25_000)], cardActivity: { month: '2026-09', cards: [{ cardAccountId: 'visa', cardName: 'Visa', owedJpy: 55_000, paymentsJpy: 0 }], activities: [{ categoryAccountId: 'food', cardAccountId: 'visa', amountJpy: 25_000 }] } },
    ], '2026-09')!
    // Aug: 30k funded. Sep: carry 20k + assigned 10k = 30k available, 25k card spend fully funded.
    expect(view.cards).toEqual([{ cardId: 'visa', cardName: 'Visa', reservedJpy: 55_000, fundedJpy: 25_000, paymentsJpy: 0, owedJpy: 55_000, gapJpy: 0 }])
  })

  it('has no cards without card data, and tolerates a month whose card data could not be read', () => {
    expect(buildEnvelopeView([{ month: '2026-09', incomeJpy: 1, budgets: [food('2026-09', 1, 0)] }], '2026-09')!.cards).toEqual([])
    const view = buildEnvelopeView([
      { month: '2026-08', incomeJpy: 1, budgets: [food('2026-08', 50_000, 10_000)], cardActivity: null },
      { month: '2026-09', incomeJpy: 1, budgets: [food('2026-09', 50_000, 10_000)], cardActivity: { month: '2026-09', cards: [{ cardAccountId: 'visa', cardName: 'Visa', owedJpy: 10_000, paymentsJpy: 0 }], activities: [{ categoryAccountId: 'food', cardAccountId: 'visa', amountJpy: 10_000 }] } },
    ], '2026-09')!
    expect(view.cards[0]).toMatchObject({ reservedJpy: 10_000, gapJpy: 0 })
  })
})
