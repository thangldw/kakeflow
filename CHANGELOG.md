# Changelog

Notable user-facing changes are recorded here. The project follows semantic versioning for stable releases.

## 1.0.0 — 2026-07-17

KakeFlow 1.0.0 is the first stable local-first desktop release.

### Added

- KakeFlow v2 application shell and primary workspaces, including responsive navigation, accessible popovers, dashboard templates, and updated application identity.
- Review-first ingestion for CSV, statement PDF, scanned PDF, receipt image, watched-folder, Google Drive, and Gmail sources.
- Local PaddleOCR PP-OCRv5 processing with checksum-pinned models; packaged Tesseract remains a compatibility fallback.
- Exact and probable duplicate resolution, classification-rule suggestions, and restart-safe pending-import recovery.
- Card statement reconciliation with masked card identity, due-date correction, settlement-bank mapping, coverage projection, unlinking, and auditable link corrections.
- Restart-safe recurring-series review and explicit replication of confirmed or ignored preferences.
- Source-backed PDF, CSV, and XLSX exports for household reviews, transaction ledgers, portfolio snapshots, and investment performance.
- Strict adapters for supported Japanese banks, cards, wallets, and brokerages, with explicit account mapping and immutable row provenance.
- Audience-partitioned, recipient-encrypted family delivery with explicit review and atomic apply.
- Fail-closed update-channel contract and release-readiness smoke testing.

### Changed

- Dashboard, budget, goal, report, card, and investment metrics now consistently read the confirmed double-entry ledger.
- Import, OCR, classification, reconciliation, connector, and family-delivery paths preserve an explicit user approval boundary.
- Desktop keyboard navigation and transaction/report accessibility were aligned with the v2 interaction contract.

### Distribution

- Published target: macOS Apple Silicon DMG, ad-hoc signed and not notarized.
- Windows remains a source-build target until native installer and packaged-app evidence is complete.
- Automatic updates remain disabled.
- Google connectors remain limited to locally configured test users pending provider qualification.
