# Authenticated personal desktop relay

KakeFlow 0.53 adds an optional, manual transport for moving schema-v4 local
change packages between desktops authenticated as the **same remote
principal**. The relay does not replace the existing package workflow: sending,
checking, downloading, staging, reviewing, and applying remain separate user
actions.

This is a personal relay boundary, not family-member synchronization. The
existing local `sync_principal` remains a logical change author. A remote
principal is independently derived by the relay from a configured Bearer token;
the desktop never supplies a principal ID to an artifact request.

## Desktop workflow

1. Enter an HTTPS relay endpoint and a connection token in Settings.
2. KakeFlow calls `GET /v1/whoami`, records the returned remote-principal ID,
   and keeps the token only in the current UI session.
3. Choose `未送信の変更を送る`. The desktop creates one current schema-v4
   change package and uploads its exact bytes explicitly.
4. On another desktop connected with a token for the same remote principal,
   choose `受信を確認`.
5. Choose `受信して確認` for one available artifact. KakeFlow downloads it,
   verifies its digest and complete change-package contract, and stages it.
6. Use the existing change-package screen to resolve conflicts and deletion
   candidates, then apply explicitly.

Relay acceptance means only that the reference service durably accepted the
artifact. It does not mean another desktop downloaded, reviewed, or applied it.
The source acknowledges only the outbox envelopes captured by that package;
changes committed after the snapshot remain pending for a later send. A failed
send reuses the same immutable prepared delivery.

Downloading or staging never mutates the ledger. Existing package rules remain
authoritative: one package may wait for review at a time, destination state is
rechecked before apply, accepted changes apply atomically, and incoming writes
do not echo into the local outbox.

## Reference relay

The repository includes a dependency-free Node reference service under
`relay-service/`. It is an operator-run example, not a hosted KakeFlow service
or identity provider.

```sh
KAKEFLOW_RELAY_TOKENS_JSON='{"replace-with-long-token":"principal-family-a"}' \
KAKEFLOW_RELAY_DATA_DIR=/var/lib/kakeflow-relay \
npm run relay:start
```

The service speaks plain HTTP and must be deployed behind a TLS reverse proxy
with request-size limits. Its explicit WebView CORS allowlist is configured by
`KAKEFLOW_RELAY_ALLOWED_ORIGINS` and permits the required authorization and
`x-kakeflow-*` headers; a reverse proxy must preserve or equivalently enforce it.
Desktop configuration accepts HTTPS endpoints, plus loopback HTTP for local
development. The service stores artifact bytes exactly as received, with a
durable on-disk index; KakeFlow 0.53 does not encrypt a change package end to
end.

Each token maps to one server-derived principal. Listings and downloads are
filtered by that principal. Artifact IDs are immutable within a principal:
retrying the same ID and digest is idempotent, while reusing the ID with
different bytes is rejected. Upload and desktop staging are both capped at 64
MiB, and SHA-256 is verified before publication and again before staging.

### HTTP API

| Operation | Request | Result |
| --- | --- | --- |
| Identify | `GET /v1/whoami` | `{ remotePrincipalId }` derived from the Bearer token |
| Upload | `POST /v1/artifacts` with artifact, digest, household, and origin-device headers plus package bytes | Immutable artifact metadata and whether it was newly created |
| Check | `GET /v1/artifacts?householdId=…&after=…&excludeOriginDeviceId=…` | Principal-scoped ordered page and next cursor |
| Download | `GET /v1/artifacts/:artifactId` | Exact stored package bytes and digest headers |

The reference service has no account-registration, invitation, password reset,
artifact deletion, recipient acknowledgement, automatic retention, or recovery
API. Token provisioning, TLS termination, and the reverse-proxy CORS policy are
operator responsibilities.

## Exact product boundary

Version 0.53 relays only confirmed-household **local change packages**. It does
not remotely transport confirmed-evidence capsules, original source bytes,
pending-import handoffs, mutable candidates, watched-folder grants, or backups.
Investment facts still require their confirmed evidence to be hydrated through
the existing explicit evidence-capsule workflow before the matching package can
apply.

KakeFlow 0.53 does not claim:

- cross-member or family-principal synchronization;
- backend-enforced `SHARED`/`PERSONAL` audience permissions;
- end-to-end encryption or a zero-knowledge relay;
- background polling, push delivery, real-time synchronization, or auto-apply;
- field-level merge or automatic conflict resolution;
- cloud backup, disaster recovery, remote deletion, or erasure of downloaded
  local copies;
- remote OCR, mobile capture, bank connectivity, or payment initiation.

Family Space audience remains a local organization label inside schema-v4. A
whole-household schema-v4 package may contain personal facts for more than one
member, so it must not be used for cross-member delivery. KakeFlow v0.54 adds a
separate family protocol whose relay derives recipients from authenticated
membership; this does not change or widen the personal-relay contract.

## Sequenced roadmap

- **0.54:** authenticated household membership and audience-partitioned
  `SHARED` and `PERSONAL(member)` family artifacts are available for the
  initial household/member/account/transaction graph. Unpartitioned schema-v4
  snapshots remain personal-relay-only; evidence-dependent aggregates remain
  withheld from family delivery.
- **0.55:** a separate mobile receipt-capture capsule, relay cursor, reference
  browser uploader, and desktop Capture Inbox are available. A mobile image
  enters as immutable pending source evidence, runs through desktop-local OCR
  and matching, and still requires explicit user confirmation; it never posts
  a transaction directly.

The current `.kakeflow-review` format excludes receipt-only imports, while
confirmed-evidence capsules apply only to evidence behind confirmed facts.
Mobile capture therefore cannot truthfully reuse either format unchanged.
