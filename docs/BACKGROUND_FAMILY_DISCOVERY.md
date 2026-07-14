# Background family-delivery discovery

KakeFlow v0.59 adds an optional native schedule for discovering new family
publications. It is a metadata check, not automatic synchronization. When a
check succeeds, the desktop registers newly visible relay publications as
`AVAILABLE`; it does not download or decrypt their `KFE1` envelopes.

## Explicit opt-in and lifetime

Automatic checks are disabled by default. A connected household can enable a
15, 30, or 60 minute interval and can also request an immediate check. The
schedule is persisted, but its worker runs only while the KakeFlow desktop
process is open. It is not an operating-system daemon, tray service, push
channel, or realtime listener.

Enabling the schedule requires the current relay token. KakeFlow stores that
token in macOS Keychain or Windows Credential Manager under a binding that
includes the household, normalized relay endpoint, and authenticated remote
principal. The token is never stored in SQLite and is never returned to the
WebView. Disabling automatic checks or disconnecting family delivery removes
the saved credential. Manual send and receive actions continue to require the
token entered in the Family Delivery screen.

## What one check does

The native worker performs a bounded, single-flight check for each due
household:

1. claim the persisted schedule with a short lease;
2. load the saved credential and authenticate the relay principal;
3. verify that the configured household membership is still active;
4. ensure the local device's public encryption identity is registered;
5. refresh the relay-owned member-to-principal mapping;
6. list bounded publication metadata after the durable inbound cursor, while
   excluding publications from the local device;
7. register new metadata in the local Family Delivery inbox as `AVAILABLE`;
8. advance the cursor and record the result of the check.

The database is not held across network requests. A lease prevents overlapping
checks for the same schedule, and an expired lease is recovered after a process
interruption. Repeated network failures use bounded retry backoff. An expired
credential, revoked membership, or missing saved credential suspends the
schedule until the user explicitly reconnects or re-enables it.

## Manual review boundary

Background discovery is deliberately read-only with respect to artifact bytes
and household finance data. It never:

- prepares or sends an outbound family artifact;
- downloads an available publication;
- decrypts a `KFE1` envelope;
- stages an inner KFF1, KFF2, or KFF3 artifact;
- resolves review conflicts or omission decisions;
- applies records to the household ledger, planning data, card data, or
  investment data.

The user must still choose **Receive and review**, provide the session token for
that manual action, inspect the staged content, resolve any conflicts, and
explicitly Apply. Existing audience partitioning, evidence provenance,
recipient encryption, and atomic-apply rules are unchanged.

## Status and recovery

The Family Delivery workspace shows whether the schedule is enabled, its
interval, previous attempt and result, next due time, discovered count, and
consecutive failures. Discovery distinguishes no changes, newly available
metadata, retryable failure, interrupted lease recovery, and a terminal state
that requires user action.

Disabling the schedule leaves already discovered `AVAILABLE` rows and locally
pending outbound changes untouched. Disconnecting also leaves local household
data intact. Neither action erases artifacts another device already downloaded
or applied.

## Compatibility and non-claims

Background discovery uses the v0.54-v0.57 family artifact contracts and the
v0.58 `KFE1` relay-blind recipient-encryption transport without changing their
bytes. Schema v1, v2, and v3 review/apply compatibility is unchanged.

Version 0.59 does not claim push delivery, realtime synchronization, automatic
send, automatic download, automatic decryption, automatic staging, automatic
conflict resolution, automatic apply, remote erasure, sender signatures, a
production-hosted relay, or a background service that runs while KakeFlow is
closed.
