import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CategoryHistoryDto } from '../../platform/types'
import { TimeMachinePanel } from './TimeMachinePanel'

afterEach(cleanup)

const history: CategoryHistoryDto = {
  months: ['2026-09', '2026-10', '2026-11'],
  categories: [{ accountId: 'fun', name: '娯楽', monthlyJpy: [10_000, 20_000, 30_000], totalJpy: 60_000 }],
}

describe('TimeMachinePanel', () => {
  it('shows spend per category and computes the difference when a percentage is chosen', async () => {
    const load = async () => history
    render(<TimeMachinePanel month="2026-11" load={load} />)
    expect(await screen.findByText('¥60,000')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('割合を選ぶと')
    fireEvent.change(screen.getByLabelText('娯楽 減らす割合'), { target: { value: '20' } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('¥12,000'))
    expect(screen.getByRole('status').textContent).toContain('月平均 ¥4,000')
  })

  it('narrows the window to the most recent months', async () => {
    render(<TimeMachinePanel month="2026-11" load={async () => history} />)
    await screen.findByText('¥60,000')
    fireEvent.change(screen.getByLabelText('娯楽 減らす割合'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('対象期間'), { target: { value: '3' } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('¥30,000'))
  })

  it('shows an empty state and an error state', async () => {
    const { unmount } = render(<TimeMachinePanel month="2026-11" load={async () => ({ months: ['2026-11'], categories: [] })} />)
    expect(await screen.findByText('この期間の支出はまだありません。')).toBeTruthy()
    unmount()
    render(<TimeMachinePanel month="2026-11" load={async () => { throw new Error('x') }} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
