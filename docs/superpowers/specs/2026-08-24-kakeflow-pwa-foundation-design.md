# KakeFlow PWA foundation design

**Status:** Implemented on `codex/phase2-pwa-hardening`; final CI and deployment-source cutover remain release gates.

**Goal:** Make KakeFlow an installable, offline-first PWA that supports the authoritative local receipt-to-ledger workflow without an account while preserving a path to native/PWA parity and eventual Money Forward ME replacement.

**Phase 2 capability boundary:** local vault, household/accounts, manual and imported candidates, local receipt OCR, immutable source evidence, explicit approval, balanced posting, provenance lookup, read models, persistent restart, and encrypted export/restore. Gmail, Google Drive, financial-institution connectors, relay, multi-device sync, native updater, watched folders, and SQLCipher-backup compatibility are excluded from this slice.

## Current boundary

The current web runtime is a synthetic preview. It returns a fixed Tanaka household, empty or sample read models, and rejects durable or mutating platform commands. There is no web manifest or service worker. It must not be relabeled as a PWA or production ledger.

The browser already has reusable local capabilities: React UI, validated DTOs, browser file reads, spreadsheet parsing, receipt normalization, posting-decision validation, PP-OCRv5 JavaScript inference, and synthetic OCR regression fixtures. Native persistence, accounting commits, evidence vaults, and most read models remain coupled to Tauri/Rust/SQLCipher.

## Architecture decision

Use one platform-neutral Rust domain core with two persistence adapters. Do not reimplement accounting invariants independently in TypeScript, and do not introduce a cloud ledger merely to make the PWA work.

### Shared domain core

Create a Rust workspace crate, `crates/kakeflow-core`, with no Tauri, filesystem, network, keychain, SQLite, or operating-system dependencies. It owns canonical domain types and deterministic functions for:

- money and currency validation;
- posting-decision validation;
- debit/credit balance enforcement;
- candidate-to-posted transition rules;
- provenance references and canonical hashes;
- duplicate/external-fact identity;
- versioned encrypted-envelope metadata validation.

The crate builds as a native Rust library and a WASM library. Native Tauri code consumes the same functions before SQLCipher commits. The web adapter invokes the WASM exports before IndexedDB commits. Cross-runtime fixtures must produce identical accepted/rejected decisions and canonical hashes.

Parsing that already runs safely in the browser, including receipt text normalization and PP-OCRv5 result mapping, remains TypeScript in this phase. Its output crosses the shared-core boundary as a versioned candidate DTO.

### Explicit runtime selection

Split the current platform selection into three explicit clients:

- `tauri`: native SQLCipher and OS capabilities;
- `pwa`: encrypted browser persistence and supported local workflows;
- `demo`: immutable synthetic data only.

Production PWA builds must never fall back to demo data. Unsupported PWA commands return a typed `UNSUPPORTED_RUNTIME` capability result so the UI can hide or explain them without implying success.

## Browser persistence and encryption

Use IndexedDB for encrypted metadata, event envelopes, and projections. Use OPFS for encrypted source/evidence blobs when supported; use encrypted IndexedDB blobs as the compatibility fallback. Request persistent browser storage and expose whether persistence was granted. Never claim that browser storage cannot be evicted.

Create a versioned local vault with these rules:

- the user supplies a passphrase when creating or unlocking the vault;
- Argon2id runs in a worker/WASM module with versioned salt, memory, iteration, and parallelism parameters;
- the derived key is imported as a non-extractable AES-GCM key;
- transient derived-key bytes are zeroized immediately after the WebCrypto import;
- every record/blob has a unique random nonce and authenticated associated data containing vault ID, record type, record ID, and schema version;
- only salt, KDF parameters, ciphertext metadata, and encrypted payloads persist;
- passphrases and unwrapped keys are never stored, logged, cached by the service worker, or sent over the network;
- lock clears in-memory keys and decrypted projections;
- failed authentication does not partially open or mutate the vault.

PWA export produces a versioned authenticated encrypted archive. Restore validates the complete archive and writes into a new staging vault before atomically switching the active-vault pointer. It does not claim compatibility with the native SQLCipher backup format in Phase 2.

## Authoritative browser data model

Store immutable domain events and rebuildable read projections. Minimum event families are:

- vault and schema lifecycle;
- household and account changes;
- source document and source-record ingestion;
- import run and candidate creation;
- candidate corrections and explicit approval decisions;
- balanced transaction posting;
- audit/provenance links.

