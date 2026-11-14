import type { Transaction } from '../platform/pwa/types'
import { formatJpy } from './formatJpy'

/**
 * The posted ledger, newest first: the classic Ledger page and the Simple History tab both show this list.
 * Without `onProvenance` the rows have no provenance button.
 */
export function PostedLedgerList({ transactions, onProvenance, emptyText = 'No posted transactions.' }: {
  readonly transactions: readonly Transaction[]
  readonly onProvenance?: (id: string) => Promise<void>
  readonly emptyText?: string
}) {
  return <div className="pwa-panel">{transactions.length === 0 ? <p>{emptyText}</p> : transactions.slice().reverse().map((transaction) => <article className="pwa-ledger-row" key={transaction.id}><div><time>{transaction.occurredOn}</time><h2>{transaction.payee}</h2><small>{transaction.transactionType} · {transaction.canonicalPostingHash.slice(0, 12)}…</small></div><strong>{formatJpy(transaction.amountJpy)}</strong>{onProvenance && <button className="pwa-quiet" type="button" onClick={() => void onProvenance(transaction.id)}>View provenance</button>}</article>)}</div>
}
