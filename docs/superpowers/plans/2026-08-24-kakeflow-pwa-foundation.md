# KakeFlow PWA Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an installable offline-first PWA at `/kakeflow/app/` that creates an encrypted local vault and completes receipt OCR -> source review -> explicit approval -> balanced ledger -> provenance without an account.

**Architecture:** Extract deterministic posting invariants into a native/WASM Rust core. A focused PWA client stores authenticated encrypted events and projections in IndexedDB, stores encrypted evidence in OPFS with IndexedDB fallback, and drives a dedicated PWA UI. The existing Tauri application and synthetic demo remain separate runtimes.

**Tech Stack:** React 18, TypeScript, Vite 6, Rust 1.97, wasm-bindgen/wasm-pack, IndexedDB/OPFS, WebCrypto AES-GCM, Argon2id WASM, vite-plugin-pwa, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-kakeflow-pwa-foundation-design.md`

## Global Constraints

- Existing Tauri behavior and the 749 frontend/643 Rust no-regression floors remain intact.
- The production PWA never returns synthetic demo data and never requires an account.
- Imported files, decrypted evidence, passphrases, and key material never enter Cache Storage, logs, URLs, or network payloads.
- Every posting requires explicit approval and exact debit/credit equality.
- Browser persistence is encrypted record-by-record with unique nonces and authenticated metadata.
- Restore validates into a staging vault before changing the active vault.
- The landing page stays at `/kakeflow/`; PWA scope and start URL are `/kakeflow/app/`.
- Connectors, relay, multi-device sync, native updater, watched folders, and native SQLCipher backup compatibility are not implemented.

---

### Task 1: Shared native/WASM posting core

**Files:**
- Create: `Cargo.toml`
- Create: `crates/kakeflow-core/Cargo.toml`
- Create: `crates/kakeflow-core/src/lib.rs`
- Create: `crates/kakeflow-core/tests/posting_contract.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/import_workflow.rs`

**Interfaces:**
- Produces: `validate_posting(&PostingInput) -> PostingValidation`; `canonical_posting_hash(&PostingInput) -> Result<String, CoreError>`; WASM `validate_posting_json(input: &str) -> Result<String, JsValue>`.
- Consumes: IDs, transaction type, positive integer JPY amount, candidate amount, approval flag, and 2-128 journal entries.

- [ ] **Step 1: Write literal Rust contract fixtures**

The passing fixture has candidate amount 1,000, explicit approval, one 1,000 debit, and one 1,000 credit. Add failing fixtures for missing approval, 999 credit, duplicate entry ID, unsupported type, control character ID, zero amount, and candidate-total mismatch. Canonical serialization sorts entries by ID and emits this exact compact JSON field order:

```json
{"schemaVersion":1,"candidateId":"candidate-1","transactionId":"transaction-1","transactionType":"EXPENSE","candidateAmountJpy":1000,"approved":true,"entries":[{"id":"entry-credit","accountId":"cash","side":"CREDIT","amountJpy":1000},{"id":"entry-debit","accountId":"expense","side":"DEBIT","amountJpy":1000}]}
```

Assert SHA-256 `c190a870d36257f86f3e473bdfb77f085d5c21a171332025ff04460392ee484f`.

- [ ] **Step 2: Verify RED**

Run:

```bash
cargo test -p kakeflow-core --test posting_contract
```

Expected: package/function missing.

- [ ] **Step 3: Implement the minimal core**

Define:

```rust
pub struct PostingInput {
    pub candidate_id: String,
    pub transaction_id: String,
    pub transaction_type: String,
    pub candidate_amount_jpy: i64,
    pub approved: bool,
    pub entries: Vec<PostingEntry>,
}

pub struct PostingEntry {
    pub id: String,
    pub account_id: String,
    pub side: EntrySide,
    pub amount_jpy: i64,
}

