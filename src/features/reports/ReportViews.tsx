import type { ReactNode } from 'react'

import { buildMonthCalendar, signedRate } from './calendarLayout'
import './reportViews.css'

export type CalendarEventKind = 'CASH_INFLOW' | 'CASH_OUTFLOW' | 'CARD_CLOSING' | 'CARD_PAYMENT_DUE' | 'CARD_PAYMENT'
export type CalendarBasis = 'ACCRUAL' | 'CASH'

export interface CalendarEventDto {
  readonly kind: CalendarEventKind
  readonly id: string
  readonly title: string
  readonly amountJpy: number
  readonly status: string | null
}

export interface CalendarDayDto {
  readonly date: string
  readonly accrualIncomeJpy: number
  readonly accrualExpenseJpy: number
  readonly cashInflowJpy: number
  readonly cashOutflowJpy: number
  readonly postedTransactionCount: number
  readonly noSpendDay: boolean
  readonly events: readonly CalendarEventDto[]
}

export interface BudgetSummaryDto {
  readonly budgetJpy: number
  readonly actualJpy: number
  readonly remainingJpy: number
  readonly utilizationBps: number | null
  readonly categoryCount: number
  readonly overBudgetCount: number
}

export interface GoalSummaryDto {
  readonly activeCount: number
  readonly targetJpy: number
  readonly savedJpy: number
  readonly remainingJpy: number
  readonly dueWithinPeriodCount: number
}

export interface DataQualitySummaryDto {
  readonly totalImports: number
  readonly postedImports: number
  readonly reviewRequiredImports: number
  readonly failedImports: number
  readonly inProgressImports: number
  readonly importCompletionBps: number | null
  readonly latestImportedAt: string | null
  readonly staleDays: number | null
  readonly hasUnresolvedImports: boolean
}

export interface FinancialCalendarDto {
  readonly month: string
  readonly asOf: string
  readonly days: readonly CalendarDayDto[]
  readonly budget: BudgetSummaryDto
  readonly goals: GoalSummaryDto
  readonly dataQuality: DataQualitySummaryDto
}

export interface MonthlyMetricsDto {
  readonly incomeJpy: number
  readonly expenseJpy: number
  readonly savingsJpy: number
  readonly savingsRateBps: number | null
  readonly postedTransactionCount: number
}

export interface MetricDeltaDto {
  readonly amountJpy: number
  readonly rateBps: number | null
}

export interface MonthlyDeltaSetDto {
  readonly income: MetricDeltaDto
  readonly expense: MetricDeltaDto
  readonly savings: MetricDeltaDto
}

export interface MonthlyDriverDto {
  readonly id?: string
  readonly name?: string | null
  readonly merchant?: string | null
  readonly currentJpy: number
  readonly previousJpy: number
  readonly deltaJpy: number
}

export interface ReconciliationSummaryDto {
  readonly totalStatements: number
  readonly fullyReconciled: number
  readonly possibleMatches: number
  readonly partiallyReconciled: number
  readonly unmatched: number
  readonly mismatchCount: number
  readonly paymentTotalJpy: number
}

export interface MonthlyReportDto {
  readonly period: string
  readonly current: MonthlyMetricsDto
  readonly priorMonth: MonthlyMetricsDto
  readonly priorYear: MonthlyMetricsDto
  readonly vsPriorMonth: MonthlyDeltaSetDto
  readonly vsPriorYear: MonthlyDeltaSetDto
  readonly topCategoryDrivers: readonly MonthlyDriverDto[]
  readonly topMerchantDrivers: readonly MonthlyDriverDto[]
  readonly budget: BudgetSummaryDto
  readonly goals: GoalSummaryDto
  readonly dataQuality: DataQualitySummaryDto
  readonly reconciliation: ReconciliationSummaryDto
}

export interface FinancialCalendarViewProps {
  readonly data: FinancialCalendarDto
  readonly basis?: CalendarBasis
  readonly onBasisChange?: (basis: CalendarBasis) => void
  readonly onSelectDate?: (date: string) => void
  readonly onSelectEvent?: (date: string, event: CalendarEventDto) => void
  readonly onOpenImports?: () => void
}

