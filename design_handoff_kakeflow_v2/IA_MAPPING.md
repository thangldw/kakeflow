# IA_MAPPING — vị trí trong IA v2 cho các tính năng đã implement nhưng chưa có thiết kế

Quyết định design 2026-07-16. Nguyên tắc: **không thêm mục nav top-level mới** — 11 workspace giữ nguyên; mọi tính năng nằm dưới dạng tab thứ cấp, panel, hoặc dialog trong workspace phù hợp. Mức độ hiển thị theo tần suất dùng: hàng ngày = tab, thỉnh thoảng = panel/section, hiếm = dialog từ Settings.

## 1. Dashboard (ホーム)
| Tính năng | Vị trí | Hình thức |
|---|---|---|
| Custom widget reorder/show-hide, reset layout | ホーム | Nút 「レイアウト編集」 cạnh template picker → edit mode: widget có handle kéo + nút ẩn; thanh trên cùng có 「テンプレートに戻す」/「完了」. Widget bị ẩn gom vào tray 「非表示のウィジェット」 cuối trang. Không rời khỏi Home. |

## 2. Transactions (取引)
| Tính năng | Vị trí | Hình thức |
|---|---|---|
| Manual double-entry transaction | 取引 toolbar | Nút 「+ 手入力取引」 → dialog 2 cột journal editor (借方/貸方, tự kiểm tra cân bằng như split editor: 残り ¥0 ✓). Đánh dấu nguồn = 「手入力」 trong evidence chain (không có source row). |
| Family attribution / audience per transaction | 取引 detail panel | Section 「帰属」 trong panel chi tiết: segmented 世帯共通/太郎/花子 + audience riêng cho source document (theo brief §10.11). |
| Bulk labels/tags (đã có bulk bar) | Bulk bar | Giữ trong bulk bar hiện có. |
| Advanced calculation-target filters | Filter row | Nút 「詳細フィルタ ▾」 cuối hàng chip → popover: 計算対象 (対象/対象外/すべて), label multi-select, tag multi-select, account group. Chip đang áp dụng hiện thành removable chips dưới hàng filter. |

## 3. Import (インポート)
| Tính năng | Vị trí | Hình thức |
|---|---|---|
| Custom delimited parser profiles + rescue dialog | インポート | Khi adapter không nhận diện: state 「未対応の形式」 trên card phải + nút 「手動マッピングで取り込む…」 → **rescue dialog**: preview 10 dòng đầu, chọn delimiter/encoding, kéo cột nguồn ↔ trường đích (日付/摘要/金額/残高), lưu thành profile có tên. Quản lý profile trong Settings. |
| ZIP / EML batch | インポート | Card file dạng container: expandable, hiện file con dạng cây, mỗi con có pill trạng thái riêng. Không có UI riêng — chỉ là card lồng. |
| Money Forward mappings | インポート | Trong flow mapping hiện có (マッピング必要) — mở rộng thành bảng: mỗi 保有金融機関 một hàng → chọn account đích; nút commit disabled đến khi đủ 100%. |
| Brokerage-specific imports (SBI/Rakuten/Monex) | インポート | Dùng cùng card + candidate table; thêm cột 約定/受渡 khi adapter là chứng khoán; buộc chọn 証券口座 như mapping thường. |
| Google Drive / Gmail / iCloud inboxes | インポート | Tab thứ cấp trong インポート: 「ローカル」(mặc định) / 「コネクタ」. Tab コネクタ: mỗi connector một section, badge 「テストユーザー限定」, hàng file phát hiện được → nút 「取り込む」 đưa vào flow review thường. Không bao giờ tự động. |

## 4. Capture (撮影 Inbox)
| Tính năng | Vị trí | Hình thức |
|---|---|---|
| Remote mobile capture relay + token | 設定 → コネクタ | Theo quyết định local-only của handoff: **không có UI trong Capture**. Bật/tắt + token nằm trong Settings section コネクタ, badge テストユーザー限定. Khi bật, file đến xuất hiện trong Capture Inbox như file local, có nhãn nguồn 「モバイル転送」. |

