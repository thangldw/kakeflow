# KakeFlow security / Bảo mật / セキュリティ

## Supported versions

Security fixes are provided for the latest stable release only. Upgrade to the newest version before reporting an issue that may already be resolved.

## Reporting a vulnerability

Use [GitHub Security Advisories](https://github.com/thangldw/kakeflow/security/advisories/new) to report vulnerabilities privately. Include the affected version, reproducible steps, impact and a minimal proof using invented data. Do not open a public issue before the maintainer has had a reasonable opportunity to investigate.

Never submit financial records, account numbers, OAuth tokens, encryption keys, updater signing keys or local KakeFlow databases. KakeFlow does not operate a bug bounty program and cannot promise payment for reports.

KakeFlow's authoritative ledger and evidence vault are local. Gmail, Google Drive, family relay, mobile capture and the signed update channel are optional network boundaries; reports involving them should state whether the issue occurs before evidence is staged, during review, or after ledger posting. Compatibility readers for older encrypted backups and evidence formats remain in scope while supported by tests.

### Known upstream risk: `glib` on Linux

GHSA-wrw7-89jp-8q8g-55p8 applies to `glib` 0.18.5 in the Linux GUI dependency path `tauri -> webkit2gtk/gtk -> glib`. The dependency is absent from the current macOS release graph, and KakeFlow does not directly call `VariantStrIter`. The maintained Tauri/GTK dependency line does not yet provide a compatible patched `glib` release; forcing a second major line would not replace the affected path. Re-evaluate this risk before any Linux release and whenever Tauri migrates to a patched GTK/`glib` graph.

## Tiếng Việt

Chỉ phiên bản ổn định mới nhất được nhận bản sửa bảo mật. Báo cáo lỗ hổng riêng tư qua [GitHub Security Advisories](https://github.com/thangldw/kakeflow/security/advisories/new), sử dụng dữ liệu giả lập và không đăng issue công khai trước khi maintainer có thời gian xử lý.

Không gửi chứng từ tài chính, số tài khoản, OAuth token, khóa mã hóa, updater signing key hoặc database KakeFlow. Dự án không vận hành chương trình bug bounty và không cam kết trả thưởng.

Sổ cái authoritative và evidence vault nằm trên thiết bị. Gmail, Google Drive, family relay, mobile capture và kênh update có chữ ký là các network boundary tùy chọn; báo cáo nên nêu lỗi xảy ra trước khi lưu evidence, trong lúc duyệt hay sau khi ghi sổ. Compatibility reader cho backup/evidence mã hóa cũ vẫn thuộc phạm vi hỗ trợ khi còn test tương ứng.

### Rủi ro upstream đã biết: `glib` trên Linux

GHSA-wrw7-89jp-8q8g-55p8 áp dụng cho `glib` 0.18.5 trong dependency path của Linux GUI: `tauri -> webkit2gtk/gtk -> glib`. Dependency này không có trong release graph macOS hiện tại và KakeFlow không gọi trực tiếp `VariantStrIter`. Dòng dependency Tauri/GTK đang được duy trì chưa cung cấp bản `glib` đã vá mà vẫn tương thích; ép thêm một major line thứ hai sẽ không thay thế affected path. Phải đánh giá lại rủi ro trước mọi bản phát hành Linux và mỗi khi Tauri chuyển sang GTK/`glib` graph đã vá.

## 日本語

セキュリティ修正は最新の安定版のみを対象とします。[GitHub Security Advisories](https://github.com/thangldw/kakeflow/security/advisories/new) から非公開で報告し、再現には架空データを使用してください。maintainer が調査する前に公開 issue を作成しないでください。

金融記録、口座番号、OAuth token、暗号鍵、updater signing key、KakeFlow の local database を送信しないでください。本 project は bug bounty を運営しておらず、報酬を保証しません。

authoritative ledger と evidence vault は端末内にあります。Gmail、Google Drive、family relay、mobile capture、署名済み update channel は任意の network boundary です。報告では、問題が evidence 保存前、確認中、台帳反映後のどこで発生するかを明記してください。test で対応する旧暗号化 backup／evidence format の compatibility reader も support scope に含まれます。

### 既知の upstream risk: Linux の `glib`

GHSA-wrw7-89jp-8q8g-55p8 は、Linux GUI の dependency path `tauri -> webkit2gtk/gtk -> glib` に含まれる `glib` 0.18.5 に該当します。この dependency は現在の macOS release graph には存在せず、KakeFlow は `VariantStrIter` を直接呼び出していません。現在保守されている Tauri/GTK dependency line には、互換性を保った修正版 `glib` がまだありません。別 major line を追加しても affected path は置き換わりません。Linux release の前、および Tauri が修正版 GTK/`glib` graph へ移行するたびに、この risk を再評価します。
