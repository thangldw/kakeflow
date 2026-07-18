# Annual Investment Performance CSV

The UTF-8 BOM CSV uses the same validated annual `InvestmentPerformanceRequest` and FIFO query as the screen, XLSX, and PDF.

The request covers one calendar year and optional same-household securities account. Earlier purchases may establish FIFO basis, but period totals/allocations remain within the selected year. Native currencies never combine.

One fixed 36-column table uses explicit grains:

- `CURRENCY_TOTAL`;
- `REALIZED_ALLOCATION`;
- `CORPORATE_ACTION_ALLOCATION`;
- `UNCOVERED_SALE`;
- `SKIPPED_EVENT`;
- `UNALLOCATED_CORPORATE_ACTION`; and
- `DISCLOSURE`.

Every row repeats scope, annual range, `FIFO`, and currency policy. Nullable values use explicit status or blank; missing provenance is never fabricated.

Rust queries, validates, generates, and saves the file. Output uses RFC quoting/CRLF and is bounded to 25,003 rows and 16 MiB. Invalid annual scope, non-FIFO data, malformed facts, impossible provenance, non-finite values, or limits fail closed. Cancellation writes nothing.
