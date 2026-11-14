import 'fake-indexeddb/auto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const argonMock = vi.hoisted(() => ({
  derive: vi.fn(async (passphrase: Uint8Array, salt: Uint8Array) => {
    const output = new Uint8Array(32)
    for (let index = 0; index < output.length; index += 1) {
      output[index] = passphrase[index % passphrase.length] ^ salt[index % salt.length] ^ index
    }
    return output
  }),
}))

vi.mock('../platform/pwa/argonWorker', () => ({ deriveArgon2idInWorker: argonMock.derive }))

import { buildQuickAddInput, quickAddChoices } from '../features/simple/quickAdd'
import { loadSimpleHome } from '../features/simple/homeLoader'
import { PwaLedgerClient } from '../platform/pwa/client'
import type { TransactionType } from '../platform/pwa/types'
import type { AccountDto, DashboardMonthlyTotalsDto, MonthlyCategoryBudgetDto, SavingsGoalDto } from '../platform/types'
import { createSimpleAdapter } from './simpleAdapter'

const passphrase = 'correct horse battery staple'
const originalFetch = globalThis.fetch
const HOUSEHOLD = 'household'
const NOVEMBER = '2026-11'
const emptyUsage = { categoryCounts: {}, lastPayingAccountId: null }
const fixedClock = () => new Date('2026-11-14T00:00:00Z')

let vaultCount = 0
async function vault() {
  vaultCount += 1
  const client = await PwaLedgerClient.createVault(`simple-adapter-${vaultCount}`, passphrase, {
    vaultId: `vault-${vaultCount}`,
    evidence: { getDirectory: undefined },
    now: fixedClock,
  })
  await client.createHousehold({ id: HOUSEHOLD, name: '山田家' })
  return client
}

async function fullVault() {
  const client = await vault()
  await client.createAccount({ id: 'cash', householdId: HOUSEHOLD, name: '財布', kind: 'ASSET' })
  await client.createAccount({ id: 'bank', householdId: HOUSEHOLD, name: '銀行', kind: 'ASSET', subtype: 'BANK' })
  await client.createAccount({ id: 'card', householdId: HOUSEHOLD, name: 'カード', kind: 'LIABILITY' })
  await client.createAccount({ id: 'food', householdId: HOUSEHOLD, name: '食費', kind: 'EXPENSE' })
  await client.createAccount({ id: 'daily', householdId: HOUSEHOLD, name: '日用品', kind: 'EXPENSE' })
  await client.createAccount({ id: 'salary', householdId: HOUSEHOLD, name: '給与', kind: 'INCOME' })
  return client
}

async function post(client: PwaLedgerClient, id: string, occurredOn: string, transactionType: TransactionType, amountJpy: number, debitAccountId: string, creditAccountId: string) {
  return client.createManualTransaction({
    id, householdId: HOUSEHOLD, occurredOn, transactionType, payee: `Payee ${id}`, amountJpy,
    entries: [
      { id: `${id}-debit`, accountId: debitAccountId, side: 'DEBIT', amountJpy },
      { id: `${id}-credit`, accountId: creditAccountId, side: 'CREDIT', amountJpy },
    ],
  })
}

const dto = (id: string, name: string, accountKind: AccountDto['accountKind'], accountSubtype: AccountDto['accountSubtype']): AccountDto => ({
  id, name, accountKind, accountSubtype, currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED',
})

