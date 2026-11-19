# Simple Mode Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-device "Simple" UI mode to the desktop/web app (new Home, three-tap quick-add sheet, 5-entry navigation) without changing the Full UI.

**Architecture:** Pure functions and props-only components under `src/features/simple/` (and `src/domain/goalPace.ts`), fed by a thin loader that reads existing platform methods. `App.tsx` gains a `uiMode` state that swaps the Overview page, the navigation list and the manual-entry trigger; everything else stays as is. No backend or Rust changes.

**Tech Stack:** React 18, TypeScript, Vite, vitest (jsdom), Playwright (Chromium), existing `platformClient`, hand-maintained en/vi catalogs.

**Spec:** `docs/superpowers/specs/2026-11-14-simple-mode-redesign-design.md` (approved 2026-11-14). Mockups: https://claude.ai/artifact/B2Xq79KYdpcE5jS2kV2p8h

## Global Constraints

- Phase 1 only: desktop app and the web preview runtime (same `App.tsx`). No PWA work, no passkey work.
- No new Tauri commands, no migrations, no `crates/` changes. Quick-add uses `createManualTransaction`; goals use `listSavingsGoals` and `updateSavingsGoal`.
- `uiMode` key absent means `full`. Existing households and all existing tests must behave exactly as today.
- Remaining to spend = total budget minus the month's accrual expense (`DashboardMonthlyTotalsDto.expenseJpy`). With no budget in any of the last 12 months: income minus expense, labelled as such.
- JPY integers only. Amounts parse with `parseYenText` from `src/ui/yen.ts`; the field uses `YenInput` rules (no silent revert).
- All visible strings go through `localize()`; each new Japanese source string gets en and vi catalog entries inserted after the anchor line `"銀行CSVの取込先銀行口座を選択してください。"` in `src/locales/en.generated.json` and `vi.generated.json` (hand-inserted, do not re-sort; check the key does not already exist first). No string interpolation inside `localize()`; use label plus value.
- Quality ratchets stay green: `src/readabilityFloor.test.ts` (no new sub-12px declarations), 44px touch targets under coarse pointer, `prefers-reduced-motion` respected.
- Code, comments and commit messages in English. Every commit message ends with these two lines: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01S3jjZRnvhvhXxyFigfq7oJ`. Do not name a model in code, comments or PR text.
- Work on branch `claude/bold-tesla-2znnzu` only; never merge or approve a PR.

## Review Focus

1. No budgets in any month and zero income: Home shows ¥0 figures and the "set a limit" action, never `NaN`, `Infinity` or a blank hero. (Task 2, Task 5)
2. Month boundaries in Tokyo time: the last and first day of a month, and a month with 28 days, give the right "days left". (Task 2)
3. Invalid sheet amounts (empty, `0`, full-width digits, 16+ digits, negative): Save stays disabled and nothing is posted; full-width digits are accepted. (Task 4, Task 6)
4. Stale ids: a remembered category or paying account that no longer exists falls back to the default instead of posting to a missing account. (Task 4, Task 3)
5. `localStorage` throwing or holding corrupt JSON: mode reads as `full`, usage reads as empty, nothing crashes. (Task 3)

---

### Task 1: Extract `goalPace` into the domain

**Files:**
- Create: `src/domain/goalPace.ts`, `src/domain/goalPace.test.ts`
- Modify: `src/App.tsx` (the local `goalPace` closure inside `BudgetsPage`, around line 2883, becomes an import)

**Interfaces:**
- Produces: `export interface GoalPace { readonly remaining: number; readonly months: number; readonly monthly: number; readonly overdue: boolean }` and `export function goalPace(goal: Pick<SavingsGoalDto, 'targetJpy' | 'savedJpy' | 'targetDate'>, now?: Date): GoalPace`

- [ ] **Step 1: Write the failing test** in `goalPace.test.ts` with a fixed `now`: target ¥600,000, saved ¥342,000, target date 2027-02-12, now `new Date(2026, 10, 14, 12)` (local) → `{ remaining: 258000, months: 3, monthly: 86000, overdue: false }` (90 days / 30.4375 rounds up to 3); saved ≥ target → `remaining 0, monthly 0`; target date in the past with remaining > 0 → `overdue: true, months: 1`.
- [ ] **Step 2: Run** `npx vitest run src/domain/goalPace.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `goalPace` by moving the existing body verbatim (same rounding: `months = max(1, ceil(max(0, days) / (365.25 / 12)))`), with `now` defaulting to `new Date()`. Replace the closure in `BudgetsPage` with the import; behavior must not change.
- [ ] **Step 4: Run** `npx vitest run src/domain/goalPace.test.ts src/App.test.tsx` → PASS.
- [ ] **Step 5: Commit** `refactor: share goalPace between the budget page and future views`.

