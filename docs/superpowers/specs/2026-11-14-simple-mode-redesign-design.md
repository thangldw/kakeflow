# Simple mode redesign: design

Date: 2026-11-14. Status: draft for approval. Mockups: https://claude.ai/artifact/B2Xq79KYdpcE5jS2kV2p8h (private; option A and the quick-add sheet were chosen).

## Intent and why

KakeFlow today reads as an accountant's cockpit. The Home screen leads with accounting vocabulary (発生ベース, 計算対象, 残高/発生 chips, five "templates", a secondary-currency card) and manual entry is a double-entry form (transaction type with 9 options, 借方/貸方 account pickers, a 貸借差額 check). The people the product is for are not accountants: a homemaker running a household budget, a factory worker saving for the future, a student with a part-time job, a single person tracking monthly income and spending. They open the app to do three things, in this order (stated by the product owner):

1. Record a spending quickly.
2. See how much they can still spend this month.
3. Follow progress toward a savings goal.

The redesign makes those three things obvious and fast, and moves everything else out of the way without removing it.

## Goals

- A first-time user can record an expense in three taps after opening the sheet: amount, category, save. Date defaults to today, paying account defaults to the last one used.
- Home answers "how much can I still spend this month" with one large number, how that number is derived, and the savings goal progress.
- Navigation for the simple mode has 5 entries, with everything else reachable from "More".
- Plain wording instead of accounting terms, in all three UI languages (ja source, en, vi).
- Works at phone width and on desktop with the same components.

## Non-goals

- No change to the ledger model, journal semantics, sync, or the existing Full UI.
- No new backend commands for phase 1 (quick-add uses `createManualTransaction`).
- No passkey or authentication work (see Out of scope).
- No new languages, no multi-currency changes, no bank feeds or importers (already decided as will-not-do).

## Anti-goals

- Hiding or deleting existing capability so that current users cannot find it.
- A second, divergent implementation of budget or ledger arithmetic in the UI. The simple UI must read the same numbers as the Full UI.
- Showing a figure that looks authoritative but is a guess (for example a forecast presented as fact).

## Constraints

- Local-first. The product owner stores no user data. Desktop (macOS, Windows, Tauri, SQLite) and mobile (browser or installed PWA; the user unlocks their own encrypted vault) both keep data on the user's device.
- The PWA is a separate root (`src/pwa/PwaRoot.tsx`) with its own client. Today it only has receipt OCR to ledger posting, in English, and its vault is unlocked with a passphrase of at least 12 characters (Argon2id, AES-GCM). `crates/kakeflow-core` (native and WASM) contains posting validation and key derivation only. Budgets, categories, savings goals and monthly aggregation exist only in the desktop persistence layer.
- UI strings are keyed by Japanese source text; `src/locales/en.generated.json` and `vi.generated.json` are hand-maintained in this environment (the generator needs network), inserted after the anchor line `"銀行CSVの取込先銀行口座を選択してください。"`.
- Backward compatibility: existing households and tests keep working. Quality ratchets stay green (`src/readabilityFloor.test.ts` baseline, 12px floor).
- JPY only.

## Approaches considered

1. **Add a "Simple" mode to the existing app (chosen for desktop).** A per-device setting, Simple or Full. Simple adds a new Home, the quick-add sheet and a 5-entry navigation; Full is unchanged. New households default to Simple, existing ones stay on Full until they switch. Trade-off: two navigation shells to maintain; in exchange, nothing existing changes for current users.
2. **Replace Home and navigation outright.** Less code, but removes the current experience, forces broad test rewrites and breaks muscle memory. Rejected.
3. **Build the simple experience in the PWA only.** Best fit for phone users, but needs a budget and goal data model in the PWA vault first. Chosen as phase 2, as its own design cycle, after the shared components exist.

Picked by the product owner: approach 1 first on desktop, PWA second.

## Design

### Phasing

- **Phase 0, shared layer.** Pure functions and presentational components with props only (no platform client calls inside), placed under `src/domain/simpleHome.ts` and `src/features/simple/`. Both runtimes will feed them view-models from their own loaders.
- **Phase 1, desktop.** Simple mode in `App.tsx`. Ships first.
- **Phase 2, PWA.** Separate design: budget and goal storage in the vault, vi/en copy in the PWA, reuse of the phase 0 components. Not part of this document's build.

### Mode setting

- Stored per device and per household in `localStorage` (key `kakeflow.uiMode`, value `simple` or `full`), read defensively (storage may throw). Not synced.
- Default is `simple` for a household created after this ships; `full` for households that already exist. A switch in Settings and under "More" changes it at any time.
- Switching is instant and non-destructive; it only changes which shell renders.

