# Báo cáo trạng thái dự án KakeFlow — cập nhật 2026-07-17

## Tóm tắt điều hành

KakeFlow hiện có phiên bản desktop `v1.0.0` đã phát hành và ứng viên local
`v1.1.0` trên nhánh `codex/kakeflow-v2-hardening`. Sổ cái local-first, quy
trình nhập và duyệt dữ liệu, dashboard, đối soát thẻ tín dụng, quản lý đầu tư,
báo cáo, theo dõi thư mục và nền tảng chia sẻ dữ liệu gia đình đều đã được xây
dựng.

Ước lượng tiến độ hiện tại:

- **Sản phẩm desktop cốt lõi theo phạm vi v1:** hoàn thành khoảng **90%**.
- **Tầm nhìn sản phẩm mở rộng**, bao gồm phát hành production, ứng dụng mobile
  native và connector tài liệu cloud dùng rộng rãi: hoàn thành khoảng
  **70–75%**. API trực tiếp tới tổ chức tài chính không thuộc tầm nhìn sản phẩm.

Đây là ước lượng theo phạm vi tính năng, không phải tỷ lệ số dòng code. Một tính
năng chỉ được tính là hoàn thành khi có code, kiểm thử, tích hợp giao diện và tài
liệu mô tả rõ giới hạn dữ liệu. Việc triển khai code, kiểm chứng trên nền tảng
native, phê duyệt từ nhà cung cấp và phát hành công khai được tính riêng.

## Trạng thái phát hành

| Trạng thái | Phiên bản | Bằng chứng |
| --- | --- | --- |
| Bản ổn định công khai mới nhất | `v1.0.0` | Git tag và GitHub Release kèm DMG macOS Apple Silicon đã kiểm thử local |
| Đã triển khai local, chưa phát hành | Ứng viên `v1.1.0` | Handoff v2, deduplication, migration và release hardening nằm trên nhánh checkpoint; metadata `1.1.0` đã đồng bộ |
| Bản phát hành công khai tiếp theo | `v1.1.0` | Code/native/frontend/PDF QA đã đạt; đang tạo bằng chứng app/DMG trước khi có quyết định tag và phát hành GitHub thủ công |

Chu kỳ phát hành đã được chuyển sang theo mốc lớn. Các tính năng nhỏ sẽ được
chạy kiểm thử theo phạm vi, commit và push. Full audit, đóng gói, tạo tag và phát
hành công khai chỉ thực hiện tại các phiên bản lớn như `v1.1` và `v1.2`.

## Các phần đã hoàn thành và phát hành trong v1.0.0

### Nền tảng tài chính

- Sổ cái kép chuẩn hóa với Asset, Liability, Income, Expense, transfer, giao
  dịch mua bằng thẻ và thanh toán dư nợ thẻ.
- Phân bổ giao dịch theo gia đình/thành viên, phạm vi shared/private, nhóm tài
  khoản, calculation target, label, tag, chỉnh sửa hàng loạt và truy ngược dữ
  liệu nguồn.
- Sao kê thẻ, ngày đến hạn, đối soát thanh toán cộng dồn, các trạng thái thanh
  toán một phần, đầy đủ, dư, quá hạn và thiếu tiền mà không tính trùng chi phí.
- Ngân sách, mục tiêu tiết kiệm, lịch tài chính, đánh giá chi phí cố định, phát
  hiện giao dịch định kỳ/bất thường, dự báo ba tháng và Action Center.

### Nhập dữ liệu và bằng chứng nguồn

- Nhập CSV, TSV, XLSX, text PDF, scanned/hybrid PDF, ảnh hóa đơn, ZIP, EML, thư
  mục local, thư mục iCloud/OneDrive/NAS đã đồng bộ, Google Drive dành cho test
  user và Gmail dành cho test user.
- Import Inbox bền vững qua lần khởi động lại, có chọn tài khoản rõ ràng,
  preview, rollback, xử lý trùng lặp, ghép hóa đơn, duyệt item/thuế và ghi sổ
  cân bằng theo một transaction nguyên tử.
- Source viewer cho dòng CSV/Excel, trang PDF và bounding box, ảnh hóa đơn gốc
  cùng lớp OCR overlay.
- Custom parser profile dùng để xử lý file chưa hỗ trợ, cùng các adapter chặt
  chẽ cho những mẫu ngân hàng, thẻ, ví điện tử, chứng khoán và Money Forward đã
  được xác minh.

### Quản lý đầu tư

