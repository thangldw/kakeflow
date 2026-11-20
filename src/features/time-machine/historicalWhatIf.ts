import type { CategoryHistoryDto } from '../../platform/types'

/** Percent less spent, per category id (whole numbers 0–100). Categories not listed are unchanged. */
export type Reductions = Readonly<Record<string, number>>

export interface WhatIfCategory {
  readonly accountId: string
  readonly name: string
  readonly spentJpy: number
  readonly reductionPercent: number
  readonly savedJpy: number
}

export interface WhatIfResult {
  /** The months the calculation covers, oldest first (the most recent `windowMonths` of the history). */
  readonly months: readonly string[]
  readonly categories: readonly WhatIfCategory[]
  readonly totalSpentJpy: number
  readonly totalSavedJpy: number
  readonly averageSavedPerMonthJpy: number
  /** Running total of what would have been kept, one entry per month. */
  readonly cumulativeSavedJpy: readonly number[]
}

/**
 * "What if I had spent X% less on this category over the last N months" — plain arithmetic on the real
 * posted history. It does not predict anything, and refunds (months where a category nets below zero)
 * count as no spending rather than as negative savings. Amounts are floored to whole yen.
 */
export function historicalWhatIf(history: CategoryHistoryDto, reductions: Reductions, windowMonths: number): WhatIfResult {
  if (!Number.isInteger(windowMonths) || windowMonths < 1 || windowMonths > history.months.length) {
    throw new RangeError('windowMonths must be between 1 and the months in the history')
  }
  const start = history.months.length - windowMonths
  const months = history.months.slice(start)
  const cumulative = new Array<number>(months.length).fill(0)
  let totalSpent = 0
  let totalSaved = 0
  const categories = history.categories.map((row): WhatIfCategory => {
    const raw = reductions[row.accountId] ?? 0
    if (!Number.isInteger(raw) || raw < 0 || raw > 100) throw new RangeError('reduction must be a whole percent from 0 to 100')
    let spent = 0
    let saved = 0
    row.monthlyJpy.slice(start).forEach((amount, index) => {
      const positive = Math.max(0, amount)
      spent += positive
      const keep = Math.floor((positive * raw) / 100)
      saved += keep
      cumulative[index] += keep
    })
    totalSpent += spent
    totalSaved += saved
    return { accountId: row.accountId, name: row.name, spentJpy: spent, reductionPercent: raw, savedJpy: saved }
  })
  let running = 0
  const cumulativeSavedJpy = cumulative.map((value) => (running += value))
  return {
    months, categories, totalSpentJpy: totalSpent, totalSavedJpy: totalSaved,
    averageSavedPerMonthJpy: Math.floor(totalSaved / months.length), cumulativeSavedJpy,
  }
}
