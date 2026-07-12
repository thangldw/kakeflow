import { describe, expect, it, vi } from 'vitest'

import type { PortfolioSnapshotCandidate } from '../../ingestion'
import { createPortfolioPlatform, mapPortfolioSnapshotImport } from './portfolioPlatform'
import type { PortfolioInvoke } from './portfolioPlatform'

const candidate: PortfolioSnapshotCandidate = {
  kind: 'portfolio-snapshot', lineage: { sourceRow: 2, sourceRowEnd: 12, rawFields: [] }, asOf: '2026-07-12T14:47:56+09:00', accountHint: 'Broker',
  marketValueJpy: 500_000, cashValueJpy: 100_000, unrealizedPnlJpy: 25_000, realizedPnlJpy: null,
  assetClasses: [{ lineage: { sourceRow: 3, sourceRowEnd: 3, rawFields: [] }, name: '株式', marketValueJpy: 400_000, unrealizedPnlJpy: 25_000 }],
  positions: [{ kind: 'position-snapshot', lineage: { sourceRow: 8, sourceRowEnd: 8, rawFields: [] }, productType: '米国株式', accountType: 'NISA', instrumentCode: 'AAPL', instrumentName: 'Apple', quantity: 10, averageCost: 180, marketPrice: 200, marketValueJpy: 400_000, unrealizedPnlJpy: 25_000, realizedPnlJpy: null, currency: 'USD' }],
  fxRates: [{ kind: 'fx-rate-snapshot', lineage: { sourceRow: 12, sourceRowEnd: 12, rawFields: [] }, baseCurrency: 'USD', quoteCurrency: 'JPY', rate: 150.25 }],
}

describe('portfolio platform boundary', () => {
  it('maps parsed candidates into the atomic desktop import request', () => {
    const mapped = mapPortfolioSnapshotImport(candidate, { snapshotId: 'snap-1', householdId: 'home', accountId: 'broker', sourceDocumentId: 'doc-1' })
    expect(mapped).toMatchObject({ id: 'snap-1', householdId: 'home', accountId: 'broker', marketValueJpy: 500000 })
    expect(mapped.positions[0]).toMatchObject({ id: 'snap-1-p-1', instrumentCode: 'AAPL', sourceRow: 8 })
    expect(mapped.fxRates[0]).toMatchObject({ id: 'snap-1-f-1', baseCurrency: 'USD', rate: 150.25 })
  })

  it('invokes list/get/import commands and validates summary responses', async () => {
    const summary = { id: 'snap-1', accountId: 'broker', accountName: 'Broker', sourceDocumentId: 'doc-1', asOf: '2026-07-12T14:47:56+09:00', marketValueJpy: 500000, cashValueJpy: 100000, unrealizedPnlJpy: 25000, realizedPnlJpy: null, positionCount: 1, fxRateCount: 1 }
    const detail = { ...summary, assetClasses: [], positions: [], fxRates: [] }
    const invoke = vi.fn(async (command: string) => command === 'portfolio_snapshots_list' ? [summary] : detail) as unknown as PortfolioInvoke
    const platform = createPortfolioPlatform(invoke)
    await expect(platform.listSnapshots('home')).resolves.toEqual([summary])
    await expect(platform.getSnapshot('home', 'snap-1')).resolves.toEqual(detail)
    await expect(platform.importSnapshot(mapPortfolioSnapshotImport(candidate, { snapshotId: 'snap-1', householdId: 'home', accountId: 'broker', sourceDocumentId: 'doc-1' }))).resolves.toEqual(detail)
    expect(invoke).toHaveBeenNthCalledWith(1, 'portfolio_snapshots_list', { householdId: 'home' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'portfolio_snapshot_get', { householdId: 'home', snapshotId: 'snap-1' })
  })

  it('rejects snapshots without a reliable total or timestamp', () => {
    expect(() => mapPortfolioSnapshotImport({ ...candidate, asOf: null }, { snapshotId: 'x', householdId: 'h', accountId: 'a', sourceDocumentId: 'd' })).toThrow()
    expect(() => mapPortfolioSnapshotImport({ ...candidate, marketValueJpy: null }, { snapshotId: 'x', householdId: 'h', accountId: 'a', sourceDocumentId: 'd' })).toThrow()
  })
})
