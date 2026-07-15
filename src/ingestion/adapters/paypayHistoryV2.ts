import { normalizeHeader, rowObject, tokenizeCsv, type CsvRow } from '../csv'
import { normalizeJapaneseText, parseJapaneseDateTime } from '../normalize'
import type { ImportAdapter, ParseIssue, WalletEventCandidate, WalletEventLegCandidate, WalletFundingLegCandidate } from '../types'

const HEADERS = [
  'Date & Time',
  'Amount Outgoing (Yen)',
  'Amount Incoming (Yen)',
  'Transaction Type',
  'Payment Option',
  'Transaction ID',
  'Description',
] as const
const NORMALIZED_HEADERS = HEADERS.map(normalizeHeader)
const MAX_SOURCE_ROWS = 20_000
const MAX_EVENTS = 10_000
const MAX_LEGS_PER_EVENT = 64
const MAX_ID_CHARS = 256
const MAX_TYPE_CHARS = 256
const MAX_TEXT_CHARS = 4_096

interface EventBuilder {
  occurredAt: string
  counterparty: string
  types: string[]
  legs: WalletEventLegCandidate[]
}

function exactHeader(row: CsvRow | undefined): boolean {
  return row != null
    && row.sourceRow === 1
    && row.sourceRowEnd === 1
    && row.fields.length === NORMALIZED_HEADERS.length
    && row.fields.map(normalizeHeader).every((field, index) => field === NORMALIZED_HEADERS[index])
}

function positiveJpy(raw: string): { value: number | null; invalid: boolean } {
  const normalized = raw.normalize('NFKC').trim()
  if (!normalized) return { value: null, invalid: false }
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(normalized)) return { value: null, invalid: true }
  const value = Number(normalized.replaceAll(',', ''))
  return Number.isSafeInteger(value) && value > 0
    ? { value, invalid: false }
    : { value: null, invalid: true }
}

function strictDateTime(raw: string): string | null {
  const normalized = raw.normalize('NFKC').trim()
  const match = normalized.match(/^\d{4}[/.年-]\d{1,2}[/.月-]\d{1,2}日?[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? '0') > 59) return null
  return parseJapaneseDateTime(normalized)
}

function parseFunding(raw: string): { funding: WalletFundingLegCandidate[]; invalid: boolean } {
  const normalized = raw.normalize('NFKC').trim()
  if (!/[()]/.test(normalized)) return { funding: [], invalid: false }
  const funding: WalletFundingLegCandidate[] = []
  const pattern = /(?:^|[,、;]\s*)([^,、;]+?)\s*\(\s*([\d,]+)\s*(?:円|yen)\s*\)/giy
  let consumed = 0
  while (consumed < normalized.length) {
    pattern.lastIndex = consumed
    const match = pattern.exec(normalized)
    if (!match || match.index !== consumed) return { funding: [], invalid: true }
    const method = normalizeJapaneseText(match[1])
    const amount = positiveJpy(match[2])
    if (!method || method.length > MAX_TEXT_CHARS || amount.invalid || amount.value == null) return { funding: [], invalid: true }
    funding.push({ method, amount: amount.value, currency: 'JPY' })
    consumed = pattern.lastIndex
  }
  return { funding, invalid: funding.length === 0 }
}

function bounded(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max
}

