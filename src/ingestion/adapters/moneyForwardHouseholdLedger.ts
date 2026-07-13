import { normalizeHeader, rowObject, tokenizeCsv } from '../csv'
import { clampScore, normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { ImportAdapter, MoneyForwardHouseholdTransactionCandidate, ParseIssue } from '../types'

export const MONEY_FORWARD_HOUSEHOLD_HEADERS = [
  '計算対象', '日付', '内容', '金額(円)', '保有金融機関', '大項目', '中項目', 'メモ', '振替', 'ID',
] as const

const MAX_INSTITUTIONS_PER_FILE = 50

function normalizedHeader(value: string): string {
  return normalizeHeader(value).replace('金額（円）', '金額(円)')
}

function parseCalculationTarget(value: string): boolean | null {
  const normalized = normalizeJapaneseText(value).toUpperCase()
  if (['1', 'TRUE', '対象', '計算対象'].includes(normalized)) return true
  if (['0', 'FALSE', '対象外', '計算対象外'].includes(normalized)) return false
  return null
}

function parseTransfer(value: string): boolean | null {
  const normalized = normalizeJapaneseText(value).toUpperCase()
  if (['1', 'TRUE', '振替'].includes(normalized)) return true
  if (['', '0', 'FALSE', '通常', '対象外'].includes(normalized)) return false
  return null
}

export const moneyForwardHouseholdLedgerAdapter: ImportAdapter<MoneyForwardHouseholdTransactionCandidate> = {
  id: 'money-forward-me-household-ledger-v1',
  detect(input) {
    const rows = tokenizeCsv(input.text).rows.slice(0, 8)
    const best = Math.max(0, ...rows.map((row) => {
      const headers = row.fields.map(normalizedHeader)
      return MONEY_FORWARD_HOUSEHOLD_HEADERS.filter((header) => headers.includes(header)).length
    }))
    return {
      adapterId: this.id,
      score: clampScore(best / MONEY_FORWARD_HOUSEHOLD_HEADERS.length),
      reasons: [`${best}/${MONEY_FORWARD_HOUSEHOLD_HEADERS.length} official Money Forward ME household-ledger headers matched`],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const headerIndex = csv.rows.findIndex((row) => {
      const headers = row.fields.map(normalizedHeader)
      return MONEY_FORWARD_HOUSEHOLD_HEADERS.every((header) => headers.includes(header))
    })
    if (headerIndex < 0) {
      return {
        adapterId: this.id, records: [], metadata: {},
        issues: [...issues, { code: 'MONEY_FORWARD_HOUSEHOLD_HEADER_MISSING', message: 'Money Forward ME household-ledger header was not found.', severity: 'error' }],
      }
    }
    const headers = csv.rows[headerIndex].fields.map(normalizedHeader)
    const records: MoneyForwardHouseholdTransactionCandidate[] = []
    const institutions = new Set<string>()
    for (const row of csv.rows.slice(headerIndex + 1)) {
      if (row.fields.every((field) => !field.trim())) continue
      const fields = rowObject(headers, row)
      const calculationTarget = parseCalculationTarget(fields['計算対象'] ?? '')
      const isTransfer = parseTransfer(fields['振替'] ?? '')
      const transactionDate = parseJapaneseDate(fields['日付'])
      const signedAmountJpy = parseJapaneseAmount(fields['金額(円)'])
      const externalTransactionId = normalizeJapaneseText(fields.ID ?? '')
      const institution = normalizeJapaneseText(fields['保有金融機関'] ?? '')
      if (calculationTarget == null) issues.push({ code: 'MONEY_FORWARD_CALCULATION_TARGET_INVALID', message: '計算対象 must use a supported explicit value.', severity: 'error', row: row.sourceRow, column: '計算対象' })
      if (isTransfer == null) issues.push({ code: 'MONEY_FORWARD_TRANSFER_INVALID', message: '振替 must use a supported explicit value.', severity: 'error', row: row.sourceRow, column: '振替' })
      if (!transactionDate) issues.push({ code: 'MONEY_FORWARD_DATE_INVALID', message: '日付 is not a valid calendar date.', severity: 'error', row: row.sourceRow, column: '日付' })
      if (signedAmountJpy == null || !Number.isSafeInteger(signedAmountJpy) || signedAmountJpy === 0) issues.push({ code: 'MONEY_FORWARD_AMOUNT_INVALID', message: '金額（円） must be a non-zero safe integer.', severity: 'error', row: row.sourceRow, column: '金額（円）' })
      if (!institution) issues.push({ code: 'MONEY_FORWARD_INSTITUTION_MISSING', message: '保有金融機関 is required for account mapping.', severity: 'error', row: row.sourceRow, column: '保有金融機関' })
      if (!externalTransactionId) issues.push({ code: 'MONEY_FORWARD_ID_MISSING', message: 'ID is blank; stable cross-export deduplication is unavailable for this row.', severity: 'warning', row: row.sourceRow, column: 'ID' })
      if (calculationTarget == null || isTransfer == null || !transactionDate || signedAmountJpy == null || !Number.isSafeInteger(signedAmountJpy) || signedAmountJpy === 0 || !institution) continue
      institutions.add(institution)
      records.push({
        kind: 'money-forward-household-transaction', lineage: row,
        sourceFields: Object.fromEntries(MONEY_FORWARD_HOUSEHOLD_HEADERS.map((header) => [header, fields[header] ?? ''])),
        calculationTarget: isTransfer ? false : calculationTarget,
        transactionDate, content: normalizeJapaneseText(fields['内容'] ?? ''), signedAmountJpy,
        institution, majorCategory: normalizeJapaneseText(fields['大項目'] ?? ''),
        minorCategory: normalizeJapaneseText(fields['中項目'] ?? ''), memo: normalizeJapaneseText(fields['メモ'] ?? ''),
        isTransfer, externalTransactionId,
      })
    }
    if (institutions.size > MAX_INSTITUTIONS_PER_FILE) issues.push({
      code: 'MONEY_FORWARD_INSTITUTION_LIMIT_EXCEEDED',
      message: `A Money Forward ME household-ledger file can contain at most ${MAX_INSTITUTIONS_PER_FILE} distinct 保有金融機関 values.`,
      severity: 'error',
    })
    return { adapterId: this.id, records, issues, metadata: { headerRow: csv.rows[headerIndex].sourceRow, institutions: [...institutions] } }
  },
}
