# KakeFlow Connector Control Center Design

**Status:** Approved

**Date:** 2026-08-25

**Scope:** Connector Control Center foundation for existing import sources

**Branch:** `codex/connector-control-center`

## Problem

KakeFlow already supports multiple local and optional import paths, including Gmail, Google Drive, iCloud or other watched folders, and manual files. Their configuration, scheduling, freshness, retry state, and review queues are exposed through separate panels and source-specific contracts. A household cannot inspect connector health or request one bounded refresh across all refreshable sources from one place.

Rakuten Household Budget's current premium plan advertises unlimited linked services and once-daily manual data refresh, alongside ad suppression and membership benefits. KakeFlow has no advertising or product-plan account limit, so copying those commercial mechanics would add no financial-management value. This design adopts only the useful capability pattern: one truthful, local-first control plane for any number of configured sources, with explicit refresh and provenance-preserving review.

Official capability reference: <https://personal-finance.rakuten.co.jp/premium/>.

This is not a claim of Rakuten or Money Forward feature parity. It does not add direct financial-institution connectivity.

## Goals

1. Project every configured source through one redacted connector summary contract.
2. Show truthful availability, lifecycle, freshness, pending-review count, retry state, and required user action.
3. Support per-connector refresh and a durable, bounded, sequential `Refresh all` operation.
4. Preserve each connector's current credential store, cursor, scheduler, inbox, and source evidence semantics.
5. Bind a connector to an allowed set of ledger accounts and an optional parser profile without permitting automatic posting.
6. Keep native and PWA capabilities explicit; never expose a native connector action in a runtime that cannot execute it.
7. Allow future statement adapters to join through a narrow internal contract without promising a public plugin SDK.

## Non-goals

- Direct login, scraping, or API integration with banks, cards, brokerages, pensions, or point providers.
- A hosted aggregation backend, cloud credential vault, or server-side scheduler.
- Automatic transaction posting, automatic duplicate resolution, or silent account selection.
- A premium tier, connection-count paywall, advertising system, coupons, lotteries, or Rakuten branding.
- Replacing the existing Gmail, Google Drive, watched-folder, or manual-import persistence models.
- Publishing a third-party connector SDK in this phase.
- Adding institution-specific parsers. Each institution or stable format requires its own later spec, fixtures, and loss/coverage evidence.

## Product Boundary

"Unlimited" means KakeFlow imposes no commercial plan limit on configured connectors or ledger accounts. Existing validation, database, pagination, process, and resource bounds remain in force. The UI must not claim universal institution coverage.

"Refresh" means discovering and staging new source material. It never means logging directly into a financial institution, and it never commits a transaction to the ledger.

The authoritative flow remains:

```text
configured source
  -> source-specific discovery and durable cursor
  -> immutable source evidence
  -> parser or OCR candidate
  -> duplicate/account/category review
  -> explicit approval
  -> balanced ledger posting with provenance
```

## Architecture

### Connector Registry

`ConnectorRegistry` is a static internal catalog keyed by `ConnectorKind`:

- `GOOGLE_DRIVE`
- `GMAIL`
- `WATCHED_FOLDER`
- `MANUAL_IMPORT`

Each descriptor declares:

- localized display key and source family;
- supported runtime: native, PWA, or both;
- capabilities: configure, disconnect, refresh now, schedule, retry, import file, account binding;
- whether it represents persistent connections or one virtual manual-import source;
- the adapter responsible for projecting and executing that kind.

The registry contains no user state, credentials, cursor, path, provider identifier, or source evidence.

### Connector Adapters

Each `ConnectorAdapter` owns translation between a source-specific store and the shared control-plane contract. The interface is internal and versioned with KakeFlow source; it is not a dynamically loaded plugin API.

Adapters provide:

- `list_summaries(household_id)`;
- `refresh(connection_key, batch_generation)` when supported;
- `retry(connection_key, batch_generation)` when supported;
- configuration destination metadata for the existing source-specific panel.

