import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SafeToSpendPanel } from './SafeToSpendPanel'

afterEach(cleanup)

const days = Array.from({ length: 30 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, accrualIncomeJpy: 0, accrualExpenseJpy: 0, cashInflowJpy: 0, cashOutflowJpy: 0, postedTransactionCount: 0, noSpendDay: false, events: i === 26 ? [{ kind: 'CARD_PAYMENT_DUE' as const, id: 'c', title: 'カード', amountJpy: 50_000, status: null }] : [] }))
const calendar = { asOf: '2026-11-21', month: '2026-11', days }

describe('SafeToSpendPanel', () => {
  it('shows the per-day amount and the breakdown it came from', async () => {
    render(<SafeToSpendPanel calendar={calendar} openingCashJpy={200_000} householdId="h" listReminders={async () => [{ id: 'a'.repeat(32), householdId: 'h', dueOn: '2026-11-25', label: '電気', amountJpy: 10_000, done: false }]} />)
    expect((await screen.findByRole('status')).textContent).toContain('¥14,000')
    expect(screen.getByText('−¥50,000')).toBeTruthy()
    expect(screen.getByText('−¥10,000')).toBeTruthy()
  })

  it('shows a shortfall when commitments exceed cash', async () => {
    render(<SafeToSpendPanel calendar={calendar} openingCashJpy={20_000} householdId="h" listReminders={async () => []} />)
    expect((await screen.findByRole('status')).textContent).toContain('不足 ¥30,000')
  })

  it('renders nothing for a past month and survives a reminder load failure', async () => {
    const { container, unmount } = render(<SafeToSpendPanel calendar={{ ...calendar, asOf: '2026-12-03' }} openingCashJpy={1} householdId="h" listReminders={async () => []} />)
    expect(container.textContent).toBe('')
    unmount()
    render(<SafeToSpendPanel calendar={calendar} openingCashJpy={100_000} householdId="h" listReminders={async () => { throw new Error('x') }} />)
    expect((await screen.findByRole('status')).textContent).toContain('¥')
  })
})
