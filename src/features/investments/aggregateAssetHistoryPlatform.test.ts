import { describe, expect, it, vi } from 'vitest'

import type { AggregateAssetSnapshotCandidate } from '../../ingestion'
import { createAggregateAssetHistoryPlatform, mapAggregateAssetSnapshotImport } from './aggregateAssetHistoryPlatform'

const candidate: AggregateAssetSnapshotCandidate = {
  kind: 'aggregate-asset-snapshot', asOf: '2026-07-31', totalAssetsJpy: 8_700_000,
  lineage: { sourceRow: 3, sourceRowEnd: 3, rawFields: ['2026/07/31', '8700000'] },
  assetClasses: [{ assetClass: 'DEPOSITS_CASH_CRYPTO', officialHeader: '預金・現金・暗号資産(円)', valueJpy: 2_100_000 }],
}

describe('aggregate asset history platform', () => {
  it('maps source lineage without inventing an account or ledger transaction', () => {
    expect(mapAggregateAssetSnapshotImport(candidate, { id: 'snapshot-1', householdId: 'family', sourceDocumentId: 'document-1' })).toEqual({
      id: 'snapshot-1', householdId: 'family', sourceDocumentId: 'document-1', sourceRow: 3,
      asOf: '2026-07-31', totalAssetsJpy: 8_700_000,
      components: [{ assetClass: 'DEPOSITS_CASH_CRYPTO', officialHeader: '預金・現金・暗号資産(円)', valueJpy: 2_100_000 }],
    })
  })

  it('forwards import/list commands and validates history ordering', async () => {
    const snapshot = mapAggregateAssetSnapshotImport(candidate, { id: 'snapshot-1', householdId: 'family', sourceDocumentId: 'document-1' })
    const invoke = vi.fn(async (command: string) => command === 'aggregate_asset_snapshot_import' ? { reusedExisting: false, snapshot } : command === 'aggregate_asset_history_import' ? { createdCount: 1, reusedCount: 0, snapshots: [snapshot] } : [snapshot, { ...snapshot, id: 'older', asOf: '2026-06-30' }])
    const platform = createAggregateAssetHistoryPlatform(invoke)
    await expect(platform.importSnapshot(snapshot)).resolves.toEqual({ reusedExisting: false, snapshot })
    await expect(platform.importHistory({ householdId: 'family', snapshots: [snapshot] })).resolves.toEqual({ createdCount: 1, reusedCount: 0, snapshots: [snapshot] })
    await expect(platform.listHistory({ householdId: 'family', dateFrom: '2026-01-01', dateTo: '2026-12-31', limit: 240 })).resolves.toHaveLength(2)
    expect(invoke).toHaveBeenNthCalledWith(1, 'aggregate_asset_snapshot_import', { input: snapshot })
    expect(invoke).toHaveBeenNthCalledWith(2, 'aggregate_asset_history_import', { input: { householdId: 'family', snapshots: [snapshot] } })
    expect(invoke).toHaveBeenNthCalledWith(3, 'aggregate_asset_history_list', { request: { householdId: 'family', dateFrom: '2026-01-01', dateTo: '2026-12-31', limit: 240 } })
  })

  it('rejects duplicate classes, invalid dates and ascending history', async () => {
    expect(() => mapAggregateAssetSnapshotImport({ ...candidate, asOf: '2026-02-30' }, { id: 'id', householdId: 'family', sourceDocumentId: 'doc' })).toThrow('date')
    expect(() => mapAggregateAssetSnapshotImport({ ...candidate, asOf: '0000-01-01' }, { id: 'id', householdId: 'family', sourceDocumentId: 'doc' })).toThrow('date')
    expect(() => mapAggregateAssetSnapshotImport({ ...candidate, assetClasses: [candidate.assetClasses[0], candidate.assetClasses[0]] }, { id: 'id', householdId: 'family', sourceDocumentId: 'doc' })).toThrow('components')
    expect(() => mapAggregateAssetSnapshotImport({ ...candidate, assetClasses: [{ ...candidate.assetClasses[0], officialHeader: '株式(現物)(円)' }] }, { id: 'id', householdId: 'family', sourceDocumentId: 'doc' })).toThrow('header')
    const snapshot = mapAggregateAssetSnapshotImport(candidate, { id: 'snapshot-1', householdId: 'family', sourceDocumentId: 'document-1' })
    const invoke = vi.fn(async () => [{ ...snapshot, asOf: '2026-06-30' }, snapshot])
    await expect(createAggregateAssetHistoryPlatform(invoke).listHistory({ householdId: 'family' })).rejects.toThrow('order')
  })
})
