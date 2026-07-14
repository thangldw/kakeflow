import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ active: vi.fn(), resolve: vi.fn(), apply: vi.fn(), discard: vi.fn() }))
vi.mock('../../platform', () => ({ platformClient: {
  runtime: 'tauri', getActiveFamilySnapshotReview: (...args: unknown[]) => api.active(...args),
  resolveFamilySnapshot: (...args: unknown[]) => api.resolve(...args), applyFamilySnapshot: (...args: unknown[]) => api.apply(...args),
  discardFamilySnapshot: (...args: unknown[]) => api.discard(...args),
} }))

import { FamilySnapshotReviewPanel } from './FamilySnapshotReviewPanel'

const review = {
  packageId: 'family-package-1', householdId: 'family', senderMemberName: '花子', audienceVisibility: 'SHARED' as const, audienceMemberName: null,
  state: 'REVIEW_REQUIRED' as const, recordCount: 2, createCount: 0, updateCount: 1, deleteCount: 1, conflictCount: 2,
  evidenceFileCount: 0, evidenceRecordCount: 0,
  records: [
    { recordOrder: 0, entityKind: 'TRANSACTION', entityId: 'tx-1', entityLabel: '取引・tx-1', domain: 'LEDGER' as const, entitySummary: '食費・スーパー', operation: 'UPSERT' as const, reviewState: 'CONFLICT' as const, resolution: 'PENDING' as const, localSummary: '¥4,800・食費', incomingSummary: '¥5,000・食費' },
    { recordOrder: 1, entityKind: 'TRANSACTION', entityId: 'tx-2', entityLabel: '取引・tx-2', domain: 'LEDGER' as const, entitySummary: '交通費・電車', operation: 'DELETE' as const, reviewState: 'DELETE' as const, resolution: 'PENDING' as const, localSummary: '¥1,200・交通費', incomingSummary: '削除候補' },
  ],
}

describe('FamilySnapshotReviewPanel', () => {
  beforeEach(() => { api.active.mockReset().mockResolvedValue(review); api.resolve.mockReset(); api.apply.mockReset(); api.discard.mockReset() })

  it('states the partition boundary and requires an explicit choice for every risky record', async () => {
    api.resolve.mockResolvedValue({ ...review, state: 'READY', records: review.records.map((record) => ({ ...record, resolution: 'APPLY_INCOMING' })) })
    render(<FamilySnapshotReviewPanel householdId="family" />)
    expect(await screen.findByText('花子さんから・世帯共有')).toBeInTheDocument()
    expect(screen.getByText(/含まれない個人データは削除・変更しません/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '台帳・取引 2件' })).toBeInTheDocument()
    expect(screen.getByText('¥4,800・食費')).toBeInTheDocument(); expect(screen.getByText('¥5,000・食費')).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: '選択内容を確定' }); expect(confirm).toBeDisabled()
    const incoming = screen.getAllByRole('radio', { name: /受信/ }); fireEvent.click(incoming[0]); fireEvent.click(incoming[1]); fireEvent.click(confirm)
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith('family-package-1', [
      { entityKind: 'TRANSACTION', entityId: 'tx-1', resolution: 'APPLY_INCOMING' },
      { entityKind: 'TRANSACTION', entityId: 'tx-2', resolution: 'APPLY_INCOMING' },
    ]))
    expect(await screen.findByRole('button', { name: 'この端末の台帳に反映' })).toBeInTheDocument()
  })

  it('keeps final apply separate and never claims synchronization', async () => {
    const ready = { ...review, state: 'READY' as const, records: review.records.map((record) => ({ ...record, resolution: 'KEEP_LOCAL' as const })) }
    api.active.mockResolvedValue(ready); api.apply.mockResolvedValue({ ...ready, state: 'APPLIED' })
    render(<FamilySnapshotReviewPanel householdId="family" />)
    fireEvent.click(await screen.findByRole('button', { name: 'この端末の台帳に反映' }))
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('family-package-1'))
    expect(await screen.findByText('2件をこの端末へ反映しました。')).toBeInTheDocument()
    expect(screen.queryByText(/同期済み/)).not.toBeInTheDocument()
  })

  it('groups configuration changes and discloses their future effect', async () => {
    const configuration = {
      ...review, recordCount: 1, createCount: 0, updateCount: 0, deleteCount: 0, conflictCount: 1,
      records: [{ recordOrder: 0, entityKind: 'CLASSIFICATION_RULE', entityId: 'rule-1', entityLabel: '分類ルール・rule-1', domain: 'CONFIG' as const, entitySummary: 'NETFLIX → 娯楽 / Subscription', operation: 'UPSERT' as const, reviewState: 'CONFLICT' as const, resolution: 'PENDING' as const, localSummary: '無効', incomingSummary: '有効' }],
    }
    api.active.mockResolvedValue(configuration)
    render(<FamilySnapshotReviewPanel householdId="family" />)
    expect(await screen.findByRole('heading', { name: 'ルール・表示設定 1件' })).toBeInTheDocument()
    expect(screen.getByText('NETFLIX → 娯楽 / Subscription')).toBeInTheDocument()
    expect(screen.getByText(/過去の取引は自動変更されません/)).toBeInTheDocument()
  })

  it('groups card and investment facts and discloses their partition evidence', async () => {
    const financial = {
      ...review, recordCount: 2, createCount: 0, updateCount: 0, deleteCount: 0, conflictCount: 2,
      evidenceFileCount: 2, evidenceRecordCount: 18,
      records: [
        { recordOrder: 0, entityKind: 'CARD_STATEMENT', entityId: 'statement-1', entityLabel: 'カード請求・statement-1', domain: 'CARD' as const, entitySummary: '楽天カード · 2026年7月 · ¥204,987', operation: 'UPSERT' as const, reviewState: 'CONFLICT' as const, resolution: 'PENDING' as const, localSummary: '未照合', incomingSummary: '支払済み' },
        { recordOrder: 1, entityKind: 'PORTFOLIO_SNAPSHOT', entityId: 'portfolio-1', entityLabel: 'ポートフォリオ・portfolio-1', domain: 'INVESTMENT' as const, entitySummary: 'SBI証券 · 2026-07-12 · ¥4,800,000', operation: 'UPSERT' as const, reviewState: 'CONFLICT' as const, resolution: 'PENDING' as const, localSummary: '10銘柄', incomingSummary: '12銘柄' },
      ],
    }
    api.active.mockResolvedValue(financial)
    render(<FamilySnapshotReviewPanel householdId="family" />)
    expect(await screen.findByRole('heading', { name: 'カード・支払照合 1件' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '投資・資産 1件' })).toBeInTheDocument()
    expect(screen.getByText('楽天カード · 2026年7月 · ¥204,987')).toBeInTheDocument()
    expect(screen.getByText('SBI証券 · 2026-07-12 · ¥4,800,000')).toBeInTheDocument()
    const evidence = screen.getByLabelText('受信した原本と証跡')
    expect(evidence).toHaveTextContent('2ファイル')
    expect(evidence).toHaveTextContent('18証跡')
    expect(evidence).toHaveTextContent('同じ配信範囲')
  })
})
