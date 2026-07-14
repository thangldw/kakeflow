# Audience-partitioned planning and configuration delivery

KakeFlow v0.56 extends the explicit family-delivery workflow with a schema-v2
current-state contract for household planning and configuration. It remains a
manual delivery and review workflow: preparing, uploading, downloading, or
staging an artifact never changes the receiving ledger.

## Delivered aggregate graph

Schema v2 retains the schema-v1 household, member, account, and transaction
graph and adds seven complete aggregates:

- the atomic monthly budget plan;
- savings goals;
- classification rules, including ordered labels and tags;
- account groups, including ordered account members;
- card-to-bank settlement mappings;
- all five dashboard-template layouts and the active appearance preference;
- versioned delimited parser profiles.

Each aggregate uses the same canonical JSON and materialization contract as the
schema-v4 local change package. Family delivery does not maintain a second,
weaker representation.

## Audience meet

Household-wide goals, dashboard preferences, and parser profiles are `SHARED`.
Account-dependent aggregates use the least-widening audience across every
referenced account:

```text
SHARED + SHARED                 -> SHARED
SHARED + PERSONAL(member A)     -> PERSONAL(member A)
PERSONAL(A) + PERSONAL(A)       -> PERSONAL(member A)
PERSONAL(A) + PERSONAL(B)       -> withheld
missing or invalid dependency   -> withheld
```

The monthly budget and account group remain whole aggregates. KakeFlow never
splits their child rows into a broader partition merely to increase the number
of records delivered. A publisher can emit only `SHARED` and that publisher's
matching `PERSONAL(member)` partition; another member's personal aggregate is
reported as withheld.

`ACCOUNT_GROUP` rows whose own `groupKind` is `PERSONAL` are withheld as
`UNASSIGNED_SCOPE` in schema v2. The current account-group model has no explicit
owner member, so KakeFlow does not infer an access-control owner from empty or
mutable account membership. Shared account groups still follow the dependency
meet above.

## Coverage disclosure

Each outbound partition reports ledger, planning, configuration, card, and
investment counts together with reason-specific withheld counts. `COMPLETE` is
valid only when every withheld count is zero. In v0.56, confirmed card and
investment aggregates remain withheld as `EVIDENCE_REQUIRED`; their immutable
source bytes and origin-scoped aliases are not silently omitted.

The card and investment figures shown in the withheld panel are household-wide
totals repeated for disclosure; they are not sent once per audience partition.

The desktop review groups records by domain, shows a meaningful aggregate
summary, and warns that applying rules or parser profiles can affect future
classification and imports. It still requires explicit conflict/deletion
choices and one atomic apply action.

## Compatibility and transport

- Desktop decoding and apply retain schema-v1 compatibility.
- New exports use `KAKEFLOW_FAMILY_SNAPSHOT_SET` schema 2.
- The reference relay accepts only `FAMILY_AUDIENCE_PARTITION_V1` or `V2`,
  stores bytes without decoding them, and preserves the exact schema in list
  and download responses.
- Publication identity remains immutable across digest, origin, sender
  membership generation, audience, and schema.
- Revocation still blocks future listing and direct download; it cannot erase
  bytes already downloaded.

## Explicit boundary

Version 0.56 does not deliver card statements, card payments, portfolio
snapshots, brokerage events, investment FX observations, market prices, or
aggregate asset snapshots. Those facts require a partitioned evidence envelope
that binds source origin, document bytes, raw rows, and entity links. They are
withheld rather than sent without their complete dependency graph.

There is still no automatic/background delivery, automatic apply, remote
posting, end-to-end relay encryption, remote erasure, or cloud-backup claim.
