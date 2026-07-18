# Google Drive connector contract

KakeFlow's Google Drive connector is a direct, read-only desktop integration. It is not a locally synchronized folder wrapper, web scraper, or generally available production service.

## Availability

OAuth, folder binding, recursive discovery, change polling, durable remote inbox, immutable hydration, scheduling, restart recovery, Settings controls, and canonical Import Inbox integration are implemented and locally tested for Google test users.

Public availability still requires Google restricted-scope verification, approved consent configuration, packaged real-account testing, and operational validation.

## Authorization boundary

Recursive selected-folder synchronization uses:

```text
https://www.googleapis.com/auth/drive.readonly
```

`drive.file` is not represented as equivalent. Although the grant is broader, product behavior remains limited to the user-bound folder. KakeFlow never modifies, moves, renames, shares, trashes, or deletes Drive content.

Native OAuth uses Authorization Code with PKCE, the system browser, a random `127.0.0.1` loopback port, state validation, OS credential storage, and native-only tokens. The frontend receives redacted availability and connection state.

References: [Drive authorization](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) and [desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app).

## Folder binding

The user binds one readable folder with a URL or bare ID. Identity uses connection ID, folder ID, and Drive ID—not the folder name. My Drive and shared-drive resources retain their provider scope and breadcrumb. Changing the binding affects future discovery only.

## Race-free synchronization

Initial sync captures a start-page token before recursively crawling the selected tree, then consumes changes from that token until a new token is reached. This closes the crawl/change-feed race.

Incremental sync records additions, updates, moves, removals, renames, shared-drive changes, and token expiry. Cursors advance only after corresponding metadata commits. Remote removal marks an inbox generation out of scope and never erases local evidence.

Automatic sync is opt-in, process-scoped, bounded, retry-aware, and lease protected. `Sync now` invokes the same idempotent worker.

## Remote identity and inbox

A remote generation is identified with connection, Drive, file, provider version/revision, modified time, and local content SHA-256. Filename and path are display metadata. Changed content creates a new immutable generation.

```text
DISCOVERED -> PROCESSING -> READY | FAILED -> NEEDS_MAPPING | STAGED
DISCOVERED | READY | FAILED | NEEDS_MAPPING -> IGNORED
remote removal -> REMOVED
```

`STAGED` means a canonical import run references the immutable snapshot; it does not mean candidates were approved.

## Hydration

Discovery downloads no bytes. A bounded native worker validates MIME/size, downloads or explicitly exports supported Google Workspace files, detects mid-read generation changes, computes SHA-256, and publishes only complete immutable snapshots. Partial downloads are never parsed.

For a Google-native export, provenance retains original and exported MIME types and labels the object as an exported snapshot.

## Review boundary

```text
Drive metadata
  -> remote inbox generation
  -> immutable snapshot
  -> parser preview and mapping
  -> REVIEW_REQUIRED candidates
  -> explicit approval
  -> balanced ledger entries
```

OAuth success, discovery, hydration, parsing, or classification confidence can never post a transaction. Restart recovery uses the same cached generation. Disconnecting Drive does not remove completed evidence or pending reviews.

Provenance retains household/connection/binding IDs, Drive/file IDs, provider revision, relative path, MIME types, timestamps, SHA-256, byte size, adapter/version, source-row evidence, and review outcome. Secrets never enter this graph.
