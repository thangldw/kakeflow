# KakeFlow Connector Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one truthful local-first control plane for existing Google Drive, Gmail, watched-folder, and manual-import sources, including source-account bindings and bounded durable refresh, without adding direct financial-institution connectivity or bypassing review.

**Architecture:** A Rust `ConnectorRegistry` and projection service translate existing source-specific stores into one redacted schema. Forward-only SQLCipher tables persist optional account/parser bindings, refresh batches, and safe runtime observations; a background worker delegates execution to the existing provider leases. One shared React view renders native projections and a PWA-only manual-import projection while preserving the separate provider settings panels and the PWA/native runtime boundary.

**Tech Stack:** Rust 1.97, Tauri 2.11, rusqlite/SQLCipher, React 18, TypeScript 5.7, Vitest, Testing Library, Playwright, Vite PWA, Node 22.

**Spec:** `docs/superpowers/specs/2026-08-25-kakeflow-connector-control-center-design.md`

## Global Constraints

- Work only on `codex/connector-control-center`; keep each task independently testable and commit it before starting the next task.
- Preserve the existing Google Drive, Gmail, watched-folder, manual-import, credential, cursor, scheduler, inbox, evidence, duplicate-review, approval, balanced-posting, and provenance contracts.
- Native credentials remain in Keychain or the existing OS credential stores. Shared DTOs, SQLite rows, logs, PWA storage, and artifacts must contain no token, authorization code, cursor, absolute path, provider folder/label ID, raw provider response, or source content.
- A binding narrows only the candidate's source-side `transaction_candidates.account_id`. It must not restrict expense/category journal entries and must never select an account or parser automatically.
- Missing bindings are valid. Archived accounts, cross-household scope, stale optimistic versions, parser-profile version mismatch, and candidate-shape mismatch fail closed before posting.
- Refresh discovers and stages source material only. It never creates a posted transaction and never bypasses the existing explicit approval path.
- `Refresh all` snapshots at most 10,000 connector rows, pages source stores in groups of 100, runs deterministically and sequentially, records every result, and never truncates an over-limit snapshot.
- The PWA exposes only its local manual-import source. Production PWA code and bundles must continue to exclude native OAuth, Keychain, relay, watched-folder, and provider runtime implementations.
- Current v1.2.1 no-regression floors are 804 frontend tests and 644 Rust tests; new coverage raises the actual totals rather than freezing them.
- Use `PATH=/opt/homebrew/opt/node@22/bin:$PATH` for npm commands and `PATH="$HOME/.cargo/bin:$PATH" cargo +1.97.0` for Rust commands.
- macOS remains ad-hoc signed. Do not describe the DMG as notarized, Developer ID signed, or a frictionless production installer.

---

### Task 1: Shared Rust connector contract and registry

**Files:**
- Create: `src-tauri/src/connector_control.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/gmail_store.rs`
- Modify: `src-tauri/src/gmail_command_service.rs`

**Interfaces:**
- Produces: `ConnectorKind`, `ConnectorCapability`, `ConnectorAvailability`, `ConnectorLifecycle`, `ConnectorHealth`, `ConfigurationDestination`, `ConnectorSummaryDto`, `ConnectorDescriptor`, `ConnectorRegistry`, and `primary_state`.
- Consumes: source-specific connection and schedule rows only after they have been redacted or reduced to bounded projection inputs.

- [ ] **Step 1: Write the registry and state truth-table tests**

Add unit tests that assert exactly four unique descriptors in this order:

```rust
[
    ConnectorKind::GoogleDrive,
    ConnectorKind::Gmail,
    ConnectorKind::WatchedFolder,
    ConnectorKind::ManualImport,
]
```

Cover the exact badge precedence `NEEDS_ACTION > RUNNING > RETRY_BACKOFF > STALE > FRESH > MANUAL > NEVER_REFRESHED > DISCONNECTED`, 128-byte connection keys, 256-byte display labels, valid RFC 3339 UTC timestamps, impossible lifecycle/health combinations, and capability/runtime consistency.

- [ ] **Step 2: Verify RED**

