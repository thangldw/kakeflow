import type { AccountDto, CreateManualTransactionInputDto } from '../../platform/types'
import type { QuickAddUsage } from './uiMode'

export type QuickAddKind = 'EXPENSE' | 'INCOME'

export interface QuickAddChoices {
  /** Up to 6 one-tap categories: the 5 most used, plus the "other" expense account when present. */
  readonly chips: readonly AccountDto[]
  readonly allCategories: readonly AccountDto[]
  /** Accounts the money comes from (expense) or lands in (income). */
  readonly payingAccounts: readonly AccountDto[]
  readonly defaultCategoryId: string | null
  readonly defaultPayingAccountId: string | null
}

const MAX_USED_CHIPS = 5
const CASH_LIKE_SUBTYPES: readonly AccountDto['accountSubtype'][] = ['BANK', 'CASH', 'WALLET']
const DEFAULT_PAYING_ORDER: readonly AccountDto['accountSubtype'][] = ['CASH', 'WALLET', 'BANK']

// AccountDto has no archived/closed flag, so every account of the right kind is active.
function categoriesFor(accounts: readonly AccountDto[], kind: QuickAddKind): readonly AccountDto[] {
  return accounts.filter((account) => account.accountKind === kind)
}

function payingAccountsFor(accounts: readonly AccountDto[], kind: QuickAddKind): readonly AccountDto[] {
  return accounts.filter((account) =>
    (account.accountKind === 'ASSET' && CASH_LIKE_SUBTYPES.includes(account.accountSubtype))
    || (kind === 'EXPENSE' && account.accountKind === 'LIABILITY' && account.accountSubtype === 'CREDIT_CARD'))
}

function usageCount(usage: QuickAddUsage, categoryId: string): number {
  if (!Object.hasOwn(usage.categoryCounts, categoryId)) return 0
  const count = usage.categoryCounts[categoryId]
  return Number.isFinite(count) && count > 0 ? count : 0
}

export function quickAddChoices(accounts: readonly AccountDto[], kind: QuickAddKind, usage: QuickAddUsage): QuickAddChoices {
  const allCategories = categoriesFor(accounts, kind)
  const payingAccounts = payingAccountsFor(accounts, kind)

  const otherAccount = kind === 'EXPENSE' ? allCategories.find((account) => account.id.endsWith('-other-expense')) : undefined
  // Array#sort is stable, so ties keep account order. Counts for ids that are not categories are never read.
  const mostUsed = allCategories
    .filter((account) => account !== otherAccount)
    .map((account) => ({ account, count: usageCount(usage, account.id) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_USED_CHIPS)
    .map((entry) => entry.account)
  const chips = otherAccount ? [...mostUsed, otherAccount] : mostUsed

  const last = usage.lastPayingAccountId
  const lastStillOffered = last !== null && payingAccounts.some((account) => account.id === last)
  const defaultPaying = lastStillOffered
    ? last
    : DEFAULT_PAYING_ORDER.map((subtype) => payingAccounts.find((account) => account.accountKind === 'ASSET' && account.accountSubtype === subtype)).find(Boolean)?.id ?? null

  return { chips, allCategories, payingAccounts, defaultCategoryId: chips[0]?.id ?? null, defaultPayingAccountId: defaultPaying }
}

/** True for a YYYY-MM-DD string naming a real calendar day (2026-02-31 is rejected). */
export function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === text
}

export function buildQuickAddInput(args: {
  id: string; householdId: string; kind: QuickAddKind; amountJpy: number
  categoryId: string; payingAccountId: string; occurredOn: string; note: string; accounts: readonly AccountDto[]
}): CreateManualTransactionInputDto {
  const { id, householdId, kind, amountJpy, categoryId, payingAccountId, occurredOn, accounts } = args
  if (!Number.isSafeInteger(amountJpy) || amountJpy <= 0) throw new Error('Quick-add amount must be a positive whole number of yen.')
  const category = categoriesFor(accounts, kind).find((account) => account.id === categoryId)
  if (!category) throw new Error(`Quick-add category is not an ${kind.toLowerCase()} account: ${categoryId}`)
  const paying = payingAccountsFor(accounts, kind).find((account) => account.id === payingAccountId)
  if (!paying) throw new Error(`Quick-add account is not available for ${kind.toLowerCase()}: ${payingAccountId}`)

  const transactionType = kind === 'INCOME' ? 'INCOME' : paying.accountKind === 'LIABILITY' ? 'CARD_PURCHASE' : 'EXPENSE'
  // Expense: Dr category / Cr paying account. Income: Dr receiving account / Cr income category.
  const debitAccountId = kind === 'EXPENSE' ? category.id : paying.id
  const creditAccountId = kind === 'EXPENSE' ? paying.id : category.id
  const note = args.note.trim()

  // Same attribution/audience as the Full manual form sends for household-common and shared; it posts with postedOn null.
  return {
    id, householdId, occurredOn, postedOn: null, transactionType,
    payee: null, description: note || null,
    attributionKind: 'HOUSEHOLD', attributedMemberId: null,
    audienceVisibility: 'SHARED', audienceMemberId: null,
    entries: [
      { id: `${id}-debit`, accountId: debitAccountId, side: 'DEBIT', amountJpy },
      { id: `${id}-credit`, accountId: creditAccountId, side: 'CREDIT', amountJpy },
    ],
  }
}
