# Credit-card statement due dates

Users can add, correct, or clear a statement payment due date. Adapters never guess a date absent from the source.

The native boundary accepts `null` or a real `YYYY-MM-DD` date on or after statement period end, scoped to the active household. Saving refreshes statement, coverage, forecast, and Action Center views. Clearing returns the statement to the missing-date state and excludes it from dated projection.

Due date is timing metadata only. It never changes statement amount/lines/evidence, payment links, paid/outstanding totals, reconciliation, transactions, or journals. Re-saving the same date is idempotent.
