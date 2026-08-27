# Connector Control Center evidence

Verified on 2026-08-27 with Node 22.23.2, npm 10.9.8, Rust 1.97.0, and `TZ=Asia/Tokyo`. The commands below leave `$HOME` unexpanded so this public record contains no personal filesystem path.

## Synthetic system journey

`src/App.desktop.test.tsx` mounts the real application, Control Center, import state, binding model, posting review, transaction detail, and provenance UI over mocked public `PlatformClient` DTOs. Its invented household has two configured sources. `Refresh all` publishes deterministic ordered progress: the first source ends `FAILED_RETRYABLE`, then the later source reaches `SUCCEEDED`, proving failure isolation.

A recovered candidate bound to a disallowed account is reviewable but cannot commit. The journey rolls it back, selects an invented CSV, explicitly maps the only allowed account, stages the candidate, and requires approval before commit. The committed decision contains a JPY 1,200 expense debit and equal asset credit. The transaction detail retains the invented filename and source row 2. No live provider, OAuth, account, path, email, or financial record is used.

The same test fails if batch items are rendered in reverse order; this mutation was applied temporarily, observed failing, and restored before the final green run. Connector idempotency, cursor fencing, batch recovery, and source-specific lease behavior remain covered by the focused and full Rust suites.

## Control-plane boundaries

| Boundary | Audited behavior |
| --- | --- |
| Registry | Manual import, watched folder, Google Drive, and Gmail are the four ordered import-source kinds. |
| Delegation | Configure, refresh, retry, and disconnect delegate to each source adapter and its authoritative lease/worker; the Control Center stores no provider workflow. |
| Binding | Missing, ambiguous, cross-household, or stale account/parser bindings fail closed until explicit remapping and approval. |
| Durable batch | A bounded snapshot of at most 10,000 sources runs sequentially; each redacted result commits before the next item. Generation fencing recovers expired work without advancing a source cursor or replaying committed work. |
| PWA | The production PWA projects only local manual import and bundles no native provider client, credential state, refresh worker, binding editor, or native path DTO. |

This is a control plane over import sources. It is not direct institution aggregation, institution-coverage evidence, a commercial connector SDK, or Money Forward or Rakuten parity.

## Verification gates

Node commands used `PATH=/opt/homebrew/opt/node@22/bin:$PATH TZ=Asia/Tokyo`; native packaging additionally placed `$HOME/.cargo/bin` on `PATH` and set `RUSTUP_TOOLCHAIN=1.97.0`. Rust commands used `PATH="$HOME/.cargo/bin:$PATH" TZ=Asia/Tokyo`.

| Command | Result |
| --- | --- |
| `npm audit` | Passed; 0 vulnerabilities. |
| `npm audit --omit=dev` | Passed; 0 vulnerabilities. |
| `npm exec vitest run src/platform/client.test.ts src/features/connectors src/App.desktop.test.tsx src/platform/pwa/client.test.ts src/pwa/PwaRoot.test.tsx scripts/pwa-contract.test.ts` | Passed; 8 files, 246/246 tests. |
| `npm exec vitest run scripts/native-macos-build.test.ts scripts/native-build-identity.test.ts scripts/desktop-release.test.ts scripts/packaged-app-smoke.test.ts scripts/dmg-install-smoke.test.ts scripts/release-version-contract.test.mjs scripts/ocr-resource-contract.test.mjs` | Passed; 7 files, 43/43 tests. |
| `npm run ocr:verify` | Passed; staged Tesseract runtime/model/privacy verification and exactly one arm64 slice. |
| `cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml connector_` | Passed; 59/59 library tests. |
| `npm run lint` | Passed. |
| `npm run test:functional` | Passed; 132 files, 923/923 tests. |
| `npm run build` | Passed; 1,781 modules transformed. |
| `npm run build:pwa` | Passed; 61 modules transformed and 25 entries precached. |
| `cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml` | Passed; 724/724 tests: 694 library, 15 family-delivery, 6 Gmail-store, and 9 Google-Drive-store. |
| `PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override:/opt/homebrew/opt/node@22/bin:$PATH" TZ=Asia/Tokyo KAKEFLOW_REQUIRE_POPPLER=1 KAKEFLOW_PDF_QA_OUTPUT=artifacts/pdf-report-visual-qa npm run test:pdf-visual` | Passed without skip; 1/1 integration test. |
| `npm exec vitest run scripts/update-channel-contract.test.mjs scripts/release-version-contract.test.mjs scripts/github-actions-pins.test.ts` | Passed; 3 files, 26/26 tests. |
| `npm run test:pwa:e2e` | Passed; 2/2 Playwright tests. |
| `TAURI_SIGNING_PRIVATE_KEY='<opaque-environment-injection>' TAURI_SIGNING_PRIVATE_KEY_PASSWORD='<opaque-environment-injection>' npm run desktop:build:mac:ci` | Passed after opaque signing-environment injection; app, DMG, updater archive, and updater signature created. |
| `npm run test:packaged` | Passed; build identity, 13 visible-page checks, 14 interaction checks, IPC, schema v71, and whole-bundle privacy. |
| `npm run test:dmg` | Passed; build identity, v1.2.1 read-only mount, whole-bundle privacy, and bundle integrity. |

The first macOS composite attempt omitted `TAURI_SIGNING_PRIVATE_KEY`: the ad-hoc app and DMG were produced, then updater signing correctly failed closed because only the public key was configured. The successful retry used opaque environment injection; the secret source and its location remain outside tracked documentation, and no key bytes or signature secret were printed or copied into evidence.

## Artifacts

