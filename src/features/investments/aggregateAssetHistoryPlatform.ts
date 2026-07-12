import { invoke as tauriInvoke } from '@tauri-apps/api/core'

import type { AggregateAssetClass, AggregateAssetSnapshotCandidate } from '../../ingestion'

export interface ImportAggregateAssetSnapshotInputDto {
  readonly id: string
  readonly householdId: string
  readonly sourceDocumentId: string
  readonly sourceRow: number
  readonly asOf: string
  readonly totalAssetsJpy: number
  readonly components: readonly AggregateAssetComponentDto[]
}

export interface AggregateAssetComponentDto {
  readonly assetClass: AggregateAssetClass
  readonly officialHeader: string
  readonly valueJpy: number
}

export type AggregateAssetSnapshotDto = ImportAggregateAssetSnapshotInputDto

export interface ImportAggregateAssetSnapshotResultDto {
  readonly reusedExisting: boolean
  readonly snapshot: AggregateAssetSnapshotDto
}

export interface ImportAggregateAssetHistoryInputDto {
  readonly householdId: string
  readonly snapshots: readonly ImportAggregateAssetSnapshotInputDto[]
}

export interface ImportAggregateAssetHistoryResultDto {
  readonly createdCount: number
  readonly reusedCount: number
  readonly snapshots: readonly AggregateAssetSnapshotDto[]
}

export interface ListAggregateAssetHistoryInputDto {
  readonly householdId: string
  readonly dateFrom?: string | null
  readonly dateTo?: string | null
  readonly limit?: number | null
}

export interface AggregateAssetImportContext {
  readonly id: string
  readonly householdId: string
  readonly sourceDocumentId: string
}

export type AggregateAssetHistoryInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

const ASSET_CLASSES: readonly AggregateAssetClass[] = ['DEPOSITS_CASH_CRYPTO', 'LISTED_STOCKS', 'INVESTMENT_TRUSTS', 'BONDS', 'FX', 'INSURANCE', 'REAL_ESTATE', 'PENSIONS', 'POINTS', 'OTHER_ASSETS']
const OFFICIAL_HEADERS: Record<AggregateAssetClass, string> = {
  DEPOSITS_CASH_CRYPTO: '預金・現金・暗号資産(円)', LISTED_STOCKS: '株式(現物)(円)', INVESTMENT_TRUSTS: '投資信託(円)', BONDS: '債券(円)', FX: 'FX(円)', INSURANCE: '保険(円)', REAL_ESTATE: '不動産(円)', PENSIONS: '年金(円)', POINTS: 'ポイント(円)', OTHER_ASSETS: 'その他の資産(円)',
}

export function mapAggregateAssetSnapshotImport(candidate: AggregateAssetSnapshotCandidate, context: AggregateAssetImportContext): ImportAggregateAssetSnapshotInputDto {
  return parseSnapshot({
    ...context,
    sourceRow: candidate.lineage.sourceRow,
    asOf: candidate.asOf,
    totalAssetsJpy: candidate.totalAssetsJpy,
    components: candidate.assetClasses.map(({ assetClass, officialHeader, valueJpy }) => ({ assetClass, officialHeader, valueJpy })),
  })
}

