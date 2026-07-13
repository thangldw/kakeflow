import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectImportAdapter, jcbMyJcbAdapter } from '../index'

const fixture = readFileSync('src/ingestion/fixtures/jcb-myjcb-statement.synthetic.csv', 'utf8')

describe('JCB MyJCB statement adapter', () => {
  it('detects the narrow JCB vocabulary and parses reordered columns, refunds, FX, and an explicit total', () => {
    expect(detectImportAdapter({ text: fixture, filename: 'myjcb_202607.csv' })?.adapter.id).toBe('jcb-myjcb-statement-v1')
    const parsed = jcbMyJcbAdapter.parse({ text: fixture, filename: 'myjcb_202607.csv' })
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(parsed.metadata).toMatchObject({ headerRow: 5, detailCount: 3, statementTotalSource: 'EXPLICIT_TOTAL' })
    expect(parsed.records[0]).toMatchObject({
      issuer: 'JCB', holderName: '架空 太郎', maskedCardNumber: '3540-****-****-1234', statementTotal: 5050,
    })
    expect(parsed.records[0].transactions[0]).toMatchObject({ usageDate: '2026-06-03', merchant: '架空ストア, 東京', billingAmount: 2400, isRefund: false })
    expect(parsed.records[0].transactions[1]).toMatchObject({ originalAmount: 20, originalCurrency: 'USD', exchangeRate: 157.5, billingAmount: 3150 })
    expect(parsed.records[0].transactions[2]).toMatchObject({ billingAmount: -500, isRefund: true })
    expect(parsed.records[0].transactions.map((transaction) => transaction.lineage.sourceRow)).toEqual([6, 7, 8])
  })

  it('uses the detail sum when no explicit total exists and warns without turning a total row into a transaction', () => {
    const mismatched = fixture.replace('お支払い合計,5050', 'お支払い合計,9999')
    const parsed = jcbMyJcbAdapter.parse({ text: mismatched })
    expect(parsed.records[0].transactions).toHaveLength(3)
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'JCB_TOTAL_MISMATCH', severity: 'error' }))

    const withoutTotal = fixture.split('\n').filter((line) => !line.includes('お支払い合計')).join('\n')
    const derived = jcbMyJcbAdapter.parse({ text: withoutTotal })
    expect(derived.records[0].statementTotal).toBe(5050)
    expect(derived.metadata).toMatchObject({ statementTotalSource: 'DETAIL_SUM' })
  })

  it('rejects unknown layouts and does not claim Rakuten, Amazon, or generic transaction CSVs', () => {
    const rakuten = '利用日,利用店名・商品名,利用者,支払方法,利用金額,7月支払金額\n2026/06/01,店,本人,一括,100,100'
    const amazon = 'Taro,****1234,Amazon Mastercard\n2026/06/01,SHOP,本人,一括,100'
    const generic = '日付,摘要,支払い金額,預かり金額,差引残高\n2026/06/01,店,100,,900'
    const sameHeadersWithoutProvider = 'ご利用日,ご利用先など,お支払い金額(円)\n2026/06/01,別カード,100'
    expect(jcbMyJcbAdapter.detect({ text: rakuten }).score).toBe(0)
    expect(jcbMyJcbAdapter.detect({ text: amazon }).score).toBe(0)
    expect(jcbMyJcbAdapter.detect({ text: generic }).score).toBe(0)
    expect(jcbMyJcbAdapter.detect({ text: sameHeadersWithoutProvider }).score).toBe(0)
    expect(jcbMyJcbAdapter.parse({ text: generic }).issues).toContainEqual(expect.objectContaining({ code: 'JCB_HEADER_MISSING', severity: 'error' }))
  })

  it('rejects a detail row whose billed amount is not a non-zero integer', () => {
    const text = 'ご利用日,ご利用先など,お支払い金額(円)\n2026/06/01,架空店,invalid'
    const parsed = jcbMyJcbAdapter.parse({ text })
    expect(parsed.records[0].transactions).toEqual([])
    expect(parsed.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['JCB_AMOUNT_INVALID', 'JCB_DETAILS_MISSING']))
  })

  it('blocks impossible dates and positive refund-like rows instead of dropping or re-signing them', () => {
    const text = [
      'JCBカードご利用代金明細',
      'ご利用日,ご利用先など,お支払い金額(円)',
      '2026/02/30,,1200',
      '2026/02/20,架空返品,500',
      '2026/02/21,,300',
    ].join('\n')
    const parsed = jcbMyJcbAdapter.parse({ text })
    expect(parsed.records[0].transactions).toEqual([])
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'JCB_DATE_INVALID', severity: 'error', row: 3 }),
      expect.objectContaining({ code: 'JCB_REFUND_SIGN_AMBIGUOUS', severity: 'error', row: 4 }),
      expect.objectContaining({ code: 'JCB_MERCHANT_MISSING', severity: 'error', row: 5 }),
    ]))
  })

  it('never substitutes a new usage amount for a blank billed amount', () => {
    const text = [
      'JCBカードご利用代金明細',
      'ご利用日,ご利用先など,お支払い金額(円),ご利用金額(円)',
      '2026/06/01,架空分割購入,,12000',
    ].join('\n')
    const parsed = jcbMyJcbAdapter.parse({ text })
    expect(parsed.records[0].transactions).toEqual([])
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'JCB_AMOUNT_INVALID', severity: 'error', row: 3, column: 'お支払い金額(円)' }))
  })
})
