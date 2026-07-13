import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectImportAdapter, rakutenSecuritiesDomesticTradeHistoryAdapter } from '../index'

const sample = readFileSync('src/ingestion/fixtures/rakuten-securities-domestic-trades.csv', 'utf8')

describe('Rakuten Securities domestic trade-history adapter', () => {
  it('wins detection only for the complete official field family', () => {
    expect(detectImportAdapter({ text: sample, filename: 'unrelated.csv' })?.adapter.id).toBe('rakuten-securities-domestic-trade-history-v1')
    expect(rakutenSecuritiesDomesticTradeHistoryAdapter.detect({ text: sample.replace(',税区分,受渡金額', ',税区分') }).score).toBe(0)
  })

  it('normalizes spot and odd-lot trades with source costs and combined security fields', () => {
    const result = rakutenSecuritiesDomesticTradeHistoryAdapter.parse({ text: sample, accountHint: '楽天証券' })
    expect(result.metadata).toMatchObject({ provider: 'RAKUTEN_SECURITIES', marketScope: 'DOMESTIC', headerRow: 1 })
    expect(result.issues).toEqual([])
    expect(result.records).toEqual([
      expect.objectContaining({ eventType: 'BUY', instrumentCode: '7203', instrumentName: 'トヨタ自動車', market: '東証', accountType: '特定', currency: 'JPY', quantity: 100, unitPrice: 2500, grossAmount: 250000, feeAmount: 100, taxAmount: 10, settlementAmount: 250110, reconciliationStatus: 'BALANCED' }),
      expect.objectContaining({ eventType: 'SELL', instrumentCode: '6758', instrumentName: 'ソニーグループ', market: 'JNX', accountType: 'NISA成長投資枠', currency: 'JPY', quantity: 20, unitPrice: 3000, grossAmount: 60000, feeAmount: 120, taxAmount: 10, settlementAmount: 59870, reconciliationStatus: 'BALANCED' }),
    ])
    result.records.forEach((record) => expect(record.legs.reduce((sum, leg) => sum + leg.signedAmount, 0)).toBe(0))
  })

  it('rejects margin and never guesses an ambiguous side', () => {
    const unsupported = sample
      .replace(',現物,買付,', ',信用新規,買付,')
      .replace(',現物（単元未満）,売付,', ',現物（単元未満）,募集,')
    const result = rakutenSecuritiesDomesticTradeHistoryAdapter.parse({ text: unsupported })
    expect(result.records).toHaveLength(0)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'RAKUTEN_SECURITIES_MARGIN_UNSUPPORTED', row: 2 }),
      expect.objectContaining({ code: 'RAKUTEN_SECURITIES_TRADE_UNSUPPORTED', row: 3 }),
    ]))
  })

  it('preserves inconsistent settlement as an auditable balanced adjustment', () => {
    const result = rakutenSecuritiesDomesticTradeHistoryAdapter.parse({ text: sample.replace('250110', '250100') })
    expect(result.records[0]).toMatchObject({ reconciliationStatus: 'ADJUSTED', reconciliationDifference: 10 })
    expect(result.records[0].legs).toContainEqual(expect.objectContaining({ kind: 'ADJUSTMENT', signedAmount: -10 }))
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'RAKUTEN_SECURITIES_SETTLEMENT_MISMATCH', row: 2 }))
  })

  it('skips malformed rows while retaining physical-row provenance', () => {
    const result = rakutenSecuritiesDomesticTradeHistoryAdapter.parse({ text: sample.replace('2026/07/01', 'invalid').replace(',100,2500,', ',0,2500,') })
    expect(result.records).toHaveLength(1)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'RAKUTEN_SECURITIES_VALUE_INVALID', row: 2 }))
  })
})
