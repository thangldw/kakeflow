import { normalizeHeader, rowObject, tokenizeCsv, type CsvRow } from '../csv'
import { normalizeJapaneseText, parseJapaneseDate } from '../normalize'
import type { BankTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

const HEADERS = [
  '日付', '摘要', '摘要内容', '支払い金額', '預かり金額', '差引残高', 'メモ', '未資金化区分', '入払区分',
] as const
const NORMALIZED_HEADERS = HEADERS.map(normalizeHeader)
const MAX_PREAMBLE_PHYSICAL_ROWS = 8
const MAX_DETAIL_ROWS = 100_000
const CARD_PAYMENT = /(カード|CARD|JCB|AMEX|アメックス)/i
const OUT_CODES = new Set(['出', '支払', '払出', 'OUT', '2'])
const IN_CODES = new Set(['入', '預入', '受入', 'IN', '1'])

type SourceOrder = 'SINGLE_ROW' | 'OLDEST_FIRST' | 'NEWEST_FIRST'

interface StrictDetail {
  row: CsvRow
  candidate: BankTransactionCandidate
  date: string
  delta: number
  balance: number
}

function exactHeader(row: CsvRow | undefined): boolean {
  return row != null
    && row.sourceRow === row.sourceRowEnd
    && row.sourceRow - 1 <= MAX_PREAMBLE_PHYSICAL_ROWS
    && row.fields.length === NORMALIZED_HEADERS.length
    && row.fields.map(normalizeHeader).every((field, index) => field === NORMALIZED_HEADERS[index])
}

function findHeaderIndex(rows: readonly CsvRow[]): number {
  return rows.findIndex(exactHeader)
}

function currencyIntegerDigits(raw: string): string | null {
  let value = raw.trim()
  const hasPrefix = value.startsWith('¥')
  const hasSuffix = value.endsWith('円')
  if (hasPrefix && hasSuffix) return null
  if (hasPrefix) value = value.slice(1).trim()
  if (hasSuffix) value = value.slice(0, -1).trim()
  return /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value) ? value : null
}

function unsignedSafeInteger(raw: string): { value: number | null; invalid: boolean } {
  const normalized = raw.normalize('NFKC').trim()
  if (!normalized) return { value: null, invalid: false }
  const value = currencyIntegerDigits(normalized)
  if (!value) return { value: null, invalid: true }
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isSafeInteger(parsed) && parsed > 0
    ? { value: parsed, invalid: false }
    : { value: null, invalid: true }
}

function signedSafeInteger(raw: string): number | null {
  let value = raw.normalize('NFKC').trim()
  let negative = false
  if (/^\(.*\)$/.test(value)) {
    negative = true
    value = value.slice(1, -1).trim()
  } else if (value.startsWith('-') || value.startsWith('△')) {
    negative = true
    value = value.slice(1).trim()
  }
  const digits = currencyIntegerDigits(value)
  if (!digits) return null
  const parsed = Number(digits.replaceAll(',', ''))
  if (!Number.isSafeInteger(parsed)) return null
  return negative ? -parsed : parsed
}

function isSummaryRow(row: CsvRow): boolean {
  const first = normalizeJapaneseText(row.fields[0] ?? '')
  const description = normalizeJapaneseText(row.fields[1] ?? '')
  return /^(?:合計|総合計|計|残高|明細件数|ご請求)/.test(first)
    || /^(?:合計|総合計|明細件数)$/.test(description)
}

function chronologyAllows(details: readonly StrictDetail[], order: Exclude<SourceOrder, 'SINGLE_ROW'>): boolean {
  return details.slice(1).every((detail, index) => order === 'OLDEST_FIRST'
    ? detail.date >= details[index].date
    : detail.date <= details[index].date)
}

function balancesReconcile(details: readonly StrictDetail[], order: Exclude<SourceOrder, 'SINGLE_ROW'>): boolean {
  if (order === 'OLDEST_FIRST') {
    return details.slice(1).every((detail, index) => detail.balance === details[index].balance + detail.delta)
  }
  return details.slice(1).every((older, index) => details[index].balance === older.balance + details[index].delta)
}

function validateSourceOrder(details: readonly StrictDetail[], issues: ParseIssue[]): SourceOrder | null {
  if (details.length === 1) return 'SINGLE_ROW'
  const chronological = (['OLDEST_FIRST', 'NEWEST_FIRST'] as const)
    .filter((order) => chronologyAllows(details, order))
  const reconciled = chronological.filter((order) => balancesReconcile(details, order))
  if (reconciled.length === 1) return reconciled[0]
  if (reconciled.length > 1 || chronological.length === 0) {
    issues.push({
      code: 'PERSONAL_BANK_SOURCE_ORDER_AMBIGUOUS',
      message: 'Source order is ambiguous; dates and balances must prove exactly one oldest-first or newest-first sequence.',
      severity: 'error',
    })
  } else {
    issues.push({
      code: 'PERSONAL_BANK_BALANCE_DISCONTINUITY',
      message: 'Running balances do not reconcile continuously in the source date order.',
      severity: 'error',
    })
  }
  return null
}

