import { invoke as tauriInvoke } from '@tauri-apps/api/core'

export type InvestmentMarketSourceKind = 'BROKERAGE_STATEMENT' | 'PORTFOLIO_SNAPSHOT' | 'MANUAL' | 'EXCHANGE_CLOSE' | 'OFFICIAL_REFERENCE'

export interface ImportInvestmentMarketPriceDto {
  readonly id: string
  readonly priceDate: string
  readonly instrumentCode: string
  readonly instrumentName: string
  readonly currency: string
  readonly unitPrice: number
  readonly sourceKind: InvestmentMarketSourceKind
  readonly provider: string
  readonly sourceDocumentId?: string
  readonly sourceRow?: number
  readonly observedAt: string
}

export interface ImportInvestmentMarketPricesDto {
  readonly householdId: string
  readonly prices: readonly ImportInvestmentMarketPriceDto[]
}

export interface InvestmentMarketPricesRequest {
  readonly householdId: string
  readonly instrumentCode?: string
  readonly currency?: string
  readonly through?: string
}

export interface InvestmentValuationRequest {
  readonly householdId: string
  readonly accountId?: string
  readonly asOf: string
}

export interface InvestmentMarketPriceDto extends Omit<ImportInvestmentMarketPriceDto, 'sourceDocumentId' | 'sourceRow'> {
  readonly sourceDocumentId: string | null
  readonly sourceRow: number | null
}

export interface InvestmentValuedPositionDto {
  readonly accountId: string
  readonly accountName: string
  readonly instrumentCode: string
  readonly instrumentName: string
  readonly currency: string
  readonly quantity: number
  readonly costBasis: number
  readonly price: InvestmentMarketPriceDto | null
  readonly marketValue: number | null
  readonly unrealizedPnl: number | null
}

export interface InvestmentValuationCurrencyDto {
  readonly currency: string
  readonly marketValue: number
  readonly costBasis: number
  readonly unrealizedPnl: number
  readonly valuedPositionCount: number
  readonly missingPricePositionCount: number
}

export interface InvestmentValuationDto {
  readonly asOf: string
  readonly costBasisMethod: 'FIFO'
  readonly positions: readonly InvestmentValuedPositionDto[]
  readonly totalsByCurrency: readonly InvestmentValuationCurrencyDto[]
  readonly missingPriceInstrumentCodes: readonly string[]
}

export type InvestmentMarketInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function createInvestmentMarketPlatform(invoke: InvestmentMarketInvoke = tauriInvoke) {
  return {
    importPrices: async (input: ImportInvestmentMarketPricesDto): Promise<{ readonly importedPriceCount: number }> => {
      const item = record(await invoke('investment_market_prices_import', { input }), 'market price import summary')
      safeInteger(item.importedPriceCount, 'importedPriceCount')
      return { importedPriceCount: item.importedPriceCount }
    },
    queryPrices: async (request: InvestmentMarketPricesRequest): Promise<readonly InvestmentMarketPriceDto[]> => {
      const value = await invoke('investment_market_prices_query', { request })
      array(value, 'market prices')
      return value.map(parsePrice)
    },
    queryValuation: async (request: InvestmentValuationRequest): Promise<InvestmentValuationDto> =>
      parseValuation(await invoke('investment_valuation_query', { request })),
  }
}

function parseValuation(value: unknown): InvestmentValuationDto {
  const item = record(value, 'investment valuation')
  date(item.asOf, 'asOf')
  if (item.costBasisMethod !== 'FIFO') throw new TypeError('costBasisMethod')
  array(item.positions, 'positions')
  array(item.totalsByCurrency, 'totalsByCurrency')
  strings(item.missingPriceInstrumentCodes, 'missingPriceInstrumentCodes')
  return {
    asOf: item.asOf,
    costBasisMethod: item.costBasisMethod,
    positions: item.positions.map(parsePosition),
    totalsByCurrency: item.totalsByCurrency.map(parseTotal),
    missingPriceInstrumentCodes: item.missingPriceInstrumentCodes,
  }
}

function parsePosition(value: unknown): InvestmentValuedPositionDto {
  const item = record(value, 'valued position')
  stringFields(item, ['accountId', 'accountName', 'instrumentCode', 'instrumentName'])
  currency(item.currency)
  finite(item.quantity, 'quantity')
  finite(item.costBasis, 'costBasis')
  nullableFinite(item.marketValue, 'marketValue')
  nullableFinite(item.unrealizedPnl, 'unrealizedPnl')
  if (item.price !== null) parsePrice(item.price)
  if ((item.price === null) !== (item.marketValue === null) || (item.price === null) !== (item.unrealizedPnl === null)) throw new TypeError('position valuation completeness')
  return {
    accountId: item.accountId as string,
    accountName: item.accountName as string,
    instrumentCode: item.instrumentCode as string,
    instrumentName: item.instrumentName as string,
    currency: item.currency as string,
    quantity: item.quantity,
    costBasis: item.costBasis,
    price: item.price === null ? null : parsePrice(item.price),
    marketValue: item.marketValue,
    unrealizedPnl: item.unrealizedPnl,
  }
}

function parseTotal(value: unknown): InvestmentValuationCurrencyDto {
  const item = record(value, 'valuation total')
  currency(item.currency)
  for (const key of ['marketValue', 'costBasis', 'unrealizedPnl']) finite(item[key], key)
  for (const key of ['valuedPositionCount', 'missingPricePositionCount']) safeInteger(item[key], key)
  return item as unknown as InvestmentValuationCurrencyDto
}

function parsePrice(value: unknown): InvestmentMarketPriceDto {
  const item = record(value, 'market price')
  stringFields(item, ['id', 'instrumentCode', 'instrumentName', 'provider', 'observedAt'])
  if (!(item.id as string).trim() || !(item.instrumentCode as string).trim() || !(item.provider as string).trim() || !(item.observedAt as string).trim()) throw new TypeError('market price required field')
  date(item.priceDate, 'priceDate')
  currency(item.currency)
  finite(item.unitPrice, 'unitPrice')
  if (item.unitPrice <= 0) throw new TypeError('unitPrice')
  if (!['BROKERAGE_STATEMENT', 'PORTFOLIO_SNAPSHOT', 'MANUAL', 'EXCHANGE_CLOSE', 'OFFICIAL_REFERENCE'].includes(String(item.sourceKind))) throw new TypeError('sourceKind')
  if (item.sourceDocumentId !== null && typeof item.sourceDocumentId !== 'string') throw new TypeError('sourceDocumentId')
  if (item.sourceRow !== null) {
    safeInteger(item.sourceRow, 'sourceRow')
    if (item.sourceRow === 0) throw new TypeError('sourceRow')
  }
  if ((item.sourceDocumentId === null) !== (item.sourceRow === null)) throw new TypeError('source provenance')
  return item as unknown as InvestmentMarketPriceDto
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label)
  return value as Record<string, unknown>
}
function array(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new TypeError(label)
}
function strings(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new TypeError(label)
}
function stringFields(item: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) if (typeof item[key] !== 'string') throw new TypeError(key)
}
function finite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(label)
}
function nullableFinite(value: unknown, label: string): asserts value is number | null {
  if (value !== null) finite(value, label)
}
function safeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(label)
}
function currency(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new TypeError('currency')
}
function date(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError(label)
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new TypeError(label)
}
