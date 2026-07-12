import type { YearlyFinancialReportDto } from '../calendar/financialCalendarPlatform'

export interface AnnualReviewViewProps {
  readonly data: YearlyFinancialReportDto
  readonly saving?: boolean
  readonly onSelectDriver?: (kind: 'CATEGORY' | 'MERCHANT', id: string) => void
  readonly onOpenBudget?: () => void
  readonly onOpenImports?: () => void
  readonly onOpenReconciliation?: () => void
  readonly onSaveCsv?: () => void
}

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`
const signedYen = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`
const rate = (value: number | null) => value == null ? '—' : `${value > 0 ? '+' : ''}${(value / 100).toFixed(1)}%`

function AnnualDelta({ amount, rateBps, inverse = false }: { readonly amount: number; readonly rateBps: number | null; readonly inverse?: boolean }) {
  const undesirable = inverse ? amount > 0 : amount < 0
  return <span className={`report-delta ${undesirable ? 'report-delta--negative' : 'report-delta--positive'}`}>{signedYen(amount)} <small>({rate(rateBps)})</small></span>
}

export function AnnualReviewView({ data, saving = false, onSelectDriver, onOpenBudget, onOpenImports, onOpenReconciliation, onSaveCsv }: AnnualReviewViewProps) {
  const max = Math.max(1, ...data.months.filter((point) => point.status === 'COMPLETE').flatMap((point) => [point.incomeJpy, point.expenseJpy]))
  const comparisonLabel = data.isCompleteYear ? '前年' : '前年同期間'
  const statementsNeedingReview = data.reconciliation.unmatched + data.reconciliation.mismatchCount + data.reconciliation.possibleMatches + data.reconciliation.partiallyReconciled

  return <div className="report-view annual-review-view" aria-label="年次家計レビュー">
    <header className="report-view-head"><div><p>Annual Household Review</p><h2>{data.period}年</h2><span>{data.completedMonthCount}か月の完了月・{comparisonLabel}と同じ期間で比較</span></div>{onSaveCsv && <button type="button" className="secondary-btn" disabled={saving || data.completedMonthCount === 0} onClick={onSaveCsv}>{saving ? 'CSVを作成中…' : '年次CSVを保存'}</button>}</header>
    <aside className="annual-review-disclosure"><strong>比較条件</strong><span>{data.isCompleteYear ? '12か月の確定取引を前年と比較しています。' : `${data.throughMonth ?? '完了月なし'}までを前年同期間と比較し、現在の未完了月と将来月は年間KPIから除外しています。`}</span><span>{data.asOf} 現在</span></aside>

    {data.dataQuality.hasUnresolvedImports && <aside className="report-quality-warning" role="status"><div><strong>年間値の完全性を確認してください</strong><span>確認待ち {data.dataQuality.reviewRequiredImports}件・失敗 {data.dataQuality.failedImports}件・最終取込 {data.dataQuality.latestImportedAt ?? 'なし'}</span></div>{onOpenImports && <button type="button" onClick={onOpenImports}>インポートを確認</button>}</aside>}

    <section className="report-kpi-grid" aria-label="年次KPI">
      <article><span>収入</span><strong>{yen(data.currentComparable.incomeJpy)}</strong><AnnualDelta amount={data.vsPriorYearComparable.income.amountJpy} rateBps={data.vsPriorYearComparable.income.rateBps} /></article>
      <article><span>支出</span><strong>{yen(data.currentComparable.expenseJpy)}</strong><AnnualDelta amount={data.vsPriorYearComparable.expense.amountJpy} rateBps={data.vsPriorYearComparable.expense.rateBps} inverse /></article>
      <article><span>貯蓄</span><strong>{yen(data.currentComparable.savingsJpy)}</strong><AnnualDelta amount={data.vsPriorYearComparable.savings.amountJpy} rateBps={data.vsPriorYearComparable.savings.rateBps} /></article>
      <article><span>貯蓄率</span><strong>{rate(data.currentComparable.savingsRateBps)}</strong><small>{comparisonLabel} {rate(data.priorYearComparable.savingsRateBps)}</small></article>
    </section>

    <section className="report-section annual-trend"><div className="report-section-head"><div><h3>月別の収入・支出</h3><p>斜線は未完了または将来のため比較対象外</p></div></div><div className="annual-chart" role="img" aria-label={`${data.period}年の月別収入と支出`}>
      {data.months.map((point) => <div className={`annual-month annual-month--${point.status.toLowerCase()}`} key={point.month}><div className="annual-bars"><i className="annual-income" style={{ height: point.status === 'COMPLETE' ? `${Math.max(2, point.incomeJpy / max * 100)}%` : undefined }} /><i className="annual-expense" style={{ height: point.status === 'COMPLETE' ? `${Math.max(2, point.expenseJpy / max * 100)}%` : undefined }} /></div><b>{Number(point.month.slice(5))}月</b><small>{point.status === 'COMPLETE' ? yen(point.savingsJpy) : point.status === 'PARTIAL' ? '未完了' : '将来'}</small></div>)}
    </div><footer className="annual-chart-legend"><span><i className="annual-income" />収入</span><span><i className="annual-expense" />支出</span><span>ラベル: 月間貯蓄</span></footer></section>

    <div className="report-driver-grid">
      <AnnualDriverTable title="支出を動かしたカテゴリー" kind="CATEGORY" rows={data.topCategoryDrivers.map((row) => ({ id: row.id, label: row.name, currentJpy: row.currentJpy, previousJpy: row.previousJpy, deltaJpy: row.deltaJpy }))} onSelect={onSelectDriver} />
      <AnnualDriverTable title="支出を動かした支払先" kind="MERCHANT" rows={data.topMerchantDrivers.map((row) => ({ id: row.merchant, label: row.merchant, currentJpy: row.currentJpy, previousJpy: row.previousJpy, deltaJpy: row.deltaJpy }))} onSelect={onSelectDriver} />
    </div>

    <section className="report-health-grid" aria-label="年間レビューの確認事項">
      <article className="report-summary-card"><span>予算</span><strong>{yen(data.budget.remainingJpy)}</strong><small>{yen(data.budget.actualJpy)} / {yen(data.budget.budgetJpy)}・超過 {data.budget.overBudgetCount}件</small>{onOpenBudget && <button type="button" onClick={onOpenBudget}>予算を見る</button>}</article>
      <article className="report-summary-card"><span>確定取引</span><strong>{data.currentComparable.postedTransactionCount}件</strong><small>選択した口座・家族内帰属の完了月</small></article>
      <article className={`report-summary-card${statementsNeedingReview > 0 ? ' report-summary-card--warning' : ''}`}><span>カード照合</span><strong>{data.reconciliation.fullyReconciled}/{data.reconciliation.totalStatements}件</strong><small>要確認 {statementsNeedingReview}件</small>{onOpenReconciliation && <button type="button" onClick={onOpenReconciliation}>照合を見る</button>}</article>
      <article className={`report-summary-card${data.dataQuality.hasUnresolvedImports ? ' report-summary-card--warning' : ''}`}><span>データ品質</span><strong>{data.dataQuality.importCompletionBps == null ? '—' : `${(data.dataQuality.importCompletionBps / 100).toFixed(1)}%`}</strong><small>反映済み {data.dataQuality.postedImports}/{data.dataQuality.totalImports}件</small>{onOpenImports && <button type="button" onClick={onOpenImports}>取込状況を見る</button>}</article>
    </section>

    <section className="report-section annual-limitations"><div className="report-section-head"><div><h3>集計範囲と制約</h3><p>表示値を判断する前に確認してください</p></div></div><ul><li>確定済み取引と完了した暦月だけを年間KPIと前年同期間比に使用します。</li><li>予算・目標・カード照合・取込状況には、選択した家族内帰属だけに配分できない世帯全体の情報が含まれます。</li><li>未取込・確認待ち・失敗したデータは集計に含まれません。</li></ul></section>
  </div>
}