export const personalJapaneseBankAdapter: ImportAdapter<BankTransactionCandidate> = {
  id: 'personal-japanese-bank-ledger-v2',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const headerIndex = findHeaderIndex(csv.rows)
    const collision = csv.rows.some((row) => row.fields.includes('金融機関コード') || row.fields.includes('入出金明細ID'))
    const matched = headerIndex >= 0 && !collision
    return {
      adapterId: this.id,
      score: matched ? 1 : 0,
      reasons: [matched
        ? `Exact provider-neutral nine-column personal-bank header found on physical row ${csv.rows[headerIndex].sourceRow}`
        : 'Exact bounded personal-bank header not found'],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const headerIndex = findHeaderIndex(csv.rows)
    if (headerIndex < 0) {
      return {
        adapterId: this.id, records: [], issues: [...issues, {
          code: 'PERSONAL_BANK_HEADER_INVALID',
          message: 'The exact nine-column personal Japanese bank header must appear after no more than eight physical preamble rows.',
          severity: 'error',
        }], metadata: {},
      }
    }

    const sourceRows = csv.rows.slice(headerIndex + 1)
    if (sourceRows.length > MAX_DETAIL_ROWS) {
      issues.push({ code: 'PERSONAL_BANK_DETAIL_LIMIT_EXCEEDED', message: `At most ${MAX_DETAIL_ROWS} detail rows are supported.`, severity: 'error' })
    }
    const details: StrictDetail[] = []
    const duplicateKeys = new Set<string>()
    for (const row of sourceRows.slice(0, MAX_DETAIL_ROWS)) {
      if (isSummaryRow(row)) {
        issues.push({ code: 'PERSONAL_BANK_SUMMARY_ROW_REJECTED', message: 'Summary rows are not transaction details.', severity: 'error', row: row.sourceRow })
        continue
      }
      if (row.fields.length !== HEADERS.length) {
        issues.push({ code: 'PERSONAL_BANK_ROW_WIDTH_INVALID', message: 'Every detail row must contain exactly nine columns.', severity: 'error', row: row.sourceRow })
        continue
      }
      const value = rowObject(NORMALIZED_HEADERS, row)
      const date = parseJapaneseDate(value['日付'])
      const outgoing = unsignedSafeInteger(value['支払い金額'])
      const incoming = unsignedSafeInteger(value['預かり金額'])
      const balance = signedSafeInteger(value['差引残高'])
      const description = normalizeJapaneseText(value['摘要'])
      const descriptionDetail = normalizeJapaneseText(value['摘要内容'])
      const directionCode = normalizeJapaneseText(value['入払区分']).toUpperCase()
      let valid = true
      if (!date) {
        valid = false
        issues.push({ code: 'PERSONAL_BANK_DATE_INVALID', message: 'Transaction date must be a valid Gregorian calendar date.', severity: 'error', row: row.sourceRow, column: '日付' })
      }
      if (outgoing.invalid || incoming.invalid || (outgoing.value == null) === (incoming.value == null)) {
        valid = false
        issues.push({ code: 'PERSONAL_BANK_AMOUNT_INVALID', message: 'Exactly one debit or credit must be a positive safe-integer JPY amount.', severity: 'error', row: row.sourceRow })
      }
      if (balance == null) {
        valid = false
        issues.push({ code: 'PERSONAL_BANK_BALANCE_INVALID', message: 'Running balance must be a signed safe-integer JPY value.', severity: 'error', row: row.sourceRow, column: '差引残高' })
      }
      if (!description && !descriptionDetail) {
        valid = false
        issues.push({ code: 'PERSONAL_BANK_DESCRIPTION_MISSING', message: 'A detail row must contain a summary or detailed description.', severity: 'error', row: row.sourceRow })
      }
      const expectedCodes = outgoing.value == null ? IN_CODES : OUT_CODES
      if (!expectedCodes.has(directionCode)) {
        valid = false
        issues.push({ code: 'PERSONAL_BANK_DIRECTION_INVALID', message: 'Debit/credit classification must agree with the populated amount column.', severity: 'error', row: row.sourceRow, column: '入払区分' })
      }
      const duplicateKey = JSON.stringify(row.fields.map((field) => field.normalize('NFKC').trim()))
      if (duplicateKeys.has(duplicateKey)) {
        valid = false
        issues.push({ code: 'PERSONAL_BANK_DETAIL_DUPLICATE', message: 'A duplicate physical detail row was rejected.', severity: 'error', row: row.sourceRow })
      } else duplicateKeys.add(duplicateKey)
      if (!valid || !date || balance == null || (outgoing.value == null) === (incoming.value == null)) continue

      const candidate: BankTransactionCandidate = {
        kind: 'bank-transaction', lineage: row,
        ...(input.accountHint ? { accountHint: input.accountHint } : {}),
        transactionDate: date, description, descriptionDetail,
        outgoingAmount: outgoing.value, incomingAmount: incoming.value, balance,
        memo: value['メモ'], fundsAvailabilityCode: value['未資金化区分'], debitCreditCode: directionCode,
        suggestedType: outgoing.value != null && CARD_PAYMENT.test(`${description} ${descriptionDetail}`) ? 'CARD_PAYMENT' : 'UNKNOWN',
      }
      details.push({ row, candidate, date, balance, delta: (incoming.value ?? 0) - (outgoing.value ?? 0) })
    }
    if (details.length === 0) {
      issues.push({ code: 'PERSONAL_BANK_DETAILS_MISSING', message: 'At least one valid transaction detail is required.', severity: 'error' })
    }
    const sourceOrder = details.length > 0 ? validateSourceOrder(details, issues) : null
    return {
      adapterId: this.id,
      records: details.map(({ candidate }) => candidate),
      issues,
      metadata: {
        delimiter: csv.delimiter,
        headerRow: csv.rows[headerIndex].sourceRow,
        sourceOrder,
        contract: 'PERSONAL_JAPANESE_BANK_NINE_COLUMN',
      },
    }
  },
}
