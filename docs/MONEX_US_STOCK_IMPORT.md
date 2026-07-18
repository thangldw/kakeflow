# Monex U.S. stock trade-history import

This fail-closed adapter handles the current Monex Securities U.S.-stock Trade History field family as investment-ledger evidence. It never creates household income or expense entries.

Monex documents the downloadable history and its displayed fields but not a literal CSV schema: [Trade History help](https://info.monex.co.jp/help/us-stock/deal-archive.html). The repository fixture is synthetic and does not claim provider-issued byte compatibility.

## Supported subset

Detection requires the complete normalized 16-field family, including USD/JPY execution and settlement values, tax-basis settlement, USD fee, currency, and FX rate. Accepted rows must have:

- valid trade/settlement dates in the post-2026-02-16 history generation;
- `現物` transaction type and explicit `買` or `売` side;
- `一般`, `特定`, or `NISA` account type;
- explicit USD settlement;
- unambiguous ticker and non-empty security name; and
- finite quantity, price, gross, settlement, and fee values.

Exported gross, settlement, and fee values remain independent facts. A difference is preserved as a visible, balanced adjustment; KakeFlow does not replace source values with `quantity × price`.

## Blocking boundary

Yen settlement, margin/credit, FX, cash/position transfers, dividends, sparse or malformed data, ambiguous securities, unsupported currencies, and older export generations block the affected source. Other Monex order/history export families are not covered.

The user selects an active `ASSET / SECURITIES` account and explicitly saves valid brokerage events. Source rows remain immutable, re-import is idempotent, and household metrics are unchanged.
