import type { ForecastMonthDto } from './forecastActionPlatform'

export interface ScenarioAdjustments {
  /** Change applied to projected income in every forecast month. */
  readonly monthlyIncomeDeltaJpy: number
  /** Change applied to projected spending in every forecast month (positive = spend more). */
  readonly monthlyExpenseDeltaJpy: number
  /** One-time outflow applied in the first forecast month. */
  readonly oneTimeOutflowJpy: number
}

export interface ScenarioMonth {
  readonly month: string
  readonly baselineClosingCashJpy: number
  readonly scenarioClosingCashJpy: number
  readonly deltaJpy: number
}

export interface ScenarioResult {
  readonly months: readonly ScenarioMonth[]
  readonly lowestClosingCashJpy: number | null
  readonly lowestMonth: string | null
  readonly firstNegativeMonth: string | null
  readonly endingDeltaJpy: number
}

/**
 * Applies what-if deltas on top of an already computed forecast. Baseline
 * assumptions (history, recurring items, known card payments) are not
 * recomputed, so the result is a read-only sensitivity view, never a ledger fact.
 */
export function projectScenario(months: readonly ForecastMonthDto[], adjustments: ScenarioAdjustments): ScenarioResult {
  for (const [name, value] of Object.entries(adjustments)) {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a whole-yen integer`)
  }
  if (adjustments.oneTimeOutflowJpy < 0) throw new RangeError('oneTimeOutflowJpy must not be negative')
  const perMonth = adjustments.monthlyIncomeDeltaJpy - adjustments.monthlyExpenseDeltaJpy
  let cumulative = 0
  const projected = months.map((month, index): ScenarioMonth => {
    cumulative += perMonth - (index === 0 ? adjustments.oneTimeOutflowJpy : 0)
    return {
      month: month.month, baselineClosingCashJpy: month.closingCashJpy,
      scenarioClosingCashJpy: month.closingCashJpy + cumulative, deltaJpy: cumulative,
    }
  })
  const lowest = projected.reduce<ScenarioMonth | null>((low, item) => (low == null || item.scenarioClosingCashJpy < low.scenarioClosingCashJpy ? item : low), null)
  return {
    months: projected,
    lowestClosingCashJpy: lowest?.scenarioClosingCashJpy ?? null,
    lowestMonth: lowest?.month ?? null,
    firstNegativeMonth: projected.find((item) => item.scenarioClosingCashJpy < 0)?.month ?? null,
    endingDeltaJpy: projected.at(-1)?.deltaJpy ?? 0,
  }
}
