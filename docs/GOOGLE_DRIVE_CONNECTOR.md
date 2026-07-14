# Google Drive Connector Contract

KakeFlow's Google Drive connector is designed as a direct, read-only desktop
integration. It is not a wrapper around a locally synchronized Google Drive
folder, and it does not scrape the Drive web application.

This document defines the approved product and platform contract. It also
separates the contract currently represented in the repository from the native
connector work that still has to be implemented and externally configured.
Nothing in this document is a claim that a live production Google Drive
connection is currently available.

## Current implementation status

The current codebase recognizes `GOOGLE_DRIVE` as a domain source type. It now
includes the native OAuth protocol primitives, OS credential-store contract,
connection lifecycle schema, durable remote-inbox schema, and restore
invariants. The system-browser command, Drive API client, remote folder
browser, change-feed worker, immutable download cache, and end-to-end desktop
UI described below are not yet a live production connector.

Implementation is staged as follows:

| Stage | Status | Scope |
| --- | --- | --- |
| 0. Contract and lineage identity | Implemented | Direct-connector boundary, source type, lifecycle, and provenance requirements |
| 1. OAuth and durable foundation | Foundation implemented and mock-tested | Loopback/PKCE protocol, token exchange contracts, OS credential storage, connection lifecycle, remote inbox, and restore invariants; system-browser command and live provider wiring remain |
| 2. Folder binding and initial discovery | Planned | Folder URL/ID validation, native folder browser, recursive crawl, and race-free catch-up |
| 3. Durable remote inbox | Planned | Change feed, bounded hydration, immutable snapshots, retries, restart recovery, and Import Inbox UI |
| 4. Canonical import integration | Planned | Existing parser preview, mapping, reconciliation, provenance display, and explicit review/commit gate |
| 5. Production qualification | External and planned | Google verification, packaged-app testing with real accounts, release configuration, and operational validation |

Until stages 1 through 5 are complete, UI and release notes must not describe
the connector as connected, production-ready, or generally available.

## Authorization boundary

Recursive synchronization of an arbitrary user-selected folder requires the
fixed read-only Drive scope:

```text
https://www.googleapis.com/auth/drive.readonly
```

KakeFlow must not present `drive.file` as equivalent. `drive.file` is intended
for files a user explicitly opens or shares with an app, commonly through the
Google Picker. Selecting one folder with that scope does not establish durable
access to all existing and future descendants needed by this connector.

`drive.readonly` is a restricted scope. Although the authorization grant is
broader than one folder, KakeFlow's product behavior remains constrained to the
folder binding selected by the user. The connector does not modify, move,
rename, share, trash, or delete remote files.

If restricted-scope authorization and verification are not available, the
product may offer a separate Picker-based import of individually selected
files. That is not recursive folder synchronization and must not be labeled as
such.

