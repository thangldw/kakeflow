import { describe, expect, it, vi } from 'vitest'
import { translateText } from '../i18n'
import type { Account, CreateAccountInput } from '../platform/pwa/types'
import { addDefaultChart, defaultChart } from './defaultChart'

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
})
