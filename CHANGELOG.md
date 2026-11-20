# KakeFlow changelog / Lịch sử thay đổi / 変更履歴

## Unreleased

- Remind you to test-restore a backup (desktop): if this device has written backups but none has been proven restorable with "Verify backup" for 90 days, a quiet toast points to Settings, then waits two weeks before asking again. It never asks for or stores a passphrase.

- Add "Check against the real balance" to the monthly report (desktop): type the balance your bank app or purse shows today and see whether KakeFlow's ledger agrees, and if not, by how much and which way. Nothing typed is saved and the ledger is never changed.

- Add a furusato nozei limit estimator to the Annual report: enter the taxable income and the resident tax income portion and get a rough yearly limit (and what is left after donations already made). It is labelled an estimate throughout and tells you to confirm with a simulator before donating.
- Check that backup files are still intact without a passphrase (desktop): each backup's SHA-256 and size are remembered when it is created, Settings can re-read them on demand (unchanged, missing, changed, unreadable), and the app does so quietly once a week, speaking up only about a problem. This proves the file is intact, not that the passphrase is remembered; "Verify backup" still does that.

- Flag possible duplicate charges in the monthly report (desktop): two posted spending entries with the same payee and amount (¥1,000 or more) within 3 days. It only points them out; nothing is changed or merged.

- Add a self-prepared income and spending summary PDF to Settings (desktop): income and spending by month for the last 3, 6 or 12 months, and the largest income entries each with the original file name and SHA-256 when one is linked. The document states it is the household's own record, not a third-party certificate.

- Add an emergency sheet to Settings (desktop): a one-page PDF listing the household's accounts and confirmed regular payments, how to restore a backup, and blank handwritten fields for contacts and where the backup and passphrase are kept. It never contains a passphrase or key.
- Add "What you can spend from today to month end" to the Calendar report (desktop): cash on hand minus the card payments and amounted payment reminders already on record, spread over the days left (or the shortfall when they exceed cash). It counts known commitments only — not income still to come or bills with no amount — and says so.

- Add synthetic household profiles (single, family, freelancer; two years each, with refunds, transfers, drafts, voids and receipts) to the Rust test suite. Each is generated deterministically into the real migrated schema and checked against an independent in-memory oracle: the ledger audit, the category history and the evidence summary must match it to the yen. Test-only; no shipped behaviour changes.

- List, under "Evidence behind spending" in the monthly report (desktop), the month's largest posted spending (¥3,000 and over, up to eight) that has no receipt or scan linked, marking whether an imported statement row is linked, so you know which receipts to attach. Read-only; it reports what is linked, not whether the amount is right.

- Add "What if…? A look back" to the monthly report (desktop): pick a percentage to spend less on a category and see, from your real posted history over the last 3, 6 or 12 months, how much would have stayed with you. Plain arithmetic on actual transactions, not a forecast; refunds count as no spending and amounts are floored to whole yen.

- Add "This month's to-do" to the Calendar report (desktop): up to three actions, most urgent first — overdue or soon-due bills and card payments (with their amounts), imports waiting for review, categories already over budget, a clearly labelled straight-line spending pace once the month is under way, and goals due soon. Every figure comes from data already on the page.
- Check the ledger quietly in the background (desktop, at most once a week while the app is open) using the existing read-only ledger audit. Nothing is shown when it is clean; if it finds a problem a notice links to Settings. Backup verification is not run in the background because it needs your passphrase.

- Add an evidence dossier PDF to the transaction detail (desktop): the entry, its journal lines and, for every linked source, the original file's name, type, size, SHA-256, import time and the source row's hash, so the original can be re-hashed and compared. States provenance only; it does not vouch for the amount.
- Add payment reminders to the Calendar report: confirm a bill's deadline (and optional amount) and see days left or overdue. When a scanned bill's text has a deadline such as お支払期限 or 振替日 (including Reiwa dates), the import row offers to add it; nothing is added automatically. Reminders are stored on this device only and never change the ledger.

