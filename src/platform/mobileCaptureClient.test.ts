import { describe, expect, it, vi } from 'vitest'
import { createPlatformClient, PlatformIpcError } from './client'

const item = { artifactId: 'artifact-1', captureId: 'capture-1', originalFilename: 'receipt.png', mediaType: 'image/png', byteSize: 100, sourceSha256: 'a'.repeat(64), capturedAt: '2026-07-14T12:00:00Z', receivedAt: '2026-07-14T12:01:00Z', senderMembershipId: 'membership-a', audienceVisibility: 'SHARED', audienceMemberId: null, state: 'RECEIVED', latestExtractionId: null, localRunId: null, localDocumentId: null, lastErrorCode: null }

describe('mobile capture platform client', () => {
  it('parses local inbox items and uses the exact native command', async () => {
    const invoke = vi.fn().mockResolvedValue([item]); const client = createPlatformClient({ tauri: true, invoke })
    await expect(client.listMobileCaptureInbox('family')).resolves.toEqual([expect.objectContaining({ captureId: 'capture-1', state: 'RECEIVED' })])
    expect(invoke).toHaveBeenCalledWith('mobile_capture_inbox_list', { householdId: 'family' })
  })

  it('keeps the capture cursor separate and validates the original-image preview', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ endpoint: 'https://relay.example', localDeviceId: 'desktop-1', captureInboundCursor: 7, items: [item] })
      .mockResolvedValueOnce({ endpoint: 'https://relay.example', localDeviceId: 'desktop-1', captureInboundCursor: 9, items: [item] })
      .mockResolvedValueOnce({ filename: 'receipt.png', mediaType: 'image/png', byteSize: 1, dataUrl: 'data:image/png;base64,AA==' })
    const client = createPlatformClient({ tauri: true, invoke })
    await expect(client.getMobileCaptureStatus('family')).resolves.toMatchObject({ captureInboundCursor: 7 })
    await expect(client.updateMobileCaptureCursor('family', 9)).resolves.toMatchObject({ captureInboundCursor: 9 })
    await expect(client.getMobileCaptureImagePreview('family', 'artifact-1')).resolves.toMatchObject({ filename: 'receipt.png' })
    expect(invoke.mock.calls).toEqual([
      ['mobile_capture_status', { householdId: 'family' }],
      ['mobile_capture_cursor_update', { householdId: 'family', nextCursor: 9 }],
      ['mobile_capture_image_preview', { householdId: 'family', artifactId: 'artifact-1' }],
    ])
  })

  it('rejects malformed state graphs at the webview boundary', async () => {
    const client = createPlatformClient({ tauri: true, invoke: vi.fn().mockResolvedValue([{ ...item, state: 'PROMOTED' }]) })
    await expect(client.listMobileCaptureInbox('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'mobile_capture_inbox_list' } satisfies Partial<PlatformIpcError>)
  })

  it('parses OCR and promotion without treating either as a posted transaction', async () => {
    const promoted = { ...item, state: 'PROMOTED', latestExtractionId: 'extract-1', localRunId: 'run-1', localDocumentId: 'document-1' }
    const document = { method: 'OCR' as const, text: '合計 100円', confidenceBps: 9000, issues: [], regions: [], pageCount: 1, pages: [{ pageNumber: 1, widthPixels: 100, heightPixels: 100, confidenceBps: 9000, issues: [] }] }
    const invoke = vi.fn()
      .mockResolvedValueOnce({ item: { ...item, state: 'OCR_READY', latestExtractionId: 'extract-1' }, extractionId: 'extract-1', document })
      .mockResolvedValueOnce({ item: { ...item, state: 'OCR_READY', latestExtractionId: 'extract-1' }, extractionId: 'extract-1', document })
      .mockResolvedValueOnce({ item: promoted, runId: 'run-1', documentId: 'document-1', reusedExisting: false })
    const client = createPlatformClient({ tauri: true, invoke })
    await expect(client.ocrMobileCapture('family', 'artifact-1')).resolves.toMatchObject({ extractionId: 'extract-1', item: { state: 'OCR_READY' } })
    await expect(client.storeMobileCaptureOcr('family', 'artifact-1', document)).resolves.toMatchObject({ extractionId: 'extract-1', item: { state: 'OCR_READY' } })
    await expect(client.promoteMobileCapture({ householdId: 'family', artifactId: 'artifact-1', extractionId: 'extract-1', import: {} as never })).resolves.toMatchObject({ item: { state: 'PROMOTED' }, reusedExisting: false })
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['mobile_capture_ocr', 'mobile_capture_ocr_store', 'mobile_capture_promote'])
  })

  it('uses strict native contracts for explicit background intake controls', async () => {
    const schedule = {
      householdId: 'family', enabled: true, intervalMinutes: 30, nextDueAt: '2026-07-15T01:30:00Z', running: false, leaseExpiresAt: null,
      lastAttemptAt: '2026-07-15T01:00:00Z', lastSuccessAt: '2026-07-15T01:00:01Z', lastResult: 'INGESTED', lastIngestedCount: 2,
      consecutiveFailures: 0, suspendedUntil: null, suspensionReason: null, lastErrorCode: null, updatedAt: '2026-07-15T01:00:01Z',
    }
    const invoke = vi.fn().mockResolvedValue(schedule); const client = createPlatformClient({ tauri: true, invoke })
    await expect(client.getMobileCaptureBackgroundStatus('family')).resolves.toEqual(schedule)
    await client.enableMobileCaptureBackground({ householdId: 'family', token: 'secret', intervalMinutes: 30 })
    await client.runMobileCaptureBackgroundNow('family'); await client.disableMobileCaptureBackground('family')
    expect(invoke.mock.calls).toEqual([
      ['mobile_capture_background_status', { householdId: 'family' }],
      ['mobile_capture_background_enable', { input: { householdId: 'family', token: 'secret', intervalMinutes: 30 } }],
      ['mobile_capture_background_run_now', { householdId: 'family' }],
      ['mobile_capture_background_disable', { householdId: 'family' }],
    ])
  })

  it('rejects impossible background lease state at the webview boundary', async () => {
    const client = createPlatformClient({ tauri: true, invoke: vi.fn().mockResolvedValue({
      householdId: 'family', enabled: true, intervalMinutes: 30, nextDueAt: '2026-07-15T01:30:00Z', running: false,
      leaseExpiresAt: '2026-07-15T01:02:00Z', lastAttemptAt: null, lastSuccessAt: null, lastResult: 'RUNNING', lastIngestedCount: 0,
      consecutiveFailures: 0, suspendedUntil: null, suspensionReason: null, lastErrorCode: null, updatedAt: '2026-07-15T01:00:00Z',
    }) })
    await expect(client.getMobileCaptureBackgroundStatus('family')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'mobile_capture_background_status' })
  })
})
