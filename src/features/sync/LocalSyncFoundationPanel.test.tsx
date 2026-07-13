import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getStatus = vi.fn()
const updateBinding = vi.fn()
vi.mock('../../platform', () => ({
  platformClient: {
    runtime: 'tauri',
    getLocalSyncFoundationStatus: (...args: unknown[]) => getStatus(...args),
    updatePrincipalMemberBinding: (...args: unknown[]) => updateBinding(...args),
  },
}))

import { LocalSyncFoundationPanel } from './LocalSyncFoundationPanel'

const status = {
  device: { id: 'device-1234567890abcdef', displayName: 'KakeFlow on macOS', createdAt: '2026-07-13T00:00:00Z' },
  platform: 'MACOS',
  principal: { id: 'principal-1234567890abcdef', displayName: 'Local principal', createdAt: '2026-07-13T00:00:00Z' },
  binding: { householdId: 'family', principalId: 'principal-1234567890abcdef', memberId: 'taro', memberName: 'Taro', updatedAt: '2026-07-13T00:00:00Z' },
  outbox: { envelopeCount: 2, latestSequence: 2, latestRecordedAt: '2026-07-13T00:00:00Z' },
  remoteTransport: 'NOT_CONFIGURED', restoreValidation: 'ENABLED',
} as const

describe('LocalSyncFoundationPanel', () => {
  beforeEach(() => { getStatus.mockReset().mockResolvedValue(status); updateBinding.mockReset().mockResolvedValue(status) })

  it('shows truthful device-only state without claiming remote sync', async () => {
    render(<LocalSyncFoundationPanel householdId="family" />)
    expect(await screen.findByText('KakeFlow on macOS')).toBeInTheDocument()
    expect(screen.getByText('2件・最新 #2')).toBeInTheDocument()
    expect(screen.getByText('端末内のみ')).toBeInTheDocument()
    expect(screen.getByText(/クラウド同期・他端末への送信はまだ行いません/)).toBeInTheDocument()
    expect(screen.queryByText('同期済み')).not.toBeInTheDocument()
  })

  it('only binds after explicit selection and excludes archived members', async () => {
    render(<LocalSyncFoundationPanel householdId="family" allowBinding members={[
      { id: 'taro', householdId: 'family', displayName: 'Taro', relationshipLabel: null, status: 'ACTIVE', sortOrder: 0, createdAt: 'x', updatedAt: 'x' },
      { id: 'old', householdId: 'family', displayName: 'Archived', relationshipLabel: null, status: 'ARCHIVED', sortOrder: 1, createdAt: 'x', updatedAt: 'x' },
    ]} />)
    const select = await screen.findByLabelText('ローカル主体を家族メンバーに対応付け')
    expect(screen.queryByRole('option', { name: 'Archived' })).not.toBeInTheDocument()
    expect(updateBinding).not.toHaveBeenCalled()
    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '対応を保存' }))
    await waitFor(() => expect(updateBinding).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', principalId: status.principal.id, memberId: null })))
    expect(screen.getByText(/現在はログイン、閲覧制限、アクセス制御を行いません/)).toBeInTheDocument()
  })

  it('offers retry after a local status failure', async () => {
    getStatus.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(status)
    render(<LocalSyncFoundationPanel householdId="family" />)
    expect(await screen.findByText('この端末の同期基盤を確認できませんでした。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByText('KakeFlow on macOS')).toBeInTheDocument()
  })
})
