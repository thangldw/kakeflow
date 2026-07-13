import { tokenizeCsv } from '../csv'
import { clampScore, normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { CardStatementCandidate, CardTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

const COLUMN_COUNT = 11
const PRODUCT_COLUMN = 2
const DATE_COLUMN = 0
const MERCHANT_COLUMN = 1
const USAGE_AMOUNT_COLUMN = 2
const PAYMENT_TYPE_COLUMN = 3
const INSTALLMENT_COUNT_COLUMN = 4
const BILLED_AMOUNT_COLUMN = 5
const ORIGINAL_AMOUNT_COLUMN = 6
const CURRENCY_COLUMN = 7
const EXCHANGE_RATE_COLUMN = 8
const EXCHANGE_DATE_COLUMN = 9
const NOTE_COLUMN = 10

const PRODUCT_MARKER = /(?:SMBC(?:\s*CARD)?|三井住友カード)/i
const AMAZON_MARKER = /Amazon\s*(?:マスター|Mastercard)/i
const MASKED_CARD_MARKER = /^(?=.*\d)(?=.*[*Xx＊])[\d*Xx＊ -]{6,}$/
const TOTAL_LABEL = /(?:お支払い|ご請求|請求)?合計|今回(?:のお)?支払(?:い)?金額/i
const REFUND_MARKER = /取消|返品|返金|キャンセル/

function isProductMetadata(fields: readonly string[]): boolean {
  const holder = normalizeJapaneseText(fields[0] ?? '').replace(/\s*様\s*$/, '').trim()
  const maskedCard = normalizeJapaneseText(fields[1] ?? '')
  const product = normalizeJapaneseText(fields[PRODUCT_COLUMN] ?? '')
  return Boolean(holder) && MASKED_CARD_MARKER.test(maskedCard) && PRODUCT_MARKER.test(product) && !AMAZON_MARKER.test(product)
}

function isExplicitTotal(fields: readonly string[]): boolean {
  if (parseJapaneseAmount(fields[BILLED_AMOUNT_COLUMN]) == null) return false
  const normalized = fields.map(normalizeJapaneseText)
  if (normalized.some((field) => TOTAL_LABEL.test(field))) return true
  return normalized.filter(Boolean).length === 1 && Boolean(normalized[BILLED_AMOUNT_COLUMN])
}

function isOneTimePayment(paymentType: string, installmentCount: string): boolean {
  const type = normalizeJapaneseText(paymentType)
  const count = normalizeJapaneseText(installmentCount)
  return /^(?:一括|1回払い|1)$/.test(type) && (count === '' || count === '1')
}

/**
 * Strict parser for the documented, headerless SMBC Vpass eleven-column
 * statement image. It intentionally rejects deferred-payment rows because a
 * usage amount is not the expense recognized in the current statement cycle.
 */
export const smbcVpassAdapter: ImportAdapter<CardStatementCandidate> = {
  id: 'smbc-vpass-statement-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const metadata = csv.rows[0]
    if (!metadata || !isProductMetadata(metadata.fields)) {
      return { adapterId: this.id, score: 0, reasons: ['The first row does not contain holder, masked card, and SMBC product metadata'] }
    }
    const lastRow = csv.rows[csv.rows.length - 1]
    const total = lastRow && isExplicitTotal(lastRow.fields) ? parseJapaneseAmount(lastRow.fields[BILLED_AMOUNT_COLUMN]) : null
    const totalSignal = total != null && Number.isSafeInteger(total) && total > 0
    const detailSignal = csv.rows.slice(1, -1).some((row) =>
      row.fields.length === COLUMN_COUNT && parseJapaneseDate(row.fields[DATE_COLUMN]) != null,
    )
    if (!totalSignal || !detailSignal) {
      return { adapterId: this.id, score: 0, reasons: ['Required Vpass eleven-column detail and final total rows were not found'] }
    }
    return {
      adapterId: this.id,
      score: clampScore(0.98),
      reasons: ['SMBC Vpass product metadata found in column 3', 'Headerless eleven-column detail and final total rows found'],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const metadata = csv.rows[0]
    if (!metadata || !isProductMetadata(metadata.fields)) {
      return {
        adapterId: this.id,
        records: [],
        issues: [{ code: 'VPASS_METADATA_MISSING', message: 'The first row must contain holder, masked card number, and SMBC product metadata.', severity: 'error', row: metadata?.sourceRow }],
        metadata: {},
      }
    }
    const metadataRows = csv.rows.filter((row) => isProductMetadata(row.fields))
    if (metadataRows.length > 1) {
      issues.push({ code: 'VPASS_MULTIPLE_SECTIONS_UNSUPPORTED', message: 'A Vpass file containing multiple card sections cannot be assigned safely to one card account.', severity: 'error', row: metadataRows[1].sourceRow })
    }

    const lastRow = csv.rows[csv.rows.length - 1]
    const hasExplicitTotal = Boolean(lastRow && isExplicitTotal(lastRow.fields))
    const parsedStatementTotal = hasExplicitTotal ? parseJapaneseAmount(lastRow!.fields[BILLED_AMOUNT_COLUMN]) : null
    const statementTotal = parsedStatementTotal != null && Number.isSafeInteger(parsedStatementTotal) && parsedStatementTotal > 0 ? parsedStatementTotal : null
    if (parsedStatementTotal == null || !Number.isSafeInteger(parsedStatementTotal)) {
      issues.push({ code: 'VPASS_TOTAL_MISSING', message: 'The final Vpass statement total is required in column 6.', severity: 'error', row: lastRow?.sourceRow, column: 'お支払い金額' })
    } else if (parsedStatementTotal <= 0) {
      issues.push({ code: 'VPASS_TOTAL_INVALID', message: 'The current Vpass statement contract requires a positive statement total.', severity: 'error', row: lastRow?.sourceRow, column: 'お支払い金額' })
    }

    const metadataIndex = csv.rows.indexOf(metadata)
    const detailRows = csv.rows.slice(metadataIndex + 1, hasExplicitTotal ? -1 : undefined)
    const transactions: CardTransactionCandidate[] = []
    for (const row of detailRows) {
      if (isProductMetadata(row.fields)) continue
      if (row.fields.length !== COLUMN_COUNT) {
        issues.push({ code: 'VPASS_COLUMN_COUNT_INVALID', message: 'Vpass detail rows must contain exactly 11 columns.', severity: 'error', row: row.sourceRow })
        continue
      }
      const usageDate = parseJapaneseDate(row.fields[DATE_COLUMN])
      if (!usageDate) {
        issues.push({ code: 'VPASS_DATE_INVALID', message: 'Vpass detail row has an invalid calendar date.', severity: 'error', row: row.sourceRow, column: 'ご利用日' })
        continue
      }
      const merchant = normalizeJapaneseText(row.fields[MERCHANT_COLUMN] ?? '')
      if (!merchant) {
        issues.push({ code: 'VPASS_MERCHANT_MISSING', message: 'Vpass detail row has no merchant.', severity: 'error', row: row.sourceRow, column: 'ご利用店名' })
        continue
      }
      const usageAmount = parseJapaneseAmount(row.fields[USAGE_AMOUNT_COLUMN])
      const billingAmount = parseJapaneseAmount(row.fields[BILLED_AMOUNT_COLUMN])
      if (usageAmount == null || billingAmount == null
        || !Number.isSafeInteger(usageAmount) || !Number.isSafeInteger(billingAmount)
        || usageAmount === 0 || billingAmount === 0) {
        issues.push({ code: 'VPASS_AMOUNT_INVALID', message: 'Vpass detail row requires non-zero integer JPY usage and billed amounts.', severity: 'error', row: row.sourceRow, column: 'ご利用金額 / お支払い金額' })
        continue
      }
      if (!isOneTimePayment(row.fields[PAYMENT_TYPE_COLUMN] ?? '', row.fields[INSTALLMENT_COUNT_COLUMN] ?? '') || usageAmount !== billingAmount) {
        issues.push({ code: 'VPASS_DEFERRED_PAYMENT_UNSUPPORTED', message: 'Installment, revolving, bonus, or partially billed Vpass payments are not supported by this adapter.', severity: 'error', row: row.sourceRow, column: '支払区分 / 分割回数 / お支払い金額' })
        continue
      }
      const normalizedRow = normalizeJapaneseText(row.fields.join(' '))
      if (REFUND_MARKER.test(normalizedRow) && billingAmount > 0) {
        issues.push({ code: 'VPASS_REFUND_SIGN_AMBIGUOUS', message: 'Vpass refund-like detail has a positive billed amount; verify the source sign before importing.', severity: 'error', row: row.sourceRow, column: 'お支払い金額' })
        continue
      }

      const rawExtra = {
        ご利用金額: row.fields[USAGE_AMOUNT_COLUMN] ?? '',
        支払区分: row.fields[PAYMENT_TYPE_COLUMN] ?? '',
        分割回数: row.fields[INSTALLMENT_COUNT_COLUMN] ?? '',
        お支払い金額: row.fields[BILLED_AMOUNT_COLUMN] ?? '',
        現地通貨額: row.fields[ORIGINAL_AMOUNT_COLUMN] ?? '',
        略称: row.fields[CURRENCY_COLUMN] ?? '',
        換算レート: row.fields[EXCHANGE_RATE_COLUMN] ?? '',
        換算日: row.fields[EXCHANGE_DATE_COLUMN] ?? '',
        備考: row.fields[NOTE_COLUMN] ?? '',
      }
      const transaction: CardTransactionCandidate = {
        kind: 'card-transaction',
        lineage: row,
        usageDate,
        merchant,
        userName: normalizeJapaneseText(metadata.fields[0] ?? '').replace(/\s*様\s*$/, '').trim(),
        paymentMethod: [row.fields[PAYMENT_TYPE_COLUMN], row.fields[INSTALLMENT_COUNT_COLUMN]].map((value) => normalizeJapaneseText(value ?? '')).filter(Boolean).join(' / '),
        billingAmount,
        feeOrInterest: null,
        isRefund: billingAmount < 0,
        rawExtra,
      }
      const originalAmount = parseJapaneseAmount(row.fields[ORIGINAL_AMOUNT_COLUMN])
      const currency = normalizeJapaneseText(row.fields[CURRENCY_COLUMN] ?? '').toUpperCase()
      const exchangeRate = Number(normalizeJapaneseText(row.fields[EXCHANGE_RATE_COLUMN] ?? '').replace(/,/g, ''))
      if (originalAmount != null) transaction.originalAmount = Math.abs(originalAmount)
      if (/^[A-Z]{3}$/.test(currency)) transaction.originalCurrency = currency
      if (Number.isFinite(exchangeRate) && exchangeRate > 0) transaction.exchangeRate = exchangeRate
      transactions.push(transaction)
    }

    if (transactions.length === 0) {
      issues.push({ code: 'VPASS_DETAILS_MISSING', message: 'No valid Vpass statement detail rows were found.', severity: 'error' })
    }
    const computedTotal = transactions.reduce((sum, transaction) => sum + (transaction.billingAmount ?? 0), 0)
    if (statementTotal != null && statementTotal !== computedTotal) {
      issues.push({ code: 'VPASS_TOTAL_MISMATCH', message: `Detail sum (${computedTotal}) does not match statement total (${statementTotal}).`, severity: 'error' })
    }

    return {
      adapterId: this.id,
      records: [{
        kind: 'card-statement',
        issuer: 'SMBC_CARD',
        holderName: normalizeJapaneseText(metadata.fields[0] ?? '').replace(/\s*様\s*$/, '').trim() || undefined,
        maskedCardNumber: normalizeJapaneseText(metadata.fields[1] ?? '') || undefined,
        productName: normalizeJapaneseText(metadata.fields[PRODUCT_COLUMN] ?? '') || undefined,
        statementTotal,
        transactions,
      }],
      issues,
      metadata: { metadataRow: metadata.sourceRow, detailCount: transactions.length, statementTotalSource: statementTotal == null ? 'MISSING' : 'EXPLICIT_TOTAL' },
    }
  },
}
