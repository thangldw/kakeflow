import { describe, expect, it, vi } from 'vitest'
import { createSourcePdfPagePreviewPlatform, pdfPreviewToEvidenceImage } from './sourcePdfPagePreviewPlatform'

const preview = {
  sourceDocumentId: 'document', filename: 'statement.pdf', pageNumber: 2, pageCount: 3,
  pageWidthPoints: 612, pageHeightPoints: 792, widthPixels: 1224, heightPixels: 1584,
  mediaType: 'image/png', dataUrl: 'data:image/png;base64,AA==',
}

describe('source PDF page preview platform', () => {
  it('invokes the tenant-scoped native page renderer and maps PDF coordinates', async () => {
    const invoke = vi.fn().mockResolvedValue(preview)
    const result = await createSourcePdfPagePreviewPlatform(invoke).get('family', 'document', 2)

    expect(invoke).toHaveBeenCalledWith('source_pdf_page_preview_get', { householdId: 'family', sourceDocumentId: 'document', pageNumber: 2 })
    expect(pdfPreviewToEvidenceImage(result)).toEqual({
      src: preview.dataUrl, width: 1224, height: 1584, pageWidthPoints: 612, pageHeightPoints: 792,
      alt: 'statement.pdf Page 2',
    })
  })

  it('rejects malformed or out-of-bounds native results', async () => {
    await expect(createSourcePdfPagePreviewPlatform(vi.fn().mockResolvedValue({ ...preview, pageNumber: 4 })).get('family', 'document', 4)).rejects.toThrow(TypeError)
    await expect(createSourcePdfPagePreviewPlatform(vi.fn().mockResolvedValue({ ...preview, widthPixels: 50_000 })).get('family', 'document', 2)).rejects.toThrow(TypeError)
    await expect(createSourcePdfPagePreviewPlatform(vi.fn().mockResolvedValue({ ...preview, dataUrl: 'https://example.test/page.png' })).get('family', 'document', 2)).rejects.toThrow(TypeError)
  })
})
