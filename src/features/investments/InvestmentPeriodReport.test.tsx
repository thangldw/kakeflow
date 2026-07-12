import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { InvestmentPeriodReport } from './InvestmentPeriodReport'
import type { InvestmentPerformanceDto } from './investmentPerformancePlatform'

const report: InvestmentPerformanceDto = {
  dateFrom: '2026-01-01', dateTo: '2026-12-31', costBasisMethod: 'FIFO',
  totalsByCurrency: [{ currency: 'JPY', buyGross: 100_000, sellGross: 140_000, realizedPnl: 35_000, dividendGross: 5_000, fees: 1_000, taxes: 4_000 }],
  realizedAllocations: [{ sellEventId: 'sell', buyEventId: 'buy', accountId: 'broker', instrumentCode: '7203', instrumentName: 'トヨタ自動車', currency: 'JPY', soldOn: '2026-07-01', acquiredOn: '2025-01-01', quantity: 10, allocatedCostBasis: 100_000, allocatedNetProceeds: 135_000, realizedPnl: 35_000, buySourceDocumentId: 'buy-doc', buySourceRow: 2, sellSourceDocumentId: 'sell-doc', sellSourceRow: 8 }],
  uncoveredSales: [], skippedEventIds: [], corporateActionEventIds: [], corporateActionAllocations: [],
}

describe('InvestmentPeriodReport', () => {
  it('queries a bounded year and shows currency totals with source rows', async () => {
    const query = vi.fn().mockResolvedValue(report)
    render(<InvestmentPeriodReport householdId="home" revision={1} initialYear={2026} queryPerformance={query} />)
    expect(await screen.findByText('実現損益 ¥35,000')).toBeInTheDocument()
    expect(screen.getByText('買付原本 行 2 → 売却原本 行 8')).toBeInTheDocument()
    expect(query).toHaveBeenCalledWith({ householdId: 'home', dateFrom: '2026-01-01', dateTo: '2026-12-31' })
  })

  it('requeries when the selected year changes', async () => {
    const query = vi.fn().mockResolvedValue(report)
    render(<InvestmentPeriodReport householdId="home" revision={1} initialYear={2026} queryPerformance={query} />)
    await screen.findByText('実現損益 ¥35,000')
    fireEvent.change(screen.getByLabelText('投資実績の対象年'), { target: { value: '2025' } })
    await waitFor(() => expect(query).toHaveBeenLastCalledWith({ householdId: 'home', dateFrom: '2025-01-01', dateTo: '2025-12-31' }))
  })

  it('keeps unavailable reporting nonfatal', async () => {
    render(<InvestmentPeriodReport householdId="home" revision={1} initialYear={2026} queryPerformance={vi.fn().mockRejectedValue(new Error('offline'))} />)
    expect(await screen.findByRole('status')).toHaveTextContent('期間別の投資実績を読み込めませんでした。')
  })
})
