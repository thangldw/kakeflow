# Connector Control Center evidence

Verified on 2026-08-27 with Node 22.23.2, npm 10.9.8, Rust 1.97.0, and the portable gates under `TZ=UTC`. The commands below leave `$HOME` unexpanded so this public record contains no personal filesystem path.

## Synthetic system journey

`src/App.desktop.test.tsx` mounts the real application, Control Center, import state, binding model, posting review, transaction detail, and provenance UI over mocked public `PlatformClient` DTOs. Its invented household has two configured sources. `Refresh all` publishes deterministic ordered progress: the first source ends `FAILED_RETRYABLE`, then the later source reaches `SUCCEEDED`, proving failure isolation.

A recovered candidate bound to a disallowed account is reviewable but cannot commit. The journey rolls it back, selects an invented CSV, explicitly maps the only allowed account, stages the candidate, and requires approval before commit. The committed decision contains a JPY 1,200 expense debit and equal asset credit. The transaction detail retains the invented filename and source row 2. No live provider, OAuth, account, path, email, or financial record is used.

The same test fails if batch items are rendered in reverse order; this mutation was applied temporarily, observed failing, and restored before the final green run. Connector idempotency, cursor fencing, batch recovery, and source-specific lease behavior remain covered by the focused and full Rust suites.

## Control-plane boundaries

| Boundary | Audited behavior |
| --- | --- |
| Registry | Manual import, watched folder, Google Drive, and Gmail are the four ordered import-source kinds. |
| Delegation | Configure, refresh, retry, and disconnect delegate to each source adapter and its authoritative lease/worker; the Control Center stores no provider workflow. |
| Binding | Review snapshots contain the connector identity, optional binding version, and a monotonic lifecycle generation retained as a tombstone. Unbound create-delete and bound delete-recreate ABA sequences therefore fail closed, as do replacement, ambiguity, cross-household scope, and stale account/parser state. |
| Durable batch | A bounded snapshot of at most 10,000 sources runs sequentially; each redacted result commits before the next item. Generation fencing recovers expired work without advancing a source cursor or replaying committed work. |
| PWA | The production PWA projects only local manual import and bundles no native provider client, credential state, refresh worker, binding editor, or native path DTO. |

This is a control plane over import sources. It is not direct institution aggregation, institution-coverage evidence, a commercial connector SDK, or Money Forward or Rakuten parity.

## Verification gates

Final portable gates used `PATH=/opt/homebrew/opt/node@22/bin:$PATH TZ=UTC`; native packaging additionally placed `$HOME/.cargo/bin` on `PATH`. Rust commands used `PATH="$HOME/.cargo/bin:$PATH" TZ=UTC`.

| Command | Result |
| --- | --- |
| `npm audit` | Passed; 0 vulnerabilities. |
| `npm audit --omit=dev` | Passed; 0 vulnerabilities. |
| `npm exec vitest run src/platform/client.test.ts src/features/connectors src/App.desktop.test.tsx src/platform/pwa/client.test.ts src/pwa/PwaRoot.test.tsx scripts/pwa-contract.test.ts` | Passed within the final functional run; 8 files, 249/249 tests. |
| `npm exec vitest run scripts/native-macos-build.test.ts scripts/native-build-identity.test.ts scripts/desktop-release.test.ts scripts/packaged-app-smoke.test.ts scripts/dmg-install-smoke.test.ts scripts/release-version-contract.test.mjs scripts/ocr-resource-contract.test.mjs scripts/stage-paddleocr-resources.test.ts` | Passed; 8 files, 58/58 tests. |
| `npm run ocr:verify` | Passed; staged Tesseract runtime/model/privacy verification and exactly one arm64 slice. |
| focused connector binding, projection, refresh, worker, and command tests | Passed; reviewer rerun the generation-fenced binding subset 15/15 and found no Critical/Important issue. |
| `npm run lint` | Passed. |
| `TZ=UTC npm run test:functional` | Passed; 133 files, 941/941 tests. |
| `npm run build` | Passed; 1,781 modules transformed. |
| `npm run build:pwa` | Passed; 61 modules transformed and 25 entries precached. |
| `TZ=UTC cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml` | Passed; 732/732 tests: 702 library, 15 family-delivery, 6 Gmail-store, and 9 Google-Drive-store. |
| `PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override:/opt/homebrew/opt/node@22/bin:$PATH" TZ=UTC KAKEFLOW_REQUIRE_POPPLER=1 KAKEFLOW_PDF_QA_OUTPUT=artifacts/pdf-report-visual-qa npm run test:pdf-visual` | Passed without skip; 1/1 integration test. |
| `npm exec vitest run scripts/update-channel-contract.test.mjs scripts/release-version-contract.test.mjs scripts/github-actions-pins.test.ts` | Passed; 3 files, 26/26 tests. |
| `npm run test:pwa:e2e` | Passed; 2/2 Playwright tests. |
| `npm exec vitest run` over updater, release, action-pin, native-build, package-smoke, DMG-smoke, and OCR contracts | Passed; 10 files, 77/77 tests. |
| opaque updater-signing environment injection plus `npm run desktop:build:mac:ci` | Passed at source identity `4db50b4c...`; arm64 app, DMG, updater archive, detached signature, and success identity created. |
| `npm run test:packaged` | Passed; 13 visible-page checks, 14 interaction checks, IPC, schema v72, source/byte identity, and whole-bundle privacy. |
| `npm run test:dmg` | Passed; v1.2.1 read-only mount, source/byte identity, whole-bundle privacy, and bundle integrity. |

