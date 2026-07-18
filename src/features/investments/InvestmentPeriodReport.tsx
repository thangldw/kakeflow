import { useEffect, useState } from 'react'

import {
  createInvestmentPerformancePlatform,
  type InvestmentPerformanceDto,
  type InvestmentPerformanceCsvSavedDto,
  type InvestmentPerformancePdfSavedDto,
  type InvestmentPerformanceRequest,
  type InvestmentPerformanceXlsxSavedDto,
} from './investmentPerformancePlatform'
import './investmentPeriodReport.css'
import { localize } from '../../i18n'

export type InvestmentPerformanceQuery = (request: InvestmentPerformanceRequest) => Promise<InvestmentPerformanceDto>
export type InvestmentPerformanceXlsxSave = (request: InvestmentPerformanceRequest) => Promise<InvestmentPerformanceXlsxSavedDto | null>
export type InvestmentPerformanceCsvSave = (request: InvestmentPerformanceRequest) => Promise<InvestmentPerformanceCsvSavedDto | null>
export type InvestmentPerformancePdfSave = (request: InvestmentPerformanceRequest) => Promise<InvestmentPerformancePdfSavedDto | null>

export interface InvestmentPeriodReportProps {
  readonly householdId: string | null
  readonly revision: number
  readonly initialYear?: number
  readonly queryPerformance?: InvestmentPerformanceQuery
  readonly savePerformanceCsv?: InvestmentPerformanceCsvSave
  readonly savePerformanceXlsx?: InvestmentPerformanceXlsxSave
  readonly savePerformancePdf?: InvestmentPerformancePdfSave
}

const defaultPlatform = createInvestmentPerformancePlatform()
const defaultQuery = defaultPlatform.queryPerformance
const defaultCsvSave = defaultPlatform.savePerformanceCsv
const defaultXlsxSave = defaultPlatform.savePerformanceXlsx
const defaultPdfSave = defaultPlatform.savePerformancePdf

function formatAmount(currency: string, value: number): string {
  const sign = value < 0 ? '−' : ''
  const amount = Math.abs(value).toLocaleString('ja-JP', { maximumFractionDigits: 2 })
  return currency === 'JPY' ? `${sign}¥${amount}` : `${sign}${currency} ${amount}`
}

