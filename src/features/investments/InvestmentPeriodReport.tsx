import { useEffect, useState } from 'react'

import {
  createInvestmentPerformancePlatform,
  type InvestmentPerformanceDto,
  type InvestmentPerformanceRequest,
} from './investmentPerformancePlatform'
import './investmentPeriodReport.css'

export type InvestmentPerformanceQuery = (request: InvestmentPerformanceRequest) => Promise<InvestmentPerformanceDto>

export interface InvestmentPeriodReportProps {
  readonly householdId: string | null
  readonly revision: number
  readonly initialYear?: number
  readonly queryPerformance?: InvestmentPerformanceQuery
}

const defaultQuery = createInvestmentPerformancePlatform().queryPerformance

function formatAmount(currency: string, value: number): string {
  const sign = value < 0 ? '−' : ''
  const amount = Math.abs(value).toLocaleString('ja-JP', { maximumFractionDigits: 2 })
  return currency === 'JPY' ? `${sign}¥${amount}` : `${sign}${currency} ${amount}`
}

export function InvestmentPeriodReport({ householdId, revision, initialYear = new Date().getFullYear(), queryPerformance = defaultQuery }: InvestmentPeriodReportProps) {
  const [year, setYear] = useState(initialYear)
  const [report, setReport] = useState<InvestmentPerformanceDto | null>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!householdId) {
      setReport(null)
      setNotice('')
      return
    }
    let active = true
    setLoading(true)
    setNotice('')
    void queryPerformance({ householdId, dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` })
      .then((next) => { if (active) setReport(next) })
      .catch(() => { if (active) { setReport(null); setNotice('期間別の投資実績を読み込めませんでした。') } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [householdId, queryPerformance, revision, year])

  if (!householdId) return null
  return <section className="panel investment-period-report" aria-label="年間投資実績">
    <div className="panel-head">
      <div><h2>年間投資実績・税金</h2><p>確定した証券取引を元通貨別に集計</p></div>
      <label>対象年<input aria-label="投資実績の対象年" type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
    </div>
    {loading && !report ? <p role="status">投資実績を集計しています…</p> : notice ? <p role="status">{notice}</p> : report && (report.totalsByCurrency.length > 0 || report.corporateActionAllocations.length > 0) ? <>
      <div className="investment-period-totals">
        {report.totalsByCurrency.map((total) => <article key={total.currency}>
          <span>{total.currency}</span>
          <strong className={total.realizedPnl >= 0 ? 'amount-positive' : ''}>実現損益 {formatAmount(total.currency, total.realizedPnl)}</strong>
          <small>配当 {formatAmount(total.currency, total.dividendGross)}</small>
          <small>手数料 {formatAmount(total.currency, total.fees)} ・ 税 {formatAmount(total.currency, total.taxes)}</small>
          <small>買付 {formatAmount(total.currency, total.buyGross)} ・ 売却 {formatAmount(total.currency, total.sellGross)}</small>
        </article>)}
      </div>
      {report.realizedAllocations.length > 0 && <div className="investment-realized-list" aria-label="実現損益の原本追跡">
        <h3>売却と取得原価の対応</h3>
        {report.realizedAllocations.slice(0, 20).map((allocation) => <article key={`${allocation.sellEventId}-${allocation.buyEventId}`}>
          <span><strong>{allocation.instrumentName}</strong><small>{allocation.soldOn} ・ {allocation.quantity.toLocaleString('ja-JP')}株</small></span>
          <span><small>取得原価</small><b>{formatAmount(allocation.currency, allocation.allocatedCostBasis)}</b></span>
          <span><small>売却手取</small><b>{formatAmount(allocation.currency, allocation.allocatedNetProceeds)}</b></span>
          <span><small>実現損益</small><b className={allocation.realizedPnl >= 0 ? 'amount-positive' : ''}>{formatAmount(allocation.currency, allocation.realizedPnl)}</b></span>
          <small>買付原本 行 {allocation.buySourceRow} → 売却原本 行 {allocation.sellSourceRow}</small>
        </article>)}
      </div>}
      {report.corporateActionAllocations.length > 0 && <div className="investment-realized-list" aria-label="コーポレートアクションの原価配分">
        <h3>コーポレートアクションの原価配分</h3>
        {report.corporateActionAllocations.slice(0, 20).map((allocation) => {
          const nonCash = allocation.actionType === 'MERGER_STOCK' || allocation.actionType === 'SPIN_OFF'
          const valueLabel = nonCash ? '非現金' : allocation.realizedPnl == null ? allocation.actionType === 'RIGHTS_SUBSCRIPTION' ? '払込現金' : '現金' : '実現損益'
          return <article key={`${allocation.actionEventId}-${allocation.actionType}-${allocation.sourceBuyEventId ?? 'new'}`}>
          <span><strong>{{ SPIN_OFF: 'スピンオフ', RIGHTS_SUBSCRIPTION: '権利行使', CASH_IN_LIEU: '端数株現金化', MERGER_STOCK: '合併・株式対価', MERGER_CASH: '合併・現金対価' }[allocation.actionType]}</strong><small>{allocation.actionOn} ・ {allocation.fromInstrumentCode}{allocation.targetInstrumentCode && allocation.targetInstrumentCode !== allocation.fromInstrumentCode ? ` → ${allocation.targetInstrumentCode}` : ''}</small></span>
          <span><small>対象数量</small><b>{allocation.quantity.toLocaleString('ja-JP')}株</b></span>
          <span><small>配分原価</small><b>{formatAmount(allocation.currency, allocation.allocatedCostBasis)}</b></span>
          <span><small>{valueLabel}</small><b className={!nonCash && (allocation.realizedPnl ?? 0) >= 0 ? 'amount-positive' : ''}>{nonCash ? '—' : formatAmount(allocation.currency, allocation.realizedPnl ?? allocation.cashAmount)}</b></span>
          <small>{allocation.sourceCurrency && allocation.sourceCostBasis != null ? `元原価 ${formatAmount(allocation.sourceCurrency, allocation.sourceCostBasis)}${allocation.conversionRate == null ? `（${allocation.sourceCurrency === allocation.currency ? '同一通貨・換算なし' : '明示レートなし'}）` : ` × 明示FX ${allocation.conversionRate.toLocaleString('ja-JP', { maximumFractionDigits: 8 })} = ${formatAmount(allocation.currency, allocation.allocatedCostBasis)}`} ・ ` : ''}{allocation.sourceBuySourceRow != null ? `取得原本 行 ${allocation.sourceBuySourceRow} → ` : ''}アクション原本 行 {allocation.actionSourceRow}</small>
        </article>})}
      </div>}
      {(report.uncoveredSales.length > 0 || report.skippedEventIds.length > 0) && <p className="performance-warning">原価未確認の売却 {report.uncoveredSales.length}件・計算対象外 {report.skippedEventIds.length}件。集計値を確定する前に原本を確認してください。</p>}
    </> : <p className="empty-state">{year}年の確定した証券取引はありません。</p>}
  </section>
}