- Import `assetbalance(all)_*.csv` thành portfolio, position, cash và FX
  snapshot riêng biệt, không chuyển thành giao dịch chi tiêu gia đình.
- Xử lý các giao dịch chứng khoán được hỗ trợ từ SBI, Rakuten Securities và
  Monex: mua, bán, cổ tức, phí, thuế, nạp/rút tiền, split, merger, quyền mua và
  corporate action có điều kiện rõ ràng.
- Tính holdings và realized P&L theo FIFO, lịch sử giá, báo cáo theo nguyên tệ,
  chuyển đổi sang JPY chỉ khi có tỷ giá nguồn, market value, unrealized P&L,
  asset allocation và cảnh báo thiếu giá.

### Dashboard, báo cáo và ứng dụng desktop

- Năm template Home tùy chỉnh: Financial Overview, Household Ledger, Assets &
  Liabilities, Card Reconciliation và Cash Flow.
- Báo cáo tháng/năm, transaction ledger, investment performance và portfolio
  snapshot với drill-down theo phạm vi và trạng thái chất lượng dữ liệu.
- Các nhóm export CSV/XLSX/PDF đã phát hành đến `v1.0.0`, font tiếng Nhật nhúng
  ổn định và công cụ visual QA từng trang PDF bằng Poppler.
- Ứng dụng desktop Tauri, database/vault local, kiểm thử app đóng gói và DMG
  trên macOS, nền tảng đóng gói Windows, backup/restore và updater fail-closed
  đang tắt.

### Nền tảng gia đình và đa thiết bị

- Family Space local, change package có version schema, portable evidence
  bundle, dữ liệu gia đình mã hóa theo người nhận, phân vùng audience, phục hồi
  khi danh sách người nhận thay đổi, duyệt conflict và Apply nguyên tử.
- Relay tham chiếu có xác thực và protocol gửi ảnh hóa đơn từ trình duyệt
  mobile, hàng đợi capture bền vững, Capture Inbox và luồng promotion chỉ tạo dữ
  liệu chờ review.

## Đã triển khai sau v1.0.0, đang chờ phát hành v1.1.0

| Tính năng | Trạng thái code | Trạng thái phát hành |
| --- | --- | --- |
| Áp dụng classification rule đã lưu trong Import Inbox và kiểm tra lại rule bị stale | Đã triển khai và chạy test phạm vi | Chờ audit/package v1.1 |
| Confirm, ignore, restore recurring series và cập nhật forecast/fixed-cost | Đã triển khai và chạy test phạm vi | Chờ audit/package v1.1 |
| Đồng bộ recurring preference qua schema-v5 package và family delivery | Đã triển khai và chạy test phạm vi | Chờ audit/package v1.1 |
| Transaction Ledger PDF dùng cùng phạm vi dữ liệu với CSV/XLSX | Đã triển khai và chạy test phạm vi | Còn thiếu visual QA cho bộ năm báo cáo |
| Sửa liên kết card payment đã confirm và lưu lịch sử audit | Đã triển khai và chạy test phạm vi | Chờ audit/package v1.1 |
| Portfolio Snapshot CSV chi tiết cho đúng snapshot được chọn | Đã triển khai và chạy test phạm vi | Chờ audit/package v1.1 |
| Investment Performance CSV theo năm và nguyên tệ | Đã triển khai và chạy test phạm vi | Chờ audit/package v1.1 |
| Adapter Resona Web入出金明細PLUS 14 trường | Đã triển khai và chạy test phạm vi | Chờ audit/package v1.1 |
| Adapter Mizuho Business Web 13 trường | Đã triển khai và chạy test phạm vi | Chờ audit/package v1.1 |

## Trạng thái kiểm chứng v1.1.0 hiện tại

- Metadata `1.1.0` đã đồng bộ giữa npm, Cargo, Tauri, changelog, README, release
  notes, CTA trên trang dự án và tên artifact.
- `npm run check:versions` đạt.
- `npm run check:update-channel` trả về đúng trạng thái
  `DISABLED_UNCONFIGURED`.
- Bộ regression frontend đạt: **104 file test / 705 test**, không còn React
  `act(...)` warning; ESLint và TypeScript/Vite production build đều đạt.
- Production bundle đã được chia theo vendor/workspace; chunk chính còn
  **312.63 kB**, không còn cảnh báo chunk lớn hơn 500 kB.
