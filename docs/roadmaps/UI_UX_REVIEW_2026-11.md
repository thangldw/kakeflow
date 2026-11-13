# UI/UX review, 2026-11-13

Method: the browser demo runtime (`vite`, synthetic Tanaka-family data) was rendered with Playwright at 375, 768 and 1440 px in light and dark mode; Home was captured at all sizes, Budgets at 1440. DOM metrics were measured on Home. Contrast ratios use the nearest opaque background, so they are indicative and must be re-checked before changing tokens.

**Not seen:** the mobile drawer (the automated click did not open it), Transactions/Import on mobile (the capture fell back to Home), empty/error/loading states, keyboard-only walkthrough, the real Tauri window, largest text size. Findings below do not cover them.

## Must fix

1. **A fake desktop title bar is drawn in the browser demo** (`App.tsx` renders `DesktopTitleBar` whenever the runtime is not Tauri; `styles.css` `.desktop-titlebar` is fixed, 38 px, `z-index: 40`). At 375 px it covers the top bar, so the menu, search, New transaction and Import controls are clipped. Render it only in the real Tauri window, never at narrow widths.
2. **Tiny and low-contrast text.** 162 text nodes are under 12 px (9 to 11 px: group labels, badges, captions). Indicative contrast failures on Home: group label "メイン" 3.89:1 at 9.5 px, delta badge 2.86:1, "ブラウザプレビュー" 2.61:1 (light); "残高" badge 2.57:1 and a Home action detail 2.35:1 (dark). Set a 12 px floor and darken the muted text token.

## Should fix

3. **Touch targets.** Every measured control is under 44 x 44 px (sidebar items 36 px tall, icon buttons 28 to 34 px). Acceptable for a desktop pointer; raise to 44 px under the 980 px breakpoint.
4. **Home action list ("対応が必要な項目").** Four tall cards for four one-line items, a lone fourth card in a three-column grid, centred arrows, and in dark mode white outlines unlike the other cards. Use compact rows (priority badge, title, amount, due date, chevron), show three, link to all.
5. **Budget bars do not show overspending.** 食費 is "超過 20%" yet uses the same amber as the 89 to 96% rows. Use a distinct overspend colour and an overflow marker, keeping the text label so colour is not the only signal. The card also says 2026年7月 while the period is 2026年11月 (check whether this is demo-only data).
6. **Simulator forms on Budgets.** Raw numbers without separators or yen units ("1200000"), and the two panels' fields do not align. The new scenario panel on the forecast uses the same raw inputs and should follow whatever pattern is chosen.
7. **Mobile Home.** Four KPI cards stack full width (about 130 px each, over 500 px before other content); use a 2 x 2 grid. Template chips wrap mid-label ("資産・負債", "キャッシュフロー").
8. **Sub-currency block.** Label and select leave an awkward gap; amounts mix decimals ($324,303.8 and $6,329.11); show two decimals consistently.
9. **KPI numerals are monospace**, which clashes with the Japanese UI font; `font-variant-numeric: tabular-nums` on the UI font gives alignment without the code look.

## Nice to have

10. `:focus-visible` is defined (11 rules in `styles.css`, 1 in `ui-polish.css`) but there is no `prefers-reduced-motion` rule in any of the three stylesheets.

## Works well

Consistent token system and clear nav grouping with badges; one clear primary action colour; a coherent dark palette; no horizontal overflow at 375, 768 or 1440 px; no page errors; no unlabelled buttons among the measured controls.
