import { platformClient } from '../../platform'
import type { EnvelopeMonthData } from './envelopeView'

/** Trailing six months of budgets, accrual income and card activity, read from the existing read models. */
export async function loadEnvelopeMonths(householdId: string, month: string): Promise<readonly EnvelopeMonthData[]> {
  const dashboard = await platformClient.queryDashboard({ householdId, accountGroupId: null, attributionScope: { kind: 'ALL' }, month, accountingBasis: 'ACCRUAL' })
  const trend = dashboard.accrualTrend.filter((point) => point.month <= month).slice(-6)
  const [budgets, cardActivity] = await Promise.all([
    Promise.all(trend.map((point) => platformClient.listBudgets(householdId, point.month))),
    // Card data is an addition: if it cannot be read the carry-over view still works.
    Promise.all(trend.map((point) => Promise.resolve().then(() => platformClient.queryEnvelopeCardActivity(householdId, point.month)).catch(() => null))),
  ])
  return trend.map((point, index) => ({ month: point.month, incomeJpy: point.incomeJpy, budgets: budgets[index], cardActivity: cardActivity[index] }))
}
