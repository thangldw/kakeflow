import { describe, expect, it } from 'vitest'
import type { OcrResult } from '@paddleocr/paddleocr-js'
import { combinePaddleOcrPdfDocuments, paddleOcrResultToDocument } from './paddleOcr'

function result(items: OcrResult['items']): OcrResult {
  return {
    image: { width: 708, height: 921 },
    items,
    metrics: { detMs: 10, recMs: 20, totalMs: 30, detectedBoxes: items.length, recognizedCount: items.length },
    runtime: { requestedBackend: 'wasm', detProvider: 'wasm', recProvider: 'wasm', webgpuAvailable: false },
  }
}

describe('PP-OCRv5 document adapter', () => {
  it('maps recognized lines, confidence, and pixel evidence to the document contract', () => {
    const document = paddleOcrResultToDocument(result([
      { text: '2024/4/5(金)', score: 0.98, poly: [[10, 20], [210, 20], [210, 50], [10, 50]] },
      { text: '合計 ¥709', score: 0.92, poly: [[10, 100], [180, 100], [180, 140], [10, 140]] },
    ]))

    expect(document).toMatchObject({
      method: 'OCR',
      text: '2024/4/5(金)\n合計 ¥709',
      pageCount: 1,
      pages: [{ pageNumber: 1, widthPixels: 708, heightPixels: 921 }],
    })
    expect(document.confidenceBps).toBeGreaterThanOrEqual(9_200)
    expect(document.regions?.[1]).toEqual({
      pageNumber: 1,
      coordinateSpace: 'PIXELS',
      boundingBox: { left: 10, top: 100, width: 170, height: 40 },
      text: '合計 ¥709',
      confidenceBps: 9_200,
      provenance: 'PADDLEOCR_V5_LINE',
    })
  })

  it('rejects empty OCR output instead of creating an empty receipt', () => {
    expect(() => paddleOcrResultToDocument(result([
      { text: '   ', score: 0.9, poly: [] },
    ]))).toThrow('did not recognize any text')
  })

  it('combines page OCR while preserving blank PDF pages and page coordinates', () => {
    const renderedPages = [1, 2].map((pageNumber) => ({ pageNumber, pageCount: 2, pageWidthPoints: 612, pageHeightPoints: 792, widthPixels: 1224, heightPixels: 1584, mediaType: 'image/png' as const, dataUrl: 'data:image/png;base64,AA==' }))
    const document = paddleOcrResultToDocument(result([{ text: '合計 ¥709', score: 0.95, poly: [[10, 10], [100, 10], [100, 30], [10, 30]] }]))
    const blank = { method: 'OCR' as const, text: '', confidenceBps: 0, issues: ['NO_TEXT'], regions: [], pageCount: 1, pages: [{ pageNumber: 1, widthPixels: 708, heightPixels: 921, confidenceBps: 0, issues: ['NO_TEXT'] }] }

    expect(combinePaddleOcrPdfDocuments(renderedPages, [document, blank])).toMatchObject({
      method: 'OCR', pageCount: 2, confidenceBps: 9500, issues: ['PARTIAL_NO_TEXT'],
      pages: [{ pageNumber: 1 }, { pageNumber: 2, issues: ['NO_TEXT'] }],
      regions: [{ pageNumber: 1, provenance: 'PADDLEOCR_V5_LINE' }],
    })
  })
})
