# Changelog

## 0.34.0 — 2026-07-13

- Add stable local device origins and logical principals without treating either as a login or authorization identity.
- Add an explicit local-principal-to-household-member mapping in Family Space; never infer it from account ownership or display names.
- Add canonical schema-v1 change envelopes with per-device sequence, idempotent mutation IDs, deterministic IDs, canonical JSON payloads, SHA-256 digests, and a separate local outbox.
- Show device, principal, change-log, and restore-validation status in Settings with an explicit `端末内のみ` boundary.
- Validate sync-foundation relations during portable restore and clear only the active device-local context while preserving logical identity and origin history.
- Keep remote transport, cloud synchronization, login, conflict resolution, audience enforcement, and mobile capture outside this release.

## 0.33.0 — 2026-07-13

- Expand packaged-WebView smoke from Home-only evidence to all ten top-level workspaces, including Settings.
- Verify canonical navigation order, exact page heading, visible heading/main region, active navigation, rendered text, viewport, IPC, migrations, integrity, and persisted onboarding data.
- Preserve partial route evidence after every successful page so packaged failures identify the last verified workspace.
- Mirror independent canonical workspace expectations in JavaScript, Node, and Rust validators and extend the process timeout for slower packaged WebViews.

## 0.32.0 — 2026-07-13

- Promote the existing source-backed Action Center to Home with the three highest-priority actions and an exact total count.
- Apply one deterministic priority, due-date, and stable-ID order in both Home and the full Forecast workspace.
- Route every action kind through an exhaustive workspace map and open “view all” directly on Reports → Forecast & Actions.
- Query actions independently from dashboard metrics, retain the last valid same-scope snapshot on refresh failure, and provide explicit loading, retry, stale, empty, and browser-preview states.
- Use the selected month's final day as the visible action baseline and disclose that import review remains household-wide under account/member filters.
- Refresh Home actions after import, card, budget, and savings-goal mutations without creating a second alert model.

## 0.31.0 — 2026-07-13

- Require a destination account for every generic Japanese bank, PayPay, Rakuten Card, and Amazon Mastercard file before staging.
- Filter each per-file selector to the compatible canonical account type: bank asset, wallet asset, or credit-card liability.
- Remove household-ID defaults and issuer-name matching from import routing; filenames and account names are never treated as authoritative mappings.
- Keep selections independent across previews and discard them when the household changes or the corresponding preview leaves the Inbox.

## 0.30.0 — 2026-07-13

- Add a source-backed Home data-quality panel with latest successful import, canonical source filename/type, original-document and source-row totals, distinct source channels, review backlog, and failed-import count.
- Select freshness only from same-household source documents attached to `POSTED` import runs, with deterministic timestamp-and-ID tie-breaking and atomic TypeScript validation of nullable provenance.
- Link the quality summary directly to Import Inbox and avoid claiming complete account coverage when the available facts only establish import/source coverage.
- Disable no-op dashboard preference controls in browser preview and label their desktop-only persistence explicitly.
- Add semantic “increase” text to demo KPI trends and a screen-reader numeric table for the six-month trend chart.
- Capture and preserve a screenshot-grounded UX/accessibility audit of the Overview-to-Card flow; use its highest-impact findings to shape this release.

## 0.29.0 — 2026-07-13

- Add household-scoped set, correction, and explicit clearing of a credit-card statement's payment due date from the Cards workspace.
- Require a canonical real `YYYY-MM-DD` date on or after the statement period end; never infer the date from issuer names, transaction descriptions, or other statements.
- Add a direct due-date action to missing-date coverage warnings and label every displayed value as user-confirmed.
- Refresh statement cards, bank coverage, forecast, and Action Center data after a successful change while retaining the entered draft and showing a clear validation message after failure.
- Preserve statement amounts and lines, confirmed payment links, reconciliation status, source evidence, transactions, and balanced journal entries across date edits.

## 0.28.0 — 2026-07-13