- Add "Evidence behind spending" to the desktop monthly report: for the month's posted spending (expenses, card purchases, fees) it shows how much, by count and yen, has a receipt or scan (image/PDF) linked, an imported statement row linked, both, or nothing (typed by hand), and the share that has any evidence. It reports provenance only: a linked document is not proof an amount is right, and nothing claims a transaction was matched to a bank statement. Read-only (`data_confidence_query`).
- Add tax return support (確定申告) to the account-free PWA, under More: pick a year (this year and the two before) and list medical-expense, hometown-tax and other donation candidates from the encrypted vault, with the 医療費控除 reference amount when the annual income is typed, and download the CSV (BOM, formula-safe). It reuses the desktop report, so the same candidate rules apply; candidates only, nothing is filed. The PWA catalog generator now also scans the shared tax panel so the strings appear in en/vi.
- Upgrade the React stack to React 19.3 (react, react-dom, types, testing-library). No production code changed; five tests that raced React 18's eager state flushing now wait for the state they assert on (stored dashboard layout, async checkbox state, quick-add sheet fields). Typecheck, lint, build and the full suite pass three runs in a row.
- Add "Verify a backup" to desktop Settings: choose a backup file and its passphrase and KakeFlow unpacks it into a private scratch copy, then runs the checks a real restore would (SQLCipher integrity, foreign keys, schema, every stored source document) plus the double-entry ledger audit for every household, and reports counts. Nothing live is touched or staged, the scratch copy is always removed (stale ones from a crash are cleaned on the next run), and a wrong passphrase or corrupted archive is rejected.
- Raise the Vitest default timeout to 20s: the synthetic source-to-provenance journey timed out at 5s under coverage on a shared CI runner and failed an unrelated PR.
- Make CI survive Ubuntu mirror outages: Rust and Poppler jobs install apt packages through `scripts/ci-apt-install.sh` (IPv4, per-request retries, up to four attempts with backoff) instead of a single `apt-get install` that failed three PRs at once.
- Add a read-only ledger integrity check to desktop Settings (`ledger_audit_run`): every posted transaction must balance, have at least two journal lines and use only accounts of its own household; findings are capped and listed with their totals. SQLite's integrity check only proves the file is not corrupt; this proves the books still make sense.
- Add a Cmd/Ctrl+K command palette: jump to any page or find a transaction by typing (debounced, desktop ledger); arrow keys, Enter and Esc, ARIA combobox/listbox, en/vi.
- Add a PWA UI contract test (Playwright + axe-core): every Simple tab, at 375/768/1440 px in light and dark, must not scroll sideways and must have no serious or critical WCAG A/AA violation. It found one real defect, fixed here: the header logo link's accessible name did not contain its visible text.
- Measure frontend coverage in CI (`npm run test:coverage`, V8): 81.4% statements, 75.9% branches, 81.9% functions and 88.4% lines today, with floors just below so it cannot quietly erode.
- Fuzz all 24 import adapters with fast-check (random text, random delimited rows, corrupted real fixtures, empty/BOM/200k-character input): none may throw, and every result keeps its shape. A one-off run of 1,500 cases per adapter found no failures.
- Add a month-end close checklist to the Calendar report (imports waiting, failed or in progress, stale data, budget set, overspent categories, with progress and a link to fix each) and the next yearly tax and filing dates (確定申告, 予定納税, ふるさと納税 cutoff; municipality- or employer-dependent dates are marked as a guide) to the Annual report.
- Add tax return support (確定申告) to the desktop Annual page: posted transactions of the selected year that look like medical expenses, hometown-tax donations (ふるさと納税) or other donations, with a reference 医療費控除 amount when the annual income is typed, and a CSV (BOM, formula-safe) to copy out. Candidates only: insurance reimbursements and eligibility are for the user to check.
- Forbid `unwrap()` and `expect()` in production Rust (`clippy::unwrap_used`/`expect_used` denied outside tests). The 23 existing sites became error handling or carry a stated invariant; a connector page with a zero limit can no longer panic.
- Remind PWA users on Today, after a week without a downloaded encrypted archive, to back up because browser storage can be cleared. A new vault is counted from its first use, downloading an archive restarts the clock, and the reminder opens the Backup page. Stored per vault in localStorage and best effort.
- Add an optional passkey quick unlock to the account-free PWA: after the vault exists, "Quick unlock with fingerprint, face or PIN" under More (and in the classic overview) asks for the passphrase once and one passkey confirmation, then the unlock screen offers "Unlock with passkey" above the passphrase form, also offline. The passkey's WebAuthn PRF secret wraps the vault key on this device only (no server, nothing in archives); up to three passkeys per vault, each can be turned off. The passphrase stays mandatory and is still needed to restore a backup. Browsers or authenticators without PRF see a short message and keep the passphrase. Verified in Chromium with a virtual authenticator; Safari/iOS and real authenticators are not verified yet.
- Copy an earlier month's budgets into an empty month in one atomic operation (`budget_copy` on the desktop, one vault write in the PWA) when the first budget of that month is saved, so a failed or interrupted copy no longer leaves the month with only some categories.
- Add Simple mode to the account-free PWA: the same Today, History, Budget, Savings and More tabs, the "+ Add spending" quick-add sheet and the amount left to spend this month, served from the encrypted browser vault, which now stores monthly budgets per category, savings goals and monthly income/spending totals. Screens are in Japanese, English or Vietnamese (chosen from the browser language, switchable on More and on the setup screen); the language choice is remembered, and existing users now also see the create, unlock and header text in their language. In a month without budgets the Budget tab starts from the last budgeted month and keeps all of its categories on the first save. New vaults start in Simple with a starter set of accounts and spending categories; existing vaults keep the classic screens until switched, and the classic receipt import, ledger with evidence and backup stay reachable from More.
- Add a Simple mode, switchable per household on the new More page or in Settings; existing households stay on Full and households created through onboarding start on Simple. It has a Home with the amount left to spend this month (budgets minus accrual spending, or income minus spending when no budget is set), the most over-budget category and the nearest savings goal with its monthly pace; a three-tap quick-add sheet (amount keypad, frequent category chips, Save) with an Edit action on the saved toast; five-entry navigation (Today, Transactions, Budget, Savings, More) as a bottom tab bar on narrow screens and in the sidebar on wide ones. Nothing in the ledger changes when switching modes.
- Add credit-card payment envelopes to the envelope panel: per card, the cash set aside from budgeted card spending (reduced by card payments), the balance owed and the part not set aside. Read-only planning estimate backed by a new `envelope_card_activity_query` command.
- Add "merge into one entry" for transfer pairs: one transfer journal on the paying transaction, the receiving transaction voided with its evidence kept and copied, and an exact undo that refuses if either side was edited afterwards (migration 0074).
- Add "cover shortfall" to the envelope panel: move this month's budget between expense categories atomically (`budget_move`); the source can never be pushed into overspend.
- Add a shared whole-yen input (thousands separators, 円 mark, invalid text flagged) to the budgets simulators.
- Add own-account transfer review on the desktop Transactions page: possible pairs can be confirmed (both legs become calculation-excluded transfers, journals unchanged) or dismissed, with undo. Decisions are stored in a new append-only, device-local table (migration 0073).
- Add a read-only carry-over and unassigned-pool panel to the desktop Budgets page, rolling budgets and accrual income forward from the first budgeted month.
- Fix overspent budget bars rendering green on the desktop runtime; raise Home and PWA text to 12px, darken low-contrast light-mode colours, add 44px touch targets and `prefers-reduced-motion`.
- Label the sub-currency strip as using fixed reference rates.
- Add a read-only what-if scenario panel to the cash forecast (income/spending deltas and a first-month one-time outflow); nothing is saved or posted.
- Block Amazon Mastercard statements whose explicitly labelled total disagrees with the detail sum (a guessed last-row total still only warns); record `statementTotalSource` for Amazon and Rakuten.
- Add fail-closed OFX/QFX (bank `STMTRS`, JPY only, durable FITID identity) and QIF (`!Type:Bank`, file-proven date order) import adapters; credit-card/investment statements, multi-account files, fractional yen, splits and corrections are blocked for review.
- Upgrade the Vite/React-plugin/jsdom toolchain as a compatible group and align the development Node baseline.
- Upgrade ZIP and X25519/ChaCha dependencies; use fixed-size nonce construction and verify legacy cipher/key compatibility.