### Task 2: Home math (pure)

**Files:**
- Create: `src/features/simple/homeMath.ts`, `src/features/simple/homeMath.test.ts`

**Interfaces:**
- Consumes: `MonthlyCategoryBudgetDto`, `DashboardExpenseCategoryDto` from `src/platform/types.ts`.
- Produces:
  - `export function tokyoDate(now?: Date): string` → `YYYY-MM-DD` in `Asia/Tokyo`.
  - `export function daysLeftInMonth(today: string): number` → days remaining including today.
  - `export function previousMonths(month: string, count: number): readonly string[]` → `month` excluded, nearest first.
  - `export interface RemainingToSpend { readonly basis: 'BUDGET' | 'INCOME_MINUS_EXPENSE'; readonly budgetMonth: string | null; readonly totalBudgetJpy: number; readonly spentJpy: number; readonly unbudgetedSpentJpy: number; readonly remainingJpy: number; readonly overByJpy: number; readonly usedRatio: number; readonly perDayJpy: number | null; readonly mostOver: { readonly name: string; readonly overJpy: number } | null }`
  - `export function computeRemainingToSpend(input: { month: string; today: string; budgetMonth: string | null; budgets: readonly MonthlyCategoryBudgetDto[]; categoryActuals: readonly DashboardExpenseCategoryDto[]; expenseJpy: number; incomeJpy: number }): RemainingToSpend`

