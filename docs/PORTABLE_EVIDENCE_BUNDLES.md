# Portable confirmed-evidence bundles

KakeFlow 0.41 extends the separate, passphrase-protected capsule to immutable
evidence behind posted household transactions, card statements, and confirmed
investment facts. Capsule schema v2 can hydrate evidence before the matching
schema-v3 change package, resolving the dependency cycle created by non-null
portfolio/brokerage source references.

## Confirmed scope only

An exported capsule contains only source documents reachable from confirmed
ledger facts:

- source rows attached to posted transactions;
- original documents referenced by confirmed card statements; and
- receipt evidence that a user already linked to a posted expense or card
  purchase;
- source documents and rows behind portfolio snapshots, brokerage events,
  investment FX observations, market prices, and aggregate asset history.

Pending Import Inbox items, mutable transaction candidates, watched-folder
grants, OCR caches, failed imports, and rolled-back imports are excluded. An
evidence import never posts a new expense, changes a journal entry, or resolves
an Inbox item.

## Portable identity and deduplication

The capsule preserves the originating installation, import-run, document,
record, transaction-link, and statement-reference identifiers. On import,
KakeFlow authenticates the complete capsule and validates every byte count,
content hash, raw-row hash, household reference, and confirmed relationship
before changing the live database.

Original files remain content-addressed. If the receiving vault already has the
same SHA-256 object, KakeFlow reuses it and records a portable alias. A portable
identifier that already names different content is rejected. Applying the same
capsule again is idempotent.

The aliases stay separate from canonical transaction, card, and investment payloads. This is
intentional: hydrating evidence must not change the hashes used by local change
packages or create an outgoing change-package echo.

## Failure behavior

The archive is staged outside the live vault and database. A wrong passphrase,
truncated archive, missing object, unexpected object, hash mismatch, oversized
manifest, a missing schema-v1 transaction/card dependency, an existing but
mismatched schema-v2 dependency, or an alias collision stops the operation
before publication. Schema-v2 evidence may be hydrated before its matching
change package. Database changes are atomic. Newly written vault
objects are removed after a failed database apply when no live source document
references them.

## Desktop workflow

In **Settings → Confirmed source evidence**:

1. Enter and confirm a passphrase of at least 12 characters.
2. Save a `.kakeflow-evidence` capsule on the source desktop.
3. On the receiving desktop, select the evidence capsule and enter its passphrase.
4. Stage, review, and apply the matching local change package.
5. Open a transaction or investment fact to inspect its raw row, original image,
   or PDF page.

Schema-v1 capsules retain their original exact transaction/card dependency
behavior. Schema-v2 capsules may hydrate their immutable source aliases first;
the later change-package apply still requires the exact origin/document/row
relationship before publishing investment facts.

This is a user-driven local file workflow. Version 0.41 does not claim automatic
cloud transport, background multi-device sync, or pending-import replication.
