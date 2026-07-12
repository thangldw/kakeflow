import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { InvestmentPeriodReport } from './InvestmentPeriodReport'
import type { InvestmentPerformanceDto } from './investmentPerformancePlatform'

const report: InvestmentPerformanceDto = {
  dateFrom: '2026-01-01', dateTo: '2026-12-31', costBasisMethod: 'FIFO',
  totalsByCurrency: [{ currency: 'JPY', buyGross: 100_000, sellGross: 140_000, realizedPnl: 35_000, dividendGross: 5_000, fees: 1_000, taxes: 4_000 }],
  realizedAllocations: [{ sellEventId: 'sell', buyEventId: 'buy', accountId: 'broker', instrumentCode: '7203', instrumentName: 'トヨタ自動車', currency: 'JPY', soldOn: '2026-07-01', acquiredOn: '2025-01-01', quantity: 10, allocatedCostBasis: 100_000, allocatedNetProceeds: 135_000, realizedPnl: 35_000, buySourceDocumentId: 'buy-doc', buySourceRow: 2, sellSourceDocumentId: 'sell-doc', sellSourceRow: 8 }],
  uncoveredSales: [], skippedEventIds: [], corporateActionEventIds: ['spin', 'merger'], corporateActionAllocations: [
    { actionEventId: 'spin', actionType: 'SPIN_OFF', actionOn: '2026-04-01', actionSourceDocumentId: 'action-doc', actionSourceRow: 12, sourceBuyEventId: 'buy', sourceBuySourceDocumentId: 'buy-doc', sourceBuySourceRow: 2, fromInstrumentCode: '7203', targetInstrumentCode: '7203B', sourceCurrency: 'JPY', sourceCostBasis: 20_000, conversionRate: null, currency: 'JPY', quantity: 5, allocatedCostBasis: 20_000, cashAmount: 0, realizedPnl: null },
    { actionEventId: 'merger', actionType: 'MERGER_STOCK', actionOn: '2026-06-01', actionSourceDocumentId: 'merger-doc', actionSourceRow: 20, sourceBuyEventId: 'buy-usd', sourceBuySourceDocumentId: 'buy-usd-doc', sourceBuySourceRow: 4, fromInstrumentCode: 'ABC', targetInstrumentCode: 'XYZ', sourceCurrency: 'USD', sourceCostBasis: 750, conversionRate: 0.92, currency: 'EUR', quantity: 2, allocatedCostBasis: 690, cashAmount: 0, realizedPnl: null },
    { actionEventId: 'merger', actionType: 'MERGER_CASH', actionOn: '2026-06-01', actionSourceDocumentId: 'merger-doc', actionSourceRow: 20, sourceBuyEventId: 'buy-usd', sourceBuySourceDocumentId: 'buy-usd-doc', sourceBuySourceRow: 4, fromInstrumentCode: 'ABC', targetInstrumentCode: 'XYZ', sourceCurrency: 'USD', sourceCostBasis: 250, conversionRate: 150, currency: 'JPY', quantity: 8, allocatedCostBasis: 37_500, cashAmount: 45_000, realizedPnl: 7_500 },
  ],
}

describe('InvestmentPeriodReport', () => {
  it('queries a bounded year and shows currency totals with source rows', async () => {
    const query = vi.fn().mockResolvedValue(report)
    render(<InvestmentPeriodReport householdId="home" revision={1} initialYear={2026} queryPerformance={query} />)
    expect(await screen.findByText('実現損益 ¥35,000')).toBeInTheDocument()
    expect(screen.getByText('買付原本 行 2 → 売却原本 行 8')).toBeInTheDocument()
    expect(screen.getByText('スピンオフ')).toBeInTheDocument()
    expect(screen.getByText('合併・株式対価')).toBeInTheDocument()
    expect(screen.getByText('合併・現金対価')).toBeInTheDocument()
    expect(screen.getAllByText('非現金')).toHaveLength(2)
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.getByText(/元原価 USD 750 × 明示FX 0.92 = EUR 690/)).toBeInTheDocument()
    expect(screen.getAllByText(/取得原本 行 4 → アクション原本 行 20/)).toHaveLength(2)
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
