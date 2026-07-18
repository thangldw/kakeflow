# Manual GitHub release

KakeFlow publishes locally verified binaries through the public [`thangldw/kakeflow-releases`](https://github.com/thangldw/kakeflow-releases) repository. Source remains private; GitHub-hosted Actions are not required for this path.

## Release boundary

- macOS: ad-hoc-signed, non-notarized Apple Silicon DMG.
- Windows: unsigned NSIS only after native Windows OCR/install/launch/uninstall evidence passes.
- Automatic updates: disabled; users install verified releases manually.
- Paid platform signing and store distribution: outside scope.

## Local macOS gates

```bash
npm run check:update-channel
npm run check:versions
npm run ocr:stage:mac
npm run ocr:verify
npm run desktop:smoke
APPLE_SIGNING_IDENTITY=- npm run desktop:build:mac:dmg
npm run test:dmg
APPLE_SIGNING_IDENTITY=- npm run desktop:build:mac
npm run test:packaged
codesign --verify --deep --strict --verbose=2 \
  src-tauri/target/release/bundle/macos/KakeFlow.app
shasum -a 256 \
  src-tauri/target/release/bundle/dmg/KakeFlow_1.0.0_aarch64.dmg
```

Set `KAKEFLOW_SMOKE_ARTIFACT_DIR` to an ignored `release-artifacts/` directory when durable JSON/log evidence is required. OCR and evidence outputs are generated and must not be committed.

On native Windows, additionally run `ocr:stage:windows`, `ocr:verify`, `desktop:build:windows`, `test:packaged`, and `test:windows-installer`. macOS contract tests are not Windows evidence.

## Publish checklist

1. Confirm clean source commit and all gates.
2. Push the source commit and annotated `vVERSION` tag.
3. Confirm the private tag peels to the reviewed commit.
4. Commit notes/checksum only to the public release repository and create the matching metadata tag.
5. Create a non-draft, non-prerelease release from that tag.
6. Upload only verified binaries and checksum.
7. Read back asset state and verify unauthenticated download/checksum.

```bash
gh release create vVERSION \
  src-tauri/target/release/bundle/dmg/KakeFlow_VERSION_aarch64.dmg \
  SHA256SUMS.txt \
  --repo thangldw/kakeflow-releases \
  --verify-tag \
  --title "KakeFlow vVERSION" \
  --notes-file RELEASE_NOTES.md
```

Release notes must disclose missing platform artifacts and signing limitations. Never advertise Windows without native evidence.
