# Investment history date-range control — 2026-07-16

## Evidence

- Source visual truth: user screenshot `codex-clipboard-6710644d-bcf1-43f2-8b5c-8c2dc6cb4e55.png`.
- Before: `00-before.png`.
- Implementation: `01-after.png`.
- Focused implementation: `01-after-focused.png`.
- Side-by-side comparison: `comparison.png`.
- Viewport: 1440 × 900, light theme, Japanese locale, Assets & investments.

## Findings and fix

- P2: native date fields had a heavy asymmetric border, narrow width and inconsistent height beside the action.
- Fix: placed the fields in a bordered filter bar, normalized both inputs to 38 px, used full four-sided borders, aligned labels and action, and promoted Apply to the navy primary action.
- Responsive behavior: two-column fields plus full-width action below 720 px; single-column stack below 480 px.
- Dark theme: the same structure uses dark surface and calendar color-scheme tokens.

## Required fidelity surfaces

- Typography: existing KakeFlow UI stack and 10/11 px control hierarchy retained.
- Spacing: 10 px grid gap, 12 × 14 px container padding and aligned control baselines.
- Color: gray canvas/surface tokens and navy primary action match the Claude Design system.
- Image/assets: no raster asset is present or required; the native calendar affordance remains sharp and platform-correct.
- Copy: Japanese labels and action text are unchanged.

## Verification

- Entered `2026-06-01` through `2026-07-31` and applied the range successfully.
- Browser console reported no errors.
- ESLint, production build and two focused component tests passed.

No actionable P0, P1 or P2 issue remains.

final result: passed
