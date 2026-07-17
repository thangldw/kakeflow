# KakeFlow — Product and UX brief for Claude Design

> This document is the design source of truth for redesigning KakeFlow. The current application is a functional reference for information architecture and workflows, not a visual target that must be copied.

## 1. Product in one sentence

KakeFlow is a local-first desktop household-finance workspace for Japan that imports financial files and receipts, turns them into reviewable financial events, reconciles duplicate evidence and credit-card payments, posts only confirmed data to a double-entry household ledger, and presents trustworthy household and investment dashboards.

## 2. Product identity

- Product name: **KakeFlow**.
- Japanese concept: **家計簿**, expanded from a simple expense tracker into a household financial operating system.
- Primary market: households living in Japan.
- Primary language: Japanese.
- Additional supported languages: English and Vietnamese.
- Platforms: standalone desktop application for macOS and Windows.
- Technical shell: Tauri 2 with React and TypeScript; native data services are implemented in Rust.
- Data model: local-first. The desktop ledger is the system of record.
- Current repository version metadata: `1.0.0`.

## 3. Core user promise

KakeFlow should help a household answer five questions with evidence:

1. How much did we earn, spend, save, own, and owe?
2. Which source files and original records support those numbers?
3. Did the same purchase appear in a receipt, wallet export, card statement, and bank statement without being counted multiple times?
4. Are upcoming card payments covered by the mapped bank accounts?
5. How are investments performing separately from daily household spending?

The product should feel calm, reliable, understandable, and precise. It should not look like a trading terminal, an aggressive fintech sales page, or a playful gamified budgeting app.

## 4. Primary users

### Household operator

The person who imports files, resolves uncertain records, manages accounts, confirms transactions, creates rules, and prepares monthly reviews.

### Household reviewer

A spouse or family member who mainly checks spending, budgets, card obligations, goals, and monthly or annual reports.

### Finance power user

A user with several banks, cards, wallets, securities accounts, currencies, and large source files who needs dense tables, filters, bulk actions, reconciliation, audit lineage, and exports.

## 5. Non-negotiable financial semantics

The redesign may change the visual hierarchy, colors, typography, layout, and component styling. It must not change these rules.

### Confirmed ledger only

- Raw files and extracted candidates do not contribute to dashboard totals.
- Only posted, confirmed ledger transactions contribute to financial metrics.
- Unreviewed data must remain visibly separate from confirmed data.

### Credit-card purchases and payments

- A card purchase is an expense when the purchase occurs.
- The later bank debit paying the card bill is a transfer from a bank asset to a card liability.
- The bank debit affects cash flow but must not create a second expense.
- One statement payment can be partial, complete, overpaid, overdue, pending, or unmatched.

Example:

```text
Card purchases in statement       ¥60,000 expense
Bank debit paying statement       ¥60,000 cash outflow
Household expense shown once      ¥60,000
```

### Three accounting views

Every dashboard or metric must make its basis explicit:

| Basis | Meaning |
| --- | --- |
| Accrual / 発生ベース | Income and expense are recognized when the economic event occurs. |
| Cash flow / 資金移動ベース | Actual movement into and out of asset accounts. |
| Balance / 残高ベース | Assets, liabilities, and net worth at a point in time. |

### Investment separation

- Portfolio snapshots are not household spending transactions.
- `assetbalance(all)_*.csv` creates portfolio, position, cash, and FX snapshots.
- Market value, asset allocation, realized P&L, unrealized P&L, dividends, fees, and taxes belong to the investment workspace.
- Currencies remain separate unless the source provides a valid FX rate.

### Source lineage

Every confirmed number should be drillable through this chain when evidence exists:

```text
Dashboard metric
→ category / merchant / account breakdown
→ transaction
→ journal entries
→ source document and source row
→ original CSV / Excel / PDF page / receipt image
```

## 6. Data-processing model

```text
Local or synced folder / manual upload / receipt capture / test-user connector
→ immutable source document
→ adapter detection, parsing, extraction, or OCR
→ normalized candidates
→ duplicate, transfer, receipt, and statement matching
→ category, label, tag, and rule suggestions
→ explicit user review
→ balanced double-entry ledger
→ analytics views, dashboards, reports, and exports
```

Important distinction:

```text
Source row ≠ business event ≠ ledger transaction
```

One purchase can be supported by several records, such as a PayPay payment row, a points row, a credit-card statement row, and a receipt image. Those records should support one expense, not create four expenses.

## 7. Input sources

The interface must accommodate these source families without pretending that all files have the same structure:

