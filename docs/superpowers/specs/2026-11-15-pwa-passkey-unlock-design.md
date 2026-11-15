# PWA passkey quick unlock: design

Date: 2026-11-15. Status: draft for the owner's approval. The owner chose option A ("an optional quick unlock added after the vault exists; the passphrase stays mandatory and is the recovery path") on 2026-11-15. Parent specs: `2026-11-14-pwa-simple-mode-design.md` (which left passkey out as "a separate design") and `2026-08-24-kakeflow-pwa-foundation-design.md` (the vault).

## Intent and why

The people this product is for (a homemaker, a factory worker, a student, a single person) use the PWA on a phone. A 12+ character passphrase typed on a phone every time the app is opened is the biggest friction left in the product, and people tend to answer friction by choosing weak or reused passphrases. A passkey (fingerprint, face or device PIN) removes the typing while the data stays encrypted on the device and the owner stores nothing.

A passkey by itself proves nothing without a server: there is no relying party to check a signature. The only thing that can protect the vault is a secret that never leaves the authenticator. WebAuthn's **PRF extension** (a per-credential HMAC secret, requested with a salt) provides exactly that. The design therefore uses the passkey as a **key-wrapping key**, not as a login.

## Goals

- A user with an unlocked PWA vault can turn on "Unlock with fingerprint / face / device PIN" under More. Afterwards, the unlock screen offers one primary button for it, with the passphrase form still available below.
- Turning it on needs the passphrase once (to prove the user knows it and to obtain the vault key bytes) and one passkey ceremony, each on its own tap (see "WebAuthn ceremony").
- The vault format, every existing record, the passphrase unlock and encrypted archives are unchanged. An existing vault keeps working with no migration; a vault without a passkey behaves exactly as today.
- The user can see that it is on and turn it off (removes the wrapper stored on this device). Turning it off removes the convenience; it does not revoke access (see Security notes).
- Works offline (no network is involved at any step).
- Japanese, English and Vietnamese copy, 44px touch targets, 12px floor, like the rest of the Simple shell.

## Non-goals

- No passkey-only vault and no generated recovery code (that was option B; not chosen).
- No server, no relying-party verification, no account system, no sync of the wrapper between devices (each device enrols itself).
- No change to the passphrase KDF, the vault key derivation, the archive format or the vault schema version.
- No passphrase change feature (there is none today; if one is added later it must re-wrap the passkey entries, see "Constraints").
- No claim that Safari or a real phone was verified: only what the Chromium virtual authenticator can prove is verified here.
- No support for serving the PWA from an IP address or several hostnames: WebAuthn needs a domain `rp.id` (https or `localhost`). The option is hidden when the hostname is an IP address.

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

`VaultRow` (in `src/platform/pwa/database.ts`) gains `readonly passkeys?: PasskeyConfig`, plaintext like the rest of the vault metadata:

- `prfSaltBase64`: 32 random bytes, **one per vault**, created at the first enrolment and used as the PRF `eval.first` input for every credential of the vault. (The PRF output is already different for every credential; one shared salt lets the unlock ceremony list several `allowCredentials` without needing `evalByCredential`.)
- `entries`: up to three, each with
  - `credentialIdBase64Url`: the WebAuthn credential id (up to 1023 bytes is allowed; it is stored as a field, never as a record id).
  - `wrapped`: an `EncryptedEnvelope` (AES-GCM) of the 32 raw vault key bytes, context `{ vaultId, recordType: 'PASSKEY_WRAP', recordId: <base64url of SHA-256(credential id)>, schemaVersion }`, so the id always fits the 255-character identifier rule, and a wrapper cannot be moved to another vault or credential.
  - `label`: a short label for the list in More (default from the creation date; not user data).
  - `createdAt`: ISO date.

The limit of three is for "this phone plus a second device or a security key", not for re-enrolment: enrolment passes the existing credential ids as `excludeCredentials`, so the same authenticator cannot be enrolled twice, and `user.id` is 16 random bytes per enrolment (never the vault id, which would let a second enrolment silently replace the first discoverable credential). A second device that uses a hybrid (phone-to-phone) flow may need Bluetooth and network; that is not an offline path and the copy does not promise it.

### Crypto

- KEK = HKDF-SHA-256(ikm = PRF output (32 bytes), salt = vaultId bytes, info = `"KakeFlow passkey wrap v1"`), imported as a non-extractable AES-GCM key. The PRF output is zeroed after use.
- Enrol: `unlockVaultKey`-equivalent derivation yields the raw bytes (a new internal helper next to `deriveAesKey`, used only here); wrap with the KEK via the existing `encryptRecord`; zero the raw bytes in `finally`.
- Unlock: PRF output → KEK → decrypt wrapper → import raw bytes as the vault key (non-extractable) → verify against `metadata.keyCheck` exactly as `unlockVaultKey` does (constant-time compare). Any failure surfaces as the same "Vault authentication failed" error as a wrong passphrase.
- New `PwaVaultDatabase.openWithKey(databaseName, key)` path (the existing `open` stays for the passphrase).

### WebAuthn ceremony (no server)