export function createAggregateAssetHistoryPlatform(invoke: AggregateAssetHistoryInvoke = tauriInvoke) {
  return {
    importSnapshot: async (input: ImportAggregateAssetSnapshotInputDto): Promise<ImportAggregateAssetSnapshotResultDto> => {
      const validated = parseSnapshot(input)
      const item = record(await invoke('aggregate_asset_snapshot_import', { input: validated }), 'aggregate asset import')
      if (typeof item.reusedExisting !== 'boolean') throw new TypeError('aggregate asset import')
      return { reusedExisting: item.reusedExisting, snapshot: parseSnapshot(item.snapshot) }
    },
    importHistory: async (input: ImportAggregateAssetHistoryInputDto): Promise<ImportAggregateAssetHistoryResultDto> => {
      const householdId = nonEmptyString(input.householdId, 'aggregate asset batch household')
      const snapshotsInput = input.snapshots.map(parseSnapshot)
      if (snapshotsInput.length === 0 || snapshotsInput.length > 1_200 || snapshotsInput.some((snapshot) => snapshot.householdId !== householdId)) throw new TypeError('aggregate asset history import')
      if (new Set(snapshotsInput.map((snapshot) => snapshot.asOf)).size !== snapshotsInput.length || new Set(snapshotsInput.map((snapshot) => `${snapshot.sourceDocumentId}:${snapshot.sourceRow}`)).size !== snapshotsInput.length) throw new TypeError('aggregate asset history import')
      const validatedInput = { householdId, snapshots: snapshotsInput }
      const item = record(await invoke('aggregate_asset_history_import', { input: validatedInput }), 'aggregate asset history import')
      const createdCount = nonNegativeInteger(item.createdCount, 'aggregate asset created count')
      const reusedCount = nonNegativeInteger(item.reusedCount, 'aggregate asset reused count')
      const snapshots = array(item.snapshots, 'aggregate asset imported snapshots').map(parseSnapshot)
      if (createdCount + reusedCount !== snapshots.length || snapshots.length !== snapshotsInput.length || snapshots.some((snapshot) => snapshot.householdId !== householdId)) throw new TypeError('aggregate asset history import')
      return { createdCount, reusedCount, snapshots }
    },
    listHistory: async (request: ListAggregateAssetHistoryInputDto): Promise<readonly AggregateAssetSnapshotDto[]> => {
      nonEmptyString(request.householdId, 'aggregate asset household')
      if (request.dateFrom != null) isoDate(request.dateFrom, 'aggregate asset date from')
      if (request.dateTo != null) isoDate(request.dateTo, 'aggregate asset date to')
      if (request.dateFrom && request.dateTo && request.dateFrom > request.dateTo) throw new TypeError('aggregate asset date range')
      if (request.limit != null && (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1_200)) throw new TypeError('aggregate asset limit')
      const value = await invoke('aggregate_asset_history_list', { request })
      if (!Array.isArray(value)) throw new TypeError('aggregate asset history')
      const snapshots = value.map(parseSnapshot)
      if (new Set(snapshots.map((snapshot) => snapshot.id)).size !== snapshots.length || new Set(snapshots.map((snapshot) => snapshot.asOf)).size !== snapshots.length || snapshots.some((snapshot, index) => index > 0 && snapshot.asOf > snapshots[index - 1].asOf)) throw new TypeError('aggregate asset history order')
      return snapshots
    },
  }
}

function parseSnapshot(value: unknown): AggregateAssetSnapshotDto {
  const item = record(value, 'aggregate asset snapshot')
  const components = array(item.components, 'aggregate asset components').map((value) => {
    const component = record(value, 'aggregate asset component')
    if (!ASSET_CLASSES.includes(component.assetClass as AggregateAssetClass)) throw new TypeError('aggregate asset class')
    const assetClass = component.assetClass as AggregateAssetClass
    const officialHeader = nonEmptyString(component.officialHeader, 'aggregate asset header')
    if (officialHeader !== OFFICIAL_HEADERS[assetClass]) throw new TypeError('aggregate asset header')
    return {
      assetClass,
      officialHeader,
      valueJpy: nonNegativeInteger(component.valueJpy, 'aggregate asset component value'),
    }
  })
  if (new Set(components.map((component) => component.assetClass)).size !== components.length) throw new TypeError('aggregate asset components')
  return {
    id: nonEmptyString(item.id, 'aggregate asset id'),
    householdId: nonEmptyString(item.householdId, 'aggregate asset household'),
    sourceDocumentId: nonEmptyString(item.sourceDocumentId, 'aggregate asset source'),
    sourceRow: positiveInteger(item.sourceRow, 'aggregate asset source row'),
    asOf: isoDate(item.asOf, 'aggregate asset date'),
    totalAssetsJpy: nonNegativeInteger(item.totalAssetsJpy, 'aggregate asset total'),
    components,
  }
}

function record(value: unknown, label: string): Record<string, unknown> { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label); return value as Record<string, unknown> }
function array(value: unknown, label: string): readonly unknown[] { if (!Array.isArray(value)) throw new TypeError(label); return value }
function nonEmptyString(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim()) throw new TypeError(label); return value }
function nonNegativeInteger(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(label); return value as number }
function positiveInteger(value: unknown, label: string): number { const result = nonNegativeInteger(value, label); if (result === 0) throw new TypeError(label); return result }
function isoDate(value: unknown, label: string): string { const result = nonEmptyString(value, label); if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(result) || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) throw new TypeError(label); return result }
