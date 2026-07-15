# Portfolio Snapshot CSV

KakeFlow can export the exact securities snapshot selected in the investment workspace as one UTF-8 CSV with BOM. This detailed export complements the existing date-range snapshot-summary CSV; it does not silently substitute the latest snapshot.

## Record grains

The `record_type` column distinguishes four grains in one bounded table:

- `SUMMARY`: selected snapshot identity, account, `asOf`, JPY market/cash values, and available P&L;
- `ASSET_CLASS`: snapshot asset-class totals;
- `POSITION`: native-currency quantity, average cost, market price, JPY values, and P&L;
- `FX_RATE`: snapshot-local base/JPY rates.

Every row carries the selected snapshot, household, account, `asOf`, and source-document identifier. Asset-class, position, and FX rows also carry the physical source row. Nullable financial values remain empty and have an adjacent `AVAILABLE` or `NOT_PROVIDED` status.

## Scope and exclusions

CSV, XLSX, and PDF all use the explicitly selected snapshot and the same strict snapshot validation. The CSV does not mix in:

- FIFO brokerage performance or cash events;
- current holdings valuation or later market prices;
- Money Forward aggregate total-assets history;
- FX conversion from another date; or
- invented trend, allocation, ROI, TWR, IRR, or forecast metrics.

Cancellation writes no file. Generation and save failures leave the selected snapshot and investment data unchanged.
