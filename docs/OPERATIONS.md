# KakeFlow operations / Vận hành / 運用

## English

Canonical project endpoints:

- Source: [github.com/thangldw/kakeflow](https://github.com/thangldw/kakeflow)
- Website: [thangldw.github.io/kakeflow](https://thangldw.github.io/kakeflow/)
- Downloads: [KakeFlow releases](https://github.com/thangldw/kakeflow/releases)

Run `npm ci`, `npm run lint`, `npm test -- --run`, `npm run build`, then Rust format, clippy and tests. Desktop candidates must pass OCR resource verification and packaged smoke tests. Release artifacts are published to `thangldw/kakeflow` under a versioned tag with SHA-256 checksums. The protected `main` branch requires the frontend/release-contract and Rust CI checks.

The stable desktop channel uses signed Tauri updater archives. Keep the private updater key outside the repository, set `TAURI_SIGNING_PRIVATE_KEY` to that local key path while building, and publish the generated updater archive plus its `.sig` file. Run `npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` and upload the resulting `latest.json` beside the installers. Never publish or commit the private key. Existing v1.1.1 installations require one manual upgrade to a build that contains the updater; subsequent releases are checked automatically after startup and can also be checked from Settings.

Existing v1.2.0 installations still query `thangldw/kakeflow-releases`. Keep that repository as a read-only compatibility mirror until a newer archive signed with the v1.2.0 updater key has been published there and redirects subsequent updates to this repository.

For OCR release QA, start the local preview and open `/ocr-regression.html`. The page must report that every synthetic PP-OCRv5 case passed. The fixtures contain only invented, anonymized receipt data; their expected date, total, tax and item values are also covered by `npm test`.

Treat temporary ports, comparison copies and release worktrees as disposable local state. Before removing one, confirm that its Git working tree is clean and that every required commit and tag exists on the remote. Keep only the active checkout; move obsolete local copies to Trash first so they remain recoverable. Build output, `node_modules`, Rust `target` directories and updater private keys must never be committed.

## Tiếng Việt

Địa chỉ chính thức của dự án:

- Mã nguồn: [github.com/thangldw/kakeflow](https://github.com/thangldw/kakeflow)
- Website: [thangldw.github.io/kakeflow](https://thangldw.github.io/kakeflow/)
- Bản tải xuống: [KakeFlow releases](https://github.com/thangldw/kakeflow/releases)

Chạy `npm ci`, `npm run lint`, `npm test -- --run`, `npm run build`, sau đó format, clippy và test Rust. Desktop candidate phải đạt kiểm tra OCR resource và packaged smoke. Artifact được publish sang `thangldw/kakeflow` dưới tag theo phiên bản, kèm SHA-256. Nhánh `main` được bảo vệ và yêu cầu hai CI check frontend/release-contract và Rust.

Kênh desktop ổn định dùng artifact Tauri có chữ ký. Giữ private key updater bên ngoài repository, đặt `TAURI_SIGNING_PRIVATE_KEY` trỏ tới tệp local đó khi build, rồi publish archive updater và tệp `.sig`. Chạy `npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` và upload `latest.json` cùng installer. Tuyệt đối không publish hoặc commit private key. Bản v1.1.1 cần nâng cấp thủ công một lần lên bản có updater; từ các bản sau ứng dụng sẽ tự kiểm tra khi khởi động và cho phép kiểm tra trong Cài đặt.

Các bản v1.2.0 hiện tại vẫn truy vấn `thangldw/kakeflow-releases`. Giữ repo đó làm compatibility mirror chỉ đọc cho đến khi phát hành tại đó một archive mới được ký bằng updater key của v1.2.0 và chuyển các lần cập nhật tiếp theo về repo này.

Để QA OCR trước khi release, chạy bản xem trước local và mở `/ocr-regression.html`. Trang phải báo toàn bộ case PP-OCRv5 tổng hợp đã pass. Fixture chỉ chứa dữ liệu biên lai giả lập, đã ẩn danh; ngày, tổng tiền, thuế và giá từng món cũng được kiểm tra trong `npm test`.

Các bản port tạm, thư mục so sánh và release worktree chỉ là dữ liệu local có thể dọn bỏ. Trước khi xoá, phải xác nhận Git working tree sạch và mọi commit/tag cần thiết đã có trên remote. Chỉ giữ checkout đang hoạt động; nên chuyển bản local cũ vào Trash trước để có thể khôi phục. Không commit build output, `node_modules`, thư mục Rust `target` hoặc private key updater.

## 日本語

公式 project endpoint:

- Source: [github.com/thangldw/kakeflow](https://github.com/thangldw/kakeflow)
- Website: [thangldw.github.io/kakeflow](https://thangldw.github.io/kakeflow/)
- Download: [KakeFlow releases](https://github.com/thangldw/kakeflow/releases)

`npm ci`、`npm run lint`、`npm test -- --run`、`npm run build` の後、Rust の format・clippy・test を実行します。デスクトップ候補は OCR resource 検証と packaged smoke を通過する必要があります。成果物は version tag ごとに SHA-256 付きで `thangldw/kakeflow` へ公開します。保護された `main` branch では frontend/release-contract と Rust の CI check が必須です。

stable デスクトップチャンネルでは、署名済み Tauri updater archive を使用します。updater の秘密鍵は repository 外に保存し、build 時だけ `TAURI_SIGNING_PRIVATE_KEY` でそのローカル key path を指定します。生成された updater archive と `.sig` を公開し、`npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` で作成した `latest.json` も installer と同じ release に upload します。秘密鍵は公開・commit しないでください。v1.1.1 は updater 搭載版へ一度だけ手動更新が必要で、それ以降は起動後の自動確認と設定画面からの手動確認を利用できます。

既存の v1.2.0 は引き続き `thangldw/kakeflow-releases` を参照します。v1.2.0 の updater key で署名した新しい archive を同 repository に公開し、その後の更新先を本 repository に切り替えるまでは、読み取り専用の compatibility mirror として維持してください。

OCR の release QA では local preview を起動し、`/ocr-regression.html` を開きます。匿名の合成 receipt を使うすべての PP-OCRv5 case が passed になることを確認してください。日付・合計・税・品目金額の期待値は `npm test` でも検証されます。

一時 port、比較用 copy、release worktree は破棄可能な local state として扱います。削除前に Git working tree が clean で、必要な commit と tag が remote に存在することを確認してください。使用中の checkout だけを残し、古い local copy は復元できるよう先に Trash へ移動します。build output、`node_modules`、Rust の `target`、updater private key は commit しません。