describe('PWA adapter for the Simple components', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (String(input).endsWith('kakeflow_core_bg.wasm')) {
        const bytes = await readFile(resolve('src/platform/pwa/core-wasm/kakeflow_core_bg.wasm'))
        return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } })
      }
      return originalFetch(input)
    })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('maps PWA accounts to account DTOs with default subtypes and household ownership', async () => {
    const adapter = createSimpleAdapter(await fullVault(), HOUSEHOLD)
    const accounts = [...await adapter.listAccountDtos()].sort((left, right) => left.id.localeCompare(right.id))
    expect(accounts).toEqual([
      dto('bank', '銀行', 'ASSET', 'BANK'),
      dto('card', 'カード', 'LIABILITY', 'CREDIT_CARD'),
      dto('cash', '財布', 'ASSET', 'CASH'),
      dto('daily', '日用品', 'EXPENSE', 'OTHER'),
      dto('food', '食費', 'EXPENSE', 'OTHER'),
      dto('salary', '給与', 'INCOME', 'OTHER'),
    ])
  })

  it('offers one category and one cash-like account for a vault with only the two setup accounts', async () => {
    const client = await vault()
    await client.createAccount({ id: 'asset', householdId: HOUSEHOLD, name: '財布', kind: 'ASSET' })
    await client.createAccount({ id: 'expense', householdId: HOUSEHOLD, name: '生活費', kind: 'EXPENSE' })
    const choices = quickAddChoices(await createSimpleAdapter(client, HOUSEHOLD).listAccountDtos(), 'EXPENSE', emptyUsage)
    expect(choices.allCategories.map((account) => account.id)).toEqual(['expense'])
    expect(choices.payingAccounts.map((account) => account.id)).toEqual(['asset'])
    expect(choices.defaultPayingAccountId).toBe('asset')
  })

  it('posts a quick-add expense from a card as CARD_PURCHASE and from cash as EXPENSE', async () => {
    const client = await fullVault()
    const adapter = createSimpleAdapter(client, HOUSEHOLD)
    const accounts = await adapter.listAccountDtos()
    const quick = (id: string, payingAccountId: string, note: string) => buildQuickAddInput({
      id, householdId: HOUSEHOLD, kind: 'EXPENSE', amountJpy: 1_200, categoryId: 'food', payingAccountId, occurredOn: '2026-11-14', note, accounts,
    })

    const cardRow = await adapter.createManualTransaction(quick('t-card', 'card', ' ランチ '))
    const cashRow = await adapter.createManualTransaction(quick('t-cash', 'cash', ''))
    expect(cardRow).toMatchObject({ id: 't-card', transactionType: 'CARD_PURCHASE', amountJpy: 1_200, status: 'POSTED', occurredOn: '2026-11-14' })
    expect(cashRow).toMatchObject({ id: 't-cash', transactionType: 'EXPENSE', amountJpy: 1_200 })

    const stored = await client.listTransactions(HOUSEHOLD)
    const card = stored.find((transaction) => transaction.id === 't-card')!
    const cash = stored.find((transaction) => transaction.id === 't-cash')!
    expect(card).toMatchObject({ householdId: HOUSEHOLD, transactionType: 'CARD_PURCHASE', payee: 'ランチ', amountJpy: 1_200 })
    expect(card.entries).toEqual([
      { id: 't-card-debit', accountId: 'food', side: 'DEBIT', amountJpy: 1_200 },
      { id: 't-card-credit', accountId: 'card', side: 'CREDIT', amountJpy: 1_200 },
    ])
    expect(cash.transactionType).toBe('EXPENSE')
    // The vault requires a payee; without a note the category name stands in.
    expect(cash.payee).toBe('食費')
  })

  it('maps budgets, the month dashboard and goals to the desktop DTOs', async () => {
    const client = await fullVault()
    await client.upsertBudget({ householdId: HOUSEHOLD, month: NOVEMBER, categoryAccountId: 'food', budgetJpy: 50_000 })
    await client.upsertBudget({ householdId: HOUSEHOLD, month: NOVEMBER, categoryAccountId: 'daily', budgetJpy: 20_000 })
    await post(client, 't-food', '2026-11-03', 'EXPENSE', 30_000, 'food', 'cash')
    await post(client, 't-daily', '2026-11-05', 'CARD_PURCHASE', 25_000, 'daily', 'card')
    await post(client, 't-salary', '2026-11-10', 'INCOME', 250_000, 'bank', 'salary')
    await client.createSavingsGoal({ id: 'trip', householdId: HOUSEHOLD, name: '旅行', targetJpy: 300_000, savedJpy: 120_000, targetDate: '2027-06-30' })
    const adapter = createSimpleAdapter(client, HOUSEHOLD)

    const budgets: MonthlyCategoryBudgetDto[] = [
      { householdId: HOUSEHOLD, month: NOVEMBER, categoryAccountId: 'daily', categoryName: '日用品', budgetJpy: 20_000, actualJpy: 25_000, remainingJpy: -5_000 },
      { householdId: HOUSEHOLD, month: NOVEMBER, categoryAccountId: 'food', categoryName: '食費', budgetJpy: 50_000, actualJpy: 30_000, remainingJpy: 20_000 },
    ]
    expect(await adapter.listBudgets(HOUSEHOLD, NOVEMBER)).toEqual(budgets)

    const dashboard: DashboardMonthlyTotalsDto = {
      month: NOVEMBER, accountingBasis: 'ACCRUAL', incomeJpy: 250_000, expenseJpy: 55_000, savingsJpy: 0, postedTransactionCount: 0,
      netWorthAsOf: '', assetsJpy: 0, liabilitiesJpy: 0, netWorthJpy: 0, accrualTrend: [], cashFlowTrend: [],
      expenseCategories: [{ accountId: 'food', name: '食費', amountJpy: 30_000 }, { accountId: 'daily', name: '日用品', amountJpy: 25_000 }],
    }
    expect(await adapter.queryDashboard({ householdId: HOUSEHOLD, accountGroupId: 'ignored', attributionScope: { kind: 'MEMBER', memberId: 'm' }, month: NOVEMBER, accountingBasis: 'CASH' })).toEqual(dashboard)

    const goal: SavingsGoalDto = {
      id: 'trip', householdId: HOUSEHOLD, name: '旅行', targetJpy: 300_000, savedJpy: 120_000, targetDate: '2027-06-30', status: 'ACTIVE',
      createdAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-14T00:00:00.000Z',
    }
    expect(await adapter.listSavingsGoals(HOUSEHOLD)).toEqual([goal])
  })

  it('clamps a negative month spend to zero for the Simple Home', async () => {
    const client = await fullVault()
    await post(client, 't-food', '2026-11-03', 'EXPENSE', 1_000, 'food', 'cash')
    await post(client, 't-refund', '2026-11-04', 'REFUND', 4_000, 'cash', 'food')
    expect((await client.monthlyDashboard(HOUSEHOLD, NOVEMBER)).expenseJpy).toBe(-3_000)
    const dashboard = await createSimpleAdapter(client, HOUSEHOLD).queryDashboard({ householdId: HOUSEHOLD, attributionScope: { kind: 'ALL' }, month: NOVEMBER, accountingBasis: 'ACCRUAL' })
    expect(dashboard.expenseJpy).toBe(0)
  })

  it('completes a goal at its target and reopens it when the saved amount drops below', async () => {
    const client = await fullVault()
    await client.createSavingsGoal({ id: 'trip', householdId: HOUSEHOLD, name: '旅行', targetJpy: 100_000, savedJpy: 10_000, targetDate: '2027-06-30' })
    const adapter = createSimpleAdapter(client, HOUSEHOLD)
    const input = { id: 'trip', householdId: HOUSEHOLD, name: '旅行', targetJpy: 100_000, targetDate: '2027-06-30' } as const

    expect(await adapter.updateSavingsGoal({ ...input, savedJpy: 100_000, status: 'ACTIVE' })).toMatchObject({ savedJpy: 100_000, status: 'COMPLETED' })
    expect(await adapter.updateSavingsGoal({ ...input, savedJpy: 40_000, status: 'COMPLETED' })).toMatchObject({ savedJpy: 40_000, status: 'ACTIVE' })
    expect((await client.listSavingsGoals(HOUSEHOLD))[0]).toMatchObject({ savedJpy: 40_000, status: 'ACTIVE' })
  })

  it('keeps a cancelled goal cancelled when its saved amount changes', async () => {
    const client = await fullVault()
    await client.createSavingsGoal({ id: 'trip', householdId: HOUSEHOLD, name: '旅行', targetJpy: 100_000, savedJpy: 10_000, targetDate: '2027-06-30' })
    await client.updateSavingsGoal({ id: 'trip', householdId: HOUSEHOLD, name: '旅行', targetJpy: 100_000, savedJpy: 10_000, targetDate: '2027-06-30', status: 'CANCELLED' })
    const adapter = createSimpleAdapter(client, HOUSEHOLD)
    expect(await adapter.updateSavingsGoal({ id: 'trip', householdId: HOUSEHOLD, name: '旅行', targetJpy: 100_000, savedJpy: 20_000, targetDate: '2027-06-30', status: 'ACTIVE' }))
      .toMatchObject({ savedJpy: 20_000, status: 'CANCELLED' })
  })

  it('feeds loadSimpleHome the figures of a hand-computed month', async () => {
    const client = await fullVault()
    await client.upsertBudget({ householdId: HOUSEHOLD, month: NOVEMBER, categoryAccountId: 'food', budgetJpy: 50_000 })
    await client.upsertBudget({ householdId: HOUSEHOLD, month: NOVEMBER, categoryAccountId: 'daily', budgetJpy: 20_000 })
    await post(client, 't-food', '2026-11-03', 'EXPENSE', 30_000, 'food', 'cash')
    await post(client, 't-daily', '2026-11-05', 'CARD_PURCHASE', 25_000, 'daily', 'card')
    await post(client, 't-salary', '2026-11-10', 'INCOME', 250_000, 'bank', 'salary')
    await client.createSavingsGoal({ id: 'trip', householdId: HOUSEHOLD, name: '旅行', targetJpy: 300_000, savedJpy: 120_000, targetDate: '2027-06-30' })

    const home = await loadSimpleHome(createSimpleAdapter(client, HOUSEHOLD), HOUSEHOLD, NOVEMBER, new Date('2026-11-14T03:00:00Z'))
    // Budget 50,000 + 20,000 = 70,000; spent 30,000 + 25,000 = 55,000; 17 days left counting the 14th.
    expect(home.remaining).toEqual({
      basis: 'BUDGET', budgetMonth: NOVEMBER, totalBudgetJpy: 70_000, spentJpy: 55_000, unbudgetedSpentJpy: 0,
      remainingJpy: 15_000, overByJpy: 0, usedRatio: 55_000 / 70_000, perDayJpy: Math.floor(15_000 / 17),
      mostOver: { name: '日用品', overJpy: 5_000 },
    })
    expect(home.goal?.id).toBe('trip')
  })
})
