# Changelog

All notable user-facing changes are recorded here. KakeFlow follows semantic versioning.

## 1.0.0 — 2026-07-18

### Added

- Local-first encrypted household ledger with immutable source evidence.
- Review-first imports for Japanese bank, card, wallet, brokerage, spreadsheet, PDF, image, ZIP, EML, Gmail, Drive, and watched-folder sources.
- Credit-card statement reconciliation and settlement coverage.
- Portfolio snapshots, native-currency valuation, and FIFO investment performance.
- Monthly, annual, ledger, and portfolio exports with source-backed scope.
- Audience-partitioned family delivery with explicit conflict review.
- Complete Japanese, English, and Vietnamese UI catalogs with automated coverage tests.

### Improved

- Rakuten Card PDF differences can proceed to review so refund or adjustment rows can be corrected manually; the original PDF remains unchanged.
- Securities asset snapshots recognize the Shift-JIS `assetbalance(all)` position-table format.
- Japanese household expense categories now cover common Money Forward, Moneytree, and 家計簿 workflows.
- Repository documentation and diagrams are consolidated around the current product behavior.

### Safety

- Imports, OCR, connectors, categorization, reconciliation, and family delivery do not post automatically.
- Ambiguous account mappings, duplicates, unsupported rows, and missing evidence fail closed.
- Cross-currency totals require source-backed conversion data.
