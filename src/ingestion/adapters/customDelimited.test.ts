import { describe, expect, it } from 'vitest'
import { createCustomDelimitedAdapter, detectCustomDelimitedBytes, parseCustomDelimitedBytes, type SavedCustomParserProfileDto } from './customDelimited'

function profile(change: Partial<SavedCustomParserProfileDto> = {}): SavedCustomParserProfileDto {
  return {
    id: 'custom-bank', householdId: 'family', name: 'Custom bank', delimiter: 'COMMA', encoding: 'UTF8',
    headerRow: 1, dateColumn: 'Date', dateFormat: 'AUTO', descriptionColumn: 'Memo', payeeColumn: 'Payee',
    amountMode: 'SIGNED', signedAmountColumn: 'Amount', signedPositiveDirection: 'IN', debitColumn: null, creditColumn: null,
    externalIdColumn: 'ID', accountHintColumn: 'Account', isEnabled: true, priority: 10, version: 3,
    createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z', ...change,
  }
}

describe('custom delimited adapter', () => {
  it('decodes UTF-8 BOM, previews mapping, canonicalizes dates and preserves lineage', () => {
    const text = 'Date;Payee;Memo;Amount;ID;Account\n2026/07/12;Store;Lunch;-1,200;tx-1;bank-31\n2026/07/13;Employer;Salary;+300000;tx-2;bank-31'
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])
    const result = parseCustomDelimitedBytes(bytes, profile({ delimiter: 'SEMICOLON' }), { filename: 'custom.csv' })
    expect(detectCustomDelimitedBytes(bytes, profile({ delimiter: 'SEMICOLON' })).score).toBe(1)

    expect(result.preview).toMatchObject({ encoding: 'utf-8-bom', delimiter: ';', headerRow: 1, candidateCount: 2, rejectedRowCount: 0 })
    expect(result.preview.mappings.find((item) => item.role === 'SIGNED_AMOUNT')).toMatchObject({ matchedHeader: 'Amount', columnIndex: 3 })
    expect(result.parsed.records[0]).toMatchObject({
      transactionDate: '2026-07-12', description: 'Store', descriptionDetail: 'Lunch', outgoingAmount: 1200,
      incomingAmount: null, externalTransactionId: 'tx-1', accountHint: 'bank-31',
      lineage: { sourceRow: 2, sourceRowEnd: 2, rawFields: ['2026/07/12', 'Store', 'Lunch', '-1,200', 'tx-1', 'bank-31'] },
    })
    expect(result.parsed.records[1]).toMatchObject({ incomingAmount: 300000, outgoingAmount: null })
  })

  it('parses TSV debit/credit rows, skips whitespace, and excludes summaries', () => {
    const text = 'When\tDetails\tDebit\tCredit\n13/07/2026\tGrocer\t2500\t\n   \t \t \t \n\tTotal\t2500\t'
    const result = createCustomDelimitedAdapter(profile({
      delimiter: 'TAB', encoding: 'AUTO', dateColumn: 'When', dateFormat: 'DD_MM_YYYY',
      descriptionColumn: 'Details', payeeColumn: null, amountMode: 'DEBIT_CREDIT', signedAmountColumn: null,
      signedPositiveDirection: null, debitColumn: 'Debit', creditColumn: 'Credit', externalIdColumn: null, accountHintColumn: null,
    })).parseBytes(new TextEncoder().encode(text))

    expect(result.parsed.records).toHaveLength(1)
    expect(result.parsed.records[0]).toMatchObject({ transactionDate: '2026-07-13', outgoingAmount: 2500, incomingAmount: null })
    expect(result.preview).toMatchObject({ dataRowCount: 2, candidateCount: 1, rejectedRowCount: 1 })
    expect(result.parsed.issues).toContainEqual(expect.objectContaining({ code: 'CUSTOM_SUMMARY_ROW', row: 4, severity: 'warning' }))
  })

  it('honors POSITIVE_OUT signed profiles for charges and negative refunds', () => {
    const result = createCustomDelimitedAdapter(profile({ signedPositiveDirection: 'OUT' })).parse({
      text: 'Date,Payee,Memo,Amount,ID,Account\n2026-07-01,Store,Charge,1200,c-1,card\n2026-07-02,Store,Refund,-500,r-1,card',
    })
    expect(result.records).toHaveLength(2)
    expect(result.records[0]).toMatchObject({ outgoingAmount: 1200, incomingAmount: null, externalTransactionId: 'c-1' })
    expect(result.records[1]).toMatchObject({ outgoingAmount: null, incomingAmount: 500, externalTransactionId: 'r-1' })
  })

  it.each([
    ['both debit and credit populated', '2026-07-01,Shop,100,200', 'CUSTOM_AMOUNT_AMBIGUOUS'],
    ['zero debit', '2026-07-01,Shop,0,', 'CUSTOM_AMOUNT_AMBIGUOUS'],
    ['no debit or credit', '2026-07-01,Shop,,', 'CUSTOM_AMOUNT_AMBIGUOUS'],
  ])('rejects ambiguous debit/credit rows: %s', (_name, row, code) => {
    const configured = profile({
      descriptionColumn: 'Payee', payeeColumn: null, amountMode: 'DEBIT_CREDIT', signedAmountColumn: null,
      signedPositiveDirection: null, debitColumn: 'Debit', creditColumn: 'Credit', externalIdColumn: null, accountHintColumn: null,
    })
    const result = createCustomDelimitedAdapter(configured).parse({ text: `Date,Payee,Debit,Credit\n${row}` })
    expect(result.records).toEqual([])
    expect(result.issues).toContainEqual(expect.objectContaining({ code, row: 2, severity: 'error' }))
  })

  it('rejects duplicate headers and date ambiguity instead of guessing', () => {
    const duplicate = createCustomDelimitedAdapter(profile({ descriptionColumn: null, payeeColumn: 'Payee' }))
      .parse({ text: 'Date,Payee,Payee,Amount,ID,Account\n2026-07-01,A,B,-1,x,bank' })
    expect(duplicate.records).toEqual([])
    expect(duplicate.issues).toContainEqual(expect.objectContaining({ code: 'CUSTOM_HEADER_AMBIGUOUS' }))

    const ambiguousDate = createCustomDelimitedAdapter(profile()).parse({ text: 'Date,Payee,Memo,Amount,ID,Account\n01/02/2026,Shop,,100,x,bank' })
    expect(ambiguousDate.records).toEqual([])
    expect(ambiguousDate.issues).toContainEqual(expect.objectContaining({ code: 'CUSTOM_DATE_INVALID', row: 2 }))
  })

  it('uses the host CP932 decoder when the saved profile requires it', () => {
    // CP932 bytes for 日付 followed by ASCII columns and data.
    const bytes = new Uint8Array([
      0x93, 0xfa, 0x95, 0x74, 0x2c, ...new TextEncoder().encode('Payee,Amount\n2026-07-01,Shop,-500'),
    ])
    const result = parseCustomDelimitedBytes(bytes, profile({
      encoding: 'CP932', dateColumn: '日付', descriptionColumn: null, payeeColumn: 'Payee',
      externalIdColumn: null, accountHintColumn: null,
    }))
    expect(result.preview.encoding).toBe('shift_jis')
    expect(result.parsed.records[0]).toMatchObject({ transactionDate: '2026-07-01', outgoingAmount: 500, description: 'Shop' })
  })

  it('fails closed when AUTO encoding is invalid for both UTF-8 and CP932', () => {
    const bytes = new Uint8Array([0x80, ...new TextEncoder().encode(',Payee,Amount\n2026-07-01,Shop,-500')])
    const result = parseCustomDelimitedBytes(bytes, profile({ encoding: 'AUTO' }))

    expect(result.parsed.records).toEqual([])
    expect(result.preview.candidateCount).toBe(0)
    expect(result.preview.issues).toContainEqual(expect.objectContaining({ code: 'CUSTOM_ENCODING_INVALID', severity: 'error' }))
  })

  it('rejects invalid or disabled saved profiles before emitting candidates', () => {
    const result = createCustomDelimitedAdapter(profile({ isEnabled: false, descriptionColumn: null, payeeColumn: null }))
      .parse({ text: 'Date,Amount\n2026-07-01,-500' })
    expect(result.records).toEqual([])
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['CUSTOM_PROFILE_DISABLED', 'CUSTOM_DESCRIPTION_MISSING']))
  })

  it('requires signed direction only for signed amount profiles', () => {
    const missingDirection = createCustomDelimitedAdapter(profile({ signedPositiveDirection: null }))
      .parse({ text: 'Date,Payee,Memo,Amount,ID,Account\n2026-07-01,Shop,,500,x,bank' })
    expect(missingDirection.records).toEqual([])
    expect(missingDirection.issues).toContainEqual(expect.objectContaining({ code: 'CUSTOM_AMOUNT_MAPPING_INVALID' }))

    const unexpectedDirection = createCustomDelimitedAdapter(profile({
      amountMode: 'DEBIT_CREDIT', signedAmountColumn: null, signedPositiveDirection: 'OUT', debitColumn: 'Debit', creditColumn: 'Credit',
    })).parse({ text: 'Date,Payee,Memo,Debit,Credit,ID,Account\n2026-07-01,Shop,,500,,x,bank' })
    expect(unexpectedDirection.records).toEqual([])
    expect(unexpectedDirection.issues).toContainEqual(expect.objectContaining({ code: 'CUSTOM_AMOUNT_MAPPING_INVALID' }))
  })
})
