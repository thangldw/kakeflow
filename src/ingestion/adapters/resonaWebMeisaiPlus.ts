import { normalizeHeader, rowObject, tokenizeCsv, type CsvRow } from '../csv'
import { normalizeJapaneseText, parseJapaneseDate } from '../normalize'
import type { BankTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

// Exact fields published by Resona for Web入出金明細PLUS CSV. Unknown aliases
// must not be accepted as this provider contract.
const HEADERS = [
  '照会口座', '番号', '勘定日', '(起算日)', '出金金額(円)', '入金金額(円)', '小切手区分',
  '残高(円)', '取引区分', '明細区分', '金融機関名', '支店名', '摘要', 'メモ',
] as const
const NORMALIZED_HEADERS = HEADERS.map(normalizeHeader)
const MAX_DETAIL_ROWS = 100_000
const CARD_PAYMENT = /(カード|CARD|JCB|AMEX|アメックス)/i

type SourceOrder = 'SINGLE_ROW' | 'OLDEST_FIRST' | 'NEWEST_FIRST'

interface StrictDetail {
  candidate: BankTransactionCandidate
  date: string
  delta: number
  balance: number
}

function exactHeader(row: CsvRow | undefined): boolean {
  return row != null
    && row.sourceRow === 1
    && row.sourceRowEnd === 1
    && row.fields.length === NORMALIZED_HEADERS.length
    && row.fields.map(normalizeHeader).every((field, index) => field === NORMALIZED_HEADERS[index])
}

function codePoints(value: string): number {
  return Array.from(value).length
}

function bounded(value: string, maximum: number): boolean {
  return codePoints(value.normalize('NFKC').trim()) <= maximum
}

function optionalPositiveInteger(value: string, maximumDigits: number): { value: number | null; invalid: boolean } {
  const normalized = value.normalize('NFKC').trim()
  if (!normalized) return { value: null, invalid: false }
  if (!new RegExp(`^\\d{1,${maximumDigits}}$`).test(normalized)) return { value: null, invalid: true }
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? { value: parsed, invalid: false }
    : { value: null, invalid: true }
}

function unsignedBalance(value: string): number | null {
  const normalized = value.normalize('NFKC').trim()
  if (!/^\d{1,19}$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) ? parsed : null
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
  const candidates = (['OLDEST_FIRST', 'NEWEST_FIRST'] as const)
    .filter((order) => chronologyAllows(details, order) && balancesReconcile(details, order))
  if (candidates.length === 1) return candidates[0]
  issues.push({
    code: candidates.length === 0 ? 'RESONA_PLUS_BALANCE_OR_ORDER_INVALID' : 'RESONA_PLUS_SOURCE_ORDER_AMBIGUOUS',
    message: candidates.length === 0
      ? 'Dates and running balances do not prove one continuous oldest-first or newest-first source order.'
      : 'Dates and running balances leave the source order ambiguous.',
    severity: 'error',
  })
  return null
}

export const resonaWebMeisaiPlusAdapter: ImportAdapter<BankTransactionCandidate> = {
  id: 'resona-web-meisai-plus-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const matched = exactHeader(csv.rows[0])
    return {
      adapterId: this.id,
      score: matched ? 1 : 0,
      reasons: [matched
        ? 'Exact Resona Web入出金明細PLUS fourteen-column header found in the first physical record'
        : 'Exact first-record Resona Web入出金明細PLUS header not found'],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    if (!exactHeader(csv.rows[0])) {
      return {
        adapterId: this.id,
        records: [],
        issues: [...issues, { code: 'RESONA_PLUS_HEADER_INVALID', message: 'The exact fourteen-column Web入出金明細PLUS header must be the first physical record.', severity: 'error' }],
        metadata: {},
      }
    }

    const sourceRows = csv.rows.slice(1)
    if (sourceRows.length > MAX_DETAIL_ROWS) {
      issues.push({ code: 'RESONA_PLUS_DETAIL_LIMIT_EXCEEDED', message: `At most ${MAX_DETAIL_ROWS} detail rows are supported.`, severity: 'error' })
    }
    const details: StrictDetail[] = []
    let accountDescriptor: string | null = null
    for (const [index, row] of sourceRows.slice(0, MAX_DETAIL_ROWS).entries()) {
      if (row.fields.length !== HEADERS.length) {
        issues.push({ code: 'RESONA_PLUS_ROW_WIDTH_INVALID', message: 'Every Web入出金明細PLUS detail must contain exactly fourteen columns.', severity: 'error', row: row.sourceRow })
        continue
      }
      const value = rowObject(NORMALIZED_HEADERS, row)
      const account = value['照会口座'].normalize('NFKC').trim()
      const sequenceRaw = value['番号'].normalize('NFKC').trim()
      const sequence = /^\d{1,5}$/.test(sequenceRaw) ? Number(sequenceRaw) : null
      const dateRaw = value['勘定日'].normalize('NFKC').trim()
      const date = bounded(dateRaw, 14) ? parseJapaneseDate(dateRaw) : null
      const valueDateRaw = value['(起算日)'].normalize('NFKC').trim()
      const valueDate = valueDateRaw && bounded(valueDateRaw, 14) ? parseJapaneseDate(valueDateRaw) : null
      const outgoing = optionalPositiveInteger(value['出金金額(円)'], 16)
      const incoming = optionalPositiveInteger(value['入金金額(円)'], 16)
      const balance = unsignedBalance(value['残高(円)'])
      const direction = normalizeJapaneseText(value['取引区分'])
      const detailType = normalizeJapaneseText(value['明細区分'])
      const description = normalizeJapaneseText(value['摘要'])
      const memo = normalizeJapaneseText(value['メモ'])
      let valid = true

      if (!account || !bounded(account, 71)) {
        valid = false
        issues.push({ code: 'RESONA_PLUS_ACCOUNT_INVALID', message: 'Inquiry account must be present and at most 71 characters.', severity: 'error', row: row.sourceRow, column: '照会口座' })
      } else if (accountDescriptor != null && account !== accountDescriptor) {
        valid = false
        issues.push({ code: 'RESONA_PLUS_ACCOUNT_MIXED', message: 'One file must contain exactly one inquiry account descriptor.', severity: 'error', row: row.sourceRow, column: '照会口座' })
      } else accountDescriptor = account
      if (sequence == null || sequence !== index + 1) {
        valid = false
        issues.push({ code: 'RESONA_PLUS_SEQUENCE_INVALID', message: 'Detail numbers must be decimal integers starting at 1 and increasing by one in source order.', severity: 'error', row: row.sourceRow, column: '番号' })
      }
      if (!date) {
        valid = false
        issues.push({ code: 'RESONA_PLUS_DATE_INVALID', message: 'Accounting date must be a valid Gregorian date within the published 14-character field.', severity: 'error', row: row.sourceRow, column: '勘定日' })
      }
      if (valueDateRaw && !valueDate) {
        valid = false
        issues.push({ code: 'RESONA_PLUS_VALUE_DATE_INVALID', message: 'Non-empty value date must be a valid Gregorian date within 14 characters.', severity: 'error', row: row.sourceRow, column: '(起算日)' })
      }
      if (outgoing.invalid || incoming.invalid || (outgoing.value == null) === (incoming.value == null)) {
        valid = false
        issues.push({ code: 'RESONA_PLUS_AMOUNT_INVALID', message: 'Exactly one debit or credit must be a positive safe-integer JPY value using the published numeric field.', severity: 'error', row: row.sourceRow })
      }
      if (balance == null) {
        valid = false
        issues.push({ code: 'RESONA_PLUS_BALANCE_INVALID', message: 'Running balance must be an unsigned safe-integer JPY value.', severity: 'error', row: row.sourceRow, column: '残高(円)' })
      }
      const expectedDirection = outgoing.value == null ? '入金' : '出金'
      if (direction !== expectedDirection) {
        valid = false
        issues.push({ code: 'RESONA_PLUS_DIRECTION_INVALID', message: 'Transaction type must be 入金 or 出金 and agree with the populated amount column.', severity: 'error', row: row.sourceRow, column: '取引区分' })
      }
      if (detailType === '取消') {
        valid = false
        issues.push({ code: 'RESONA_PLUS_CANCELLATION_UNSUPPORTED', message: 'Cancellation details require explicit reversal semantics and are not imported by this adapter.', severity: 'error', row: row.sourceRow, column: '明細区分' })
      } else if (detailType !== '') {
        valid = false
        issues.push({ code: 'RESONA_PLUS_DETAIL_TYPE_UNSUPPORTED', message: 'Only a blank detail classification is supported.', severity: 'error', row: row.sourceRow, column: '明細区分' })
      }
      if (value['小切手区分'].trim() || value['金融機関名'].trim() || value['支店名'].trim()) {
        valid = false
        issues.push({ code: 'RESONA_PLUS_RESERVED_FIELD_NONEMPTY', message: 'Published blank-only check, financial-institution, and branch fields must remain empty.', severity: 'error', row: row.sourceRow })
      }
      if (!bounded(description, 69) || !bounded(memo, 40)) {
        valid = false
        issues.push({ code: 'RESONA_PLUS_TEXT_LIMIT_EXCEEDED', message: 'Description or memo exceeds the published field length.', severity: 'error', row: row.sourceRow })
      }
      if (!description && !memo) {
        valid = false
        issues.push({ code: 'RESONA_PLUS_DESCRIPTION_MISSING', message: 'Description or memo is required for review.', severity: 'error', row: row.sourceRow })
      }
      if (!valid || !date || balance == null || (outgoing.value == null) === (incoming.value == null)) continue

      const detail = valueDate ? `起算日 ${valueDate}` : ''
      const candidate: BankTransactionCandidate = {
        kind: 'bank-transaction', lineage: row,
        ...(input.accountHint ? { accountHint: input.accountHint } : {}),
        transactionDate: date,
        description,
        descriptionDetail: detail,
        outgoingAmount: outgoing.value,
        incomingAmount: incoming.value,
        balance,
        memo,
        fundsAvailabilityCode: '',
        debitCreditCode: direction,
        suggestedType: outgoing.value != null && CARD_PAYMENT.test(`${description} ${memo}`) ? 'CARD_PAYMENT' : 'UNKNOWN',
      }
      details.push({ candidate, date, balance, delta: (incoming.value ?? 0) - (outgoing.value ?? 0) })
    }
    if (details.length === 0) {
      issues.push({ code: 'RESONA_PLUS_DETAILS_MISSING', message: 'At least one supported transaction detail is required.', severity: 'error' })
    }
    const sourceOrder = details.length > 0 ? validateSourceOrder(details, issues) : null
    return {
      adapterId: this.id,
      records: details.map(({ candidate }) => candidate),
      issues,
      metadata: {
        institution: 'RESONA_BANK',
        contract: 'WEB_DEPOSIT_WITHDRAWAL_MEISAI_PLUS_2026_05',
        delimiter: csv.delimiter,
        headerRow: 1,
        accountDescriptorPresent: accountDescriptor != null,
        sourceOrder,
        exportSequenceIsDurableTransactionId: false,
      },
    }
  },
}
