# KakeFlow operations / Vận hành / 運用

## English

Canonical project endpoints:

- Source: [github.com/thangldw/kakeflow](https://github.com/thangldw/kakeflow)
- Website: [thangldw.github.io/kakeflow](https://thangldw.github.io/kakeflow/)
- Downloads: [KakeFlow releases](https://github.com/thangldw/kakeflow/releases)

Run `npm ci`, `npm run lint`, `npm test -- --run`, `npm run build`, then Rust format, clippy and tests. Desktop candidates must pass OCR resource verification and packaged smoke tests. Release artifacts are published to `thangldw/kakeflow` under a versioned tag with SHA-256 checksums. The protected `main` branch requires the frontend/release-contract and Rust CI checks.

The stable desktop channel uses signed Tauri updater archives. Keep the private updater key outside the repository, set `TAURI_SIGNING_PRIVATE_KEY` to that local key path while building, and publish the generated updater archive plus its `.sig` file. Run `npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` and upload the resulting `latest.json` beside the installers. Never publish or commit the private key. Existing v1.1.1 installations require one manual upgrade to a build that contains the updater; subsequent releases are checked automatically after startup and can also be checked from Settings.

Existing v1.2.0 installations query a retired release endpoint and therefore cannot receive automatic updates. Users on v1.2.0 must install the next release manually from the canonical releases page; builds produced from the current source query this repository directly. Do not recreate a separate release repository.

For OCR release QA, start the local preview and open `/ocr-regression.html`. The page must report that every synthetic PP-OCRv5 case passed. The fixtures contain only invented, anonymized receipt data; their expected date, total, tax and item values are also covered by `npm test`.

Treat temporary ports, comparison copies and release worktrees as disposable local state. Before removing one, confirm that its Git working tree is clean and that every required commit and tag exists on the remote. Keep only the active checkout; move obsolete local copies to Trash first so they remain recoverable. Build output, `node_modules`, Rust `target` directories and updater private keys must never be committed.

GitHub Pages must use **GitHub Actions** as its source. `.github/workflows/pages.yml` builds the production PWA, copies `docs/` to the artifact root and mounts `dist/` at `app/`; do not commit the generated 148 MB build. After merge, switch Settings → Pages → Build and deployment → Source from the legacy `main/docs` source to GitHub Actions, run the workflow, then verify the landing page and `/kakeflow/app/` online and offline. Keep the legacy source active until the workflow exists on `main`.

The current v1.2.0 macOS binary is ad-hoc signed and not notarized. Do not describe it as a frictionless production installer. Prefer Developer ID signing and Apple notarization for the next desktop release; otherwise preserve the explicit ad-hoc/not-notarized disclosure. Create `v1.2.1` only after substantive dependency, test, or release changes pass every gate; this documentation or a PWA preview alone does not publish a release.

Delete only merged or strict-ancestor feature branches. Keep release tags, changelog entries, migration files and compatibility readers that are required to install, restore or open previously supported data.

## Tiếng Việt

Địa chỉ chính thức của dự án:

- Mã nguồn: [github.com/thangldw/kakeflow](https://github.com/thangldw/kakeflow)
- Website: [thangldw.github.io/kakeflow](https://thangldw.github.io/kakeflow/)
- Bản tải xuống: [KakeFlow releases](https://github.com/thangldw/kakeflow/releases)

Chạy `npm ci`, `npm run lint`, `npm test -- --run`, `npm run build`, sau đó format, clippy và test Rust. Desktop candidate phải đạt kiểm tra OCR resource và packaged smoke. Artifact được publish sang `thangldw/kakeflow` dưới tag theo phiên bản, kèm SHA-256. Nhánh `main` được bảo vệ và yêu cầu hai CI check frontend/release-contract và Rust.

Kênh desktop ổn định dùng artifact Tauri có chữ ký. Giữ private key updater bên ngoài repository, đặt `TAURI_SIGNING_PRIVATE_KEY` trỏ tới tệp local đó khi build, rồi publish archive updater và tệp `.sig`. Chạy `npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` và upload `latest.json` cùng installer. Tuyệt đối không publish hoặc commit private key. Bản v1.1.1 cần nâng cấp thủ công một lần lên bản có updater; từ các bản sau ứng dụng sẽ tự kiểm tra khi khởi động và cho phép kiểm tra trong Cài đặt.

Các bản v1.2.0 hiện tại truy vấn một endpoint release đã ngừng hoạt động nên không thể tự động cập nhật. Người dùng v1.2.0 phải cài thủ công bản kế tiếp từ trang release chính thức; các build từ mã nguồn hiện tại truy vấn trực tiếp repo này. Không tạo lại repo release riêng.

Để QA OCR trước khi release, chạy bản xem trước local và mở `/ocr-regression.html`. Trang phải báo toàn bộ case PP-OCRv5 tổng hợp đã pass. Fixture chỉ chứa dữ liệu biên lai giả lập, đã ẩn danh; ngày, tổng tiền, thuế và giá từng món cũng được kiểm tra trong `npm test`.

Các bản port tạm, thư mục so sánh và release worktree chỉ là dữ liệu local có thể dọn bỏ. Trước khi xoá, phải xác nhận Git working tree sạch và mọi commit/tag cần thiết đã có trên remote. Chỉ giữ checkout đang hoạt động; nên chuyển bản local cũ vào Trash trước để có thể khôi phục. Không commit build output, `node_modules`, thư mục Rust `target` hoặc private key updater.

GitHub Pages phải dùng **GitHub Actions** làm source. `.github/workflows/pages.yml` build PWA production, copy `docs/` vào root artifact và mount `dist/` tại `app/`; không commit build 148 MB đã generate. Sau khi merge, đổi Settings → Pages → Build and deployment → Source từ legacy `main/docs` sang GitHub Actions, chạy workflow rồi kiểm tra landing page và `/kakeflow/app/` cả online lẫn offline. Giữ source legacy cho tới khi workflow có trên `main`.

Binary macOS v1.2.0 hiện tại được ký ad-hoc và chưa notarize; không mô tả đây là installer production frictionless. Ưu tiên Developer ID signing và Apple notarization cho desktop release tiếp theo; nếu chưa có thì phải giữ disclosure rõ ràng. Chỉ tạo `v1.2.1` sau khi thay đổi dependency, test hoặc release thực chất vượt qua mọi gate; tài liệu hoặc PWA preview tự nó không phát hành release.

Chỉ xoá feature branch đã merge hoặc là ancestor của `main`. Giữ release tag, changelog, migration và compatibility reader cần thiết để cài đặt, restore hoặc mở dữ liệu từng được hỗ trợ.

## 日本語

公式 project endpoint:

- Source: [github.com/thangldw/kakeflow](https://github.com/thangldw/kakeflow)
- Website: [thangldw.github.io/kakeflow](https://thangldw.github.io/kakeflow/)
- Download: [KakeFlow releases](https://github.com/thangldw/kakeflow/releases)

`npm ci`、`npm run lint`、`npm test -- --run`、`npm run build` の後、Rust の format・clippy・test を実行します。デスクトップ候補は OCR resource 検証と packaged smoke を通過する必要があります。成果物は version tag ごとに SHA-256 付きで `thangldw/kakeflow` へ公開します。保護された `main` branch では frontend/release-contract と Rust の CI check が必須です。

stable デスクトップチャンネルでは、署名済み Tauri updater archive を使用します。updater の秘密鍵は repository 外に保存し、build 時だけ `TAURI_SIGNING_PRIVATE_KEY` でそのローカル key path を指定します。生成された updater archive と `.sig` を公開し、`npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` で作成した `latest.json` も installer と同じ release に upload します。秘密鍵は公開・commit しないでください。v1.1.1 は updater 搭載版へ一度だけ手動更新が必要で、それ以降は起動後の自動確認と設定画面からの手動確認を利用できます。

既存の v1.2.0 は廃止された release endpoint を参照するため、自動更新を受信できません。v1.2.0 の利用者は canonical release page から次の release を手動でインストールする必要があります。現在の source から生成した build は本 repository を直接参照します。別の release repository は再作成しません。

OCR の release QA では local preview を起動し、`/ocr-regression.html` を開きます。匿名の合成 receipt を使うすべての PP-OCRv5 case が passed になることを確認してください。日付・合計・税・品目金額の期待値は `npm test` でも検証されます。

一時 port、比較用 copy、release worktree は破棄可能な local state として扱います。削除前に Git working tree が clean で、必要な commit と tag が remote に存在することを確認してください。使用中の checkout だけを残し、古い local copy は復元できるよう先に Trash へ移動します。build output、`node_modules`、Rust の `target`、updater private key は commit しません。

GitHub Pages の source は **GitHub Actions** を使用します。`.github/workflows/pages.yml` が production PWA を build し、`docs/` を artifact root、`dist/` を `app/` に配置します。生成済み 148 MB build は commit しません。merge 後、Settings → Pages → Build and deployment → Source を legacy `main/docs` から GitHub Actions へ変更し、workflow 実行後に landing page と `/kakeflow/app/` を online／offline で確認します。workflow が `main` に入るまでは legacy source を維持します。

現在の macOS v1.2.0 binary は ad-hoc 署名済み・未公証で、frictionless production installer と表現しません。次の desktop release では Developer ID 署名と Apple notarization を優先し、未対応なら明示的な disclosure を維持します。`v1.2.1` は実質的な dependency／test／release 変更が全 gate を通過した場合だけ作成し、documentation または PWA preview だけでは release しません。

削除する feature branch は merge 済み、または `main` の strict ancestor に限ります。過去に対応したデータの install／restore／open に必要な release tag、changelog、migration、compatibility reader は保持します。