- CSV and TSV.
- Excel XLSX.
- Text PDF, hybrid PDF, and scanned PDF.
- JPEG and PNG receipt images.
- ZIP batches.
- EML email attachments.
- Local folders and locally synchronized Google Drive, iCloud Drive, OneDrive, or NAS folders.
- Test-user Google Drive and Gmail connectors.
- Bank history, credit-card statements, PayPay history, Money Forward exports, receipts, and securities exports.
- Custom CSV/TSV mapping profiles for unsupported layouts.

Importing is always a review workflow. No newly discovered file should silently post transactions.

## 8. Information architecture

The desktop application currently has 11 top-level workspaces. The redesign should preserve this functional coverage, although closely related items may be grouped if every destination remains easy to reach.

| Workspace | Japanese label | Purpose |
| --- | --- | --- |
| Overview | ホーム | Household status, key metrics, actions, recent transactions, card obligations, and data quality. |
| Transactions | 取引 | Searchable confirmed ledger with filters, editing, bulk actions, evidence, and drill-down. |
| Import Inbox | インポート | File discovery, parsing preview, candidate review, mapping, matching, approval, errors, and rollback. |
| Capture Inbox | 撮影 Inbox | Mobile/receipt captures awaiting local OCR and promotion into Import Inbox. |
| Credit Cards | カード照合 | Statements, due dates, mapped bank accounts, payment reconciliation, and coverage. |
| Investments | 資産・投資 | Portfolio snapshots, holdings, prices, allocation, FIFO performance, and investment exports. |
| Calendar & Reports | カレンダー・レポート | Financial calendar, monthly review, annual review, forecasts, recurring/anomaly review, fixed costs, and exports. |
| Budgets & Goals | 予算・目標 | Monthly category budgets and savings goals. |
| Classification Rules | 分類ルール | Explainable merchant/description rules assigning categories, labels, and tags. |
| Family Space | 家族スペース | Household members, ownership, shared/personal organization, and explicit data-delivery review. |
| Settings | 設定 | Accounts, categories, local preferences, backup/restore, folders, and connectors. |

## 9. Global application shell

### Persistent navigation

- Product logo and `kakeflow` wordmark.
- Active household and household selector.
- Primary workspace navigation.
- Local/desktop state indicator.
- Settings access.

### Global controls

Controls should appear only when relevant to the current workspace:

- Household.
- Account group or account scope.
- Household-wide, common, or member attribution scope.
- Month, year, statement period, or custom date range.
- Accounting basis.
- Language: `日本語`, `English`, `Tiếng Việt`.
- Theme and density where appropriate.

The language selector must be visible and discoverable, but it should not dominate the top bar.

## 10. Screen requirements

### 10.1 Overview / Home

The Home screen is a decision surface, not merely a collection of charts.

Required content:

- Net worth.
- Current-month income.
- Current-month expense.
- Expected savings and savings rate.
- Action Center with the most urgent review, payment, import, or budget items.
- Income and expense trend.
- Category spending breakdown.
- Recent confirmed transactions.
- Credit-card payment summary.
- Data-quality and source-freshness summary.

Five truthful dashboard templates exist:

1. Financial Overview.
2. Household Ledger.
3. Assets & Liabilities.
4. Card Reconciliation.
5. Cash Flow.

Users can select a template, light/dark/system theme, comfortable/compact density, and independently arrange widgets per template. A widget must preserve the metric basis and drill-down behavior when moved.

### 10.2 Transactions

Required capabilities:

- Search by merchant, description, account, or source text.
- Filter by period, account group, family attribution, accounting basis, calculation target, category, label, and tag.
- Clear income, expense, transfer, card purchase, card payment, refund, fee, interest, and adjustment semantics.
- Bulk category, label, tag, and calculation-target editing.
- Split transaction support.
- Evidence and audit-history access.
- Drill-down to balanced journal entries and original source.
- CSV, XLSX, and PDF export for the selected validated scope.

Dense tabular information is expected, but the primary amount, transaction type, review state, account, and evidence status must remain scannable.

### 10.3 Import Inbox

This is the most important operational workflow.

Required stages:

```text
Discovered
→ extracting
→ preview ready
→ mapping required
→ review required
→ ready to post
→ posted / rolled back / failed / ignored
```

Required UI:

- Source filename, provider, type, received time, row count, and processing status.
- Detected adapter and confidence or explicit unsupported state.
- Required target-account mapping.
- Candidate list with original description, date, amount, account, category, labels, tags, and calculation target.
- Duplicate, transfer, receipt match, and card-payment suggestions with reasons.
- Row-level warnings and blocking errors.
- Accept, edit, exclude, match, retry, ignore, rollback, and commit actions.
- Original-source viewer beside or near the candidate being reviewed.
- Strong separation between high-confidence suggestions and irreversible confirmation.