- [ ] **Step 1: Write failing tests** (assertions with the spec's numbers): budgets 60,000/45,000/15,000/20,000/15,000 (total 155,000), `expenseJpy 112,400`, today `2026-11-14`, month `2026-11` → `remainingJpy 42600`, `perDayJpy 2505` (floor of 42,600 / 17), `usedRatio ≈ 0.725`; a category with actual 24,500 against budget 20,000 → `mostOver { name, overJpy: 4500 }`; spending of 5,000 in a category without a budget → `unbudgetedSpentJpy 5000`; `expenseJpy > totalBudget` → `remainingJpy` negative, `overByJpy` positive, `perDayJpy null`, `usedRatio 1`; past month (`month` before the month of `today`) → `perDayJpy null`; no budgets and `incomeJpy 250000, expenseJpy 112400` → `basis 'INCOME_MINUS_EXPENSE'`, `remainingJpy 137600`; no budgets, income 0, expense 0 → all zeros and no `NaN`; `daysLeftInMonth('2026-11-30') === 1`, `('2026-11-01') === 30`, `('2027-02-28') === 1`; `previousMonths('2026-02', 3)` → `['2026-01','2025-12','2025-11']`; `tokyoDate(new Date('2026-11-14T15:30:00Z')) === '2026-11-15'`.
- [ ] **Step 2: Run** `npx vitest run src/features/simple/homeMath.test.ts` → FAIL.
- [ ] **Step 3: Implement** the functions. `categoryActuals` (from the dashboard) is the single source for per-category spending, for both own-month and fallback budgets; `unbudgetedSpentJpy = spentJpy - sum(actuals of categories that have a budget row)`; `mostOver` is the budgeted category with the largest positive `actual - budgetJpy`.
- [ ] **Step 4: Run** the test file → PASS.
- [ ] **Step 5: Commit** `feat: pure remaining-to-spend math for the simple home`.

### Task 3: UI mode and usage storage

**Files:**
- Create: `src/features/simple/uiMode.ts`, `src/features/simple/uiMode.test.ts`

**Interfaces:**
- Produces:
  - `export type UiMode = 'simple' | 'full'`
  - `export function readUiMode(householdId: string | null): UiMode` (key `kakeflow.uiMode`, a JSON map from household id to mode; absent, unreadable or invalid → `'full'`)
  - `export function writeUiMode(householdId: string, mode: UiMode): void`
  - `export interface QuickAddUsage { readonly categoryCounts: Readonly<Record<string, number>>; readonly lastPayingAccountId: string | null }`
  - `export function readQuickAddUsage(householdId: string): QuickAddUsage` (key `kakeflow.simpleUsage.<householdId>`)
  - `export function recordQuickAddUse(householdId: string, categoryId: string, payingAccountId: string): void`

- [ ] **Step 1: Write failing tests** using jsdom `localStorage`: absent → `'full'`; write `simple` for household A does not change household B; corrupt JSON → `'full'`; a storage whose `getItem` and `setItem` throw → `'full'` and `writeUiMode` does not throw; usage starts empty; two `recordQuickAddUse` calls increment the category count and keep the latest paying account; corrupt usage JSON → empty usage.
- [ ] **Step 2: Run** `npx vitest run src/features/simple/uiMode.test.ts` → FAIL.
- [ ] **Step 3: Implement** with every storage access wrapped in try/catch, in the style of `readSavedAttributionScopes` in `src/App.tsx`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: per-device simple/full mode and quick-add usage storage`.

### Task 4: Quick-add mapping (pure)

**Files:**
- Create: `src/features/simple/quickAdd.ts`, `src/features/simple/quickAdd.test.ts`

**Interfaces:**
- Consumes: `AccountDto`, `CreateManualTransactionInputDto` from `src/platform/types.ts`; `QuickAddUsage` from Task 3 (`{ categoryCounts: Readonly<Record<string, number>>; lastPayingAccountId: string | null }`).
- Produces:
  - `export type QuickAddKind = 'EXPENSE' | 'INCOME'`
  - `export interface QuickAddChoices { readonly chips: readonly AccountDto[]; readonly allCategories: readonly AccountDto[]; readonly payingAccounts: readonly AccountDto[]; readonly defaultCategoryId: string | null; readonly defaultPayingAccountId: string | null }`
  - `export function quickAddChoices(accounts: readonly AccountDto[], kind: QuickAddKind, usage: QuickAddUsage): QuickAddChoices`
  - `export function buildQuickAddInput(args: { id: string; householdId: string; kind: QuickAddKind; amountJpy: number; categoryId: string; payingAccountId: string; occurredOn: string; note: string; accounts: readonly AccountDto[] }): CreateManualTransactionInputDto`

- [ ] **Step 1: Write failing tests:** expense paid from a `BANK` account → `transactionType 'EXPENSE'`, entries `[{accountId: categoryId, side: 'DEBIT'}, {accountId: bankId, side: 'CREDIT'}]` both with `amountJpy`; paid from a `CREDIT_CARD` liability → `'CARD_PURCHASE'`; income → `'INCOME'`, Dr the receiving asset, Cr the income account; `note ''` → `description null`, `payee null`; entry ids are unique and derived from `id`; `amountJpy` ≤ 0 or non-integer throws `Error`; categories are `accountKind === 'EXPENSE'` (INCOME kind for income), paying accounts are `ASSET` with subtype `BANK|CASH|WALLET` plus `LIABILITY` `CREDIT_CARD` (income: assets only); chips are the 5 most used (ties keep account order) plus the account whose id ends with `-other-expense` when present, at most 6 chips total; `defaultPayingAccountId` is `usage.lastPayingAccountId` when it still exists in the list, else the first `CASH`, then `WALLET`, then `BANK`; a stale `lastPayingAccountId` or an unknown category count key is ignored; a household with no expense account gives `defaultCategoryId null` and empty `chips`.
- [ ] **Step 2: Run** `npx vitest run src/features/simple/quickAdd.test.ts` → FAIL.
- [ ] **Step 3: Implement** both functions. For attribution and audience, send the same values the Full manual form sends for household-common and shared (see `createManual` in `src/App.tsx`, around line 1083); post date equals `occurredOn` the way that form does it.
- [ ] **Step 4: Run** the test file → PASS.
- [ ] **Step 5: Commit** `feat: map quick-add input to a balanced journal`.

### Task 5: Home loader and Simple Home view

**Files:**
- Create: `src/features/simple/homeLoader.ts`, `src/features/simple/homeLoader.test.ts`, `src/features/simple/SimpleHome.tsx`, `src/features/simple/SimpleHome.test.tsx`, `src/features/simple/simpleMode.css`
- Modify: `src/main.tsx` or the module that already imports `src/ui-polish.css` (add the new CSS import next to it); `src/locales/en.generated.json`, `src/locales/vi.generated.json`

**Interfaces:**
- Consumes: `computeRemainingToSpend`, `previousMonths`, `tokyoDate` (Task 2); `goalPace` (Task 1); `YenInput` and `yen` helpers from `src/ui`.
- Produces:
  - `export type HomeClient = Pick<PlatformClient, 'listBudgets' | 'queryDashboard' | 'listSavingsGoals' | 'updateSavingsGoal'>`
  - `export interface SimpleHomeData { readonly remaining: RemainingToSpend; readonly goal: SavingsGoalDto | null }`
  - `export async function loadSimpleHome(client: HomeClient, householdId: string, month: string, now?: Date): Promise<SimpleHomeData>` (dashboard with `attributionScope {kind:'ALL'}`, `accountGroupId null`, `accountingBasis 'ACCRUAL'`; budgets for `month`, else the nearest of `previousMonths(month, 12)` that has rows, read sequentially; goal = the `ACTIVE` goal with the nearest `targetDate`)
  - `export function SimpleHome(props: { householdId: string | null; householdName: string; month: string; revision: number; onSetLimit: () => void; onOpenBudgets: () => void; onOpenSavings: () => void; client?: HomeClient }): JSX.Element`

- [ ] **Step 1: Write failing loader tests** with a fake client: own-month budgets used when present (`budgetMonth === month`); empty own month and budgets in `2026-09` → `budgetMonth '2026-09'` and the Sep budget amounts against the current month's `expenseCategories`; no budgets in 12 months → `basis 'INCOME_MINUS_EXPENSE'`; two active goals → the nearer `targetDate`; completed goals ignored; `queryDashboard` rejecting makes `loadSimpleHome` reject.
- [ ] **Step 2: Write failing view tests** (`SimpleHome.test.tsx`, fake client): hero shows `¥42,600` and the daily-allowance row for the spec's data; over-budget data shows the "over budget by" label and no negative hero number; the unbudgeted line appears only when `unbudgetedSpentJpy > 0`; fallback month shows the "earlier month's budget" note; no-budget state shows the income-minus-spending label and a "Set a monthly limit" button that calls `onSetLimit`; the goal card shows `goalPace` text and the update field calls `updateSavingsGoal` with the new `savedJpy` (other fields unchanged) then reloads; no goal shows "Create a goal" calling `onOpenSavings`; the "needs attention" row appears only for an over-budget category; a load failure renders a role `alert` with a retry button; progress bars have `role="img"` and an `aria-label`.
- [ ] **Step 3: Run** both test files → FAIL.
- [ ] **Step 4: Implement** `loadSimpleHome` and `SimpleHome` (loading skeleton, error and empty states; re-fetch on `householdId`, `month`, `revision` changes; stale-response guard like `TransferPairStrip`). Add the copy from the table below to both catalogs. Styles live in `simpleMode.css`, use existing theme tokens, hero number ≥ 36px, bars 10px high, over-budget state uses the existing danger token and a text label.
- [ ] **Step 5: Run** the two test files plus `npx vitest run src/i18n.test.tsx src/readabilityFloor.test.ts` → PASS.
- [ ] **Step 6: Commit** `feat: simple home with remaining-to-spend and savings goal`.

**Copy (ja source | en | vi)** — new Home and sheet strings. Skip a row if the key already exists in the catalogs.

| ja | en | vi |
|---|---|---|
| 今月あと使える金額 | Left to spend this month | Còn được tiêu tháng này |
| 1日あたりの目安 | Daily allowance | Mức tiêu mỗi ngày |
| 残り日数 | Days left | Số ngày còn lại |
| 予算を超えています | Over budget by | Đã vượt ngân sách |
| 使った金額 | Spent | Đã chi |
| 予算 | Budget | Ngân sách |
| 予算のないカテゴリーの支出 | Spending in categories without a budget | Chi ở khoản chưa có ngân sách |
| 以前の月の予算を使っています | Using an earlier month's budget | Đang dùng ngân sách của tháng trước đó |
| 収入 − 支出（予算は未設定） | Income minus spending (no budget set) | Thu − Chi (chưa đặt ngân sách) |
| 月の上限を決める | Set a monthly limit | Đặt hạn mức tháng |
| 貯蓄済みを更新 | Update saved amount | Cập nhật số đã để dành |
| 目標を作る | Create a goal | Tạo mục tiêu |
| 予算を超えたカテゴリー | Category over budget | Khoản chi vượt ngân sách |
| 見る | View | Xem |
| 読み込めませんでした | Could not load | Không tải được |
| 再読み込み | Retry | Tải lại |
| ＋ 支出を記録 | + Add spending | + Ghi chi tiêu |
| 支出を記録 | Add spending | Ghi chi tiêu |
| 収入を記録 | Add income | Ghi thu nhập |
| 金額 | Amount | Số tiền |
| 日付 | Date | Ngày |
| 支払い方法 | Paid with | Trả bằng |
| 受取口座 | Received in | Nhận vào |
| メモ（任意） | Note (optional) | Ghi chú (không bắt buộc) |
| もっと見る | More… | Thêm… |
| 保存 | Save | Lưu |
| 保存しました | Saved | Đã lưu |
| 修正 | Edit | Sửa |
| 記録できる口座がありません | No account to record to | Chưa có tài khoản để ghi |
| 口座を設定する | Set up accounts | Thiết lập tài khoản |
| 今日 | Today | Hôm nay |
| 予算 | Budget | Ngân sách |
| 貯蓄 | Savings | Tiết kiệm |
| その他 | More | Thêm |
| 表示モード | Display mode | Chế độ hiển thị |
| かんたん | Simple | Đơn giản |
| 詳細 | Full | Đầy đủ |

### Task 6: Quick-add sheet

**Files:**
- Create: `src/features/simple/QuickAddSheet.tsx`, `src/features/simple/QuickAddSheet.test.tsx`
- Modify: `src/features/simple/simpleMode.css`

**Interfaces:**
- Consumes: `quickAddChoices`, `buildQuickAddInput` (Task 4); `readQuickAddUsage`, `recordQuickAddUse` (Task 3); `parseYenText`.
- Produces: `export function QuickAddSheet(props: { open: boolean; householdId: string | null; accounts: readonly AccountDto[]; onClose: () => void; onSaved: (result: { transactionId: string; amountJpy: number; categoryName: string }) => void; client?: Pick<PlatformClient, 'createManualTransaction'>; now?: () => Date }): JSX.Element | null`

- [ ] **Step 1: Write failing tests:** typing digits on the on-screen keypad updates the amount; Save disabled for empty, `0`, and when no category is chosen; full-width digits `１２８０` enable Save and post `1280`; a 16-digit amount is rejected (Save stays disabled); Save calls `createManualTransaction` once with the mapped journal (expense from a cash account, date = Tokyo today) and then `onSaved`; the Expense/Income switch swaps chips and the account label ("Paid with" ↔ "Received in"); credit-card paying account posts `CARD_PURCHASE`; after a successful save the used category and paying account are remembered (`readQuickAddUsage`); a rejected `createManualTransaction` keeps the sheet open, keeps the amount and shows a role `alert`; with no expense or no paying account the empty state with a "Set up accounts" button is shown; Escape closes and focus returns to the opener; the amount input is focused on open; Enter saves when valid.
- [ ] **Step 2: Run** `npx vitest run src/features/simple/QuickAddSheet.test.tsx` → FAIL.
- [ ] **Step 3: Implement** the sheet: bottom sheet below 720px, centered dialog above; `role="dialog" aria-modal`, focus trap; keypad buttons ≥ 52px; category chips ≥ 40px high with `aria-pressed`; date input defaulting to `tokyoDate()` (editable); optional note; paying account as a collapsed row that expands to a select; "More…" chip reveals a select of `allCategories`. Generate the transaction id with `crypto.randomUUID()`.
- [ ] **Step 4: Run** the test file plus the i18n and readability tests → PASS.
- [ ] **Step 5: Commit** `feat: three-tap quick-add sheet`.

### Task 7: Simple navigation and More page

**Files:**
- Create: `src/features/simple/simpleNavigation.ts`, `src/features/simple/simpleNavigation.test.ts`, `src/features/simple/SimpleTabBar.tsx`, `src/features/simple/SimpleMorePage.tsx`, `src/features/simple/SimpleNavigation.test.tsx`
- Modify: `src/types.ts` (add `'more'` to `PageId`), `src/App.tsx` (`pageMeta` entry for `more`; the `Sidebar` accepts a `simple` prop that swaps `navigation`/`navigationSections` for the five Simple entries and keeps the household picker and the settings button), `src/features/simple/simpleMode.css`

**Interfaces:**
- Produces:
  - `export type SimpleTab = 'today' | 'transactions' | 'budget' | 'savings' | 'more'`
  - `export const SIMPLE_TABS: readonly { readonly id: SimpleTab; readonly page: PageId; readonly label: string }[]` (labels in Japanese source: 今日, 取引, 予算, 貯蓄, その他; pages `overview`, `transactions`, `budgets`, `budgets`, `more`)
  - `export function tabForPage(page: PageId, savingsActive: boolean): SimpleTab`
  - `export function SimpleTabBar(props: { active: SimpleTab; onSelect: (tab: SimpleTab) => void }): JSX.Element`
  - `export function SimpleMorePage(props: { mode: UiMode; onModeChange: (mode: UiMode) => void; onNavigate: (page: PageId) => void }): JSX.Element` (groups: Import and capture; Recurring and fixed costs; Card reconciliation; Family space; Settings; "Advanced": classification rules, assets and investments, audit trail, reports; plus the Simple/Full switch)

- [ ] **Step 1: Write failing tests:** `tabForPage('budgets', true) === 'savings'`, `tabForPage('budgets', false) === 'budget'`, unknown simple pages (`import`, `rules`, …) map to `'more'`; `SimpleTabBar` renders five buttons with `aria-current="page"` on the active one; `SimpleMorePage` lists every Full page that is not one of the four main tabs exactly once (so nothing is lost; compare against `navigation` ids), calls `onNavigate` with the page id, and the mode switch calls `onModeChange`.
- [ ] **Step 2: Run** the new test files → FAIL.
- [ ] **Step 3: Implement.** `SimpleTabBar` is fixed to the bottom with the safe-area inset and visible only below 721px; on wider screens the same five entries render in the existing sidebar via the `simple` prop. Keep the top-bar hamburger and drawer on narrow screens (it holds the household picker).
- [ ] **Step 4: Run** the new tests plus `npx vitest run src/App.test.tsx` → PASS (Full navigation unchanged).
- [ ] **Step 5: Commit** `feat: five-entry navigation and More page for simple mode`.

### Task 8: Wire Simple mode into the app shell

**Files:**
- Modify: `src/App.tsx` (state, `pageContent`, `Topbar` props, onboarding completion, Settings switch), `src/App.desktop.test.tsx` and `src/App.test.tsx` only to add new cases
- Create: `src/features/simple/SimpleMode.integration.test.tsx`

**Interfaces:**
- Consumes: `readUiMode`, `writeUiMode` (Task 3); `SimpleHome` (Task 5); `QuickAddSheet` (Task 6); `SimpleTabBar`, `SimpleMorePage`, `tabForPage` (Task 7).

- [ ] **Step 1: Write failing integration tests** (web preview runtime, in `SimpleMode.integration.test.tsx`): with no stored mode the app renders the existing Full Home and sidebar exactly as before (assert a Full-only element such as the template chips); with `kakeflow.uiMode` set to simple for the active household it renders the Simple Home, the five tabs, no basis toggle and no account-scope selector in the top bar, and the month selector is still present; the top-bar "手入力取引" button opens the quick-add sheet instead of navigating; saving from the sheet refreshes the Home figures (revision bump) and shows a "Saved" toast with an "Edit" action that opens the transaction detail panel; "Budget" opens the budgets page, "Savings" opens it scrolled to the goals panel (`id="goals"` on the goal article in `BudgetsPage`); switching to Full in More restores the Full shell without a reload; switching household re-reads the mode; a saved non-ALL attribution scope or account group is ignored in Simple mode (requests use ALL) and applies again after switching to Full; creating a household through onboarding stores `simple` for it.
- [ ] **Step 2: Run** `npx vitest run src/features/simple/SimpleMode.integration.test.tsx` → FAIL.
- [ ] **Step 3: Implement** in `App.tsx`: `const [uiMode, setUiMode]` initialised from `readUiMode(activeHouseholdId)` and re-read when the active household changes; `pageContent.overview` renders `SimpleHome` when `uiMode === 'simple'`; add `more: <SimpleMorePage …/>` (and a harmless fallback for `more` in Full); pass `simple` to `Sidebar`; render `SimpleTabBar` and a floating "+ Add spending" button (narrow screens) in Simple mode; `Topbar` gets `showAccountScope={false}`, `showBasis={false}` and `onManualEntry` opening the sheet; `completeHouseholdCreation` calls `writeUiMode(household.id, 'simple')`; add the Simple/Full switch to `SettingsPage` (reuse `SimpleMorePage`'s switch component or a shared small control); add `id="goals"` to the goal article in `BudgetsPage`; Simple mode passes ALL/no group to `SimpleHome` and ignores saved scopes without clearing them.
- [ ] **Step 4: Run** `npx vitest run src/App.test.tsx src/App.desktop.test.tsx src/features/simple` and `npx tsc --noEmit` and `npx eslint src` → all PASS.
- [ ] **Step 5: Commit** `feat: simple mode in the app shell`.

### Task 9: Verification, screenshots and docs

**Files:**
- Create: `scripts/` or test-only Playwright spec following the repo's existing render-test convention (find with `grep -rn "playwright" package.json`); screenshots are artifacts, not committed.
- Modify: `CHANGELOG.md`, `docs/superpowers/specs/2026-11-14-simple-mode-redesign-design.md` (status line: implemented in phase 1)

- [ ] **Step 1: Run the full frontend suite** `npm test` (or the repo's CI command from `.github/workflows`) → all PASS, including `readabilityFloor`.
- [ ] **Step 2: Phone-width render check.** With the web preview, render Simple Home and the open quick-add sheet at 360×800 and 1280×800, light and dark, via Playwright (Chromium, `deviceScaleFactor: 1` for these checks); read the screenshots and confirm: no horizontal scroll, hero number visible without scrolling, tab bar clear of the safe area, sheet keypad fully visible.
- [ ] **Step 3: Real-runtime check.** Build and drive the Tauri app under Xvfb with the packaged-smoke harness used for the transfer verification (smoke mode `KAKEFLOW_PACKAGED_SMOKE=1` with `KAKEFLOW_SMOKE_ROOT`, tauri-driver, seeded data; the local-only `KAKEFLOW_SMOKE_NO_UI` hook is not committed). Seed the spec's numbers (budgets totalling ¥155,000, spending ¥112,400, a goal). Confirm: the hero equals budgets minus spending and equals what the Budget page shows; adding ¥1,280 through the sheet lowers the hero by ¥1,280; the Full mode switch restores the old Home.
- [ ] **Step 4: Update `CHANGELOG.md`** (Added: Simple mode) and the spec status line.
- [ ] **Step 5: Commit** `docs: changelog and status for simple mode`; push and open a draft PR with the verification evidence and the list of what was not verified (Windows/macOS, WebView2, PWA).
