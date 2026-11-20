import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaymentReminderDto } from '../../platform/types'
import { BillRemindersPanel } from './BillRemindersPanel'

afterEach(cleanup)

const reminder = (overrides: Partial<PaymentReminderDto>): PaymentReminderDto => ({ id: 'a'.repeat(32), householdId: 'h', dueOn: '2026-12-25', label: '電気代', amountJpy: 8200, done: false, ...overrides })

function setup(initial: readonly PaymentReminderDto[] = []) {
  let rows = [...initial]
  const api = {
    list: vi.fn(async () => rows),
    create: vi.fn(async (input) => { const created = reminder({ id: 'b'.repeat(32), dueOn: input.dueOn, label: input.label, amountJpy: input.amountJpy }); rows = [...rows, created]; return created }),
    setDone: vi.fn(async (_h: string, id: string, done: boolean) => { rows = rows.map((row) => row.id === id ? { ...row, done } : row) }),
    remove: vi.fn(async (_h: string, id: string) => { rows = rows.filter((row) => row.id !== id) }),
  }
  render(<BillRemindersPanel householdId="h" today="2026-12-20" {...api} />)
  return api
}

describe('BillRemindersPanel', () => {
  it('lists reminders with the days left and flags overdue ones', async () => {
    setup([reminder({}), reminder({ id: 'c'.repeat(32), dueOn: '2026-12-18', label: 'カード', amountJpy: null })])
    expect(await screen.findByText('あと5日')).toBeTruthy()
    expect(screen.getByText('2日超過')).toBeTruthy()
    expect(screen.getByText('¥8,200')).toBeTruthy()
  })

  it('shows an empty state', async () => {
    setup()
    expect(await screen.findByText('登録されたリマインダーはありません。')).toBeTruthy()
  })

  it('adds a reminder only when the label and date are valid and the amount is digits', async () => {
    const api = setup()
    await screen.findByText('登録されたリマインダーはありません。')
    const add = screen.getByRole('button', { name: '追加' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '水道代' } })
    fireEvent.change(screen.getByLabelText('支払期限'), { target: { value: '2026-12-28' } })
    fireEvent.change(screen.getByLabelText('金額（任意）'), { target: { value: '12ab' } })
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('金額（任意）'), { target: { value: '3000' } })
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ householdId: 'h', dueOn: '2026-12-28', label: '水道代', amountJpy: 3000 }))
    expect(await screen.findByText('水道代')).toBeTruthy()
    expect((screen.getByLabelText('内容') as HTMLInputElement).value).toBe('')
  })

  it('marks a reminder paid and back, and deletes it', async () => {
    const api = setup([reminder({})])
    fireEvent.click(await screen.findByRole('button', { name: '支払い済みにする' }))
    await waitFor(() => expect(api.setDone).toHaveBeenCalledWith('h', 'a'.repeat(32), true))
    fireEvent.click(await screen.findByRole('button', { name: '未払いに戻す' }))
    await waitFor(() => expect(api.setDone).toHaveBeenLastCalledWith('h', 'a'.repeat(32), false))
    fireEvent.click(await screen.findByRole('button', { name: '電気代 を削除' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('h', 'a'.repeat(32)))
    expect(await screen.findByText('登録されたリマインダーはありません。')).toBeTruthy()
  })

  it('shows an error when the list cannot be loaded', async () => {
    render(<BillRemindersPanel householdId="h" today="2026-12-20" list={async () => { throw new Error('x') }} create={vi.fn()} setDone={vi.fn()} remove={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