Adapters delegate discovery and cursor advancement to existing connector workers. They must not duplicate OAuth, credential, inbox, hydration, parser, or posting logic.

### Connection Projection Service

`ConnectionProjectionService` joins registry metadata with redacted adapter summaries. It owns sorting, capability validation, derived display state, aggregate counts, and runtime filtering.

One summary has:

```text
schemaVersion = 1
connectorKind
connectionKey
displayLabel
availability
lifecycle
health
capabilities[]
lastAttemptAt
lastSuccessAt
freshnessDeadlineAt
nextDueAt
pendingReviewCount
consecutiveFailures
lastErrorCode
bindingSummary
configurationDestination
```

Connection keys are bounded to 128 UTF-8 bytes and display labels to 256 UTF-8 bytes. The DTO must not contain tokens, authorization codes, cursors, absolute paths, provider folder or label identifiers, raw provider responses, source contents, or database identifiers that are not already safe public connection keys.

### State Dimensions

Availability, lifecycle, and health are separate so the UI does not collapse unrelated conditions:

- `availability`: `AVAILABLE`, `RUNTIME_UNSUPPORTED`, `CONFIG_MISSING`;
- `lifecycle`: `DISCONNECTED`, `CONFIGURING`, `CONNECTED`;
- `health`: `NEVER_REFRESHED`, `MANUAL`, `FRESH`, `STALE`, `RUNNING`, `RETRY_BACKOFF`, `NEEDS_ACTION`.

The visible primary badge uses the most actionable state in this order:

```text
NEEDS_ACTION > RUNNING > RETRY_BACKOFF > STALE > FRESH > MANUAL > NEVER_REFRESHED > DISCONNECTED
```

An adapter supplies `freshnessDeadlineAt`; the projection service does not invent a universal cadence. Scheduled Gmail and Google Drive sources derive the deadline from their persisted interval. Watched folders derive it from their configured scan policy. Manual import has no background freshness deadline and uses `MANUAL` health rather than pretending to be fresh.

### Source-account Binding

A new household-scoped binding stores:

- connector kind and safe connection key;
- one or more allowed ledger account IDs;
- optional parser-profile ID plus exact version;
- optimistic version and audit timestamps.

The binding narrows review choices; it does not choose or post an account automatically. A missing binding is valid and leaves all household-valid review choices available. If a bound account is archived, moved to another household, or no longer matches the candidate shape, the candidate requires explicit remapping. A stale, cross-household, or parser-version-mismatched binding fails closed before candidate commitment.

Existing source-specific evidence and ledger links remain authoritative. Deleting or disconnecting a connector deletes its active binding but preserves previously imported evidence and posted ledger provenance.

## Refresh Lifecycle

### Individual refresh

An individual refresh delegates to the connector adapter and existing schedule lease. A disabled automatic schedule may be enabled only for the exact manual claim and must be restored to its prior disabled state after the claim completes, matching current Gmail and Google Drive behavior.

### Refresh all

`Refresh all` creates a durable batch with a unique generation and a bounded snapshot of currently refreshable connector keys. The batch:

1. validates the household and runtime;
2. pages configured connectors in batches of 100, with a 10,000-item safety ceiling per refresh batch;
3. records one item per refreshable connector and `SKIPPED_MANUAL` for the non-refreshable manual-import source;
4. runs items sequentially in deterministic connector-kind and connection-key order;
5. delegates each item to its connector's authoritative lease and worker;
6. records a redacted item result before moving to the next item;
7. returns complete, partial-success, or complete-failure counts without hiding individual outcomes.

Sequential execution avoids provider bursts and local CPU or storage contention. One connector failure never blocks later items unless the application database itself becomes unavailable.

Exceeding the 10,000-item safety ceiling rejects batch creation atomically with `CONNECTOR_BATCH_LIMIT_EXCEEDED`; it never truncates the connector set. This is a technical denial-of-service bound, not a product-plan limit.

