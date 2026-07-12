import { invoke as tauriInvoke } from '@tauri-apps/api/core'

export interface ForecastActionRequestDto {
  readonly householdId: string
  readonly accountGroupId?: string | null
  readonly asOf: string
}

export type ActionPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type ActionKind =
  | 'IMPORT_REVIEW'
  | 'IMPORT_FAILED'
  | 'CARD_MISMATCH'
  | 'CARD_PAYMENT_DUE'
  | 'BUDGET_OVERRUN'
  | 'GOAL_DUE'
  | 'SPENDING_ANOMALY'
  | 'RECURRING_PRICE_CHANGE'

export interface ForecastAssumptionsDto {
  readonly historyFrom: string
  readonly historyThrough: string
  readonly historyMonths: number
  readonly averageMonthlyIncomeJpy: number
  readonly averageMonthlyExpenseJpy: number
  readonly averageMonthlyNonRecurringExpenseJpy: number
  readonly averageMonthlyCashChangeBeforeCardPaymentsJpy: number
  readonly recurringMonthlyExpenseJpy: number
  readonly recurringItemCount: number
  readonly reasons: readonly string[]
}

export interface ForecastMonthDto {
  readonly month: string
  readonly openingCashJpy: number
  readonly projectedIncomeJpy: number
  readonly projectedNonRecurringExpenseJpy: number
  readonly projectedRecurringExpenseJpy: number
  readonly projectedSavingsJpy: number
  readonly projectedCashChangeBeforeCardPaymentsJpy: number
  readonly knownCardPaymentsJpy: number
  readonly projectedCashChangeJpy: number
  readonly closingCashJpy: number
}

export interface ActionItemDto {
  readonly id: string
  readonly kind: ActionKind
  readonly priority: ActionPriority
  readonly title: string
  readonly detail: string
  readonly dueOn: string | null
  readonly amountJpy: number | null
  readonly entityId: string | null
  readonly reasons: readonly string[]
}

export interface ForecastActionDto {
  readonly asOf: string
  readonly forecastFrom: string
  readonly forecastThrough: string
  readonly openingCashJpy: number
  readonly assumptions: ForecastAssumptionsDto
  readonly months: readonly ForecastMonthDto[]
  readonly actions: readonly ActionItemDto[]
}

export type ForecastActionInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export function createForecastActionPlatform(invoke: ForecastActionInvoke = tauriInvoke): {
  query(request: ForecastActionRequestDto): Promise<ForecastActionDto>
} {
  return {
    query: async (request) => parseForecastAction(await invoke('forecast_action_query', { request })),
  }
}

export function parseForecastAction(value: unknown): ForecastActionDto {
  const item = record(value, 'forecast action')
  const months = array(item.months, 'months').map(parseForecastMonth)
  if (months.length !== 3) throw new TypeError('months')
  return {
    asOf: isoDate(item.asOf, 'asOf'),
    forecastFrom: month(item.forecastFrom, 'forecastFrom'),
    forecastThrough: month(item.forecastThrough, 'forecastThrough'),
    openingCashJpy: integer(item.openingCashJpy, 'openingCashJpy'),
    assumptions: parseAssumptions(item.assumptions),
    months,
    actions: array(item.actions, 'actions').map(parseAction),
  }
}

