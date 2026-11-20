import { describe, expect, it } from 'vitest'
import type { FinancialCalendarDayDto } from '../calendar/financialCalendarPlatform'
import type { PaymentReminderDto } from '../../platform/types'
import { safeToSpend } from './safeToSpend'

function days(events: Record<string, FinancialCalendarDayDto['events']> = {}): FinancialCalendarDayDto[] {
  return Array.from({ length: 30 }, (_, i) => { const date = `2026-11-${String(i + 1).padStart(2, '0')}`; return { date, accrualIncomeJpy: 0, accrualExpenseJpy: 0, cashInflowJpy: 0, cashOutflowJpy: 0, postedTransactionCount: 0, noSpendDay: false, events: events[date] ?? [] } })
}
const cal = (asOf = '2026-11-21', events = {}) => ({ asOf, month: '2026-11', days: days(events) })
const card = (amountJpy: number) => [{ kind: 'CARD_PAYMENT_DUE' as const, id: 'c', title: 'カード', amountJpy, status: null }]
const reminder = (o: Partial<PaymentReminderDto>): PaymentReminderDto => ({ id: 'a'.repeat(32), householdId: 'h', dueOn: '2026-11-25', label: '電気', amountJpy: 10_000, done: false, ...o })

describe('safeToSpend', () => {
  it('sets aside card payments and amounted reminders due from today to month end and spreads the rest over the days left', () => {
    const result = safeToSpend(cal('2026-11-21', { '2026-11-27': card(50_000), '2026-11-10': card(99_999) }), 200_000, [reminder({}), reminder({ dueOn: '2026-12-02' }), reminder({ amountJpy: null }), reminder({ done: true })])
    expect(result).toMatchObject({ cardPaymentsJpy: 50_000, remindersJpy: 10_000, availableJpy: 140_000, daysLeft: 10, perDayJpy: 14_000, shortfallJpy: 0 })
  })

  it('counts an overdue reminder because it still has to be paid', () => {
    expect(safeToSpend(cal(), 100_000, [reminder({ dueOn: '2026-11-15', amountJpy: 30_000 })])?.availableJpy).toBe(70_000)
  })

  it('reports a shortfall instead of a negative daily amount', () => {
    const result = safeToSpend(cal('2026-11-21', { '2026-11-22': card(150_000) }), 100_000, [])
    expect(result).toMatchObject({ availableJpy: -50_000, shortfallJpy: 50_000, perDayJpy: 0 })
  })

  it('floors the daily amount to whole yen', () => {
    expect(safeToSpend(cal('2026-11-21'), 100_000, [])?.perDayJpy).toBe(10_000)
    expect(safeToSpend(cal('2026-11-21'), 100_005, [])?.perDayJpy).toBe(10_000)
  })

  it('includes today and the last day', () => {
    expect(safeToSpend(cal('2026-11-30'), 3_000, [])).toMatchObject({ daysLeft: 1, perDayJpy: 3_000 })
  })

  it('returns null for a month that is not the current one, or an unusable balance', () => {
    expect(safeToSpend({ asOf: '2026-12-02', month: '2026-11', days: days() }, 1, [])).toBeNull()
    expect(safeToSpend(cal(), Number.NaN, [])).toBeNull()
  })
})