Google's current scope guidance is documented in the
[Drive API authorization guide](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Desktop OAuth contract

Authorization runs in the native desktop core, not inside the application
WebView:

```text
User selects Connect Google Drive
  -> native core creates state, PKCE verifier, and PKCE challenge
  -> native core binds a random 127.0.0.1 loopback port
  -> system browser opens Google's authorization page
  -> Google redirects the authorization response to the loopback listener
  -> native core validates state and exchanges the code
  -> refresh token is stored in the operating-system credential store
  -> WebView receives only a connection state/result
```

The implementation follows Google's
[OAuth 2.0 for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
guidance:

- use Authorization Code with PKCE;
- open the user's system browser, never an embedded login page;
- bind the loopback listener only to `127.0.0.1` on a random available port;
- validate the authorization state before exchanging the code;
- keep the PKCE verifier and pending session in native memory;
- expire or cancel an abandoned authorization attempt; and
- never return authorization codes, access tokens, refresh tokens, or the PKCE
  verifier to the frontend.

The desktop OAuth client ID is public configuration compiled into an eligible
native build. It is not a secret. Refresh tokens are stored in macOS Keychain or
Windows Credential Manager, while short-lived access tokens remain in native
memory. Disconnect revokes or discards the grant and removes its stored
credential. It does not erase immutable documents already imported into
KakeFlow.

## Build availability

The native platform is the source of truth for connector availability. The
frontend must not infer availability from a browser environment variable or
display a connect button that cannot complete authorization.

At minimum, the platform reports:

```text
available
authorization mode: SYSTEM_BROWSER_LOOPBACK
scope profile: DRIVE_READONLY
unavailable reason, when applicable
```

A build without the desktop OAuth client ID displays an unavailable state such
as `CLIENT_ID_NOT_COMPILED`. Drive API disablement, consent rejection, revoked
access, and provider rate limits are runtime connection errors rather than
build-time availability results.

Web-only builds remain unsupported for this connector unless a separate,
explicitly designed web OAuth architecture is introduced later.

## Folder selection and binding

After authorization, the user binds one Drive folder by either:

- pasting a full Google Drive folder URL or a bare folder ID; or
- using KakeFlow's native, paginated Drive folder browser.

The native core parses and validates the input, confirms that the resource is a
readable Drive folder, and returns a canonical binding. Folder names are not
stable identities and must never be used as the binding key.

The binding retains the authenticated connection ID, folder ID, Drive ID,
display breadcrumb, and whether the folder belongs to My Drive or a shared
drive. Shared-drive requests use the Drive API's `supportsAllDrives` and
`includeItemsFromAllDrives` behavior where required.

Folder listing, search, and pagination follow the official
[`files.list` reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
and [file search guidance](https://developers.google.com/workspace/drive/api/guides/search-files).

Changing a binding affects future discovery only. It does not rewrite the
provenance of an already downloaded source document.

## Race-free initial synchronization

Initial discovery must close the gap between a recursive crawl and subsequent
incremental changes. The native worker uses this sequence:

```text
1. Obtain and persist a Drive start-page token.
2. Recursively crawl the selected folder and its supported descendants.
3. Persist discovered remote generations in the remote inbox.
4. Read the change feed beginning at the saved start-page token.
5. Apply changes until the feed returns a new start-page token.
6. Persist the new token and enter incremental polling.
```

Capturing the token before the crawl ensures that a file created, changed,
moved, or removed during the crawl is observed in the catch-up pass. Discovery
is idempotent, so an unchanged generation seen by both paths produces one inbox
item.

A successful crawl is not the same as a successful download or import. Status
must distinguish metadata discovery, content hydration, parsing, review, and
posting.

## Incremental change feed

After catch-up, the connector consumes Drive changes from the persisted page
token and advances the token only after the corresponding metadata changes are
durably recorded.

The worker maintains enough folder/file metadata to determine whether an item
currently belongs beneath the selected root. It handles:

- new files and new descendant folders;
- file content or metadata changes;
- moves into or out of the selected tree;
- renamed files and folders;
- removed or trashed remote items;
- shared-drive changes; and
- expired or invalid page tokens by scheduling a bounded full reconciliation.

A remote removal or move out of scope marks the remote inbox generation as no
longer present. It never deletes an immutable KakeFlow source document or a
posted ledger transaction.

Change polling is bounded, resumable, and rate-limit aware. `Sync now` requests
the same idempotent worker; it does not run an independent import path.

## Remote generation identity

One Drive file can produce multiple immutable source generations. Identity is
based on provider metadata such as:

```text
connection ID
Drive ID
remote file ID
Drive version or provider revision marker
remote modified time
downloaded content SHA-256
```

Filename and path are display and provenance fields, not unique identities.
Drive MD5 values are not sufficient because they are unavailable for some
resources, including Google Workspace-native documents.

When a known remote file changes, the connector creates or discovers a new
generation. It does not overwrite the bytes or lineage of the previous one.

## Durable remote inbox

Google Drive has a dedicated remote inbox. It must not be modeled as a local
watched folder because a local path, filesystem event, and local modified time
cannot represent the provider's connection, Drive ID, revision, or change-feed
state.

The lifecycle is:

```text
DISCOVERED
  -> HYDRATING
  -> READY | FAILED
  -> NEEDS_MAPPING | STAGED

DISCOVERED | READY | NEEDS_MAPPING | FAILED -> IGNORED
remote item leaves selected tree             -> REMOVED
```

`STAGED` means that a canonical import run is linked to the immutable remote
snapshot. It does not mean that any transaction has been approved or posted.

Inbox records retain household, connection, folder binding, Drive/file IDs,
remote generation, relative display path, original and exported MIME types,
size, modified time, content digest, lifecycle state, attempt metadata, and an
optional import-run ID. They never contain OAuth tokens.

## Bounded hydration and immutable snapshots

Discovery downloads no bytes. A bounded native claim hydrates a limited number
of discovered generations at a time. Before accepting a snapshot, the worker:

1. validates the supported MIME type and declared size;
2. downloads or exports within configured per-file and per-batch limits;
3. detects a provider generation change during the read;
4. calculates the local SHA-256 digest;
5. writes the completed snapshot to KakeFlow's immutable native source/cache
   boundary; and
6. atomically moves the inbox item to `READY`.

Partial downloads are never parsed. A generation changed during download is
rejected and rediscovered as a new generation. Retryable network errors, rate
limits, unsupported MIME types, oversized files, access loss, and export
failures remain distinct user-visible outcomes.

Google Workspace-native files require an explicit export contract. For
example, a supported Google Sheet may be exported to XLSX. KakeFlow retains the
original Google MIME type and remote version as well as the exported MIME type,
immutable exported bytes, and content digest. The UI labels that evidence as an
exported snapshot; it must not imply that the exported bytes are the provider's
original binary file.

## Import and review gate

The frontend may read a bounded cached snapshot to run existing adapter
detection and preview logic, but the native snapshot remains authoritative.
Starting an import uses the inbox item identity; the native core verifies the
cached generation, digest, filename, size, and MIME metadata and supplies those
bytes to the canonical import boundary.

```text
Drive metadata
  -> remote inbox generation
  -> immutable downloaded/exported snapshot
  -> parser preview and account mapping
  -> canonical import run with REVIEW_REQUIRED candidates
  -> duplicate, transfer, receipt, and card-payment reconciliation
  -> explicit user approval
  -> balanced ledger entries
```

No OAuth success, sync, discovery, download, export, parse result, or high
classification confidence may post a transaction automatically. Only the
existing explicit review/commit operation can write confirmed ledger entries.

Restart recovery reads the cached immutable snapshot rather than downloading a
different remote generation under the same preview. Disconnecting Google Drive
does not remove pending reviews backed by completed snapshots.

## Provenance contract

A Google Drive import creates a `SourceDocument` with
`sourceType = GOOGLE_DRIVE`. Its lineage retains, where applicable:

- household, connection, and folder-binding identifiers;
- My Drive or shared Drive ID;
- remote file ID and provider version/revision;
- selected-root-relative path and original filename;
- original provider MIME type and exported MIME type;
- remote modified time and native download/export completion time;
- immutable content SHA-256 and byte size;
- import-run, source-document, source-record, and candidate identifiers;
- adapter name/version, physical row or evidence location; and
- review decision and final transaction/entry identifiers.

Transaction drill-down should display a human-readable provider summary such
as `Google Drive · Statements/July.csv · version 42` and link it to the stored
immutable evidence. It must not expose access tokens, refresh tokens,
authorization codes, PKCE values, or credential-store references.

Renaming or moving a remote file later does not mutate historical provenance.

## User-visible connection states

Settings and Import Inbox must distinguish at least:

- connector unavailable in this build;
- disconnected;
- browser authorization in progress;
- connected but no folder selected;
- active;
- reauthorization required;
- rate limited, including the next retry time;
- selected folder missing, removed, or no longer readable; and
- retryable provider/network failure.

Disconnect explains that KakeFlow stops polling and removes the stored grant,
while already hydrated reviews and confirmed source documents remain. Reconnect
may retain the previous folder binding only if the newly authorized account can
resolve and read that same folder.

## External production blockers

Code completion alone does not make this connector production-ready. A release
claim requires all of the following:

- a Google Cloud project with the Drive API enabled;
- a Desktop OAuth client configured for supported packaged builds;
- a correctly configured OAuth consent screen;
- verified application domains and published privacy/support information;
- Google's required verification for the restricted `drive.readonly` scope;
- successful authorization, initial crawl, catch-up, incremental sync,
  reconnect, revocation, rate-limit, and shared-drive tests with real accounts;
- packaged macOS and Windows validation using production build configuration;
  and
- an operational policy for provider outages and expired change-feed tokens.

Developer credentials, unverified test-user access, mock Drive responses, or a
locally synchronized folder do not satisfy these production requirements.

## Explicit non-goals

The direct connector does not:

- use a Google Drive for Desktop local folder as a substitute for the API;
- request write access or initiate payments;
- mutate or clean up the user's remote Drive;
- place the live KakeFlow SQLite database in Google Drive;
- turn Drive into a multi-device ledger synchronization transport;
- post imported transactions without review; or
- claim availability merely because `GOOGLE_DRIVE` exists as a source type.
