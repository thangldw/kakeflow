# Family delivery of recurring-series preferences

The development line after KakeFlow v1.0.0 extends the explicit,
audience-partitioned family-delivery workflow with family snapshot schema v4 and
the `KFF4` artifact envelope. Schema v4 retains the complete schema-v3 graph and
evidence contract and adds one required household aggregate:
`RECURRING_SERIES_PREFERENCES`.

Receiving, decrypting, staging, or reviewing a V4 artifact never changes the
ledger or the receiving household's preferences. The user must choose the local
or incoming whole aggregate and explicitly Apply the reviewed family snapshot.

## Whole household aggregate

The aggregate contains the complete ordered set of explicit recurring-series
decisions for the household. Each item contains only:

- the canonical normalized payee; and
- `CONFIRMED` or `IGNORED`.

`AUTO_DETECTED` is represented by the absence of an explicit item. The aggregate
is still present when its item list is empty, allowing the receiver to distinguish
an authoritative empty state from an older artifact that does not cover recurring
preferences. Accepting an incoming empty aggregate restores every local series to
detector-owned `AUTO_DETECTED` state.

The payload does not transport cadence, expected date, typical or latest amount,
confidence, price-change rate, local optimistic version, or local timestamps.
Those values are derived or installation-local state. The receiving installation
creates or advances its own local concurrency versions during Apply.

## SHARED audience and privacy disclosure

Recurring preferences are household-wide, so the aggregate can appear only in
the `SHARED` partition. It is never copied into a `PERSONAL(member)` partition,
split by payee, or widened from personal transaction evidence. A V4 shared send
therefore reveals every normalized payee with an explicit `CONFIRMED` or
`IGNORED` decision to every active recipient of that household publication.

This is an explicit privacy boundary rather than an inference from transaction
audiences. A household that does not want those normalized payees shared must
not send the V4 `SHARED` partition. Private source documents, private
transactions, detected amounts, and cadence observations are not added to this
aggregate.

## KFF4 artifact

V4 extends the evidence-bearing KFF3 container without weakening its provenance
contract:

```text
KFF4 magic (4 bytes)
+ canonical-header length (unsigned 64-bit, big-endian)
+ canonical JSON header
+ original document bytes in manifest order
```

The canonical header binds the schema-v4 family partition, source installation,
ordered records, evidence manifest, original documents, raw records, aggregate
counts, and digests. The existing 64 MiB artifact bound covers the header and
document bytes together. Non-canonical JSON, invalid counts, trailing or
truncated bytes, digest changes, unsupported decisions, duplicate payees, or an
invalid aggregate audience fail before staging or Apply.

The outer recipient-encrypted `KFE1` transport continues to seal the exact inner
artifact bytes. The relay treats `FAMILY_AUDIENCE_PARTITION_V4` as opaque bytes,
preserves its immutable publication identity, and does not inspect or reinterpret
the recurring decisions.

## Review and atomic Apply

The family review presents recurring preferences in the configuration domain and
warns that accepting them changes future forecasts, fixed-cost review, and
recurring Action Center items without rewriting past transactions. A difference
between local and incoming sets is one conflict; KakeFlow never merges individual
payees from the two sets.

Apply revalidates the exact staged KFF4 artifact and destination state, then
materializes accepted evidence, aggregates, and the preference replacement in
one SQLite transaction. A stale local change, invalid dependency, or failed write
rolls back the entire Apply. Incoming writes do not echo into the receiving
installation's local change-package outbox.

## Compatibility and non-claims

- Family schemas V1, V2, and V3 remain readable through their existing paths.
- Older artifacts do not cover recurring preferences; their omission cannot
  clear or alter local decisions.
- V4 uses `FAMILY_AUDIENCE_PARTITION_V4` and the binary KFF4 inner artifact.
- The reference relay accepts V1 through V4 and rejects unknown V5 declarations.
- Send, download, conflict resolution, and Apply remain explicit user actions.
- This is not automatic synchronization, automatic Apply, remote posting, or a
  cloud-backup/remote-erasure claim.
