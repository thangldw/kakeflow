# Audience-partitioned family delivery

Family delivery is distinct from same-principal local change packages. The relay derives recipients from authenticated household membership; clients never submit recipient principal IDs.

- `SHARED` reaches other active household memberships.
- `PERSONAL(member)` reaches only active memberships mapped to that member.
- Revocation blocks future list/download for that membership generation but cannot erase downloaded copies.

## Snapshot schemas

`KAKEFLOW_FAMILY_SNAPSHOT_SET` is an immutable current-state collection of audience partitions.

- V1: household/member directory, accounts, and transactions whose complete journal dependency graph resolves to one audience.
- V2: budgets, goals, rules, groups, settlement mappings, dashboard layouts, and parser profiles.
- V3: evidence-backed card and investment aggregates with origin-scoped source identity.
- V4: one complete shared recurring-preference aggregate containing only normalized payee and `CONFIRMED`/`IGNORED`.

Mixed-member or incomplete dependency graphs are withheld rather than widened. Hashes bind identity, revision, counts, exclusions, records, and audience. Older schemas remain readable but have no authority over newer aggregates they cannot represent.

Receiving bytes only stages a review. Shared dependencies apply before matching personal partitions, and every conflict/omission requires explicit resolution before atomic Apply. Omission can delete only a locally unchanged entity with an accepted source/audience head.

`KFE1` adds recipient encryption but not sender signatures, realtime sync, automatic apply, remote deletion, or erasure. The bundled relay remains an operator-run reference service.
