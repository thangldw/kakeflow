import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IncomeStatementPanel } from './IncomeStatementPanel'

afterEach(cleanup)

describe('IncomeStatementPanel', () => {
  it('saves for the chosen period and shows the file name', async () => {
    const save = vi.fn(async () => 'kakeflow-income-statement-2026-06-2026-11.pdf')
    render(<IncomeStatementPanel save={save} available />)
    fireEvent.change(screen.getByLabelText('対象期間'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: '収支のまとめをPDFで保存' }))
    expect((await screen.findByRole('status')).textContent).toContain('2026-06-2026-11')
    expect(save).toHaveBeenCalledWith(6)
  })

  it('defaults to twelve months and stays quiet when cancelled', async () => {
    const save = vi.fn(async () => null)
    render(<IncomeStatementPanel save={save} available />)
    fireEvent.click(screen.getByRole('button', { name: '収支のまとめをPDFで保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(12))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows an error on failure and disables the button where unavailable', async () => {
    render(<IncomeStatementPanel save={async () => { throw new Error('x') }} available />)
    fireEvent.click(screen.getByRole('button', { name: '収支のまとめをPDFで保存' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    cleanup()
    render(<IncomeStatementPanel save={vi.fn()} available={false} />)
    expect((screen.getByRole('button', { name: '収支のまとめをPDFで保存' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
