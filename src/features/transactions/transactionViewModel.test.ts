import { describe, expect, it } from 'vitest'
import type { TransactionRowDto } from '../../platform/types'
import { toTransactionViewModel } from './transactionViewModel'

function row(overrides: Partial<TransactionRowDto> = {}): TransactionRowDto {
  return {
    id: 'tx-1',
    occurredOn: '2026-07-12',
    postedOn: '2026-07-13',
    transactionType: 'EXPENSE',
    payee: '成城石井',
    description: '食料品',
    amountJpy: 4_280,
    status: 'POSTED',
    calculationTarget: true,
    debitAccountId: 'family-groceries',
    debitAccountName: '食費',
    creditAccountId: 'family-bank',
    creditAccountName: '銀行',
    categoryAccountId: 'family-groceries',
    categoryName: '食費',
    attributionKind: 'HOUSEHOLD',
    attributedMemberId: null,
    attributedMemberName: null,
    audienceVisibility: 'SHARED',
    audienceMemberId: null,
    audienceMemberName: null,
    labels: [],
    tags: [],
    ...overrides,
  }
}

describe('toTransactionViewModel', () => {
  it('maps a posted expense with ledger account and category detail', () => {
    expect(toTransactionViewModel(row())).toEqual({
      id: 'tx-1',
      date: '7月12日',
      merchant: '成城石井',
      detail: '食料品',
      category: '食費',
      account: '銀行 → 食費',
      amount: -4_280,
      status: 'confirmed',
      icon: 'subscription',
      accountingEffect: 'ACCRUAL_AND_CASH',
      calculationTarget: true,
      labels: [],
      tags: [],
      attributionLabel: '世帯共通',
      audienceLabel: '共有',
    })
  })

  it('falls back when optional account projections are absent', () => {
    expect(toTransactionViewModel(row({
      debitAccountName: null,
      creditAccountName: null,
      categoryName: null,
    }))).toMatchObject({ category: '支出', account: '口座情報なし' })
  })

  it.each([
    ['INCOME', 10_000, 10_000, '収入', 'income', 'ACCRUAL_AND_CASH'],
    ['REFUND', 2_000, 2_000, '返金', 'income', 'ACCRUAL_AND_CASH'],
    ['CARD_PURCHASE', 5_000, -5_000, 'カード利用', 'subscription', 'ACCRUAL_ONLY'],
    ['CARD_PAYMENT', 6_000, -6_000, '資金移動', 'subscription', 'CASH_ONLY'],
    ['FEE', -500, -500, '手数料', 'subscription', 'ACCRUAL_AND_CASH'],
  ] as const)('maps %s semantics', (transactionType, amountJpy, amount, category, icon, accountingEffect) => {
    const mapped = toTransactionViewModel(row({ transactionType, amountJpy, categoryName: null }))
    expect(mapped).toMatchObject({ amount, category, icon, accountingEffect })
  })

  it('preserves ambiguous transfer direction rather than fabricating an inflow or outflow', () => {
    expect(toTransactionViewModel(row({ transactionType: 'TRANSFER', amountJpy: -3_000 })).amount).toBe(-3_000)
    expect(toTransactionViewModel(row({ transactionType: 'ADJUSTMENT', amountJpy: 3_000 })).amount).toBe(3_000)
  })

  it('falls back to available source text and marks non-posted rows for review', () => {
    expect(toTransactionViewModel(row({
      occurredOn: 'not-a-date',
      transactionType: 'future_type',
      payee: '  ',
      description: '  調整メモ  ',
      amountJpy: 125,
      status: 'DRAFT',
      categoryName: null,
    }))).toMatchObject({
      date: 'not-a-date',
      merchant: '調整メモ',
      detail: '調整メモ',
      category: 'その他',
      amount: 125,
      status: 'review',
    })
  })

  it('uses a type label when both payee and description are absent', () => {
    expect(toTransactionViewModel(row({ transactionType: 'INCOME', payee: null, description: null }))).toMatchObject({
      merchant: '収入',
      detail: '収入',
    })
  })

  it('does not normalize an impossible calendar date', () => {
    expect(toTransactionViewModel(row({ occurredOn: '2026-02-31' })).date).toBe('2026-02-31')
  })

  it('preserves the calculation-target flag for ledger badges', () => {
    expect(toTransactionViewModel(row({ calculationTarget: false }))).toMatchObject({ calculationTarget: false })
  })
})
