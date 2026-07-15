# Investment performance accounting

KakeFlow derives investment holdings, realized performance, dated market valuation, and explicit corporate-action allocations from immutable brokerage events and provenance-bearing observations.

## Market valuation

Valuation selects the latest confirmed instrument price on or before the requested
date. Prices imported with `assetbalance(all)_*.csv` snapshots are reused with
their original document and row provenance. A future quote, wrong-currency quote,
or missing quote is never substituted: the affected position remains unvalued and
is excluded from currency totals with an explicit missing-price warning.

Market value and unrealized P&L stay grouped by native currency. The FX reporting
layer remains separate so valuation never silently combines unlike currencies.

## Cost basis

The cost-basis method is **FIFO (first in, first out)**. A sale consumes the oldest open purchase lot in the same household account, instrument identity, and currency. Instrument code is the primary identity; normalized instrument name is used only when a code is absent.

- Purchase cost basis = gross purchase amount + purchase fee + purchase tax.
- Net sale proceeds = gross sale amount - sale fee - sale tax.
- Realized P&L = allocated net sale proceeds - allocated FIFO cost basis.

## Corporate actions

KakeFlow supports three non-cash corporate actions with an explicit
`new units / old unit` ratio:

- `SPLIT`
- `REVERSE_SPLIT`
- `MERGER` (share-for-share; same or cross-currency with explicit terms)

Splits multiply every open lot quantity by the ratio and divide its unit cost
by the same ratio. Mergers do the same transformation and move the lot to the
explicit target instrument. The original acquisition date, source document,
source row, and total remaining cost are retained. Corporate actions never
create a realized allocation or gain by themselves.

Actions without the explicit quantities, ratios, allocation, target, or required
currency conversion are rejected or reported as skipped rather than guessed.

## Complex corporate actions

- `SPIN_OFF` creates target-instrument lots while allocating source-lot cost only
  from an explicit source-provided ratio. Acquisition date and source lineage are retained.
- `RIGHTS_SUBSCRIPTION` creates new lots from explicit subscription quantity and
  confirmed subscription cost.
- `CASH_IN_LIEU` consumes fractional quantity through FIFO and reports proceeds,
  allocated cost, and realized P&L.

Every allocation identifies both the corporate-action source row and the
originating purchase event. Missing terms are surfaced as issues and do not
produce an estimated lot or gain.

## Mixed and cross-currency mergers

A merger source row must provide the target instrument/currency, new-shares per
old-share ratio, and the fraction of source cost basis assigned to the stock
consideration. A merger with cash must also provide the total cash amount and
currency; the remainder of source basis is assigned to that cash consideration.

When an output currency differs from the source lot currency, the source row
must provide a direct rate expressed as output-currency units per one source-
currency unit. A same-currency output must omit the rate. KakeFlow does not use a
market quote, triangulate, or silently substitute a reporting FX observation for
the legal/tax allocation terms of the action.

For each open FIFO lot:

```text
stock source basis = lot basis × stock allocation ratio
stock output basis = stock source basis × source-to-target rate
cash source basis  = lot basis × (1 − stock allocation ratio)
cash output basis  = cash source basis × source-to-cash rate
cash proceeds      = total cash × lot surrendered quantity / total surrendered quantity
cash realized P&L = cash proceeds − cash output basis
```

The resulting `MERGER_STOCK` and `MERGER_CASH` allocations retain the source buy
document/row and action document/row. Reports show source basis/currency, exact
conversion rate, output basis/currency, proceeds, and realized P&L. Security,
cash, and offset legs are balanced independently in each currency; cash movement
is reported in the cash leg currency.

## FX reporting

Brokerage events and FIFO lots always retain their original currency. FX rates
are immutable observations containing an effective date, pair, provider,
source kind, observation timestamp, and optional source-document row. The
reporting conversion selects the latest direct (or explicit inverse) rate on or
before `fxAsOf`, returns the native totals alongside the converted total, and
exposes every selected rate in `conversions`.

Identity conversion uses rate `1`. Triangulation and stale-rate substitution
are intentionally unsupported. If any native currency lacks a required direct
or inverse observation, `investment_reporting_query` fails without returning a
partial converted total. This prevents an apparently complete report from
containing an invented rate.
- Partial sales retain the unconsumed quantity and cost in the original lot.
- A sale without enough prior quantity is reported as an uncovered sale. KakeFlow does not invent a zero cost basis.
- A buy or sell without a usable positive quantity is reported through `skippedEventIds`.

Each lot and realized allocation includes its buy/sell event ID, source document ID, and source row, so the calculation can be audited back to imported evidence.

## Currency policy

All holdings, costs, proceeds, dividends, fees, taxes, and realized P&L stay in their source currency. JPY is one native-currency bucket alongside USD and other ISO currency codes. The native totals never aggregate unlike currencies. The optional reporting view converts them only when every required direct or inverse dated FX observation is available and returns the exact rate provenance alongside the JPY total.

## Period behavior

A period query loads acquisitions before the requested start date because those lots may establish the cost basis of a sale inside the period. Transaction totals and realized allocations are then filtered to the requested date range. Current market return and unrealized return are intentionally excluded from this event-only view because they require trustworthy dated market valuations.
