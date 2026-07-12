import type { AttributionScopeDto } from '../../platform/types'

export type FixedCostSegment = 'HOUSING' | 'INSURANCE' | 'ELECTRICITY' | 'GAS' | 'WATER' | 'INTERNET' | 'MOBILE' | 'SUBSCRIPTIONS_OTHER' | 'OTHER_RECURRING'
export type FixedCostCadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'

export interface FixedCostReviewRequestDto {
  readonly householdId: string
  readonly accountGroupId?: string | null
  readonly attributionScope: AttributionScopeDto
  readonly asOf: string
}

export interface FixedCostMonthlyPointDto { readonly month: string; readonly totalJpy: number; readonly recurringPayeeCount: number; readonly transactionCount: number }
export interface FixedCostPayeeDto {
  readonly normalizedPayee: string; readonly displayPayee: string; readonly expenseCategoryNames: readonly string[]; readonly cadence: FixedCostCadence
  readonly typicalAmountJpy: number; readonly latestAmountJpy: number; readonly latestPaymentOn: string; readonly occurrenceCount: number; readonly confidenceBps: number; readonly reasons: readonly string[]
}
export interface FixedCostSegmentDto {
  readonly segment: FixedCostSegment; readonly monthlyPoints: readonly FixedCostMonthlyPointDto[]
  readonly recentThreeAverageJpy: number; readonly previousThreeAverageJpy: number; readonly changeJpy: number; readonly changeRateBps: number | null
  readonly annualizedJpy: number; readonly recurringPayeeCount: number; readonly transactionCount: number; readonly latestPaymentOn: string | null
  readonly topPayees: readonly FixedCostPayeeDto[]; readonly reasons: readonly string[]
}
export interface FixedCostTotalsDto {
  readonly recentThreeAverageJpy: number; readonly previousThreeAverageJpy: number; readonly changeJpy: number; readonly changeRateBps: number | null
  readonly annualizedJpy: number; readonly recurringPayeeCount: number; readonly transactionCount: number
}
export interface FixedCostCoverageDto {
  readonly completeMonthCount: number; readonly observedMonthCount: number; readonly confirmedTransactionCount: number
  readonly recurringTransactionCount: number; readonly unclassifiedRecurringPayeeCount: number
}
export interface FixedCostReviewDto {
  readonly asOf: string; readonly historyFrom: string; readonly historyThrough: string; readonly monthlyPoints: readonly FixedCostMonthlyPointDto[]
  readonly segments: readonly FixedCostSegmentDto[]; readonly totals: FixedCostTotalsDto; readonly coverage: FixedCostCoverageDto; readonly limitations: readonly string[]
}

export type FixedCostInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export async function queryFixedCostReview(invoke: FixedCostInvoke, request: FixedCostReviewRequestDto): Promise<FixedCostReviewDto> {
  return parseFixedCostReview(await invoke<unknown>('fixed_cost_review_query', { request }))
}

const segments: readonly FixedCostSegment[] = ['HOUSING', 'INSURANCE', 'ELECTRICITY', 'GAS', 'WATER', 'INTERNET', 'MOBILE', 'SUBSCRIPTIONS_OTHER', 'OTHER_RECURRING']
const cadences: readonly FixedCostCadence[] = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL']

export function parseFixedCostReview(value: unknown): FixedCostReviewDto {
  const item = record(value, 'fixed cost review')
  const monthlyPoints = array(item.monthlyPoints, 'monthlyPoints').map(parseMonthlyPoint)
  validateSixMonths(monthlyPoints)
  const parsedSegments = array(item.segments, 'segments').map(parseSegment)
  if (new Set(parsedSegments.map((segment) => segment.segment)).size !== parsedSegments.length) throw new TypeError('segments')
  if (parsedSegments.some((segment) => segment.monthlyPoints.some((point, index) => point.month !== monthlyPoints[index].month))) throw new TypeError('segment monthlyPoints')
  const coverage = parseCoverage(item.coverage)
  if (coverage.completeMonthCount !== 6) throw new TypeError('completeMonthCount')
  const totals = parseTotals(item.totals)
  validateObservedComparison(monthlyPoints, totals)
  return {
    asOf: date(item.asOf, 'asOf'), historyFrom: date(item.historyFrom, 'historyFrom'), historyThrough: date(item.historyThrough, 'historyThrough'),
    monthlyPoints, segments: parsedSegments, totals, coverage,
    limitations: array(item.limitations, 'limitations').map((reason) => nonEmptyString(reason, 'limitation')),
  }
}

