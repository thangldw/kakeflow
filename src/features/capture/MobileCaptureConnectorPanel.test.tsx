import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileCaptureConnectorPanel } from './MobileCaptureConnectorPanel'

const mocks = vi.hoisted(() => ({ status: vi.fn(), enable: vi.fn(), disable: vi.fn(), run: vi.fn() }))

vi.mock('../../platform', async (original) => ({
  ...await original<typeof import('../../platform')>(),
  platformClient: {
    runtime: 'tauri',
    getMobileCaptureBackgroundStatus: mocks.status,
    enableMobileCaptureBackground: mocks.enable,
    disableMobileCaptureBackground: mocks.disable,
    runMobileCaptureBackgroundNow: mocks.run,
  },
}))

const disabled = { householdId: 'family', enabled: false, intervalMinutes: 30, nextDueAt: null, running: false, leaseExpiresAt: null, lastAttemptAt: null, lastSuccessAt: null, lastResult: 'DISABLED', lastIngestedCount: 0, consecutiveFailures: 0, suspendedUntil: null, suspensionReason: null, lastErrorCode: null, updatedAt: '2026-07-15T00:00:00Z' }

describe('MobileCaptureConnectorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status.mockResolvedValue(disabled)
    mocks.enable.mockResolvedValue({ ...disabled, enabled: true, nextDueAt: '2026-07-15T01:00:00Z', lastResult: 'NEVER' })
  })

  it('stores connector configuration in Settings and never starts OCR or posting', async () => {
    render(<MobileCaptureConnectorPanel householdId="family" />)
    expect(await screen.findByText('テストユーザー限定')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('接続トークン'), { target: { value: 'session-token' } })
    fireEvent.change(screen.getByLabelText('確認間隔'), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'モバイル転送を有効にする' }))
    await waitFor(() => expect(mocks.enable).toHaveBeenCalledWith({ householdId: 'family', token: 'session-token', intervalMinutes: 15 }))
    expect(await screen.findByText(/OCRや台帳反映は自動実行しません/)).toBeInTheDocument()
    expect(screen.getByLabelText('接続トークン')).toHaveValue('')
  })
})
