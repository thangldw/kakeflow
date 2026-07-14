import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectImportAdapter, payPayCardAdapter } from '../index'

const fixture = readFileSync('src/ingestion/fixtures/paypay-card-statement.community-derived.synthetic.csv', 'utf8')
const header = fixture.split('\n')[0]

describe('PayPay Card finalized-statement adapter', () => {
  it('detects the exact content contract without a filename and preserves due date, refunds, and lineage', () => {
    expect(detectImportAdapter({ text: fixture, filename: 'unrelated.csv' })?.adapter.id).toBe('paypay-card-finalized-statement-v1')
    const parsed = payPayCardAdapter.parse({ text: fixture, filename: 'not-paypay.csv' })

    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(parsed.metadata).toEqual({
      headerRow: 1, detailCount: 3, statementTotalSource: 'CURRENT_PAYMENT_SUM', schemaBasis: 'COMMUNITY_DERIVED_SYNTHETIC',
    })
    expect(parsed.records[0]).toMatchObject({
      issuer: 'PAYPAY_CARD', productName: 'PayPayカード', statementMonth: '2026-07',
      paymentDueOn: '2026-07-27', statementTotal: 5550,
    })
    expect(parsed.records[0].transactions).toHaveLength(3)
    expect(parsed.records[0].transactions[0]).toMatchObject({
      merchant: '架空ストア, 東京', billingAmount: 2400, feeOrInterest: 0, isRefund: false,
      lineage: { sourceRow: 2, sourceRowEnd: 2 },
      rawExtra: { 支払区分: '1回', 当月支払金額: '2400', 当月お支払日: '2026/7/27' },
    })
    expect(parsed.records[0].transactions[2]).toMatchObject({ billingAmount: -500, isRefund: true })
  })

  it('requires the exact ordered eleven-column contract and does not collide with existing card or wallet formats', () => {
    const reordered = fixture.replace('"利用日/キャンセル日","利用店名・商品名"', '"利用店名・商品名","利用日/キャンセル日"')
    const extra = fixture.replace('"当月お支払日"', '"当月お支払日","備考"')
    const missing = fixture.replace(',"調整額"', '')
    for (const text of [reordered, extra, missing]) {
      expect(payPayCardAdapter.detect({ text, filename: 'paypay-card.csv' }).score).toBe(0)
      expect(payPayCardAdapter.parse({ text }).records).toEqual([])
      expect(payPayCardAdapter.parse({ text }).issues).toContainEqual(expect.objectContaining({ code: 'PAYPAY_CARD_HEADER_MISSING', severity: 'error' }))
    }

    const otherFormats = [
      'Date & Time,Amount Outgoing (Yen),Amount Incoming (Yen),Transaction Type,Payment Option,Transaction ID,Description\n2026/07/12 12:00,1200,,Payment,PayPay Balance,pay-1,STORE',
      '利用日,利用店名・商品名,利用者,支払方法,利用金額,7月支払金額\n2026/06/12,STORE,本人,一括,1200,1200',
      'JCBカードご利用代金明細\nご利用日,ご利用先など,お支払い金額(円),支払区分\n2026/06/12,STORE,1200,ショッピング',
      '架空 太郎 様,4980-****-****-1234,三井住友カード(NL)\n2026/06/01,STORE,1200,一括,,1200,,,,,\nお支払い合計,,,,,1200,,,,,',
      'イオンカードご利用明細,2026年7月ご請求分\nご利用日,ご利用先,ご利用金額(円),支払区分,今回ご請求額(円)\n2026/06/01,STORE,1200,一括,1200\nお支払い合計,,,,1200',
    ]
    for (const text of otherFormats) expect(payPayCardAdapter.detect({ text, filename: 'paypay-card.csv' }).score).toBe(0)
  })

  it('fails closed on deferred, fee-bearing, carried, partial, and adjusted rows', () => {
    const valid = '"2026/6/03","架空購入","本人*","1回","12000","0","12000","12000","0","0","2026/7/27"'
    const unsupported = [
      ['リボ', valid.replace('"1回"', '"リボ払い"')],
      ['分割', valid.replace('"1回"', '"3回払い"').replace('"12000","0","12000","12000"', '"12000","300","12300","4100"')],
      ['ボーナス', valid.replace('"1回"', '"ボーナス一括"')],
      ['手数料', valid.replace('"12000","0","12000","12000"', '"12000","300","12300","12300"')],
      ['一部請求', valid.replace('"12000","0","12000","12000"', '"12000","0","12000","4000"')],
      ['繰越', valid.replace('"0","0","2026/7/27"', '"8000","0","2026/7/27"').replace('"12000","0","12000","12000"', '"12000","0","12000","4000"')],
      ['調整', valid.replace('"0","0","2026/7/27"', '"0","-500","2026/7/27"')],
    ] as const

    for (const [name, row] of unsupported) {
      const parsed = payPayCardAdapter.parse({ text: `${header}\n${row}` })
      expect(parsed.records[0].transactions, name).toEqual([])
      expect(parsed.issues, name).toContainEqual(expect.objectContaining({
        code: name === '調整' ? 'PAYPAY_CARD_ADJUSTMENT_UNSUPPORTED' : 'PAYPAY_CARD_DEFERRED_PAYMENT_UNSUPPORTED',
        severity: 'error', row: 2,
      }))
    }
  })

  it('blocks malformed details, positive cancellation signs, inconsistent due dates, and nonpositive statements', () => {
    const malformed = [
      '2026/02/30,STORE,本人*,1回,100,0,100,100,0,0,2026/7/27',
      '2026/06/01,,本人*,1回,100,0,100,100,0,0,2026/7/27',
      '2026/06/01,STORE,本人*,1回,invalid,0,100,100,0,0,2026/7/27',
      '2026/06/01,STORE,本人*,1回,100,0,100,100,0,0,2026/2/30',
      '2026/06/01,STORE,本人*,1回,100,0,100,100,0,0',
      '2026/06/01,STORE,本人*,1回,100,0,100,100,0,0,2026/7/27,extra',
      '2026/06/01,STORE キャンセル,本人*,1回,100,0,100,100,0,0,2026/7/27',
    ].join('\n')
    const parsed = payPayCardAdapter.parse({ text: `${header}\n${malformed}` })
    expect(parsed.records[0].transactions).toEqual([])
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PAYPAY_CARD_DATE_INVALID', row: 2 }),
      expect.objectContaining({ code: 'PAYPAY_CARD_MERCHANT_MISSING', row: 3 }),
      expect.objectContaining({ code: 'PAYPAY_CARD_AMOUNT_INVALID', row: 4 }),
      expect.objectContaining({ code: 'PAYPAY_CARD_PAYMENT_DATE_INVALID', row: 5 }),
      expect.objectContaining({ code: 'PAYPAY_CARD_COLUMN_COUNT_INVALID', row: 7 }),
      expect.objectContaining({ code: 'PAYPAY_CARD_REFUND_SIGN_AMBIGUOUS', row: 8 }),
    ]))

    const inconsistent = payPayCardAdapter.parse({ text: fixture.replace('"2026/7/27"\n"2026/6/15"', '"2026/7/28"\n"2026/6/15"') })
    expect(inconsistent.issues).toContainEqual(expect.objectContaining({ code: 'PAYPAY_CARD_PAYMENT_DATE_MISMATCH', severity: 'error' }))
    expect(inconsistent.records[0].paymentDueOn).toBeUndefined()

    const nonpositive = payPayCardAdapter.parse({ text: `${header}\n2026/06/01,STORE キャンセル,本人*,1回,-100,0,-100,-100,0,0,2026/7/27` })
    expect(nonpositive.issues).toContainEqual(expect.objectContaining({ code: 'PAYPAY_CARD_TOTAL_INVALID', severity: 'error' }))
    expect(nonpositive.records[0].statementTotal).toBeNull()
  })

  it('preserves quoted-newline physical provenance', () => {
    const parsed = payPayCardAdapter.parse({ text: fixture.replace('"架空ストア, 東京"', '"架空ストア,\n東京"') })
    expect(parsed.records[0].transactions[0]).toMatchObject({ merchant: '架空ストア, 東京', lineage: { sourceRow: 2, sourceRowEnd: 3 } })
    expect(parsed.records[0].transactions[1].lineage.sourceRow).toBe(4)
  })
})
