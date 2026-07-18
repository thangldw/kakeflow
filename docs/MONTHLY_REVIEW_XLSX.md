# Monthly Household Review XLSX

The workbook uses the same `MonthlyFinancialReportRequest`, selected month, account group, attribution scope, and data-quality `asOf` as the screen, CSV, and PDF.

| Sheet | Contents |
| --- | --- |
| `Summary` | Period, scope, income, expense, savings, rate, and count |
| `Comparisons` | Prior month/year values and validated changes |
| `Drivers` | Bounded prior-month category and merchant changes |
| `Health` | Budgets, household goals, reconciliation, import quality, and limitations |

The selected month remains a complete financial period; `asOf` is freshness metadata. Household-wide goal/data-quality facts are not relabeled as member-only. Typed numeric cells preserve JPY, counts, percentages, and signed values. Missing DTO metrics remain unavailable rather than being calculated in Excel.

Rust generates and saves the workbook. Bytes do not cross WebView IPC; cancellation writes nothing. Bounds include four sheets, eight category and merchant drivers each, bounded text, exact Excel integers, and 8 MiB.
