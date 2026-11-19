import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectImportAdapter, ofxBankStatementAdapter } from '../index'

const fixture = readFileSync('src/ingestion/fixtures/ofx-bank.synthetic.ofx', 'utf8')
const errors = (text: string) => ofxBankStatementAdapter.parse({ text }).issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code)

describe('OFX/QFX bank-statement adapter', () => {
  it('detects by content and parses SGML transactions with durable ids and lineage', () => {
    expect(detectImportAdapter({ text: fixture, filename: 'download.bin' })?.adapter.id).toBe('ofx-bank-statement-v1')
    const parsed = ofxBankStatementAdapter.parse({ text: fixture })

    expect(parsed.issues).toEqual([])
    expect(parsed.metadata).toMatchObject({ ledgerBalance: '748800', ledgerBalanceAsOf: '2026-01-31', accountCount: 1 })
    expect(parsed.records).toHaveLength(2)
    expect(parsed.records[0]).toMatchObject({
      kind: 'bank-transaction', transactionDate: '2026-01-05', outgoingAmount: 1200, incomingAmount: null,
      description: 'Synthetic Store & Co', descriptionDetail: 'Groceries', debitCreditCode: 'OUT',
      externalTransactionId: 'ofx:0001:1234567:20260105-001',
    })
    expect(parsed.records[0].lineage.rawFields).toContain('FITID=20260105-001')
    expect(parsed.records[0].lineage.sourceRow).toBeLessThan(parsed.records[0].lineage.sourceRowEnd)
    expect(parsed.records[1]).toMatchObject({ transactionDate: '2026-01-25', incomingAmount: 250000, outgoingAmount: null, description: 'Synthetic Employer', descriptionDetail: '' })
  })

  it('parses OFX 2.x XML with closed leaf tags', () => {
    const xml = `<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>JPY</CURDEF>
      <BANKACCTFROM><BANKID>1</BANKID><ACCTID>9</ACCTID></BANKACCTFROM><BANKTRANLIST>
      <STMTTRN><DTPOSTED>20260301</DTPOSTED><TRNAMT>-500</TRNAMT><FITID>x1</FITID><NAME>Cafe</NAME></STMTTRN>
      </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
    const parsed = ofxBankStatementAdapter.parse({ text: xml })
    expect(parsed.issues).toEqual([])
    expect(parsed.records[0]).toMatchObject({ transactionDate: '2026-03-01', outgoingAmount: 500, externalTransactionId: 'ofx:1:9:x1' })
  })

  it('fails closed on currency, fractional yen, duplicate or missing FITID, bad dates and corrections', () => {
    expect(errors(fixture.replace('<CURDEF>JPY', '<CURDEF>USD'))).toContain('OFX_CURRENCY_UNSUPPORTED')
    expect(errors(fixture.replace('<TRNAMT>-1200', '<TRNAMT>-1200.50'))).toContain('OFX_AMOUNT_INVALID')
    expect(errors(fixture.replace('<TRNAMT>-1200', '<TRNAMT>0'))).toContain('OFX_AMOUNT_INVALID')
    expect(errors(fixture.replace('<FITID>20260125-001', '<FITID>20260105-001'))).toContain('OFX_FITID_DUPLICATE')
    expect(errors(fixture.replace('<FITID>20260125-001\n', ''))).toContain('OFX_FITID_MISSING')
    expect(errors(fixture.replace('<DTPOSTED>20260125', '<DTPOSTED>20260231'))).toContain('OFX_DATE_INVALID')
    expect(errors(fixture.replace('<FITID>20260125-001', '<FITID>20260125-001\n<CORRECTFITID>20260105-001\n<CORRECTACTION>REPLACE'))).toContain('OFX_CORRECTION_UNSUPPORTED')
  })

  it('rejects credit-card statements and multi-account files instead of guessing a destination', () => {
    const card = fixture.replaceAll('STMTRS', 'CCSTMTRS')
    expect(errors(card)).toContain('OFX_UNSUPPORTED_STATEMENT_TYPE')
    expect(ofxBankStatementAdapter.parse({ text: card }).records).toEqual([])
    const second = fixture.replace('</STMTRS>', '</STMTRS></STMTTRNRS><STMTTRNRS><STMTRS><CURDEF>JPY<BANKACCTFROM><BANKID>0001<ACCTID>7654321</BANKACCTFROM></STMTRS>')
    expect(errors(second)).toContain('OFX_MULTIPLE_ACCOUNTS')
  })

  it('does not match CSV or unrelated text', () => {
    expect(ofxBankStatementAdapter.detect({ text: '日付,金額\n2026/01/01,100' }).score).toBe(0)
    expect(ofxBankStatementAdapter.detect({ text: '<OFX></OFX>' }).score).toBe(0)
  })
})
