import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountDto } from '../../platform'
import { CaptureInboxWorkspace } from './CaptureInboxWorkspace'

const mocks = vi.hoisted(() => ({
  list: vi.fn(), preview: vi.fn(), ocr: vi.fn(), storeOcr: vi.fn(), paddleOcr: vi.fn(), promote: vi.fn(), mark: vi.fn(), commit: vi.fn(), receipt: vi.fn(),
  listWatchedFolders: vi.fn(),
  backgroundStatus: vi.fn(), backgroundEnable: vi.fn(), backgroundDisable: vi.fn(), backgroundRun: vi.fn(),
}))

vi.mock('../../platform', async (original) => ({
  ...await original<typeof import('../../platform')>(),
  platformClient: {
    runtime: 'tauri', listMobileCaptureInbox: mocks.list, getMobileCaptureImagePreview: mocks.preview,
    listWatchedFolders: mocks.listWatchedFolders,
    ocrMobileCapture: mocks.ocr, storeMobileCaptureOcr: mocks.storeOcr, promoteMobileCapture: mocks.promote, markMobileCaptureOcrReviewRequired: mocks.mark,
    getMobileCaptureBackgroundStatus: mocks.backgroundStatus, enableMobileCaptureBackground: mocks.backgroundEnable,
    disableMobileCaptureBackground: mocks.backgroundDisable, runMobileCaptureBackgroundNow: mocks.backgroundRun,
    commitImport: mocks.commit,
  },
}))
vi.mock('../import/receiptText', () => ({ buildReceiptImport: mocks.receipt }))
vi.mock('../import/paddleOcr', () => ({ paddleOcrDocument: mocks.paddleOcr, paddleOcrRenderedPdfPages: vi.fn() }))

const item = { artifactId: 'artifact-1', captureId: 'capture-1', originalFilename: 'receipt.png', mediaType: 'image/png' as const, byteSize: 100, sourceSha256: 'a'.repeat(64), capturedAt: '2026-07-14T12:00:00Z', receivedAt: '2026-07-14T12:01:00Z', senderMembershipId: 'membership-a', senderMemberName: '花子', audienceVisibility: 'PERSONAL' as const, audienceMemberId: 'member-a', state: 'RECEIVED' as const, latestExtractionId: null, localRunId: null, localDocumentId: null, lastErrorCode: null }
const cash: AccountDto = { id: 'cash', name: '現金', accountKind: 'ASSET', accountSubtype: 'CASH', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' }

describe('CaptureInboxWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.list.mockResolvedValue([item])
    mocks.preview.mockResolvedValue({ filename: 'receipt.png', mediaType: 'image/png', byteSize: 100, dataUrl: 'data:image/png;base64,AA==' })
    const document = { method: 'OCR', text: '花子商店\n2026/07/14\n合計 100円', confidenceBps: 9000, issues: [], regions: [], pageCount: 1, pages: [{ pageNumber: 1, widthPixels: 100, heightPixels: 100, confidenceBps: 9000, issues: [] }] }
    mocks.paddleOcr.mockResolvedValue(document)
    mocks.storeOcr.mockResolvedValue({ item: { ...item, state: 'OCR_READY', latestExtractionId: 'extract-1' }, extractionId: 'extract-1', document })
    mocks.ocr.mockResolvedValue({ item: { ...item, state: 'OCR_READY', latestExtractionId: 'extract-1' }, extractionId: 'extract-1', document })
    mocks.receipt.mockResolvedValue({ request: { runId: 'run-1', documentId: 'document-1', audienceVisibility: 'PERSONAL', audienceMemberId: 'member-a' }, fields: { issues: [] } })
    mocks.promote.mockResolvedValue({ item: { ...item, state: 'PROMOTED', latestExtractionId: 'extract-1', localRunId: 'run-1', localDocumentId: 'document-1' }, runId: 'run-1', documentId: 'document-1', reusedExisting: false })
    mocks.listWatchedFolders.mockResolvedValue([])
    mocks.backgroundStatus.mockResolvedValue({ householdId: 'family', enabled: false, intervalMinutes: 30, nextDueAt: null, running: false, leaseExpiresAt: null, lastAttemptAt: null, lastSuccessAt: null, lastResult: 'DISABLED', lastIngestedCount: 0, consecutiveFailures: 0, suspendedUntil: null, suspensionReason: null, lastErrorCode: null, updatedAt: '2026-07-15T00:00:00Z' })
  })

  it('requires original preview, preserves PERSONAL audience, and creates review without posting', async () => {
    render(<CaptureInboxWorkspace householdId="family" accounts={[cash]} onOpenImport={vi.fn()} onChanged={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '原本画像を確認' }))
    expect(await screen.findByRole('dialog', { name: 'receipt.png' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'この画像をOCR' }))
    await waitFor(() => expect(mocks.storeOcr).toHaveBeenCalledOnce())
    expect(mocks.paddleOcr).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/png')
    expect(mocks.ocr).not.toHaveBeenCalled()
    expect(mocks.promote).not.toHaveBeenCalled()
    expect(await screen.findByText(/OCRが完了しました/)).toBeInTheDocument()
    const reopen = screen.getByRole('button', { name: '原本画像を確認' })
    await waitFor(() => expect(reopen).toBeEnabled())
    fireEvent.click(reopen)
    fireEvent.click(await screen.findByRole('button', { name: 'インポートへ昇格' }))
    await waitFor(() => expect(mocks.ocr).toHaveBeenCalledOnce())
    await waitFor(() => expect(mocks.promote).toHaveBeenCalledOnce())
    expect(mocks.receipt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceType: 'CAMERA_SCAN', audienceVisibility: 'PERSONAL', audienceMemberId: 'member-a', attributionKind: 'MEMBER', attributedMemberId: 'member-a' }), expect.any(Function), expect.any(Function))
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(await screen.findByText(/台帳へは自動反映していません/)).toBeInTheDocument()
  })

  it('keeps connector credentials out of Capture while preserving the local inbox', async () => {
    render(<CaptureInboxWorkspace householdId="family" accounts={[cash]} onOpenImport={vi.fn()} onChanged={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: '届いたレシート' })).toBeInTheDocument()
    expect(screen.queryByLabelText('接続トークン')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '原本画像の自動受信' })).not.toBeInTheDocument()
    expect(mocks.backgroundEnable).not.toHaveBeenCalled()
    expect(mocks.ocr).not.toHaveBeenCalled(); expect(mocks.promote).not.toHaveBeenCalled(); expect(mocks.commit).not.toHaveBeenCalled()
  })
})
