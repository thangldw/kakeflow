import { invoke as tauriInvoke } from '@tauri-apps/api/core'

import type { BrokerageEventCandidate, BrokerageEventType, BrokerageLegKind } from '../../ingestion'

export interface BrokerageImportContext {
  readonly householdId: string
  readonly accountId: string
  readonly sourceDocumentId: string
  readonly idPrefix: string
}

export interface ImportBrokerageEventsDto {
  readonly householdId: string
  readonly accountId: string
  readonly sourceDocumentId: string
  readonly events: readonly ImportBrokerageEventDto[]
}

export interface ImportBrokerageEventDto {
  readonly id: string
  readonly sourceRow: number
  readonly eventType: BrokerageEventType
  readonly tradeDate: string | null
  readonly settlementDate: string | null
  readonly instrumentCode: string
  readonly instrumentName: string
  readonly accountType: string
  readonly currency: string
  readonly quantity: number | null
  readonly unitPrice: number | null
  readonly grossAmount: number
  readonly feeAmount: number
  readonly taxAmount: number
  readonly settlementAmount: number
  readonly reconciliationStatus: 'BALANCED' | 'ADJUSTED'
  readonly reconciliationDifference: number
  readonly affectsHouseholdExpense: false
  readonly rawTransactionType: string
  readonly corporateActionRatio?: number
  readonly targetInstrumentCode?: string
  readonly targetInstrumentName?: string
  readonly targetCurrency?: string
  readonly costBasisAllocationRatio?: number
  readonly subscriptionAmount?: number
  readonly cashInLieuAmount?: number
  readonly cashInLieuQuantity?: number
  readonly mergerCashAmount?: number
  readonly mergerCashCurrency?: string
  readonly mergerStockCostBasisRatio?: number
  readonly sourceToTargetFxRate?: number
  readonly sourceToCashFxRate?: number
  readonly legs: readonly ImportBrokerageLegDto[]
}

export interface ImportBrokerageLegDto {
  readonly id: string
  readonly kind: BrokerageLegKind
  readonly signedAmount: number
  readonly currency: string
  readonly instrumentCode?: string
  readonly instrumentName?: string
  readonly signedQuantity?: number
  readonly description: string
}

export interface BrokerageImportSummaryDto {
  readonly sourceDocumentId: string
  readonly importedEventCount: number
  readonly importedLegCount: number
}

export interface BrokerageHistoryRequest {
  readonly householdId: string
  readonly accountId?: string
  readonly dateFrom?: string
  readonly dateTo?: string
}

export interface BrokerageHistoryDto {
  readonly events: readonly BrokerageEventDto[]
  readonly totalsByCurrency: readonly BrokerageCurrencyTotalsDto[]
}

export interface BrokerageEventDto extends Omit<ImportBrokerageEventDto, 'legs' | 'corporateActionRatio' | 'targetInstrumentCode' | 'targetInstrumentName' | 'targetCurrency' | 'costBasisAllocationRatio' | 'subscriptionAmount' | 'cashInLieuAmount' | 'cashInLieuQuantity' | 'mergerCashAmount' | 'mergerCashCurrency' | 'mergerStockCostBasisRatio' | 'sourceToTargetFxRate' | 'sourceToCashFxRate'> {
  readonly accountId: string
  readonly accountName: string
  readonly sourceDocumentId: string
  readonly corporateActionRatio: number | null
  readonly targetInstrumentCode: string | null
  readonly targetInstrumentName: string | null
  readonly targetCurrency: string | null
  readonly costBasisAllocationRatio: number | null
  readonly subscriptionAmount: number | null
  readonly cashInLieuAmount: number | null
  readonly cashInLieuQuantity: number | null
  readonly mergerCashAmount: number | null
  readonly mergerCashCurrency: string | null
  readonly mergerStockCostBasisRatio: number | null
  readonly sourceToTargetFxRate: number | null
  readonly sourceToCashFxRate: number | null
  readonly legs: readonly BrokerageLegDto[]
}

export interface BrokerageLegDto extends ImportBrokerageLegDto {
  readonly lineNumber: number
}

export interface BrokerageCurrencyTotalsDto {
  readonly currency: string
  readonly buyGross: number
  readonly sellGross: number
  readonly dividendGross: number
  readonly fees: number
  readonly taxes: number
  readonly deposits: number
  readonly withdrawals: number
  readonly netCashMovement: number
}

export type BrokerageInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

const MAX_MERGER_CASH_AMOUNT = 1e18
const MAX_MERGER_FX_RATE = 1e12

