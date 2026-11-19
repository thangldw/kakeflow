import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectImportAdapter, qifBankAdapter } from '../index'

const fixture = readFileSync('src/ingestion/fixtures/qif-bank.synthetic.qif', 'utf8')
const errors = (text: string) => qifBankAdapter.parse({ text }).issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code)
const register = (...records: string[]) => `!Type:Bank\n${records.map((record) => `${record}\n^`).join('\n')}\n`

describe('QIF bank adapter', () => {
  it('detects by content and parses Quicken apostrophe dates, thousands separators and lineage', () => {
    expect(detectImportAdapter({ text: fixture, filename: 'export.txt' })?.adapter.id).toBe('qif-bank-v1')
    const parsed = qifBankAdapter.parse({ text: fixture })

    expect(parsed.issues).toEqual([])
    expect(parsed.records).toHaveLength(2)
    expect(parsed.records[0]).toMatchObject({
      kind: 'bank-transaction', transactionDate: '2026-01-05', outgoingAmount: 1200, incomingAmount: null,
      description: 'Synthetic Store', descriptionDetail: 'Groceries', lineage: { sourceRow: 2, sourceRowEnd: 7 },
    })
    expect(parsed.records[0]).not.toHaveProperty('externalTransactionId')
    expect(parsed.records[1]).toMatchObject({ transactionDate: '2026-01-25', incomingAmount: 250000 })
  })

  it('proves a/b/YYYY date order from the whole file and refuses to guess', () => {
    const dayFirst = qifBankAdapter.parse({ text: register('D25/01/2026\nT-100\nPA', 'D05/02/2026\nT-200\nPB') })
    expect(dayFirst.issues).toEqual([])
    expect(dayFirst.records.map((record) => record.transactionDate)).toEqual(['2026-01-25', '2026-02-05'])
    expect(dayFirst.metadata).toMatchObject({ dateOrder: 'DMY' })

    const monthFirst = qifBankAdapter.parse({ text: register('D01/25/2026\nT-100', 'D02/05/2026\nT-200') })
    expect(monthFirst.records.map((record) => record.transactionDate)).toEqual(['2026-01-25', '2026-02-05'])

    expect(errors(register('D02/05/2026\nT-200'))).toEqual(['QIF_DATE_ORDER_AMBIGUOUS'])
    expect(errors(register('D25/01/2026\nT-1', 'D01/25/2026\nT-2'))).toContain('QIF_DATE_ORDER_CONFLICT')
    expect(errors(register('D05/05/2026\nT-200'))).toEqual([])
  })

  it('fails closed on splits, other types, account blocks, fractional yen, two-digit slash years and unterminated records', () => {
    expect(errors(register('D2026-01-05\nT-100\nSFood\n$-100'))).toContain('QIF_SPLIT_UNSUPPORTED')
    expect(errors('!Type:CCard\nD2026-01-05\nT-100\n^\n')).toEqual(['QIF_TYPE_UNSUPPORTED'])
    expect(errors(`!Account\nNMain\n^\n${register('D2026-01-05\nT-100')}`)).toContain('QIF_ACCOUNT_BLOCKS_UNSUPPORTED')
    expect(errors(register('D2026-01-05\nT-100.5'))).toContain('QIF_AMOUNT_INVALID')
    expect(errors(register('D01/05/26\nT-100'))).toContain('QIF_DATE_INVALID')
    expect(errors('!Type:Bank\nD2026-01-05\nT-100\n')).toContain('QIF_RECORD_UNTERMINATED')
    expect(errors(register('D2026-02-30\nT-100'))).toContain('QIF_DATE_INVALID')
  })
})
