# Durable Folder Inbox

KakeFlow 0.24 treats every registered local or cloud-synced folder as a durable source queue. Discovery is available from the whole desktop application rather than only while the Import page is mounted.

## Lifecycle

```text
DISCOVERED
  -> PROCESSING
  -> READY | NEEDS_MAPPING | FAILED
  -> PROCESSING
  -> STAGED

DISCOVERED | READY | NEEDS_MAPPING | FAILED -> IGNORED
missing current generation                    -> REMOVED
```

`STAGED` means that a canonical import run exists. It does not mean that transactions were approved or posted. Users must still review every transaction candidate and explicitly commit the accepted decisions.

## Durable metadata

The queue stores only household scope, watched-folder identity, relative path, filename, media type, byte size, modified time, generation fingerprint, state, retry metadata, and an optional canonical import-run reference. It does not store source bytes or the watched folder's absolute path.

The source file is read only after a bounded claim. KakeFlow compares the returned relative path, media type, size, and modified time with the claimed generation before previewing it. A mismatch fails that generation with `FILE_CHANGED_DURING_READ`; the next folder reconciliation discovers the new generation separately.

## Reconciliation and recovery

- Native filesystem events, polling fallback, and manual scans all call the same idempotent reconciliation path.
- Claims are bounded to 25 items and use five-minute leases.
- Fresh discovery parsing is limited to five attempts; expired leases recover safely.
- Rehydrating `READY` or `NEEDS_MAPPING` after an app restart does not consume the fresh-parse retry budget.
- A `STAGED` item can return to the queue only after its linked import run is `ROLLED_BACK`.
- Removed, ignored, or superseded generations remove stale in-memory previews.

## User controls

The Import navigation badge shows actionable queue items from every page. Automatic preview can be disabled; discovery metadata and counts continue to update, but KakeFlow does not claim or read source files until the user requests a refresh. Failed and ignored items can be retried explicitly, while actionable items can be ignored without deleting the source file.

## Accounting boundary

Folder Inbox never writes to the ledger. Its responsibilities stop at discovery, extraction preview, and linking to an import run. Canonical import review remains the only path to a posted, balanced journal entry.
