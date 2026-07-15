import { describe, expect, it, vi } from 'vitest'

import { deleteRecurringSeriesPreference, listRecurringSeriesPreferences, parseFinancialIntelligence, queryFinancialIntelligence, upsertRecurringSeriesPreference } from './platform'

const response = {
  asOf: '2026-07-31',
  historyFrom: '2025-07-30',
  recurringItems: [{
    normalizedPayee: 'netflix', displayPayee: 'Netflix', occurrenceCount: 6,
    cadence: 'MONTHLY', medianIntervalDays: 30, typicalAmountJpy: 1490,
    latestAmountJpy: 1590, lastSeenOn: '2026-07-20', nextExpectedOn: '2026-08-20',
    confidenceBps: 9500, priceChangeBps: 671,
    reasons: ['5 of 5 intervals match a monthly cadence'],
    decisionStatus: 'CONFIRMED',
  }],
  ignoredRecurringItems: [{
    normalizedPayee: 'gym', displayPayee: 'Gym', occurrenceCount: 8,
    cadence: 'MONTHLY', medianIntervalDays: 30, typicalAmountJpy: 8000,
    latestAmountJpy: 8000, lastSeenOn: '2026-07-10', nextExpectedOn: '2026-08-10',
    confidenceBps: 9000, priceChangeBps: null, reasons: ['monthly cadence'], decisionStatus: 'IGNORED',
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
    await expect(queryFinancialIntelligence(invoke, { householdId: 'family', accountGroupId: 'daily', attributionScope: { kind: 'HOUSEHOLD_COMMON' }, asOf: '2026-07-31' }))
      .resolves.toEqual(response)
    expect(invoke).toHaveBeenCalledWith('financial_intelligence_query', {
      request: { householdId: 'family', accountGroupId: 'daily', attributionScope: { kind: 'HOUSEHOLD_COMMON' }, asOf: '2026-07-31' },
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

  it('parses decision statuses and rejects unknown status values', () => {
    expect(parseFinancialIntelligence(response).ignoredRecurringItems[0].decisionStatus).toBe('IGNORED')
    expect(() => parseFinancialIntelligence({
      ...response,
      recurringItems: [{ ...response.recurringItems[0], decisionStatus: 'PENDING' }],
    })).toThrow('decisionStatus')
  })

  it('uses exact preference commands and optimistic versions', async () => {
    const preference = { householdId: 'family', normalizedPayee: 'netflix', decision: 'CONFIRMED', version: 2, createdAt: '2026-07-14T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z' }
    const invoke = vi.fn()
      .mockResolvedValueOnce([preference])
      .mockResolvedValueOnce({ ...preference, decision: 'IGNORED', version: 3 })
      .mockResolvedValueOnce(null)

    await expect(listRecurringSeriesPreferences(invoke, 'family')).resolves.toEqual([preference])
    await expect(upsertRecurringSeriesPreference(invoke, { householdId: 'family', normalizedPayee: 'netflix', decision: 'IGNORED', expectedVersion: 2 })).resolves.toMatchObject({ decision: 'IGNORED', version: 3 })
    await expect(deleteRecurringSeriesPreference(invoke, { householdId: 'family', normalizedPayee: 'netflix', expectedVersion: 3 })).resolves.toBeUndefined()
    expect(invoke.mock.calls).toEqual([
      ['recurring_series_preferences_list', { householdId: 'family' }],
      ['recurring_series_preference_upsert', { input: { householdId: 'family', normalizedPayee: 'netflix', decision: 'IGNORED', expectedVersion: 2 } }],
      ['recurring_series_preference_delete', { input: { householdId: 'family', normalizedPayee: 'netflix', expectedVersion: 3 } }],
    ])
  })

  it('rejects malformed preference decisions and versions', async () => {
    const base = { householdId: 'family', normalizedPayee: 'netflix', decision: 'CONFIRMED', version: 1, createdAt: 'created', updatedAt: 'updated' }
    await expect(listRecurringSeriesPreferences(vi.fn().mockResolvedValue([{ ...base, decision: 'AUTO_DETECTED' }]), 'family')).rejects.toThrow('decision')
    await expect(listRecurringSeriesPreferences(vi.fn().mockResolvedValue([{ ...base, version: 0 }]), 'family')).rejects.toThrow('version')
  })
})
