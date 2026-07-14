import { describe, expect, it } from 'vitest'
import type { SourceRecordViewDto } from '../../platform'
import { buildDocumentEvidence } from './documentEvidence'

const record = (payload: unknown): SourceRecordViewDto => ({
  id: 'record-1', sourceDocumentId: 'document-1', rowNumber: 1, recordHash: 'hash',
  payloadJson: typeof payload === 'string' ? payload : JSON.stringify(payload), createdAt: '2026-07-13T00:00:00Z', evidenceRole: 'PRIMARY',
})

describe('document evidence read model', () => {
  it('groups located evidence by one-based page and exposes receipt provenance', () => {
    const result = buildDocumentEvidence(record({
      evidenceVersion: 2,
      extraction: {
        method: 'OCR', text: '牛乳 238', confidenceBps: 9100, issues: [],
        regions: [
          { pageNumber: 2, coordinateSpace: 'PIXELS', boundingBox: { left: 20, top: 30, width: 80, height: 14 }, text: '238', confidenceBps: 9200, provenance: 'TESSERACT_WORD' },
          { pageNumber: 1, coordinateSpace: 'UNLOCATED', boundingBox: null, text: 'スーパー', confidenceBps: 9000, provenance: 'PDF_EMBEDDED_TEXT' },
        ],
      },
      receipt: {
        merchant: 'スーパー', occurredOn: '2026-07-12', amountJpy: 238,
        items: [{ description: '牛乳', amountJpy: 238, quantity: 1, taxRatePercent: 8, confidenceBps: 8000, provenance: { lineNumber: 1, regionIndexes: [0], method: 'TEXT_PATTERN' } }],
        taxes: [], couponAmountJpy: 10, pointsUsedJpy: null,
        couponEvidence: [{ amountJpy: 10, confidenceBps: 8500, provenance: { lineNumber: 2, regionIndexes: [1], method: 'TEXT_PATTERN' } }],
        pointsUsedEvidence: [],
        reconciliation: { status: 'DELTA', itemTotalJpy: 999, totalAmountJpy: 238, deltaJpy: 761 },
      },
    }))

    expect(result?.pages.map((page) => page.pageNumber)).toEqual([1, 2])
    expect(result?.pages[1].regions[0].boundingBox).toEqual({ left: 20, top: 30, width: 80, height: 14 })
    expect(result?.receipt?.items[0].provenance.regionIndexes).toEqual([0])
    expect(result?.receipt?.items[0].taxRatePercent).toBe(8)
    expect(result?.receipt?.couponEvidence[0]).toMatchObject({ amountJpy: 10, confidenceBps: 8500 })
    // Reconciliation is derived from sanitized item evidence instead of trusting a stale payload summary.
    expect(result?.receipt?.reconciliation).toEqual({ status: 'EXACT', itemTotalJpy: 238, totalAmountJpy: 238, deltaJpy: 0 })
  })

  it('supports legacy extraction payloads and rejects malformed JSON', () => {
    expect(buildDocumentEvidence(record({ extraction: { method: 'EMBEDDED_TEXT', text: 'legacy', confidenceBps: 9000, issues: [] } }))).toMatchObject({ evidenceVersion: 1, pages: [] })
    expect(buildDocumentEvidence(record({
      extraction: { method: 'OCR', text: 'legacy receipt', confidenceBps: 9000, issues: [] },
      receipt: { amountJpy: 100, items: [{ description: '品目', amountJpy: 90, quantity: null, confidenceBps: 8000, provenance: { lineNumber: 1, regionIndexes: [], method: 'TEXT_PATTERN' } }], taxes: [], couponAmountJpy: 10, pointsUsedJpy: null },
    }))?.receipt).toMatchObject({
      couponAmountJpy: 10, couponEvidence: [], pointsUsedEvidence: [],
      reconciliation: { status: 'DELTA', itemTotalJpy: 90, totalAmountJpy: 100, deltaJpy: -10 },
      items: [expect.objectContaining({ taxRatePercent: null })],
    })
    expect(buildDocumentEvidence(record('{'))).toBeNull()
  })
})
