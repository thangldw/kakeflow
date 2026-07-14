import { describe, expect, it, vi } from 'vitest'
import { createProtectedPdfPlatform } from './protectedPdfPlatform'

const extracted = { method: 'EMBEDDED_TEXT', text: 'TOTAL 1200', confidenceBps: 9000, issues: [], regions: [{ pageNumber: 1, coordinateSpace: 'UNLOCATED', boundingBox: null, text: 'TOTAL 1200', confidenceBps: 9000, provenance: 'PDF_EMBEDDED_TEXT' }] }
const ocrDocument = {
  method: 'OCR', text: '合計 1,480', confidenceBps: 9200, issues: [], pageCount: 1,
  pages: [{ pageNumber: 1, widthPixels: 1000, heightPixels: 2000, confidenceBps: 9200, issues: [] }],
  regions: [{ pageNumber: 1, coordinateSpace: 'PIXELS', boundingBox: { left: 100, top: 200, width: 300, height: 40 }, text: '合計 1,480', confidenceBps: 9200, provenance: 'TESSERACT_WORD' }],
}

describe('protected PDF platform', () => {
  it('sends a password only to the ephemeral native extraction attempt', async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 'SUCCESS', document: extracted })
    const result = await createProtectedPdfPlatform(invoke).extract(new Uint8Array([37, 80, 68, 70]), 'one-time-password')

    expect(result).toEqual({ status: 'SUCCESS', document: extracted })
    expect(invoke).toHaveBeenCalledWith('document_extract_attempt', { fileBytes: [37, 80, 68, 70], mediaType: 'application/pdf', password: 'one-time-password' })
  })

  it('accepts explicit password guidance states and rejects malformed results', async () => {
    await expect(createProtectedPdfPlatform(vi.fn().mockResolvedValue({ status: 'PASSWORD_REQUIRED', document: null })).extract(new Uint8Array([1]))).resolves.toEqual({ status: 'PASSWORD_REQUIRED', document: null })
    await expect(createProtectedPdfPlatform(vi.fn().mockResolvedValue({ status: 'PASSWORD_INVALID', document: extracted })).extract(new Uint8Array([1]), 'wrong')).rejects.toThrow(TypeError)
    await expect(createProtectedPdfPlatform(vi.fn().mockResolvedValue({ status: 'SUCCESS', document: null })).extract(new Uint8Array([1]), 'ok')).rejects.toThrow(TypeError)
  })

  it('accepts a complete page-aware OCR result', async () => {
    const result = await createProtectedPdfPlatform(vi.fn().mockResolvedValue({ status: 'SUCCESS', document: ocrDocument })).ocr(new Uint8Array([37, 80, 68, 70]))

    expect(result).toEqual({ status: 'SUCCESS', document: ocrDocument })
  })

  it.each([
    ['declared page count mismatch', { ...ocrDocument, pageCount: 2 }],
    ['empty pages', { ...ocrDocument, pageCount: 0, pages: [] }],
    ['non-contiguous pages', { ...ocrDocument, pageCount: 1, pages: [{ ...ocrDocument.pages[0], pageNumber: 2 }] }],
    ['partial page dimensions', { ...ocrDocument, pages: [{ ...ocrDocument.pages[0], heightPixels: null }] }],
    ['region outside declared pages', { ...ocrDocument, regions: [{ ...ocrDocument.regions[0], pageNumber: 2 }] }],
    ['pixel region outside page bounds', { ...ocrDocument, regions: [{ ...ocrDocument.regions[0], boundingBox: { left: 900, top: 200, width: 300, height: 40 } }] }],
    ['zero-sized region', { ...ocrDocument, regions: [{ ...ocrDocument.regions[0], boundingBox: { left: 100, top: 200, width: 0, height: 40 } }] }],
    ['located region without geometry', { ...ocrDocument, regions: [{ ...ocrDocument.regions[0], boundingBox: null }] }],
    ['unlocated region with geometry', { ...ocrDocument, regions: [{ ...ocrDocument.regions[0], coordinateSpace: 'UNLOCATED' }] }],
    ['empty provenance', { ...ocrDocument, regions: [{ ...ocrDocument.regions[0], provenance: '' }] }],
  ])('rejects OCR SUCCESS with invalid %s', async (_label, document) => {
    await expect(createProtectedPdfPlatform(vi.fn().mockResolvedValue({ status: 'SUCCESS', document })).ocr(new Uint8Array([1]))).rejects.toThrow(TypeError)
  })
})