pub struct PostingValidation {
    pub valid: bool,
    pub codes: Vec<ValidationCode>,
    pub debit_total_jpy: i64,
    pub credit_total_jpy: i64,
}
```

Use checked integer addition. Hash the versioned, field-ordered validated structure with SHA-256 inside the Rust core; callers do not reconstruct canonical bytes.

- [ ] **Step 4: Verify GREEN and mutation resistance**

Run core tests. Temporarily change the credit comparison and confirm the unbalanced fixture fails; restore and rerun.

- [ ] **Step 5: Integrate native validation**

Add a path dependency from `src-tauri` and convert each `PostingDecision` plus database candidate amount into `PostingInput { approved: true, ... }` immediately before the existing SQL transaction writes. Map core error codes to `UnbalancedJournal` or the existing validation error without changing public DTOs.

- [ ] **Step 6: Verify native regression**

Run focused `import_workflow` tests, then `cargo test -p kakeflow`. Expected: all existing tests plus core tests pass.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml crates/kakeflow-core src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/import_workflow.rs
git commit -m "refactor: share posting invariants with PWA core"
```

### Task 2: WASM package and runtime separation

**Files:**
- Modify: `crates/kakeflow-core/Cargo.toml`
- Modify: `crates/kakeflow-core/src/lib.rs`
- Create: `scripts/build-pwa-core.mjs`
- Create: `src/platform/pwa/core-wasm/` generated package
- Create: `src/runtime.ts`
- Modify: `src/main.tsx`
- Test: `src/runtime.test.ts`

**Interfaces:**
- Produces: `runtimeFromEnvironment(value): 'tauri' | 'pwa' | 'demo'`; generated WASM exports `validate_posting_json` and `derive_key_argon2id`.

- [ ] **Step 1: Write failing runtime-selection tests**

Assert `pwa` selects PWA, `demo` selects demo, missing value selects Tauri only when `__TAURI_INTERNALS__` exists, and missing value otherwise selects demo. Unknown values throw.

- [ ] **Step 2: Verify RED and implement the selector**

Run the targeted Vitest file, implement `runtimeFromEnvironment`, and rerun.

- [ ] **Step 3: Add WASM exports**

Add target-gated `wasm-bindgen` and Argon2 dependencies. Export JSON validation and:

```rust
pub fn derive_key_argon2id(
    passphrase: &[u8], salt: &[u8], memory_kib: u32,
    iterations: u32, parallelism: u32,
) -> Result<Vec<u8>, JsValue>
```

Return exactly 32 bytes and zeroize intermediate buffers.

- [ ] **Step 4: Generate a pinned web package**

`scripts/build-pwa-core.mjs` executes `wasm-pack 0.15.0` with `--target web --release`, deletes only the owned generated directory, and normalizes generated package metadata. Commit the generated JS, TypeScript declarations, and WASM so ordinary desktop builds remain self-contained.

- [ ] **Step 5: Route roots without importing PWA data into Tauri state**

`main.tsx` dynamically loads `PwaRoot` only for PWA, renders the existing `App` for Tauri/demo, and preserves StrictMode/I18nProvider.

- [ ] **Step 6: Verify**

Run runtime tests, regenerate WASM twice and compare hashes, run `npm run build`, and run core native tests.

- [ ] **Step 7: Commit**

```bash
git add crates/kakeflow-core scripts/build-pwa-core.mjs src/platform/pwa/core-wasm src/runtime.ts src/runtime.test.ts src/main.tsx package.json package-lock.json
git commit -m "feat: add deterministic WASM core runtime"
```

### Task 3: Versioned encrypted browser vault

**Files:**
- Create: `src/platform/pwa/vaultTypes.ts`
- Create: `src/platform/pwa/vaultCrypto.ts`
- Create: `src/platform/pwa/vaultCrypto.test.ts`
- Create: `src/platform/pwa/argonWorker.ts`

**Interfaces:**
- Produces: `createVaultKey(passphrase): Promise<VaultKeyMaterial>`; `unlockVaultKey(passphrase, metadata): Promise<CryptoKey>`; `encryptRecord(key, context, bytes): Promise<EncryptedEnvelope>`; `decryptRecord(...)`.

- [ ] **Step 1: Write failing crypto behavior tests**

Use literal plaintext and context. Assert round-trip, wrong passphrase rejection, modified ciphertext rejection, context/AAD mismatch rejection, unique nonces for identical plaintext, and absence of passphrase/plaintext in serialized envelopes.

- [ ] **Step 2: Verify RED**

Run the targeted test; expected missing module failure.

- [ ] **Step 3: Implement the vault envelope**

