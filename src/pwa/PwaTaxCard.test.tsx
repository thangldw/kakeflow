import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PwaLedgerClient } from '../platform/pwa/client'
import { PwaTaxCard } from './PwaTaxCard'
import { loadPwaTaxTransactions } from './pwaTax'

afterEach(cleanup)

const entry = (accountId: string, side: 'DEBIT' | 'CREDIT') => ({ id: `${accountId}-${side}`, accountId, side, amountJpy: 3000 })
const accounts = [
  { id: 'cash', name: 'Cash', kind: 'ASSET' },
  { id: 'medical', name: '医療費', kind: 'EXPENSE' },
  { id: 'food', name: 'Food', kind: 'EXPENSE' },
]
const transactions = [
  { id: 'tx-clinic', householdId: 'h', occurredOn: '2026-03-02', transactionType: 'EXPENSE', payee: 'Clinic', amountJpy: 3000, entries: [entry('medical', 'DEBIT'), entry('cash', 'CREDIT')] },
  { id: 'tx-lunch', householdId: 'h', occurredOn: '2026-03-03', transactionType: 'EXPENSE', payee: 'Lunch', amountJpy: 3000, entries: [entry('food', 'DEBIT'), entry('cash', 'CREDIT')] },
  { id: 'tx-furusato', householdId: 'h', occurredOn: '2026-04-01', transactionType: 'EXPENSE', payee: 'ふるさとチョイス', amountJpy: 3000, entries: [entry('food', 'DEBIT'), entry('cash', 'CREDIT')] },
]
const client = {
  listTransactions: vi.fn(async () => transactions),
  listAccounts: vi.fn(async () => accounts),
} as unknown as PwaLedgerClient

describe('loadPwaTaxTransactions', () => {
  it('maps vault transactions with the debited expense account as the category', async () => {
    const rows = await loadPwaTaxTransactions(client, 'h')
    expect(rows.find((row) => row.id === 'tx-clinic')).toMatchObject({ categoryName: '医療費', status: 'POSTED', calculationTarget: true, description: null })
    expect(rows.find((row) => row.id === 'tx-lunch')?.categoryName).toBe('Food')
  })
})

describe('PwaTaxCard', () => {
  it('lists medical and hometown-tax candidates of the chosen year', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-20T00:00:00+09:00'))
    try {
      render(<PwaTaxCard client={client} householdId="h" />)
      expect((screen.getByLabelText('対象の年') as HTMLSelectElement).value).toBe('2026')
      fireEvent.click(screen.getByRole('button', { name: '候補を表示' }))
      expect(await screen.findByText('Clinic')).toBeTruthy()
      expect(screen.getByText('ふるさとチョイス')).toBeTruthy()
      expect(screen.queryByText('Lunch')).toBeNull()
    } finally { vi.useRealTimers() }
  })
})
