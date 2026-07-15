# Local change packages

KakeFlow 0.41 provides a user-driven file workflow for moving the current
household state between KakeFlow desktop installations. It does not connect to a
server, poll another device, or transmit a file over a network.

Original source bytes remain outside this bounded JSON graph. For schema-v3
through schema-v5 investment data, import the matching [portable confirmed-evidence
bundle](PORTABLE_EVIDENCE_BUNDLES.md) first, then stage/apply the change package.
The package refuses to publish an investment fact unless its portable document,
origin installation, and source row resolve to the already hydrated evidence.

## Covered current state

Package schema v5 declares exactly these nineteen aggregate kinds:

1. household;
2. household members;
3. accounts;
4. posted/draft transaction aggregates, including ordered journal entries,
   labels, tags, portable source references, and provider external keys;
5. card statements with period, due date, amount, derived status, ordered lines,
   and a portable source-document identifier;
6. card payments, including unconfirmed suggestions and confirmed bank-payment
   links;
7. portfolio snapshots with asset classes, positions, and snapshot FX rates;
8. brokerage events with ordered balanced legs and explicit corporate-action terms;
9. dated investment FX observations;
10. dated investment market-price observations;
11. Money Forward aggregate asset snapshots with category components;
12. the complete monthly budget plan, including an empty plan;
13. savings goals;
14. classification rules with labels and tags;
15. account groups with ordered members;
16. card-to-bank settlement mappings;
17. dashboard preferences, including the active template, theme, density, and
    the independent widget order and hidden-widget set for all five templates; and
18. delimited parser profiles; and
19. the complete household recurring-series preference set, including an empty
    set.

Schema-v1 packages with the original eleven kinds, schema-v2 packages with
thirteen kinds, and schema-v3 packages with the original eighteen-kind payloads
remain valid. Schema-v4 packages retain the same eighteen kinds and add the
authoritative five-layout dashboard-preference payload. Omissions in schema v1
through schema v4 never create a recurring-preference deletion or clear a local
review decision because those schemas do not cover the new aggregate. A
schema-v3 dashboard-preference payload updates its active template, theme, and
density while preserving every destination widget layout; schema v4 and schema
v5 authoritatively carry all five layouts.

## Recurring-series preference aggregate

Schema v5 contains exactly one `RECURRING_SERIES_PREFERENCES` record whose
entity identity is the household. Its canonical payload contains an ordered
list of the household's explicit `CONFIRMED` and `IGNORED` decisions keyed by
normalized payee. `AUTO_DETECTED` is the absence of an explicit decision and is
therefore not serialized as an item. The aggregate is required even when the
ordered list is empty, so a receiver can distinguish an intentional empty
current state from a package that does not cover recurring preferences.

The transported item contains the normalized payee and decision only. The local
integer `version`, creation timestamp, and update timestamp are implementation
metadata for optimistic writes on one installation; they are not portable facts
and do not participate in the package payload or digest. Receiving KakeFlow
creates or advances its own local versions during Apply and reloads those tokens
before another local edit.

The whole preference set is reviewed as one household aggregate. KakeFlow does
not merge individual payees from local and incoming sets. Choosing the package
value atomically replaces the explicit set, so an incoming empty list restores
all local recurring series to detector-owned `AUTO_DETECTED`. Choosing the local
value preserves the complete local set.

Source bytes, mutable import runs/candidates, watched-folder grants, and derived
analytics are not included. Holdings, FIFO lots, realized-performance reports,
market valuation, and charts are recomputed from the five confirmed investment
aggregate kinds after apply.
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

For schema v4, the dashboard-preference aggregate must contain exactly the five
known templates. Every template has one exhaustive, duplicate-free four-widget
order and a template-compatible hidden set that leaves at least one eligible
widget visible. Missing templates, unknown widgets, duplicate entries, and Cash
Flow hidden sets that incorrectly include the ineligible `SPENDING` widget are
rejected before the package can mutate the destination.

For schema v5, the recurring preference aggregate must appear exactly once and
belong to the package household. Normalized payees must already satisfy the
detector's canonical normalization, must be unique and deterministically
ordered, and may carry only `CONFIRMED` or `IGNORED`. Missing aggregates,
duplicate payees, `AUTO_DETECTED` rows, local optimistic versions, timestamps,
or unknown fields are rejected before staging.

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
KakeFlow does not perform field-level merges. Accepted mixed choices are checked
against derived card status, confirmed-payment invariants, investment account
scope, exact evidence dependencies, and balanced brokerage semantics; an
inconsistent graph rolls back as one transaction.

Dashboard appearance is reviewed as one aggregate. Accepting its incoming value
replaces the active preference and all five layouts atomically. Keeping the local
value retains the complete destination appearance; KakeFlow never mixes layouts
field by field.

Recurring-series preferences follow the same whole-aggregate rule. A local and
incoming difference is shown for explicit review; no decision is imported,
deleted, or restored merely because a package was selected or staged.

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

The UI presents the evidence capsule as step 1 and `変更パッケージ` as step 2.
It never labels a package as cloud-synchronized. Moving the saved file with iCloud Drive, Google Drive,
OneDrive, removable media, or another tool is outside KakeFlow and remains an
explicit user action.

Schema v5 portability is not family delivery. Local change packages and the
optional same-principal desktop relay use a different contract from
audience-partitioned cross-principal family artifacts. Adding this aggregate to
a local package does not place it in `SHARED` or `PERSONAL(member)` family
partitions and does not enable automatic delivery or Apply.
