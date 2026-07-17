# KakeFlow reference relay

The reference relay is a dependency-free Node service for exercising KakeFlow's personal artifact, family publication, and mobile receipt-capture protocols. It stores immutable bytes on disk and derives every principal from a configured bearer token.

It is not a hosted KakeFlow service, identity provider, synchronization engine, or production-ready deployment.

## Run locally

```bash
KAKEFLOW_RELAY_TOKENS_JSON='{"replace-with-long-token":"principal-family-a"}' \
KAKEFLOW_RELAY_DATA_DIR=/var/lib/kakeflow-relay \
npm run relay:start
```

The service speaks plain HTTP. Production-like deployments must add TLS termination, request limits, secret management, monitoring, backup, and durable filesystem controls.

`KAKEFLOW_RELAY_ALLOWED_ORIGINS` replaces the default WebView and local-Vite CORS allowlist with a comma-separated list.

## Security model

- Authentication determines the principal; client-supplied principal IDs are never accepted.
- Artifact and publication identifiers are immutable within their scope.
- Exact retries are idempotent; conflicting metadata, digest, or bytes are rejected.
- Revocation blocks future relay access but cannot revoke bytes already downloaded.
- The relay validates routing metadata, sizes, and SHA-256 digests but does not interpret opaque artifact contents.
- Relay acceptance proves storage only. It does not prove download, review, or application by another desktop.

## Personal artifact API

```text
GET  /v1/whoami
POST /v1/artifacts
GET  /v1/artifacts
GET  /v1/artifacts/:id
```

Uploads are limited to 64 MiB and must include `X-KakeFlow-Digest`. Personal indexes and artifact files survive process restart.

## Family API

```text
GET    /v2/whoami
POST   /v2/households
GET    /v2/households
GET    /v2/households/:householdId/members
POST   /v2/households/:householdId/invites
GET    /v2/households/:householdId/invites
DELETE /v2/households/:householdId/invites/:inviteId
POST   /v2/invites/preview
POST   /v2/invites/redeem
DELETE /v2/households/:householdId/members/:membershipId
POST   /v2/households/:householdId/publications
GET    /v2/households/:householdId/publications
GET    /v2/households/:householdId/publications/:publicationId
POST   /v2/households/:householdId/captures
GET    /v2/households/:householdId/captures
GET    /v2/households/:householdId/captures/:captureId
```

Create a binding with stable local household and member identities:

```json
{
  "householdId": "family",
  "domainMemberId": "family-member-primary",
  "idempotencyKey": "create-family-20260714"
}
```

Owners issue one-use, expiring invites. Redeeming an invite creates a new immutable membership generation. Revocation and re-invitation do not restore access to publications addressed to an earlier generation.

### Publication headers

```text
X-KakeFlow-Publication-Id: <stable retry id>
X-KakeFlow-Digest: <sha256 of exact bytes>
X-KakeFlow-Origin-Device-Id: <local device id>
X-KakeFlow-Audience-Visibility: SHARED | PERSONAL
X-KakeFlow-Audience-Member-Id: <required for PERSONAL>
X-KakeFlow-Artifact-Schema: FAMILY_AUDIENCE_PARTITION_V1 | FAMILY_AUDIENCE_PARTITION_V2 | FAMILY_AUDIENCE_PARTITION_V3 | FAMILY_AUDIENCE_PARTITION_V4
```

`SHARED` snapshots every other active household membership as a recipient. `PERSONAL` is valid only for the authenticated sender's own domain member and routes only to other active generations of that member. Personal delivery never falls back to the household audience.

A publication ID can be retried only with the same sender generation, origin, audience, schema, digest, and bytes. A fresh publication ID may republish the same bytes for a newly joined generation.

## Mobile receipt capture

Receipt captures use an independent opaque stream:

```text
X-KakeFlow-Capture-Id: <stable retry id>
X-KakeFlow-Digest: <sha256 of exact capsule bytes>
X-KakeFlow-Origin-Device-Id: <browser or device session id>
X-KakeFlow-Audience-Visibility: SHARED | PERSONAL
X-KakeFlow-Audience-Member-Id: <required for PERSONAL>
X-KakeFlow-Capsule-Schema: MOBILE_RECEIPT_CAPTURE_V1
```

The default capsule limit is 32 MiB. The reference uploader limits an individual JPEG or PNG to 20 MiB, creates deterministic capsule bytes, and stores the exact capsule in IndexedDB before upload.

Run the uploader with:

```bash
npm run capture:uploader
```

Add its origin to `KAKEFLOW_RELAY_ALLOWED_ORIGINS` when necessary. The page retains its bearer token only in the current input element and does not use cookies, local storage, or session storage.

Receipt capture never performs remote OCR and never posts a ledger transaction. The desktop must download, inspect, process, and explicitly promote the receipt through its normal review workflow.

## Tests

```bash
npm run relay:test
npm run capture:test
```
