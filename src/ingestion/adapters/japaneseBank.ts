import { normalizeHeader, rowObject, tokenizeCsv } from '../csv'
import { clampScore, normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { BankTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

const REQUIRED = ['日付', '摘要', '支払い金額', '預かり金額', '差引残高']

export const japaneseBankAdapter: ImportAdapter<BankTransactionCandidate> = {
  id: 'japanese-bank-ledger-v1',
  detect(input) {
    const firstRows = tokenizeCsv(input.text).rows.slice(0, 8)
    const best = Math.max(0, ...firstRows.map((row) => {
      const cells = row.fields.map(normalizeHeader)
      return REQUIRED.filter((header) => cells.includes(header)).length
    }))
    return { adapterId: this.id, score: clampScore(best / REQUIRED.length), reasons: [`${best}/${REQUIRED.length} required bank headers matched`] }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const headerIndex = csv.rows.findIndex((row) => REQUIRED.every((header) => row.fields.map(normalizeHeader).includes(header)))
    if (headerIndex < 0) return { adapterId: this.id, records: [], issues: [...issues, { code: 'BANK_HEADER_MISSING', message: 'Japanese bank ledger header was not found.', severity: 'error' }], metadata: {} }
    const headers = csv.rows[headerIndex].fields.map(normalizeHeader)
    const records = csv.rows.slice(headerIndex + 1).map((row) => {
      const value = rowObject(headers, row)
      const outgoingAmount = parseJapaneseAmount(value['支払い金額'])
      const incomingAmount = parseJapaneseAmount(value['預かり金額'])
      const description = normalizeJapaneseText(value['摘要'] ?? '')
      const date = parseJapaneseDate(value['日付'])
      if (!date) issues.push({ code: 'BANK_DATE_INVALID', message: `Invalid transaction date: ${value['日付']}`, severity: 'warning', row: row.sourceRow, column: '日付' })
      if (outgoingAmount == null && incomingAmount == null) issues.push({ code: 'BANK_AMOUNT_MISSING', message: 'Both debit and credit amounts are empty.', severity: 'warning', row: row.sourceRow })
      const cardPayment = /(カード|CARD|JCB|AMEX|アメックス)/i.test(description)
      return {
        kind: 'bank-transaction' as const, lineage: row, accountHint: input.accountHint,
        transactionDate: date, description, descriptionDetail: normalizeJapaneseText(value['摘要内容'] ?? ''),
        outgoingAmount, incomingAmount, balance: parseJapaneseAmount(value['差引残高']), memo: value['メモ'] ?? '',
        fundsAvailabilityCode: value['未資金化区分'] ?? '', debitCreditCode: value['入払区分'] ?? '',
        suggestedType: cardPayment ? 'CARD_PAYMENT' as const : 'UNKNOWN' as const,
      }
    })
    return { adapterId: this.id, records, issues, metadata: { delimiter: csv.delimiter, headerRow: csv.rows[headerIndex].sourceRow } }
  },
}
