import type { InvestmentValuationDto } from './investmentMarketPlatform'
import './InvestmentValuationSummary.css'

export function InvestmentValuationSummary({ valuation }: { readonly valuation: InvestmentValuationDto | null }) {
  if (!valuation || valuation.positions.length === 0) return null
  return <section className="panel investment-valuation" aria-label="時点別ポートフォリオ評価">
    <div className="panel-head">
      <div><h2>時点別ポートフォリオ評価</h2><p>{valuation.asOf} 以前の確認済み終値・残高スナップショットだけを使用</p></div>
      <span>{valuation.costBasisMethod} 原価法</span>
    </div>
    <div className="investment-valuation__totals">
      {valuation.totalsByCurrency.map((total) => <article key={total.currency}>
        <span>{total.currency}</span>
        <strong>{money(total.marketValue, total.currency)} 評価額</strong>
        <small className={total.unrealizedPnl >= 0 ? 'amount-positive' : ''}>含み損益 {signed(total.unrealizedPnl, total.currency)}</small>
        {total.missingPricePositionCount > 0 && <em>価格未確認 {total.missingPricePositionCount}銘柄（集計外）</em>}
      </article>)}
    </div>
    <div className="investment-valuation__positions">
      {valuation.positions.map((position) => <div key={`${position.accountId}-${position.instrumentCode}-${position.currency}`}>
        <span><strong>{position.instrumentName}</strong><small>{position.instrumentCode || '銘柄コードなし'} ・ {position.accountName}</small></span>
        {position.price ? <>
          <b>{money(position.marketValue ?? 0, position.currency)}</b>
          <small>{position.price.priceDate}・{position.price.provider}・単価 {money(position.price.unitPrice, position.currency)}</small>
        </> : <b className="investment-valuation__missing">価格未確認</b>}
      </div>)}
    </div>
    {valuation.missingPriceInstrumentCodes.length > 0 && <p className="performance-warning">価格のない銘柄は推定せず評価額から除外しています: {valuation.missingPriceInstrumentCodes.join('、')}</p>}
  </section>
}

function money(value: number, currency: string) {
  return `${currency} ${value.toLocaleString('ja-JP', { maximumFractionDigits: 4 })}`
}

function signed(value: number, currency: string) {
  return `${value >= 0 ? '+' : ''}${money(value, currency)}`
}
