# Manual GitHub release

KakeFlow can publish a locally verified release without a GitHub-hosted Actions runner. This path is used while the repository's monthly Actions quota cannot allocate a runner.

The commands below describe the supported release path: an ad-hoc-signed macOS
DMG and, after native Windows evidence exists, an unsigned Windows NSIS
installer. Paid Developer ID/notarization and Authenticode certificate work are
outside project scope. Release notes and download instructions must disclose
the Gatekeeper or SmartScreen warning without claiming verified publisher
identity.

## Release cadence

Capability increments are tested, committed, and pushed to `main` as they are
completed, but they do not automatically create a public version. Full audit,
packaging, artifact validation, tagging, and GitHub Release publication are
reserved for major product milestones. The current release-candidate line is
`v1.0.0`; it becomes the stable public line only after the clean-commit, tag,
artifact and GitHub Release gates below pass. Future public versions follow the
same major-milestone gate.

Do not change the application version, create intermediate tags, or publish
partial installers between those milestones. Focused tests still run with each
capability increment; the complete gate below runs only for a release candidate.
The requirement classification and platform evidence boundary are maintained in
[V1_RELEASE_READINESS.md](V1_RELEASE_READINESS.md).

## Required local gates

```bash
set -euo pipefail
EVIDENCE_ROOT="${PWD}/release-artifacts/v1.0.0/macos"
mkdir -p "${EVIDENCE_ROOT}"
git rev-parse HEAD | tee "${EVIDENCE_ROOT}/commit.txt"
npm run check:update-channel 2>&1 | tee "${EVIDENCE_ROOT}/update-channel.log"
npm run check:versions 2>&1 | tee "${EVIDENCE_ROOT}/version-contract.log"
npm run ocr:stage:mac 2>&1 | tee "${EVIDENCE_ROOT}/ocr-stage.log"
npm run ocr:verify 2>&1 | tee "${EVIDENCE_ROOT}/ocr-verify.log"
npm run desktop:smoke 2>&1 | tee "${EVIDENCE_ROOT}/desktop-smoke.log"
APPLE_SIGNING_IDENTITY=- npm run desktop:build:mac:dmg 2>&1 | tee "${EVIDENCE_ROOT}/build-dmg.log"
KAKEFLOW_SMOKE_ARTIFACT_DIR="${EVIDENCE_ROOT}" npm run test:dmg 2>&1 | tee "${EVIDENCE_ROOT}/dmg-smoke.log"
APPLE_SIGNING_IDENTITY=- npm run desktop:build:mac 2>&1 | tee "${EVIDENCE_ROOT}/build-app.log"
KAKEFLOW_SMOKE_ARTIFACT_DIR="${EVIDENCE_ROOT}" npm run test:packaged 2>&1 | tee "${EVIDENCE_ROOT}/packaged-smoke.log"
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/KakeFlow.app 2>&1 | tee "${EVIDENCE_ROOT}/codesign.log"
shasum -a 256 src-tauri/target/release/bundle/dmg/KakeFlow_1.0.0_aarch64.dmg | tee "${EVIDENCE_ROOT}/SHA256SUMS.txt"
```

The generated OCR runtime is intentionally not stored in Git. A clean release
checkout must stage it first; both macOS bundle commands fail before packaging
when the pinned manifest, binary, models, or TSV configuration are absent.
The `release-artifacts/` evidence directory is also intentionally ignored by
Git. Copy the complete evidence directory to durable release storage before
cleaning the worktree; do not commit financial test data, credentials, generated
binaries, or release evidence to the repository.

The update-channel check must report `DISABLED_UNCONFIGURED`. GitHub Releases
are the only supported distribution channel and users update manually; a normal
GitHub Release and source archives are not automatic-updater evidence.

For a Windows x64 release candidate, run these additional gates on native
Windows rather than on the macOS release host:

```powershell
npm run ocr:stage:windows
npm run ocr:verify
npm run desktop:build:windows
npm run test:packaged
npm run test:windows-installer
```

`desktop:build:windows` verifies an already staged runtime and never downloads
OCR dependencies itself. Archive the generated OCR manifest, verifier output,
packaged WebView evidence, and Windows installer acceptance JSON with the release
evidence. Source inspection or the platform-neutral OCR contract tests on macOS
do not substitute for these native Windows results. Until all commands above
pass on Windows—including the installer harness's second OCR smoke against the
installed resource tree—the release notes must continue to mark Windows
OCR/installer evidence as incomplete.

Run the packaged-app smoke a second time when the change affects persistence,
migrations, import, or application startup. The expected macOS artifact is
ad-hoc signed and not notarized. This limitation is accepted for the direct
GitHub release and must remain visible in the release notes.

## Publish

1. Commit and push the release version.
2. Create an annotated `vVERSION` tag and push it. If a withdrawn legacy tag
   uses the same version, remove that local/remote tag only after the new
   release commit is verified, then recreate it at the verified commit.
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

The checked-in CI and release workflows are intentionally `workflow_dispatch`
only during the quota constraint. They can be re-enabled for push, pull-request,
and tag events when hosted runners are available; this does not require adding
paid signing credentials.
