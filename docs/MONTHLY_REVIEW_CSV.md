# Monthly Household Review CSV

The native exporter reruns the same validated monthly report request used by the screen, including calendar month, account group, household/member attribution, and resolved data-quality `asOf` date.

The financial period is always the complete selected month. `asOf` qualifies freshness and completeness only; it never truncates income, expense, drivers, budgets, or reconciliation. Goals and data quality remain household-wide and are labeled accordingly.

```text
section,period,comparison,metric,label,current_value,previous_value,
delta_value,rate_bps,household_id,account_group_id,attribution_scope,
attribution_member_id,as_of
```

Summary includes prior-month and prior-year comparisons. Category/merchant drivers are prior-month only. Other sections contain only facts present in the validated DTO.

Output uses UTF-8 BOM, RFC-style quoting, CRLF, at most 128 data rows, and 1 MiB. Scope mismatches and oversized values fail closed. The native save dialog writes only after selection; cancellation writes nothing.
