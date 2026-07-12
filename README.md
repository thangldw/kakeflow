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

Desktop development also requires Rust 1.97. The current development key provider deliberately requires an environment key of at least 32 characters:

```bash
export KAKEFLOW_DATABASE_KEY='replace-with-a-local-development-secret'
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

Release builds currently fail closed at database initialization until an OS credential provider replaces the development environment-key provider. This prevents accidentally distributing a build that relies on a bundled or process-environment database secret.

## Next milestone

1. Add macOS Keychain and Windows Credential Manager database-key providers.
2. Move immutable source copying and parsing behind typed Rust commands.
3. Add import decision, atomic ledger posting, idempotency, and rollback by import run.
4. Replace dashboard fixtures with SQLite read models and typed IPC queries.
5. Add encrypted document vault, portable backup/restore, PDF/OCR, and signed release CI.
