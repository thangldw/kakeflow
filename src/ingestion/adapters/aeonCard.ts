import { normalizeHeader, rowObject, tokenizeCsv } from '../csv'
import { clampScore, normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { CardStatementCandidate, CardTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

const PROVIDER_MARKER = /(?:イオンカードご利用明細|AEON\s*CARD\s*(?:STATEMENT|ご利用明細))/i
const DATE_HEADERS = ['ご利用日', '利用日', 'ご利用年月日'] as const
const MERCHANT_HEADERS = ['ご利用先', '利用先', 'ご利用店名'] as const
const USAGE_AMOUNT_HEADERS = ['ご利用金額(円)', 'ご利用金額', '利用金額(円)', '利用金額'] as const
const PAYMENT_HEADERS = ['支払区分', 'お支払区分', 'お支払い方法'] as const
const BILLED_AMOUNT_HEADERS = ['今回ご請求額(円)', '今回ご請求額', '今回のお支払い金額(円)', '今回のお支払い金額'] as const
const USER_HEADERS = ['カード利用者', 'ご利用者', '利用者'] as const
const TOTAL_LABEL = /^(?:お支払い|ご請求|今回ご請求)(?:金額)?合計$/
const REFUND_MARKER = /取消|返品|返金|キャンセル/
const UNSUPPORTED_PAYMENT = /リボ|分割|ボーナス|据置|繰越|スキップ|あとから/
const MASKED_CARD_MARKER = /^(?=.*\d)(?=.*[*Xx＊])[\d*Xx＊ -]{6,}$/

function firstHeader(headers: readonly string[], candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => headers.includes(candidate))
}

function findHeaderIndex(rows: ReturnType<typeof tokenizeCsv>['rows']): number {
  return rows.slice(0, 12).findIndex((row) => {
    const headers = row.fields.map(normalizeHeader)
    return Boolean(firstHeader(headers, DATE_HEADERS))
      && Boolean(firstHeader(headers, MERCHANT_HEADERS))
      && Boolean(firstHeader(headers, USAGE_AMOUNT_HEADERS))
      && Boolean(firstHeader(headers, PAYMENT_HEADERS))
      && Boolean(firstHeader(headers, BILLED_AMOUNT_HEADERS))
  })
}

function hasProviderMarker(rows: ReturnType<typeof tokenizeCsv>['rows'], headerIndex: number): boolean {
  if (headerIndex < 0) return false
  return rows.slice(0, headerIndex).some((row) => PROVIDER_MARKER.test(normalizeJapaneseText(row.fields.join(' '))))
}

function isOneTimePayment(value: string): boolean {
  const normalized = normalizeJapaneseText(value)
  return /^(?:一括|1回払い|1回|1)$/.test(normalized) && !UNSUPPORTED_PAYMENT.test(normalized)
}

function metadataValue(rows: ReturnType<typeof tokenizeCsv>['rows'], labels: RegExp): string | undefined {
  const row = rows.find((candidate) => labels.test(normalizeHeader(candidate.fields[0] ?? '')))
  const value = normalizeJapaneseText(row?.fields[1] ?? '')
  return value || undefined
}

/**
 * Strict AEON finalized-statement adapter based on a screen-derived synthetic
 * contract. AEON does not publish a literal CSV schema for this contract, so
 * layouts outside these named fields are rejected instead of inferred.
 */
export const aeonCardAdapter: ImportAdapter<CardStatementCandidate> = {
  id: 'aeon-card-finalized-statement-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const headerIndex = findHeaderIndex(csv.rows)
    if (headerIndex < 0) return { adapterId: this.id, score: 0, reasons: ['Required AEON finalized-statement headers not found'] }
    if (!hasProviderMarker(csv.rows, headerIndex)) return { adapterId: this.id, score: 0, reasons: ['AEON provider marker not found before the detail header'] }
    const headers = csv.rows[headerIndex].fields.map(normalizeHeader)
    const billedHeader = firstHeader(headers, BILLED_AMOUNT_HEADERS)!
    const totalSignal = csv.rows.slice(headerIndex + 1).some((row) => {
      const value = rowObject(headers, row)
      return row.fields.some((field) => TOTAL_LABEL.test(normalizeJapaneseText(field)))
        && parseJapaneseAmount(value[billedHeader]) != null
    })
    const detailSignal = csv.rows.slice(headerIndex + 1).some((row) => parseJapaneseDate(row.fields[headers.indexOf(firstHeader(headers, DATE_HEADERS)!)]) != null)
    if (!totalSignal || !detailSignal) return { adapterId: this.id, score: 0, reasons: ['Final total and dated detail rows are both required'] }
    return {
      adapterId: this.id,
      score: clampScore(0.99),
      reasons: ['AEON content marker found', 'Named finalized-statement fields, dated detail, and explicit total found'],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const headerIndex = findHeaderIndex(csv.rows)
    if (headerIndex < 0) {
      return { adapterId: this.id, records: [], issues: [{ code: 'AEON_HEADER_MISSING', message: 'Supported AEON finalized-statement headers were not found.', severity: 'error' }], metadata: {} }
    }
    if (!hasProviderMarker(csv.rows, headerIndex)) {
      return { adapterId: this.id, records: [], issues: [{ code: 'AEON_PROVIDER_MARKER_MISSING', message: 'An AEON provider marker is required before the detail header.', severity: 'error' }], metadata: {} }
    }

    const markerRows = csv.rows.slice(0, headerIndex).filter((row) => PROVIDER_MARKER.test(normalizeJapaneseText(row.fields.join(' '))))
    if (markerRows.length > 1) {
      issues.push({ code: 'AEON_MULTIPLE_SECTIONS_UNSUPPORTED', message: 'A file containing multiple AEON statement sections cannot be assigned safely to one card account.', severity: 'error', row: markerRows[1].sourceRow })
    }

    const headers = csv.rows[headerIndex].fields.map(normalizeHeader)
    const dateHeader = firstHeader(headers, DATE_HEADERS)!
    const merchantHeader = firstHeader(headers, MERCHANT_HEADERS)!
    const usageHeader = firstHeader(headers, USAGE_AMOUNT_HEADERS)!
    const paymentHeader = firstHeader(headers, PAYMENT_HEADERS)!
    const billedHeader = firstHeader(headers, BILLED_AMOUNT_HEADERS)!
    const userHeader = firstHeader(headers, USER_HEADERS)
    const transactions: CardTransactionCandidate[] = []
    let explicitStatementTotal: number | null = null
    let totalRow: number | undefined

    for (const row of csv.rows.slice(headerIndex + 1)) {
      const value = rowObject(headers, row)
      const normalizedRow = normalizeJapaneseText(row.fields.join(' '))
      if (row.fields.some((field) => TOTAL_LABEL.test(normalizeJapaneseText(field)))) {
        if (totalRow != null) {
          issues.push({ code: 'AEON_MULTIPLE_TOTALS_UNSUPPORTED', message: 'Exactly one AEON statement total is supported.', severity: 'error', row: row.sourceRow })
          continue
        }
        totalRow = row.sourceRow
        const parsedTotal = parseJapaneseAmount(value[billedHeader])
        if (parsedTotal == null || !Number.isSafeInteger(parsedTotal) || parsedTotal <= 0) {
          issues.push({ code: 'AEON_TOTAL_INVALID', message: 'The explicit AEON statement total must be a positive integer JPY amount.', severity: 'error', row: row.sourceRow, column: billedHeader })
        } else explicitStatementTotal = parsedTotal
        continue
      }

      const rawDate = value[dateHeader] ?? ''
      const usageDate = parseJapaneseDate(rawDate)
      if (!usageDate) {
        if (rawDate.trim() || normalizedRow) issues.push({ code: 'AEON_DATE_INVALID', message: 'AEON detail row has an invalid calendar date.', severity: 'error', row: row.sourceRow, column: dateHeader })
        continue
      }
      const merchant = normalizeJapaneseText(value[merchantHeader] ?? '')
      if (!merchant) {
        issues.push({ code: 'AEON_MERCHANT_MISSING', message: 'AEON detail row has no merchant.', severity: 'error', row: row.sourceRow, column: merchantHeader })
        continue
      }
      const usageAmount = parseJapaneseAmount(value[usageHeader])
      const billingAmount = parseJapaneseAmount(value[billedHeader])
      if (usageAmount == null || billingAmount == null
        || !Number.isSafeInteger(usageAmount) || !Number.isSafeInteger(billingAmount)
        || usageAmount === 0 || billingAmount === 0) {
        issues.push({ code: 'AEON_AMOUNT_INVALID', message: 'AEON detail row requires non-zero integer JPY usage and billed amounts.', severity: 'error', row: row.sourceRow, column: `${usageHeader} / ${billedHeader}` })
        continue
      }
      const paymentMethod = normalizeJapaneseText(value[paymentHeader] ?? '')
      if (!isOneTimePayment(paymentMethod) || usageAmount !== billingAmount) {
        issues.push({ code: 'AEON_DEFERRED_PAYMENT_UNSUPPORTED', message: 'Installment, revolving, bonus, or partially billed AEON payments are not supported by this adapter.', severity: 'error', row: row.sourceRow, column: `${paymentHeader} / ${billedHeader}` })
        continue
      }
      if (REFUND_MARKER.test(normalizedRow) && billingAmount > 0) {
        issues.push({ code: 'AEON_REFUND_SIGN_AMBIGUOUS', message: 'AEON refund-like detail has a positive billed amount; verify the source sign before importing.', severity: 'error', row: row.sourceRow, column: billedHeader })
        continue
      }

      transactions.push({
        kind: 'card-transaction',
        lineage: row,
        usageDate,
        merchant,
        userName: normalizeJapaneseText(userHeader ? value[userHeader] ?? '' : ''),
        paymentMethod,
        billingAmount,
        feeOrInterest: null,
        isRefund: billingAmount < 0,
        rawExtra: Object.fromEntries(headers
          .filter((header) => ![dateHeader, merchantHeader].includes(header))
          .map((header) => [header, value[header] ?? ''])),
      })
    }

    if (totalRow == null) issues.push({ code: 'AEON_TOTAL_MISSING', message: 'A finalized AEON statement requires one explicit statement total.', severity: 'error', column: billedHeader })
    if (transactions.length === 0) issues.push({ code: 'AEON_DETAILS_MISSING', message: 'No valid AEON statement detail rows were found.', severity: 'error' })
    const computedTotal = transactions.reduce((sum, transaction) => sum + (transaction.billingAmount ?? 0), 0)
    if (explicitStatementTotal != null && explicitStatementTotal !== computedTotal) {
      issues.push({ code: 'AEON_TOTAL_MISMATCH', message: `Detail sum (${computedTotal}) does not match statement total (${explicitStatementTotal}).`, severity: 'error' })
    }

    const metadataRows = csv.rows.slice(0, headerIndex)
    const holderName = metadataValue(metadataRows, /^(?:カード会員名|会員名|カード名義)$/)?.replace(/\s*様\s*$/, '').trim()
    const maskedCardNumber = metadataValue(metadataRows, /^(?:カード番号|カードNo\.?|カードNO\.?)$/i)
    if (maskedCardNumber && !MASKED_CARD_MARKER.test(maskedCardNumber)) {
      issues.push({ code: 'AEON_CARD_NUMBER_UNSAFE', message: 'AEON card number metadata must be masked before import.', severity: 'error', row: metadataRows.find((row) => /カード番号/.test(normalizeHeader(row.fields[0] ?? '')))?.sourceRow })
    }
    const statementMonth = markerRows[0]?.fields.map(normalizeJapaneseText).find((field) => /\d{4}年\d{1,2}月(?:ご請求分|お支払い分)/.test(field))
    return {
      adapterId: this.id,
      records: [{
        kind: 'card-statement', issuer: 'AEON_CARD', holderName, maskedCardNumber,
        productName: 'イオンカード', statementMonth, statementTotal: explicitStatementTotal, transactions,
      }],
      issues,
      metadata: { headerRow: csv.rows[headerIndex].sourceRow, totalRow, detailCount: transactions.length, statementTotalSource: explicitStatementTotal == null ? 'MISSING' : 'EXPLICIT_TOTAL', schemaBasis: 'SCREEN_DERIVED_SYNTHETIC' },
    }
  },
}
