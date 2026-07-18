# Durable Folder Inbox

Every registered local or synchronized folder is a durable source queue available to the whole desktop process, not only while Import Inbox is open.

## Lifecycle

```text
DISCOVERED -> PROCESSING -> READY | NEEDS_MAPPING | FAILED
READY | NEEDS_MAPPING | FAILED -> PROCESSING -> STAGED
actionable state -> IGNORED
missing generation -> REMOVED
```

`STAGED` means an import run exists; it never means candidates were approved or posted.

## Metadata and claims

The queue stores household/folder IDs, relative path, filename, media type, size, modified time, generation fingerprint, state, retry data, and optional run ID. It stores neither source bytes nor the granted absolute path.

A bounded claim reads the file and revalidates relative path, media type, size, and modified time. A mismatch fails with `FILE_CHANGED_DURING_READ`; reconciliation discovers the new generation separately.

Filesystem events, polling, and manual scans use one idempotent reconciliation path. Claims are limited to 25 items with five-minute leases and five fresh-parse attempts. Restart rehydration does not consume that retry budget. A staged item reopens only after its linked run is rolled back.

Users may disable automatic preview without stopping metadata discovery. Retry and ignore never delete the source file. Folder Inbox stops at preview and run linking; only canonical review can post balanced entries.
