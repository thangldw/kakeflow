# KakeFlow reference relay

This dependency-free Node service exercises personal artifacts, family delivery, and mobile receipt capture. It stores immutable opaque bytes and derives principals exclusively from configured bearer tokens.

It is a protocol reference—not a hosted KakeFlow service, identity provider, shared ledger, or production-ready deployment.

## Start

```bash
KAKEFLOW_RELAY_TOKENS_JSON='{"replace-with-long-token":"principal-family-a"}' \
KAKEFLOW_RELAY_DATA_DIR=/var/lib/kakeflow-relay \
npm run relay:start
```

Set `KAKEFLOW_RELAY_ALLOWED_ORIGINS` to a comma-separated CORS allowlist when the default local WebView/Vite origins are insufficient. The service speaks HTTP; external deployment must add TLS, secret management, rate and size limits, durable storage, backups, monitoring, and incident controls.

## Guarantees

- Authentication determines the principal; client-provided principal IDs are rejected.
- Artifact IDs are immutable and exact retries are idempotent.
- Conflicting metadata, digest, or bytes are rejected.
- SHA-256, routing metadata, and bounds are validated without interpreting encrypted content.
- Revocation blocks future access but cannot retract bytes already downloaded.
- Relay acceptance confirms storage only—not download, review, or ledger application.

## Endpoints

Personal artifacts use `/v1/whoami` and `/v1/artifacts`. Family membership, invites, publications, and captures use `/v2/households`, `/v2/invites`, and their nested resources. See the route definitions and tests for the exact request contract.

`SHARED` publications target other active household memberships. `PERSONAL` publications target only other active generations of the same domain member and never fall back to the household audience.

Mobile captures use `MOBILE_RECEIPT_CAPTURE_V1`. They are transported as opaque capsules; OCR and posting remain local review steps.

## Verify

```bash
npm run relay:test
npm run capture:test
```
