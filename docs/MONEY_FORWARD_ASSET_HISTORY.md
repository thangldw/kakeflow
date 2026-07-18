# Money Forward aggregate asset history

KakeFlow imports the Money Forward ME asset-trend CSV documented in its [download guide](https://support.me.moneyforward.com/hc/ja/articles/49505374073497-%E5%AE%B6%E8%A8%88%E7%B0%BF%E3%83%87%E3%83%BC%E3%82%BF%E3%81%AF%E3%83%80%E3%82%A6%E3%83%B3%E3%83%AD%E3%83%BC%E3%83%89%E3%81%A7%E3%81%8D%E3%81%BE%E3%81%99%E3%81%8B).

## Contract

`日付` and `合計（円）` are required. Supported optional class columns are deposits/cash/crypto, stocks, funds, bonds, FX, insurance, real estate, pensions, points, and other assets. Optional columns may be omitted or reordered.

Dates must be real and every present value must be a non-negative safe-integer JPY amount. KakeFlow does not require the visible class sum to equal the provider total because the provider does not publish that invariant.

## Persistence

One row becomes one household-level aggregate snapshot linked to its immutable source and physical row. A file contains 1–1,200 points and commits atomically.

The household/date key is unique. Identical overlapping points reuse the existing record; conflicting values reject the complete batch. Completed-source re-import is idempotent.

## Accounting boundary

This is total-assets reference history, not net worth. It has no liabilities or account ownership and creates no transaction, journal, balance, income, expense, cash-flow, or portfolio-valuation change. The Investments workspace displays it as a separate assets-only series with source lineage and no interpolation.