function parseAssumptions(value: unknown): ForecastAssumptionsDto {
  const item = record(value, 'assumptions')
  return {
    historyFrom: month(item.historyFrom, 'historyFrom'),
    historyThrough: month(item.historyThrough, 'historyThrough'),
    historyMonths: integer(item.historyMonths, 'historyMonths', 1, 36),
    averageMonthlyIncomeJpy: integer(item.averageMonthlyIncomeJpy, 'averageMonthlyIncomeJpy', 0),
    averageMonthlyExpenseJpy: integer(item.averageMonthlyExpenseJpy, 'averageMonthlyExpenseJpy', 0),
    averageMonthlyNonRecurringExpenseJpy: integer(item.averageMonthlyNonRecurringExpenseJpy, 'averageMonthlyNonRecurringExpenseJpy', 0),
    averageMonthlyCashChangeBeforeCardPaymentsJpy: integer(item.averageMonthlyCashChangeBeforeCardPaymentsJpy, 'averageMonthlyCashChangeBeforeCardPaymentsJpy'),
    recurringMonthlyExpenseJpy: integer(item.recurringMonthlyExpenseJpy, 'recurringMonthlyExpenseJpy', 0),
    recurringItemCount: integer(item.recurringItemCount, 'recurringItemCount', 0),
    reasons: strings(item.reasons, 'assumption reasons'),
  }
}

function parseForecastMonth(value: unknown): ForecastMonthDto {
  const item = record(value, 'forecast month')
  return {
    month: month(item.month, 'month'),
    openingCashJpy: integer(item.openingCashJpy, 'openingCashJpy'),
    projectedIncomeJpy: integer(item.projectedIncomeJpy, 'projectedIncomeJpy', 0),
    projectedNonRecurringExpenseJpy: integer(item.projectedNonRecurringExpenseJpy, 'projectedNonRecurringExpenseJpy', 0),
    projectedRecurringExpenseJpy: integer(item.projectedRecurringExpenseJpy, 'projectedRecurringExpenseJpy', 0),
    projectedSavingsJpy: integer(item.projectedSavingsJpy, 'projectedSavingsJpy'),
    projectedCashChangeBeforeCardPaymentsJpy: integer(item.projectedCashChangeBeforeCardPaymentsJpy, 'projectedCashChangeBeforeCardPaymentsJpy'),
    knownCardPaymentsJpy: integer(item.knownCardPaymentsJpy, 'knownCardPaymentsJpy', 0),
    projectedCashChangeJpy: integer(item.projectedCashChangeJpy, 'projectedCashChangeJpy'),
    closingCashJpy: integer(item.closingCashJpy, 'closingCashJpy'),
  }
}

function parseAction(value: unknown): ActionItemDto {
  const item = record(value, 'action')
  const kind = oneOf(item.kind, 'kind', ['IMPORT_REVIEW', 'IMPORT_FAILED', 'CARD_MISMATCH', 'CARD_PAYMENT_DUE', 'BUDGET_OVERRUN', 'GOAL_DUE', 'SPENDING_ANOMALY', 'RECURRING_PRICE_CHANGE'] as const)
  const priority = oneOf(item.priority, 'priority', ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const)
  return {
    id: text(item.id, 'id'),
    kind,
    priority,
    title: text(item.title, 'title'),
    detail: text(item.detail, 'detail'),
    dueOn: nullableDate(item.dueOn, 'dueOn'),
    amountJpy: nullableInteger(item.amountJpy, 'amountJpy', 0),
    entityId: nullableText(item.entityId, 'entityId'),
    reasons: strings(item.reasons, 'action reasons'),
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(field)
  return value as Record<string, unknown>
}
function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(field)
  return value
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(field)
  return value
}
function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field)
}
function isoDate(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new TypeError(field)
  return result
}
function nullableDate(value: unknown, field: string): string | null {
  return value === null ? null : isoDate(value, field)
}
function month(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) throw new TypeError(field)
  return result
}
function integer(value: unknown, field: string, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new TypeError(field)
  return value as number
}
function nullableInteger(value: unknown, field: string, minimum = Number.MIN_SAFE_INTEGER): number | null {
  return value === null ? null : integer(value, field, minimum)
}
function strings(value: unknown, field: string): readonly string[] {
  return array(value, field).map((item) => text(item, field))
}
function oneOf<const T extends readonly string[]>(value: unknown, field: string, allowed: T): T[number] {
  const result = text(value, field)
  if (!allowed.includes(result)) throw new TypeError(field)
  return result as T[number]
}
