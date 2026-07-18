# Investment performance accounting

KakeFlow derives holdings, FIFO realized performance, dated valuation, and explicit corporate-action allocations from immutable brokerage events and provenance-bearing observations.

## Valuation

Valuation selects the latest confirmed instrument price on or before the requested date. Future, wrong-currency, or missing prices are never substituted; affected positions remain unvalued and are excluded from currency totals with explicit warnings. Native currencies remain separate.

## FIFO cost basis

A sale consumes the oldest open lot in the same household account, instrument, and currency.

- Purchase basis = gross purchase + fee + tax.
- Net sale proceeds = gross sale − fee − tax.
- Realized P&L = allocated proceeds − allocated FIFO basis.

Partial sales retain remaining quantity/cost. Uncovered sales are reported without invented zero basis. Every allocation retains buy/sell event and source-row lineage.

## Corporate actions

Supported explicit actions include split, reverse split, merger, spin-off, rights subscription, and cash in lieu. Ratios, target instruments, cost allocations, cash terms, and cross-currency rates must come from the source. Missing terms are rejected or reported as unallocated; KakeFlow does not use market FX to invent legal/tax allocation terms.

Non-cash actions preserve acquisition date and total remaining cost. Cash consideration and fractional disposals can create realized allocations with both original-buy and action provenance.

## FX reporting

Events and lots retain source currency. Optional reporting conversion selects a dated direct or explicit inverse observation on or before `fxAsOf`, returns native totals and exact rate provenance, and fails if any required pair is missing. Identity uses rate 1; triangulation and stale substitution are unsupported.

Period reports scan earlier acquisitions for FIFO basis but include only in-period event totals and allocations. Current valuation/unrealized return remain separate from event-only performance.