Run:

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml connector_control::tests
```

Expected: failure because `connector_control` does not exist.

- [ ] **Step 3: Implement the minimal versioned DTO and registry**

Use closed enums serialized as `SCREAMING_SNAKE_CASE` and a camelCase DTO:

```rust
pub struct ConnectorSummaryDto {
    pub schema_version: u8,
    pub connector_kind: ConnectorKind,
    pub connection_key: String,
    pub display_label: String,
    pub availability: ConnectorAvailability,
    pub lifecycle: ConnectorLifecycle,
    pub health: ConnectorHealth,
    pub capabilities: Vec<ConnectorCapability>,
    pub last_attempt_at: Option<String>,
    pub last_success_at: Option<String>,
    pub freshness_deadline_at: Option<String>,
    pub next_due_at: Option<String>,
    pub pending_review_count: u64,
    pub consecutive_failures: u8,
    pub last_error_code: Option<String>,
    pub binding_summary: Option<ConnectorBindingSummaryDto>,
    pub configuration_destination: ConfigurationDestination,
}
```

Keep registry descriptors static. Do not put user state, provider IDs, cursor fields, credentials, paths, or evidence into a descriptor.

- [ ] **Step 4: Expose the already-persisted Gmail schedule timestamps internally**

Add `last_attempt_at` and `last_success_at` to `gmail_store::SyncScheduleDto` and its `load_schedule` query. Keep both fields out of `RedactedGmailScheduleDto`; they are internal projection inputs, not a change to the existing Gmail public contract. Update constructor fixtures in `gmail_store.rs`, `gmail_command_service.rs`, and `gmail_commands.rs` as required by the compiler.

- [ ] **Step 5: Verify GREEN and redaction**

Run the focused tests and serialize a literal summary containing sentinel source secrets in the input projection. Assert the JSON contains only the safe connection key/display label and none of `refresh-token-secret`, `page-token-secret`, `/Users/private`, `Label_123`, or provider response JSON.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/connector_control.rs src-tauri/src/lib.rs src-tauri/src/gmail_store.rs src-tauri/src/gmail_command_service.rs
git commit -m "feat: define connector control contract"
```

### Task 2: Strict TypeScript DTO validation

**Files:**
- Modify: `src/platform/types.ts`
- Modify: `src/platform/client.ts`
- Modify: `src/platform/client.test.ts`

**Interfaces:**
- Produces: TypeScript counterparts of the Rust enums and `ConnectorSummaryDto`; `PlatformClient.listConnectorSummaries(householdId, cursor?, limit?)`.
- Produces command: `connector_control_list` with a bounded page result `{ schemaVersion: 1, items, nextCursor }`.

- [ ] **Step 1: Add literal valid and invalid response fixtures**

Add one valid page with Drive, Gmail, watched-folder, and manual summaries. Add table-driven rejection cases for unknown enums, duplicate `(connectorKind, connectionKey)` pairs, invalid timestamps, negative counts, more than 100 items, overlong UTF-8 values, `RUNNING` without refresh capability, `RUNTIME_UNSUPPORTED` with executable capabilities, `MANUAL` on a non-manual connector, and provider-only fields such as `cursor` or `absolutePath`.

- [ ] **Step 2: Verify RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm exec vitest run src/platform/client.test.ts
```

Expected: TypeScript or test failure because the connector command and parser are absent.

- [ ] **Step 3: Implement closed-set parsing**

Add the command to `AppCommand`, the method to `PlatformClient`, the desktop `invokeValidated` mapping, and a parser that reconstructs the DTO field-by-field rather than spreading the input record. Count UTF-8 bytes with `TextEncoder`, not JavaScript string length.

The ordinary browser-preview client returns one local manual-import summary and never invokes native IPC. It must not pretend that Google Drive, Gmail, or watched folders are executable in `runtime: 'web'`.

- [ ] **Step 4: Verify GREEN and mutation resistance**

Run the focused test. Temporarily allow an unknown capability and confirm the rejection fixture fails; restore the closed-set check and rerun.

- [ ] **Step 5: Commit**

```bash
git add src/platform/types.ts src/platform/client.ts src/platform/client.test.ts
git commit -m "feat: validate connector projections at IPC boundary"
```

### Task 3: Native read-only projection adapters and command

**Files:**
- Create: `src-tauri/src/connector_projection.rs`
- Create: `src-tauri/src/connector_commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces internal trait: `ConnectorAdapter::list_summaries(connection, household_id, after_key, limit)`.
- Produces: `ConnectionProjectionService::list_page`; Tauri command `connector_control_list`.
- Consumes: `google_drive_command_service`, `google_drive_store`, `gmail_store`, `watched_folders`, `watched_file_inbox`, `import_runs`, and `source_documents`.

