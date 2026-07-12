# Changelog

## 0.6.0 — 2026-07-13

- Add a process-wide background folder discovery supervisor that detects created, modified, and removed supported files even when Import Inbox is closed.
- Emit debounced, household-scoped change events without exposing absolute paths or automatically posting financial data.
- Add FIFO investment cost basis, open lots, holdings, realized allocations, uncovered-sale warnings, and auditable source event/row lineage.
- Report realized P&L, dividends, fees, and taxes per currency without inventing FX conversion or combining currencies.
- Integrate background discovery status and investment performance into the desktop workspace.
- Add a packaged-app smoke harness that launches the real macOS/Windows bundle in isolated app data, validates the main window, WebView IPC, SQLCipher integrity, and migrations, then exits and cleans up.

## 0.5.0 — 2026-07-13

- Add a deterministic three-month household cash and savings forecast with visible assumptions, recurring costs, and known card payments.
- Add an Action Center for import failures/review, card mismatches and due payments, budget overruns, goal deadlines, anomalies, and recurring price changes.
- Add Japanese brokerage transaction ingestion and persistence for buys, sells, dividends, fees, taxes, deposits, and withdrawals without inflating household expenses.
- Add brokerage currency totals, cash movement, source-row idempotence, balanced investment legs, and transaction history in the investment workspace.
- Add page-aware PDF evidence and OCR word bounding boxes with confidence and provenance.
- Upgrade receipt evidence with item rows, Japanese 8%/10% taxes, coupons, points, and source line/region references.
- Add responsive forecast, action, and evidence viewers with desktop integration tests.
- Make Windows release builds select the compatible Strawberry Perl toolchain for vendored OpenSSL.

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
