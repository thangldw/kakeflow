import { categoryData } from './data'

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

export const currentMonthMetrics = {
  income: 652_800,
  expense: sum(categoryData.map((category) => category.amount)),
  budget: 430_000,
  netWorth: 8_246_320,
  cashOutflow: 386_000,
} as const

export const savings = currentMonthMetrics.income - currentMonthMetrics.expense
export const savingsRate = savings / currentMonthMetrics.income
export const budgetUsage = currentMonthMetrics.expense / currentMonthMetrics.budget

export const budgetByCategory = [
  { ...categoryData[0], budget: 110_000 },
  { ...categoryData[1], budget: 95_000 },
  { ...categoryData[2], budget: 65_000 },
  { ...categoryData[3], budget: 50_000 },
] as const

export function assertMetricInvariants(): void {
  if (currentMonthMetrics.expense !== sum(categoryData.map((category) => category.amount))) {
    throw new Error('Expense KPI must equal the category total')
  }
  if (savings !== currentMonthMetrics.income - currentMonthMetrics.expense) {
    throw new Error('Savings must equal income minus expense')
  }
}