- [ ] **Step 1: Write adapter contract tests with a migrated in-memory database**

Seed two households, connected/configuring/disconnected Drive and Gmail rows, enabled watched folders, pending inbox items, and manual import runs. Assert household isolation, deterministic kind/key ordering, pages of 100, one virtual `manual-import` row, pending-review counts scoped to each connection, and no provider ID/path/cursor in serialized output.

- [ ] **Step 2: Verify RED**

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml connector_projection::tests
```

Expected: missing projection module.

- [ ] **Step 3: Implement source-specific adapters without duplicating workers**

Project:

- Drive/Gmail lifecycle from the existing connection status and health from the authoritative schedule row.
- Watched-folder lifecycle from `is_enabled`, safe display text from `label` plus `display_name`, and pending count only from that folder's inbox rows.
- Manual import as `connectionKey = "manual-import"`, `CONNECTED`, `MANUAL`, with `IMPORT_FILE` and no refresh action.

An enabled schedule is stale only when `freshnessDeadlineAt` exists and is before the projection clock. A disabled schedule with a prior successful run may be `FRESH` with no deadline; without durable success it remains `NEVER_REFRESHED`. Watched folders remain `NEVER_REFRESHED` until Task 7 adds a durable observation; do not infer success from process uptime.

- [ ] **Step 4: Implement bounded cursor pagination**

Use a cursor containing only the last `(connectorKind, connectionKey)`. Validate it against the registry, cap `limit` to 100, and fetch `limit + 1` to determine `nextCursor`. The service, not the frontend, owns sorting and duplicate rejection.

- [ ] **Step 5: Register the command and verify GREEN**

Add both modules to `lib.rs` and `connector_commands::connector_control_list` to `tauri::generate_handler!`. Run focused projection tests and the existing Google Drive, Gmail, and watched-folder store tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/connector_projection.rs src-tauri/src/connector_commands.rs src-tauri/src/lib.rs
git commit -m "feat: project native connectors through one control plane"
```

### Task 4: Read-only native Control Center UI

**Files:**
- Create: `src/features/connectors/connectorControlModel.ts`
- Create: `src/features/connectors/connectorControlModel.test.ts`
- Create: `src/features/connectors/ConnectorControlCenter.tsx`
- Create: `src/features/connectors/ConnectorControlCenter.test.tsx`
- Create: `src/features/connectors/ConnectorControlCenter.css`
- Modify: `src/App.tsx`
- Modify: `src/features/import/GoogleDriveSettingsPanel.tsx`
- Modify: `src/features/import/GmailSettingsPanel.tsx`
- Modify: `src/locales/en.generated.json`
- Modify: `src/locales/vi.generated.json`

**Interfaces:**
- Produces pure aggregate/filter functions and an accessible presentational `ConnectorControlCenter`.
- Consumes paged connector summaries and an `onConfigure(destination)` callback.

- [ ] **Step 1: Write model and component tests**

Cover connected/stale/running/needs-action totals, filters `ALL`, `STALE`, `NEEDS_ACTION`, primary badge precedence, last-success/next-due/pending-review text, zero-state behavior, runtime-unavailable disclosure, and the statement that refresh creates review candidates and never posts automatically.

- [ ] **Step 2: Verify RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm exec vitest run src/features/connectors/connectorControlModel.test.ts src/features/connectors/ConnectorControlCenter.test.tsx
```

Expected: missing modules.

- [ ] **Step 3: Implement the focused component**

Keep fetching and mutation outside the presentational view. Load every native page in the Settings container, stopping when `nextCursor` is null and rejecting repeated cursors. Render no secret-shaped detail and no institution logos or Rakuten/Money Forward trade dress.

- [ ] **Step 4: Route Configure to exact existing panels**

Give the existing settings sections stable DOM destinations:

```text
connector-settings-google-drive
connector-settings-gmail
connector-settings-watched-folder
connector-import-inbox
```

`Configure` opens the containing `SettingsDisclosure`, scrolls the exact destination into view, and focuses its heading. It does not recreate provider authorization or schedule controls in the Control Center.

- [ ] **Step 5: Generate and verify localization**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run i18n:generate
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm exec vitest run scripts/i18n-catalog-contract.test.ts src/features/connectors/ConnectorControlCenter.test.tsx
```

