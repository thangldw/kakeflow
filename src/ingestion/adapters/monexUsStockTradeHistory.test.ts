import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectImportAdapter, monexUsStockTradeHistoryAdapter } from '../index'

const sample = readFileSync('src/ingestion/fixtures/monex-us-stock-history.synthetic.csv', 'utf8')

describe('Monex U.S.-stock trade-history adapter', () => {
  it('wins filename-independent detection only for the complete screen-derived 16-field family', () => {
    expect(detectImportAdapter({ text: sample, filename: 'unrelated.csv' })?.adapter.id).toBe('monex-us-stock-trade-history-v1')
    const missingField = sample.replace(',為替レート', '')
    const changedField = sample.replace('約定値段[ドル]', '約定単価[ドル]')
    expect(monexUsStockTradeHistoryAdapter.detect({ text: missingField }).score).toBe(0)
    expect(monexUsStockTradeHistoryAdapter.detect({ text: changedField }).score).toBe(0)
    expect(detectImportAdapter({ text: missingField })?.adapter.id).not.toBe('monex-us-stock-trade-history-v1')
    expect(detectImportAdapter({ text: changedField })?.adapter.id).not.toBe('monex-us-stock-trade-history-v1')

    const orderUpload = [
      'Ticker,AccountType,ExpireDay,Side,Currency,Qty,Price,Remark',
      'VOO,4,20260220,2,USD,10,620.5,',
    ].join('\n')
    expect(monexUsStockTradeHistoryAdapter.detect({ text: orderUpload, filename: 'monex_us_orders.csv' }).score).toBe(0)
    expect(detectImportAdapter({ text: orderUpload, filename: 'monex_us_orders.csv' })).toBeNull()
  })

  it('uses source USD values, preserves both dates and raw physical-row lineage, and balances spot trades', () => {
    const result = monexUsStockTradeHistoryAdapter.parse({ text: sample, accountHint: 'マネックス証券' })
    expect(result.metadata).toMatchObject({ provider: 'MONEX_SECURITIES', marketScope: 'US', currencyScope: 'USD_SETTLEMENT_ONLY', sourceContract: 'SCREEN_DERIVED_POST_RENEWAL_2026_02', validationBasis: 'SYNTHETIC_FIXTURE', headerRow: 1 })
    expect(result.issues).toEqual([])
    expect(result.records).toEqual([
      expect.objectContaining({ eventType: 'BUY', tradeDate: '2026-02-16', settlementDate: '2026-02-19', instrumentCode: 'AAPL', instrumentName: 'Apple Inc.', accountType: '特定', currency: 'USD', quantity: 10, unitPrice: 200, grossAmount: 2000, feeAmount: 5, taxAmount: 0, settlementAmount: 2005, reconciliationStatus: 'BALANCED' }),
      expect.objectContaining({ eventType: 'SELL', tradeDate: '2026-02-17', settlementDate: '2026-02-20', instrumentCode: 'MSFT', instrumentName: 'Microsoft Corp.', accountType: 'NISA', currency: 'USD', quantity: 2, unitPrice: 500, grossAmount: 1000, feeAmount: 5, taxAmount: 0, settlementAmount: 995, reconciliationStatus: 'BALANCED' }),
    ])
    expect(result.records[0].lineage).toEqual(expect.objectContaining({ sourceRow: 2, sourceRowEnd: 2, rawFields: expect.arrayContaining(['AAPL Apple Inc.', '300750', '150.00']) }))
    expect(result.records[1].lineage.sourceRow).toBe(3)
    result.records.forEach((record) => expect(record.legs.reduce((sum, leg) => sum + leg.signedAmount, 0)).toBeCloseTo(0, 8))
  })

  it('accepts both explicit USD labels and every documented account value without recomputing source gross', () => {
    const result = monexUsStockTradeHistoryAdapter.parse({
      text: sample.replace(/米ドル/g, 'USD').replace(',特定,', ',一般,').replace(',10,200.00,2000.00,', ',10,201.00,2000.00,'),
    })
    expect(result.issues).toEqual([])
    expect(result.records[0]).toMatchObject({ accountType: '一般', currency: 'USD', unitPrice: 201, grossAmount: 2000, settlementAmount: 2005, reconciliationStatus: 'BALANCED' })
    expect(result.records[1]).toMatchObject({ accountType: 'NISA', currency: 'USD' })
  })

  it.each([
    ['円', 'MONEX_US_JPY_SETTLEMENT_UNSUPPORTED'],
    ['JPY', 'MONEX_US_JPY_SETTLEMENT_UNSUPPORTED'],
    ['EUR', 'MONEX_US_CURRENCY_UNSUPPORTED'],
  ])('fails closed for unsupported transaction currency %s', (currency, code) => {
    const result = monexUsStockTradeHistoryAdapter.parse({ text: sample.replace(/米ドル/g, currency) })
    expect(result.records).toHaveLength(0)
    expect(result.issues.filter((issue) => issue.code === code)).toHaveLength(2)
    expect(result.issues.every((issue) => issue.severity === 'error')).toBe(true)
  })

  it('fails closed for margin/nonspot activity, unknown sides and account values', () => {
    const variants = [
      [sample.replace(/現物/g, '信用新規'), 'MONEX_US_MARGIN_UNSUPPORTED'],
      [sample.replace(/現物/g, '配当金'), 'MONEX_US_EVENT_UNSUPPORTED'],
      [sample.replace(',買,', ',募集,'), 'MONEX_US_SIDE_UNSUPPORTED'],
      [sample.replace(/,特定,/, ',法人口座,'), 'MONEX_US_ACCOUNT_UNSUPPORTED'],
    ] as const
    for (const [text, code] of variants) {
      const result = monexUsStockTradeHistoryAdapter.parse({ text })
      expect(result.issues).toContainEqual(expect.objectContaining({ code, severity: 'error', row: 2 }))
    }
  })

  it('rejects pre-renewal, malformed and sparse rows instead of guessing', () => {
    const preRenewal = monexUsStockTradeHistoryAdapter.parse({ text: sample.replace('2026/02/16', '2026/02/15') })
    expect(preRenewal.records).toHaveLength(1)
    expect(preRenewal.issues).toContainEqual(expect.objectContaining({ code: 'MONEX_US_ROW_INVALID', severity: 'error', row: 2 }))

    const malformed = monexUsStockTradeHistoryAdapter.parse({ text: sample.replace('AAPL Apple Inc.', 'Apple Inc.').replace(',10,200.00,', ',0,200.00,') })
    expect(malformed.records).toHaveLength(1)
    expect(malformed.issues).toContainEqual(expect.objectContaining({ code: 'MONEX_US_ROW_INVALID', row: 2 }))

    const sparse = monexUsStockTradeHistoryAdapter.parse({ text: `${sample.split('\n')[0]}\nAAPL Apple Inc.,2026/02/19` })
    expect(sparse.records).toHaveLength(0)
    expect(sparse.issues).toContainEqual(expect.objectContaining({ code: 'MONEX_US_ROW_SPARSE', severity: 'error', row: 2 }))
  })

  it('preserves a source settlement mismatch as a warning and balanced adjustment', () => {
    const result = monexUsStockTradeHistoryAdapter.parse({ text: sample.replace('2005.00,300750', '2004.00,300750') })
    expect(result.records[0]).toMatchObject({ grossAmount: 2000, feeAmount: 5, settlementAmount: 2004, reconciliationStatus: 'ADJUSTED', reconciliationDifference: 1 })
    expect(result.records[0].legs).toContainEqual(expect.objectContaining({ kind: 'ADJUSTMENT', signedAmount: -1 }))
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MONEX_US_SETTLEMENT_MISMATCH', severity: 'warning', row: 2 }))
  })
})
