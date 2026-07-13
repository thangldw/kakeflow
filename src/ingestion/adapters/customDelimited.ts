import { decodeCsvBytes, normalizeHeader, tokenizeCsv, type CsvParseResult } from '../csv'
import { parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { BankTransactionCandidate, DetectionResult, ImportInput, ParseIssue, ParsedImport } from '../types'

export type CustomDelimiter = 'AUTO' | 'COMMA' | 'TAB' | 'SEMICOLON'
export type CustomDateFormat = 'AUTO' | 'YYYY_MM_DD' | 'YYYYMMDD' | 'MM_DD_YYYY' | 'DD_MM_YYYY'

/** Read-only contract supplied by parser-profile persistence. */
export interface SavedCustomParserProfileDto {
  id: string
  householdId: string
  name: string
  delimiter: CustomDelimiter
  encoding: 'AUTO' | 'UTF8' | 'CP932'
  /** One-based physical source row. */
  headerRow: number
  dateColumn: string
  dateFormat: CustomDateFormat
  descriptionColumn: string | null
  payeeColumn: string | null
  amountMode: 'SIGNED' | 'DEBIT_CREDIT'
  signedAmountColumn: string | null
  signedPositiveDirection: 'IN' | 'OUT' | null
  debitColumn: string | null
  creditColumn: string | null
  externalIdColumn: string | null
  accountHintColumn: string | null
  isEnabled: boolean
  priority: number
  version: number
  createdAt: string
  updatedAt: string
}

export type CustomColumnRole =
  | 'DATE'
  | 'DESCRIPTION'
  | 'PAYEE'
  | 'EXTERNAL_ID'
  | 'ACCOUNT_HINT'
  | 'SIGNED_AMOUNT'
  | 'DEBIT_AMOUNT'
  | 'CREDIT_AMOUNT'

export interface CustomColumnMappingPreview {
  role: CustomColumnRole
  configuredHeader: string
  matchedHeader: string | null
  columnIndex: number | null
}

export interface CustomDelimitedPreview {
  profileId: string
  profileVersion: number
  filename?: string
  encoding: string
  delimiter: string
  headerRow: number
  mappings: readonly CustomColumnMappingPreview[]
  dataRowCount: number
  candidateCount: number
  rejectedRowCount: number
  issues: readonly ParseIssue[]
}

export interface CustomDelimitedParseResult {
  parsed: ParsedImport<BankTransactionCandidate>
  preview: CustomDelimitedPreview
}

const DEFAULT_SUMMARY_MARKERS = ['total', 'subtotal', 'summary', '合計', '小計', '請求額合計']

function delimiterValue(delimiter: CustomDelimiter): string | undefined {
  if (delimiter === 'COMMA') return ','
  if (delimiter === 'TAB') return '\t'
  if (delimiter === 'SEMICOLON') return ';'
  return undefined
}

function mappedColumns(profile: SavedCustomParserProfileDto): readonly [CustomColumnRole, string][] {
  const columns: [CustomColumnRole, string | null | undefined][] = [
    ['DATE', profile.dateColumn],
    ['DESCRIPTION', profile.descriptionColumn],
    ['PAYEE', profile.payeeColumn],
    ['EXTERNAL_ID', profile.externalIdColumn],
    ['ACCOUNT_HINT', profile.accountHintColumn],
  ]
  if (profile.amountMode === 'SIGNED') columns.push(['SIGNED_AMOUNT', profile.signedAmountColumn])
  else columns.push(['DEBIT_AMOUNT', profile.debitColumn], ['CREDIT_AMOUNT', profile.creditColumn])
  return columns.filter((entry): entry is [CustomColumnRole, string] => Boolean(entry[1]?.trim()))
}

function invalidProfile(profile: SavedCustomParserProfileDto): ParseIssue[] {
  const issues: ParseIssue[] = []
  if (!profile.id.trim() || profile.id.length > 64 || !profile.householdId.trim() || !Number.isSafeInteger(profile.version) || profile.version < 1) {
    issues.push({ code: 'CUSTOM_PROFILE_INVALID', message: 'Parser profile identity or version is invalid.', severity: 'error' })
  }
  if (!Number.isSafeInteger(profile.headerRow) || profile.headerRow < 1) {
    issues.push({ code: 'CUSTOM_HEADER_ROW_INVALID', message: 'Header row must be a positive one-based row number.', severity: 'error' })
  }
  if (!profile.isEnabled) issues.push({ code: 'CUSTOM_PROFILE_DISABLED', message: 'Disabled parser profiles cannot parse imports.', severity: 'error' })
  if (!Number.isSafeInteger(profile.priority)) issues.push({ code: 'CUSTOM_PRIORITY_INVALID', message: 'Parser profile priority must be an integer.', severity: 'error' })
  if (!profile.descriptionColumn && !profile.payeeColumn) {
    issues.push({ code: 'CUSTOM_DESCRIPTION_MISSING', message: 'At least one description or payee column is required.', severity: 'error' })
  }
  const amountShapeValid = profile.amountMode === 'SIGNED'
    ? Boolean(profile.signedAmountColumn && profile.signedPositiveDirection && !profile.debitColumn && !profile.creditColumn)
    : Boolean(!profile.signedAmountColumn && !profile.signedPositiveDirection && profile.debitColumn && profile.creditColumn)
  if (!amountShapeValid) issues.push({ code: 'CUSTOM_AMOUNT_MAPPING_INVALID', message: 'Amount columns do not match the selected signed or debit/credit mode.', severity: 'error' })
  const configured = mappedColumns(profile).map(([, header]) => normalizeHeader(header))
  if (configured.some((header) => !header)) {
    issues.push({ code: 'CUSTOM_COLUMN_INVALID', message: 'Mapped column names must not be empty.', severity: 'error' })
  }
  if (new Set(configured).size !== configured.length) {
    issues.push({ code: 'CUSTOM_COLUMN_AMBIGUOUS', message: 'One source column cannot serve more than one mapped role.', severity: 'error' })
  }
  return issues
}

function parseDate(value: string, format: CustomDateFormat): string | null {
  const normalized = value.normalize('NFKC').trim()
  if (format === 'AUTO' || format === 'YYYY_MM_DD') return parseJapaneseDate(normalized)
  if (format === 'YYYYMMDD') {
    const match = normalized.match(/^(\d{4})(\d{2})(\d{2})$/)
    return match ? parseJapaneseDate(`${match[1]}-${match[2]}-${match[3]}`) : null
  }
  const match = normalized.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (!match) return null
  const month = format === 'MM_DD_YYYY' ? match[1] : match[2]
  const day = format === 'MM_DD_YYYY' ? match[2] : match[1]
  return parseJapaneseDate(`${match[3]}-${month}-${day}`)
}

function isSummaryRow(fields: readonly string[], description: string): boolean {
  const markers = DEFAULT_SUMMARY_MARKERS
    .map((marker) => normalizeHeader(marker).toLocaleLowerCase())
    .filter(Boolean)
  const first = normalizeHeader(fields.find(Boolean) ?? '').toLocaleLowerCase()
  const detail = normalizeHeader(description).toLocaleLowerCase()
  return markers.some((marker) => first === marker || detail === marker || first.startsWith(`${marker} `) || detail.startsWith(`${marker} `))
}

function resolveMappings(
  csv: CsvParseResult,
  profile: SavedCustomParserProfileDto,
  issues: ParseIssue[],
): { headerIndex: number; indexes: Map<CustomColumnRole, number>; previews: CustomColumnMappingPreview[] } | null {
  const headerIndex = csv.rows.findIndex((row) => row.sourceRow === profile.headerRow)
  if (headerIndex < 0) {
    issues.push({ code: 'CUSTOM_HEADER_MISSING', message: `Configured header row ${profile.headerRow} was not found.`, severity: 'error', row: profile.headerRow })
    return null
  }
  const headers = csv.rows[headerIndex].fields.map(normalizeHeader)
  const duplicates = new Set(headers.filter((header, index) => header && headers.indexOf(header) !== index))
  const indexes = new Map<CustomColumnRole, number>()
  const previews = mappedColumns(profile).map(([role, configuredHeader]) => {
    const normalized = normalizeHeader(configuredHeader)
    const matches = headers.flatMap((header, index) => header === normalized ? [index] : [])
    if (duplicates.has(normalized) || matches.length > 1) {
      issues.push({ code: 'CUSTOM_HEADER_AMBIGUOUS', message: `Mapped header "${configuredHeader}" appears more than once.`, severity: 'error', row: profile.headerRow, column: configuredHeader })
    } else if (matches.length === 0) {
      issues.push({ code: 'CUSTOM_COLUMN_MISSING', message: `Mapped header "${configuredHeader}" was not found.`, severity: 'error', row: profile.headerRow, column: configuredHeader })
    } else indexes.set(role, matches[0])
    return { role, configuredHeader, matchedHeader: matches.length === 1 ? headers[matches[0]] : null, columnIndex: matches.length === 1 ? matches[0] : null }
  })
  return { headerIndex, indexes, previews }
}

function field(row: { fields: readonly string[] }, indexes: Map<CustomColumnRole, number>, role: CustomColumnRole): string {
  const index = indexes.get(role)
  return index == null ? '' : row.fields[index] ?? ''
}

function parseDecoded(
  input: ImportInput,
  profile: SavedCustomParserProfileDto,
  encoding: string,
): CustomDelimitedParseResult {
  const issues = invalidProfile(profile)
  const csv = tokenizeCsv(input.text, delimiterValue(profile.delimiter))
  issues.push(...csv.issues)
  const resolved = issues.some((issue) => issue.severity === 'error') ? null : resolveMappings(csv, profile, issues)
  const records: BankTransactionCandidate[] = []
  let rejectedRowCount = 0
  let dataRowCount = 0
  if (resolved && !issues.some((issue) => issue.severity === 'error')) {
    for (const row of csv.rows.slice(resolved.headerIndex + 1)) {
      if (row.fields.every((value) => !value.trim())) continue
      dataRowCount += 1
      const description = field(row, resolved.indexes, 'DESCRIPTION')
      const payee = field(row, resolved.indexes, 'PAYEE')
      if (isSummaryRow(row.fields, [payee, description].filter(Boolean).join(' '))) {
        rejectedRowCount += 1
        issues.push({ code: 'CUSTOM_SUMMARY_ROW', message: 'Summary row was excluded from transaction candidates.', severity: 'warning', row: row.sourceRow })
        continue
      }
      const transactionDate = parseDate(field(row, resolved.indexes, 'DATE'), profile.dateFormat)
      if (!transactionDate) {
        rejectedRowCount += 1
        issues.push({ code: 'CUSTOM_DATE_INVALID', message: 'Row does not contain an unambiguous valid date for the configured format.', severity: 'error', row: row.sourceRow, column: profile.dateColumn })
        continue
      }
      let outgoingAmount: number | null = null
      let incomingAmount: number | null = null
      if (profile.amountMode === 'SIGNED') {
        const amount = parseJapaneseAmount(field(row, resolved.indexes, 'SIGNED_AMOUNT'))
        if (amount == null || amount === 0 || !Number.isSafeInteger(amount)) {
          rejectedRowCount += 1
          issues.push({ code: 'CUSTOM_AMOUNT_INVALID', message: 'Signed amount must be a non-zero integer JPY value.', severity: 'error', row: row.sourceRow, column: profile.signedAmountColumn ?? undefined })
          continue
        }
        const positiveDirection = profile.signedPositiveDirection!
        const direction = amount > 0 ? positiveDirection : positiveDirection === 'IN' ? 'OUT' : 'IN'
        if (direction === 'OUT') outgoingAmount = Math.abs(amount)
        else incomingAmount = Math.abs(amount)
      } else {
        const debitRaw = field(row, resolved.indexes, 'DEBIT_AMOUNT')
        const creditRaw = field(row, resolved.indexes, 'CREDIT_AMOUNT')
        const debit = parseJapaneseAmount(debitRaw)
        const credit = parseJapaneseAmount(creditRaw)
        if ((debit != null && debit <= 0) || (credit != null && credit <= 0) || (debit != null) === (credit != null)) {
          rejectedRowCount += 1
          issues.push({ code: 'CUSTOM_AMOUNT_AMBIGUOUS', message: 'Exactly one positive debit or credit amount is required.', severity: 'error', row: row.sourceRow })
          continue
        }
        outgoingAmount = debit
        incomingAmount = credit
      }
      const externalId = field(row, resolved.indexes, 'EXTERNAL_ID')
      const accountHint = field(row, resolved.indexes, 'ACCOUNT_HINT') || input.accountHint
      records.push({
        kind: 'bank-transaction',
        lineage: { sourceRow: row.sourceRow, sourceRowEnd: row.sourceRowEnd, rawFields: row.rawFields },
        ...(accountHint ? { accountHint } : {}),
        ...(externalId ? { externalTransactionId: externalId } : {}),
        transactionDate,
        description: payee || description,
        descriptionDetail: payee ? description : '',
        outgoingAmount,
        incomingAmount,
        balance: null,
        memo: '',
        fundsAvailabilityCode: '',
        debitCreditCode: outgoingAmount == null ? 'IN' : 'OUT',
        suggestedType: 'UNKNOWN',
      })
    }
  }
  const previews = resolved?.previews ?? mappedColumns(profile).map(([role, configuredHeader]) => ({ role, configuredHeader, matchedHeader: null, columnIndex: null }))
  const metadata = { profileId: profile.id, profileVersion: profile.version, encoding, delimiter: csv.delimiter, headerRow: profile.headerRow, columnMappings: previews, rejectedRowCount }
  const parsed: ParsedImport<BankTransactionCandidate> = { adapterId: 'custom-delimited-v1', records, issues, metadata }
  return {
    parsed,
    preview: {
      profileId: profile.id, profileVersion: profile.version, ...(input.filename ? { filename: input.filename } : {}), encoding,
      delimiter: csv.delimiter, headerRow: profile.headerRow, mappings: previews,
      dataRowCount: resolved ? dataRowCount : 0,
      candidateCount: records.length, rejectedRowCount, issues,
    },
  }
}

function decodeProfileBytes(bytes: Uint8Array, encoding: SavedCustomParserProfileDto['encoding']): { text: string; encoding: string; issue?: ParseIssue } {
  if (encoding === 'AUTO') {
    const decoded = decodeCsvBytes(bytes)
    return decoded.encoding.endsWith('-invalid') || decoded.text.includes('\uFFFD')
      ? { ...decoded, issue: { code: 'CUSTOM_ENCODING_INVALID', message: 'Source bytes are not valid UTF-8 or CP932.', severity: 'error' } }
      : decoded
  }
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  try {
    if (encoding === 'UTF8') return { text: new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes), encoding: hasBom ? 'utf-8-bom' : 'utf-8' }
    return { text: new TextDecoder('shift_jis', { fatal: true }).decode(bytes), encoding: 'shift_jis' }
  } catch {
    return {
      text: '',
      encoding: encoding === 'CP932' ? 'shift_jis-invalid' : 'utf-8-invalid',
      issue: { code: 'CUSTOM_ENCODING_INVALID', message: `Source bytes are not valid ${encoding}.`, severity: 'error' },
    }
  }
}

