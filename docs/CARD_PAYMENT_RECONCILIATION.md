# Cumulative card-payment reconciliation

KakeFlow can reconcile one credit-card statement with more than one confirmed
bank debit. Reconciliation is a relationship between already-posted ledger
transactions and a statement; it never initiates a payment or rewrites a
journal entry.

## Derived statement status

The statement amount is compared with the sum of explicitly confirmed payment
links:

- no confirmed payment: `UNMATCHED`;
- confirmed total below the statement amount: `PARTIALLY_RECONCILED`;
- confirmed total equal to the statement amount: `FULLY_RECONCILED`;
- confirmed total above the statement amount: `OVERPAID`.

The Cards workspace shows the statement once, the confirmed total, remaining or
excess amount, and every linked bank debit. An eligible unconfirmed debit is
only a suggestion until the user explicitly confirms it.

## Confirmation rules

At confirmation time the native ledger revalidates that the statement and
payment belong to the same household and card account, the payment transaction
is posted, the amount is positive, and its date is within the supported
statement-settlement window. A payment cannot be linked to two statements.

Confirmation is atomic and idempotent. Repeating the same confirmation does not
add the amount twice. Any cross-household, stale, conflicting, or otherwise
invalid relationship is rejected without partial changes.

## Accounting boundary

Card purchases remain the household expenses. Bank debits that pay the card
remain cash-flow and liability movements. Linking those facts changes only
reconciliation metadata: journal entries, source evidence, account balances,
expense totals, and budget actuals remain unchanged.

Coverage projections count only confirmed payments effective on or before the
requested as-of date. Possible matches and future payments are disclosed but do
not silently reduce an obligation.

The statement payment due date is editable metadata, independent from payment
matching. Setting, correcting, or clearing it changes forecast timing only. It
does not create a payment, confirm a candidate, change the reconciliation status,
or modify any transaction or journal entry.
