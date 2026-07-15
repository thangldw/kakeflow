import { describe, expect, it } from 'vitest'
import { detectImportAdapter, payPayAdapter, payPayCardAdapter, payPayHistoryV2Adapter } from '../index'

const header = 'Date & Time,Amount Outgoing (Yen),Amount Incoming (Yen),Transaction Type,Payment Option,Transaction ID,Description'

function detail(overrides: Partial<Record<'date' | 'outgoing' | 'incoming' | 'type' | 'option' | 'id' | 'description', string>> = {}): string {
  const value = {
    date: '2026/07/12 12:30', outgoing: '998', incoming: '', type: 'Payment',
    option: 'PayPay Balance', id: 'P-1', description: '架空ストア', ...overrides,
  }
  return [value.date, value.outgoing, value.incoming, value.type, value.option, value.id, value.description]
    .map((field) => /[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field).join(',')
}

describe('strict PayPay history v2 adapter', () => {
  it('ranks exact v2 ahead of v1 while keeping v1 callable and avoiding PayPay Card', () => {
    const text = `${header}\n${detail()}`
    expect(payPayHistoryV2Adapter.detect({ text }).score).toBe(1)
    expect(payPayAdapter.detect({ text }).score).toBe(1)
    expect(detectImportAdapter({ text })?.adapter.id).toBe('paypay-history-v2')
    expect(payPayAdapter.parse({ text }).adapterId).toBe('paypay-history-v1')

    const card = '利用日/キャンセル日,利用店名・商品名,利用者,支払区分,利用金額,手数料,支払総額,当月支払金額,翌月以降繰越金額,調整額,当月お支払日\n2026/06/12,架空ストア,本人,1回,1200,0,1200,1200,0,0,2026/07/27'
    expect(payPayHistoryV2Adapter.detect({ text: card }).score).toBe(0)
    expect(payPayCardAdapter.detect({ text: card }).score).toBe(1)
  })

  it('groups an exact payment and points event with split funding and physical provenance', () => {
    const text = [
      header,
      detail({ option: 'PayPay Point (41yen), Credit VISA 8106 (957yen)', description: '架空ストア,\n東京' }),
      detail({ outgoing: '', incoming: '4', type: 'Points, Balance Earned', option: '', description: '架空ストア,\n東京' }),
    ].join('\n')
    const parsed = payPayHistoryV2Adapter.parse({ text })

    expect(parsed.issues).toEqual([])
    expect(parsed.metadata).toEqual({
      headerRow: 1, sourceRows: 2, businessEvents: 1,
      schemaBasis: 'EXACT_SEVEN_COLUMN_HISTORY', unknownTransactionTypesRemainReviewData: true,
    })
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]).toMatchObject({
      transactionId: 'P-1', occurredAt: '2026-07-12T12:30:00+09:00', counterparty: '架空ストア, 東京',
      eventType: 'Payment + Points, Balance Earned', totalOutgoing: 998, totalIncoming: 4,
    })
    expect(parsed.records[0].legs[0]).toMatchObject({
      lineage: { sourceRow: 2, sourceRowEnd: 3 },
      funding: [{ method: 'PayPay Point', amount: 41, currency: 'JPY' }, { method: 'Credit VISA 8106', amount: 957, currency: 'JPY' }],
    })
    expect(parsed.records[0].legs[0].lineage.rawFields[6]).toBe('架空ストア,\n東京')
    expect(parsed.records[0].legs[1].lineage).toMatchObject({ sourceRow: 4, sourceRowEnd: 5 })
  })

  it('requires the exact ordered seven-column header on physical row one', () => {
    const variants = [
      header.replace('Date & Time,Amount Outgoing (Yen)', 'Amount Outgoing (Yen),Date & Time'),
      `${header},Extra`,
      `Preamble\n${header}`,
      header.replace(',Description', ''),
    ]
    for (const variant of variants) {
      expect(payPayHistoryV2Adapter.detect({ text: `${variant}\n${detail()}` }).score).toBe(0)
      expect(payPayHistoryV2Adapter.parse({ text: `${variant}\n${detail()}` }).issues)
        .toContainEqual(expect.objectContaining({ code: 'PAYPAY_V2_HEADER_INVALID', severity: 'error' }))
    }
  })

  it('blocks malformed details, duplicates, inconsistent event identity and funding', () => {
    const valid = detail()
    const text = [
      header,
      valid,
      valid,
      detail({ date: '2026/07/12 25:00', id: 'bad-date' }),
      detail({ outgoing: '100', incoming: '100', id: 'two-sided' }),
      detail({ outgoing: '0', id: 'zero' }),
      detail({ type: '', id: 'no-type' }),
      detail({ id: '', description: 'no id' }),
      detail({ id: 'no-description', description: '' }),
      detail({ id: 'P-1', description: '別店舗', type: 'Refund', outgoing: '', incoming: '998' }),
      detail({ id: 'funding-mismatch', option: 'Point (1yen), Card (2yen)' }),
      detail({ id: 'funding-malformed', option: 'Point (998)' }),
      '2026/07/12 12:30,100,,Payment,PayPay Balance,short',
    ].join('\n')
    const parsed = payPayHistoryV2Adapter.parse({ text })
    expect(parsed.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'PAYPAY_V2_ROW_DUPLICATE', 'PAYPAY_V2_DATETIME_INVALID', 'PAYPAY_V2_AMOUNT_INVALID',
      'PAYPAY_V2_TYPE_INVALID', 'PAYPAY_V2_ID_INVALID', 'PAYPAY_V2_TEXT_INVALID',
      'PAYPAY_V2_EVENT_INCONSISTENT', 'PAYPAY_V2_FUNDING_MISMATCH', 'PAYPAY_V2_FUNDING_INVALID',
      'PAYPAY_V2_ROW_WIDTH_INVALID',
    ]))
  })

  it('retains unknown transaction types as review data without assigning semantics', () => {
    const parsed = payPayHistoryV2Adapter.parse({ text: `${header}\n${detail({ type: 'Unrecognized Future Event' })}` })
    expect(parsed.issues).toEqual([])
    expect(parsed.records[0]).toMatchObject({ eventType: 'Unrecognized Future Event' })
    expect(parsed.records[0].legs[0]).toMatchObject({ transactionType: 'Unrecognized Future Event', outgoingAmount: 998 })
  })

  it('enforces event-leg, event-count and source-row bounds', () => {
    const tooManyLegs = [header, ...Array.from({ length: 65 }, (_, index) => detail({ type: `Unknown ${index}`, outgoing: String(index + 1) }))].join('\n')
    expect(payPayHistoryV2Adapter.parse({ text: tooManyLegs }).issues)
      .toContainEqual(expect.objectContaining({ code: 'PAYPAY_V2_LEG_LIMIT_EXCEEDED', row: 66 }))

    const tooManyEvents = [header, ...Array.from({ length: 10_001 }, (_, index) => detail({ id: `event-${index}`, outgoing: String(index + 1) }))].join('\n')
    expect(payPayHistoryV2Adapter.parse({ text: tooManyEvents }).issues)
      .toContainEqual(expect.objectContaining({ code: 'PAYPAY_V2_EVENT_LIMIT_EXCEEDED', row: 10002 }))

    const tooManyRows = [header, ...Array.from({ length: 20_001 }, (_, index) => detail({ id: `row-${index}`, outgoing: String(index + 1) }))].join('\n')
    expect(payPayHistoryV2Adapter.parse({ text: tooManyRows }).issues)
      .toContainEqual(expect.objectContaining({ code: 'PAYPAY_V2_ROW_LIMIT_EXCEEDED', severity: 'error' }))
  })
})
