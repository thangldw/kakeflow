# Investment performance accounting

KakeFlow v0.7 derives investment holdings and realized performance from immutable brokerage events.

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
cash-in-lieu for fractional shares, mixed cash-and-stock mergers, cross-currency
mergers, spin-offs requiring a source-provided cost allocation, rights issues,
and actions without an explicit ratio or merger target. Cash components should
be imported as separate brokerage events until a dedicated allocation model is
available.

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
