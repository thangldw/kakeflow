import { describe, expect, it } from 'vitest'
import { mapParsedImportToStartImport, type HashFn, type IdFactory } from '../../features/import/importMapper'
import { detectImportAdapter } from '../index'
import { mufgBizstationDepositWithdrawalAdapter } from './mufgBizstationDepositWithdrawal'

const header = [
  '金融機関コード', '金融機関名', '支店コード', '支店名', '科目', '口座番号', '口座名', '取引日',
  '入払区分', '取引区分', '取引金額', '内他店券金額', '手形・小切手区分', '手形・小切手番号',
  '振込依頼人番号', '振込依頼人名', '仕向金融機関名', '仕向支店名', '摘要', 'EDI情報',
]

const deposit = ['0005', 'ﾐﾂﾋﾞｼﾕ-ｴﾌｼﾞｴｲ', '123', 'ﾄｳｷﾖ', '1', '0001234567', 'ｶｹﾌﾛｳ', '080701', '1', '11', '000000300000', '000000000000', '', '', '0000000042', 'ｶﾌﾞｼｷｶﾞｲｼﾔ', 'ﾃｽﾄｷﾞﾝｺｳ', 'ﾎﾝﾃﾝ', '給与', '']
const payment = ['0005', 'ﾐﾂﾋﾞｼﾕ-ｴﾌｼﾞｴｲ', '123', 'ﾄｳｷﾖ', '1', '0001234567', 'ｶｹﾌﾛｳ', '080702', '2', '14', '000000050000', '000000000000', '', '', '', '', '', '', 'ラクテンカード', '']

function csvRow(fields: readonly string[]): string {
  return fields.map((field) => JSON.stringify(field)).join(',')
}

function officialShape(details: readonly (readonly string[])[] = [deposit, payment]): string {
  return [header, ...details].map(csvRow).join('\r\n')
}

function dependencies(): { ids: IdFactory; hash: HashFn } {
  let sequence = 0
  return {
    ids: { next: (kind) => `${kind}-${++sequence}` },
    hash: async (value) => `hash:${value.length}`.padEnd(64, '0').slice(0, 64),
  }
}

describe('MUFG BizSTATION deposit/withdrawal adapter', () => {
  it('detects only the exact official twenty-field family', () => {
    const text = officialShape()
    expect(mufgBizstationDepositWithdrawalAdapter.detect({ text }).score).toBe(1)
    expect(detectImportAdapter({ text })?.adapter.id).toBe('mufg-bizstation-deposit-withdrawal-v1')
    expect(mufgBizstationDepositWithdrawalAdapter.detect({ text: text.replace('金融機関コード', '銀行コード') }).score).toBe(0)
    expect(mufgBizstationDepositWithdrawalAdapter.detect({ text: [header, deposit.slice(1)].map(csvRow).join('\n') }).score).toBe(0)
  })

  it('parses supported Reiwa dates, directions, provenance and conservative semantics', () => {
    const parsed = mufgBizstationDepositWithdrawalAdapter.parse({ text: officialShape(), accountHint: 'Selected MUFG account' })
    expect(parsed.issues).toEqual([])
    expect(parsed.metadata).toMatchObject({
      institution: 'MUFG_BANK', product: 'BIZSTATION_DEPOSIT_WITHDRAWAL', sourceEncoding: 'SHIFT_JIS',
      sourceDateCalendar: 'JAPANESE_ERA', supportedReiwaThrough: 8, durableTransactionIdAvailable: false, balanceAvailable: false,
    })
    expect(JSON.stringify(parsed.metadata)).not.toContain('0001234567')
    expect(JSON.stringify(parsed.metadata)).not.toContain('カケフロウ')
    expect(parsed.records).toHaveLength(2)
    expect(parsed.records[0]).toMatchObject({
      transactionDate: '2026-07-01', description: '給与', outgoingAmount: null, incomingAmount: 300000,
      balance: null, debitCreditCode: '1', suggestedType: 'UNKNOWN', accountHint: 'Selected MUFG account',
    })
    expect(parsed.records[0].lineage).toMatchObject({ sourceRow: 2, sourceRowEnd: 2, rawFields: deposit })
    expect(parsed.records[1]).toMatchObject({
      transactionDate: '2026-07-02', description: 'ラクテンカード', outgoingAmount: 50000,
      incomingAmount: null, suggestedType: 'CARD_PAYMENT',
    })
  })

  it('fails closed on ambiguous eras, mixed accounts, codes and padded amounts', () => {
    const invalid = [...payment]
    invalid[0] = '9999'
    invalid[5] = '0007654321'
    invalid[7] = '310430'
    invalid[8] = '9'
    invalid[9] = '99'
    invalid[10] = '50000'
    invalid[11] = '000000060000'
    const parsed = mufgBizstationDepositWithdrawalAdapter.parse({ text: officialShape([deposit, invalid]) })
    expect(parsed.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'MUFG_BIZSTATION_DW_INSTITUTION_INVALID', 'MUFG_BIZSTATION_DW_ACCOUNT_MIXED',
      'MUFG_BIZSTATION_DW_DATE_UNSUPPORTED', 'MUFG_BIZSTATION_DW_DIRECTION_INVALID',
      'MUFG_BIZSTATION_DW_CLASS_INVALID', 'MUFG_BIZSTATION_DW_AMOUNT_INVALID',
    ]))
  })

  it('maps raw source rows only to the selected bank account', async () => {
    const parsed = mufgBizstationDepositWithdrawalAdapter.parse({ text: officialShape() })
    const deps = dependencies()
    const mapped = await mapParsedImportToStartImport({
      file: {
        householdId: 'family', sourceType: 'MANUAL_UPLOAD', originalFilename: 'mufg-transactions.csv', mediaType: 'text/csv',
        byteSize: 500, sha256: 'a'.repeat(64), sourceModifiedAt: null, accountId: 'explicit-bank', adapterVersion: '1',
      },
      detectedAdapterId: parsed.adapterId,
      parsed,
    }, deps.ids, deps.hash)
    expect(mapped.issues).toEqual([])
    expect(mapped.request.candidates[1]).toMatchObject({
      accountId: 'explicit-bank', occurredOn: '2026-07-02', amountJpy: 50000,
      direction: 'OUT', merchantRaw: 'ラクテンカード', externalTransactionId: null,
    })
    expect(JSON.parse(mapped.request.records[1].payloadJson).rawFields).toEqual(payment)
  })
})
