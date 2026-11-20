import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FinancialCalendarDto } from '../calendar/financialCalendarPlatform'
import { MonthlyActionsPanel } from './MonthlyActionsPanel'

afterEach(cleanup)

const base: FinancialCalendarDto = {
  month: '2026-11', asOf: '2026-11-10',
  days: Array.from({ length: 30 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, accrualIncomeJpy: 0, accrualExpenseJpy: 0, cashInflowJpy: 0, cashOutflowJpy: 0, postedTransactionCount: 0, noSpendDay: false, events: [] })),
  budget: { budgetJpy: 0, actualJpy: 0, remainingJpy: 0, utilizationBps: null, categoryCount: 0, overBudgetCount: 0 },
  goals: { activeCount: 0, targetJpy: 0, savedJpy: 0, remainingJpy: 0, dueWithinPeriodCount: 0 },
  dataQuality: { totalImports: 1, postedImports: 1, reviewRequiredImports: 2, failedImports: 0, inProgressImports: 0, importCompletionBps: 5000, latestImportedAt: null, staleDays: 1, hasUnresolvedImports: true },
}

describe('MonthlyActionsPanel', () => {
  it('shows the top actions, with a reminder loaded from the device, and opens the target', async () => {
    const onOpen = vi.fn()
    render(<MonthlyActionsPanel calendar={base} householdId="h" onOpen={onOpen} listReminders={async () => [{ id: 'a'.repeat(32), householdId: 'h', dueOn: '2026-11-08', label: '水道', amountJpy: 3000, done: false }]} />)
    expect(await screen.findByText('水道 ¥3,000 — 2日超過')).toBeTruthy()
    expect(screen.getByText('確認待ちの取り込みがあります: 2')).toBeTruthy()
    // Bills are handled on this same page, so only the import action has an open button.
    const open = screen.getAllByRole('button', { name: '開く' })
    expect(open).toHaveLength(1)
    fireEvent.click(open[0])
    expect(onOpen).toHaveBeenCalledWith('import')
  })

  it('says nothing is urgent when there are no actions, and survives a reminder load failure', async () => {
    render(<MonthlyActionsPanel calendar={{ ...base, dataQuality: { ...base.dataQuality, reviewRequiredImports: 0 } }} householdId="h" listReminders={async () => { throw new Error('x') }} />)
    expect(await screen.findByText('今、急いでやることはありません。')).toBeTruthy()
  })
})
