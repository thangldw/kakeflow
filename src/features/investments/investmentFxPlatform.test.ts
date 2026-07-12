import { describe, expect, it, vi } from 'vitest'
import { createInvestmentFxPlatform, type InvestmentFxInvoke } from './investmentFxPlatform'

describe('investment FX platform boundary', () => {
  it('keeps original totals and validates auditable conversions', async () => {
    const invoke = vi.fn(async () => ({
      dateFrom: null, dateTo: '2026-12-31', fxAsOf: '2026-12-31',
      originalTotalsByCurrency: [{ currency: 'USD', buyGross: 10, sellGross: 0, realizedPnl: 0, dividendGross: 0, fees: 0, taxes: 0 }],
      convertedTotals: { currency: 'JPY', buyGross: 1500, sellGross: 0, realizedPnl: 0, dividendGross: 0, fees: 0, taxes: 0 },
      conversions: [{ originalCurrency: 'USD', reportingCurrency: 'JPY', rate: 150, rateId: 'fx-1', rateDate: '2026-12-30', inverted: false, sourceKind: 'OFFICIAL_REFERENCE', provider: 'BOJ', sourceDocumentId: null, sourceRow: null }],
    })) as unknown as InvestmentFxInvoke
    const result = await createInvestmentFxPlatform(invoke).queryReporting({ householdId: 'home', reportingCurrency: 'JPY', fxAsOf: '2026-12-31' })
    expect(result.originalTotalsByCurrency[0]).toMatchObject({ currency: 'USD', buyGross: 10 })
    expect(result.convertedTotals.buyGross).toBe(1500)
    expect(result.conversions[0]).toMatchObject({ rateId: 'fx-1', provider: 'BOJ' })
  })

  it('rejects malformed conversion rates', async () => {
    const invoke = async () => ({ dateFrom: null, dateTo: null, fxAsOf: '2026-12-31', originalTotalsByCurrency: [], convertedTotals: { currency: 'JPY', buyGross: 0, sellGross: 0, realizedPnl: 0, dividendGross: 0, fees: 0, taxes: 0 }, conversions: [{ originalCurrency: 'USD', reportingCurrency: 'JPY', rate: Number.NaN, rateId: 'fx', rateDate: '2026-12-31', inverted: false, sourceKind: 'MANUAL', provider: 'user', sourceDocumentId: null, sourceRow: null }] })
    await expect(createInvestmentFxPlatform(invoke).queryReporting({ householdId: 'home', reportingCurrency: 'JPY', fxAsOf: '2026-12-31' })).rejects.toThrow('rate')
  })
})