Review generated English and Vietnamese strings for connector/security terminology before accepting them.

- [ ] **Step 6: Commit**

```bash
git add src/features/connectors src/App.tsx src/features/import/GoogleDriveSettingsPanel.tsx src/features/import/GmailSettingsPanel.tsx src/locales
git commit -m "feat: add read-only connector control center"
```

### Task 5: Source-account and parser binding persistence

**Files:**
- Create: `src-tauri/migrations/0070_connector_bindings.sql`
- Create: `src-tauri/src/connector_binding.rs`
- Modify: `src-tauri/src/persistence.rs`
- Modify: `src-tauri/src/connector_commands.rs`
- Modify: `src-tauri/src/google_drive_commands.rs`
- Modify: `src-tauri/src/gmail_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/import_workflow.rs`

**Interfaces:**
- Produces: list/upsert/delete binding functions and Tauri commands.
- Produces: `validate_import_binding(connection, run_id)` called inside `commit_import`'s existing immediate transaction before any ledger write.

- [ ] **Step 1: Write migration and lifecycle tests first**

Start a database at `MIGRATIONS[..69]`, seed released v1.2.1 households, accounts, connectors, schedules, inbox rows, source evidence, and posted provenance, then migrate to latest. Assert all old rows are byte-for-byte equivalent for selected columns and the new tables are empty.

Add binding tests for one to 256 allowed account IDs, optimistic create/update/delete, duplicate IDs, stale version, archived account, cross-household account/connector/profile, unknown connection key, parser deletion/version change, connector disconnect/removal, and portable restore clearing device-local bindings while retaining evidence and ledger provenance.

- [ ] **Step 2: Verify RED**

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml connector_binding::tests
```

Expected: migration/module missing.

- [ ] **Step 3: Add the forward-only schema**

Create `connector_bindings` and `connector_binding_accounts`. Use `(household_id, connector_kind, connection_key)` as the binding identity, an integer optimistic `version`, paired nullable parser-profile ID/version columns, bounded CHECK constraints, and account/profile scope triggers. Do not add foreign keys from prior provider, inbox, source, or ledger tables to the control plane.

The upsert input is:

```rust
pub struct UpsertConnectorBindingInput {
    pub household_id: String,
    pub connector_kind: ConnectorKind,
    pub connection_key: String,
    pub allowed_account_ids: Vec<String>,
    pub parser_profile_id: Option<String>,
    pub parser_profile_version: Option<u64>,
    pub expected_version: Option<u64>,
}
```

Require at least one explicitly allowed account. Absence is represented by no binding row, never an empty allow-list.

- [ ] **Step 4: Enforce the binding at the posting boundary**

Resolve a run's source connector through the existing staged inbox link:

```text
GMAIL          -> gmail_inbox.import_run_id -> connection_id
GOOGLE_DRIVE   -> google_drive_inbox.import_run_id -> connection_id
LOCAL/ICLOUD   -> watched_file_inbox.import_run_id -> watched_folder_id
MANUAL_UPLOAD  -> manual-import
```

Inside `commit_import`, validate each candidate's `transaction_candidates.account_id` against the resolved binding. Do not validate category/expense entries against the allow-list. If a parser is bound, require `adapter_id = custom-delimited-v1` and `adapter_version = <profileId>@<exactVersion>`. Run this check before the first transaction or journal insert.

- [ ] **Step 5: Wire deletion and restore semantics**

Delete the active binding when a connector is disconnected or a watched folder is removed. Extend `clear_restored_device_local_state` so restored native connector bindings and active refresh state are cleared with device-local connector configuration; keep prior evidence and posted provenance.

- [ ] **Step 6: Verify migration, fail-closed posting, and no regression**

Run focused connector-binding, `import_workflow::tests`, persistence migration, Google Drive, Gmail, and watched-folder tests. Add a test proving a bound bank account accepts a posting whose category journal entry is outside the allow-list while rejecting a candidate whose source-side account is outside it.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/migrations/0070_connector_bindings.sql src-tauri/src/connector_binding.rs src-tauri/src/persistence.rs src-tauri/src/connector_commands.rs src-tauri/src/google_drive_commands.rs src-tauri/src/gmail_commands.rs src-tauri/src/lib.rs src-tauri/src/import_workflow.rs
git commit -m "feat: enforce connector account bindings"
```

