# iCloud Drive Inbox contract

KakeFlow watches a user-selected, locally synchronized iCloud Drive folder. It does not use CloudKit, sign in to Apple services, enumerate remote storage, or upload the ledger to iCloud.

```text
iCloud local folder
  -> durable file generation
  -> stable-byte claim
  -> provider-aware preview
  -> explicit review and commit
```

Supported CSV, XLSX, PDF, and receipt-image files retain `sourceType = ICLOUD_PICKER` through restart recovery and pending review.

## Placeholder handling

iCloud metadata can appear before bytes are materialized. Such generations remain retryable and are not parsed as corrupt partial files. Fingerprinting starts only after size and modified time stabilize; a changing generation is rejected and rediscovered separately. The UI may ask the user to download the file in Finder.

## Provenance

Lineage retains provider type, inbox/folder IDs, relative path, original filename, modified time, generation fingerprint, size, SHA-256, adapter/version, and import/source/candidate IDs. Absolute granted paths are not exposed.

Discovery never posts. Ignore/retry never deletes or moves the source. The live SQLite database must not be stored in iCloud Drive, and conflict copies remain distinct generations. See [Durable Folder Inbox](DURABLE_FOLDER_INBOX.md).
