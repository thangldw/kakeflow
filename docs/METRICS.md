# KakeFlow metric contract

Metrics use posted, household-owned ledger facts. Raw sources and pending candidates never contribute.

| Metric | Definition |
| --- | --- |
| Accrual expense | Expense-account debits on posted expense-like transactions |
| Accrual income | Income-account credits on posted transactions |
| Cash flow | Posted movement into/out of selected asset accounts |
| Savings | Accrual income minus accrual expense |
| Net worth | Asset balances plus portfolio market value minus liabilities |

Card purchase recognizes expense; later bank settlement changes cash/liability without duplicating expense.

Calendar daily values follow selected basis/scope. No-spend status requires complete coverage. Card due events resolve only through confirmed links. Import freshness comes from persisted sources and retains missing/stale caveats.

Monthly comparisons use complete Asia/Tokyo months. Drivers rank absolute change while retaining both values. Savings rate is undefined at zero income. Budget variance is actual accrual expense minus plan.

Recurring/anomaly results use posted history, explainable cadence/tolerance/baselines, and no peer or opaque global model. Transfers, settlements, refunds, drafts, and sparse one-offs are excluded.

Account groups use any-journal-entry membership and never widen on invalid scope. Attribution (`ALL`, `HOUSEHOLD_COMMON`, or `MEMBER`) combines with group scope for transaction facts. Ownership, audience, and attribution remain separate; household-wide balance facts are labeled rather than falsely allocated.

Exports contain posted records, integer JPY, basis/group/attribution metadata, bounded date/row scope, and UTF-8 BOM where applicable.
