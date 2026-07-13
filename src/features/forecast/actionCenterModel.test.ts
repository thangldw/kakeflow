import { describe, expect, it } from 'vitest'
import type { ActionItemDto, ActionKind, ActionPriority } from './forecastActionPlatform'
import { homeActionSlice, orderActions, pageForAction } from './actionCenterModel'

const action = (id: string, priority: ActionPriority, dueOn: string | null = null, kind: ActionKind = 'SPENDING_ANOMALY'): ActionItemDto => ({ id, kind, priority, title: id, detail: id, dueOn, amountJpy: null, entityId: null, reasons: [] })

describe('action center model', () => {
  it('orders deterministically by priority, due date, and stable id', () => {
    const ordered = orderActions([action('z', 'HIGH'), action('b', 'CRITICAL', '2026-08-02'), action('a', 'CRITICAL', '2026-08-02'), action('dated', 'HIGH', '2026-07-20')])
    expect(ordered.map((item) => item.id)).toEqual(['a', 'b', 'dated', 'z'])
  })

  it('returns a bounded home slice and exact remaining count', () => {
    const result = homeActionSlice(['a', 'b', 'c', 'd'].map((id) => action(id, 'MEDIUM')), 3)
    expect(result.visible.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(result).toMatchObject({ total: 4, remaining: 1 })
  })

  it.each([
    ['IMPORT_REVIEW', 'import'], ['IMPORT_FAILED', 'import'],
    ['CARD_MISMATCH', 'cards'], ['CARD_PAYMENT_DUE', 'cards'], ['CARD_BALANCE_SHORTFALL', 'cards'], ['CARD_MAPPING_REQUIRED', 'cards'],
    ['BUDGET_OVERRUN', 'budgets'], ['GOAL_DUE', 'budgets'],
    ['SPENDING_ANOMALY', 'transactions'], ['RECURRING_PRICE_CHANGE', 'transactions'],
  ] as const)('routes %s to %s', (kind, page) => expect(pageForAction({ kind })).toBe(page))
})
