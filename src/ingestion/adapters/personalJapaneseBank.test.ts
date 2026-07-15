import { describe, expect, it } from 'vitest'
import { mapParsedImportToStartImport, type HashFn, type IdFactory } from '../../features/import/importMapper'
import { detectImportAdapter, japaneseBankAdapter, personalJapaneseBankAdapter } from '../index'
import { mufgBizstationAllDetailsAdapter } from './mufgBizstationAllDetails'
import { mufgBizstationDepositWithdrawalAdapter } from './mufgBizstationDepositWithdrawal'
import { yuchoDirectAdapter } from './yuchoDirect'

const header = '日付,摘要,摘要内容,支払い金額,預かり金額,差引残高,メモ,未資金化区分,入払区分'

function dependencies(): { ids: IdFactory; hash: HashFn } {
  let sequence = 0
  return {
    ids: { next: (kind) => `${kind}-${++sequence}` },
    hash: async (value) => `hash:${value.length}`.padEnd(64, '0').slice(0, 64),
  }
}

describe('strict provider-neutral personal Japanese bank adapter', () => {
  it('wins over generic v1 with an exact header after a bounded physical preamble', () => {
    const text = ['口座明細', '対象期間,2026年7月', header, '2026/07/01,給与,,,300000,300000,,,入'].join('\n')
    expect(personalJapaneseBankAdapter.detect({ text })).toMatchObject({ score: 1 })
    expect(japaneseBankAdapter.detect({ text }).score).toBe(1)
    expect(detectImportAdapter({ text })?.adapter.id).toBe('personal-japanese-bank-ledger-v2')

    const tooDeep = `${Array.from({ length: 9 }, (_, index) => `preamble ${index + 1}`).join('\n')}\n${header}\n2026/07/01,給与,,,1,1,,,入`
    expect(personalJapaneseBankAdapter.detect({ text: tooDeep }).score).toBe(0)
  })

  it('parses oldest-first rows with complete physical provenance and exact balance validation', () => {
    const text = [
      '明細', header,
      '2026/07/01,給与,"7月\n通常分",,300000,300000,確認済,,入',
      '2026/07/02,ラクテンカードサービス,,50000,,250000,,,出',
    ].join('\n')
    const parsed = personalJapaneseBankAdapter.parse({ text, accountHint: 'Selected bank' })

    expect(parsed.issues).toEqual([])
    expect(parsed.metadata).toMatchObject({ headerRow: 2, sourceOrder: 'OLDEST_FIRST', contract: 'PERSONAL_JAPANESE_BANK_NINE_COLUMN' })
    expect(parsed.records).toHaveLength(2)
    expect(parsed.records[0]).toMatchObject({
      transactionDate: '2026-07-01', incomingAmount: 300000, outgoingAmount: null,
      balance: 300000, descriptionDetail: '7月 通常分', accountHint: 'Selected bank', debitCreditCode: '入',
    })
    expect(parsed.records[0].lineage).toMatchObject({ sourceRow: 3, sourceRowEnd: 4 })
    expect(parsed.records[0].lineage.rawFields[2]).toBe('7月\n通常分')
    expect(parsed.records[1]).toMatchObject({ outgoingAmount: 50000, balance: 250000, suggestedType: 'CARD_PAYMENT' })
    expect(parsed.records[1].lineage.sourceRow).toBe(5)
  })

  it('recognizes newest-first source order without reordering records', () => {
    const parsed = personalJapaneseBankAdapter.parse({ text: [
      header,
      '2026/07/02,カード,,50000,,250000,,,出',
      '2026/07/01,給与,,,300000,300000,,,入',
    ].join('\n') })

    expect(parsed.issues).toEqual([])
    expect(parsed.metadata.sourceOrder).toBe('NEWEST_FIRST')
    expect(parsed.records.map((record) => record.description)).toEqual(['カード', '給与'])
    expect(parsed.records.map((record) => record.lineage.sourceRow)).toEqual([2, 3])
  })

  it('blocks ambiguous order, balance discontinuities, malformed rows, summaries and duplicates', () => {
    const ambiguous = personalJapaneseBankAdapter.parse({ text: [
      header,
      '2026/07/01,入金,,,100,100,,,入',
      '2026/07/01,出金,,100,,0,,,出',
    ].join('\n') })
    expect(ambiguous.issues).toContainEqual(expect.objectContaining({ code: 'PERSONAL_BANK_SOURCE_ORDER_AMBIGUOUS', severity: 'error' }))

    const malformed = personalJapaneseBankAdapter.parse({ text: [
      header,
      '2026/07/01,給与,,,300000,300000,,,入',
      '2026/07/02,カード,,50000,,999999,,,出',
      '2026/02/30,不正,1,2,3,not-a-balance,,,不明',
      '合計,,,50000,300000,250000,,,',
      '2026/07/01,給与,,,300000,300000,,,入',
      '2026/07/03,列不足,100',
    ].join('\n') })
    expect(malformed.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'PERSONAL_BANK_BALANCE_DISCONTINUITY', 'PERSONAL_BANK_DATE_INVALID', 'PERSONAL_BANK_AMOUNT_INVALID',
      'PERSONAL_BANK_BALANCE_INVALID', 'PERSONAL_BANK_DIRECTION_INVALID', 'PERSONAL_BANK_SUMMARY_ROW_REJECTED',
      'PERSONAL_BANK_DETAIL_DUPLICATE', 'PERSONAL_BANK_ROW_WIDTH_INVALID',
    ]))
  })

  it('does not collide with MUFG BizSTATION or Yucho Direct', () => {
    const bizstation = '金融機関コード,金融機関名,支店コード,支店名,科目,口座番号,口座名,取引日,入払区分,取引区分,取引金額,内他店券金額,手形・小切手区分,手形・小切手番号,振込依頼人番号,振込依頼人名,仕向金融機関名,仕向支店名,摘要,EDI情報\n0005,ﾐﾂﾋﾞｼﾕ-ｴﾌｼﾞｴｲ,123,ﾄｳｷﾖ,1,0001234567,ｶｹﾌﾛｳ,080701,1,11,000000300000,000000000000,,,,ｶﾌﾞｼｷｶﾞｲｼﾔ,ﾃｽﾄｷﾞﾝｺｳ,ﾎﾝﾃﾝ,給与,'
    const bizstationAll = '1,123,東京支店,1,0,普通,0012345,カケフロウ,2026.7.1-2026.7.31,全明細,2026.7.31,12:34,,,\n2,2026.7.1,振込,給与,0,300000,300000\n8\n9,0,1,,0,300000,0,300000'
    const yucho = '取引日,入出金明細ID,受入金額(円),払出金額(円),詳細1,詳細2,現在(貸付)高\n20260701,1,100,,給与,,100'
    expect(personalJapaneseBankAdapter.detect({ text: bizstation }).score).toBe(0)
    expect(personalJapaneseBankAdapter.detect({ text: bizstationAll }).score).toBe(0)
    expect(personalJapaneseBankAdapter.detect({ text: yucho }).score).toBe(0)
    expect(mufgBizstationDepositWithdrawalAdapter.detect({ text: bizstation }).score).toBe(1)
    expect(mufgBizstationAllDetailsAdapter.detect({ text: bizstationAll }).score).toBe(1)
    expect(yuchoDirectAdapter.detect({ text: yucho }).score).toBe(1)
  })

  it('maps candidates only to the explicit ASSET/BANK account and preserves the raw row', async () => {
    const parsed = personalJapaneseBankAdapter.parse({ text: `${header}\n2026/07/27,カード引落,7月分,204987,,100000,確認,,出` })
    const deps = dependencies()
    const mapped = await mapParsedImportToStartImport({
      file: {
        householdId: 'family', sourceType: 'MANUAL_UPLOAD', originalFilename: 'personal-bank.csv', mediaType: 'text/csv',
        byteSize: 120, sha256: 'a'.repeat(64), sourceModifiedAt: null, accountId: 'explicit-bank', adapterVersion: '2',
      },
      detectedAdapterId: parsed.adapterId,
      parsed,
    }, deps.ids, deps.hash)

    expect(mapped.issues).toEqual([])
    expect(mapped.request).toMatchObject({ adapterId: 'personal-japanese-bank-ledger-v2', adapterVersion: '2' })
    expect(mapped.request.candidates).toEqual([expect.objectContaining({
      accountId: 'explicit-bank', occurredOn: '2026-07-27', amountJpy: 204987,
      direction: 'OUT', merchantRaw: 'カード引落', descriptionRaw: 'カード引落 7月分',
    })])
    expect(JSON.parse(mapped.request.records[0].payloadJson)).toMatchObject({
      sourceRow: 2, sourceRowEnd: 2,
      rawFields: ['2026/07/27', 'カード引落', '7月分', '204987', '', '100000', '確認', '', '出'],
    })
  })
})
