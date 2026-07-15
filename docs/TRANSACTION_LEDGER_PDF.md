# Transaction Ledger PDF

KakeFlow can save the confirmed transaction ledger as a deterministic,
searchable Japanese PDF. It consumes the same validated canonical table as the
transaction CSV and XLSX exports. It does not issue a second ledger query,
parse another export, infer totals, or silently choose a different scope.

## Exact export scope

The native request preserves the selected household, inclusive `fromDate`
through `toDate`, accrual or cash accounting basis, optional saved account
group, and household/member attribution scope. Only posted transactions already
selected by the canonical export contract appear.

- Accrual exports omit bank settlements of credit-card liabilities, preventing
  the card expense from being counted twice.
- Cash exports omit card purchases and retain the later cash settlement.
- `calculation_target` remains visible for every row; it is not used to hide an
  otherwise selected posted transaction.
- Pending imports, OCR candidates, and other unconfirmed data are excluded and
  disclosed on the cover page.

## Document structure

The first landscape A4 page records the date range, posted row count,
accounting basis, account group or `ALL`, attribution scope/member, household,
and accounting caveats. Detail pages repeat one fixed header and render the
canonical transaction values without a separate calculation:

- occurrence/posting dates, type, payee, description, signed JPY amount,
  status, category, and calculation-target state;
- transaction ID, debit and credit account IDs/names, category account ID,
  accounting basis, group ID, and attribution member; and
- deterministic page numbering and the pinned Noto Sans JP font already used
  by KakeFlow reports.

Long values wrap inside their transaction row. Rows are kept intact across page
boundaries, so a transaction is never split or silently truncated.

## Bounds and native save boundary

Generation accepts at most 500 posted transactions, 512 Unicode characters per
canonical cell, 128 pages, and 32 MiB. A row that cannot fit intact on one page
is rejected. These PDF-specific bounds keep rendering and manual review finite;
CSV/XLSX remain available for larger machine-readable selections.

PDF bytes stay in Rust and cross neither the WebView IPC boundary nor the save
dialog. The UI receives only filename, row count, page count, and byte size
after a destination is saved. Cancel returns no artifact and is not an error.

## Visual verification

The contract test proves deterministic bytes, exact canonical row count and
scope, searchable text, page count, save cancellation, and native write
semantics. Before a release advertises the artifact, generate the fixed fixture
and run the Poppler workflow documented in
[PDF report visual QA](PDF_REPORT_VISUAL_QA.md) with
`--require transaction-ledger`, then inspect every PNG page at 100% zoom.
