import type { Account, CreateAccountInput } from '../platform/pwa/types'

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

/** Composed (NFC) so a name typed with combining marks (common in Vietnamese) matches the same name precomposed. */
function normalizedName(name: string) {
  return name.normalize('NFC').trim().toLocaleLowerCase()
}

interface ChartClient {
  listAccounts(householdId: string): Promise<readonly Account[]>
  createAccount(input: CreateAccountInput): Promise<unknown>
}

/**
 * For a new vault only: creates the starter accounts the household does not have yet. An account is skipped when its id exists or when
 * an account of the same kind already has the same name (a setup-form "Cash" is not doubled). Never removes or
 * changes an existing account.
 */
export async function addDefaultChart(client: ChartClient, householdId: string, t: (source: string) => string): Promise<void> {
  const existing = await client.listAccounts(householdId)
  for (const account of defaultChart(householdId, t)) {
    const present = existing.some((current) => current.id === account.id
      || (current.kind === account.kind && normalizedName(current.name) === normalizedName(account.name)))
    if (!present) await client.createAccount(account)
  }
}

/** Whether quick add offers `account` as where the money comes from (expense) or lands (income); see quickAddChoices. */
function canPay(account: Account, kind: 'EXPENSE' | 'INCOME') {
  if (account.kind === 'ASSET') return account.subtype === undefined || ['BANK', 'CASH', 'WALLET'].includes(account.subtype)
  return kind === 'EXPENSE' && account.kind === 'LIABILITY' && (account.subtype === undefined || account.subtype === 'CREDIT_CARD')
}

/**
 * The quick-add sheet's "Set up accounts" for an existing household: creates only what a quick add of `kind` lacks,
 * with the starter chart's id and name for each item: a category of that kind (the salary account for income, the
 * "Other" category for spending) when there is none, and the cash account when nothing can pay or receive. An item
 * whose id already exists is skipped. The full starter chart is for new vaults only (see addDefaultChart).
 */
export async function addQuickAddEssentials(client: ChartClient, householdId: string, kind: 'EXPENSE' | 'INCOME', t: (source: string) => string): Promise<void> {
  const existing = await client.listAccounts(householdId)
  const chart = defaultChart(householdId, t)
  const wanted: string[] = []
  if (!existing.some((account) => account.kind === kind)) wanted.push(kind === 'INCOME' ? 'income-salary' : 'expense-other')
  if (!existing.some((account) => canPay(account, kind))) wanted.push('asset-cash')
  for (const id of wanted) {
    const account = chart.find((item) => item.id === id)
    if (account && !existing.some((current) => current.id === id)) await client.createAccount(account)
  }
}
