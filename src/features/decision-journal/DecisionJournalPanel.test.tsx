import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DecisionJournalPanel } from './DecisionJournalPanel'
import type { DecisionDto } from '../../platform/types'

afterEach(cleanup)
const base = { householdId: 'family', decidedOn: '2026-05-01', amountJpy: 1_200_000, reason: '古い', expectation: '10年使える' }
const waiting = (id: string, title: string, reviewOn: string): DecisionDto => ({ ...base, id, title, reviewOn, outcome: null })

function setup(items: readonly DecisionDto[], today = '2026-11-20') {
  const list = vi.fn(async () => items)
  const create = vi.fn(async (input) => ({ ...base, ...input, id: 'n'.repeat(32), outcome: null }))
  const recordOutcome = vi.fn(async () => undefined)
  const remove = vi.fn(async () => undefined)
  render(<DecisionJournalPanel householdId="family" today={today} list={list} create={create} recordOutcome={recordOutcome} remove={remove} />)
  return { list, create, recordOutcome, remove }
}

describe('DecisionJournalPanel', () => {
  it('adds a decision with a default review date six months out', async () => {
    const { create } = setup([])
    fireEvent.change(screen.getByLabelText('決めたこと'), { target: { value: 'エアコン' } })
    fireEvent.change(screen.getByLabelText('金額（任意）'), { target: { value: '150000' } })
    fireEvent.click(screen.getByRole('button', { name: '記録する' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ householdId: 'family', decidedOn: '2026-11-20', title: 'エアコン', amountJpy: 150000, reason: '', expectation: '', reviewOn: '2027-05-20' }))
  })

  it('does not allow saving without a title, with a bad amount or a past review date', async () => {
    setup([])
    const add = screen.getByRole('button', { name: '記録する' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('決めたこと'), { target: { value: 'x' } })
    expect(add.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('金額（任意）'), { target: { value: 'abc' } })
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('金額（任意）'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('振り返る日'), { target: { value: '2026-11-19' } })
    expect(add.disabled).toBe(true)
  })

  it('offers the outcome form only once the review date has come, and saves it', async () => {
    const { recordOutcome } = setup([waiting('a'.repeat(32), '車', '2026-11-01'), waiting('b'.repeat(32), '家', '2027-01-01')])
    expect(await screen.findAllByText('振り返りの時期です。')).toHaveLength(1)
    expect(screen.getAllByLabelText('実際はどうだったか')).toHaveLength(1)
    const save = screen.getByRole('button', { name: '振り返りを保存' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('実際はどうだったか'), { target: { value: ' 満足 ' } })
    fireEvent.click(save)
    await waitFor(() => expect(recordOutcome).toHaveBeenCalledWith('family', 'a'.repeat(32), '満足'))
  })

  it('shows reviewed decisions with their outcome and deletes entries', async () => {
    const { remove } = setup([{ ...waiting('c'.repeat(32), 'PC', '2026-06-01'), outcome: 'よかった' }])
    expect((await screen.findByText(/よかった/)).textContent).toContain('結果')
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('family', 'c'.repeat(32)))
  })

  it('shows an error when loading fails', async () => {
    render(<DecisionJournalPanel householdId="family" today="2026-11-20" list={async () => { throw new Error('x') }} create={vi.fn()} recordOutcome={vi.fn()} remove={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