export function mapBrokerageEventsImport(
  candidates: readonly BrokerageEventCandidate[],
  context: BrokerageImportContext,
): ImportBrokerageEventsDto {
  if (candidates.length === 0) throw new TypeError('At least one brokerage event is required')
  if ([context.householdId, context.accountId, context.sourceDocumentId, context.idPrefix].some((value) => !value.trim())) throw new TypeError('Brokerage import context is incomplete')
  const prefix = context.idPrefix.slice(0, 40)
  return {
    householdId: context.householdId,
    accountId: context.accountId,
    sourceDocumentId: context.sourceDocumentId,
    events: candidates.map((candidate, eventIndex) => {
      if (candidate.affectsHouseholdExpense !== false) throw new TypeError('Brokerage events cannot affect household expense')
      if (!candidate.tradeDate && !candidate.settlementDate) throw new TypeError('Brokerage event requires a trade or settlement date')
      validateMergerCandidate(candidate)
      const balances = candidate.legs.reduce((totals, current) => totals.set(current.currency, (totals.get(current.currency) ?? 0) + current.signedAmount), new Map<string, number>())
      if (candidate.legs.length < 2 || [...balances.values()].some((balance) => Math.abs(balance) > 0.000001)) throw new TypeError('Brokerage event legs must balance per currency')
      const eventId = `${prefix}-e-${eventIndex + 1}`
      return {
        id: eventId,
        sourceRow: candidate.lineage.sourceRow,
        eventType: candidate.eventType,
        tradeDate: candidate.tradeDate,
        settlementDate: candidate.settlementDate,
        instrumentCode: candidate.instrumentCode,
        instrumentName: candidate.instrumentName,
        accountType: candidate.accountType,
        currency: candidate.currency,
        quantity: candidate.quantity,
        unitPrice: candidate.unitPrice,
        grossAmount: candidate.grossAmount,
        feeAmount: candidate.feeAmount,
        taxAmount: candidate.taxAmount,
        settlementAmount: candidate.settlementAmount,
        reconciliationStatus: candidate.reconciliationStatus,
        reconciliationDifference: candidate.reconciliationDifference,
        affectsHouseholdExpense: false,
        rawTransactionType: candidate.rawTransactionType,
        corporateActionRatio: candidate.corporateActionRatio,
        targetInstrumentCode: candidate.targetInstrumentCode,
        targetInstrumentName: candidate.targetInstrumentName,
        targetCurrency: candidate.targetCurrency,
        costBasisAllocationRatio: candidate.costBasisAllocationRatio,
        subscriptionAmount: candidate.subscriptionAmount,
        cashInLieuAmount: candidate.cashInLieuAmount,
        cashInLieuQuantity: candidate.cashInLieuQuantity,
        mergerCashAmount: candidate.mergerCashAmount,
        mergerCashCurrency: candidate.mergerCashCurrency,
        mergerStockCostBasisRatio: candidate.mergerStockCostBasisRatio,
        sourceToTargetFxRate: candidate.sourceToTargetFxRate,
        sourceToCashFxRate: candidate.sourceToCashFxRate,
        legs: candidate.legs.map((leg, legIndex) => ({ ...leg, id: `${eventId}-l-${legIndex + 1}` })),
      }
    }),
  }
}

export function createBrokeragePlatform(invoke: BrokerageInvoke = tauriInvoke) {
  return {
    importEvents: async (input: ImportBrokerageEventsDto): Promise<BrokerageImportSummaryDto> => parseImportSummary(await invoke('brokerage_events_import', { input })),
    queryHistory: async (request: BrokerageHistoryRequest): Promise<BrokerageHistoryDto> => parseHistory(await invoke('brokerage_history_query', { request })),
  }
}

function parseImportSummary(value: unknown): BrokerageImportSummaryDto {
  const item = record(value, 'brokerage import summary')
  string(item.sourceDocumentId, 'sourceDocumentId')
  safeInteger(item.importedEventCount, 'importedEventCount')
  safeInteger(item.importedLegCount, 'importedLegCount')
  return item as unknown as BrokerageImportSummaryDto
}

function parseHistory(value: unknown): BrokerageHistoryDto {
  const item = record(value, 'brokerage history')
  if (!Array.isArray(item.events) || !Array.isArray(item.totalsByCurrency)) throw new TypeError('Invalid brokerage history collections')
  return { events: item.events.map(parseEvent), totalsByCurrency: item.totalsByCurrency.map(parseTotals) }
}

