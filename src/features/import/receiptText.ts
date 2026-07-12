import type { ExtractedDocumentDto, StartImportDto } from '../../platform'

export interface ReceiptTextFields {
  readonly merchant: string | null
  readonly occurredOn: string | null
  readonly amountJpy: number | null
  readonly confidenceBps: number
  readonly issues: readonly string[]
}

function isoDate(year: string, month: string, day: string): string | null {
  const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? null : value
}

export function parseReceiptText(text: string): ReceiptTextFields {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const dateMatches = Array.from(text.matchAll(/(20\d{2})[/.年-]\s*(\d{1,2})[/.月-]\s*(\d{1,2})(?:日)?/g))
  const occurredOn = dateMatches[0] ? isoDate(dateMatches[0][1], dateMatches[0][2], dateMatches[0][3]) : null
  const totalLines = lines.filter((line) => /(?:合計|お買上|ご請求|GRAND\s*TOTAL|TOTAL)/i.test(line))
  const amounts = totalLines.flatMap((line) => Array.from(line.matchAll(/(?:¥|￥)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)/g), (match) => Number(match[1].replaceAll(',', '')))).filter((amount) => Number.isSafeInteger(amount) && amount > 0)
  const amountJpy = amounts.length > 0 ? Math.max(...amounts) : null
  const merchant = lines.find((line) => !/(?:レシート|RECEIPT|合計|TOTAL)/i.test(line) && !/(20\d{2})[/.年-]/.test(line)) ?? null
  const issues: string[] = []
  if (dateMatches.length > 3 || totalLines.length > 3) issues.push('STATEMENT_LIKELY')
  if (!merchant) issues.push('MERCHANT_MISSING')
  if (!occurredOn) issues.push('DATE_MISSING')
  if (!amountJpy) issues.push('TOTAL_MISSING')
  const confidenceBps = Math.max(0, 10_000 - issues.length * 2500)
  return { merchant, occurredOn, amountJpy, confidenceBps, issues }
}

export async function buildReceiptImport(
  extracted: ExtractedDocumentDto,
  file: { householdId: string; filename: string; mediaType: string; byteSize: number; sha256: string; sourceModifiedAt: string | null; accountId: string },
  id: () => string,
  hash: (value: string) => Promise<string>,
): Promise<{ request: StartImportDto | null; fields: ReceiptTextFields }> {
  const fields = parseReceiptText(extracted.text)
  if (!fields.occurredOn || !fields.amountJpy || fields.issues.includes('STATEMENT_LIKELY')) return { request: null, fields }
  const payloadJson = JSON.stringify({ extraction: extracted, receipt: fields })
  const recordId = id()
  return {
    fields,
    request: {
      runId: id(), documentId: id(), householdId: file.householdId, sourceType: 'MANUAL_UPLOAD',
      originalFilename: file.filename, mediaType: file.mediaType, byteSize: file.byteSize, sha256: file.sha256,
      sourceModifiedAt: file.sourceModifiedAt, adapterId: 'receipt-text-v1', adapterVersion: '1',
      records: [{ id: recordId, rowNumber: 1, recordHash: await hash(payloadJson), payloadJson }],
      candidates: [{
        id: id(), accountId: file.accountId, occurredOn: fields.occurredOn, postedOn: null,
        amountJpy: fields.amountJpy, direction: 'OUT', descriptionRaw: 'Receipt document', merchantRaw: fields.merchant,
        externalTransactionId: null, extractionConfidenceBps: extracted.confidenceBps,
        normalizationConfidenceBps: fields.confidenceBps, reviewStatus: fields.confidenceBps >= 7500 ? 'READY' : 'PENDING',
        evidence: [{ sourceRecordId: recordId, role: 'PRIMARY' }],
      }],
    },
  }
}
