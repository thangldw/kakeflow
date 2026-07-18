# JCB MyJCB statement import

The `jcb-myjcb-statement-v1` adapter supports a deliberately narrow JCB billing CSV. JCB confirms monthly CSV downloads and notes that deferred-payment exports can contain both usage and current billed values, but it does not define one universal column layout: [CSV notes](https://www.jcb.co.jp/processing/share/csv.html) and [MyJCB download FAQ](https://j-faq.jcb.co.jp/faq/show/357?site_domain=default).

## Detection

Within the first 12 physical rows, the source must provide a JCB/MyJCB provider marker and a header containing:

- `ご利用日` or `利用日`;
- `ご利用先など` or `ご利用先など(漢字)`; and
- one recognized explicit JPY billed/usage amount column.

Width is normalized and columns may be reordered. Unknown layouts, missing fields, or guessed positions are rejected.

## Semantics

- When usage and billed values both exist, the billed value is canonical and usage remains raw evidence.
- Negative billed values are refunds; positive cancellation/refund wording is ambiguous and blocking.
- Payment method, installment count, currency, foreign amount, and exchange-rate fields remain source context when valid.
- Metadata and total rows never become purchases.
- An explicit total must equal the detail sum.
- Every detail preserves its physical CSV row.

The adapter does not infer installment schedules, revolving balances, absent fees, statement due dates, or destination accounts.

## Workflow

Select an active credit-card liability account, stage the source, review each candidate, and post only explicit approvals. The later bank debit is a liability settlement, not another expense.
