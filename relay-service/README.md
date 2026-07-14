# KakeFlow reference relay

This dependency-free Node service stores immutable KakeFlow artifact bytes for a
principal derived from a configured Bearer token. Client-supplied principal IDs
are never accepted. It is a reference transport, not a hosted service, login
provider, synchronization engine, or end-to-end encrypted store.

Run it behind a TLS reverse proxy with request-size limits. The service itself
speaks plain HTTP and stores artifact bytes on disk exactly as received. Its
WebView CORS allowlist defaults to KakeFlow's packaged origins and local Vite;
set `KAKEFLOW_RELAY_ALLOWED_ORIGINS` to a comma-separated replacement list.

```sh
KAKEFLOW_RELAY_TOKENS_JSON='{"replace-with-long-token":"principal-family-a"}' \
KAKEFLOW_RELAY_DATA_DIR=/var/lib/kakeflow-relay \
npm run relay:start
```

The personal-device API exposes `GET /v1/whoami`, `POST /v1/artifacts`,
`GET /v1/artifacts?...`, and `GET /v1/artifacts/:id`. Uploads are limited to
64 MiB, verified against `x-kakeflow-digest`, and immutable for each
principal/artifact ID pair.

## Authenticated family relay

The `/v2` API adds durable household membership and audience-partitioned
publications. Authentication always determines the principal. The service does
not accept sender or recipient principal IDs from a client.

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
GET    /v2/households/:householdId/publications?after=0
GET    /v2/households/:householdId/publications/:publicationId
POST   /v2/households/:householdId/captures
GET    /v2/households/:householdId/captures?after=0
GET    /v2/households/:householdId/captures/:captureId
```

Create a family binding with a stable local household/member identity:

```json
{
  "householdId": "family",
  "domainMemberId": "family-member-primary",
  "idempotencyKey": "create-family-20260714"
}
```

An owner can create a one-use, expiring invite for a `domainMemberId`. Redeeming
it creates a new immutable membership generation for the authenticated
principal. Revocation makes that generation ineligible for both publication
listing and direct byte download. Reinviting the same principal creates a new
generation and does not restore access to publications addressed to an older
generation. Invite codes are returned by create/retry responses but omitted
from invite listings. An authenticated client can preview an active code before
redeeming it; preview returns only `householdId`, `domainMemberId`, `role`, and
`expiresAt`, and does not consume or echo the code.

Family publication uploads use these headers:

```text
X-KakeFlow-Publication-Id: <stable retry id>
X-KakeFlow-Digest: <sha256 of exact bytes>
X-KakeFlow-Origin-Device-Id: <local device id>
X-KakeFlow-Audience-Visibility: SHARED | PERSONAL
X-KakeFlow-Audience-Member-Id: <required only for PERSONAL>
X-KakeFlow-Artifact-Schema: FAMILY_AUDIENCE_PARTITION_V1
```

For `SHARED`, the relay snapshots every other active household membership as a
recipient. For `PERSONAL`, the member header must equal the authenticated
sender membership's `domainMemberId`; only other active membership generations
for that exact member are recipients. There is no fallback from `PERSONAL` to
the household audience. An upload with no eligible recipient is rejected.

A publication ID is immutable within its household. Retrying the same ID and
exact metadata/bytes is idempotent; changing its digest, sender generation,
origin, schema, or audience is a conflict. A new publication ID may publish the
same bytes again, which lets a newly joined generation receive a fresh current
snapshot. Cursors are ordered server sequences, while direct downloads repeat
the same live membership-generation authorization used by listing.

Relay acceptance means only that the publication and its recipient snapshot
were stored durably. It is not evidence that another desktop downloaded,
reviewed, or applied the data. Revocation blocks future relay access but cannot
erase copies already downloaded. The reference relay does not inspect the
opaque artifact to prove its contents match the declared audience, does not
provide local desktop user authorization, and is not end-to-end encrypted.

The versioned personal and family indexes and all artifact files survive a
process restart.

## Mobile-browser receipt capture channel

Receipt captures use a separate opaque stream and never enter the family
snapshot publication format. Upload exact capsule bytes with:

```text
X-KakeFlow-Capture-Id: <stable retry id>
X-KakeFlow-Digest: <sha256 of exact capsule bytes>
X-KakeFlow-Origin-Device-Id: <browser/device session id>
X-KakeFlow-Audience-Visibility: SHARED | PERSONAL
X-KakeFlow-Audience-Member-Id: <required only for PERSONAL>
X-KakeFlow-Capsule-Schema: MOBILE_RECEIPT_CAPTURE_V1
```

`SHARED` snapshots every other active household membership as a recipient.
`PERSONAL` is accepted only for the authenticated sender's own
`domainMemberId` and routes only to another active principal mapped to that
member. Missing recipients are rejected; a personal capture never falls back
to household sharing. Capture IDs are immutable within a household, exact
retries preserve their original recipient snapshot, and capture cursors are
independent of family-publication cursors. Revoked or rejoined membership
generations cannot list or download a capture addressed to an older generation.

The default relay limit is 32 MiB per capsule. The v1 capsule is a deterministic
binary envelope containing a canonical manifest and one exact JPEG/PNG image;
the reference uploader limits the image itself to 20 MiB to match desktop OCR.
The relay validates routing metadata, size, and the capsule-byte digest but does
not inspect or attest the opaque manifest.

For manual testing on a phone browser, run:

```sh
npm run capture:uploader
```

Then add `http://127.0.0.1:8790` (or the TLS origin used to expose that page) to
`KAKEFLOW_RELAY_ALLOWED_ORIGINS`. The page keeps its Bearer token only in the
current input element and does not use cookies, local storage, or session
storage. It is a responsive reference uploader, not an iOS/Android native app,
offline queue, background camera integration, remote OCR service, or production
authentication surface. Relay acceptance is not a desktop download/read
receipt and never posts a ledger transaction.
