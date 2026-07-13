# Local sync foundation

KakeFlow 0.34 prepares a local, inspectable contract for a future optional
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

KakeFlow 0.35 adds a transactional capture layer for household-member, account,
and canonical transaction inserts/updates (plus transaction deletes). SQLite
records the capture in the same commit as the domain write. The local foundation
drains captures in monotonically increasing order into the immutable envelope
and outbox contract. This covers the core ledger identity surfaces; planning,
import workflow, investment snapshots, documents, and derived analytics are not
yet change-envelope producers.

## Restore validation

Schema 32 restore validation checks device, principal, member-binding, local
context, envelope, outbox, and transactional-capture relations before activation. Device-local context
is cleared during portable restore, while logical principals and historical
origin/envelope records remain in the backup.

## Explicit non-goals

This release does not provide a sync server, network transport, end-to-end sync
protocol, cross-device conflict resolution, merge UI, login, remote
authentication, access control, backend audience enforcement, or mobile receipt
capture. Those remain separate roadmap milestones.
