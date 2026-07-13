# Local change packages

KakeFlow 0.41 provides a user-driven file workflow for moving the current
household state between KakeFlow desktop installations. It does not connect to a
server, poll another device, or transmit a file over a network.

Original source bytes remain outside this bounded JSON graph. For schema-v3 and
schema-v4 investment data, import the matching [portable confirmed-evidence
bundle](PORTABLE_EVIDENCE_BUNDLES.md) first, then stage/apply the change package.
The package refuses to publish an investment fact unless its portable document,
origin installation, and source row resolve to the already hydrated evidence.

## Covered current state

Package schema v4 declares exactly these eighteen aggregate kinds:

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
18. delimited parser profiles.

Schema-v1 packages with the original eleven kinds, schema-v2 packages with
thirteen kinds, and schema-v3 packages with the original eighteen-kind payloads
remain valid. Their omissions never create deletion candidates for aggregate
kinds they do not cover. A schema-v3 dashboard-preference payload updates its
active template, theme, and density while preserving every destination widget
layout; only schema v4 authoritatively carries the five layouts.

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
