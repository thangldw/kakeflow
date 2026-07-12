import { describe, expect, it, vi } from 'vitest'

import {
  createInvestmentPerformancePlatform,
  type InvestmentPerformanceInvoke,
} from './investmentPerformancePlatform'

const allocation = {
  sellEventId: 'sell', buyEventId: 'buy', accountId: 'broker', instrumentCode: 'ABC', instrumentName: 'Acme', currency: 'JPY',
  soldOn: '2026-03-01', acquiredOn: '2026-01-01', quantity: 1, allocatedCostBasis: 100, allocatedNetProceeds: 150, realizedPnl: 50,
  buySourceDocumentId: 'doc-buy', buySourceRow: 1, sellSourceDocumentId: 'doc-sell', sellSourceRow: 2,
}

describe('investment performance platform boundary', () => {
  it('queries and validates FIFO holdings with auditable event IDs', async () => {
    const invoke = vi.fn(async () => ({
      asOf: '2026-12-31', costBasisMethod: 'FIFO',
      positions: [{ accountId: 'broker', accountName: 'Broker', instrumentCode: 'ABC', instrumentName: 'Acme', currency: 'JPY', quantity: 2, costBasis: 200, averageCost: 100, openLotCount: 1, sourceBuyEventIds: ['buy'] }],
      openLots: [{ buyEventId: 'buy', accountId: 'broker', instrumentCode: 'ABC', instrumentName: 'Acme', currency: 'JPY', acquiredOn: '2026-01-01', originalQuantity: 3, remainingQuantity: 2, unitCost: 100, remainingCostBasis: 200, sourceDocumentId: 'doc-buy', sourceRow: 1 }],
      realizedAllocations: [allocation], uncoveredSales: [], skippedEventIds: [], corporateActionEventIds: ['split'],
    })) as unknown as InvestmentPerformanceInvoke
    const platform = createInvestmentPerformancePlatform(invoke)
    const result = await platform.queryHoldings({ householdId: 'home', accountId: 'broker', asOf: '2026-12-31' })
    expect(invoke).toHaveBeenCalledWith('investment_holdings_query', { request: { householdId: 'home', accountId: 'broker', asOf: '2026-12-31' } })
    expect(result.realizedAllocations[0].buySourceDocumentId).toBe('doc-buy')
  })

  it('keeps independent native-currency performance totals', async () => {
    const invoke = vi.fn(async () => ({
      dateFrom: '2026-01-01', dateTo: '2026-12-31', costBasisMethod: 'FIFO',
      totalsByCurrency: [
        { currency: 'JPY', buyGross: 100, sellGross: 150, realizedPnl: 50, dividendGross: 0, fees: 0, taxes: 0 },
        { currency: 'USD', buyGross: 0, sellGross: 0, realizedPnl: 0, dividendGross: 10, fees: 1, taxes: 2 },
      ], realizedAllocations: [allocation], uncoveredSales: [], skippedEventIds: [], corporateActionEventIds: [],
    })) as unknown as InvestmentPerformanceInvoke
    const result = await createInvestmentPerformancePlatform(invoke).queryPerformance({ householdId: 'home', dateFrom: '2026-01-01', dateTo: '2026-12-31' })
    expect(result.totalsByCurrency.map((item) => item.currency)).toEqual(['JPY', 'USD'])
  })

  it('rejects malformed native responses instead of coercing them', async () => {
    const invoke = vi.fn(async () => ({ asOf: '2026-12-31', costBasisMethod: 'AVERAGE', positions: [], openLots: [], realizedAllocations: [], uncoveredSales: [], skippedEventIds: [], corporateActionEventIds: [] })) as unknown as InvestmentPerformanceInvoke
    await expect(createInvestmentPerformancePlatform(invoke).queryHoldings({ householdId: 'home', asOf: '2026-12-31' })).rejects.toThrow('costBasisMethod')
  })
})