export const payPayHistoryV2Adapter: ImportAdapter<WalletEventCandidate> = {
  id: 'paypay-history-v2',
  detect(input) {
    const matched = exactHeader(tokenizeCsv(input.text).rows[0])
    return {
      adapterId: this.id,
      score: matched ? 1 : 0,
      reasons: [matched ? 'Exact ordered seven-column PayPay history header matched' : 'Exact PayPay history v2 header not found'],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    if (!exactHeader(csv.rows[0])) {
      return {
        adapterId: this.id,
        records: [],
        issues: [...issues, { code: 'PAYPAY_V2_HEADER_INVALID', message: 'The exact ordered seven-column PayPay history header is required on physical row 1.', severity: 'error' }],
        metadata: {},
      }
    }
    const sourceRows = csv.rows.slice(1)
    if (sourceRows.length > MAX_SOURCE_ROWS) {
      issues.push({ code: 'PAYPAY_V2_ROW_LIMIT_EXCEEDED', message: `At most ${MAX_SOURCE_ROWS} source rows are supported.`, severity: 'error' })
    }
    const groups = new Map<string, EventBuilder>()
    const duplicateRows = new Set<string>()
    for (const row of sourceRows.slice(0, MAX_SOURCE_ROWS)) {
      if (row.fields.length !== HEADERS.length) {
        issues.push({ code: 'PAYPAY_V2_ROW_WIDTH_INVALID', message: 'Every PayPay history detail must contain exactly seven columns.', severity: 'error', row: row.sourceRow })
        continue
      }
      const duplicateKey = JSON.stringify(row.fields.map((field) => field.normalize('NFKC').trim()))
      if (duplicateRows.has(duplicateKey)) {
        issues.push({ code: 'PAYPAY_V2_ROW_DUPLICATE', message: 'A duplicate physical PayPay history detail was rejected.', severity: 'error', row: row.sourceRow })
        continue
      }
      duplicateRows.add(duplicateKey)
      const value = rowObject(NORMALIZED_HEADERS, row)
      const dateRaw = value['Date & Time'].normalize('NFKC').trim()
      const occurredAt = strictDateTime(dateRaw)
      const outgoing = positiveJpy(value['Amount Outgoing (Yen)'])
      const incoming = positiveJpy(value['Amount Incoming (Yen)'])
      const transactionType = normalizeJapaneseText(value['Transaction Type'])
      const paymentOption = normalizeJapaneseText(value['Payment Option'])
      const transactionId = value['Transaction ID'].normalize('NFKC').trim()
      const counterparty = normalizeJapaneseText(value['Description'])
      const parsedFunding = parseFunding(paymentOption)
      let valid = true
      if (!occurredAt) {
        valid = false
        issues.push({ code: 'PAYPAY_V2_DATETIME_INVALID', message: 'PayPay date and time must be a valid calendar date and clock time.', severity: 'error', row: row.sourceRow, column: 'Date & Time' })
      }
      if (outgoing.invalid || incoming.invalid || (outgoing.value == null) === (incoming.value == null)) {
        valid = false
        issues.push({ code: 'PAYPAY_V2_AMOUNT_INVALID', message: 'Exactly one incoming or outgoing amount must be a positive safe-integer JPY value.', severity: 'error', row: row.sourceRow })
      }
      if (!bounded(transactionType, MAX_TYPE_CHARS)) {
        valid = false
        issues.push({ code: 'PAYPAY_V2_TYPE_INVALID', message: 'Transaction Type is missing or exceeds the supported bound.', severity: 'error', row: row.sourceRow, column: 'Transaction Type' })
      }
      if (!bounded(transactionId, MAX_ID_CHARS)) {
        valid = false
        issues.push({ code: 'PAYPAY_V2_ID_INVALID', message: 'Transaction ID is missing or exceeds the supported bound.', severity: 'error', row: row.sourceRow, column: 'Transaction ID' })
      }
      if (!bounded(counterparty, MAX_TEXT_CHARS) || paymentOption.length > MAX_TEXT_CHARS) {
        valid = false
        issues.push({ code: 'PAYPAY_V2_TEXT_INVALID', message: 'Description or Payment Option is missing or exceeds the supported bound.', severity: 'error', row: row.sourceRow })
      }
      if (parsedFunding.invalid) {
        valid = false
        issues.push({ code: 'PAYPAY_V2_FUNDING_INVALID', message: 'Funding components must use complete positive integer method(amount yen) entries.', severity: 'error', row: row.sourceRow, column: 'Payment Option' })
      } else if (parsedFunding.funding.length > 0 && outgoing.value != null) {
        const total = parsedFunding.funding.reduce((sum, item) => sum + item.amount, 0)
        if (!Number.isSafeInteger(total) || total !== outgoing.value) {
          valid = false
          issues.push({ code: 'PAYPAY_V2_FUNDING_MISMATCH', message: 'Funding components must equal the exact outgoing amount.', severity: 'error', row: row.sourceRow, column: 'Payment Option' })
        }
      }
      if (!valid || !occurredAt || !transactionId || (outgoing.value == null) === (incoming.value == null)) continue
      const existing = groups.get(transactionId)
      if (existing && (existing.occurredAt !== occurredAt || existing.counterparty !== counterparty)) {
        issues.push({ code: 'PAYPAY_V2_EVENT_INCONSISTENT', message: 'Rows sharing a Transaction ID must have the same date/time and description.', severity: 'error', row: row.sourceRow, column: 'Transaction ID' })
        continue
      }
      if (!existing && groups.size >= MAX_EVENTS) {
        issues.push({ code: 'PAYPAY_V2_EVENT_LIMIT_EXCEEDED', message: `At most ${MAX_EVENTS} business events are supported.`, severity: 'error', row: row.sourceRow })
        continue
      }
      const current = existing ?? { occurredAt, counterparty, types: [], legs: [] }
      if (current.legs.length >= MAX_LEGS_PER_EVENT) {
        issues.push({ code: 'PAYPAY_V2_LEG_LIMIT_EXCEEDED', message: `A PayPay event may contain at most ${MAX_LEGS_PER_EVENT} legs.`, severity: 'error', row: row.sourceRow, column: 'Transaction ID' })
        continue
      }
      current.types.push(transactionType)
      current.legs.push({
        lineage: row, transactionType, outgoingAmount: outgoing.value, incomingAmount: incoming.value,
        paymentOption, funding: parsedFunding.funding,
      })
      groups.set(transactionId, current)
    }
    const records: WalletEventCandidate[] = []
    for (const [transactionId, group] of groups) {
      const totalOutgoing = group.legs.reduce((sum, leg) => sum + (leg.outgoingAmount ?? 0), 0)
      const totalIncoming = group.legs.reduce((sum, leg) => sum + (leg.incomingAmount ?? 0), 0)
      if (!Number.isSafeInteger(totalOutgoing) || !Number.isSafeInteger(totalIncoming)) {
        issues.push({ code: 'PAYPAY_V2_EVENT_TOTAL_UNSAFE', message: 'Grouped event totals exceed safe-integer JPY bounds.', severity: 'error', row: group.legs[0]?.lineage.sourceRow })
        continue
      }
      records.push({
        kind: 'wallet-event', transactionId, occurredAt: group.occurredAt, counterparty: group.counterparty,
        eventType: [...new Set(group.types)].join(' + '), legs: group.legs, totalOutgoing, totalIncoming,
      })
    }
    if (records.length === 0) issues.push({ code: 'PAYPAY_V2_EVENTS_MISSING', message: 'At least one valid PayPay business event is required.', severity: 'error' })
    return {
      adapterId: this.id,
      records,
      issues,
      metadata: {
        headerRow: 1, sourceRows: sourceRows.length, businessEvents: records.length,
        schemaBasis: 'EXACT_SEVEN_COLUMN_HISTORY', unknownTransactionTypesRemainReviewData: true,
      },
    }
  },
}
