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
    expect(result.issues).toEqual([])
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

  it('recognizes common Japanese aliases and zero-value split and merger actions', () => {
    const corporateActions = [
      '約定年月日,取引内容,銘柄,商品コード,受渡金額,分割比率,交換比率,交換先コード,交換先銘柄名,通貨名',
      '2026/08/01,株式分割,旧会社,1111,,1:2,,,,JPY',
      '2026/09/01,株式交換（合併）,旧会社,1111,,,1:0.5,2222,新会社,JPY',
    ].join('\n')
    const result = japaneseBrokerageTransactionsAdapter.parse({ text: corporateActions, filename: '楽天証券_取引履歴.csv' })
    expect(result.records).toHaveLength(2)
    expect(result.records[0]).toMatchObject({ eventType: 'SPLIT', grossAmount: 0, settlementAmount: 0, corporateActionRatio: 2 })
    expect(result.records[1]).toMatchObject({ eventType: 'MERGER', corporateActionRatio: 0.5, targetInstrumentCode: '2222', targetInstrumentName: '新会社' })
    expect(result.records[0].legs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'SECURITY', signedAmount: 0, signedQuantity: -1 }),
      expect.objectContaining({ kind: 'SECURITY', signedAmount: 0, signedQuantity: 2 }),
    ]))
    expect(result.issues).toHaveLength(0)
  })

  it('requires and preserves explicit complex corporate-action allocation inputs', () => {
    const actions = [
      '約定日,取引,銘柄コード,銘柄名,割当比率,割当銘柄コード,割当銘柄名,取得価額配分比率,払込金額,端数株数,端数株代金,通貨',
      '2026/08/01,スピンオフ,1111,Parent,1:0.25,2222,Child,20%,,,,JPY',
      '2026/09/01,新株予約権行使,1111,Parent,1:0.1,1111,Parent,,5000,,,JPY',
      '2026/10/01,端数株処分代金,1111,Parent,,,,,,0.5,900,JPY',
    ].join('\n')
    const result = japaneseBrokerageTransactionsAdapter.parse({ text: actions })
    expect(result.issues).toEqual([])
    expect(result.records).toEqual([
      expect.objectContaining({ eventType: 'SPIN_OFF', corporateActionRatio: 0.25, costBasisAllocationRatio: 0.2, targetInstrumentCode: '2222' }),
      expect.objectContaining({ eventType: 'RIGHTS_SUBSCRIPTION', corporateActionRatio: 0.1, subscriptionAmount: 5000, grossAmount: 5000 }),
      expect.objectContaining({ eventType: 'CASH_IN_LIEU', cashInLieuQuantity: 0.5, cashInLieuAmount: 900, grossAmount: 900 }),
    ])
    result.records.forEach((record) => expect(record.legs.reduce((sum, item) => sum + item.signedAmount, 0)).toBeCloseTo(0, 8))
  })

  it('surfaces complex actions with missing allocation inputs instead of guessing', () => {
    const missing = [
      '約定日,取引,銘柄コード,銘柄名,割当比率,割当銘柄コード,割当銘柄名,取得価額配分比率,払込金額,端数株数,端数株代金,通貨',
      '2026/08/01,スピンオフ,1111,Parent,1:0.25,2222,Child,,,,,JPY',
      '2026/09/01,新株予約権行使,1111,Parent,1:0.1,1111,Parent,,,,,JPY',
      '2026/10/01,端数株処分代金,1111,Parent,,,,,,,,JPY',
    ].join('\n')
    const result = japaneseBrokerageTransactionsAdapter.parse({ text: missing })
    expect(result.records).toHaveLength(0)
    expect(result.issues.filter((issue) => issue.code === 'BROKERAGE_ACTION_INPUT_MISSING')).toHaveLength(3)
  })

  it('parses the documented Monex US-stock CSV column variants', () => {
    const monex = [
      'ティッカー＋銘柄名（または通貨名）,国内約定日,取引種別,売買,口座区分,取引通貨,約定数量[株],約定値段[ドル],約定金額[ドル],受渡金額[ドル],手数料(税込)[ドル]',
      'AAPL Apple Inc.,2026/07/10,現物,買,特定,USD,10,200,2000,2005,5',
      'MSFT Microsoft Corp.,2026/07/11,現物,売,NISA,USD,2,500,1000,995,5',
    ].join('\n')

    const result = japaneseBrokerageTransactionsAdapter.parse({ text: monex, filename: 'monex_us_tradehistory.csv', accountHint: 'マネックス証券' })
    expect(result.issues).toHaveLength(0)
    expect(result.records).toEqual([
      expect.objectContaining({ eventType: 'BUY', instrumentCode: 'AAPL', instrumentName: 'Apple Inc.', currency: 'USD', quantity: 10, unitPrice: 200, grossAmount: 2000, feeAmount: 5, settlementAmount: 2005 }),
      expect.objectContaining({ eventType: 'SELL', instrumentCode: 'MSFT', instrumentName: 'Microsoft Corp.', currency: 'USD', quantity: 2, unitPrice: 500, grossAmount: 1000, feeAmount: 5, settlementAmount: 995 }),
    ])
    result.records.forEach((record) => expect(record.legs.reduce((sum, item) => sum + item.signedAmount, 0)).toBeCloseTo(0, 8))
  })
})
