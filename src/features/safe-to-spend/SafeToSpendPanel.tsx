import { useEffect, useMemo, useState } from 'react'
import { localize } from '../../i18n'
import type { FinancialCalendarDto } from '../calendar/financialCalendarPlatform'
import type { PaymentReminderDto } from '../../platform/types'
import { safeToSpend } from './safeToSpend'

export interface SafeToSpendPanelProps {
  readonly calendar: Pick<FinancialCalendarDto, 'asOf' | 'month' | 'days'>
  readonly openingCashJpy: number
  readonly householdId: string
  readonly listReminders: (householdId: string) => Promise<readonly PaymentReminderDto[]>
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

/** Cash left per day until month end after the card payments and reminders already on record. Known commitments only. */
export function SafeToSpendPanel({ calendar, openingCashJpy, householdId, listReminders }: SafeToSpendPanelProps) {
  const [reminders, setReminders] = useState<readonly PaymentReminderDto[]>([])
  useEffect(() => {
    let cancelled = false
    void listReminders(householdId).then((rows) => { if (!cancelled) setReminders(rows) }, () => { if (!cancelled) setReminders([]) })
    return () => { cancelled = true }
  }, [householdId, listReminders])
  const result = useMemo(() => safeToSpend(calendar, openingCashJpy, reminders), [calendar, openingCashJpy, reminders])
  if (!result) return null
  return <section className="panel safe-to-spend-panel" aria-label={localize("今日から月末まで使える額")}>
    <div className="panel-head"><div><h2>{localize("今日から月末まで使える額")}</h2>
      <p>{localize("手元の現金から、支払いが決まっているものを引いた金額です。これから入る収入や、金額が未入力の請求は含みません。")}</p></div></div>
    {result.shortfallJpy > 0
      ? <p role="status"><strong>{localize("不足")} {yen(result.shortfallJpy)}</strong> — {localize("月末までに決まっている支払いが、手元の現金を上回っています。")}</p>
      : <p role="status"><strong>{yen(result.perDayJpy)}</strong> {localize("／日")} <small>（{localize(`あと${result.daysLeft}日`)}・{yen(result.availableJpy)}）</small></p>}
    <ul className="safe-to-spend-breakdown">
      <li><span>{localize("手元の現金")}</span><span>{yen(result.cashJpy)}</span></li>
      <li><span>{localize("カードの支払い")}</span><span>−{yen(result.cardPaymentsJpy)}</span></li>
      <li><span>{localize("支払いリマインダー")}</span><span>−{yen(result.remindersJpy)}</span></li>
    </ul>
  </section>
}