An IndexedDB transaction atomically writes the approved candidate transition, balanced posting, ledger entries, provenance edges, and projection revision. A crash before commit leaves all of them absent; a crash after commit leaves all of them present. Projections are disposable and can be rebuilt from authenticated events.

Posted transactions are append-only in the foundation slice. A correction creates a reversing/correcting event chain rather than rewriting provenance. Every visible ledger value links to its source document/record or is explicitly marked manual.

## PWA shell and offline behavior

Keep the existing public landing page at `/kakeflow/`. Publish the application at `/kakeflow/app/` with manifest `scope` and `start_url` set to `/kakeflow/app/`; local development uses `/`. Add a generated service worker for those explicit bases. Provide install icons, standalone display, theme/background colors, and Japanese/English/Vietnamese name/description metadata where supported.

The service worker precaches only versioned application code, static UI assets, fonts, and checksum-verified OCR model resources. It must not cache imported files, decrypted evidence, API responses containing financial data, or vault exports in Cache Storage. Navigation uses an app-shell fallback only within the PWA scope.

Updates are prompt-driven. A new worker may download in the background, but it must not force reload while a vault is unlocked or a review/posting operation is active. Activation occurs after the user accepts, the vault is locked or quiescent, and schema compatibility is confirmed.

## Phase 2 user workflow

The release workflow is:

1. install or open the PWA without creating an online account;
2. create and unlock a local encrypted vault;
3. create a household and required asset/liability/income/expense accounts;
4. import a synthetic receipt image or supported local file;
5. run PP-OCRv5 locally and preserve the original as encrypted evidence;
6. show the candidate beside source regions and reconciliation status;
7. require explicit approval and a balanced posting decision;
8. atomically post the ledger transaction;
9. show updated read models and navigate back to source provenance;
10. reload offline and recover the same committed state after unlocking;
11. export the encrypted vault, delete no active data, and restore into a separately validated vault.

Manual balanced transactions use the same posting core. Unsupported connectors and native-only controls are absent from the PWA navigation rather than displayed as working features.

## Security and privacy boundary

- No account, telemetry, analytics, advertising, or third-party runtime script is required.
- Apply a restrictive CSP; load application and OCR resources from the same origin.
- Treat the browser, extensions, and compromised device session as outside the protection provided by at-rest encryption; document that an unlocked vault is readable by code executing in the origin.
- Do not store connector credentials in this phase.
- Do not expose decrypted financial data through service-worker messages, URLs, error text, console logging, crash artifacts, or performance traces.
- Hashes prove artifact identity and lineage, not truth of OCR or financial correctness.

## Verification strategy

### Shared-core contracts

- Native and WASM tests consume the same literal fixtures.
- Mutations for unbalanced entries, missing approval, altered provenance hashes, duplicate external facts, malformed money, and unsupported schema versions must fail.
- Desktop posting tests prove that extraction did not change native behavior.

### Storage and recovery

- Wrong passphrase, modified ciphertext, nonce reuse guard, interrupted commit, interrupted restore, projection rebuild, schema migration, quota failure, denied persistent storage, and OPFS fallback have deterministic tests.
- Browser integration tests restart the page and browser context before asserting durable state.

### PWA behavior

- Manifest scope/start URL/icon checks run against the production build.
- A browser test installs/loads the service worker, switches network offline, reloads, unlocks the vault, and completes local read/write operations.
- Cache inspection proves no imported evidence, export, or decrypted payload is present in Cache Storage.
- Update tests prove an active posting cannot be interrupted by worker activation.

### End-to-end evidence

One synthetic receipt test exercises OCR candidate, source comparison, explicit approval, balanced posting, provenance navigation, offline restart, encrypted export, and restore without an account or network connector. The same flow supplies the 85-95 second public demo.

## Acceptance gates

- Production build is installable and scoped correctly on GitHub Pages and localhost.
- After one online load, the application shell and local vault workflow run offline.
- No production PWA path returns synthetic demo data.
- Vault records and evidence are unreadable at rest without the passphrase-derived key.
- Wrong passphrase or modified ciphertext changes no state.
- Synthetic receipt OCR, review, approval, balanced posting, and provenance pass end to end.
- An unbalanced or unapproved candidate cannot create any ledger entry.
- Restart preserves committed state; interrupted commit leaves no partial posting.
- Encrypted export/restore passes through a staging vault and preserves canonical hashes.
- Native and WASM shared-core fixtures agree exactly.
- Existing frontend and Rust no-regression floors remain green.
- Network inspection shows no financial payload, key material, imported evidence, or account requirement.