function parseEvent(value: unknown): BrokerageEventDto {
  const item = record(value, 'brokerage event')
  for (const key of ['id', 'accountId', 'accountName', 'sourceDocumentId', 'eventType', 'instrumentCode', 'instrumentName', 'accountType', 'currency', 'reconciliationStatus', 'rawTransactionType']) string(item[key], key)
  if (!['BUY', 'SELL', 'DIVIDEND', 'FEE', 'TAX', 'DEPOSIT', 'WITHDRAWAL', 'SPLIT', 'REVERSE_SPLIT', 'MERGER', 'SPIN_OFF', 'RIGHTS_SUBSCRIPTION', 'CASH_IN_LIEU'].includes(item.eventType as string)) throw new TypeError('Invalid eventType')
  if (!['BALANCED', 'ADJUSTED'].includes(item.reconciliationStatus as string)) throw new TypeError('Invalid reconciliationStatus')
  if (!/^[A-Z]{3}$/.test(item.currency as string)) throw new TypeError('Invalid currency')
  safeInteger(item.sourceRow, 'sourceRow')
  for (const key of ['tradeDate', 'settlementDate']) nullableString(item[key], key)
  for (const key of ['quantity', 'unitPrice']) nullableFinite(item[key], key)
  nullableFinite(item.corporateActionRatio, 'corporateActionRatio')
  for (const key of ['costBasisAllocationRatio', 'subscriptionAmount', 'cashInLieuAmount', 'cashInLieuQuantity', 'mergerCashAmount', 'mergerStockCostBasisRatio', 'sourceToTargetFxRate', 'sourceToCashFxRate']) nullableFinite(item[key], key)
  for (const key of ['targetInstrumentCode', 'targetInstrumentName', 'targetCurrency', 'mergerCashCurrency']) nullableString(item[key], key)
  for (const key of ['grossAmount', 'feeAmount', 'taxAmount', 'settlementAmount', 'reconciliationDifference']) finite(item[key], key)
  if (item.affectsHouseholdExpense !== false || !Array.isArray(item.legs)) throw new TypeError('Invalid brokerage event accounting fields')
  const mergerFields = ['mergerCashAmount', 'mergerCashCurrency', 'mergerStockCostBasisRatio', 'sourceToTargetFxRate', 'sourceToCashFxRate'] as const
  if (item.eventType !== 'MERGER' && mergerFields.some((key) => item[key] !== null)) throw new TypeError('Invalid non-merger allocation fields')
  if (item.eventType === 'MERGER') {
    const sourceCurrency = item.currency as string
    const targetCurrency = item.targetCurrency as string | null
    const cashAmount = item.mergerCashAmount as number | null
    const cashCurrency = item.mergerCashCurrency as string | null
    const stockRatio = item.mergerStockCostBasisRatio as number | null
    const targetRate = item.sourceToTargetFxRate as number | null
    const cashRate = item.sourceToCashFxRate as number | null
    const hasCash = cashAmount !== null
    if (!targetCurrency || !/^[A-Z]{3}$/.test(targetCurrency) || stockRatio === null || (hasCash ? !(stockRatio > 0 && stockRatio < 1) : stockRatio !== 1)) throw new TypeError('Invalid merger stock allocation')
    if ((targetCurrency === sourceCurrency) !== (targetRate === null) || targetRate !== null && (targetRate <= 0 || targetRate > MAX_MERGER_FX_RATE)) throw new TypeError('Invalid merger target FX rate')
    if (hasCash ? cashAmount <= 0 || cashAmount > MAX_MERGER_CASH_AMOUNT || !cashCurrency || !/^[A-Z]{3}$/.test(cashCurrency) : cashCurrency !== null) throw new TypeError('Invalid merger cash allocation')
    if (hasCash && ((cashCurrency === sourceCurrency) !== (cashRate === null) || cashRate !== null && (cashRate <= 0 || cashRate > MAX_MERGER_FX_RATE)) || !hasCash && cashRate !== null) throw new TypeError('Invalid merger cash FX rate')
  }
  return { ...item, legs: item.legs.map(parseLeg) } as unknown as BrokerageEventDto
}

