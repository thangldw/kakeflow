# Changelog

## 0.9.0 — 2026-07-13

- Import Monex U.S. stock transaction-history CSV columns and preserve the source row, currency, ticker, and transaction semantics.
- Allocate spin-off cost basis from an explicit source-provided ratio, create rights-subscription lots from confirmed terms, and treat cash in lieu as an auditable FIFO disposal with realized P&L.
- Explain corporate-action allocations in the annual investment report down to the action and originating purchase source rows; incomplete terms are rejected instead of guessed.
- Unlock supported password-protected PDFs for the current extraction or page-render request, with explicit required, invalid, and unsupported-password states and no persisted password.
- Mount the produced macOS DMG read-only and validate its versioned app bundle, executable, resources, signature structure, and clean detach separately from the packaged-WebView smoke test.
- Harden packaged-app smoke cleanup so a timed-out child is terminated and reaped before temporary data is removed, and suppress macOS crash-history restoration prompts inside the isolated smoke process.

## 0.8.0 — 2026-07-13

- Add immutable dated investment market-price observations with provider, document, row, and observation provenance.
- Reuse prices from `assetbalance(all)_*.csv` snapshots and value FIFO holdings at the latest confirmed price on or before the selected date without using future or wrong-currency quotes.
- Add market value, unrealized P&L, missing-price disclosure, annual realized P&L, dividend, fee, tax, and source-row reports by currency.
- Render authenticated PDF source pages locally and place `PDF_POINTS` extraction regions over the actual page image.
- Normalize full-width Japanese receipt text, `令和`/`平成` dates, and additional electronic-money payment methods.
- Exercise onboarding and the resulting Home screen inside the real packaged WebView, verify the UI-created household in SQLCipher, and upload machine-readable interaction evidence from macOS and Windows CI.

## 0.7.0 — 2026-07-13

- Replace folder-only polling with recursive native filesystem notifications, burst debouncing, duplicate suppression, and a bounded polling fallback.
- Add split, reverse-split, and same-currency share-for-share merger events that preserve FIFO lot cost, acquisition date, and source provenance without creating artificial gains.
- Add immutable dated FX observations and JPY investment reporting with direct/inverse-rate provenance; missing rates fail visibly instead of producing partial or invented totals.
- Reuse provenance-bearing FX rates imported with securities portfolio snapshots.
- Display authenticated receipt images locally with interactive OCR bounding-box overlays, zoom, selection, and source-row drill-down.
- Expand Japanese receipt extraction for quantities, unit prices, subtotals, change, payment methods, and included/excluded tax modes.

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
