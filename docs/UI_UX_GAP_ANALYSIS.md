# KakeFlow v2 — UI/UX gap analysis

Đối chiếu cập nhật ngày 2026-07-17 giữa application và toàn bộ handoff tại `design_handoff_kakeflow_v2` (README, IA mapping, P1 specs, visual QA và phase-2 screenshots).

## Kết luận

- **Có trong thiết kế nhưng chưa implement:** không còn mục nào.
- **Đã implement nhưng chưa có vị trí UI/UX trong handoff:** không còn mục nào. Các capability nâng cao đã được đặt vào IA theo `IA_MAPPING.md` mà không thêm top-level navigation.
- `残高` vẫn disabled có chủ đích và có tooltip chính xác theo `P1_SPECS.md`; đây là trạng thái được thiết kế, không phải feature còn thiếu.

## Ma trận đã hoàn tất

| Workspace | Phần đã hoàn tất theo handoff v2 |
|---|---|
| Global shell | Title bar macOS/Windows, sidebar 232px, 11 workspace, household/scope/month controls, light/dark, density, JA/EN/VI navigation và keyboard/focus states |
| Home | Loading skeleton, first-run CTA, Action Center, template presets, drag/drop reorder, show/hide tray, reset/cancel/done và KPI basis semantics |
| Transactions | Type chips, advanced removable filters, bulk category/calculation/attribution/labels/tags, right detail drawer 340px, split remainder `¥0`, manual double-entry dialog, evidence, CSV/Excel/PDF và toast |
| Import | Local/Connector tabs, production master-detail 330px, immutable source, explicit review-before-post, dedup resolution, parser rescue/profiles, protected PDF/OCR, ZIP/EML, Money Forward/brokerage mapping, Drive/Gmail/iCloud/watched-folder flows |
| Capture | JPEG/PNG/PDF ≤25MB, immediate SHA-256 state, local/watched/mobile source labels, explicit OCR then promotion, confidence/progress, discard without deleting audit evidence, live badge; mobile token/background configuration moved to Settings → Connectors |
| Cards | Pill system supports all 8 presentation states with icon+text, explicit bank mapping, due-date override, partial/over/under payment and balance-coverage disclosure |
| Investments | Snapshot, FIFO, trend/valuation tabs; FX, market valuation without interpolation, aggregate history, brokerage-instrument history và period/export reports |
| Reports | 3 primary ARIA tabs, monthly/annual review, forecast/actions, recurring/anomaly/fixed-cost views, SQLite monthly memo và view-level exports |
| Budget/Rules | Threshold/progress/required pace; deterministic rule editor, persisted last-application explanation và create-rule prefill |
| Family/Sync | Receive/send tabs, snapshots, change packages, relay/delivery, conflict review và portable evidence bundles |
| Settings/Evidence | Progressive connector/parser/account-group/export sections, mobile capture connector, backup/restore, full-screen immutable evidence overlay with SHA/source metadata |

Form tạo account group đã được kiểm tra lại sau handoff: tên, loại và CTA nằm
trên cùng một hàng ở desktop, chuyển thành một cột ở mobile, không tạo hàng rỗng
khi chưa có account và không còn kéo CTA thành nút full-width ngoài ý muốn.

## Các mục xác minh ngoài phạm vi implementation

Các mục này không phải gap UI/UX và không chặn trạng thái hoàn tất của code:

1. Chụp ảnh QA trên Windows native runtime để xác nhận caption buttons/font rendering thực tế.
2. Hoàn tất provider qualification và packaged real-account validation trước khi quảng bá Google Drive/Gmail ngoài phạm vi test user.

Các gate local trước đây còn mở đã được xử lý trong hardening 2026-07-17:
Rust toolchain được gọi trực tiếp từ toolchain đã cài, migration/native tests và
clippy được chạy local; production bundle được tách theo vendor và workspace,
đưa chunk chính xuống dưới ngưỡng cảnh báo 500 kB. Đây là kiểm chứng kỹ thuật,
không thay đổi kết luận gap UI/UX ở trên.

## Nguyên tắc nghiệp vụ được giữ nguyên

- Import/Capture không tự post; candidate chỉ vào ledger sau explicit review/approval.
- Transfer và card payment không bị tính lại thành expense.
- Calculation-target chỉ thay đổi analytics inclusion, không thay đổi balance/journal.
- Immutable source, SHA-256 lineage, dedup decision và evidence chain không bị xóa khi đổi UI.