### 10.4 Source viewer

The viewer must support:

- Original CSV or Excel row and surrounding context.
- PDF page with extracted bounding boxes.
- Receipt image with OCR overlays.
- Raw and normalized values.
- Parser/OCR confidence and provenance.
- Linked transaction or candidate.

The original evidence is immutable. Editing normalized data must never visually imply that the source itself changed.

### 10.5 Capture Inbox

- Large, uncropped receipt preview.
- Capture metadata and family audience.
- Duplicate status.
- OCR availability and progress.
- Promote to Import Inbox, retry, or discard controls.
- Clear statement that capture and OCR do not post an expense automatically.

### 10.6 Credit Cards

Each card should expose:

- Card name and masked identifier.
- Statement period and statement amount.
- Confirmed due date.
- Mapped payment bank account.
- Expected debit and confirmed bank debits.
- Payment progress.
- Coverage or shortfall.
- Reconciliation status.
- Itemized purchases, refunds, fees, interest, and credits.

Core statuses:

```text
Payment pending
Possible match
Partially paid
Fully reconciled
Amount mismatch
Overpaid
Overdue
Unmatched bank debit
```

Never use color as the only way to communicate a reconciliation status.

### 10.7 Investments

Required content:

- Selected portfolio snapshot and as-of date.
- Total market value and cash value.
- Asset allocation.
- Positions with quantity, average cost, current/source price, market value, currency, and unrealized P&L.
- Snapshot-local FX rates and missing-data disclosure.
- Realized performance by year and source currency.
- FIFO lots, dividends, fees, taxes, corporate actions, and exceptions.
- Snapshot history and price history.
- CSV, XLSX, and PDF exports.

Do not merge household cash-flow charts and portfolio valuation into one ambiguous metric.

### 10.8 Calendar and Reports

Subviews:

- Calendar.
- Monthly report.
- Annual review.
- Forecast and actions.
- Recurring and anomaly review.
- Fixed-cost review.
- Account groups and export.

The monthly and annual reviews should feel like a professional Japanese household book: planned versus actual, weekly or monthly rhythm, category drivers, no-spend days only when coverage is trustworthy, memo/action areas, and a clear closing summary.

### 10.9 Budgets and Goals

- Budget versus actual by category.
- Remaining budget and variance.
- Savings goals with target amount, target date, current progress, and required pace.
- Clear distinction between a planned value and a confirmed ledger value.

### 10.10 Classification Rules

Each rule contains:

- Rule name.
- Merchant-name condition.
- Optional description condition.
- Destination category.
- Labels.
- Tags.
- Numeric priority.
- Enabled/disabled state.

Rules are deterministic and explainable. The interface should show why a rule matched and allow the user to create a rule from a corrected candidate.

### 10.11 Family Space

- Household members and archived-member history.
- Account ownership: household or a specific member.
- Shared/personal organization labels.
- Transaction attribution: household-common or a member.
- Source-document audience independent from transaction attribution.
- Explicit send, receive, conflict review, and atomic Apply workflows.

`Personal` is an organization label in the local application; it must not be presented as a guarantee that another user of the same computer cannot access the data.

## 11. Core domain vocabulary

Use these concepts consistently in navigation, headings, forms, filters, statuses, and help text.

| Concept | Meaning |
| --- | --- |
| Source document | Immutable original file or image. |
| Source record | One original row, page region, or extracted record with provenance. |
| Candidate | Normalized but unposted financial data awaiting review. |
| Transaction | Confirmed business event. |
| Journal entry | Debit/credit effect on ledger accounts. |
| Evidence | Source material supporting a candidate or transaction. |
| Account | Asset, liability, income, expense, or equity ledger account. |
| Account group | Saved analytical scope; not a new account. |
| Category | Primary accounting/budget classification. |
| Label | Workflow or semantic state such as recurring or reimbursable. |
| Tag | Flexible multi-dimensional metadata such as family member or trip. |
| Statement | Credit-card billing cycle and obligation. |
| Card payment | Bank-to-card-liability settlement, not an expense. |
| Portfolio snapshot | Securities balance at a specific time, separate from spending. |
| Calculation target | Whether a posted transaction contributes to household analytics; account balance still remains truthful. |

## 12. Metric contract

