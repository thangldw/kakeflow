# Home Action Center

Home displays the canonical Forecast & Actions read model and never derives a second warning system from dashboard cards.

At most three actions are shown, ordered by priority, dated before undated, due date, then stable ID. Badge and “View all” use the complete count.

The query uses the final day of the globally selected month. Account-group and attribution filters are forwarded, while backend-defined household obligations remain household-wide with disclosure.

| Action family | Destination |
| --- | --- |
| Import review/failure | Import Inbox |
| Card mismatch, due payment, shortfall, missing mapping | Cards |
| Budget overrun, savings-goal due | Budgets & Goals |
| Spending anomaly, recurring price change | Transactions |

These routes open workspaces, not guaranteed entity rows. “View all” opens Reports → Forecast & Actions.

Action loading is independent from financial metrics. Initial failure shows retry; refresh failure may retain only a labeled last-valid snapshot for the exact same household, group, attribution, and baseline date. Browser preview never presents sample actions as live data.
