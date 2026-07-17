# Handoff: KakeFlow v2 — Desktop Household Finance Workspace

## Overview
KakeFlow is a local-first desktop household-finance app (Tauri 2 + React + TypeScript, Rust services) for households in Japan. This handoff covers the full v2 redesign: global shell (macOS/Windows title bars), 11 workspaces, light/dark themes, JA/EN/VI navigation localization, and the review-before-post accounting semantics that the UI must never violate.

## About the Design Files
The bundled `KakeFlow v2.dc.html` is a **design reference created in HTML** — a working prototype showing intended look and behavior, NOT production code to copy. Recreate it in the target codebase (React + TypeScript inside Tauri 2, Lucide icons) using its established patterns. The prototype's inline styles map 1:1 to the design tokens below — implement tokens as CSS custom properties or a theme object, not scattered literals. Where the prototype shows a toast suffixed （デモ）, that is a placeholder for the real behavior described in this README — implement the real dialog/action, not the toast.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and states are final intent. Recreate pixel-faithfully. The glyph icons in the prototype (◫ ≡ ⇥ …) are placeholders — replace with Lucide equivalents (suggested mapping below).

## Non-negotiable semantics (read first)
These are product rules the UI encodes; do not "simplify" them away:
1. **Confirmed ledger only** — candidates/imports never contribute to dashboard totals. Unreviewed data is visually separate (pill `◐ レビュー必要`).
2. **Card payment ≠ expense** — a bank debit paying a card bill renders as 振替/カード支払 type with an info note: "支出ではありません — 購入時に計上済み". Never style it like an expense.
3. **Every metric declares its basis** — KPI cards carry a small chip: 発生 / 資金移動 / 残高. On Overview, the active dashboard template determines the basis (no separate basis switcher there); the 3-segment basis switcher appears only on 取引 and カレンダー.
4. **Source lineage** — transaction detail shows the evidence chain: metric → transaction → journal entries (借方/貸方 rows) → source row (`file.csv L21`) → immutable original (SHA256 ✓).
5. **No color-only meaning** — every status pill has icon + text (✓ / ◐ / ⚠ / ⛔ + label).
6. **No false completeness** — stale/missing data disclosed inline (e.g. "暫定 — PayPay 7月分 未取込", NULL prices shown as `NULL`).
7. **Import is review → atomic post** — stages: 検出 → 抽出中 → プレビュー → マッピング必要 → レビュー必要 → 転記可能 → 転記済み/ロールバック/失敗/無視. Blocking errors (e.g. AEON リボ払い) block; never auto-fix.

## Design Tokens

### Color roles (CSS custom properties; oklch)
Semantic mapping: **olive/warm paper** = brand/stability · **cobalt blue** = interaction/focus/active info · **orange** = expense/exception/warning · **green** = income/completion/asset growth · **red** = real errors only.

