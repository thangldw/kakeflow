import { describe, expect, it, vi } from 'vitest'
import { createProtectedPdfPlatform } from './protectedPdfPlatform'

const extracted = { method: 'EMBEDDED_TEXT', text: 'TOTAL 1200', confidenceBps: 9000, issues: [], regions: [{ pageNumber: 1, coordinateSpace: 'UNLOCATED', boundingBox: null, text: 'TOTAL 1200', confidenceBps: 9000, provenance: 'PDF_EMBEDDED_TEXT' }] }

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
})
