# Shared date and month control system — 2026-07-16

## Scope

Eight native date/month controls were audited:

1. Topbar month selector.
2. Transaction detail date.
3. Manual transaction date.
4. Missing card due-date editor.
5. Card statement due-date editor.
6. Savings-goal target date.
7. Investment-history start date.
8. Investment-history end date.

## Evidence

- Source visual truth: user screenshot `codex-clipboard-6710644d-bcf1-43f2-8b5c-8c2dc6cb4e55.png`.
- Light implementation: `01-light-assets.png`.
- Dark implementation: `02-dark-assets.png`.
- Keyboard/mouse focus state: `03-focus-state.png`.
- Focused implementation crop: `04-focused-date-range.png`.
- Side-by-side comparison: `comparison.png`.
- Viewport: 1440 × 900, Japanese locale.

## Findings and fixes

- P2: date/month controls used fragmented context rules; only investment history had a complete border, focus and dark-mode treatment.
- P2: an older olive `:focus` rule could override the redesigned navy `:focus-visible` treatment.
- Fix: introduced one native date/month foundation with tabular numerals, full borders, shared hover/focus, calendar-indicator behavior and dark `color-scheme`.
- Fix: preserved intentional variants: 30 px month selector in the topbar, 36 px card due-date controls and 38 px content-form controls.
- Fix: aligned form and due-date action heights with their neighboring date inputs.

## Required fidelity surfaces

- Typography: Noto/system UI stack, 11 px control text and tabular date numerals.
- Spacing: shared 10 px horizontal padding, 6 px radius and context-aware height tokens.
- Colors: gray paper surfaces, full neutral border and navy focus treatment; no legacy olive focus remains.
- Image/assets: native calendar indicators retained; no replacement raster or custom SVG was required.
- Copy: existing Japanese labels and accessible names were preserved.

## Verification

- Light and dark assets screens rendered without clipping or browser console errors.
- Start/end dates accepted valid values and Apply completed.
- ESLint and production build passed.
- 112 focused application and component tests passed.
- Desktop-only transaction, card and goal controls share the same selector contract; their existing accessibility labels and workflows remain covered by `App.desktop.test.tsx`.

No actionable P0, P1 or P2 issue remains.

final result: passed
