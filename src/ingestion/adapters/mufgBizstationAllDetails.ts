import { tokenizeCsv } from '../csv'
import { normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { BankTransactionCandidate, ImportAdapter, ParseIssue, SourceLineage } from '../types'

const HEADER_WIDTH = 15
const DETAIL_WIDTH = 7
const FINAL_WIDTH = 8
const CARD_PAYMENT = /(カード|CARD|JCB|AMEX|アメックス)/i

function normalized(value: string | undefined): string {
  return normalizeJapaneseText(value ?? '')
}

function unsignedInteger(value: string | undefined): number | null {
  const amount = parseJapaneseAmount(value)
  return amount != null && Number.isSafeInteger(amount) && amount >= 0 ? amount : null
}

function signedInteger(value: string | undefined): number | null {
  const amount = parseJapaneseAmount(value)
  return amount != null && Number.isSafeInteger(amount) ? amount : null
}

function optionalDirectionAmount(value: string | undefined): number | null {
  const amount = unsignedInteger(value)
  return amount === 0 ? null : amount
}

function exactStructure(text: string): boolean {
  const rows = tokenizeCsv(text).rows
  const header = rows[0]
  return header?.fields.length === HEADER_WIDTH
    && header.fields[0] === '1'
    && normalized(header.fields[9]) === '全明細'
    && rows.some((row) => row.fields.length === DETAIL_WIDTH && row.fields[0] === '2')
    && rows.some((row) => row.fields.length === 1 && row.fields[0] === '8')
    && rows.at(-1)?.fields.length === FINAL_WIDTH
    && rows.at(-1)?.fields[0] === '9'
}

function headerDateRange(value: string): { from: string; to: string } | null {
  const match = value.normalize('NFKC').trim().match(/^(.+?)-(.+)$/)
  if (!match) return null
  const from = parseJapaneseDate(match[1])
  const to = parseJapaneseDate(match[2])
  return from && to && from <= to ? { from, to } : null
}

type ReconciliationRow = {
  lineage: SourceLineage
  outgoing: number
  incoming: number
  balance: number
}

function determineSourceOrder(rows: readonly ReconciliationRow[], opening: number, closing: number): 'OLDEST_FIRST' | 'NEWEST_FIRST' | null {
  if (rows.length === 0) return opening === closing ? 'OLDEST_FIRST' : null
  const oldestFirst = opening + rows[0].incoming - rows[0].outgoing === rows[0].balance
    && rows.every((row, index) => index === 0 || rows[index - 1].balance + row.incoming - row.outgoing === row.balance)
    && rows.at(-1)?.balance === closing
  if (oldestFirst) return 'OLDEST_FIRST'
  const newestFirst = rows[0].balance === closing
    && rows.every((row, index) => index === 0 || row.balance + rows[index - 1].incoming - rows[index - 1].outgoing === rows[index - 1].balance)
    && opening + rows.at(-1)!.incoming - rows.at(-1)!.outgoing === rows.at(-1)!.balance
  return newestFirst ? 'NEWEST_FIRST' : null
}

export const mufgBizstationAllDetailsAdapter: ImportAdapter<BankTransactionCandidate> = {
  id: 'mufg-bizstation-all-details-v1',
  detect(input) {
    const matched = exactStructure(input.text)
    return {
      adapterId: this.id,
      score: matched ? 1 : 0,
      reasons: [matched ? 'Exact MUFG BizSTATION all-details record structure matched' : 'Exact MUFG BizSTATION all-details structure not found'],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    if (!exactStructure(input.text)) {
      return {
        adapterId: this.id,
        records: [],
        issues: [...issues, { code: 'MUFG_BIZSTATION_STRUCTURE_INVALID', message: 'Exact MUFG BizSTATION all-details structure was not found.', severity: 'error' }],
        metadata: {},
      }
    }

    const header = csv.rows[0]
    const final = csv.rows.at(-1)!
    const range = headerDateRange(header.fields[8] ?? '')
    if (!range) issues.push({ code: 'MUFG_BIZSTATION_PERIOD_INVALID', message: 'The statement period must contain two valid dates.', severity: 'error', row: header.sourceRow })
    if (!parseJapaneseDate(header.fields[10])) issues.push({ code: 'MUFG_BIZSTATION_OPERATION_DATE_INVALID', message: 'The export operation date is invalid.', severity: 'error', row: header.sourceRow })
    if (!/^\d{1,2}:\d{2}$/.test(header.fields[11] ?? '')) issues.push({ code: 'MUFG_BIZSTATION_OPERATION_TIME_INVALID', message: 'The export operation time is invalid.', severity: 'error', row: header.sourceRow })
    const accountCode = `${header.fields[3] ?? ''}${header.fields[4] ?? ''}`
    const expectedAccountName = { '10': '普通', '20': '当座', '11': 'BCL' }[accountCode as '10' | '20' | '11']
    if (!expectedAccountName || normalized(header.fields[5]).toUpperCase() !== expectedAccountName) {
      issues.push({ code: 'MUFG_BIZSTATION_ACCOUNT_TYPE_INVALID', message: 'The official account type code and name do not agree.', severity: 'error', row: header.sourceRow })
    }
    if (!/^\d{7}$/.test(header.fields[6] ?? '')) issues.push({ code: 'MUFG_BIZSTATION_ACCOUNT_NUMBER_INVALID', message: 'The account number must be seven digits.', severity: 'error', row: header.sourceRow })

    const records: BankTransactionCandidate[] = []
    const reconciliationRows: ReconciliationRow[] = []
    let sawFooter = false
    for (const row of csv.rows.slice(1, -1)) {
      if (row.fields[0] === '8') {
        if (row.fields.length !== 1 || sawFooter) issues.push({ code: 'MUFG_BIZSTATION_FOOTER_INVALID', message: 'The export must contain one single-column footer record.', severity: 'error', row: row.sourceRow })
        sawFooter = true
        continue
      }
      if (row.fields[0] !== '2' || row.fields.length !== DETAIL_WIDTH || sawFooter) {
        issues.push({ code: 'MUFG_BIZSTATION_DETAIL_STRUCTURE_INVALID', message: 'Detail records must contain seven columns before the footer.', severity: 'error', row: row.sourceRow })
        continue
      }
      const transactionDate = parseJapaneseDate(row.fields[1])
      if (!transactionDate) issues.push({ code: 'MUFG_BIZSTATION_DATE_INVALID', message: 'The detail date is invalid.', severity: 'error', row: row.sourceRow, column: '指定日' })
      const outgoingRaw = unsignedInteger(row.fields[4])
      const incomingRaw = unsignedInteger(row.fields[5])
      const balance = signedInteger(row.fields[6])
      if (outgoingRaw == null || incomingRaw == null || balance == null) {
        issues.push({ code: 'MUFG_BIZSTATION_AMOUNT_INVALID', message: 'Amounts and balances must be safe integer JPY values.', severity: 'error', row: row.sourceRow })
      } else if ((outgoingRaw > 0) === (incomingRaw > 0)) {
        issues.push({ code: 'MUFG_BIZSTATION_DIRECTION_INVALID', message: 'Exactly one of payment or deposit must be greater than zero.', severity: 'error', row: row.sourceRow })
      } else {
        reconciliationRows.push({ lineage: row, outgoing: outgoingRaw, incoming: incomingRaw, balance })
      }
      const description = normalized(row.fields[3])
      records.push({
        kind: 'bank-transaction', lineage: row,
        ...(input.accountHint ? { accountHint: input.accountHint } : {}),
        transactionDate,
        description,
        descriptionDetail: normalized(row.fields[2]),
        outgoingAmount: outgoingRaw == null ? null : optionalDirectionAmount(row.fields[4]),
        incomingAmount: incomingRaw == null ? null : optionalDirectionAmount(row.fields[5]),
        balance,
        memo: '', fundsAvailabilityCode: '',
        debitCreditCode: outgoingRaw != null && outgoingRaw > 0 ? 'OUT' : incomingRaw != null && incomingRaw > 0 ? 'IN' : '',
        suggestedType: CARD_PAYMENT.test(description) ? 'CARD_PAYMENT' : 'UNKNOWN',
      })
    }
    if (!sawFooter) issues.push({ code: 'MUFG_BIZSTATION_FOOTER_MISSING', message: 'The footer record is missing.', severity: 'error' })

    const outgoingCount = unsignedInteger(final.fields[1])
    const incomingCount = unsignedInteger(final.fields[2])
    const outgoingTotal = unsignedInteger(final.fields[4])
    const incomingTotal = unsignedInteger(final.fields[5])
    const openingBalance = signedInteger(final.fields[6])
    const closingBalance = signedInteger(final.fields[7])
    if ([outgoingCount, incomingCount, outgoingTotal, incomingTotal, openingBalance, closingBalance].some((value) => value == null)) {
      issues.push({ code: 'MUFG_BIZSTATION_FINAL_INVALID', message: 'The final record contains an invalid count, total, or balance.', severity: 'error', row: final.sourceRow })
    }
    const actualOutgoing = reconciliationRows.filter((row) => row.outgoing > 0)
    const actualIncoming = reconciliationRows.filter((row) => row.incoming > 0)
    if (outgoingCount != null && outgoingTotal != null && (outgoingCount !== actualOutgoing.length || outgoingTotal !== actualOutgoing.reduce((sum, row) => sum + row.outgoing, 0))) {
      issues.push({ code: 'MUFG_BIZSTATION_PAYMENT_TOTAL_MISMATCH', message: 'Payment count or total does not agree with detail records.', severity: 'error', row: final.sourceRow })
    }
    if (incomingCount != null && incomingTotal != null && (incomingCount !== actualIncoming.length || incomingTotal !== actualIncoming.reduce((sum, row) => sum + row.incoming, 0))) {
      issues.push({ code: 'MUFG_BIZSTATION_DEPOSIT_TOTAL_MISMATCH', message: 'Deposit count or total does not agree with detail records.', severity: 'error', row: final.sourceRow })
    }
    const sourceOrder = openingBalance != null && closingBalance != null && reconciliationRows.length === records.length
      ? determineSourceOrder(reconciliationRows, openingBalance, closingBalance) : null
    if (!sourceOrder) issues.push({ code: 'MUFG_BIZSTATION_BALANCE_MISMATCH', message: 'Running and final balances do not reconcile in either source order.', severity: 'error', row: final.sourceRow })

    return {
      adapterId: this.id,
      records,
      issues,
      metadata: {
        institution: 'MUFG_BANK', product: 'BIZSTATION_ALL_DETAILS', delimiter: csv.delimiter,
        sourceEncoding: 'SHIFT_JIS', sourceOrder, periodStart: range?.from ?? null, periodEnd: range?.to ?? null,
        accountType: expectedAccountName ?? null,
      },
    }
  },
}
