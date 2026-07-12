import { jpy } from './types'
import type {
  Account,
  EntityId,
  IsoDate,
  IsoDateTime,
  JpyAmount,
  LedgerEntry,
  Transaction,
  TransactionType,
} from './types'

export interface PostingContext {
  id: EntityId
  householdId: EntityId
  occurredOn: IsoDate
  description: string
  createdAt: IsoDateTime
  createdBy: EntityId
  sourceRecordIds?: readonly EntityId[]
  categoryId?: EntityId
  merchantId?: EntityId
}

export interface LedgerValidation {
  valid: boolean
  debitTotal: JpyAmount
  creditTotal: JpyAmount
  errors: readonly string[]
}

function requirePositive(amount: JpyAmount): void {
  if (amount <= 0) throw new RangeError('Posting amount must be greater than zero')
}

function requireSameHousehold(context: PostingContext, accounts: readonly Account[]): void {
  for (const account of accounts) {
    if (account.householdId !== context.householdId) {
      throw new Error(`Account ${account.id} does not belong to household ${context.householdId}`)
    }
    if (account.currency !== 'JPY') throw new Error(`Account ${account.id} is not denominated in JPY`)
  }
}

function entry(
  transactionId: EntityId,
  suffix: string,
  accountId: EntityId,
  debit: JpyAmount,
  credit: JpyAmount,
): LedgerEntry {
  return { id: `${transactionId}:${suffix}`, transactionId, accountId, debit, credit }
}

function post(
  context: PostingContext,
  type: TransactionType,
  accounts: readonly Account[],
  entries: readonly LedgerEntry[],
): Transaction {
  requireSameHousehold(context, accounts)
  const validation = validateBalancedEntries(entries)
  if (!validation.valid) throw new Error(`Invalid ledger posting: ${validation.errors.join('; ')}`)
  return {
    ...context,
    type,
    status: 'POSTED',
    sourceRecordIds: context.sourceRecordIds ?? [],
    entries,
  }
}

export function validateBalancedEntries(entries: readonly LedgerEntry[]): LedgerValidation {
  const errors: string[] = []
  let debits = 0
  let credits = 0
  if (entries.length < 2) errors.push('A transaction must contain at least two entries')
  for (const item of entries) {
    if (!Number.isSafeInteger(item.debit) || !Number.isSafeInteger(item.credit)) {
      errors.push(`Entry ${item.id} contains a non-integer amount`)
    }
    if (item.debit < 0 || item.credit < 0) errors.push(`Entry ${item.id} contains a negative leg`)
    if ((item.debit === 0) === (item.credit === 0)) {
      errors.push(`Entry ${item.id} must have exactly one positive debit or credit leg`)
    }
    debits += item.debit
    credits += item.credit
  }
  if (!Number.isSafeInteger(debits) || !Number.isSafeInteger(credits)) {
    errors.push('Transaction totals exceed the safe integer range')
  }
  if (debits !== credits) errors.push(`Debits (${debits}) do not equal credits (${credits})`)
  return { valid: errors.length === 0, debitTotal: jpy(debits), creditTotal: jpy(credits), errors }
}

/** Expense paid immediately from an asset account (bank, cash, or wallet). */
export function postExpense(
  context: PostingContext,
  expenseAccount: Account,
  paymentAccount: Account,
  amount: JpyAmount,
): Transaction {
  requirePositive(amount)
  if (expenseAccount.kind !== 'EXPENSE') throw new Error('Expense account must have kind EXPENSE')
  if (paymentAccount.kind !== 'ASSET') throw new Error('Payment account must have kind ASSET')
  return post(context, 'EXPENSE', [expenseAccount, paymentAccount], [
    entry(context.id, 'expense', expenseAccount.id, amount, jpy(0)),
    entry(context.id, 'payment', paymentAccount.id, jpy(0), amount),
  ])
}

/** Purchase recognized as expense while increasing a credit-card liability. */
export function postCardPurchase(
  context: PostingContext,
  expenseAccount: Account,
  cardAccount: Account,
  amount: JpyAmount,
): Transaction {
  requirePositive(amount)
  if (expenseAccount.kind !== 'EXPENSE') throw new Error('Expense account must have kind EXPENSE')
  if (cardAccount.kind !== 'LIABILITY' || cardAccount.subtype !== 'CREDIT_CARD') {
    throw new Error('Card account must be a CREDIT_CARD liability')
  }
  return post(context, 'CARD_PURCHASE', [expenseAccount, cardAccount], [
    entry(context.id, 'expense', expenseAccount.id, amount, jpy(0)),
    entry(context.id, 'card-liability', cardAccount.id, jpy(0), amount),
  ])
}

/** Bank settlement reduces both bank assets and outstanding card liability. */
export function postCardPayment(
  context: PostingContext,
  bankAccount: Account,
  cardAccount: Account,
  amount: JpyAmount,
): Transaction {
  requirePositive(amount)
  if (bankAccount.kind !== 'ASSET' || bankAccount.subtype !== 'BANK') {
    throw new Error('Card payment source must be a BANK asset')
  }
  if (cardAccount.kind !== 'LIABILITY' || cardAccount.subtype !== 'CREDIT_CARD') {
    throw new Error('Card payment destination must be a CREDIT_CARD liability')
  }
  return post(context, 'CARD_PAYMENT', [bankAccount, cardAccount], [
    entry(context.id, 'card-liability', cardAccount.id, amount, jpy(0)),
    entry(context.id, 'bank', bankAccount.id, jpy(0), amount),
  ])
}

/** Refund reverses expense into either an asset or a card liability account. */
export function postRefund(
  context: PostingContext,
  expenseAccount: Account,
  destinationAccount: Account,
  amount: JpyAmount,
): Transaction {
  requirePositive(amount)
  if (expenseAccount.kind !== 'EXPENSE') throw new Error('Refund offset must have kind EXPENSE')
  if (destinationAccount.kind !== 'ASSET' && destinationAccount.kind !== 'LIABILITY') {
    throw new Error('Refund destination must be an ASSET or LIABILITY')
  }
  return post(context, 'REFUND', [expenseAccount, destinationAccount], [
    entry(context.id, 'destination', destinationAccount.id, amount, jpy(0)),
    entry(context.id, 'expense-reversal', expenseAccount.id, jpy(0), amount),
  ])
}

/** Transfer moves value between two asset accounts without affecting expense. */
export function postTransfer(
  context: PostingContext,
  sourceAccount: Account,
  destinationAccount: Account,
  amount: JpyAmount,
): Transaction {
  requirePositive(amount)
  if (sourceAccount.id === destinationAccount.id) throw new Error('Transfer accounts must be different')
  if (sourceAccount.kind !== 'ASSET' || destinationAccount.kind !== 'ASSET') {
    throw new Error('Transfer accounts must both have kind ASSET')
  }
  return post(context, 'TRANSFER', [sourceAccount, destinationAccount], [
    entry(context.id, 'destination', destinationAccount.id, amount, jpy(0)),
    entry(context.id, 'source', sourceAccount.id, jpy(0), amount),
  ])
}
