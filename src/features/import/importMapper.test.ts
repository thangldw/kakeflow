import { describe, expect, it } from 'vitest'
import { jcbMyJcbAdapter } from '../../ingestion'
import type { ParsedImport } from '../../ingestion/types'
import { mapParsedImportToStartImport, type HashFn, type IdFactory, type ImportMapperInput } from './importMapper'

function dependencies(): { ids: IdFactory; hash: HashFn } {
  let sequence = 0
  return {
    ids: { next: (kind) => `${kind}-${++sequence}` },
    hash: async (value) => `sha256:${value.length}:${Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0)}`.padEnd(64, '0').slice(0, 64),
  }
}

function input(parsed: ParsedImport<unknown>): ImportMapperInput {
  return {
    file: {
      householdId: 'household-1', sourceType: 'MANUAL_UPLOAD', originalFilename: 'history.csv', mediaType: 'text/csv',
      byteSize: 42, sha256: 'a'.repeat(64), sourceModifiedAt: '2026-07-12T10:00:00Z', accountId: 'account-1', adapterVersion: '1',
    },
    detectedAdapterId: parsed.adapterId,
    parsed,
  }
}

describe('import mapper', () => {
  it('maps a bank row to Rust StartImport camelCase without binary data', async () => {
    const parsed: ParsedImport<unknown> = { adapterId: 'japanese-bank-ledger-v1', issues: [], metadata: {}, records: [{
      kind: 'bank-transaction', lineage: { sourceRow: 2, sourceRowEnd: 2, rawFields: ['2026/07/27', 'ラクテンカード', '204987'] },
      transactionDate: '2026-07-27', description: 'ラクテンカード', descriptionDetail: '', outgoingAmount: 204987, incomingAmount: null,
      balance: 100000, memo: '', fundsAvailabilityCode: '', debitCreditCode: '出', suggestedType: 'CARD_PAYMENT',
    }] }
    const deps = dependencies()
    const result = await mapParsedImportToStartImport(input(parsed), deps.ids, deps.hash)

    expect(result.issues).toEqual([])
    expect(result.request).toMatchObject({ householdId: 'household-1', adapterId: parsed.adapterId, byteSize: 42, audienceVisibility: 'SHARED', audienceMemberId: null })
    expect(result.request).not.toHaveProperty('fileBytes')
    expect(result.request.records).toHaveLength(1)
    expect(JSON.parse(result.request.records[0].payloadJson)).toEqual({ sourceRow: 2, sourceRowEnd: 2, rawFields: ['2026/07/27', 'ラクテンカード', '204987'] })
    expect(result.request.records[0].recordHash).toHaveLength(64)
    expect(result.request.candidates[0]).toMatchObject({ amountJpy: 204987, direction: 'OUT', occurredOn: '2026-07-27', accountId: 'account-1', reviewStatus: 'PENDING', attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null })
    expect(result.request.cardStatements).toEqual([])
  })

  it('preserves a custom parser external transaction ID on the review candidate', async () => {
    const parsed: ParsedImport<unknown> = { adapterId: 'custom-delimited-v1', issues: [], metadata: { profileId: 'custom' }, records: [{
      kind: 'bank-transaction', lineage: { sourceRow: 8, sourceRowEnd: 8, rawFields: ['2026-07-12', 'Store', '-1200', 'bank-row-9'] },
      transactionDate: '2026-07-12', description: 'Store', descriptionDetail: '', outgoingAmount: 1200, incomingAmount: null,
      externalTransactionId: 'bank-row-9', balance: null, memo: '', fundsAvailabilityCode: '', debitCreditCode: 'OUT', suggestedType: 'UNKNOWN',
    }] }
    const deps = dependencies(); const result = await mapParsedImportToStartImport(input(parsed), deps.ids, deps.hash)
    expect(result.request.candidates).toHaveLength(1)
    expect(result.request.candidates[0]).toMatchObject({ externalTransactionId: 'bank-row-9', reviewStatus: 'PENDING' })
    expect(result.request.records[0]).toMatchObject({ rowNumber: 8 })
  })

  it('carries every Money Forward semantic hint and named source field into staging', async () => {
    const sourceFields = { 計算対象: '1', 日付: '2026/07/12', 内容: 'カード引落', '金額(円)': '-1000', 保有金融機関: 'MUFG', 大項目: '振替', 中項目: 'カード', メモ: 'July', 振替: '1', ID: 'mf-1' }
    const parsed: ParsedImport<unknown> = { adapterId: 'money-forward-me-household-ledger-v1', issues: [], metadata: {}, records: [{
      kind: 'money-forward-household-transaction', lineage: { sourceRow: 2, sourceRowEnd: 2, rawFields: Object.values(sourceFields) },
      sourceFields, calculationTarget: false, transactionDate: '2026-07-12', content: 'カード引落', signedAmountJpy: -1000,
      institution: 'MUFG', majorCategory: '振替', minorCategory: 'カード', memo: 'July', isTransfer: true, externalTransactionId: 'mf-1',
    }] }
    const deps = dependencies(); const result = await mapParsedImportToStartImport(input(parsed), deps.ids, deps.hash)
    expect(result.request.candidates[0]).toMatchObject({
      accountId: 'account-1', direction: 'OUT', amountJpy: 1000, calculationTarget: false,
      suggestedTransactionType: 'TRANSFER', externalSource: 'MONEY_FORWARD_ME', externalTransactionId: 'mf-1',
      institutionRaw: 'MUFG', categoryMajorRaw: '振替', categoryMinorRaw: 'カード', memoRaw: 'July',
    })
    expect(result.request.candidates[0].externalFactHash).toHaveLength(64)
    expect(JSON.parse(result.request.records[0].payloadJson)).toMatchObject({ fields: sourceFields })
  })

  it('groups PayPay legs while preserving primary, supporting, and split-funding evidence', async () => {
    const parsed: ParsedImport<unknown> = { adapterId: 'paypay-history-v1', issues: [], metadata: {}, records: [{
      kind: 'wallet-event', transactionId: 'pay-1', occurredAt: '2026-07-10T12:30:00+09:00', counterparty: '店舗', eventType: 'Payment + Points, Balance Earned',
      totalOutgoing: 998, totalIncoming: 1, legs: [
        { lineage: { sourceRow: 2, sourceRowEnd: 2, rawFields: ['payment'] }, transactionType: 'Payment', outgoingAmount: 998, incomingAmount: null, paymentOption: 'Point (41yen), VISA (957yen)', funding: [{ method: 'Point', amount: 41, currency: 'JPY' }, { method: 'VISA', amount: 957, currency: 'JPY' }] },
        { lineage: { sourceRow: 3, sourceRowEnd: 3, rawFields: ['points'] }, transactionType: 'Points, Balance Earned', outgoingAmount: null, incomingAmount: 1, paymentOption: '', funding: [] },
      ],
    }] }
    const deps = dependencies(); const result = await mapParsedImportToStartImport(input(parsed), deps.ids, deps.hash)

    expect(result.request.records).toHaveLength(2)
    expect(result.request.candidates).toHaveLength(1)
    expect(result.request.candidates[0].evidence.map(({ role }) => role)).toEqual(['FUNDING_LEG', 'SUPPORTING'])
    expect(result.request.candidates[0]).toMatchObject({ amountJpy: 998, direction: 'OUT', externalTransactionId: 'pay-1' })
    expect(result.request.cardStatements).toEqual([])
  })

  it('maps card refunds and marks merged Rakuten lineage as continuation evidence', async () => {
    const parsed: ParsedImport<unknown> = { adapterId: 'rakuten-enavi-v1', issues: [], metadata: {}, records: [{
      kind: 'card-statement', issuer: 'RAKUTEN_CARD', statementTotal: -3666, transactions: [{
        kind: 'card-transaction', lineage: { sourceRow: 4, sourceRowEnd: 5, rawFields: ['ANTHROPIC', '-3666', '現地利用額 22.000'] },
        usageDate: '2026-06-20', merchant: 'ANTHROPIC', userName: '', paymentMethod: '一括', billingAmount: -3666,
        feeOrInterest: 0, originalAmount: 22, originalCurrency: 'USD', exchangeRate: 166.637, isRefund: true, rawExtra: {},
      }],
    }] }
    const deps = dependencies(); const result = await mapParsedImportToStartImport(input(parsed), deps.ids, deps.hash)

    expect(result.request.candidates[0]).toMatchObject({ amountJpy: 3666, direction: 'IN', merchantRaw: 'ANTHROPIC' })
    expect(result.request.candidates[0].evidence.map(({ role }) => role)).toEqual(['CONTINUATION'])
    expect(result.request.cardStatements).toEqual([])
  })

  it('retains card statement total and candidate line grouping', async () => {
    const parsed: ParsedImport<unknown> = { adapterId: 'rakuten-enavi-v1', issues: [], metadata: {}, records: [{
      kind: 'card-statement', issuer: 'RAKUTEN_CARD', statementTotal: 4000, transactions: [
        { kind: 'card-transaction', lineage: { sourceRow: 2, sourceRowEnd: 2, rawFields: ['STORE', '5000'] }, usageDate: '2026-06-10', merchant: 'STORE', userName: '', paymentMethod: '一括', billingAmount: 5000, feeOrInterest: 0, isRefund: false, rawExtra: {} },
        { kind: 'card-transaction', lineage: { sourceRow: 3, sourceRowEnd: 3, rawFields: ['REFUND', '-1000'] }, usageDate: '2026-06-20', merchant: 'REFUND', userName: '', paymentMethod: '一括', billingAmount: -1000, feeOrInterest: 0, isRefund: true, rawExtra: {} },
      ],
    }] }
    const deps = dependencies(); const result = await mapParsedImportToStartImport(input(parsed), deps.ids, deps.hash)

    expect(result.request.cardStatements).toHaveLength(1)
    expect(result.request.cardStatements[0]).toMatchObject({
      cardAccountId: 'account-1', issuer: 'RAKUTEN_CARD', periodStart: '2026-06-10', periodEnd: '2026-06-20', statementAmountJpy: 4000,
      lines: [{ statementLineNumber: 1, billedAmountJpy: 5000 }, { statementLineNumber: 2, billedAmountJpy: -1000 }],
    })
  })

  it('maps a JCB statement into pending card purchases with exact source-row provenance', async () => {
    const text = [
      'JCBカードご利用代金明細',
      'ご利用先など,ご利用日,お支払い金額(円),支払区分',
      '架空ストア,2026/06/01,1200,ショッピング',
      '架空返金,2026/06/03,-200,ショッピング',
      'お支払い合計,,1000,',
    ].join('\n')
    const parsed = jcbMyJcbAdapter.parse({ text, filename: 'myjcb.csv' }) as ParsedImport<unknown>
    const deps = dependencies(); const result = await mapParsedImportToStartImport(input(parsed), deps.ids, deps.hash)
    expect(result.issues).toEqual([])
    expect(result.request.records.map((record) => record.rowNumber)).toEqual([3, 4])
    expect(result.request.candidates).toHaveLength(2)
    expect(result.request.candidates[0]).toMatchObject({ direction: 'OUT', amountJpy: 1200, reviewStatus: 'PENDING', merchantRaw: '架空ストア' })
    expect(result.request.candidates[1]).toMatchObject({ direction: 'IN', amountJpy: 200, reviewStatus: 'PENDING', merchantRaw: '架空返金', descriptionRaw: 'REFUND / ショッピング' })
    expect(result.request.cardStatements[0]).toMatchObject({
      cardAccountId: 'account-1', issuer: 'JCB', statementAmountJpy: 1000,
      periodStart: '2026-06-01', periodEnd: '2026-06-03',
      lines: [{ statementLineNumber: 1, billedAmountJpy: 1200 }, { statementLineNumber: 2, billedAmountJpy: -200 }],
    })
  })

  it.each([
    ['invalid date', { transactionDate: '2026-02-30', outgoingAmount: 500, incomingAmount: null }, 'INVALID_DATE'],
    ['fractional amount', { transactionDate: '2026-02-20', outgoingAmount: 1.5, incomingAmount: null }, 'INVALID_AMOUNT'],
    ['both directions', { transactionDate: '2026-02-20', outgoingAmount: 500, incomingAmount: 500 }, 'AMBIGUOUS_DIRECTION'],
  ])('rejects %s instead of fabricating a candidate', async (_name, values, issueCode) => {
    const parsed: ParsedImport<unknown> = { adapterId: 'japanese-bank-ledger-v1', issues: [], metadata: {}, records: [{
      kind: 'bank-transaction', lineage: { sourceRow: 2, sourceRowEnd: 2, rawFields: ['bad'] }, description: '', descriptionDetail: '', balance: null,
      memo: '', fundsAvailabilityCode: '', debitCreditCode: '', suggestedType: 'UNKNOWN', ...values,
    }] }
    const deps = dependencies(); const result = await mapParsedImportToStartImport(input(parsed), deps.ids, deps.hash)
    expect(result.request.candidates).toEqual([])
    expect(result.issues).toContainEqual(expect.objectContaining({ code: issueCode, severity: 'error', sourceRow: 2 }))
  })

  it('does not map records when the detected and parsed adapter IDs differ', async () => {
    const parsed: ParsedImport<unknown> = { adapterId: 'paypay-history-v1', issues: [], metadata: {}, records: [] }
    const value = input(parsed); value.detectedAdapterId = 'japanese-bank-ledger-v1'
    const deps = dependencies(); const result = await mapParsedImportToStartImport(value, deps.ids, deps.hash)
    expect(result.issues[0].code).toBe('ADAPTER_MISMATCH')
    expect(result.request.records).toEqual([])
    expect(result.request.candidates).toEqual([])
  })

  it('caps source payload JSON and reports a structured issue', async () => {
    const parsed: ParsedImport<unknown> = { adapterId: 'japanese-bank-ledger-v1', issues: [], metadata: {}, records: [{
      kind: 'bank-transaction', lineage: { sourceRow: 2, sourceRowEnd: 2, rawFields: ['x'.repeat(1_048_576)] },
      transactionDate: '2026-07-01', description: '', descriptionDetail: '', outgoingAmount: 1, incomingAmount: null, balance: null,
      memo: '', fundsAvailabilityCode: '', debitCreditCode: '', suggestedType: 'UNKNOWN',
    }] }
    const deps = dependencies(); const result = await mapParsedImportToStartImport(input(parsed), deps.ids, deps.hash)
    expect(result.request.records).toEqual([])
    expect(result.request.candidates).toEqual([])
    expect(result.issues[0].code).toBe('PAYLOAD_TOO_LARGE')
  })
})