### Simple Home

Top to bottom:

1. **Remaining to spend (hero).**
   - `remaining = totalBudget - monthlyExpense` for the selected month, where `totalBudget` is the sum of `budgetJpy` over `listBudgets(householdId, month)` and `monthlyExpense` is the accrual-basis expense total from the existing dashboard totals (so transfers, card payments and calculation-excluded items are already left out, same as Full).
   - Per-day line only for the current month and only when `remaining > 0`: `floor(remaining / daysLeftIncludingToday)`. Past months show the closing figures without a per-day line.
   - `remaining <= 0` renders as "Over by ¥X" with the danger tone, not as a negative hero number.
   - Progress bar: `monthlyExpense / totalBudget`, clamped to 100% visually.
   - **No budgets set:** show `income - expense` for the month labelled as such, and a prominent "Set a monthly limit" action that opens the existing budgets page. The label must make clear this is not a budget.
2. **Savings goal.** The goal with the nearest `targetDate` among `status` active goals: name, `savedJpy / targetJpy` bar, and "need ¥X per month to finish on time" taken from the existing `goalPace` helper, so it matches the Budget page. No goals: a single prompt to create one (existing `createSavingsGoal`).
3. **Needs attention.** At most one row: the most overspent category ("Entertainment is ¥4,500 over"), linking to the budgets page. Absent when nothing is over.
4. **Add button.** A persistent "+ Add spending" button (floating on narrow screens), available on every page in Simple mode.

Not on this Home: net worth, USD card, templates, basis chips, data-quality panel. They remain on the Full Home.

### Quick-add sheet

Bottom sheet on narrow screens, centered dialog on wide ones. Fields: amount (large keypad), category chips, date (default today), paying account (collapsed row, default last used), optional note, and an Expense/Income switch.

- **Expense:** `entries = [Dr <category expense account>, Cr <paying account>]`. If the paying account is a credit card the transaction type is `CARD_PURCHASE`, otherwise `EXPENSE`.
- **Income:** `entries = [Dr <paying/receiving asset account>, Cr <income account>]`, type `INCOME`.
- Categories come from the household's expense accounts (income accounts for Income), most recently used first, at most 6 chips plus "Other" and "More…" for the rest. Usage counts are kept locally per household.
- Attribution defaults to household-common and audience to shared; both remain editable through the existing transaction detail panel.
- Amount uses the shared `YenInput` rules (integer yen only, no silent revert).
- After saving: toast "Saved ¥X · category", the Home figures refresh, the sheet closes. A "Edit" action opens the existing transaction detail panel. There is no undo/void API today; adding one is out of scope for phase 1.
- Keyboard: the amount field is focused on open; Enter saves when valid; Escape closes; focus returns to the trigger.

### Navigation (Simple mode)

Five entries: Today (Simple Home), Transactions (existing page), Budget (existing 予算・目標 page), Savings (the goals section of the budgets page; a dedicated page only if cheap), More.

"More" lists: import and capture, recurring and fixed costs, card reconciliation, family space, settings, and an "Advanced" group (classification rules, assets and investments, audit trail, reports). Each opens the existing page unchanged. On narrow screens the five entries form a bottom tab bar and the sidebar is not used; on wide screens they appear in the existing sidebar frame.

In Simple mode the top bar hides the accounting-basis toggle and the account-scope selector unless the user opens Advanced.

### Copy

- New strings are plain words, one language per screen, no accounting terms. Japanese source strings are plain Japanese; en and vi catalogs get matching entries.
- Fix the mixed-language Home action ("食費 is over budget") in Simple copy.

### Responsive and accessibility

- Layouts work at 360px width; side gutter at least 16px; touch targets at least 44px (coarse pointer); text at least 12px; contrast per existing tokens.
- Progress bars expose a text alternative; the over-budget state is not conveyed by color alone.
- Reduced-motion respected.

## Details settled during review

These close the questions an independent read of this document raised. Items marked (call) are my decisions, to be checked.

