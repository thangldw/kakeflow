# KakeFlow v2 — quy trình visual QA

So sánh application với handoff ở viewport 1440 × 900, DPR 1, light theme và ngôn ngữ Nhật. Kiểm tra dark theme và responsive widths sau khi desktop reference đã khớp.

## Chuẩn bị

- Build từ working tree sạch.
- Dùng cùng household fixture, period và scope giữa các lần chụp.
- Tắt animation không cần thiết và chờ font/OCR assets load xong.
- Xác nhận không có CSS cũ ghi đè token v2.
- Xác nhận `font-variant-numeric: tabular-nums` và font offline hoạt động.

## Vòng 1: shell

- [ ] Title bar đúng platform.
- [ ] Sidebar rộng 232px, group/order/nav state đúng.
- [ ] Household selector, badges và local-desktop status hoạt động.
- [ ] Header có scope/period phù hợp; không có theme/language ở ngoài Settings.
- [ ] Popover đóng bằng chọn, click ngoài và Escape.
- [ ] Dark theme giữ nguyên semantic meaning.
- [ ] Không có horizontal overflow ở 1440, 1280 và 1100px.

Ảnh tham chiếu: `01-home-light.jpg`, `15-home-dark.jpg`.

## Vòng 2: workspace cốt lõi

| Ảnh | Workspace | Điểm cần kiểm tra |
| --- | --- | --- |
| 01 | Home | template, KPI basis, action center, trend, layout density |
| 02 | Transactions | selection, type semantics, amount alignment, detail và evidence |
| 03–04 | Import | stage strip, master-detail, mapping, source preview và blocking error |
| 05 | Capture | drop zone, OCR state, confidence, retry và promotion |
| 06 | Cards | visible identity, status, totals, coverage và actions |
| 07–08 | Investments | explicit snapshot, `NULL`, lineage và currency-separated FIFO |
| 09–10 | Reports | coverage-aware calendar và monthly/annual states |
| 11 | Budgets | thresholds, variance và goal pace |
| 12 | Rules | deterministic condition, toggle và match explanation |
| 13 | Family | ownership, audience, digest và explicit Apply |
| 14 | Settings | account, language, theme, density và backup |

## Vòng 3: advanced surfaces

- Screenshots 16–20: forecast, recurring, fixed costs, investment trend và FX.
- Screenshots 21–26: connectors, parser rescue, family send/receive, settings profiles và evidence viewer.
- Screenshots 27–33: dashboard edit, manual entry, advanced filters, deduplication, card actions, OCR progress và sync diagnostics.

Kiểm tra interaction thật, không chỉ ảnh tĩnh. Demo toast trong prototype phải được thay bằng dialog hoặc native action tương ứng.

## Vòng 4: state và accessibility

- [ ] Loading skeleton và first-run empty state.
- [ ] Empty filter, bulk selection, balanced journal và blocking import states.
- [ ] Keyboard navigation, focus return, Escape và accessible names.
- [ ] Status không phụ thuộc màu.
- [ ] Missing/stale/partial/forecast disclosures hiển thị đúng.
- [ ] Merchant, filename và source content không bị dịch.
- [ ] Browser console không có application error hoặc warning.

## Phương pháp so sánh

Đặt reference và implementation cạnh nhau trước, sau đó dùng overlay 50% hoặc pixel diff để tìm lệch spacing. Chấp nhận sai số tối đa khoảng 2px do font rendering. Khi màu lệch, so computed token thay vì đánh giá bằng mắt.

Mỗi vòng chỉ sửa một nhóm: token, shell, một workspace hoặc một state family. Chụp lại và xác nhận regression trước khi chuyển nhóm.

## Điều kiện hoàn tất

- Các viewport mục tiêu không overflow ngoài chủ ý.
- Light/dark semantic colors nhất quán.
- Tất cả hành động blocking/destructive có hierarchy và confirmation đúng.
- Frontend lint, build, tests và `git diff --check` đều pass.
- Visual evidence được lưu dưới `docs/audits/`; ảnh tạm không commit vào repo.
