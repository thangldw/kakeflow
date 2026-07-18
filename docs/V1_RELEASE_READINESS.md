# KakeFlow v1 release readiness

This contract separates locally verifiable product quality from provider, platform, and distribution evidence.

## Local gates

- Ledger, reconciliation, portfolio, reports, evidence, rules, family, and durable Inbox tests pass.
- All released adapters preserve physical provenance and explicit mapping.
- Drive/Gmail remain read-only and review-gated.
- PP-OCRv5/ONNX assets and Tesseract compatibility resources verify.
- npm, Cargo, Tauri, docs, project page, and artifact versions match.
- Update channel stays disabled.
- Manual release gates pass from a clean commit.

`npm run check:versions` and `npm run check:update-channel` enforce structural consistency. Full audit/package/tag/publication is reserved for substantial release milestones.

## Platform evidence

| Platform | Required evidence |
| --- | --- |
| macOS | Pinned OCR, packaged WebView smoke, read-only DMG, signature structure, SHA-256 |
| Windows | Native OCR, NSIS install, installed-app smoke, resource/version checks, silent uninstall, SHA-256 |

Evidence from one operating system cannot substitute for another.

## External boundaries

Google connectors require provider qualification and packaged real-account validation. Paid Apple/Windows publisher signing, stores, and signed automatic updates are outside funded scope; warnings must remain disclosed.

Direct bank/card/brokerage/aggregation APIs are permanently outside scope for legal/licensing reasons. Native mobile capture, broader automatic multi-device coordination, and more adapters remain separate roadmap tracks.

Version 1.0.0 advertises only the verified macOS Apple Silicon artifact. Windows and unqualified connectors remain unavailable or explicitly test-only.
