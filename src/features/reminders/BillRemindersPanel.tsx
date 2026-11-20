import { useCallback, useEffect, useState } from 'react'
import { localize } from '../../i18n'
import type { PaymentReminderDto, PaymentReminderInputDto } from '../../platform/types'

export interface BillRemindersPanelProps {
  readonly householdId: string
  /** Today's date in Tokyo (YYYY-MM-DD), to mark overdue and near deadlines. */
  readonly today: string
  readonly list: (householdId: string) => Promise<readonly PaymentReminderDto[]>
  readonly create: (input: PaymentReminderInputDto) => Promise<PaymentReminderDto>
  readonly setDone: (householdId: string, id: string, done: boolean) => Promise<void>
  readonly remove: (householdId: string, id: string) => Promise<void>
  /** Bumped by the parent when a reminder was added elsewhere (from a scanned bill), to reload the list. */
  readonly revision?: number
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** Deadlines the user confirmed (typed in, or suggested from a scanned bill), soonest first. */
export function BillRemindersPanel({ householdId, today, list, create, setDone, remove, revision = 0 }: BillRemindersPanelProps) {
  const [reminders, setReminders] = useState<readonly PaymentReminderDto[]>([])
  const [failed, setFailed] = useState(false)
  const [label, setLabel] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try { setReminders(await list(householdId)); setFailed(false) } catch { setFailed(true) }
  }, [householdId, list])

  useEffect(() => { void reload() }, [reload, revision])

  const amountJpy = /^\d+$/u.test(amount.trim()) ? Number(amount.trim()) : null
  const amountInvalid = amount.trim() !== '' && amountJpy === null
  const canAdd = label.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/u.test(dueOn) && !amountInvalid && !busy

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action(); await reload() } catch { setFailed(true) } finally { setBusy(false) }
  }

  const add = () => act(async () => {
    await create({ householdId, dueOn, label: label.trim(), amountJpy })
    setLabel(''); setDueOn(''); setAmount('')
  })

  const status = (reminder: PaymentReminderDto) => {
    if (reminder.done) return localize("支払い済み")
    const days = daysBetween(today, reminder.dueOn)
    if (days < 0) return localize(`${-days}日超過`)
    return days === 0 ? localize("今日が期限") : localize(`あと${days}日`)
  }

  return <section className="panel bill-reminders-panel" aria-label={localize("支払いリマインダー")}>
    <div className="panel-head"><div><h2>{localize("支払いリマインダー")}</h2><p>{localize("請求書の支払期限を覚えておきます。この端末にだけ保存され、台帳は変更しません。")}</p></div></div>
    {failed && <p role="alert">{localize("リマインダーを処理できませんでした。")}</p>}
    {reminders.length === 0
      ? <p className="empty-state">{localize("登録されたリマインダーはありません。")}</p>
      : <ul className="bill-reminders-list">
        {reminders.map((reminder) => {
          const overdue = !reminder.done && reminder.dueOn < today
          return <li key={reminder.id} className={reminder.done ? 'bill-reminder-done' : overdue ? 'bill-reminder-overdue' : ''}>
            <span>{reminder.dueOn}</span>
            <span>{reminder.label}{reminder.amountJpy !== null && <> <strong>{yen(reminder.amountJpy)}</strong></>}</span>
            <small>{status(reminder)}</small>
            <button type="button" className="text-btn" disabled={busy} onClick={() => void act(() => setDone(householdId, reminder.id, !reminder.done))}>{reminder.done ? localize("未払いに戻す") : localize("支払い済みにする")}</button>
            <button type="button" className="text-btn" disabled={busy} aria-label={`${reminder.label} ${localize("を削除")}`} onClick={() => void act(() => remove(householdId, reminder.id))}>{localize("削除")}</button>
          </li>
        })}
      </ul>}
    <div className="bill-reminders-form">
      <label>{localize("内容")}<input value={label} maxLength={200} onChange={(event) => setLabel(event.target.value)} placeholder={localize("例: 電気代")} /></label>
      <label>{localize("支払期限")}<input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label>
      <label>{localize("金額（任意）")}<input inputMode="numeric" value={amount} aria-invalid={amountInvalid} onChange={(event) => setAmount(event.target.value)} /></label>
      <button type="button" className="secondary-btn" disabled={!canAdd} onClick={() => void add()}>{localize("追加")}</button>
    </div>
  </section>
}
