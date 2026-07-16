import { categoryData } from './data'

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

export const currentMonthMetrics = {
  income: 1_000_000,
  expense: sum(categoryData.map((category) => category.amount)),
  budget: 800_000,
  netWorth: 51_240_000,
  cashOutflow: 812_237,
} as const

export const savings = currentMonthMetrics.income - currentMonthMetrics.expense
export const savingsRate = savings / currentMonthMetrics.income
export const budgetUsage = currentMonthMetrics.expense / currentMonthMetrics.budget

export const budgetByCategory = [
  { ...categoryData[0], budget: 250_000 },
  { ...categoryData[1], budget: 150_000 },
  { ...categoryData[2], budget: 100_000 },
  { ...categoryData[3], budget: 100_000 },
] as const

export function assertMetricInvariants(): void {
  if (currentMonthMetrics.expense !== sum(categoryData.map((category) => category.amount))) {
    throw new Error('Expense KPI must equal the category total')
  }
  if (savings !== currentMonthMetrics.income - currentMonthMetrics.expense) {
    throw new Error('Savings must equal income minus expense')
  }
}
