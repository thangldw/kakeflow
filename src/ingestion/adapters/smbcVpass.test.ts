import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { amazonMastercardAdapter, detectImportAdapter, smbcVpassAdapter } from '../index'

const fixture = readFileSync('src/ingestion/fixtures/smbc-vpass-statement.synthetic.csv', 'utf8')

describe('SMBC Vpass statement adapter', () => {
  it('detects and parses the strict headerless layout with refund, FX, total, and physical lineage', () => {
    expect(detectImportAdapter({ text: fixture, filename: 'unrelated.csv' })?.adapter.id).toBe('smbc-vpass-statement-v1')
    const parsed = smbcVpassAdapter.parse({ text: fixture })
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(parsed.metadata).toMatchObject({ metadataRow: 1, detailCount: 3, statementTotalSource: 'EXPLICIT_TOTAL' })
    expect(parsed.records[0]).toMatchObject({
      issuer: 'SMBC_CARD', holderName: '架空 太郎', maskedCardNumber: '4980-****-****-1234',
      productName: '三井住友カード(NL)', statementTotal: 5050,
    })
    expect(parsed.records[0].transactions[0]).toMatchObject({ merchant: '架空ストア, 東京', billingAmount: 2400, isRefund: false })
    expect(parsed.records[0].transactions[1]).toMatchObject({ originalAmount: 20, originalCurrency: 'USD', exchangeRate: 157.5 })
    expect(parsed.records[0].transactions[2]).toMatchObject({ billingAmount: -500, isRefund: true })
    expect(parsed.records[0].transactions.map((transaction) => transaction.lineage.sourceRow)).toEqual([2, 3, 4])
  })

  it('requires a content marker and never claims Amazon, JCB, Rakuten, or generic files', () => {
    const withoutProvider = fixture.replace('三井住友カード(NL)', '別カード')
    const amazon = fixture.replace('三井住友カード(NL)', 'Amazon Mastercard')
    const jcb = 'JCBカード\nご利用日,ご利用先など,お支払い金額(円)\n2026/06/01,店,100'
    const rakuten = '利用日,利用店名・商品名,利用者,支払方法,利用金額,7月支払金額\n2026/06/01,店,本人,一括,100,100'
    const generic = '日付,摘要,支払い金額,預かり金額,差引残高\n2026/06/01,店,100,,900'
    expect(smbcVpassAdapter.detect({ text: withoutProvider, filename: 'vpass.csv' }).score).toBe(0)
    expect(smbcVpassAdapter.detect({ text: amazon }).score).toBe(0)
    expect(smbcVpassAdapter.detect({ text: jcb }).score).toBe(0)
    expect(smbcVpassAdapter.detect({ text: rakuten }).score).toBe(0)
    expect(smbcVpassAdapter.detect({ text: generic }).score).toBe(0)
    expect(amazonMastercardAdapter.detect({ text: amazon }).score).toBe(1)

    for (const invalidMetadata of [
      fixture.replace('三井住友カード(NL)', 'Vpassカード'),
      fixture.replace('架空 太郎 様', ''),
      fixture.replace('4980-****-****-1234', '4980123412341234'),
    ]) expect(smbcVpassAdapter.detect({ text: invalidMetadata }).score).toBe(0)

    const amazonMerchant = fixture.replace('FICTIONAL CLOUD', 'Amazon Mastercard annual fee')
    expect(detectImportAdapter({ text: amazonMerchant })?.adapter.id).toBe('smbc-vpass-statement-v1')

    const prefixed = `untrusted preamble\n${fixture}`
    expect(smbcVpassAdapter.detect({ text: prefixed }).score).toBe(0)
    expect(smbcVpassAdapter.parse({ text: prefixed }).issues).toContainEqual(expect.objectContaining({ code: 'VPASS_METADATA_MISSING', severity: 'error', row: 1 }))
  })

  it('blocks deferred, revolving, installment, and partially billed rows', () => {
    for (const replacement of [
      '12000,分割,3,4000',
      '12000,リボ,,4000',
      '12000,一括,,4000',
      '12000,2回払い,2,12000',
    ]) {
      const text = [
        '架空 太郎,****1234,SMBC CARD',
        `2026/06/01,架空購入,${replacement},,,,,`,
        'お支払い合計,,,,,4000,,,,,',
      ].join('\n')
      expect(smbcVpassAdapter.parse({ text }).issues).toContainEqual(expect.objectContaining({ code: 'VPASS_DEFERRED_PAYMENT_UNSUPPORTED', severity: 'error', row: 2 }))
    }
  })

  it('blocks invalid dates, amounts, merchants, and positive refund-like rows', () => {
    const text = [
      '架空 太郎,****1234,SMBC CARD',
      '2026/02/30,架空店,100,一括,,100,,,,,',
      '2026/06/01,,100,一括,,100,,,,,',
      '2026/06/02,架空店,invalid,一括,,100,,,,,',
      '2026/06/03,架空店 返金,100,一括,,100,,,,,返金',
      'お支払い合計,,,,,300,,,,,',
    ].join('\n')
    const parsed = smbcVpassAdapter.parse({ text })
    expect(parsed.records[0].transactions).toEqual([])
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'VPASS_DATE_INVALID', row: 2 }),
      expect.objectContaining({ code: 'VPASS_MERCHANT_MISSING', row: 3 }),
      expect.objectContaining({ code: 'VPASS_AMOUNT_INVALID', row: 4 }),
      expect.objectContaining({ code: 'VPASS_REFUND_SIGN_AMBIGUOUS', row: 5 }),
    ]))
  })

  it('requires an exact explicit final total and never imports that row', () => {
    const mismatch = smbcVpassAdapter.parse({ text: fixture.replace('5050', '9999') })
    expect(mismatch.records[0].transactions).toHaveLength(3)
    expect(mismatch.issues).toContainEqual(expect.objectContaining({ code: 'VPASS_TOTAL_MISMATCH', severity: 'error' }))

    const withoutTotal = fixture.split('\n').filter((line) => !line.includes('お支払い合計')).join('\n')
    expect(smbcVpassAdapter.detect({ text: withoutTotal }).score).toBe(0)
    expect(smbcVpassAdapter.parse({ text: withoutTotal }).issues).toContainEqual(expect.objectContaining({ code: 'VPASS_TOTAL_MISSING', severity: 'error' }))

    const amountOnly = fixture.replace('お支払い合計,,,,,5050', ',,,,,5050')
    expect(smbcVpassAdapter.parse({ text: amountOnly }).issues.filter((issue) => issue.severity === 'error')).toEqual([])

    const zeroTotal = fixture.replace('お支払い合計,,,,,5050', 'お支払い合計,,,,,0')
    expect(smbcVpassAdapter.detect({ text: zeroTotal }).score).toBe(0)
    expect(smbcVpassAdapter.parse({ text: zeroTotal }).issues).toContainEqual(expect.objectContaining({ code: 'VPASS_TOTAL_INVALID', severity: 'error' }))
  })

  it('preserves quoted-newline lineage and every unmodeled source value', () => {
    const text = [
      '架空 太郎,****1234,三井住友カード ゴールド',
      '2026/06/01,"架空\nストア",100,1,1,100,0,USD,150,2026/06/02,"備考\n続き"',
      ',,,,,100,,,,,',
    ].join('\n')
    const parsed = smbcVpassAdapter.parse({ text })
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(parsed.records[0].transactions[0]).toMatchObject({ merchant: '架空 ストア', lineage: { sourceRow: 2, sourceRowEnd: 4 } })
    expect(parsed.records[0].transactions[0].rawExtra).toMatchObject({ 支払区分: '1', 分割回数: '1', 換算日: '2026/06/02', 備考: '備考\n続き' })
  })

  it('rejects multiple card sections and malformed detail widths', () => {
    const extraSection = fixture.replace('お支払い合計', '別人,****9999,SMBC CARD\nお支払い合計')
    const parsed = smbcVpassAdapter.parse({ text: extraSection })
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'VPASS_MULTIPLE_SECTIONS_UNSUPPORTED', severity: 'error' }))

    const malformed = fixture.replace('2026/06/03,"架空ストア, 東京",2400,一括,,2400,,,,,日用品', '2026/06/03,架空店,2400,一括,,2400')
    expect(smbcVpassAdapter.parse({ text: malformed }).issues).toContainEqual(expect.objectContaining({ code: 'VPASS_COLUMN_COUNT_INVALID', severity: 'error', row: 2 }))
  })
})
