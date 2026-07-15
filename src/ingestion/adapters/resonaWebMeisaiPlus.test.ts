import { describe, expect, it } from 'vitest'
import { mapParsedImportToStartImport, type HashFn, type IdFactory } from '../../features/import/importMapper'
import { detectImportAdapter, japaneseBankAdapter, personalJapaneseBankAdapter } from '../index'
import { resonaWebMeisaiPlusAdapter } from './resonaWebMeisaiPlus'

const header = [
  '照会口座', '番号', '勘定日', '（起算日）', '出金金額（円）', '入金金額（円）', '小切手区分',
  '残高（円）', '取引区分', '明細区分', '金融機関名', '支店名', '摘要', 'メモ',
]
const deposit = ['りそな銀行 東京支店 普通 1234567', '1', '2026年7月1日', '', '', '50000', '', '150000', '入金', '', '', '', '給与', '7月給与']
const cardPayment = ['りそな銀行 東京支店 普通 1234567', '2', '2026年7月2日', '2026年7月1日', '10000', '', '', '140000', '出金', '', '', '', 'ラクテンカード', '7月分']

function csvRow(fields: readonly string[]): string {
  return fields.map((field) => JSON.stringify(field)).join(',')
}

function officialShape(details: readonly (readonly string[])[] = [deposit, cardPayment]): string {
  return [header, ...details].map(csvRow).join('\r\n')
}

function dependencies(): { ids: IdFactory; hash: HashFn } {
  let sequence = 0
  return {
    ids: { next: (kind) => `${kind}-${++sequence}` },
    hash: async (value) => `hash:${value.length}`.padEnd(64, '0').slice(0, 64),
  }
}

describe('Resona Web deposit/withdrawal Meisai Plus adapter', () => {
  it('detects only the exact published first-record fourteen-column family', () => {
    const text = officialShape()
    expect(resonaWebMeisaiPlusAdapter.detect({ text }).score).toBe(1)
    expect(detectImportAdapter({ text })?.adapter.id).toBe('resona-web-meisai-plus-v1')
    expect(japaneseBankAdapter.detect({ text }).score).toBeLessThan(0.5)
    expect(personalJapaneseBankAdapter.detect({ text }).score).toBe(0)
    expect(resonaWebMeisaiPlusAdapter.detect({ text: text.replace('出金金額（円）', '出金額（円）') }).score).toBe(0)
    expect(resonaWebMeisaiPlusAdapter.detect({ text: `案内行\n${text}` }).score).toBe(0)
  })

  it('parses both directions, value date, running balances and immutable source rows', () => {
    const parsed = resonaWebMeisaiPlusAdapter.parse({ text: officialShape(), accountHint: 'Selected Resona account' })
    expect(parsed.issues).toEqual([])
    expect(parsed.metadata).toMatchObject({
      institution: 'RESONA_BANK', contract: 'WEB_DEPOSIT_WITHDRAWAL_MEISAI_PLUS_2026_05',
      headerRow: 1, sourceOrder: 'OLDEST_FIRST', exportSequenceIsDurableTransactionId: false,
    })
    expect(JSON.stringify(parsed.metadata)).not.toContain('1234567')
    expect(parsed.records).toHaveLength(2)
    expect(parsed.records[0]).toMatchObject({
      transactionDate: '2026-07-01', incomingAmount: 50000, outgoingAmount: null,
      balance: 150000, description: '給与', memo: '7月給与', debitCreditCode: '入金',
      accountHint: 'Selected Resona account', suggestedType: 'UNKNOWN',
    })
    expect(parsed.records[1]).toMatchObject({
      transactionDate: '2026-07-02', incomingAmount: null, outgoingAmount: 10000,
      balance: 140000, description: 'ラクテンカード', descriptionDetail: '起算日 2026-07-01',
      memo: '7月分', debitCreditCode: '出金', suggestedType: 'CARD_PAYMENT',
    })
    expect(parsed.records[1].lineage).toMatchObject({ sourceRow: 3, sourceRowEnd: 3, rawFields: cardPayment })
    expect(parsed.records[1]).not.toHaveProperty('externalTransactionId')
  })

  it('supports a proven newest-first sequence without sorting the source', () => {
    const newer = ['りそな銀行 東京支店 普通 1234567', '1', '2026/07/02', '', '10000', '', '', '140000', '出金', '', '', '', 'カード', '']
    const older = ['りそな銀行 東京支店 普通 1234567', '2', '2026/07/01', '', '', '50000', '', '150000', '入金', '', '', '', '給与', '']
    const parsed = resonaWebMeisaiPlusAdapter.parse({ text: officialShape([newer, older]) })
    expect(parsed.issues).toEqual([])
    expect(parsed.metadata.sourceOrder).toBe('NEWEST_FIRST')
    expect(parsed.records.map((record) => record.transactionDate)).toEqual(['2026-07-02', '2026-07-01'])
  })

  it('fails closed on cancellations, mixed accounts, malformed sequence and reserved fields', () => {
    const canceled = [...deposit]
    canceled[9] = '取消'
    const mixed = [...cardPayment]
    mixed[0] = 'りそな銀行 大阪支店 普通 7654321'
    mixed[1] = '3'
    mixed[6] = '小切手'
    mixed[8] = '入金'
    const parsed = resonaWebMeisaiPlusAdapter.parse({ text: officialShape([canceled, mixed]) })
    expect(parsed.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'RESONA_PLUS_CANCELLATION_UNSUPPORTED', 'RESONA_PLUS_ACCOUNT_MIXED',
      'RESONA_PLUS_SEQUENCE_INVALID', 'RESONA_PLUS_RESERVED_FIELD_NONEMPTY',
      'RESONA_PLUS_DIRECTION_INVALID', 'RESONA_PLUS_DETAILS_MISSING',
    ]))
    expect(parsed.records).toEqual([])

    const discontinuous = [...cardPayment]
    discontinuous[7] = '130000'
    expect(resonaWebMeisaiPlusAdapter.parse({ text: officialShape([deposit, discontinuous]) }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RESONA_PLUS_BALANCE_OR_ORDER_INVALID' })]))
  })

  it('maps only to the explicitly selected bank account and retains sequence in raw provenance', async () => {
    const parsed = resonaWebMeisaiPlusAdapter.parse({ text: officialShape() })
    const deps = dependencies()
    const mapped = await mapParsedImportToStartImport({
      file: {
        householdId: 'family', sourceType: 'MANUAL_UPLOAD', originalFilename: 'resona.csv', mediaType: 'text/csv',
        byteSize: 500, sha256: 'a'.repeat(64), sourceModifiedAt: null, accountId: 'explicit-resona-account', adapterVersion: '1',
      },
      detectedAdapterId: parsed.adapterId,
      parsed,
    }, deps.ids, deps.hash)
    expect(mapped.issues).toEqual([])
    expect(mapped.request.candidates[1]).toMatchObject({
      accountId: 'explicit-resona-account', occurredOn: '2026-07-02', amountJpy: 10000,
      direction: 'OUT', merchantRaw: 'ラクテンカード', descriptionRaw: 'ラクテンカード 起算日 2026-07-01',
      externalTransactionId: null,
    })
    expect(JSON.parse(mapped.request.records[1].payloadJson).rawFields[1]).toBe('2')
  })
})
