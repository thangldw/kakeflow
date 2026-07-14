import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AccountDto, PostingDecisionDto, PreviewCandidateDto, ReceiptReviewDto } from '../../platform'
import { ReceiptReviewPanel } from './ReceiptReviewPanel'

const accounts: AccountDto[] = [
  { id: 'expense', name: 'その他', accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
  { id: 'food', name: '食費', accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
  { id: 'card', name: 'カード', accountKind: 'LIABILITY', accountSubtype: 'CREDIT_CARD', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
]
const provenance = { lineNumber: 1, regionIndexes: [0], method: 'TEXT_PATTERN' as const }
const review: ReceiptReviewDto = {
  merchant: '生協', occurredOn: '2026-07-12', totalAmountJpy: 1_000,
  items: [{ description: '牛乳', quantity: 2, amountJpy: 300, taxRatePercent: 8, confidenceBps: 9000, provenance }, { description: '洗剤', quantity: 1, amountJpy: 700, taxRatePercent: 10, confidenceBps: 9000, provenance }],
  taxes: [{ ratePercent: 8, taxAmountJpy: 22, taxableAmountJpy: 278, confidenceBps: 9000, provenance }],
  couponAmountJpy: 100, pointsUsedJpy: 50, couponEvidence: [{ amountJpy: 100, confidenceBps: 9000, provenance }], pointsUsedEvidence: [{ amountJpy: 50, confidenceBps: 9000, provenance }],
  subtotalJpy: 1_150, changeJpy: null, paymentMethod: 'カード', taxMode: 'INCLUDED',
  reconciliation: { status: 'EXACT', itemTotalJpy: 1_000, totalAmountJpy: 1_000, deltaJpy: 0 }, provenance: { sourceRecordId: 'record', sourceRowNumber: 1, documentPageNumber: null },
}
const candidate = { id: 'candidate', accountId: 'card', occurredOn: '2026-07-12', postedOn: null, amountJpy: 1_000, direction: 'OUT', descriptionRaw: '生協', merchantRaw: '生協', externalTransactionId: null, externalSource: null, externalFactHash: null, calculationTarget: true, suggestedTransactionType: null, institutionRaw: null, categoryMajorRaw: null, categoryMinorRaw: null, memoRaw: null, extractionConfidenceBps: 9000, normalizationConfidenceBps: 9000, attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null, reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [], receiptReview: review } satisfies PreviewCandidateDto
const decision: PostingDecisionDto = { candidateId: 'candidate', transactionId: 'transaction', transactionType: 'CARD_PURCHASE', payee: '生協', description: null, attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null, calculationTarget: true, entries: [{ id: 'd', accountId: 'expense', side: 'DEBIT', amountJpy: 1_000 }, { id: 'c', accountId: 'card', side: 'CREDIT', amountJpy: 1_000 }] }

describe('ReceiptReviewPanel', () => {
  it('shows quantities, tax markers, adjustments and creates an exact per-item split', () => {
    const onChange = vi.fn()
    render(<ReceiptReviewPanel candidate={candidate} decision={decision} accounts={accounts} onDecisionChange={onChange} />)
    expect(screen.getByText('×2')).toBeInTheDocument()
    expect(screen.getAllByText('8%').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/原本 1行目 ・ 信頼度 90%/)).toHaveLength(2)
    expect(screen.getByText('クーポン')).toBeInTheDocument()
    expect(screen.getByText('ポイント利用')).toBeInTheDocument()
    expect(screen.getByText(/クーポン根拠: 原本 1行目/)).toBeInTheDocument()
    expect(screen.getByText(/ポイント根拠: 原本 1行目/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('牛乳の費用口座'), { target: { value: 'food' } })
    fireEvent.click(screen.getByRole('button', { name: '品目から分割' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ entries: [expect.objectContaining({ accountId: 'food', amountJpy: 300 }), expect.objectContaining({ accountId: 'expense', amountJpy: 700 }), decision.entries[1]] }))
  })

  it('does not auto allocate a delta and keeps manual split guidance visible', () => {
    render(<ReceiptReviewPanel candidate={{ ...candidate, amountJpy: 1_100 }} decision={{ ...decision, entries: decision.entries.map((entry) => ({ ...entry, amountJpy: 1_100 })) }} accounts={accounts} onDecisionChange={vi.fn()} />)
    expect(screen.getByText(/差があるため自動配分しません/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '品目から分割' })).toBeDisabled()
  })

  it('explains no-items receipts and leaves manual splitting available', () => {
    render(<ReceiptReviewPanel candidate={{ ...candidate, receiptReview: { ...review, items: [], reconciliation: { status: 'NO_ITEMS', itemTotalJpy: 0, totalAmountJpy: 1_000, deltaJpy: -1_000 } } }} decision={decision} accounts={accounts} onDecisionChange={vi.fn()} />)
    expect(screen.getByText(/品目を抽出できなかったため自動配分しません/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '品目から分割' })).toBeDisabled()
  })
})
