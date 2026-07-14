import { invoke as tauriInvoke } from '@tauri-apps/api/core'

export type InvestmentCostBasisMethod = 'FIFO'

export interface InvestmentHoldingsRequest {
  readonly householdId: string
  readonly accountId?: string
  readonly asOf: string
}

export interface InvestmentPerformanceRequest {
  readonly householdId: string
  readonly accountId?: string
  readonly dateFrom?: string
  readonly dateTo?: string
}

export interface InvestmentPositionDto {
  readonly accountId: string
  readonly accountName: string
  readonly instrumentCode: string
  readonly instrumentName: string
  readonly currency: string
  readonly quantity: number
  readonly costBasis: number
  readonly averageCost: number
  readonly openLotCount: number
  readonly sourceBuyEventIds: readonly string[]
}

export interface InvestmentLotDto {
  readonly buyEventId: string
  readonly accountId: string
  readonly instrumentCode: string
  readonly instrumentName: string
  readonly currency: string
  readonly acquiredOn: string
  readonly originalQuantity: number
  readonly remainingQuantity: number
  readonly unitCost: number
  readonly remainingCostBasis: number
  readonly sourceDocumentId: string
  readonly sourceRow: number
}

export interface RealizedAllocationDto {
  readonly sellEventId: string
  readonly buyEventId: string
  readonly accountId: string
  readonly instrumentCode: string
  readonly instrumentName: string
  readonly currency: string
  readonly soldOn: string
  readonly acquiredOn: string
  readonly quantity: number
  readonly allocatedCostBasis: number
  readonly allocatedNetProceeds: number
  readonly realizedPnl: number
  readonly buySourceDocumentId: string
  readonly buySourceRow: number
  readonly sellSourceDocumentId: string
  readonly sellSourceRow: number
}

export interface UncoveredSaleDto {
  readonly sellEventId: string
  readonly accountId: string
  readonly instrumentCode: string
  readonly instrumentName: string
  readonly currency: string
  readonly soldOn: string
  readonly uncoveredQuantity: number
  readonly sourceDocumentId: string
  readonly sourceRow: number
}

export interface CorporateActionAllocationDto {
  readonly actionEventId: string
  readonly actionType: 'SPIN_OFF' | 'RIGHTS_SUBSCRIPTION' | 'CASH_IN_LIEU' | 'MERGER_STOCK' | 'MERGER_CASH'
  readonly actionOn: string
  readonly actionSourceDocumentId: string
  readonly actionSourceRow: number
  readonly sourceBuyEventId: string | null
  readonly sourceBuySourceDocumentId: string | null
  readonly sourceBuySourceRow: number | null
  readonly fromInstrumentCode: string
  readonly targetInstrumentCode: string
  readonly sourceCurrency: string | null
  readonly sourceCostBasis: number | null
  readonly conversionRate: number | null
  readonly currency: string
  readonly quantity: number
  readonly allocatedCostBasis: number
  readonly cashAmount: number
  readonly realizedPnl: number | null
}

export interface InvestmentHoldingsDto {
  readonly asOf: string
  readonly costBasisMethod: InvestmentCostBasisMethod
  readonly positions: readonly InvestmentPositionDto[]
  readonly openLots: readonly InvestmentLotDto[]
  readonly realizedAllocations: readonly RealizedAllocationDto[]
  readonly uncoveredSales: readonly UncoveredSaleDto[]
  readonly skippedEventIds: readonly string[]
  readonly corporateActionEventIds: readonly string[]
  readonly corporateActionAllocations: readonly CorporateActionAllocationDto[]
}

export interface InvestmentPeriodCurrencyDto {
  readonly currency: string
  readonly buyGross: number
  readonly sellGross: number
  readonly realizedPnl: number
  readonly dividendGross: number
  readonly fees: number
  readonly taxes: number
}

export interface InvestmentPerformanceDto {
  readonly dateFrom: string | null
  readonly dateTo: string | null
  readonly costBasisMethod: InvestmentCostBasisMethod
  readonly totalsByCurrency: readonly InvestmentPeriodCurrencyDto[]
  readonly realizedAllocations: readonly RealizedAllocationDto[]
  readonly uncoveredSales: readonly UncoveredSaleDto[]
  readonly skippedEventIds: readonly string[]
  readonly corporateActionEventIds: readonly string[]
  readonly corporateActionAllocations: readonly CorporateActionAllocationDto[]
}

export interface InvestmentPerformanceXlsxSavedDto {
  readonly fileName: string
  readonly rowCount: number
  readonly byteSize: number
}