export function parseCustomDelimitedBytes(bytes: Uint8Array, profile: SavedCustomParserProfileDto, input: Omit<ImportInput, 'text'> = {}): CustomDelimitedParseResult {
  const decoded = decodeProfileBytes(bytes, profile.encoding)
  const result = parseDecoded({ ...input, text: decoded.text }, profile, decoded.encoding)
  if (!decoded.issue) return result
  const issues = [decoded.issue, ...result.parsed.issues]
  return { parsed: { ...result.parsed, issues, records: [] }, preview: { ...result.preview, issues, candidateCount: 0 } }
}

function detectionFromPreview(preview: CustomDelimitedPreview): DetectionResult {
  const mapped = preview.mappings.filter((mapping) => mapping.columnIndex != null).length
  const total = Math.max(1, preview.mappings.length)
  const structuralError = preview.issues.some((issue) =>
    issue.severity === 'error' && (issue.row == null || issue.row === preview.headerRow))
  return { adapterId: 'custom-delimited-v1', score: structuralError ? 0 : mapped / total, reasons: [`${mapped}/${total} saved profile columns matched`] }
}

export function detectCustomDelimitedBytes(bytes: Uint8Array, profile: SavedCustomParserProfileDto, input: Omit<ImportInput, 'text'> = {}): DetectionResult {
  return detectionFromPreview(parseCustomDelimitedBytes(bytes, profile, input).preview)
}

export function createCustomDelimitedAdapter(profile: SavedCustomParserProfileDto) {
  return {
    id: 'custom-delimited-v1' as const,
    detect(input: ImportInput): DetectionResult {
      return detectionFromPreview(parseDecoded(input, profile, 'predecoded').preview)
    },
    parse(input: ImportInput): ParsedImport<BankTransactionCandidate> {
      return parseDecoded(input, profile, 'predecoded').parsed
    },
    parseBytes(bytes: Uint8Array, input: Omit<ImportInput, 'text'> = {}): CustomDelimitedParseResult {
      return parseCustomDelimitedBytes(bytes, profile, input)
    },
    detectBytes(bytes: Uint8Array, input: Omit<ImportInput, 'text'> = {}): DetectionResult {
      return detectCustomDelimitedBytes(bytes, profile, input)
    },
  }
}