Use schema version 1, 16-byte random salt, Argon2id parameters recorded in metadata, a non-extractable AES-GCM key, 12-byte random nonce, and AAD:

```ts
`${vaultId}\u0000${recordType}\u0000${recordId}\u0000${schemaVersion}`
```

Reject nonce reuse within one active session using a nonce set. Zeroize passphrase encoding and derived bytes in `finally` blocks.

- [ ] **Step 4: Verify GREEN and mutation resistance**

Run crypto tests; mutate one AAD field and confirm rejection test fails, then restore.

- [ ] **Step 5: Commit**

```bash
git add src/platform/pwa/vaultTypes.ts src/platform/pwa/vaultCrypto.ts src/platform/pwa/vaultCrypto.test.ts src/platform/pwa/argonWorker.ts
git commit -m "feat: add encrypted PWA vault envelopes"
```

### Task 4: Authenticated IndexedDB event store and evidence fallback

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/platform/pwa/database.ts`
- Create: `src/platform/pwa/database.test.ts`
- Create: `src/platform/pwa/evidenceStore.ts`
- Create: `src/platform/pwa/evidenceStore.test.ts`

**Interfaces:**
- Produces: `PwaVaultDatabase.create/open/lock`; `appendPostingAtomically`; `rebuildProjections`; `putEvidence/getEvidence`; `storagePersistenceStatus`.
- Dependencies: `idb@8.0.3`; test-only `fake-indexeddb@6.2.5`.

- [ ] **Step 1: Write failing database tests**

Cover vault creation/open, encrypted raw records, event replay, atomic posting across event/projection/meta stores, forced abort with no partial rows, projection rebuild, wrong key, schema migration, quota error, and denied `navigator.storage.persist()`.

- [ ] **Step 2: Verify RED**

Run the targeted database/evidence tests; expected missing modules.

- [ ] **Step 3: Implement schema version 1**

Create stores `vaults`, `events`, `projections`, `evidence`, and `meta`. Keys include `vaultId`. Encrypt every event/projection/evidence payload before opening the write transaction. Store only envelopes and non-sensitive indexes.

- [ ] **Step 4: Implement OPFS with encrypted IndexedDB fallback**

Write ciphertext only. Detect OPFS capability, use deterministic owned paths under `/kakeflow/<vaultId>/evidence/`, and fall back to the `evidence` store. Never write plaintext to either backend.

- [ ] **Step 5: Verify GREEN**

Run targeted tests, including restart with a fresh database instance and projection rebuild.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/platform/pwa/database.ts src/platform/pwa/database.test.ts src/platform/pwa/evidenceStore.ts src/platform/pwa/evidenceStore.test.ts
git commit -m "feat: persist encrypted PWA ledger events"
```

### Task 5: Focused PWA ledger client

**Files:**
- Create: `src/platform/pwa/types.ts`
- Create: `src/platform/pwa/client.ts`
- Create: `src/platform/pwa/client.test.ts`

**Interfaces:**
- Produces `PwaLedgerClient` methods: `createVault`, `unlock`, `lock`, `createHousehold`, `createAccount`, `createManualTransaction`, `stageReceipt`, `approveCandidate`, `listCandidates`, `listTransactions`, `transactionDetail`, `sourceEvidence`, `dashboard`, `exportVault`, `restoreVault`.

- [ ] **Step 1: Write failing domain-flow tests**

Test account setup, manual transaction, receipt candidate staging, no posting before approval, unbalanced approval rejection with no partial state, balanced approval success, dashboard update, transaction-to-source lookup, duplicate source hash behavior, and lock rejection.

- [ ] **Step 2: Verify RED**

Run the client test; expected missing client.

- [ ] **Step 3: Implement event types and projections**

Use versioned events `HOUSEHOLD_CREATED`, `ACCOUNT_CREATED`, `SOURCE_STORED`, `CANDIDATE_STAGED`, `CANDIDATE_APPROVED`, `TRANSACTION_POSTED`. Send every posting to WASM `validate_posting_json`; persist the returned canonical hash with the event.

- [ ] **Step 4: Implement atomic approval**

Prepare encrypted event/projection envelopes, then call `appendPostingAtomically`. Approval writes candidate status, transaction, entries, provenance edge, audit event, and projection revision in one transaction.

- [ ] **Step 5: Verify GREEN and mutation resistance**

