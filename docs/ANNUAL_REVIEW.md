# Annual Household Review

The annual review reuses confirmed monthly ledger facts and never compares an incomplete current year with a complete prior year.

## Comparable window

- `year` selects 12 calendar months.
- `asOf` is the current Asia/Tokyo date, independent of the UI month picker.
- Past years contain 12 `COMPLETE` months.
- In the current year, months before `asOf` are `COMPLETE`, the current month is `PARTIAL`, and later months are `FUTURE`.
- Only complete months enter annual KPIs, drivers, budgets, reconciliation, and prior-year comparison.
- Prior-year comparison uses the same number of completed months.
- Future years are rejected.

The response always contains 12 points. Partial values provide context; future points are explicit zero-status placeholders and are never presented as observations. Split journal entries count as one transaction.

Account-group scope uses canonical any-journal-entry membership and combines with household/member attribution. Household-wide goals and data quality remain explicitly disclosed.

CSV, XLSX, PDF, and screen views use the same validated report DTO and scope. Export rows retain status, period, `asOf`, through-month, account group, attribution, values, deltas, and rates without converting partial/future states into completed activity.
