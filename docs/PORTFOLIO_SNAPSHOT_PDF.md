# Portfolio Snapshot PDF

The PDF renders the exact snapshot selected in the investment workspace using the same validated snapshot DTO as CSV/XLSX.

It records household, snapshot ID, source `asOf`, JPY summary, asset classes, native-currency positions, nullable values, snapshot-local FX, and source document/row lineage. Missing values display as `NULL` or unavailable; the report does not substitute a newer snapshot.

The PDF excludes FIFO performance, open-lot computation, live quotes, Money Forward aggregate history, trend interpolation, ROI/TWR/IRR, and forecasts. It never creates JPY conversions absent from the source snapshot.

Rust generates a bounded searchable PDF with pinned Japanese fonts and writes only after native save confirmation. Bytes do not cross WebView IPC; cancellation writes nothing. Every release follows [PDF visual QA](PDF_REPORT_VISUAL_QA.md).
