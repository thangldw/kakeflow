# Family evidence delivery

Family snapshot schema v3 (`KFF3`) adds evidence-backed card and investment aggregates. An aggregate travels only when the same audience partition contains its complete immutable source evidence.

Delivered kinds include card statements/payments, portfolio snapshots, brokerage events, investment FX/market prices, and aggregate asset history, alongside v1/v2 data. Card payments remain settlements; investment observations remain separate from household transactions.

## Envelope

```text
KFF3 magic
  + canonical-header length
  + canonical JSON header
  + original documents in manifest order
```

The header binds partition, source installation, manifest, counts, hashes, raw rows, origin-scoped IDs, and entity links. The complete artifact is limited to 64 MiB. Noncanonical, truncated, trailing, count-mismatched, or digest-mismatched bytes are rejected.

Audience is the least-widening meet of each aggregate and all dependencies. Shared artifacts cannot contain personal bytes/IDs/hashes; mixed-member, missing-evidence, mismatch, or oversized graphs are withheld with a reason. Withheld absence is not authoritative deletion.

Portable source IDs are keyed by `(origin installation, local ID)`, preventing collisions across devices. Explicit Apply re-verifies bytes, publishes new vault objects, materializes aliases/facts atomically, and removes orphaned new objects on failure. Receiving/staging never changes the ledger.
