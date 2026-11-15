# PWA passkey quick unlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PWA vault owner can turn on a passkey (PRF-wrapped vault key) as an optional quick unlock, and unlock with it offline, while the passphrase stays valid and mandatory.

**Architecture:** An additive `passkeys` field on the existing `vaults` row holds one shared PRF salt and up to three entries, each an AES-GCM envelope of the raw vault key wrapped by a KEK derived (HKDF) from that credential's PRF output. All WebAuthn calls live in one injectable module; the client orchestrates enrol/unlock/remove; one localized card renders the controls in Simple More and the classic Overview; the unlock card gains a passkey button.

**Tech Stack:** TypeScript, React 18, Web Crypto (HKDF, AES-GCM), WebAuthn PRF extension, `idb`, Vitest + Testing Library, Playwright (Chromium CDP virtual authenticator).

**Spec:** `docs/superpowers/specs/2026-11-15-pwa-passkey-unlock-design.md` (approved by the owner on 2026-11-15; read it with this plan).

## Global Constraints

- All vault access stays in `src/platform/pwa/`; the vault key stays non-extractable once imported; raw key bytes exist only inside enrol/unlock functions and are zeroed in `finally`.
- Additive storage: optional `passkeys` on the `vaults` row; no IndexedDB version bump (`STORAGE_VERSION` stays 2), no `VAULT_SCHEMA_VERSION` change, archives export `state.vault.metadata` only (wrappers never exported or restored).
- `userVerification: "required"`, `residentKey: "preferred"`, `rp.id` = `location.hostname`, random 16-byte `user.id` per enrolment, `excludeCredentials` = stored ids, at most 3 entries, one PRF salt (32 random bytes) per vault.
- KEK = HKDF-SHA-256(ikm = PRF output, salt = UTF-8 vaultId, info = `"KakeFlow passkey wrap v1"`), AES-GCM non-extractable; wrapper context `{ vaultId, recordType: 'PASSKEY_WRAP', recordId: base64url(SHA-256(credential id)), schemaVersion }`.
- Enrolment order: verify passphrase (Argon2id) → one tap runs the WebAuthn ceremony (create, plus a follow-up get with a second tap only if PRF is not returned at create) → re-derive raw key → wrap → decrypt self-check → write. No WebAuthn call may follow an Argon2id run inside the same tap.
- Any unlock failure surfaces as `Vault authentication failed`; nothing is stored on cancel, missing PRF or wrong passphrase.
- Production PWA contract (`npm run build:pwa`, `scripts/pwa-contract.test.ts`): no Tauri strings, native commands or provider words in any chunk; new UI strings are literal `localize("…")` Japanese keys, en/vi hand-inserted after the anchor `"銀行CSVの取込先銀行口座を選択してください。"` in `src/locales/{en,vi}.generated.json` (no re-sorting, no duplicates, no key that is a substring of another source string, no interpolation inside `localize()`), then `npm run build:pwa-catalog` regenerates `src/pwa/locales/*.subset.json`.
- `npx tsc -b` is the type check (not `tsc --noEmit`). 12px text floor, 44px touch targets, existing Simple tokens/classes.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01S3jjZRnvhvhXxyFigfq7oJ`; no model names in code.

## Review Focus

- Wrong passphrase at enrolment: no credential is created, nothing stored (test in Task 3).
- Wrapper copied to another vault or another credential id: unwrap fails (Task 1).
- User cancels the ceremony or the browser returns no PRF: nothing stored, passphrase unlock still works (Tasks 2, 3).
- Credential id longer than 255 characters (security keys): enrolment and unlock still work (Tasks 1, 3).
- Restore from an archive: the new vault has no passkeys, and exported archives contain no wrapper (Task 3).
- Fourth enrolment is rejected; removing the only passkey returns the unlock card to passphrase-only (Tasks 3, 5).
- Hostname is an IP address or `PublicKeyCredential` is missing: option hidden, nothing throws (Task 2).

---

## File Structure

- Create `src/platform/pwa/passkeyWrap.ts`: KEK derivation, wrap/unwrap, record id. Pure crypto.
- Create `src/platform/pwa/passkey.ts`: `PasskeyAuthenticator` interface, browser implementation, capability check, error classes.
- Modify `src/platform/pwa/vaultTypes.ts`, `vaultCrypto.ts`, `database.ts`, `client.ts`: data model, raw-key helpers, persistence, client methods.
- Modify `src/pwa/usePwaClient.ts`, `src/pwa/PwaRoot.tsx`: passkey unlock button and session method.
- Create `src/pwa/QuickUnlockCard.tsx` (+ css in `src/pwa/pwa.css`); modify `src/pwa/SimpleShell.tsx` (`MoreTab`) and `PwaRoot.tsx` (`Overview`) to render it.
- Create `e2e/pwa-passkey.spec.ts`; update CHANGELOG and the spec status line.

---

### Task 1: Passkey wrap crypto and raw-key helpers

**Files:**
- Create: `src/platform/pwa/passkeyWrap.ts`, `src/platform/pwa/passkeyWrap.test.ts`
- Modify: `src/platform/pwa/vaultTypes.ts`, `src/platform/pwa/vaultCrypto.ts`, `src/platform/pwa/vaultCrypto.test.ts`

**Interfaces:**
- Produces (`vaultTypes.ts`): `PasskeyEntry { credentialIdBase64Url: string; wrapped: EncryptedEnvelope; label: string; createdAt: string }` and `PasskeyConfig { prfSaltBase64: string; entries: readonly PasskeyEntry[] }`.
- Produces (`vaultCrypto.ts`): `deriveRawVaultKey(passphrase: string, metadata: VaultMetadata): Promise<Uint8Array>` (Argon2id, then verifies against `metadata.keyCheck`; throws `Vault authentication failed`) and `importVaultKeyBytes(raw: Uint8Array, metadata: VaultMetadata): Promise<CryptoKey>` (imports non-extractable AES-GCM, verifies `keyCheck` with the existing constant-time compare, throws `Vault authentication failed`). `unlockVaultKey` keeps its behaviour and reuses the shared verification.
- Produces (`passkeyWrap.ts`): `PASSKEY_LIMIT = 3`; `passkeyRecordId(credentialId: Uint8Array): Promise<string>` (base64url of SHA-256); `wrapVaultKey(prfOutput: Uint8Array, rawKey: Uint8Array, vaultId: string, credentialId: Uint8Array): Promise<EncryptedEnvelope>`; `unwrapVaultKey(prfOutput: Uint8Array, envelope: EncryptedEnvelope, vaultId: string, credentialId: Uint8Array): Promise<Uint8Array>` (throws `Vault authentication failed`).

- [ ] **Step 1: Write failing tests** in `passkeyWrap.test.ts`: wrap then unwrap returns the 32 bytes; unwrap with a different PRF output fails; unwrap for another `vaultId` fails; unwrap with a different credential id fails; a 1023-byte credential id wraps (record id stays 43 characters); the envelope's `recordType` is `PASSKEY_WRAP`. In `vaultCrypto.test.ts`: `deriveRawVaultKey` then `importVaultKeyBytes` yields a key that decrypts a record encrypted by `createVaultKey`'s key; a wrong passphrase and a wrong raw key both throw `Vault authentication failed`; input bytes are not retained (the helper zeroes only its own copies, the caller zeroes returned bytes).
- [ ] **Step 2: Run** `npx vitest run src/platform/pwa/passkeyWrap.test.ts src/platform/pwa/vaultCrypto.test.ts`; expected: the new tests FAIL (missing exports).
- [ ] **Step 3: Implement** the types, helpers and `passkeyWrap.ts` using `crypto.subtle.deriveKey` (HKDF) and the existing `encryptRecord`/`decryptRecord`; share the key-check verification between `unlockVaultKey` and `importVaultKeyBytes`.
- [ ] **Step 4: Run** the same command plus `npx tsc -b`; expected: PASS, no type errors.
- [ ] **Step 5: Commit** `git add src/platform/pwa && git commit -m "Add passkey key-wrap crypto and raw vault key helpers"`.

---

### Task 2: WebAuthn adapter and capability check

**Files:**
- Create: `src/platform/pwa/passkey.ts`, `src/platform/pwa/passkey.test.ts`

**Interfaces:**
- Produces: `interface PasskeyAuthenticator { create(input: { rpId: string; userId: Uint8Array; challenge: Uint8Array; excludeCredentialIds: readonly Uint8Array[]; prfSalt: Uint8Array }): Promise<PasskeyResult>; get(input: { rpId: string; challenge: Uint8Array; allowCredentialIds: readonly Uint8Array[]; prfSalt: Uint8Array }): Promise<PasskeyResult> }` with `PasskeyResult { credentialId: Uint8Array; prfOutput: Uint8Array | null }`; `class PasskeyCancelledError extends Error`; `class PasskeyUnsupportedError extends Error`; `browserPasskeyAuthenticator(): PasskeyAuthenticator`; `passkeyAvailable(): Promise<boolean>`; `bytesToBase64Url(bytes: Uint8Array): string` and `base64UrlToBytes(value: string): Uint8Array`.

- [ ] **Step 1: Write failing tests** with a fake `navigator.credentials` and `PublicKeyCredential`: `create` requests `userVerification: 'required'`, `residentKey: 'preferred'`, `extensions.prf.eval.first` equal to the salt, passes `excludeCredentials` and a 16-byte user id, and returns the PRF result when `getClientExtensionResults().prf.results.first` is present, `null` otherwise; `NotAllowedError` becomes `PasskeyCancelledError`; `get` passes every allowed id and the salt; `passkeyAvailable()` is false when `PublicKeyCredential` is undefined, when `location.hostname` is an IPv4/IPv6 address, and when `getClientCapabilities()` reports `extension:prf: false`; true otherwise; base64url round-trips 1023 bytes.
- [ ] **Step 2: Run** `npx vitest run src/platform/pwa/passkey.test.ts`; expected: FAIL.
- [ ] **Step 3: Implement** the module: `browserPasskeyAuthenticator` wraps `navigator.credentials.create/get` with `publicKey` options, copies PRF output into a fresh `Uint8Array` and never logs bytes.
- [ ] **Step 4: Run** the test and `npx tsc -b`; expected: PASS.
- [ ] **Step 5: Commit** `git add src/platform/pwa/passkey.ts src/platform/pwa/passkey.test.ts && git commit -m "Add the WebAuthn PRF adapter for the PWA"`.

---

### Task 3: Persistence and client API

**Files:**
- Modify: `src/platform/pwa/database.ts`, `src/platform/pwa/client.ts`, `src/platform/pwa/types.ts`
- Test: `src/platform/pwa/client.test.ts` (new `describe('passkeys')`), `src/platform/pwa/database.test.ts`, `src/platform/pwa/archive.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PasskeyConfig`, `PasskeyEntry`, `deriveRawVaultKey`, `importVaultKeyBytes`, `wrapVaultKey`, `unwrapVaultKey`, `passkeyRecordId`, `PASSKEY_LIMIT`); Task 2 (`PasskeyAuthenticator`, `PasskeyCancelledError`, `PasskeyUnsupportedError`, base64url helpers).
- Produces (`database.ts`): `VaultRow.passkeys?: PasskeyConfig`; `static PwaVaultDatabase.readVaultRow(databaseName: string): Promise<VaultRow | null>`; `static PwaVaultDatabase.openWithKey(databaseName: string, key: CryptoKey, vaultId: string): Promise<PwaVaultDatabase>`; instance `readPasskeys(): Promise<PasskeyConfig | undefined>` and `writePasskeys(config: PasskeyConfig | undefined): Promise<void>` (one readwrite transaction that read-modify-writes the vault row; removing the last entry deletes the field).
- Produces (`client.ts`): `static PwaLedgerClient.readPasskeyCount(databaseName: string): Promise<number>`; `static PwaLedgerClient.unlockWithPasskey(databaseName: string, authenticator: PasskeyAuthenticator, options?: Pick<ClientOptions, 'evidence' | 'now'>): Promise<PwaLedgerClient>`; instance `verifyPassphrase(passphrase: string): Promise<void>`; `enablePasskey(passphrase: string, authenticator: PasskeyAuthenticator, label?: string): Promise<void>`; `listPasskeys(): Promise<readonly PasskeySummary[]>` with `PasskeySummary { credentialIdBase64Url: string; label: string; createdAt: string }` (in `types.ts`); `removePasskey(credentialIdBase64Url: string): Promise<void>`.

- [ ] **Step 1: Write failing tests** using a fake `PasskeyAuthenticator` (deterministic PRF output per credential id): enable then `unlockWithPasskey` opens the same data (create a household first and read it back); `verifyPassphrase` with a wrong passphrase throws `Vault authentication failed` and the fake's `create` is never called by `enablePasskey` when it is given the wrong passphrase (Review Focus 1); a fake whose `create` returns `prfOutput: null` and whose `get` returns null throws `PasskeyUnsupportedError` and `listPasskeys()` stays empty; a fake whose `create` returns null PRF but whose `get` returns it enrols (second-tap path); `PasskeyCancelledError` from `create` stores nothing; a 1023-byte credential id enrols and unlocks; a fourth `enablePasskey` rejects with `Passkey limit reached`; `excludeCredentialIds` passed to `create` equals the stored ids; `removePasskey` removes one entry and unlock by the other still works; passphrase `PwaLedgerClient.unlock` still works in every state; wrapper moved to another vault row fails; `archive.test.ts`: the exported archive bytes contain no `passkeys` content and a vault restored from it has `readPasskeyCount === 0`; `database.test.ts`: `writePasskeys(undefined)` removes the field and a vault row without it is valid.
- [ ] **Step 2: Run** `npx vitest run src/platform/pwa/client.test.ts src/platform/pwa/database.test.ts src/platform/pwa/archive.test.ts`; expected: new tests FAIL.
- [ ] **Step 3: Implement** database and client methods. `enablePasskey` order is fixed: reject if 3 entries; check the passphrase only through the already-verified caller contract (the caller runs `verifyPassphrase` first), run `authenticator.create` (and `get` if PRF is null), then `deriveRawVaultKey(passphrase, metadata)`, `wrapVaultKey`, `unwrapVaultKey` self-check, zero all byte arrays in `finally`, `writePasskeys` last. Create the shared salt on the first enrolment. `unlockWithPasskey` reads the row, calls `authenticator.get` with all ids and the salt, finds the entry by the returned credential id, unwraps, imports, opens with `openWithKey`; any failure throws `Vault authentication failed`.
- [ ] **Step 4: Run** the three test files and `npx tsc -b`; expected: PASS.
- [ ] **Step 5: Commit** `git add src/platform/pwa && git commit -m "Store passkey wrappers and add enrol, unlock and remove to the PWA client"`.

---

### Task 4: Passkey unlock on the unlock screen

**Files:**
- Modify: `src/pwa/usePwaClient.ts`, `src/pwa/PwaRoot.tsx`, `src/pwa/pwa.css`, `src/locales/en.generated.json`, `src/locales/vi.generated.json`, regenerated `src/pwa/locales/*.subset.json`
- Test: `src/pwa/usePwaClient.test.tsx`, `src/pwa/PwaRoot.test.tsx`

**Interfaces:**
- Consumes: `PwaLedgerClient.readPasskeyCount`, `PwaLedgerClient.unlockWithPasskey`, `PasskeyAuthenticator`, `browserPasskeyAuthenticator`, `passkeyAvailable`.
- Produces: `PwaClientSession.unlockVaultWithPasskey(authenticator: PasskeyAuthenticator): Promise<PwaLedgerClient>` (uses the same `run` wrapper as `unlockVault`). `PwaRoot` accepts an optional prop `passkeyAuthenticator?: PasskeyAuthenticator` (defaults to the browser one) so tests can inject a fake.

- [ ] **Step 1: Write failing tests**: `usePwaClient` — `unlockVaultWithPasskey` moves a locked session to unlocked and sets `error` on failure like `unlockVault`; `PwaRoot` — with a stored passkey and an available capability the unlock card shows a primary "Unlock with passkey" button above the passphrase field in en, vi and ja; clicking it unlocks without typing; a cancelled ceremony leaves the passphrase form usable and shows the inline message; with no passkey or unavailable capability the button is absent; the existing passphrase unlock tests are unchanged and pass.
- [ ] **Step 2: Run** `npx vitest run src/pwa/usePwaClient.test.tsx src/pwa/PwaRoot.test.tsx`; expected: new tests FAIL.
- [ ] **Step 3: Implement** the session method, the Root effect that reads the passkey count when `mode === 'locked'` (and when `databaseName` changes) and the button. New strings (Japanese keys with en/vi): "パスキーで開く", "パスキーを使えませんでした。パスフレーズで開いてください。" and their translations; insert after the anchor, then `npm run build:pwa-catalog`.
- [ ] **Step 4: Run** the two test files, `npx vitest run src/pwa`, `npx tsc -b`; expected: PASS.
- [ ] **Step 5: Commit** `git add src && git commit -m "Offer passkey unlock on the PWA unlock screen"`.

---

### Task 5: Quick unlock card (More and classic Overview)

**Files:**
- Create: `src/pwa/QuickUnlockCard.tsx`, `src/pwa/QuickUnlockCard.test.tsx`
- Modify: `src/pwa/SimpleShell.tsx` (`MoreTab`), `src/pwa/PwaRoot.tsx` (`Overview`), `src/pwa/pwa.css`, `src/locales/en.generated.json`, `src/locales/vi.generated.json`, regenerated `src/pwa/locales/*.subset.json`
- Test: `src/pwa/SimpleShell.test.tsx`, `src/pwa/SimpleShellSubset.test.tsx`

**Interfaces:**
- Consumes: `PwaLedgerClient.listPasskeys/verifyPassphrase/enablePasskey/removePasskey`, `PasskeyAuthenticator`, `passkeyAvailable`, `PASSKEY_LIMIT`.
- Produces: `QuickUnlockCard(props: { client: PwaLedgerClient; authenticator?: PasskeyAuthenticator }): JSX.Element | null` (returns null when `passkeyAvailable()` is false). Steps shown in order: off state (explanation, cloud-keychain caveat, "Turn on") → passphrase form with Continue (calls `verifyPassphrase`) → single "Confirm with fingerprint, face or PIN" button (calls `enablePasskey`, shows "Tap again to finish" if the second tap is needed) → on state with a list (label, created date) and per-entry "Turn off" with a confirm that states it does not revoke past access and points to restoring a backup into a new vault.

- [ ] **Step 1: Write failing component tests** in en, vi and ja with a fake authenticator: the full enable flow reaches the on state and lists one entry; wrong passphrase shows an inline error and never shows the confirm button; cancelling the ceremony returns to the off state with a message; turning off asks for confirmation, removes the entry and returns to the off state; the fourth-entry limit disables "Turn on"; the card renders nothing when unavailable; touch targets are buttons of at least 44px height via the existing class (assert the class, not pixels); `SimpleShell.test.tsx`: the card appears in the More tab; `SimpleShellSubset.test.tsx` (the subset-catalog render test) shows every new string translated, none in Japanese.
- [ ] **Step 2: Run** `npx vitest run src/pwa`; expected: new tests FAIL.
- [ ] **Step 3: Implement** the card (state machine in the component, no new dependency), render it in `MoreTab` and in the classic `Overview` next to the existing mode switch. Strings follow the spec's copy: what it does, the synced-passkey caveat, that turning off does not revoke earlier access. Insert en/vi after the anchor and regenerate the subsets.
- [ ] **Step 4: Run** `npx vitest run src/pwa src/platform/pwa`, `npx tsc -b`, eslint on changed files; expected: PASS.
- [ ] **Step 5: Commit** `git add src && git commit -m "Add the quick unlock card to the PWA"`.

---

### Task 6: Browser verification, contract build and docs

**Files:**
- Create: `e2e/pwa-passkey.spec.ts`
- Modify: `CHANGELOG.md`, `docs/superpowers/specs/2026-11-15-pwa-passkey-unlock-design.md` (status line), `docs/superpowers/specs/2026-11-14-pwa-simple-mode-design.md` (passkey note)

**Interfaces:**
- Consumes: everything above; follows the structure of `e2e/pwa-simple.spec.ts` (labels, helpers, 360px viewport, Chromium only).

- [ ] **Step 1: Write the e2e** with a CDP virtual authenticator (`WebAuthn.enable`, `WebAuthn.addVirtualAuthenticator` with `protocol: 'ctap2'`, `transport: 'internal'`, `hasResidentKey: true`, `hasUserVerification: true`, `isUserVerified: true`, `automaticPresenceSimulation: true`, `hasPrf: true`): create a vault and household, open More, turn on quick unlock (passphrase, then confirm), reload, unlock with the passkey button and see the same household, go offline and unlock again, turn off, reload and see only the passphrase form; a second test with a virtual authenticator without PRF shows the "can't unlock with a passkey" message and stores nothing.
- [ ] **Step 2: Run** `npx playwright test e2e/pwa-passkey.spec.ts --trace off`; expected: PASS (use the preinstalled Chromium; see `e2e/pwa-simple.spec.ts` for the server and project setup). If the Chromium build rejects `hasPrf`, stop and report; do not weaken the test.
- [ ] **Step 3: Run the full checks**: `npx tsc -b`, eslint on all changed files, `npx vitest run`, `npm run build`, `npm run build:pwa` (contract), `npx playwright test e2e/pwa-simple.spec.ts e2e/pwa-offline.spec.ts --trace off`; expected: all pass.
- [ ] **Step 4: Write docs**: CHANGELOG Unreleased entry; spec status changed to implemented with the "not verified: Safari/iOS, real authenticators, security keys, cloud-keychain sync" list; one line in the PWA Simple spec noting the passkey is now available as an optional unlock.
- [ ] **Step 5: Commit** `git add e2e docs CHANGELOG.md && git commit -m "Verify the PWA passkey quick unlock in Chromium and document it"`.
