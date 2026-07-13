# Local change packages

KakeFlow 0.38 provides a user-driven file workflow for moving the current
household state between KakeFlow desktop installations. It does not connect to a
server, poll another device, or transmit a file over a network.

## Covered current state

Every package declares exactly these eleven aggregate kinds:

1. household;
2. household members;
3. accounts;
4. posted/draft transaction aggregates, including ordered journal entries,
   labels, tags, portable source references, and provider external keys;
5. the complete monthly budget plan, including an empty plan;
6. savings goals;
7. classification rules with labels and tags;
8. account groups with ordered members;
9. card-to-bank settlement mappings;
10. dashboard preferences; and
11. delimited parser profiles.

Source documents and their bytes, import runs/candidates, card statements and
payment links, investment snapshots/events, watched-folder grants, and derived
analytics are not included. Transaction source identifiers are retained as
portable references; they do not pretend that the missing source document is
present on the receiving installation.

## Export and validation

Export first drains already-recorded local changes and then reads all aggregate
views inside one SQLite read transaction. Canonical JSON and SHA-256 digests bind
every payload, the ordered snapshot, and the complete package. The manifest also
binds the household, source installation/principal, monotonic source revision,
creation time, exact covered-kind list, and per-kind counts.

The receiver rejects unsupported schema/mode values, missing or extra kinds,
duplicate entity keys, identity or household mismatches, non-canonical payloads,
digest changes, excessive record/file sizes, stale revisions, and a different
snapshot presented at an already-applied source revision.

## Review and conflict semantics

Selecting a file only stages it; it never mutates the ledger. The Settings panel
shows add, update, delete, and review counts. New entities and proven unchanged
entities can be prepared automatically. A same-ID difference without a proven
shared entity head is a conflict. An entity present locally but omitted from the
authoritative full-state package is only a deletion candidate for supported
kinds.

Every conflict and deletion starts with no selected resolution. The user must
choose one whole-aggregate outcome:

- keep this device's current aggregate; or
- use the package aggregate (or delete it when omitted).

Households and household members are never inferred as omission deletes.
KakeFlow 0.38 does not perform field-level merges.

## Atomic apply and lineage

Immediately before apply, KakeFlow re-reads every destination aggregate involved
in the package. A change made after review stops the apply and requires a fresh
review. Accepted upserts run in dependency order and deletes in reverse order in
one transaction. If any constraint or dependency fails, no domain change is
committed.

The same transaction records the applied package receipt and the last accepted
source/entity heads. A temporary transactional guard suppresses incoming domain
writes from `sync_local_change_capture`; the package therefore cannot echo into
the local outbox. Re-applying the same accepted package is an idempotent read of
its existing receipt.

## Product boundary

The UI uses `変更パッケージ` and `端末内のみ`. It never labels a package as
cloud-synchronized. Moving the saved file with iCloud Drive, Google Drive,
OneDrive, removable media, or another tool is outside KakeFlow and remains an
explicit user action.
