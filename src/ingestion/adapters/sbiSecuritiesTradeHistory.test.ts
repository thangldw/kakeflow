import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectImportAdapter, sbiSecuritiesTradeHistoryAdapter } from '../index'

const domestic = readFileSync('src/ingestion/fixtures/sbi-securities-domestic-trades.csv', 'utf8')
const foreign = readFileSync('src/ingestion/fixtures/sbi-securities-foreign-trades.csv', 'utf8')

describe('SBI Securities trade-history adapter', () => {
  it('wins detection only for the complete official domestic or foreign field family', () => {
    expect(detectImportAdapter({ text: domestic, filename: 'unrelated.csv' })?.adapter.id).toBe('sbi-securities-trade-history-v1')
    expect(detectImportAdapter({ text: foreign, filename: 'unrelated.csv' })?.adapter.id).toBe('sbi-securities-trade-history-v1')
    const partial = domestic.replace(',受渡日,受渡金額／決済損益', ',受渡日')
    expect(sbiSecuritiesTradeHistoryAdapter.detect({ text: partial }).score).toBe(0)
  })

  it('parses domestic combined security fields and exact spot trade semantics', () => {
    const result = sbiSecuritiesTradeHistoryAdapter.parse({ text: domestic, accountHint: 'SBI証券' })
    expect(result.metadata).toMatchObject({ provider: 'SBI_SECURITIES', layout: 'DOMESTIC', headerRow: 1 })
    expect(result.records).toEqual([
      expect.objectContaining({ eventType: 'BUY', instrumentCode: '7203', instrumentName: 'トヨタ自動車', market: '東証', accountType: '特定', currency: 'JPY', quantity: 100, unitPrice: 2500, grossAmount: 250000, settlementAmount: 250000, reconciliationStatus: 'BALANCED' }),
      expect.objectContaining({ eventType: 'SELL', instrumentCode: '6758', instrumentName: 'ソニーグループ', market: '東証', accountType: 'NISA', currency: 'JPY', quantity: 20, unitPrice: 3000, grossAmount: 60000, settlementAmount: 59480, reconciliationStatus: 'ADJUSTED', reconciliationDifference: -520 }),
    ])
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'SBI_SETTLEMENT_MISMATCH', row: 3 }))
    result.records.forEach((record) => expect(record.legs.reduce((sum, leg) => sum + leg.signedAmount, 0)).toBe(0))
  })

  it('parses foreign name, ticker and market while preserving currency', () => {
    const result = sbiSecuritiesTradeHistoryAdapter.parse({ text: foreign })
    expect(result.records).toEqual([
      expect.objectContaining({ eventType: 'BUY', instrumentCode: 'AAPL', instrumentName: 'Apple Inc.', market: 'NASDAQ', currency: 'USD', quantity: 10, unitPrice: 200, settlementAmount: 2005 }),
      expect.objectContaining({ eventType: 'SELL', instrumentCode: 'MSFT', instrumentName: 'Microsoft Corp.', market: 'NASDAQ', currency: 'USD', quantity: 2, unitPrice: 500, settlementAmount: 995 }),
    ])
    expect(result.issues.filter((issue) => issue.code === 'SBI_SETTLEMENT_MISMATCH')).toHaveLength(2)

    const officialMinimum = foreign.replace(',決済通貨', '').replace(/,USD$/gm, '')
    expect(sbiSecuritiesTradeHistoryAdapter.parse({ text: officialMinimum }).records)
      .toEqual([expect.objectContaining({ currency: 'USD' }), expect.objectContaining({ currency: 'USD' })])

    const verboseSpot = foreign.replace(',現買,', ',買付,').replace(',現売,', ',売却,')
    expect(sbiSecuritiesTradeHistoryAdapter.parse({ text: verboseSpot }).records.map((record) => record.eventType))
      .toEqual(['BUY', 'SELL'])

    const tickerFirst = foreign.replace('Apple Inc. AAPL NASDAQ', 'AAPL Apple Inc. Nasdaq')
    expect(sbiSecuritiesTradeHistoryAdapter.parse({ text: tickerFirst }).records[0])
      .toMatchObject({ instrumentCode: 'AAPL', instrumentName: 'Apple Inc.', market: 'NASDAQ' })
  })

  it('rejects margin trades and never guesses ambiguous activity', () => {
    const margin = domestic.replace('株式現物買', '株式信用新規買').replace('株式現物売', '信用返済売')
    const result = sbiSecuritiesTradeHistoryAdapter.parse({ text: margin })
    expect(result.records).toHaveLength(0)
    expect(result.issues.filter((issue) => issue.code === 'SBI_MARGIN_TRADE_UNSUPPORTED')).toHaveLength(2)

    const ambiguous = foreign.replace(',現物,現買,', ',指値,買付,')
    const ambiguousResult = sbiSecuritiesTradeHistoryAdapter.parse({ text: ambiguous })
    expect(ambiguousResult.records).toHaveLength(1)
    expect(ambiguousResult.issues).toContainEqual(expect.objectContaining({ code: 'SBI_TRADE_TYPE_UNSUPPORTED', row: 2 }))
  })

  it('skips incomplete or invalid records with row provenance', () => {
    const invalid = domestic.replace('2026/07/01,7203', 'invalid,7203').replace(',100,2500,', ',0,2500,')
    const result = sbiSecuritiesTradeHistoryAdapter.parse({ text: invalid })
    expect(result.records).toHaveLength(1)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'SBI_TRADE_VALUE_INVALID', row: 2 }))
  })
})