Every artifact built before the final generation-fenced HEAD was treated as stale. The controller then performed one clean arm64 rebuild and reran package, DMG, privacy, architecture, and codesign checks. The injection mechanism, location, and key material remain outside tracked documentation.

Both `npm run test:packaged` and `npm run test:dmg` were rerun against the invalidated `71e8c92` artifacts after this correction. Each exited 1 with `Native build input identity mismatch` before app launch or DMG mount. The replacement artifacts then passed both positive gates.

## Artifacts

- Poppler machine result: `artifacts/pdf-report-visual-qa/manifest.json` with `status: automated-pass`. This proves required Poppler execution and render-artifact plumbing only.
- Poppler review checklist: `artifacts/pdf-report-visual-qa/VISUAL_REVIEW.md`. It is an uncompleted human-review input, not evidence that a reviewer approved the pages.
- Rendered fixtures: `artifacts/pdf-report-visual-qa/{monthly,annual,investment-performance,portfolio-snapshot}/page-0001.png`, each 1,190 × 1,684 pixels. All four are the same synthetic placeholder page; they do not prove report-specific content, visual variety, or visual quality.
- Native application: current identity-bound arm64 `KakeFlow.app`; recorded tree SHA-256 `03d495b92bf6f3e306b04a82636875b9ac18e2e6dbe7870603887e3748ae7f40` across 14 files.
- Updater archive: SHA-256 `776f4a7ecc65c76a2e2b7b6caedcbafe14a497a022dabeeffea2825ea887dc8b`.
- Detached updater signature: SHA-256 `b7414701f62440865388c96db35a59061cd5fec486e0cbdfefe0e382c66b614c`.
- DMG: SHA-256 `60e0bd9b20cb25f23633e85e69db7712ea09e4211649090168c65bc74c7bf8dd`.
- `kakeflow-build-identity.json`: SHA-256 `9c00b9a623d638e53b61580fe9b38b20ba358ff645c56ea158645e2cc895a294`; build-input identity `4db50b4cce11e3ef49f6abf5bf6724ed1b627ab565fc530cad4fb9a4484f87ef`.

`codesign --verify --deep --strict` passed; the app reports `Signature=adhoc`, `TeamIdentifier=not set`, and exactly the `arm64` architecture. Apple notarization was skipped because no notarization credentials were present. These local artifacts are not a release, are not Developer ID signed or notarized, and are not presented as a frictionless production installer.

## Privacy and claim inspection

The fresh PWA build, Poppler manifest/checklist/PNGs, Playwright result, connector batch test sources, rebuilt native app/updater/DMG, and this evidence were inspected for credential values, authorization-code values, cursor values, personal absolute paths, provider folder/label values, personal emails, real financial payloads, premium branding, and unsupported direct-institution or installer claims.

