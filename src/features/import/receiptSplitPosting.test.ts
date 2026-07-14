import { describe, expect, it } from 'vitest'
import type { PostingDecisionDto } from '../../platform'
import { createExactReceiptItemSplit, reconcileReceiptSplit, validatePostingDecision } from './receiptSplitPosting'

const accounts = new Set(['expense', 'food', 'household', 'card', 'bank'])

function decision(overrides: Partial<PostingDecisionDto> = {}): PostingDecisionDto {
  return {
    candidateId: 'candidate-1', transactionId: 'transaction-1', transactionType: 'CARD_PURCHASE',
    payee: 'スーパー', description: null, calculationTarget: true,
    attributionKind: 'HOUSEHOLD', attributedMemberId: null,
    audienceVisibility: 'SHARED', audienceMemberId: null,
    entries: [
      { id: 'debit-1', accountId: 'expense', side: 'DEBIT', amountJpy: 1_000 },
      { id: 'credit-1', accountId: 'card', side: 'CREDIT', amountJpy: 1_000 },
    ],
    ...overrides,
  }
}

const items = [
  { id: 'item-1', description: '牛乳', amountJpy: 300, expenseAccountId: 'food' },
  { id: 'item-2', description: '洗剤', amountJpy: 700, expenseAccountId: null },
] as const

describe('receipt split reconciliation', () => {
  it('reports no items, exact totals, and a signed items-minus-candidate delta', () => {
    expect(reconcileReceiptSplit(1_000, [])).toEqual({ status: 'NO_ITEMS', candidateAmountJpy: 1_000, itemTotalJpy: null, deltaJpy: null, itemsAreValid: true })
    expect(reconcileReceiptSplit(1_000, items)).toEqual({ status: 'EXACT', candidateAmountJpy: 1_000, itemTotalJpy: 1_000, deltaJpy: 0, itemsAreValid: true })
    expect(reconcileReceiptSplit(1_100, items)).toEqual({ status: 'DELTA', candidateAmountJpy: 1_100, itemTotalJpy: 1_000, deltaJpy: -100, itemsAreValid: true })
    expect(reconcileReceiptSplit(900, items)).toEqual({ status: 'DELTA', candidateAmountJpy: 900, itemTotalJpy: 1_000, deltaJpy: 100, itemsAreValid: true })
  })

  it.each([
    [{ ...items[0], amountJpy: 0 }, items[1]],
    [{ ...items[0], amountJpy: -300 }, items[1]],
    [{ ...items[0], amountJpy: 1.5 }, items[1]],
    [{ ...items[0], description: '  ' }, items[1]],
    [items[0], { ...items[1], id: items[0].id }],
  ])('does not call malformed review rows exact', (...malformed) => {
    expect(reconcileReceiptSplit(1_000, malformed)).toMatchObject({ status: 'DELTA', itemTotalJpy: null, deltaJpy: null, itemsAreValid: false })
  })
})

