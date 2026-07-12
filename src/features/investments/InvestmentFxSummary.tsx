import { useEffect, useState } from 'react'

import {
  createInvestmentFxPlatform,
  type InvestmentReportingDto,
  type InvestmentReportingRequest,
} from './investmentFxPlatform'
import './investmentFxSummary.css'

export type InvestmentFxReportingQuery = (request: InvestmentReportingRequest) => Promise<InvestmentReportingDto>

export interface InvestmentFxSummaryProps {
  readonly householdId: string | null
  readonly fxAsOf: string
  readonly revision: number
  readonly queryReporting?: InvestmentFxReportingQuery
}

const defaultQueryReporting = createInvestmentFxPlatform().queryReporting

function amount(currency: string, value: number): string {
  const absolute = Math.abs(value).toLocaleString('ja-JP', { maximumFractionDigits: 2 })
  if (currency === 'JPY') return `${value < 0 ? '−' : ''}¥${absolute}`
  return `${value < 0 ? '−' : ''}${currency} ${absolute}`
}

function missingRate(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /required.*fx rate.*missing|fx rate.*missing/i.test(message)
}

export function InvestmentFxSummary({
  householdId,
  fxAsOf,
  revision,
  queryReporting = defaultQueryReporting,
}: InvestmentFxSummaryProps) {
  const [report, setReport] = useState<InvestmentReportingDto | null>(null)
  const [notice, setNotice] = useState<'MISSING_RATE' | 'UNAVAILABLE' | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!householdId) {
      setReport(null)
      setNotice(null)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setNotice(null)
    void queryReporting({ householdId, reportingCurrency: 'JPY', fxAsOf })
      .then((next) => {
        if (!active) return
        setReport(next)
        setNotice(null)
      })
      .catch((error: unknown) => {
        if (!active) return
        setReport(null)
        setNotice(missingRate(error) ? 'MISSING_RATE' : 'UNAVAILABLE')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [fxAsOf, householdId, queryReporting, revision])

  if (!householdId) return null
  if (loading && !report) return <section className="panel investment-fx-summary" aria-busy="true"><p className="investment-fx-loading">円換算を計算しています…</p></section>
  if (!report) {
    return <section className="panel investment-fx-summary investment-fx-notice" role="status">
      <strong>{notice === 'MISSING_RATE' ? '円換算に必要な為替レートが不足しています' : '円換算を読み込めませんでした'}</strong>
      <span>元通貨の保有残高と実績はそのまま利用できます。換算値を推測して補完することはありません。</span>
    </section>
  }

  const converted = report.convertedTotals
  return <section className="panel investment-fx-summary" aria-label="投資実績の円換算">
    <div className="panel-head">
      <div><h2>投資実績の円換算</h2><p>元通貨を保持したまま、確認済みレートだけで集計</p></div>
      <span>{report.fxAsOf} レート</span>
    </div>
    <div className="investment-fx-kpis">
      <article><span>実現損益</span><strong className={converted.realizedPnl >= 0 ? 'amount-positive' : ''}>{amount(converted.currency, converted.realizedPnl)}</strong></article>
      <article><span>配当</span><strong>{amount(converted.currency, converted.dividendGross)}</strong></article>
      <article><span>買付 / 売却</span><strong>{amount(converted.currency, converted.buyGross)} / {amount(converted.currency, converted.sellGross)}</strong></article>
      <article><span>手数料・税</span><strong>{amount(converted.currency, converted.fees + converted.taxes)}</strong></article>
    </div>
    <div className="investment-fx-native" aria-label="元通貨の実績">
      {report.originalTotalsByCurrency.map((total) => <span key={total.currency}><b>{total.currency}</b> 実現損益 {amount(total.currency, total.realizedPnl)}</span>)}
    </div>
    <div className="investment-fx-provenance">
      <h3>換算レートと出典</h3>
      {report.conversions.map((conversion) => <article key={`${conversion.originalCurrency}-${conversion.rateId}`}>
        <span><b>{conversion.originalCurrency} → {conversion.reportingCurrency}</b><small>{conversion.rateDate} ・ {conversion.provider}</small></span>
        <strong>× {conversion.rate.toLocaleString('ja-JP', { maximumFractionDigits: 8 })}</strong>
        <small>{conversion.rateId === 'IDENTITY' ? '同一通貨' : conversion.sourceDocumentId ? `原本 ${conversion.sourceDocumentId}${conversion.sourceRow == null ? '' : ` ・ 行 ${conversion.sourceRow}`}` : conversion.sourceKind}{conversion.inverted ? ' ・ 逆数利用' : ''}</small>
      </article>)}
    </div>
  </section>
}
