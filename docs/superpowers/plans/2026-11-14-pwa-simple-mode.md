# PWA Simple Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the PWA the Simple experience (budgets, savings goals, three-tap spending entry, the Simple Home) on top of its encrypted vault, in Japanese, English and Vietnamese.

**Architecture:** Additive vault model (`BUDGET` and `SAVINGS_GOAL` projections, optional account subtype) behind new `PwaLedgerClient` methods; an adapter maps the client to the DTO shapes the phase-1 Simple components already consume; the PWA bundle gets a generated catalog subset and no desktop platform client; `PwaRoot` gains a Simple shell.

**Tech Stack:** React 18, TypeScript, Vite (PWA build), vitest, Playwright (Chromium), IndexedDB vault with AES-GCM, hand-maintained en/vi catalogs.

**Spec:** `docs/superpowers/specs/2026-11-14-pwa-simple-mode-design.md` (parent: `2026-11-14-simple-mode-redesign-design.md`).

## Global Constraints

- The production PWA contract (`scripts/pwa-contract.test.ts`, run through `npm run build:pwa`) must stay green: no Tauri runtime strings, no native connector commands, no provider catalog words (`Google Drive`, `Gmail`, `同期フォルダー`, the listed connector words) in any shipped chunk.
- Verify types with `npx tsc -b` (not `tsc --noEmit`); run the whole `npx vitest run` before the last commit of each task that touches shared code; `npx eslint src` has 0 errors.
- Vault changes are additive: new event/projection types and optional fields only; no existing record changes; no database version bump unless the task proves it unavoidable (and then a migration plus an old-archive restore test).
- JPY integers only; all vault access inside `PwaLedgerClient`; offline-capable; no new network access.
- Simple components keep their phase-1 behaviour; Full/desktop mode is unchanged (`src/App.test.tsx` and `src/App.desktop.test.tsx` assertions are never edited).
- Strings: `localize()` with Japanese source keys, hand-inserted en/vi entries after the anchor `"銀行CSVの取込先銀行口座を選択してください。"` (no re-sorting, no duplicates, existing entries untouched, proper English capitalization, natural Vietnamese); no interpolation inside `localize()`; readability floor 12px; 44px touch targets; tokens only.
- Code, comments and commit messages in English; every commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01S3jjZRnvhvhXxyFigfq7oJ`; no model names in code or PR text; work on branch `claude/bold-tesla-2znnzu` only; never merge or approve a PR.
- Out of scope: passkey/unlock changes, sync, bank import, redesign of the receipt screens.

## Review Focus

1. Month bucketing at the Tokyo month boundary and ledger dates at `YYYY-MM-01` / month-end; a transaction exactly on the boundary lands in one month only. (Task 1)
2. Restoring an archive made before this feature into the new build, and an archive with budgets and goals into the same build, preserving every record. (Task 1)
3. A vault with only the two original setup accounts (`asset`, `expense`): the Simple Home, quick-add and Budget screens work and tell the user what to add, never crash or post to a missing account. (Task 3, Task 4)
4. The PWA bundle never contains the desktop platform client or provider words, including through a transitive import from a Simple component. (Task 2, Task 4)
5. Invalid input everywhere money or dates are typed: negative, fractional, huge, wrong month format, duplicate ids; nothing is written on error. (Task 1, Task 3)

---

### Task 1: Vault model and client methods

**Files:**
- Modify: `src/platform/pwa/types.ts`, `src/platform/pwa/client.ts`
- Test: `src/platform/pwa/client.test.ts` (extend), `src/platform/pwa/archive.test.ts` (extend)

**Interfaces:**
- Produces in `types.ts`: `AccountSubtype`, optional `subtype` on `Account` and `CreateAccountInput`; `Budget { householdId; month; categoryAccountId; budgetJpy }`; `UpsertBudgetInput` (same fields); `MonthlyBudgetRow extends Budget { categoryName: string; actualJpy: number; remainingJpy: number }`; `SavingsGoal { id; householdId; name; targetJpy; savedJpy; targetDate; status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'; createdAt: string; updatedAt: string }`; `SaveSavingsGoalInput { id; householdId; name; targetJpy; savedJpy; targetDate; status?: SavingsGoal['status'] }`; `MonthlyDashboard { householdId; month; incomeJpy; expenseJpy; expenseCategories: readonly { accountId: string; name: string; amountJpy: number }[] }`.
- Produces on `PwaLedgerClient`: `upsertBudget(input: UpsertBudgetInput): Promise<Budget>`, `listBudgets(householdId: string, month: string): Promise<MonthlyBudgetRow[]>`, `createSavingsGoal(input: SaveSavingsGoalInput): Promise<SavingsGoal>`, `updateSavingsGoal(input: SaveSavingsGoalInput): Promise<SavingsGoal>`, `listSavingsGoals(householdId: string): Promise<SavingsGoal[]>`, `monthlyDashboard(householdId: string, month: string): Promise<MonthlyDashboard>`. Clock for `createdAt`/`updatedAt` comes from the existing `ClientOptions` clock if there is one, else a new optional `now?: () => Date` in `ClientOptions`.

- [ ] **Step 1: Write failing tests** in `client.test.ts` (names and assertions): `upsertBudget` then `listBudgets('h','2026-11')` returns the row with `actualJpy` equal to the month's expense in that category and `remainingJpy = budgetJpy - actualJpy`; a second upsert for the same category overwrites; budget 0 is accepted; rejects negative, fractional, > 2^53 safe integer, month `2026-13`/`26-11`, unknown category, non-EXPENSE account, unknown household. `monthlyDashboard`: EXPENSE, CARD_PURCHASE, FEE count as expense, REFUND subtracts, INCOME and INTEREST count as income, TRANSFER and CARD_PAYMENT count as neither; transactions on `2026-10-31` and `2026-11-01` land in October and November respectively; `expenseCategories` sums DEBIT entries on EXPENSE accounts per category (and subtracts REFUND credits) and omits zero categories. Savings goals: create, list, update only changes the given fields and `updatedAt`, rejects `savedJpy > 0` with `targetJpy 0`, bad `targetDate`, duplicate id on create, unknown id on update, empty name. `createAccount` accepts an optional valid `subtype`, rejects an invalid one, and stores none by default.
- [ ] **Step 2: Write failing archive tests** in `archive.test.ts`: export a vault containing a budget and a goal and restore it into a fresh database: `listBudgets` and `listSavingsGoals` return the same rows; restoring an archive fixture produced without these types still works (use an existing archive fixture or build one before upserting).
- [ ] **Step 3: Run** `npx vitest run src/platform/pwa` → FAIL.
- [ ] **Step 4: Implement** the types and methods. Budget projection id `<householdId>~<month>~<categoryAccountId>` with event `BUDGET_SET`; goal projection id = goal id with events `SAVINGS_GOAL_CREATED` / `SAVINGS_GOAL_UPDATED`; write each through the existing `appendDomainChange`; derive month actuals from the posted transactions' `occurredOn` and entries; reuse the existing identifier/name/date validators and `checkedAdd`.
- [ ] **Step 5: Run** `npx vitest run src/platform/pwa`, `npx tsc -b`, `npx eslint src/platform/pwa` → PASS.
- [ ] **Step 6: Commit** `feat: budgets, savings goals and monthly totals in the PWA vault`.

### Task 2: Decouple the Simple components and add the PWA catalog subset

**Files:**
- Modify: `src/features/simple/SimpleHome.tsx`, `src/features/simple/homeLoader.ts`, `src/features/simple/QuickAddSheet.tsx` (make `client` required and drop any default import of the desktop `platformClient` or `src/platform/index`; type-only imports from `src/platform/types` are fine), `src/App.tsx` (pass `platformClient` where those components are mounted), `vite.config.ts` (PWA-only resolution of the catalogs), the existing tests that relied on the default client
- Create: `scripts/build-pwa-catalog.mjs` (or `.ts` run by tsx if the repo already uses it), `src/pwa/locales/en.subset.json`, `src/pwa/locales/vi.subset.json`, `src/pwa/locales/catalog.test.ts`

**Interfaces:**
- Produces: `npm run build:pwa-catalog` (writes the two subset files); a PWA-build-only Vite `resolveId` plugin that maps the imports of `src/locales/en.generated.json` and `vi.generated.json` in `src/i18n.tsx` to the subsets; the Simple components no longer import `src/platform/index`.

- [ ] **Step 1: Write the failing tests** in `catalog.test.ts`: (a) the generated subsets equal what the generator would produce now (run the generator's pure function in the test; the subset keys are exactly the `localize("…")`/i18n helper keys found in `src/features/simple/**`, `src/ui/**`, `src/pwa/**`, plus the Simple tab/More labels); (b) every such key has non-empty en and vi values; (c) no subset value or key matches the forbidden-word patterns used by `scripts/pwa-contract.test.ts` (`Google Drive`, `Gmail`, `GOOGLE_DRIVE`, `GMAIL`, `WATCHED_FOLDER`, `同期フォルダー`) — import the patterns or copy them with a comment pointing at the contract; (d) a source scan asserting no file under `src/features/simple/` imports `../../platform` (index) as a value.
- [ ] **Step 2: Run** `npx vitest run src/pwa/locales src/features/simple` → FAIL.
- [ ] **Step 3: Implement** the generator (scan the listed directories for `localize("…")` literals and the i18n helper's text-key calls, look the keys up in the full catalogs, write sorted subsets), run it to create the committed subsets, the plugin in `vite.config.ts` (applies only when `isPwaBuild`), and the component refactor. In `src/i18n.tsx` do not change behaviour for the desktop build.
- [ ] **Step 4: Run** the whole `npx vitest run`, `npx tsc -b`, `npm run build:pwa` (contract test included) → PASS; confirm the desktop build (`npm run build`) still passes.
- [ ] **Step 5: Commit** `refactor: keep the simple components free of the desktop client and add a PWA catalog subset`.

### Task 3: PWA adapter and Budget/Goals components

**Files:**
- Create: `src/pwa/simpleAdapter.ts`, `src/pwa/simpleAdapter.test.ts`, `src/features/simple/BudgetEditor.tsx`, `src/features/simple/BudgetEditor.test.tsx`, `src/features/simple/GoalsPanel.tsx`, `src/features/simple/GoalsPanel.test.tsx`
- Modify: `src/locales/en.generated.json`, `src/locales/vi.generated.json` (new keys), then regenerate the PWA subsets (`npm run build:pwa-catalog`)

**Interfaces:**
- Consumes: Task 1 client methods; `HomeClient` from `src/features/simple/homeLoader.ts`; `AccountDto`, `MonthlyCategoryBudgetDto`, `DashboardMonthlyTotalsDto`, `SavingsGoalDto`, `UpdateSavingsGoalInputDto`, `CreateManualTransactionInputDto`, `TransactionRowDto` from `src/platform/types.ts`.
- Produces:
  - `export function createSimpleAdapter(client: PwaLedgerClient, householdId: string): SimpleAdapter` where `SimpleAdapter = HomeClient & { createManualTransaction(input: CreateManualTransactionInputDto): Promise<TransactionRowDto>; listAccountDtos(): Promise<readonly AccountDto[]> }` (mapping: PWA `ASSET` → `accountKind 'ASSET'` with the stored subtype or `'CASH'`, `LIABILITY` → `'LIABILITY'` with `'CREDIT_CARD'` when no subtype, `EXPENSE`/`INCOME` pass through; `queryDashboard` fills unused fields with zeros/empty arrays and `month`, `accountingBasis 'ACCRUAL'`; `listBudgets` maps `MonthlyBudgetRow` to `MonthlyCategoryBudgetDto`; goals map `SavingsGoal` to `SavingsGoalDto`; `createManualTransaction` maps the journal to the PWA `ManualTransactionInput` with `payee` from the note or empty and returns the minimal row the sheet reads).
  - `export function BudgetEditor(props: { month: string; categories: readonly { id: string; name: string }[]; budgets: readonly { categoryAccountId: string; budgetJpy: number }[]; onSave: (categoryAccountId: string, budgetJpy: number) => Promise<void>; onAddCategory?: (name: string) => Promise<void> }): JSX.Element`
  - `export function GoalsPanel(props: { goals: readonly SavingsGoalDto[]; onCreate: (input: { name: string; targetJpy: number; targetDate: string }) => Promise<void>; onUpdateSaved: (goalId: string, savedJpy: number) => Promise<void> }): JSX.Element`

- [ ] **Step 1: Write failing adapter tests** against a real `PwaLedgerClient` on `fake-indexeddb` (look at how `client.test.ts` builds one): the mapped budgets/dashboard/goals equal the expected DTOs for a small month; `createManualTransaction` for an expense paid from a LIABILITY account posts `CARD_PURCHASE`, from an ASSET `EXPENSE`; a vault with only the two setup accounts yields `listAccountDtos()` with one category and one cash-like account; running `loadSimpleHome(adapter, …)` from Task 5 of phase 1 returns `remaining` values equal to a hand-computed example.
- [ ] **Step 2: Write failing component tests:** `BudgetEditor` renders a row per category with `YenInput`, Save is disabled while the text is invalid or unchanged, calls `onSave(categoryId, value)` once, shows an alert and keeps the text when `onSave` rejects, shows an "Add a category" form only when `onAddCategory` is provided and rejects an empty name; `GoalsPanel` lists goals with the shared `goalPace` text, creates a goal (name required, target > 0, date valid), updates the saved amount with the same invalid-text rules as the phase-1 goal card. Render in en and vi and assert no visible English text starts lowercase (reuse the helper from `SimpleLocales.test.tsx` if exported, else a local copy).
- [ ] **Step 3: Run** the new test files → FAIL.
- [ ] **Step 4: Implement** the adapter and both components (props-only; no imports of the desktop client; new Japanese source strings with en/vi entries; regenerate the PWA subsets).
- [ ] **Step 5: Run** `npx vitest run src/pwa src/features/simple src/pwa/locales`, `npx tsc -b`, `npx eslint src` → PASS.
- [ ] **Step 6: Commit** `feat: PWA adapter for the simple components plus budget and goal editors`.

### Task 4: PWA Simple shell

**Files:**
- Modify: `src/pwa/PwaRoot.tsx`, `src/pwa/pwa.css`, `src/pwa/PwaRoot.test.tsx` (add cases only)
- Create: `src/pwa/SimpleShell.tsx`, `src/pwa/SimpleShell.test.tsx`, `src/pwa/defaultChart.ts`, `src/pwa/defaultChart.test.ts`
- Modify: catalogs and regenerate the PWA subsets

**Interfaces:**
- Consumes: Tasks 1-3; `readUiMode`/`writeUiMode`, `SimpleHome`, `QuickAddSheet`, `SimpleTabBar`, `SimpleMorePage`/`UiModeSwitch`, `BudgetEditor`, `GoalsPanel`, `I18nProvider`.
- Produces: `export function defaultChart(householdId: string, t: (source: string) => string): readonly CreateAccountInput[]` (cash `ASSET`/`CASH`, credit card `LIABILITY`/`CREDIT_CARD`, income `INCOME`, expense categories groceries, utilities, transport, entertainment, other; ids `asset-cash`, `liability-card`, `income-salary`, `expense-groceries`, … stable and valid identifiers; names from `t`); `export function SimpleShell(props: { client: PwaLedgerClient; household: Household; onOpenPage: (page: 'import' | 'ledger' | 'backup') => void; onSwitchToClassic: () => void }): JSX.Element`.

- [ ] **Step 1: Write failing tests:** `defaultChart` ids are valid identifiers, unique, one of each required subtype, names localized in en/vi; `SimpleShell` (fake-indexeddb client, English and Vietnamese): Today shows `SimpleHome`; adding spending through the sheet posts and the hero drops by the amount; Budget tab saves a budget and Today then shows the new remaining; Savings tab creates a goal and Today shows its card; More lists Import a receipt, Backup and recovery, the mode switch and the language switch; switching to classic calls `onSwitchToClassic`; a vault with only the two setup accounts shows the "add a category" path in Budget and the sheet's empty state with a working "Set up accounts" action. `PwaRoot` tests: a new vault created after this change starts in Simple (mode written for `household`) and gets the default chart; an existing vault with no stored mode keeps the classic screens; `navigator.language` `vi` selects Vietnamese; the language switch persists.
- [ ] **Step 2: Run** the new tests → FAIL.
- [ ] **Step 3: Implement** the shell (bottom tab bar visible at phone width, same z-index/padding rules as phase 1; History reuses the existing ledger list component; More opens the existing pages through `onOpenPage`), the `PwaRoot` wiring (mount `I18nProvider`, language detection and switch, mode state per vault, default chart at new-vault setup in Simple mode, vault-setup form copy), CSS in `pwa.css` using existing tokens, and the catalog entries; regenerate the PWA subsets.
- [ ] **Step 4: Run** the whole `npx vitest run`, `npx tsc -b`, `npx eslint src`, `npm run build:pwa` (contract included) → PASS.
- [ ] **Step 5: Commit** (two or three commits are fine) `feat: Simple shell in the PWA`.

### Task 5: End-to-end, screenshots and docs

**Files:**
- Create: `e2e/pwa-simple.spec.ts`
- Modify: `CHANGELOG.md`, both phase specs' status lines

- [ ] **Step 1: Write the Playwright spec** following `e2e/pwa-offline.spec.ts` (production PWA build served as it does): at 360x800 create a vault with a passphrase of at least 12 characters, confirm it opens in Simple with the default chart, set a Budget for groceries, add spending through the sheet, assert the Today number equals budget minus spending, reload the page offline and unlock again, and assert the data persisted; run it in Chromium.
- [ ] **Step 2: Run** `npm run test:pwa:e2e` (build the PWA first as the repo's script does) and the full `npx vitest run`, `npx tsc -b`, `npx eslint src`, `npm run build:pwa`.
- [ ] **Step 3: Render check:** at 360x800 and 1280x800, light and dark, Vietnamese and English, screenshot Today, the open sheet, Budget, Savings and More from the production build; read every screenshot; assert no horizontal scroll and that no tab label is clipped; fix nothing here, report problems.
- [ ] **Step 4: Update `CHANGELOG.md`** (Added: Simple mode in the PWA) and both specs' status lines (phase 2 implemented; passkey still a separate design).
- [ ] **Step 5: Commit** `docs: changelog and status for the PWA Simple mode` plus the e2e spec; push and open a draft PR with the evidence and the list of what was not verified (WebKit/Safari, a real installed PWA on a phone, Windows/macOS).
