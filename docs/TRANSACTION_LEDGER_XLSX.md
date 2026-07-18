# Transaction Ledger XLSX

The native workbook uses the same canonical transaction table and scope as CSV and PDF; it does not run a second query or calculate independent totals.

The request retains household, inclusive date range, accrual/cash basis, optional account group, and household/member attribution. Only posted transactions are included. Accrual omits card settlements; cash omits card purchases. `calculation_target` remains a typed Boolean.

| Sheet | Contents |
| --- | --- |
| `Transactions` | The canonical 19 ordered columns with native dates, numeric JPY, filters, and frozen header |
| `Scope` | Household, basis, group, attribution, date range, confirmed-only flag, and row count |

No formulas, hidden totals, pivots, charts, or independent accounting logic are added. Native code generates and writes the workbook; bytes never cross WebView IPC and cancellation writes nothing. Invalid scope, oversized text/data, non-exact integers, or output limits fail closed.
