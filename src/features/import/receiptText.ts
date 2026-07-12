import type { ExtractedDocumentDto, StartImportDto } from '../../platform'

export interface ReceiptTextFields {
  readonly merchant: string | null
  readonly occurredOn: string | null
  readonly amountJpy: number | null
  readonly confidenceBps: number
  readonly issues: readonly string[]
  readonly items: readonly ReceiptItemEvidence[]
  readonly taxes: readonly ReceiptTaxEvidence[]
  readonly couponAmountJpy: number | null
  readonly pointsUsedJpy: number | null
}

export interface ReceiptEvidenceProvenance {
  readonly lineNumber: number
  readonly regionIndexes: readonly number[]
  readonly method: 'TEXT_PATTERN'
}

export interface ReceiptItemEvidence {
  readonly description: string
  readonly quantity: number | null
  readonly amountJpy: number
  readonly confidenceBps: number
  readonly provenance: ReceiptEvidenceProvenance
}

export interface ReceiptTaxEvidence {
  readonly ratePercent: 8 | 10
  readonly taxAmountJpy: number | null
  readonly taxableAmountJpy: number | null
  readonly confidenceBps: number
  readonly provenance: ReceiptEvidenceProvenance
}

function isoDate(year: string, month: string, day: string): string | null {
  const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? null : value
}

export function parseReceiptText(text: string): ReceiptTextFields {
  const lines = text.split(/\r?\n/).map((line, index) => ({ text: line.trim(), lineNumber: index + 1 })).filter((line) => Boolean(line.text))
  const lineTexts = lines.map((line) => line.text)
  const dateMatches = Array.from(text.matchAll(/(20\d{2})[/.年-]\s*(\d{1,2})[/.月-]\s*(\d{1,2})(?:日)?/g))
  const occurredOn = dateMatches[0] ? isoDate(dateMatches[0][1], dateMatches[0][2], dateMatches[0][3]) : null
  const totalLines = lineTexts.filter((line) => /(?:合計|お買上|ご請求|GRAND\s*TOTAL|TOTAL)/i.test(line))
  const amounts = totalLines.flatMap((line) => Array.from(line.matchAll(/(?:¥|￥)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)/g), (match) => Number(match[1].replaceAll(',', '')))).filter((amount) => Number.isSafeInteger(amount) && amount > 0)
  const amountJpy = amounts.length > 0 ? Math.max(...amounts) : null
  const merchant = lineTexts.find((line) => !/(?:レシート|RECEIPT|合計|TOTAL)/i.test(line) && !/(20\d{2})[/.年-]/.test(line)) ?? null
  const provenance = (lineNumber: number): ReceiptEvidenceProvenance => ({ lineNumber, regionIndexes: [], method: 'TEXT_PATTERN' })
  const parseLineAmount = (line: string): number | null => {
    const matches = Array.from(line.matchAll(/[-−]?\s*(?:¥|￥)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:円)?/g))
    if (matches.length === 0) return null
    const last = matches[matches.length - 1]
    const amount = Number(last[1].replaceAll(',', ''))
    return Number.isSafeInteger(amount) ? amount : null
  }
  const taxes: ReceiptTaxEvidence[] = lines.flatMap(({ text: line, lineNumber }) => {
    const rate = line.match(/(?:税|対象|税率)?\s*(8|10)\s*%|(?:8|10)\s*%(?:対象|税)/)
    if (!rate || !/(?:税|対象)/.test(line)) return []
    const ratePercent = Number(rate[1] ?? line.match(/(8|10)/)?.[1]) as 8 | 10
    const amount = parseLineAmount(line)
    return [{
      ratePercent,
      taxAmountJpy: /(?:消費税|税額|内税|外税)/.test(line) ? amount : null,
      taxableAmountJpy: /(?:対象|課税)/.test(line) ? amount : null,
      confidenceBps: amount === null ? 6500 : 8500,
      provenance: provenance(lineNumber),
    }]
  })
  const adjustmentAmount = (pattern: RegExp) => {
    const line = lines.find(({ text: value }) => pattern.test(value))
    return line ? parseLineAmount(line.text) : null
  }
  const couponAmountJpy = adjustmentAmount(/(?:クーポン|値引|割引|COUPON)/i)
  const pointsUsedJpy = adjustmentAmount(/(?:ポイント利用|ポイント使用|POINTS?\s*(?:USED|REDEEMED))/i)
  const nonItem = /(?:合計|TOTAL|小計|税|対象|クーポン|値引|割引|ポイント|お預り|お釣り|現金|クレジット|PayPay|領収|レシート)/i
  const items: ReceiptItemEvidence[] = lines.flatMap(({ text: line, lineNumber }) => {
    if (nonItem.test(line) || /(20\d{2})[/.年-]/.test(line)) return []
    const match = line.match(/^(.+?)\s+(?:¥|￥)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:円)?$/)
    if (!match) return []
    const amount = Number(match[2].replaceAll(',', ''))
    if (!Number.isSafeInteger(amount) || amount <= 0) return []
    const quantity = match[1].match(/(?:x|×)\s*(\d+)$/i)
    return [{
      description: match[1].replace(/(?:x|×)\s*\d+$/i, '').trim(),
      quantity: quantity ? Number(quantity[1]) : null,
      amountJpy: amount,
      confidenceBps: 8000,
      provenance: provenance(lineNumber),
    }]
  })
  const issues: string[] = []
  if (dateMatches.length > 3 || totalLines.length > 3) issues.push('STATEMENT_LIKELY')
  if (!merchant) issues.push('MERCHANT_MISSING')
  if (!occurredOn) issues.push('DATE_MISSING')
  if (!amountJpy) issues.push('TOTAL_MISSING')
  const confidenceBps = Math.max(0, 10_000 - issues.length * 2500)
  return { merchant, occurredOn, amountJpy, confidenceBps, issues, items, taxes, couponAmountJpy, pointsUsedJpy }
}

