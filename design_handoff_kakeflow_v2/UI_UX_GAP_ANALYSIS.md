# KakeFlow v2 — kết quả đóng UI/UX gap

Tài liệu này thay thế danh sách gap ban đầu ngày 2026-07-16 bằng trạng thái sau đợt hardening ngày 2026-07-17. Đây là hồ sơ bàn giao lịch sử; source và tests là nguồn sự thật cho hành vi hiện tại.

## Đã hoàn tất

- Shell macOS/Windows, sidebar 232px, workspace header, scroll region và responsive desktop sizing.
- Light/dark token system, typography Nhật/mono, spacing, radius và focus states.
- 11 workspace đúng information architecture.
- Household/scope/period popovers và Settings-only theme/language/density controls.
- Home template, KPI basis, action center, trends, data quality và layout editing.
- Transactions type/advanced filters, bulk actions, manual double-entry, detail, split, attribution và evidence chain.
- Import master-detail review, mapping, deduplication, rescue profiles, connector inboxes và rollback.
- Capture local intake, watched folders, OCR lifecycle, retry, discard, promotion và live state.
- Card identity, eight-state semantics, mapping/due-date/unlink actions và coverage projection.
- Calendar, monthly/annual review, forecast, recurring/anomaly và fixed-cost surfaces.
- Investment snapshot, FIFO, FX, trend, aggregate history và period-report entry.
- Family receive/send, encrypted artifacts, snapshots, conflicts and portable evidence.
- Settings connectors, parser profiles, backup, sync diagnostics và account-group export.
- Full-screen evidence viewer, protected PDF flow và OCR overlays.
- JA/EN/VI navigation and product-copy coverage within the released scope.

## Cố ý chưa bật

| Khu vực | Trạng thái | Lý do |
| --- | --- | --- |
| Balance basis | Disabled | Native read model mới hỗ trợ accrual/cash |
| Google connectors | Test users only | Chờ provider qualification và packaged real-account evidence |
| Windows installer | Source build only | Chờ native installer/OCR/signing evidence |
| Automatic updater | Disabled | Chưa có signing key, endpoint và upgrade evidence |
| macOS notarization | Not notarized | Public artifact hiện dùng ad-hoc signing |

## Các khác biệt được chấp nhận

- Runtime data không cần giống fixture trong screenshot.
- Native control có thể khác vài pixel giữa platform nếu hierarchy và accessibility tương đương.
- Tesseract vẫn được đóng gói như compatibility fallback trong giai đoạn PP-OCRv5 migration.
- Historical audit screenshots có thể giữ trạng thái trước/sau; chúng không phải current visual truth.

## Nguyên tắc duy trì

1. Không hiển thị control như đang hoạt động nếu backend chưa hỗ trợ.
2. Không đưa candidate hoặc capture chưa review vào metric.
3. Không tự sửa source ambiguity hoặc duplicate decision.
4. Không gộp currency hoặc nội suy snapshot khi thiếu bằng chứng.
5. Mọi thay đổi IA mới phải cập nhật `IA_MAPPING.md`, handoff và interaction tests cùng lúc.

Đối chiếu implementation chi tiết nằm trong [`docs/UI_UX_GAP_ANALYSIS.md`](../docs/UI_UX_GAP_ANALYSIS.md).
