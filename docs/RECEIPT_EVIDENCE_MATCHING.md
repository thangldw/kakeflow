# Receipt evidence matching

KakeFlow can attach an OCR receipt candidate to one existing posted expense. This adds evidence and never creates another transaction.

## Suggestions

A `receipt-text-v2` candidate can match only a transaction that:

- belongs to the same household;
- is a posted `EXPENSE` or `CARD_PURCHASE`;
- has an expense debit exactly equal to the receipt total; and
- falls within three calendar days of the receipt date.

At most ten results are ranked by date proximity and normalized merchant similarity. Amount and date are hard requirements; merchant similarity is explanatory ranking only. No remote model or automatic selection is used.

## Confirmation

The user explicitly chooses `新規支出を作らず証憑として紐付け`. The native transaction revalidates household, status, type, exact amount, and date window before it:

1. records the receipt relationship;
2. attaches immutable source rows as supporting evidence;
3. resolves the receipt candidate; and
4. completes the import when no candidate remains.

Exact repeat is idempotent; linking one receipt candidate to another transaction is rejected.

The operation does not change amount, category, accounts, calculation target, balances, metrics, budgets, or reconciliation. Income, transfers, investments, pending authorizations, foreign-currency tolerance, and unposted targets are outside the matching boundary.
