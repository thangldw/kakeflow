# KakeFlow v2 — ánh xạ kiến trúc thông tin

Quyết định ngày 2026-07-16: giữ nguyên 11 workspace top-level. Tính năng mới được đặt vào tab thứ cấp, panel hoặc dialog theo tần suất sử dụng; không tạo thêm mục sidebar.

| Khu vực | Tính năng | Vị trí và hình thức |
| --- | --- | --- |
| Home | Tuỳ biến widget | `レイアウト編集` mở edit mode tại chỗ; widget ẩn nằm trong restore tray |
| Transactions | Manual double-entry | Nút toolbar mở dialog hai cột có kiểm tra cân bằng |
| Transactions | Attribution | Section trong detail drawer; độc lập với source audience |
| Transactions | Labels/tags hàng loạt | Giữ trong bulk action bar |
| Transactions | Advanced filters | Popover cuối filter row; active filters thành removable chips |
| Import | Parser rescue | Unsupported-format card mở dialog preview, encoding, delimiter và field mapping |
| Import | ZIP/EML | Container card có cây file con và trạng thái riêng |
| Import | Money Forward mapping | Một hàng cho mỗi institution; commit bị khoá tới khi đủ mapping |
| Import | Brokerage sources | Dùng candidate table chung, thêm trade/settlement fields và securities-account mapping |
| Import | Drive/Gmail/iCloud | Tab `コネクタ`; từng file cần hành động `取り込む` |
| Capture | Mobile relay | Cấu hình tại Settings → Connectors; file đến hiển thị trong Capture với source label |
| Reports | Forecast và actions | Tab `分析・予測`, subview `予測とアクション` |
| Reports | Recurring/anomaly | Subview `定期・異常レビュー` |
| Reports | Fixed costs | Subview `固定費レビュー` |
| Investments | FX summary | Card trong Snapshot, dưới allocation |
| Investments | Valuation trend | Tab `推移・評価`; chỉ dùng snapshot có thật |
| Investments | Aggregate history | Section riêng trong `推移・評価`, có nhãn Money Forward |
| Investments | Period report | Dialog từ FIFO tab |
| Investments | Brokerage history | Position/account click mở detail panel |
| Family | Receive/send | Hai tab nhỏ trong delivery card |
| Family | Change packages | Send tab, nhóm theo audience, có retry state |
| Family | Snapshot review | Receive tab, có diff và conflict summary |
| Family | Evidence bundle | Dialog từ footer Family Space |
| Settings | Backup encryption | Mở rộng backup card hiện có |
| Settings | Connectors and relays | Section `コネクタ`, collapsed mặc định |
| Settings | Parser profiles | Section quản trị riêng |
| Settings | Sync diagnostics | Nằm cùng connector/local sync controls |
| Evidence | Protected PDF | Inline password state trong viewer |
| Evidence | OCR overlays | Canvas liên kết box với normalized values |
| Evidence | Full document viewer | Overlay ba cột mở từ mọi source-evidence action |

## Nguyên tắc placement

- Hành động hằng ngày được đặt trực tiếp ở toolbar hoặc tab.
- Cấu hình ít dùng nằm trong Settings và dùng progressive disclosure.
- Review và evidence ở gần record đang xử lý, không tách thành workspace mới.
- Cấu hình transport không nằm trong Capture hoặc Family; hai workspace đó chỉ vận hành flow đã cấu hình.
- Export xuất hiện trong context đang xem, còn quản trị account group ở Settings.

## Thứ tự tham chiếu thiết kế

1. Reports `分析・予測`.
2. Investments `推移・評価`.
3. Import rescue và connector tab.
4. Family send/snapshot và evidence viewer.
5. Settings connector, parser và diagnostics.

Prototype và screenshots 16–33 là nguồn hình ảnh cho các khu vực trên.