## 1.3.0 — 2026-09-11

### English

- Rotated the updater key after loss of the previous private key. All earlier desktop versions, including v1.2.1, require one manual installation of v1.3.0; future releases use the new trust root. Application identity and data locations are unchanged by the rotation.

- Added a read-only Connector Control Center that inventories native sources and makes account bindings an explicit posting-authorization boundary.
- Added durable refresh batches with per-source cursors, backoff, version and generation fencing, fail-closed recovery, and redacted operational summaries.
- Hardened the isolated macOS ARM64 release wrapper with canonical path checks, atomic physical-path locks, source/resource identity digests, and packaged artifact verification.
- Removed two test-only CodeQL data flows at their source and documented the remaining generated-macro false positive; the Linux-only `glib` advisory remains disclosed.
- Kept connector provider clients and credentials out of the PWA. This release does not claim direct bank aggregation or Money Forward parity.
- Published the macOS ARM64 desktop build as an ad-hoc-signed, non-notarized community artifact; the account-free PWA remains the no-Gatekeeper option.

### Tiếng Việt

- Đổi khóa updater do mất private key cũ. Mọi bản desktop trước đó, kể cả v1.2.1, cần cài v1.3.0 thủ công một lần; các bản tiếp theo dùng khóa mới. Việc đổi khóa giữ nguyên định danh ứng dụng và vị trí dữ liệu.

