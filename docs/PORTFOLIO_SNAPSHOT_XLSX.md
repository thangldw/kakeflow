# Portfolio Snapshot XLSX

The native workbook exports one explicitly selected point-in-time securities snapshot. It does not query the latest snapshot, calculate performance, or combine unrelated investment grains.

| Sheet | Contents |
| --- | --- |
| `Summary` | Snapshot identity, household, source/as-of metadata, JPY summary, and counts |
| `AssetClasses` | Source-reported asset-class values |
| `Positions` | Instrument, class, native currency, quantity, cost, price, JPY value/P&L, and lineage |
| `FXRates` | Snapshot-local base/JPY rates and lineage |

Child sheets retain headers when empty. Blank means absent and is never converted to zero. No formula, macro, external link, inferred market value, calculated P&L, or currency conversion is generated.

Validation checks ownership, snapshot/count consistency, unique IDs, ISO currencies, positive source rows/rates, finite values, text/numeric bounds, at most 25,000 data rows, and 8 MiB. Rust generates and writes the complete workbook atomically; cancellation writes nothing.
