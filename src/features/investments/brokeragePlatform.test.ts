import { describe, expect, it, vi } from 'vitest'

import type { BrokerageEventCandidate } from '../../ingestion'
import { createBrokeragePlatform, mapBrokerageEventsImport, type BrokerageInvoke } from './brokeragePlatform'

const candidate: BrokerageEventCandidate = {
  kind: 'brokerage-event', lineage: { sourceRow: 2, sourceRowEnd: 2, rawFields: [] }, eventType: 'BUY', tradeDate: '2026-07-01', settlementDate: '2026-07-03',
  instrumentCode: '7203', instrumentName: 'Toyota', accountType: '特定', currency: 'JPY', quantity: 10, unitPrice: 1000,
  grossAmount: 10000, feeAmount: 100, taxAmount: 0, settlementAmount: 10100,
  legs: [
    { kind: 'SECURITY', signedAmount: 10000, currency: 'JPY', description: 'Security' },
    { kind: 'CASH', signedAmount: -10100, currency: 'JPY', description: 'Cash' },
    { kind: 'INVESTMENT_EXPENSE', signedAmount: 100, currency: 'JPY', description: 'Fee' },
  ],
  reconciliationStatus: 'BALANCED', reconciliationDifference: 0, affectsHouseholdExpense: false, rawTransactionType: '買付',
}

describe('brokerage platform boundary', () => {
  it('maps balanced candidates with stable event and leg IDs', () => {
    const input = mapBrokerageEventsImport([candidate], { householdId: 'home', accountId: 'broker', sourceDocumentId: 'doc', idPrefix: 'batch' })
    expect(input.events[0]).toMatchObject({ id: 'batch-e-1', sourceRow: 2, affectsHouseholdExpense: false })
    expect(input.events[0].legs.map((leg) => leg.id)).toEqual(['batch-e-1-l-1', 'batch-e-1-l-2', 'batch-e-1-l-3'])
  })

  it('rejects an unbalanced candidate before native persistence', () => {
    const invalid = { ...candidate, legs: candidate.legs.slice(0, 2) }
    expect(() => mapBrokerageEventsImport([invalid], { householdId: 'home', accountId: 'broker', sourceDocumentId: 'doc', idPrefix: 'batch' })).toThrow('balance')
  })

  it('strictly validates native history responses', async () => {
    const event = { ...mapBrokerageEventsImport([candidate], { householdId: 'home', accountId: 'broker', sourceDocumentId: 'doc', idPrefix: 'batch' }).events[0], accountId: 'broker', accountName: 'Broker', sourceDocumentId: 'doc', corporateActionRatio: null, targetInstrumentCode: null, targetInstrumentName: null, targetCurrency: null, costBasisAllocationRatio: null, subscriptionAmount: null, cashInLieuAmount: null, cashInLieuQuantity: null, legs: [{ id: 'leg', lineNumber: 1, kind: 'CASH', signedAmount: 1, currency: 'JPY', description: 'Cash' }] }
    const invoke = vi.fn(async (command: string) => command === 'brokerage_events_import'
      ? { sourceDocumentId: 'doc', importedEventCount: 1, importedLegCount: 3 }
      : { events: [event], totalsByCurrency: [{ currency: 'JPY', buyGross: 10000, sellGross: 0, dividendGross: 0, fees: 100, taxes: 0, deposits: 0, withdrawals: 0, netCashMovement: -10100 }] }) as unknown as BrokerageInvoke
    const platform = createBrokeragePlatform(invoke)
    await expect(platform.importEvents({ householdId: 'home', accountId: 'broker', sourceDocumentId: 'doc', events: [] })).resolves.toMatchObject({ importedEventCount: 1 })
    await expect(platform.queryHistory({ householdId: 'home' })).resolves.toMatchObject({ totalsByCurrency: [{ buyGross: 10000 }] })
    expect(invoke).toHaveBeenLastCalledWith('brokerage_history_query', { request: { householdId: 'home' } })
  })

  it('rejects malformed performance facts from native code', async () => {
    const platform = createBrokeragePlatform(async () => ({ events: [], totalsByCurrency: [{ currency: 'JPY', buyGross: Number.NaN }] }))
    await expect(platform.queryHistory({ householdId: 'home' })).rejects.toThrow()
  })
})
