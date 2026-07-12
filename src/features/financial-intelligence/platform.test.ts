import { describe, expect, it, vi } from 'vitest'

import { parseFinancialIntelligence, queryFinancialIntelligence } from './platform'

const response = {
  asOf: '2026-07-31',
  historyFrom: '2025-07-30',
  recurringItems: [{
    normalizedPayee: 'netflix', displayPayee: 'Netflix', occurrenceCount: 6,
    cadence: 'MONTHLY', medianIntervalDays: 30, typicalAmountJpy: 1490,
    latestAmountJpy: 1590, lastSeenOn: '2026-07-20', nextExpectedOn: '2026-08-20',
    confidenceBps: 9500, priceChangeBps: 671,
    reasons: ['5 of 5 intervals match a monthly cadence'],
  }],
  anomalies: [{
    transactionId: 'spike', occurredOn: '2026-07-20', normalizedPayee: 'market',
    displayPayee: 'Market', amountJpy: 15000, baselineAmountJpy: 5000,
    baselineSampleCount: 4, scoreBps: 10000, reasons: ['Amount is 300% of the median'],
  }],
}

describe('financial intelligence platform boundary', () => {
  it('invokes the derived analytics command and validates the response', async () => {
    const invoke = vi.fn().mockResolvedValue(response)
    await expect(queryFinancialIntelligence(invoke, { householdId: 'family', accountGroupId: 'daily', asOf: '2026-07-31' }))
      .resolves.toEqual(response)
    expect(invoke).toHaveBeenCalledWith('financial_intelligence_query', {
      request: { householdId: 'family', accountGroupId: 'daily', asOf: '2026-07-31' },
    })
  })

  it('rejects impossible confidence and malformed dates at the boundary', () => {
    expect(() => parseFinancialIntelligence({ ...response, asOf: '31/07/2026' })).toThrow('asOf')
    expect(() => parseFinancialIntelligence({
      ...response,
      recurringItems: [{ ...response.recurringItems[0], confidenceBps: 10001 }],
    })).toThrow('confidenceBps')
  })

  it('rejects sparse baseline claims from the service', () => {
    expect(() => parseFinancialIntelligence({
      ...response,
      anomalies: [{ ...response.anomalies[0], baselineSampleCount: 2 }],
    })).toThrow('baselineSampleCount')
  })
})
