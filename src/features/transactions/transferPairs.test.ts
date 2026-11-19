import { describe, expect, it } from 'vitest'
import type { TransactionRowDto, TransferPairDecisionDto } from '../../platform/types'
import { proposeFromRows, transferCandidatesFromRows } from './transferPairs'

const row = (id: string, transactionType: string, occurredOn: string, amountJpy: number, accounts: { debit?: string; credit?: string }, extra: Partial<TransactionRowDto> = {}): TransactionRowDto => ({
  id, occurredOn, postedOn: null, transactionType, payee: null, description: null, amountJpy, status: 'POSTED', calculationTarget: true,
  debitAccountId: accounts.debit ?? null, debitAccountName: null, creditAccountId: accounts.credit ?? null, creditAccountName: null,
  categoryAccountId: null, categoryName: null, ...extra,
}) as TransactionRowDto

describe('transfer candidates from ledger rows', () => {
  it('uses the credit account of an expense and the debit account of an income, and skips everything else', () => {
    const candidates = transferCandidatesFromRows([
      row('e1', 'EXPENSE', '2026-07-01', 50_000, { debit: 'food', credit: 'bank-a' }),
      row('i1', 'INCOME', '2026-07-01', 50_000, { debit: 'bank-b', credit: 'salary' }),
      row('t1', 'TRANSFER', '2026-07-01', 1, { debit: 'x', credit: 'y' }),
      row('c1', 'CARD_PAYMENT', '2026-07-01', 1, { debit: 'x', credit: 'y' }),
      row('x1', 'EXPENSE', '2026-07-01', 1, { debit: 'x', credit: 'y' }, { calculationTarget: false }),
      row('n1', 'EXPENSE', '2026-07-01', 1, { debit: 'x' }),
      row('z1', 'EXPENSE', '2026-07-01', 0, { debit: 'x', credit: 'y' }),
    ])
    expect(candidates.map((candidate) => [candidate.id, candidate.direction, candidate.accountId])).toEqual([['e1', 'OUT', 'bank-a'], ['i1', 'IN', 'bank-b']])
  })

  it('proposes a pair and hides it once the pair was rejected or linked', () => {
    const rows = [
      row('e1', 'EXPENSE', '2026-07-01', 50_000, { debit: 'food', credit: 'bank-a' }, { payee: '振込 ミツイ' }),
      row('i1', 'INCOME', '2026-07-02', 50_000, { debit: 'bank-b', credit: 'salary' }),
    ]
    expect(proposeFromRows(rows, []).proposals.map((proposal) => [proposal.outId, proposal.inId])).toEqual([['e1', 'i1']])
    const rejected: TransferPairDecisionDto = { pairKey: 'e1|i1', outTransactionId: 'e1', inTransactionId: 'i1', state: 'REJECTED', decidedAt: '2026-07-03T00:00:00.000Z' }
    expect(proposeFromRows(rows, [rejected]).proposals).toEqual([])
    expect(proposeFromRows(rows, [{ ...rejected, state: 'LINKED' }]).proposals).toEqual([])
  })
})
