# Home Action Center

KakeFlow surfaces the existing forecast/action read model on Home. It does not derive a second set of warnings from dashboard cards.

## Ordering and visibility

Home displays at most three actions. All actions are ordered identically on Home and in Reports → Forecast & Actions:

1. priority: critical, high, medium, low;
2. dated actions before undated actions within the same priority;
3. due date ascending;
4. stable action ID as the final tie-break.

The count badge and “view all” action use the complete result count, not the visible slice.

## Baseline and scope

The action query uses the final calendar day of the month selected in the global filter and prints that date beside the Home result. This keeps historical Home views aligned with the full monthly forecast instead of silently switching to today's date.

Account-group and member attribution filters are forwarded to the canonical query. Import review and other backend-defined household obligations can remain household-wide; Home discloses that mixed scope when a narrower filter is active.

## Resolution routes

Every action kind has an exhaustive workspace route:

| Action family | Workspace |
| --- | --- |
| Import review/failure | Import Inbox |
| Card mismatch, due payment, balance shortfall, missing settlement mapping | Cards |
| Budget overrun and savings-goal due | Budgets & Goals |
| Spending anomaly and recurring price change | Transactions |

These are workspace routes, not claims that a particular entity row has been opened. “View all” opens Reports directly on Forecast & Actions; ordinary Reports navigation still opens Calendar.

## Failure boundary

The Home action request is independent from dashboard totals, transactions, cards, and import-quality requests. A failed action request therefore cannot blank financial metrics. First-load failure shows an explicit retry. A failed refresh retains and labels the last valid snapshot for the same household, account group, attribution scope, and baseline date. Changing any of those scopes hides the old snapshot until the new query succeeds.

Browser preview never presents sample actions as live desktop data.
