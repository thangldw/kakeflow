# Fixed-cost review semantics

KakeFlow's fixed-cost review is an observed-ledger analysis, not a quote comparison or a promise of potential savings.

## Reporting window

- `asOf` selects the analysis date.
- The month containing `asOf` is treated as incomplete and excluded.
- The report always returns the six immediately preceding complete calendar months, including explicit zero months.
- `recentThreeAverageJpy` is the integer average of the latest three points; `previousThreeAverageJpy` is the integer average of the first three.
- A zero previous average produces no percentage rate because the relative change is undefined.

## Recurring detection

Cadence detection may inspect at most 36 months of confirmed history so annual costs can remain visible even when no payment falls in the six-month reporting window. A stale series is excluded.

Supported cadence and annualization factors:

| Cadence | Factor |
| --- | ---: |
| Weekly | 52 |
| Biweekly | 26 |
| Monthly | 12 |
| Quarterly | 4 |
| Annual | 1 |

Annualized values are estimates based on the payee's observed typical amount and cadence. They are not cash-flow forecasts.

Generic `OTHER_RECURRING` payees require stable amounts. A recognized fixed-cost segment such as electricity, gas, or water may have variable amounts when its cadence is stable; the result then carries lower confidence and states that amount stability was not claimed.

## Included ledger activity

Only posted `EXPENSE` and `CARD_PURCHASE` transactions with an expense debit are eligible. Transfers, card settlements, refunds, void transactions, pending imports, unknown/irregular payees, and source records that were never posted are excluded.

Split journal entries are grouped by transaction so one purchase is not counted twice. The optional account-group scope follows the canonical any-journal-entry membership rule. The global attribution scope can select all household activity, household-common activity, or one valid current/historical household member.

## Classification

The classifier checks expense-category evidence before payee text. Recognized segments are housing, insurance, electricity, gas, water, internet, mobile, subscriptions, and other recurring costs. Japanese terms can match within natural text; short English terms use token boundaries so unrelated words such as `Parent` or `Vegas` are not classified as rent or gas.

## Coverage and limitations

Coverage counts disclose confirmed transactions in the six-month window, recurring transactions selected by the detector, recurring payees, unclassified recurring payees, and the exact history boundary. Category names are transported losslessly even when they contain commas.

KakeFlow does not compare providers, tariffs, insurance products, or external market prices in this report. Consequently it does not calculate or display a potential-savings amount. Such a figure would require dated, attributable market data and a separate comparison contract.
