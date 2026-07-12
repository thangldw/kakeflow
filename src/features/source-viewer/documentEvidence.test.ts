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
      receipt: { merchant: 'スーパー', occurredOn: '2026-07-12', amountJpy: 238, items: [{ description: '牛乳', amountJpy: 238, quantity: 1, confidenceBps: 8000, provenance: { lineNumber: 1, regionIndexes: [0], method: 'TEXT_PATTERN' } }], taxes: [], couponAmountJpy: null, pointsUsedJpy: null },
    }))

    expect(result?.pages.map((page) => page.pageNumber)).toEqual([1, 2])
    expect(result?.pages[1].regions[0].boundingBox).toEqual({ left: 20, top: 30, width: 80, height: 14 })
    expect(result?.receipt?.items[0].provenance.regionIndexes).toEqual([0])
  })

  it('supports legacy extraction payloads and rejects malformed JSON', () => {
    expect(buildDocumentEvidence(record({ extraction: { method: 'EMBEDDED_TEXT', text: 'legacy', confidenceBps: 9000, issues: [] } }))).toMatchObject({ evidenceVersion: 1, pages: [] })
    expect(buildDocumentEvidence(record('{'))).toBeNull()
  })
})
