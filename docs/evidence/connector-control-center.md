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

Node commands used `PATH=/opt/homebrew/opt/node@22/bin:$PATH TZ=Asia/Tokyo`; Rust commands used `PATH="$HOME/.cargo/bin:$PATH" TZ=Asia/Tokyo`.

| Command | Result |
| --- | --- |
| `npm audit` | Passed; 0 vulnerabilities. |
| `npm audit --omit=dev` | Passed; 0 vulnerabilities. |
| `npm exec vitest run src/platform/client.test.ts src/features/connectors src/App.desktop.test.tsx src/platform/pwa/client.test.ts src/pwa/PwaRoot.test.tsx scripts/pwa-contract.test.ts` | Passed; 8 files, 245/245 tests. |
| `cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml connector_` | Passed; 59/59 library tests. |
| `npm run lint` | Passed. |
| `npm run test:functional` | Passed; 129 files, 902/902 tests. |
| `npm run build` | Passed; 1,781 modules transformed. |
| `npm run build:pwa` | Passed; 61 modules transformed and 25 entries precached. |
| `cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml` | Passed; 724/724 tests: 694 library, 15 family-delivery, 6 Gmail-store, and 9 Google-Drive-store. |
| `PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override:/opt/homebrew/opt/node@22/bin:$PATH" TZ=Asia/Tokyo KAKEFLOW_REQUIRE_POPPLER=1 KAKEFLOW_PDF_QA_OUTPUT=artifacts/pdf-report-visual-qa npm run test:pdf-visual` | Passed without skip; 1/1 integration test. |
| `npm exec vitest run scripts/update-channel-contract.test.mjs scripts/release-version-contract.test.mjs scripts/github-actions-pins.test.ts` | Passed; 3 files, 26/26 tests. |
| `npm run test:pwa:e2e` | Passed; 2/2 Playwright tests. |
| `TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/kakeflow-updater.key" TAURI_SIGNING_PRIVATE_KEY_PASSWORD='' npm run desktop:build:mac:ci` | Passed after the documented local updater key was supplied; app, DMG, updater archive, and updater signature created. |
| `npm run test:packaged` | Passed; 13 visible-page checks, 14 interaction checks, IPC, and schema v71. |
| `npm run test:dmg` | Passed; v1.2.1 read-only mount and bundle integrity. |

The first macOS composite attempt omitted `TAURI_SIGNING_PRIVATE_KEY`: the ad-hoc app and DMG were produced, then updater signing correctly failed closed because only the public key was configured. The successful retry supplied the existing local key by path; no key bytes or signature secret were printed or copied into evidence.

## Artifacts

- Poppler machine result: `artifacts/pdf-report-visual-qa/manifest.json` with `status: automated-pass`.
- Poppler human-review artifact: `artifacts/pdf-report-visual-qa/VISUAL_REVIEW.md`.
- Rendered fixtures: `artifacts/pdf-report-visual-qa/{monthly,annual,investment-performance,portfolio-snapshot}/page-0001.png`, each 1,190 × 1,684 pixels. The deterministic fixture was visually inspected; the release-review checklist remains explicitly unclaimed.
- Native application: `src-tauri/target/release/bundle/macos/KakeFlow.app`.
- Updater archive: `src-tauri/target/release/bundle/macos/KakeFlow.app.tar.gz`, SHA-256 `23e77aff8ace10d4a3e3583a0a564f058935e45e866e41a1c6cc3bd33e259446`.
- Updater signature: `src-tauri/target/release/bundle/macos/KakeFlow.app.tar.gz.sig`, SHA-256 `2b3838d742b99fff088cb26ab2647cbf8b708282f085bbefba248c8b9cd944b5`.
- DMG: `src-tauri/target/release/bundle/dmg/KakeFlow_1.2.1_aarch64.dmg`, SHA-256 `4a39624d19febaceaa0507a3843e227feecfd3fc3c40e6192002feec588d32cc`.

`codesign --verify --deep --strict` passed for the app. Its recorded identity is `Signature=adhoc` and `TeamIdentifier=not set`; the build explicitly skipped Apple notarization because no notarization credentials were present. These are local verification artifacts, not a release. They are not Developer ID signed or notarized and are not presented as a frictionless production installer.

## Privacy and claim inspection

The fresh PWA build, native build, Poppler manifest/checklist/PNGs, Playwright result, package resources, connector batch test sources, and this evidence were inspected for credential values, authorization-code values, cursor values, personal absolute paths, provider folder/label values, personal emails, real financial payloads, premium branding, and unsupported direct-institution or installer claims.

The first package scan rejected the executable because Rust, Tauri, and OpenSSL build literals retained the local home root. Compiler path remapping removed Rust source spans but could not rewrite five generated or native-library literals. A tested `beforeBundleCommand` now replaces only the exact build home root with a same-length placeholder before Tauri signs and archives the executable; the package smoke also independently rejects macOS or Windows personal build-root markers. The final `.app`, extracted updater executable, and read-only-mounted DMG executable contain neither marker, and their runtime smoke checks pass.

No private payload or unsupported claim was found. Expected identifiers were separated from leaked runtime evidence: IndexedDB dependency code contains `IDBCursor`/`openCursor`; the bundled ONNX runtime contains its public build marker `/home/web_user`; native source tests contain public DTO field names and invented negative fixtures, including synthetic personal-path markers used to test the deny rule; and package email-like strings resolve to public third-party attribution addresses (for example, `appro@openssl.org` and `xiaokang.qian@arm.com`), `ftp@example.com`, or non-email binary fragments, not a KakeFlow user or build-machine identity. Roadmap and security text names OAuth, providers, and product comparisons only to define non-goals. Rust SQLite tests use temporary databases and emitted no persistent database fixture. Local compiler output displayed its working directory as an ephemeral diagnostic, but no personal absolute path was embedded in the public evidence, Poppler artifacts, Playwright result, updater signature, or final package executables.
