import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectImportAdapter, japaneseBrokerageTransactionsAdapter } from '../index'

const sample = readFileSync('src/ingestion/fixtures/japanese-brokerage-transactions.csv', 'utf8')

describe('Japanese brokerage transaction adapter', () => {
  it('detects a brokerage activity export', () => {
    const result = detectImportAdapter({ text: sample, filename: '取引履歴_202607.csv' })
    expect(result?.adapter.id).toBe('japanese-brokerage-transactions-v1')
    expect(result?.score).toBeGreaterThanOrEqual(0.8)
  })

  it('normalizes buy, sell, dividend, fee, tax and cash transfers into balanced legs', () => {
    const result = japaneseBrokerageTransactionsAdapter.parse({ text: sample, accountHint: 'SBI証券' })
    expect(result.issues).toHaveLength(0)
    expect(result.metadata).toMatchObject({ ledgerKind: 'INVESTMENT', headerRow: 1 })
    expect(result.records.map((record) => record.eventType)).toEqual([
      'BUY', 'SELL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'TAX',
    ])
    for (const record of result.records) {
      expect(record.affectsHouseholdExpense).toBe(false)
      expect(record.reconciliationStatus).toBe('BALANCED')
      expect(record.legs.reduce((sum, leg) => sum + leg.signedAmount, 0)).toBeCloseTo(0, 8)
    }
    expect(result.records[0]).toMatchObject({
      accountHint: 'SBI証券', eventType: 'BUY', instrumentCode: '7203', quantity: 100,
      grossAmount: 250000, feeAmount: 550, settlementAmount: 250550,
    })
    expect(result.records[0].legs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'SECURITY', signedAmount: 250000, signedQuantity: 100 }),
      expect.objectContaining({ kind: 'CASH', signedAmount: -250550 }),
      expect.objectContaining({ kind: 'INVESTMENT_EXPENSE', signedAmount: 550 }),
    ]))
    expect(result.records[1].legs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'SECURITY', signedAmount: -60000, signedQuantity: -20 }),
      expect.objectContaining({ kind: 'CASH', signedAmount: 59480 }),
    ]))
    expect(result.records[2].legs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'INVESTMENT_INCOME', signedAmount: -15000 }),
      expect.objectContaining({ kind: 'INVESTMENT_TAX', signedAmount: 3000 }),
      expect.objectContaining({ kind: 'CASH', signedAmount: 12000 }),
    ]))
  })

  it('preserves an inconsistent source settlement with an auditable adjustment', () => {
    const inconsistent = [
      '約定日,受渡日,取引,銘柄コード,銘柄名,数量,単価,約定金額,手数料,税金,受渡金額,通貨',
      '2026年7月1日,2026年7月3日,買付,6758,ソニー,10,10000,100000,100,0,100050,JPY',
    ].join('\n')
    const result = japaneseBrokerageTransactionsAdapter.parse({ text: inconsistent })
    expect(result.records[0]).toMatchObject({ reconciliationStatus: 'ADJUSTED', reconciliationDifference: 50 })
    expect(result.records[0].legs).toContainEqual(expect.objectContaining({ kind: 'ADJUSTMENT', signedAmount: -50 }))
    expect(result.records[0].legs.reduce((sum, leg) => sum + leg.signedAmount, 0)).toBe(0)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'BROKERAGE_SETTLEMENT_MISMATCH', row: 2 }))
  })

  it('skips unknown and amount-less rows with provenance warnings', () => {
    const invalid = [
      '取引日,取引種類,商品名,金額',
      'invalid,その他調整,不明,100',
      '2026/07/01,買付,No amount,',
    ].join('\n')
    const result = japaneseBrokerageTransactionsAdapter.parse({ text: invalid })
    expect(result.records).toHaveLength(0)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'BROKERAGE_EVENT_TYPE_UNKNOWN', row: 2 }),
      expect.objectContaining({ code: 'BROKERAGE_AMOUNT_MISSING', row: 3 }),
    ]))
  })
})
