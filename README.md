# KakeFlow

KakeFlow is a local-first household finance workspace for macOS and Windows. It turns bank, card, wallet, PDF, spreadsheet, and receipt sources into a reconciled household ledger, with investment portfolio support planned as a separate snapshot-based module.

This repository contains a runnable desktop application slice: responsive ledger dashboards, accrual/cash accounting views, CSV/XLSX/PDF/image ingestion, native sync-folder scanning, review-before-posting, searchable and paginated double-entry transactions, balanced split editing with source-evidence drill-down, persisted budgets and savings goals, credit-card settlement reconciliation, a Tauri 2 shell, and an encrypted SQLCipher database with forward-only migrations.

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

## Remaining product milestones

1. Add background filesystem change notifications and reviewed batch import on top of the current bounded native sync-folder scanner.
2. Add an investment and securities portfolio module, starting with the sample `assetbalance(all)_20260712_144756.csv` format. This file is an as-of asset snapshot—not transaction history—so it will populate separate `PortfolioSnapshot`, `PositionSnapshot`, and `FxRateSnapshot` models without changing household expense or cash-flow totals. Planned views include net worth, asset allocation, cash held at brokers, market value, average cost, realized/unrealized profit and loss, and historical portfolio performance. A separate brokerage transaction adapter will later handle buys, sells, dividends, fees, taxes, and deposits/withdrawals.
3. Add packaged UI launch/E2E coverage on macOS and Windows; current CI compiles the real native executable without launching user data.
4. Configure production signing, notarization, update keys, and a signed release channel.
