# Monthly Household Review XLSX

KakeFlow 0.67 can save the validated Monthly Household Review as a native Excel workbook. The export runs the same `MonthlyFinancialReportRequest` and report query as the visible monthly screen, including the selected calendar month, saved account group, and household/member attribution scope. The later [Monthly Household Review CSV](MONTHLY_REVIEW_CSV.md) uses that same request and resolved data-quality `asOf` date without changing the workbook contract.

## Reporting period and scope

Income, expense, savings, transaction count, comparison metrics, drivers, budget, and card reconciliation cover the complete selected calendar month. The optional `asOf` request value is used only as the data-quality reference date; it does not truncate the financial reporting period or turn the selected month into an as-of financial snapshot.

Scope behavior follows the existing monthly report query:

- income, expense, savings, transaction count, category and merchant drivers, budget, and card reconciliation respect the selected account group and household/member attribution scope;
- savings goals remain household-wide; and
- import completeness and source freshness remain household-wide.

The workbook records the household ID, account-group ID or `ALL`, attribution kind, and member ID when applicable. It does not infer a different scope or silently present household-wide goal and data-quality facts as member-only facts.

## Workbook contents

The workbook has four fixed sheets:

- `Summary`: report period and scope metadata plus current-month income, expense, savings, savings rate, and confirmed transaction count.
- `Comparisons`: current month, prior month, month-over-month change, prior-year month, and year-over-year change for the report metrics. A rate or delta that is not present in the validated DTO is shown as unavailable rather than calculated independently in Excel.
- `Drivers`: the bounded category and merchant expense changes returned by the monthly report. These drivers are always calculated against the prior month (`PRIOR_MONTH`), regardless of whether the visible UI comparison toggle is set to prior month or prior year.
- `Health`: budget status, household-wide savings-goal progress, card reconciliation, household-wide import completeness and freshness, plus the scope and period limitations needed to interpret those values.

JPY amounts, counts, and percentages remain typed numeric cells. Signed values are not converted to display text, pending transactions are not inserted, and the workbook does not manufacture transaction details or metrics absent from the monthly report DTO.

## Native save boundary

The workbook is generated and written by the native desktop process. Binary workbook bytes are not serialized through WebView IPC. The UI receives only the saved filename, exported data-row count, byte size, and cancellation result. Cancelling the native save dialog writes nothing.

Generation is bounded to four sheets, at most eight category drivers and eight merchant drivers, bounded cell text, an 8 MiB workbook, and integers that Excel can represent exactly. Invalid, inconsistent, or oversized report data fails instead of being silently truncated, rounded, or reinterpreted.

The source-backed Monthly Household Review is also available as deterministic CSV and as a visually verified PDF with embedded Japanese fonts. All three formats retain their own structural validation while sharing the same report request and metric semantics.
