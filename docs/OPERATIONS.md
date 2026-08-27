# KakeFlow operations / Vận hành / 運用

## English

Canonical project endpoints:

- Source: [github.com/thangldw/kakeflow](https://github.com/thangldw/kakeflow)
- Website: [thangldw.github.io/kakeflow](https://thangldw.github.io/kakeflow/)
- Downloads: [KakeFlow releases](https://github.com/thangldw/kakeflow/releases)

Run `npm ci`, `npm run lint`, `npm test -- --run`, `npm run build`, then Rust format, clippy and tests. Desktop candidates must pass OCR resource verification and packaged smoke tests. Release artifacts are published to `thangldw/kakeflow` under a versioned tag with SHA-256 checksums. The protected `main` branch requires the frontend/release-contract and Rust CI checks.

The stable desktop channel uses signed Tauri updater archives. Keep the private updater key outside the repository and inject `TAURI_SIGNING_PRIVATE_KEY` opaquely from the operator or CI environment while building; its storage mechanism and location must stay outside tracked documentation. Publish the generated updater archive plus its `.sig` file. Run `npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` and upload the resulting `latest.json` beside the installers. Never publish or commit the private key. Existing v1.1.1 installations require one manual upgrade to a build that contains the updater; subsequent releases are checked automatically after startup and can also be checked from Settings.

On macOS, `npm run desktop:release` and `npm run desktop:build:mac:ci` must use the isolated arm64 wrapper because the packaged OCR resource contains exactly one arm64 slice. The wrapper locks one checkout/target atomically, removes only its resolved app/updater/DMG outputs, and writes `kakeflow-build-identity.json` only after a complete success; packaged and DMG smoke tests reject missing or mismatched identities. Never delete a reported lock broadly. If its recorded process is confirmed absent, retry once with `KAKEFLOW_RECOVER_STALE_BUILD_LOCK=1`; an active or malformed lock requires inspection and removal of only the exact reported lock directory. Non-macOS `desktop:release` continues to dispatch directly to Tauri.

Existing v1.2.0 installations query a retired release endpoint and therefore cannot receive automatic updates. Users on v1.2.0 must install v1.2.1 manually from the canonical releases page; v1.2.1 and later builds query this repository directly. Do not recreate a separate release repository.

For OCR release QA, start the local preview and open `/ocr-regression.html`. The page must report that every synthetic PP-OCRv5 case passed. The fixtures contain only invented, anonymized receipt data; their expected date, total, tax and item values are also covered by `npm test`.

Treat temporary ports, comparison copies and release worktrees as disposable local state. Before removing one, confirm that its Git working tree is clean and that every required commit and tag exists on the remote. Keep only the active checkout; move obsolete local copies to Trash first so they remain recoverable. Build output, `node_modules`, Rust `target` directories and updater private keys must never be committed.

GitHub Pages uses **GitHub Actions** as its source. `.github/workflows/pages.yml` builds the production PWA, copies `docs/` to the artifact root and mounts `dist/` at `app/`; do not commit the generated 148 MB build. After each merge, wait for the exact commit's Pages workflow and verify the landing page plus `/kakeflow/app/` online and offline.

The v1.2.1 macOS community binary is ad-hoc signed and not notarized. Do not describe it as a frictionless production installer. A paid Apple Developer Program membership is not maintained, so preserve the explicit ad-hoc/not-notarized disclosure and direct users who want no Gatekeeper installation path to the account-free PWA. Publish future desktop versions only after substantive dependency, test, or release changes pass every gate.

Delete only merged or strict-ancestor feature branches. Keep release tags, changelog entries, migration files and compatibility readers that are required to install, restore or open previously supported data.

## Tiếng Việt

Địa chỉ chính thức của dự án:

- Mã nguồn: [github.com/thangldw/kakeflow](https://github.com/thangldw/kakeflow)
- Website: [thangldw.github.io/kakeflow](https://thangldw.github.io/kakeflow/)
- Bản tải xuống: [KakeFlow releases](https://github.com/thangldw/kakeflow/releases)

Chạy `npm ci`, `npm run lint`, `npm test -- --run`, `npm run build`, sau đó format, clippy và test Rust. Desktop candidate phải đạt kiểm tra OCR resource và packaged smoke. Artifact được publish sang `thangldw/kakeflow` dưới tag theo phiên bản, kèm SHA-256. Nhánh `main` được bảo vệ và yêu cầu hai CI check frontend/release-contract và Rust.

Kênh desktop ổn định dùng artifact Tauri có chữ ký. Giữ private key updater bên ngoài repository và inject `TAURI_SIGNING_PRIVATE_KEY` theo cách opaque từ môi trường operator hoặc CI khi build; không ghi cơ chế lưu trữ hay vị trí vào tài liệu tracked. Sau đó publish archive updater và tệp `.sig`. Chạy `npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` và upload `latest.json` cùng installer. Tuyệt đối không publish hoặc commit private key. Bản v1.1.1 cần nâng cấp thủ công một lần lên bản có updater; từ các bản sau ứng dụng sẽ tự kiểm tra khi khởi động và cho phép kiểm tra trong Cài đặt.

Trên macOS, `npm run desktop:release` và `npm run desktop:build:mac:ci` phải đi qua wrapper arm64 cô lập vì OCR đóng gói chỉ có đúng một slice arm64. Wrapper khóa nguyên tử theo checkout/target, chỉ xóa app/updater/DMG đã resolve của target đó, và chỉ ghi `kakeflow-build-identity.json` sau khi hoàn tất; smoke app/DMG từ chối identity thiếu hoặc lệch. Không xóa lock theo phạm vi rộng. Chỉ sau khi xác nhận process đã dừng mới retry một lần với `KAKEFLOW_RECOVER_STALE_BUILD_LOCK=1`; lock đang hoạt động hoặc metadata hỏng phải được kiểm tra và chỉ xóa đúng thư mục lock được báo. Trên nền tảng khác, `desktop:release` vẫn gọi Tauri trực tiếp.

Các bản v1.2.0 hiện tại truy vấn một endpoint release đã ngừng hoạt động nên không thể tự động cập nhật. Người dùng v1.2.0 phải cài thủ công v1.2.1 từ trang release chính thức; các build từ v1.2.1 trở đi truy vấn trực tiếp repo này. Không tạo lại repo release riêng.

Để QA OCR trước khi release, chạy bản xem trước local và mở `/ocr-regression.html`. Trang phải báo toàn bộ case PP-OCRv5 tổng hợp đã pass. Fixture chỉ chứa dữ liệu biên lai giả lập, đã ẩn danh; ngày, tổng tiền, thuế và giá từng món cũng được kiểm tra trong `npm test`.

Các bản port tạm, thư mục so sánh và release worktree chỉ là dữ liệu local có thể dọn bỏ. Trước khi xoá, phải xác nhận Git working tree sạch và mọi commit/tag cần thiết đã có trên remote. Chỉ giữ checkout đang hoạt động; nên chuyển bản local cũ vào Trash trước để có thể khôi phục. Không commit build output, `node_modules`, thư mục Rust `target` hoặc private key updater.

GitHub Pages dùng **GitHub Actions** làm source. `.github/workflows/pages.yml` build PWA production, copy `docs/` vào root artifact và mount `dist/` tại `app/`; không commit build 148 MB đã generate. Sau mỗi lần merge, chờ Pages workflow của đúng commit rồi kiểm tra landing page và `/kakeflow/app/` cả online lẫn offline.

Binary cộng đồng macOS v1.2.1 được ký ad-hoc và chưa notarize; không mô tả đây là installer production frictionless. Dự án không duy trì gói Apple Developer Program trả phí, vì vậy phải giữ disclosure rõ ràng và hướng người dùng muốn tránh Gatekeeper sang PWA không cần account. Chỉ phát hành desktop version tiếp theo sau khi thay đổi dependency, test hoặc release thực chất vượt qua mọi gate.

Chỉ xoá feature branch đã merge hoặc là ancestor của `main`. Giữ release tag, changelog, migration và compatibility reader cần thiết để cài đặt, restore hoặc mở dữ liệu từng được hỗ trợ.

## 日本語

公式 project endpoint:

- Source: [github.com/thangldw/kakeflow](https://github.com/thangldw/kakeflow)
- Website: [thangldw.github.io/kakeflow](https://thangldw.github.io/kakeflow/)
- Download: [KakeFlow releases](https://github.com/thangldw/kakeflow/releases)

`npm ci`、`npm run lint`、`npm test -- --run`、`npm run build` の後、Rust の format・clippy・test を実行します。デスクトップ候補は OCR resource 検証と packaged smoke を通過する必要があります。成果物は version tag ごとに SHA-256 付きで `thangldw/kakeflow` へ公開します。保護された `main` branch では frontend/release-contract と Rust の CI check が必須です。

stable デスクトップチャンネルでは、署名済み Tauri updater archive を使用します。updater の秘密鍵は repository 外に保存し、build 時に operator または CI の環境から `TAURI_SIGNING_PRIVATE_KEY` を opaque に注入します。保存方法と場所は tracked documentation に記録しません。生成された updater archive と `.sig` を公開し、`npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` で作成した `latest.json` も installer と同じ release に upload します。秘密鍵は公開・commit しないでください。v1.1.1 は updater 搭載版へ一度だけ手動更新が必要で、それ以降は起動後の自動確認と設定画面からの手動確認を利用できます。

macOS の `npm run desktop:release` と `npm run desktop:build:mac:ci` は、同梱 OCR が arm64 slice を 1 つだけ含むため、分離された arm64 wrapper を必ず使用します。wrapper は checkout/target ごとに atomic lock を取得し、resolve 済みの app/updater/DMG だけを削除し、完全成功後だけ `kakeflow-build-identity.json` を書きます。app/DMG smoke は identity の欠落や不一致を拒否します。lock を広範囲に削除してはいけません。記録された process の終了を確認した場合だけ `KAKEFLOW_RECOVER_STALE_BUILD_LOCK=1` で 1 回 retry し、active または不正な lock は調査後に報告された lock directory だけを削除します。macOS 以外の `desktop:release` は Tauri を直接呼び出します。

既存の v1.2.0 は廃止された release endpoint を参照するため、自動更新を受信できません。v1.2.0 の利用者は canonical release page から v1.2.1 を手動でインストールする必要があります。v1.2.1 以降の build は本 repository を直接参照します。別の release repository は再作成しません。

OCR の release QA では local preview を起動し、`/ocr-regression.html` を開きます。匿名の合成 receipt を使うすべての PP-OCRv5 case が passed になることを確認してください。日付・合計・税・品目金額の期待値は `npm test` でも検証されます。

一時 port、比較用 copy、release worktree は破棄可能な local state として扱います。削除前に Git working tree が clean で、必要な commit と tag が remote に存在することを確認してください。使用中の checkout だけを残し、古い local copy は復元できるよう先に Trash へ移動します。build output、`node_modules`、Rust の `target`、updater private key は commit しません。

GitHub Pages の source は **GitHub Actions** です。`.github/workflows/pages.yml` が production PWA を build し、`docs/` を artifact root、`dist/` を `app/` に配置します。生成済み 148 MB build は commit しません。merge ごとに exact commit の Pages workflow を待ち、landing page と `/kakeflow/app/` を online／offline で確認します。

macOS v1.2.1 community binary は ad-hoc 署名済み・未公証で、frictionless production installer と表現しません。有料 Apple Developer Program は維持していないため、この disclosure を明示し、Gatekeeper の install path を避けたい利用者には account 不要の PWA を案内します。今後の desktop version は、実質的な dependency／test／release 変更が全 gate を通過した場合だけ公開します。

削除する feature branch は merge 済み、または `main` の strict ancestor に限ります。過去に対応したデータの install／restore／open に必要な release tag、changelog、migration、compatibility reader は保持します。