- Add bounded manual ZIP upload and drop for official Yucho Direct bulk exports while leaving watched-folder ZIP behavior unchanged.
- Expand each distinct CSV payload into a normal import preview with deterministic ordering, `archive.zip › entry.csv` source provenance, explicit bank-account mapping, review, and explicit posting.
- Reject an archive atomically when it is malformed, split/multidisk, ZIP64, encrypted, path-bearing, directory-bearing, ambiguously named, inconsistently described, CRC-invalid, or uses an unsupported compression method.
- Bound archive processing to 25 MB compressed, 20 entries, 10 MB per entry, and 50 MB total expanded data; expanded CSV children also count against the existing 20-preview batch limit.
- Ignore non-CSV entries only after the archive passes validation and disclose them once in the preview rather than silently treating them as financial data.
- Collapse byte-identical CSV entries to one content-addressed preview with a visible canonical-name mapping, and reject unflagged non-ASCII legacy filenames instead of decoding Japanese names inconsistently.

## 0.27.0 — 2026-07-13

- Add a dedicated `yucho-direct-ledger-v1` adapter for the official Yucho Direct personal-account CSV, detected ahead of the generic Japanese bank format.
- Find the exact seven-column header after the account-information preamble, normalize full-width header punctuation, and parse official `YYYYMMDD` transaction dates.
- Map deposits, withdrawals, detail fields, and signed current/loan balances into the canonical bank candidate while requiring the user to select the destination account explicitly.
- Validate row width, real calendar dates, positive integer JPY amounts, mutually exclusive debit/credit columns, duplicate export sequences, signed balances, and oldest-first running-balance continuity.
- Keep `入出金明細ID` only in immutable raw provenance because Yucho defines it as a sequence assigned during CSV export, not a durable bank transaction identifier.
- Treat `カード` conservatively as an unknown bank event because it can represent an ATM cash-card transaction; never infer a credit-card settlement from that label.

## 0.26.0 — 2026-07-13

- Add a fifth persisted `CASH_FLOW` Home preset with cash-specific inflow, outflow, net-flow, and month-end asset labels.
- Add a dedicated six-month cash-flow trend derived from posted asset-account deltas under the same household, account-group, member-attribution, date, and calculation-target scopes as the headline totals.
- Count a credit-card purchase on the accrual timeline and its later bank settlement once on the cash timeline, including when purchase and settlement fall in different months.
- Keep the existing accrual trend and expense-category composition unchanged; the Cash Flow preset does not present either as cash movement or invent cash categories.
- Query Home KPIs, trend, and recent activity consistently in cash basis for the Cash Flow preset, refetch in accrual basis when leaving it, and prevent delayed responses from an old basis or household from replacing the active view.
- Preserve existing dashboard preferences while extending their constrained domain through a versioned SQLite migration and restore validation.

## 0.25.0 — 2026-07-13

- Add four household-scoped Home focus presets: Financial Overview, Household Ledger, Assets & Liabilities, and Card Reconciliation.
- Reorder and emphasize only existing, source-backed KPIs and widgets; changing a preset never changes accounting basis, ledger rows, dashboard queries, or card-settlement semantics.
- Add app-wide `System`, `Light`, and `Dark` appearance plus `Comfortable` and `Compact` density with responsive desktop layouts.
- Persist preferences in SQLite per household, return deterministic defaults without writing, and restore each household's independent selection when switching.
- Protect asynchronous preference loading and saving from stale household responses, and validate every enum, household relation, timestamp, IPC response, migration, and restored database state.

## 0.24.0 — 2026-07-13

- Add a durable, household-scoped Folder Inbox that persists metadata and processing state in SQLite without storing file bytes or absolute watched-folder paths in the queue.
- Reconcile native filesystem events, polling fallback, and manual scans idempotently by watched folder, relative path, and file generation; mark disappeared generations removed instead of silently forgetting them.
- Hydrate bounded preview batches from every application page, restore `READY` and `NEEDS_MAPPING` previews after restart without spending retry attempts, and expose an app-wide actionable badge.
- Require an explicit import start and review decision before posting; the queue becomes `STAGED` only after the canonical import run exists and never commits a transaction automatically.
- Recover stale leases, cap fresh parsing attempts, support retry/ignore controls, and permit a staged retry only after the linked canonical import run has been rolled back.
- Reject changed file metadata after reading, stale leases, cross-household links, malformed relative paths, invalid restore state, and contradictory queue-state metadata.

## 0.23.0 — 2026-07-13

