import type { ExtractedRegionDto, SourceRecordViewDto } from '../../platform'
import type { ReceiptAdjustmentEvidence, ReceiptItemEvidence, ReceiptReconciliationEvidence, ReceiptTaxEvidence } from '../import/receiptText'

export interface DocumentEvidenceReadModel {
  readonly sourceRecordId: string
  readonly evidenceVersion: number
  readonly method: 'EMBEDDED_TEXT' | 'OCR' | 'UNKNOWN'
  readonly text: string
  readonly confidenceBps: number
  readonly issues: readonly string[]
  readonly pages: readonly {
    readonly pageNumber: number
    readonly widthPixels: number | null
    readonly heightPixels: number | null
    readonly confidenceBps: number
    readonly issues: readonly string[]
    readonly regions: readonly ExtractedRegionDto[]
  }[]
  readonly receipt: {
    readonly merchant: string | null
    readonly occurredOn: string | null
    readonly totalAmountJpy: number | null
    readonly items: readonly ReceiptItemEvidence[]
    readonly taxes: readonly ReceiptTaxEvidence[]
    readonly couponEvidence: readonly ReceiptAdjustmentEvidence[]
    readonly pointsUsedEvidence: readonly ReceiptAdjustmentEvidence[]
    readonly couponAmountJpy: number | null
    readonly pointsUsedJpy: number | null
    readonly subtotalJpy?: number | null
    readonly changeJpy?: number | null
    readonly paymentMethod?: string | null
    readonly taxMode?: 'INCLUDED' | 'EXCLUDED' | 'MIXED' | null
    readonly reconciliation: ReceiptReconciliationEvidence
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
  const taxRatePercent = input.taxRatePercent === 8 || input.taxRatePercent === 10 ? input.taxRatePercent : null
  return { description, amountJpy, confidenceBps, quantity: input.quantity === null ? null : integer(input.quantity, 1), taxRatePercent, provenance: source }
}

function adjustment(value: unknown): ReceiptAdjustmentEvidence | null {
  const input = object(value)
  const source = input && provenance(input.provenance)
  const confidenceBps = input && integer(input.confidenceBps, 0, 10_000)
  const amountJpy = input?.amountJpy === null ? null : integer(input?.amountJpy)
  if (!input || !source || confidenceBps === null || (input.amountJpy !== null && amountJpy === null)) return null
  return { amountJpy, confidenceBps, provenance: source }
}

function adjustmentTotal(evidence: readonly ReceiptAdjustmentEvidence[]): number | null {
  const values = evidence.flatMap((item) => item.amountJpy === null ? [] : [item.amountJpy])
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return Number.isSafeInteger(total) ? total : null
}

function reconciliation(items: readonly ReceiptItemEvidence[], totalAmountJpy: number | null): ReceiptReconciliationEvidence {
  if (items.length === 0) return { status: 'NO_ITEMS', itemTotalJpy: null, totalAmountJpy, deltaJpy: null }
  const itemTotalJpy = items.reduce((sum, item) => sum + item.amountJpy, 0)
  if (!Number.isSafeInteger(itemTotalJpy)) return { status: 'DELTA', itemTotalJpy: null, totalAmountJpy, deltaJpy: null }
  const deltaJpy = totalAmountJpy === null ? null : itemTotalJpy - totalAmountJpy
  return {
    status: deltaJpy === 0 ? 'EXACT' : 'DELTA',
    itemTotalJpy,
    totalAmountJpy,
    deltaJpy: Number.isSafeInteger(deltaJpy) ? deltaJpy : null,
  }
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
  const outcomes = Array.isArray(extraction.pages) ? extraction.pages.flatMap((value) => {
    const page = object(value)
    const pageNumber = page && integer(page.pageNumber, 1, 10_000)
    const confidenceBps = page && integer(page.confidenceBps, 0, 10_000)
    if (!page || pageNumber === null || confidenceBps === null) return []
    return [{
      pageNumber,
      widthPixels: page.widthPixels === null ? null : integer(page.widthPixels, 1, 20_000),
      heightPixels: page.heightPixels === null ? null : integer(page.heightPixels, 1, 20_000),
      confidenceBps,
      issues: stringList(page.issues),
    }]
  }) : []
  const pageNumbers = [...new Set([...outcomes.map((item) => item.pageNumber), ...regions.map((item) => item.pageNumber)])].sort((left, right) => left - right)
  const receipt = object(payload.receipt)
  const receiptItems = receipt && Array.isArray(receipt.items) ? receipt.items.map(item).filter((value): value is ReceiptItemEvidence => value !== null) : []
  const couponEvidence = receipt && Array.isArray(receipt.couponEvidence) ? receipt.couponEvidence.map(adjustment).filter((value): value is ReceiptAdjustmentEvidence => value !== null) : []
  const pointsUsedEvidence = receipt && Array.isArray(receipt.pointsUsedEvidence) ? receipt.pointsUsedEvidence.map(adjustment).filter((value): value is ReceiptAdjustmentEvidence => value !== null) : []
  const totalAmountJpy = receipt ? integer(receipt.amountJpy) : null
  return {
    sourceRecordId: record.id,
    evidenceVersion: integer(payload.evidenceVersion, 1, 100) ?? 1,
    method: extraction.method === 'EMBEDDED_TEXT' || extraction.method === 'OCR' ? extraction.method : 'UNKNOWN',
    text: text(extraction.text) ?? '',
    confidenceBps: integer(extraction.confidenceBps, 0, 10_000) ?? 0,
    issues: stringList(extraction.issues),
    pages: pageNumbers.map((pageNumber) => {
      const outcome = outcomes.find((item) => item.pageNumber === pageNumber)
      return {
        pageNumber,
        widthPixels: outcome?.widthPixels ?? null,
        heightPixels: outcome?.heightPixels ?? null,
        confidenceBps: outcome?.confidenceBps ?? (regions.filter((item) => item.pageNumber === pageNumber)[0]?.confidenceBps ?? 0),
        issues: outcome?.issues ?? [],
        regions: regions.filter((item) => item.pageNumber === pageNumber),
      }
    }),
    receipt: receipt ? {
      merchant: text(receipt.merchant),
      occurredOn: text(receipt.occurredOn),
      totalAmountJpy,
      items: receiptItems,
      taxes: Array.isArray(receipt.taxes) ? receipt.taxes.map(tax).filter((value): value is ReceiptTaxEvidence => value !== null) : [],
      couponEvidence,
      pointsUsedEvidence,
      couponAmountJpy: integer(receipt.couponAmountJpy) ?? adjustmentTotal(couponEvidence),
      pointsUsedJpy: integer(receipt.pointsUsedJpy) ?? adjustmentTotal(pointsUsedEvidence),
      subtotalJpy: integer(receipt.subtotalJpy),
      changeJpy: integer(receipt.changeJpy),
      paymentMethod: text(receipt.paymentMethod),
      taxMode: receipt.taxMode === 'INCLUDED' || receipt.taxMode === 'EXCLUDED' || receipt.taxMode === 'MIXED' ? receipt.taxMode : null,
      reconciliation: reconciliation(receiptItems, totalAmountJpy),
    } : null,
  }
}
