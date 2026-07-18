# KakeFlow v2 — bàn giao thiết kế desktop

Tài liệu này là hợp đồng thiết kế cho KakeFlow v2, ứng dụng quản lý tài chính gia đình local-first dành cho macOS và Windows. Prototype đi kèm mô tả 11 workspace, light/dark theme, điều hướng JA/EN/VI và các ranh giới kế toán không được làm yếu đi khi triển khai UI.

## Cách dùng bộ bàn giao

- `KakeFlow v2.dc.html` là prototype HTML tương tác, không phải production code.
- `screenshots/` chứa 33 ảnh JPEG tham chiếu cho shell, workspace và trạng thái nâng cao.
- `IA_MAPPING.md` quyết định vị trí của tính năng trong kiến trúc thông tin.
- `P1_SPECS.md` mô tả các trạng thái quan trọng chưa có trong bộ khung ban đầu.
- `VISUAL_QA.md` là quy trình kiểm tra fidelity.

Triển khai production dùng React, TypeScript, Tauri 2, Rust và Lucide. Chuyển token sang CSS custom properties; không sao chép logic mẫu hoặc rải literal style trong component.

## Nguyên tắc nghiệp vụ bắt buộc

1. Chỉ dữ liệu `CONFIRMED` trong ledger được đưa vào KPI và báo cáo.
2. Candidate chưa review luôn tách khỏi ledger và mang trạng thái `レビュー必要`.
3. Thanh toán thẻ là chuyển khoản/liability settlement, không phải chi phí lần hai.
4. Mọi metric phải công khai basis: phát sinh, dòng tiền hoặc số dư.
5. Mọi số liệu phải lần ngược được tới journal entry, source row và bản gốc bất biến.
6. Không dùng màu làm tín hiệu duy nhất; status luôn có icon và nhãn chữ.
7. Dữ liệu thiếu, stale, partial hoặc `NULL` phải được hiển thị trung thực.
8. Import đi qua detect → extract → preview → mapping → review → atomic post; lỗi blocking không được tự sửa.

## Design tokens

### Màu

| Token | Light | Dark | Vai trò |
| --- | --- | --- | --- |
| `--canvas` | `oklch(0.96 0.008 95)` | `oklch(0.20 0.012 100)` | nền workspace |
| `--surface` | `oklch(0.99 0.004 95)` | `oklch(0.245 0.014 100)` | card chính |
| `--surface2` | `oklch(0.965 0.007 95)` | `oklch(0.275 0.015 100)` | surface phụ/hover |
| `--text` | `oklch(0.25 0.02 100)` | `oklch(0.92 0.01 95)` | nội dung chính |
| `--text2` | `oklch(0.52 0.02 100)` | `oklch(0.68 0.015 95)` | nội dung phụ |
| `--hairline` | `oklch(0.90 0.012 95)` | `oklch(0.32 0.016 100)` | viền mảnh |
| `--divider` | `oklch(0.82 0.015 95)` | `oklch(0.40 0.018 100)` | phân cách/disabled |
| `--brand` | `oklch(0.45 0.07 120)` | `oklch(0.70 0.07 120)` | logo olive |
| `--primary` | `oklch(0.48 0.19 262)` | `oklch(0.72 0.13 262)` | tương tác cobalt |
| `--navsel` | `oklch(0.93 0.03 262)` | `oklch(0.32 0.05 262)` | nav được chọn |
| `--income`, `--asset`, `--ok` | `oklch(0.50 0.12 150)` | `oklch(0.72 0.11 150)` | thu nhập/thành công |
| `--expense`, `--liability`, `--warn` | `oklch(0.56 0.14 55)` | `oklch(0.74 0.12 55)` | chi phí/cảnh báo |
| `--err` | `oklch(0.50 0.19 27)` | `oklch(0.72 0.15 27)` | lỗi thật sự |

Các biến nền semantic (`--ok-bg`, `--warn-bg`, `--review-bg`, `--err-bg`, `--info-bg`) phải giữ đủ tương phản ở cả hai theme. Olive chỉ dùng cho nhận diện thương hiệu; cobalt dành cho focus và hành động.

### Typography và hình học

- UI: `Noto Sans JP`, `Hiragino Sans`, `Yu Gothic UI`, sans-serif.
- Source row, hash, ID, ngày và số tiền dày: `IBM Plex Mono`, monospace.
- Bật `font-variant-numeric: tabular-nums` ở root.
- Không dùng chữ dưới 10px; giá trị tài chính chính không dùng màu xám hoặc weight nhẹ.
- Page title 15.5px/700; card title 12.5–13px/700; body 11.5–12.5px; KPI 18–21px/700; pill 9.5–10px/700.
- Sidebar 232px; card radius 10px; control radius 7px; pill bo tròn hoàn toàn.

## Shell toàn cục

- Title bar riêng cho macOS và Windows.
- Sidebar cố định, nhóm điều hướng đúng thứ tự, có badge Import/Capture và trạng thái local desktop.
- Header workspace chứa household, scope và period. Basis chỉ xuất hiện tại Transactions và Calendar/Reports.
- Language, theme và density chỉ được thay đổi trong Settings.
- Popover đóng khi chọn, click ngoài hoặc nhấn Escape; chỉ một popover mở tại một thời điểm.
- Mỗi workspace giữ lại tab, filter và selection khi người dùng chuyển trang.

