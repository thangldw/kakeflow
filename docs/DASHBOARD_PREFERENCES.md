# Dashboard preferences

KakeFlow lets each household choose how the existing confirmed-ledger metrics are presented on Home. Preferences affect presentation only; they never change journal entries, accounting basis, transaction inclusion, budgets, balances, or reconciliation.

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

## Widget layout

The compact layout editor lets users drag eligible widgets, use the equivalent named up/down buttons from a keyboard, hide or restore a widget, and reset the active template. The rendered DOM follows the visual order so focus and screen-reader reading order stay coherent. A polite announcement reports completed moves.

Version 0.48 stores a separate layout for each of the five templates. Switching templates restores the target template's order and visibility; it does not copy, reset, or overwrite another template. Reset affects only the template currently shown.

Every saved order is exhaustive and contains each known widget exactly once. Templates filter that order to their eligible widgets; Cash Flow never exposes the accrual-only category panel. Hidden IDs remain available in the editor, and KakeFlow refuses to hide the last visible eligible widget. The renderer also falls back to the first eligible widget if migrated or template-filtered data would otherwise produce an empty Home.

Layout changes do not alter KPI cards, Data Quality, chart facts, accounting basis, or transaction inclusion. They only control the four main Home panels: trend, category spending, recent transactions, and card settlement.

## Persistence

Preferences are stored in SQLite under the active household and contain the active template, theme, density, five exhaustive template layouts, and update timestamp. A household without a stored record receives deterministic defaults (`FINANCIAL_OVERVIEW`, `SYSTEM`, `COMFORTABLE`, per-template canonical orders, no hidden widgets) without creating a database row. Migration preserves the legacy active layout and initializes the other templates independently.

Loads and saves are household-scoped. If the user switches household while a request is in flight, a stale response cannot overwrite the new household's preferences. Database restore validation rejects unknown enum values, duplicate/unknown/missing widget IDs, hiding all widgets, malformed timestamps, and invalid household relations.

Widget order and visibility remain device-local in v0.48. Existing local change-package schemas continue to carry template, theme, and density only, preserving their canonical hashes and never erasing a destination device's custom layouts. A future package-schema version can add explicit layout transport without changing legacy lineage.
