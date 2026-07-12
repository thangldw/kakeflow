# KakeFlow metric contract

KakeFlow dashboards read confirmed, household-owned records. Raw documents and
unposted candidates never contribute to financial totals.

## Accounting bases

| Metric | Definition | Exclusions |
| --- | --- | --- |
| Accrual expense | Debit entries to `EXPENSE` accounts on posted `EXPENSE`, `CARD_PURCHASE`, `FEE`, or `INTEREST` transactions | Card settlements, transfers, voided/draft transactions |
| Accrual income | Credit entries to `INCOME` accounts on posted transactions | Transfers and balance adjustments without an income entry |
| Cash inflow/outflow | Posted movement into/out of selected asset accounts on the transaction date | Movements outside the selected account scope |
| Savings | Accrual income minus accrual expense for the selected period | Asset transfers and investment snapshot valuation changes |
| Net worth | Asset account balances plus portfolio market value, less liability balances, as of the selected date | Income/expense totals counted a second time |

Credit-card purchases recognize expense when purchased. The later bank debit is
cash outflow and liability settlement, not a second expense.

## Calendar

- A daily amount is the sum of posted ledger activity on that calendar date in
  the selected accounting basis and account scope.
- A no-spend day has zero confirmed accrual expense. It is not shown as a
  trustworthy no-spend day when source coverage is incomplete.
- Card due events come from persisted statements. A due event is resolved only
  by a matched payment, not merely by a same-amount bank transaction.
- Import freshness is the latest successfully persisted source document per
  account/provider; missing or stale inputs remain visible as a coverage caveat.

## Monthly report

- Period comparisons use complete calendar months in `Asia/Tokyo`.
- Month-over-month compares the selected month with the immediately preceding
  month. Year-over-year compares the same calendar month one year earlier.
- Category and merchant drivers are ranked by absolute change in posted accrual
  expense, with both current and comparison values retained.
- Savings rate is `savings / income`; it is undefined when income is zero.
- Budget variance is actual accrual expense minus the persisted monthly budget.

## Recurring and anomaly analytics

- Recurring candidates require repeated posted expense-like transactions with a
  normalized payee, a stable cadence, and an explainable amount tolerance.
- Transfers, card payments, refunds, draft/voided rows, and one-off sparse data
  are excluded from recurring detection.
- Expected next date and amount are estimates from the household's own history,
  not payment instructions or financial advice.
- Anomalies compare a transaction with the household's prior merchant/category
  history. Every result includes the baseline, observed value, score, and reason.
- No peer-household benchmark or opaque global model is used in v0.4.

## Account groups

Account groups are saved scopes, not new ledger accounts. A transaction is in a
group when one of its journal accounts belongs to that group. Group-filtered
cards, charts, reports, and exports must all use the same membership rule and
must not change the underlying journal entries.

KakeFlow validates the group against the active household before running a
scoped query. Missing or foreign-household groups fail rather than widening to
all accounts. A transaction that touches several member accounts is still
included once. Import failures and savings-goal actions remain household-wide
because their records do not identify an account; the UI keeps them visible
instead of implying that an account filter can classify them.

## Family organization

Household members and account ownership are stable local organization metadata.
`PERSONAL` does not hide an account, authenticate a person, or restrict another
user of the same device. Account ownership is independent from sharing: a
member-owned account may still be `SHARED`; a `PERSONAL` account must have one
active owner in the same household.

KakeFlow does not derive transaction or source-document visibility from account
ownership. Transfers and split funding may touch accounts owned by different
members, so doing so could expose or omit the wrong counterpart. A later member
reporting/access-control layer must use explicit transaction and document
audiences.

Transactions now store attribution and audience independently. Source documents
store their own audience, which may intentionally differ from every linked
transaction. Current household metrics continue to use all posted transactions;
v0.12 does not silently apply member filters to only part of the dashboard.

## Export

Exports contain posted records only, use UTF-8 with BOM for Japanese Excel
compatibility, preserve integer JPY amounts, identify the accounting basis and
scope, and remain bounded by the requested date range and row limit.
