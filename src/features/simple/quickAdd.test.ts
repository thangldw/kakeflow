import { describe, expect, it } from 'vitest'
import type { AccountDto } from '../../platform/types'
import type { QuickAddUsage } from './uiMode'
import { buildQuickAddInput, quickAddChoices } from './quickAdd'

function account(id: string, accountKind: AccountDto['accountKind'], accountSubtype: AccountDto['accountSubtype'] = 'OTHER'): AccountDto {
  return { id, name: `name-${id}`, accountKind, accountSubtype, currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' }
}

const accounts: AccountDto[] = [
  account('bank', 'ASSET', 'BANK'),
  account('cash', 'ASSET', 'CASH'),
  account('wallet', 'ASSET', 'WALLET'),
  account('securities', 'ASSET', 'SECURITIES'),
  account('card', 'LIABILITY', 'CREDIT_CARD'),
  account('loan', 'LIABILITY', 'OTHER'),
  account('equity', 'EQUITY'),
  account('food', 'EXPENSE'),
  account('transport', 'EXPENSE'),
  account('daily', 'EXPENSE'),
  account('fun', 'EXPENSE'),
  account('health', 'EXPENSE'),
  account('home', 'EXPENSE'),
  account('h1-other-expense', 'EXPENSE'),
  account('salary', 'INCOME'),
  account('bonus', 'INCOME'),
]
const noUsage: QuickAddUsage = { categoryCounts: {}, lastPayingAccountId: null }
const ids = (list: readonly AccountDto[]) => list.map((a) => a.id)

function args(overrides: Partial<Parameters<typeof buildQuickAddInput>[0]> = {}): Parameters<typeof buildQuickAddInput>[0] {
  return { id: 'tx-1', householdId: 'h1', kind: 'EXPENSE', amountJpy: 1200, categoryId: 'food', payingAccountId: 'bank', occurredOn: '2026-11-14', note: '', accounts, ...overrides }
}

describe('quickAddChoices', () => {
  it('offers expense categories and paying accounts (assets plus credit cards)', () => {
    const choices = quickAddChoices(accounts, 'EXPENSE', noUsage)
    expect(ids(choices.allCategories)).toEqual(['food', 'transport', 'daily', 'fun', 'health', 'home', 'h1-other-expense'])
    expect(ids(choices.payingAccounts)).toEqual(['bank', 'cash', 'wallet', 'card'])
  })

  it('offers income categories and asset-only receiving accounts for income', () => {
    const choices = quickAddChoices(accounts, 'INCOME', noUsage)
    expect(ids(choices.allCategories)).toEqual(['salary', 'bonus'])
    expect(ids(choices.payingAccounts)).toEqual(['bank', 'cash', 'wallet'])
  })

  it('shows the 5 most used categories with ties in account order, plus the other-expense account', () => {
    const usage: QuickAddUsage = { categoryCounts: { home: 9, fun: 4, daily: 4, health: 1, transport: 1, food: 1 }, lastPayingAccountId: null }
    const choices = quickAddChoices(accounts, 'EXPENSE', usage)
    expect(ids(choices.chips)).toEqual(['home', 'daily', 'fun', 'food', 'transport', 'h1-other-expense'])
    expect(choices.chips.length).toBeLessThanOrEqual(6)
    expect(choices.defaultCategoryId).toBe('home')
  })

  it('never lists the other-expense account twice, even when it is the most used', () => {
    const usage: QuickAddUsage = { categoryCounts: { 'h1-other-expense': 50, food: 2 }, lastPayingAccountId: null }
    const chips = ids(quickAddChoices(accounts, 'EXPENSE', usage).chips)
    expect(chips.filter((id) => id === 'h1-other-expense')).toHaveLength(1)
    expect(chips.length).toBeLessThanOrEqual(6)
  })

  it('falls back to account order when nothing has been used yet', () => {
    const choices = quickAddChoices(accounts, 'EXPENSE', noUsage)
    expect(ids(choices.chips)).toEqual(['food', 'transport', 'daily', 'fun', 'health', 'h1-other-expense'])
  })

  it('uses the last paying account when it still exists', () => {
    expect(quickAddChoices(accounts, 'EXPENSE', { categoryCounts: {}, lastPayingAccountId: 'card' }).defaultPayingAccountId).toBe('card')
  })

  it('ignores a stale last paying account and an unknown category count key', () => {
    const usage: QuickAddUsage = { categoryCounts: { ghost: 99, food: 1 }, lastPayingAccountId: 'deleted' }
    const choices = quickAddChoices(accounts, 'EXPENSE', usage)
    expect(choices.defaultPayingAccountId).toBe('cash')
    expect(ids(choices.chips)).not.toContain('ghost')
    expect(choices.defaultCategoryId).toBe('food')
  })

  it('ignores a last paying account that is not offered for the kind', () => {
    // A card cannot receive income.
    expect(quickAddChoices(accounts, 'INCOME', { categoryCounts: {}, lastPayingAccountId: 'card' }).defaultPayingAccountId).toBe('cash')
  })

  it('defaults to CASH, then WALLET, then BANK', () => {
    const noCash = accounts.filter((a) => a.id !== 'cash')
    expect(quickAddChoices(noCash, 'EXPENSE', noUsage).defaultPayingAccountId).toBe('wallet')
    const onlyBank = accounts.filter((a) => a.id !== 'cash' && a.id !== 'wallet')
    expect(quickAddChoices(onlyBank, 'EXPENSE', noUsage).defaultPayingAccountId).toBe('bank')
  })

  it('does not mutate a frozen usage value', () => {
    const usage: QuickAddUsage = Object.freeze({ categoryCounts: Object.freeze({ food: 2 }), lastPayingAccountId: 'bank' })
    expect(() => quickAddChoices(accounts, 'EXPENSE', usage)).not.toThrow()
  })

  it('tolerates a household with no relevant accounts', () => {
    const choices = quickAddChoices([account('equity', 'EQUITY')], 'EXPENSE', { categoryCounts: { food: 3 }, lastPayingAccountId: 'bank' })
    expect(choices).toEqual({ chips: [], allCategories: [], payingAccounts: [], defaultCategoryId: null, defaultPayingAccountId: null })
  })

  it('tolerates an empty account list for income', () => {
    expect(quickAddChoices([], 'INCOME', noUsage)).toEqual({ chips: [], allCategories: [], payingAccounts: [], defaultCategoryId: null, defaultPayingAccountId: null })
  })
})

describe('buildQuickAddInput', () => {
  it('books an expense paid from a bank account as Dr category / Cr bank', () => {
    const input = buildQuickAddInput(args())
    expect(input.transactionType).toBe('EXPENSE')
    expect(input.entries.map(({ accountId, side, amountJpy }) => ({ accountId, side, amountJpy }))).toEqual([
      { accountId: 'food', side: 'DEBIT', amountJpy: 1200 },
      { accountId: 'bank', side: 'CREDIT', amountJpy: 1200 },
    ])
  })

  it('books an expense paid by credit card as CARD_PURCHASE', () => {
    const input = buildQuickAddInput(args({ payingAccountId: 'card' }))
    expect(input.transactionType).toBe('CARD_PURCHASE')
    expect(input.entries.map((e) => [e.accountId, e.side])).toEqual([['food', 'DEBIT'], ['card', 'CREDIT']])
  })

  it('books income as Dr receiving asset / Cr income account', () => {
    const input = buildQuickAddInput(args({ kind: 'INCOME', categoryId: 'salary', payingAccountId: 'bank', amountJpy: 250000 }))
    expect(input.transactionType).toBe('INCOME')
    expect(input.entries.map(({ accountId, side, amountJpy }) => ({ accountId, side, amountJpy }))).toEqual([
      { accountId: 'bank', side: 'DEBIT', amountJpy: 250000 },
      { accountId: 'salary', side: 'CREDIT', amountJpy: 250000 },
    ])
  })

  it('sends household-common attribution and shared audience, as the Full manual form does', () => {
    const input = buildQuickAddInput(args())
    expect(input).toMatchObject({
      id: 'tx-1', householdId: 'h1', occurredOn: '2026-11-14', postedOn: null,
      attributionKind: 'HOUSEHOLD', attributedMemberId: null,
      audienceVisibility: 'SHARED', audienceMemberId: null,
    })
  })

  it('maps an empty note to null description and payee, and keeps a trimmed note', () => {
    expect(buildQuickAddInput(args({ note: '' }))).toMatchObject({ description: null, payee: null })
    expect(buildQuickAddInput(args({ note: '   ' }))).toMatchObject({ description: null, payee: null })
    expect(buildQuickAddInput(args({ note: ' lunch ' }))).toMatchObject({ description: 'lunch', payee: null })
  })

  it('derives unique entry ids from the transaction id', () => {
    const entries = buildQuickAddInput(args()).entries
    expect(new Set(entries.map((e) => e.id)).size).toBe(2)
    expect(entries.map((e) => e.id)).toEqual(['tx-1-debit', 'tx-1-credit'])
    const other = buildQuickAddInput(args({ id: 'tx-2' })).entries
    expect(other.map((e) => e.id)).not.toContain('tx-1-debit')
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('throws for amount %s', (amountJpy) => {
    expect(() => buildQuickAddInput(args({ amountJpy }))).toThrow(Error)
  })

  it('throws for an unknown category or paying account', () => {
    expect(() => buildQuickAddInput(args({ categoryId: 'ghost' }))).toThrow(Error)
    expect(() => buildQuickAddInput(args({ payingAccountId: 'ghost' }))).toThrow(Error)
  })

  it('throws for a category of the wrong kind', () => {
    expect(() => buildQuickAddInput(args({ kind: 'EXPENSE', categoryId: 'salary' }))).toThrow(Error)
    expect(() => buildQuickAddInput(args({ kind: 'INCOME', categoryId: 'food', payingAccountId: 'bank' }))).toThrow(Error)
  })

  it('throws for a paying account that is not offered for the kind', () => {
    expect(() => buildQuickAddInput(args({ payingAccountId: 'securities' }))).toThrow(Error)
    expect(() => buildQuickAddInput(args({ payingAccountId: 'loan' }))).toThrow(Error)
    expect(() => buildQuickAddInput(args({ kind: 'INCOME', categoryId: 'salary', payingAccountId: 'card' }))).toThrow(Error)
    expect(() => buildQuickAddInput(args({ payingAccountId: 'food' }))).toThrow(Error)
  })
})
