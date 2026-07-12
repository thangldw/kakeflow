import type { ActionItemDto, ActionKind, ActionPriority, ForecastActionDto } from './forecastActionPlatform'
import './forecastActionViews.css'

export interface ForecastActionViewsProps {
  readonly data: ForecastActionDto
  readonly onAction?: (action: ActionItemDto) => void
}

const priorityLabels: Record<ActionPriority, string> = {
  CRITICAL: '緊急', HIGH: '高', MEDIUM: '中', LOW: '低',
}

const kindLabels: Record<ActionKind, string> = {
  IMPORT_REVIEW: '取込確認', IMPORT_FAILED: '取込失敗', CARD_MISMATCH: 'カード不一致',
  CARD_PAYMENT_DUE: 'カード引落', BUDGET_OVERRUN: '予算超過', GOAL_DUE: '目標期限',
  SPENDING_ANOMALY: '異常支出', RECURRING_PRICE_CHANGE: '定期支払変更',
}

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`
const signedYen = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${yen(Math.abs(value))}`
const monthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`

export function ActionCenter({ actions, onAction }: { readonly actions: readonly ActionItemDto[]; readonly onAction?: (action: ActionItemDto) => void }) {
  const ordered = [...actions].sort((left, right) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(left.priority) - ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(right.priority))
  return <section className="forecast-panel action-center" aria-labelledby="action-center-title">
    <header><div><p>Action Center</p><h2 id="action-center-title">対応が必要な項目</h2></div><span className="action-count" aria-label={`${actions.length}件`}>{actions.length}</span></header>
    {ordered.length === 0 ? <p className="forecast-empty" role="status">現在、対応が必要な項目はありません。</p> : <ol className="action-list">
      {ordered.map((action) => <li key={action.id} className={`action-item action-item--${action.priority.toLowerCase()}`}>
        <div className="action-badges"><span>{kindLabels[action.kind]}</span><strong>{priorityLabels[action.priority]}</strong></div>
        <div className="action-copy"><h3>{action.title}</h3><p>{action.detail}</p>
          <div className="action-meta">{action.dueOn && <time dateTime={action.dueOn}>期限 {action.dueOn}</time>}{action.amountJpy != null && <b>{yen(action.amountJpy)}</b>}</div>
          {action.reasons.length > 0 && <details><summary>判定理由</summary><ul>{action.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>}
        </div>
        {onAction && <button type="button" onClick={() => onAction(action)} aria-label={`${action.title}を確認`}>確認する</button>}
      </li>)}
    </ol>}
  </section>
}

export function CashSavingsForecast({ data }: { readonly data: ForecastActionDto }) {
  const maxCash = Math.max(1, ...data.months.map((month) => Math.abs(month.closingCashJpy)))
  return <section className="forecast-panel cash-forecast" aria-labelledby="cash-forecast-title">
    <header><div><p>3-month forecast</p><h2 id="cash-forecast-title">現金・貯蓄予測</h2></div><span>{data.forecastFrom} — {data.forecastThrough}</span></header>
    <div className="forecast-opening"><span>開始時点の現預金</span><strong>{yen(data.openingCashJpy)}</strong><small>{data.asOf} 現在</small></div>
    <div className="forecast-months">
      {data.months.map((month) => <article key={month.month}>
        <header><h3>{monthLabel(month.month)}</h3><strong className={month.projectedSavingsJpy < 0 ? 'is-negative' : ''}>{signedYen(month.projectedSavingsJpy)} 貯蓄</strong></header>
        <div className="cash-bar" aria-label={`月末現預金 ${yen(month.closingCashJpy)}`}><span style={{ width: `${Math.max(2, Math.abs(month.closingCashJpy) / maxCash * 100)}%` }} /></div>
        <dl><div><dt>予測収入</dt><dd>{yen(month.projectedIncomeJpy)}</dd></div><div><dt>通常支出</dt><dd>{yen(month.projectedNonRecurringExpenseJpy)}</dd></div><div><dt>定期支出</dt><dd>{yen(month.projectedRecurringExpenseJpy)}</dd></div><div><dt>カード引落</dt><dd>{yen(month.knownCardPaymentsJpy)}</dd></div><div className="forecast-closing"><dt>月末現預金</dt><dd>{yen(month.closingCashJpy)}</dd></div></dl>
      </article>)}
    </div>
    <details className="forecast-assumptions"><summary>予測の前提と説明</summary><p>計算対象の確定取引のみを使用し、集計対象外は履歴平均・定期支出・予測から除きます。</p><div className="assumption-grid"><span>履歴期間<strong>{data.assumptions.historyFrom} — {data.assumptions.historyThrough}</strong></span><span>平均月収<strong>{yen(data.assumptions.averageMonthlyIncomeJpy)}</strong></span><span>平均月支出<strong>{yen(data.assumptions.averageMonthlyExpenseJpy)}</strong></span><span>定期支出<strong>{yen(data.assumptions.recurringMonthlyExpenseJpy)}（{data.assumptions.recurringItemCount}件）</strong></span></div><ul>{data.assumptions.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>
  </section>
}

export function ForecastActionViews({ data, onAction }: ForecastActionViewsProps) {
  return <div className="forecast-action-layout"><ActionCenter actions={data.actions} onAction={onAction} /><CashSavingsForecast data={data} /></div>
}
