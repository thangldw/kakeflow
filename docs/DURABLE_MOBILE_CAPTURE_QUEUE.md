# Durable mobile-browser capture queue

KakeFlow's reference receipt uploader persists each completed
`MOBILE_RECEIPT_CAPTURE_V1` capsule in the browser profile before attempting a
relay upload. The queue makes foreground mobile-browser testing resilient to a
temporary network failure or page reload. It is not a native iOS/Android client
or a background delivery service.

```text
Camera / file picker
  -> validate JPEG or PNG
  -> build one deterministic capsule
  -> commit exact capsule bytes to IndexedDB
  -> QUEUED
  -> upload with the stored capture ID and digest
  -> relay acceptance must match both values
  -> DELIVERED
  -> desktop Capture Inbox
  -> local OCR and explicit review
```

The relay token remains only in the password input and is never written to the
queue. Each queue record retains the normalized relay endpoint, household,
audience, origin device ID, immutable capsule bytes, digest, attempt count, and
a non-sensitive error code. Deleting a delivered queue-history entry does not
delete the relay capture or any copy already downloaded by a desktop.

## State contract

| State | Meaning |
| --- | --- |
| `QUEUED` | Capsule is committed locally and ready to send. |
| `UPLOADING` | One foreground upload attempt is in progress. |
| `RETRY_WAIT` | A retryable failure is waiting for bounded backoff. |
| `DELIVERED` | Relay accepted the same capture ID and digest. |
| `NEEDS_ATTENTION` | Automatic retry stopped or relay acceptance mismatched. |

An `UPLOADING` record found after a page restart returns to `QUEUED` without
changing its capsule. Retryable failures use bounded backoff and stop after five
automatic attempts. Manual retry begins a new bounded attempt cycle while
preserving the original capture ID, digest, and bytes. HTTP authorization and
other permanent relay rejections require manual attention immediately.

## Product boundary

- Queue persistence uses IndexedDB in the current browser profile.
- Upload processing runs only while the page is open and has a relay token.
- An online event resumes due work, but the page does not claim operating-system
  background execution.
- Clearing site data, private-browsing lifecycle, or browser storage eviction can
  remove queued captures.
- The reference page does not encrypt capsule bytes independently of the browser
  profile and must not be presented as a production mobile application.
- Relay delivery still never creates a ledger transaction. Desktop-local OCR,
  candidate review, reconciliation, and explicit posting remain mandatory.

See [Mobile receipt capture](./MOBILE_RECEIPT_CAPTURE.md) for the capsule and
desktop Capture Inbox boundaries.
