# Portfolio Snapshot PDF

## Purpose

Portfolio Snapshot PDF is a shareable, source-auditable rendering of one
persisted securities snapshot. It uses the same explicit
`householdId + snapshotId` selection as the investment workspace and
[Portfolio Snapshot XLSX](PORTFOLIO_SNAPSHOT_XLSX.md). The exporter never
substitutes the latest snapshot and never combines multiple snapshots.

The report is designed for reviewing values imported from an
`assetbalance(all)_*.csv`-style source. It is not an investment-performance
calculation.

## Truth boundary

One PDF represents exactly:

- one household-scoped, explicitly selected portfolio snapshot;
- one securities account and its display name;
- one source document and source-provided `asOf` time;
- the persisted JPY summary, asset classes, positions, and snapshot-local FX
  rows belonging to that snapshot.

Values are rendered as persisted. Blank nullable values stay visibly
unavailable and are never converted to zero. The report does not calculate a
missing position value, derive P&L, perform an FX conversion, or refresh market
prices.

## Report contents

The bounded Japanese A4 report contains:

1. an executive snapshot summary with the selected snapshot, account, source,
   `asOf`, market value, cash value, source-reported P&L, and completeness
   counts;
2. source-reported asset-class composition using exact JPY values;
3. a bounded position table preserving product/account type, instrument,
   native currency, nullable quantity/cost/price, source-reported JPY value and
   P&L, and Source Document/Row lineage;
4. snapshot-local FX rows with base/JPY quote, exact source rate, and source
   row lineage, plus explicit interpretation caveats.

Long tables may continue across pages within the native page and row limits.
Rows are not silently discarded to make a report fit.

## Native save contract

PDF construction and filesystem writes remain in the native process. The UI
sends only the exact selected-snapshot request and receives only saved-file
metadata. PDF bytes are not serialized through frontend IPC.

Canceling the platform save dialog is a successful no-op: no file is written,
the selected snapshot remains visible, and the operation is not presented as
an error. XLSX and PDF saves are mutually locked so two exports cannot overlap.

## Explicit exclusions

The snapshot PDF does not manufacture or imply:

- event-based FIFO performance or realized allocations;
- a current or live valuation beyond the persisted `asOf` snapshot;
- FX-consolidated native position values beyond source-reported JPY fields;
- multi-snapshot trends, change analysis, or Money Forward aggregate history;
- ROI, TWR, IRR, benchmark return, forecast, or investment advice;
- brokerage trades, dividends, fees, taxes, or open-lot calculations.

Those require separate event, valuation, or time-series contracts. The PDF
keeps this point-in-time source boundary visible on every release.

## Release validation

The stable-release gate verifies bounded deterministic PDF structure and
renders every page with Poppler. A reviewer must inspect all pages at 100% zoom
for Japanese glyphs, clipping, table continuation, nullable-value semantics,
selected-snapshot identity, native-currency and FX labels, exact source
lineage, and the absence of invented performance or live-valuation claims.
