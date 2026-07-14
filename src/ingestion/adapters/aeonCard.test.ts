import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { aeonCardAdapter, detectImportAdapter } from '../index'

const fixture = readFileSync('src/ingestion/fixtures/aeon-card-statement.screen-derived.synthetic.csv', 'utf8')

describe('AEON Card finalized-statement adapter', () => {
  it('detects content without relying on filename and preserves refunds, total, and physical lineage', () => {
    expect(detectImportAdapter({ text: fixture, filename: 'unrelated.csv' })?.adapter.id).toBe('aeon-card-finalized-statement-v1')
    const parsed = aeonCardAdapter.parse({ text: fixture, filename: 'not-aeon.csv' })
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(parsed.metadata).toMatchObject({ headerRow: 4, totalRow: 8, detailCount: 3, statementTotalSource: 'EXPLICIT_TOTAL', schemaBasis: 'SCREEN_DERIVED_SYNTHETIC' })
    expect(parsed.records[0]).toMatchObject({
      issuer: 'AEON_CARD', holderName: '架空 太郎', maskedCardNumber: '4987-****-****-1234',
      productName: 'イオンカード', statementMonth: '2026年7月ご請求分', statementTotal: 5050,
    })
    expect(parsed.records[0].transactions[0]).toMatchObject({ merchant: '架空ストア, 東京', billingAmount: 2400, isRefund: false })
    expect(parsed.records[0].transactions[2]).toMatchObject({ billingAmount: -500, isRefund: true })
    expect(parsed.records[0].transactions.map((transaction) => transaction.lineage.sourceRow)).toEqual([5, 6, 7])
    expect(parsed.records[0].transactions[0].rawExtra).toMatchObject({ 'ご利用金額(円)': '2400', 支払区分: '1回払い', 備考: '日用品' })
  })

  it('requires AEON content and exact named fields, never filename or another card vocabulary', () => {
    const withoutMarker = fixture.replace('イオンカードご利用明細', 'カードご利用明細')
    const generic = 'ご利用日,ご利用先,ご利用金額(円),支払区分,今回ご請求額(円)\n2026/06/01,架空店,100,一括,100\nお支払い合計,,,,100'
    const jcb = 'JCBカードご利用代金明細\nご利用日,ご利用先など,お支払い金額(円)\n2026/06/01,架空店,100\n,お支払い合計,100'
    const rakuten = '利用日,利用店名・商品名,利用者,支払方法,利用金額,7月支払金額\n2026/06/01,架空店,本人,一括,100,100'
    expect(aeonCardAdapter.detect({ text: withoutMarker, filename: 'aeon.csv' }).score).toBe(0)
    expect(aeonCardAdapter.detect({ text: generic, filename: 'aeon.csv' }).score).toBe(0)
    expect(aeonCardAdapter.detect({ text: jcb, filename: 'aeon.csv' }).score).toBe(0)
    expect(aeonCardAdapter.detect({ text: rakuten, filename: 'aeon.csv' }).score).toBe(0)
    expect(aeonCardAdapter.parse({ text: generic }).issues).toContainEqual(expect.objectContaining({ code: 'AEON_PROVIDER_MARKER_MISSING', severity: 'error' }))
  })

  it('fails closed on revolving, installment, bonus, and partially billed rows', () => {
    for (const detail of [
      '2026/06/01,架空購入,12000,リボ払い,4000,本人,',
      '2026/06/01,架空購入,12000,3回払い,4000,本人,',
      '2026/06/01,架空購入,12000,ボーナス一括,12000,本人,',
      '2026/06/01,架空購入,12000,一括,4000,本人,',
    ]) {
      const text = fixture.replace(/2026\/06\/03[^\n]+/, detail).replace('5050', '6650')
      const parsed = aeonCardAdapter.parse({ text })
      expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'AEON_DEFERRED_PAYMENT_UNSUPPORTED', severity: 'error', row: 5 }))
      expect(parsed.records[0].transactions.some((transaction) => transaction.merchant === '架空購入')).toBe(false)
    }
  })

  it('requires one valid explicit total and blocks mismatch, malformed detail, and ambiguous refund signs', () => {
    const mismatch = aeonCardAdapter.parse({ text: fixture.replace('5050', '9999') })
    expect(mismatch.issues).toContainEqual(expect.objectContaining({ code: 'AEON_TOTAL_MISMATCH', severity: 'error' }))

    const withoutTotal = fixture.split('\n').filter((line) => !line.includes('お支払い合計')).join('\n')
    expect(aeonCardAdapter.detect({ text: withoutTotal }).score).toBe(0)
    expect(aeonCardAdapter.parse({ text: withoutTotal }).issues).toContainEqual(expect.objectContaining({ code: 'AEON_TOTAL_MISSING', severity: 'error' }))

    const invalid = [
      'イオンカードご利用明細,2026年7月ご請求分',
      'ご利用日,ご利用先,ご利用金額(円),支払区分,今回ご請求額(円),カード利用者,備考',
      '2026/02/30,架空店,100,一括,100,本人,',
      '2026/06/01,,100,一括,100,本人,',
      '2026/06/02,架空返品,100,一括,100,本人,返品',
      '2026/06/03,架空店,invalid,一括,100,本人,',
      'お支払い合計,,,,400,,',
    ].join('\n')
    const parsed = aeonCardAdapter.parse({ text: invalid })
    expect(parsed.records[0].transactions).toEqual([])
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'AEON_DATE_INVALID', row: 3 }),
      expect.objectContaining({ code: 'AEON_MERCHANT_MISSING', row: 4 }),
      expect.objectContaining({ code: 'AEON_REFUND_SIGN_AMBIGUOUS', row: 5 }),
      expect.objectContaining({ code: 'AEON_AMOUNT_INVALID', row: 6 }),
    ]))
  })

  it('preserves quoted-newline provenance and rejects unsafe card metadata or multiple sections', () => {
    const multiline = fixture.replace('"架空ストア, 東京"', '"架空\nストア, 東京"')
    const parsed = aeonCardAdapter.parse({ text: multiline })
    expect(parsed.records[0].transactions[0]).toMatchObject({ merchant: '架空 ストア, 東京', lineage: { sourceRow: 5, sourceRowEnd: 6 } })

    const unsafe = aeonCardAdapter.parse({ text: fixture.replace('4987-****-****-1234', '4987123412341234') })
    expect(unsafe.issues).toContainEqual(expect.objectContaining({ code: 'AEON_CARD_NUMBER_UNSAFE', severity: 'error' }))

    const multiple = fixture.replace('カード番号,4987-****-****-1234', 'イオンカードご利用明細,別カード\nカード番号,4987-****-****-1234')
    expect(aeonCardAdapter.parse({ text: multiple }).issues).toContainEqual(expect.objectContaining({ code: 'AEON_MULTIPLE_SECTIONS_UNSUPPORTED', severity: 'error' }))
  })
})
