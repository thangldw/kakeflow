# Dashboard data quality and freshness

KakeFlow 0.30 places a compact data-quality summary underneath the Home analytical widgets. Its purpose is to qualify the dashboard, not to invent a universal completeness score.

## Source-backed facts

For the active household the panel reports:

- the most recently imported source document belonging to a `POSTED` import run;
- its import timestamp, original filename, and source type;
- total immutable source documents and source records;
- the number of distinct source types represented by household documents;
- pending and ready transaction candidates that are still excluded from confirmed-ledger analytics;
- failed import runs that need attention.

The latest source uses `imported_at DESC, source_document.id DESC` for deterministic tie-breaking. A document from another household or a non-posted run cannot become the successful-import freshness marker. The nullable timestamp, filename, and source type are validated as one atomic provenance tuple by the desktop client.

## Status semantics

The panel uses only four bounded states:

- `原本データなし`: no source documents are recorded;
- `取込エラーあり`: at least one import run is failed;
- `確認待ちあり`: pending or ready candidates remain outside confirmed analytics;
- `確認済みデータを反映`: source data exists and neither of the above warnings is present.

The last state does **not** claim that every bank, card, wallet, or investment account is covered. KakeFlow does not know external account completeness from local files alone.

## Interaction and accessibility

The single action opens Import Inbox, where review or failed-ingestion work can be resolved. Browser preview labels the panel as sample data and disables desktop-only dashboard preference controls. KPI direction includes semantic text, and the six-month SVG chart has an adjacent visually hidden numeric table using the same data points and labels.
