# Background family-delivery discovery

KakeFlow first introduced an optional native schedule for discovering new
family publications. Metadata-only discovery remains the default. A second,
separate opt-in can now download, decrypt, and stage at most one encrypted
`KFE1` publication for manual review after each successful discovery.

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

When the separate automatic-preparation switch is enabled, the same leased run
then checks that no family review is already active, selects the oldest
`AVAILABLE` encrypted publication, downloads exactly its declared bytes (up to
64 MiB), verifies its transport SHA-256, opens it for the currently validated
remote membership, and stages the inner artifact. Legacy plaintext
publications remain manual. A run prepares at most one artifact.

The database is not held across network requests. A lease prevents overlapping
checks for the same schedule, and an expired lease is recovered after a process
interruption. Repeated network failures use bounded retry backoff. An expired
credential, revoked membership, or missing saved credential suspends the
schedule until the user explicitly reconnects or re-enables it.

## Manual review boundary

Metadata-only discovery remains read-only with respect to artifact bytes. The
separate automatic-preparation option may download/decrypt one encrypted item
and move it to `WAITING_FOR_REVIEW` or `READY_TO_APPLY`. Neither mode ever:

- prepares or sends an outbound family artifact;
- resolves review conflicts or omission decisions;
- applies records to the household ledger, planning data, card data, or
  investment data.

With automatic preparation off, the user still chooses **Receive and review**.
With it on, the user opens the prepared review. In both cases they inspect the
content, resolve conflicts where needed, and explicitly Apply. `READY_TO_APPLY`
does not mean automatically applied.

## Status and recovery

The Family Delivery workspace shows whether the schedule is enabled, its
interval, previous attempt and result, next due time, discovered count, and
consecutive failures. When automatic preparation is enabled it also shows the
last bounded intake result and whether one item was staged. Discovery
distinguishes no changes, newly available metadata, retryable failure,
interrupted lease recovery, and a terminal state that requires user action.

Disabling the schedule leaves already discovered `AVAILABLE` rows and locally
pending outbound changes untouched. Disconnecting also leaves local household
data intact. Neither action erases artifacts another device already downloaded
or applied.

## Compatibility and non-claims

Background discovery uses the v0.54-v0.57 family artifact contracts and the
v0.58 `KFE1` relay-blind recipient-encryption transport without changing their
bytes. Schema v1, v2, and v3 review/apply compatibility is unchanged.

This feature does not claim push delivery, realtime synchronization, automatic
send, plaintext automatic intake, automatic conflict resolution, automatic
apply, remote erasure, sender signatures, a
production-hosted relay, or a background service that runs while KakeFlow is
closed.

KakeFlow v0.60 adds recovery for an explicitly initiated send whose encrypted
recipient set becomes stale. That recovery remains separate from this
inbound workflow: background discovery and preparation never retry, reset, or
reseal an outbound delivery. See
[recipient-set recovery](FAMILY_RECIPIENT_SET_RECOVERY.md).
