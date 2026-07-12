import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { AttributionScopeDto } from '../../platform/types'

export interface FinancialCalendarRequest {
  readonly householdId: string
  readonly accountGroupId?: string | null
  readonly attributionScope: AttributionScopeDto
  readonly month: string
  readonly asOf?: string
}

export type MonthlyFinancialReportRequest = FinancialCalendarRequest

export interface YearlyFinancialReportRequest {
  readonly householdId: string
  readonly accountGroupId?: string | null
  readonly attributionScope: AttributionScopeDto
  readonly year: string
  readonly asOf?: string
}

export type FinancialCalendarEventKind =
  | 'CASH_INFLOW'
  | 'CASH_OUTFLOW'
  | 'CARD_CLOSING'
  | 'CARD_PAYMENT_DUE'
  | 'CARD_PAYMENT'

export interface FinancialCalendarEventDto {
  readonly kind: FinancialCalendarEventKind
  readonly id: string
  readonly title: string
  readonly amountJpy: number
  readonly status: string | null
}

export interface FinancialCalendarDayDto {
  readonly date: string
  readonly accrualIncomeJpy: number
  readonly accrualExpenseJpy: number
  readonly cashInflowJpy: number
  readonly cashOutflowJpy: number
  readonly postedTransactionCount: number
  readonly noSpendDay: boolean
  readonly events: readonly FinancialCalendarEventDto[]
}

export interface BudgetStatusDto {
  readonly budgetJpy: number
  readonly actualJpy: number
  readonly remainingJpy: number
  readonly utilizationBps: number | null
  readonly categoryCount: number
  readonly overBudgetCount: number
}

export interface GoalProgressSummaryDto {
  readonly activeCount: number
  readonly targetJpy: number
  readonly savedJpy: number
  readonly remainingJpy: number
  readonly dueWithinPeriodCount: number
}

export interface DataQualitySummaryDto {
  readonly totalImports: number
  readonly postedImports: number
  readonly reviewRequiredImports: number
  readonly failedImports: number
  readonly inProgressImports: number
  readonly importCompletionBps: number | null
  readonly latestImportedAt: string | null
  readonly staleDays: number | null
  readonly hasUnresolvedImports: boolean
}

export interface FinancialCalendarDto {
  readonly month: string
  readonly asOf: string
  readonly days: readonly FinancialCalendarDayDto[]
  readonly budget: BudgetStatusDto
  readonly goals: GoalProgressSummaryDto
  readonly dataQuality: DataQualitySummaryDto
}

export interface PeriodMetricsDto {
  readonly incomeJpy: number
  readonly expenseJpy: number
  readonly savingsJpy: number
  readonly savingsRateBps: number | null
  readonly postedTransactionCount: number
}

export interface MetricDeltaDto {
  readonly amountJpy: number
  readonly rateBps: number | null
}

export interface MetricDeltaSetDto {
  readonly income: MetricDeltaDto
  readonly expense: MetricDeltaDto
  readonly savings: MetricDeltaDto
}

export interface CategoryDriverDto {
  readonly id: string
  readonly name: string
  readonly currentJpy: number
  readonly previousJpy: number
  readonly deltaJpy: number
}

export interface MerchantDriverDto {
  readonly merchant: string
  readonly currentJpy: number
  readonly previousJpy: number
  readonly deltaJpy: number
}

export interface ReconciliationSummaryDto {
  readonly totalStatements: number
  readonly fullyReconciled: number
  readonly possibleMatches: number
  readonly partiallyReconciled: number
  readonly unmatched: number
  readonly mismatchCount: number
  readonly paymentTotalJpy: number
}

export interface MonthlyFinancialReportDto {
  readonly period: string
  readonly current: PeriodMetricsDto
  readonly priorMonth: PeriodMetricsDto
  readonly priorYear: PeriodMetricsDto
  readonly vsPriorMonth: MetricDeltaSetDto
  readonly vsPriorYear: MetricDeltaSetDto
  readonly topCategoryDrivers: readonly CategoryDriverDto[]
  readonly topMerchantDrivers: readonly MerchantDriverDto[]
  readonly budget: BudgetStatusDto
  readonly goals: GoalProgressSummaryDto
  readonly dataQuality: DataQualitySummaryDto
  readonly reconciliation: ReconciliationSummaryDto
}

export interface MonthlyReportPointDto extends PeriodMetricsDto {
  readonly month: string
}

