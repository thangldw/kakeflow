import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AggregateAssetSnapshotDto } from './aggregateAssetHistoryPlatform'
import { AggregateAssetHistoryView } from './AggregateAssetHistoryView'

const snapshots: AggregateAssetSnapshotDto[] = [
  { id: 'jul', householdId: 'family', sourceDocumentId: 'doc', sourceRow: 3, asOf: '2026-07-31', totalAssetsJpy: 8_700_000, components: [{ assetClass: 'DEPOSITS_CASH_CRYPTO', officialHeader: '預金・現金・暗号資産(円)', valueJpy: 2_100_000 }, { assetClass: 'LISTED_STOCKS', officialHeader: '株式(現物)(円)', valueJpy: 3_100_000 }] },
  { id: 'jun', householdId: 'family', sourceDocumentId: 'doc', sourceRow: 2, asOf: '2026-06-30', totalAssetsJpy: 8_500_000, components: [{ assetClass: 'DEPOSITS_CASH_CRYPTO', officialHeader: '預金・現金・暗号資産(円)', valueJpy: 2_000_000 }] },
]

describe('AggregateAssetHistoryView', () => {
  it('shows latest total, change, composition and the no-ledger disclosure', () => {
    render(<AggregateAssetHistoryView snapshots={snapshots} />)
    expect(screen.getByRole('heading', { name: '総資産履歴（Money Forward）' })).toBeInTheDocument()
    expect(screen.getByText('資産のみ・純資産ではありません')).toBeInTheDocument()
    expect(screen.getByText(/台帳、収支、口座残高、現在の純資産には加算しません/)).toBeInTheDocument()
    expect(screen.getAllByText('¥8,700,000').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('+¥200,000')).toBeInTheDocument()
    expect(screen.getByText('株式')).toBeInTheDocument()
    expect(screen.getByText('原本行 3')).toBeInTheDocument()
  })

  it('applies an explicit date range', () => {
    const apply = vi.fn()
    render(<AggregateAssetHistoryView snapshots={snapshots} onApplyRange={apply} />)
    fireEvent.change(screen.getByLabelText('総資産履歴の開始日'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('総資産履歴の終了日'), { target: { value: '2026-07-31' } })
    fireEvent.click(screen.getByRole('button', { name: '期間を適用' }))
    expect(apply).toHaveBeenCalledWith('2026-06-01', '2026-07-31')
  })
})
