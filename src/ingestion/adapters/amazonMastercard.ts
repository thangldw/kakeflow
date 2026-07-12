import { tokenizeCsv } from '../csv'
import { clampScore, normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { CardStatementCandidate, CardTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

export const amazonMastercardAdapter: ImportAdapter<CardStatementCandidate> = {
  id: 'amazon-mastercard-statement-v1',
  detect(input) {
    const sample = input.text.slice(0, 2_000).normalize('NFKC')
    const product = /Amazon\s*マスター|Amazon\s*Mastercard/i.test(sample)
    const headerless = !sample.includes('利用日,利用店名')
    return { adapterId: this.id, score: clampScore((product ? 0.85 : 0) + (product && headerless ? 0.15 : 0)), reasons: [product ? 'Amazon Mastercard product metadata found' : 'Product metadata not found', headerless ? 'Headerless layout detected' : 'Header-like row detected'] }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text); const issues: ParseIssue[] = [...csv.issues]
    const metadata = csv.rows[0]
    if (!metadata || !metadata.fields.join(' ').normalize('NFKC').match(/Amazon\s*マスター|Amazon\s*Mastercard/i)) return { adapterId: this.id, records: [], issues: [{ code: 'AMAZON_METADATA_MISSING', message: 'Amazon Mastercard metadata row was not found.', severity: 'error' }], metadata: {} }
    const transactions: CardTransactionCandidate[] = []; let statementTotal: number | null = null
    for (const row of csv.rows.slice(1)) {
      const date = parseJapaneseDate(row.fields[0]); const amounts = row.fields.map(parseJapaneseAmount)
      if (!date) {
        const likelyTotal = amounts.slice().reverse().find((amount) => amount != null) ?? null
        if (/合計|請求/.test(row.fields.join(' ')) || row === csv.rows[csv.rows.length - 1]) statementTotal = likelyTotal
        else issues.push({ code: 'AMAZON_ROW_SKIPPED', message: 'Non-detail row skipped.', severity: 'warning', row: row.sourceRow })
        continue
      }
      const billingAmount = amounts.slice(2).find((amount) => amount != null) ?? null
      const note = normalizeJapaneseText(row.fields.join(' '))
      transactions.push({ kind: 'card-transaction', lineage: row, usageDate: date, merchant: normalizeJapaneseText(row.fields[1] ?? ''), userName: '', paymentMethod: row.fields[3] ?? '', billingAmount, feeOrInterest: null, isRefund: (billingAmount ?? 0) < 0 || /返品|返金/.test(note), rawExtra: Object.fromEntries(row.fields.slice(2).map((value, index) => [`raw_col_${index + 3}`, value])) })
    }
    const sum = transactions.reduce((total, tx) => total + (tx.billingAmount ?? 0), 0)
    if (statementTotal != null && sum !== statementTotal) issues.push({ code: 'AMAZON_TOTAL_MISMATCH', message: `Detail sum (${sum}) does not match statement total (${statementTotal}).`, severity: 'warning' })
    return { adapterId: this.id, records: [{ kind: 'card-statement', issuer: 'AMAZON_MASTERCARD', holderName: metadata.fields[0], maskedCardNumber: metadata.fields[1], productName: metadata.fields[2], statementTotal, transactions }], issues, metadata: { detailCount: transactions.length } }
  },
}
