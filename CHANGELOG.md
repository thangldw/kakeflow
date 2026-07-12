# Changelog

## 0.4.0 — 2026-07-13

- Add a 42-day financial calendar with accrual/cash views, no-spend days, card closing dates, payment due dates, and settlement events.
- Add monthly and yearly household reports with period comparisons, savings rate, budget/goal progress, spending drivers, reconciliation status, and data-quality context.
- Detect recurring payments and subscriptions, predict the next occurrence, and explain price changes from confirmed household history.
- Detect unusual expenses using robust household/payee baselines without sending financial data to an external model.
- Add reusable ordered account groups for family, personal, daily-spending, investment, business, tax, education, and custom scopes.
- Export confirmed transaction ledgers and portfolio snapshots as scoped, date-bounded UTF-8 BOM CSV files.
- Add strict native IPC validation, a new account-group migration, responsive report views, and desktop integration tests.

## 0.3.0 — 2026-07-13

- Parse and persist Japanese securities `assetbalance(all)_*.csv` snapshots separately from household transactions.
- Add investment asset allocation, positions, market value, cash, P&L, FX-rate, and snapshot-history views.
- Automatically discover and preview changed files in registered sync folders every 60 seconds.
- Add immutable source-record drill-down from transaction evidence.
- Add persisted, prioritized classification rules for merchant/description matching, categories, labels, and tags.
- Add safe rule preview/application with optimistic concurrency.
- Expand native schema migrations and platform validation for the new modules.

## 0.2.0 — 2026-07-12

- First runnable local-first desktop MVP for macOS and Windows.
- Added ledger dashboards, manual and file imports, budgets, goals, source provenance, backup/restore, and credit-card reconciliation.
