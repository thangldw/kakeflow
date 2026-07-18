# Durable mobile capture queue

The reference uploader commits each deterministic `MOBILE_RECEIPT_CAPTURE_V1` capsule to IndexedDB before relay upload. This makes foreground testing resilient to reloads and temporary network failures; it is not a native or background mobile service.

```text
image selection
  -> capsule validation and construction
  -> IndexedDB commit
  -> QUEUED -> UPLOADING
  -> DELIVERED | RETRY_WAIT | NEEDS_ATTENTION
```

| State | Meaning |
| --- | --- |
| `QUEUED` | Exact capsule is durable and ready. |
| `UPLOADING` | One foreground request is active. |
| `RETRY_WAIT` | Retryable failure is in bounded backoff. |
| `DELIVERED` | Relay accepted the same ID and digest. |
| `NEEDS_ATTENTION` | Retry stopped or relay response conflicted. |

After restart, `UPLOADING` returns to `QUEUED` without changing ID, digest, or bytes. Automatic retry stops after five attempts; manual retry starts another bounded cycle with the same immutable capsule. Authorization and permanent relay rejections require attention immediately.

The bearer token remains only in the current password input. Queue records retain endpoint, household, audience, origin device, capsule bytes, digest, attempt count, and a non-sensitive error code.

Processing requires the page to be open and supplied with a token. Clearing browser storage can remove queued data. Relay delivery does not run OCR or create a transaction; desktop review remains mandatory. See [Mobile receipt capture](MOBILE_RECEIPT_CAPTURE.md).
