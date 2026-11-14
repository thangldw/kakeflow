# PWA Simple mode (phase 2): design

Date: 2026-11-14. Status: implemented (phase 2 of the Simple mode redesign; passkey unlock remains a separate design); approved by the owner's standing instruction ("continue automatically until the spec is done"); decisions the owner did not make are listed under "My calls". Parent spec: `2026-11-14-simple-mode-redesign-design.md` (phase 2 and out-of-scope sections).

## Intent and why

The people this product is for mostly use a phone. The mobile build is the PWA (installed or in a browser); the user unlocks their own encrypted vault and the owner stores no user data. Phase 1 shipped Simple mode on the desktop/web-preview app, but the PWA today only has a receipt-to-ledger flow in English, with no budgets, no savings goals, no manual entry and no Vietnamese. Phase 2 gives the PWA the same three jobs, in the same order: record a spending quickly, see how much is left to spend this month, follow savings progress.

## Goals

- A new or existing PWA vault can set monthly category budgets, create and update savings goals, record an expense/income in three taps, and see the Simple Home ("Left to spend this month", daily allowance, goal card, needs-attention row) computed exactly like on desktop.
- Reuse the phase-1 Simple components unchanged in behaviour (`SimpleHome`, `QuickAddSheet`, `SimpleTabBar`, `SimpleMorePage`, `uiMode`, `homeMath`, `quickAdd`, `goalPace`).
- Japanese, English and Vietnamese copy in the PWA for the Simple screens, chosen by device language with a switch.
- Backward compatible: existing vaults keep working; the existing PWA screens (import a receipt, ledger, evidence, backup) stay reachable; an encrypted archive exported by the new build restores in the new build and an archive from the old build restores in the new one.

## Non-goals

- No passkey or unlock changes (security-sensitive, separate design). The vault keeps its passphrase unlock.
- No device-to-device sync, no server, no new network access.
- No bank import, no CSV import in the PWA, no multi-currency.
- No redesign of the existing receipt flow screens.

## Constraints

- The production PWA bundle contract (`scripts/pwa-contract.test.ts`, run by `npm run build:pwa`) forbids, in any shipped chunk: Tauri runtime strings, native connector commands, provider authorization copy, and provider catalog words (`Google Drive`, `Gmail`, `同期フォルダー`, and the listed connector words). The full `src/locales/*.generated.json` catalogs contain such words, so the PWA must ship a small catalog subset and must not import the desktop platform client.
- `tsc -b` is the type check CI runs (`tsc --noEmit` checks nothing).
- The vault is an encrypted, append-only event log with projections (`events`, `projections` stores; record types `EVENT:<type>` / `PROJECTION:<type>` in archives). New data must be additive: new event and projection types, no change to existing records, no database version bump unless unavoidable.
- JPY integers only; the PWA runs offline; all vault access stays inside `PwaLedgerClient`.
- UI strings: Japanese source text keyed catalogs, hand-maintained en/vi; no interpolation inside `localize()`; the readability floor (12px) and 44px touch targets apply.

## Approaches considered

1. **Reuse the phase-1 components through an adapter client (chosen).** The Simple components already take a `client` prop with the desktop DTO shapes. A PWA adapter maps `PwaLedgerClient` to those DTOs. Trade-off: the PWA carries a mapping layer and a catalog subset; in exchange there is one implementation of the arithmetic and the screens.
2. **Rewrite the Simple screens inside `PwaRoot.tsx` with PWA types.** No adapter, but a second copy of the money logic and copy to keep in step. Rejected (the arithmetic is the part that must not diverge).
3. **Ship the desktop app's web preview as the PWA.** The preview runs on sample data and the full catalogs, and cannot satisfy the bundle contract. Rejected.

## Design

### Vault model (additive)

- `BUDGET` projection, id `<householdId>~<month>~<categoryAccountId>`, payload `{ householdId, month: 'YYYY-MM', categoryAccountId, budgetJpy }`, event `BUDGET_SET` (an upsert: last write wins; a budget of 0 is allowed).
- `SAVINGS_GOAL` projection, id = goal id, payload `{ id, householdId, name, targetJpy, savedJpy, targetDate: 'YYYY-MM-DD', status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' }`, events `SAVINGS_GOAL_CREATED` and `SAVINGS_GOAL_UPDATED`.
- `Account` gains an optional `subtype?: 'BANK' | 'CASH' | 'WALLET' | 'CREDIT_CARD' | 'OTHER'` (and the same optional field on `CreateAccountInput`), validated when present. Old accounts have none.
- Export/restore: archives already serialise every event and projection row generically; the new types must round-trip and be covered by tests (restore of an archive with and without them).

