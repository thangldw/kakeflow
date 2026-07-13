# Manual GitHub release

KakeFlow can publish a locally verified release without a GitHub-hosted Actions runner. This path is used while the repository's monthly Actions quota cannot allocate a runner.

## Required local gates

```bash
npm run desktop:smoke
APPLE_SIGNING_IDENTITY=- npm run desktop:build:mac:dmg
npm run test:dmg
APPLE_SIGNING_IDENTITY=- npm run desktop:build:mac
npm run test:packaged
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/KakeFlow.app
shasum -a 256 src-tauri/target/release/bundle/dmg/KakeFlow_VERSION_aarch64.dmg
```

Run the packaged-app smoke a second time when the change affects persistence, migrations, import, or application startup. The DMG is ad-hoc signed and is not notarized unless external Apple credentials are configured.

## Publish

1. Commit and push the release version.
2. Create an annotated `vVERSION` tag and push it.
3. Confirm the remote tag peels to the intended release commit.
4. Create a non-draft, non-prerelease GitHub Release from that existing tag and upload only artifacts produced by the gates above.
5. Include the SHA-256, supported architecture, signing/notarization status, and any intentionally missing platform artifact in the release notes.
6. Read the release back with `gh release view` and confirm every asset reports `uploaded`.

Example:

```bash
gh release create vVERSION \
  src-tauri/target/release/bundle/dmg/KakeFlow_VERSION_aarch64.dmg \
  --verify-tag \
  --title "KakeFlow vVERSION" \
  --notes-file RELEASE_NOTES.md
```

Do not claim a Windows release unless a Windows installer was built and tested on Windows. GitHub automatically provides source archives from the verified tag; those archives are not substitutes for a tested installer.

The checked-in release workflow is intentionally `workflow_dispatch` only during the quota constraint. It can be re-enabled for tag pushes after hosted runners and production signing credentials are available again.
