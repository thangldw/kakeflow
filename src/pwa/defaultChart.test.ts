import { describe, expect, it, vi } from 'vitest'
import { translateText } from '../i18n'
import type { Account, CreateAccountInput } from '../platform/pwa/types'
import { addDefaultChart, addQuickAddEssentials, defaultChart } from './defaultChart'

const english = (source: string) => translateText('en', source)
const vietnamese = (source: string) => translateText('vi', source)

describe('defaultChart', () => {
  it('uses stable, valid identifiers that never contain the budget key separator', () => {
    const chart = defaultChart('household', english)
    expect(chart.map((account) => account.id)).toEqual([
      'asset-cash', 'liability-card', 'income-salary',
      'expense-groceries', 'expense-utilities', 'expense-transport', 'expense-entertainment', 'expense-other',
    ])
    for (const account of chart) {
      expect(account.id).toMatch(/^[a-z]+-[a-z]+$/u)
      expect(account.id).not.toContain('~')
      expect(account.householdId).toBe('household')
    }
    expect(new Set(chart.map((account) => account.id)).size).toBe(chart.length)
  })

  it('has a cash account, a credit card, an income account and five spending categories', () => {
    const chart = defaultChart('household', english)
    expect(chart.filter((account) => account.kind === 'ASSET').map((account) => account.subtype)).toEqual(['CASH'])
    expect(chart.filter((account) => account.kind === 'LIABILITY').map((account) => account.subtype)).toEqual(['CREDIT_CARD'])
    expect(chart.filter((account) => account.kind === 'INCOME')).toHaveLength(1)
    expect(chart.filter((account) => account.kind === 'EXPENSE')).toHaveLength(5)
  })

  it('names the accounts in the chosen language', () => {
    expect(defaultChart('household', english).map((account) => account.name)).toEqual([
      'Cash', 'Credit card', 'Salary', 'Groceries', 'Utilities', 'Transport', 'Entertainment', 'Other',
    ])
    expect(defaultChart('household', vietnamese).map((account) => account.name)).toEqual([
      'Tiền mặt', 'Thẻ tín dụng', 'Lương', 'Thực phẩm', 'Điện nước & tiện ích', 'Đi lại', 'Giải trí', 'Khác',
    ])
    const japanese = defaultChart('household', (source) => source).map((account) => account.name)
    expect(japanese).toContain('現金')
    expect(japanese.every((name) => /[ぁ-んァ-ヶ一-龯]/u.test(name))).toBe(true)
  })
})

describe('addDefaultChart', () => {
  function fakeClient(accounts: Account[]) {
    return {
      accounts,
      listAccounts: vi.fn(async () => [...accounts]),
      createAccount: vi.fn(async (input: CreateAccountInput) => { accounts.push({ ...input, currency: 'JPY' }) }),
    }
  }

  it('creates every starter account in an empty household', async () => {
    const client = fakeClient([])
    await addDefaultChart(client, 'household', english)
    expect(client.accounts.map((account) => account.id)).toEqual(defaultChart('household', english).map((account) => account.id))
  })

  it('skips ids that exist and same-kind accounts with the same name, and never changes existing accounts', async () => {
    const asset: Account = { id: 'asset', householdId: 'household', name: ' cash ', kind: 'ASSET', currency: 'JPY' }
    const other: Account = { id: 'expense-other', householdId: 'household', name: '雑費', kind: 'EXPENSE', currency: 'JPY' }
    const salaryAsExpense: Account = { id: 'expense', householdId: 'household', name: 'Salary', kind: 'EXPENSE', currency: 'JPY' }
    const client = fakeClient([asset, other, salaryAsExpense])
    await addDefaultChart(client, 'household', english)
    const created = client.createAccount.mock.calls.map(([input]) => input.id)
    expect(created).not.toContain('asset-cash')
    expect(created).not.toContain('expense-other')
    // A same name of another kind does not count.
    expect(created).toContain('income-salary')
    expect(client.accounts.slice(0, 3)).toEqual([asset, other, salaryAsExpense])
  })

  it('matches a name typed with combining marks against the same precomposed name', async () => {
    const decomposed = 'Lương'.normalize('NFD')
    expect(decomposed).not.toBe('Lương')
    const client = fakeClient([{ id: 'salary', householdId: 'household', name: decomposed, kind: 'INCOME', currency: 'JPY' }])
    await addDefaultChart(client, 'household', vietnamese)
    expect(client.createAccount.mock.calls.map(([input]) => input.id)).not.toContain('income-salary')
  })
})

describe('addQuickAddEssentials', () => {
  function fakeClient(accounts: Account[]) {
    return {
      accounts,
      listAccounts: vi.fn(async () => [...accounts]),
      createAccount: vi.fn(async (input: CreateAccountInput) => { accounts.push({ ...input, currency: 'JPY' }) }),
    }
  }
  const setupFormAccounts = (): Account[] => [
    { id: 'asset', householdId: 'household', name: '財布', kind: 'ASSET', currency: 'JPY' },
    { id: 'expense', householdId: 'household', name: '食費', kind: 'EXPENSE', currency: 'JPY' },
  ]

  it('gives a two-account vault only the income account when income has nowhere to go', async () => {
    const client = fakeClient(setupFormAccounts())
    await addQuickAddEssentials(client, 'household', 'INCOME', english)
    expect(client.createAccount.mock.calls.map(([input]) => input)).toEqual([
      { id: 'income-salary', householdId: 'household', name: 'Salary', kind: 'INCOME' },
    ])
  })

  it('creates nothing when the kind already works', async () => {
    const client = fakeClient(setupFormAccounts())
    await addQuickAddEssentials(client, 'household', 'EXPENSE', english)
    expect(client.createAccount).not.toHaveBeenCalled()
  })

  it('creates the minimum for a vault with no category and nothing that can pay', async () => {
    const client = fakeClient([{ id: 'card', householdId: 'household', name: 'Card', kind: 'LIABILITY', currency: 'JPY' }])
    await addQuickAddEssentials(client, 'household', 'INCOME', english)
    expect(client.accounts.map((account) => account.id)).toEqual(['card', 'income-salary', 'asset-cash'])

    const empty = fakeClient([])
    await addQuickAddEssentials(empty, 'household', 'EXPENSE', english)
    expect(empty.accounts.map((account) => account.id)).toEqual(['expense-other', 'asset-cash'])
  })

  it('skips a chart id that already exists', async () => {
    const client = fakeClient([{ id: 'income-salary', householdId: 'household', name: 'Bonus', kind: 'EXPENSE', currency: 'JPY' }])
    await addQuickAddEssentials(client, 'household', 'INCOME', english)
    expect(client.createAccount.mock.calls.map(([input]) => input.id)).toEqual(['asset-cash'])
  })
})
