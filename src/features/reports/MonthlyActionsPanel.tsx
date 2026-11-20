import { useEffect, useState } from 'react'
import { localize } from '../../i18n'
import type { FinancialCalendarDto } from '../calendar/financialCalendarPlatform'
import type { PaymentReminderDto } from '../../platform/types'
import { monthlyActions, type MonthlyAction, type MonthlyActionTarget } from './monthlyActions'

export interface MonthlyActionsPanelProps {
  readonly calendar: Pick<FinancialCalendarDto, 'asOf' | 'month' | 'days' | 'budget' | 'goals' | 'dataQuality'>
  readonly householdId: string
  readonly listReminders: (householdId: string) => Promise<readonly PaymentReminderDto[]>
  /** Bills and card payments are handled on this same page, so only imports, budgets and goals navigate. */
  readonly onOpen?: (target: Exclude<MonthlyActionTarget, 'calendar'>) => void
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`

function actionText(action: MonthlyAction): string {
  switch (action.id) {
    case 'overdue-reminder': return `${action.label}${action.amountJpy === null ? '' : ` ${yen(action.amountJpy)}`} — ${localize(`${action.daysOverdue}日超過`)}`
    case 'card-payment-due': return `${action.label} ${yen(action.amountJpy)} — ${action.dueOn}（${localize(`あと${action.daysLeft}日`)}）`
    case 'reminder-due-soon': return `${action.label}${action.amountJpy === null ? '' : ` ${yen(action.amountJpy)}`} — ${action.dueOn}（${action.daysLeft === 0 ? localize("今日が期限") : localize(`あと${action.daysLeft}日`)}）`
    case 'review-imports': return `${localize("確認待ちの取り込みがあります")}: ${action.count}`
    case 'over-budget': return `${localize("予算を超過したカテゴリー")}: ${action.count}`
    case 'budget-pace': return `${localize("このペースだと月末の支出は")} ${yen(action.projectedJpy)} ${localize("になり、予算")} ${yen(action.budgetJpy)} ${localize("を超える見込みです（日割りの単純な見通し）。")}`
    case 'goals-due': return `${localize("期限が近い目標があります")}: ${action.count}`
  }
}

/** The few most useful things to do right now, drawn only from data already on this page. */
export function MonthlyActionsPanel({ calendar, householdId, listReminders, onOpen }: MonthlyActionsPanelProps) {
  const [reminders, setReminders] = useState<readonly PaymentReminderDto[]>([])
  useEffect(() => {
    let cancelled = false
    void listReminders(householdId).then((rows) => { if (!cancelled) setReminders(rows) }, () => { if (!cancelled) setReminders([]) })
    return () => { cancelled = true }
  }, [householdId, listReminders])
  const actions = monthlyActions(calendar, reminders)
  return <section className="panel monthly-actions-panel" aria-label={localize("今月やること")}>
    <div className="panel-head"><div><h2>{localize("今月やること")}</h2><p>{actions.length === 0 ? localize("今、急いでやることはありません。") : localize("優先度の高い順に最大3件です。")}</p></div></div>
    {actions.length > 0 && <ol>
      {actions.map((action, index) => {
        const target = action.target
        return <li key={`${action.id}-${index}`}>
          <span>{actionText(action)}</span>
          {onOpen && target !== 'calendar' && <button type="button" className="text-btn" onClick={() => onOpen(target)}>{localize("開く")}</button>}
        </li>
      })}
    </ol>}
  </section>
}
