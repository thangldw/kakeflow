# KakeFlow v2 — đặc tả P1 bổ sung

Các đặc tả dưới đây hoàn thiện những trạng thái quan trọng chưa được mô tả đủ trong handoff ban đầu.

## Balance basis chưa hỗ trợ

Backend chỉ hỗ trợ `ACCRUAL` và `CASH`. Tuỳ chọn `残高` trong Transactions và Calendar phải hiển thị nhưng disabled thật:

- không đổi state khi click;
- dùng token disabled và `cursor: default`;
- có tooltip keyboard-accessible: `残高ベースは読み取りモデル対応後に有効になります`;
- không mô phỏng hành động rồi mới báo lỗi.

Khi read model hỗ trợ balance basis, chỉ bỏ trạng thái disabled sau khi contract và tests được cập nhật.

## Capture lifecycle

File local, watched-folder hoặc mobile-relay tạo card ngay theo chuỗi:

```text
受信済み → OCR待ち → OCR実行中 → OCR完了 → インポートへ昇格
```

- Preview bản gốc xuất hiện trước khi OCR hoàn tất.
- Promotion bị khoá trong lúc hash/OCR chưa xong.
- OCR progress và confidence dùng status text, không chỉ dùng màu.
- OCR failure có retry; SHA duplicate trỏ tới file đã tồn tại và không tạo card thứ hai.
- Source label phân biệt local, watched folder và mobile transfer.

## Dashboard layout edit

- `レイアウト編集` bật edit mode tại Home.
- Mỗi widget có drag handle và hành động hide.
- Drop target có indicator primary 2px.
- Widget ẩn nằm trong restore tray.
- Sticky action bar gồm reset template, cancel và done.
- Luôn giữ ít nhất một widget hiển thị.
- Layout được lưu theo household và template, đồng thời tham gia replication contract.

## Transaction bulk attribution và advanced filter

- Bulk bar có `帰属の変更` cho shared hoặc từng member.
- Attribution không thay đổi source-document audience.
- Advanced filter hỗ trợ calculation target, labels, tags và account group.
- Active values trở thành removable chips; Clear xoá toàn bộ advanced filters.

## Manual transaction

- Toolbar mở dialog double-entry hai cột.
- Debit/credit difference luôn hiển thị và phải bằng 0 trước khi post.
- Evidence chain ghi source là manual, không tạo source row giả.

## Deduplication

Candidate exact/probable duplicate cung cấp ba quyết định: link existing, keep both, exclude.

- Không có quyết định mặc định.
- Bulk approval chỉ chọn candidate hợp lệ và đã resolve.
- Compact labels vẫn phải có accessible name đầy đủ.

## Card actions

Statement card cho phép đổi settlement account, override due date và unlink reconciliation. Mỗi hành động phải dùng native workflow hiện có, lưu audit trail và cập nhật coverage; UI không được mô phỏng thanh toán.

## Settings diagnostics

Settings hiển thị relay status, pending envelopes, local key fingerprint, unapplied receipts và connector state. Secrets không xuất hiện trong logs, toast hoặc diagnostics copy.

## Quy tắc chung

- Review-before-post và explicit Apply không được bỏ qua.
- Forecast, partial coverage và missing data luôn có disclosure.
- Demo toast trong prototype đại diện cho production action thật, không phải hành vi cuối cùng.
- Screenshot 27–33 là tham chiếu trực tiếp cho các flow bổ sung.
