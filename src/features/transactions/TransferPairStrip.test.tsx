import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TransactionRowDto, TransferPairDecisionDto } from '../../platform/types'
import { TransferPairStrip } from './TransferPairStrip'

const row = (id: string, transactionType: string, occurredOn: string, payee: string, accounts: { debit?: [string, string]; credit?: [string, string] }): TransactionRowDto => ({
  id, occurredOn, postedOn: null, transactionType, payee, description: null, amountJpy: 50_000, status: 'POSTED', calculationTarget: true,
  debitAccountId: accounts.debit?.[0] ?? null, debitAccountName: accounts.debit?.[1] ?? null, creditAccountId: accounts.credit?.[0] ?? null, creditAccountName: accounts.credit?.[1] ?? null,
  categoryAccountId: null, categoryName: null,
}) as TransactionRowDto

const rows = [
  row('e1', 'EXPENSE', '2026-07-01', '銀行振込 A', { debit: ['food', '食費'], credit: ['bank-a', '三井住友'] }),
  row('i1', 'INCOME', '2026-07-02', '入金 B', { debit: ['bank-b', 'ゆうちょ'], credit: ['salary', '給与'] }),
]
const decision = (state: 'LINKED' | 'REJECTED' | 'MERGED'): TransferPairDecisionDto => ({ pairKey: 'e1|i1', outTransactionId: 'e1', inTransactionId: 'i1', state, decidedAt: '2026-07-03T00:00:00.000Z' })

function fakeClient(initial: readonly TransferPairDecisionDto[] = [], next?: (input: { action: string }) => readonly TransferPairDecisionDto[]) {
  return {
    listTransferPairDecisions: vi.fn(async () => initial),
    decideTransferPair: vi.fn(async (input: { action: string }) => next ? next(input) : initial),
  }
}

describe('TransferPairStrip', () => {
  it('proposes a pair with account names and confirms it, notifying the ledger change', async () => {
    const client = fakeClient([], () => [decision('LINKED')])
    const onChanged = vi.fn()
    render(<TransferPairStrip householdId="family" rows={rows} revision={0} onChanged={onChanged} client={client} />)
    const item = (await screen.findByText('銀行振込 A')).closest('li')!
    expect(within(item).getByText('三井住友')).toBeInTheDocument()
    expect(within(item).getByText('ゆうちょ')).toBeInTheDocument()
    expect(item).toHaveTextContent('¥50,000')
    expect(item).toHaveTextContent('1日差')
    fireEvent.click(screen.getByRole('button', { name: '振替として確定' }))
    await waitFor(() => expect(client.decideTransferPair).toHaveBeenCalledWith({ householdId: 'family', outTransactionId: 'e1', inTransactionId: 'i1', action: 'LINK' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: '振替として確定' })).not.toBeInTheDocument()
    expect(screen.getByText(/確定・却下の履歴/)).toBeInTheDocument()
  })

  it('remembers a dismissal without touching the ledger and can undo it', async () => {
    const client = fakeClient([], (input) => input.action === 'REJECT' ? [decision('REJECTED')] : [])
    const onChanged = vi.fn()
    render(<TransferPairStrip householdId="family" rows={rows} revision={0} onChanged={onChanged} client={client} />)
    fireEvent.click(await screen.findByRole('button', { name: '振替ではない' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '振替ではない' })).not.toBeInTheDocument())
    expect(onChanged).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(/確定・却下の履歴/))
    expect(screen.getByText('却下済み')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    await waitFor(() => expect(client.decideTransferPair).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'CLEAR' })))
    expect(await screen.findByRole('button', { name: '振替として確定' })).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('shows an alert when the action fails and keeps the proposal', async () => {
    const client = fakeClient()
    client.decideTransferPair.mockRejectedValueOnce(new Error('boom'))
    render(<TransferPairStrip householdId="family" rows={rows} revision={0} onChanged={vi.fn()} client={client} />)
    fireEvent.click(await screen.findByRole('button', { name: '振替として確定' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('振替の操作に失敗しました')
    expect(screen.getByRole('button', { name: '振替として確定' })).toBeEnabled()
  })

  it('hides previously rejected pairs and renders nothing without candidates or a household', async () => {
    const client = fakeClient([decision('REJECTED')])
    const hidden = render(<TransferPairStrip householdId="family" rows={rows} revision={0} onChanged={vi.fn()} client={client} />)
    await screen.findByText(/確定・却下の履歴/)
    expect(screen.queryByRole('button', { name: '振替として確定' })).not.toBeInTheDocument()
    hidden.unmount()
    const empty = render(<TransferPairStrip householdId="family" rows={[]} revision={0} onChanged={vi.fn()} client={fakeClient()} />)
    expect(empty.container).toBeEmptyDOMElement()
    const none = render(<TransferPairStrip householdId={null} rows={rows} revision={0} onChanged={vi.fn()} client={fakeClient()} />)
    expect(none.container).toBeEmptyDOMElement()
  })

  it('merges a pair into one entry, shows it as merged and offers undo', async () => {
    const client = fakeClient([], (input) => input.action === 'MERGE' ? [decision('MERGED')] : [])
    const onChanged = vi.fn()
    render(<TransferPairStrip householdId="family" rows={rows} revision={0} onChanged={onChanged} client={client} />)
    fireEvent.click(await screen.findByRole('button', { name: '一つの仕訳に統合' }))
    await waitFor(() => expect(client.decideTransferPair).toHaveBeenCalledWith({ householdId: 'family', outTransactionId: 'e1', inTransactionId: 'i1', action: 'MERGE' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: '一つの仕訳に統合' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/確定・却下の履歴/))
    expect(screen.getByText('統合済み')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    await waitFor(() => expect(client.decideTransferPair).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'CLEAR' })))
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('never shows an internal id for a history leg that is not among the loaded rows', async () => {
    const client = fakeClient([decision('MERGED')])
    render(<TransferPairStrip householdId="family" rows={[]} revision={0} onChanged={vi.fn()} client={client} />)
    fireEvent.click(await screen.findByText(/確定・却下の履歴/))
    expect(screen.getAllByText('表示範囲外または無効化済みの取引')).toHaveLength(2)
    expect(screen.queryByText('e1')).not.toBeInTheDocument()
    expect(screen.queryByText('i1')).not.toBeInTheDocument()
  })
})
