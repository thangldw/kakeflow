import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(screen.queryByRole('button', { name: '不足を補う' })).not.toBeInTheDocument()
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

describe('EnvelopeCarryPanel cover flow', () => {
  const two = (category: string, name: string, month: string, budgetJpy: number, actualJpy: number): MonthlyCategoryBudgetDto =>
    ({ householdId: 'h', month, categoryAccountId: category, categoryName: name, budgetJpy, actualJpy, remainingJpy: budgetJpy - actualJpy })
  const load = async () => [{ month: '2026-09', incomeJpy: 100_000, budgets: [two('food', '食費', '2026-09', 60_000, 100_000), two('home', '住居', '2026-09', 90_000, 30_000), two('fun', '娯楽', '2026-09', 10_000, 10_000)] }]

  it('moves budget from a category that still has some left and refreshes the page', async () => {
    const move = vi.fn(async () => [])
    const onChanged = vi.fn()
    render(<EnvelopeCarryPanel householdId="h" month="2026-09" revision={0} load={load} move={move} onChanged={onChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: '不足を補う' }))
    const group = screen.getByRole('group')
    const select = within(group).getByLabelText('補填元') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual(['home'])
    expect((within(group).getByLabelText('移す金額') as HTMLInputElement).value).toBe('40,000')
    fireEvent.click(within(group).getByRole('button', { name: '移す' }))
    await waitFor(() => expect(move).toHaveBeenCalledWith({ householdId: 'h', month: '2026-09', fromCategoryAccountId: 'home', toCategoryAccountId: 'food', amountJpy: 40_000 }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('defaults to the category with the most budget left', async () => {
    const wide = async () => [{ month: '2026-09', incomeJpy: 0, budgets: [two('food', '食費', '2026-09', 10_000, 20_000), two('fun', '娯楽', '2026-09', 10_000, 4_000), two('home', '住居', '2026-09', 90_000, 30_000)] }]
    render(<EnvelopeCarryPanel householdId="h" month="2026-09" revision={0} load={wide} move={vi.fn()} onChanged={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '不足を補う' }))
    const select = screen.getByLabelText('補填元') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual(['home', 'fun'])
    expect(select.value).toBe('home')
    expect((screen.getByLabelText('移す金額') as HTMLInputElement).value).toBe('10,000')
  })

  it('blocks an amount above what the source has left, and reports a failed move', async () => {
    const move = vi.fn(async () => { throw new Error('rejected') })
    render(<EnvelopeCarryPanel householdId="h" month="2026-09" revision={0} load={load} move={move} onChanged={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '不足を補う' }))
    const group = screen.getByRole('group')
    const amount = within(group).getByLabelText('移す金額')
    fireEvent.focus(amount)
    fireEvent.change(amount, { target: { value: '70000' } })
    expect(within(group).getByRole('button', { name: '移す' })).toBeDisabled()
    expect(within(group).getByText('補填元の残りを超えています。')).toBeInTheDocument()
    fireEvent.change(amount, { target: { value: '1000' } })
    fireEvent.click(within(group).getByRole('button', { name: '移す' }))
    expect(await within(group).findByRole('alert')).toHaveTextContent('予算の移動に失敗しました')
    expect(within(group).getByRole('button', { name: '移す' })).toBeEnabled()
  })

  it('says so when no other category has budget left, and offers no action without onChanged', async () => {
    const onlyOver = async () => [{ month: '2026-09', incomeJpy: 0, budgets: [two('food', '食費', '2026-09', 10_000, 20_000)] }]
    render(<EnvelopeCarryPanel householdId="h" month="2026-09" revision={0} load={onlyOver} move={vi.fn()} onChanged={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '不足を補う' }))
    expect(screen.getByText('補填元にできるカテゴリーに今月の残りがありません。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '移す' })).not.toBeInTheDocument()
    const readonly = render(<EnvelopeCarryPanel householdId="h" month="2026-09" revision={0} load={onlyOver} />)
    await waitFor(() => expect(within(readonly.container).getAllByText('食費').length).toBeGreaterThan(0))
    expect(within(readonly.container).queryByRole('button', { name: '不足を補う' })).not.toBeInTheDocument()
  })
})
