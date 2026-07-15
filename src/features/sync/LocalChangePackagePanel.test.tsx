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
    expect(screen.getByText(/先に原本カプセル/)).toBeInTheDocument()
    const layoutScope = screen.getByText(/5テンプレート分の並びと表示設定/)
    for (const template of ['財務概要', '家計簿', '資産・負債', 'カード照合', 'キャッシュフロー']) expect(layoutScope).toHaveTextContent(`「${template}」`)
    expect(layoutScope).toHaveTextContent('このローカルファイルに含めます')
    expect(layoutScope).not.toHaveTextContent('クラウド')
    expect(layoutScope).not.toHaveTextContent('同期')
    expect(screen.getByText('手順 2 / 2')).toBeInTheDocument()
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

  it('names card statement and settlement records in the review', async () => {
    activeReview.mockResolvedValue({
      ...review,
      records: [
        { ...review.records[0], entityKind: 'CARD_STATEMENT', entityId: 'statement-1' },
        { ...review.records[1], entityKind: 'CARD_PAYMENT', entityId: 'payment-1' },
      ],
    })
    render(<LocalChangePackagePanel householdId="family" />)
    expect(await screen.findByText('カード請求・statement-1')).toBeInTheDocument()
    expect(screen.getByText('カード引落照合・payment-1')).toBeInTheDocument()
  })

  it('uses distinct review labels for every portable investment aggregate', async () => {
    activeReview.mockResolvedValue({
      ...review,
      recordCount: 5,
      records: [
        { ...review.records[0], entityKind: 'PORTFOLIO_SNAPSHOT', entityId: 'portfolio-1' },
        { ...review.records[0], entityKind: 'BROKERAGE_EVENT', entityId: 'event-1' },
        { ...review.records[0], entityKind: 'INVESTMENT_FX_RATE', entityId: 'fx-1' },
        { ...review.records[0], entityKind: 'INVESTMENT_MARKET_PRICE', entityId: 'price-1' },
        { ...review.records[0], entityKind: 'AGGREGATE_ASSET_SNAPSHOT', entityId: 'aggregate-1' },
      ],
    })
    render(<LocalChangePackagePanel householdId="family" />)
    for (const label of ['資産残高', '証券取引', '投資用為替レート', '市場価格', '総資産履歴']) {
      expect(await screen.findByText(new RegExp(`^${label}・`))).toBeInTheDocument()
    }
  })

  it('labels and forwards the household recurring-series preference aggregate', async () => {
    const recurringReview = {
      ...review,
      recordCount: 1, createCount: 0, updateCount: 1, unchangedCount: 0, deleteCount: 0, conflictCount: 1,
      records: [{ ...review.records[0], entityKind: 'RECURRING_SERIES_PREFERENCES', entityId: 'family' }],
    } as const
    activeReview.mockResolvedValue(recurringReview)
    resolvePackage.mockResolvedValue({ ...recurringReview, state: 'READY', records: recurringReview.records.map((item) => ({ ...item, resolution: 'APPLY_INCOMING' })) })
    render(<LocalChangePackagePanel householdId="family" />)

    expect(await screen.findByText('定期支出の確認状態・family')).toBeInTheDocument()
    expect(screen.getByText(/「確認済み」「対象外」の判断/)).toHaveTextContent('反映後の予測と固定費分析に影響しますが、過去の取引は変更しません')
    fireEvent.click(screen.getByRole('radio', { name: 'パッケージの内容を使う' }))
    fireEvent.click(screen.getByRole('button', { name: '選択内容を確定' }))

    await waitFor(() => expect(resolvePackage).toHaveBeenCalledWith('package-1', [
      { entityKind: 'RECURRING_SERIES_PREFERENCES', entityId: 'family', resolution: 'APPLY_INCOMING' },
    ]))
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
