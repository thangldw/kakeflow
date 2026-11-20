import { useEffect, useMemo, useState } from 'react'
import { localize } from '../../i18n'
import type { CategoryHistoryDto } from '../../platform/types'
import { historicalWhatIf, type Reductions } from './historicalWhatIf'

export interface TimeMachinePanelProps {
  readonly month: string
  readonly load: () => Promise<CategoryHistoryDto>
}

const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`
const SHOWN_CATEGORIES = 8
const PERCENT_CHOICES = [0, 10, 20, 30, 50] as const
const WINDOW_CHOICES = [3, 6, 12] as const

/** "What if I had spent less on this?" answered from the household's own posted history. Arithmetic, not a forecast. */
export function TimeMachinePanel({ month, load }: TimeMachinePanelProps) {
  const [history, setHistory] = useState<CategoryHistoryDto | null>(null)
  const [failed, setFailed] = useState(false)
  const [reductions, setReductions] = useState<Reductions>({})
  const [windowMonths, setWindowMonths] = useState<number>(12)

  useEffect(() => {
    let active = true
    setHistory(null); setFailed(false); setReductions({})
    Promise.resolve().then(load).then((result) => { if (active && result) setHistory(result) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [load, month])

  const usableWindow = history ? Math.min(windowMonths, history.months.length) : 0
  const result = useMemo(
    () => (history && usableWindow > 0 ? historicalWhatIf({ ...history, categories: history.categories.slice(0, SHOWN_CATEGORIES) }, reductions, usableWindow) : null),
    [history, reductions, usableWindow],
  )

  if (failed) return <section className="panel time-machine-panel" aria-label={localize("もしも…の振り返り")}><p role="alert">{localize("読み込めませんでした。")}</p></section>
  if (!history || !result) return null
  if (history.categories.length === 0) return <section className="panel time-machine-panel" aria-label={localize("もしも…の振り返り")}><h2>{localize("もしも…の振り返り")}</h2><p className="empty-state">{localize("この期間の支出はまだありません。")}</p></section>

  return <section className="panel time-machine-panel" aria-label={localize("もしも…の振り返り")}>
    <div className="panel-head"><div><h2>{localize("もしも…の振り返り")}</h2><p>{localize("実際の履歴に当てはめた単純な計算です。将来の予測ではありません。")}</p></div>
      <label>{localize("対象期間")}<select value={usableWindow} onChange={(event) => setWindowMonths(Number(event.target.value))}>
        {WINDOW_CHOICES.filter((choice) => choice <= history.months.length).map((choice) => <option key={choice} value={choice}>{localize(`直近${choice}か月`)}</option>)}
      </select></label>
    </div>
    <ul className="time-machine-list">
      {result.categories.map((category) => <li key={category.accountId}>
        <span>{category.name}</span>
        <span>{yen(category.spentJpy)}</span>
        <label>{localize("減らす割合")}<select aria-label={`${category.name} ${localize("減らす割合")}`} value={category.reductionPercent} onChange={(event) => setReductions({ ...reductions, [category.accountId]: Number(event.target.value) })}>
          {PERCENT_CHOICES.map((choice) => <option key={choice} value={choice}>{choice}%</option>)}
        </select></label>
        <strong>{category.savedJpy > 0 ? yen(category.savedJpy) : '—'}</strong>
      </li>)}
    </ul>
    <p className="time-machine-total" role="status">
      {result.totalSavedJpy > 0
        ? `${localize("この削減を続けていれば、直近")}${result.months.length}${localize("か月で")} ${yen(result.totalSavedJpy)} ${localize("が手元に残っていました（月平均")} ${yen(result.averageSavedPerMonthJpy)}${localize("）。")}`
        : localize("割合を選ぶと、実際の履歴にもとづく差額が表示されます。")}
    </p>
  </section>
}
