# VISUAL_QA — đối chiếu app thật với handoff (1440×900)

Quy trình cho Codex: render app ở đúng viewport **1440×900, DPR 1, light theme, ngôn ngữ 日本語**, chụp từng screen, đặt cạnh ảnh trong `screenshots/`, sửa theo thứ tự dưới đây. Mỗi vòng chỉ sửa một nhóm, chụp lại, rồi mới sang nhóm sau.

## Vòng 0 — Dọn CSS trước khi so sánh
- Xóa/cách ly toàn bộ style cũ (v1) khỏi cascade: không được có rule cũ chồng lên lớp v2. Cách an toàn: namespace lớp v2 (vd `.kf2 …` hoặc CSS layer `@layer v2`) hoặc xóa hẳn file style cũ nếu không còn screen nào dùng.
- Tokens là CSS custom properties đúng tên và giá trị trong README §Design Tokens (oklch, cả light lẫn `[data-theme="dark"]`). Không hardcode màu trong component.
- `font-variant-numeric: tabular-nums` ở root; Noto Sans JP + IBM Plex Mono load được offline.
- Kiểm tra nhanh: đổi `--primary` thử một giá trị lạ → mọi nút chính/tab/nav-selected phải đổi theo. Nếu có chỗ không đổi → còn hardcode.

## Vòng 1 — Shell (so với 01-home-light.png, 15-home-dark.png)
Checklist từng điểm, sai ở đâu sửa ở đó:
- [ ] Title bar đúng platform (macOS 38px traffic lights / Windows 34px caption buttons)
- [ ] Sidebar 232px cố định; logo 家 olive + wordmark `kakeflow` thường + chip `1.0.0`
- [ ] Household selector mở dropdown (✓ 田中家 / + 新しい世帯を作成…)
- [ ] 5 nhóm nav đúng thứ tự, item selected = navsel bg + primary text/700
- [ ] Badge số trên インポート (2) và 撮影 Inbox (2)
- [ ] Header: scope dropdown + period stepper `◀ 2026年7月 ▶` + popover lưới tháng; **không có** nút theme, **không có** language, **không có** basis trên Overview
- [ ] Footer sidebar: chấm xanh + ローカル・デスクトップ版
- [ ] Dark theme: đổi `data-theme` — so với 15-home-dark.png, mọi màu ngữ nghĩa giữ nguyên nghĩa
- [ ] Esc + click ra ngoài đóng popover; Enter/Space kích hoạt hàng role=button

## Vòng 2 — Workspaces (mỗi screen so 1 ảnh)
Thứ tự nên làm: Home → 取引 → インポート → còn lại.

| Ảnh | Screen | Điểm hay sai nhất |
|---|---|---|
| 01 | ホーム | template picker 5 chip; KPI có chip basis; action center 2 cột; trend 6 tháng 2 màu |
| 02 | 取引 detail | cột checkbox 26px; pill 種別 đúng màu (振替/カード支払 = info, số tiền màu --text); panel 340px với 仕訳 + 証跡チェーン 5 bước |
| 03 | インポート review | stage strip; card trái border primary khi chọn; pill 提案 có lý do hover; source viewer highlight dòng |
| 04 | インポート lỗi | banner ⛔ err-bg; nút 再試行/無視する; KHÔNG có bảng candidate |
| 05 | 撮影 Inbox | drop zone dashed + 2 nút + đường dẫn 監視中; banner ⓘ; card lỗi OCR thấp có warn banner |
| 06 | カード照合 | 3 trạng thái pill khác nhau; 4 stat tiles; progress bar; note/warn banner |
| 07 | 投資 snapshot | KPI 4; allocation bar; bảng vị thế có `NULL` hiển thị nguyên văn; cột ソース mono |
| 08 | 投資 FIFO | 2 card JPY/USD riêng; tổng theo từng tiền tệ |
| 09 | カレンダー | ô ngày >14 xám; tag 無支出日 chỉ ngày covered |
| 10 | 月次・年次 | bảng 予算/実績/差異; strip 12 tháng 3 trạng thái |
| 11 | 予算・目標 | bar đổi màu theo ngưỡng 85%/超過; goal card có 必要ペース |
| 12 | 分類ルール | toggle switch xanh; hàng disabled mờ 55%; panel なぜ一致したか |
| 13 | 家族スペース | pill 帰属; KFE1 card có SHA-256 + nút レビューして適用 |
| 14 | 設定 | 言語/テーマ/密度 = segmented control (đây là chỗ DUY NHẤT đổi 3 thứ này) |
| 15 | ホーム dark | so tổng thể tokens dark |

## Vòng 3 — States không có trong ảnh (kiểm tra bằng tay)
- Loading skeleton khi khởi động (~1s shimmer)
- First-run empty state (qua household → 新しい世帯を作成)
- 取引: chọn ≥1 checkbox → bulk bar; empty filter state; split editor 残り ¥0 ✓
- Toast bottom-center 2.6s

## Cách so sánh hiệu quả
- Overlay 2 ảnh (opacity 50%) hoặc diff pixel để bắt lệch spacing; chấp nhận lệch ≤2px do font rendering.
- Sai lệch màu: lấy giá trị computed style, so token — đừng so mắt thường trên màn khác profile màu.
- Mỗi fix commit riêng theo nhóm (tokens / shell / screen-XX) để bisect được khi vỡ.
