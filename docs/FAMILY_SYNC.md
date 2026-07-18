# Family sync

Family delivery moves encrypted, audience-scoped artifacts between authenticated members. It does not turn the relay into a shared database.

![Audience-partitioned family delivery](assets/infographics/family-delivery.svg)

## Flow

1. Capture a complete confirmed dependency graph locally.
2. Partition data into `SHARED` or `PERSONAL(member)` audiences.
3. Encrypt artifacts for recipients derived from active authenticated membership.
4. Let the relay store and route opaque immutable bytes.
5. Validate schema, digest, audience and membership on receipt.
6. Review conflicts and apply the accepted set atomically.

![Planning and configuration delivery](assets/infographics/family-v2-planning.svg)

Mobile receipt capture follows the same boundary: transport and OCR create review material, not expense postings.

![Mobile capture flow](assets/infographics/mobile-capture.svg)

## Operational boundary

The bundled relay is a reference implementation. Production deployment requires TLS termination, secret management, request limits, durable storage, backup, monitoring, and incident controls.