- **33 test relay** và **7 test capture uploader** đều đạt.
- Rust đạt `cargo fmt --check`, clippy `-D warnings`, **610 library test** và
  **30 native integration test**. Test tương thích schema v3 đã được sửa đúng
  phạm vi downgrade; migration 0066–0068 áp dụng và integrity check đạt.
- Năm PDF fixture bắt buộc đã render thành **19 trang PNG**. Automated manifest
  đạt và checklist visual review từng trang được ký `PASS` ngày 2026-07-17.
- OCR runtime Tesseract 5.5.2 với `eng+jpn` và 6 file manifest đã verify.
- Packaged-app smoke, DMG smoke, kiểm tra codesign và SHA-256 đang là gate local
  cuối cùng trước khi khóa evidence của ứng viên.
- Chưa có commit release cuối cùng, tag `v1.1.0`, DMG hoặc GitHub Release
  `v1.1.0`.

## Các phần chưa hoàn thành

### Tính năng và độ phủ dữ liệu

1. Các adapter bổ sung cho ngân hàng, thẻ, công ty chứng khoán, lương hưu, bảo
   hiểm, point, mileage, crypto và các nguồn phổ biến khác chưa có parser riêng.
2. Các nghiệp vụ chứng khoán chưa đủ hợp đồng nguồn rõ ràng: margin/derivatives,
   một số hình thức settlement hai tiền tệ, trả góp và revolving card theo từng
   nhà cung cấp.
3. Google Drive và Gmail dùng rộng rãi cho production. Code đã có nhưng chưa
   hoàn tất provider qualification và kiểm thử real-account trên app đóng gói.
4. Ứng dụng native iOS/Android để chụp hóa đơn, có durable storage do nền tảng
   quản lý và background delivery ổn định. Bản hiện tại là client tham chiếu chạy
   trên trình duyệt mobile.
5. Điều phối đa thiết bị tự động ở phạm vi rộng hơn. Luồng hiện tại vẫn yêu cầu
   send/download/review/Apply rõ ràng; automatic Apply chủ động nằm ngoài hợp
   đồng sản phẩm.

Kết nối API trực tiếp với ngân hàng, thẻ tín dụng, công ty chứng khoán hoặc dịch
vụ financial aggregation đã được loại vĩnh viễn khỏi phạm vi vì không có giấy
phép/thoả thuận nhà cung cấp phù hợp và không đáp ứng ranh giới pháp lý của sản
phẩm. KakeFlow tiếp tục theo mô hình file-first, user-controlled và review-gated.

### Phát hành và vận hành

1. OCR staging native Windows x64, chạy installer, smoke app đã cài đặt, kiểm
   thử uninstall và phát hành artifact Windows unsigned qua GitHub Releases.
2. Vận hành production cho relay/mobile delivery, giám sát dịch vụ, quy trình hỗ
   trợ và mức độ sẵn sàng về provider/pháp lý/thương mại.
3. Apple Developer ID/notarization, Windows Authenticode/Azure Artifact Signing,
   Store distribution, automatic update có chữ ký, macOS Intel/universal và
   Windows ARM64 đã được loại khỏi phạm vi được tài trợ. macOS tiếp tục ad-hoc
   signed, Windows unsigned và người dùng cập nhật thủ công từ GitHub Releases.

## Trình tự công việc đề xuất tiếp theo

1. Khóa checkpoint code, build app/DMG từ checkpoint và lưu packaged smoke,
   persistence smoke, DMG/codesign cùng SHA-256 vào release evidence.
2. Chỉ sau khi có quyết định phát hành: push commit, tạo tag annotated `v1.1.0`
   và phát hành DMG đã xác minh theo cách thủ công, không sử dụng GitHub Actions.
3. Chạy gate Windows trên Windows x64 trước khi quảng bá installer Windows.
4. Hoàn tất Google provider qualification và packaged real-account validation
   trước khi mở connector ngoài nhóm test user.
5. Tiếp tục các capability increment bằng kiểm thử theo phạm vi; không chạy full
   audit hoặc release tiếp cho đến mốc lớn `v1.2.0`.

## Nguồn bằng chứng

- [README](../README.md)
- [Changelog](../CHANGELOG.md)
- [Điều kiện sẵn sàng phát hành v1](V1_RELEASE_READINESS.md)
- [Quy trình phát hành GitHub thủ công](MANUAL_GITHUB_RELEASE.md)
- [Visual QA báo cáo PDF](PDF_REPORT_VISUAL_QA.md)
- Lịch sử Git đến nhóm tính năng `09c0be5` và tag/release công khai `v1.0.0`
