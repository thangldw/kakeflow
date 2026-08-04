# Contributing to KakeFlow

Thank you for helping improve KakeFlow. Keep changes focused, reviewable and compatible with the project's local-first accounting boundaries.

## Before opening an issue

- Remove real financial records, account numbers, receipt identifiers, OAuth credentials, encryption keys and local databases.
- Use invented or anonymized fixtures for OCR and import bugs.
- Report security vulnerabilities privately through [GitHub Security Advisories](https://github.com/thangldw/kakeflow/security/advisories/new).

## Development

Requirements: Node.js 20.19+ or 22.12+, Rust 1.97 and the Tauri 2 platform dependencies.

```bash
npm ci
npm run lint
npm test -- --run
npm run build
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
```

For OCR changes, also run `npm run paddleocr:verify`, `npm run ocr:verify` on a staged desktop environment, and the local `/ocr-regression.html` model gate.

## Pull requests

- Create a focused branch and explain the user-facing impact.
- Add or update tests for changed behavior.
- Preserve explicit review before imported data becomes a confirmed ledger entry.
- Keep new functionality local by default. Document every new network boundary.
- Update English, Vietnamese and Japanese copy together when changing visible UI text.
- Do not commit generated installers, local databases, credentials or updater private keys.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