export type InvestmentPerformanceInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function createInvestmentPerformancePlatform(invoke: InvestmentPerformanceInvoke = tauriInvoke) {
  return {
    queryHoldings: async (request: InvestmentHoldingsRequest): Promise<InvestmentHoldingsDto> =>
      parseHoldings(await invoke('investment_holdings_query', { request })),
    queryPerformance: async (request: InvestmentPerformanceRequest): Promise<InvestmentPerformanceDto> =>
      parsePerformance(await invoke('investment_performance_query', { request })),
    savePerformanceXlsx: async (request: InvestmentPerformanceRequest): Promise<InvestmentPerformanceXlsxSavedDto | null> => {
      const value = await invoke('investment_performance_xlsx_save', { request })
      return value === null ? null : parsePerformanceXlsxSaved(value)
    },
  }
}

function parsePerformanceXlsxSaved(value: unknown): InvestmentPerformanceXlsxSavedDto {
  const item = record(value, 'saved investment performance XLSX')
  string(item.fileName, 'saved investment performance XLSX filename')
  safeInteger(item.rowCount, 'saved investment performance XLSX rows')
  safeInteger(item.byteSize, 'saved investment performance XLSX bytes')
  const fileName = item.fileName
  if (fileName.length === 0 || fileName.length > 255 || !/\.xlsx$/i.test(fileName) || /[\\/]/.test(fileName) || Array.from(fileName).some((character) => character.charCodeAt(0) < 32)) throw new TypeError('Invalid saved investment performance XLSX filename')
  if (item.rowCount <= 0 || item.byteSize <= 0) throw new TypeError('Invalid saved investment performance XLSX')
  return item as unknown as InvestmentPerformanceXlsxSavedDto
}

function parseHoldings(value: unknown): InvestmentHoldingsDto {
  const item = record(value, 'investment holdings')
  date(item.asOf, 'asOf')
  fifo(item.costBasisMethod)
  array(item.positions, 'positions')
  array(item.openLots, 'openLots')
  array(item.realizedAllocations, 'realizedAllocations')
  array(item.uncoveredSales, 'uncoveredSales')
  strings(item.skippedEventIds, 'skippedEventIds')
  strings(item.corporateActionEventIds, 'corporateActionEventIds')
  array(item.corporateActionAllocations, 'corporateActionAllocations')
  return {
    asOf: item.asOf,
    costBasisMethod: item.costBasisMethod,
    positions: item.positions.map(parsePosition),
    openLots: item.openLots.map(parseLot),
    realizedAllocations: item.realizedAllocations.map(parseAllocation),
    uncoveredSales: item.uncoveredSales.map(parseUncoveredSale),
    skippedEventIds: item.skippedEventIds,
    corporateActionEventIds: item.corporateActionEventIds,
    corporateActionAllocations: item.corporateActionAllocations.map(parseCorporateActionAllocation),
  }
}

function parsePerformance(value: unknown): InvestmentPerformanceDto {
  const item = record(value, 'investment performance')
  nullableDate(item.dateFrom, 'dateFrom')
  nullableDate(item.dateTo, 'dateTo')
  fifo(item.costBasisMethod)
  array(item.totalsByCurrency, 'totalsByCurrency')
  array(item.realizedAllocations, 'realizedAllocations')
  array(item.uncoveredSales, 'uncoveredSales')
  strings(item.skippedEventIds, 'skippedEventIds')
  strings(item.corporateActionEventIds, 'corporateActionEventIds')
  array(item.corporateActionAllocations, 'corporateActionAllocations')
  return {
    dateFrom: item.dateFrom,
    dateTo: item.dateTo,
    costBasisMethod: item.costBasisMethod,
    totalsByCurrency: item.totalsByCurrency.map(parsePeriodTotals),
    realizedAllocations: item.realizedAllocations.map(parseAllocation),
    uncoveredSales: item.uncoveredSales.map(parseUncoveredSale),
    skippedEventIds: item.skippedEventIds,
    corporateActionEventIds: item.corporateActionEventIds,
    corporateActionAllocations: item.corporateActionAllocations.map(parseCorporateActionAllocation),
  }
}

function parsePosition(value: unknown): InvestmentPositionDto {
  const item = record(value, 'investment position')
  stringFields(item, ['accountId', 'accountName', 'instrumentCode', 'instrumentName'])
  currency(item.currency)
  numberFields(item, ['quantity', 'costBasis', 'averageCost'])
  safeInteger(item.openLotCount, 'openLotCount')
  strings(item.sourceBuyEventIds, 'sourceBuyEventIds')
  return item as unknown as InvestmentPositionDto
}

function parseLot(value: unknown): InvestmentLotDto {
  const item = record(value, 'investment lot')
  stringFields(item, ['buyEventId', 'accountId', 'instrumentCode', 'instrumentName', 'sourceDocumentId'])
  currency(item.currency)
  date(item.acquiredOn, 'acquiredOn')
  numberFields(item, ['originalQuantity', 'remainingQuantity', 'unitCost', 'remainingCostBasis'])
  safeInteger(item.sourceRow, 'sourceRow')
  return item as unknown as InvestmentLotDto
}

