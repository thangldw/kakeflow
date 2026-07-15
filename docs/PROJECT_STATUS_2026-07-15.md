# KakeFlow project status — 2026-07-15

## Executive summary

KakeFlow has a released `v1.0.0` desktop product and a substantial `v1.1.0`
feature candidate on `main`. The canonical local-first ledger, import/review
workflow, dashboards, card reconciliation, investment workspace, reporting,
folder ingestion, and explicit family-delivery foundations are implemented.

The current estimate is:

- **Core desktop product agreed for v1:** approximately **90% complete**.
- **Broader product vision including production distribution, native mobile,
  generally available cloud connectors, and live financial aggregation:**
  approximately **70–75% complete**.

These are scope estimates, not source-line percentages. A capability counts as
complete only when code, tests, UI integration, and a documented truth boundary
exist. External qualification, native-platform evidence, and public release are
counted separately from implementation.

## Release state

| State | Version | Evidence |
| --- | --- | --- |
| Latest public stable | `v1.0.0` | Git tag and GitHub Release with locally verified macOS Apple Silicon DMG |
| Implemented on `main`, not yet released | `v1.1.0` candidate | Ten feature commits after `v1.0.0`; version/release metadata is prepared locally |
| Next public release | `v1.1.0` | Blocked until the complete non-security audit, five-report visual QA, OCR/package smoke, DMG verification, commit/tag, and manual GitHub publication pass |

The release cadence is now milestone-based. Capability increments receive
focused tests, commits, and pushes. Full audit, packaging, tagging, and public
release run only for substantial versions such as `v1.1` and `v1.2`.

## Completed and released in v1.0.0

### Financial core

- Canonical double-entry household ledger with Asset, Liability, Income,
  Expense, transfer, card-purchase, and card-payment semantics.
- Household/member attribution, shared/private scopes, saved account groups,
  calculation targets, labels, tags, bulk editing, and source drill-down.
- Credit-card statements, due dates, cumulative settlement matching, partial,
  full, overpaid, overdue, and shortfall states without double-counting expense.
- Budgets, savings goals, financial calendar, fixed-cost review, recurring and
  unusual-spending detection, three-month forecast, and Action Center.

### Data ingestion and evidence

- Immutable CSV, TSV, XLSX, text PDF, scanned/hybrid PDF, receipt image, ZIP,
  EML, local folder, iCloud/OneDrive/NAS-synced folder, Google Drive test-user,
  and Gmail test-user ingestion paths.
- Durable Import Inbox with restart recovery, explicit account mapping,
  preview, rollback, duplicate handling, receipt matching, item/tax review, and
  balanced atomic posting.
- Source viewer for CSV/Excel rows, PDF pages and bounding boxes, and original
  receipt images with OCR overlays.
- Generic parser rescue profiles plus strict adapters for major samples and
  supported Japanese bank, card, wallet, securities, and Money Forward files.

### Investment workspace

- `assetbalance(all)_*.csv` portfolio, position, cash, and FX snapshots kept
  separate from household spending transactions.
- Brokerage events for supported SBI, Rakuten Securities, and Monex spot
  contracts, including buys, sells, dividends, fees, taxes, deposits,
  withdrawals, splits, mergers, rights, and explicit corporate-action terms.
- FIFO holdings and realized P&L, dated market prices, native-currency reporting,
  JPY conversion only with explicit source FX, market value, unrealized P&L,
  allocation, and missing-price disclosure.

### Dashboards, reports, and desktop product

- Five customizable Home templates: Financial Overview, Household Ledger,
  Assets & Liabilities, Card Reconciliation, and Cash Flow.
- Monthly and annual reviews, transaction ledger, investment performance, and
  portfolio snapshot views with scoped drill-down and data-quality disclosure.
- CSV/XLSX/PDF export families released through `v1.0.0`, deterministic Japanese
  PDF font embedding, and page-by-page Poppler visual-QA tooling.
- Tauri desktop application, local database/vault, macOS packaged-app and DMG
  smoke harnesses, Windows packaging foundation, backup/restore, and disabled
  fail-closed updater contract.

### Family and multi-device foundations

- Local Family Space, schema-versioned change packages, portable evidence
  bundles, recipient-encrypted family artifacts, audience partitioning,
  recipient-set recovery, explicit conflict review, and atomic Apply.
- Authenticated reference relay and mobile-browser receipt capsule protocol,
  durable capture queue, Capture Inbox, and review-only promotion.

## Implemented after v1.0.0, pending v1.1.0 release

