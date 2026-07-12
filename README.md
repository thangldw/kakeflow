# KakeFlow

KakeFlow is a local-first household finance workspace for macOS and Windows. It turns bank, card, wallet, investment, PDF, spreadsheet, and receipt sources into a reconciled household ledger.

This repository contains a runnable desktop vertical slice: a responsive dashboard, transaction accounting-basis switch, real CSV detection/preview, credit-card settlement reconciliation, budgets/goals, a Tauri 2 shell, and an encrypted SQLCipher database with forward-only migrations.

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
```

Desktop development also requires Rust 1.97. The desktop app creates a random database master key on first launch and stores it in macOS Keychain or Windows Credential Manager:

```bash
npm run desktop:dev
```

Build an unsigned local macOS/Windows artifact:

```bash
npm run desktop:build
```

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
src/               React UI, domain rules, and decoded CSV adapters
src-tauri/         Tauri shell, typed commands, SQLCipher, migrations
workers/extract    planned PDF/OCR sidecar
```

KakeFlow never stores the database key in its database, logs, application bundle, or process environment. Losing the OS credential currently makes the encrypted local database unrecoverable; portable encrypted backup and recovery-key workflows remain a release requirement.

## Next milestone

1. Move immutable source copying and parsing behind typed Rust commands.
2. Add import decision, atomic ledger posting, idempotency, and rollback by import run.
3. Replace the remaining dashboard fixtures with SQLite read models and typed IPC queries.
4. Add encrypted document vault, portable backup/restore, and PDF/OCR.
5. Add signed/notarized release credentials and packaged E2E tests.