| Metric | Definition |
| --- | --- |
| Accrual expense | Debits to expense accounts from posted expense-like transactions, excluding card settlements and transfers. |
| Accrual income | Credits to income accounts from posted transactions, excluding transfers. |
| Cash inflow/outflow | Posted movement into or out of selected asset accounts. |
| Savings | Accrual income minus accrual expense for the selected period. |
| Savings rate | Savings divided by income; undefined when income is zero. |
| Net worth | Asset balances plus portfolio market value minus liability balances at the selected date. |
| Budget variance | Actual accrual expense minus persisted monthly budget. |

Metrics must display selected period, scope, basis, freshness, and incomplete-data caveats where relevant.

## 13. Localization and typography

### Language behavior

- First-run language and untranslated domain fallback: Japanese.
- User can switch from the desktop top bar between Japanese, English, and Vietnamese.
- Account names, merchant names, tags, filenames, and imported source text are never translated.
- Dates use locale-appropriate formatting; financial periods remain semantically identical.
- All new shared interface copy should be authored in Japanese and reviewed in English and Vietnamese.

### Typography requirements

- Use a system-first, highly readable sans-serif stack.
- Current stack: Inter when installed, then platform UI fonts, `Noto Sans JP`, `Hiragino Sans`, `Yu Gothic UI`, and `Meiryo`.
- Japanese glyph quality is more important than using a distinctive Latin display font.
- Use tabular lining numerals for financial values and aligned tables.
- Monospace is reserved for source records, hashes, identifiers, and technical evidence.
- Avoid extra-light weights, tiny gray text, and condensed type for primary financial information.

## 14. Interaction principles

- **Review before posting:** suggestions must not look already confirmed.
- **Explain every automation:** show matched rule, match reason, confidence, or reconciliation evidence.
- **Progressive disclosure:** show household outcomes first, accounting and provenance detail on demand.
- **Dense but calm:** professional tables may be dense; dashboard cards should not compete for attention.
- **Drill-down everywhere:** a financial total should lead to the records behind it.
- **Reversible work:** import runs, matches, edits, and rule effects should expose undo or correction paths where supported.
- **No false completeness:** missing source periods, unmapped cards, missing prices, OCR uncertainty, and pending candidates remain visible.
- **No color-only meaning:** use text, icons, and status labels with color.
- **Destructive actions are explicit:** deleting, ignoring, replacing, or rolling back requires unmistakable copy and hierarchy.

## 15. Required states for every major screen

Design at least these states, not only the ideal populated state:

- First run or no data.
- Loading.
- Populated and healthy.
- Partial or stale data.
- Review required.
- Blocking validation error.
- Non-blocking warning.
- Empty filtered result.
- Desktop capability unavailable in browser preview.
- Long Japanese names, large JPY values, negative values, and mixed JPY/USD values.

## 16. Accessibility and desktop behavior

- Minimum supported window: approximately `1024 × 720`; recommended design viewport: `1440 × 900`.
- The desktop shell must remain useful at `1280 × 800` and high-DPI scaling from 125% to 200%.
- Reflow widgets and tables; do not shrink all typography to fit.
- Provide visible keyboard focus.
- Use semantic labels for icon-only controls.
- Preserve logical focus order in dense review forms.
- Use sufficient contrast in both light and dark themes.
- Charts require text summaries, legends, exact-value tooltips, and accessible tables or drill-downs.
- Amount columns should align consistently and preserve minus signs and currencies.

## 17. Visual direction boundaries

Claude Design may propose a new visual system. It is not required to retain the current warm-paper and olive palette.

However, the redesign should remain:

- Calm rather than flashy.
- Trustworthy rather than promotional.
- Warm enough for a household product but precise enough for financial review.
- Suitable for Japanese typography and information density.
- Clear about status, evidence, and incomplete data.
- Consistent across dashboard cards, tables, review queues, reports, and source viewers.

Avoid:

- Trading-app neon colors and black terminal aesthetics as the default.
- Large decorative gradients that reduce table readability.
- Excessive rounded cards around every row.
- Many unrelated accent colors.
- Oversized marketing typography inside operational screens.
- Pie charts with too many categories.
- Hiding essential filters in hover-only interactions.
- Using green for both income and generic success if that causes ambiguity.
- Treating a low-confidence suggestion as a completed action.

## 18. Recommended semantic color roles

The exact palette may change, but define stable roles before styling screens:

- Canvas and elevated surface.
- Primary text and secondary text.
- Hairline border and stronger divider.
- Primary action.
- Selected navigation.
- Income.
- Expense.
- Asset.
- Liability.
- Confirmed/success.
- Review required.
- Warning.
- Error/destructive.
- Informational/accent.
- Chart categorical sequence with sufficient contrast.