function AnnualDriverTable({ title, kind, rows, onSelect }: { readonly title: string; readonly kind: 'CATEGORY' | 'MERCHANT'; readonly rows: readonly { readonly id: string; readonly label: string; readonly currentJpy: number; readonly previousJpy: number; readonly deltaJpy: number }[]; readonly onSelect?: (kind: 'CATEGORY' | 'MERCHANT', id: string) => void }) {
  return <section className="report-section driver-section"><div className="report-section-head"><div><h3>{title}</h3><p>前年同期間からの増減</p></div></div>{rows.length === 0 ? <p className="report-empty">比較できる支出はありません。</p> : <div className="report-table-wrap"><table><thead><tr><th>{kind === 'CATEGORY' ? 'カテゴリー' : '支払先'}</th><th>当年</th><th>前年同期間</th><th>増減</th></tr></thead><tbody>{rows.map((row) => <tr key={`${kind}-${row.id}`}><th scope="row"><button type="button" onClick={() => onSelect?.(kind, row.id)}>{row.label}</button></th><td>{yen(row.currentJpy)}</td><td>{yen(row.previousJpy)}</td><td className={row.deltaJpy > 0 ? 'amount-warning' : 'amount-good'}>{signedYen(row.deltaJpy)}</td></tr>)}</tbody></table></div>}</section>
}
