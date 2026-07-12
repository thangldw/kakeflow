# KakeFlow

KakeFlow is a local-first household finance workspace for macOS and Windows. It turns bank, card, wallet, investment, PDF, spreadsheet, and receipt sources into a reconciled household ledger.

This repository currently contains the first runnable product slice: a responsive desktop dashboard prototype with transaction search, an import inbox, credit-card settlement reconciliation, and budgets/goals.

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

The current React application is the presentation layer. Planned boundaries are:

```text
apps/desktop       Tauri shell and React UI
crates/core        ingestion orchestration, validation, encryption
workers/extract    CSV/XLSX/PDF/OCR adapters
packages/domain    canonical schemas and accounting rules
```

Tauri scaffolding is intentionally deferred until the Rust toolchain is available in the development environment. The UI runs independently in Vite so product work and domain modeling can continue in parallel.

## Next milestone

1. Introduce canonical domain types and SQLite migrations.
2. Implement Japanese bank, PayPay, Amazon Mastercard, and Rakuten e-NAVI adapters.
3. Add import preview, idempotency, and rollback by import run.
4. Add deterministic credit-card statement to bank-debit reconciliation.
5. Wrap the verified React application in Tauri for signed macOS and Windows builds.
