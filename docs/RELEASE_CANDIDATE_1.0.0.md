# KakeFlow v1.0.0 release candidate

Ngày kiểm chứng: 2026-07-17

Nhánh: `codex/kakeflow-v2-hardening`

## Kết quả gate

- Version contract và disabled update channel: PASS.
- `npm audit --audit-level=high`: PASS, không có vulnerability.
- Frontend: 106 file test, 721 test pass; lint và production build: PASS.
- Rust: format, clippy, 612 library test và 30 integration test: PASS.
- Relay: 33 test; capture uploader: 7 test: PASS.
- Tesseract compatibility runtime và PaddleOCR PP-OCRv5 resources: PASS.
- Packaged macOS app: hai lần PASS, 11 page, 12 interaction, IPC, schema v68.
- DMG read-only mount và bundle-integrity smoke: PASS.
- Ad-hoc code-sign structure verification: PASS.
- PDF QA: automated manifest PASS và visual review PASS cho 19 trang thuộc năm
  nhóm báo cáo.

## Artifact đã kiểm chứng

- File: `KakeFlow_1.0.0_aarch64.dmg`
- Kiến trúc: macOS Apple Silicon (`aarch64`)
- Kích thước: 70.610.621 byte
- SHA-256: `f15a59c2a5dd7832729cab2c41542443bc2bf1fe3fe9ae678dfc774d3eede18c`
- Signing: ad-hoc; chưa Apple-notarized.
- Evidence local: `release-artifacts/v1.0.0/macos-rc-20260717/`.

## Trạng thái GitHub

- GitHub Release `v1.0.0` cũ đã được xoá ngày 2026-07-17.
- Remote tag `v1.0.0` cũ vẫn trỏ tới commit legacy và chưa được thay.
- Chưa có GitHub Release công khai.

## Điều kiện trước khi publish

1. Xác nhận commit chứa tài liệu này là release commit và working tree sạch.
2. Push release commit lên remote.
3. Xoá tag `v1.0.0` legacy ở local/remote, sau đó tạo annotated tag cùng tên
   tại đúng release commit và xác nhận remote tag peel về commit đó.
4. Tạo GitHub Release thủ công và upload duy nhất DMG đã kiểm chứng.
5. Đọc lại release cùng asset metadata và kiểm tra checksum tải xuống.

Windows chưa được quảng bá hoặc phát hành vì chưa có native Windows x64 OCR,
installer, installed-app smoke và uninstall evidence. Automatic update vẫn tắt.
