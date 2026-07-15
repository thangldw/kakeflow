# Card payment link corrections

KakeFlow lets a user undo a mistakenly confirmed bank-debit-to-card-statement link from the card reconciliation screen.

## Invariants

- Unlinking changes only the reconciliation link and derived statement totals.
- The original bank transaction and its journal entries are never edited or deleted.
- The payment becomes an eligible candidate again after unlinking.
- Remaining confirmed payments are summed again in the same database transaction, producing `UNMATCHED`, `PARTIALLY_RECONCILED`, `FULLY_RECONCILED`, or `OVERPAID` from the new total.
- Every local correction creates an immutable `card_payment_link_corrections` audit row before the link is cleared.
- A direct SQL update cannot clear a confirmed link without that matching audit event. Change-package materialization uses the existing household-scoped apply guard and still validates the complete reconciliation graph before commit.

## Desktop flow

The first **紐付けを解除** click explains the consequence. A second **解除を確定** click performs the correction. Success and failure are reported inline; no payment instruction is sent and no money movement is initiated.
