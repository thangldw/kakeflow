import { describe, expect, it } from 'vitest'
import {
  findBestBankDebitMatch,
  jpy,
  postCardPayment,
  postCardPurchase,
  postTransfer,
  reconcileCardStatementToBankDebit,
  validateBalancedEntries,
} from '.'
import type { Account, CardStatement } from '.'

const householdId = 'household-1'
const account = (partial: Partial<Account> & Pick<Account, 'id' | 'name' | 'kind' | 'subtype'>): Account => ({
  householdId,
  currency: 'JPY',
  ...partial,
})

const bank = account({ id: 'bank', name: 'MUFG', kind: 'ASSET', subtype: 'BANK' })
const card = account({ id: 'card', name: 'Rakuten Card', kind: 'LIABILITY', subtype: 'CREDIT_CARD' })
const groceries = account({ id: 'groceries', name: 'Food', kind: 'EXPENSE', subtype: 'OTHER' })
const wallet = account({ id: 'wallet', name: 'PayPay', kind: 'ASSET', subtype: 'WALLET' })

const posting = (id: string) => ({
  id,
  householdId,
  occurredOn: '2026-07-12',
  description: id,
  createdAt: '2026-07-12T15:00:00+09:00',
  createdBy: 'member-1',
})

describe('double-entry ledger', () => {
  it('recognizes a card purchase as expense plus liability', () => {
    const transaction = postCardPurchase(posting('purchase'), groceries, card, jpy(5_000))

    expect(transaction.type).toBe('CARD_PURCHASE')
    expect(transaction.entries).toEqual([
      expect.objectContaining({ accountId: groceries.id, debit: 5_000, credit: 0 }),
      expect.objectContaining({ accountId: card.id, debit: 0, credit: 5_000 }),
    ])
    expect(validateBalancedEntries(transaction.entries).valid).toBe(true)
  })

  it('posts the later bank debit as liability payment, not another expense', () => {
    const payment = postCardPayment(posting('payment'), bank, card, jpy(5_000))

    expect(payment.type).toBe('CARD_PAYMENT')
    expect(payment.entries.some((entry) => entry.accountId === groceries.id)).toBe(false)
    expect(payment.entries).toEqual([
      expect.objectContaining({ accountId: card.id, debit: 5_000, credit: 0 }),
      expect.objectContaining({ accountId: bank.id, debit: 0, credit: 5_000 }),
    ])
  })

  it('rejects fractional JPY and same-account transfers', () => {
    expect(() => jpy(12.5)).toThrow(/safe integer/)
    expect(() => postTransfer(posting('transfer'), wallet, wallet, jpy(1_000))).toThrow(/different/)
  })
})

describe('card statement reconciliation', () => {
  const statement: CardStatement = {
    id: 'statement-1', householdId, cardAccountId: card.id,
    periodStart: '2026-05-16', periodEnd: '2026-06-15', dueDate: '2026-07-27',
    amountDue: jpy(204_987), currency: 'JPY', issuerName: '楽天カード',
  }

  it('fully reconciles an exact known debit near the due date', () => {
    const result = reconcileCardStatementToBankDebit(statement, {
      transactionId: 'bank-tx-1', bankAccountId: bank.id, occurredOn: '2026-07-27',
      amount: jpy(204_987), description: 'ラクテンカードサービス',
    }, [{ cardAccountId: card.id, bankAccountId: bank.id }])

    expect(result.score).toBe(100)
    expect(result.status).toBe('FULLY_RECONCILED')
  })

  it('selects the deterministic highest-confidence debit', () => {
    const result = findBestBankDebitMatch(statement, [
      { transactionId: 'wrong', bankAccountId: bank.id, occurredOn: '2026-07-27', amount: jpy(20_170), description: 'AMAZON' },
      { transactionId: 'right', bankAccountId: bank.id, occurredOn: '2026-07-27', amount: jpy(204_987), description: 'ラクテンカードサービス' },
    ], [{ cardAccountId: card.id, bankAccountId: bank.id }])

    expect(result?.bankTransactionId).toBe('right')
    expect(result?.status).toBe('FULLY_RECONCILED')
  })
})
