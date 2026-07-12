# KakeFlow

KakeFlow is a local-first household finance workspace for macOS and Windows. It turns bank, card, wallet, PDF, spreadsheet, receipt, and securities-asset sources into a reconciled household ledger and a separate investment portfolio.

Version 0.7 adds native sync-folder notifications, auditable corporate actions, provenance-bearing FX reporting, and interactive receipt-image evidence overlays. It keeps the v0.6 FIFO performance engine and packaged-app launch validation against a real WebView, IPC boundary, SQLCipher database, and migrations.

## Product tour

The household overview combines net worth, monthly income and spending, trends,
category composition, recent transactions, and card-settlement status.

![KakeFlow household overview](docs/assets/screenshots/kakeflow-overview.png)

| Searchable transaction ledger | Import and review inbox |
| --- | --- |
| ![KakeFlow transaction ledger](docs/assets/screenshots/kakeflow-transactions.png) | ![KakeFlow import inbox](docs/assets/screenshots/kakeflow-import-inbox.png) |

## How KakeFlow works

![KakeFlow local-first data pipeline](docs/assets/infographics/data-pipeline.svg)

KakeFlow deliberately separates expense recognition from cash settlement. A
credit-card purchase creates an expense and a card liability; the later bank
debit settles that liability without counting the expense twice.

![KakeFlow credit-card reconciliation](docs/assets/infographics/card-reconciliation.svg)

## Run locally

Use Node.js 20 LTS or 22 LTS.

```bash
npm install
npm run dev
```

Production checks:

```bash
npm run lint
npm run build
npm test
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

Desktop development also requires Rust 1.97. The desktop app creates a random database master key on first launch and stores it in macOS Keychain or Windows Credential Manager:

```bash
npm run desktop:dev
```

Build an unsigned local macOS/Windows artifact:

```bash
npm run desktop:build
```

Run the same non-destructive release-readiness smoke sequence as CI (version check,
frontend tests/lint/build, Rust format/Clippy/tests, and an unsigned
`tauri build --no-bundle`):

```bash
npm run desktop:smoke
```

The smoke command compiles and verifies the native executable but never launches
the app, opens a user database, creates an installer, or accesses signing keys.
GitHub Actions runs it independently on macOS and Windows. Signing, Apple
notarization, and production update credentials remain external release steps.

## Product principles

- Source files are immutable evidence, not transactions by themselves.
- Source rows, business events, and ledger entries are separate concepts.
- Card purchases count as expenses; the later bank debit is a liability payment and must not double-count spending.
- Dashboard metrics read confirmed ledger data, not raw extraction candidates.
- Every displayed number should remain traceable to its original source.

## Intended architecture

```text
Local/synced folder
  -> source document store
  -> adapter detection and extraction
  -> normalized candidates
  -> deduplication and reconciliation
  -> user review
  -> double-entry ledger
  -> analytics views
  -> desktop dashboard
```

The React application is the presentation and import-preview layer. Tauri/Rust owns the encrypted database, migrations, OS paths, and IPC boundary:

```text
src/               React UI, import adapters, review workflow, typed IPC client
src-tauri/         Tauri shell, SQLCipher ledger, encrypted vault, PDF/OCR, backup/restore
```

KakeFlow never stores the database key in its database, logs, application bundle, or process environment. A portable v2 backup encrypts the ledger, source-document vault, and a cross-device key capsule with a user passphrase. Backup destinations are selected by the native backend; restore is authenticated, staged, semantically validated, confirmed in a native OS dialog, and activated through a restart-safe journal.

Receipt OCR is offline. Development builds use `tesseract` from `PATH` and require the `jpn` and `eng` language models. Release bundles may instead provide `ocr/tesseract` (or `tesseract.exe`) and `ocr/tessdata` in the Tauri resource directory; if neither source is complete, the app reports OCR as unavailable and does not upload the image anywhere.

## Data and release safety

- SQLCipher encrypts the canonical ledger; XChaCha20-Poly1305 encrypts immutable source documents.
- macOS Keychain or Windows Credential Manager stores the active master key.
- Backup archives and restore work have aggregate byte, entry, and record budgets.
- Imported candidates remain reviewable and rollbackable until they are posted atomically as balanced journal entries.
- The checked-in desktop workflow produces **unsigned/ad-hoc** macOS and Windows artifacts. Public distribution still requires Apple Developer ID signing/notarization and a Windows code-signing certificate.

## Current v0.7 capabilities

- Recursive native filesystem notifications with debouncing, duplicate suppression, and bounded polling fallback.
- Split, reverse-split, and same-currency share-for-share merger events that preserve FIFO lot provenance and total cost.
- JPY investment reporting from dated direct/inverse FX observations, including the exact selected rate and source provenance.
- Authenticated local receipt-image preview with interactive OCR regions, zoom, confidence, and source-row drill-down.
- Background folder discovery outside Import Inbox with debounced created/modified/removed events.
- FIFO holdings, open lots, realized P&L, dividends, fees, and taxes with source-event lineage per currency.
- Packaged application launch smoke using isolated temporary data, real WebView IPC, and migration checks.
- Three-month cash/savings forecast with explicit historical assumptions, recurring costs, and known card payments.
- Prioritized Action Center for imports, card reconciliation, budgets, goals, anomalies, and subscription price changes.
- Brokerage buys, sells, dividends, fees, taxes, deposits, and withdrawals with balanced investment legs and currency summaries.
- Page-aware PDF/OCR evidence plus receipt item, tax, coupon, point, confidence, and provenance views.
- Financial calendar with accrual/cash views, no-spend days, card schedules, and drill-down.
- Monthly/yearly reports with MoM/YoY comparisons, budget/goal progress, spending drivers, reconciliation, and data-quality status.
- Explainable recurring/subscription and unusual-spending detection derived locally from confirmed ledger history.
- Reusable household/personal/investment/custom account groups and scoped transaction or portfolio CSV export.
- Automatic reviewed ingestion from registered local, iCloud Drive, Google Drive, OneDrive, or NAS folders while the Import Inbox is open.
- Immutable CSV/Excel/OCR source-record drill-down from a posted transaction.
- Household-scoped classification rules with priority, enable/disable, category, labels, and tags.
- Securities asset snapshot ingestion and a dedicated investment dashboard.
- Existing double-entry household ledger, budgets, goals, receipt/PDF extraction, and bank/card reconciliation.

## Remaining product milestones

1. Add more institution-specific brokerage adapters, dated market-price history, dividends/fees/tax reports, and complex corporate actions such as spin-offs and cash-in-lieu.
2. Render scanned PDF pages behind evidence overlays and improve item extraction across more Japanese receipt and statement formats.
3. Add multi-device household synchronization and mobile receipt capture while keeping the desktop ledger authoritative.
4. Add visual packaged UI interaction coverage, production signing/notarization, update keys, and a signed release channel.
