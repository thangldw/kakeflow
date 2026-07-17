# KakeFlow v1.0.0

KakeFlow v1.0.0 is the complete first stable release of the local-first
household finance desktop workspace. It ships the complete KakeFlow v2 desktop
handoff, local PP-OCRv5 document intake, duplicate review, stronger statement
import and card reconciliation, recurring-series coordination, source-backed
exports, and investment evidence without weakening the explicit review boundary.

## Highlights

- The production shell and all primary workspaces now use the KakeFlow v2
  design, with compact navigation, responsive workspace sizing, accessible
  popovers, semantic card identity, dashboard templates, and the new app icon.
- CSV, statement PDF, scanned PDF, and receipt-image intake converge on the
  review-first Import Inbox. Original provider fields, immutable evidence, and
  explicit destination account/card mapping remain visible before posting.
- Image and rendered-PDF OCR runs locally with checksum-pinned PaddleOCR
  PP-OCRv5 models and ONNX Runtime assets. Tesseract remains packaged only as a
  compatibility fallback during the migration window.
- Exact and probable duplicates require an explicit link/keep/exclude decision;
  the bulk approval checkbox selects only valid, fully resolved candidates.
- Card reconciliation shows the card name and masked number on every statement,
  supports explicit bank mapping, due-date correction and unlinking, and shows
  projected settlement coverage without initiating a payment.
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

- Candidate artifact: `KakeFlow_1.0.0_aarch64.dmg` for macOS Apple Silicon;
  it is not public until the release commit and tag gates are complete.
- Signing: ad-hoc signed. Not Apple-notarized.
- Windows: source-build target only; no Windows installer is published because
  native x64 OCR and installer evidence is not yet complete.
- Automatic updates: disabled and unconfigured by design.
- Gmail and Google Drive: limited to locally configured test users pending
  Google provider qualification and packaged real-account validation.
- No ingestion, classification, reconciliation, or family-delivery path
  automatically posts or applies data.

## macOS artifact

- File: `KakeFlow_1.0.0_aarch64.dmg`
- Size: `70,610,621` bytes
- SHA-256: `f15a59c2a5dd7832729cab2c41542443bc2bf1fe3fe9ae678dfc774d3eede18c`

This artifact is the locally verified release candidate. Publish it only after
the release source is committed, the `v1.0.0` tag points to that exact commit,
and the artifact has been rebuilt or reproduced from the clean tagged tree.
