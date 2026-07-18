# Recurring series review

Recurring review stores an analytical preference for a detected normalized payee. It never edits transactions, journals, sources, categories, cadence, or amounts.

Identity is `(household ID, normalized payee)`. Preferences are household-wide; group/member scopes filter observations but do not create separate decisions.

| State | Meaning |
| --- | --- |
| `AUTO_DETECTED` | Derived stable pattern with no stored preference |
| `CONFIRMED` | Explicitly included; cadence/amount remain detector-derived |
| `IGNORED` | Excluded from recurring forecast/actions/fixed-cost consumers |

Only `CONFIRMED`/`IGNORED` plus integer version are stored. Restore deletes the explicit row and reveals `AUTO_DETECTED`. Ignored detected series remain visible with reasons and can be restored.

Optimistic writes require exact household, payee, state, and version. Stale or conflicting writes fail and reload. Ignoring changes recurring projections only; underlying transactions remain in totals, budgets, calendar, balances, and evidence.

Users cannot set cadence, expected date, amount, confidence, or annualization. Schema-v5 change packages and KFF4 family delivery can transport the complete explicit preference set through review and atomic Apply; local versions/timestamps are not portable.
