import { normalizeHeader, rowObject, tokenizeCsv } from '../csv'
import { clampScore, normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { CardStatementCandidate, CardTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

const BASE_HEADERS = ['利用日', '利用店名・商品名', '利用者', '支払方法', '利用金額']

export const rakutenEnaviAdapter: ImportAdapter<CardStatementCandidate> = {
  id: 'rakuten-enavi-v1',
  detect(input) {
    const rows = tokenizeCsv(input.text).rows.slice(0, 5)
    const hits = Math.max(0, ...rows.map((row) => BASE_HEADERS.filter((header) => row.fields.map(normalizeHeader).includes(header)).length))
    const dynamic = rows.some((row) => row.fields.some((field) => /^\d{1,2}月支払金額$/.test(normalizeHeader(field))))
    return { adapterId: this.id, score: clampScore(hits / BASE_HEADERS.length * 0.85 + (dynamic ? 0.15 : 0)), reasons: [`${hits}/${BASE_HEADERS.length} base columns matched`, dynamic ? 'Monthly payment column found' : 'Monthly payment column missing'] }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text); const issues: ParseIssue[] = [...csv.issues]
    const headerIndex = csv.rows.findIndex((row) => BASE_HEADERS.every((header) => row.fields.map(normalizeHeader).includes(header)))
    if (headerIndex < 0) return { adapterId: this.id, records: [], issues: [{ code: 'RAKUTEN_HEADER_MISSING', message: 'Rakuten e-NAVI header was not found.', severity: 'error' }], metadata: {} }
    const headers = csv.rows[headerIndex].fields.map(normalizeHeader); const paymentHeader = headers.find((header) => /^\d{1,2}月支払金額$/.test(header)); const transactions: CardTransactionCandidate[] = []
    for (const row of csv.rows.slice(headerIndex + 1)) {
      const value = rowObject(headers, row); const date = parseJapaneseDate(value['利用日'])
      if (!date) {
        const text = normalizeJapaneseText(row.fields.join(' ')); const previous = transactions[transactions.length - 1]
        const original = text.match(/現地利用額\s*([\d,.]+)/); const rate = text.match(/変換レート\s*([\d,.]+)円?/)
        if (previous && (original || rate)) {
          if (original) previous.originalAmount = Number(original[1].replace(/,/g, ''))
          if (rate) previous.exchangeRate = Number(rate[1].replace(/,/g, ''))
          const currency = text.match(/\b(USD|EUR|GBP|AUD|CAD|KRW|CNY)\b/i); if (currency) previous.originalCurrency = currency[1].toUpperCase()
          previous.lineage = { sourceRow: previous.lineage.sourceRow, sourceRowEnd: row.sourceRowEnd, rawFields: [...previous.lineage.rawFields, ...row.rawFields] }
        } else if (text) issues.push({ code: 'RAKUTEN_CONTINUATION_OR_SUMMARY_SKIPPED', message: 'Unrecognized continuation or summary row skipped.', severity: 'warning', row: row.sourceRow })
        continue
      }
      const billingAmount = parseJapaneseAmount(paymentHeader ? value[paymentHeader] : value['当月請求額']) ?? parseJapaneseAmount(value['支払総額']) ?? parseJapaneseAmount(value['利用金額'])
      transactions.push({ kind: 'card-transaction', lineage: row, usageDate: date, merchant: normalizeJapaneseText(value['利用店名・商品名'] ?? ''), userName: value['利用者'] ?? '', paymentMethod: value['支払方法'] ?? '', billingAmount, feeOrInterest: parseJapaneseAmount(value['手数料/利息']), isRefund: (billingAmount ?? 0) < 0 || /返品|返金/.test(value['利用店名・商品名'] ?? ''), rawExtra: Object.fromEntries(headers.filter((header) => !BASE_HEADERS.includes(header)).map((header) => [header, value[header] ?? ''])) })
    }
    const statementTotal = transactions.reduce((sum, tx) => sum + (tx.billingAmount ?? 0), 0)
    const monthMatch = paymentHeader?.match(/^(\d{1,2})月/)
    return { adapterId: this.id, records: [{ kind: 'card-statement', issuer: 'RAKUTEN_CARD', statementMonth: monthMatch?.[1], statementTotal, transactions }], issues, metadata: { paymentColumn: paymentHeader, detailCount: transactions.length } }
  },
}
