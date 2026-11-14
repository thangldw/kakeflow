import type { DashboardExpenseCategoryDto, MonthlyCategoryBudgetDto } from '../../platform/types'

export interface RemainingToSpend {
  readonly basis: 'BUDGET' | 'INCOME_MINUS_EXPENSE'
  readonly budgetMonth: string | null
  readonly totalBudgetJpy: number
  readonly spentJpy: number
  readonly unbudgetedSpentJpy: number
  readonly remainingJpy: number
  readonly overByJpy: number
  readonly usedRatio: number
  readonly perDayJpy: number | null
  readonly mostOver: { readonly name: string; readonly overJpy: number } | null
}

/** Calendar date (YYYY-MM-DD) in Asia/Tokyo. */
export function tokyoDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

/** Days remaining in the month of `today` (YYYY-MM-DD), counting today. */
export function daysLeftInMonth(today: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today)
  if (!match) return 1
  const year = Number(match[1])
  const monthNumber = Number(match[2])
  const day = Number(match[3])
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return Math.max(1, lastDay - day + 1)
}

/** The `count` months before `month` (YYYY-MM), nearest first; `month` itself is excluded. */
export function previousMonths(month: string, count: number): readonly string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return []
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const months: string[] = []
  for (let step = 1; step <= count; step += 1) {
    const date = new Date(Date.UTC(year, monthIndex - step, 1))
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function computeRemainingToSpend(input: {
  month: string
  today: string
  budgetMonth: string | null
  budgets: readonly MonthlyCategoryBudgetDto[]
  categoryActuals: readonly DashboardExpenseCategoryDto[]
  expenseJpy: number
  incomeJpy: number
}): RemainingToSpend {
  const spentJpy = finite(input.expenseJpy)
  const incomeJpy = finite(input.incomeJpy)

  if (input.budgets.length === 0) {
    const remainingJpy = incomeJpy - spentJpy
    return {
      basis: 'INCOME_MINUS_EXPENSE',
      budgetMonth: null,
      totalBudgetJpy: 0,
      spentJpy,
      unbudgetedSpentJpy: 0,
      remainingJpy,
      overByJpy: Math.max(0, -remainingJpy),
      usedRatio: 0,
      perDayJpy: null,
      mostOver: null,
    }
  }

  // categoryActuals is the single source of per-category spending (not budgets[].actualJpy).
  const actualByCategory = new Map<string, number>()
  for (const item of input.categoryActuals) {
    actualByCategory.set(item.accountId, (actualByCategory.get(item.accountId) ?? 0) + finite(item.amountJpy))
  }

  let totalBudgetJpy = 0
  let budgetedActualJpy = 0
  let mostOver: { name: string; overJpy: number } | null = null
  const seen = new Set<string>()
  for (const row of input.budgets) {
    const budgetJpy = finite(row.budgetJpy)
    totalBudgetJpy += budgetJpy
    if (seen.has(row.categoryAccountId)) continue
    seen.add(row.categoryAccountId)
    const actualJpy = actualByCategory.get(row.categoryAccountId) ?? 0
    budgetedActualJpy += actualJpy
    const overJpy = actualJpy - budgetJpy
    if (overJpy > 0 && (mostOver === null || overJpy > mostOver.overJpy)) {
      mostOver = { name: row.categoryName, overJpy }
    }
  }

  const remainingJpy = totalBudgetJpy - spentJpy
  const usedRatio = totalBudgetJpy > 0 ? Math.min(1, Math.max(0, spentJpy / totalBudgetJpy)) : spentJpy > 0 ? 1 : 0
  const isPastMonth = input.month < input.today.slice(0, 7)
  const perDayJpy = !isPastMonth && remainingJpy >= 0 ? Math.floor(remainingJpy / daysLeftInMonth(input.today)) : null

  return {
    basis: 'BUDGET',
    budgetMonth: input.budgetMonth ?? input.month,
    totalBudgetJpy,
    spentJpy,
    unbudgetedSpentJpy: Math.max(0, spentJpy - budgetedActualJpy),
    remainingJpy,
    overByJpy: Math.max(0, -remainingJpy),
    usedRatio,
    perDayJpy,
    mostOver,
  }
}
