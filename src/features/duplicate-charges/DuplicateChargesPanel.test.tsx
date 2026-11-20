import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuplicateChargesPanel } from './DuplicateChargesPanel'

afterEach(cleanup)
const pair = { firstTransactionId: 'a', secondTransactionId: 'b', firstOn: '2026-11-02', secondOn: '2026-11-04', payee: 'Amazon', amountJpy: 4980, daysApart: 2 }

describe('DuplicateChargesPanel', () => {
  it('lists the pairs and opens transactions', async () => {
    const open = vi.fn()
    const load = vi.fn(async () => [pair, { ...pair, firstTransactionId: 'c', secondTransactionId: 'd', daysApart: 0 }])
    render(<DuplicateChargesPanel month="2026-11" load={load} onOpenTransactions={open} />)
    expect(await screen.findAllByText(/Amazon/)).toHaveLength(2)
    expect(screen.getByText(/2日差/)).toBeTruthy()
    expect(screen.getByText(/同日/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取引を確認する' }))
    expect(open).toHaveBeenCalled()
  })

  it('renders nothing when there are none or loading fails', async () => {
    const { container } = render(<DuplicateChargesPanel month="2026-11" load={async () => []} onOpenTransactions={vi.fn()} />)
    await waitFor(() => expect(container.textContent).toBe(''))
    cleanup()
    const failing = render(<DuplicateChargesPanel month="2026-11" load={async () => { throw new Error('x') }} onOpenTransactions={vi.fn()} />)
    await waitFor(() => expect(failing.container.textContent).toBe(''))
  })
})