- Bổ sung Connector Control Center chỉ đọc để kiểm kê nguồn native và dùng account binding làm ranh giới cấp quyền ghi sổ rõ ràng.
- Bổ sung refresh batch bền vững với cursor/backoff theo nguồn, version/generation fencing, khôi phục fail-closed và summary vận hành đã che dữ liệu nhạy cảm.
- Củng cố wrapper release macOS ARM64 cô lập bằng kiểm tra canonical path, khóa nguyên tử theo physical path, digest nhận dạng source/resource và xác minh artifact đã đóng gói.
- Loại hai data flow CodeQL chỉ xuất hiện trong test và ghi lại false positive còn lại từ macro sinh mã; advisory `glib` chỉ áp dụng Linux vẫn được công khai.
- Không đưa provider client hoặc credential connector vào PWA. Bản này không tuyên bố kết nối ngân hàng trực tiếp hay tương đương Money Forward.
- Phát hành desktop macOS ARM64 dưới dạng community artifact được ký ad-hoc và chưa notarize; PWA không cần account vẫn là lựa chọn không gặp Gatekeeper.

### 日本語

- 旧秘密鍵の紛失により updater 鍵を更新しました。v1.2.1 を含む旧 desktop 版からは v1.3.0 の手動インストールが一度必要です。以降の更新は新しい鍵を使用し、今回の鍵更新によるアプリ識別子とデータ保存先の変更はありません。

- native source を一覧化し、account binding を明示的な記帳承認境界として扱う read-only Connector Control Center を追加しました。
- source ごとの cursor／backoff、version／generation fencing、fail-closed recovery、秘匿化済み運用 summary を備えた durable refresh batch を追加しました。
- canonical path 検査、physical path 単位の atomic lock、source／resource identity digest、packaged artifact 検証により、分離された macOS ARM64 release wrapper を強化しました。
- test のみに存在した CodeQL data flow を 2 件除去し、生成 macro に残る false positive を記録しました。Linux のみ該当する `glib` advisory は引き続き開示します。
- PWA には connector provider client と credential を含めません。本 release は銀行への直接接続や Money Forward 同等性を主張しません。
- macOS ARM64 desktop build を ad-hoc 署名済み・未公証の community artifact として公開しました。account 不要の PWA は Gatekeeper を必要としない選択肢です。

## 1.2.1 — 2026-08-25

### English