describe('posting decision validation', () => {
  it('accepts a balanced manual split whose debit and credit totals equal the candidate', () => {
    expect(validatePostingDecision(decision({ entries: [
      { id: 'd1', accountId: 'food', side: 'DEBIT', amountJpy: 300 },
      { id: 'd2', accountId: 'household', side: 'DEBIT', amountJpy: 700 },
      { id: 'c1', accountId: 'card', side: 'CREDIT', amountJpy: 1_000 },
    ] }), { candidateAmountJpy: 1_000, accountIds: accounts, expectedCandidateId: 'candidate-1' })).toEqual({ valid: true, codes: [] })
  })

  it('rejects missing, duplicate, unknown, non-integer, unbalanced, mismatched, and oversized decisions', () => {
    const result = validatePostingDecision(decision({
      candidateId: 'other', transactionId: ' ', transactionType: ' ',
      entries: [
        { id: 'same', accountId: 'missing', side: 'DEBIT', amountJpy: 900.5 },
        { id: 'same', accountId: '', side: 'CREDIT', amountJpy: 800 },
      ],
    }), { candidateAmountJpy: 1_000, accountIds: accounts, expectedCandidateId: 'candidate-1' })
    expect(result.valid).toBe(false)
    expect(result.codes).toEqual(expect.arrayContaining([
      'INVALID_DECISION_ID', 'CANDIDATE_ID_MISMATCH', 'INVALID_TRANSACTION_TYPE', 'DUPLICATE_ENTRY_ID',
      'UNKNOWN_ACCOUNT_ID', 'INVALID_ACCOUNT_ID', 'INVALID_ENTRY_AMOUNT', 'UNBALANCED_TOTAL', 'CANDIDATE_TOTAL_MISMATCH',
    ]))
    expect(validatePostingDecision(decision({ entries: Array.from({ length: 129 }, (_, index) => ({
      id: `e-${index}`, accountId: 'expense', side: index === 128 ? 'CREDIT' as const : 'DEBIT' as const, amountJpy: 1,
    })) }), { candidateAmountJpy: 128, accountIds: accounts }).codes).toContain('INVALID_ENTRY_COUNT')
    expect(validatePostingDecision(decision(), { candidateAmountJpy: 0, accountIds: accounts }).codes).toContain('INVALID_CANDIDATE_AMOUNT')
  })
})

describe('exact receipt item split', () => {
  it('preserves the payment-side entry and maps item debits to selected or default expense accounts', () => {
    let sequence = 0
    const original = decision()
    const split = createExactReceiptItemSplit({
      candidateAmountJpy: 1_000, direction: 'OUT', decision: original, items, accountIds: accounts,
      nextEntryId: () => `split-${++sequence}`,
    })
    expect(split?.entries).toEqual([
      { id: 'split-1', accountId: 'food', side: 'DEBIT', amountJpy: 300 },
      { id: 'split-2', accountId: 'expense', side: 'DEBIT', amountJpy: 700 },
      original.entries[1],
    ])
    expect(split?.entries[2]).toBe(original.entries[1])
    expect(original.entries).toHaveLength(2)
  })

  it.each([
    { label: 'incoming', change: { direction: 'IN' as const } },
    { label: 'refund', change: { decision: decision({ transactionType: 'REFUND' }) } },
    { label: 'delta', change: { candidateAmountJpy: 999 } },
    { label: 'one item', change: { items: [items[0]] } },
    { label: 'unknown selected account', change: { items: [{ ...items[0], expenseAccountId: 'unknown' }, items[1]] } },
    { label: 'multiple payment entries', change: { decision: decision({ entries: [
      { id: 'd', accountId: 'expense', side: 'DEBIT', amountJpy: 1_000 },
      { id: 'c1', accountId: 'card', side: 'CREDIT', amountJpy: 500 },
      { id: 'c2', accountId: 'bank', side: 'CREDIT', amountJpy: 500 },
    ] }) } },
  ])('fails closed for $label', ({ change }) => {
    expect(createExactReceiptItemSplit({
      candidateAmountJpy: 1_000, direction: 'OUT', decision: decision(), items, accountIds: accounts,
      nextEntryId: () => 'fresh-id', ...change,
    })).toBeNull()
  })

  it('rejects duplicate generated IDs and more than 127 item entries', () => {
    expect(createExactReceiptItemSplit({
      candidateAmountJpy: 1_000, direction: 'OUT', decision: decision(), items, accountIds: accounts,
      nextEntryId: () => 'debit-1',
    })).toBeNull()
    const manyItems = Array.from({ length: 128 }, (_, index) => ({ id: `i-${index}`, description: `item ${index}`, amountJpy: 1, expenseAccountId: null }))
    expect(createExactReceiptItemSplit({
      candidateAmountJpy: 128, direction: 'OUT', decision: decision({ entries: [
        { id: 'd', accountId: 'expense', side: 'DEBIT', amountJpy: 128 },
        { id: 'c', accountId: 'card', side: 'CREDIT', amountJpy: 128 },
      ] }), items: manyItems, accountIds: accounts, nextEntryId: () => crypto.randomUUID(),
    })).toBeNull()
  })
})
