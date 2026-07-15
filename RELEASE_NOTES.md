# KakeFlow v1.0.0

KakeFlow v1.0.0 is the first stable major release of the local-first household
finance desktop workspace. It consolidates source-backed bank, card, PayPay,
receipt, PDF, spreadsheet, email, and securities data into a review-gated
double-entry ledger with traceable dashboards and reports.

## Highlights

- Household ledger, cash-flow, assets/liabilities, card reconciliation,
  budgets, goals, rules, labels, tags, and source drill-down.
- Strict Japanese provider adapters with immutable physical-row evidence and
  explicit account mapping, including personal-bank and PayPay history v2.
- Portfolio snapshots, FIFO investment performance, and native CSV/XLSX/PDF
  reports without inventing missing FX or return metrics.
- Durable local/cloud-synced folder intake, receipt/PDF OCR, local EML import,
  and read-only Gmail/Google Drive paths for configured test users.
- Recipient-encrypted family delivery with explicit review and Apply; optional
  background intake prepares at most one eligible encrypted publication per run.
- Transaction Ledger XLSX and Monthly Household Review CSV exports using the
  same validated scope as their on-screen data.
- Keyboard-accessible transaction dialogs and report tabs.

## Distribution boundary

- Published artifact: `KakeFlow_1.0.0_aarch64.dmg` for macOS Apple Silicon.
- Signing: ad-hoc signed. Not Apple-notarized.
- Windows: source-build target only; no Windows installer is published because
  native x64 OCR and installer evidence is not yet complete.
- Automatic updates: disabled and unconfigured by design.
- Gmail and Google Drive: limited to locally configured test users pending
  Google provider qualification and packaged real-account validation.
- No ingestion or family-delivery path automatically posts or applies data.

The verified DMG SHA-256 is included in the GitHub Release notes generated from
the local release evidence.
