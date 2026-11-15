# PWA passkey quick unlock: design

Date: 2026-11-15. Status: draft for the owner's approval. The owner chose option A ("an optional quick unlock added after the vault exists; the passphrase stays mandatory and is the recovery path") on 2026-11-15. Parent specs: `2026-11-14-pwa-simple-mode-design.md` (which left passkey out as "a separate design") and `2026-08-24-kakeflow-pwa-foundation-design.md` (the vault).

## Intent and why

The people this product is for (a homemaker, a factory worker, a student, a single person) use the PWA on a phone. A 12+ character passphrase typed on a phone every time the app is opened is the biggest friction left in the product, and people tend to answer friction by choosing weak or reused passphrases. A passkey (fingerprint, face or device PIN) removes the typing while the data stays encrypted on the device and the owner stores nothing.

A passkey by itself proves nothing without a server: there is no relying party to check a signature. The only thing that can protect the vault is a secret that never leaves the authenticator. WebAuthn's **PRF extension** (a per-credential HMAC secret, requested with a salt) provides exactly that. The design therefore uses the passkey as a **key-wrapping key**, not as a login.

## Goals

- A user with an unlocked PWA vault can turn on "Unlock with fingerprint / face / device PIN" under More. Afterwards, the unlock screen offers one primary button for it, with the passphrase form still available below.
- Turning it on needs the passphrase once (to prove the user knows it and to obtain the vault key bytes) and one passkey ceremony.
- The vault format, every existing record, the passphrase unlock and encrypted archives are unchanged. An existing vault keeps working with no migration; a vault without a passkey behaves exactly as today.
- The user can see that it is on and turn it off (removes the wrapper stored on this device).
- Works offline (no network is involved at any step).
- Japanese, English and Vietnamese copy, 44px touch targets, 12px floor, like the rest of the Simple shell.

## Non-goals

- No passkey-only vault and no generated recovery code (that was option B; not chosen).
- No server, no relying-party verification, no account system, no sync of the wrapper between devices (each device enrols itself).
- No change to the passphrase KDF, the vault key derivation, the archive format or the vault schema version.
- No passphrase change feature (there is none today; if one is added later it must re-wrap the passkey entries, see "Constraints").
- No claim that Safari or a real phone was verified: only what the Chromium virtual authenticator can prove is verified here.

## Anti-goals (what would make this a failure even if it works)

- A passkey that opens the vault when the authenticator is not present, or a stored secret that unlocks the vault by itself (the wrapper alone must be useless).
- Lock-in: any state where losing the passkey means losing the data. The passphrase always remains valid and archives are still produced and restored with it.
- Silent weakening: the user must be told, in plain words, that a passkey kept in a cloud keychain is only as safe as that account.

## Constraints

- All vault access stays inside `src/platform/pwa/`. The key stays non-extractable once imported; the only place raw key bytes exist is the enrolment function, which zeroes them.
- Production PWA contract (`scripts/pwa-contract.test.ts`, `npm run build:pwa`): no Tauri strings, native commands or provider words in any chunk; new UI strings go through the catalog subset generator (`npm run build:pwa-catalog`).
- Additive storage: the `vaults` row gains an optional `passkeys` array. The IndexedDB database version and `VAULT_SCHEMA_VERSION` do not change; old rows without the field are valid.
- `tsc -b` is the type check. UI strings: literal `localize("…")` calls with Japanese source keys, en/vi hand-maintained, no interpolation inside `localize()`.
- Archives export `state.vault.metadata` only, so the wrapper is not exported; a restored vault is re-keyed and has no passkey until the user enables it again (this is correct and must stay covered by a test).
- If a future feature changes the vault key, every passkey wrapper must be re-wrapped or removed in the same transaction.

## Approaches considered

1. **PRF secret wraps the existing vault key (chosen).** At enrolment the passphrase is used to re-derive the vault key bytes; a key-encryption key derived from the passkey's PRF output encrypts them (AES-GCM) into a wrapper stored next to the vault metadata. Unlock: assertion with the PRF salt gives the secret, which decrypts the wrapper, which is imported as the same non-extractable AES-GCM key. Trade-off: needs a browser/authenticator with PRF; in exchange there is no format change and the passphrase stays valid.
2. **Re-key the vault with a random data key wrapped by both the passphrase and the passkey.** The textbook envelope-encryption layout and the one that would make a passphrase change cheap later. Rejected for now: it re-encrypts or re-wraps every record and changes the archive and restore path for a feature that is optional.
3. **Store the vault key in IndexedDB, protected only by a WebAuthn user-verification gate.** Rejected: without the PRF secret nothing cryptographic depends on the authenticator, so malware or a copied browser profile unlocks the vault. That is a login screen, not encryption.
4. **Passkey-only vault with a recovery code (option B).** Not chosen by the owner.

## Design

### Data

`VaultRow` (in `src/platform/pwa/database.ts`) gains `readonly passkeys?: readonly PasskeyWrapper[]`. Each entry, plaintext like the rest of the vault metadata:

- `credentialIdBase64Url`: the WebAuthn credential id.
- `prfSaltBase64`: 32 random bytes, the PRF `eval.first` input for this credential.
- `wrapped`: an `EncryptedEnvelope` (AES-GCM) of the 32 raw vault key bytes, context `{ vaultId, recordType: 'PASSKEY_WRAP', recordId: <credential id>, schemaVersion }`, so a wrapper cannot be moved to another vault or credential.
- `label`: a short device/created label for the list in More (default from creation date; not user data).
- `createdAt`: ISO date.