export function InvestmentPeriodReport({ householdId, revision, initialYear = new Date().getFullYear(), queryPerformance = defaultQuery, savePerformanceCsv = defaultCsvSave, savePerformanceXlsx = defaultXlsxSave, savePerformancePdf = defaultPdfSave }: InvestmentPeriodReportProps) {
  const [year, setYear] = useState(initialYear)
  const [report, setReport] = useState<InvestmentPerformanceDto | null>(null)
  const [notice, setNotice] = useState('')
  const [exportNotice, setExportNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingCsv, setSavingCsv] = useState(false)
  const [savingXlsx, setSavingXlsx] = useState(false)
  const [savingPdf, setSavingPdf] = useState(false)

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
      .catch(() => { if (active) { setReport(null); setNotice(localize("期間別の投資実績を読み込めませんでした。")) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [householdId, queryPerformance, revision, year])

  const saveXlsx = async () => {
    if (!householdId || savingCsv || savingXlsx || savingPdf || !report) return
    setSavingXlsx(true)
    setExportNotice('')
    try {
      const saved = await savePerformanceXlsx({ householdId, dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` })
      setExportNotice(saved === null
        ? localize("投資Excelエクスポートをキャンセルしました。")
        : localize(`${saved.fileName}（${saved.rowCount.toLocaleString('ja-JP')}行）を保存しました。`))
    } catch {
      setExportNotice(localize("投資Excelを書き出せませんでした。対象年と確定した証券取引を確認してください。"))
    } finally {
      setSavingXlsx(false)
    }
  }

  const saveCsv = async () => {
    if (!householdId || savingCsv || savingXlsx || savingPdf || !report) return
    setSavingCsv(true)
    setExportNotice('')
    try {
      const saved = await savePerformanceCsv({ householdId, dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` })
      setExportNotice(saved === null
        ? localize("投資CSVエクスポートをキャンセルしました。")
        : localize(`${saved.fileName}（${saved.rowCount.toLocaleString('ja-JP')}行）を保存しました。`))
    } catch {
      setExportNotice(localize("投資CSVを書き出せませんでした。対象年と確定した証券取引を確認してください。"))
    } finally {
      setSavingCsv(false)
    }
  }

  const savePdf = async () => {
    if (!householdId || savingCsv || savingXlsx || savingPdf || !report) return
    setSavingPdf(true)
    setExportNotice('')
    try {
      const saved = await savePerformancePdf({ householdId, dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` })
      setExportNotice(saved === null
        ? localize("投資PDFエクスポートをキャンセルしました。")
        : localize(`${saved.fileName}（${saved.pageCount.toLocaleString('ja-JP')}ページ）を保存しました。`))
    } catch {
      setExportNotice(localize("投資PDFを書き出せませんでした。対象年と確定した証券取引を確認してください。"))
    } finally {
      setSavingPdf(false)
    }
  }

  if (!householdId) return null
  const hasReportData = report != null && (
    report.totalsByCurrency.length > 0
    || report.realizedAllocations.length > 0
    || report.uncoveredSales.length > 0
    || report.skippedEventIds.length > 0
    || report.corporateActionAllocations.length > 0
  )
  return <section className="panel investment-period-report" aria-label={localize("年間投資実績")}>
    <div className="panel-head">
      <div><h2>{localize("年間投資実績・税金")}</h2><p>{localize("確定した証券取引を元通貨別に集計")}</p></div>
      <div className="investment-period-actions">
        <label>{localize("対象年")}<input aria-label={localize("投資実績の対象年")} type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
        <button className="secondary-btn" disabled={loading || savingCsv || savingXlsx || savingPdf || !hasReportData} onClick={() => void saveCsv()}>{savingCsv ? localize("CSVを作成中…") : localize("年間投資CSVを保存")}</button>
        <button className="secondary-btn" disabled={loading || savingCsv || savingXlsx || savingPdf || !hasReportData} onClick={() => void saveXlsx()}>{savingXlsx ? localize("Excelを作成中…") : localize("年間投資Excelを保存")}</button>
        <button className="secondary-btn" disabled={loading || savingCsv || savingXlsx || savingPdf || !hasReportData} onClick={() => void savePdf()}>{savingPdf ? localize("PDFを作成中…") : localize("年間投資PDFを保存")}</button>
      </div>
    </div>
    {exportNotice && <p className="investment-export-notice" role="status">{exportNotice}</p>}
    {loading && !report ? <p role="status">{localize("投資実績を集計しています…")}</p> : notice ? <p role="status">{notice}</p> : hasReportData && report ? <>
      <div className="investment-period-totals">
        {report.totalsByCurrency.map((total) => <article key={total.currency}>
          <span>{total.currency}</span>
          <strong className={total.realizedPnl >= 0 ? 'amount-positive' : ''}>{localize("実現損益")} {formatAmount(total.currency, total.realizedPnl)}</strong>
          <small>{localize("配当")} {formatAmount(total.currency, total.dividendGross)}</small>
          <small>{localize("手数料")} {formatAmount(total.currency, total.fees)} {localize("・ 税")} {formatAmount(total.currency, total.taxes)}</small>
          <small>{localize("買付")} {formatAmount(total.currency, total.buyGross)} {localize("・ 売却")} {formatAmount(total.currency, total.sellGross)}</small>
        </article>)}
      </div>
      {report.realizedAllocations.length > 0 && <div className="investment-realized-list" aria-label={localize("実現損益の原本追跡")}>
        <h3>{localize("売却と取得原価の対応")}</h3>
        {report.realizedAllocations.slice(0, 20).map((allocation) => <article key={`${allocation.sellEventId}-${allocation.buyEventId}`}>
          <span><strong>{allocation.instrumentName}</strong><small>{allocation.soldOn} ・ {allocation.quantity.toLocaleString('ja-JP')}{localize("株")}</small></span>
          <span><small>{localize("取得原価")}</small><b>{formatAmount(allocation.currency, allocation.allocatedCostBasis)}</b></span>
          <span><small>{localize("売却手取")}</small><b>{formatAmount(allocation.currency, allocation.allocatedNetProceeds)}</b></span>
          <span><small>{localize("実現損益")}</small><b className={allocation.realizedPnl >= 0 ? 'amount-positive' : ''}>{formatAmount(allocation.currency, allocation.realizedPnl)}</b></span>
          <small>{localize("買付原本 行")} {allocation.buySourceRow} {localize("→ 売却原本 行")} {allocation.sellSourceRow}</small>
        </article>)}
      </div>}
      {report.corporateActionAllocations.length > 0 && <div className="investment-realized-list" aria-label={localize("コーポレートアクションの原価配分")}>
        <h3>{localize("コーポレートアクションの原価配分")}</h3>
        {report.corporateActionAllocations.slice(0, 20).map((allocation) => {
          const nonCash = allocation.actionType === 'MERGER_STOCK' || allocation.actionType === 'SPIN_OFF'
          const valueLabel = nonCash ? localize("非現金") : allocation.realizedPnl == null ? allocation.actionType === 'RIGHTS_SUBSCRIPTION' ? localize("払込現金") : localize("現金") : localize("実現損益")
          return <article key={`${allocation.actionEventId}-${allocation.actionType}-${allocation.sourceBuyEventId ?? 'new'}`}>
          <span><strong>{{ SPIN_OFF: localize("スピンオフ"), RIGHTS_SUBSCRIPTION: localize("権利行使"), CASH_IN_LIEU: localize("端数株現金化"), MERGER_STOCK: localize("合併・株式対価"), MERGER_CASH: localize("合併・現金対価") }[allocation.actionType]}</strong><small>{allocation.actionOn} ・ {allocation.fromInstrumentCode}{allocation.targetInstrumentCode && allocation.targetInstrumentCode !== allocation.fromInstrumentCode ? ` → ${allocation.targetInstrumentCode}` : ''}</small></span>
          <span><small>{localize("対象数量")}</small><b>{allocation.quantity.toLocaleString('ja-JP')}{localize("株")}</b></span>
          <span><small>{localize("配分原価")}</small><b>{formatAmount(allocation.currency, allocation.allocatedCostBasis)}</b></span>
          <span><small>{valueLabel}</small><b className={!nonCash && (allocation.realizedPnl ?? 0) >= 0 ? 'amount-positive' : ''}>{nonCash ? '—' : formatAmount(allocation.currency, allocation.realizedPnl ?? allocation.cashAmount)}</b></span>
          <small>{allocation.sourceCurrency && allocation.sourceCostBasis != null ? localize(`元原価 ${formatAmount(allocation.sourceCurrency, allocation.sourceCostBasis)}${allocation.conversionRate == null ? `（${allocation.sourceCurrency === allocation.currency ? localize("同一通貨・換算なし") : localize("明示レートなし")}）` : ` × 明示FX ${allocation.conversionRate.toLocaleString('ja-JP', { maximumFractionDigits: 8 })} = ${formatAmount(allocation.currency, allocation.allocatedCostBasis)}`} ・ `) : ''}{allocation.sourceBuySourceRow != null ? localize(`取得原本 行 ${allocation.sourceBuySourceRow} → `) : ''}{localize("アクション原本 行")} {allocation.actionSourceRow}</small>
        </article>})}
      </div>}
      {(report.uncoveredSales.length > 0 || report.skippedEventIds.length > 0) && <p className="performance-warning">{localize("原価未確認の売却")} {report.uncoveredSales.length}{localize("件・計算対象外")} {report.skippedEventIds.length}{localize("件。集計値を確定する前に原本を確認してください。")}</p>}
    </> : <p className="empty-state">{year}{localize("年の確定した証券取引はありません。")}</p>}
  </section>
}
