# KakeFlow — product and UX brief

This brief gives external design tools enough context to extend KakeFlow without breaking its accounting, evidence, or local-first boundaries. The canonical visual specification is the [KakeFlow v2 handoff](../design_handoff_kakeflow_v2/README.md).

## Product

KakeFlow is a desktop household-finance workspace for Japan. Users bring their own bank, card, wallet, brokerage, spreadsheet, PDF, email, folder, and receipt sources. KakeFlow preserves originals, extracts review candidates, requires explicit approval, and posts balanced ledger entries locally.

Primary users need to answer:

- What did the household earn, spend, save, own, and owe?
- Which numbers are confirmed, missing, stale, partial, or forecast?
- Has a card purchase already been counted, and was the liability settled?
- Can every displayed value be traced back to source evidence?
- What needs review or action now?

## Non-negotiable product rules

1. Only posted ledger facts enter metrics.
2. A card purchase is expense; its later bank settlement is not expense again.
3. Import, OCR, connectors, classification, deduplication, and family delivery never auto-post.
4. Missing or ambiguous data fails closed and remains visible.
5. Accrual, cash flow, and balance are different bases and must be labeled.
6. Source document, source row, business event, transaction, and journal entry are distinct records.
7. Investment currencies remain separate unless a dated source-backed conversion exists.
8. Ownership, attribution, and delivery audience are separate concepts.
9. Color never carries status alone.
10. Local-first does not imply cloud account, hosted identity, or automatic synchronization.

## Information architecture

The desktop keeps 11 workspaces:

1. Home
2. Transactions
3. Import
4. Capture Inbox
5. Card reconciliation
6. Investments
7. Calendar & Reports
8. Budgets & Goals
9. Classification Rules
10. Family Space
11. Settings

Do not add a top-level workspace for a low-frequency feature. Place daily work in a toolbar/tab, occasional work in a panel, and configuration in Settings. See [IA mapping](../design_handoff_kakeflow_v2/IA_MAPPING.md).

## Global shell

- Platform-aware title bar and 232px desktop sidebar.
- Household selector, grouped navigation, actionable badges, and local-desktop status.
- Workspace header with scope and period controls.
- Accounting-basis selector only where the content supports it.
- Language, theme, and density only in Settings.
- Minimum desktop width around 1024px without shrinking text below readable size.

## Core workspace requirements

### Home

Use a calm financial overview: source-qualified KPIs, Action Center, trend, category composition, recent confirmed transactions, card status, and data quality. Layout editing changes order/visibility only and always leaves one widget visible.

### Transactions

Provide search, types, advanced filters, bulk actions, exports, balanced manual entry, detail/split editing, attribution, and evidence chain. Right-align tabular amounts. Transfers/card settlements remain neutral and explain why they are excluded from expense.

### Import and Capture

Import is master-detail review with clear lifecycle, source preview, mapping, candidate table, blocking issues, dedup decisions, classification suggestions, commit, and rollback. Capture separates receipt arrival, local OCR, promotion, matching, and posting into visible steps.

### Cards

Show card name, masked identity, period, bank mapping, statement total, confirmed payment, difference, coverage, due date, and action history. The UI can link or unlink posted facts but never initiate payment.

### Investments

Keep portfolio snapshots, market valuation, FIFO realized performance, FX, trends, and aggregate asset history separate by grain. Never auto-switch an explicitly selected snapshot. Render absent prices as `NULL`.

### Reports

Calendar, monthly/annual review, forecast/actions, recurring/anomaly, and fixed-cost views all reuse canonical read models. Forecast and partial coverage require prominent disclosures.

### Family and Settings

Family Space reviews send/receive artifacts, audience partitions, conflicts, and Apply. Settings owns accounts, preferences, backups, connectors, relays, parser profiles, and diagnostics. Secrets must not appear in screenshots, logs, or UI copy.

## Visual direction

- Warm paper canvas with restrained white surfaces.
- Olive brand identity; cobalt for interaction/focus; green for income/success; orange for expense/warning; red for errors only.
- Compact desktop density, clear visual hierarchy, low visual noise.
- Noto Sans JP/system Japanese UI with tabular numerals; monospace for IDs, hashes, dates, and source rows.
- Rounded cards and controls, thin neutral borders, accessible focus rings.
- Charts and diagrams use direct labels, source/disclosure notes, and adjacent numeric equivalents when needed.

Use the exact token table and workspace specifications in the [handoff README](../design_handoff_kakeflow_v2/README.md).

## Required states

Every relevant surface needs loading, empty, partial, stale, review-required, blocking error, success, retry, and disabled states. Avoid optimistic success before native confirmation. Preserve the user's selection and show a recoverable path after failure.

## Accessibility and localization

- Keyboard access for all actions, logical DOM/read order, visible focus, Escape handling, and focus return.
- Icon-only controls require accessible names.
- Status uses icon + text and sufficient contrast in light/dark themes.
- Japanese is primary; English and Vietnamese are supported.
- Merchant, account, filename, imported content, IDs, and evidence are never translated.

## Deliverables

Design work should include:

- affected workspace and responsive state;
- normal, empty, loading, blocking, and recovery states;
- keyboard/focus behavior;
- exact copy and localization implications;
- accounting/evidence disclosures;
- handoff notes mapping UI actions to existing product contracts.

Reference screenshots live under `design_handoff_kakeflow_v2/screenshots/`. Current product screenshots live under `docs/assets/screenshots/`. Dated material under `docs/audits/` is historical evidence, not the current specification.