Item outcomes are `PENDING`, `RUNNING`, `SUCCEEDED`, `NO_CHANGES`, `SKIPPED_MANUAL`, `FAILED_RETRYABLE`, or `NEEDS_ACTION`. Terminal batch results are `COMPLETE`, `PARTIAL`, or `FAILED` and are derived from the complete item set.

The batch tables contain no financial records, provider responses, credentials, or source identifiers beyond safe connector keys. Cleanup retains no more than the latest 100 completed batches per household and no completed batch older than 30 days. Active batches are never deleted by retention cleanup.

### Crash and stale worker behavior

An active batch and item carry exact lease generations. On restart, an expired batch item becomes retryable without advancing any connector cursor. A completion from an older generation is rejected. If a source-specific worker committed its cursor and result atomically before the process stopped, recovery treats that item as complete and does not replay it.

## Failure Semantics

### Retryable connector failures

Network loss, provider unavailability, rate limiting, and bounded transient read failures:

- release only the current source-specific lease;
- retain the last durable cursor and evidence;
- use the connector's bounded backoff;
- expose `RETRY_BACKOFF` plus a stable public error code;
- allow other batch items to continue.

### Terminal connector failures

Expired authorization, missing credential, revoked access, invalid durable cursor requiring explicit reconciliation, and configuration scope mismatch:

- suspend only the affected connector;
- expose `NEEDS_ACTION` and a specific configuration destination;
- retain imported evidence and posted ledger entries;
- never expose provider error bodies or credential material.

### Content and review failures

Unsupported format, schema drift, ambiguous account mapping, parser-version mismatch, candidate validation, and duplicate ambiguity are item-level review outcomes. They do not mark the connector unhealthy when discovery succeeded. The item remains in the existing review queue with immutable source evidence and a stable failure reason.

### Infrastructure failures

Failure to persist a cursor, evidence object, candidate graph, batch generation, or audit result fails the relevant transaction atomically. No success or freshness timestamp may be published for an operation whose durable state did not commit.

## User Experience

The existing connector-specific settings panels remain the only place to authorize providers, select folders or labels, manage credentials, and edit detailed schedules.

The new `Accounts & Refresh` Control Center provides:

- aggregate counts for connected, stale, running, and needs-action sources;
- filters for all, stale, and needs action;
- one card per persistent connection and one virtual manual-import card;
- truthful primary state, last successful refresh, next due time, pending-review count, and binding summary;
- per-connector `Refresh`, `Retry`, `Configure`, and `Disconnect` actions when supported;
- one `Refresh all` action with live sequential progress and a final per-item outcome list;
- an explicit statement that refresh creates review candidates and never posts automatically.

The UI reuses KakeFlow's visual language and localization system. It must not reproduce Rakuten names, icons, screenshots, layout, trade dress, pricing, or premium labels.

## Native and PWA Runtime Contract

Native macOS can project and execute configured Gmail, Google Drive, and watched-folder connectors plus manual imports.

The PWA projects its local manual-import source and may show native connector descriptors as `RUNTIME_UNSUPPORTED` only when that explanation helps the user understand feature availability. It must not expose OAuth setup, Keychain operations, native paths, or a refresh action it cannot execute. Production PWA code continues to exclude Gmail, Google Drive, relay, and watched-folder runtime implementations.

Shared TypeScript DTO validation rejects unknown enum values, impossible state combinations, timestamps with invalid shapes, negative counts, unbounded labels, and capabilities inconsistent with runtime availability.

## Security and Privacy

- Every command is household-scoped and rejects cross-household connection or account keys.
- Credentials remain in the existing native key stores and never enter SQLCipher projections, batch audit rows, frontend logs, PWA storage, exports, or telemetry.
- Projection DTOs are redacted by construction; source-specific raw structs are not serialized through the shared command.
- `Refresh all` snapshots validated connector keys and never accepts an arbitrary provider operation from the frontend.
- Account bindings use foreign keys and semantic validation so restore or migration cannot create cross-household links.
- Refresh never bypasses the current immutable evidence, duplicate review, explicit approval, balanced-posting, or provenance boundaries.

