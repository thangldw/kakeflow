import { describe, expect, it } from 'vitest'
import { mapParsedImportToStartImport, type HashFn, type IdFactory } from '../../features/import/importMapper'
import { detectImportAdapter, japaneseBankAdapter } from '../index'
import { yuchoDirectAdapter } from './yuchoDirect'

const header = '取引日,入出金明細ID,受入金額（円）,払出金額（円）,詳細1,詳細2,現在（貸付）高'

function officialShape(rows: readonly string[]): string {
  return [
    'お客さま口座情報',
    '現在高：,140000,円',
    '照会対象：,2026年7月1日～2026年7月31日',
    '明細件数：,2',
    header,
    ...rows,
  ].join('\n')
}

function dependencies(): { ids: IdFactory; hash: HashFn } {
  let sequence = 0
  return {
    ids: { next: (kind) => `${kind}-${++sequence}` },
    hash: async (value) => `hash:${value.length}`.padEnd(64, '0').slice(0, 64),
  }
}

describe('Yucho Direct personal statement adapter', () => {
  it('detects only the exact official header after its account-information preamble', () => {
    const text = officialShape(['20260701,202607010000001,50000,,給与,勤務先,150000'])
    expect(yuchoDirectAdapter.detect({ text })).toMatchObject({ score: 1 })
    expect(japaneseBankAdapter.detect({ text }).score).toBe(0)
    expect(detectImportAdapter({ text })?.adapter.id).toBe('yucho-direct-ledger-v1')

    const guessedAlias = text.replace('入出金明細ID', '明細ID')
    expect(yuchoDirectAdapter.detect({ text: guessedAlias }).score).toBe(0)
  })

  it('parses deposits, withdrawals, compact dates, signed balances and physical lineage', () => {
    const parsed = yuchoDirectAdapter.parse({
      text: officialShape([
        '20260701,202607010000001,50000,,給与,勤務先,150000',
        '20260702,202607020000001,,10000,カード,,140000',
      ]),
      accountHint: 'Yucho selected account',
    })

    expect(parsed.issues).toEqual([])
    expect(parsed.metadata).toMatchObject({ institution: 'JP_BANK', headerRow: 5, sourceOrder: 'OLDEST_FIRST', exportSequenceIsDurableTransactionId: false })
    expect(parsed.records).toHaveLength(2)
    expect(parsed.records[0]).toMatchObject({
      transactionDate: '2026-07-01', incomingAmount: 50000, outgoingAmount: null,
      balance: 150000, description: '給与', descriptionDetail: '勤務先', accountHint: 'Yucho selected account',
    })
    expect(parsed.records[0].lineage.sourceRow).toBe(6)
    expect(parsed.records[1]).toMatchObject({
      transactionDate: '2026-07-02', incomingAmount: null, outgoingAmount: 10000,
      balance: 140000, description: 'カード', suggestedType: 'UNKNOWN', debitCreditCode: 'OUT',
    })
    expect(parsed.records[1]).not.toHaveProperty('externalTransactionId')

    const loan = yuchoDirectAdapter.parse({ text: `${header}\n20260701,1,,100,カード,,-100` })
    expect(loan.records[0].balance).toBe(-100)
    expect(loan.issues).toEqual([])
  })

  it('reports malformed dates, widths, directions, balances and duplicate export sequences', () => {
    const text = [
      header,
      '20260701,seq-1,100,,,給与,100',
      '20260702,seq-2,10,10,送金,相手,100',
      '20260230,seq-3,,10,カード,,90',
      '20260704,seq-4,,5,カード,,80',
      '20260705,seq-5,,abc,カード,,abc',
      '20260706,seq-6,,5,only-six,85',
      '20260707,seq-1,,5,カード,,75',
    ].join('\n')
    const parsed = yuchoDirectAdapter.parse({ text })
    const codes = parsed.issues.map((issue) => issue.code)

    expect(codes).toEqual(expect.arrayContaining([
      'YUCHO_AMOUNT_AMBIGUOUS', 'YUCHO_DATE_INVALID', 'YUCHO_BALANCE_MISMATCH',
      'YUCHO_AMOUNT_INVALID', 'YUCHO_BALANCE_INVALID', 'YUCHO_ROW_WIDTH_INVALID',
      'YUCHO_SEQUENCE_DUPLICATE',
    ]))
    expect(parsed.records).toHaveLength(5)
  })

  it('keeps the export sequence only in immutable raw provenance during canonical mapping', async () => {
    const parsed = yuchoDirectAdapter.parse({
      text: officialShape(['20260702,202607020000001,,10000,カード,ATM,140000']),
    })
    const deps = dependencies()
    const result = await mapParsedImportToStartImport({
      file: {
        householdId: 'family', sourceType: 'MANUAL_UPLOAD', originalFilename: 'yucho.csv', mediaType: 'text/csv',
        byteSize: 100, sha256: 'a'.repeat(64), sourceModifiedAt: null, accountId: 'explicit-yucho-account', adapterVersion: '1',
      },
      detectedAdapterId: parsed.adapterId,
      parsed,
    }, deps.ids, deps.hash)

    expect(result.issues).toEqual([])
    expect(result.request.candidates).toHaveLength(1)
    expect(result.request.candidates[0]).toMatchObject({
      accountId: 'explicit-yucho-account', occurredOn: '2026-07-02', amountJpy: 10000,
      direction: 'OUT', merchantRaw: 'カード', descriptionRaw: 'カード ATM', externalTransactionId: null,
    })
    expect(JSON.parse(result.request.records[0].payloadJson).rawFields[1]).toBe('202607020000001')
    expect(result.request.candidates[0]).not.toHaveProperty('suggestedTransactionType', 'CARD_PAYMENT')
  })
})
