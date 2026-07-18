# Annual Household Review XLSX

The native workbook reuses the exact `YearlyFinancialReportRequest` and validated screen/CSV DTO.

| Sheet | Contents |
| --- | --- |
| `Summary` | Scope, completeness window, comparable KPIs, deltas, rates, and confirmed count |
| `Monthly` | Exactly 12 typed `COMPLETE`, `PARTIAL`, or `FUTURE` rows |
| `Drivers` | Bounded category and merchant changes |
| `Health` | Budgets, goals, reconciliation, import freshness, and limitations |

Financial values remain numeric and signed. The workbook does not include pending transactions, invent metrics, or treat partial/future months as observed.

Rust generates and saves the file; binary bytes never cross WebView IPC. Cancellation writes nothing. Generation is bounded to four sheets, 12 months, fixed driver limits, bounded text, exact Excel integers, and 8 MiB. Invalid or oversized output fails instead of truncating or rounding.
