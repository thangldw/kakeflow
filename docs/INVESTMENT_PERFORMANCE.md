# Investment performance accounting

KakeFlow v0.9 derives investment holdings, realized performance, dated market valuation, and explicit corporate-action allocations from immutable brokerage events and provenance-bearing observations.

## Market valuation (v0.8)

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

## Corporate actions (v0.7)

KakeFlow supports three non-cash corporate actions with an explicit
`new units / old unit` ratio:

- `SPLIT`
- `REVERSE_SPLIT`
- `MERGER` (same-currency, share-for-share mergers only)

Splits multiply every open lot quantity by the ratio and divide its unit cost
by the same ratio. Mergers do the same transformation and move the lot to the
explicit target instrument. The original acquisition date, source document,
source row, and total remaining cost are retained. Corporate actions never
create a realized allocation or gain by themselves.

Unsupported cases are rejected or reported as skipped rather than guessed:
mixed cash-and-stock mergers, cross-currency mergers, and actions without the
explicit quantities, ratios, allocation, or target required by their type.

## Complex corporate actions (v0.9)

- `SPIN_OFF` creates target-instrument lots while allocating source-lot cost only
  from an explicit source-provided ratio. Acquisition date and source lineage are retained.
- `RIGHTS_SUBSCRIPTION` creates new lots from explicit subscription quantity and
  confirmed subscription cost.
- `CASH_IN_LIEU` consumes fractional quantity through FIFO and reports proceeds,
  allocated cost, and realized P&L.

Every allocation identifies both the corporate-action source row and the
originating purchase event. Missing terms are surfaced as issues and do not
produce an estimated lot or gain. Mixed cash/stock and cross-currency mergers
remain unsupported until their source supplies an unambiguous allocation model.

## FX reporting (v0.7)

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
