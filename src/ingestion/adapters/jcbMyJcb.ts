import { normalizeHeader, rowObject, tokenizeCsv } from '../csv'
import { clampScore, normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { CardStatementCandidate, CardTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

const DATE_HEADERS = ['ご利用日', '利用日'] as const
const MERCHANT_HEADERS = ['ご利用先など', 'ご利用先など(漢字)'] as const
const BILLED_AMOUNT_HEADERS = ['お支払い金額(円)', 'お支払い金額', '今回のお支払い金額(円)', '今回のお支払金額(円)'] as const
const USAGE_AMOUNT_HEADERS = ['ご利用金額(円)', 'ご利用金額'] as const
const USER_HEADERS = ['利用者氏名', 'ご利用者', 'カードご利用者'] as const
const ORIGINAL_AMOUNT_HEADERS = ['現地通貨利用金額', '現地通貨額'] as const
const CURRENCY_HEADERS = ['通貨', '通貨略称'] as const
const EXCHANGE_RATE_HEADERS = ['円換算レート', '換算レート'] as const

function firstHeader(headers: readonly string[], candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => headers.includes(candidate))
}

function firstValue(row: Readonly<Record<string, string>>, candidates: readonly string[]): string {
  const header = candidates.find((candidate) => candidate in row)
  return header ? row[header] ?? '' : ''
}

function findHeaderIndex(rows: ReturnType<typeof tokenizeCsv>['rows']): number {
  return rows.slice(0, 12).findIndex((row) => {
    const headers = row.fields.map(normalizeHeader)
    return Boolean(firstHeader(headers, DATE_HEADERS))
      && Boolean(firstHeader(headers, MERCHANT_HEADERS))
      && Boolean(firstHeader(headers, [...BILLED_AMOUNT_HEADERS, ...USAGE_AMOUNT_HEADERS]))
  })
}

/**
 * Narrow parser for KakeFlow's explicit JCB statement v1 contract. Unknown
 * layouts are rejected instead of being guessed from column positions.
 */
export const jcbMyJcbAdapter: ImportAdapter<CardStatementCandidate> = {
  id: 'jcb-myjcb-statement-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const headerIndex = findHeaderIndex(csv.rows)
    if (headerIndex < 0) return { adapterId: this.id, score: 0, reasons: ['Required JCB statement headers not found'] }
    const headers = csv.rows[headerIndex].fields.map(normalizeHeader)
    const filenameSignal = /(?:myjcb|jcb)/i.test(input.filename ?? '')
    const contentSignal = csv.rows.slice(0, 12).some((row) => /(?:MyJCB|JCB|ジェーシービー)/i.test(row.fields.join(' ')))
    const jcbMerchantVocabulary = headers.some((header) => MERCHANT_HEADERS.includes(header as typeof MERCHANT_HEADERS[number]))
    if (!filenameSignal && !contentSignal) return { adapterId: this.id, score: 0, reasons: ['JCB provider marker not found'] }
    return {
      adapterId: this.id,
      score: clampScore(0.8 + (filenameSignal ? 0.1 : 0) + (contentSignal ? 0.05 : 0) + (jcbMerchantVocabulary ? 0.05 : 0)),
      reasons: ['JCB date, merchant, and amount headers found', filenameSignal ? 'JCB filename signal found' : 'JCB content marker found'],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const headerIndex = findHeaderIndex(csv.rows)
    if (headerIndex < 0) {
      return { adapterId: this.id, records: [], issues: [{ code: 'JCB_HEADER_MISSING', message: 'Supported JCB v1 statement headers were not found.', severity: 'error' }], metadata: {} }
    }

    const headers = csv.rows[headerIndex].fields.map(normalizeHeader)
    const dateHeader = firstHeader(headers, DATE_HEADERS)!
    const merchantHeader = firstHeader(headers, MERCHANT_HEADERS)!
    const billedHeader = firstHeader(headers, BILLED_AMOUNT_HEADERS)
    const usageHeader = firstHeader(headers, USAGE_AMOUNT_HEADERS)
    const transactions: CardTransactionCandidate[] = []
    let explicitStatementTotal: number | null = null

    for (const row of csv.rows.slice(headerIndex + 1)) {
      const value = rowObject(headers, row)
      const text = normalizeJapaneseText(row.fields.join(' '))
      const usageDate = parseJapaneseDate(value[dateHeader])
      if (!usageDate) {
        if (/合計|ご請求金額/.test(text)) {
          explicitStatementTotal = parseJapaneseAmount(billedHeader ? value[billedHeader] : undefined)
            ?? parseJapaneseAmount(usageHeader ? value[usageHeader] : undefined)
            ?? row.fields.map(parseJapaneseAmount).reverse().find((amount) => amount != null)
            ?? null
        } else if ((value[dateHeader] ?? '').trim()) {
          issues.push({ code: 'JCB_DATE_INVALID', message: 'JCB detail row has an invalid calendar date.', severity: 'error', row: row.sourceRow, column: dateHeader })
        } else if (text) {
          issues.push({ code: 'JCB_NON_DETAIL_SKIPPED', message: 'JCB metadata or non-detail row skipped.', severity: 'warning', row: row.sourceRow })
        }
        continue
      }

      const billedAmount = billedHeader
        ? parseJapaneseAmount(value[billedHeader])
        : parseJapaneseAmount(usageHeader ? value[usageHeader] : undefined)
      if (billedAmount == null || !Number.isSafeInteger(billedAmount) || billedAmount === 0) {
        issues.push({ code: 'JCB_AMOUNT_INVALID', message: 'JCB detail row has no non-zero integer JPY billed amount.', severity: 'error', row: row.sourceRow, column: billedHeader ?? usageHeader })
        continue
      }
      if (!(value[merchantHeader] ?? '').trim()) {
        issues.push({ code: 'JCB_MERCHANT_MISSING', message: 'JCB detail row has no merchant.', severity: 'error', row: row.sourceRow, column: merchantHeader })
        continue
      }
      const refundKeyword = /取消|返品|返金/.test(text)
      if (refundKeyword && billedAmount > 0) {
        issues.push({ code: 'JCB_REFUND_SIGN_AMBIGUOUS', message: 'JCB refund-like detail has a positive billed amount; verify the source sign before importing.', severity: 'error', row: row.sourceRow, column: billedHeader ?? usageHeader })
        continue
      }

      const originalAmount = parseJapaneseAmount(firstValue(value, ORIGINAL_AMOUNT_HEADERS))
      const exchangeRate = Number(firstValue(value, EXCHANGE_RATE_HEADERS).replace(/,/g, ''))
      const paymentParts = [value['支払区分'], value['今回回数'], value['支払方法']].map((part) => normalizeJapaneseText(part ?? '')).filter(Boolean)
      const rawExtra = Object.fromEntries(headers
        .filter((header) => ![dateHeader, merchantHeader].includes(header))
        .map((header) => [header, value[header] ?? '']))
      const transaction: CardTransactionCandidate = {
        kind: 'card-transaction',
        lineage: row,
        usageDate,
        merchant: normalizeJapaneseText(value[merchantHeader] ?? ''),
        userName: normalizeJapaneseText(firstValue(value, USER_HEADERS)),
        paymentMethod: paymentParts.join(' / '),
        billingAmount: billedAmount,
        feeOrInterest: parseJapaneseAmount(value['手数料']) ?? parseJapaneseAmount(value['利息']),
        isRefund: billedAmount < 0,
        rawExtra,
      }
      if (originalAmount != null) transaction.originalAmount = Math.abs(originalAmount)
      const currency = normalizeJapaneseText(firstValue(value, CURRENCY_HEADERS)).toUpperCase()
      if (/^[A-Z]{3}$/.test(currency)) transaction.originalCurrency = currency
      if (Number.isFinite(exchangeRate) && exchangeRate > 0) transaction.exchangeRate = exchangeRate
      transactions.push(transaction)
    }

    if (transactions.length === 0) issues.push({ code: 'JCB_DETAILS_MISSING', message: 'No valid JCB statement detail rows were found.', severity: 'error' })
    const computedTotal = transactions.reduce((sum, transaction) => sum + (transaction.billingAmount ?? 0), 0)
    if (explicitStatementTotal != null && explicitStatementTotal !== computedTotal) {
      issues.push({ code: 'JCB_TOTAL_MISMATCH', message: `Detail sum (${computedTotal}) does not match statement total (${explicitStatementTotal}).`, severity: 'error' })
    }
    const metadataRows = csv.rows.slice(0, headerIndex)
    const metadataText = metadataRows.flatMap((row) => row.fields).map(normalizeJapaneseText)
    const maskedCardNumber = metadataText.find((field) => /(?:\*{2,}|X{2,}|\d{4}[- ]?\*+)/i.test(field))
    const holderRow = metadataRows.find((row) => /^(?:会員名|カード名義|ご利用者)$/.test(normalizeHeader(row.fields[0] ?? '')))
    const holderName = holderRow
      ? normalizeJapaneseText(holderRow.fields[1] ?? '').replace(/\s*様\s*$/, '').trim()
      : metadataText.find((field) => /様$/.test(field))?.replace(/\s*様\s*$/, '').trim()
    return {
      adapterId: this.id,
      records: [{
        kind: 'card-statement', issuer: 'JCB', holderName, maskedCardNumber,
        productName: 'JCB', statementTotal: explicitStatementTotal ?? computedTotal, transactions,
      }],
      issues,
      metadata: { headerRow: csv.rows[headerIndex].sourceRow, detailCount: transactions.length, statementTotalSource: explicitStatementTotal == null ? 'DETAIL_SUM' : 'EXPLICIT_TOTAL' },
    }
  },
}
