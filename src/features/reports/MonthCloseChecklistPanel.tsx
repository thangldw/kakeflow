import { localize } from '../../i18n'
import type { FinancialCalendarDto } from '../calendar/financialCalendarPlatform'
import { monthCloseChecklist, type MonthCloseItem, type MonthCloseTarget } from './monthCloseChecklist'

export interface MonthCloseChecklistPanelProps {
  readonly calendar: Pick<FinancialCalendarDto, 'dataQuality' | 'budget'>
  readonly onOpen?: (target: MonthCloseTarget) => void
}

function itemText(item: MonthCloseItem): string {
  switch (item.id) {
    case 'review-imports': return item.done ? localize("確認待ちの取り込みはありません") : `${localize("確認待ちの取り込みがあります")}: ${item.count}`
    case 'failed-imports': return item.done ? localize("失敗した取り込みはありません") : `${localize("失敗した取り込みがあります")}: ${item.count}`
    case 'in-progress-imports': return item.done ? localize("処理中の取り込みはありません") : `${localize("処理中の取り込みがあります")}: ${item.count}`
    case 'fresh-data': return item.done ? localize("取り込みデータは最新です") : item.count === 0 ? localize("まだ取り込みがありません") : `${localize("最後の取り込みから日数が経っています")}: ${item.count}`
    case 'budget-set': return item.done ? localize("予算が設定されています") : localize("予算が未設定です")
    case 'over-budget': return item.done ? localize("予算超過のカテゴリーはありません") : `${localize("予算を超過したカテゴリー")}: ${item.count}`
  }
}

/** "Close the month": what is still open (imports, stale data, budget) with a link to fix each item. */
export function MonthCloseChecklistPanel({ calendar, onOpen }: MonthCloseChecklistPanelProps) {
  const checklist = monthCloseChecklist(calendar)
  return <section className="panel month-close-panel" aria-label={localize("月次の締めチェック")}>
    <div className="panel-head">
      <div><h2>{localize("月次の締めチェック")}</h2><p>{checklist.complete ? localize("すべて完了しています。") : `${checklist.doneCount} / ${checklist.total}`}</p></div>
    </div>
    <progress value={checklist.doneCount} max={checklist.total} aria-label={localize("締めチェックの進み具合")} />
    <ul>
      {checklist.items.map((item) => <li key={item.id} className={item.done ? 'month-close-done' : 'month-close-open'}>
        <span aria-hidden="true">{item.done ? '✓' : '○'}</span>
        <span>{itemText(item)}</span>
        {!item.done && onOpen && <button type="button" className="text-btn" onClick={() => onOpen(item.target)}>{localize("開く")}</button>}
      </li>)}
    </ul>
  </section>
}
