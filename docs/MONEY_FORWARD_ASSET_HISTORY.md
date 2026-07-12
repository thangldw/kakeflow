# Money Forward aggregate asset history

Money Forward ME officially documents an asset-trend CSV containing `日付`, `合計（円）`, and optional asset-class columns. Columns for classes the user does not hold may be omitted: [Money Forward ME download guide](https://support.me.moneyforward.com/hc/ja/articles/49505374073497-%E5%AE%B6%E8%A8%88%E7%B0%BF%E3%83%87%E3%83%BC%E3%82%BF%E3%81%AF%E3%83%80%E3%82%A6%E3%83%B3%E3%83%AD%E3%83%BC%E3%83%89%E3%81%A7%E3%81%8D%E3%81%BE%E3%81%99%E3%81%8B).

KakeFlow recognizes the following exact normalized columns:

- `預金・現金・暗号資産（円）`
- `株式(現物)（円）`
- `投資信託（円）`
- `債券（円）`
- `FX（円）`
- `保険（円）`
- `不動産（円）`
- `年金（円）`
- `ポイント（円）`
- `その他の資産（円）`

`日付` and `合計（円）` are required. Asset-class columns can be omitted or reordered. Every present amount must be a nonnegative safe integer in JPY, and dates must use a recognized real calendar date. KakeFlow does not assume that the documented total must equal the visible category sum because the provider does not publish that invariant.

## Persistence and provenance

One valid CSV row becomes one household-level aggregate asset snapshot linked to its immutable source document and source row. The entire file imports in one database transaction, bounded to 1–1,200 snapshots. Validation and source-record ownership resolution happen before writes.

The household/date pair is unique. An overlapping export with the same date, total, and components reuses the existing point and retains its first-source provenance. A differing value for the same date rejects and rolls back the whole batch. Re-importing a completed source file is idempotent.

## Accounting boundary

This series is **total assets history**, not net worth:

- it contains no liabilities;
- it is not attached to an account;
- it creates no transaction or journal entry;
- it does not change income, expense, cash flow, account balances, portfolio valuation, or KakeFlow net worth;
- it must never be added to account or portfolio balances.

The Investments screen therefore presents it as a separate reference chart with a visible assets-only disclosure, latest change, source-row lineage, date filters, and the latest available asset-class composition.