- Poppler machine result: `artifacts/pdf-report-visual-qa/manifest.json` with `status: automated-pass`. This proves required Poppler execution and render-artifact plumbing only.
- Poppler review checklist: `artifacts/pdf-report-visual-qa/VISUAL_REVIEW.md`. It is an uncompleted human-review input, not evidence that a reviewer approved the pages.
- Rendered fixtures: `artifacts/pdf-report-visual-qa/{monthly,annual,investment-performance,portfolio-snapshot}/page-0001.png`, each 1,190 × 1,684 pixels. All four are the same synthetic placeholder page; they do not prove report-specific content, visual variety, or visual quality.
- Native application: `<neutral-cargo-target>/aarch64-apple-darwin/release/bundle/macos/KakeFlow.app`.
- Updater archive: `<neutral-cargo-target>/aarch64-apple-darwin/release/bundle/macos/KakeFlow.app.tar.gz`, SHA-256 `bf9bb45e5bb29a8eab7308260e42a8fa5887cc60f4ac9a7cbe09c5d0f6a04779`.
- Updater signature: `<neutral-cargo-target>/aarch64-apple-darwin/release/bundle/macos/KakeFlow.app.tar.gz.sig`, SHA-256 `2e5bf58cce72f6c5fff65f836f616316a59ff37a999f7d0b2048cb37a76469d8`.
- DMG: `<neutral-cargo-target>/aarch64-apple-darwin/release/bundle/dmg/KakeFlow_1.2.1_aarch64.dmg`, SHA-256 `c74479626676a0fd374dffa0ebde1c4dc52f10ef567d3b0764e221e6a3450f0b`.
- Build identity: `<neutral-cargo-target>/aarch64-apple-darwin/release/kakeflow-build-identity.json`, SHA-256 `e7e6a02e174f063bc8d2798948a95316647b115393b9e6546a1a71ad92b012e1`.

`codesign --verify --deep --strict` passed for the app. Its recorded identity is `Signature=adhoc` and `TeamIdentifier=not set`; the build explicitly skipped Apple notarization because no notarization credentials were present. These are local verification artifacts, not a release. They are not Developer ID signed or notarized and are not presented as a frictionless production installer.

## Privacy and claim inspection

The fresh PWA build, native build, Poppler manifest/checklist/PNGs, Playwright result, package resources, connector batch test sources, and this evidence were inspected for credential values, authorization-code values, cursor values, personal absolute paths, provider folder/label values, personal emails, real financial payloads, premium branding, and unsupported direct-institution or installer claims.

The first package scan rejected the executable because Rust, Tauri, and OpenSSL build literals retained the local home root. The rejected post-link byte rewrite was removed: it was section-blind and affected unrelated native-library strings. The retained macOS-only build wrapper chooses a deterministic neutral `CARGO_TARGET_DIR`, passes `aarch64-apple-darwin` explicitly, and injects Rust path remapping at compile time through `CARGO_ENCODED_RUSTFLAGS`; it rejects personal target directories, x64/fat targets, unsupported hosts, and ambiguous plain `RUSTFLAGS`. Tesseract verification requires exactly one arm64 slice. Until target-specific or fat OCR resources exist, no x64 or universal macOS package capability is claimed.

Both generic `desktop:release` and the macOS CI entry point route through that wrapper on macOS; protected target, bundle, config, and debug arguments cannot bypass it. Other platforms retain direct Tauri dispatch. Each checkout/target has an atomic lock. A dead, well-formed owner can be recovered only through explicit `KAKEFLOW_RECOVER_STALE_BUILD_LOCK=1`; active or malformed locks fail closed and require inspection of the exact reported lock. Before building, only the resolved app, updater, signature, DMG, and previous identity are removed. A source- and byte-bound identity manifest is written atomically only after success, and both smokes reject missing, mismatched, interrupted, or stale outputs before launch or mount. The first isolated invocation without Cargo on `PATH` demonstrated this failure boundary: it left no success identity and released the lock; the pinned-toolchain retry produced the recorded artifacts in one release invocation.

A subsequent whole-bundle scan exposed two generated dependencies that an executable-only scan missed. The PWA core generator now uses its own neutral Cargo target and compile-time Rust remapping; its contract rejects personal roots in both the tracked WASM and production PWA WASM. The macOS OCR stage now builds under a neutral temporary vcpkg root, disables restoration from a user binary cache, and makes OCR verification reject personal roots in Tesseract before packaging. The rebuilt raw executable, all 14 regular files in the `.app`, all 14 files extracted from the updater, and all 16 files on the read-only-mounted DMG contain no macOS or Windows personal build-root marker. Package and DMG runtime smokes pass.

Untouched OpenSSL `ENGINESDIR` and `MODULESDIR` strings and Tesseract source diagnostics remain under neutral operating-system temporary build roots. They are absolute compile-output paths, but they contain no user or personal build identity. Rust source paths are remapped to `/kakeflow-build-home`. The privacy claim is therefore personal-path-free artifacts, not the absence of every absolute path.

No private payload or unsupported claim was found. Expected identifiers were separated from leaked runtime evidence: IndexedDB dependency code contains `IDBCursor`/`openCursor`; the bundled ONNX runtime contains its public build marker `/home/web_user`; native source tests contain public DTO field names and invented negative fixtures, including synthetic personal-path markers used to test the deny rule; and package email-like strings resolve to public third-party attribution addresses (for example, `appro@openssl.org` and `xiaokang.qian@arm.com`), `ftp@example.com`, or non-email binary fragments, not a KakeFlow user or build-machine identity. Roadmap and security text names OAuth, providers, and product comparisons only to define non-goals. Rust SQLite tests use temporary databases and emitted no persistent database fixture. Local compiler output displayed its working directory as an ephemeral diagnostic, but no personal absolute path was embedded in the public evidence, Poppler artifacts, Playwright result, updater signature, or final package executables.
