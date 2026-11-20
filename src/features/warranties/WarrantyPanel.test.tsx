import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WarrantyPanel } from './WarrantyPanel'
import { warrantyState } from './warrantyState'
import type { WarrantyDto } from '../../platform/types'

afterEach(cleanup)
const entry = (id: string, item: string, expiresOn: string): WarrantyDto => ({ id, householdId: 'family', item, store: 'ヨドバシ', purchasedOn: '2025-11-20', warrantyMonths: 12, expiresOn, amountJpy: 80000, note: '' })

function setup(items: readonly WarrantyDto[]) {
  const list = vi.fn(async () => items)
  const create = vi.fn(async (input) => ({ ...entry('n'.repeat(32), input.item, '2027-11-20'), ...input }))
  const remove = vi.fn(async () => undefined)
  render(<WarrantyPanel householdId="family" today="2026-11-20" list={list} create={create} remove={remove} />)
  return { list, create, remove }
}

describe('warrantyState', () => {
  it('marks ended, soon and active cover', () => {
    expect(warrantyState('2026-11-19', '2026-11-20')).toEqual({ state: 'ENDED', daysLeft: -1 })
    expect(warrantyState('2026-11-20', '2026-11-20')).toEqual({ state: 'SOON', daysLeft: 0 })
    expect(warrantyState('2027-01-19', '2026-11-20')).toEqual({ state: 'SOON', daysLeft: 60 })
    expect(warrantyState('2027-01-20', '2026-11-20')).toEqual({ state: 'ACTIVE', daysLeft: 61 })
  })
})

describe('WarrantyPanel', () => {
  it('adds a warranty with the typed months and amount', async () => {
    const { create } = setup([])
    fireEvent.change(screen.getByLabelText('品名'), { target: { value: '冷蔵庫' } })
    fireEvent.change(screen.getByLabelText('保証期間（月）'), { target: { value: '24' } })
    fireEvent.change(screen.getByLabelText('購入金額（任意）'), { target: { value: '90000' } })
    fireEvent.click(screen.getByRole('button', { name: '追加する' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ householdId: 'family', item: '冷蔵庫', store: '', purchasedOn: '2026-11-20', warrantyMonths: 24, amountJpy: 90000, note: '' }))
  })

  it('does not allow saving without a name, or with a bad period or amount', () => {
    setup([])
    const add = screen.getByRole('button', { name: '追加する' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('品名'), { target: { value: 'x' } })
    expect(add.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('保証期間（月）'), { target: { value: '0' } })
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('保証期間（月）'), { target: { value: '121' } })
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('保証期間（月）'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('購入金額（任意）'), { target: { value: 'abc' } })
    expect(add.disabled).toBe(true)
  })

  it('flags ended and soon-ending cover and deletes entries', async () => {
    const { remove } = setup([entry('a'.repeat(32), '古い掃除機', '2026-10-01'), entry('b'.repeat(32), 'TV', '2026-12-31'), entry('c'.repeat(32), '冷蔵庫', '2030-01-01')])
    expect(await screen.findByText('保証は終了しています。')).toBeTruthy()
    expect(screen.getByText(/保証期限が近づいています。.*期限までの日数: 41/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '削除' })).toHaveLength(3)
    fireEvent.click(screen.getAllByRole('button', { name: '削除' })[0] as HTMLElement)
    await waitFor(() => expect(remove).toHaveBeenCalledWith('family', 'a'.repeat(32)))
  })

  it('shows an error when loading fails', async () => {
    render(<WarrantyPanel householdId="family" today="2026-11-20" list={async () => { throw new Error('x') }} create={vi.fn()} remove={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