### Task 6: Binding API and review UI

**Files:**
- Modify: `src/platform/types.ts`
- Modify: `src/platform/client.ts`
- Modify: `src/platform/client.test.ts`
- Modify: `src/features/connectors/ConnectorControlCenter.tsx`
- Modify: `src/features/connectors/ConnectorControlCenter.test.tsx`
- Create: `src/features/connectors/connectorBindingModel.ts`
- Create: `src/features/connectors/connectorBindingModel.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.desktop.test.tsx`
- Modify: `src/locales/en.generated.json`
- Modify: `src/locales/vi.generated.json`

**Interfaces:**
- Produces platform methods: `listConnectorBindings`, `upsertConnectorBinding`, and `deleteConnectorBinding`.
- Produces pure review filtering by connector identity, allowed source accounts, and exact parser version.

- [ ] **Step 1: Write failing IPC and UI tests**

Assert strict binding DTO parsing, optimistic conflicts, account/profile options, explicit Save/Remove actions, and no account/parser auto-selection. In Import Inbox tests, seed Drive, Gmail, watched-folder, and manual previews and prove only the relevant source-account selectors are narrowed.

- [ ] **Step 2: Verify RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm exec vitest run src/platform/client.test.ts src/features/connectors/connectorBindingModel.test.ts src/features/connectors/ConnectorControlCenter.test.tsx src/App.desktop.test.tsx
```

Expected: missing methods/model or failed binding assertions.

- [ ] **Step 3: Add strict platform methods and binding editor**

Reconstruct binding responses field-by-field, require unique account IDs, and retain the last loaded optimistic version. The editor displays active, same-household accounts and enabled parser profiles. It never writes until Save is pressed.

- [ ] **Step 4: Narrow Import Inbox choices without choosing defaults**

Resolve a preview's connector using its existing `gmailInboxItemId`, `driveInboxItemId`, `watchedFolderId`, or manual source type plus the currently loaded inbox rows. Filter source-account and parser-profile options only when a binding exists. If a prior selection becomes invalid, clear it and show a needs-remapping message; do not choose the first allowed value.

- [ ] **Step 5: Verify stale and archived behavior end-to-end in the component test**

Simulate an optimistic conflict, an account archived after the editor loaded, and a parser version increment. The UI must reload and require a fresh explicit choice; the mocked commit must not be called while the mapping is invalid.

- [ ] **Step 6: Regenerate catalogs and commit**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run i18n:generate
git add src/platform src/features/connectors src/App.tsx src/App.desktop.test.tsx src/locales
git commit -m "feat: manage connector bindings in review UI"
```

### Task 7: Durable refresh batch state machine

**Files:**
- Create: `src-tauri/migrations/0071_connector_refresh_batches.sql`
- Create: `src-tauri/src/connector_refresh.rs`
- Modify: `src-tauri/src/persistence.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: create/load/claim/heartbeat/complete/recover/retain batch operations.
- Persists only safe connector keys, stable error codes, counts, generations, and timestamps.

- [ ] **Step 1: Write state-machine and migration tests**

Cover deterministic item ordering, explicit `SKIPPED_MANUAL`, exactly 10,000 accepted items, 10,001 rejected atomically as `CONNECTOR_BATCH_LIMIT_EXCEEDED`, one active batch per household, item lease generation, stale completion rejection, expired item recovery, partial success, full failure, no-change success, infrastructure rollback, and active-batch retention immunity.

- [ ] **Step 2: Verify RED**

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml connector_refresh::tests
```

Expected: migration/module missing.

- [ ] **Step 3: Add the bounded schema**

Create:

```text
connector_refresh_batches
connector_refresh_batch_items
connector_runtime_observations
```

Batch status is `ACTIVE | COMPLETE | PARTIAL | FAILED`; item status is `PENDING | RUNNING | SUCCEEDED | NO_CHANGES | SKIPPED_MANUAL | FAILED_RETRYABLE | NEEDS_ACTION`. A running item carries an incrementing attempt generation plus a 64-hex lease token and expiry. Unique constraints prevent duplicate connector keys within a batch.

- [ ] **Step 4: Implement transactional state transitions**

`create_batch` inserts the batch and complete snapshot in one immediate transaction. `claim_next` orders by connector kind/key and returns one item. `complete_item` updates only the exact batch/item/token/generation. Derive the terminal batch result only after every item is terminal.

