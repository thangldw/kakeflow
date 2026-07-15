# Monthly Household Review CSV

KakeFlow can save the validated Monthly Household Review as deterministic
UTF-8 CSV. The export reruns the same `MonthlyFinancialReportRequest` used by
the visible monthly screen, including the selected calendar month, saved
account group, household/member attribution scope, and resolved data-quality
reference date.

## Period and scope

The selected month is always a complete calendar-month reporting window.
`asOf` qualifies import freshness and completeness; it never truncates income,
expense, savings, drivers, budget actuals, or card reconciliation.

Every row repeats the authoritative scope:

- household ID;
- account-group ID, or an empty value for all accounts;
- attribution kind and member ID when applicable; and
- the resolved ISO `asOf` date returned by the native report query.

Goals and data quality remain household-wide because that is their established
Monthly Review semantic. The CSV does not relabel those facts as member-only.

## Rows

The fixed columns are:

```text
section,period,comparison,metric,label,current_value,previous_value,
delta_value,rate_bps,household_id,account_group_id,attribution_scope,
attribution_member_id,as_of
```

`SUMMARY` contains separate `PRIOR_MONTH` and `PRIOR_YEAR` comparisons for
income, expense, savings, savings rate, and confirmed transaction count.
Category and merchant driver rows are explicitly `PRIOR_MONTH`, matching the
existing bounded driver read model; the export does not manufacture a second
year-over-year driver set. Budget, goals, data quality, and card reconciliation
use only facts already present in the validated monthly DTO.

## Determinism and save boundary

The native generator writes a UTF-8 BOM, RFC-4180 quoting, and CRLF line
endings. It is capped at 128 data rows and 1 MiB, rejects a request/report
period or `asOf` mismatch, and never silently truncates an oversized value.
The filename includes both the selected month and resolved data-quality date:

```text
kakeflow-monthly-household-review-YYYY-MM-as-of-YYYY-MM-DD.csv
```

The native save dialog writes the bytes only after the user selects a
destination. Cancellation writes nothing and returns a normal cancelled
result. CSV, XLSX, and PDF use the same request; changing the on-screen
comparison toggle does not change export scope or semantics.
