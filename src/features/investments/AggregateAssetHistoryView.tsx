import { useState } from 'react'

import type { AggregateAssetClass } from '../../ingestion'
import type { AggregateAssetSnapshotDto } from './aggregateAssetHistoryPlatform'

const labels: Record<AggregateAssetClass, string> = {
  DEPOSITS_CASH_CRYPTO: '預金・現金・暗号資産', LISTED_STOCKS: '株式', INVESTMENT_TRUSTS: '投資信託', BONDS: '債券', FX: 'FX', INSURANCE: '保険', REAL_ESTATE: '不動産', PENSIONS: '年金', POINTS: 'ポイント', OTHER_ASSETS: 'その他',
}
const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`

export function AggregateAssetHistoryView({ snapshots, initialDateFrom = '', initialDateTo = '', onApplyRange }: { readonly snapshots: readonly AggregateAssetSnapshotDto[]; readonly initialDateFrom?: string; readonly initialDateTo?: string; readonly onApplyRange?: (from: string | null, to: string | null) => void }) {
  const [from, setFrom] = useState(initialDateFrom)
  const [to, setTo] = useState(initialDateTo)
  const latest = snapshots[0]
  const previous = snapshots[1]
  const change = latest && previous ? latest.totalAssetsJpy - previous.totalAssetsJpy : null
  const changeRate = change != null && previous.totalAssetsJpy !== 0 ? change * 100 / previous.totalAssetsJpy : null
  const maxTotal = Math.max(1, ...snapshots.map((snapshot) => snapshot.totalAssetsJpy))
  const maxComponent = Math.max(1, ...(latest?.components.map((component) => component.valueJpy) ?? [1]))

  return <section className="panel aggregate-asset-history" aria-label="総資産履歴（Money Forward）">
    <div className="panel-head"><div><h2>総資産履歴（Money Forward）</h2><p>Money Forward MEの資産推移CSVを、口座横断の参照履歴として表示</p></div><strong>{snapshots.length}時点</strong></div>
    <aside className="aggregate-asset-disclosure"><strong>資産のみ・純資産ではありません</strong><span>負債を含まないため net worth ではありません。台帳、収支、口座残高、現在の純資産には加算しません。</span></aside>
    <form className="aggregate-asset-range" onSubmit={(event) => { event.preventDefault(); onApplyRange?.(from || null, to || null) }}><label>開始日<input aria-label="総資産履歴の開始日" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>終了日<input aria-label="総資産履歴の終了日" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="secondary-btn" type="submit">期間を適用</button></form>
    {latest ? <>
      <div className="aggregate-asset-summary"><article><span>最新の総資産</span><strong>{yen(latest.totalAssetsJpy)}</strong><small>{latest.asOf}</small></article><article><span>前回からの変化</span><strong className={change != null && change >= 0 ? 'amount-positive' : ''}>{change == null ? '—' : `${change > 0 ? '+' : ''}${yen(change)}`}</strong><small>{changeRate == null ? '比較時点なし' : `${changeRate > 0 ? '+' : ''}${changeRate.toFixed(1)}%`}</small></article><article><span>内訳カテゴリー</span><strong>{latest.components.length}</strong><small>CSVに存在する項目のみ</small></article></div>
      <div className="aggregate-asset-layout"><div><h3>推移</h3><div className="aggregate-asset-chart">{[...snapshots].reverse().map((snapshot) => <div key={snapshot.id}><strong>{yen(snapshot.totalAssetsJpy)}</strong><span><i style={{ height: `${Math.max(3, snapshot.totalAssetsJpy / maxTotal * 100)}%` }} /></span><small>{snapshot.asOf.slice(0, 7)}</small></div>)}</div></div><div><h3>最新の資産構成</h3><div className="aggregate-asset-composition">{latest.components.map((component) => <div key={component.assetClass}><span><strong>{labels[component.assetClass]}</strong><em>{yen(component.valueJpy)}</em></span><div><i style={{ width: `${component.valueJpy / maxComponent * 100}%` }} /></div></div>)}</div></div></div>
      <div className="aggregate-asset-list"><div className="aggregate-asset-list-head"><span>基準日</span><span>総資産</span><span>内訳</span></div>{snapshots.map((snapshot) => <div key={snapshot.id}><span>{snapshot.asOf}<small>原本行 {snapshot.sourceRow}</small></span><strong>{yen(snapshot.totalAssetsJpy)}</strong><span>{snapshot.components.length}項目</span></div>)}</div>
    </> : <p className="empty-state">指定期間にMoney Forwardの総資産履歴はありません。</p>}
  </section>
}
