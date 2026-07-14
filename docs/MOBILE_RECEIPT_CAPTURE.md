# Mobile receipt capture and desktop Capture Inbox

KakeFlow 0.55 adds a dedicated receipt-capture channel. It is deliberately
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
token in memory, and provides explicit `世帯共有` and `自分のみ` choices. It is
not a native iOS/Android application, an App Store build, a background upload
service, or a production-hosted relay.

## Non-claims

Version 0.55 does not provide remote OCR, automatic matching, automatic
categorization, automatic ledger posting, push/realtime delivery, remote
deletion, end-to-end/zero-knowledge relay encryption, offline mobile queues, or
native mobile distribution. Existing explicit receipt matching and balanced
posting controls remain mandatory.
