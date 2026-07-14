# iCloud Drive Inbox Contract

KakeFlow imports from iCloud Drive through a user-selected, locally synchronized folder. This is a provider-aware extension of the durable Folder Inbox, not an iCloud, CloudKit, or Apple ID API integration.

## Product boundary

The desktop app asks the user to select an iCloud Drive folder with the native folder picker. KakeFlow watches only that granted local folder and its supported descendants. It does not sign in to Apple services, enumerate the user's remote drive, request access to the whole iCloud account, or upload the household ledger to iCloud.

```text
iCloud Drive
  -> Apple syncs a selected folder to the Mac
  -> KakeFlow durable Folder Inbox discovers a local generation
  -> stable bytes are claimed and previewed
  -> source type ICLOUD_PICKER is retained
  -> user reviews the candidates
  -> explicit commit posts balanced ledger entries
```

The selected folder may contain CSV, Excel, PDF, or supported receipt images. Normal adapter detection, size limits, duplicate checks, and review rules remain unchanged.

## Placeholder and retry behavior

iCloud can expose file metadata before the file's bytes have been downloaded. A placeholder is not a corrupt document and must not be parsed as a partial file.

- Discovery persists the generation in the durable inbox even when bytes are not materialized.
- Claim/read failures that identify an unavailable provider placeholder remain retryable. They do not become a permanent parser failure.
- Retry uses a bounded attempt count and backoff. The UI can direct the user to download the file in Finder and retry.
- Fingerprinting and parsing start only after the file is materialized and its size and modified time are stable.
- If a generation changes while being read, KakeFlow rejects that read and discovers the new generation separately.

Automatic discovery never implies automatic posting. A materialized file still passes through preview, mapping, duplicate/reconciliation checks, and the same human review gate as a manual upload.

## Provenance contract

Each hydrated preview takes its source type from the durable inbox item. An iCloud-backed item therefore creates an import request and `SourceDocument` with `sourceType = ICLOUD_PICKER`; it must never be silently rewritten to `LOCAL_FOLDER`.

The lineage graph retains:

- provider-aware source type;
- watched-folder and inbox-item identifiers;
- relative path and original filename, without exposing the granted absolute path;
- source modified time, stable generation fingerprint, byte size, and SHA-256;
- import-run, source-document, source-record, and candidate identifiers;
- adapter/version and immutable source evidence used during review.

Restart recovery and pending-review hydration must preserve the same source type. Idempotency uses the existing source-document and generation fingerprints, so rescanning the same materialized file does not create a second expense.

## Review and accounting boundary

Folder discovery and document extraction stop before the ledger. The user must confirm the canonical candidates, receipt matches, transfers, and card-payment reconciliation. Only an explicit commit may create posted transactions and balanced entries. Ignoring or retrying an inbox item never deletes or moves the original iCloud file.

## Known limitations

- iCloud Drive must be configured and the selected files must be available locally.
- KakeFlow cannot guarantee or force a background iCloud download.
- There is no remote folder enumeration, CloudKit database access, Apple-account sign-in, or iCloud web scraping.
- iCloud conflict copies and provider version history are separate file generations; KakeFlow does not resolve them automatically.
- The live SQLite database must not be placed in iCloud Drive. Multi-device ledger synchronization is a separate feature.
- File moves, deletes, and provider eviction are observed only through the local filesystem state and do not cause remote mutations.
- macOS is the primary supported iCloud workflow. A locally synchronized iCloud folder on Windows can use the same inbox semantics when the desktop provider exposes stable local files, but parity depends on Apple's Windows client.

For the shared lifecycle, retry budget, and recovery semantics, see [Durable Folder Inbox](./DURABLE_FOLDER_INBOX.md).
