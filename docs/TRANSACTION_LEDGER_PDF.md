# Transaction Ledger PDF

The searchable Japanese PDF consumes the same validated canonical table as transaction CSV/XLSX. It does not run another query or infer totals.

## Scope

The request preserves household, inclusive date range, accrual/cash basis, optional account group, and attribution scope. Only posted selected transactions appear.

- Accrual omits card settlements to avoid double-counting purchases.
- Cash omits card purchases and retains their later settlement.
- `calculation_target` remains visible and does not hide selected rows.
- Pending imports and OCR candidates are excluded and disclosed.

The landscape A4 cover records scope, row count, and caveats. Detail pages repeat a fixed header and include dates, type, payee, description, amount, status, category, calculation target, IDs, debit/credit accounts, group, attribution, and evidence identifiers. Noto Sans JP is pinned and rows never split across pages.

Bounds: 500 rows, 512 characters per cell, 128 pages, and 32 MiB. Rust retains bytes through save; cancellation writes nothing. Release validation follows [PDF visual QA](PDF_REPORT_VISUAL_QA.md).