## Yêu cầu theo workspace

### 1. Home

- Template picker và các KPI có basis chip.
- Action center, xu hướng sáu tháng, category composition, recent transactions, card status và data quality.
- Edit mode hỗ trợ kéo thả, ẩn/khôi phục, reset template và ràng buộc tối thiểu một widget.
- Có loading skeleton và first-run empty state thật.

### 2. Transactions

- Search, type filter, advanced filter, removable chips và bulk actions.
- Amount phải right-aligned; transfer/card payment dùng màu trung tính và giải thích không phải chi phí.
- Detail drawer hiển thị journal, attribution và evidence chain.
- Manual entry/split editor chỉ cho post khi debit bằng credit.
- CSV/XLSX/PDF dùng đúng scope đang hiển thị.

### 3. Import

- Master-detail review với stage strip, source preview và candidate table.
- Account/card mapping phải hoàn tất trước khi commit.
- Exact/probable duplicate cần quyết định rõ: link, keep both hoặc exclude.
- Unsupported delimited source mở rescue dialog; ZIP/EML hiển thị file con.
- Connector tab chỉ đưa file được chọn vào review; không auto-post.

### 4. Capture Inbox

- Local picker, drag/drop và watched folder tạo card ngay khi nhận file.
- Chuỗi trạng thái: received → OCR queued → OCR running → OCR complete → promote.
- Hiển thị preview, SHA duplicate, confidence, retry và discard.
- Mobile relay được cấu hình trong Settings; Capture chỉ hiển thị file nhận được.

### 5. Card reconciliation

- Mỗi statement card có tên thẻ, masked number, kỳ sao kê và bank mapping.
- Hỗ trợ đủ tám trạng thái reconciliation bằng icon + text.
- Hiển thị statement amount, confirmed payment, difference, coverage và progress.
- Cho phép thay bank mapping, override due date và unlink với audit trail.
- Không có hành động khởi tạo thanh toán.

### 6. Investments

- Tách khỏi household income/expense workspace.
- Snapshot không tự nhảy sang bản mới nhất; hiển thị `asOf`, position, asset class, snapshot FX và lineage.
- Missing price hiển thị nguyên văn `NULL`.
- FIFO performance tách từng currency; không tạo tổng quy đổi không có bằng chứng.
- Trend chỉ nối các snapshot có thật và không nội suy.

### 7. Calendar and reports

- Calendar chỉ đánh dấu ngày “không chi tiêu” khi dữ liệu đã phủ đủ.
- Monthly/annual review giữ budget, goals, drivers, import health, reconciliation và disclosures.
- Analysis/forecast phân biệt rõ giá trị dự báo với dữ liệu xác nhận.
- Recurring/anomaly và fixed-cost review giữ trạng thái, lý do và hành động rõ ràng.

### 8. Budgets and goals

- Budget so sánh plan với confirmed accrual values; cảnh báo từ 85% và khi vượt.
- Goal hiển thị current/target, deadline, progress và required monthly pace.

### 9. Classification rules

- Bảng rule có priority, deterministic condition, result, labels/tags và enabled state.
- Panel “vì sao khớp” giải thích transaction, condition, rule và kết quả.
- Không tự xác nhận bằng confidence score mơ hồ.

### 10. Family Space

- Members, ownership và audience là các khái niệm riêng.
- Receive/Send hiển thị artifact ID, audience, digest, size, retry và applied state.
- Review phải diễn ra trước một lần atomic Apply.
- Portable evidence export yêu cầu chọn scope và audience.

### 11. Settings

- Account management, language, theme, density, backup/restore và watched folder.
- Connector, relay, sync diagnostics và parser profiles nằm trong progressive disclosure.
- Test-only connector phải có badge và giới hạn rõ ràng.

## Evidence viewer

Viewer mở toàn màn hình: thumbnail rail bên trái, source canvas ở giữa, raw/normalized/confidence bên phải. Header hiển thị filename, SHA và page. OCR box liên kết hai chiều với giá trị normalized. Protected-PDF password chỉ dùng cục bộ và không được đưa vào family artifact.

## Interaction và accessibility

- Mọi interactive element có focus ring rõ, tên truy cập được và hỗ trợ keyboard tương ứng.
- Clickable row dùng Enter/Space; Escape đóng popover/dialog; segmented control và switch có role/ARIA đúng.
- Destructive action có hierarchy riêng và confirmation phù hợp.
- Toast xác nhận xuất hiện bottom-center và tự đóng sau khoảng 2.6 giây.
- Mục tiêu viewport là 1440 × 900; cửa sổ tối thiểu khoảng 1024 × 720; không được làm chữ co nhỏ để tránh overflow.
- Merchant, account, filename và source text không được dịch.

## Tài sản tham chiếu

- Prototype: `KakeFlow v2.dc.html`
- Screenshots 01–15: shell và workspace cốt lõi.
- Screenshots 16–26: report, investment, connector, rescue, family và evidence viewer.
- Screenshots 27–33: layout edit, manual entry, advanced filter, dedup, card actions, OCR progress và sync diagnostics.

Ảnh raster chỉ là bằng chứng tham chiếu. Production dùng Lucide icons và font offline phù hợp.
