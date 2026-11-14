import type { CreateAccountInput } from '../platform/pwa/types'

/**
 * The starter accounts a new PWA vault gets in Simple mode, so budgeting and quick add work at once: a cash account,
 * a credit card, an income account and five spending categories. Ids are fixed and never contain `~` (the budget
 * key separator); names come from `t`, in the language chosen when the vault is set up.
 */
export function defaultChart(householdId: string, t: (source: string) => string): readonly CreateAccountInput[] {
  // Called `text` so the PWA catalog generator (scripts/build-pwa-catalog.mjs) collects these keys.
  const text = t
  return [
    { id: 'asset-cash', householdId, name: text("現金"), kind: 'ASSET', subtype: 'CASH' },
    { id: 'liability-card', householdId, name: text("クレジットカード"), kind: 'LIABILITY', subtype: 'CREDIT_CARD' },
    { id: 'income-salary', householdId, name: text("給与収入"), kind: 'INCOME' },
    { id: 'expense-groceries', householdId, name: text("食料品の買い物"), kind: 'EXPENSE' },
    { id: 'expense-utilities', householdId, name: text("水道・光熱費"), kind: 'EXPENSE' },
    { id: 'expense-transport', householdId, name: text("交通費"), kind: 'EXPENSE' },
    { id: 'expense-entertainment', householdId, name: text("娯楽"), kind: 'EXPENSE' },
    { id: 'expense-other', householdId, name: text("その他"), kind: 'EXPENSE' },
  ]
}
