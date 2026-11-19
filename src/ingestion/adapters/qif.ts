import { parseExactIntegerAmount } from '../normalize'
import type { BankTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

interface QifRecord {
  startLine: number
  endLine: number
  fields: Record<string, string>
  raw: string[]
  terminated: boolean
}

function scan(text: string): { header: string | null; accountBlocks: number; records: QifRecord[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
  let header: string | null = null
  let accountBlocks = 0
  const records: QifRecord[] = []
  let current: QifRecord | null = null
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim()
    const number = index + 1
    if (!line) return
    if (line.startsWith('!')) {
      if (/^!account/i.test(line)) accountBlocks += 1
      else if (/^!type:/i.test(line) && header == null) header = line.slice(6).trim()
      return
    }
    current ??= { startLine: number, endLine: number, fields: {}, raw: [], terminated: false }
    if (line === '^') {
      current.endLine = number
      current.terminated = true
      records.push(current)
      current = null
      return
    }
    const code = line[0]
    const value = line.slice(1).trim()
    current.endLine = number
    current.raw.push(line)
    // Split lines (S/E/$) repeat; keep the first value and mark the presence below.
    if (!(code in current.fields)) current.fields[code] = value
    else if (code === 'S' || code === 'E' || code === '$') current.fields[`${code}+`] = value
  })
  if (current) records.push(current)
  return { header, accountBlocks, records }
}

type DateParts = { year: number; first: number; second: number; order: 'YMD' | 'MD' | 'AMBIGUOUS' }

function validCalendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Parses unambiguous forms directly (YYYY-MM-DD, YYYY/MM/DD, Quicken M/D'YY).
 * a/b/YYYY is returned as parts so the file-level order can be proven first.
 */
function parseQifDate(value: string): { iso: string } | { parts: DateParts } | null {
  const compact = value.normalize('NFKC').replace(/\s+/g, '')
  let match = compact.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (match) { const iso = validCalendarDate(Number(match[1]), Number(match[2]), Number(match[3])); return iso ? { iso } : null }
  match = compact.match(/^(\d{1,2})\/(\d{1,2})'(\d{2})$/)
  if (match) { const iso = validCalendarDate(2000 + Number(match[3]), Number(match[1]), Number(match[2])); return iso ? { iso } : null }
  match = compact.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (match) return { parts: { year: Number(match[3]), first: Number(match[1]), second: Number(match[2]), order: 'AMBIGUOUS' } }
  return null
}

/** QIF bank-register adapter (!Type:Bank). Fails closed on ambiguous dates, splits, other types and fractional yen. */
export const qifBankAdapter: ImportAdapter<BankTransactionCandidate> = {
  id: 'qif-bank-v1',
  detect(input) {
    const { header, records } = scan(input.text)
    const found = header != null && records.some((record) => record.terminated && record.fields.D != null && record.fields.T != null)
    return { adapterId: this.id, score: found ? 1 : 0, reasons: [found ? 'QIF !Type header and terminated D/T record found' : 'QIF !Type header with a D/T record not found'] }
  },
  parse(input) {
    const { header, accountBlocks, records: raw } = scan(input.text)
    const issues: ParseIssue[] = []
    if (header == null || !/^(?:bank|cash)$/i.test(header)) {
      issues.push({ code: 'QIF_TYPE_UNSUPPORTED', message: `Only !Type:Bank QIF registers are supported (found ${header ?? 'none'}).`, severity: 'error' })
      return { adapterId: this.id, records: [], issues, metadata: { qifType: header } }
    }
    if (accountBlocks > 0) {
      issues.push({ code: 'QIF_ACCOUNT_BLOCKS_UNSUPPORTED', message: 'QIF files with !Account blocks (multiple accounts) cannot be mapped to a single destination account.', severity: 'error' })
      return { adapterId: this.id, records: [], issues, metadata: { qifType: header } }
    }

    // Prove the day/month order from the whole file before trusting any a/b/YYYY date.
    const parsedDates = raw.map((record) => (record.fields.D ? parseQifDate(record.fields.D) : null))
    let dayFirst = false
    let monthFirst = false
    let ambiguous = false
    for (const parsed of parsedDates) {
      if (!parsed || !('parts' in parsed)) continue
      const { first, second } = parsed.parts
      if (first > 12 && second <= 12) dayFirst = true
      else if (second > 12 && first <= 12) monthFirst = true
      else if (first !== second && first <= 12 && second <= 12) ambiguous = true
    }
    if (dayFirst && monthFirst) {
      issues.push({ code: 'QIF_DATE_ORDER_CONFLICT', message: 'QIF dates mix day-first and month-first values; the date order cannot be proven.', severity: 'error' })
    } else if (ambiguous && !dayFirst && !monthFirst) {
      issues.push({ code: 'QIF_DATE_ORDER_AMBIGUOUS', message: 'QIF a/b/YYYY dates are ambiguous between day-first and month-first; no date in the file proves the order.', severity: 'error' })
    }
    const orderProven = dayFirst !== monthFirst

    const records: BankTransactionCandidate[] = []
    raw.forEach((record, index) => {
      const row = record.startLine
      const lineage = { sourceRow: record.startLine, sourceRowEnd: record.endLine, rawFields: record.raw }
      if (!record.terminated) {
        issues.push({ code: 'QIF_RECORD_UNTERMINATED', message: 'QIF record is missing its closing ^ line.', severity: 'error', row })
        return
      }
      if (record.fields.S != null || record.fields.E != null || record.fields.$ != null) {
        issues.push({ code: 'QIF_SPLIT_UNSUPPORTED', message: 'QIF split transactions (S/E/$) are not supported.', severity: 'error', row })
        return
      }
      const parsed = parsedDates[index]
      let transactionDate: string | null = null
      let orderUnprovenReported = false
      if (parsed && 'iso' in parsed) transactionDate = parsed.iso
      else if (parsed) {
        const { first, second, year } = parsed.parts
        if (first === second) transactionDate = validCalendarDate(year, first, second)
        else if (orderProven) transactionDate = dayFirst ? validCalendarDate(year, second, first) : validCalendarDate(year, first, second)
        else orderUnprovenReported = first <= 12 && second <= 12 // already reported at file level
      }
      if (!transactionDate && !orderUnprovenReported) {
        issues.push({ code: 'QIF_DATE_INVALID', message: 'QIF D date must be YYYY-MM-DD, YYYY/MM/DD, M/D\'YY or an order-proven a/b/YYYY date.', severity: 'error', row, column: 'D' })
      }
      const amount = parseExactIntegerAmount(record.fields.T)
      if (amount == null || amount === 0) {
        issues.push({ code: 'QIF_AMOUNT_INVALID', message: 'QIF T amount must be a non-zero whole-yen amount.', severity: 'error', row, column: 'T' })
      }
      const payee = record.fields.P ?? ''
      const memo = record.fields.M ?? ''
      records.push({
        kind: 'bank-transaction',
        lineage,
        ...(input.accountHint ? { accountHint: input.accountHint } : {}),
        transactionDate,
        description: payee || memo,
        descriptionDetail: payee ? memo : '',
        outgoingAmount: amount != null && amount < 0 ? -amount : null,
        incomingAmount: amount != null && amount > 0 ? amount : null,
        balance: null,
        memo: '',
        fundsAvailabilityCode: '',
        debitCreditCode: amount != null && amount < 0 ? 'OUT' : 'IN',
        suggestedType: 'UNKNOWN',
      })
    })
    return { adapterId: this.id, records, issues, metadata: { qifType: header, dateOrder: orderProven ? (dayFirst ? 'DMY' : 'MDY') : 'UNKNOWN' } }
  },
}