- [ ] **Step 5: Implement crash recovery and retention**

Expired `RUNNING` items return to `PENDING` with a new attempt generation available; they do not advance a provider cursor. Retain the latest 100 completed batches per household and no completed batch older than 30 days. Never delete `ACTIVE` rows.

- [ ] **Step 6: Add restore and released-schema preservation tests**

Extend the v1.2.1 migration fixture from Task 5 through migration 71. Portable restore clears active batches/observations tied to deleted device-local connectors while leaving historical evidence and ledger rows valid.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/migrations/0071_connector_refresh_batches.sql src-tauri/src/connector_refresh.rs src-tauri/src/persistence.rs src-tauri/src/lib.rs
git commit -m "feat: persist durable connector refresh batches"
```

### Task 8: Sequential refresh worker and native commands

**Files:**
- Create: `src-tauri/src/connector_refresh_worker.rs`
- Modify: `src-tauri/src/connector_commands.rs`
- Modify: `src-tauri/src/connector_projection.rs`
- Modify: `src-tauri/src/google_drive_commands.rs`
- Modify: `src-tauri/src/gmail_commands.rs`
- Modify: `src-tauri/src/folder_discovery.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces commands: `connector_refresh_one`, `connector_refresh_all`, `connector_refresh_batch_get`.
- Produces managed `BackgroundConnectorRefresh` that resumes active batches after startup.
- Consumes the existing Google Drive/Gmail manual schedule claim paths and watched-folder scan/reconcile path.

- [ ] **Step 1: Write fake-executor worker tests**

Use a synthetic executor to prove sequential deterministic execution, no overlap, later connectors continue after retryable and terminal failures, manual source is skipped, item result is persisted before the next item starts, an infrastructure persistence error stops only when safe progress cannot be recorded, and startup resumes an expired active item.

- [ ] **Step 2: Verify RED**

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml connector_refresh_worker::tests
```

Expected: worker missing.

- [ ] **Step 3: Expose existing manual provider runners internally**

Change only visibility and parameter shape around `google_drive_sync_now_blocking` and `gmail::sync_now_blocking` so the worker can delegate to them. Preserve their exact temporary-enable, schedule-claim, lease, cursor, disabled-state restoration, backoff, terminal suspension, evidence, and event behavior.

- [ ] **Step 4: Implement watched-folder and error adapters**

The watched-folder executor calls `scan_registered` plus `watched_file_inbox::reconcile_scan` in the existing database transaction and records a safe runtime observation. Update background folder discovery to record success/failure timestamps and stable public codes without recording paths or file metadata. Projection derives watched freshness from that persisted observation and the fixed poll policy.

Map provider outcomes to:

```text
network/rate/provider unavailable -> FAILED_RETRYABLE
auth/credential/config/cursor action -> NEEDS_ACTION
successful discovery with zero new items -> NO_CHANGES
successful discovery with new items -> SUCCEEDED
```

- [ ] **Step 5: Snapshot server-side and start asynchronously**

`connector_refresh_all` pages `ConnectionProjectionService` in groups of 100, validates every refreshable capability server-side, atomically rejects over 10,000, creates the batch, and wakes the managed worker. `connector_refresh_one` validates one household-scoped registry key and creates the same durable batch shape. Neither command accepts an operation name from the frontend.

- [ ] **Step 6: Verify stale generation and idempotency with real stores**

Add integration tests showing an older batch completion cannot update a newer attempt; repeating Drive/Gmail/watched refresh with the same synthetic source generation creates no duplicate inbox/evidence/candidate row; one retryable connector does not prevent a later connector from completing.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/connector_refresh_worker.rs src-tauri/src/connector_commands.rs src-tauri/src/connector_projection.rs src-tauri/src/google_drive_commands.rs src-tauri/src/gmail_commands.rs src-tauri/src/folder_discovery.rs src-tauri/src/lib.rs
git commit -m "feat: run durable connector refresh batches"
```

### Task 9: Refresh progress, retry, and disconnect UI

**Files:**
- Modify: `src/platform/types.ts`
- Modify: `src/platform/client.ts`
- Modify: `src/platform/client.test.ts`
- Modify: `src/features/connectors/ConnectorControlCenter.tsx`
- Modify: `src/features/connectors/ConnectorControlCenter.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.desktop.test.tsx`
- Modify: `src/locales/en.generated.json`
- Modify: `src/locales/vi.generated.json`