export interface YearlyFinancialReportDto {
  readonly period: string
  readonly current: PeriodMetricsDto
  readonly priorYear: PeriodMetricsDto
  readonly vsPriorYear: MetricDeltaSetDto
  readonly months: readonly MonthlyReportPointDto[]
  readonly topCategoryDrivers: readonly CategoryDriverDto[]
  readonly topMerchantDrivers: readonly MerchantDriverDto[]
  readonly budget: BudgetStatusDto
  readonly goals: GoalProgressSummaryDto
  readonly dataQuality: DataQualitySummaryDto
  readonly reconciliation: ReconciliationSummaryDto
}

export type FinancialCalendarInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function createFinancialCalendarPlatform(invoke: FinancialCalendarInvoke = tauriInvoke) {
  return {
    getCalendar: async (request: FinancialCalendarRequest): Promise<FinancialCalendarDto> =>
      parseCalendar(await invoke('financial_calendar_query', { request })),
    getMonthlyReport: async (request: MonthlyFinancialReportRequest): Promise<MonthlyFinancialReportDto> =>
      parseMonthlyReport(await invoke('financial_report_monthly_query', { request })),
    getYearlyReport: async (request: YearlyFinancialReportRequest): Promise<YearlyFinancialReportDto> =>
      parseYearlyReport(await invoke('financial_report_yearly_query', { request })),
  }
}

function parseCalendar(value: unknown): FinancialCalendarDto {
  const item = record(value, 'financial calendar')
  stringValue(item.month, 'financial calendar month')
  stringValue(item.asOf, 'financial calendar as-of date')
  const days = arrayValue(item.days, 'financial calendar days').map((value) => {
    const day = record(value, 'financial calendar day')
    stringValue(day.date, 'financial calendar date')
    integers(day, ['accrualIncomeJpy', 'accrualExpenseJpy', 'cashInflowJpy', 'cashOutflowJpy', 'postedTransactionCount'], 'financial calendar day')
    booleanValue(day.noSpendDay, 'financial calendar no-spend flag')
    const events = arrayValue(day.events, 'financial calendar events').map(parseEvent)
    return { ...day, events } as unknown as FinancialCalendarDayDto
  })
  return {
    month: item.month as string,
    asOf: item.asOf as string,
    days,
    budget: parseBudget(item.budget),
    goals: parseGoals(item.goals),
    dataQuality: parseDataQuality(item.dataQuality),
  }
}

function parseEvent(value: unknown): FinancialCalendarEventDto {
  const item = record(value, 'financial calendar event')
  if (!['CASH_INFLOW', 'CASH_OUTFLOW', 'CARD_CLOSING', 'CARD_PAYMENT_DUE', 'CARD_PAYMENT'].includes(String(item.kind))) throw new TypeError('financial calendar event kind')
  stringValue(item.id, 'financial calendar event id')
  stringValue(item.title, 'financial calendar event title')
  integerValue(item.amountJpy, 'financial calendar event amount')
  nullableString(item.status, 'financial calendar event status')
  return item as unknown as FinancialCalendarEventDto
}

function parseMonthlyReport(value: unknown): MonthlyFinancialReportDto {
  const item = record(value, 'monthly financial report')
  stringValue(item.period, 'monthly financial report period')
  return {
    period: item.period as string,
    current: parseMetrics(item.current),
    priorMonth: parseMetrics(item.priorMonth),
    priorYear: parseMetrics(item.priorYear),
    vsPriorMonth: parseDeltaSet(item.vsPriorMonth),
    vsPriorYear: parseDeltaSet(item.vsPriorYear),
    topCategoryDrivers: arrayValue(item.topCategoryDrivers, 'category drivers').map(parseCategoryDriver),
    topMerchantDrivers: arrayValue(item.topMerchantDrivers, 'merchant drivers').map(parseMerchantDriver),
    budget: parseBudget(item.budget),
    goals: parseGoals(item.goals),
    dataQuality: parseDataQuality(item.dataQuality),
    reconciliation: parseReconciliation(item.reconciliation),
  }
}

