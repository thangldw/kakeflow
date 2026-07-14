# Packaged application smoke test

KakeFlow's packaged smoke harness launches the same native artifact that CI
packages for users. It verifies all of the following before the process exits:

- the native process and `main` WebView window boot;
- frontend-to-Rust IPC can invoke `app_bootstrap`;
- the real onboarding form creates an isolated smoke household through IPC;
- the packaged WebView visits all eleven top-level workspaces in canonical order,
  with each exact heading, active navigation state, and usable dimensions;
- SQLCipher opens an isolated database and every migration applies;
- SQLite's integrity check succeeds;
- the UI-created household is present in the database;
- the app exits cleanly and leaves a machine-readable success result.

The JSON evidence records the onboarding title, all navigation labels, every
workspace heading, heading visibility, active state, main-region dimensions,
interactive-control count, rendered text length,
viewport, DPR, and interaction count. It is generated inside the packaged WebView
after the real onboarding form interaction; it is not inferred from source files.

## Isolation

The harness creates a new directory below the operating system's temporary
directory and passes it as `KAKEFLOW_SMOKE_ROOT`. In this mode KakeFlow:

- does not use the normal application-data directory;
- does not read or write the database key in Keychain or Credential Manager;
- does not participate in production single-instance locking;
- does not start background folder discovery;
- removes the temporary database and result after validation.

`KAKEFLOW_PACKAGED_SMOKE` is not sufficient by itself: an absolute
`KAKEFLOW_SMOKE_ROOT` is required. The smoke-only IPC endpoint rejects calls in
normal application mode.

On macOS the harness also launches with `ApplePersistenceIgnoreState` so an
AppKit crash-history or window-restoration prompt from an earlier interrupted
development run cannot block Tauri setup. This changes only the smoke process;
it does not delete or modify the user's saved application state.

Set `KAKEFLOW_SMOKE_ARTIFACT_DIR` to copy the evidence JSON out of the temporary
directory before cleanup.

## Local use

Stage and verify the pinned offline OCR runtime before producing a distributable
macOS artifact. The staging command builds Tesseract 5.5.2 from the pinned vcpkg
baseline with static third-party libraries, downloads checksum-pinned `eng` and
`jpn` models, writes a file-level manifest, and rejects non-system dynamic links:

```sh
npm run ocr:stage:mac
npm run ocr:verify
```

Generated OCR binaries and models are intentionally excluded from Git. The
resource manifest is generated alongside them, and Tauri maps that staged tree
to `Contents/Resources/ocr` in the application bundle. A release must not be
built from a clean checkout until the staging and verification commands pass.
The current reproducible resource build targets native Apple Silicon macOS 12+
only. It does not claim a Windows OCR artifact; Windows must be built and tested
on Windows with its own pinned static triplet before such a release is advertised.

Then build the unsigned artifact for the current platform and launch it through
the harness:

```sh
# macOS
APPLE_SIGNING_IDENTITY=- npm run desktop:build:mac
npm run test:packaged

# Mount the built DMG read-only and validate its bundle integrity
npm run desktop:build:mac:dmg
npm run test:dmg

# Windows
npm run desktop:build:windows
npm run test:packaged
```

Set `KAKEFLOW_KEEP_SMOKE_DATA=1` only while debugging to retain the temporary
directory. `KAKEFLOW_SMOKE_EXECUTABLE` can point at another compatible build.

## macOS DMG validation

`npm run test:dmg` validates the distribution image rather than the build-tree
app. On macOS it:

- mounts the versioned DMG with `hdiutil -readonly -nobrowse` at an isolated
  mountpoint and verifies the OS reports that mount as read-only;
- locates `KakeFlow.app` on the mounted volume;
- reads `Info.plist` with `plutil` and requires the expected product version,
  bundle identifier `app.kakeflow.desktop`, and executable `kakeflow`;
- verifies the executable is a non-empty executable file whose resolved path
  remains inside the mounted volume;
- verifies the bundled OCR manifest and every file hash, rejects non-system
  Tesseract dependencies, loads both language models, and executes TSV OCR from
  the read-only mounted resource tree with a minimal `PATH`;
- verifies the bundle Resources directory and validates the bundle's complete
  code-signature structure with `codesign --verify --deep --strict`; and
- detaches the volume in a `finally` path on both success and failure.

When `KAKEFLOW_SMOKE_ARTIFACT_DIR` is set, CI retains both the packaged UI JSON
and `dmg-install-smoke-darwin.json` containing the image, bundle metadata,
executable size and bundle-integrity result. `KAKEFLOW_DMG_PATH`
can select a specific compatible image for local diagnosis.

## Scope and limitations

This is a deterministic launch/IPC/onboarding/top-level-navigation test, not a complete
pixel-diff UI suite. DOM evidence proves that the packaged WebView rendered and
responded to real interaction, but it cannot detect every CSS or GPU artifact.
macOS and Windows produce the same DOM interaction evidence. It covers the eleven
top-level workspace shells, but not report subtabs, entity drill-downs, financial
mutations, or pixel-level rendering. This harness also does
not claim a screenshot: Tauri does not expose a stable window-capture API, while
OS screen capture is permission-gated on macOS and unreliable on unattended CI.
It also does not exercise OS file-picker dialogs, install the NSIS
package, or validate signing,
notarization, Gatekeeper, and SmartScreen behavior. Those checks need signed
release credentials and/or a dedicated interactive runner.

The DMG harness is macOS-only. It proves mount-level and bundle integrity but
does not launch from the read-only volume: macOS LaunchServices and Tauri startup
from a mounted unsigned CI image are not deterministic on unattended runners.
Launch/UI behavior remains enforced by the separate packaged app-bundle smoke.
The DMG gate also does not write to `/Applications`, bypass Gatekeeper, or claim
Windows NSIS/MSI installation coverage.