### Client API (`PwaLedgerClient`)

`upsertBudget(input)`, `listBudgets(householdId, month)` (returns each budgeted category with its month actual), `createSavingsGoal(input)`, `updateSavingsGoal(input)`, `listSavingsGoals(householdId)`, `monthlyDashboard(householdId, month)` returning `{ incomeJpy, expenseJpy, expenseCategories: { accountId, name, amountJpy }[] }` using the same accrual rules as the existing `dashboard` (EXPENSE, CARD_PURCHASE, FEE count as expense; REFUND reduces it; INCOME and INTEREST count as income) bucketed by `occurredOn` month (ledger dates are Tokyo dates). Every write validates identifiers, integer yen >= 0, month and date formats, and that category accounts exist and are `EXPENSE`.

### Adapter and component reuse

- `src/pwa/simpleAdapter.ts` maps the PWA client to the Simple components' `HomeClient` (`listBudgets`, `queryDashboard`, `listSavingsGoals`, `updateSavingsGoal`) and `createManualTransaction`, and maps PWA accounts to the account DTO shape `quickAddChoices` expects (ASSET without subtype is offered as a cash-like paying account, LIABILITY as a card, EXPENSE as categories, INCOME as income accounts).
- The Simple components must not import the desktop platform client: `client` becomes a required prop (the app shell passes `platformClient`), and nothing under `src/features/simple/` imports `src/platform/index`.
- Props-only Budget and Savings editors are added (`BudgetEditor`, `GoalsPanel`) so the PWA can set budgets and manage goals; they take a small client interface and are not tied to `App.tsx`.

### Catalog subset and language

- A script generates `src/pwa/locales/{en,vi}.subset.json` containing exactly the keys used by the PWA entry, `src/features/simple/**`, `src/ui/**` and the PWA shell (found by scanning for `localize("…")` and the i18n helper calls), and a test asserts the generated files are up to date and contain none of the contract's forbidden words. The PWA build aliases `./locales/{en,vi}.generated.json` (imported by `src/i18n.tsx`) to the subsets.
- `PwaRoot` mounts `I18nProvider` (default language from `navigator.language`: `vi` → Vietnamese, `ja` → Japanese, otherwise English) and offers a language switch (Japanese / English / Tiếng Việt). The existing English-only receipt screens keep their English text for now.

### PWA shell

- Same rule as desktop: the mode key `kakeflow.uiMode` is per device and household (the PWA household id is `household`); absent means the existing screens; a vault created after this ships starts in Simple.
- Simple shell: the five-entry bottom tab bar (Today, History, Budget, Savings, More), the floating "+ Add spending" button and the quick-add sheet; Today is `SimpleHome`; History is the existing ledger list; Budget shows `BudgetEditor`; Savings shows `GoalsPanel`; More lists the existing PWA pages (Import a receipt, Evidence, Backup and recovery) and the mode and language switches.
- New-vault bootstrap in Simple mode creates a small default chart so budgeting works at once: a cash asset, a credit-card liability, an income account, and expense categories (groceries, utilities, transport, entertainment, other); names come from the chosen language. Existing vaults with only the two setup accounts get an "Add a category" form in the Budget screen.

### Verification

Unit tests for every client method (including validation errors, month bucketing at month boundaries, refunds, budget upsert, goal update, archive round-trip both ways), adapter tests, component tests in the three languages, `npm run build:pwa` with the contract test, the existing Playwright PWA e2e plus a new e2e for the Simple flow (create vault, set a budget, add spending, see the number change, reload offline and unlock again) at 360px in Chromium, and screenshots read at 360px light and dark.

## Decided by the owner

Phone users are the priority; mobile runs as a browser/PWA where users unlock their own vault and the owner stores no data; reuse the Simple experience; passkey is out of scope; the formula for "Left to spend" and the fallbacks from phase 1.

## My calls (please check)

- Existing PWA vaults keep their current screens until the user switches to Simple under More; new vaults start in Simple.
- `Account.subtype` is optional; without it ASSET accounts count as cash-like paying accounts and LIABILITY as cards.
- Default categories are created only for new vaults in Simple mode; older vaults add categories from the Budget screen.
- The receipt-flow screens stay English-only in this phase.
- The header's vault chrome (the status pills and "Lock vault") follows the language. The receipt-flow, ledger, evidence and backup/restore screens, the update banner and the vault engine's own error messages stay English in this phase.
- The language switch lives under More and in the vault setup screen.

## Left to the builder

File layout under `src/pwa/` and `src/features/simple/`, the exact generator mechanism for the catalog subset (any approach that keeps the contract green and is tested), visual details of the budget and goals screens (reuse the Simple tokens).
