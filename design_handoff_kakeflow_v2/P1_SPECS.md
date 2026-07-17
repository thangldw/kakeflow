# P1_SPECS — spec bổ sung cho các gap P1 chưa có trong handoff gốc

Bổ sung 2026-07-16 theo UI_UX_GAP_ANALYSIS. Prototype `KakeFlow v2.dc.html` đã minh họa phần lớn — mục nào chưa có trong prototype được ghi rõ.

## 1. 残高 basis disabled (Transactions / Calendar)
Backend chỉ hỗ trợ ACCRUAL/CASH → option 残高 trong segmented control phải **disabled thật, không ẩn**:
- Nút 残高: `color: --divider`, `cursor: default`, không đổi state khi click.
- Tooltip (hover + focus): 「残高ベースは読み取りモデル対応後に有効になります」.
- KHÔNG render như đang chọn được rồi báo lỗi sau. Khi backend hỗ trợ, chỉ cần bỏ cờ disabled.
- ĐÃ minh họa trong prototype: 取引 → segmented basis, nút 残高 disabled + tooltip.

## 2. Capture local ingestion states
Khi user drop file / chọn file trực tiếp tại Capture Inbox, card mới xuất hiện NGAY trong lưới với chuỗi trạng thái:
```
受信済み（ハッシュ計算中） → OCR待ち → OCR実行中 (progress %) → OCR完了 (confidence) → [インポートへ昇格]
```
- Card ở trạng thái chưa xong OCR: preview đã hiển thị (ảnh gốc), pill trạng thái theo bước, nút 昇格 disabled đến khi OCR xong.
- OCR lỗi → pill ⚠ + nút OCR再試行; file trùng (SHA) → pill 「重複 — 既存: receipt_x.jpg」 và không tạo card mới thứ hai.
- Watched folder: file phát hiện tự tạo card cùng chuỗi trạng thái, nhãn nguồn 「監視フォルダ」; nguồn mobile relay có nhãn 「モバイル転送」.
- ĐÃ minh họa một phần trong prototype: 撮影 Inbox có card 「◌ OCR実行中 63%」 với progress bar, nút 昇格 disabled.

## 3. Dashboard custom layout (edit mode)
- Nút 「レイアウト編集」 cạnh template picker → edit mode:
  - Mỗi widget có overlay header khi hover: handle kéo (⠿) + nút 非表示 (👁 gạch).
  - Kéo thả đổi thứ tự trong grid; vị trí thả có drop indicator 2px primary.
  - Widget bị ẩn rơi xuống tray 「非表示のウィジェット」 cuối trang (chip có nút 復元).
  - Thanh sticky trên cùng: 「テンプレートに戻す」 (destructive-secondary) · 「キャンセル」 · 「完了」 (primary).
- Ràng buộc: tối thiểu 1 widget hiển thị; widget giữ nguyên basis chip + drill-down sau khi di chuyển; layout lưu theo (household × template), di chuyển máy vẫn giữ (schema-v4).
- ĐÃ minh họa trong prototype: ホーム → nút レイアウト編集 (panel với switch từng widget, ràng buộc min-1, テンプレートに戻す/完了; kéo-thả biểu diễn bằng handle ⠿).

## 4. Bulk attribution & advanced filters (Transactions)
- Bulk bar thêm nút thứ 4: 「帰属の変更」 → menu 世帯共通/太郎/花子. Đổi attribution KHÔNG đổi audience của source document (hai khái niệm độc lập — brief §10.11).
- 「詳細フィルタ ▾」 popover: 計算対象 (すべて/対象のみ/対象外のみ), label multi-select, tag multi-select, account group. Filter đang áp dụng hiện thành removable chips dưới toolbar; nút 「クリア」 xóa hết.
- ĐÃ minh họa trong prototype: 取引 → 詳細フィルタ popover + section 帰属 trong detail panel (kèm ghi chú audience độc lập).

## 5. Các phần ĐÃ minh họa trong prototype (tham chiếu trực tiếp)
| Design mới | Xem ở đâu trong prototype |
|---|---|
| Reports 分析・予測 (forecast + disclosure, recurring CONFIRMED/IGNORED, anomaly, fixed-cost) | カレンダー・レポート → tab 分析・予測 |
| Investments FX summary | 資産・投資 → スナップショット (card cuối) |
| Investments 推移・評価 (điểm snapshot không nội suy + aggregate MF tách nguồn) | 資産・投資 → tab 推移・評価 |
| Period report entry | 資産・投資 → 実現損益 → nút 期間レポート… |
| Import tab ローカル/コネクタ (Drive/Gmail/iCloud, テストユーザー限定, nút 取り込む) | インポート → tab コネクタ |
| Rescue dialog (delimiter/encoding, column mapping, profile name) | インポート → card 「chihou_bank_a.csv 未対応の形式」 |
| Family 送信 tab (封緘して送信, 再試行待ち bytes-unchanged, family snapshot conflict card, 証跡バンドル) | 家族スペース → データ受け渡し → tab 送信 / 受信 |
| Settings コネクタ + パーサープロファイル + backup 暗号化済み | 設定 (cột phải) |
| Evidence viewer overlay (header SHA, thumbnail rail, source canvas + highlighted row, RAW↔正規化, ghi chú PDF password/OCR box) | 取引 → chọn giao dịch → 原本ソースを表示 |

## Quy tắc chung giữ nguyên
- Mọi flow mới: review-before-post, không auto-ingest, disclosure khi dữ liệu thiếu/dự báo.
- Toast （デモ） trong prototype = hành vi thật cần implement, không phải toast.

## 6. Bổ sung đợt 3 (đã minh họa trong prototype)
| Design | Xem ở đâu |
|---|---|
| Manual double-entry dialog (貸借差額 ¥0 ✓, nguồn 「手入力」) | 取引 → ＋手入力取引 |
| Dedup resolution リンク/両方保持/除外 (3 nút trên hàng candidate có cảnh báo trùng) | インポート → rakuten_card CSV → hàng 成城石井 |
| Cards: 引落口座を変更 / 支払日を上書き / 照合を解除 + projected coverage note | カード照合 → footer mỗi card |
| Capture OCR progress (◌ OCR実行中 63%, 昇格 disabled) | 撮影 Inbox → card thứ 3 |
| Settings 同期診断 (relay status, pending envelopes, key fingerprint, unapplied receipts) | 設定 → card 同期診断 |
| 残高 basis disabled + tooltip | 取引 header |
| Dashboard レイアウト編集 | ホーム |
