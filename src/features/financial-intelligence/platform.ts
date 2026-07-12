export type RecurringCadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'

export interface FinancialIntelligenceRequestDto {
  readonly householdId: string
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

export function parseFinancialIntelligence(value: unknown): FinancialIntelligenceDto {
  const record = asRecord(value)
  return {
    asOf: isoDate(record.asOf, 'asOf'),
    historyFrom: isoDate(record.historyFrom, 'historyFrom'),
    recurringItems: array(record.recurringItems, 'recurringItems').map(parseRecurringItem),
    anomalies: array(record.anomalies, 'anomalies').map(parseAnomaly),
  }
}

function parseRecurringItem(value: unknown): RecurringItemDto {
  const record = asRecord(value)
  const cadence = string(record.cadence, 'cadence')
  if (!['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(cadence)) {
    throw new TypeError('cadence')
  }
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
