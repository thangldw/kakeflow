import type { FixedCostReviewDto, FixedCostSegment } from './platform'
import { localize } from '../../i18n'

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`
const labels: Record<FixedCostSegment, string> = {
  HOUSING: '住居費', INSURANCE: '保険', ELECTRICITY: '電気', GAS: 'ガス', WATER: '水道', INTERNET: 'インターネット', MOBILE: '携帯電話', SUBSCRIPTIONS_OTHER: 'その他サブスク', OTHER_RECURRING: 'その他固定費',
}
function changeLabel(change: number, rate: number | null): string { return `${change > 0 ? '+' : ''}${yen(change)}${rate == null ? '' : ` (${rate > 0 ? '+' : ''}${(rate / 100).toFixed(1)}%)`}` }

export function FixedCostReviewView({ data, onOpenTransactions }: { data: FixedCostReviewDto; onOpenTransactions: () => void }) {
  const maxMonthly = Math.max(1, ...data.monthlyPoints.map((point) => point.totalJpy))
  return <section className="fixed-cost-review" aria-label={localize("固定費レビュー")}>
    <div className="fixed-cost-disclosure"><strong>{localize("比較条件")}</strong><span>{data.historyFrom}〜{data.historyThrough} {localize("の完了済み6か月と計算対象の確定取引を使用。集計対象外と現在の未完了月は除外しています。")}</span><span>{localize("市場価格・他社プランのデータがないため、市場相場に基づく節約可能額は算出していません。")}</span></div>
    <div className="fixed-cost-kpis">
      <article><span>{localize("直近3か月平均")}</span><strong>{yen(data.totals.recentThreeAverageJpy)}</strong><small>{localize("完了月のみ")}</small></article>
      <article><span>{localize("前3か月平均")}</span><strong>{yen(data.totals.previousThreeAverageJpy)}</strong><small>{localize("比較基準")}</small></article>
      <article><span>{localize("変化")}</span><strong className={data.totals.changeJpy > 0 ? 'cost-increase' : data.totals.changeJpy < 0 ? 'cost-decrease' : ''}>{changeLabel(data.totals.changeJpy, data.totals.changeRateBps)}</strong><small>{localize("直近3か月 − 前3か月")}</small></article>
      <article><span>{localize("年換算")}</span><strong>{yen(data.totals.annualizedJpy)}</strong><small>{localize("支払周期で正規化した推定額")}</small></article>
    </div>
    <article className="panel fixed-cost-trend"><div className="panel-head"><div><h2>{localize("完了月の推移")}</h2><p>{localize("安定した定期支出のみ")}</p></div><span>{data.totals.recurringPayeeCount}{localize("支払先・")}{data.totals.transactionCount}{localize("取引")}</span></div><div className="fixed-cost-bars">{data.monthlyPoints.map((point) => <div key={point.month}><strong>{yen(point.totalJpy)}</strong><span><i style={{ height: `${Math.max(3, point.totalJpy / maxMonthly * 100)}%` }} /></span><small>{Number(point.month.slice(5))}{localize("月")}</small></div>)}</div></article>
    <div className="fixed-cost-segments">{data.segments.map((segment) => <article className="panel" key={segment.segment}><div className="fixed-cost-segment-head"><span><strong>{localize(labels[segment.segment])}</strong><small>{segment.recurringPayeeCount}{localize("支払先・周期正規化の年換算")} {yen(segment.annualizedJpy)}</small></span><b className={segment.changeJpy > 0 ? 'increase' : segment.changeJpy < 0 ? 'decrease' : ''}>{changeLabel(segment.changeJpy, segment.changeRateBps)}</b></div><dl><div><dt>{localize("直近3か月")}</dt><dd>{yen(segment.recentThreeAverageJpy)}</dd></div><div><dt>{localize("前3か月")}</dt><dd>{yen(segment.previousThreeAverageJpy)}</dd></div><div><dt>{localize("最新支払")}</dt><dd>{segment.latestPaymentOn ?? '—'}</dd></div></dl><div className="fixed-cost-payees">{segment.topPayees.map((payee) => <button key={payee.normalizedPayee} onClick={onOpenTransactions}><span><strong>{payee.displayPayee}</strong><small>{payee.expenseCategoryNames.join('・') || localize("カテゴリー未分類")} ・ {payee.occurrenceCount}{localize("回 ・ 信頼度")} {Math.round(payee.confidenceBps / 100)}%</small></span><span><strong>{yen(payee.typicalAmountJpy)}</strong><small>{localize("最新")} {yen(payee.latestAmountJpy)}</small></span></button>)}</div>{segment.reasons.length > 0 && <p>{segment.reasons.join(' ・ ')}</p>}</article>)}</div>
    <article className="panel fixed-cost-coverage"><div><h2>{localize("データ範囲と制約")}</h2><p>{localize("確認済み取引")} {data.coverage.confirmedTransactionCount}{localize("件中、定期支出")} {data.coverage.recurringTransactionCount}{localize("件。観測")} {data.coverage.observedMonthCount}{localize("か月から完了済み")} {data.coverage.completeMonthCount}{localize("か月を比較しています。")}</p><p>{localize("分類できない定期支払先:")} {data.coverage.unclassifiedRecurringPayeeCount}{localize("件")}</p></div><ul>{data.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></article>
  </section>
}
