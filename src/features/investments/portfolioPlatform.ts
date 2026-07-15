import { invoke as tauriInvoke } from '@tauri-apps/api/core'

import type { PortfolioSnapshotCandidate } from '../../ingestion'

export interface PortfolioImportContext {
  readonly snapshotId: string
  readonly householdId: string
  readonly accountId: string
  readonly sourceDocumentId: string
}

export interface ImportPortfolioSnapshotDto {
  readonly id: string
  readonly householdId: string
  readonly accountId: string
  readonly sourceDocumentId: string
  readonly asOf: string
  readonly marketValueJpy: number
  readonly cashValueJpy: number
  readonly unrealizedPnlJpy: number | null
  readonly realizedPnlJpy: number | null
  readonly assetClasses: readonly { readonly id: string; readonly name: string; readonly marketValueJpy: number; readonly unrealizedPnlJpy: number | null; readonly sourceRow: number }[]
  readonly positions: readonly { readonly id: string; readonly productType: string; readonly accountType: string; readonly instrumentCode: string; readonly instrumentName: string; readonly quantity: number | null; readonly averageCost: number | null; readonly marketPrice: number | null; readonly marketValueJpy: number | null; readonly unrealizedPnlJpy: number | null; readonly realizedPnlJpy: number | null; readonly currency: string; readonly sourceRow: number }[]
  readonly fxRates: readonly { readonly id: string; readonly baseCurrency: string; readonly rate: number; readonly sourceRow: number }[]
}

export interface PortfolioSnapshotSummaryDto {
  readonly id: string; readonly accountId: string; readonly accountName: string; readonly sourceDocumentId: string
  readonly asOf: string; readonly marketValueJpy: number; readonly cashValueJpy: number
  readonly unrealizedPnlJpy: number | null; readonly realizedPnlJpy: number | null
  readonly positionCount: number; readonly fxRateCount: number
}

export interface PortfolioSnapshotDetailDto extends PortfolioSnapshotSummaryDto {
  readonly assetClasses: readonly { readonly id: string; readonly name: string; readonly marketValueJpy: number; readonly unrealizedPnlJpy: number | null; readonly sourceRow: number }[]
  readonly positions: readonly { readonly id: string; readonly productType: string; readonly accountType: string; readonly instrumentCode: string; readonly instrumentName: string; readonly quantity: number | null; readonly averageCost: number | null; readonly marketPrice: number | null; readonly marketValueJpy: number | null; readonly unrealizedPnlJpy: number | null; readonly realizedPnlJpy: number | null; readonly currency: string; readonly sourceRow: number }[]
  readonly fxRates: readonly { readonly id: string; readonly baseCurrency: string; readonly quoteCurrency: 'JPY'; readonly rate: number; readonly sourceRow: number }[]
}

export interface PortfolioSnapshotXlsxRequest {
  readonly householdId: string
  readonly snapshotId: string
}

export interface PortfolioSnapshotXlsxSavedDto {
  readonly fileName: string
  readonly rowCount: number
  readonly byteSize: number
}

export interface PortfolioSnapshotCsvSavedDto {
  readonly fileName: string
  readonly rowCount: number
  readonly byteSize: number
}

export interface PortfolioSnapshotPdfSavedDto {
  readonly fileName: string
  readonly pageCount: number
  readonly byteSize: number
}

export type PortfolioInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function mapPortfolioSnapshotImport(candidate: PortfolioSnapshotCandidate, context: PortfolioImportContext): ImportPortfolioSnapshotDto {
  if (!candidate.asOf) throw new TypeError('Portfolio snapshot timestamp is required')
  if (candidate.marketValueJpy == null || candidate.marketValueJpy < 0) throw new TypeError('Portfolio market value is required')
  const prefix = context.snapshotId.slice(0, 40)
  return {
    id: context.snapshotId, householdId: context.householdId, accountId: context.accountId,
    sourceDocumentId: context.sourceDocumentId, asOf: candidate.asOf,
    marketValueJpy: candidate.marketValueJpy, cashValueJpy: candidate.cashValueJpy ?? 0,
    unrealizedPnlJpy: candidate.unrealizedPnlJpy, realizedPnlJpy: candidate.realizedPnlJpy,
    assetClasses: candidate.assetClasses.map((item, index) => ({ id: `${prefix}-c-${index + 1}`, name: item.name, marketValueJpy: item.marketValueJpy, unrealizedPnlJpy: item.unrealizedPnlJpy, sourceRow: item.lineage.sourceRow })),
    positions: candidate.positions.map((item, index) => ({ id: `${prefix}-p-${index + 1}`, productType: item.productType, accountType: item.accountType, instrumentCode: item.instrumentCode, instrumentName: item.instrumentName, quantity: item.quantity, averageCost: item.averageCost, marketPrice: item.marketPrice, marketValueJpy: item.marketValueJpy, unrealizedPnlJpy: item.unrealizedPnlJpy, realizedPnlJpy: item.realizedPnlJpy, currency: item.currency, sourceRow: item.lineage.sourceRow })),
    fxRates: candidate.fxRates.map((item, index) => ({ id: `${prefix}-f-${index + 1}`, baseCurrency: item.baseCurrency, rate: item.rate, sourceRow: item.lineage.sourceRow })),
  }
}

