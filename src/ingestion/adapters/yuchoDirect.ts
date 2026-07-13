import { normalizeHeader, rowObject, tokenizeCsv } from '../csv'
import { normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { BankTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

// Exact public ゆうちょダイレクト personal-account CSV headers. Do not add
// aliases based on third-party examples: an unknown layout must remain reviewable.
const HEADERS = [
  '取引日',
  '入出金明細ID',
  '受入金額(円)',
  '払出金額(円)',
  '詳細1',
  '詳細2',
  '現在(貸付)高',
] as const

const normalizedHeaders = HEADERS.map(normalizeHeader)

function isExactHeader(fields: readonly string[]): boolean {
  return fields.length === normalizedHeaders.length
    && fields.map(normalizeHeader).every((field, index) => field === normalizedHeaders[index])
}

function compactDate(value: string): string | null {
  const match = value.normalize('NFKC').trim().match(/^(\d{4})(\d{2})(\d{2})$/)
  return match ? parseJapaneseDate(`${match[1]}-${match[2]}-${match[3]}`) : null
}

function optionalPositiveJpy(value: string): { value: number | null; invalid: boolean } {
  const raw = value.normalize('NFKC').trim()
  if (!raw) return { value: null, invalid: false }
  const parsed = parseJapaneseAmount(raw)
  if (parsed == null || !Number.isSafeInteger(parsed) || parsed <= 0) return { value: null, invalid: true }
  return { value: parsed, invalid: false }
}

function signedJpy(value: string): number | null {
  const parsed = parseJapaneseAmount(value)
  return parsed != null && Number.isSafeInteger(parsed) ? parsed : null
}

export const yuchoDirectAdapter: ImportAdapter<BankTransactionCandidate> = {
  id: 'yucho-direct-ledger-v1',
  detect(input) {
    const header = tokenizeCsv(input.text).rows.slice(0, 32).find((row) => isExactHeader(row.fields))
    return {
      adapterId: this.id,
      score: header ? 1 : 0,
      reasons: [header ? `Exact Yucho Direct header found on row ${header.sourceRow}` : 'Exact Yucho Direct header not found'],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const headerIndex = csv.rows.slice(0, 32).findIndex((row) => isExactHeader(row.fields))
    if (headerIndex < 0) {
      return {
        adapterId: this.id,
        records: [],
        issues: [...issues, { code: 'YUCHO_HEADER_MISSING', message: 'Exact Yucho Direct statement header was not found.', severity: 'error' }],
        metadata: {},
      }
    }

    const records: BankTransactionCandidate[] = []
    const sequences = new Set<string>()
    let previousBalance: number | null = null
    for (const row of csv.rows.slice(headerIndex + 1)) {
      if (row.fields.length !== normalizedHeaders.length) {
        issues.push({ code: 'YUCHO_ROW_WIDTH_INVALID', message: 'Yucho Direct detail row must contain exactly seven columns.', severity: 'error', row: row.sourceRow })
        continue
      }
      const value = rowObject(normalizedHeaders, row)
      const sequence = value['入出金明細ID'].normalize('NFKC').trim()
      if (!sequence) {
        issues.push({ code: 'YUCHO_SEQUENCE_MISSING', message: 'Yucho Direct export sequence is missing.', severity: 'error', row: row.sourceRow, column: '入出金明細ID' })
        continue
      }
      if (sequences.has(sequence)) {
        issues.push({ code: 'YUCHO_SEQUENCE_DUPLICATE', message: 'Yucho Direct export sequence is duplicated within this file.', severity: 'error', row: row.sourceRow, column: '入出金明細ID' })
        continue
      }
      sequences.add(sequence)

      const transactionDate = compactDate(value['取引日'])
      if (!transactionDate) issues.push({ code: 'YUCHO_DATE_INVALID', message: 'Yucho Direct transaction date must be a valid YYYYMMDD date.', severity: 'error', row: row.sourceRow, column: '取引日' })

      const incoming = optionalPositiveJpy(value['受入金額(円)'])
      const outgoing = optionalPositiveJpy(value['払出金額(円)'])
      if (incoming.invalid || outgoing.invalid) {
        issues.push({ code: 'YUCHO_AMOUNT_INVALID', message: 'Yucho Direct amounts must be positive integer JPY values.', severity: 'error', row: row.sourceRow })
      }
      if (incoming.value != null && outgoing.value != null) {
        issues.push({ code: 'YUCHO_AMOUNT_AMBIGUOUS', message: 'Yucho Direct row cannot contain both incoming and outgoing amounts.', severity: 'error', row: row.sourceRow })
      } else if (incoming.value == null && outgoing.value == null && !incoming.invalid && !outgoing.invalid) {
        issues.push({ code: 'YUCHO_AMOUNT_MISSING', message: 'Yucho Direct row must contain one incoming or outgoing amount.', severity: 'error', row: row.sourceRow })
      }

      const balance = signedJpy(value['現在(貸付)高'])
      if (balance == null) issues.push({ code: 'YUCHO_BALANCE_INVALID', message: 'Yucho Direct current balance must be an integer JPY value.', severity: 'error', row: row.sourceRow, column: '現在(貸付)高' })
      if (previousBalance != null && balance != null && (incoming.value != null) !== (outgoing.value != null)) {
        const expected: number = previousBalance + (incoming.value ?? 0) - (outgoing.value ?? 0)
        if (expected !== balance) issues.push({ code: 'YUCHO_BALANCE_MISMATCH', message: 'Yucho Direct running balance does not reconcile with the previous row.', severity: 'error', row: row.sourceRow, column: '現在(貸付)高' })
      }
      if (balance != null) previousBalance = balance

      records.push({
        kind: 'bank-transaction',
        lineage: row,
        ...(input.accountHint ? { accountHint: input.accountHint } : {}),
        // 入出金明細ID is an export-time sequence, not a durable transaction ID.
        transactionDate,
        description: normalizeJapaneseText(value['詳細1']),
        descriptionDetail: normalizeJapaneseText(value['詳細2']),
        outgoingAmount: outgoing.value,
        incomingAmount: incoming.value,
        balance,
        memo: '',
        fundsAvailabilityCode: '',
        debitCreditCode: outgoing.value == null ? 'IN' : 'OUT',
        // In official Yucho terminology カード can mean an ATM cash-card event.
        suggestedType: 'UNKNOWN',
      })
    }

    return {
      adapterId: this.id,
      records,
      issues,
      metadata: {
        institution: 'JP_BANK',
        delimiter: csv.delimiter,
        headerRow: csv.rows[headerIndex].sourceRow,
        sourceOrder: 'OLDEST_FIRST',
        exportSequenceIsDurableTransactionId: false,
      },
    }
  },
}
