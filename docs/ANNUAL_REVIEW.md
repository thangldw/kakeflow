# Annual Household Review semantics

The Annual Household Review uses the same confirmed ledger facts as KakeFlow's monthly reports. It does not compare an incomplete current year with a full prior year.

Money Forward ME's official support material describes a one-year income/expense/balance trend and prior-month/prior-year category comparisons as useful report patterns. KakeFlow adopts those analytical patterns without copying the service's visual design: [Money Forward ME monthly-report guide](https://support.me.moneyforward.com/hc/ja/articles/900003467326--%E3%83%9E%E3%83%B3%E3%82%B9%E3%83%AA%E3%83%BC%E3%83%AC%E3%83%9D%E3%83%BC%E3%83%88-%E3%81%AE%E4%BD%BF%E3%81%84%E6%96%B9).

## Comparable window

- `year` selects the twelve displayed calendar months.
- `asOf` is the actual current date in Asia/Tokyo, independent of which month the user selected in the desktop period picker.
- For a past year, all twelve months are complete.
- For the current year, only months ending before the `asOf` month enter KPIs, drivers, budget actuals, reconciliation, and prior-year comparison.
- The current `asOf` month is `PARTIAL`; later months are `FUTURE`.
- January can truthfully have zero completed months and a null `throughMonth`.
- A future report year is rejected.

The report compares the completed current window only with the same number of months in the prior year. Compatibility fields named `current`, `priorYear`, and `vsPriorYear` are exact aliases of the explicit comparable-window fields.

## Monthly series

The response always contains twelve consecutive points:

- `COMPLETE`: confirmed metrics for the full month; included in annual comparison.
- `PARTIAL`: actual-to-`asOf` metrics for context; excluded from annual comparison.
- `FUTURE`: explicit zero metrics with a future status; never presented as observed activity.

Income, expense, savings, transaction count, and savings rate obey the same integer-JPY metric invariants as monthly reports. Split journal entries count as one transaction.

## Scope and export

The account-group scope uses canonical any-journal-entry membership and is combined with the household/common/member attribution scope. Household budget plans, goals, and import status are disclosed separately where they cannot be assigned safely to one member.

The annual CSV is generated from the same validated DTO as the screen. It is UTF-8 with BOM, bounded, deterministic, and includes explicit section, period, status, metric, current/prior/delta values, `asOf`, `throughMonth`, account group, attribution kind, and member identifier. Partial and future rows remain identifiable by status and never enter the summary comparison.
