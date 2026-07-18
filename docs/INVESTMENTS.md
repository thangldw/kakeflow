# Investments

Investment data is kept separate from household spending while sharing the same evidence and review principles.

## Asset snapshots

Snapshot imports preserve the as-of date, security code, name, asset class, quantity, unit price, currency, market value, cost basis where present, and source row. The Shift-JIS `assetbalance(all)` position table is recognized by its brokerage headers rather than by one fixed filename.

## Transactions and performance

- Purchases, sales, dividends, fees, taxes, transfers, and corporate-action exceptions remain explicit.
- FIFO realized performance is calculated from confirmed lots.
- Native-currency totals are shown per currency.
- JPY conversion appears only when an imported or otherwise source-backed FX rate exists.
- Unsupported corporate actions remain exceptions for review.

## Exports

CSV, XLSX, and PDF exports preserve the selected snapshot or reporting period and include the same exceptions shown on screen.
