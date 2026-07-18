# Authenticated personal desktop relay

The optional personal relay moves local change packages between desktops authenticated as the same remote principal. It never widens a package into cross-member family delivery.

## Workflow

1. Configure an HTTPS endpoint and token.
2. Native code calls `/v1/whoami`; the relay derives principal identity.
3. Explicit Send prepares and uploads immutable package bytes.
4. Another same-principal desktop explicitly checks and downloads.
5. Native code verifies digest/contract and stages the existing conflict review.
6. The user resolves and applies atomically.

Relay acceptance proves storage only—not download or application. Failed send retries the same prepared bytes. Download/staging never mutate the ledger; incoming writes do not echo into the outbox.

The reference service stores exact bytes behind TLS supplied by the operator. Artifact IDs are immutable per principal; exact retries are idempotent and changed bytes conflict. Limits are 64 MiB with SHA-256 verification.

The relay transports confirmed-household change packages only. It excludes source bytes, evidence capsules, pending reviews, candidates, watched-folder grants, and backups. It provides no family-principal routing, backend audience control, end-to-end encryption, background/push sync, auto-apply, cloud backup, or remote erasure.

See [relay-service/README.md](../relay-service/README.md) and [Audience-partitioned family delivery](AUDIENCE_PARTITIONED_FAMILY_DELIVERY.md).
