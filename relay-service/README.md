# KakeFlow reference relay

This dependency-free Node service stores immutable KakeFlow artifact bytes for a
principal derived from a configured Bearer token. Client-supplied principal IDs
are never accepted. It is a reference transport, not a hosted service, login
provider, synchronization engine, or end-to-end encrypted store.

Run it behind a TLS reverse proxy with request-size limits. The service itself
speaks plain HTTP and stores artifact bytes on disk exactly as received.

```sh
KAKEFLOW_RELAY_TOKENS_JSON='{"replace-with-long-token":"principal-family-a"}' \
KAKEFLOW_RELAY_DATA_DIR=/var/lib/kakeflow-relay \
npm run relay:start
```

The API exposes `GET /v1/whoami`, `POST /v1/artifacts`,
`GET /v1/artifacts?...`, and `GET /v1/artifacts/:id`. Uploads are limited to
64 MiB, verified against `x-kakeflow-digest`, and immutable for each
principal/artifact ID pair. The durable index and artifact files survive a
process restart.
