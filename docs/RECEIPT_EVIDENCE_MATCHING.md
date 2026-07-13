# Receipt evidence matching

KakeFlow 0.21 can attach an offline-OCR receipt candidate to an existing posted
household expense. This is an evidence workflow, not an automatic transaction
creation workflow.

## Suggestion rules

The Import Inbox asks the native ledger for possible matches only for a
reviewable candidate produced by the `receipt-text-v2` adapter. A transaction is
eligible when all of the following remain true:

- it belongs to the same household;
- it is a posted `EXPENSE` or `CARD_PURCHASE` transaction;
- its expense debit equals the extracted receipt total exactly; and
- its transaction date is no more than three calendar days before or after the
  receipt date.

Eligible transactions are ranked by date proximity and normalized merchant-name
similarity. KakeFlow returns at most ten suggestions and shows explainable
signals, including the exact amount, date difference, and merchant similarity.
Merchant similarity improves ranking; it does not override the exact-amount and
date-window requirements.

Suggestions are deliberately conservative and local. They do not use a remote
model, silently broaden the date range, infer another household, or choose a
match on the user's behalf.

## Explicit confirmation

The user selects a suggested transaction and explicitly confirms
`新規支出を作らず証憑として紐付け`. Until that action, the receipt remains a
review candidate and no relationship is persisted.

At confirmation, KakeFlow rechecks the household, posted status, transaction
type, exact expense amount, and three-day date window in one database
transaction. A stale, changed, cross-household, or otherwise ineligible target
is rejected instead of being linked optimistically.

Successful confirmation:

1. records the selected receipt-to-transaction relationship;
2. attaches all immutable receipt source rows to the posted transaction as
   supporting evidence;
3. resolves the receipt candidate as linked; and
4. completes its import run when no other candidates still require review.

Repeating the same confirmation is idempotent. Attempting to attach the same
receipt candidate to a different transaction is rejected.

## No duplicate expense

Evidence linking does **not** create a new ledger transaction or journal entry.
It does not change the selected transaction's amount, category, accounts,
calculation-target state, balances, dashboards, budgets, or card reconciliation.
The existing posted purchase remains the single recognized expense; the receipt
becomes additional provenance that can be inspected from that transaction.

Users can still choose the ordinary review/posting path when a receipt genuinely
represents a new cash or other expense and no existing transaction is the right
match.

## Current boundaries

- Suggestions cover posted household expenses and card purchases, not income,
  transfers, investments, pending card authorizations, or unposted candidates.
- Amount matching is exact in JPY; foreign-currency and tolerance-based matching
  are not inferred.
- The date window is fixed at three calendar days.
- A merchant-name mismatch can lower ranking but does not automatically exclude
  an otherwise eligible exact-amount/date candidate, so user review remains
  mandatory.
- One receipt candidate can be linked to only one posted transaction.