- **Unbudgeted spending (call).** The hero follows the product owner's rule: budget total minus the month's actual spending (all expense categories). When part of the spending is in categories without a budget, the sub-line adds "of which ¥X has no budget", so the figure reconciles with the Budget page, which sums only budgeted rows (`totalActual / totalBudget`).
- **Budgets are per month and are not copied forward (verified in code).** A new month would otherwise start in the "no budget" state. (call) When the selected month has no budgets, Simple Home reads the most recent earlier month that has budgets (up to 12 months back), shows "using last month's budget" and does not write anything. The fallback to "income minus expense" applies only when no month has budgets. Envelope carry-over (前月繰越) is not part of the hero; it stays in Full mode.
- **Savings goals (call).** `savedJpy` is a manually entered figure today, not derived from the ledger. The Home goal card reuses the existing `goalPace` helper (same wording and numbers as the Budget page) and offers an inline "update saved amount" field using the existing `updateSavingsGoal`. Linking goals to transactions or accounts is out of scope. Quick-add stays Expense/Income only.
- **`uiMode` default (call).** An absent key means `full`. `simple` is written only when a household is created through the onboarding flow and when the user switches. A second device, a restored backup or a cleared browser therefore starts on Full; the switch is one tap away in Settings and under More.
- **Accounts in quick-add (call).** Categories: active accounts with `accountKind === 'EXPENSE'` (the same list the Budget page uses for its category picker). "Other" maps to the household's `-other-expense` default account if present, else the last category in the list. Paying accounts: `ASSET` accounts with subtype `BANK`, `CASH` or `WALLET`, plus `LIABILITY` accounts with subtype `CREDIT_CARD`; only `CREDIT_CARD` produces `CARD_PURCHASE`. Income: Dr the chosen asset account, Cr an `INCOME` account (chips, same rules). If a household has no expense or no payable account the sheet shows an empty state with a link to account settings and does not create accounts.
- **Runtimes (call).** Simple mode is part of `App.tsx` and therefore also renders in the web preview runtime with sample data, which is what component tests and the 360px screenshots use. Local usage counts and the last paying account are stored in `localStorage` per household (`kakeflow.simpleUsage.<householdId>`), read defensively, never synced.
- **Month selector.** It stays in the top bar in Simple mode, so past-month views stay reachable.
- **Scope filters.** Simple mode always reads the whole household (attribution scope ALL, no account group) and says so by showing the household name only. Saved scopes are not changed and apply again when the user switches back to Full.

## Verification

- Unit tests for the pure functions: remaining-to-spend (including no budget, over budget, current vs past month, month-end day), goal monthly need, quick-add to journal mapping (expense, card purchase, income).
- Component tests for the Home states and the sheet (keyboard, validation, save error).
- Existing suites stay green, especially `App.test.tsx`, `App.desktop.test.tsx`, i18n and the readability ratchet. Full mode renders exactly as before when `uiMode` is `full`.
- Real-runtime run: the Tauri app under Xvfb with the smoke harness used for the transfer work (seed data, drive Simple mode, screenshot), checking that the hero number equals budgets minus expense and that a quick-added expense changes it.
- Phone-width screenshots (Playwright, 360px) of Simple Home and the sheet, light and dark.

## Out of scope and follow-ups

- **Passkey unlock for the PWA.** Not implemented today; the vault uses a 12-character passphrase. Passkeys would use WebAuthn PRF, which has uneven browser support, and with no server-side copy a lost passkey without an encrypted export means lost data. Needs its own design (recovery, fallback to passphrase).
- **PWA simple experience** (phase 2): budget and goal data model in the vault, vi/en copy, reuse of the phase 0 components.
- Undo/void for a just-saved transaction.
- Replacing the Full Home.

## Decided by the product owner

- Audience and the three jobs, in that order.
- Option A for Home; the quick-add sheet; the five-entry navigation moving advanced features under More.
- Remaining-to-spend = total budget minus the month's actual spending; with no budget, show income minus expense and invite setting a limit.
- Desktop first, PWA second; mobile is a browser or PWA where users unlock their own data; no user data is stored by the owner.

## My calls (please check)

- Existing households stay on Full by default; new ones start on Simple.
- The savings block shows "need ¥X per month to finish on time" from the target date instead of the mockup's "about 3 months" (the latter would be a forecast built on an assumed saving rate).
- Quick-add has no undo in phase 1; it offers "Edit" through the existing detail panel.
- "Expense" for the remaining figure uses the dashboard's accrual-basis total regardless of the Full-mode basis toggle, so card purchases count when made.
- The `uiMode` setting is per device and is not synced.

## Left to the builder

- Component and file structure within `src/features/simple/`.
- Whether Savings is its own page or a section anchor.
- Exact visual tokens (reuse the existing theme tokens; the mockup palette is indicative).
- How the paying-account default is initialised for a household with no history (suggest the first cash, then wallet, then bank account).
- The migration of tests that assume the Full navigation labels.