The first package scan rejected the executable because Rust, Tauri, and OpenSSL build literals retained the local home root. The rejected post-link byte rewrite was removed: it was section-blind and affected unrelated native-library strings. The retained macOS-only build wrapper chooses a deterministic neutral `CARGO_TARGET_DIR`, passes `aarch64-apple-darwin` explicitly, and injects Rust path remapping at compile time through `CARGO_ENCODED_RUSTFLAGS`; it rejects personal target directories, x64/fat targets, unsupported hosts, and ambiguous plain `RUSTFLAGS`. Tesseract verification requires exactly one arm64 slice. Until target-specific or fat OCR resources exist, no x64 or universal macOS package capability is claimed.

Both generic `desktop:release` and the macOS CI entry point route through that wrapper on macOS; protected target, bundle, config, and debug arguments cannot bypass it. Other platforms retain direct Tauri dispatch. Checkout and target paths are canonicalized through their physical existing ancestors, so aliases contend on one lock and a neutral-looking target link into a personal root is rejected. Cleanup rebases each explicit artifact below the physical release root, rejects every symlink traversal, invalidates identity first, and validates containment immediately before each removal.

The build-input digest is a sorted sequence of unambiguous per-file records containing type, portable path, mode, length, and SHA-256; symlink records also include their target. It covers root Cargo and Node manifests, the pinned Rust toolchain, TypeScript/Vite inputs, `src`, `src-tauri`, direct `crates/kakeflow-core`, build scripts, public assets, and ignored staged Paddle/Tesseract resources. Outputs, caches, tests not invoked by the build, and evidence documentation are excluded. Paddle metadata bytes are deterministic and are not rewritten when unchanged, so a real 1,781-module build leaves the input digest stable.

Each physical checkout/target has an atomic lock. Acquisition treats every existing lock as occupied, without checking liveness to justify takeover and without renaming, deleting, or temporarily vacating the path. This includes live, absent, reused, and malformed recorded PIDs, and the legacy recovery environment flag has no effect. Only deliberate out-of-band removal of the exact canonical lock path is permitted after independently verifying that no build process remains. Normal release validates the complete owner token, unlinks `owner.json` while the shared lock directory remains occupied, and makes successful `rmdir` the final and only unlock linearization point. Any earlier failure leaves the path occupied and fail closed; there is no shared-path rename/restore or fallible work after successful unlock. The success identity is written under the lock only after stable inputs and complete outputs. Any build, publication, or pre-unlock release failure removes the current builder's newly published identity while the lock still blocks contenders; app and DMG smokes reject missing, stale-source, or byte-mismatched identity before launch or mount.

A prior whole-bundle scan exposed two generated dependencies that an executable-only scan missed. The PWA core generator uses its own neutral Cargo target and compile-time Rust remapping; its contract rejects personal roots in both the tracked WASM and production PWA WASM. The macOS OCR stage builds under a neutral temporary vcpkg root, disables restoration from a user binary cache, and makes OCR verification reject personal roots in Tesseract before packaging. The replacement app, extracted updater, and read-only-mounted DMG passed their whole-bundle personal-root scans and source/byte identity checks.

Untouched OpenSSL `ENGINESDIR` and `MODULESDIR` strings and Tesseract source diagnostics remain under neutral operating-system temporary build roots. They are absolute compile-output paths, but they contain no user or personal build identity. Rust source paths are remapped to `/kakeflow-build-home`. The privacy claim is therefore personal-path-free artifacts, not the absence of every absolute path.

No private payload or unsupported claim was found in the current source, browser, Poppler, evidence, or rebuilt native-package surfaces. Expected identifiers were separated from leaked runtime evidence: IndexedDB dependency code contains `IDBCursor`/`openCursor`; the bundled ONNX runtime contains its public build marker `/home/web_user`; native source tests contain public DTO field names and invented negative fixtures, including synthetic personal-path markers used to test the deny rule; and public dependency attribution is not user data. Roadmap and security text names OAuth, providers, and product comparisons only to define non-goals. Rust SQLite tests use temporary databases and emitted no persistent batch fixture.