- Reconcile one credit-card statement with multiple explicitly confirmed bank debits and show each payment leg once.
- Derive statement status and paid, outstanding, and overpaid totals strictly from confirmed links.
- Surface bounded same-card settlement candidates while requiring an explicit user confirmation for every link.
- Keep confirmation household-scoped, atomic, idempotent, immutable after confirmation, and limited to posted card-payment journals within 120 days after the statement period.
- Preserve card purchases as the expense facts and leave journals, source evidence, balances, budgets, and payment initiation untouched.
- Normalize legacy reconciliation state and validate cumulative links and derived status during restore.

## 0.22.0 — 2026-07-13

- Add seven controlled workflow labels and household-defined tags without changing accounting categories, journals, balances, budgets, or card reconciliation.
- Show sorted labels and tags on transaction rows and details, with exact label/tag filters in the persisted ledger query.
- Add explicit current-page and per-row selection plus atomic bulk add/remove for up to 200 posted transactions.
- Reject duplicate IDs, conflicting add/remove operations, invalid tags, non-posted rows, and cross-household batches without partial metadata changes.
- Keep bulk operations idempotent and report only transactions whose metadata actually changed.

## 0.21.0 — 2026-07-13

- Add receipt-match suggestions for offline OCR candidates against existing posted expenses and card purchases, requiring an exact expense amount and a transaction date within three days.
- Rank up to ten eligible suggestions by date proximity and explainable merchant-name similarity while showing the amount, date difference, similarity, and reasons in the Import Inbox.
- Require the user to select and confirm a suggested transaction; KakeFlow never links a receipt automatically.
- Attach every receipt source row to the selected transaction as supporting evidence and resolve the receipt candidate without creating another transaction or journal entry.
- Keep confirmation household-scoped, atomic, idempotent, and revalidated against the current posted transaction so stale, cross-household, or changed targets are rejected.
- Preserve the original posting, account balances, dashboard totals, and card reconciliation when evidence is linked, preventing the receipt and imported card/bank record from becoming duplicate expenses.

## 0.20.0 — 2026-07-13

- Add a dedicated adapter for Money Forward ME's documented ten-column household-ledger CSV export, including reordered columns, quoted fields, UTF-8/CP932 decoding, strict calendar dates, and signed integer JPY amounts.
- Preserve calculation-target, transfer, financial-institution, major/minor category, memo, external ID, and named source fields through immutable evidence, staging, review, and posting.
- Require one explicit KakeFlow Asset/Liability account for the exported institution and reject multi-institution files instead of silently assigning every row to one account.
- Force Money Forward transfers to remain calculation-excluded `TRANSFER` transactions and reject any transfer journal that touches income or expense accounts.
- Persist provider external IDs with a canonical source-fact hash, reuse identical overlapping-export rows as supporting evidence, and reject changed facts under the same ID atomically.
- Show Money Forward institution, taxonomy, source ID, calculation-target state, and transfer defaults in the Import Inbox review before ledger posting.

## 0.19.0 — 2026-07-13

- Add persisted, explicit credit-card-to-bank settlement mappings with strict same-household, active-account, and account-type validation; KakeFlow never infers a payment bank from transaction text.
- Project every dated outstanding statement cumulatively against the mapped bank's actual posted balance, including transactions excluded from household analytics, across multiple cards sharing one bank account.
- Respect the requested as-of date when counting confirmed card payments, include old overdue obligations, and cap the bounded projection query without silently truncating debts.
- Separate unmapped statements and statements missing a payment due date from the chronological projection so incomplete data remains visible instead of producing false confidence.
- Add covered, shortfall, and overdue states plus current, step-by-step projected, ending, and maximum-shortfall balances to the Cards workspace.
- Add household-wide Action Center warnings for bank-balance shortfalls, missing card-to-bank mappings, and missing statement due dates.
- Protect mappings with database triggers, restore validation, and account-archive checks while keeping the entire feature read-only with no payment initiation.

## 0.18.0 — 2026-07-13

- Add a persisted per-transaction calculation target with a legacy-safe included default and strict boolean storage.
- Keep excluded posted transactions visible in the ledger, journal, source evidence, actual account/net-worth balances, card statements, payments, and reconciliation while removing them from household analytical totals.
- Apply the calculation target consistently to dashboard income/expense/trends/categories, budget actuals, financial calendar and reports, recurring/anomaly/fixed-cost analysis, forecast history, and transaction-derived Action Center actuals.
- Add `ALL`, `INCLUDED`, and `EXCLUDED` ledger filters that compose with accounting basis, account-group scope, family attribution, search, date range, and pagination.
- Add visible `計算対象` / `集計対象外` badges and an editable `家計の集計に含める` control with an explicit no-balance-change disclosure.
- Allow a flag-only update on card-linked transactions while preserving every journal, statement, payment, and source relation; unrelated edits remain reconciliation-protected.
- Export both included and excluded transactions with an explicit `calculation_target` column instead of silently dropping source facts.

