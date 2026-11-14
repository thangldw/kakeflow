import { describe, expect, it } from 'vitest'
import { translateText } from '../i18n'
import { defaultChart } from './defaultChart'

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
