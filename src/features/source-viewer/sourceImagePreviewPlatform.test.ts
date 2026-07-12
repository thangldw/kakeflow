import { describe, expect, it, vi } from 'vitest'

import { createSourceImagePreviewPlatform } from './sourceImagePreviewPlatform'

describe('source image preview platform', () => {
  it('invokes the tenant-scoped native command and validates the data URL', async () => {
    const invoke = vi.fn().mockResolvedValue({ sourceDocumentId: 'document', filename: 'receipt.png', mediaType: 'image/png', byteSize: 3, dataUrl: 'data:image/png;base64,AAA=' })
    await expect(createSourceImagePreviewPlatform(invoke).get('family', 'document')).resolves.toMatchObject({ mediaType: 'image/png' })
    expect(invoke).toHaveBeenCalledWith('source_image_preview_get', { householdId: 'family', sourceDocumentId: 'document' })
  })

  it('rejects mismatched or unsupported data URLs', async () => {
    const invoke = vi.fn().mockResolvedValue({ sourceDocumentId: 'document', filename: 'x.svg', mediaType: 'image/svg+xml', byteSize: 3, dataUrl: 'data:image/svg+xml;base64,AAA=' })
    await expect(createSourceImagePreviewPlatform(invoke).get('family', 'document')).rejects.toThrow(TypeError)
  })
})
