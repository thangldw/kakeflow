import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MobileCaptureInboxItemDto } from '../../platform'
import { CaptureInboxPage } from './CaptureInboxPage'

const item = (state: MobileCaptureInboxItemDto['state'], overrides: Partial<MobileCaptureInboxItemDto> = {}): MobileCaptureInboxItemDto => ({
  artifactId: `artifact-${state}`, captureId: `capture-${state}`, originalFilename: 'receipt.png', mediaType: 'image/png',
  byteSize: 1_024, sourceSha256: 'a'.repeat(64), capturedAt: '2026-07-14T20:15:00+09:00', receivedAt: '2026-07-14T11:16:00Z',
  senderMembershipId: 'membership-hanako', senderMemberName: '花子', audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null,
  state, latestExtractionId: state === 'RECEIVED' ? null : 'extraction-1',
  localRunId: ['PROMOTED', 'DUPLICATE'].includes(state) ? 'run-1' : null,
  localDocumentId: ['PROMOTED', 'DUPLICATE'].includes(state) ? 'document-1' : null,
  lastErrorCode: state === 'FAILED_RETRYABLE' ? 'OCR_UNAVAILABLE' : null, receivedBeforeSenderRevocation: false,
  ...overrides,
})

function setup(items: readonly MobileCaptureInboxItemDto[]) {
  const actions = { refresh: vi.fn(), ocr: vi.fn(), promote: vi.fn(), openImport: vi.fn(), retry: vi.fn() }
  render(<CaptureInboxPage householdId="household" items={items} loading={false} busyArtifactId={null} token="token" preview={null} previewBusy={false} notice={null} onTokenChange={vi.fn()} onPreview={actions.promote} onClosePreview={vi.fn()}
    onRefresh={actions.refresh} onProcess={actions.ocr} onOpenImport={actions.openImport} onRetry={actions.retry} />)
  return actions
}