function parseMonthlyPoint(value: unknown): FixedCostMonthlyPointDto {
  const item = record(value, 'monthly point')
  return { month: month(item.month, 'month'), totalJpy: integer(item.totalJpy, 'totalJpy', 0), recurringPayeeCount: integer(item.recurringPayeeCount, 'recurringPayeeCount', 0), transactionCount: integer(item.transactionCount, 'transactionCount', 0) }
}
function parseSegment(value: unknown): FixedCostSegmentDto {
  const item = record(value, 'fixed cost segment')
  const segment = enumValue(item.segment, segments, 'segment')
  const monthlyPoints = array(item.monthlyPoints, 'monthlyPoints').map(parseMonthlyPoint)
  validateSixMonths(monthlyPoints)
  const result = {
    segment, monthlyPoints, ...parseComparison(item), latestPaymentOn: item.latestPaymentOn === null ? null : date(item.latestPaymentOn, 'latestPaymentOn'),
    topPayees: array(item.topPayees, 'topPayees').map(parsePayee), reasons: array(item.reasons, 'reasons').map((reason) => nonEmptyString(reason, 'reason')),
  }
  validateObservedComparison(monthlyPoints, result)
  return result
}
function parsePayee(value: unknown): FixedCostPayeeDto {
  const item = record(value, 'fixed cost payee')
  return {
    normalizedPayee: nonEmptyString(item.normalizedPayee, 'normalizedPayee'), displayPayee: nonEmptyString(item.displayPayee, 'displayPayee'),
    expenseCategoryNames: array(item.expenseCategoryNames, 'expenseCategoryNames').map((name) => nonEmptyString(name, 'expenseCategoryName')),
    cadence: enumValue(item.cadence, cadences, 'cadence'), typicalAmountJpy: integer(item.typicalAmountJpy, 'typicalAmountJpy', 1), latestAmountJpy: integer(item.latestAmountJpy, 'latestAmountJpy', 1),
    latestPaymentOn: date(item.latestPaymentOn, 'latestPaymentOn'), occurrenceCount: integer(item.occurrenceCount, 'occurrenceCount', 3), confidenceBps: integer(item.confidenceBps, 'confidenceBps', 0, 10_000),
    reasons: array(item.reasons, 'reasons').map((reason) => nonEmptyString(reason, 'reason')),
  }
}
function parseComparison(value: unknown): FixedCostTotalsDto {
  const item = record(value, 'fixed cost comparison')
  const result = {
    recentThreeAverageJpy: integer(item.recentThreeAverageJpy, 'recentThreeAverageJpy', 0), previousThreeAverageJpy: integer(item.previousThreeAverageJpy, 'previousThreeAverageJpy', 0),
    changeJpy: integer(item.changeJpy, 'changeJpy'), changeRateBps: item.changeRateBps === null ? null : integer(item.changeRateBps, 'changeRateBps'), annualizedJpy: integer(item.annualizedJpy, 'annualizedJpy', 0),
    recurringPayeeCount: integer(item.recurringPayeeCount, 'recurringPayeeCount', 0), transactionCount: integer(item.transactionCount, 'transactionCount', 0),
  }
  if (result.changeJpy !== result.recentThreeAverageJpy - result.previousThreeAverageJpy) throw new TypeError('fixed cost comparison')
  return result
}
function parseTotals(value: unknown): FixedCostTotalsDto { return parseComparison(value) }
function parseCoverage(value: unknown): FixedCostCoverageDto {
  const item = record(value, 'fixed cost coverage')
  return { completeMonthCount: integer(item.completeMonthCount, 'completeMonthCount', 0), observedMonthCount: integer(item.observedMonthCount, 'observedMonthCount', 0), confirmedTransactionCount: integer(item.confirmedTransactionCount, 'confirmedTransactionCount', 0), recurringTransactionCount: integer(item.recurringTransactionCount, 'recurringTransactionCount', 0), unclassifiedRecurringPayeeCount: integer(item.unclassifiedRecurringPayeeCount, 'unclassifiedRecurringPayeeCount', 0) }
}
function record(value: unknown, field: string): Record<string, unknown> { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(field); return value as Record<string, unknown> }
function array(value: unknown, field: string): readonly unknown[] { if (!Array.isArray(value)) throw new TypeError(field); return value }
function nonEmptyString(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new TypeError(field); return value }
function date(value: unknown, field: string): string { const parsed = nonEmptyString(value, field); if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) throw new TypeError(field); return parsed }
function month(value: unknown, field: string): string { const parsed = nonEmptyString(value, field); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(parsed)) throw new TypeError(field); return parsed }
function integer(value: unknown, field: string, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new TypeError(field); return value as number }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T { if (typeof value !== 'string' || !allowed.includes(value as T)) throw new TypeError(field); return value as T }
function validateSixMonths(points: readonly FixedCostMonthlyPointDto[]): void {
  if (points.length !== 6 || new Set(points.map((point) => point.month)).size !== 6) throw new TypeError('monthlyPoints')
  const serials = points.map((point) => Number(point.month.slice(0, 4)) * 12 + Number(point.month.slice(5)) - 1)
  if (serials.some((serial, index) => index > 0 && serial !== serials[index - 1] + 1)) throw new TypeError('monthlyPoints')
}
function validateObservedComparison(points: readonly FixedCostMonthlyPointDto[], comparison: FixedCostTotalsDto): void {
  const average = (values: readonly FixedCostMonthlyPointDto[]) => Math.trunc(values.reduce((sum, point) => sum + point.totalJpy, 0) / 3)
  const previous = average(points.slice(0, 3)); const recent = average(points.slice(3)); const change = recent - previous
  const rate = previous === 0 ? null : Math.max(-2_147_483_648, Math.min(2_147_483_647, Math.trunc(change * 10_000 / previous)))
  if (comparison.previousThreeAverageJpy !== previous || comparison.recentThreeAverageJpy !== recent || comparison.changeJpy !== change || comparison.changeRateBps !== rate) throw new TypeError('fixed cost observed comparison')
}
