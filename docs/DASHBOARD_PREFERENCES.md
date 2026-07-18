# Dashboard preferences

Preferences change Home presentation only. They never alter journals, inclusion, basis semantics, budgets, balances, or reconciliation.

| Preset | Focus |
| --- | --- |
| Financial Overview | Net worth, income, expense, savings, trends, categories, recent activity, cards |
| Household Ledger | Income/expense/savings and recent ledger activity |
| Assets & Liabilities | Balance facts with Investments access |
| Card Reconciliation | Liabilities and settlement status |
| Cash Flow | Asset inflow/outflow, movement, ending assets, settlements |

The first four use accrual facts. Cash Flow uses its separate cash basis/trend; purchases do not move cash until later settlement.

Theme supports System/Light/Dark and density supports Comfortable/Compact. Root attributes apply the resolved setting consistently.

Each preset stores an independent exhaustive widget order and hidden set. Drag/drop and keyboard move actions keep DOM/read order aligned. At least one eligible widget remains visible; reset affects only the current preset; Cash Flow never exposes accrual-only panels.

SQLite storage is household-scoped with deterministic defaults and concurrency protection. Change-package schema v4 transports all layouts atomically. Older schemas preserve destination layouts they cannot represent. Window size and OS appearance are not portable.
