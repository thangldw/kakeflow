import { platformClient } from '../../platform'
import type { EnvelopeMonthData } from './envelopeView'

/** Trailing six months of budgets and accrual income, read from the existing read models. */
export async function loadEnvelopeMonths(householdId: string, month: string): Promise<readonly EnvelopeMonthData[]> {
  const dashboard = await platformClient.queryDashboard({ householdId, accountGroupId: null, attributionScope: { kind: 'ALL' }, month, accountingBasis: 'ACCRUAL' })
  const trend = dashboard.accrualTrend.filter((point) => point.month <= month).slice(-6)
  const budgets = await Promise.all(trend.map((point) => platformClient.listBudgets(householdId, point.month)))
  return trend.map((point, index) => ({ month: point.month, incomeJpy: point.incomeJpy, budgets: budgets[index] }))
}