export interface MonthlyReportViewProps {
  readonly data: MonthlyReportDto
  readonly comparison?: 'PRIOR_MONTH' | 'PRIOR_YEAR'
  readonly onComparisonChange?: (comparison: 'PRIOR_MONTH' | 'PRIOR_YEAR') => void
  readonly onSelectDriver?: (kind: 'CATEGORY' | 'MERCHANT', driver: MonthlyDriverDto) => void
  readonly onOpenBudget?: () => void
  readonly onOpenGoals?: () => void
  readonly onOpenImports?: () => void
  readonly onOpenReconciliation?: () => void
}

const weekdays = ['日', '月', '火', '水', '木', '金', '土'] as const
const eventLabels: Record<CalendarEventKind, string> = {
  CASH_INFLOW: '入金',
  CASH_OUTFLOW: '出金',
  CARD_CLOSING: 'カード締日',
  CARD_PAYMENT_DUE: 'カード引落予定',
  CARD_PAYMENT: 'カード引落',
}

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`
const signedYen = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`
const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`
const optionalPercent = (bps: number | null) => bps == null ? '—' : percent(bps)
const monthLabel = (month: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  return match ? `${match[1]}年${Number(match[2])}月` : month
}

function Progress({ value, warning = false }: { readonly value: number; readonly warning?: boolean }) {
  const bounded = Math.max(0, Math.min(10_000, value))
  return <div className="report-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bounded / 100)}><span className={warning ? 'warning' : ''} style={{ width: `${bounded / 100}%` }} /></div>
}

function SummaryCard({ label, value, detail, progress, warning, action }: { readonly label: string; readonly value: string; readonly detail: string; readonly progress?: number; readonly warning?: boolean; readonly action?: ReactNode }) {
  return <article className={`report-summary-card${warning ? ' report-summary-card--warning' : ''}`}>
    <span>{label}</span><strong>{value}</strong><small>{detail}</small>
    {progress != null && <Progress value={progress} warning={warning} />}{action}
  </article>
}

function DataQualityWarning({ quality, onOpenImports }: { readonly quality: DataQualitySummaryDto; readonly onOpenImports?: () => void }) {
  if (!quality.hasUnresolvedImports && (quality.staleDays == null || quality.staleDays < 7)) return null
  const messages = [
    quality.reviewRequiredImports > 0 ? `${quality.reviewRequiredImports}件が確認待ち` : '',
    quality.failedImports > 0 ? `${quality.failedImports}件が失敗` : '',
    quality.inProgressImports > 0 ? `${quality.inProgressImports}件を処理中` : '',
    quality.staleDays != null && quality.staleDays >= 7 ? `最終取込から${quality.staleDays}日` : '',
  ].filter(Boolean)
  return <aside className="report-quality-warning" role="status"><div><strong>データの完全性を確認してください</strong><span>{messages.join(' ・ ')}</span></div>{onOpenImports && <button type="button" onClick={onOpenImports}>インポートを確認</button>}</aside>
}

function CalendarEvent({ date, event, onSelect }: { readonly date: string; readonly event: CalendarEventDto; readonly onSelect?: (date: string, event: CalendarEventDto) => void }) {
  const content = <><span>{eventLabels[event.kind]}</span><strong>{event.title}</strong>{event.amountJpy != null && <em>{yen(event.amountJpy)}</em>}</>
  if (!onSelect) return <div className={`calendar-event calendar-event--${event.kind.toLowerCase()}`} title={`${event.title} (${event.status})`}>{content}</div>
  return <button type="button" className={`calendar-event calendar-event--${event.kind.toLowerCase()}`} title={`${event.title} (${event.status})`} onClick={() => onSelect(date, event)}>{content}</button>
}

export function FinancialCalendarView({ data, basis = 'ACCRUAL', onBasisChange, onSelectDate, onSelectEvent, onOpenImports }: FinancialCalendarViewProps) {
  const cells = buildMonthCalendar(data.month, data.days)
  const monthIncome = data.days.reduce((sum, day) => sum + (basis === 'ACCRUAL' ? day.accrualIncomeJpy : day.cashInflowJpy), 0)
  const monthExpense = data.days.reduce((sum, day) => sum + (basis === 'ACCRUAL' ? day.accrualExpenseJpy : day.cashOutflowJpy), 0)
  const noSpendDays = data.days.filter((day) => day.noSpendDay).length

  return <div className="report-view financial-calendar-view">
    <header className="report-view-head"><div><p>Financial Calendar</p><h2>{monthLabel(data.month)}</h2><span>{data.asOf} 現在・確定取引のみ</span></div><div className="report-segmented" aria-label="カレンダーの計上基準"><button type="button" aria-pressed={basis === 'ACCRUAL'} onClick={() => onBasisChange?.('ACCRUAL')}>発生ベース</button><button type="button" aria-pressed={basis === 'CASH'} onClick={() => onBasisChange?.('CASH')}>資金移動</button></div></header>
    <DataQualityWarning quality={data.dataQuality} onOpenImports={onOpenImports} />
    <section className="report-summary-grid" aria-label="月間サマリー">
      <SummaryCard label={basis === 'ACCRUAL' ? '収入' : '入金'} value={yen(monthIncome)} detail={`${data.days.reduce((sum, day) => sum + day.postedTransactionCount, 0)}件の確定取引`} />
      <SummaryCard label={basis === 'ACCRUAL' ? '支出' : '出金'} value={yen(monthExpense)} detail={`差引 ${signedYen(monthIncome - monthExpense)}`} />
      <SummaryCard label="予算" value={yen(data.budget.remainingJpy)} detail={`${data.budget.categoryCount}カテゴリー・超過 ${data.budget.overBudgetCount}件`} progress={data.budget.utilizationBps ?? undefined} warning={data.budget.overBudgetCount > 0} />
      <SummaryCard label="No-spend days" value={`${noSpendDays}日`} detail={`貯蓄目標 ${data.goals.activeCount}件`} />
    </section>
    <div className="calendar-table-wrap">
      <table className="financial-calendar-table">
        <caption className="report-visually-hidden">{monthLabel(data.month)}の日別収支カレンダー</caption>
        <thead><tr>{weekdays.map((weekday) => <th key={weekday} scope="col">{weekday}</th>)}</tr></thead>
        <tbody>{Array.from({ length: 6 }, (_, week) => <tr key={week}>{cells.slice(week * 7, week * 7 + 7).map((cell) => {
          if (cell.dayOfMonth == null) return <td className="calendar-day calendar-day--empty" aria-hidden="true" key={cell.key} />
          const day = cell.data
          const income = day ? (basis === 'ACCRUAL' ? day.accrualIncomeJpy : day.cashInflowJpy) : 0
          const expense = day ? (basis === 'ACCRUAL' ? day.accrualExpenseJpy : day.cashOutflowJpy) : 0
          const date = cell.key
          return <td className={`calendar-day${day?.noSpendDay ? ' calendar-day--no-spend' : ''}`} key={cell.key}>
            <button type="button" className="calendar-date" aria-label={`${date}の取引を表示`} onClick={() => onSelectDate?.(date)}><b>{cell.dayOfMonth}</b>{day?.noSpendDay && <span>No spend</span>}</button>
            <div className="calendar-day-totals">{income > 0 && <span className="calendar-income">+{yen(income)}</span>}{expense > 0 && <span className="calendar-expense">−{yen(expense)}</span>}{day && day.postedTransactionCount > 0 && <small>{day.postedTransactionCount}件</small>}</div>
            {day && day.events.length > 0 && <div className="calendar-events">{day.events.map((event) => <CalendarEvent key={`${event.kind}-${event.id}`} date={date} event={event} onSelect={onSelectEvent} />)}</div>}
          </td>
        })}</tr>)}</tbody>
      </table>
    </div>
    <footer className="calendar-legend" aria-label="カレンダー凡例"><span><i className="legend-income" />入金</span><span><i className="legend-expense" />支出・出金</span><span><i className="legend-card" />カード予定</span><span><i className="legend-no-spend" />No-spend day</span></footer>
  </div>
}

function Delta({ delta, inverse = false }: { readonly delta: MetricDeltaDto; readonly inverse?: boolean }) {
  const undesirable = inverse ? delta.amountJpy > 0 : delta.amountJpy < 0
  return <span className={`report-delta ${undesirable ? 'report-delta--negative' : 'report-delta--positive'}`}>{signedYen(delta.amountJpy)} <small>({signedRate(delta.rateBps)})</small></span>
}

function DriverTable({ title, kind, rows, onSelect }: { readonly title: string; readonly kind: 'CATEGORY' | 'MERCHANT'; readonly rows: readonly MonthlyDriverDto[]; readonly onSelect?: (kind: 'CATEGORY' | 'MERCHANT', driver: MonthlyDriverDto) => void }) {
  return <section className="report-section driver-section"><div className="report-section-head"><div><h3>{title}</h3><p>比較期間からの支出増減</p></div></div>{rows.length === 0 ? <p className="report-empty">比較できる支出はありません。</p> : <div className="report-table-wrap"><table><thead><tr><th scope="col">{kind === 'CATEGORY' ? 'カテゴリー' : '支払先'}</th><th scope="col">当月</th><th scope="col">比較期間</th><th scope="col">増減</th></tr></thead><tbody>{rows.map((row, index) => {
    const label = row.name ?? row.merchant ?? '名称未設定'
    return <tr key={`${kind}-${row.id ?? row.merchant ?? row.name ?? index}`}><th scope="row">{onSelect ? <button type="button" onClick={() => onSelect(kind, row)}>{label}</button> : label}</th><td>{yen(row.currentJpy)}</td><td>{yen(row.previousJpy)}</td><td className={row.deltaJpy > 0 ? 'amount-warning' : 'amount-good'}>{signedYen(row.deltaJpy)}</td></tr>
  })}</tbody></table></div>}</section>
}

export function MonthlyReportView({ data, comparison = 'PRIOR_MONTH', onComparisonChange, onSelectDriver, onOpenBudget, onOpenGoals, onOpenImports, onOpenReconciliation }: MonthlyReportViewProps) {
  const delta = comparison === 'PRIOR_MONTH' ? data.vsPriorMonth : data.vsPriorYear
  const comparisonLabel = comparison === 'PRIOR_MONTH' ? '前月比' : '前年同月比'
  const goalProgress = data.goals.targetJpy > 0 ? Math.round(data.goals.savedJpy / data.goals.targetJpy * 10_000) : 0
  const reconciledBps = data.reconciliation.totalStatements > 0 ? Math.round(data.reconciliation.fullyReconciled / data.reconciliation.totalStatements * 10_000) : 0

  return <div className="report-view monthly-report-view">
    <header className="report-view-head"><div><p>Monthly Review</p><h2>{monthLabel(data.period)}</h2><span>{data.current.postedTransactionCount}件の確定取引</span></div><div className="report-segmented" aria-label="レポートの比較期間"><button type="button" aria-pressed={comparison === 'PRIOR_MONTH'} onClick={() => onComparisonChange?.('PRIOR_MONTH')}>前月比</button><button type="button" aria-pressed={comparison === 'PRIOR_YEAR'} onClick={() => onComparisonChange?.('PRIOR_YEAR')}>前年同月比</button></div></header>
    <DataQualityWarning quality={data.dataQuality} onOpenImports={onOpenImports} />
    <section className="report-kpi-grid" aria-label="月次KPI">
      <article><span>収入</span><strong>{yen(data.current.incomeJpy)}</strong><Delta delta={delta.income} /></article>
      <article><span>支出</span><strong>{yen(data.current.expenseJpy)}</strong><Delta delta={delta.expense} inverse /></article>
      <article><span>貯蓄</span><strong>{yen(data.current.savingsJpy)}</strong><Delta delta={delta.savings} /></article>
      <article><span>貯蓄率</span><strong>{data.current.savingsRateBps == null ? '—' : percent(data.current.savingsRateBps)}</strong><small>{comparisonLabel}</small></article>
    </section>
    <div className="report-driver-grid"><DriverTable title="支出を動かしたカテゴリー" kind="CATEGORY" rows={data.topCategoryDrivers} onSelect={onSelectDriver} /><DriverTable title="支出を動かした支払先" kind="MERCHANT" rows={data.topMerchantDrivers} onSelect={onSelectDriver} /></div>
    <section className="report-health-grid" aria-label="家計の進捗とデータ品質">
      <SummaryCard label="予算進捗" value={`${optionalPercent(data.budget.utilizationBps)} 使用`} detail={`${yen(data.budget.actualJpy)} / ${yen(data.budget.budgetJpy)}・超過 ${data.budget.overBudgetCount}件`} progress={data.budget.utilizationBps ?? undefined} warning={data.budget.overBudgetCount > 0} action={onOpenBudget && <button type="button" onClick={onOpenBudget}>予算を見る</button>} />
      <SummaryCard label="貯蓄目標" value={yen(data.goals.savedJpy)} detail={`残り ${yen(data.goals.remainingJpy)}・期限間近 ${data.goals.dueWithinPeriodCount}件`} progress={goalProgress} warning={data.goals.dueWithinPeriodCount > 0} action={onOpenGoals && <button type="button" onClick={onOpenGoals}>目標を見る</button>} />
      <SummaryCard label="データ完全性" value={optionalPercent(data.dataQuality.importCompletionBps)} detail={`${data.dataQuality.postedImports}/${data.dataQuality.totalImports}件反映・最終取込 ${data.dataQuality.latestImportedAt ?? 'なし'}`} progress={data.dataQuality.importCompletionBps ?? undefined} warning={data.dataQuality.hasUnresolvedImports} action={onOpenImports && <button type="button" onClick={onOpenImports}>取込状況を見る</button>} />
      <SummaryCard label="カード照合" value={`${data.reconciliation.fullyReconciled}/${data.reconciliation.totalStatements}件`} detail={`引落 ${yen(data.reconciliation.paymentTotalJpy)}・要確認 ${data.reconciliation.mismatchCount + data.reconciliation.unmatched}件`} progress={reconciledBps} warning={data.reconciliation.mismatchCount + data.reconciliation.unmatched > 0} action={onOpenReconciliation && <button type="button" onClick={onOpenReconciliation}>照合を見る</button>} />
    </section>
    <section className="report-section comparison-table"><div className="report-section-head"><div><h3>収支比較</h3><p>同じ定義の確定台帳を期間比較</p></div></div><div className="report-table-wrap"><table><thead><tr><th scope="col">指標</th><th scope="col">当月</th><th scope="col">前月</th><th scope="col">前年同月</th></tr></thead><tbody><tr><th scope="row">収入</th><td>{yen(data.current.incomeJpy)}</td><td>{yen(data.priorMonth.incomeJpy)}</td><td>{yen(data.priorYear.incomeJpy)}</td></tr><tr><th scope="row">支出</th><td>{yen(data.current.expenseJpy)}</td><td>{yen(data.priorMonth.expenseJpy)}</td><td>{yen(data.priorYear.expenseJpy)}</td></tr><tr><th scope="row">貯蓄</th><td>{yen(data.current.savingsJpy)}</td><td>{yen(data.priorMonth.savingsJpy)}</td><td>{yen(data.priorYear.savingsJpy)}</td></tr><tr><th scope="row">取引件数</th><td>{data.current.postedTransactionCount}件</td><td>{data.priorMonth.postedTransactionCount}件</td><td>{data.priorYear.postedTransactionCount}件</td></tr></tbody></table></div></section>
  </div>
}
