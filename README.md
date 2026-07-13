# KakeFlow

KakeFlow is a local-first household finance workspace for macOS and Windows. It turns bank, card, wallet, PDF, spreadsheet, receipt, and securities-asset sources into a reconciled household ledger and a separate investment portfolio.

Version 0.29 closes the credit-card forecast loop with editable statement payment due dates. Users can set, correct, or clear a verified date without changing statement lines, journal entries, reconciliation links, or payment totals; coverage and Action Center projections refresh from the saved value.

## Product tour

The household overview combines net worth, monthly income and spending, trends,
category composition, recent transactions, and card-settlement status.

![KakeFlow household overview](docs/assets/screenshots/kakeflow-overview.png)

| Searchable transaction ledger | Import and review inbox |
| --- | --- |
| ![KakeFlow transaction ledger](docs/assets/screenshots/kakeflow-transactions.png) | ![KakeFlow import inbox](docs/assets/screenshots/kakeflow-import-inbox.png) |

## How KakeFlow works

![KakeFlow local-first data pipeline](docs/assets/infographics/data-pipeline.svg)

KakeFlow deliberately separates expense recognition from cash settlement. A
credit-card purchase creates an expense and a card liability; the later bank
debit settles that liability without counting the expense twice.

![KakeFlow credit-card reconciliation](docs/assets/infographics/card-reconciliation.svg)

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
npm test
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

Desktop development also requires Rust 1.97. The desktop app creates a random database master key on first launch and stores it in macOS Keychain or Windows Credential Manager:

```bash
npm run desktop:dev
```

Build an unsigned local macOS/Windows artifact:

```bash
npm run desktop:build
```

Run the same non-destructive release-readiness smoke sequence as CI (version check,
frontend tests/lint/build, Rust format/Clippy/tests, and an unsigned
`tauri build --no-bundle`):

```bash
npm run desktop:smoke
```

The smoke command compiles and verifies the native executable but never launches
the app, opens a user database, creates an installer, or accesses signing keys.
GitHub Actions runs it independently on macOS and Windows. Signing, Apple
notarization, and production update credentials remain external release steps.