describe('CaptureInboxPage', () => {
  it('states that receiving and OCR never post to the ledger', () => {
    setup([item('RECEIVED')])
    expect(screen.getByText(/画像を受信しても、台帳には反映されません/)).toBeInTheDocument()
    expect(screen.getByText('台帳には未反映')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '原本画像を確認' })).toBeInTheDocument()
  })

  it('routes OCR, promotion, normal review, and retry through separate explicit actions', () => {
    const received = item('RECEIVED'); const ready = item('OCR_READY'); const promoted = item('PROMOTED'); const failed = item('FAILED_RETRYABLE')
    const actions = setup([received, ready, promoted, failed])
    fireEvent.click(screen.getAllByRole('button', { name: '原本画像を確認' })[0])
    fireEvent.click(screen.getAllByRole('button', { name: '原本画像を確認' })[1])
    fireEvent.click(screen.getByRole('button', { name: '取引候補を確認' }))
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み取る' }))
    expect(actions.promote).toHaveBeenCalledWith(received); expect(actions.promote).toHaveBeenCalledWith(ready)
    expect(actions.openImport).toHaveBeenCalledOnce(); expect(actions.retry).toHaveBeenCalledWith(failed)
  })

  it('explains duplicate, invalid, and post-revocation captures without offering a posting action', () => {
    setup([
      item('DUPLICATE'),
      item('REJECTED_INVALID'),
      item('RECEIVED', { artifactId: 'revoked', receivedBeforeSenderRevocation: true }),
    ])
    expect(screen.getByText(/同じ画像はすでに受信済みです。新しい支出候補は作成していません/)).toBeInTheDocument()
    expect(screen.getByText(/画像の内容を検証できなかったため受信しませんでした/)).toBeInTheDocument()
    expect(screen.getByText(/配信停止前に送信済みの画像です/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /台帳へ反映/ })).not.toBeInTheDocument()
  })

  it('uses alert semantics for invalid or revoked connection notices', () => {
    render(<CaptureInboxPage householdId="household" items={[]} loading={false} busyArtifactId={null} token="token" preview={null} previewBusy={false} onTokenChange={vi.fn()} onPreview={vi.fn()} onClosePreview={vi.fn()}
      notice={{ kind: 'error', text: 'この家族スペースへの配信は停止されています。新しい画像は受信できません。' }}
      onRefresh={vi.fn()} onProcess={vi.fn()} onOpenImport={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('新しい画像は受信できません')
  })

  it('shows the uncropped original in a dialog before OCR and restores explicit confirmation', () => {
    const received = item('RECEIVED'); const process = vi.fn(); const close = vi.fn()
    render(<CaptureInboxPage householdId="household" items={[received]} loading={false} busyArtifactId={null} token="token" preview={{ item: received, image: { filename: 'receipt.png', mediaType: 'image/png', byteSize: 10, dataUrl: 'data:image/png;base64,AA==' } }} previewBusy={false} notice={null}
      onTokenChange={vi.fn()} onPreview={vi.fn()} onClosePreview={close} onRefresh={vi.fn()} onProcess={process} onOpenImport={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'receipt.png' })).toBeInTheDocument()
    const image = screen.getByRole('img')
    expect(image).toHaveAttribute('src', 'data:image/png;base64,AA==')
    expect(image.parentElement).toHaveClass('capture-dialog-media')
    expect(screen.getByText(/OCRしても台帳には反映されません/)).toBeInTheDocument()
    const closeButton = screen.getByRole('button', { name: '原本画像を閉じる' })
    const processButton = screen.getByRole('button', { name: 'この画像をOCR' })
    closeButton.focus(); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(processButton).toHaveFocus()
    fireEvent.click(processButton)
    expect(process).toHaveBeenCalledWith(received)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(close).toHaveBeenCalledOnce()
  })

  it('requires explicit opt-in and keeps background intake separate from OCR', () => {
    const enable = vi.fn(); const run = vi.fn(); const disable = vi.fn(); const ocr = vi.fn()
    const { rerender } = render(<CaptureInboxPage householdId="household" items={[]} loading={false} busyArtifactId={null} token="token" preview={null} previewBusy={false} notice={null}
      background={null} backgroundInterval={30} backgroundBusy={false} onBackgroundIntervalChange={vi.fn()} onEnableBackground={enable} onDisableBackground={disable} onRunBackgroundNow={run}
      onTokenChange={vi.fn()} onPreview={vi.fn()} onClosePreview={vi.fn()} onRefresh={vi.fn()} onProcess={ocr} onOpenImport={vi.fn()} onRetry={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '自動受信を有効にする' })); expect(enable).toHaveBeenCalledOnce(); expect(ocr).not.toHaveBeenCalled()
    rerender(<CaptureInboxPage householdId="household" items={[]} loading={false} busyArtifactId={null} token="" preview={null} previewBusy={false} notice={null}
      background={{ householdId: 'household', enabled: true, intervalMinutes: 30, nextDueAt: '2026-07-15T02:00:00Z', running: false, leaseExpiresAt: null, lastAttemptAt: null, lastSuccessAt: null, lastResult: 'NEVER', lastIngestedCount: 0, consecutiveFailures: 0, suspendedUntil: null, suspensionReason: null, lastErrorCode: null, updatedAt: '2026-07-15T01:00:00Z' }} backgroundInterval={30} backgroundBusy={false} onBackgroundIntervalChange={vi.fn()} onEnableBackground={enable} onDisableBackground={disable} onRunBackgroundNow={run}
      onTokenChange={vi.fn()} onPreview={vi.fn()} onClosePreview={vi.fn()} onRefresh={vi.fn()} onProcess={ocr} onOpenImport={vi.fn()} onRetry={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '今すぐ確認' })); fireEvent.click(screen.getByRole('button', { name: '自動受信を停止' }))
    expect(run).toHaveBeenCalledOnce(); expect(disable).toHaveBeenCalledOnce(); expect(ocr).not.toHaveBeenCalled()
    expect(screen.getByText(/OCR、分類、取引照合、台帳反映は自動実行しません/)).toBeInTheDocument()
  })
})
