# Mobile receipt capture and desktop Capture Inbox

KakeFlow adds a dedicated receipt-capture channel. It is deliberately
separate from confirmed family snapshots, portable pending-import packages,
and confirmed-evidence bundles because a newly photographed receipt is still
unreviewed source evidence.

```text
Mobile browser camera
  -> MOBILE_RECEIPT_CAPTURE_V1 capsule
  -> authenticated household capture channel
  -> immutable local Capture Inbox
  -> desktop-local OCR
  -> normal receipt candidate in REVIEW_REQUIRED
  -> explicit link-to-existing-transaction or explicit ledger approval
```

Receiving or OCR-processing a capture never posts a transaction. The image is
stored locally before OCR, so a missing OCR engine or an unreadable receipt does
not discard the original evidence.

## Capsule boundary

The binary capsule contains a small versioned manifest followed by exactly one
JPEG or PNG image. It contains no OCR result, merchant, amount, category,
account, transaction, journal entry, or remote recipient list. The relay checks
the digest of the opaque capsule; the desktop validates the manifest and image
digest again before storing the image in the encrypted document vault.

Version 1 accepts one JPEG or PNG image of at most 20 MiB. HEIC conversion,
PDFs, video, multi-image batches, and receipt editing are not supported.

## Audience and delivery

The authenticated relay derives recipients from active household membership:

- `SHARED` is available to active members of the household.
- `PERSONAL(member)` is available only to active devices mapped to the sending
  member. A sender cannot choose another member as a personal recipient.

Capture delivery has its own sequence and cursor. It does not consume or alter
the cursor used by confirmed family snapshots. Revocation blocks future relay
access but cannot erase an image that was already downloaded to a desktop.

## Opt-in desktop intake while KakeFlow is open

The Capture Inbox offers an explicit `15`, `30`, or `60` minute automatic
receive schedule. It is off by default and runs only inside the KakeFlow
desktop process. Closing KakeFlow stops the worker; this is not an
operating-system service and does not claim app-closed background operation.

Enabling the schedule validates the current family membership and stores the
relay bearer token through the existing OS-bound family-delivery credential
binding. The WebView never performs scheduled HTTP requests. A bounded native
client lists at most 100 capture descriptors, downloads each opaque capsule,
and validates household, audience, schema, byte size, capsule digest, manifest,
and original-image digest before publication to Capture Inbox.

For each accepted capsule, the immutable receipt row and its capture cursor are
committed in the same SQLite transaction. A failure after one successful image
therefore retries from that image's sequence rather than skipping the failed
capsule. Exact retry is idempotent. Authentication expiry or revoked membership
terminally suspends the schedule until the user reconnects; transient failures
use bounded backoff. A durable lease prevents concurrent workers and recovers
an interrupted in-process run.

The worker stops at `RECEIVED`. It never calls OCR, promotes an import,
matches a receipt, assigns a category, or posts a transaction. Those actions
remain separate, visible user decisions in the desktop UI.

## Desktop states

Transport and ledger processing remain separate concepts. `AVAILABLE` means a
capsule can be downloaded, while `READY_LOCAL` means only that the original
image is safely stored on this desktop. OCR may then produce
`REVIEW_REQUIRED`; that state is still not a posted transaction.

Exact retries reuse the existing capture. A reused capture identity with
different bytes is rejected. When the underlying image is already present,
KakeFlow points to the existing local review instead of creating a second
expense candidate.

## Reference uploader

The repository includes a responsive mobile-browser reference uploader for
testing the protocol. It uses the browser camera/file picker, keeps the relay
token in memory, and provides explicit `世帯共有` and `自分のみ` choices. A
[durable foreground queue](./DURABLE_MOBILE_CAPTURE_QUEUE.md) commits the exact
capsule bytes to IndexedDB before upload, survives a page reload, and uses
bounded retry without changing capture identity. It is not a native iOS/Android
application, an App Store build, an operating-system background upload service,
or a production-hosted relay.

## Non-claims

The capture channel does not provide remote OCR, automatic matching, automatic
categorization, automatic ledger posting, push/realtime delivery, remote
deletion, end-to-end/zero-knowledge relay encryption, operating-system
background delivery while KakeFlow is closed, or native mobile distribution.
Existing explicit receipt matching and balanced posting controls remain
mandatory.
