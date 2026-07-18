# Card payment link corrections

A two-step `紐付けを解除` action removes a mistaken confirmed bank-debit link from a card statement.

- Only the reconciliation link and derived statement totals change.
- The bank transaction and journal remain untouched.
- The payment becomes eligible for matching again.
- Remaining confirmed payments recompute statement status atomically.
- An immutable correction audit row is written before the link is cleared.
- Direct unaudited link deletion is rejected by native guards.

The first click explains the consequence; the second confirms. The action never sends a payment instruction or moves money.
