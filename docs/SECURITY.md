# KakeFlow security / Bảo mật / セキュリティ

## Supported versions

Security fixes are provided for the latest stable release only. Upgrade to the newest version before reporting an issue that may already be resolved.

## Reporting a vulnerability

Use [GitHub Security Advisories](https://github.com/thangldw/kakeflow/security/advisories/new) to report vulnerabilities privately. Include the affected version, reproducible steps, impact and a minimal proof using invented data. Do not open a public issue before the maintainer has had a reasonable opportunity to investigate.

Never submit financial records, account numbers, OAuth tokens, encryption keys, updater signing keys or local KakeFlow databases. KakeFlow does not operate a bug bounty program and cannot promise payment for reports.

KakeFlow's authoritative ledger and evidence vault are local. Gmail, Google Drive, family relay, mobile capture and the signed update channel are optional network boundaries; reports involving them should state whether the issue occurs before evidence is staged, during review, or after ledger posting. Compatibility readers for older encrypted backups and evidence formats remain in scope while supported by tests.

### Known upstream risk: `glib` on Linux

GHSA-wrw7-89jp-8q8g-55p8 applies to `glib` 0.18.5 in the Linux GUI dependency path `tauri -> webkit2gtk/gtk -> glib`. The dependency is absent from the current macOS release graph, and KakeFlow does not directly call `VariantStrIter`. The maintained Tauri/GTK dependency line does not yet provide a compatible patched `glib` release; forcing a second major line would not replace the affected path. Re-evaluate this risk before any Linux release and whenever Tauri migrates to a patched GTK/`glib` graph.

### PWA vault and browser boundary

PWA records use Argon2id-derived, non-extractable AES-GCM keys and authenticated per-record envelopes. Export archives encrypt their manifest and every event, projection, and evidence payload; restore validates all entries in a staging vault before atomic activation. The passphrase and unwrapped key are not persisted or service-worker cached.

At-rest encryption does not protect an unlocked vault from code already executing in the KakeFlow origin, a compromised browser or extension, or a compromised device session. Browser storage can be evicted even after persistent storage is requested. Keep a verified encrypted archive outside browser storage before clearing site data, changing browser profiles, or relying on the PWA as the only copy.

The production CSP keeps scripts and connections same-origin and disallows inline script, but the bundled PP-OCRv5/OpenCV runtime currently requires `script-src 'unsafe-eval'`. This increases the impact of any same-origin script injection. No third-party runtime script is loaded; dependency removal or replacement must be re-evaluated before claiming an eval-free CSP.

## Tiếng Việt

Chỉ phiên bản ổn định mới nhất được nhận bản sửa bảo mật. Báo cáo lỗ hổng riêng tư qua [GitHub Security Advisories](https://github.com/thangldw/kakeflow/security/advisories/new), sử dụng dữ liệu giả lập và không đăng issue công khai trước khi maintainer có thời gian xử lý.

Không gửi chứng từ tài chính, số tài khoản, OAuth token, khóa mã hóa, updater signing key hoặc database KakeFlow. Dự án không vận hành chương trình bug bounty và không cam kết trả thưởng.

Sổ cái authoritative và evidence vault nằm trên thiết bị. Gmail, Google Drive, family relay, mobile capture và kênh update có chữ ký là các network boundary tùy chọn; báo cáo nên nêu lỗi xảy ra trước khi lưu evidence, trong lúc duyệt hay sau khi ghi sổ. Compatibility reader cho backup/evidence mã hóa cũ vẫn thuộc phạm vi hỗ trợ khi còn test tương ứng.

### Rủi ro upstream đã biết: `glib` trên Linux

GHSA-wrw7-89jp-8q8g-55p8 áp dụng cho `glib` 0.18.5 trong dependency path của Linux GUI: `tauri -> webkit2gtk/gtk -> glib`. Dependency này không có trong release graph macOS hiện tại và KakeFlow không gọi trực tiếp `VariantStrIter`. Dòng dependency Tauri/GTK đang được duy trì chưa cung cấp bản `glib` đã vá mà vẫn tương thích; ép thêm một major line thứ hai sẽ không thay thế affected path. Phải đánh giá lại rủi ro trước mọi bản phát hành Linux và mỗi khi Tauri chuyển sang GTK/`glib` graph đã vá.

### Vault PWA và browser boundary

Record PWA dùng key AES-GCM non-extractable dẫn xuất bằng Argon2id cùng authenticated envelope riêng cho từng record. Archive export mã hóa manifest, event, projection và evidence; restore kiểm tra toàn bộ trong staging vault trước khi activate nguyên tử. Passphrase và key đã mở không được persist hoặc cache bởi service worker.

Mã hóa at rest không bảo vệ vault đang unlock trước code đã chạy trong origin KakeFlow, browser/extension bị xâm nhập hoặc device session bị chiếm quyền. Browser storage vẫn có thể bị eviction dù đã request persistence. Cần giữ một encrypted archive đã kiểm tra ở ngoài browser storage trước khi xóa site data, đổi profile hoặc dùng PWA làm bản duy nhất.

CSP production giữ script và kết nối cùng origin, đồng thời cấm inline script, nhưng runtime PP-OCRv5/OpenCV đóng gói hiện cần `script-src 'unsafe-eval'`. Điều này làm tăng tác động của lỗ hổng same-origin script injection. Không tải runtime script bên thứ ba; phải đánh giá lại dependency trước khi tuyên bố CSP không dùng eval.

## 日本語

セキュリティ修正は最新の安定版のみを対象とします。[GitHub Security Advisories](https://github.com/thangldw/kakeflow/security/advisories/new) から非公開で報告し、再現には架空データを使用してください。maintainer が調査する前に公開 issue を作成しないでください。

金融記録、口座番号、OAuth token、暗号鍵、updater signing key、KakeFlow の local database を送信しないでください。本 project は bug bounty を運営しておらず、報酬を保証しません。

authoritative ledger と evidence vault は端末内にあります。Gmail、Google Drive、family relay、mobile capture、署名済み update channel は任意の network boundary です。報告では、問題が evidence 保存前、確認中、台帳反映後のどこで発生するかを明記してください。test で対応する旧暗号化 backup／evidence format の compatibility reader も support scope に含まれます。

### 既知の upstream risk: Linux の `glib`

GHSA-wrw7-89jp-8q8g-55p8 は、Linux GUI の dependency path `tauri -> webkit2gtk/gtk -> glib` に含まれる `glib` 0.18.5 に該当します。この dependency は現在の macOS release graph には存在せず、KakeFlow は `VariantStrIter` を直接呼び出していません。現在保守されている Tauri/GTK dependency line には、互換性を保った修正版 `glib` がまだありません。別 major line を追加しても affected path は置き換わりません。Linux release の前、および Tauri が修正版 GTK/`glib` graph へ移行するたびに、この risk を再評価します。

### PWA vault と browser boundary

PWA record は Argon2id で導出した non-extractable AES-GCM key と record ごとの authenticated envelope を使用します。export archive は manifest、event、projection、evidence を暗号化し、restore は staging vault 全体を検証してから原子的に activate します。passphrase と unwrapped key は永続化せず、service worker に cache しません。

at-rest 暗号化は、unlock 中の vault を KakeFlow origin 内で実行中の code、侵害された browser／extension、侵害された device session から保護しません。persistent storage を要求しても browser storage は eviction される可能性があります。site data の削除、profile 変更、PWA を唯一の copy とする前に、検証済み encrypted archive を browser storage 外へ保管してください。

production CSP は script／connection を same-origin に限定し inline script を禁止しますが、同梱 PP-OCRv5／OpenCV runtime は現在 `script-src 'unsafe-eval'` を必要とします。そのため same-origin script injection の影響が増えます。third-party runtime script は読み込まず、eval-free CSP を主張する前に dependency の除去または置換を再評価します。