Run the client tests; bypass the WASM call temporarily and confirm the unbalanced test catches it; restore.

- [ ] **Step 6: Commit**

```bash
git add src/platform/pwa/types.ts src/platform/pwa/client.ts src/platform/pwa/client.test.ts
git commit -m "feat: add authoritative PWA ledger client"
```

### Task 6: PWA receipt-to-provenance UI

**Files:**
- Create: `src/pwa/PwaRoot.tsx`
- Create: `src/pwa/PwaRoot.test.tsx`
- Create: `src/pwa/pwa.css`
- Create: `src/pwa/usePwaClient.ts`
- Modify: `src/i18n.tsx` and generated locale catalogs only through the existing localization workflow.

**Interfaces:**
- Consumes: `PwaLedgerClient`, `paddleOcrDocument`, `parseReceiptText`/receipt candidate builder.
- Produces: onboarding/unlock, dashboard, import/review, ledger, evidence, and backup screens.

- [ ] **Step 1: Write failing UI journeys**

Render with a real in-memory/fake-IndexedDB client. Test vault creation, account setup, synthetic receipt selection, candidate/source display, explicit approval, balanced entry display, provenance navigation, lock/unlock, and unsupported connector absence. Assert no Tanaka demo values appear.

- [ ] **Step 2: Verify RED**

Run the PWA root test; expected missing component.

- [ ] **Step 3: Implement the minimal responsive UI**

Use a six-step navigation and visible state labels: `LOCAL`, `LOCKED/UNLOCKED`, `CANDIDATE`, `APPROVED`, `POSTED`, `OFFLINE READY`. Require account selection and show debit, credit, and `difference ¥0` before enabling approval.

- [ ] **Step 4: Connect local OCR**

Read bytes in the browser, run PP-OCRv5, map receipt fields/provenance, encrypt the original before persistence, and retain incomplete OCR as an unpostable candidate. No network fallback.

- [ ] **Step 5: Verify GREEN, accessibility, and mobile layout**

Run UI tests and production build. Test keyboard labels/roles and 390x844 layout with no horizontal document overflow.

- [ ] **Step 6: Commit**

```bash
git add src/pwa src/i18n.tsx src/locales src/main.tsx
git commit -m "feat: add offline PWA receipt ledger workflow"
```

### Task 7: Installability, service worker, and safe updates

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Modify: `index.html`
- Create: `public/pwa/` icons
- Create: `src/pwa/serviceWorker.ts`
- Create: `scripts/pwa-contract.test.ts`

**Interfaces:**
- Dependency: `vite-plugin-pwa@1.3.0`.
- Produces: manifest scope/start URL `/kakeflow/app/`; prompt-driven updates; cache allowlist.

- [ ] **Step 1: Write failing production-build contracts**

Build with `VITE_KAKEFLOW_RUNTIME=pwa` and assert manifest scope/start URL, required icons, service worker presence, no imported evidence paths in precache, and CSP metadata. The test serves `dist` and verifies app-shell navigation only within scope.

- [ ] **Step 2: Verify RED**

Expected: missing manifest/service worker.

- [ ] **Step 3: Configure the PWA plugin**

Use `registerType: 'prompt'`, explicit `/kakeflow/app/` base in production PWA mode, same-origin OCR assets, and a runtime-caching deny-by-default policy. Do not register Background Sync or cache API/data requests.

- [ ] **Step 4: Implement quiescent update activation**

Expose update availability in `PwaRoot`. Enable activation only when the vault is locked or the client reports no active review/posting operation. Never call `skipWaiting` automatically.

- [ ] **Step 5: Verify GREEN**

