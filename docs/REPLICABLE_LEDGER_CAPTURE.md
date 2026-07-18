# Replicable ledger capture

One posted transaction is captured as a complete deterministic aggregate so a receiver can never observe a header without balanced journal lines.

![Replicable ledger capture](assets/infographics/data-pipeline.svg)

The aggregate contains complete transaction fields, ordered journal entries, sorted labels/tags, ordered source references, and ordered external keys. Household/member/account payloads retain complete scalar state; supported deletions emit tombstones.

All contributing SQL writes are captured in the same commit and coalesced to the latest pending aggregate before one immutable canonical JSON/SHA envelope is emitted. Per-device sequence is monotonic and drain is idempotent.

Validation requires at least two unique positive journal lines, same-household accounts, valid sides, equal debit/credit totals, typed metadata arrays, and exact processed payload/operation consistency. Two-database tests reconstruct and compare the balanced aggregate.

The capture is a reproducibility contract. By itself it does not transport source blobs, run incoming apply, resolve conflicts, authenticate users, or synchronize with a cloud service.