## 5. Reports (カレンダー・レポート)
Giữ 2 tab top: カレンダー / 月次・年次レビュー. Thêm tab thứ 3: **「分析・予測」**, chứa 4 subview dạng segmented trong tab:
| Tính năng | Subview |
|---|---|
| Forecast / action views | 予測とアクション — chart dự báo cuối tháng (đường thực tế + vùng dự báo có disclosure 「予測値 — 確定データではありません」), danh sách action đề xuất |
| Recurring preference / anomaly review | 定期・異常レビュー — bảng chuỗi định kỳ phát hiện được (mỗi hàng: pattern, nhịp, CONFIRMED/IGNORED explicit toggle), section anomaly có lý do |
| Fixed-cost review | 固定費レビュー — bảng chi phí cố định theo tháng, biến động highlight |
| Financial intelligence | Gộp vào 予測とアクション (không tab riêng) |
| Account-group export administration | Ở lại 設定 (quản trị) + nút export ngay trong từng report view (đã có trong handoff) |

## 6. Investments (資産・投資)
Giữ 2 tab hiện có, thêm 1: スナップショット / 実現損益（FIFO） / **「推移・評価」**:
| Tính năng | Vị trí |
|---|---|
| FX summary | Card trong スナップショット (dưới allocation): bảng tỷ giá snapshot-local từng cặp + nguồn |
| Valuation summary / market valuation | Tab 推移・評価: tổng hợp định giá theo thời gian — mỗi điểm là một snapshot đã chọn, KHÔNG nội suy; ghi rõ asOf từng điểm |
| Aggregate asset history | Cùng tab 推移・評価, section 資産推移 (nguồn Money Forward aggregate, có nhãn nguồn riêng biệt) |
| Period report | Nút 「期間レポート…」 trong tab 実現損益 → dialog chọn kỳ + preview trước export |
| Dedicated brokerage histories | Trong スナップショット: click account trong bảng vị thế → panel lịch sử giao dịch của riêng chứng khoán đó |

## 7. Family/Sync (家族スペース)
Cột phải hiện tại (データ受け渡し) mở rộng thành 2 tab nhỏ trong card: 「受信」 / 「送信」:
| Tính năng | Vị trí |
|---|---|
| Family delivery packages (nhận) | Tab 受信 — như hiện tại (KFE1 card + レビューして適用) |
| Local change packages + gửi | Tab 送信 — danh sách thay đổi local chưa gửi (grouped theo audience), nút 「封緘して送信」, trạng thái retry bytes-unchanged hiển thị pill 「再試行待ち」 |
| Desktop relay cấu hình | 設定 → コネクタ (không phải Family Space — Family Space chỉ dùng, không cấu hình) |
| Family snapshot review | Tab 受信, loại card thứ 2: 「家族スナップショット」 với diff summary + conflict list trước Apply |
| Portable evidence bundles | Nút 「証跡バンドルを書き出す…」 footer của Family Space → dialog chọn phạm vi + audience |

## 8. Settings (設定)
Thêm 2 section dưới các card hiện có (theo mô hình progressive disclosure — collapsed mặc định):
| Tính năng | Section |
|---|---|
| Encrypted backup/restore forms | Mở rộng card バックアップ hiện có: passphrase field khi bật mã hóa, chỉ báo 「暗号化済み」 trên bản backup |
| Google Drive/Gmail connectors + mobile relay + desktop relay | Section mới 「コネクタ」: mỗi connector một hàng — trạng thái, badge テストユーザー限定, nút cấu hình → dialog |
| Parser-profile administration | Section mới 「パーサープロファイル」: bảng profile đã lưu (tên, delimiter, encoding, số lần dùng), sửa/xóa/export |
| Local sync panels | Trong section コネクタ |

## 9. Source evidence viewer
| Tính năng | Vị trí |
|---|---|
| Protected PDF password flow | Trong source viewer: state 「保護されたPDF」 với password field inline + ghi chú mật khẩu chỉ dùng cục bộ, không lưu vào file gia đình |
| Image/PDF evidence overlays | Source viewer chế độ ảnh/PDF: canvas trang + bounding box OCR (viền info màu, click box ↔ highlight giá trị normalized bên phải) |
| Document evidence viewer nâng cao | Source viewer thành overlay toàn màn hình (không inline): thanh trên = tên file + SHA + trang; trái = trang/thumbnail; giữa = canvas; phải = raw ↔ normalized + confidence. Mở từ mọi 「原本ソースを表示」. |

---
Thứ tự design chi tiết tiếp theo (đã thống nhất): Reports 分析・予測 → Investments 推移・評価 → Import nâng cao (rescue dialog + コネクタ tab) → Family/Sync 送信 + evidence viewer overlay → Settings sections.