Run production build contracts, inspect generated precache entries, and rerun UI tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.ts index.html public/pwa src/pwa/serviceWorker.ts scripts/pwa-contract.test.ts
git commit -m "feat: make the local ledger installable offline"
```

### Task 8: Encrypted export and staging restore

**Files:**
- Create: `src/platform/pwa/archive.ts`
- Create: `src/platform/pwa/archive.test.ts`
- Modify: `src/platform/pwa/client.ts`
- Modify: `src/pwa/PwaRoot.tsx`

**Interfaces:**
- Produces: archive schema 1 with authenticated manifest, encrypted vault metadata/events/projections/evidence; staging restore and atomic active-vault switch.

- [ ] **Step 1: Write failing archive tests**

Cover deterministic manifest fields, wrong passphrase, modified entry, missing evidence, unsupported schema, interrupted restore, unchanged active vault on failure, and successful canonical-hash preservation.

- [ ] **Step 2: Verify RED**

Run archive tests; expected missing module.

- [ ] **Step 3: Implement export/restore**

Use `fflate` to package already encrypted records plus an authenticated manifest. Restore validates every declared file/hash into a new vault ID, rebuilds projections, and changes `activeVaultId` in one final metadata transaction.

- [ ] **Step 4: Add browser download/file-picker controls**

Create Blob downloads and `<input type=file>` restore without placing archive content in Cache Storage or URLs.

- [ ] **Step 5: Verify GREEN**

Run archive, client, and UI tests.

- [ ] **Step 6: Commit**

```bash
git add src/platform/pwa/archive.ts src/platform/pwa/archive.test.ts src/platform/pwa/client.ts src/pwa/PwaRoot.tsx
git commit -m "feat: add staged encrypted PWA recovery"
```

### Task 9: Browser offline E2E and 90-second demo

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Create: `e2e/pwa-offline.spec.ts`
- Create: `scripts/capture-pwa-demo.mjs`
- Create: `docs/demo/KakeFlow-90-second-storyboard.md`

**Interfaces:**
- Produces: account-free browser E2E, deterministic WebM capture, MP4 transcode consumed by hardening Task 6.
- Test dependency: `@playwright/test@1.62.1`.

- [ ] **Step 1: Write the failing browser journey**

Serve the production PWA and use a clean persistent browser context. Complete vault creation, receipt import, source comparison, approval, posting, provenance, offline reload/unlock, export, and restore. Inspect Cache Storage and captured requests for forbidden payloads.

- [ ] **Step 2: Verify RED then implement missing selectors/behavior**

Run with system Chrome locally and Chromium in CI. Fix application behavior, not assertions, until green.

- [ ] **Step 3: Add deterministic capture**

Reuse the synthetic fixture and stable data-testid/accessible selectors. Pause on six evidence steps so final duration is 85-95 seconds. Record 1440x900 video, transcode with H.264/yuv420p, and write a storyboard mapping timestamps to claims.

- [ ] **Step 4: Verify media**

Use `ffprobe` for duration, `ffmpeg` to extract six representative frames, visually inspect them, and compute SHA-256.

- [ ] **Step 5: Commit test/capture source**

```bash
git add package.json package-lock.json playwright.config.ts e2e/pwa-offline.spec.ts scripts/capture-pwa-demo.mjs docs/demo/KakeFlow-90-second-storyboard.md
git commit -m "test: prove the PWA receipt flow offline"
```

The generated MP4/checksum commit is owned by hardening Task 6.

### Task 10: PWA CI, documentation, and final gates

**Files:**
- Modify: `.github/workflows/quality.yml`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: pinned CI job for core/WASM/PWA/build/browser gates and accurate public capability boundaries.

- [ ] **Step 1: Add a pinned PWA CI job**

Install Node 22, Rust 1.97, `wasm32-unknown-unknown`, pinned `wasm-pack 0.15.0`, and Playwright Chromium. Verify generated WASM reproducibility, run core tests, PWA unit/contracts, production build, and offline E2E. Upload only synthetic screenshots/traces on failure.

- [ ] **Step 2: Update architecture/security documentation**

Document three runtimes, local-authoritative browser boundary, at-rest encryption limits, eviction risk, backup requirement, unsupported connectors, and `/kakeflow/app/` scope in English, Vietnamese, and Japanese.

- [ ] **Step 3: Run all final gates fresh**

Run full Node audits, lint, frontend functional and Poppler suites, production desktop/PWA builds, core/native Rust fmt/clippy/tests, PWA E2E offline, archive restore, workflow pins, version/update/signature/checksum contracts, and media verification.

- [ ] **Step 4: Re-read both specs and record gaps**

Map every acceptance gate to fresh command output. Any unmet gate remains explicitly incomplete; do not tag or publish.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/quality.yml README.md docs/ARCHITECTURE.md docs/SECURITY.md CHANGELOG.md
git commit -m "docs: define the PWA production boundary"
```