Limit: at most three entries.

### Crypto

- KEK = HKDF-SHA-256(ikm = PRF output (32 bytes), salt = vaultId bytes, info = `"KakeFlow passkey wrap v1"`), imported as a non-extractable AES-GCM key. The PRF output is zeroed after use.
- Enrol: `unlockVaultKey`-equivalent derivation yields the raw bytes (a new internal helper next to `deriveAesKey`, used only here); wrap with the KEK via the existing `encryptRecord`; zero the raw bytes in `finally`.
- Unlock: PRF output → KEK → decrypt wrapper → import raw bytes as the vault key (non-extractable) → verify against `metadata.keyCheck` exactly as `unlockVaultKey` does (constant-time compare). Any failure surfaces as the same "Vault authentication failed" error as a wrong passphrase.
- New `PwaVaultDatabase.openWithKey(databaseName, key)` path (the existing `open` stays for the passphrase).

### WebAuthn ceremony (no server)

- `rp.id` = `location.hostname`; random local challenge (it only has to be fresh); `userVerification: "required"`; `residentKey: "preferred"`; `extensions: { prf: {} }` on create, and a follow-up `get` with `prf: { eval: { first: prfSalt } }` right after creation (some browsers return PRF results only on `get`), so enrolment ends with a verified round trip: the wrapper is written only after the secret has been obtained and the wrapper has been decrypted once successfully.
- If PRF is not supported or the result is missing, enrolment stops with a plain message ("This browser or device can't unlock with a passkey. Keep using your passphrase.") and nothing is stored. (The orphan credential cannot be removed from a web page; this limitation is noted in the user-facing copy only if it proves common.)
- Unlock uses `allowCredentials` of the stored ids, `userVerification: "required"`, PRF eval with the matching salt. It requires a user gesture (button), never an automatic prompt, so iOS accepts it.
- Capability: use `PublicKeyCredential.getClientCapabilities?.()` when present to hide the option early (`extension:prf` false); otherwise offer it and let enrolment fail gracefully.

### UI

- Unlock screen (`PwaRoot`): when the vault row has at least one passkey, show a primary "Unlock with passkey" button above the existing passphrase form; cancel or failure keeps the passphrase form usable with a short inline message.
- More (Simple shell and the classic screens' vault section): a "Quick unlock" card: off state explains in two lines what it does and the cloud-keychain caveat, button "Turn on" asks for the passphrase in a small form (one field, same validation) and then runs the ceremony; on state lists entries with "Turn off" per entry (removes the wrapper only, after a confirm).
- Copy states the trade-off honestly: a passkey saved in a cloud keychain can be used by whoever controls that account; the passphrase is still the strongest protection and is still needed to restore from a backup.

### Client API

`PwaLedgerClient` gains `listPasskeys()`, `enablePasskey(passphrase)` and `removePasskey(credentialId)`; `usePwaClient` gains `unlockVaultWithPasskey()`. All WebAuthn calls live in one module (`src/platform/pwa/passkey.ts`) behind a small interface so unit tests inject a fake authenticator.

### Verification

Unit tests with a fake PRF authenticator: enrol, unlock, wrong credential, missing PRF, cancelled ceremony, wrapper bound to its vault and credential id (moved wrapper fails), at most three, removal, passphrase still works after each, archive export does not contain the wrapper and a restored vault has none. Component tests in en/vi/ja for the unlock screen and the card. Playwright e2e in Chromium with the CDP WebAuthn virtual authenticator (`hasPrf: true`, `hasUserVerification: true`, `isUserVerified: true`): create vault, enable, reload, unlock with passkey, remove, reload, passphrase only; plus a negative run with an authenticator without PRF. `npm run build:pwa` with the contract test. Not verifiable here: Safari/iOS, real platform authenticators, security keys, cloud-keychain sync behaviour.

## Security notes

- The wrapper and credential id are plaintext in IndexedDB; they show that a passkey exists on this device, nothing else. Without the authenticator's PRF secret they are useless.
- A copied browser profile alone cannot unlock the vault (the PRF secret is not in it). A synced passkey moves the PRF secret with the user's keychain account; compromise of that account plus a copy of the profile unlocks the vault. This is the stated trade-off of a synced passkey.
- There is no offline guessing target created by this feature: the wrapper's protection is a 256-bit secret, not a low-entropy secret.
- Removing a passkey deletes the wrapper but cannot revoke the credential from the authenticator; the wrapper cannot be re-used because it is gone and the PRF secret alone does not contain the vault key.
- Enrolment requires the passphrase, so a person using an already-unlocked device cannot add a passkey (and thus a permanent bypass of the passphrase) without knowing it.

## Decided by the owner

Option A: optional quick unlock added after the vault exists; the passphrase stays mandatory and is the recovery path. Owner stores no user data (no server component).

## My calls (please check)

- Passkey is offered on all PWA vaults, in Simple and classic modes, under the vault section of More; not at vault creation.
- Up to three passkeys per vault; the UI manages them as a list.
- `userVerification: "required"` (a passkey that opens financial data must verify the person); `residentKey: "preferred"`.
- The enrolment ceremony ends with a decrypt round trip before anything is stored.
- Re-prompting for the passphrase at enrolment (not just the unlocked session) is intentional.
- Passkey entries are not exported in archives and are not restored.

## Left to the builder

File layout inside `src/platform/pwa/` and `src/pwa/`, the exact HKDF/encoding helpers, error message wording beyond the examples, visual details of the card (reuse the Simple tokens), how the fake authenticator is structured in tests, and whether capability detection hides or only warns.
