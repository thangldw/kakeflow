# Local sync foundation

KakeFlow prepares a local, inspectable contract for a future optional
multi-device service. It does **not** connect to a server or transmit financial
data.

## Identity model

- A `sync_device` is a stable logical origin for changes created by one desktop
  installation. Portable restore clears the active local context, so the next
  launch can establish a new device origin without rewriting prior history.
- A `sync_principal` is a local logical actor. It is not a login, cloud account,
  authenticated user, or authorization subject.
- A `household_principal_binding` explicitly maps that local actor to one active
  household member, or to no member. KakeFlow never infers this choice from an
  account owner, display name, or primary-member label.

## Change envelopes and outbox

An explicit binding edit creates an immutable schema-v1 envelope containing the
household, origin device and principal, per-device sequence, caller mutation ID,
entity identity, operation, canonical JSON payload, and SHA-256 payload digest.
The envelope ID is derived from those immutable fields. Repeating the same
mutation and content reuses the same envelope; reusing a mutation ID with
different content is rejected. Pending envelopes are ordered by origin device
and monotonically increasing sequence.

Delivery state lives in a separate outbox row so a future acknowledgement does
not mutate the canonical envelope. In 0.34 the outbox has no transport and every
status is labelled `端末内のみ`.

KakeFlow completes the canonical ledger side of the transactional capture
layer. Household, member, and account payloads retain their complete scalar
state. A transaction capture is a deterministic aggregate containing its full
header, ordered journal entries, sorted labels and tags, source references, and
external identity keys. SQLite records every contributing write in the same
domain commit, and the drain coalesces intermediate states into the last pending
aggregate before producing one immutable envelope.

The [replicable ledger contract](REPLICABLE_LEDGER_CAPTURE.md) is exercised by a
two-database replay test that verifies equal debit and credit totals and exact
metadata/reference reconstruction. This is a contract proof only: there is no
incoming-envelope application runtime in 0.36.

KakeFlow adds seven portable, user-authored planning and configuration
aggregates: the household monthly-budget plan, savings goals, classification
rules with sorted labels and tags, account groups with ordered members, explicit
card-to-bank settlement mappings, saved dashboard preferences, and versioned
CSV/TSV parser profiles. Writes are captured in the same domain commit and
coalesced before envelope creation just like the ledger aggregates.

The [planning and configuration contract](REPLICABLE_PLANNING_CONFIG_CAPTURE.md)
has its own dependency-ordered two-database replay proof. It does not add an
incoming-envelope application runtime or transmit an outbox record.

KakeFlow adds a separate, user-driven [local change package](LOCAL_CHANGE_PACKAGES.md)
workflow. It exports one consistent current-state snapshot for all eleven
covered aggregate kinds, stages it durably on another installation, requires an
explicit decision for every conflict or omission deletion, and applies the
accepted result in one SQLite transaction. Incoming package writes are guarded
from local capture, so applying a package does not echo it into the outbox. This
is file transfer initiated by the user, not outbox delivery or network sync.

KakeFlow introduces package schema v2 and extends that atomic graph with
card statements and card payments. Ordered statement lines, due dates,
unconfirmed suggestions, confirmed settlement links, and portable statement
source references now reconstruct the Cards and forecast read models on the
receiving installation. Schema-v1 packages remain accepted and cannot delete
the new card graph by omission.

KakeFlow introduces package schema v3 with five whole investment
aggregates: portfolio snapshots, brokerage events, investment FX rates, market
prices, and aggregate asset history. The matching evidence capsule is hydrated
first; apply then resolves exact origin/document/row aliases, reconstructs the
facts atomically, and recomputes derived investment read models locally.

## Restore validation

Schema 36 restore validation checks device, principal, member-binding, local
context, envelope, outbox, and transactional-capture relations before activation.
It also validates the final replayable aggregate shape, journal account scope,
line uniqueness, positive integer amounts, debit/credit balance, planning and
configuration field types, deterministic child arrays, and household/account
dependencies. Device-local context is cleared during portable restore, while
logical principals and historical origin/envelope records remain in the backup.

## Explicit non-goals

This release does not provide a sync server, network transport, automatic
package delivery, automatic source-document/blob transport, source/import
aggregate graph, pending-import replication,
end-to-end sync protocol, field-level merge, login,
remote authentication, access control, backend audience enforcement, or mobile
receipt capture. Device-local watched-folder state also remains local. Those
remain separate roadmap milestones.
