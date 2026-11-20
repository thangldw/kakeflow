import type { FinancialCalendarDto } from '../calendar/financialCalendarPlatform'
import type { PaymentReminderDto } from '../../platform/types'

export interface SafeToSpend {
  /** Cash on hand today, from the forecast's opening balance. */
  readonly cashJpy: number
  /** Card payments due from today to month end, from the calendar. */
  readonly cardPaymentsJpy: number
  /** Unpaid reminders with an amount, due from today to month end. */
  readonly remindersJpy: number
  /** Cash left after those known commitments; negative means they exceed it. */
  readonly availableJpy: number
  /** Days from today to month end, today included. */
  readonly daysLeft: number
  /** Whole yen per day (floored); 0 when nothing is left to spend. */
  readonly perDayJpy: number
  readonly shortfallJpy: number
}

/**
 * How much cash is left to spend until month end once the commitments already on record are set aside.
 * Deliberately conservative and plain: it counts only cash now, card payments due and reminders with an amount.
 * It does NOT count income still to come, bills with no recorded amount, or ordinary spending, so it is a
 * "known commitments" figure, never a prediction. Reminders overdue (before today) are included, because
 * they still have to be paid.
 */
export function safeToSpend(
  calendar: Pick<FinancialCalendarDto, 'asOf' | 'month' | 'days'>,
  openingCashJpy: number,
  reminders: readonly PaymentReminderDto[],
): SafeToSpend | null {
  if (!Number.isSafeInteger(openingCashJpy)) return null
  const today = calendar.asOf
  if (!today.startsWith(calendar.month)) return null // the month shown is not the current one
  const monthEnd = calendar.days.length > 0 ? calendar.days[calendar.days.length - 1].date : null
  if (monthEnd === null || today > monthEnd) return null
  const daysLeft = calendar.days.filter((day) => day.date >= today).length
  if (daysLeft === 0) return null

  let cardPayments = 0
  for (const day of calendar.days) {
    if (day.date < today) continue
    for (const event of day.events) {
      if (event.kind === 'CARD_PAYMENT_DUE' && event.amountJpy > 0) cardPayments += event.amountJpy
    }
  }
  let remindersTotal = 0
  for (const reminder of reminders) {
    if (reminder.done || reminder.amountJpy === null || reminder.dueOn > monthEnd) continue
    remindersTotal += reminder.amountJpy
  }
  const available = openingCashJpy - cardPayments - remindersTotal
  return {
    cashJpy: openingCashJpy, cardPaymentsJpy: cardPayments, remindersJpy: remindersTotal, availableJpy: available,
    daysLeft, perDayJpy: available > 0 ? Math.floor(available / daysLeft) : 0, shortfallJpy: available < 0 ? -available : 0,
  }
}
