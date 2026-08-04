# KakeFlow operations / Vận hành / 運用

## English

Run `npm ci`, `npm run lint`, `npm test -- --run`, `npm run build`, then Rust format, clippy and tests. Desktop candidates must pass OCR resource verification and packaged smoke tests. Release artifacts are published locally to `thangldw/kakeflow-releases` under `v1.2.0` with SHA-256 checksums.

The stable desktop channel uses signed Tauri updater archives. Keep the private updater key outside the repository, set `TAURI_SIGNING_PRIVATE_KEY` to that local key path while building, and publish the generated updater archive plus its `.sig` file. Run `npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` and upload the resulting `latest.json` beside the installers. Never publish or commit the private key. Existing v1.1.1 installations require one manual upgrade to a build that contains the updater; subsequent releases are checked automatically after startup and can also be checked from Settings.

For OCR release QA, start the local preview and open `/ocr-regression.html`. The page must report that every synthetic PP-OCRv5 case passed. The fixtures contain only invented, anonymized receipt data; their expected date, total, tax and item values are also covered by `npm test`.

## Tiếng Việt

Chạy `npm ci`, `npm run lint`, `npm test -- --run`, `npm run build`, sau đó format, clippy và test Rust. Desktop candidate phải đạt kiểm tra OCR resource và packaged smoke. Artifact được publish local sang `thangldw/kakeflow-releases` dưới tag `v1.2.0` kèm SHA-256.

Kênh desktop ổn định dùng artifact Tauri có chữ ký. Giữ private key updater bên ngoài repository, đặt `TAURI_SIGNING_PRIVATE_KEY` trỏ tới tệp local đó khi build, rồi publish archive updater và tệp `.sig`. Chạy `npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` và upload `latest.json` cùng installer. Tuyệt đối không publish hoặc commit private key. Bản v1.1.1 cần nâng cấp thủ công một lần lên bản có updater; từ các bản sau ứng dụng sẽ tự kiểm tra khi khởi động và cho phép kiểm tra trong Cài đặt.

Để QA OCR trước khi release, chạy bản xem trước local và mở `/ocr-regression.html`. Trang phải báo toàn bộ case PP-OCRv5 tổng hợp đã pass. Fixture chỉ chứa dữ liệu biên lai giả lập, đã ẩn danh; ngày, tổng tiền, thuế và giá từng món cũng được kiểm tra trong `npm test`.

## 日本語

`npm ci`、`npm run lint`、`npm test -- --run`、`npm run build` の後、Rust の format・clippy・test を実行します。デスクトップ候補は OCR resource 検証と packaged smoke を通過する必要があります。成果物は SHA-256 付きで `thangldw/kakeflow-releases` の `v1.2.0` にローカル公開します。

stable デスクトップチャンネルでは、署名済み Tauri updater archive を使用します。updater の秘密鍵は repository 外に保存し、build 時だけ `TAURI_SIGNING_PRIVATE_KEY` でそのローカル key path を指定します。生成された updater archive と `.sig` を公開し、`npm run release:update:manifest -- --version X.Y.Z --artifacts packaging/release/vX.Y.Z` で作成した `latest.json` も installer と同じ release に upload します。秘密鍵は公開・commit しないでください。v1.1.1 は updater 搭載版へ一度だけ手動更新が必要で、それ以降は起動後の自動確認と設定画面からの手動確認を利用できます。

OCR の release QA では local preview を起動し、`/ocr-regression.html` を開きます。匿名の合成 receipt を使うすべての PP-OCRv5 case が passed になることを確認してください。日付・合計・税・品目金額の期待値は `npm test` でも検証されます。
