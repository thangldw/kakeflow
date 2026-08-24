# KakeFlow changelog / Lịch sử thay đổi / 変更履歴

## Unreleased

### English

- Added an installable account-free PWA foundation with an Argon2id/AES-GCM browser vault, encrypted IndexedDB/OPFS storage, local PP-OCRv5 receipt review, explicit approval, balanced posting, provenance, offline reload, and authenticated atomic export/restore.
- Extracted platform-neutral Rust posting invariants into `kakeflow-core`, consumed natively and through a reproducible pinned WASM build.
- Added production PWA scope/service-worker contracts, offline Playwright E2E, GitHub Pages artifact deployment, and an 85-second synthetic public evidence video with SHA-256.
- Removed the Nano ID advisory, documented the applicable Linux-only `glib` path, pinned every GitHub Action by immutable SHA, isolated Poppler visual QA with machine/human artifacts, and settled React `act(...)` warnings.
- Kept desktop release 1.2.0: no `v1.2.1` tag or installer is published by these unreleased changes; the current macOS binary remains explicitly ad-hoc signed and not notarized.
- Added an end-to-end synthetic Tanaka-family demo and localized Japanese, English and Vietnamese animations.
- Expanded the architecture and operations documentation with current runtime, trust, posting and compatibility boundaries.
- Removed the completed design-port handoff, obsolete comparison images, v1.1.1 social campaign page/assets and the superseded single-language demo GIF.
- Renamed the active application style layers to `theme.css` and `ui-polish.css`; no accounting or compatibility behavior changed.

### Tiếng Việt

- Bổ sung PWA cài đặt được, không cần account, với vault Argon2id/AES-GCM, lưu trữ IndexedDB/OPFS mã hóa, PP-OCRv5 local, duyệt rõ ràng, bút toán cân bằng, provenance, reload offline và export/restore nguyên tử có xác thực.
- Tách invariant ghi sổ trung lập nền tảng vào `kakeflow-core`, dùng trực tiếp trong native và qua WASM build tái lập được, có pin version.
- Bổ sung contract scope/service worker production, E2E Playwright offline, deploy artifact GitHub Pages và video evidence tổng hợp 85 giây kèm SHA-256.
- Loại advisory Nano ID, ghi rõ affected path `glib` chỉ áp dụng Linux, pin GitHub Actions bằng immutable SHA, tách Poppler visual QA cùng artifact machine/human và dọn warning React `act(...)`.
- Giữ desktop release ở 1.2.0: các thay đổi unreleased này không tạo tag hay installer `v1.2.1`; binary macOS hiện tại vẫn được công bố rõ là ad-hoc signed và chưa notarize.
- Bổ sung demo end-to-end bằng dữ liệu tổng hợp của gia đình Tanaka và GIF riêng cho Nhật, Anh, Việt.
- Cập nhật tài liệu kiến trúc/vận hành theo runtime, trust boundary, quy tắc ghi sổ và compatibility hiện tại.
- Xoá handoff thiết kế đã hoàn thành, ảnh so sánh cũ, trang/asset social v1.1.1 và GIF demo một ngôn ngữ đã được thay thế.
- Đổi tên layer giao diện đang dùng thành `theme.css` và `ui-polish.css`; không thay đổi logic kế toán hoặc compatibility.

### 日本語

- account 不要で install 可能な PWA foundation を追加しました。Argon2id／AES-GCM browser vault、暗号化 IndexedDB／OPFS、端末内 PP-OCRv5、明示的承認、貸借一致、provenance、offline reload、認証付き原子的 export／restore に対応します。
- platform-neutral な記帳 invariant を `kakeflow-core` へ抽出し、native と再現可能な pinned WASM build の両方から利用します。
- production scope／service worker contract、offline Playwright E2E、GitHub Pages artifact deploy、SHA-256 付き 85 秒合成 evidence video を追加しました。
- Nano ID advisory を除去し、Linux のみ該当する `glib` path を明記し、全 GitHub Actions を immutable SHA へ pin し、Poppler visual QA と machine／human artifact を分離し、React `act(...)` warning を解消しました。
- desktop release は 1.2.0 のままです。この unreleased 変更は `v1.2.1` tag／installer を公開せず、現行 macOS binary は引き続き ad-hoc 署名済み・未公証と明記します。
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
