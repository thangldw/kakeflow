import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MonthlyCategoryBudgetDto } from '../../platform/types'
import { EnvelopeCarryPanel } from './EnvelopeCarryPanel'

const budget = (month: string, budgetJpy: number, actualJpy: number): MonthlyCategoryBudgetDto =>
  ({ householdId: 'h', month, categoryAccountId: 'food', categoryName: '食費', budgetJpy, actualJpy, remainingJpy: budgetJpy - actualJpy })

describe('EnvelopeCarryPanel', () => {
  it('shows carry-in, the overspend marker and the unassigned pool for the selected month', async () => {
    const load = vi.fn(async () => [
      { month: '2026-08', incomeJpy: 100_000, budgets: [budget('2026-08', 60_000, 45_000)] },
      { month: '2026-09', incomeJpy: 100_000, budgets: [budget('2026-09', 60_000, 100_000)] },
    ])
    render(<EnvelopeCarryPanel householdId="h" month="2026-09" revision={0} load={load} />)
    expect(await screen.findByText('繰越と未割当')).toBeInTheDocument()
    expect(load).toHaveBeenCalledWith('h', '2026-09')
    expect(screen.getByText(/未割当（累計）/)).toHaveTextContent('¥80,000')
    const row = screen.getByRole('row', { name: /食費/ })
    expect(row).toHaveTextContent('¥15,000')
    expect(row).toHaveTextContent('超過')
    expect(row).toHaveTextContent('−¥25,000')
  })

  it('renders nothing without a budget, without a household, or when loading fails', async () => {
    const empty = render(<EnvelopeCarryPanel householdId="h" month="2026-09" revision={0} load={async () => [{ month: '2026-09', incomeJpy: 1, budgets: [] }]} />)
    await waitFor(() => expect(empty.container).toBeEmptyDOMElement())
    const none = render(<EnvelopeCarryPanel householdId={null} month="2026-09" revision={0} load={vi.fn()} />)
    expect(none.container).toBeEmptyDOMElement()
    const failing = render(<EnvelopeCarryPanel householdId="h" month="2026-09" revision={0} load={async () => { throw new Error('offline') }} />)
    await waitFor(() => expect(failing.container).toBeEmptyDOMElement())
  })
})