export function createPortfolioPlatform(invoke: PortfolioInvoke = tauriInvoke) {
  return {
    importSnapshot: async (input: ImportPortfolioSnapshotDto): Promise<PortfolioSnapshotDetailDto> => parseDetail(await invoke('portfolio_snapshot_import', { input })),
    listSnapshots: async (householdId: string): Promise<readonly PortfolioSnapshotSummaryDto[]> => {
      const value = await invoke('portfolio_snapshots_list', { householdId })
      if (!Array.isArray(value)) throw new TypeError('portfolio snapshots')
      return value.map(parseSummary)
    },
    getSnapshot: async (householdId: string, snapshotId: string): Promise<PortfolioSnapshotDetailDto> => parseDetail(await invoke('portfolio_snapshot_get', { householdId, snapshotId })),
    saveSnapshotCsv: async (request: PortfolioSnapshotXlsxRequest): Promise<PortfolioSnapshotCsvSavedDto | null> => {
      const value = await invoke('portfolio_snapshot_csv_save', { request })
      return value === null ? null : parseSnapshotCsvSaved(value)
    },
    saveSnapshotXlsx: async (request: PortfolioSnapshotXlsxRequest): Promise<PortfolioSnapshotXlsxSavedDto | null> => {
      const value = await invoke('portfolio_snapshot_xlsx_save', { request })
      return value === null ? null : parseSnapshotXlsxSaved(value)
    },
    saveSnapshotPdf: async (request: PortfolioSnapshotXlsxRequest): Promise<PortfolioSnapshotPdfSavedDto | null> => {
      const value = await invoke('portfolio_snapshot_pdf_save', { request })
      return value === null ? null : parseSnapshotPdfSaved(value)
    },
  }
}

function parseSnapshotCsvSaved(value: unknown): PortfolioSnapshotCsvSavedDto {
  const item = record(value)
  if (typeof item.fileName !== 'string' || !Number.isSafeInteger(item.rowCount) || !Number.isSafeInteger(item.byteSize)) throw new TypeError('portfolio snapshot CSV summary')
  const fileName = item.fileName
  if (fileName.length === 0 || fileName.length > 255 || !/\.csv$/i.test(fileName) || /[\\/]/.test(fileName) || Array.from(fileName).some((character) => character.charCodeAt(0) < 32)) throw new TypeError('portfolio snapshot CSV filename')
  if ((item.rowCount as number) <= 0 || (item.byteSize as number) <= 0) throw new TypeError('portfolio snapshot CSV summary')
  return item as unknown as PortfolioSnapshotCsvSavedDto
}

function parseSnapshotXlsxSaved(value: unknown): PortfolioSnapshotXlsxSavedDto {
  const item = record(value)
  if (typeof item.fileName !== 'string' || !Number.isSafeInteger(item.rowCount) || !Number.isSafeInteger(item.byteSize)) throw new TypeError('portfolio snapshot XLSX summary')
  const fileName = item.fileName
  if (fileName.length === 0 || fileName.length > 255 || !/\.xlsx$/i.test(fileName) || /[\\/]/.test(fileName) || Array.from(fileName).some((character) => character.charCodeAt(0) < 32)) throw new TypeError('portfolio snapshot XLSX filename')
  if ((item.rowCount as number) <= 0 || (item.byteSize as number) <= 0) throw new TypeError('portfolio snapshot XLSX summary')
  return item as unknown as PortfolioSnapshotXlsxSavedDto
}

function parseSnapshotPdfSaved(value: unknown): PortfolioSnapshotPdfSavedDto {
  const item = record(value)
  if (typeof item.fileName !== 'string' || !Number.isSafeInteger(item.pageCount) || !Number.isSafeInteger(item.byteSize)) throw new TypeError('portfolio snapshot PDF summary')
  const fileName = item.fileName
  if (fileName.length === 0 || fileName.length > 255 || !/\.pdf$/i.test(fileName) || /[\\/]/.test(fileName) || Array.from(fileName).some((character) => character.charCodeAt(0) < 32)) throw new TypeError('portfolio snapshot PDF filename')
  if ((item.pageCount as number) <= 0 || (item.byteSize as number) <= 0) throw new TypeError('portfolio snapshot PDF summary')
  return item as unknown as PortfolioSnapshotPdfSavedDto
}

function parseSummary(value: unknown): PortfolioSnapshotSummaryDto {
  const item = record(value)
  for (const key of ['id', 'accountId', 'accountName', 'sourceDocumentId', 'asOf']) if (typeof item[key] !== 'string') throw new TypeError('portfolio summary')
  for (const key of ['marketValueJpy', 'cashValueJpy', 'positionCount', 'fxRateCount']) if (!Number.isSafeInteger(item[key])) throw new TypeError('portfolio summary')
  for (const key of ['unrealizedPnlJpy', 'realizedPnlJpy']) if (item[key] !== null && !Number.isSafeInteger(item[key])) throw new TypeError('portfolio summary')
  return item as unknown as PortfolioSnapshotSummaryDto
}

function parseDetail(value: unknown): PortfolioSnapshotDetailDto {
  const item = record(value); const summary = parseSummary(item)
  if (!Array.isArray(item.assetClasses) || !Array.isArray(item.positions) || !Array.isArray(item.fxRates)) throw new TypeError('portfolio detail')
  return { ...summary, assetClasses: item.assetClasses as PortfolioSnapshotDetailDto['assetClasses'], positions: item.positions as PortfolioSnapshotDetailDto['positions'], fxRates: item.fxRates as PortfolioSnapshotDetailDto['fxRates'] }
}

function record(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('portfolio response')
  return value as Record<string, unknown>
}
