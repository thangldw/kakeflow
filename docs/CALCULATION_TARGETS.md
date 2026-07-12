# Transaction calculation targets

`calculationTarget` answers one question: should this posted transaction participate in household analytical totals?

Money Forward ME documents a similar user need: turning `計算対象` off removes an item from monthly income and expense totals while retaining the history itself. KakeFlow adopts that product concept with an explicit double-entry boundary: [Money Forward ME calculation-target guide](https://support.me.moneyforward.com/hc/ja/articles/900003501566-%E8%A8%88%E7%AE%97%E5%AF%BE%E8%B1%A1%E3%81%AE%E3%83%81%E3%82%A7%E3%83%83%E3%82%AF%E3%82%92%E5%A4%96%E3%81%99%E3%81%A8%E3%81%A9%E3%81%86%E3%81%AA%E3%82%8A%E3%81%BE%E3%81%99%E3%81%8B).

Existing and newly posted transactions default to included. The user can mark a posted transaction as excluded in its detail view and find it again with the `ALL / INCLUDED / EXCLUDED` ledger filter.

## Included in analytical totals

Only calculation-target transactions contribute to:

- dashboard income, expense, savings, transaction count, trends, and category composition;
- accrual and cash-flow report totals;
- financial-calendar activity and no-spend days;
- monthly and annual reports, category/merchant drivers, and annual CSV summary metrics;
- budget actuals and budget-overrun actions;
- recurring, subscription, anomaly, and fixed-cost detection;
- historical income, spending, and recurring assumptions used by forecasts.

Account group, household/common/member attribution, accounting basis, date range, and calculation target are independent filters and combine with logical AND.

## Never removed from accounting truth

Turning the target off does **not** delete, void, reverse, or rebalance a transaction. It remains part of:

- the transaction ledger and CSV export;
- ordered debit/credit journal entries;
- source-document and source-row evidence;
- actual account, cash, liability, and net-worth balances;
- credit-card statement totals, bank settlements, payment schedules, and reconciliation;
- account reference checks and audit history.

Consequently, an excluded cash purchase does not appear in the cash-flow report but still reduces the real cash-account balance. The UI discloses this distinction wherever the calculation target is edited.

## Card-linked transactions

Card-linked facts remain protected from ordinary transaction edits. KakeFlow permits a flag-only calculation-target change when every other submitted field and ordered journal entry exactly matches persisted data. The update changes only `calculation_target` and the transaction timestamp; card-statement, payment, source, and journal relations remain untouched. Any simultaneous content or journal edit is rejected and must go through the reconciliation workflow.

## Export and migration

Transaction CSV export includes both states and a `calculation_target` column with `true` or `false`. It never silently omits excluded source facts.

Schema migration 0022 backfills all existing transactions to `true` and enforces a strict `0/1` domain. Manual and imported transactions inherit the included default unless the user changes the posted transaction later.
