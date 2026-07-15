# Claude Design v2 implementation audit — 2026-07-16

## Phạm vi

- Nguồn thiết kế: `KakeFlow v2.dc.html` trong mockup Claude Design do người dùng cung cấp.
- Viewport chuẩn: 1440 × 900.
- Trạng thái kiểm tra: browser preview, dữ liệu mẫu hiện có của KakeFlow.
- Màn hình đã đối chiếu: Home, Transactions, Import, Cards, Investments, Reports, Budgets, Rules, Family và Settings.

## Ngôn ngữ thiết kế đã áp dụng

- Sidebar trắng 230 px, điều hướng chia nhóm theo nghiệp vụ và header 62 px.
- Nền canvas xám lạnh, surface trắng, viền mảnh và bán kính góc nhỏ.
- Primary navy; income xanh lam; expense đỏ gạch; asset teal; liability violet.
- Typography ưu tiên Noto Sans JP/System UI, số liệu dùng IBM Plex Mono.
- Mật độ desktop cao, KPI nhỏ gọn, bảng theo hàng ngang và biểu đồ cột/horizontal bar.
- Light/dark theme và bộ đổi ngôn ngữ Nhật/Anh/Việt đặt trực tiếp trên topbar.

## QA hình ảnh

Ảnh nguồn nằm trong `source/`, ảnh triển khai nằm trong `implementation/`, ảnh đối chiếu cạnh nhau nằm trong `comparison/`.

### Vòng 1

- P1: hàng giao dịch bị nén do selector `.table-panel .transaction-row` cũ có độ ưu tiên cao hơn grid mới.
- Sửa: chuẩn hóa grid 5 cột, đặt `width: 100%`, bảo vệ `min-width: 0` và thêm ellipsis một dòng.
- Kết quả: tên cửa hàng, chi tiết, category, account và amount giữ đúng nhịp bảng ở 1440 px.

### Vòng 2

- P2: các mục sidebar trong dark mode thiếu tương phản.
- Sửa: đặt token màu riêng cho navigation item và section caption ở dark theme.
- Kết quả: trạng thái thường/active đọc rõ, vẫn giữ sự tập trung cho nội dung chính.

## Sai khác có chủ đích

- Browser preview chỉ có năm giao dịch mẫu; mockup hiển thị mười dòng. Đây là khác biệt dữ liệu, không phải khác biệt component.
- Action Center của browser preview giữ thông báo desktop-only theo hành vi sản phẩm và regression test hiện có.
- Cards, Investments và Rules dùng dữ liệu/state thật của ứng dụng; không chèn dữ liệu giả chỉ để giống ảnh tĩnh.
- Các workflow sâu hiện có của KakeFlow được giữ nguyên, chỉ thay shell, hierarchy và visual tokens.

## Kiểm tra chức năng

- Chuyển Nhật → Anh → Việt hoạt động và cập nhật navigation/header.
- Theme toggle hoạt động cả ở browser preview và chuyển đúng `data-theme`.
- Điều hướng Home/Transactions/Import/Cards/Rules/Settings hoạt động.
- Console browser: không có lỗi.
- ESLint: pass.
- TypeScript + Vite production build: pass.
- Vitest: 701/701 test pass trên toàn bộ 102 test files.

## Kết luận

Không còn lỗi P0, P1 hoặc P2 trong phạm vi redesign. Giao diện triển khai bám đúng hướng Claude Design v2 nhưng vẫn bảo toàn mô hình dữ liệu, workflow và trạng thái thật của KakeFlow.

final result: passed
