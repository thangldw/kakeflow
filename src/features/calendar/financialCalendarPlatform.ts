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
  readonly asOf: string
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

export type AnnualMonthStatusDto = 'COMPLETE' | 'PARTIAL' | 'FUTURE'

export interface AnnualMonthPointDto extends PeriodMetricsDto {
  readonly month: string
  readonly status: AnnualMonthStatusDto
}

export interface YearlyFinancialReportDto {
  readonly period: string
  readonly asOf: string
  readonly throughMonth: string | null
  readonly completedMonthCount: number
  readonly isCompleteYear: boolean
  readonly currentComparable: PeriodMetricsDto
  readonly priorYearComparable: PeriodMetricsDto
  readonly vsPriorYearComparable: MetricDeltaSetDto
  readonly current: PeriodMetricsDto
  readonly priorYear: PeriodMetricsDto
  readonly vsPriorYear: MetricDeltaSetDto
  readonly months: readonly AnnualMonthPointDto[]
  readonly topCategoryDrivers: readonly CategoryDriverDto[]
  readonly topMerchantDrivers: readonly MerchantDriverDto[]
  readonly budget: BudgetStatusDto
  readonly goals: GoalProgressSummaryDto
  readonly dataQuality: DataQualitySummaryDto
  readonly reconciliation: ReconciliationSummaryDto
}

export interface AnnualReviewCsvDto {
  readonly fileName: string
  readonly mediaType: 'text/csv;charset=utf-8'
  readonly rowCount: number
  readonly byteSize: number
  readonly utf8BomCsv: string
}

export interface AnnualReviewCsvSavedDto {
  readonly fileName: string
  readonly rowCount: number
  readonly byteSize: number
}

export interface MonthlyReviewCsvDto {
  readonly fileName: string
  readonly mediaType: 'text/csv;charset=utf-8'
  readonly rowCount: number
  readonly byteSize: number
  readonly utf8BomCsv: string
}

export interface MonthlyReviewCsvSavedDto {
  readonly fileName: string
  readonly rowCount: number
  readonly byteSize: number
}

export interface AnnualReviewXlsxSavedDto {
  readonly fileName: string
  readonly rowCount: number
  readonly byteSize: number
}

export interface AnnualReviewPdfSavedDto {
  readonly fileName: string
  readonly pageCount: number
  readonly byteSize: number
}

export interface MonthlyReviewXlsxSavedDto {
  readonly fileName: string
  readonly rowCount: number
  readonly byteSize: number
}

export interface MonthlyReviewPdfSavedDto {
  readonly fileName: string
  readonly pageCount: number
  readonly byteSize: number
}

