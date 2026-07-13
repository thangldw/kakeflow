import type { ParseIssue, SourceLineage } from './types'

export interface CsvRow extends SourceLineage {
  fields: readonly string[]
}

export interface CsvParseResult {
  rows: readonly CsvRow[]
  issues: readonly ParseIssue[]
  delimiter: string
}

/** RFC-4180-style tokenizer supporting escaped quotes and quoted newlines. */
export function tokenizeCsv(text: string, delimiter = detectDelimiter(text)): CsvParseResult {
  const rows: CsvRow[] = []
  const issues: ParseIssue[] = []
  let fields: string[] = []
  let field = ''
  let quoted = false
  let rowStart = 1
  let line = 1

  const pushRow = (rowEnd: number) => {
    fields.push(field)
    if (fields.some((value) => value.length > 0)) {
      const frozen = fields.map((value) => value.trim())
      rows.push({ sourceRow: rowStart, sourceRowEnd: rowEnd, rawFields: frozen, fields: frozen })
    }
    fields = []
    field = ''
    rowStart = rowEnd + 1
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
        if (character === '\n') line += 1
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true
    } else if (character === delimiter) {
      fields.push(field)
      field = ''
    } else if (character === '\n') {
      pushRow(line)
      line += 1
    } else if (character !== '\r') {
      field += character
    }
  }

  if (quoted) issues.push({ code: 'CSV_UNCLOSED_QUOTE', message: 'Quoted field was not closed.', severity: 'error', row: rowStart })
  if (field.length > 0 || fields.length > 0) pushRow(line)
  return { rows, issues, delimiter }
}

export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 16_384)
  const candidates = [',', '\t', ';']
  const counts = new Map(candidates.map((candidate) => [candidate, 0]))
  let quoted = false
  for (const character of sample) {
    if (character === '"') quoted = !quoted
    if (!quoted && counts.has(character)) counts.set(character, (counts.get(character) ?? 0) + 1)
  }
  return candidates.reduce((best, candidate) =>
    (counts.get(candidate) ?? 0) > (counts.get(best) ?? 0) ? candidate : best,
  ',')
}

export function rowObject(headers: readonly string[], row: CsvRow): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, row.fields[index] ?? '']))
}

export function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** Browser-safe decoding helper. CP932 support depends on the host TextDecoder. */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' }
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const replacements = (utf8.match(/\uFFFD/g) ?? []).length
  if (replacements === 0) return { text: utf8, encoding: 'utf-8' }
  try {
    return { text: new TextDecoder('shift_jis', { fatal: true }).decode(bytes), encoding: 'shift_jis' }
  } catch {
    return { text: utf8, encoding: 'utf-8-invalid' }
  }
}