function validateMergerCandidate(candidate: BrokerageEventCandidate): void {
  const mergerValues = [candidate.mergerCashAmount, candidate.mergerCashCurrency, candidate.mergerStockCostBasisRatio, candidate.sourceToTargetFxRate, candidate.sourceToCashFxRate]
  if (candidate.eventType !== 'MERGER') {
    if (mergerValues.some((value) => value !== undefined)) throw new TypeError('Non-merger event has merger allocation fields')
    return
  }
  const targetCurrency = candidate.targetCurrency
  const cashAmount = candidate.mergerCashAmount
  const cashCurrency = candidate.mergerCashCurrency
  const stockRatio = candidate.mergerStockCostBasisRatio
  const targetRate = candidate.sourceToTargetFxRate
  const cashRate = candidate.sourceToCashFxRate
  const hasCash = cashAmount !== undefined
  const conditionalRate = (target: string, rate: number | undefined) => target === candidate.currency ? rate === undefined : rate !== undefined && Number.isFinite(rate) && rate > 0 && rate <= MAX_MERGER_FX_RATE
  if (!candidate.corporateActionRatio || !Number.isFinite(candidate.corporateActionRatio) || candidate.corporateActionRatio <= 0 || !candidate.targetInstrumentCode?.trim() && !candidate.targetInstrumentName?.trim() || candidate.grossAmount !== 0 || candidate.feeAmount !== 0 || candidate.taxAmount !== 0 || candidate.settlementAmount !== 0) throw new TypeError('Invalid merger action terms')
  if (!targetCurrency || !/^[A-Z]{3}$/.test(targetCurrency) || !conditionalRate(targetCurrency, targetRate)) throw new TypeError('Invalid merger target currency or FX rate')
  if (stockRatio === undefined || !Number.isFinite(stockRatio) || (hasCash ? !(stockRatio > 0 && stockRatio < 1) : stockRatio !== 1)) throw new TypeError('Invalid merger stock allocation')
  if (hasCash ? !Number.isFinite(cashAmount) || cashAmount <= 0 || cashAmount > MAX_MERGER_CASH_AMOUNT || !cashCurrency || !/^[A-Z]{3}$/.test(cashCurrency) || !conditionalRate(cashCurrency, cashRate) : cashCurrency !== undefined || cashRate !== undefined) throw new TypeError('Invalid merger cash allocation')
  const securityLegs = candidate.legs.filter((leg) => leg.kind === 'SECURITY')
  const cashLegs = candidate.legs.filter((leg) => leg.kind === 'CASH')
  const adjustmentLegs = candidate.legs.filter((leg) => leg.kind === 'ADJUSTMENT')
  if (securityLegs.length !== 2 || !securityLegs.some((leg) => (leg.signedQuantity ?? 0) < 0 && leg.currency === candidate.currency) || !securityLegs.some((leg) => (leg.signedQuantity ?? 0) > 0 && leg.currency === targetCurrency)) throw new TypeError('Invalid merger security legs')
  if (hasCash ? cashLegs.length !== 1 || adjustmentLegs.length !== 1 || cashLegs[0].currency !== cashCurrency || cashLegs[0].signedAmount !== cashAmount || adjustmentLegs[0].currency !== cashCurrency || adjustmentLegs[0].signedAmount !== -cashAmount : cashLegs.length !== 0 || adjustmentLegs.length !== 0) throw new TypeError('Invalid merger cash legs')
}

function parseLeg(value: unknown): BrokerageLegDto {
  const item = record(value, 'brokerage leg')
  for (const key of ['id', 'kind', 'currency', 'description']) string(item[key], key)
  if (!['SECURITY', 'CASH', 'INVESTMENT_INCOME', 'INVESTMENT_EXPENSE', 'INVESTMENT_TAX', 'TRANSFER', 'ADJUSTMENT'].includes(item.kind as string)) throw new TypeError('Invalid leg kind')
  if (!/^[A-Z]{3}$/.test(item.currency as string)) throw new TypeError('Invalid leg currency')
  for (const key of ['instrumentCode', 'instrumentName']) optionalString(item[key], key)
  safeInteger(item.lineNumber, 'lineNumber')
  finite(item.signedAmount, 'signedAmount')
  if (item.signedQuantity !== undefined) finite(item.signedQuantity, 'signedQuantity')
  return item as unknown as BrokerageLegDto
}

function parseTotals(value: unknown): BrokerageCurrencyTotalsDto {
  const item = record(value, 'brokerage totals')
  string(item.currency, 'currency')
  for (const key of ['buyGross', 'sellGross', 'dividendGross', 'fees', 'taxes', 'deposits', 'withdrawals', 'netCashMovement']) finite(item[key], key)
  return item as unknown as BrokerageCurrencyTotalsDto
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${name}`)
  return value as Record<string, unknown>
}
function string(value: unknown, name: string): asserts value is string { if (typeof value !== 'string') throw new TypeError(`Invalid ${name}`) }
function optionalString(value: unknown, name: string): void { if (value !== undefined && typeof value !== 'string') throw new TypeError(`Invalid ${name}`) }
function nullableString(value: unknown, name: string): void { if (value !== null && typeof value !== 'string') throw new TypeError(`Invalid ${name}`) }
function finite(value: unknown, name: string): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${name}`) }
function nullableFinite(value: unknown, name: string): void { if (value !== null) finite(value, name) }
function safeInteger(value: unknown, name: string): asserts value is number { if (!Number.isSafeInteger(value)) throw new TypeError(`Invalid ${name}`) }
