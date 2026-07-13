# Dashboard preferences

KakeFlow 0.25 lets each household choose how the existing confirmed-ledger metrics are presented on Home. Preferences affect presentation only; they never change journal entries, accounting basis, transaction inclusion, budgets, balances, or reconciliation.

## Focus presets

| Preset | Emphasis |
| --- | --- |
| Financial Overview | Net worth, monthly income, expense, savings, trend, categories, recent activity, and card status |
| Household Ledger | Monthly income, expense, savings, category composition, and recent confirmed transactions |
| Assets & Liabilities | Existing asset, liability, net-worth, and savings facts plus direct access to Investments |
| Card Reconciliation | Existing liabilities, expense, assets, net worth, and confirmed card-settlement status plus direct access to Cards |
| Cash Flow | Actual asset-account inflow, outflow, net movement, month-end assets, recent cash movements, and card-settlement status |

The first four presets use accrual Home facts. The Cash Flow preset explicitly requests cash basis and uses its own six-month `cashFlowTrend`. The existing income/expense trend and category composition remain accrual-only and are hidden from Cash Flow; KakeFlow never relabels them as cash movement.

For credit cards, the purchase is recognized as an expense on its purchase date. It is excluded from cash outflow because no asset account moved. The later bank debit reduces an asset account and appears once as cash outflow, including when the purchase and settlement occur in different months.

## Appearance

- `System` follows the operating-system color-scheme preference and reacts when it changes.
- `Light` and `Dark` explicitly select an app-wide semantic color palette.
- `Comfortable` preserves the standard spacing and panel height.
- `Compact` reduces spacing and row height without shrinking the entire interface or changing its content.

The resolved values are applied to the document root as theme and density attributes so every page shares one consistent appearance.

## Persistence

Preferences are stored in SQLite under the active household and contain only the template, theme, density, and update timestamp. A household without a stored record receives deterministic defaults (`FINANCIAL_OVERVIEW`, `SYSTEM`, `COMFORTABLE`) without creating a database row.

Loads and saves are household-scoped. If the user switches household while a request is in flight, a stale response cannot overwrite the new household's preferences. Database restore validation rejects unknown enum values, malformed timestamps, and invalid household relations.
