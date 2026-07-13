# Credit-card statement due dates

KakeFlow 0.29 lets a household enter, correct, or clear the payment due date for an imported credit-card statement. Card CSV adapters do not guess a due date when the source file does not supply one.

## Workflow

- Every statement card shows its stored due date and labels it as a user-confirmed value.
- A missing-date warning provides the same date input without requiring the user to find the statement in the selected month.
- Saving refreshes card statements, mapped-bank coverage, cash forecast, and Action Center data.
- Clearing the date deliberately returns the statement to the missing-date warning and removes it from dated coverage and forecast calculations.

## Validation

The native ledger accepts only `null` or a real canonical `YYYY-MM-DD` date. A date cannot be earlier than the statement period end. The update is scoped to the active household; a missing or other-household statement is rejected.

KakeFlow does not infer a date from the card issuer, merchant text, another billing cycle, or a bank debit. The user must verify the date against the issuer's statement.

## Accounting boundary

The due date controls timing metadata for coverage and forecast views only. An edit preserves:

- statement amount, period, detail lines, and source evidence;
- confirmed and eligible payment links;
- paid, outstanding, and overpaid totals;
- reconciliation status;
- transactions and every balanced journal entry.

The command is idempotent: saving the same date again returns the same statement state without creating another financial event.
