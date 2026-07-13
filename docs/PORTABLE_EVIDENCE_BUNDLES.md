# Portable confirmed-evidence bundles

KakeFlow 0.40 adds a separate, passphrase-protected capsule for the immutable
evidence behind already-posted household transactions and card statements. It
complements the reviewable local change package: move the ledger graph first,
then move its evidence capsule so the receiving desktop can open the original
CSV, PDF, or receipt image and inspect the captured raw rows.

## Confirmed scope only

An exported capsule contains only source documents reachable from confirmed
ledger facts:

- source rows attached to posted transactions;
- original documents referenced by confirmed card statements; and
- receipt evidence that a user already linked to a posted expense or card
  purchase.

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

The aliases stay separate from canonical transaction and card payloads. This is
intentional: hydrating evidence must not change the hashes used by local change
packages or create an outgoing change-package echo.

## Failure behavior

The archive is staged outside the live vault and database. A wrong passphrase,
truncated archive, missing object, unexpected object, hash mismatch, oversized
manifest, missing transaction/card dependency, or alias collision stops the
operation before publication. Database changes are atomic. Newly written vault
objects are removed after a failed database apply when no live source document
references them.

## Desktop workflow

In **Settings → Confirmed source evidence**:

1. Enter and confirm a passphrase of at least 12 characters.
2. Save a `.kakeflow-evidence` capsule on the source desktop.
3. On the receiving desktop, apply the matching local change package first.
4. Select the evidence capsule and enter its passphrase.
5. Open a transaction's evidence section to inspect its raw row, original image,
   or PDF page.

This is a user-driven local file workflow. Version 0.40 does not claim automatic
cloud transport, background multi-device sync, or pending-import replication.
