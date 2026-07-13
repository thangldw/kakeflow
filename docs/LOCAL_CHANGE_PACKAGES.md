# Local change packages

KakeFlow 0.39 provides a user-driven file workflow for moving the current
household state between KakeFlow desktop installations. It does not connect to a
server, poll another device, or transmit a file over a network.

KakeFlow 0.40 keeps original source bytes outside this bounded JSON graph. After
applying a change package, use the separate
[portable confirmed-evidence bundle](PORTABLE_EVIDENCE_BUNDLES.md) to hydrate
the immutable CSV/PDF/image and raw-row provenance referenced by its portable
transaction and card identifiers.

## Covered current state

Package schema v2 declares exactly these thirteen aggregate kinds:

1. household;
2. household members;
3. accounts;
4. posted/draft transaction aggregates, including ordered journal entries,
   labels, tags, portable source references, and provider external keys;
5. card statements with period, due date, amount, derived status, ordered lines,
   and a portable source-document identifier;
6. card payments, including unconfirmed suggestions and confirmed bank-payment
   links;
7. the complete monthly budget plan, including an empty plan;
8. savings goals;
9. classification rules with labels and tags;
10. account groups with ordered members;
11. card-to-bank settlement mappings;
12. dashboard preferences; and
13. delimited parser profiles.

Schema-v1 packages with the original eleven kinds remain valid. Their omission
of card statements and payments never creates deletion candidates for those
aggregates on the receiver.

Source documents and their bytes, import runs/candidates, investment
snapshots/events, watched-folder grants, and derived analytics are not included.
Transaction source identifiers are retained as
portable references; they do not pretend that the missing source document is
present on the receiving installation. The same rule applies to a statement's
source-document identifier: an equal local ID alone does not prove equal bytes,
so it remains portable unless the destination statement already has that exact
actual source link.

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
KakeFlow 0.39 does not perform field-level merges. Accepted mixed choices are
also checked against the derived card status and confirmed-payment invariants;
an inconsistent graph rolls back as one transaction.

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