- Added an installable account-free PWA foundation with an Argon2id/AES-GCM browser vault, encrypted IndexedDB/OPFS storage, local PP-OCRv5 receipt review, explicit approval, balanced posting, provenance, offline reload, and authenticated atomic export/restore.
- Extracted platform-neutral Rust posting invariants into `kakeflow-core`, consumed natively and through a reproducible pinned WASM build.
- Added production PWA scope/service-worker contracts, offline Playwright E2E, GitHub Pages artifact deployment, and an 85-second synthetic public evidence video with SHA-256.
- Removed the Nano ID advisory, documented the applicable Linux-only `glib` path, pinned every GitHub Action by immutable SHA, isolated Poppler visual QA with machine/human artifacts, and settled React `act(...)` warnings.
- Published the macOS ARM64 desktop build as an explicitly ad-hoc-signed, non-notarized community artifact; the account-free PWA remains the no-Gatekeeper option.
- Added an end-to-end synthetic Tanaka-family demo and localized Japanese, English and Vietnamese animations.
- Expanded the architecture and operations documentation with current runtime, trust, posting and compatibility boundaries.
- Removed the completed design-port handoff, obsolete comparison images, v1.1.1 social campaign page/assets and the superseded single-language demo GIF.
- Renamed the active application style layers to `theme.css` and `ui-polish.css`; no accounting or compatibility behavior changed.

### Tiếng Việt

- Bổ sung PWA cài đặt được, không cần account, với vault Argon2id/AES-GCM, lưu trữ IndexedDB/OPFS mã hóa, PP-OCRv5 local, duyệt rõ ràng, bút toán cân bằng, provenance, reload offline và export/restore nguyên tử có xác thực.
- Tách invariant ghi sổ trung lập nền tảng vào `kakeflow-core`, dùng trực tiếp trong native và qua WASM build tái lập được, có pin version.
- Bổ sung contract scope/service worker production, E2E Playwright offline, deploy artifact GitHub Pages và video evidence tổng hợp 85 giây kèm SHA-256.
- Loại advisory Nano ID, ghi rõ affected path `glib` chỉ áp dụng Linux, pin GitHub Actions bằng immutable SHA, tách Poppler visual QA cùng artifact machine/human và dọn warning React `act(...)`.
- Phát hành desktop macOS ARM64 dưới dạng community artifact được ký ad-hoc và chưa notarize; PWA không cần account vẫn là lựa chọn không gặp Gatekeeper.
- Bổ sung demo end-to-end bằng dữ liệu tổng hợp của gia đình Tanaka và GIF riêng cho Nhật, Anh, Việt.
- Cập nhật tài liệu kiến trúc/vận hành theo runtime, trust boundary, quy tắc ghi sổ và compatibility hiện tại.
- Xoá handoff thiết kế đã hoàn thành, ảnh so sánh cũ, trang/asset social v1.1.1 và GIF demo một ngôn ngữ đã được thay thế.
- Đổi tên layer giao diện đang dùng thành `theme.css` và `ui-polish.css`; không thay đổi logic kế toán hoặc compatibility.

### 日本語

- account 不要で install 可能な PWA foundation を追加しました。Argon2id／AES-GCM browser vault、暗号化 IndexedDB／OPFS、端末内 PP-OCRv5、明示的承認、貸借一致、provenance、offline reload、認証付き原子的 export／restore に対応します。
- platform-neutral な記帳 invariant を `kakeflow-core` へ抽出し、native と再現可能な pinned WASM build の両方から利用します。
- production scope／service worker contract、offline Playwright E2E、GitHub Pages artifact deploy、SHA-256 付き 85 秒合成 evidence video を追加しました。
- Nano ID advisory を除去し、Linux のみ該当する `glib` path を明記し、全 GitHub Actions を immutable SHA へ pin し、Poppler visual QA と machine／human artifact を分離し、React `act(...)` warning を解消しました。
- macOS ARM64 desktop build を ad-hoc 署名済み・未公証の community artifact として公開しました。account 不要の PWA は Gatekeeper を必要としない選択肢です。
- 田中家の合成データを使う end-to-end demo と、日本語・英語・ベトナム語別 GIF を追加しました。
- 現行 runtime、trust boundary、記帳条件、compatibility 方針に合わせて architecture／operations 文書を更新しました。
- 完了済み design port handoff、旧比較画像、v1.1.1 social page／asset、置換済み単一言語 GIF を削除しました。
- 現行 style layer を `theme.css` と `ui-polish.css` へ改名しました。会計・compatibility 動作は変更していません。

