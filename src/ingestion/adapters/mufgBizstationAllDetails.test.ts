import { describe, expect, it } from 'vitest'
import { mapParsedImportToStartImport, type HashFn, type IdFactory } from '../../features/import/importMapper'
import { detectImportAdapter, japaneseBankAdapter } from '../index'
import { mufgBizstationAllDetailsAdapter } from './mufgBizstationAllDetails'

function csvRow(fields: readonly string[]): string {
  return fields.map((field) => JSON.stringify(field)).join(',')
}

const header = ['1', '123', '東京支店', '1', '0', '普通', '0012345', 'カケフロウ', '2026.7.1-2026.7.31', '全明細', '2026.7.31', '12:34', '', '', '']
const deposit = ['2', '2026.7.1', '振込', '給与', '0', '300000', '300000']
const payment = ['2', '2026.7.2', '口座振替', 'ラクテンカード', '50000', '0', '250000']
const footer = ['8']
const final = ['9', '1', '1', '', '50000', '300000', '0', '250000']

function officialShape(details: readonly (readonly string[])[] = [deposit, payment], end: readonly string[] = final): string {
  return [header, ...details, footer, end].map(csvRow).join('\r\n')
}

function dependencies(): { ids: IdFactory; hash: HashFn } {
  let sequence = 0
  return {
    ids: { next: (kind) => `${kind}-${++sequence}` },
    hash: async (value) => `hash:${value.length}`.padEnd(64, '0').slice(0, 64),
  }
}

describe('MUFG BizSTATION all-details adapter', () => {
  it('detects the exact official record structure ahead of generic bank parsing', () => {
    const text = officialShape()
    expect(mufgBizstationAllDetailsAdapter.detect({ text })).toMatchObject({ score: 1 })
    expect(japaneseBankAdapter.detect({ text }).score).toBe(0)
    expect(detectImportAdapter({ text })?.adapter.id).toBe('mufg-bizstation-all-details-v1')

    expect(mufgBizstationAllDetailsAdapter.detect({ text: text.replace('全明細', '入出金明細') }).score).toBe(0)
    expect(mufgBizstationAllDetailsAdapter.detect({ text: [header, deposit, final].map(csvRow).join('\n') }).score).toBe(0)
  })

  it('parses and reconciles oldest-first payments, deposits, totals and physical rows', () => {
    const parsed = mufgBizstationAllDetailsAdapter.parse({ text: officialShape(), accountHint: 'Selected MUFG account' })

    expect(parsed.issues).toEqual([])
    expect(parsed.metadata).toMatchObject({
      institution: 'MUFG_BANK', product: 'BIZSTATION_ALL_DETAILS', sourceEncoding: 'SHIFT_JIS',
      sourceOrder: 'OLDEST_FIRST', periodStart: '2026-07-01', periodEnd: '2026-07-31', accountType: '普通',
    })
    expect(JSON.stringify(parsed.metadata)).not.toContain('0012345')
    expect(JSON.stringify(parsed.metadata)).not.toContain('カケフロウ')
    expect(parsed.records).toHaveLength(2)
    expect(parsed.records[0]).toMatchObject({
      transactionDate: '2026-07-01', description: '給与', descriptionDetail: '振込',
      outgoingAmount: null, incomingAmount: 300000, balance: 300000, debitCreditCode: 'IN',
      suggestedType: 'UNKNOWN', accountHint: 'Selected MUFG account',
    })
    expect(parsed.records[0].lineage).toMatchObject({ sourceRow: 2, sourceRowEnd: 2, rawFields: deposit })
    expect(parsed.records[1]).toMatchObject({
      transactionDate: '2026-07-02', description: 'ラクテンカード', outgoingAmount: 50000,
      incomingAmount: null, balance: 250000, debitCreditCode: 'OUT', suggestedType: 'CARD_PAYMENT',
    })
  })

  it('recognizes a newest-first export without changing source-row order', () => {
    const parsed = mufgBizstationAllDetailsAdapter.parse({ text: officialShape([payment, deposit]) })

    expect(parsed.issues).toEqual([])
    expect(parsed.metadata.sourceOrder).toBe('NEWEST_FIRST')
    expect(parsed.records.map((record) => record.description)).toEqual(['ラクテンカード', '給与'])
    expect(parsed.records.map((record) => record.lineage.sourceRow)).toEqual([2, 3])
  })

  it('fails closed on invalid account metadata, detail direction, totals and balances', () => {
    const malformedHeader = [...header]
    malformedHeader[5] = '当座'
    const malformedDirection = ['2', '2026.7.2', '振込', '不明', '100', '200', '400000']
    const malformedFinal = ['9', '9', '9', '', '1', '2', '0', '999999']
    const parsed = mufgBizstationAllDetailsAdapter.parse({ text: [malformedHeader, malformedDirection, footer, malformedFinal].map(csvRow).join('\n') })
    const codes = parsed.issues.map((issue) => issue.code)

    expect(codes).toEqual(expect.arrayContaining([
      'MUFG_BIZSTATION_ACCOUNT_TYPE_INVALID', 'MUFG_BIZSTATION_DIRECTION_INVALID',
      'MUFG_BIZSTATION_PAYMENT_TOTAL_MISMATCH', 'MUFG_BIZSTATION_DEPOSIT_TOTAL_MISMATCH',
      'MUFG_BIZSTATION_BALANCE_MISMATCH',
    ]))
  })

  it('maps only to the explicitly selected bank account and retains raw source provenance', async () => {
    const parsed = mufgBizstationAllDetailsAdapter.parse({ text: officialShape() })
    const deps = dependencies()
    const mapped = await mapParsedImportToStartImport({
      file: {
        householdId: 'family', sourceType: 'MANUAL_UPLOAD', originalFilename: 'mufg-bizstation.csv', mediaType: 'text/csv',
        byteSize: 300, sha256: 'a'.repeat(64), sourceModifiedAt: null, accountId: 'explicit-bank', adapterVersion: '1',
      },
      detectedAdapterId: parsed.adapterId,
      parsed,
    }, deps.ids, deps.hash)

    expect(mapped.issues).toEqual([])
    expect(mapped.request.candidates).toHaveLength(2)
    expect(mapped.request.candidates[1]).toMatchObject({
      accountId: 'explicit-bank', occurredOn: '2026-07-02', amountJpy: 50000,
      direction: 'OUT', merchantRaw: 'ラクテンカード', descriptionRaw: 'ラクテンカード 口座振替',
      externalTransactionId: null,
    })
    expect(JSON.parse(mapped.request.records[1].payloadJson).rawFields).toEqual(payment)
  })
})
