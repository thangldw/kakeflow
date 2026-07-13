import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const activeReview = vi.fn()
const pickAndStage = vi.fn()
const resolvePackage = vi.fn()
const applyPackage = vi.fn()
const discardPackage = vi.fn()
const exportPackage = vi.fn()
vi.mock('../../platform', () => ({
  platformClient: {
    runtime: 'tauri',
    getActiveChangePackageReview: (...args: unknown[]) => activeReview(...args),
    pickAndStageChangePackage: (...args: unknown[]) => pickAndStage(...args),
    resolveChangePackage: (...args: unknown[]) => resolvePackage(...args),
    applyChangePackage: (...args: unknown[]) => applyPackage(...args),
    discardChangePackage: (...args: unknown[]) => discardPackage(...args),
    exportChangePackage: (...args: unknown[]) => exportPackage(...args),
  },
}))

import { LocalChangePackagePanel } from './LocalChangePackagePanel'

const review = {
  packageId: 'package-1', targetHouseholdId: 'family', sourceInstallationId: 'source-device',
  sourceRevision: 42, sourceCreatedAt: '2026-07-13T00:00:00Z', state: 'REVIEW_REQUIRED',
  recordCount: 4, createCount: 1, updateCount: 1, unchangedCount: 0, deleteCount: 1, conflictCount: 1,
  records: [
    { recordOrder: 0, entityKind: 'ACCOUNT', entityId: 'bank', operation: 'UPSERT', payloadSha256: 'a'.repeat(64), reviewState: 'CONFLICT', resolution: 'PENDING', currentPayloadSha256: 'b'.repeat(64), conflictReason: 'LOCAL_DIVERGENCE' },
    { recordOrder: 1, entityKind: 'TRANSACTION', entityId: 'old', operation: 'DELETE', payloadSha256: 'c'.repeat(64), reviewState: 'DELETE', resolution: 'PENDING', currentPayloadSha256: 'c'.repeat(64), conflictReason: null },
  ],
} as const

describe('LocalChangePackagePanel', () => {
  beforeEach(() => {
    activeReview.mockReset().mockResolvedValue(review)
    pickAndStage.mockReset(); resolvePackage.mockReset(); applyPackage.mockReset()
    discardPackage.mockReset(); exportPackage.mockReset()
  })

  it('states the local-only workflow and requires an explicit choice for every risky item', async () => {
    resolvePackage.mockResolvedValue({ ...review, state: 'READY', records: review.records.map((item) => ({ ...item, resolution: 'APPLY_INCOMING' })) })
    render(<LocalChangePackagePanel householdId="family" />)
    expect(await screen.findByText('反映前の確認')).toBeInTheDocument()
    expect(screen.getByText(/ネットワーク送受信は行いません/)).toBeInTheDocument()
    expect(screen.queryByText('同期済み')).not.toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: '選択内容を確定' })
    expect(confirm).toBeDisabled()
    const incoming = screen.getAllByRole('radio', { name: /パッケージ/ })
    fireEvent.click(incoming[0]); fireEvent.click(incoming[1])
    expect(confirm).toBeEnabled(); fireEvent.click(confirm)
    await waitFor(() => expect(resolvePackage).toHaveBeenCalledWith('package-1', [
      { entityKind: 'ACCOUNT', entityId: 'bank', resolution: 'APPLY_INCOMING' },
      { entityKind: 'TRANSACTION', entityId: 'old', resolution: 'APPLY_INCOMING' },
    ]))
    expect(await screen.findByText('反映準備ができました')).toBeInTheDocument()
  })

  it('applies a ready package only after the separate final action', async () => {
    const ready = { ...review, state: 'READY', records: [] } as const
    activeReview.mockResolvedValue(ready)
    applyPackage.mockResolvedValue({ ...ready, state: 'APPLIED' })
    render(<LocalChangePackagePanel householdId="family" />)
    fireEvent.click(await screen.findByRole('button', { name: '台帳へ反映' }))
    await waitFor(() => expect(applyPackage).toHaveBeenCalledWith('package-1'))
    expect(await screen.findByText('このパッケージは反映済みです。')).toBeInTheDocument()
  })

  it('ignores a file-picker result after the household changes', async () => {
    activeReview.mockResolvedValue(null)
    let finishPick: (value: typeof review) => void = () => undefined
    pickAndStage.mockReturnValue(new Promise((resolve) => { finishPick = resolve }))
    const view = render(<LocalChangePackagePanel householdId="family" />)
    fireEvent.click(await screen.findByRole('button', { name: 'ローカルパッケージを選択' }))
    view.rerender(<LocalChangePackagePanel householdId="other" />)
    finishPick(review)
    await waitFor(() => expect(activeReview).toHaveBeenCalledWith('other'))
    expect(screen.queryByText('反映前の確認')).not.toBeInTheDocument()
  })
})