## 1.2.0 — 2026-08-04

### English

- Added signed Tauri auto-update checks after startup plus manual update controls in Settings.
- Added anonymized synthetic PP-OCRv5 receipt fixtures, parser contracts and an in-browser model regression gate for dates, totals, taxes and item prices.
- Rebuilt the public landing page in Japanese, English and Vietnamese with a real product GIF covering OCR, budgets and investments.
- Added an optional Support my work dialog with GitHub Sponsors and MB Bank VietQR.

### Tiếng Việt

- Bổ sung auto-update Tauri có chữ ký, tự kiểm tra sau khi mở app và có nút kiểm tra thủ công trong Cài đặt.
- Bổ sung fixture biên lai PP-OCRv5 tổng hợp đã ẩn danh, test parser và trang regression model cho ngày, tổng tiền, thuế và giá từng món.
- Làm lại landing page Nhật–Anh–Việt với GIF màn hình thật giới thiệu OCR, ngân sách và đầu tư.
- Thêm modal Support my work tùy chọn qua GitHub Sponsors và MB Bank VietQR.

### 日本語

- 署名済み Tauri auto-update を追加し、起動後の自動確認と設定画面からの手動確認に対応しました。
- 匿名の合成 PP-OCRv5 レシート fixture、parser contract、日付・合計・税・品目価格を確認する browser model regression gate を追加しました。
- OCR・予算・投資の実画面 GIF を使い、公開 landing page を日本語・英語・ベトナム語対応へ刷新しました。
- GitHub Sponsors と MB Bank VietQR に対応する任意の Support my work dialog を追加しました。

## 1.1.1 — 2026-08-04

### English

- Fixed the Settings layout at narrower desktop widths so preferences no longer overlap account and category controls.
- Completed Vietnamese rendering for canonical account names and visible OCR, parser and source-evidence issue messages without rewriting custom user names.
- Hardened the bundled PP-OCRv5 receipt pipeline for wide-spaced yen totals such as `￥23 3`, tax-marked prices such as `*138`, and AEON Pay settlement rows.
- Added precise review guidance when OCR succeeds but a receipt image contains no transaction date; no date is invented and nothing is posted automatically.
- Verified the fixes against the supplied supermarket, AEON and Seven-Eleven receipt images, with full frontend tests, lint, production build and model checksum gates.

### Tiếng Việt

- Sửa layout Cài đặt ở chiều rộng desktop hẹp để khối Tùy chọn không còn chồng lên phần tài khoản và danh mục.
- Hoàn thiện hiển thị tiếng Việt cho tên tài khoản mặc định và các thông báo OCR, parser, bằng chứng nguồn mà không ghi đè tên người dùng tự đặt.
- Củng cố pipeline biên lai PP-OCRv5 đóng gói để nhận tổng tiền có khoảng cách như `￥23 3`, giá có dấu thuế như `*138` và dòng thanh toán AEON Pay.
- Hiển thị hướng dẫn chính xác khi OCR thành công nhưng ảnh biên lai không có ngày; ứng dụng không tự tạo ngày và không tự ghi sổ.
- Xác minh bản sửa với ba ảnh biên lai siêu thị, AEON và Seven-Eleven được cung cấp, cùng toàn bộ test frontend, lint, production build và checksum model.

### 日本語