One color must keep the same financial meaning across every screen.

## 19. Realistic sample data for mockups

Use Japanese household data rather than generic lorem ipsum.

```text
Household: 田中家
Selected period: 2026年7月
Net worth: ¥8,246,320
Monthly income: ¥652,800
Monthly expense: ¥267,990
Expected savings: ¥384,810
Savings rate: 58.9%

Recent transactions:
- 成城石井 / 食費 / PayPay / −¥4,280
- 東京電力 / 住居・光熱 / MUFG / −¥8,640
- JR EAST / 交通 / Rakuten Card / −¥5,000
- 給与振込 / 収入 / MUFG / +¥426,800

Card statements:
- Rakuten Card / statement ¥204,987 / bank debit ¥204,987 / fully reconciled
- Amazon Mastercard / statement ¥20,170 / bank debit pending

Import state:
- 42 records imported
- 31 automatically classified
- 6 possible duplicates
- 3 possible transfers
- 2 low-confidence OCR candidates
```

## 20. Current implementation references

Use these repository assets to understand existing scope and information density:

- Overview screenshot: [`docs/assets/screenshots/kakeflow-overview.png`](assets/screenshots/kakeflow-overview.png)
- Import Inbox screenshot: [`docs/assets/screenshots/kakeflow-import-inbox.png`](assets/screenshots/kakeflow-import-inbox.png)
- Transactions screenshot: [`docs/assets/screenshots/kakeflow-transactions.png`](assets/screenshots/kakeflow-transactions.png)
- Recent typography audit: [`docs/audits/typography-2026-07-15/AUDIT.md`](audits/typography-2026-07-15/AUDIT.md)
- Recent rule-builder audit: [`docs/audits/rule-builder-2026-07-16/AUDIT.md`](audits/rule-builder-2026-07-16/AUDIT.md)
- Metric definitions: [`docs/METRICS.md`](METRICS.md)
- Localization policy: [`docs/LOCALIZATION.md`](LOCALIZATION.md)
- Current project status: [`docs/PROJECT_STATUS_2026-07-15.md`](PROJECT_STATUS_2026-07-15.md)
- Current application UI: `src/App.tsx` and `src/styles.css`.

## 21. Design deliverables requested from Claude Design

Create a coherent desktop design system and high-fidelity screens for:

1. Global application shell, navigation, household selector, filters, and language switching.
2. Overview in all five dashboard-template modes.
3. Transaction ledger and transaction/evidence detail.
4. Import Inbox list, candidate review, source viewer, matching, and blocking-error states.
5. Credit-card reconciliation and bank-coverage detail.
6. Investment portfolio overview and position/performance detail.
7. Calendar, monthly review, and annual review.
8. Budgets and savings goals.
9. Classification Rules.
10. Family Space.
11. Settings and account management.
12. Light and dark themes.
13. Japanese primary layouts plus representative English and Vietnamese localization stress tests.
14. Empty, loading, stale, review-required, error, and populated states.

For each major screen, specify:

- Grid and dimensions.
- Component hierarchy.
- Typography tokens.
- Semantic color tokens.
- Spacing, radius, border, and elevation tokens.
- Interaction states.
- Table and chart behavior.
- Keyboard and accessibility considerations.
- Responsive behavior at 1024, 1280, 1440, and 1920 pixel widths.

## 22. Acceptance criteria for the redesign

A proposal is successful when:

- A Japanese household user can identify current financial status and urgent actions within a few seconds.
- Import review clearly distinguishes source evidence, suggestions, warnings, and confirmed actions.
- Card purchases and later bank settlements cannot be visually mistaken for two expenses.
- Portfolio values are clearly separated from household income and expense.
- Every major total exposes period, scope, accounting basis, and drill-down.
- Data incompleteness is visible without overwhelming healthy screens.
- Dense workflows remain readable at desktop sizes and with Japanese text.
- Japanese, English, and Vietnamese fit without broken navigation or truncated critical labels.
- Light and dark themes preserve the same semantic meanings.
- The design can be implemented with React components and Lucide icons without decorative placeholder assets.

## 23. Final instruction to Claude Design

Redesign the product as a complete, internally consistent desktop system. Preserve KakeFlow's accounting semantics, evidence-first import workflow, information architecture, and user-confirmation boundaries. The current UI may be reorganized and visually replaced, but do not remove operational states or simplify away source lineage, data quality, reconciliation, accounting basis, or review requirements.
