# Release

KakeFlow uses one semantic version across `package.json`, the lockfile, Tauri configuration, Cargo metadata, UI version text, and update metadata.

## Preflight

```bash
npm ci
npm run check:versions
npm run lint
npm test -- --run
npm run build
cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Verify OCR resources before packaging. Build macOS artifacts with `npm run desktop:build:mac:ci`; Windows NSIS artifacts are produced on Windows with `npm run desktop:build:windows`.

## Publication

1. Commit the reviewed source and create the signed or annotated `vX.Y.Z` tag.
2. Build artifacts from that exact tag.
3. Run packaged-app and installer smoke tests on each platform.
4. Generate SHA-256 checksums and publish them beside the artifacts.
5. Publish the source release in `thangldw/kakeflow`.
6. Mirror public installers, checksums and release notes to `thangldw/kakeflow-releases`.
7. Verify the product-page download link and the GitHub `latest` endpoints.

Never claim notarization, signing, Windows support, or automatic updates unless the published artifact has corresponding evidence.
