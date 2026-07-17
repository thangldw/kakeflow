# KakeFlow 1.0.0 release notes

KakeFlow 1.0.0 is the first stable release of the local-first household finance desktop workspace. It combines an auditable double-entry ledger, review-first document intake, card reconciliation, household reporting, investment evidence, and explicit family delivery in one desktop application.

## Highlights

- A complete KakeFlow v2 desktop interface with responsive workspaces, accessible controls, configurable dashboard layouts, and updated application identity.
- One Import Inbox for CSV, statement PDF, scanned PDF, receipt image, watched-folder, Drive, and Gmail sources.
- Local PP-OCRv5 processing for images and rendered PDF pages, with immutable original evidence and page-level outcomes.
- Explicit exact/probable duplicate decisions and classification-rule suggestions before posting.
- Card reconciliation with source-backed statement identity, settlement-bank mapping, due-date correction, coverage projection, and auditable link changes.
- Source-backed CSV, XLSX, and PDF exports that reuse the selected screen scope instead of running a second query.
- Portfolio snapshots and annual FIFO investment performance with native currencies, exceptions, and source lineage kept explicit.
- Restart-safe recurring-series preferences and recipient-encrypted family artifacts that still require review and atomic apply.
- Strict Japanese financial-source adapters that reject ambiguous or unsupported records instead of repairing them silently.

## Safety boundaries

- No import, OCR, connector, classification, reconciliation, or family-delivery workflow posts or applies data automatically.
- Missing account mappings, unsupported source semantics, ambiguous corrections, and unresolved duplicates block approval.
- KakeFlow does not initiate bank transfers or card payments.
- Cross-currency totals are not created without source-backed conversion data.
- Gmail and Google Drive remain test-user integrations pending provider qualification.
- Automatic updates are disabled.

## Distribution

The verified release artifact is `KakeFlow_1.0.0_aarch64.dmg` for macOS Apple Silicon.

- Size: `70,610,649` bytes
- SHA-256: `cc553b8f15a5f8ae29cc66d7dcbd0e648aa3bebf65bc0a6c59f78fb1e563a6e8`
- Signing: ad-hoc
- Notarization: none
- Windows: no public binary in this release

Publish or mirror the artifact only when its checksum matches and the `v1.0.0` tag identifies the reviewed source. See [Manual GitHub release](docs/MANUAL_GITHUB_RELEASE.md) and [V1 release readiness](docs/V1_RELEASE_READINESS.md).
