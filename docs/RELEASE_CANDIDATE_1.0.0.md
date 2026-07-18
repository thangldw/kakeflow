# KakeFlow 1.0.0 release candidate

Verified 2026-07-18 on `codex/kakeflow-v2-hardening`.

## Gate result

- Version and disabled updater: PASS.
- `npm audit --audit-level=high`: PASS.
- Frontend: 106 files / 721 tests, lint, and build: PASS.
- Rust: format, Clippy, 612 library, and 30 integration tests: PASS.
- Relay/capture: 33 and 7 tests: PASS.
- PP-OCRv5 and Tesseract compatibility resources: PASS.
- Packaged macOS: 11 pages / 12 interactions, IPC, schema 68: PASS.
- DMG read-only mount, bundle integrity, and ad-hoc signature structure: PASS.
- PDF manifest and 19-page visual review: PASS.

## Artifact

- File: `KakeFlow_1.0.0_aarch64.dmg`
- Platform: macOS Apple Silicon
- Size: 70,610,649 bytes
- SHA-256: `cc553b8f15a5f8ae29cc66d7dcbd0e648aa3bebf65bc0a6c59f78fb1e563a6e8`
- Signing: ad-hoc; not notarized

Public metadata belongs in `thangldw/kakeflow-releases`. Before publication, confirm the clean release commit/tag, matching public metadata tag, uploaded asset/checksum, and unauthenticated download verification.

Windows remains unadvertised until native x64 OCR, installer, installed-app, and uninstall evidence exists. Automatic update remains disabled.