**Interfaces:**
- Produces strict refresh batch/item DTO parsing and PlatformClient methods.
- Produces UI actions `Refresh`, `Retry`, `Configure`, `Disconnect`, and `Refresh all` only when allowed by the projected capabilities.

- [ ] **Step 1: Write failing parser and UI journey tests**

Cover ACTIVE progress, `3 / 5`, deterministic item list, COMPLETE/PARTIAL/FAILED summaries, retryable vs needs-action copy, disabled buttons while the same connector runs, poll cleanup on unmount, no global failure when one item fails, and no refresh/disconnect button for manual or runtime-unsupported sources.

- [ ] **Step 2: Verify RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm exec vitest run src/platform/client.test.ts src/features/connectors/ConnectorControlCenter.test.tsx src/App.desktop.test.tsx
```

Expected: refresh methods/actions missing.

- [ ] **Step 3: Implement strict batch parsing and polling**

Poll `connector_refresh_batch_get` every 500 ms only while the returned batch is `ACTIVE`. Stop on terminal state, household change, or unmount. Reload connector summaries after every terminal item set so freshness/pending counts remain authoritative.

- [ ] **Step 4: Delegate disconnect to existing provider commands**

Map Drive/Gmail/watched-folder disconnect to the current typed PlatformClient methods after an explicit confirmation. Manual import has no disconnect. A successful disconnect reloads summaries and bindings; imported evidence and posted provenance remain visible.

- [ ] **Step 5: Verify accessibility and localization**

Assert live progress uses a polite live region, terminal failures are not color-only, focus returns to the initiating button, filters and cards work at 390x844 without horizontal overflow, and all Japanese UI strings have reviewed English/Vietnamese catalog entries.

- [ ] **Step 6: Commit**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run i18n:generate
git add src/platform src/features/connectors src/App.tsx src/App.desktop.test.tsx src/locales
git commit -m "feat: control connector refresh from settings"
```

### Task 10: PWA manual-source projection and runtime proof

**Files:**
- Modify: `src/platform/pwa/client.ts`
- Modify: `src/platform/pwa/client.test.ts`
- Modify: `src/pwa/PwaRoot.tsx`
- Modify: `src/pwa/PwaRoot.test.tsx`
- Modify: `src/pwa/pwa.css`
- Modify: `e2e/pwa-offline.spec.ts`
- Modify: `scripts/pwa-contract.test.ts`

**Interfaces:**
- Produces one local manual-import connector summary from the unlocked PWA vault.
- Adds a PWA `Sources` screen that reuses the shared presentational Control Center with unsupported native actions absent.

- [ ] **Step 1: Write failing PWA client and UI tests**

Assert the manual source is `AVAILABLE`, `CONNECTED`, `MANUAL`, exposes only `IMPORT_FILE`, reports pending local receipt candidates, and navigates Import explicitly. Assert the PWA screen contains no Google OAuth setup, Keychain action, native path, refresh action, schedule action, direct-bank action, or account requirement.

- [ ] **Step 2: Verify RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm exec vitest run src/platform/pwa/client.test.ts src/pwa/PwaRoot.test.tsx scripts/pwa-contract.test.ts
```

Expected: missing PWA projection/screen or stale six-button navigation assertion.

- [ ] **Step 3: Implement the local projection without native imports**

Derive pending count from `PwaLedgerClient.listCandidates(householdId)` and construct the shared DTO through `connectorControlModel`. Do not import `platform/client.ts`, Tauri APIs, Drive/Gmail modules, watched-folder modules, or native command names into the PWA dependency graph.

- [ ] **Step 4: Add the seventh workflow destination and offline journey**

Add `Sources` to the current six-screen navigation, update exact navigation-count tests, and extend the Playwright flow: unlock offline, open Sources, see manual import, navigate to Import, stage a synthetic receipt, return to Sources, and see one pending review without a network request.

- [ ] **Step 5: Prove bundle separation**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build:pwa
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm exec vitest run scripts/pwa-contract.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:pwa:e2e
```

The contract scans the production PWA output for native provider command names, OAuth scopes, Keychain strings, absolute-path DTO keys, and Tauri runtime chunks; all must be absent.

- [ ] **Step 6: Commit**

```bash
git add src/platform/pwa src/pwa e2e/pwa-offline.spec.ts scripts/pwa-contract.test.ts
git commit -m "feat: show truthful manual source in PWA"
```