| Token | Light | Dark |
|---|---|---|
| `--canvas` | `oklch(0.96 0.008 95)` | `oklch(0.20 0.012 100)` |
| `--surface` | `oklch(0.99 0.004 95)` | `oklch(0.245 0.014 100)` |
| `--surface2` | `oklch(0.965 0.007 95)` | `oklch(0.275 0.015 100)` |
| `--text` | `oklch(0.25 0.02 100)` | `oklch(0.92 0.01 95)` |
| `--text2` | `oklch(0.52 0.02 100)` | `oklch(0.68 0.015 95)` |
| `--hairline` | `oklch(0.90 0.012 95)` | `oklch(0.32 0.016 100)` |
| `--divider` | `oklch(0.82 0.015 95)` | `oklch(0.40 0.018 100)` |
| `--brand` (olive, logo only) | `oklch(0.45 0.07 120)` | `oklch(0.70 0.07 120)` |
| `--primary` (cobalt) | `oklch(0.48 0.19 262)` | `oklch(0.72 0.13 262)` |
| `--primary-fg` | `#fff` | `oklch(0.20 0.012 100)` |
| `--navsel` | `oklch(0.93 0.03 262)` | `oklch(0.32 0.05 262)` |
| `--income` / `--asset` / `--ok` (green) | `oklch(0.50 0.12 150)` | `oklch(0.72 0.11 150)` |
| `--ok-bg` | `oklch(0.94 0.04 150)` | `oklch(0.32 0.05 150)` |
| `--expense` / `--liability` / `--warn` (orange) | `oklch(0.56 0.14 55)` | `oklch(0.74 0.12 55)` |
| `--warn-bg` | `oklch(0.95 0.05 65)` | `oklch(0.32 0.05 60)` |
| `--review` | `oklch(0.55 0.13 65)` | `oklch(0.78 0.11 70)` |
| `--review-bg` | `oklch(0.95 0.05 75)` | `oklch(0.32 0.05 70)` |
| `--err` (red) | `oklch(0.50 0.19 27)` | `oklch(0.72 0.15 27)` |
| `--err-bg` | `oklch(0.94 0.04 27)` | `oklch(0.31 0.06 27)` |
| `--info` / `--info-bg` | same as primary / `oklch(0.94 0.03 262)` | primary / `oklch(0.30 0.04 262)` |
| `--chip` | `oklch(0.93 0.012 95)` | `oklch(0.30 0.014 100)` |
| `--mono-bg` | `oklch(0.955 0.01 95)` | `oklch(0.22 0.012 100)` |

Chart categorical (allocation bar): `oklch(0.50 0.12 150)`, `oklch(0.58 0.10 200)`, `oklch(0.66 0.08 120)`, `--divider` (cash).

### Typography
- UI: `'Noto Sans JP','Hiragino Sans','Yu Gothic UI',sans-serif` (system-first is fine; JP glyph quality > Latin flair). `font-variant-numeric: tabular-nums` globally.
- Mono (source rows, hashes, IDs, dates in tables, amounts in dense tables): `'IBM Plex Mono', monospace`.
- Scale: page title 15.5/700 · card title 12.5–13/700 · body 11.5–12.5/400 · secondary 10.5–11 · table header 10/700 uppercase-ish color `--text2` · KPI value 21/700 (home), 18/700 (invest) · pills 9.5–10/700 · mono in tables 10–11.5.
- Never below 10px anywhere (incl. legends and status glyphs); primary financial values never gray or light-weight.

### Spacing / radius / borders / elevation
- Card: `background:var(--surface); border:1px solid var(--hairline); border-radius:8px; padding:14–17px`.
- Small controls radius 6–7px; pills 4px (badges 8–9px full-round); popovers 9px with `box-shadow:0 8px 24px rgba(0,0,0,0.14)`.
- Grid gaps 12–14px; table rows `padding:8px 14px; border-top:1px solid var(--hairline)`.
- Toast: fixed bottom-center, `--text` bg / `--canvas` text, radius 8px, auto-dismiss 2.6s.
- Focus: `:focus-visible { outline:2px solid var(--primary); outline-offset:1px }`.

## Global Shell

