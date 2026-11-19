import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette, type PaletteTransaction } from './CommandPalette'

const pages = [
  { id: 'overview', label: 'ホーム' }, { id: 'transactions', label: '取引' }, { id: 'budgets', label: '予算・目標' },
] as const
const lunch: PaletteTransaction = { id: 'tx1', occurredOn: '2026-11-01', payee: 'セブン', description: null, amountJpy: 480 }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

function setup(extra: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const onClose = vi.fn(); const onNavigate = vi.fn()
  render(<CommandPalette open onClose={onClose} pages={pages} onNavigate={onNavigate} {...extra} />)
  return { onClose, onNavigate, input: screen.getByRole('combobox') as HTMLInputElement }
}

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<CommandPalette open={false} onClose={vi.fn()} pages={pages} onNavigate={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('lists every page first, filters as you type and opens the highlighted one with Enter', () => {
    const { input, onNavigate, onClose } = setup()
    expect(screen.getAllByRole('option')).toHaveLength(3)
    fireEvent.change(input, { target: { value: '予算' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('budgets')
    expect(onClose).toHaveBeenCalled()
  })

  it('moves with the arrow keys, wrapping around, and keeps aria-activedescendant in sync', () => {
    const { input, onNavigate } = setup()
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    const options = screen.getAllByRole('option')
    expect(options[2].getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(options[2].id)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('budgets')
  })

  it('searches transactions after a short pause and navigates to the transactions page', async () => {
    const search = vi.fn(async () => [lunch])
    const { input, onNavigate } = setup({ searchTransactions: search })
    fireEvent.change(input, { target: { value: 'セブ' } })
    expect(search).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(search).toHaveBeenCalledWith('セブ')
    fireEvent.mouseDown(screen.getByText(/セブン/u))
    expect(onNavigate).toHaveBeenCalledWith('transactions')
  })

  it('does not search for a single character and shows an empty message when nothing matches', async () => {
    const search = vi.fn(async () => [])
    const { input } = setup({ searchTransactions: search })
    fireEvent.change(input, { target: { value: 'z' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(search).not.toHaveBeenCalled()
    expect(screen.getByText('一致する結果はありません。')).toBeTruthy()
  })

  it('closes on Escape and on a click outside', () => {
    const { input, onClose } = setup()
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector('.command-palette-backdrop') as Element)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