function parseAllocation(value: unknown): RealizedAllocationDto {
  const item = record(value, 'realized allocation')
  stringFields(item, ['sellEventId', 'buyEventId', 'accountId', 'instrumentCode', 'instrumentName', 'buySourceDocumentId', 'sellSourceDocumentId'])
  currency(item.currency)
  date(item.soldOn, 'soldOn')
  date(item.acquiredOn, 'acquiredOn')
  numberFields(item, ['quantity', 'allocatedCostBasis', 'allocatedNetProceeds', 'realizedPnl'])
  safeInteger(item.buySourceRow, 'buySourceRow')
  safeInteger(item.sellSourceRow, 'sellSourceRow')
  return item as unknown as RealizedAllocationDto
}

function parseUncoveredSale(value: unknown): UncoveredSaleDto {
  const item = record(value, 'uncovered sale')
  stringFields(item, ['sellEventId', 'accountId', 'instrumentCode', 'instrumentName', 'sourceDocumentId'])
  currency(item.currency)
  date(item.soldOn, 'soldOn')
  finite(item.uncoveredQuantity, 'uncoveredQuantity')
  safeInteger(item.sourceRow, 'sourceRow')
  return item as unknown as UncoveredSaleDto
}

function parseCorporateActionAllocation(value: unknown): CorporateActionAllocationDto {
  const item = record(value, 'corporate action allocation')
  stringFields(item, ['actionEventId', 'actionType', 'actionSourceDocumentId', 'fromInstrumentCode', 'targetInstrumentCode'])
  if (!['SPIN_OFF', 'RIGHTS_SUBSCRIPTION', 'CASH_IN_LIEU', 'MERGER_STOCK', 'MERGER_CASH'].includes(item.actionType as string)) throw new TypeError('Invalid actionType')
  date(item.actionOn, 'actionOn')
  if (item.sourceBuyEventId !== null && typeof item.sourceBuyEventId !== 'string') throw new TypeError('Invalid sourceBuyEventId')
  if (item.sourceBuySourceDocumentId !== null && typeof item.sourceBuySourceDocumentId !== 'string') throw new TypeError('Invalid sourceBuySourceDocumentId')
  if (item.sourceBuySourceRow !== null) safeInteger(item.sourceBuySourceRow, 'sourceBuySourceRow')
  if (item.sourceCurrency !== null) currency(item.sourceCurrency)
  if (item.sourceCostBasis !== null) finite(item.sourceCostBasis, 'sourceCostBasis')
  if (item.conversionRate !== null) { finite(item.conversionRate, 'conversionRate'); if ((item.conversionRate as number) <= 0) throw new TypeError('Invalid conversionRate') }
  currency(item.currency)
  numberFields(item, ['quantity', 'allocatedCostBasis', 'cashAmount'])
  if (item.realizedPnl !== null) finite(item.realizedPnl, 'realizedPnl')
  safeInteger(item.actionSourceRow, 'actionSourceRow')
  if (item.actionType === 'MERGER_STOCK' || item.actionType === 'MERGER_CASH') {
    if (item.sourceBuyEventId === null || item.sourceBuySourceDocumentId === null || item.sourceBuySourceRow === null || item.sourceCurrency === null || item.sourceCostBasis === null || (item.sourceCostBasis as number) < 0) throw new TypeError('Invalid merger source allocation')
    if (((item.sourceCurrency as string) === item.currency) !== (item.conversionRate === null)) throw new TypeError('Invalid merger conversion rate')
  }
  return item as unknown as CorporateActionAllocationDto
}

function parsePeriodTotals(value: unknown): InvestmentPeriodCurrencyDto {
  const item = record(value, 'investment currency totals')
  currency(item.currency)
  numberFields(item, ['buyGross', 'sellGross', 'realizedPnl', 'dividendGross', 'fees', 'taxes'])
  return item as unknown as InvestmentPeriodCurrencyDto
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${name}`)
  return value as Record<string, unknown>
}
function array(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Invalid ${name}`)
}
function string(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`Invalid ${name}`)
}
function stringFields(item: Record<string, unknown>, names: readonly string[]): void {
  names.forEach((name) => string(item[name], name))
}
function strings(value: unknown, name: string): asserts value is string[] {
  array(value, name)
  value.forEach((item) => string(item, name))
}
function finite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${name}`)
}
function numberFields(item: Record<string, unknown>, names: readonly string[]): void {
  names.forEach((name) => finite(item[name], name))
}
function safeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`Invalid ${name}`)
}
function currency(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new TypeError('Invalid currency')
}
function date(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError(`Invalid ${name}`)
}
function nullableDate(value: unknown, name: string): asserts value is string | null {
  if (value !== null) date(value, name)
}
function fifo(value: unknown): asserts value is InvestmentCostBasisMethod {
  if (value !== 'FIFO') throw new TypeError('Invalid costBasisMethod')
}