## Persistence and Compatibility

Forward-only migrations add connector-account bindings and refresh-batch state. They do not rewrite existing Gmail, Google Drive, watched-folder, import-run, source-document, or ledger tables.

Migration tests must prove that a released v1.2.1 database upgrades without data loss and opens with all prior connector schedules, inbox rows, evidence, and ledger provenance intact. Portable restore continues to clear device-local credentials and bindings whose connector configuration cannot be safely transferred.

Removing the feature in a later version must not make prior evidence or ledger data unreadable. Batch diagnostic rows may be ignored by older read models but cannot become a restore dependency.

## Testing Strategy

### Rust and persistence

- Registry completeness and unique connector kinds.
- Adapter contract tests using synthetic provider clients and source files.
- Projection state truth table, precedence, timestamp validation, and redaction.
- Household isolation and source-account binding lifecycle.
- Sequential batch order, bounded connector snapshot, explicit skips, and partial success.
- Retryable, terminal, content, infrastructure, crash-recovery, and stale-generation cases.
- Cursor, evidence, and success-timestamp atomicity.
- v1.2.1 migration preservation and restore behavior.

### TypeScript and UI

- Strict DTO parsing and impossible-state rejection.
- Runtime capability filtering for native and PWA.
- Accessible filters, state badges, per-connector actions, sequential progress, and final results.
- `Refresh all` partial failure and retry behavior.
- Navigation to the exact source-specific configuration panel.
- No credential, cursor, raw path, or provider-detail rendering.

### End-to-end

Use only synthetic Gmail, Google Drive, watched-folder, and manual-file fixtures. Demonstrate:

1. multiple configured sources appear without a commercial count limit;
2. `Refresh all` discovers new material in deterministic order;
3. repeating the same refresh creates no duplicate evidence or candidates;
4. one retryable failure does not block later connectors;
5. a schema or account-binding mismatch enters review and fails closed;
6. no transaction appears before explicit approval;
7. approved balanced postings retain source provenance;
8. PWA shows only actions supported by its runtime.

The existing frontend, Rust, audit, updater, Poppler, packaged-app, DMG, PWA online/offline, and production build gates remain mandatory. New tests increase the suite counts; the design does not freeze them at v1.2.1 totals.

## Delivery Sequence

1. Shared connector DTOs, registry, redacted projections, and read-only Control Center.
2. Source-account binding persistence and UI.
3. Durable individual and batch refresh orchestration over existing connectors.
4. PWA capability projection, accessibility, localization, and end-to-end evidence.
5. Separate follow-up specs for target-cohort institution statement adapters.

Each sequence item must be independently testable and preserve existing provider-specific panels. No later step is allowed to weaken the review or posting boundary established by an earlier step.

## Acceptance Gates

- All configured Gmail, Google Drive, and watched-folder connections plus manual import are represented truthfully in the supported runtime.
- No product-plan connection or ledger-account limit is introduced.
- Every action is consistent with the connector and runtime capability contract.
- `Refresh all` is bounded, sequential, durable, resumable, and idempotent.
- Repeated source material creates no duplicate evidence or candidate.
- Retryable and terminal failures preserve cursors, evidence, and unrelated connector progress.
- Source-account binding fails closed on stale version, schema mismatch, archived account, or cross-household scope.
- Refresh never posts; explicit approval and balanced entries remain required.
- Existing credentials, connector state, review queues, evidence, backups, and ledger provenance survive migration.
- Projection, logs, batch state, PWA storage, and artifacts contain no secrets or private provider payloads.
- Full source, package, security, updater, PDF visual, native, and PWA gates pass without regression.

## Follow-up Boundary

The first institution-specific adapter will be selected from the target replacement cohort, not from advertised connector counts. Its follow-up spec must name the exact export or ingress path, history window, account and transaction coverage, reconciliation rules, unsupported fields, fixtures, freshness claim, and migration exit evidence before implementation begins.
