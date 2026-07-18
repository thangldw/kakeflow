# Annual Investment Performance XLSX

The workbook uses the same annual request, FIFO query, native-currency policy, provenance, and exceptions as the screen and CSV.

| Sheet | Contents |
| --- | --- |
| `Summary` | Household/account scope, annual range, FIFO method, and per-currency totals |
| `Realized` | Buy-to-sell allocations with dates, amounts, instruments, and both source rows |
| `CorporateActions` | Explicit action terms, conversions, allocations, cash, P&L, and lineage |
| `Exceptions` | Uncovered sales, skipped events, and unallocated actions |

Earlier acquisitions may supply cost basis, but dated totals and allocations remain within the annual range. JPY, USD, and other currencies stay separate; no mixed grand total or implicit FX is added.

The workbook excludes current holdings, open lots, current valuation, unrealized P&L, prices, FX reporting conversion, snapshots, aggregate history, ROI, TWR, IRR, and forecasts.

Rust generates and saves the workbook; bytes do not cross IPC and cancellation writes nothing. Bounds include four sheets, 20,000 total rows, 512-character cells, finite Excel values, and 8 MiB. Invalid scope, period, FIFO response, currency/date/provenance, exception completeness, or limits fail closed.
