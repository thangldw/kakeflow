import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BalanceCheckPanel } from './BalanceCheckPanel'

afterEach(cleanup)
const accounts = [{ accountId: 'bank', name: '銀行', subtype: 'BANK', balanceJpy: 100_000 }]

describe('BalanceCheckPanel', () => {
  it('says match, higher or lower as the real balance is typed', async () => {
    render(<BalanceCheckPanel asOf="2026-11-20" load={async () => accounts} />)
    const input = await screen.findByLabelText(/銀行/)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.change(input, { target: { value: '100,000' } })
    expect(screen.getByRole('status').textContent).toContain('一致しています。')
    fireEvent.change(input, { target: { value: '120000' } })
    expect(screen.getByRole('status').textContent).toContain('実際のほうが多い: ¥20,000')
    fireEvent.change(input, { target: { value: '90000' } })
    expect(screen.getByRole('status').textContent).toContain('実際のほうが少ない: ¥10,000')
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders nothing without accounts or when loading fails', async () => {
    const { container } = render(<BalanceCheckPanel asOf="2026-11-20" load={async () => []} />)
    await waitFor(() => expect(container.textContent).toBe(''))
    cleanup()
    const failing = render(<BalanceCheckPanel asOf="2026-11-20" load={async () => { throw new Error('x') }} />)
    await waitFor(() => expect(failing.container.textContent).toBe(''))
  })
})