- 狭いデスクトップ幅の設定画面で、環境設定が口座・カテゴリ操作へ重ならないようレイアウトを修正しました。
- カスタム口座名を書き換えず、標準口座名と OCR・parser・原本証跡の問題表示をベトナム語へ完全に切り替えます。
- 同梱 PP-OCRv5 レシート処理を強化し、`￥23 3` のような桁間スペース、`*138` のような税率マーカー付き価格、AEON Pay 支払行に対応しました。
- OCR 成功後も原本画像に取引日がない場合は、日付を推測せず、台帳へ自動反映しない明確な案内を表示します。
- 提供されたスーパー、AEON、セブン‐イレブンの画像で修正を確認し、frontend 全テスト、lint、production build、model checksum を検証しました。

## 1.1.0 — 2026-08-04

### English

- Adopted the Gemini-inspired warm-paper, green and coral visual system across the production application, including the navigation rail, command bar, dashboard, investments and responsive layouts.
- Added production-backed recurring-cost and audit-readiness workspaces, global ledger search, quick entry/import actions, debt payoff and future-spending simulations, currency context and monthly notes.
- Completed Japanese, English and Vietnamese localization for the newly ported UI and fixed mixed-language menus and selected-state contrast.
- Added explainable on-device category suggestions using saved rules, confirmed transaction history, merchant similarity, amount consistency and deterministic keywords without AI tokens.
- Preserved explicit review before approval or ledger posting for imports, receipts and category suggestions.

### Tiếng Việt

- Áp dụng hệ thống giao diện giấy ấm, xanh lá và san hô lấy cảm hứng từ Gemini cho ứng dụng production, bao gồm thanh điều hướng, command bar, dashboard, đầu tư và responsive layout.
- Bổ sung màn hình chi phí định kỳ và audit readiness dùng dữ liệu production, tìm kiếm sổ cái toàn cục, thao tác nhập nhanh, mô phỏng trả nợ/chi tiêu, quy đổi tiền tệ và ghi chú tháng.
- Hoàn thiện bản địa hóa Nhật–Anh–Việt cho giao diện mới, sửa menu lẫn ngôn ngữ và độ tương phản của trạng thái được chọn.
- Bổ sung đề xuất danh mục có giải thích, chạy trên thiết bị từ rule đã lưu, lịch sử xác nhận, merchant tương tự, độ nhất quán số tiền và từ khóa xác định mà không cần AI token.
- Giữ bước duyệt thủ công trước khi xác nhận hoặc ghi sổ đối với import, biên lai và đề xuất danh mục.

### 日本語

- Gemini を参考にした温かい紙面、グリーン、コーラルのデザインを、ナビゲーション、コマンドバー、ダッシュボード、投資、レスポンシブ画面を含む production アプリ全体へ適用しました。
- production データを使う定期費用・監査準備ワークスペース、台帳横断検索、クイック入力、返済・将来支出シミュレーション、通貨表示、月次メモを追加しました。
- 新しい UI の日英越ローカライズを完成させ、言語混在メニューと選択状態のコントラストを修正しました。
- 保存済みルール、確定取引履歴、支払先類似度、金額整合性、決定的キーワードを使う説明可能な端末内カテゴリー候補を追加し、AI token を不要にしました。
- 取込、レシート、カテゴリー候補は承認・台帳反映前の明示的な確認を維持します。

## 1.0.0 — 2026-07-26

### English

- Consolidated all merged import, evidence, review, double-entry ledger, card settlement, investment, report and family-delivery features.
- Preserved fail-closed accounting, source lineage and local encrypted storage.
- Removed hosted CI and release workflows; release verification now runs locally.

### Tiếng Việt

- Hợp nhất toàn bộ tính năng import, bằng chứng, duyệt, sổ kép, đối soát thẻ, đầu tư, báo cáo và chia sẻ gia đình đã merge.
- Giữ kế toán fail-closed, lineage nguồn và lưu trữ mã hóa local.
- Xóa CI/release workflow hosted; kiểm tra release được chạy local.

### 日本語

- マージ済みの取込、証拠、確認、複式簿記、カード決済照合、投資、レポート、家族共有を統合しました。
- fail-closed 会計、ソース来歴、ローカル暗号化保存を維持しました。
- hosted CI と release workflow を削除し、リリース検証をローカル実行へ統一しました。
