import { describe, expect, it } from 'vitest'
import { amazonMastercardAdapter, japaneseBankAdapter, payPayAdapter, rakutenEnaviAdapter, tokenizeCsv } from './index'

describe('CSV tokenizer', () => {
  it('preserves quoted commas, escaped quotes and quoted newlines', () => {
    const result = tokenizeCsv('a,b\n"shop, west","first\nsecond ""memo"""\n')
    expect(result.issues).toHaveLength(0)
    expect(result.rows[1].fields).toEqual(['shop, west', 'first\nsecond "memo"'])
    expect(result.rows[1].sourceRowEnd).toBe(3)
  })
})

describe('Japanese bank adapter', () => {
  it('normalizes amounts and proposes card payments', () => {
    const text = '日付,摘要,摘要内容,支払い金額,預かり金額,差引残高,メモ,未資金化区分,入払区分\n2026/07/27,ラクテンカードサービス,,204987,,100000,,,出'
    const parsed = japaneseBankAdapter.parse({ text, accountHint: 'MUFG ****31' })
    expect(parsed.records[0]).toMatchObject({ transactionDate: '2026-07-27', outgoingAmount: 204987, suggestedType: 'CARD_PAYMENT', accountHint: 'MUFG ****31' })
  })
})

describe('PayPay adapter', () => {
  it('groups rows into events and extracts split funding', () => {
    const text = [
      'Date & Time,Amount Outgoing (Yen),Amount Incoming (Yen),Transaction Type,Payment Option,Transaction ID,Description',
      '2026/07/12 12:30,998,,Payment,"PayPay Point (41yen), Credit VISA 8106 (957yen)",P-1,"Shop, Tokyo"',
      '2026/07/12 12:30,,4,"Points, Balance Earned",,P-1,"Shop, Tokyo"',
    ].join('\n')
    const parsed = payPayAdapter.parse({ text })
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]).toMatchObject({ transactionId: 'P-1', totalOutgoing: 998, totalIncoming: 4 })
    expect(parsed.records[0].legs[0].funding).toEqual([
      { method: 'PayPay Point', amount: 41, currency: 'JPY' },
      { method: 'Credit VISA 8106', amount: 957, currency: 'JPY' },
    ])
  })
})

describe('card statement adapters', () => {
  it('parses headerless Amazon statements without treating total as detail', () => {
    const text = 'Taro,****1234,Amazon Mastercard\n2026/07/01,AMAZON.CO.JP,本人,一括,2000,,\n2026/07/02,返品,本人,一括,-500,,\nご請求金額合計,,,,1500,,'
    const statement = amazonMastercardAdapter.parse({ text }).records[0]
    expect(statement.transactions).toHaveLength(2)
    expect(statement.transactions[1].isRefund).toBe(true)
    expect(statement.statementTotal).toBe(1500)
  })

  it('attaches Rakuten FX continuation rows to the preceding transaction', () => {
    const text = '利用日,利用店名・商品名,利用者,支払方法,利用金額,手数料/利息,支払総額,7月支払金額,当月請求額,8月繰越残高\n2026/06/12,ANTHROPIC* CLAUDE SU,本人,一括,3666,0,3666,3666,3666,0\n現地利用額 22.000 USD 変換レート 166.637円,,,,,,,,,'
    const transaction = rakutenEnaviAdapter.parse({ text }).records[0].transactions[0]
    expect(transaction).toMatchObject({ originalAmount: 22, originalCurrency: 'USD', exchangeRate: 166.637, billingAmount: 3666 })
    expect(transaction.lineage.sourceRowEnd).toBe(3)
  })
})
