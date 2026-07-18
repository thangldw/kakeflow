import { useMemo, useState } from 'react'
import type { AccountDto, PostingDecisionDto, PreviewCandidateDto } from '../../platform'
import { createExactReceiptItemSplit, reconcileReceiptSplit } from './receiptSplitPosting'
import { localize } from '../../i18n'

const yen = (value: number) => `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`

export interface ReceiptReviewPanelProps {
  readonly candidate: PreviewCandidateDto
  readonly decision: PostingDecisionDto
  readonly accounts: readonly AccountDto[]
  readonly onDecisionChange: (decision: PostingDecisionDto) => void
}

export function ReceiptReviewPanel({ candidate, decision, accounts, onDecisionChange }: ReceiptReviewPanelProps) {
  const review = candidate.receiptReview
  const expenseAccounts = accounts.filter((account) => account.accountKind === 'EXPENSE')
  const fallbackExpense = decision.entries.find((entry) => entry.side === 'DEBIT')?.accountId ?? ''
  const [accountByItem, setAccountByItem] = useState<Record<string, string>>({})
  const splitItems = useMemo(() => review?.items.map((item, index) => ({
    id: `${candidate.id}:receipt-item:${index}`,
    description: item.description,
    amountJpy: item.amountJpy,
    expenseAccountId: accountByItem[`${candidate.id}:receipt-item:${index}`] ?? fallbackExpense,
  })) ?? [], [accountByItem, candidate.id, fallbackExpense, review])
  if (!review) return null

  const reconciliation = reconcileReceiptSplit(candidate.amountJpy, splitItems)
  const sourceReconciliationIsExact = review.reconciliation?.status === 'EXACT'
    && review.reconciliation.totalAmountJpy === candidate.amountJpy
    && review.reconciliation.deltaJpy === 0
  const canSplitShape = candidate.direction === 'OUT' && ['EXPENSE', 'CARD_PURCHASE'].includes(decision.transactionType)
  const canAutoSplit = canSplitShape && splitItems.length >= 2 && reconciliation.status === 'EXACT' && sourceReconciliationIsExact
  const applySplit = () => {
    const split = createExactReceiptItemSplit({
      candidateAmountJpy: candidate.amountJpy,
      direction: candidate.direction,
      decision,
      items: splitItems,
      accountIds: new Set(accounts.map((account) => account.id)),
      expectedCandidateId: candidate.id,
      nextEntryId: () => globalThis.crypto.randomUUID(),
    })
    if (split) onDecisionChange(split)
  }

  return <section className="receipt-review-panel" aria-label={localize(`${candidate.id}のレシート明細`)}>
    <header><div><strong>{localize("レシート読取結果")}</strong><small>{[review.merchant, review.occurredOn, review.paymentMethod].filter(Boolean).join(' ・ ')}</small></div><b>{reconciliation.status === 'EXACT' && sourceReconciliationIsExact ? localize("一致") : reconciliation.status === 'NO_ITEMS' ? localize("品目なし") : localize("差額あり")}</b></header>
    {review.items.length > 0 ? <div className="receipt-item-table" role="table" aria-label={localize("読み取った品目")}>
      <div role="row" className="receipt-item-heading"><span>{localize("品目")}</span><span>{localize("数量")}</span><span>{localize("税")}</span><span>{localize("金額")}</span><span>{localize("費用口座")}</span></div>
      {review.items.map((item, index) => { const id = `${candidate.id}:receipt-item:${index}`; return <div role="row" key={id}>
        <span>{item.description}<small>{localize("原本")} {item.provenance.lineNumber}{localize("行目 ・ 信頼度")} {Math.round(item.confidenceBps / 100)}%</small></span><span>{item.quantity == null ? '—' : `×${item.quantity}`}</span><span>{item.taxRatePercent == null ? '—' : `${item.taxRatePercent}%`}</span><strong>{yen(item.amountJpy)}</strong>
        <select aria-label={localize(`${item.description}の費用口座`)} value={accountByItem[id] ?? fallbackExpense} onChange={(event) => setAccountByItem((current) => ({ ...current, [id]: event.target.value }))}><option value="">{localize("費用口座を選択")}</option>{expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
      </div> })}
    </div> : <p className="receipt-split-notice">{localize("品目を抽出できなかったため自動配分しません。下の仕訳明細で手動分割できます。")}</p>}
    <dl className="receipt-review-summary">
      {review.subtotalJpy != null && <div><dt>{localize("小計")}</dt><dd>{yen(review.subtotalJpy)}</dd></div>}
      {review.taxes.map((tax) => <div key={tax.ratePercent}><dt>{localize("消費税")} {tax.ratePercent}%</dt><dd>{tax.taxAmountJpy == null ? localize("金額不明") : yen(tax.taxAmountJpy)}</dd></div>)}
      {(review.couponAmountJpy != null || review.couponEvidence.length > 0) && <div><dt>{localize("クーポン")}</dt><dd>{review.couponAmountJpy == null ? localize("金額読取不可") : <>−{yen(Math.abs(review.couponAmountJpy))}</>}</dd></div>}
      {(review.pointsUsedJpy != null || review.pointsUsedEvidence.length > 0) && <div><dt>{localize("ポイント利用")}</dt><dd>{review.pointsUsedJpy == null ? localize("金額読取不可") : <>−{yen(Math.abs(review.pointsUsedJpy))}</>}</dd></div>}
      <div><dt>{localize("レシート合計")}</dt><dd>{yen(review.totalAmountJpy)}</dd></div>
      <div><dt>{localize("候補金額")}</dt><dd>{yen(candidate.amountJpy)}</dd></div>
      <div><dt>{localize("品目合計")}</dt><dd>{reconciliation.itemTotalJpy == null ? '—' : yen(reconciliation.itemTotalJpy)}</dd></div>
      <div><dt>{localize("差額")}</dt><dd>{reconciliation.deltaJpy == null ? '—' : yen(reconciliation.deltaJpy)}</dd></div>
    </dl>
    {(review.couponEvidence.length > 0 || review.pointsUsedEvidence.length > 0) && <div className="receipt-adjustment-evidence" aria-label={localize("割引の原本根拠")}>
      {review.couponEvidence.map((evidence, index) => <span key={`coupon:${index}`}>{localize("クーポン根拠: 原本")} {evidence.provenance.lineNumber}{localize("行目 ・")} {evidence.amountJpy == null ? localize("金額読取不可") : yen(evidence.amountJpy)} {localize("・ 信頼度")} {Math.round(evidence.confidenceBps / 100)}%</span>)}
      {review.pointsUsedEvidence.map((evidence, index) => <span key={`points:${index}`}>{localize("ポイント根拠: 原本")} {evidence.provenance.lineNumber}{localize("行目 ・")} {evidence.amountJpy == null ? localize("金額読取不可") : yen(evidence.amountJpy)} {localize("・ 信頼度")} {Math.round(evidence.confidenceBps / 100)}%</span>)}
    </div>}
    {(reconciliation.status === 'DELTA' || (reconciliation.status === 'EXACT' && !sourceReconciliationIsExact)) && <p className="receipt-split-notice">{localize("品目合計と候補金額に差があるため自動配分しません。クーポン・ポイント・読取漏れを確認し、下の仕訳明細で手動分割してください。")}</p>}
    {reconciliation.status === 'EXACT' && !canSplitShape && <p className="receipt-split-notice">{localize("品目分割は支出方向の 「支出」「カード利用」 だけで利用できます。仕訳明細は手動で編集できます。")}</p>}
    <button type="button" className="secondary-btn" disabled={!canAutoSplit} onClick={applySplit}>{localize("品目から分割")}</button>
  </section>
}