function parseYearlyReport(value: unknown): YearlyFinancialReportDto {
  const item = record(value, 'yearly financial report')
  stringValue(item.period, 'yearly financial report period')
  const months = arrayValue(item.months, 'yearly financial report months').map((value) => {
    const month = record(value, 'monthly report point')
    stringValue(month.month, 'monthly report point month')
    return { month: month.month as string, ...parseMetrics(month) }
  })
  return {
    period: item.period as string,
    current: parseMetrics(item.current),
    priorYear: parseMetrics(item.priorYear),
    vsPriorYear: parseDeltaSet(item.vsPriorYear),
    months,
    topCategoryDrivers: arrayValue(item.topCategoryDrivers, 'category drivers').map(parseCategoryDriver),
    topMerchantDrivers: arrayValue(item.topMerchantDrivers, 'merchant drivers').map(parseMerchantDriver),
    budget: parseBudget(item.budget),
    goals: parseGoals(item.goals),
    dataQuality: parseDataQuality(item.dataQuality),
    reconciliation: parseReconciliation(item.reconciliation),
  }
}

function parseMetrics(value: unknown): PeriodMetricsDto {
  const item = record(value, 'period metrics')
  integers(item, ['incomeJpy', 'expenseJpy', 'savingsJpy', 'postedTransactionCount'], 'period metrics')
  nullableInteger(item.savingsRateBps, 'period savings rate')
  return item as unknown as PeriodMetricsDto
}

function parseDeltaSet(value: unknown): MetricDeltaSetDto {
  const item = record(value, 'metric deltas')
  return { income: parseDelta(item.income), expense: parseDelta(item.expense), savings: parseDelta(item.savings) }
}

function parseDelta(value: unknown): MetricDeltaDto {
  const item = record(value, 'metric delta')
  integerValue(item.amountJpy, 'metric delta amount')
  nullableInteger(item.rateBps, 'metric delta rate')
  return item as unknown as MetricDeltaDto
}

function parseCategoryDriver(value: unknown): CategoryDriverDto {
  const item = record(value, 'category driver')
  stringValue(item.id, 'category driver id'); stringValue(item.name, 'category driver name')
  integers(item, ['currentJpy', 'previousJpy', 'deltaJpy'], 'category driver')
  return item as unknown as CategoryDriverDto
}

function parseMerchantDriver(value: unknown): MerchantDriverDto {
  const item = record(value, 'merchant driver')
  stringValue(item.merchant, 'merchant driver name')
  integers(item, ['currentJpy', 'previousJpy', 'deltaJpy'], 'merchant driver')
  return item as unknown as MerchantDriverDto
}

function parseBudget(value: unknown): BudgetStatusDto {
  const item = record(value, 'budget status')
  integers(item, ['budgetJpy', 'actualJpy', 'remainingJpy', 'categoryCount', 'overBudgetCount'], 'budget status')
  nullableInteger(item.utilizationBps, 'budget utilization')
  return item as unknown as BudgetStatusDto
}

function parseGoals(value: unknown): GoalProgressSummaryDto {
  const item = record(value, 'goal progress')
  integers(item, ['activeCount', 'targetJpy', 'savedJpy', 'remainingJpy', 'dueWithinPeriodCount'], 'goal progress')
  return item as unknown as GoalProgressSummaryDto
}

function parseDataQuality(value: unknown): DataQualitySummaryDto {
  const item = record(value, 'data quality')
  integers(item, ['totalImports', 'postedImports', 'reviewRequiredImports', 'failedImports', 'inProgressImports'], 'data quality')
  nullableInteger(item.importCompletionBps, 'import completion')
  nullableString(item.latestImportedAt, 'latest import timestamp')
  nullableInteger(item.staleDays, 'data staleness')
  booleanValue(item.hasUnresolvedImports, 'unresolved import flag')
  return item as unknown as DataQualitySummaryDto
}

function parseReconciliation(value: unknown): ReconciliationSummaryDto {
  const item = record(value, 'reconciliation summary')
  integers(item, ['totalStatements', 'fullyReconciled', 'possibleMatches', 'partiallyReconciled', 'unmatched', 'mismatchCount', 'paymentTotalJpy'], 'reconciliation summary')
  return item as unknown as ReconciliationSummaryDto
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label)
  return value as Record<string, unknown>
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(label)
  return value
}

function integers(item: Record<string, unknown>, keys: readonly string[], label: string) {
  for (const key of keys) integerValue(item[key], label)
}

function integerValue(value: unknown, label: string) {
  if (!Number.isSafeInteger(value)) throw new TypeError(label)
}

function nullableInteger(value: unknown, label: string) {
  if (value !== null) integerValue(value, label)
}

function stringValue(value: unknown, label: string) {
  if (typeof value !== 'string') throw new TypeError(label)
}

function nullableString(value: unknown, label: string) {
  if (value !== null) stringValue(value, label)
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new TypeError(label)
}