When GitHub-hosted runners are unavailable, follow the checked [manual GitHub
release procedure](docs/MANUAL_GITHUB_RELEASE.md): run every local desktop gate,
create the verified tag, and upload the locally built artifact with `gh release
create`. The release workflow is dispatch-only so pushing a tag does not create a
known-failing quota job.

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
src/               React UI, import adapters, review workflow, typed IPC client
src-tauri/         Tauri shell, SQLCipher ledger, encrypted vault, PDF/OCR, backup/restore
```

KakeFlow never stores the database key in its database, logs, application bundle, or process environment. A portable v2 backup encrypts the ledger, source-document vault, and a cross-device key capsule with a user passphrase. Backup destinations are selected by the native backend; restore is authenticated, staged, semantically validated, confirmed in a native OS dialog, and activated through a restart-safe journal.

Receipt OCR is offline. Development builds use `tesseract` from `PATH` and require the `jpn` and `eng` language models. Release bundles may instead provide `ocr/tesseract` (or `tesseract.exe`) and `ocr/tessdata` in the Tauri resource directory; if neither source is complete, the app reports OCR as unavailable and does not upload the image anywhere.

## Data and release safety

- SQLCipher encrypts the canonical ledger; XChaCha20-Poly1305 encrypts immutable source documents.
- macOS Keychain or Windows Credential Manager stores the active master key.
- Backup archives and restore work have aggregate byte, entry, and record budgets.
- Imported candidates remain reviewable and rollbackable until they are posted atomically as balanced journal entries.
- The checked-in desktop workflow produces **unsigned/ad-hoc** macOS and Windows artifacts. Public distribution still requires Apple Developer ID signing/notarization and a Windows code-signing certificate.

## Current capabilities

- User-confirmed [credit-card statement due dates](docs/CARD_DUE_DATES.md) with set/correct/clear controls, household-scoped validation, explicit no-inference labeling, and immediate coverage/forecast refresh without ledger mutation.
- Bounded [Yucho bulk ZIP import](docs/YUCHO_BULK_ZIP_IMPORT.md) for manual upload and drop, with deterministic per-CSV previews, archive-entry provenance, atomic archive rejection, CRC verification, explicit review, and no automatic ledger posting.
- Dedicated [Yucho Direct transaction import](docs/YUCHO_DIRECT_IMPORT.md) using the official seven-column personal-account CSV, explicit account mapping, physical-row provenance, running-balance validation, and conservative ATM/card semantics.
- Persisted [dashboard focus and appearance preferences](docs/DASHBOARD_PREFERENCES.md) with five truthful presets including dedicated Cash Flow, system/light/dark themes, comfortable/compact density, household isolation, responsive layouts, and no change to ledger data.
- Durable [app-wide Folder Inbox](docs/DURABLE_FOLDER_INBOX.md) with SQLite-backed discovery state, idempotent event/poll/manual reconciliation, bounded leases and retries, restart-safe preview rehydration, explicit retry/ignore controls, and no automatic ledger posting.
- Explicit [receipt-to-transaction evidence matching](docs/RECEIPT_EVIDENCE_MATCHING.md) for offline OCR candidates, with exact-amount and three-day date-window eligibility, explainable merchant-based ranking, and up to ten suggestions.
- User-confirmed evidence linking that attaches the receipt's immutable source rows to an existing posted expense/card purchase as supporting evidence without creating a transaction, journal entry, balance movement, or duplicate expense.
- Persisted workflow labels and free-form tags with [explicit bulk editing and exact filters](docs/TRANSACTION_LABELS_AND_TAGS.md), independent from categories and journals.
- Dedicated [Money Forward ME household-ledger import](docs/MONEY_FORWARD_HOUSEHOLD_IMPORT.md) with strict official-column parsing, explicit institution-to-account selection, transfer-safe posting, named source provenance, and stable external-ID deduplication.
- Calculation-target and transfer semantics carried through preview and posting; a Money Forward transfer can never silently become household income or expense.
- Explicit [card settlement coverage](docs/CARD_SETTLEMENT_COVERAGE.md) with user-selected card-to-bank mappings, cumulative multi-card projections, covered/shortfall/overdue states, and Action Center warnings.
- Cumulative [card-payment reconciliation](docs/CARD_PAYMENT_RECONCILIATION.md) with itemized confirmed debits, explicit candidate confirmation, and derived partial/full/overpaid totals.
- Actual bank-balance semantics that include every posted journal entry even when a transaction is excluded from household analytics, while confirmed card payments are applied only when effective by the requested as-of date.
- Honest disclosure of unmapped obligations and statements missing a due date; neither is silently assigned or folded into a misleading chronological forecast.
- Per-transaction [calculation targets](docs/CALCULATION_TARGETS.md) with visible included/excluded state, combined ledger filters, card-safe flag-only editing, complete CSV retention, and an explicit analytics-versus-balance boundary.
- [Annual Household Review](docs/ANNUAL_REVIEW.md) with twelve explicit month states, equal-window prior-year comparison, driver drill-down, account/member scopes, and deterministic UTF-8 BOM CSV export.
- [Money Forward aggregate asset history](docs/MONEY_FORWARD_ASSET_HISTORY.md) with official-column parsing, atomic multi-row persistence, overlapping-export reuse, provenance, date filters, trend/composition views, and a strict assets-only/no-ledger contract.
- Reliable zero-transaction import finalization for portfolio, brokerage, and aggregate reporting data while candidate-bearing imports still require a complete review decision set.
- Fixed-cost review for housing, insurance, utilities, connectivity, mobile, subscriptions, and other recurring costs with six complete monthly points and transaction drill-down.
- Cadence-normalized annual estimates for weekly through annual payees, stale-series exclusion, category-first classification, confidence reasons, account/member scopes, and explicit [metric semantics](docs/FIXED_COST_REVIEW.md).
- Truthful fixed-cost coverage and limitations: the app reports observed confirmed-ledger costs and never claims an external market-saving opportunity without market data.
- Mixed cash/stock and cross-currency merger ingestion with explicit stock-basis allocation, consideration currencies, and source-to-output FX rates.
- FIFO merger allocations that expose source acquisition evidence, source/output basis and currency, exact conversion rate, cash proceeds, and realized P&L.
- Per-currency balanced merger legs and cash-flow totals; incomplete or unnecessary terms are rejected instead of inferred.
- Persisted [custom CSV/TSV mappings](docs/CUSTOM_PARSER_PROFILES.md) with optimistic concurrency, UTF-8/CP932 decoding, explicit signed/debit-credit semantics, and JPY-only validation.
- Per-file profile application with matched-header, candidate, excluded-row, and issue preview; error rows block staging and every valid candidate remains pending review.
- Immutable custom source-row/raw-field provenance, external transaction ID propagation, and an explicit Asset/Liability target account.
- Persisted whole-household, household-common, or member activity scope with archived-member historical reporting.
- Consistent attribution filtering across transaction activity, calendar/reports, recurring and anomaly intelligence, forecast history, Action Center actuals, and transaction CSV export.
- Truthful household-wide disclosure for net worth, account balances, investments, savings goals, import status, and unallocated household obligations.
- Explicit household/member transaction attribution, independent shared/personal audience labels, and archived-member historical references.
- Independent source-document audience editing that never changes linked transaction metadata.
- Local Family Space with ordered member creation, editing, archive lifecycle, and truthful no-access-control disclosure.
- Independent household/member account ownership and shared/personal classification, including atomic account creation and strict same-household active-owner validation.
- Saved household/personal/daily-spending/custom account scopes across Overview, Transactions, Reports, intelligence, forecasts, Action Center items, and CSV export.
- Canonical any-journal-entry group membership with no duplicate transaction counts, strict household validation, and legacy all-account behavior when no scope is selected.
- Monex U.S. stock-history CSV import with source-row provenance and normalized ticker/name fields.
- Spin-off cost allocation, rights-subscription lots, and cash-in-lieu FIFO disposal from explicit source terms, with annual-report explanations and no guessed values.
- Password-protected PDF extraction and evidence-page rendering with ephemeral credentials and semantic retry states.
- Read-only DMG mount validation for bundle version, identifier, executable, resources, signature structure, and clean detach.
- Dated market-price history, `assetbalance` price reuse, market value, unrealized P&L, and explicit missing-price disclosure by currency.
- Annual realized P&L, dividend, fee, tax, and FIFO purchase-to-sale source-row reporting.
- Locally rendered authenticated PDF pages underneath extraction bounding boxes.
- Packaged-WebView onboarding and Home-render evidence with database persistence verification.
- Recursive native filesystem notifications with debouncing, duplicate suppression, and bounded polling fallback.
- Split, reverse-split, and same-currency share-for-share merger events that preserve FIFO lot provenance and total cost.
- JPY investment reporting from dated direct/inverse FX observations, including the exact selected rate and source provenance.
- Authenticated local receipt-image preview with interactive OCR regions, zoom, confidence, and source-row drill-down.
- Background folder discovery outside Import Inbox with debounced created/modified/removed events.
- FIFO holdings, open lots, realized P&L, dividends, fees, and taxes with source-event lineage per currency.
- Packaged application launch smoke using isolated temporary data, real WebView IPC, and migration checks.
- Three-month cash/savings forecast with explicit historical assumptions, recurring costs, and known card payments.
- Prioritized Action Center for imports, card reconciliation, budgets, goals, anomalies, and subscription price changes.
- Brokerage buys, sells, dividends, fees, taxes, deposits, and withdrawals with balanced investment legs and currency summaries.
- Page-aware PDF/OCR evidence plus receipt item, tax, coupon, point, confidence, and provenance views.
- Financial calendar with accrual/cash views, no-spend days, card schedules, and drill-down.
- Monthly/yearly reports with MoM/YoY comparisons, budget/goal progress, spending drivers, reconciliation, and data-quality status.
- Explainable recurring/subscription and unusual-spending detection derived locally from confirmed ledger history.
- Reusable household/personal/investment/custom account groups and scoped transaction or portfolio CSV export.
- Automatic reviewed ingestion from registered local, iCloud Drive, Google Drive, OneDrive, or NAS folders across the desktop app, including restart-safe queue state and an app-wide actionable badge.
- Immutable CSV/Excel/OCR source-record drill-down from a posted transaction.
- Household-scoped classification rules with priority, enable/disable, category, labels, and tags.
- Securities asset snapshot ingestion and a dedicated investment dashboard.
- Existing double-entry household ledger, budgets, goals, receipt/PDF extraction, and bank/card reconciliation.

## Remaining product milestones

1. Add optional end-to-end encrypted multi-device household synchronization, principal-to-member mapping, backend-derived audience enforcement, and mobile receipt capture.
2. Add more institution-specific brokerage and statement adapters.
3. Add production signing/notarization, update keys, Windows installer-level tests, and a signed release channel.
