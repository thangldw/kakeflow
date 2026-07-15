# Custom CSV/TSV parser profiles

KakeFlow can normalize JPY transaction files that do not match a built-in
institution adapter. Profiles are saved in the encrypted household database and
are applied only when the user explicitly selects one for a file in Import Inbox.

KakeFlow adds an inline rescue workflow. An unsupported CSV/TSV always shows
`このファイルを読み取る`, including when no profile exists. The dialog reads the
file locally, offers header candidates from its first twelve physical rows, and
populates every mapping dropdown only from the selected header. Changing that
row clears stale mappings.

## Supported mapping

A profile defines:

- delimiter: automatic, comma, tab, or semicolon;
- encoding: automatic, UTF-8, or CP932/Shift_JIS;
- one-based header row and a date column/date format;
- at least one description or payee column;
- either one signed amount column or separate debit and credit columns;
- for a signed column, whether a positive value means money in or money out;
- optional external transaction ID and account-hint columns.

All amounts are integer JPY. Multi-currency files, portfolio snapshots, and
brokerage events continue to require their dedicated adapters. A profile maps
source data into ordinary bank/card transaction candidates; it never posts a
transaction directly.

## Preview and integrity rules

The local preview shows the selected encoding and delimiter, every configured
header match, candidate count, excluded-row count, and row-level issues. Empty
rows and recognized total/subtotal rows do not become candidates. Duplicate
headers, invalid dates, zero or ambiguous debit/credit values, missing columns,
or invalid encoding produce errors.

If any error is present, KakeFlow blocks staging even when other rows are valid.
This avoids presenting a partial import as complete. After a clean preview, the
user selects an Asset or Liability source account. An exact account ID/name hint
may preselect it, but the hint never assigns an account without confirmation.

The import then follows the standard pipeline:

```text
Local file
  -> actual-header mapping + local preview
  -> saved household profile
  -> ready-to-stage preview
  -> explicit `取込開始`
  -> immutable source rows
  -> pending transaction candidates
  -> account/category/reconciliation review
  -> explicit approval
  -> posted ledger
```

The import stores the profile ID and version as its adapter version so later
audits can identify the mapping that produced each candidate. Changing a profile
uses optimistic concurrency; stale updates or deletes fail and require reload.
