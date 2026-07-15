import type { AttributionScopeDto } from '../../platform/types'

export type RecurringCadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
export type RecurringDecision = 'CONFIRMED' | 'IGNORED'
export type RecurringDecisionStatus = 'AUTO_DETECTED' | RecurringDecision

export interface FinancialIntelligenceRequestDto {
  readonly householdId: string
  readonly accountGroupId?: string | null
  readonly attributionScope: AttributionScopeDto
  readonly asOf: string
}

export interface RecurringItemDto {
  readonly normalizedPayee: string
  readonly displayPayee: string
  readonly occurrenceCount: number
  readonly cadence: RecurringCadence
  readonly medianIntervalDays: number
  readonly typicalAmountJpy: number
  readonly latestAmountJpy: number
  readonly lastSeenOn: string
  readonly nextExpectedOn: string
  readonly confidenceBps: number
  readonly priceChangeBps: number | null
  readonly reasons: readonly string[]
  readonly decisionStatus: RecurringDecisionStatus
}

export interface RecurringSeriesPreferenceDto {
  readonly householdId: string
  readonly normalizedPayee: string
  readonly decision: RecurringDecision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface UpsertRecurringSeriesPreferenceDto {
  readonly householdId: string
  readonly normalizedPayee: string
  readonly decision: RecurringDecision
  readonly expectedVersion?: number | null
}

export interface DeleteRecurringSeriesPreferenceDto {
  readonly householdId: string
  readonly normalizedPayee: string
  readonly expectedVersion: number
}

export interface SpendingAnomalyDto {
  readonly transactionId: string
  readonly occurredOn: string
  readonly normalizedPayee: string
  readonly displayPayee: string
  readonly amountJpy: number
  readonly baselineAmountJpy: number
  readonly baselineSampleCount: number
  readonly scoreBps: number
  readonly reasons: readonly string[]
}

export interface FinancialIntelligenceDto {
  readonly asOf: string
  readonly historyFrom: string
  readonly recurringItems: readonly RecurringItemDto[]
  readonly ignoredRecurringItems: readonly RecurringItemDto[]
  readonly anomalies: readonly SpendingAnomalyDto[]
}

export type FeatureInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export async function queryFinancialIntelligence(
  invoke: FeatureInvoke,
  request: FinancialIntelligenceRequestDto,
): Promise<FinancialIntelligenceDto> {
  const response = await invoke<unknown>('financial_intelligence_query', { request })
  return parseFinancialIntelligence(response)
}

export async function listRecurringSeriesPreferences(invoke: FeatureInvoke, householdId: string): Promise<readonly RecurringSeriesPreferenceDto[]> {
  return array(await invoke<unknown>('recurring_series_preferences_list', { householdId }), 'recurring series preferences').map(parseRecurringSeriesPreference)
}

export async function upsertRecurringSeriesPreference(invoke: FeatureInvoke, input: UpsertRecurringSeriesPreferenceDto): Promise<RecurringSeriesPreferenceDto> {
  return parseRecurringSeriesPreference(await invoke<unknown>('recurring_series_preference_upsert', { input }))
}

export async function deleteRecurringSeriesPreference(invoke: FeatureInvoke, input: DeleteRecurringSeriesPreferenceDto): Promise<void> {
  await invoke<unknown>('recurring_series_preference_delete', { input })
}

export function parseFinancialIntelligence(value: unknown): FinancialIntelligenceDto {
  const record = asRecord(value)
  return {
    asOf: isoDate(record.asOf, 'asOf'),
    historyFrom: isoDate(record.historyFrom, 'historyFrom'),
    recurringItems: array(record.recurringItems, 'recurringItems').map(parseRecurringItem),
    ignoredRecurringItems: array(record.ignoredRecurringItems, 'ignoredRecurringItems').map(parseRecurringItem),
    anomalies: array(record.anomalies, 'anomalies').map(parseAnomaly),
  }
}

function parseRecurringItem(value: unknown): RecurringItemDto {
  const record = asRecord(value)
  const cadence = string(record.cadence, 'cadence')
  if (!['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(cadence)) {
    throw new TypeError('cadence')
  }
  const decisionStatus = string(record.decisionStatus, 'decisionStatus')
  if (!['AUTO_DETECTED', 'CONFIRMED', 'IGNORED'].includes(decisionStatus)) throw new TypeError('decisionStatus')
  return {
    normalizedPayee: string(record.normalizedPayee, 'normalizedPayee'),
    displayPayee: string(record.displayPayee, 'displayPayee'),
    occurrenceCount: safeInteger(record.occurrenceCount, 'occurrenceCount', 3),
    cadence: cadence as RecurringCadence,
    medianIntervalDays: safeInteger(record.medianIntervalDays, 'medianIntervalDays', 1),
    typicalAmountJpy: safeInteger(record.typicalAmountJpy, 'typicalAmountJpy', 1),
    latestAmountJpy: safeInteger(record.latestAmountJpy, 'latestAmountJpy', 1),
    lastSeenOn: isoDate(record.lastSeenOn, 'lastSeenOn'),
    nextExpectedOn: isoDate(record.nextExpectedOn, 'nextExpectedOn'),
    confidenceBps: safeInteger(record.confidenceBps, 'confidenceBps', 0, 10_000),
    priceChangeBps: nullableInteger(record.priceChangeBps, 'priceChangeBps'),
    reasons: array(record.reasons, 'reasons').map((reason) => string(reason, 'reason')),
    decisionStatus: decisionStatus as RecurringDecisionStatus,
  }
}

function parseRecurringSeriesPreference(value: unknown): RecurringSeriesPreferenceDto {
  const record = asRecord(value)
  const decision = string(record.decision, 'decision')
  if (!['CONFIRMED', 'IGNORED'].includes(decision)) throw new TypeError('decision')
  return {
    householdId: string(record.householdId, 'householdId'),
    normalizedPayee: string(record.normalizedPayee, 'normalizedPayee'),
    decision: decision as RecurringDecision,
    version: safeInteger(record.version, 'version', 1),
    createdAt: string(record.createdAt, 'createdAt'),
    updatedAt: string(record.updatedAt, 'updatedAt'),
  }
}

function parseAnomaly(value: unknown): SpendingAnomalyDto {
  const record = asRecord(value)
  return {
    transactionId: string(record.transactionId, 'transactionId'),
    occurredOn: isoDate(record.occurredOn, 'occurredOn'),
    normalizedPayee: string(record.normalizedPayee, 'normalizedPayee'),
    displayPayee: string(record.displayPayee, 'displayPayee'),
    amountJpy: safeInteger(record.amountJpy, 'amountJpy', 1),
    baselineAmountJpy: safeInteger(record.baselineAmountJpy, 'baselineAmountJpy', 1),
    baselineSampleCount: safeInteger(record.baselineSampleCount, 'baselineSampleCount', 3),
    scoreBps: safeInteger(record.scoreBps, 'scoreBps', 0, 10_000),
    reasons: array(record.reasons, 'reasons').map((reason) => string(reason, 'reason')),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('record')
  return value as Record<string, unknown>
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(field)
  return value
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(field)
  return value
}

function isoDate(value: unknown, field: string): string {
  const result = string(value, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new TypeError(field)
  return result
}

function safeInteger(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(field)
  }
  return value as number
}

function nullableInteger(value: unknown, field: string): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value)) throw new TypeError(field)
  return value as number
}
