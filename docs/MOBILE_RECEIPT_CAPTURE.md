# Mobile receipt capture

Mobile capture is a dedicated transport for unreviewed source evidence. It is separate from confirmed family artifacts, pending-review packages, and evidence bundles.

```text
mobile browser
  -> MOBILE_RECEIPT_CAPTURE_V1 capsule
  -> authenticated capture channel
  -> immutable desktop Capture Inbox
  -> local OCR
  -> REVIEW_REQUIRED receipt
  -> evidence link or explicit posting
```

Receiving or recognizing a capture never posts a transaction.

## Capsule

Version 1 contains a small manifest and exactly one JPEG or PNG up to 20 MiB. It contains no OCR output, accounting fields, transaction, journal, or recipient list. Relay and desktop validate exact capsule/image digests before the original enters the encrypted vault. HEIC, PDF, video, editing, and multi-image batches are unsupported.

## Audience

`SHARED` routes to other active household memberships. `PERSONAL(member)` is limited to active devices for the authenticated sender's member identity and never falls back to the household audience. Capture cursors are independent from family-publication cursors. Revocation cannot erase already downloaded images.

## Desktop intake

Optional 15/30/60-minute receive runs only while KakeFlow is open. Native code stores credentials, claims a durable lease, validates bounded descriptors/capsules, and atomically commits each image with its cursor. Retry is idempotent; authentication or membership failure suspends the schedule until reconnection.

The worker stops at `RECEIVED`. OCR, promotion, matching, categorization, and posting remain visible user actions. Reused identity with changed bytes is rejected; an existing image links to the existing local review instead of creating a duplicate.

## Reference uploader

The browser uploader uses camera/file input, in-memory token handling, explicit audience selection, and a durable IndexedDB foreground queue. It is a protocol test surface—not a native mobile app, background OS service, hosted production relay, or remote OCR system. See [Durable mobile capture queue](DURABLE_MOBILE_CAPTURE_QUEUE.md).