- `rp.id` = `location.hostname`; random local challenge (it only has to be fresh); `userVerification: "required"`; `residentKey: "preferred"`; random 16-byte `user.id`; `excludeCredentials` = the stored ids; `extensions: { prf: { eval: { first: prfSalt } } }` on create (Chrome 116+ and Safari 18+ return the PRF result at creation; where only `prf.enabled` comes back, a follow-up `get` with the same eval is needed and costs the user a **second tap**, which is accepted).
- Because WebKit requires a fresh user gesture for each WebAuthn call and Argon2id takes seconds on a phone, enrolment is split so that no WebAuthn call follows a long computation inside the same tap: (1) the user types the passphrase and taps Continue; the passphrase is verified against `metadata.keyCheck` (Argon2id) and discarded, no raw key bytes are kept between steps; (2) the screen shows a single "Confirm with fingerprint / face / PIN" button; that tap runs the create (and the follow-up get when needed); (3) the passphrase is re-derived (no gesture needed) to obtain the raw bytes, the KEK wraps them, the wrapper is decrypted once as a self-check, and only then is the row written. The re-derivation means a second Argon2id run; it is preferred over holding raw key bytes in memory between taps.
- If PRF is not supported or the result is missing, enrolment stops with a plain message ("This browser or device can't unlock with a passkey. Keep using your passphrase.") and nothing is stored. The orphan credential cannot be removed from a web page.
- Unlock uses `allowCredentials` of all stored ids, `userVerification: "required"` and PRF eval with the vault's shared salt; the credential id returned selects the entry. It requires a user gesture (button), never an automatic prompt, so iOS accepts it.
- Capability: use `PublicKeyCredential.getClientCapabilities?.()` when present to hide the option early (`extension:prf` false); otherwise offer it and let enrolment fail gracefully. Hidden when the hostname is an IP address.

### UI

- Unlock screen (`PwaRoot`): when the vault row has at least one passkey, show a primary "Unlock with passkey" button above the existing passphrase form; cancel or failure keeps the passphrase form usable with a short inline message.
- A single localized `QuickUnlockCard` (Japanese, English, Vietnamese) is rendered under More in the Simple shell and in the localized vault chrome of the classic screens (the classic receipt, ledger, evidence and backup screens stay English-only as today). The card: off state explains in two lines what it does and the cloud-keychain caveat, button "Turn on" asks for the passphrase in a small form (one field, same validation) and then runs the ceremony; on state lists entries with "Turn off" per entry (removes the wrapper only, after a confirm).
- Copy states the trade-offs honestly: a passkey saved in a cloud keychain can be used by whoever controls that account; the passphrase is still the strongest protection and is still needed to restore from a backup; and turning the quick unlock off does not revoke access for anyone who already has a copy of this device's data plus the passkey (to cut that off, restore a backup into a new vault, which is re-keyed).

### Client API

`PwaLedgerClient` gains `listPasskeys()`, `enablePasskey(passphrase)` and `removePasskey(credentialId)`; `usePwaClient` gains `unlockVaultWithPasskey()`. All WebAuthn calls live in one module (`src/platform/pwa/passkey.ts`) behind a small interface so unit tests inject a fake authenticator.

### Verification

Unit tests with a fake PRF authenticator: enrol, unlock, wrong credential, missing PRF, cancelled ceremony, wrapper bound to its vault and credential id (moved wrapper fails), at most three, removal, passphrase still works after each, archive export does not contain the wrapper and a restored vault has none. Component tests in en/vi/ja for the unlock screen and the card. Playwright e2e in Chromium with the CDP WebAuthn virtual authenticator (`hasPrf: true`, `hasUserVerification: true`, `isUserVerified: true`): create vault, enable, reload, unlock with passkey, remove, reload, passphrase only; plus a negative run with an authenticator without PRF. `npm run build:pwa` with the contract test. Not verifiable here: Safari/iOS, real platform authenticators, security keys, cloud-keychain sync behaviour.

## Security notes

- The wrapper and credential id are plaintext in IndexedDB; they show that a passkey exists on this device, nothing else. Without the authenticator's PRF secret they are useless.
- A copied browser profile alone cannot unlock the vault (the PRF secret is not in it). A synced passkey moves the PRF secret with the user's keychain account; compromise of that account plus a copy of the profile unlocks the vault. This is the stated trade-off of a synced passkey.
- There is no offline guessing target created by this feature: the wrapper's protection is a 256-bit secret, not a low-entropy secret.
- Removing a passkey deletes the wrapper from this device and cannot revoke the credential from the authenticator. The vault key never changes, so anyone who already holds an earlier copy of this device's IndexedDB data (which still contains the wrapper) and the passkey can still unlock it after "Turn off". Turning it off removes the convenience, not past exposure. Full revocation means re-keying the vault, which restoring a backup into a new vault does today (approach 2 would make this cheap; it is deferred).
- Enrolment requires the passphrase, so a person using an already-unlocked device cannot add a passkey (and thus a permanent bypass of the passphrase) without knowing it.

## Decided by the owner

Option A: optional quick unlock added after the vault exists; the passphrase stays mandatory and is the recovery path. Owner stores no user data (no server component).

## My calls (please check)

- Passkey is offered on all PWA vaults, in Simple and classic modes, under the vault section of More; not at vault creation.
- Up to three passkeys per vault, one shared PRF salt per vault, random `user.id` per enrolment and `excludeCredentials`; the UI manages them as a list.
- Enrolment is three steps (passphrase check, one tap for the passkey ceremony, then wrap) with a second Argon2id run instead of holding raw key bytes between taps; a second tap is accepted when the browser returns PRF only on `get`.
- The wrapper record id is the base64url SHA-256 of the credential id.
- The quick unlock card is trilingual; the classic receipt, ledger, evidence and backup screens stay English.
- `userVerification: "required"` (a passkey that opens financial data must verify the person); `residentKey: "preferred"`.
- The enrolment ceremony ends with a decrypt round trip before anything is stored.
- Re-prompting for the passphrase at enrolment (not just the unlocked session) is intentional.
- Passkey entries are not exported in archives and are not restored.

## Left to the builder

File layout inside `src/platform/pwa/` and `src/pwa/`, the exact HKDF/encoding helpers, error message wording beyond the examples, visual details of the card (reuse the Simple tokens), how the fake authenticator is structured in tests, and whether capability detection hides or only warns.