## 0.17.0 — 2026-07-13

- Add an Annual Household Review with equal-window year-over-year income, expense, savings, savings-rate, category, merchant, budget, reconciliation, and data-quality views.
- Mark all twelve calendar points as `COMPLETE`, `PARTIAL`, or `FUTURE`; exclude incomplete months from annual KPIs and compare a current year only with the same completed prior-year months.
- Add deterministic, scoped annual-review CSV generation and native save with UTF-8 BOM, explicit month status, source period, account group, and attribution scope.
- Add a dedicated `money-forward-me-asset-trend-v1` adapter for the officially documented Money Forward ME asset-history columns, including optional and reordered asset-class columns.
- Persist aggregate asset history by household/date with immutable source-document and source-row provenance, atomic 1–1,200 row imports, overlapping-export reuse, conflict rollback, and date-range queries.
- Display total-asset trend, latest change, and asset-class composition in Investments while explicitly keeping the external aggregate out of accounts, ledger, cash flow, and net-worth calculations.
- Allow zero-decision finalization only for non-transaction import runs with zero reviewable candidates, fixing completion of portfolio, brokerage, and aggregate-asset imports without weakening transaction review.

## 0.16.0 — 2026-07-13

- Add a dedicated fixed-cost review inside Reports, derived only from confirmed household expenses and card purchases.
- Compare the latest three complete months with the preceding three while excluding the partial current month and always returning an explicit six-month series.
- Detect weekly, biweekly, monthly, quarterly, and annual payment cadence over a bounded 36-month history, exclude stale series, and annualize each payee by its observed cadence.
- Classify housing, insurance, electricity, gas, water, internet, mobile, and subscription segments using category-first evidence while preventing short English keywords from matching inside unrelated words.
- Allow cadence-stable utilities to vary in amount with lower confidence; require stable amounts for generic recurring costs and disclose every reason in the drill-down.
- Apply the global account-group and household/member attribution scopes without double-counting split journal entries.
- Report source coverage and limitations explicitly and never invent a market-price comparison or potential-savings estimate.

## 0.15.0 — 2026-07-13

- Add explicit source terms for all-stock and mixed cash/stock mergers, including target and cash currencies, stock cost-basis allocation, and source-to-target/source-to-cash FX rates.
- Represent cross-currency security and cash legs by their actual currency, require each currency bucket to balance independently, and attribute brokerage cash movement to the cash leg's currency.
- Transform every matching FIFO source lot into target shares while preserving acquisition/source provenance; allocate cash proceeds pro rata by surrendered quantity and calculate realized P&L per lot.
- Convert stock and cash cost-basis portions only with explicit source-row rates; missing, unnecessary, non-finite, or out-of-range rates reject import or leave the performance action skipped without consuming source lots.
- Add `MERGER_STOCK` and `MERGER_CASH` audit allocations with source document/row, source basis/currency, conversion rate, output basis/currency, cash proceeds, and realized result.
- Extend Japanese/English brokerage aliases and investment reports for merger consideration while keeping non-cash stock allocations visually distinct from cash proceeds.

## 0.14.0 — 2026-07-13

- Add household-scoped, versioned CSV/TSV parser profiles with create, update, enable/disable, priority, and optimistic delete/update behavior.
- Map saved header rows to transaction date, description/payee, signed amount or separate debit/credit columns, external transaction ID, and an optional account hint.
- Support explicit UTF-8/UTF-8 BOM/CP932 decoding, comma/tab/semicolon detection, multiple date layouts, and configurable positive-value direction for one-column card or bank amounts.
- Preview real matched headers, candidates, excluded rows, encoding, delimiter, and row-level issues before starting an import; any error blocks staging rather than silently omitting rows.
- Preserve source-row/raw-field provenance and external transaction IDs, select an Asset/Liability target account explicitly, and keep every custom candidate in the existing review/approval workflow.
- Retain bounded bytes for unsupported CSV/TSV files so a saved profile can be applied locally without uploading or rereading the original file.

