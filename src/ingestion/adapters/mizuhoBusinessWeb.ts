import { normalizeHeader, rowObject, tokenizeCsv, type CsvRow } from '../csv'
import { normalizeJapaneseText, parseJapaneseDate } from '../normalize'
import type { BankTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

const HEADERS = [
  '照会口座', '番号', '勘定日', '(起算日)', '出金(円)', '入金(円)', '小切手区分',
  '残高(円)', '取引区分', '明細区分', '金融機関名', '支店名', '摘要',
] as const
const NORMALIZED_HEADERS = HEADERS.map(normalizeHeader)
const MAX_DETAIL_ROWS = 100_000
const CARD_PAYMENT = /(カード|CARD|JCB|AMEX|アメックス)/i
const TRANSACTION_TYPES = new Set([
  '振込入金', '取立入金', '入金', '出金', '現金', '振替入金', '取立',
  '振込', '他券振込', '振替支払', '交換払', '小切手', '他店券',
])
const CHECK_TYPES = new Set(['', '小切手', '他店券'])

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

function length(value: string): number {
  return Array.from(value.normalize('NFKC').trim()).length
}

function positiveAmount(value: string): { value: number | null; invalid: boolean; negative: boolean } {
  const normalized = value.normalize('NFKC').trim()
  if (!normalized) return { value: null, invalid: false, negative: false }
  if (/^-\d{1,14}$/.test(normalized)) return { value: null, invalid: false, negative: true }
  if (!/^\d{1,15}$/.test(normalized)) return { value: null, invalid: true, negative: false }
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? { value: parsed, invalid: false, negative: false }
    : { value: null, invalid: true, negative: false }
}

function signedBalance(value: string): number | null {
  const normalized = value.normalize('NFKC').trim()
  if (!/^-?\d{1,18}$/.test(normalized)) return null
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
    code: candidates.length === 0 ? 'MIZUHO_BUSINESS_BALANCE_OR_ORDER_INVALID' : 'MIZUHO_BUSINESS_SOURCE_ORDER_AMBIGUOUS',
    message: candidates.length === 0
      ? 'Dates and running balances do not prove one continuous oldest-first or newest-first source order.'
      : 'Dates and running balances leave the source order ambiguous.',
    severity: 'error',
  })
  return null
}

