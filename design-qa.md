# KakeFlow v2 — Design QA

## Visual truth

- Source of truth: `design_handoff_kakeflow_v2/README.md`, `IA_MAPPING.md`, `P1_SPECS.md`, `VISUAL_QA.md` and the 26 handoff screenshots.
- Reviewed reference screens: Home, Transactions detail, Capture Inbox, Calendar/Reports, and Settings connectors/profiles.
- Implementation: `http://127.0.0.1:1420/` in the in-app Browser, light theme, July 2026.
- Primary viewport: 1440 × 900 at DPR 1. The handoff images are 914 × 540 exports of the same desktop composition, so comparison used normalized shell geometry and component hierarchy rather than raw pixel dimensions.
- Responsive safety check: 1100 × 700 produced no horizontal overflow (`scrollWidth === innerWidth`).

## Comparison evidence

- Home source and implementation were emitted together in one comparison pass. Shell, 232px sidebar, title bar, workspace header, warm canvas, KPI hierarchy, action center, chart rhythm, type scale, borders, radii, and semantic colors align with the source.
- Capture source and implementation were emitted together after the final connector-placement fix. The production Capture page now contains only local JPEG/PNG/PDF intake, watched-folder routing, explicit OCR/promotion states, and the no-auto-posting gate. Mobile relay credentials are absent from this page.
- Settings source and implementation were emitted together with the connector disclosure open. Drive, Gmail, iCloud, and the mobile-to-desktop relay are grouped under Settings as specified by the information architecture.
- The reported broken account-group form and the corrected implementation were emitted together at the same 1740 × 672 viewport. The corrected form measures 659px / 180px / 101px for name, kind, and CTA; all controls are 38px high, the export panel remains a separate column, and the document has no horizontal overflow.
- Transaction list geometry and semantics match the handoff: selection column, date, description, category, account, type, amount, evidence, type filters, advanced filters, neutral transfer/card-payment styling, and tabular amounts. The native detail drawer, split editor, and source-evidence workflow are covered by desktop integration tests; the Browser preview cannot invoke that native detail command.
- Runtime sample rows and empty states differ from the static handoff fixtures, but layout, hierarchy, interaction gates, and state semantics remain equivalent.

Implementation captures:

- `tmp/design-qa-v2/home-implementation.png`
- `tmp/design-qa-v2/transactions-detail-implementation.png`
- `tmp/design-qa-v2/capture-implementation.png`
- `tmp/design-qa-v2/settings-connectors-implementation.png`
- `tmp/design-qa/account-group-form-fixed.png`
- `tmp/design-qa/account-group-form-fixed-1740x672.png`

## Required fidelity surfaces

- Dashboard: loading skeleton, first-run empty state, six-month trend, configurable templates, drag/drop, show/hide tray, reset/cancel/done.
- Transactions: real CSV/XLSX/PDF exports, type and advanced filters, removable chips, bulk category/calculation/attribution/label/tag actions, centered balanced double-entry dialog, right-side detail drawer, split editor, and explicit disabled balance basis.
- Reports: Calendar, monthly/annual review, analysis/forecast, durable monthly memo, exports, recurring-series review, and fixed-cost drill-down.
- Investments: portfolio snapshot, FIFO realized P/L, FX summary, valuation history, aggregate history without interpolation, and instrument history.
- Import and deduplication: Local/Connectors tabs, production master-detail review, exact/probable duplicate gates, rescue flows, immutable evidence, protected PDF handling, connector inboxes, rollback, and no automatic ledger posting.
- Capture: local encrypted original intake, source hash, OCR progress/confidence, explicit promotion to Import Inbox, watched folder, durable discard, and live sidebar badge.
- Cards, Family, Settings, and evidence: eight reconciliation states, receive/send/snapshot/change/evidence flows, progressive disclosures, connector and parser configuration, account-group export, and full-screen evidence overlay.

## Interaction QA

- Exercised Home → Transactions → Capture Inbox → Settings navigation in the Browser.
- Verified Capture exposes the local picker and watched-folder controls and does not expose the mobile relay token.
- Opened Settings connectors and verified the mobile relay token, interval, disabled enable gate, and connector truth-copy are present there.
- Opened Settings → Account groups/Export and verified the creation form, empty state, export column, control alignment, and responsive one-column fallback. Browser console contained no application errors or warnings.
- Verified transaction type filters, export actions, advanced-filter disclosure, table semantics, disabled balance control, and row focus state.
- Desktop tests verify the native transaction detail drawer, balanced corrections, source evidence, bulk changes, import review/post/rollback, monthly memo persistence, Capture discard, and connector behavior.
- Browser console contained no application errors or warnings in the final reviewed state.

## Iteration history

- Moved mobile relay credentials and background polling out of production Capture and into Settings → Connectors.
- Replaced the inline manual-entry form with the handoff’s centered two-column double-entry dialog and explicit `残り ¥0 ✓` completion gate.
- Kept OCR and promotion as separate user actions so receipt intake never posts directly to the ledger.
- Preserved the implemented deduplication workflow and aligned its review states with the v2 Import master-detail layout.
- Corrected account-group grid placement so an empty account list cannot push the primary CTA into the flexible name column; added explicit desktop placement, matched control sizing/focus treatment, and a mobile reset.

## Regression checks

- `npm run lint`: passed.
- `npm run build`: passed. Functional/vendor chunking reduced the main production chunk from about 1.07 MB to 312.63 kB; no chunk exceeds Vite's 500 kB warning threshold.
- `npm test -- --run`: 104 files / 705 tests passed without React `act(...)` warnings.
- `git diff --check`: passed.
- Rust: `cargo fmt --all -- --check` passed; clippy passed with `-D warnings`; 610 library tests and 30 native integration tests passed, including migrations 0066–0068 and schema-v3 compatibility.
- PDF release QA: all five v1.1.0 fixture families rendered to 19 PNG pages; every page was inspected and the review checklist was signed `PASS` on 2026-07-17.

Feature coverage and the bidirectional design/implementation inventory are tracked in `docs/UI_UX_GAP_ANALYSIS.md` and `design_handoff_kakeflow_v2/UI_UX_GAP_ANALYSIS.md`.

final result: passed
