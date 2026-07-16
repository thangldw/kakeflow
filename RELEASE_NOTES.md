# KakeFlow v1.1.0

KakeFlow v1.1.0 is the first post-1.0 feature milestone for the local-first
household finance desktop workspace. It expands review-time automation,
recurring-series coordination, source-backed exports, investment evidence, and
strict Japanese bank ingestion without weakening the explicit review boundary.

## Highlights

- Import Inbox can suggest persisted classification rules, revalidate stale
  suggestions, and apply them only after an explicit user action.
- Recurring-series review is restart-safe, supports ignore and restore, and can
  carry the complete confirmed/ignored preference set through schema-v5 change
  packages and explicit family delivery.
- Transaction Ledger PDF reuses the exact validated transaction scope shared by
  CSV/XLSX; all five released PDF report families pass page-by-page visual QA.
- Confirmed card-payment links can be corrected with auditable reconciliation
  updates instead of destructive re-import.
- Portfolio Snapshot CSV preserves the exact selected snapshot, while annual
  Investment Performance CSV keeps FIFO allocations, exceptions, lineage, and
  each native currency separate.
- Strict Resona Web入出金明細PLUS and Mizuho Business Web adapters validate their
  official record families, require explicit bank-account mapping, preserve
  physical source rows, and fail closed on ambiguous corrections.

## Distribution boundary

- Published artifact: `KakeFlow_1.1.0_aarch64.dmg` for macOS Apple Silicon.
- Signing: ad-hoc signed. Not Apple-notarized.
- Windows: source-build target only; no Windows installer is published because
  native x64 OCR and installer evidence is not yet complete.
- Automatic updates: disabled and unconfigured by design.
- Gmail and Google Drive: limited to locally configured test users pending
  Google provider qualification and packaged real-account validation.
- No ingestion, classification, reconciliation, or family-delivery path
  automatically posts or applies data.

The verified DMG SHA-256 is included in the GitHub Release notes generated from
the local release evidence.