### OS title bar (per platform)
- **macOS**: 38px bar, traffic lights (#ff5f57 / #febc2e / #28c840, 12px circles, 8px gap), centered title "KakeFlow — 田中家" 12/600 `--text2`.
- **Windows**: 34px bar, 16px olive app icon + title left, right-aligned caption buttons ─ ▢ ✕ (46px wide each; ✕ hover `#e81123` + white).

### Sidebar (232px fixed)
- Logo: 24px olive rounded square with 家 + wordmark **`kakeflow`** lowercase 15/700 + version chip `1.0.0` mono 9.5.
- Household selector button below logo: avatar circle + 田中家 + ▾ — opens dropdown: current household (✓, navsel highlight) + 「+ 新しい世帯を作成…」 which leads to the first-run empty state.
- 5 nav groups (labels 9.5/700 uppercase `--text2`): メイン(ホーム, 取引) / 取り込み(インポート, 撮影 Inbox) / 照合・資産(カード照合, 資産・投資) / 計画・分析(カレンダー・レポート, 予算・目標, 分類ルール) / 世帯(家族スペース, 設定).
- Item: 12.5px, radius 6, selected = `--navsel` bg + `--primary` text/700; count badges (review-bg pill) on インポート (pending imports) and 撮影 Inbox (pending captures); counts decrease as items are posted/promoted.
- Footer: green dot + "ローカル · デスクトップ版".
- Lucide suggestions: home, list, inbox, camera, credit-card, trending-up, calendar, target, settings-2/wand, users/lock, settings.

### Header (per workspace)
Title 15.5/700 + subtitle 11 `--text2`; right side, only when relevant:
- **Scope dropdown** — button `範囲: <b>すべての口座</b> ▾` (white-space:nowrap). Popover 218px, two sections: 口座グループ (すべての口座/銀行のみ/カードのみ/ウォレット/証券のみ + account counts) and 帰属 (世帯全体/太郎のみ/花子のみ). ✓ check on selected, `--navsel` highlight. Shown on: home, tx, cards, invest.
- **Period stepper + month-grid popover** — `◀ 2026年7月 ▶` segmented control; label opens 252px popover: year header with ‹ ›, 4×3 month grid, each cell shows coverage mark (✓ full green / ◐ partial review-color / − none divider-color), future months disabled, legend + 「今月」 button in footer. Selecting closes popover. Opening one popover closes the other.
- **Basis segmented control** (tx/cal ONLY — not Overview): 発生 | 資金移動 | 残高; selected = primary bg.
- **No theme toggle in the header** — theme lives in Settings only (decision 2026-07-16).
- Language selector is NOT here — it lives in Settings.
- **Popover behavior**: scope/period/household popovers are mutually exclusive, close on outside click and Escape. Enter/Space activates any focused role="button" row.

## Screens / Views (11 workspaces)
Content area: scrollable, padding 20–22px, inner `min-width:1060px; max-width:1480px` (horizontal scroll below 1060 rather than crushing tables).

### 1. ホーム (Overview)
- **Loading state**: on app start, content area shows shimmer skeleton (4 KPI-sized blocks + 2 large blocks, ~1.2s shimmer via 200% background-position keyframe) with caption "ローカルデータを読み込み中…".
- **First-run / empty state** (new household, no data): centered panel — 56px olive 家 mark, title 新しい世帯へようこそ, explainer that only confirmed transactions appear on dashboards, three CTAs (primary ファイルを取り込む → Import Inbox; レシートを追加 → Capture; 口座を設定 → Settings), link back to sample household.
- **Template picker** row: 5 chips — 財務概要 / 家計簿 / 資産・負債 / カード照合 / 資金移動. Each template toggles widget visibility (overview=all; ledger=kpi+recent+cats+quality; assets=kpi+assets+trend; cardrec=kpi+actions+cards+quality+recent; cash=kpi+trend+recent+quality). Widgets keep basis chips and drill-downs in every template.
- **KPI row** (4 cards): 純資産 ¥8,246,320 [残高] · 今月の収入 ¥652,800 [発生] green · 今月の支出 ¥267,990 [発生] orange, sub "暫定 — PayPay 7月分 未取込" · 予想貯蓄 ¥384,810, sub "貯蓄率 58.9%".
- **アクションセンター**: 2-col grid of 4 clickable rows, each = status pill + text + →, navigating to cards/import/capture/budget. Items: Amazon MC due 07-27; 6 dup + 3 transfer candidates; 2 low-confidence OCR; 交際費 112% over.
- **収支トレンド**: paired bar chart 6 months (income green / expense orange), legend, exact-value tooltips, caption with totals + 暫定 caveat.
- **カテゴリ別支出**: horizontal progress bars per category vs budget; over-budget shows ⚠ 超過 and orange bar; rows click through to Transactions.
- **最近の確定取引** (5 rows) + link 取引台帳へ →.
- **カード支払** mini-widget: 3 cards with status pills; link 照合へ →.
- **データ品質・鮮度**: 4 rows icon+text+meta (imported-through dates, auto-classified 31/42, PayPay stale, 11 items pending review).

### 2. 取引 (Transactions)
- Toolbar: search input (店名・摘要・口座・ソース文字列で検索), filter chips すべて/収入/支出/振替・支払/返金, count + basis label, export button `↓ CSV / XLSX / PDF`.
- Table columns: 日付(mono) / 摘要 / カテゴリ / 口座 / 種別 pill / 金額 right-aligned / evidence icon ⎘. Type pills: 収入, 支出, 振替(info), カード購入, カード支払(info), 返金(ok). Transfer/card-payment amounts render in `--text` (NOT income/expense colors).
- **Bulk actions**: leading checkbox column (26px, accent-color primary; checkbox click does not open detail). When ≥1 checked, a bulk bar appears above the table (navsel bg, primary border): "N件選択中" + カテゴリ一括変更… / ラベル・タグ… / 計算対象の切替 / 選択解除. 計算対象 toggling never changes account balances — only analytics inclusion.
- **Split transaction**: detail panel has 取引を分割… opening an inline split editor: category+amount rows, a 残り (remainder) line that must equal ¥0 ✓ before 分割を適用 is enabled; journal entries stay balanced.
- Row click opens **detail panel** (340px right column): description, date/account/category; optional info note (e.g. card-settlement explanation); 仕訳（複式） debit/credit rows; 証跡チェーン numbered 1–5 ending in mono source ref + SHA256 ✓; button 原本ソースを表示.
- Empty filtered state: centered "該当する取引がありません" + hint.
- Sample data: 10 transactions from §19 of the product brief (成城石井, 東京電力, JR EAST, MUFG→SBI transfer pair, ヨドバシ refund, 楽天カード引落 ¥204,987, 給与 ¥426,800…).

### 3. インポート (Import Inbox)
- Stage strip across top (chips joined by →, last one green).
- Left column (330px): file cards — filename mono, adapter name, row count/received time, status pill (◐ レビュー必要 / ◐ マッピング必要 / ◇ プレビュー可 / ⛔ 失敗 / ✓ 転記済み). Selected card = primary border. Caption: "新規ファイルが自動転記されることはありません…".
- Right: **candidate review card** — file header + adapter confidence (0.98); candidate table 日付/元の摘要/カテゴリ案/金額/提案・警告 where suggestions are pills with hover reason (重複の可能性 warn; ルール一致/振替の可能性 info). Actions: primary 「レビュー確定して転記」, secondary 行を除外, caption "提案は未確定です…". Posted state: green ✓ 転記済み + ロールバック button.
  - Mapping state: review-bg banner ◐ マッピング必要 + target-account select.
  - Blocking error state (AEON): err-bg banner ⛔ + explanation (リボ払い blocked, no implicit fixes) + 再試行/無視する.
- **ソースビューア** card below: mono block with raw CSV lines, the candidate's source line highlighted (review-bg; ok-bg when posted). Caption: "原本は不変 — 正規化値の編集は原本を変更しません".

### 4. 撮影 Inbox (Capture)
- **Local intake block (primary workflow)**: dashed drop zone (2px dashed divider, radius 9) — "レシート画像をここにドラッグ＆ドロップ", JPEG/PNG/PDF, primary ファイルを選択… + 監視フォルダを設定… buttons, mono caption showing the watched folder path. No remote/token UI anywhere (decision 2026-07-16).
- Info banner: capture/OCR never auto-posts.
- Card per receipt: large uncropped preview area (striped placeholder), filename, capture meta (time, audience, OCR confidence, duplicate status), status pill; low-confidence card gets warn banner (dup suspicion vs PayPay row). Actions: インポートへ昇格 (primary) / OCR再試行 / 破棄 (red text).

### 5. カード照合 (Credit Cards)
Card per statement: brand swatch, name + masked `**** 4213`, period + mapped bank; status pill (✓ 完全照合 / ◐ 支払待ち / ⚠ 金額不一致); 4 stat tiles (明細金額, 確認済み引落, 内訳/差額, カバレッジ/状態); progress bar; info note for reconciled (transfer explanation) or warn banner for mismatch (¥5,200 difference, partial-payment guidance). Footer caption restates card-payment semantics. All 8 statuses from the brief must be supported by the pill system.

### 6. 資産・投資 (Investments)
- Tabs: スナップショット / 実現損益（FIFO）; caption "家計の収支とは分離されたワークスペースです"; export button.
- Snapshot tab: snapshot date picker (explicit; "最新への自動切替は行いません · asOf …"); 4 KPI cards (時価総額, 現金, 評価損益 green, 実現損益 2026); allocation stacked bar + legend; positions table コード/銘柄/種別/数量/平均取得/現在価格/時価評価/評価損益/ソース — missing prices literally `NULL`, P&L colored by sign, source refs mono. FX disclosure caption.
- Performance tab: one card per currency (JPY, USD — never merged), realized FIFO rows with proceeds/cost/P&L, totals per currency; disclosure caption (lots, dividends, fees, taxes, corporate actions in exports).

### 7. カレンダー・レポート
- Tabs: カレンダー / 月次・年次レビュー.
- Calendar: 7-col month grid, cells with day number + net amount (colored) + 無支出日 tag only for covered days; days beyond import coverage grayed with explanatory caption.
- Monthly review: 予算/実績/差異 table (variance green when under, warn when over) + closing summary box; memo/action panel; annual strip of 12 month chips (完了 green / 一部 review / 予定 chip) + legend.

### 8. 予算・目標
- Left: budget bars per category — actual/plan mono values, % or ⚠ 超過 n%, bar color: green-blue asset → review at >85% → warn when over. Caption: "予算=計画値 / 実績=確定済み元帳値（発生ベース）".
- Right: goal cards — name, target date, current/target, progress bar (asset color), required pace "必要ペース: ¥22,800 / 月 — 順調".

### 9. 分類ルール
- Rules table: 優先(number, mono) / ルール名 / 条件 (mono, e.g. `店名 ⊃ [成城石井, サミット]`) / カテゴリ / ラベル・タグ / 状態 有効/無効 / toggle switch (green when on; disabled rows 55% opacity).
- Right panel: **なぜ一致したか** — explanation of last match (transaction, matched condition, rule name+priority, resulting category/labels) + caption "ルールは決定的で説明可能です。信頼度スコアによる自動確定は行いません。" + primary button 修正からルールを作成.

### 10. 家族スペース
- Members card (avatar, name, role, device, アクティブ pill); ownership card (account → 世帯/太郎/花子 pills) + caption that 個人 is an organization label, not an access guarantee.
- Delivery review card: KFE1 envelope items — id mono, audience pill (世帯共通/太郎のみ), description, SHA-256 ✓ + size + sealed time; pending → primary 「レビューして適用」 + "適用は原子的" caption; applied → ✓ 適用済み pill. Toast on apply.

### 11. 設定
- 口座管理 list (dot colored by asset/liability, name, kind, balance) + 「+ 口座を追加」.
- 環境設定: 言語 = segmented 日本語/English/Tiếng Việt (the only place language switching lives), テーマ = segmented ライト/ダーク (the only theme control), 密度 = segmented 標準/コンパクト (compact reduces row padding ~25%).
- バックアップ・フォルダ: last backup ✓, watched folder mono path, Google Drive/Gmail connector = 「テストユーザー限定」 review pill; buttons 今すぐバックアップ / 復元….

## Interactions & Behavior
- Workspace switching: sidebar click; state-preserving (each workspace keeps its tab/filter/selection state).
- Popovers (scope, period, household): open on click, mutually exclusive, close on selection, outside click, and Escape.
- Toast: bottom-center, 2.6s auto-dismiss, used for post/apply/export/selection confirmations.
- All destructive/irreversible actions (転記, 適用, 破棄) are explicit buttons with distinct hierarchy; posting supports ロールバック.
- Hover: rows `--surface2`; buttons darken slightly; nav items `--surface2`.
- Localization: JA is primary + fallback. EN/VI currently translate nav, group labels, subtitles, scope word (see `L` object in prototype logic). Account names, merchants, filenames, source text are NEVER translated. Full UI-copy translation is planned but not yet in the prototype.
- Theme: `data-theme="dark"` attribute swaps the custom-property set; every semantic color keeps its meaning across themes.

## State Management (from prototype; map to your store)
`screen, theme, lang, basis, period, periodOpen, pickYear, scope, scopeMember, scopeOpen, hhOpen, booted (loading), firstRun, density, tpl (dashboard template), txQuery, txFilter, txSel, txChecked{}, splitOpen, impSel, posted{}, promoted{}, ruleOn{}, invTab, snapSel, calTab, dlApplied{}, toast`.
Derived helpers: `stepPeriod(period, ±1)` clamped to current month; `coverage(month) → full|partial|none`; JPY formatter with `−¥`/`+¥` and ja-JP grouping.

## Accessibility
- Visible focus ring on all interactives; `role="button"`/`tabIndex` on clickable rows (Enter/Space must activate them); Escape closes any open popover; `role="group"`+`aria-label` on segmented controls; `role="switch"`+`aria-checked` on rule toggles; icon-only buttons have `aria-label` (テーマ切替, 前月, 翌月…).
- Min window ~1024×720, design viewport 1440×900; below 1060px content scrolls horizontally instead of shrinking type.
- Amounts right-aligned, tabular numerals, minus signs preserved.

## Assets
No raster assets. Icons = Lucide (replace prototype glyphs). Receipt previews = image placeholders. Fonts: Noto Sans JP + IBM Plex Mono (Google Fonts, or bundled for offline desktop).

## Files
- `KakeFlow v2.dc.html` — the full interactive prototype (template + logic + sample data). Open in a browser; all 11 workspaces, both themes, both OS frames, and all interactive flows are live in this single file.

## Screenshots
In `screenshots/` (1440px, light theme unless noted):
- `10-monthly-annual-review.png`
- `11-budgets-goals.png`
- `12-classification-rules.png`
- `13-family-space.png`
- `14-settings.png`
- `15-home-dark.png`
- `01-home-light.png`
- `02-transactions-detail.png`
- `03-import-inbox-review.png`
- `04-import-blocking-error.png`
- `05-capture-inbox.png`
- `06-credit-cards.png`
- `07-investments-snapshot.png`
- `08-investments-fifo.png`
- `09-calendar.png`

## Phase 2 documents (2026-07-16)
- `UI_UX_GAP_ANALYSIS.md` — gap analysis từ phía implementation (nguồn sự thật về trạng thái hiện tại)
- `IA_MAPPING.md` — vị trí trong IA v2 cho mọi tính năng đã implement nhưng chưa có thiết kế
- `P1_SPECS.md` — spec bổ sung cho các gap P1 + bảng tham chiếu design mới ↔ vị trí trong prototype
- Prototype đã mở rộng: Reports tab 分析・予測; Investments tab 推移・評価 + FXサマリー + 期間レポート; Import tab コネクタ + rescue dialog; Family Space tab 送信 + family snapshot + 証跡バンドル; Settings コネクタ/パーサープロファイル; evidence viewer overlay (取引 → 原本ソースを表示).

### Phase 2 screenshots
- `25-settings-connectors-profiles.png`
- `26-evidence-viewer.png`
- `16-reports-forecast.png`
- `17-reports-recurring.png`
- `18-reports-fixedcost.png`
- `19-investments-trend.png`
- `20-investments-fx-summary.png`
- `21-import-connectors.png`
- `22-import-rescue-dialog.png`
- `23-family-send.png`
- `24-family-receive-snapshot.png`

### Phase 3 screenshots (dashboard edit, manual entry, dedup, card actions, OCR progress, sync diagnostics)
- `27-dashboard-layout-edit.png`
- `28-manual-entry-dialog.png`
- `29-tx-advanced-filter.png`
- `30-import-dedup-resolution.png`
- `31-cards-actions.png`
- `32-capture-ocr-progress.png`
- `33-settings-sync-diagnostics.png`
