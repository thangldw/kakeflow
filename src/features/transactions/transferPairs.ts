import { proposeTransferPairs, rejectionKey, type TransferMatchCandidate, type TransferMatchResult } from '../../domain/transferMatching'
import type { TransactionRowDto, TransferPairDecisionDto } from '../../platform/types'

/**
 * Only plain, calculation-included, posted expense and income rows can be legs:
 * an expense is money leaving its credit account, an income is money entering
 * its debit account. Everything else (card, refund, adjustment, transfer) is
 * handled by its own flow and is never proposed here.
 */
export function transferCandidatesFromRows(rows: readonly TransactionRowDto[]): TransferMatchCandidate[] {
  const candidates: TransferMatchCandidate[] = []
  for (const row of rows) {
    if (row.status !== 'POSTED' || !row.calculationTarget || !Number.isSafeInteger(row.amountJpy) || row.amountJpy <= 0) continue
    const description = [row.payee, row.description].filter(Boolean).join(' ')
    if (row.transactionType === 'EXPENSE' && row.creditAccountId) {
      candidates.push({ id: row.id, accountId: row.creditAccountId, occurredOn: row.occurredOn, amountJpy: row.amountJpy, direction: 'OUT', description })
    } else if (row.transactionType === 'INCOME' && row.debitAccountId) {
      candidates.push({ id: row.id, accountId: row.debitAccountId, occurredOn: row.occurredOn, amountJpy: row.amountJpy, direction: 'IN', description })
    }
  }
  return candidates
}

export function proposeFromRows(rows: readonly TransactionRowDto[], decisions: readonly TransferPairDecisionDto[]): TransferMatchResult {
  const rejectedKeys = new Set(decisions.filter((decision) => decision.state === 'REJECTED').map((decision) => decision.pairKey))
  return proposeTransferPairs(transferCandidatesFromRows(rows), { rejectedKeys })
}

export { rejectionKey }
