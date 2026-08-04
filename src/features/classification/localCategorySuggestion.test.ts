import { describe, expect, it } from 'vitest'
import type { AccountDto, TransactionRowDto } from '../../platform'
import { normalizeMerchant, suggestLocalCategory } from './localCategorySuggestion'

const account = (id: string, name: string): AccountDto => ({
  id, name, accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED',
})

const accounts = [account('food', '食費'), account('transport', '交通費'), account('utilities', '水道・光熱費'), account('daily', '日用品'), account('medical', '健康・医療')]

const transaction = (id: string, payee: string, categoryAccountId: string, categoryName: string): TransactionRowDto => ({
  id, occurredOn: `2026-07-${String(Number(id) + 10).padStart(2, '0')}`, postedOn: null, transactionType: 'CARD_PURCHASE', payee, description: null, amountJpy: 1_000,
  status: 'POSTED', calculationTarget: true, debitAccountId: categoryAccountId, debitAccountName: categoryName, creditAccountId: 'card', creditAccountName: 'Card',
  categoryAccountId, categoryName, attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null, labels: [], tags: [],
})

describe('local category suggestions', () => {
  it('normalizes corporate, branch, payment-provider and punctuation noise', () => {
    expect(normalizeMerchant('VISA 株式会社 成城石井・恵比寿店 123456')).toBe('成城石井恵比寿')
  })

  it('prefers the dominant category from similar confirmed merchant history', () => {
    const history = [
      transaction('1', '成城石井 恵比寿店', 'food', '食費'),
      transaction('2', '成城石井・新宿店', 'food', '食費'),
      transaction('3', '株式会社 成城石井', 'food', '食費'),
      transaction('4', '成城石井オンラインストア', 'daily', '日用品'),
    ]
    const suggestion = suggestLocalCategory({ merchant: 'カード利用 成城石井 恵比寿支店', description: null, transactionType: 'CARD_PURCHASE' }, history, accounts)
    expect(suggestion).toMatchObject({ categoryAccountId: 'food', source: 'HISTORY' })
    expect(suggestion!.sampleCount).toBeGreaterThanOrEqual(2)
    expect(suggestion!.confidenceBps).toBeGreaterThanOrEqual(7_500)
    expect(suggestion!.historySharePercent).toBeGreaterThanOrEqual(65)
  })

  it('falls back to an explainable keyword mapping when history is unavailable', () => {
    expect(suggestLocalCategory({ merchant: '東京電力', description: '7月電気料金', transactionType: 'EXPENSE' }, [], accounts)).toMatchObject({
      categoryAccountId: 'utilities', source: 'KEYWORD', confidenceBps: 9_300, matchedKeyword: '東京電力',
    })
  })

  it('prefers a specific high-confidence keyword over a broad marketplace keyword', () => {
    expect(suggestLocalCategory({ merchant: 'Amazon Pharmacy', description: '薬局 医薬品', transactionType: 'EXPENSE' }, [], accounts)).toMatchObject({
      categoryAccountId: 'medical', source: 'KEYWORD', matchedKeyword: 'pharmacy',
    })
  })

  it('marks a consistently repeated exact merchant as high confidence', () => {
    const history = Array.from({ length: 6 }, (_, index) => transaction(String(index + 1), '東京電力', 'utilities', '水道・光熱費'))
    const suggestion = suggestLocalCategory({ merchant: '東京電力', description: '電気料金', transactionType: 'EXPENSE', amountJpy: 1_000 }, history, accounts)
    expect(suggestion).toMatchObject({ categoryAccountId: 'utilities', source: 'HISTORY', sampleCount: 6 })
    expect(suggestion!.confidenceBps).toBeGreaterThanOrEqual(9_200)
  })

  it('does not suggest a category for transfers or an ambiguous one-off history match', () => {
    expect(suggestLocalCategory({ merchant: 'JR東日本', description: null, transactionType: 'TRANSFER' }, [], accounts)).toBeNull()
    expect(suggestLocalCategory({ merchant: 'Unknown Store', description: null, transactionType: 'EXPENSE' }, [transaction('1', 'Different Store', 'food', '食費')], accounts)).toBeNull()
  })
})