### Task 11: Synthetic system evidence and full release gates

**Files:**
- Modify: `src/App.desktop.test.tsx`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/roadmaps/MONEY_FORWARD_ME_REPLACEMENT.md`
- Create: `docs/evidence/connector-control-center.md`
- Modify: `docs/SECURITY.md`

**Interfaces:**
- Produces auditable synthetic evidence for multi-source refresh, idempotency, failure isolation, fail-closed binding, explicit approval, balanced posting, provenance, and PWA runtime separation.

- [ ] **Step 1: Add the complete synthetic native journey**

Use mocked public PlatformClient DTOs plus real model/component state to show more than one configured source, `Refresh all` deterministic progress, one retryable failure followed by a success, a binding mismatch that blocks commit, explicit remapping and approval, balanced debit/credit, and source provenance. Use no personal account, provider, path, email, or statement data.

- [ ] **Step 2: Run focused source gates**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm exec vitest run src/platform/client.test.ts src/features/connectors src/App.desktop.test.tsx src/platform/pwa/client.test.ts src/pwa/PwaRoot.test.tsx scripts/pwa-contract.test.ts
PATH="$HOME/.cargo/bin:$PATH" cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml connector_
```

Expected: all connector, binding, refresh, native UI, and PWA tests pass.

- [ ] **Step 3: Run complete frontend, Rust, lint, build, and audit gates**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm audit
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm audit --omit=dev
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run lint
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:functional
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build:pwa
PATH="$HOME/.cargo/bin:$PATH" cargo +1.97.0 test --manifest-path src-tauri/Cargo.toml
```

Expected: both audits report zero vulnerabilities; frontend exceeds 804 passing tests; Rust exceeds 644 passing tests; lint and both builds exit 0.

- [ ] **Step 4: Run Poppler, updater, checksum, native package, and PWA gates**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH KAKEFLOW_REQUIRE_POPPLER=1 KAKEFLOW_PDF_QA_OUTPUT=artifacts/pdf-report-visual-qa npm run test:pdf-visual
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm exec vitest run scripts/update-channel-contract.test.mjs scripts/release-version-contract.test.mjs scripts/github-actions-pins.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:pwa:e2e
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run desktop:build:mac:ci
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:packaged
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:dmg
```

Expected: Poppler runs rather than skips and emits machine/human artifacts; updater/signature/checksum contracts pass; online/offline PWA passes; packaged app and ad-hoc-signed DMG smoke tests pass.

- [ ] **Step 5: Inspect artifacts for privacy and product claims**

Search built JS, test output, SQLite batch fixtures, screenshots, and evidence docs for tokens, authorization codes, cursors, absolute paths, provider folder/label IDs, personal emails, real financial data, Rakuten premium branding, and claims of direct-bank or notarized-installer support. Expected: no private payload or unsupported claim.

- [ ] **Step 6: Document architecture and evidence**

Record the connector registry, provider delegation, binding boundary, durable batch recovery, PWA limitation, exact commands, actual test counts, artifact paths, and ad-hoc macOS release boundary. State explicitly that this is a control plane over import sources, not Rakuten/Money Forward parity or direct institution aggregation.

- [ ] **Step 7: Commit**

```bash
git add src/App.desktop.test.tsx docs/ARCHITECTURE.md docs/roadmaps/MONEY_FORWARD_ME_REPLACEMENT.md docs/evidence/connector-control-center.md docs/SECURITY.md
git commit -m "docs: publish connector control evidence"
```

### Task 12: Final branch verification and handoff

**Files:**
- Review only; modify files only to fix a failing gate discovered here.

- [ ] **Step 1: Verify clean history and scope**

```bash
git status --short
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

Expected: clean worktree, task-sized commits, only Connector Control Center/spec/evidence changes, and no whitespace errors.

- [ ] **Step 2: Re-run the smallest affected gate after any final correction**

Do not amend an earlier verified task silently. Add a focused fix commit, rerun its targeted test, then rerun the complete lint/build/test/audit gate if runtime code changed.

- [ ] **Step 3: Prepare the review summary**

Report exact commits, actual frontend/Rust counts, audit results, Poppler artifacts, native/PWA/package evidence, privacy scan result, and remaining non-goals. Do not tag or publish a release unless a separate release decision confirms a substantive release boundary.
