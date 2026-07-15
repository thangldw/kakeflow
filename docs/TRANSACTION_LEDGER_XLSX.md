# Transaction Ledger XLSX

KakeFlow can save the confirmed transaction ledger as a native Excel workbook. The workbook uses the same validated canonical table as the existing transaction CSV export; it does not run a second query, parse the CSV, calculate totals, or infer a different scope.

## Exact export scope

The request preserves all existing ledger-export dimensions:

- household;
- complete `fromDate` through `toDate` range;
- accrual or cash accounting basis;
- optional saved account group; and
- all activity, household-common activity, or one member's attributed activity.

Only posted transactions selected by the existing ledger export are included. Accrual exports omit card-payment settlements, while cash exports omit card purchases, matching the CSV contract. `calculation_target` remains an explicit typed Boolean column and is not used to silently remove otherwise selected rows.

## Workbook structure

The workbook contains two fixed sheets:

- `Transactions` contains the same 19 ordered columns and rows as the canonical transaction CSV table. Dates are native Excel dates, `amount_jpy` is a numeric JPY cell, and `calculation_target` is a Boolean. The header is frozen and filtered.
- `Scope` records the household, accounting basis, account group or `ALL`, attribution scope/member, native date range, confirmed-only flag, and typed row count.

There are no formulas, hidden totals, pivots, charts, or independently recomputed financial facts.

## Bounds and native save boundary

Generation is limited to 100,000 rows, 19 columns, 1.9 million data cells, 4,096 Unicode characters per text cell, and a 32 MiB workbook. JPY values outside Excel's exact integer range are rejected instead of being rounded. The workbook bytes stay in Rust and are written only after the native save dialog returns a destination. Cancel returns no artifact and is not an error.

Portfolio snapshots remain available as CSV in this workspace. Their purpose-built Excel/PDF artifacts remain in the investment workspace; the transaction-ledger workbook does not claim portfolio parity.
