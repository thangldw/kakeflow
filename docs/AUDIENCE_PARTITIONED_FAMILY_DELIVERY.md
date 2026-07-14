# Audience-partitioned family delivery

KakeFlow v0.54 introduced a family-delivery protocol that is deliberately
separate from the schema-v4 personal change package. Personal relay packages
remain suitable only for devices authenticated as the same remote principal.
They must never be filtered and sent to another household member.

KakeFlow v0.56 adds schema-v2 planning/configuration aggregates without
widening that trust boundary. See the dedicated
[planning and configuration contract](FAMILY_PLANNING_CONFIG_DELIVERY.md).

KakeFlow v0.60 adds exact-byte retry and recipient-set-change recovery without
changing the artifact or review contracts. See the dedicated
[recipient-set recovery contract](FAMILY_RECIPIENT_SET_RECOVERY.md).

## Trust and routing boundary

The reference relay authenticates every request and owns the authoritative
mapping between a remote principal, a household membership, and a KakeFlow
member ID. Clients never submit recipient principal IDs. The relay derives the
audience for list and download requests each time:

- `SHARED` is available to every active membership in the household.
- `PERSONAL(member)` is available only to an active membership mapped to that
  member.
- revocation prevents future list and direct-download access for that
  membership generation; it cannot erase a copy that was already downloaded.

Rows inside a delivered household snapshot are data. They do not create or
alter relay membership.

## Family snapshot format

Family delivery uses the versioned `KAKEFLOW_FAMILY_SNAPSHOT_SET` format. New
v0.57 exports use schema 3 while schema 1 and schema 2 remain readable. A snapshot set is
an immutable, current-state collection of audience partitions. Its identity,
source revision, hashes, record counts, excluded counts, and partition audience
are covered by deterministic hashes. Recipient principal IDs are never part of
the package.

Schema v1 supports the intentionally narrow core graph:

- household and member directory records are `SHARED`;
- an account follows its explicit `SHARED` or `PERSONAL(member)` scope;
- a transaction is deliverable only when its own audience and every journal
  account dependency resolve to one audience;
- a dependency graph involving two different personal members is withheld;
- source links and evidence bytes are not included in v0.54.

Schema v2 additionally carries atomic budgets, goals, rules, account groups,
settlement mappings, dashboard layouts, and parser profiles. Account-dependent
aggregates use the same least-widening audience meet. A hash-bound
entity-audience relocation lineage prevents a later omission artifact from deleting an aggregate that moved
between `SHARED` and `PERSONAL(member)`.

Schema v3 adds card and investment aggregates only when their source-origin-
scoped immutable evidence, complete raw rows, and dependency graph fit the same
audience partition. Missing, mismatched, or oversized evidence is disclosed and
withheld rather than silently omitted or widened. See the full
[family evidence delivery contract](FAMILY_EVIDENCE_DELIVERY.md).

## Review and apply

Receiving bytes never changes the ledger. The desktop app validates and stages
the complete set, shows separate shared and personal partitions, and requires
an explicit review and apply action. Shared dependencies are applied before the
matching personal partition.

Lineage is keyed by source installation, household, and exact audience tuple.
An omission can remove an entity only when an accepted replica head exists from
the same source and same partition and the local payload still matches that
head. A record in another partition, a locally created record, or a record with
no accepted head is never an omission-delete candidate.

## Explicit non-claims

KakeFlow v0.58 adds relay-blind recipient encryption through the `KFE1`
transport envelope. The relay stores ciphertext and derives recipients from
active membership, while device private keys remain native. `KFE1` does not
add sender signatures, realtime/background synchronization, remote ledger
posting, remote deletion, or erasure of downloaded copies. The bundled relay
is a reference transport that must be operated separately from the desktop
app.
