import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaxSupportPanel } from './TaxSupportPanel'
import type { TaxTransaction } from './taxSupport'

const base: TaxTransaction = { id: 'a', occurredOn: '2026-04-01', transactionType: 'EXPENSE', payee: '田中クリニック', description: null, amountJpy: 150_000, status: 'POSTED', calculationTarget: true, categoryName: null }
const furusato: TaxTransaction = { ...base, id: 'b', payee: 'さとふる', amountJpy: 30_000 }

afterEach(cleanup)

describe('TaxSupportPanel', () => {
  it('loads on demand, lists candidates and recalculates the deduction when income is typed', async () => {
    const loadYear = vi.fn(async () => [base, furusato])
    render(<TaxSupportPanel year="2026" loadYear={loadYear} />)
    expect(loadYear).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }))
    expect(await screen.findByText('田中クリニック')).toBeTruthy()
    expect(screen.getByText('さとふる')).toBeTruthy()
    expect(screen.queryByText(/医療費控除額/u)).toBeNull()
    fireEvent.change(screen.getByLabelText(/年間の総所得/u), { target: { value: '5000000' } })
    expect(screen.getByText(/医療費控除額（参考）/u).textContent).toContain('¥50,000')
  })

  it('hands the CSV to the saver and reports cancel', async () => {
    const onSaveCsv = vi.fn(async () => false)
    render(<TaxSupportPanel year="2026" loadYear={async () => [base]} onSaveCsv={onSaveCsv} />)
    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }))
    fireEvent.click(await screen.findByRole('button', { name: 'CSVを書き出す' }))
    await waitFor(() => expect(onSaveCsv).toHaveBeenCalledWith(expect.stringContaining('医療費 合計'), 'kakeflow-tax-support-2026.csv'))
    expect(await screen.findByText('エクスポートをキャンセルしました。')).toBeTruthy()
  })

  it('shows a notice when loading fails', async () => {
    render(<TaxSupportPanel year="2026" loadYear={async () => { throw new Error('x') }} />)
    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }))
    expect(await screen.findByText('取引を読み込めませんでした。')).toBeTruthy()
  })
})
