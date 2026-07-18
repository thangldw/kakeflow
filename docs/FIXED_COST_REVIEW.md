# Fixed-cost review

Fixed-cost review analyzes confirmed ledger observations. It is not a provider comparison or savings promise.

## Window and cadence

The month containing `asOf` is excluded. The report returns the previous six complete months, including zero months, and compares integer averages for the recent three versus earlier three. A zero earlier average produces no percentage rate.

Cadence detection may inspect 36 months and supports weekly (52), biweekly (26), monthly (12), quarterly (4), and annual (1) annualization factors. Annualized values are estimates from observed typical amount and cadence—not forecasts.

## Eligible activity

Only posted `EXPENSE` and `CARD_PURCHASE` transactions with expense debits participate. Transfers, settlements, refunds, voids, pending imports, and irregular payees are excluded. Split entries group by transaction.

Classification checks expense-category evidence before payee text and recognizes housing, insurance, utilities, internet, mobile, subscriptions, and other recurring costs. Variable utilities may remain eligible with lower confidence; generic recurring payees require stable amounts.

Coverage reports transaction/payee counts, unclassified items, and history bounds. KakeFlow does not use external tariffs or market prices and therefore does not display potential savings.