## 0.13.0 — 2026-07-13

- Add one persisted tagged attribution scope—whole household, household-common activity, or one member—to the desktop workspace.
- Apply attribution and account-group scopes together to transaction lists, dashboard activity metrics, financial calendar, monthly/yearly reports, recurring and anomaly analysis, forecasts, Action Center actuals, and transaction CSV export.
- Validate member scopes against the active household while preserving archived members for historical reporting and rejecting cross-household scope widening.
- Keep balance facts such as net worth, opening cash, investment valuation, portfolio export, goals, and import status household-wide, with explicit UI and forecast disclosures instead of misleading partial totals.
- Select card statements by linked transaction attribution when available, retain unlinked household obligations, and never allocate a full settlement amount to a member without evidence.
- Keep audience labels independent from analytical attribution and from authentication or access control.

## 0.12.0 — 2026-07-13

- Add explicit, independent household/member attribution and shared/personal audience tuples to transactions, import candidates, and source documents without deriving them from account ownership or account groups.
- Backfill existing records to household-attributed/shared and preserve archived-member references as historical facts while rejecting cross-household tuples.
- Carry attribution and audience through manual entry, import preview/posting, posted-transaction edits, transaction rows, details, and evidence projections.
- Add separate transaction controls and text badges for family attribution and local display classification; the assigned member and personal audience member may intentionally differ.
- Add a source-document audience editor that changes only the original document label and never cascades into linked transaction metadata.
- Validate scope tuples during restore and at the native IPC boundary, while keeping all existing analytics totals unchanged until a complete attribution-reporting contract is implemented.

## 0.11.0 — 2026-07-13

- Add stable household-member records with ordered active/archive lifecycle and an automatically created primary local member for existing and new households.
- Add a dedicated Family Space for member management and clearly state that personal classification is local organization, not authentication or access control.
- Classify accounts independently by household/member ownership and shared/personal visibility; member-owned shared accounts remain supported.
- Create accounts with ownership atomically and reject personal household accounts, foreign or archived owners, last-active-member archive, and archive of a member who still owns accounts.
- Preserve member and ownership data in the encrypted database/backup and validate cross-household ownership and active-member invariants during restore.
- Replace hard-coded person-like avatars with neutral initials derived from the active household name.

## 0.10.0 — 2026-07-13

- Add a saved account-scope selector to Overview, Transactions, and Reports, restore the selection per household, and reset it safely when the household changes or the group is deleted.
- Apply one canonical any-journal-entry membership rule to dashboard KPIs and trends, ledger pagination, financial calendar, monthly/yearly reports, recurring/anomaly analysis, forecasts, and account-derived Action Center items.
- Reject missing or cross-household groups instead of silently returning whole-household data; an omitted group preserves the previous all-account result.
- Keep household-level import and goal actions visible inside scoped reports because those records have no account association.
- Default CSV export to the active analytical scope and display the selected group beside scoped results.

## 0.9.0 — 2026-07-13

- Import Monex U.S. stock transaction-history CSV columns and preserve the source row, currency, ticker, and transaction semantics.
- Allocate spin-off cost basis from an explicit source-provided ratio, create rights-subscription lots from confirmed terms, and treat cash in lieu as an auditable FIFO disposal with realized P&L.
- Explain corporate-action allocations in the annual investment report down to the action and originating purchase source rows; incomplete terms are rejected instead of guessed.
- Unlock supported password-protected PDFs for the current extraction or page-render request, with explicit required, invalid, and unsupported-password states and no persisted password.
- Mount the produced macOS DMG read-only and validate its versioned app bundle, executable, resources, signature structure, and clean detach separately from the packaged-WebView smoke test.
- Harden packaged-app smoke cleanup so a timed-out child is terminated and reaped before temporary data is removed, and suppress macOS crash-history restoration prompts inside the isolated smoke process.

## 0.8.0 — 2026-07-13

- Add immutable dated investment market-price observations with provider, document, row, and observation provenance.
- Reuse prices from `assetbalance(all)_*.csv` snapshots and value FIFO holdings at the latest confirmed price on or before the selected date without using future or wrong-currency quotes.
- Add market value, unrealized P&L, missing-price disclosure, annual realized P&L, dividend, fee, tax, and source-row reports by currency.
- Render authenticated PDF source pages locally and place `PDF_POINTS` extraction regions over the actual page image.
- Normalize full-width Japanese receipt text, `令和`/`平成` dates, and additional electronic-money payment methods.
- Exercise onboarding and the resulting Home screen inside the real packaged WebView, verify the UI-created household in SQLCipher, and upload machine-readable interaction evidence from macOS and Windows CI.