export const mizuhoBusinessWebAdapter: ImportAdapter<BankTransactionCandidate> = {
  id: 'mizuho-business-web-statement-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const matched = exactHeader(csv.rows[0])
    return {
      adapterId: this.id,
      score: matched ? 1 : 0,
      reasons: [matched
        ? 'Exact Mizuho Business Web thirteen-column CSV header found in the first physical record'
        : 'Exact first-record Mizuho Business Web CSV header not found'],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    if (!exactHeader(csv.rows[0])) {
      return {
        adapterId: this.id,
        records: [],
        issues: [...issues, { code: 'MIZUHO_BUSINESS_HEADER_INVALID', message: 'The exact thirteen-column Mizuho Business Web header must be the first physical record.', severity: 'error' }],
        metadata: {},
      }
    }

    const sourceRows = csv.rows.slice(1)
    if (sourceRows.length > MAX_DETAIL_ROWS) {
      issues.push({ code: 'MIZUHO_BUSINESS_DETAIL_LIMIT_EXCEEDED', message: `At most ${MAX_DETAIL_ROWS} detail rows are supported.`, severity: 'error' })
    }
    const details: StrictDetail[] = []
    const dateNumbers = new Set<string>()
    let accountDescriptor: string | null = null
    for (const row of sourceRows.slice(0, MAX_DETAIL_ROWS)) {
      if (row.fields.length !== HEADERS.length) {
        issues.push({ code: 'MIZUHO_BUSINESS_ROW_WIDTH_INVALID', message: 'Every Mizuho Business Web detail must contain exactly thirteen columns.', severity: 'error', row: row.sourceRow })
        continue
      }
      const value = rowObject(NORMALIZED_HEADERS, row)
      const account = value['照会口座'].normalize('NFKC').trim()
      const transactionNumber = value['番号'].normalize('NFKC').trim()
      const dateRaw = value['勘定日'].normalize('NFKC').trim()
      const date = length(dateRaw) <= 14 ? parseJapaneseDate(dateRaw) : null
      const valueDateRaw = value['(起算日)'].normalize('NFKC').trim()
      const valueDate = valueDateRaw && length(valueDateRaw) <= 14 ? parseJapaneseDate(valueDateRaw) : null
      const outgoing = positiveAmount(value['出金(円)'])
      const incoming = positiveAmount(value['入金(円)'])
      const balance = signedBalance(value['残高(円)'])
      const transactionType = normalizeJapaneseText(value['取引区分'])
      const detailType = normalizeJapaneseText(value['明細区分'])
      const checkType = normalizeJapaneseText(value['小切手区分'])
      const institution = normalizeJapaneseText(value['金融機関名'])
      const branch = normalizeJapaneseText(value['支店名'])
      const summary = normalizeJapaneseText(value['摘要'])
      let valid = true

      if (!account || length(account) > 71) {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_ACCOUNT_INVALID', message: 'Inquiry account must be present and at most 71 characters.', severity: 'error', row: row.sourceRow, column: '照会口座' })
      } else if (accountDescriptor != null && account !== accountDescriptor) {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_ACCOUNT_MIXED', message: 'One import file must contain exactly one inquiry account descriptor.', severity: 'error', row: row.sourceRow, column: '照会口座' })
      } else accountDescriptor = account
      if (!transactionNumber || length(transactionNumber) > 5) {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_NUMBER_INVALID', message: 'Transaction number must be present and at most five characters.', severity: 'error', row: row.sourceRow, column: '番号' })
      }
      if (!date) {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_DATE_INVALID', message: 'Accounting date must be a valid Gregorian date within the published 14-character field.', severity: 'error', row: row.sourceRow, column: '勘定日' })
      }
      if (valueDateRaw && !valueDate) {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_VALUE_DATE_INVALID', message: 'Non-empty value date must be a valid Gregorian date within 14 characters.', severity: 'error', row: row.sourceRow, column: '(起算日)' })
      }
      if (date && transactionNumber) {
        const key = `${date}\u0000${transactionNumber}`
        if (dateNumbers.has(key)) {
          valid = false
          issues.push({ code: 'MIZUHO_BUSINESS_NUMBER_DUPLICATE', message: 'Transaction number is duplicated within the same accounting date.', severity: 'error', row: row.sourceRow, column: '番号' })
        } else dateNumbers.add(key)
      }
      if (outgoing.negative || incoming.negative) {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_NEGATIVE_AMOUNT_UNSUPPORTED', message: 'Negative correction amounts require explicit reversal semantics and are not imported.', severity: 'error', row: row.sourceRow })
      } else if (outgoing.invalid || incoming.invalid || (outgoing.value == null) === (incoming.value == null)) {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_AMOUNT_INVALID', message: 'Exactly one debit or credit must be a positive safe-integer JPY value.', severity: 'error', row: row.sourceRow })
      }
      if (balance == null) {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_BALANCE_INVALID', message: 'Running balance must be a signed safe-integer JPY value.', severity: 'error', row: row.sourceRow, column: '残高(円)' })
      }
      if (!TRANSACTION_TYPES.has(transactionType)) {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_TRANSACTION_TYPE_UNSUPPORTED', message: 'Transaction type is outside the official Mizuho Business Web CSV value set.', severity: 'error', row: row.sourceRow, column: '取引区分' })
      }
      if (detailType === '取消' || detailType === '欠番') {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_CORRECTION_UNSUPPORTED', message: 'Cancellation and missing-number details require explicit correction semantics and are not imported.', severity: 'error', row: row.sourceRow, column: '明細区分' })
      } else if (detailType !== '') {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_DETAIL_TYPE_UNSUPPORTED', message: 'Only a blank normal detail classification is supported.', severity: 'error', row: row.sourceRow, column: '明細区分' })
      }
      if (!CHECK_TYPES.has(checkType)) {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_CHECK_TYPE_UNSUPPORTED', message: 'Check classification is outside the official blank, 小切手, or 他店券 set.', severity: 'error', row: row.sourceRow, column: '小切手区分' })
      }
      if (length(institution) > 15 || length(branch) > 15 || length(summary) > 69) {
        valid = false
        issues.push({ code: 'MIZUHO_BUSINESS_TEXT_LIMIT_EXCEEDED', message: 'Institution, branch, or summary exceeds the published field length.', severity: 'error', row: row.sourceRow })
      }
      if (!valid || !date || balance == null || (outgoing.value == null) === (incoming.value == null)) continue

      const description = summary || transactionType
      const descriptionDetail = [transactionType, institution, branch, checkType, valueDate ? `起算日 ${valueDate}` : '']
        .filter((item, index, all) => item && (index > 0 || item !== description) && all.indexOf(item) === index)
        .join(' ')
      const candidate: BankTransactionCandidate = {
        kind: 'bank-transaction', lineage: row,
        ...(input.accountHint ? { accountHint: input.accountHint } : {}),
        transactionDate: date,
        description,
        descriptionDetail,
        outgoingAmount: outgoing.value,
        incomingAmount: incoming.value,
        balance,
        memo: '',
        fundsAvailabilityCode: '',
        debitCreditCode: outgoing.value == null ? 'IN' : 'OUT',
        suggestedType: outgoing.value != null && CARD_PAYMENT.test(`${description} ${descriptionDetail}`) ? 'CARD_PAYMENT' : 'UNKNOWN',
      }
      details.push({ candidate, date, balance, delta: (incoming.value ?? 0) - (outgoing.value ?? 0) })
    }
    if (details.length === 0) {
      issues.push({ code: 'MIZUHO_BUSINESS_DETAILS_MISSING', message: 'At least one supported normal transaction detail is required.', severity: 'error' })
    }
    const sourceOrder = details.length > 0 ? validateSourceOrder(details, issues) : null
    return {
      adapterId: this.id,
      records: details.map(({ candidate }) => candidate),
      issues,
      metadata: {
        institution: 'MIZUHO_BANK',
        product: 'MIZUHO_BUSINESS_WEB',
        sourceEncoding: 'SHIFT_JIS',
        contract: 'DEPOSIT_WITHDRAWAL_CSV_13_FIELD',
        headerRow: 1,
        accountDescriptorPresent: accountDescriptor != null,
        sourceOrder,
        transactionNumberIsDurableTransactionId: false,
      },
    }
  },
}
