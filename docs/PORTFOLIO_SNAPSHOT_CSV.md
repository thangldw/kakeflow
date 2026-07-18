# Portfolio Snapshot CSV

The native CSV exports the exact selected securities snapshot. It never replaces the selection with the latest snapshot or mixes event-based performance into point-in-time holdings.

One fixed record-grain table contains:

- snapshot scope and JPY summary;
- asset-class totals;
- positions with native currency, quantity, cost, price, source-reported JPY value/P&L, and lineage;
- snapshot-local FX observations; and
- disclosures for absent and intentionally excluded metrics.

Blank source values remain blank, never zero. The exporter does not calculate quantity × price, derive P&L, convert currencies, or infer live valuation. Every child record retains source document and row when provided.

Output is UTF-8 with BOM, RFC-style quoting, CRLF, deterministic order, bounded rows/text, and native-only save. Invalid snapshot ownership, counts, currencies, rates, provenance, non-finite values, or size limits fail closed. Cancellation writes nothing.
