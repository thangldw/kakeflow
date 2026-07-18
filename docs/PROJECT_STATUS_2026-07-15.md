# KakeFlow project status — 2026-07-18

This historical status records the v1.0.0 release-candidate boundary. Current release facts live in [README](../README.md), [release notes](../RELEASE_NOTES.md), and [release readiness](V1_RELEASE_READINESS.md).

## Completed

- KakeFlow v2 shell and all 11 primary workspaces.
- Review-first file, PDF, OCR, folder, Gmail, and Drive ingestion.
- Strict supported Japanese bank/card/wallet/brokerage adapters.
- Card reconciliation, source lineage, duplicate resolution, and classification suggestions.
- Monthly/annual/ledger/portfolio/investment CSV/XLSX/PDF exports.
- Explicit family delivery, local packages, evidence capsules, and recurring preferences.
- PP-OCRv5 primary OCR with pinned assets and Tesseract compatibility fallback.

## Verified candidate evidence

- Frontend: 106 files / 721 tests; lint and production build passed.
- Rust: format, warnings-denied Clippy, 612 library tests, 30 integration tests.
- Relay: 33 tests; capture uploader: 7 tests.
- PDF: five families, 19 rendered pages, automated and visual PASS.
- Packaged macOS: 11 pages / 12 interactions, IPC, schema 68, code-sign structure and read-only DMG smoke passed.
- Artifact: `KakeFlow_1.0.0_aarch64.dmg`, 70,610,649 bytes, SHA-256 `cc553b8f15a5f8ae29cc66d7dcbd0e648aa3bebf65bc0a6c59f78fb1e563a6e8`.

## Remaining boundaries

- Windows native OCR/installer/installed-app/uninstall evidence.
- Google provider qualification and packaged real-account validation.
- Native mobile capture and app-closed background behavior.
- Additional financial-source adapters with authoritative contracts.
- Production relay operations and support.

Paid notarization/AuthentiCode, stores, signed updater, macOS Intel/universal, Windows ARM64, and direct financial-provider APIs are outside funded scope. Distribution remains manual through GitHub Releases.