export type FinancialCalendarInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function createFinancialCalendarPlatform(invoke: FinancialCalendarInvoke = tauriInvoke) {
  return {
    getCalendar: async (request: FinancialCalendarRequest): Promise<FinancialCalendarDto> =>
      parseCalendar(await invoke('financial_calendar_query', { request })),
    getMonthlyReport: async (request: MonthlyFinancialReportRequest): Promise<MonthlyFinancialReportDto> =>
      parseMonthlyReport(await invoke('financial_report_monthly_query', { request })),
    generateMonthlyReviewCsv: async (request: MonthlyFinancialReportRequest): Promise<MonthlyReviewCsvDto> =>
      parseMonthlyReviewCsv(await invoke('monthly_household_review_csv_generate', { request })),
    saveMonthlyReviewCsv: async (request: MonthlyFinancialReportRequest): Promise<MonthlyReviewCsvSavedDto | null> => {
      const value = await invoke('monthly_household_review_csv_save', { request })
      return value === null ? null : parseMonthlyReviewCsvSaved(value)
    },
    saveMonthlyReviewXlsx: async (request: MonthlyFinancialReportRequest): Promise<MonthlyReviewXlsxSavedDto | null> => {
      const value = await invoke('monthly_household_review_xlsx_save', { request })
      return value === null ? null : parseMonthlyReviewXlsxSaved(value)
    },
    saveMonthlyReviewPdf: async (request: MonthlyFinancialReportRequest): Promise<MonthlyReviewPdfSavedDto | null> => {
      const value = await invoke('monthly_household_review_pdf_save', { request })
      return value === null ? null : parseMonthlyReviewPdfSaved(value)
    },
    getYearlyReport: async (request: YearlyFinancialReportRequest): Promise<YearlyFinancialReportDto> =>
      parseYearlyReport(await invoke('financial_report_yearly_query', { request })),
    generateAnnualReviewCsv: async (request: YearlyFinancialReportRequest): Promise<AnnualReviewCsvDto> =>
      parseAnnualReviewCsv(await invoke('annual_household_review_csv_generate', { request })),
    saveAnnualReviewCsv: async (request: YearlyFinancialReportRequest): Promise<AnnualReviewCsvSavedDto | null> => {
      const value = await invoke('annual_household_review_csv_save', { request })
      return value === null ? null : parseAnnualReviewCsvSaved(value)
    },
    saveAnnualReviewXlsx: async (request: YearlyFinancialReportRequest): Promise<AnnualReviewXlsxSavedDto | null> => {
      const value = await invoke('annual_household_review_xlsx_save', { request })
      return value === null ? null : parseAnnualReviewXlsxSaved(value)
    },
    saveAnnualReviewPdf: async (request: YearlyFinancialReportRequest): Promise<AnnualReviewPdfSavedDto | null> => {
      const value = await invoke('annual_household_review_pdf_save', { request })
      return value === null ? null : parseAnnualReviewPdfSaved(value)
    },
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
  monthValue(item.period, 'monthly financial report period')
  dateValue(item.asOf, 'monthly financial report as-of date')
  const report = {
    period: item.period as string,
    asOf: item.asOf as string,
    current: parseAnnualMetrics(item.current),
    priorMonth: parseAnnualMetrics(item.priorMonth),
    priorYear: parseAnnualMetrics(item.priorYear),
    vsPriorMonth: parseDeltaSet(item.vsPriorMonth),
    vsPriorYear: parseDeltaSet(item.vsPriorYear),
    topCategoryDrivers: arrayValue(item.topCategoryDrivers, 'category drivers').map(parseCategoryDriver),
    topMerchantDrivers: arrayValue(item.topMerchantDrivers, 'merchant drivers').map(parseMerchantDriver),
    budget: parseBudget(item.budget),
    goals: parseGoals(item.goals),
    dataQuality: parseDataQuality(item.dataQuality),
    reconciliation: parseReconciliation(item.reconciliation),
  }
  validateDeltaSet(report.current, report.priorMonth, report.vsPriorMonth)
  validateDeltaSet(report.current, report.priorYear, report.vsPriorYear)
  for (const driver of [...report.topCategoryDrivers, ...report.topMerchantDrivers]) {
    if (driver.deltaJpy !== driver.currentJpy - driver.previousJpy) throw new TypeError('monthly financial report driver delta')
  }
  return report
}

function parseYearlyReport(value: unknown): YearlyFinancialReportDto {
  const item = record(value, 'yearly financial report')
  yearValue(item.period, 'yearly financial report period')
  dateValue(item.asOf, 'yearly financial report as-of')
  if (item.throughMonth !== null) monthValue(item.throughMonth, 'yearly financial report through month')
  nonNegativeInteger(item.completedMonthCount, 'yearly financial report completed month count')
  if ((item.completedMonthCount as number) > 12) throw new TypeError('yearly financial report completed month count')
  booleanValue(item.isCompleteYear, 'yearly financial report complete flag')
  const months = arrayValue(item.months, 'yearly financial report months').map((value) => {
    const month = record(value, 'monthly report point')
    monthValue(month.month, 'monthly report point month')
    if (!['COMPLETE', 'PARTIAL', 'FUTURE'].includes(String(month.status))) throw new TypeError('monthly report point status')
    return { month: month.month as string, status: month.status as AnnualMonthStatusDto, ...parseAnnualMetrics(month) }
  })
  validateAnnualWindow(item.period as string, item.throughMonth as string | null, item.completedMonthCount as number, item.isCompleteYear as boolean, months)
  const currentComparable = parseAnnualMetrics(item.currentComparable)
  const priorYearComparable = parseAnnualMetrics(item.priorYearComparable)
  const vsPriorYearComparable = parseDeltaSet(item.vsPriorYearComparable)
  const current = parseAnnualMetrics(item.current)
  const priorYear = parseAnnualMetrics(item.priorYear)
  const vsPriorYear = parseDeltaSet(item.vsPriorYear)
  if (!sameMetrics(currentComparable, current) || !sameMetrics(priorYearComparable, priorYear) || !sameDeltaSet(vsPriorYearComparable, vsPriorYear)) throw new TypeError('yearly financial report legacy aliases')
  validateCurrentMatchesMonths(currentComparable, months)
  validateDeltaSet(currentComparable, priorYearComparable, vsPriorYearComparable)
  const topCategoryDrivers = arrayValue(item.topCategoryDrivers, 'category drivers').map(parseCategoryDriver)
  const topMerchantDrivers = arrayValue(item.topMerchantDrivers, 'merchant drivers').map(parseMerchantDriver)
  if ([...topCategoryDrivers, ...topMerchantDrivers].some((driver) => driver.deltaJpy !== driver.currentJpy - driver.previousJpy)) throw new TypeError('yearly financial report driver')
  return {
    period: item.period as string,
    asOf: item.asOf as string,
    throughMonth: item.throughMonth as string | null,
    completedMonthCount: item.completedMonthCount as number,
    isCompleteYear: item.isCompleteYear as boolean,
    currentComparable, priorYearComparable, vsPriorYearComparable,
    current, priorYear, vsPriorYear,
    months,
    topCategoryDrivers,
    topMerchantDrivers,
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

function parseAnnualMetrics(value: unknown): PeriodMetricsDto {
  const result = parseMetrics(value)
  if (result.postedTransactionCount < 0 || result.savingsJpy !== result.incomeJpy - result.expenseJpy) throw new TypeError('period metrics')
  const expectedRate = result.incomeJpy === 0 ? null : Math.trunc(result.savingsJpy * 10_000 / result.incomeJpy)
  if (result.savingsRateBps !== expectedRate) throw new TypeError('period savings rate')
  return result
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

function yearValue(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) throw new TypeError(label)
}

function monthValue(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new TypeError(label)
}

function dateValue(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new TypeError(label)
}

function nonNegativeInteger(value: unknown, label: string) {
  integerValue(value, label)
  if ((value as number) < 0) throw new TypeError(label)
}

function validateAnnualWindow(period: string, throughMonth: string | null, completedMonthCount: number, isCompleteYear: boolean, months: readonly AnnualMonthPointDto[]) {
  if (months.length !== 12 || months.some((point, index) => point.month !== `${period}-${String(index + 1).padStart(2, '0')}`)) throw new TypeError('yearly financial report months')
  const complete = months.filter((point) => point.status === 'COMPLETE')
  if (complete.length !== completedMonthCount || complete.some((point, index) => point.month !== months[index].month)) throw new TypeError('yearly financial report completed months')
  if ((throughMonth ?? null) !== (complete.at(-1)?.month ?? null) || isCompleteYear !== (completedMonthCount === 12)) throw new TypeError('yearly financial report window')
  const nonComplete = months.slice(completedMonthCount)
  if (!isCompleteYear && (nonComplete[0]?.status !== 'PARTIAL' || nonComplete.slice(1).some((point) => point.status !== 'FUTURE'))) throw new TypeError('yearly financial report month status')
  if (months.filter((point) => point.status === 'FUTURE').some((point) => point.incomeJpy !== 0 || point.expenseJpy !== 0 || point.savingsJpy !== 0 || point.savingsRateBps !== null || point.postedTransactionCount !== 0)) throw new TypeError('yearly financial report future month')
}

function sameMetrics(left: PeriodMetricsDto, right: PeriodMetricsDto) {
  return left.incomeJpy === right.incomeJpy && left.expenseJpy === right.expenseJpy && left.savingsJpy === right.savingsJpy && left.savingsRateBps === right.savingsRateBps && left.postedTransactionCount === right.postedTransactionCount
}

function sameDeltaSet(left: MetricDeltaSetDto, right: MetricDeltaSetDto) {
  return (['income', 'expense', 'savings'] as const).every((key) => left[key].amountJpy === right[key].amountJpy && left[key].rateBps === right[key].rateBps)
}

function validateDeltaSet(current: PeriodMetricsDto, previous: PeriodMetricsDto, deltas: MetricDeltaSetDto) {
  for (const [key, field] of [['income', 'incomeJpy'], ['expense', 'expenseJpy'], ['savings', 'savingsJpy']] as const) {
    const amount = current[field] - previous[field]
    const expectedRate = previous[field] === 0 ? null : Math.trunc(amount * 10_000 / Math.abs(previous[field]))
    if (deltas[key].amountJpy !== amount || deltas[key].rateBps !== expectedRate) throw new TypeError('financial report deltas')
  }
}

function validateCurrentMatchesMonths(current: PeriodMetricsDto, months: readonly AnnualMonthPointDto[]) {
  const complete = months.filter((point) => point.status === 'COMPLETE')
  const incomeJpy = complete.reduce((sum, point) => sum + point.incomeJpy, 0)
  const expenseJpy = complete.reduce((sum, point) => sum + point.expenseJpy, 0)
  const postedTransactionCount = complete.reduce((sum, point) => sum + point.postedTransactionCount, 0)
  if (current.incomeJpy !== incomeJpy || current.expenseJpy !== expenseJpy || current.postedTransactionCount !== postedTransactionCount) throw new TypeError('yearly financial report current total')
}

function parseAnnualReviewCsv(value: unknown): AnnualReviewCsvDto {
  const item = record(value, 'annual review CSV')
  if (item.mediaType !== 'text/csv;charset=utf-8') throw new TypeError('annual review CSV')
  stringValue(item.fileName, 'annual review CSV filename'); nonNegativeInteger(item.rowCount, 'annual review CSV rows'); nonNegativeInteger(item.byteSize, 'annual review CSV bytes'); stringValue(item.utf8BomCsv, 'annual review CSV data')
  if (!(item.utf8BomCsv as string).startsWith('\uFEFF') || new TextEncoder().encode(item.utf8BomCsv as string).byteLength !== item.byteSize) throw new TypeError('annual review CSV')
  return item as unknown as AnnualReviewCsvDto
}

function parseMonthlyReviewCsv(value: unknown): MonthlyReviewCsvDto {
  const item = record(value, 'monthly review CSV')
  if (item.mediaType !== 'text/csv;charset=utf-8') throw new TypeError('monthly review CSV')
  stringValue(item.fileName, 'monthly review CSV filename'); nonNegativeInteger(item.rowCount, 'monthly review CSV rows'); nonNegativeInteger(item.byteSize, 'monthly review CSV bytes'); stringValue(item.utf8BomCsv, 'monthly review CSV data')
  if (!(item.utf8BomCsv as string).startsWith('\uFEFF') || new TextEncoder().encode(item.utf8BomCsv as string).byteLength !== item.byteSize) throw new TypeError('monthly review CSV')
  return item as unknown as MonthlyReviewCsvDto
}

function parseMonthlyReviewCsvSaved(value: unknown): MonthlyReviewCsvSavedDto {
  const item = record(value, 'saved monthly review CSV')
  stringValue(item.fileName, 'saved monthly review CSV filename'); nonNegativeInteger(item.rowCount, 'saved monthly review CSV rows'); nonNegativeInteger(item.byteSize, 'saved monthly review CSV bytes')
  const fileName = item.fileName as string
  if (fileName.length === 0 || fileName.length > 255 || !/\.csv$/i.test(fileName) || /[\\/]/.test(fileName) || Array.from(fileName).some((character) => character.charCodeAt(0) < 32)) throw new TypeError('saved monthly review CSV filename')
  if ((item.rowCount as number) === 0 || (item.byteSize as number) === 0) throw new TypeError('saved monthly review CSV')
  return item as unknown as MonthlyReviewCsvSavedDto
}

function parseAnnualReviewCsvSaved(value: unknown): AnnualReviewCsvSavedDto {
  const item = record(value, 'saved annual review CSV')
  stringValue(item.fileName, 'saved annual review CSV filename'); nonNegativeInteger(item.rowCount, 'saved annual review CSV rows'); nonNegativeInteger(item.byteSize, 'saved annual review CSV bytes')
  return item as unknown as AnnualReviewCsvSavedDto
}

function parseAnnualReviewXlsxSaved(value: unknown): AnnualReviewXlsxSavedDto {
  const item = record(value, 'saved annual review XLSX')
  stringValue(item.fileName, 'saved annual review XLSX filename')
  nonNegativeInteger(item.rowCount, 'saved annual review XLSX rows')
  nonNegativeInteger(item.byteSize, 'saved annual review XLSX bytes')
  const fileName = item.fileName as string
  if (fileName.length === 0 || fileName.length > 255 || !/\.xlsx$/i.test(fileName) || /[\\/]/.test(fileName) || Array.from(fileName).some((character) => character.charCodeAt(0) < 32)) throw new TypeError('saved annual review XLSX filename')
  if ((item.rowCount as number) === 0 || (item.byteSize as number) === 0) throw new TypeError('saved annual review XLSX')
  return item as unknown as AnnualReviewXlsxSavedDto
}

function parseAnnualReviewPdfSaved(value: unknown): AnnualReviewPdfSavedDto {
  const item = record(value, 'saved annual review PDF')
  stringValue(item.fileName, 'saved annual review PDF filename')
  nonNegativeInteger(item.pageCount, 'saved annual review PDF pages')
  nonNegativeInteger(item.byteSize, 'saved annual review PDF bytes')
  const fileName = item.fileName as string
  if (fileName.length === 0 || fileName.length > 255 || !/\.pdf$/i.test(fileName) || /[\\/]/.test(fileName) || Array.from(fileName).some((character) => character.charCodeAt(0) < 32)) throw new TypeError('saved annual review PDF filename')
  if ((item.pageCount as number) === 0 || (item.byteSize as number) === 0) throw new TypeError('saved annual review PDF')
  return item as unknown as AnnualReviewPdfSavedDto
}

function parseMonthlyReviewXlsxSaved(value: unknown): MonthlyReviewXlsxSavedDto {
  const item = record(value, 'saved monthly review XLSX')
  stringValue(item.fileName, 'saved monthly review XLSX filename')
  nonNegativeInteger(item.rowCount, 'saved monthly review XLSX rows')
  nonNegativeInteger(item.byteSize, 'saved monthly review XLSX bytes')
  const fileName = item.fileName as string
  if (fileName.length === 0 || fileName.length > 255 || !/\.xlsx$/i.test(fileName) || /[\\/]/.test(fileName) || Array.from(fileName).some((character) => character.charCodeAt(0) < 32)) throw new TypeError('saved monthly review XLSX filename')
  if ((item.rowCount as number) === 0 || (item.byteSize as number) === 0) throw new TypeError('saved monthly review XLSX')
  return item as unknown as MonthlyReviewXlsxSavedDto
}

function parseMonthlyReviewPdfSaved(value: unknown): MonthlyReviewPdfSavedDto {
  const item = record(value, 'saved monthly review PDF')
  stringValue(item.fileName, 'saved monthly review PDF filename')
  nonNegativeInteger(item.pageCount, 'saved monthly review PDF pages')
  nonNegativeInteger(item.byteSize, 'saved monthly review PDF bytes')
  const fileName = item.fileName as string
  if (fileName.length === 0 || fileName.length > 255 || !/\.pdf$/i.test(fileName) || /[\\/]/.test(fileName) || Array.from(fileName).some((character) => character.charCodeAt(0) < 32)) throw new TypeError('saved monthly review PDF filename')
  if ((item.pageCount as number) === 0 || (item.byteSize as number) === 0) throw new TypeError('saved monthly review PDF')
  return item as unknown as MonthlyReviewPdfSavedDto
}
