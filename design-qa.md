# KakeFlow v2 — Design QA

## 2026-07-17 focused correction pass

- Scope: visible card identity, workspace horizontal clipping around a 1280px desktop window, and hidden native topbar controls entering the keyboard focus order.
- Reference: `design_handoff_kakeflow_v2/screenshots/06-credit-cards.png`.
- Implementation state: browser preview, light theme, July 2026, 1280 × 720 CSS pixels at DPR 2.
- Card identity: every reconciliation card exposes a visible semantic heading plus masked identifier and statement period. The decorative card surface removed by the v2 handoff is no longer the only source of identity.
- Responsive result: `main.clientWidth === main.scrollWidth === 1048`; `.workspace-content` measured 1004px wide with its right edge at 1258px inside the 1280px viewport.
- Keyboard result: the native month/account/family fallback controls are `hidden`, `aria-hidden="true"`, and have no visible element with `tabIndex >= 0`. The visible popover and period controls remain operable.
- Runtime result: both Rakuten Card / `•••• 8106` and PayPayカード / `•••• 2841` were visible; the Browser console contained only Vite/React development messages and no application error or warning.

Focused evidence:

- `tmp/design-qa-2026-07-17/01-home-responsive-fixed.png`
- `tmp/design-qa-2026-07-17/03-card-reconciliation-fixed.png`
- `tmp/design-qa-2026-07-17/card-comparison.png` — handoff and implementation in the same comparison frame.

## Visual truth

- Source of truth: `design_handoff_kakeflow_v2/README.md`, `IA_MAPPING.md`, `P1_SPECS.md`, `VISUAL_QA.md` and all 33 handoff screenshots.
- Reviewed reference screens: Home, Transactions detail, Capture Inbox, Calendar/Reports, and Settings connectors/profiles.
- Implementation: `http://127.0.0.1:1420/` in the in-app Browser, light theme, July 2026.
- Primary viewport: 1440 × 900 at DPR 1. The handoff images are 914 × 540 exports of the same desktop composition, so comparison used normalized shell geometry and component hierarchy rather than raw pixel dimensions.
- Responsive safety check: 1100 × 700 produced no horizontal overflow (`scrollWidth === innerWidth`).

## Comparison evidence

- Home source and implementation were emitted together in one comparison pass. Shell, 232px sidebar, title bar, workspace header, warm canvas, KPI hierarchy, action center, chart rhythm, type scale, borders, radii, and semantic colors align with the source.
- Capture source and implementation were emitted together after the final connector-placement fix. The production Capture page now contains only local JPEG/PNG/PDF intake, watched-folder routing, explicit OCR/promotion states, and the no-auto-posting gate. Mobile relay credentials are absent from this page.
- Settings source and implementation were emitted together with the connector disclosure open. Drive, Gmail, iCloud, and the mobile-to-desktop relay are grouped under Settings as specified by the information architecture.
- The reported broken account-group form and the corrected implementation were emitted together at the same 1740 × 672 viewport. The corrected form measures 659px / 180px / 101px for name, kind, and CTA; all controls are 38px high, the export panel remains a separate column, and the document has no horizontal overflow.
- Transaction list geometry and semantics match the handoff: selection column, date, description, category, account, type, amount, evidence, type filters, advanced filter disclosure, neutral transfer/card-payment styling, and tabular amounts. The new copy contract uses `＋ 手入力取引`, `手入力取引（複式）`, `貸借差額`, and `転記`; native detail, split, manual-posting, and source-evidence behavior are covered by desktop integration tests.
- Phase-3 surfaces were audited against screenshots 27–33: dashboard layout edit, manual entry, advanced filters, duplicate resolution, card actions, Capture OCR cards, and Settings connector/sync diagnostics. The compact dedup labels retain detailed accessible names, while card actions focus or invoke their existing native mapping/due-date/unlink operations.
- The evidence viewer now uses the handoff’s full-screen three-column workspace: page thumbnails at left, original/overlay canvas in the center, and extracted/normalized regions with confidence at right. Protected-PDF retry, SHA lineage, receipt normalization, and raw text remain intact.
- Runtime sample rows and empty states differ from the static handoff fixtures, but layout, hierarchy, interaction gates, and state semantics remain equivalent.

Implementation captures:

- `tmp/design-qa-v2/home-implementation.png`
- `tmp/design-qa-v2/transactions-detail-implementation.png`
- `tmp/design-qa-v2/capture-implementation.png`
- `tmp/design-qa-v2/settings-connectors-implementation.png`
- `tmp/design-qa/account-group-form-fixed.png`
- `tmp/design-qa/account-group-form-fixed-1740x672.png`
- `tmp/qa-tx-advanced-filter.png`
- `tmp/qa-compare-tx-advanced-filter.png`

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
- Replaced the inline manual-entry form with the handoff’s centered two-column double-entry dialog and explicit `貸借差額 ¥0 ✓` completion gate.
- Aligned Reports analysis labels, rescue-dialog title/CTA, compact dedup decisions, card footer actions, Capture OCR card density, and the evidence viewer’s three-column hierarchy with screenshots 16–33.
- Kept OCR and promotion as separate user actions so receipt intake never posts directly to the ledger.
- Preserved the implemented deduplication workflow and aligned its review states with the v2 Import master-detail layout.
- Corrected account-group grid placement so an empty account list cannot push the primary CTA into the flexible name column; added explicit desktop placement, matched control sizing/focus treatment, and a mobile reset.

## Regression checks

- `npm run lint`: passed.
- `npm run build`: passed. Vite still reports the known large offline OCR/ONNX resource chunks; this pass did not add to those assets.
- `npm test`: 106 files / 721 tests passed.
- Focused application tests: 2 files / 117 tests passed.
- Packaged macOS smoke: passed (11 visible pages, 12 interactions, IPC, schema v68); the rebuilt ad-hoc-signed app passed `codesign --verify --deep --strict` and launched from `/Applications/KakeFlow.app`.
- `git diff --check`: passed.
- Rust: `cargo fmt --all -- --check` passed; clippy passed with `-D warnings`; 610 library tests and 30 native integration tests passed, including migrations 0066–0068 and schema-v3 compatibility.
- PDF release QA: all five v1.0.0 fixture families rendered to 19 PNG pages; every page was inspected and the review checklist was signed `PASS` on 2026-07-17.

Feature coverage and the bidirectional design/implementation inventory are tracked in `docs/UI_UX_GAP_ANALYSIS.md` and `design_handoff_kakeflow_v2/UI_UX_GAP_ANALYSIS.md`.

final result: passed
