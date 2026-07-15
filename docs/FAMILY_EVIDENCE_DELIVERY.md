# Audience-partitioned family evidence delivery

KakeFlow extends the manual family-delivery workflow with family snapshot
schema v3 and the `KFF3` artifact envelope. Card and investment aggregates can
now travel only when the same audience partition also contains their complete,
immutable source evidence. Receiving or staging an artifact never changes the
ledger; the recipient must review and explicitly apply it.

## Delivered graph

Schema v3 retains every schema-v1 and schema-v2 record kind and adds seven
evidence-backed aggregates:

- card statements and card payments;
- portfolio snapshots and brokerage events;
- investment FX rates and market prices;
- aggregate asset snapshots.

This produces an exact 18-kind contract. Card payments remain transfers that
settle a liability, not a second household expense. Investment snapshots remain
balance and performance observations, not household transactions.

## KFF3 envelope

Each independently deliverable audience artifact is encoded as:

```text
KFF3 magic (4 bytes)
+ canonical-header length (unsigned 64-bit, big-endian)
+ canonical JSON header
+ original document bytes in manifest order
```

The canonical header binds the family partition, source installation, evidence
manifest, file and raw-record counts, document hashes, portable origin-scoped
IDs, raw rows, and entity links. The 64 MiB artifact limit covers header and
document bytes together. Decoding rejects a non-canonical header, trailing or
truncated data, a count mismatch, or any blob whose digest differs from its
manifest entry.

## Audience closure

KakeFlow computes the least-widening audience across every aggregate and its
dependencies:

- a card statement includes its card account, line transactions, and source
  document;
- a card payment includes its statement, bank transaction, card account, and
  the evidence behind those records;
- an investment observation includes its securities account and linked source
  document and rows;
- a manual or official-reference FX/market observation may be source-free only
  when both source document and source row are absent.

`SHARED` evidence never contains bytes, rows, names, IDs, or hashes belonging to
a `PERSONAL(member)` dependency. Mixed-member graphs are withheld rather than
split or widened. Missing evidence, an audience mismatch, and an artifact-size
limit are disclosed separately. A withheld kind is not authoritative, so its
absence cannot delete an already accepted remote aggregate.

## Origin-scoped provenance

Portable import-run, document, source-record, and candidate IDs are unique only
within the installation that created them. Schema v3 therefore keys aliases and
card source references by `(origin installation, portable ID)`. Forwarding an
artifact preserves the original origin instead of assigning the forwarding
device, preventing two devices with the same local ID from merging unrelated
evidence.

## Review and atomic apply

Staging persists the exact KFF3 bytes and creates the normal family review, but
does not materialize evidence or aggregates. On explicit Apply, KakeFlow:

1. decodes and verifies the pending KFF3 bytes again;
2. writes any new encrypted vault blobs;
3. materializes evidence aliases and accepted aggregates in one SQLite
   transaction;
4. removes newly written vault blobs if the database transaction fails;
5. clears the pending artifact only after a successful apply or explicit
   discard.

Confirmed card payments retain their immutability rules, while an exact retry is
idempotent. The reference relay treats V3 as opaque bytes and preserves the
same immutable publication identity and recipient rules used by V1/V2.

## Compatibility and boundary

- V1 and V2 artifacts remain readable and apply through their existing JSON
  path.
- V3 uses the binary `FAMILY_AUDIENCE_PARTITION_V3` path.
- Current schema v4 preserves this exact evidence model in a distinct `KFF4` /
  `FAMILY_AUDIENCE_PARTITION_V4` artifact and adds the household recurring-
  preference aggregate. Historical KFF3/V3 artifacts remain decoded as the
  exact 18-kind contract documented above; they are never reinterpreted as V4.
- KakeFlow wraps V1/V2/V3 artifacts in the recipient-encrypted `KFE1`
  transport while retaining the exact inner artifact and review contract.
- Delivery remains manual in this implementation: there is no background scheduling or
  automatic apply.
- The relay stores opaque ciphertext, but `KFE1` is not a sender-signature or
  backup-erasure protocol and cannot erase bytes already downloaded.
