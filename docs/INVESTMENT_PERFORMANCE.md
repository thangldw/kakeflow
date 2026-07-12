# Investment performance accounting

KakeFlow v0.6 derives investment holdings and realized performance from immutable brokerage events.

## Cost basis

The cost-basis method is **FIFO (first in, first out)**. A sale consumes the oldest open purchase lot in the same household account, instrument identity, and currency. Instrument code is the primary identity; normalized instrument name is used only when a code is absent.

- Purchase cost basis = gross purchase amount + purchase fee + purchase tax.
- Net sale proceeds = gross sale amount - sale fee - sale tax.
- Realized P&L = allocated net sale proceeds - allocated FIFO cost basis.
- Partial sales retain the unconsumed quantity and cost in the original lot.
- A sale without enough prior quantity is reported as an uncovered sale. KakeFlow does not invent a zero cost basis.
- A buy or sell without a usable positive quantity is reported through `skippedEventIds`.

Each lot and realized allocation includes its buy/sell event ID, source document ID, and source row, so the calculation can be audited back to imported evidence.

## Currency policy

All holdings, costs, proceeds, dividends, fees, taxes, and realized P&L stay in their source currency. JPY is one native-currency bucket alongside USD and other ISO currency codes. KakeFlow does not aggregate unlike currencies and does not infer an FX rate. Cross-currency reporting requires an explicit dated FX source in a future valuation layer.

## Period behavior

A period query loads acquisitions before the requested start date because those lots may establish the cost basis of a sale inside the period. Transaction totals and realized allocations are then filtered to the requested date range. Current market return and unrealized return are intentionally excluded from this event-only view because they require trustworthy dated market valuations.
