# Transaction calculation targets

`calculationTarget` controls whether a posted transaction contributes to household analytics. It does not change accounting truth.

Included transactions contribute to dashboard KPIs, accrual/cash-flow totals, calendar activity, reports, budgets, recurring/fixed-cost detection, anomalies, and forecast history. Account group, attribution, basis, date, and calculation target combine independently with logical AND.

Excluding a transaction does not delete, void, reverse, or rebalance it. The record remains in the ledger/export with journal entries, evidence, account and net-worth balances, card statements, settlements, schedules, and audit history. An excluded cash purchase still reduces the actual cash balance.

Card-linked records permit a flag-only update only when every other field and journal entry matches persisted data. Simultaneous content edits must use reconciliation workflows.

Exports include `calculation_target = true|false`; excluded facts are never silently omitted. New and migrated transactions default to included.
