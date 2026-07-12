import type { ExtractedRegionDto, SourceRecordViewDto } from '../../platform'
import type { ReceiptItemEvidence, ReceiptTaxEvidence } from '../import/receiptText'

export interface DocumentEvidenceReadModel {
  readonly sourceRecordId: string
  readonly evidenceVersion: number
  readonly method: 'EMBEDDED_TEXT' | 'OCR' | 'UNKNOWN'
  readonly text: string
  readonly confidenceBps: number
  readonly issues: readonly string[]
  readonly pages: readonly { readonly pageNumber: number; readonly regions: readonly ExtractedRegionDto[] }[]
  readonly receipt: {
    readonly merchant: string | null
    readonly occurredOn: string | null
    readonly totalAmountJpy: number | null
    readonly items: readonly ReceiptItemEvidence[]
    readonly taxes: readonly ReceiptTaxEvidence[]
    readonly couponAmountJpy: number | null
    readonly pointsUsedJpy: number | null
    readonly subtotalJpy?: number | null
    readonly changeJpy?: number | null
    readonly paymentMethod?: string | null
    readonly taxMode?: 'INCLUDED' | 'EXCLUDED' | 'MIXED' | null
  } | null
}

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum ? Number(value) : null
const text = (value: unknown) => typeof value === 'string' ? value : null
const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

function region(value: unknown): ExtractedRegionDto | null {
  const input = object(value)
  if (!input) return null
  const pageNumber = integer(input.pageNumber, 1, 10_000)
  const confidenceBps = integer(input.confidenceBps, 0, 10_000)
  const regionText = text(input.text)
  const coordinateSpace = input.coordinateSpace
  if (pageNumber === null || confidenceBps === null || regionText === null || !['PIXELS', 'PDF_POINTS', 'UNLOCATED'].includes(String(coordinateSpace))) return null
  const box = object(input.boundingBox)
  const boundingBox = box === null ? null : {
    left: integer(box.left) ?? 0,
    top: integer(box.top) ?? 0,
    width: integer(box.width) ?? 0,
    height: integer(box.height) ?? 0,
  }
  return { pageNumber, confidenceBps, text: regionText, coordinateSpace: coordinateSpace as ExtractedRegionDto['coordinateSpace'], boundingBox, provenance: text(input.provenance) ?? 'UNKNOWN' }
}

function provenance(value: unknown) {
  const input = object(value)
  if (!input) return null
  const lineNumber = integer(input.lineNumber, 1, 100_000)
  if (lineNumber === null) return null
  const regionIndexes = Array.isArray(input.regionIndexes)
    ? input.regionIndexes.map((item) => integer(item, 0, 100_000)).filter((item): item is number => item !== null)
    : []
  return { lineNumber, regionIndexes, method: 'TEXT_PATTERN' as const }
}

function item(value: unknown): ReceiptItemEvidence | null {
  const input = object(value)
  const source = input && provenance(input.provenance)
  const description = input && text(input.description)
  const amountJpy = input && integer(input.amountJpy)
  const confidenceBps = input && integer(input.confidenceBps, 0, 10_000)
  if (!input || !source || !description || amountJpy === null || confidenceBps === null) return null
  return { description, amountJpy, confidenceBps, quantity: input.quantity === null ? null : integer(input.quantity, 1), provenance: source }
}

function tax(value: unknown): ReceiptTaxEvidence | null {
  const input = object(value)
  const source = input && provenance(input.provenance)
  const confidenceBps = input && integer(input.confidenceBps, 0, 10_000)
  const ratePercent = input?.ratePercent
  if (!input || !source || confidenceBps === null || (ratePercent !== 8 && ratePercent !== 10)) return null
  return {
    ratePercent,
    taxAmountJpy: input.taxAmountJpy === null ? null : integer(input.taxAmountJpy),
    taxableAmountJpy: input.taxableAmountJpy === null ? null : integer(input.taxableAmountJpy),
    confidenceBps,
    provenance: source,
  }
}

export function buildDocumentEvidence(record: SourceRecordViewDto): DocumentEvidenceReadModel | null {
  let payload: Record<string, unknown>
  try {
    payload = object(JSON.parse(record.payloadJson)) ?? {}
  } catch {
    return null
  }
  const extraction = object(payload.extraction)
  if (!extraction) return null
  const regions = Array.isArray(extraction.regions) ? extraction.regions.map(region).filter((value): value is ExtractedRegionDto => value !== null) : []
  const pageNumbers = [...new Set(regions.map((item) => item.pageNumber))].sort((left, right) => left - right)
  const receipt = object(payload.receipt)
  return {
    sourceRecordId: record.id,
    evidenceVersion: integer(payload.evidenceVersion, 1, 100) ?? 1,
    method: extraction.method === 'EMBEDDED_TEXT' || extraction.method === 'OCR' ? extraction.method : 'UNKNOWN',
    text: text(extraction.text) ?? '',
    confidenceBps: integer(extraction.confidenceBps, 0, 10_000) ?? 0,
    issues: stringList(extraction.issues),
    pages: pageNumbers.map((pageNumber) => ({ pageNumber, regions: regions.filter((item) => item.pageNumber === pageNumber) })),
    receipt: receipt ? {
      merchant: text(receipt.merchant),
      occurredOn: text(receipt.occurredOn),
      totalAmountJpy: integer(receipt.amountJpy),
      items: Array.isArray(receipt.items) ? receipt.items.map(item).filter((value): value is ReceiptItemEvidence => value !== null) : [],
      taxes: Array.isArray(receipt.taxes) ? receipt.taxes.map(tax).filter((value): value is ReceiptTaxEvidence => value !== null) : [],
      couponAmountJpy: integer(receipt.couponAmountJpy),
      pointsUsedJpy: integer(receipt.pointsUsedJpy),
      subtotalJpy: integer(receipt.subtotalJpy),
      changeJpy: integer(receipt.changeJpy),
      paymentMethod: text(receipt.paymentMethod),
      taxMode: receipt.taxMode === 'INCLUDED' || receipt.taxMode === 'EXCLUDED' || receipt.taxMode === 'MIXED' ? receipt.taxMode : null,
    } : null,
  }
}
