import { describe, expect, it } from 'vitest'
import { mapParsedImportToStartImport, type HashFn, type IdFactory } from '../../features/import/importMapper'
import { detectImportAdapter, japaneseBankAdapter, personalJapaneseBankAdapter } from '../index'
import { mizuhoBusinessWebAdapter } from './mizuhoBusinessWeb'

const header = [
  '照会口座', '番号', '勘定日', '（起算日）', '出金（円）', '入金（円）', '小切手区分',
  '残高（円）', '取引区分', '明細区分', '金融機関名', '支店名', '摘要',
]
const deposit = ['みずほ銀行 東京中央支店 普通 1234567', '001', '2026年7月1日', '', '', '50000', '', '150000', '振込入金', '', 'テスト銀行', '本店', '給与']
const cardPayment = ['みずほ銀行 東京中央支店 普通 1234567', '002', '2026年7月2日', '2026年7月1日', '10000', '', '', '140000', '振替支払', '', '', '', 'ラクテンカード']

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

describe('Mizuho Business Web statement adapter', () => {
  it('detects only the exact official first-record thirteen-column family', () => {
    const text = officialShape()
    expect(mizuhoBusinessWebAdapter.detect({ text }).score).toBe(1)
    expect(detectImportAdapter({ text })?.adapter.id).toBe('mizuho-business-web-statement-v1')
    expect(japaneseBankAdapter.detect({ text }).score).toBeLessThan(0.5)
    expect(personalJapaneseBankAdapter.detect({ text }).score).toBe(0)
    expect(mizuhoBusinessWebAdapter.detect({ text: text.replace('出金（円）', '出金額（円）') }).score).toBe(0)
    expect(mizuhoBusinessWebAdapter.detect({ text: `案内行\n${text}` }).score).toBe(0)
  })

  it('parses positive normal entries, official transaction values and source provenance', () => {
    const parsed = mizuhoBusinessWebAdapter.parse({ text: officialShape(), accountHint: 'Selected Mizuho account' })
    expect(parsed.issues).toEqual([])
    expect(parsed.metadata).toMatchObject({
      institution: 'MIZUHO_BANK', product: 'MIZUHO_BUSINESS_WEB', sourceEncoding: 'SHIFT_JIS',
      contract: 'DEPOSIT_WITHDRAWAL_CSV_13_FIELD', headerRow: 1, sourceOrder: 'OLDEST_FIRST',
      transactionNumberIsDurableTransactionId: false,
    })
    expect(JSON.stringify(parsed.metadata)).not.toContain('1234567')
    expect(parsed.records).toHaveLength(2)
    expect(parsed.records[0]).toMatchObject({
      transactionDate: '2026-07-01', incomingAmount: 50000, outgoingAmount: null,
      balance: 150000, description: '給与', descriptionDetail: '振込入金 テスト銀行 本店',
      debitCreditCode: 'IN', suggestedType: 'UNKNOWN', accountHint: 'Selected Mizuho account',
    })
    expect(parsed.records[1]).toMatchObject({
      transactionDate: '2026-07-02', incomingAmount: null, outgoingAmount: 10000,
      balance: 140000, description: 'ラクテンカード', descriptionDetail: '振替支払 起算日 2026-07-01',
      debitCreditCode: 'OUT', suggestedType: 'CARD_PAYMENT',
    })
    expect(parsed.records[1].lineage).toMatchObject({ sourceRow: 3, sourceRowEnd: 3, rawFields: cardPayment })
    expect(parsed.records[1]).not.toHaveProperty('externalTransactionId')
  })

  it('supports signed balances and a uniquely proven newest-first sequence without sorting', () => {
    const newer = ['みずほ銀行 東京中央支店 普通 1234567', '002', '2026/07/02', '', '10000', '', '', '-1000', '出金', '', '', '', 'カード']
    const older = ['みずほ銀行 東京中央支店 普通 1234567', '001', '2026/07/01', '', '', '5000', '', '9000', '入金', '', '', '', '入金']
    const parsed = mizuhoBusinessWebAdapter.parse({ text: officialShape([newer, older]) })
    expect(parsed.issues).toEqual([])
    expect(parsed.metadata.sourceOrder).toBe('NEWEST_FIRST')
    expect(parsed.records.map((record) => record.balance)).toEqual([-1000, 9000])
  })

  it('blocks negative corrections, cancellation or gaps, duplicate numbers and mixed accounts', () => {
    const negative = [...deposit]
    negative[5] = '-50000'
    negative[9] = '取消'
    const mixed = [...cardPayment]
    mixed[0] = 'みずほ銀行 大阪支店 普通 7654321'
    mixed[1] = '001'
    mixed[9] = '欠番'
    const parsed = mizuhoBusinessWebAdapter.parse({ text: officialShape([negative, mixed]) })
    expect(parsed.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'MIZUHO_BUSINESS_NEGATIVE_AMOUNT_UNSUPPORTED', 'MIZUHO_BUSINESS_CORRECTION_UNSUPPORTED',
      'MIZUHO_BUSINESS_ACCOUNT_MIXED', 'MIZUHO_BUSINESS_DETAILS_MISSING',
    ]))
    expect(parsed.records).toEqual([])

    const duplicate = [...cardPayment]
    duplicate[1] = '001'
    duplicate[2] = deposit[2]
    expect(mizuhoBusinessWebAdapter.parse({ text: officialShape([deposit, duplicate]) }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'MIZUHO_BUSINESS_NUMBER_DUPLICATE' })]))
  })

  it('maps only to the explicitly selected bank account and keeps the number in raw provenance', async () => {
    const parsed = mizuhoBusinessWebAdapter.parse({ text: officialShape() })
    const deps = dependencies()
    const mapped = await mapParsedImportToStartImport({
      file: {
        householdId: 'family', sourceType: 'MANUAL_UPLOAD', originalFilename: 'mizuho.csv', mediaType: 'text/csv',
        byteSize: 500, sha256: 'a'.repeat(64), sourceModifiedAt: null, accountId: 'explicit-mizuho-account', adapterVersion: '1',
      },
      detectedAdapterId: parsed.adapterId,
      parsed,
    }, deps.ids, deps.hash)
    expect(mapped.issues).toEqual([])
    expect(mapped.request.candidates[1]).toMatchObject({
      accountId: 'explicit-mizuho-account', occurredOn: '2026-07-02', amountJpy: 10000,
      direction: 'OUT', merchantRaw: 'ラクテンカード', descriptionRaw: 'ラクテンカード 振替支払 起算日 2026-07-01',
      externalTransactionId: null,
    })
    expect(JSON.parse(mapped.request.records[1].payloadJson).rawFields[1]).toBe('002')
  })
})
