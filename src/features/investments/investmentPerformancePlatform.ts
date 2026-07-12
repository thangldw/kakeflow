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

export interface InvestmentHoldingsDto {
  readonly asOf: string
  readonly costBasisMethod: InvestmentCostBasisMethod
  readonly positions: readonly InvestmentPositionDto[]
  readonly openLots: readonly InvestmentLotDto[]
  readonly realizedAllocations: readonly RealizedAllocationDto[]
  readonly uncoveredSales: readonly UncoveredSaleDto[]
  readonly skippedEventIds: readonly string[]
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
}

export type InvestmentPerformanceInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function createInvestmentPerformancePlatform(invoke: InvestmentPerformanceInvoke = tauriInvoke) {
  return {
    queryHoldings: async (request: InvestmentHoldingsRequest): Promise<InvestmentHoldingsDto> =>
      parseHoldings(await invoke('investment_holdings_query', { request })),
    queryPerformance: async (request: InvestmentPerformanceRequest): Promise<InvestmentPerformanceDto> =>
      parsePerformance(await invoke('investment_performance_query', { request })),
  }
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
  return {
    asOf: item.asOf,
    costBasisMethod: item.costBasisMethod,
    positions: item.positions.map(parsePosition),
    openLots: item.openLots.map(parseLot),
    realizedAllocations: item.realizedAllocations.map(parseAllocation),
    uncoveredSales: item.uncoveredSales.map(parseUncoveredSale),
    skippedEventIds: item.skippedEventIds,
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
  return {
    dateFrom: item.dateFrom,
    dateTo: item.dateTo,
    costBasisMethod: item.costBasisMethod,
    totalsByCurrency: item.totalsByCurrency.map(parsePeriodTotals),
    realizedAllocations: item.realizedAllocations.map(parseAllocation),
    uncoveredSales: item.uncoveredSales.map(parseUncoveredSale),
    skippedEventIds: item.skippedEventIds,
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