export async function buildReceiptImport(
  extracted: ExtractedDocumentDto,
  file: { householdId: string; filename: string; mediaType: string; byteSize: number; sha256: string; sourceModifiedAt: string | null; accountId: string; sourceType?: 'MANUAL_UPLOAD' | 'LOCAL_FOLDER' },
  id: () => string,
  hash: (value: string) => Promise<string>,
): Promise<{ request: StartImportDto | null; fields: ReceiptTextFields }> {
  const fields = parseReceiptText(extracted.text)
  if (!fields.occurredOn || !fields.amountJpy || fields.issues.includes('STATEMENT_LIKELY')) return { request: null, fields }
  const regionIndexesForLine = (lineNumber: number) => (extracted.regions ?? [])
    .map((region, index) => ({ region, index }))
    .filter(({ region }) => region.text.trim() === extracted.text.split(/\r?\n/)[lineNumber - 1]?.trim())
    .map(({ index }) => index)
  const receipt = {
    ...fields,
    items: fields.items.map((item) => ({ ...item, provenance: { ...item.provenance, regionIndexes: regionIndexesForLine(item.provenance.lineNumber) } })),
    taxes: fields.taxes.map((tax) => ({ ...tax, provenance: { ...tax.provenance, regionIndexes: regionIndexesForLine(tax.provenance.lineNumber) } })),
  }
  const payloadJson = JSON.stringify({ evidenceVersion: 2, extraction: { ...extracted, regions: extracted.regions ?? [] }, receipt })
  const recordId = id()
  return {
    fields,
    request: {
      runId: id(), documentId: id(), householdId: file.householdId, sourceType: file.sourceType ?? 'MANUAL_UPLOAD',
      originalFilename: file.filename, mediaType: file.mediaType, byteSize: file.byteSize, sha256: file.sha256,
      sourceModifiedAt: file.sourceModifiedAt, adapterId: 'receipt-text-v2', adapterVersion: '2',
      records: [{ id: recordId, rowNumber: 1, recordHash: await hash(payloadJson), payloadJson }],
      candidates: [{
        id: id(), accountId: file.accountId, occurredOn: fields.occurredOn, postedOn: null,
        amountJpy: fields.amountJpy, direction: 'OUT', descriptionRaw: 'Receipt document', merchantRaw: fields.merchant,
        externalTransactionId: null, extractionConfidenceBps: extracted.confidenceBps,
        normalizationConfidenceBps: fields.confidenceBps,
        reviewStatus: Math.min(extracted.confidenceBps, fields.confidenceBps) >= 7500 ? 'READY' : 'PENDING',
        evidence: [{ sourceRecordId: recordId, role: 'PRIMARY' }],
      }],
      cardStatements: [],
    },
  }
}
