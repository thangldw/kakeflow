# Cumulative card-payment reconciliation

One statement can reconcile with multiple confirmed bank debits. Reconciliation links already-posted facts; it never initiates payment or rewrites journals.

| Confirmed payment total | Status |
| --- | --- |
| None | `UNMATCHED` |
| Below statement | `PARTIALLY_RECONCILED` |
| Equal to statement | `FULLY_RECONCILED` |
| Above statement | `OVERPAID` |

At confirmation, native code revalidates household, card account, posted state, positive amount, settlement window, and one-statement ownership. Confirmation is atomic and idempotent.

Purchases remain expenses; bank debits remain cash/liability movements. Linking changes only reconciliation metadata, not journals, evidence, balances, expense totals, or budgets. Coverage subtracts only confirmed payments effective by `asOf`; suggestions and future payments do not reduce obligations.

Due-date editing is independent timing metadata. Mistaken links use the audited [correction workflow](CARD_PAYMENT_LINK_CORRECTIONS.md).