## 0.7.0 — 2026-07-13

- Replace folder-only polling with recursive native filesystem notifications, burst debouncing, duplicate suppression, and a bounded polling fallback.
- Add split, reverse-split, and same-currency share-for-share merger events that preserve FIFO lot cost, acquisition date, and source provenance without creating artificial gains.
- Add immutable dated FX observations and JPY investment reporting with direct/inverse-rate provenance; missing rates fail visibly instead of producing partial or invented totals.
- Reuse provenance-bearing FX rates imported with securities portfolio snapshots.
- Display authenticated receipt images locally with interactive OCR bounding-box overlays, zoom, selection, and source-row drill-down.
- Expand Japanese receipt extraction for quantities, unit prices, subtotals, change, payment methods, and included/excluded tax modes.

## 0.6.0 — 2026-07-13

- Add a process-wide background folder discovery supervisor that detects created, modified, and removed supported files even when Import Inbox is closed.
- Emit debounced, household-scoped change events without exposing absolute paths or automatically posting financial data.
- Add FIFO investment cost basis, open lots, holdings, realized allocations, uncovered-sale warnings, and auditable source event/row lineage.
- Report realized P&L, dividends, fees, and taxes per currency without inventing FX conversion or combining currencies.
- Integrate background discovery status and investment performance into the desktop workspace.
- Add a packaged-app smoke harness that launches the real macOS/Windows bundle in isolated app data, validates the main window, WebView IPC, SQLCipher integrity, and migrations, then exits and cleans up.

## 0.5.0 — 2026-07-13

- Add a deterministic three-month household cash and savings forecast with visible assumptions, recurring costs, and known card payments.
- Add an Action Center for import failures/review, card mismatches and due payments, budget overruns, goal deadlines, anomalies, and recurring price changes.
- Add Japanese brokerage transaction ingestion and persistence for buys, sells, dividends, fees, taxes, deposits, and withdrawals without inflating household expenses.
- Add brokerage currency totals, cash movement, source-row idempotence, balanced investment legs, and transaction history in the investment workspace.
- Add page-aware PDF evidence and OCR word bounding boxes with confidence and provenance.
- Upgrade receipt evidence with item rows, Japanese 8%/10% taxes, coupons, points, and source line/region references.
- Add responsive forecast, action, and evidence viewers with desktop integration tests.
- Make Windows release builds select the compatible Strawberry Perl toolchain for vendored OpenSSL.

## 0.4.0 — 2026-07-13

- Add a 42-day financial calendar with accrual/cash views, no-spend days, card closing dates, payment due dates, and settlement events.
- Add monthly and yearly household reports with period comparisons, savings rate, budget/goal progress, spending drivers, reconciliation status, and data-quality context.
- Detect recurring payments and subscriptions, predict the next occurrence, and explain price changes from confirmed household history.
- Detect unusual expenses using robust household/payee baselines without sending financial data to an external model.
- Add reusable ordered account groups for family, personal, daily-spending, investment, business, tax, education, and custom scopes.
- Export confirmed transaction ledgers and portfolio snapshots as scoped, date-bounded UTF-8 BOM CSV files.
- Add strict native IPC validation, a new account-group migration, responsive report views, and desktop integration tests.

## 0.3.0 — 2026-07-13

- Parse and persist Japanese securities `assetbalance(all)_*.csv` snapshots separately from household transactions.
- Add investment asset allocation, positions, market value, cash, P&L, FX-rate, and snapshot-history views.
- Automatically discover and preview changed files in registered sync folders every 60 seconds.
- Add immutable source-record drill-down from transaction evidence.
- Add persisted, prioritized classification rules for merchant/description matching, categories, labels, and tags.
- Add safe rule preview/application with optimistic concurrency.
- Expand native schema migrations and platform validation for the new modules.

## 0.2.0 — 2026-07-12

- First runnable local-first desktop MVP for macOS and Windows.
- Added ledger dashboards, manual and file imports, budgets, goals, source provenance, backup/restore, and credit-card reconciliation.
