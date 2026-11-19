import type { TaxTransaction } from '../features/reports/taxSupport'
import type { PwaLedgerClient } from '../platform/pwa/client'

/**
 * Posted vault transactions in the shape the tax-support report reads. The vault has no status, calculation
 * target or description: every stored transaction is posted and counts. The category is the expense account
 * the transaction debits, which is what the medical-expense rule looks at.
 */
export async function loadPwaTaxTransactions(client: PwaLedgerClient, householdId: string): Promise<readonly TaxTransaction[]> {
  const [transactions, accounts] = await Promise.all([client.listTransactions(householdId), client.listAccounts(householdId)])
  const expenseName = new Map(accounts.filter((account) => account.kind === 'EXPENSE').map((account) => [account.id, account.name]))
  return transactions.map((transaction) => ({
    id: transaction.id,
    occurredOn: transaction.occurredOn,
    transactionType: transaction.transactionType,
    payee: transaction.payee,
    description: null,
    amountJpy: transaction.amountJpy,
    status: 'POSTED',
    calculationTarget: true,
    categoryName: transaction.entries.map((entry) => expenseName.get(entry.accountId)).find((name) => name !== undefined) ?? null,
  }))
}

/** Hands the CSV to the browser as a download; returns true once the download was started. */
export function downloadCsv(csv: string, fileName: string): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked on the next task so the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return Promise.resolve(true)
}
