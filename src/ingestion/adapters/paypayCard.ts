import { normalizeHeader, rowObject, tokenizeCsv } from '../csv'
import { clampScore, normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { CardStatementCandidate, CardTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

const HEADERS = [
  '利用日/キャンセル日',
  '利用店名・商品名',
  '利用者',
  '支払区分',
  '利用金額',
  '手数料',
  '支払総額',
  '当月支払金額',
  '翌月以降繰越金額',
  '調整額',
  '当月お支払日',
] as const

const REFUND_MARKER = /取消|返品|返金|キャンセル/
const UNSUPPORTED_PAYMENT = /リボ|分割|ボーナス|据置|繰越|スキップ|あとから/

function exactHeaderIndex(rows: ReturnType<typeof tokenizeCsv>['rows']): number {
  return rows.slice(0, 5).findIndex((row) => {
    const headers = row.fields.map(normalizeHeader)
    return headers.length === HEADERS.length && HEADERS.every((header, index) => headers[index] === header)
  })
}

function isOneTimePayment(value: string): boolean {
  const normalized = normalizeJapaneseText(value)
  return /^(?:1回|1回払い|一括)$/.test(normalized) && !UNSUPPORTED_PAYMENT.test(normalized)
}

function integerAmount(value: string | undefined): number | null {
  const amount = parseJapaneseAmount(value)
  return amount != null && Number.isSafeInteger(amount) ? amount : null
}

/**
 * Strict adapter for a community-observed PayPay Card finalized CSV layout.
 * PayPay Card confirms monthly CSV export, but does not publish the literal
 * consumer schema. Only this exact versioned field contract is accepted.
 */
export const payPayCardAdapter: ImportAdapter<CardStatementCandidate> = {
  id: 'paypay-card-finalized-statement-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const headerIndex = exactHeaderIndex(csv.rows)
    if (headerIndex < 0) return { adapterId: this.id, score: 0, reasons: ['Exact PayPay Card eleven-column header not found'] }
    const detailSignal = csv.rows.slice(headerIndex + 1).some((row) => parseJapaneseDate(row.fields[0]) != null)
    if (!detailSignal) return { adapterId: this.id, score: 0, reasons: ['PayPay Card header found without a dated detail row'] }
    return {
      adapterId: this.id,
      score: clampScore(1),
      reasons: ['Exact PayPay Card eleven-column header and dated detail row found'],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const headerIndex = exactHeaderIndex(csv.rows)
    if (headerIndex < 0) {
      return {
        adapterId: this.id,
        records: [],
        issues: [{ code: 'PAYPAY_CARD_HEADER_MISSING', message: 'The exact supported PayPay Card eleven-column header was not found.', severity: 'error' }],
        metadata: {},
      }
    }

    const headers = csv.rows[headerIndex].fields.map(normalizeHeader)
    const transactions: CardTransactionCandidate[] = []
    const paymentDates = new Set<string>()

    for (const row of csv.rows.slice(headerIndex + 1)) {
      if (row.fields.length !== HEADERS.length) {
        issues.push({ code: 'PAYPAY_CARD_COLUMN_COUNT_INVALID', message: 'PayPay Card detail rows must contain exactly eleven columns.', severity: 'error', row: row.sourceRow })
        continue
      }
      const value = rowObject(headers, row)
      const usageDate = parseJapaneseDate(value['利用日/キャンセル日'])
      if (!usageDate) {
        issues.push({ code: 'PAYPAY_CARD_DATE_INVALID', message: 'PayPay Card detail row has an invalid usage or cancellation date.', severity: 'error', row: row.sourceRow, column: '利用日/キャンセル日' })
        continue
      }
      const paymentDueOn = parseJapaneseDate(value['当月お支払日'])
      if (!paymentDueOn) {
        issues.push({ code: 'PAYPAY_CARD_PAYMENT_DATE_INVALID', message: 'PayPay Card detail row has an invalid current payment date.', severity: 'error', row: row.sourceRow, column: '当月お支払日' })
        continue
      }
      const merchant = normalizeJapaneseText(value['利用店名・商品名'] ?? '')
      if (!merchant) {
        issues.push({ code: 'PAYPAY_CARD_MERCHANT_MISSING', message: 'PayPay Card detail row has no merchant or item name.', severity: 'error', row: row.sourceRow, column: '利用店名・商品名' })
        continue
      }

      const usageAmount = integerAmount(value['利用金額'])
      const fee = integerAmount(value['手数料'])
      const paymentTotal = integerAmount(value['支払総額'])
      const currentPayment = integerAmount(value['当月支払金額'])
      const carryForward = integerAmount(value['翌月以降繰越金額'])
      const adjustment = integerAmount(value['調整額'])
      if ([usageAmount, fee, paymentTotal, currentPayment, carryForward, adjustment].some((amount) => amount == null)
        || usageAmount === 0 || paymentTotal === 0 || currentPayment === 0) {
        issues.push({ code: 'PAYPAY_CARD_AMOUNT_INVALID', message: 'PayPay Card detail row requires safe integer JPY values in every amount field.', severity: 'error', row: row.sourceRow, column: '利用金額 / 手数料 / 支払総額 / 当月支払金額 / 翌月以降繰越金額 / 調整額' })
        continue
      }

      const paymentMethod = normalizeJapaneseText(value['支払区分'] ?? '')
      if (!isOneTimePayment(paymentMethod)
        || fee !== 0
        || carryForward !== 0
        || usageAmount! + fee! !== paymentTotal
        || paymentTotal !== currentPayment) {
        issues.push({ code: 'PAYPAY_CARD_DEFERRED_PAYMENT_UNSUPPORTED', message: 'Only one-time PayPay Card rows with zero fee/carry-forward and equal usage, total, and current-payment amounts are supported.', severity: 'error', row: row.sourceRow, column: '支払区分 / 利用金額 / 手数料 / 支払総額 / 当月支払金額 / 翌月以降繰越金額' })
        continue
      }
      if (adjustment !== 0) {
        issues.push({ code: 'PAYPAY_CARD_ADJUSTMENT_UNSUPPORTED', message: 'PayPay Card adjustment rows require separate liability modeling and are not supported.', severity: 'error', row: row.sourceRow, column: '調整額' })
        continue
      }
      if (REFUND_MARKER.test(normalizeJapaneseText(row.fields.join(' '))) && currentPayment! > 0) {
        issues.push({ code: 'PAYPAY_CARD_REFUND_SIGN_AMBIGUOUS', message: 'PayPay Card cancellation or refund wording has a positive current-payment amount.', severity: 'error', row: row.sourceRow, column: '当月支払金額' })
        continue
      }

      paymentDates.add(paymentDueOn)
      transactions.push({
        kind: 'card-transaction',
        lineage: row,
        usageDate,
        merchant,
        userName: normalizeJapaneseText(value['利用者'] ?? ''),
        paymentMethod,
        billingAmount: currentPayment,
        feeOrInterest: fee,
        isRefund: currentPayment! < 0,
        rawExtra: Object.fromEntries(headers
          .filter((header) => !['利用日/キャンセル日', '利用店名・商品名'].includes(header))
          .map((header) => [header, value[header] ?? ''])),
      })
    }

    if (transactions.length === 0) issues.push({ code: 'PAYPAY_CARD_DETAILS_MISSING', message: 'No valid finalized PayPay Card detail rows were found.', severity: 'error' })
    if (paymentDates.size > 1) issues.push({ code: 'PAYPAY_CARD_PAYMENT_DATE_MISMATCH', message: 'A PayPay Card monthly export must contain exactly one current payment date.', severity: 'error', column: '当月お支払日' })
    const statementTotal = transactions.reduce((sum, transaction) => sum + (transaction.billingAmount ?? 0), 0)
    if (transactions.length > 0 && statementTotal <= 0) issues.push({ code: 'PAYPAY_CARD_TOTAL_INVALID', message: 'The finalized PayPay Card statement total must be positive.', severity: 'error', column: '当月支払金額' })
    const paymentDueOn = paymentDates.size === 1 ? [...paymentDates][0] : undefined

    return {
      adapterId: this.id,
      records: [{
        kind: 'card-statement', issuer: 'PAYPAY_CARD', productName: 'PayPayカード',
        statementMonth: paymentDueOn?.slice(0, 7), paymentDueOn,
        statementTotal: statementTotal > 0 ? statementTotal : null, transactions,
      }],
      issues,
      metadata: {
        headerRow: csv.rows[headerIndex].sourceRow,
        detailCount: transactions.length,
        statementTotalSource: 'CURRENT_PAYMENT_SUM',
        schemaBasis: 'COMMUNITY_DERIVED_SYNTHETIC',
      },
    }
  },
}
