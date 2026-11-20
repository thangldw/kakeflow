import { describe, expect, it } from 'vitest'
import type { FinancialCalendarDto, FinancialCalendarDayDto } from '../calendar/financialCalendarPlatform'
import type { PaymentReminderDto } from '../../platform/types'
import { monthlyActions } from './monthlyActions'

function day(date: string, events: FinancialCalendarDayDto['events'] = []): FinancialCalendarDayDto {
  return { date, accrualIncomeJpy: 0, accrualExpenseJpy: 0, cashInflowJpy: 0, cashOutflowJpy: 0, postedTransactionCount: 0, noSpendDay: false, events }
}
function month(events: Record<string, FinancialCalendarDayDto['events']> = {}) {
  return Array.from({ length: 30 }, (_, i) => { const date = `2026-11-${String(i + 1).padStart(2, '0')}`; return day(date, events[date] ?? []) })
}
function calendar(overrides: Partial<FinancialCalendarDto> = {}): FinancialCalendarDto {
  return {
    month: '2026-11', asOf: '2026-11-10', days: month(),
    budget: { budgetJpy: 0, actualJpy: 0, remainingJpy: 0, utilizationBps: null, categoryCount: 0, overBudgetCount: 0 },
    goals: { activeCount: 0, targetJpy: 0, savedJpy: 0, remainingJpy: 0, dueWithinPeriodCount: 0 },
    dataQuality: { totalImports: 1, postedImports: 1, reviewRequiredImports: 0, failedImports: 0, inProgressImports: 0, importCompletionBps: 10000, latestImportedAt: null, staleDays: 1, hasUnresolvedImports: false },
    ...overrides,
  }
}
const reminder = (o: Partial<PaymentReminderDto>): PaymentReminderDto => ({ id: 'a'.repeat(32), householdId: 'h', dueOn: '2026-11-12', label: '電気代', amountJpy: 8200, done: false, ...o })

describe('monthlyActions', () => {
  it('is empty when nothing needs attention', () => {
    expect(monthlyActions(calendar(), [])).toEqual([])
  })

  it('ranks overdue bills first, then soon-due payments, then imports, budget, goals, and keeps three', () => {
    const cal = calendar({
      days: month({ '2026-11-13': [{ kind: 'CARD_PAYMENT_DUE', id: 'c', title: 'Rカード', amountJpy: 54_000, status: null }] }),
      dataQuality: { ...calendar().dataQuality, reviewRequiredImports: 2 },
      budget: { ...calendar().budget, budgetJpy: 100_000, overBudgetCount: 1 },
      goals: { ...calendar().goals, dueWithinPeriodCount: 1 },
    })
    const actions = monthlyActions(cal, [reminder({ id: 'b'.repeat(32), dueOn: '2026-11-08', label: '水道', amountJpy: null })])
    expect(actions.map((a) => a.id)).toEqual(['overdue-reminder', 'card-payment-due', 'review-imports'])
    expect(actions[0]).toMatchObject({ daysOverdue: 2, label: '水道', amountJpy: null })
    expect(actions[1]).toMatchObject({ daysLeft: 3, amountJpy: 54_000, dueOn: '2026-11-13' })
  })

  it('includes reminders due within a week but not later ones, finished ones, or past card events', () => {
    const cal = calendar({ days: month({ '2026-11-05': [{ kind: 'CARD_PAYMENT_DUE', id: 'c', title: '過去', amountJpy: 1, status: null }], '2026-11-30': [{ kind: 'CARD_PAYMENT_DUE', id: 'd', title: '先', amountJpy: 1, status: null }] }) })
    const actions = monthlyActions(cal, [reminder({ dueOn: '2026-11-17' }), reminder({ dueOn: '2026-11-18' }), reminder({ dueOn: '2026-11-11', done: true })])
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ id: 'reminder-due-soon', daysLeft: 7 })
  })

  it('projects a straight-line pace only once the month is under way and no category is over already', () => {
    const budget = { budgetJpy: 100_000, actualJpy: 60_000, remainingJpy: 40_000, utilizationBps: 6000, categoryCount: 3, overBudgetCount: 0 }
    expect(monthlyActions(calendar({ budget }), [])).toEqual([{ id: 'budget-pace', urgency: 5, target: 'budgets', projectedJpy: 180_000, budgetJpy: 100_000 }])
    expect(monthlyActions(calendar({ budget, asOf: '2026-11-05' }), [])).toEqual([])
    expect(monthlyActions(calendar({ budget: { ...budget, overBudgetCount: 1 } }), []).map((a) => a.id)).toEqual(['over-budget'])
    expect(monthlyActions(calendar({ budget: { ...budget, actualJpy: 20_000 } }), [])).toEqual([])
    expect(monthlyActions(calendar({ budget, asOf: '2026-12-10' }), [])).toEqual([])
  })
})
