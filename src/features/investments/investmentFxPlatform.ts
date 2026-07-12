import { invoke as tauriInvoke } from '@tauri-apps/api/core'

export type InvestmentFxSourceKind = 'BROKERAGE_STATEMENT' | 'PORTFOLIO_SNAPSHOT' | 'MANUAL' | 'OFFICIAL_REFERENCE'

export interface ImportInvestmentFxRateDto {
  readonly id: string
  readonly rateDate: string
  readonly baseCurrency: string
  readonly quoteCurrency: string
  readonly rate: number
  readonly sourceKind: InvestmentFxSourceKind
  readonly provider: string
  readonly sourceDocumentId?: string
  readonly sourceRow?: number
  readonly observedAt: string
}
export interface ImportInvestmentFxRatesDto { readonly householdId: string; readonly rates: readonly ImportInvestmentFxRateDto[] }
export interface InvestmentFxImportSummaryDto { readonly importedRateCount: number }
export interface InvestmentFxRatesRequest { readonly householdId: string; readonly baseCurrency?: string; readonly quoteCurrency?: string; readonly through?: string }
export interface InvestmentFxRateDto extends Omit<ImportInvestmentFxRateDto, 'sourceDocumentId' | 'sourceRow'> { readonly sourceDocumentId: string | null; readonly sourceRow: number | null }
export interface InvestmentReportingRequest { readonly householdId: string; readonly accountId?: string; readonly dateFrom?: string; readonly dateTo?: string; readonly reportingCurrency: string; readonly fxAsOf: string }
export interface InvestmentCurrencyTotalsDto { readonly currency: string; readonly buyGross: number; readonly sellGross: number; readonly realizedPnl: number; readonly dividendGross: number; readonly fees: number; readonly taxes: number }
export interface InvestmentFxConversionDto { readonly originalCurrency: string; readonly reportingCurrency: string; readonly rate: number; readonly rateId: string; readonly rateDate: string; readonly inverted: boolean; readonly sourceKind: InvestmentFxSourceKind | 'IDENTITY'; readonly provider: string; readonly sourceDocumentId: string | null; readonly sourceRow: number | null }
export interface InvestmentReportingDto { readonly dateFrom: string | null; readonly dateTo: string | null; readonly fxAsOf: string; readonly originalTotalsByCurrency: readonly InvestmentCurrencyTotalsDto[]; readonly convertedTotals: InvestmentCurrencyTotalsDto; readonly conversions: readonly InvestmentFxConversionDto[] }

export type InvestmentFxInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>
export function createInvestmentFxPlatform(invoke: InvestmentFxInvoke = tauriInvoke) {
  return {
    importRates: async (input: ImportInvestmentFxRatesDto): Promise<InvestmentFxImportSummaryDto> => parseSummary(await invoke('investment_fx_rates_import', { input })),
    queryRates: async (request: InvestmentFxRatesRequest): Promise<readonly InvestmentFxRateDto[]> => parseRates(await invoke('investment_fx_rates_query', { request })),
    queryReporting: async (request: InvestmentReportingRequest): Promise<InvestmentReportingDto> => parseReporting(await invoke('investment_reporting_query', { request })),
  }
}

function parseSummary(value: unknown): InvestmentFxImportSummaryDto { const item = record(value, 'FX import summary'); integer(item.importedRateCount, 'importedRateCount'); return item as unknown as InvestmentFxImportSummaryDto }
function parseRates(value: unknown): readonly InvestmentFxRateDto[] { if (!Array.isArray(value)) throw new TypeError('Invalid FX rates'); return value.map(parseRate) }
function parseRate(value: unknown): InvestmentFxRateDto {
  const item = record(value, 'FX rate'); strings(item, ['id', 'rateDate', 'baseCurrency', 'quoteCurrency', 'sourceKind', 'provider', 'observedAt']); finite(item.rate, 'rate'); nullableString(item.sourceDocumentId, 'sourceDocumentId'); nullableInteger(item.sourceRow, 'sourceRow'); return item as unknown as InvestmentFxRateDto
}
function parseReporting(value: unknown): InvestmentReportingDto {
  const item = record(value, 'investment reporting'); nullableString(item.dateFrom, 'dateFrom'); nullableString(item.dateTo, 'dateTo'); string(item.fxAsOf, 'fxAsOf')
  if (!Array.isArray(item.originalTotalsByCurrency) || !Array.isArray(item.conversions)) throw new TypeError('Invalid reporting collections')
  return { dateFrom: item.dateFrom as string | null, dateTo: item.dateTo as string | null, fxAsOf: item.fxAsOf, originalTotalsByCurrency: item.originalTotalsByCurrency.map(parseTotals), convertedTotals: parseTotals(item.convertedTotals), conversions: item.conversions.map(parseConversion) }
}
function parseTotals(value: unknown): InvestmentCurrencyTotalsDto { const item = record(value, 'investment totals'); string(item.currency, 'currency'); numbers(item, ['buyGross', 'sellGross', 'realizedPnl', 'dividendGross', 'fees', 'taxes']); return item as unknown as InvestmentCurrencyTotalsDto }
function parseConversion(value: unknown): InvestmentFxConversionDto { const item = record(value, 'FX conversion'); strings(item, ['originalCurrency', 'reportingCurrency', 'rateId', 'rateDate', 'sourceKind', 'provider']); finite(item.rate, 'rate'); if (typeof item.inverted !== 'boolean') throw new TypeError('Invalid inverted'); nullableString(item.sourceDocumentId, 'sourceDocumentId'); nullableInteger(item.sourceRow, 'sourceRow'); return item as unknown as InvestmentFxConversionDto }
function record(value: unknown, name: string): Record<string, unknown> { if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${name}`); return value as Record<string, unknown> }
function string(value: unknown, name: string): asserts value is string { if (typeof value !== 'string') throw new TypeError(`Invalid ${name}`) }
function strings(item: Record<string, unknown>, keys: readonly string[]): void { keys.forEach((key) => string(item[key], key)) }
function finite(value: unknown, name: string): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${name}`) }
function numbers(item: Record<string, unknown>, keys: readonly string[]): void { keys.forEach((key) => finite(item[key], key)) }
function integer(value: unknown, name: string): asserts value is number { if (!Number.isSafeInteger(value)) throw new TypeError(`Invalid ${name}`) }
function nullableString(value: unknown, name: string): void { if (value !== null && typeof value !== 'string') throw new TypeError(`Invalid ${name}`) }
function nullableInteger(value: unknown, name: string): void { if (value !== null) integer(value, name) }
