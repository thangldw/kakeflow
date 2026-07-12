import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { InvestmentFxSummary } from './InvestmentFxSummary'

describe('InvestmentFxSummary', () => {
  it('shows JPY totals, native amounts, and selected-rate provenance', async () => {
    const queryReporting = vi.fn(async () => ({
      dateFrom: null, dateTo: null, fxAsOf: '2026-12-31',
      originalTotalsByCurrency: [
        { currency: 'USD', buyGross: 100, sellGross: 200, realizedPnl: 50, dividendGross: 10, fees: 2, taxes: 3 },
        { currency: 'JPY', buyGross: 1000, sellGross: 0, realizedPnl: -100, dividendGross: 0, fees: 10, taxes: 0 },
      ],
      convertedTotals: { currency: 'JPY', buyGross: 16000, sellGross: 30000, realizedPnl: 7400, dividendGross: 1500, fees: 310, taxes: 450 },
      conversions: [
        { originalCurrency: 'USD', reportingCurrency: 'JPY', rate: 150, rateId: 'boj-20261230', rateDate: '2026-12-30', inverted: false, sourceKind: 'OFFICIAL_REFERENCE' as const, provider: 'BOJ', sourceDocumentId: null, sourceRow: null },
        { originalCurrency: 'JPY', reportingCurrency: 'JPY', rate: 1, rateId: 'IDENTITY', rateDate: '2026-12-31', inverted: false, sourceKind: 'IDENTITY' as const, provider: 'KakeFlow', sourceDocumentId: null, sourceRow: null },
      ],
    }))
    render(<InvestmentFxSummary householdId="home" fxAsOf="2026-12-31" revision={1} queryReporting={queryReporting} />)
    expect(await screen.findByText('¥7,400')).toBeInTheDocument()
    expect(screen.getByText(/USD 50/)).toBeInTheDocument()
    expect(screen.getByText('USD → JPY')).toBeInTheDocument()
    expect(screen.getByText('2026-12-30 ・ BOJ')).toBeInTheDocument()
    expect(screen.getByText('× 150')).toBeInTheDocument()
    expect(queryReporting).toHaveBeenCalledWith({ householdId: 'home', reportingCurrency: 'JPY', fxAsOf: '2026-12-31' })
  })

  it('turns a missing rate into a nonfatal notice without invented totals', async () => {
    const queryReporting = vi.fn(async () => { throw new Error('A required FX rate is missing; native-currency totals were not converted') })
    render(<InvestmentFxSummary householdId="home" fxAsOf="2026-12-31" revision={1} queryReporting={queryReporting} />)
    expect(await screen.findByRole('status')).toHaveTextContent('円換算に必要な為替レートが不足しています')
    expect(screen.getByRole('status')).toHaveTextContent('元通貨の保有残高と実績はそのまま利用できます')
    expect(screen.queryByLabelText('投資実績の円換算')).not.toBeInTheDocument()
  })

  it('ignores a stale request when the household changes', async () => {
    let resolveFirst: ((value: never) => void) | undefined
    const queryReporting = vi.fn((request: { householdId: string }) => request.householdId === 'first'
      ? new Promise<never>((resolve) => { resolveFirst = resolve })
      : Promise.resolve({ dateFrom: null, dateTo: null, fxAsOf: '2026-12-31', originalTotalsByCurrency: [], convertedTotals: { currency: 'JPY', buyGross: 0, sellGross: 0, realizedPnl: 99, dividendGross: 0, fees: 0, taxes: 0 }, conversions: [] }))
    const view = render(<InvestmentFxSummary householdId="first" fxAsOf="2026-12-31" revision={1} queryReporting={queryReporting} />)
    view.rerender(<InvestmentFxSummary householdId="second" fxAsOf="2026-12-31" revision={1} queryReporting={queryReporting} />)
    expect(await screen.findByText('¥99')).toBeInTheDocument()
    resolveFirst?.({} as never)
    await waitFor(() => expect(screen.getByText('¥99')).toBeInTheDocument())
  })
})
