import { describe, expect, it, vi } from 'vitest'
import { createInvestmentMarketPlatform } from './investmentMarketPlatform'

const price = {
  id: 'price-1', priceDate: '2026-06-30', instrumentCode: '7203', instrumentName: 'Toyota',
  currency: 'JPY', unitPrice: 2800, sourceKind: 'EXCHANGE_CLOSE', provider: 'JPX',
  sourceDocumentId: 'doc-1', sourceRow: 8, observedAt: '2026-06-30T15:30:00+09:00',
}

const valuation = {
  asOf: '2026-06-30', costBasisMethod: 'FIFO',
  positions: [{ accountId: 'broker', accountName: 'Broker', instrumentCode: '7203', instrumentName: 'Toyota', currency: 'JPY', quantity: 10, costBasis: 25000, price, marketValue: 28000, unrealizedPnl: 3000 }],
  totalsByCurrency: [{ currency: 'JPY', marketValue: 28000, costBasis: 25000, unrealizedPnl: 3000, valuedPositionCount: 1, missingPricePositionCount: 0 }],
  missingPriceInstrumentCodes: [],
}

describe('investment market platform boundary', () => {
  it('uses typed command envelopes and preserves price provenance', async () => {
    const invoke = vi.fn(async (command: string) => command === 'investment_market_prices_import' ? { importedPriceCount: 1 } : command === 'investment_market_prices_query' ? [price] : valuation)
    const platform = createInvestmentMarketPlatform(invoke)
    expect(await platform.importPrices({ householdId: 'home', prices: [] })).toEqual({ importedPriceCount: 1 })
    expect((await platform.queryPrices({ householdId: 'home', through: '2026-06-30' }))[0].provider).toBe('JPX')
    expect((await platform.queryValuation({ householdId: 'home', asOf: '2026-06-30' })).positions[0].price?.sourceRow).toBe(8)
    expect(invoke).toHaveBeenNthCalledWith(2, 'investment_market_prices_query', { request: { householdId: 'home', through: '2026-06-30' } })
  })

  it('rejects partial and non-finite valuations', async () => {
    const partial = { ...valuation, positions: [{ ...valuation.positions[0], price: null }] }
    await expect(createInvestmentMarketPlatform(async () => partial).queryValuation({ householdId: 'home', asOf: '2026-06-30' })).rejects.toThrow('completeness')
    const nonFinite = { ...valuation, totalsByCurrency: [{ ...valuation.totalsByCurrency[0], marketValue: Number.NaN }] }
    await expect(createInvestmentMarketPlatform(async () => nonFinite).queryValuation({ householdId: 'home', asOf: '2026-06-30' })).rejects.toThrow('marketValue')
    await expect(createInvestmentMarketPlatform(async () => ({ ...valuation, asOf: '2026-02-30' })).queryValuation({ householdId: 'home', asOf: '2026-02-28' })).rejects.toThrow('asOf')
  })
})
