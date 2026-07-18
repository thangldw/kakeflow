# Packaged application testing

The packaged smoke harness launches the native artifact users receive and verifies native boot, WebView creation, `app_bootstrap` IPC, real onboarding, all 11 workspace headings/navigation states, SQLCipher migration/integrity, household persistence, usable layout dimensions, and clean exit.

Machine-readable JSON is captured from the packaged WebView after real interaction; it is not inferred from source.

## Isolation

The harness creates a temporary `KAKEFLOW_SMOKE_ROOT`. Smoke mode avoids user application data, OS credential storage, production single-instance locking, and background folder discovery, then removes its database/results unless evidence output or debug retention is requested.

`KAKEFLOW_PACKAGED_SMOKE=1` alone is insufficient; an absolute smoke root is mandatory. Smoke-only IPC is rejected in normal mode.

## Build and run

```bash
# macOS
npm run ocr:stage:mac
npm run ocr:verify
APPLE_SIGNING_IDENTITY=- npm run desktop:build:mac
npm run test:packaged
APPLE_SIGNING_IDENTITY=- npm run desktop:build:mac:dmg
npm run test:dmg
```

```powershell
# Windows x64
npm run ocr:stage:windows
npm run ocr:verify
npm run desktop:build:windows
npm run test:packaged
npm run test:windows-installer
```

OCR staging is explicit and generated resources remain ignored. Build commands verify the pinned manifest/runtime/models and fail when resources are missing, stale, wrong-target, or improperly linked.

## Platform acceptance

Windows NSIS testing performs isolated per-user install, product/resource validation, installed-tree OCR verification, packaged WebView smoke, silent uninstall, and removal. It does not claim Authenticode, SmartScreen reputation, MSI, elevation, or all-users install.

macOS DMG testing mounts read-only, verifies app metadata/executable/resource boundaries, OCR from the mounted tree, bundle resources, and signature structure, then detaches in all paths. Launch behavior is covered by the separate app-bundle smoke.

This harness is not pixel-diff QA. It does not cover all report subtabs, financial mutations, file pickers, signing trust, or every GPU/CSS issue. Visual evidence uses the separate browser and PDF QA workflows.
