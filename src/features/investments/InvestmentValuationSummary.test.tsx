import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InvestmentValuationSummary } from './InvestmentValuationSummary'
import type { InvestmentValuationDto } from './investmentMarketPlatform'

const valuation: InvestmentValuationDto = {
  asOf: '2026-06-30', costBasisMethod: 'FIFO',
  positions: [
    { accountId: 'broker', accountName: 'Broker', instrumentCode: '7203', instrumentName: 'Toyota', currency: 'JPY', quantity: 10, costBasis: 25000, price: { id: 'p', priceDate: '2026-06-29', instrumentCode: '7203', instrumentName: 'Toyota', currency: 'JPY', unitPrice: 2800, sourceKind: 'EXCHANGE_CLOSE', provider: 'JPX', sourceDocumentId: null, sourceRow: null, observedAt: '2026-06-29T15:00:00Z' }, marketValue: 28000, unrealizedPnl: 3000 },
    { accountId: 'broker', accountName: 'Broker', instrumentCode: 'MISSING', instrumentName: 'No quote', currency: 'USD', quantity: 1, costBasis: 10, price: null, marketValue: null, unrealizedPnl: null },
  ],
  totalsByCurrency: [
    { currency: 'JPY', marketValue: 28000, costBasis: 25000, unrealizedPnl: 3000, valuedPositionCount: 1, missingPricePositionCount: 0 },
    { currency: 'USD', marketValue: 0, costBasis: 0, unrealizedPnl: 0, valuedPositionCount: 0, missingPricePositionCount: 1 },
  ],
  missingPriceInstrumentCodes: ['MISSING'],
}

describe('InvestmentValuationSummary', () => {
  it('shows valuation provenance and makes missing prices explicit', () => {
    render(<InvestmentValuationSummary valuation={valuation} />)
    expect(screen.getByLabelText('時点別ポートフォリオ評価')).toHaveTextContent('2026-06-29・JPX')
    expect(screen.getByText('JPY 28,000 評価額')).toBeInTheDocument()
    expect(screen.getAllByText('価格未確認').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/MISSING/).length).toBeGreaterThan(0)
  })
})