| Capability | Code state | Release state |
| --- | --- | --- |
| Apply persisted classification rules during Import Inbox review, with stale-rule revalidation | Implemented and focused-tested | Pending v1.1 audit/package |
| Recurring-series confirm, ignore, restore, forecast/fixed-cost effects | Implemented and focused-tested | Pending v1.1 audit/package |
| Replicate recurring preferences through schema-v5 packages and family delivery | Implemented and focused-tested | Pending v1.1 audit/package |
| Transaction Ledger PDF using the exact CSV/XLSX scope | Implemented and focused-tested | Five-report visual QA still required |
| Correct an already confirmed card-payment link with audit history | Implemented and focused-tested | Pending v1.1 audit/package |
| Detailed selected Portfolio Snapshot CSV | Implemented and focused-tested | Pending v1.1 audit/package |
| Annual native-currency Investment Performance CSV | Implemented and focused-tested | Pending v1.1 audit/package |
| Strict Resona Web入出金明細PLUS 14-field adapter | Implemented and focused-tested | Pending v1.1 audit/package |
| Strict Mizuho Business Web 13-field adapter | Implemented and focused-tested | Pending v1.1 audit/package |

## Current v1.1.0 verification state

- Release metadata is aligned at `1.1.0` across npm, Cargo, Tauri, changelog,
  README, release notes, documentation CTAs, and artifact naming.
- `npm run check:versions` passes.
- `npm run check:update-channel` reports `DISABLED_UNCONFIGURED` as required.
- Frontend regression passes: **101 test files / 699 tests**.
- ESLint, TypeScript/Vite production build, relay **33 tests**, and capture
  uploader **7 tests** pass.
- The full Rust regression run exposed one schema-v3 compatibility test failure
  during the milestone audit. The release remains blocked until that test is
  reproduced, diagnosed, fixed if necessary, and the complete Rust suite plus
  clippy pass.
- Five generated PDF fixtures have not yet been rendered and manually signed
  off for this candidate.
- OCR staging, packaged-app smoke, DMG smoke, second persistence smoke,
  codesign-structure verification, and SHA-256 generation have not yet run for
  this candidate.
- No `v1.1.0` commit, tag, DMG, or GitHub Release has been published yet.

## Not completed

### Product and data coverage

1. Additional high-volume Japanese bank, card, brokerage, pension, insurance,
   point, mileage, crypto, and other statement adapters beyond the currently
   strict contracts.
2. Broader brokerage semantics where source contracts are still ambiguous,
   including margin/derivatives, unsupported dual-currency settlement, and
   provider-specific installment/revolving card cases.
3. Generally available Google Drive and Gmail connectors. The code exists, but
   provider qualification and packaged real-account validation are incomplete.
4. A contracted read-only Japanese bank/card aggregation connector. No public
   consumer API or production partner contract is currently integrated.
5. Native iOS/Android receipt-capture applications with platform-managed durable
   storage and reliable background delivery. The current client is a reference
   mobile-browser implementation.
6. Broader automatic multi-device coordination. Current delivery remains
   explicit send/download/review/Apply by product contract; automatic Apply is
   intentionally not planned.

### Distribution and operations

1. Apple Developer ID signing and notarization. The current macOS artifact is
   Apple Silicon only and ad-hoc signed.
2. Native Windows x64 OCR staging, installer execution, installed-app smoke,
   Authenticode signing, uninstall evidence, and public Windows artifact.
3. Signed automatic updates, hosted update manifest/artifacts, and platform
   upgrade/rollback evidence. The updater is intentionally disabled.
4. Production-hosted relay/mobile delivery operations, service monitoring,
   support procedures, and provider/legal/commercial readiness.
5. Full native macOS Intel/universal and Windows ARM64 distribution evidence.

## Recommended next sequence

1. Resolve the v1.1 Rust compatibility gate and rerun the complete non-security
   suite once.
2. Generate and inspect all five PDF fixtures: monthly, annual, investment
   performance, portfolio snapshot, and transaction ledger.
3. Commit and push the final v1.1 release metadata, then build/test the DMG from
   that exact commit.
4. Create the annotated `v1.1.0` tag and publish the verified DMG manually with
   its SHA-256; do not use GitHub Actions.
5. Resume focused capability increments without another full audit/release until
   the next substantial milestone (`v1.2.0`).

## Evidence sources

- [README](../README.md)
- [Changelog](../CHANGELOG.md)
- [v1 release readiness](V1_RELEASE_READINESS.md)
- [Manual GitHub release](MANUAL_GITHUB_RELEASE.md)
- [PDF report visual QA](PDF_REPORT_VISUAL_QA.md)
- Git history through `09c0be5` and public release/tag `v1.0.0`
