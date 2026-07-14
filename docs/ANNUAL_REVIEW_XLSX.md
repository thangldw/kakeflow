# Annual Household Review XLSX

KakeFlow 0.65 can save the validated Annual Household Review as a native Excel workbook. The export uses the same `YearlyFinancialReportRequest` and report DTO as the visible annual screen and CSV, so year, as-of date, saved account group, and household/member attribution scope do not drift between formats.

## Workbook contents

- `Summary`: report scope, completeness window, current/prior comparable income, expense, savings, deltas, rates, and confirmed transaction count.
- `Monthly`: exactly twelve rows with explicit `COMPLETE`, `PARTIAL`, or `FUTURE` state and typed JPY, percentage, and count cells.
- `Drivers`: the bounded category and merchant changes already shown by the annual report.
- `Health`: budget, goals, card reconciliation, import completeness, latest-source freshness, and the report limitations needed to interpret the numbers.

The workbook contains Japanese labels and keeps signed financial values numeric instead of formatting them as text. It does not invent metrics, include pending transactions, or convert partial/future months into observed activity.

## Save boundary

The workbook is generated and written by the native desktop process. Binary workbook bytes are not serialized through WebView IPC; the UI receives only the filename, row count, byte size, and cancellation result. Cancelling the native save dialog writes nothing.

Generation is bounded to four sheets, twelve months, a fixed driver limit, bounded cell text, an 8 MiB workbook, and integers that Excel can represent exactly. Invalid or oversized reports fail instead of silently truncating or rounding values.

This release exports only the Annual Household Review to XLSX. Monthly and investment XLSX reports, and visually verified PDF reports with deterministic Japanese font embedding, remain separate milestones.
