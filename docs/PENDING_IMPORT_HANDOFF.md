# Pending import handoff

A `.kakeflow-review` file moves one unconfirmed candidate-bearing review between installations. It carries mutable review inputs, not confirmed ledger facts.

## Boundary

The source run must be `REVIEW_REQUIRED` with candidates. Receipt-only, portfolio, brokerage, aggregate-asset, completed, and source-only runs are excluded. Export does not pause or modify the source run; import creates a normal destination review without transporting approvals or posting drafts.

```text
source review
  -> passphrase-protected local file
  -> authenticated graph validation
  -> explicit account/member mapping
  -> destination REVIEW_REQUIRED run
```

KakeFlow does not upload or remotely transport this file.

## Portable graph

Schema v1 includes one source and its bytes, source rows, normalized candidates, evidence edges, staged statements/lines, and referenced account/member descriptors. It excludes approvals, destination ledger IDs, confirmed facts, receipt-only evidence, investments, prices, FX marts, and analytics.

Every account maps to an active destination account with matching kind, subtype, and currency. Every member maps to an active household member. Display names are never identity.

## Idempotency and conflicts

An immutable receipt records origin installation, portable run, manifest digest, and generated local IDs. Exact reapply reopens the existing review; same identity with different content is equivocation. Existing pending or terminal source collisions are reported explicitly. Database and vault publication are atomic.

| Format | Boundary | Destination effect |
| --- | --- | --- |
| `.kakeflow-review` | Unconfirmed review | Creates/reopens review; never posts |
| `.kakeflow-evidence` | Confirmed source evidence | Hydrates evidence behind confirmed facts |
| Change package | Confirmed aggregate state | Conflict review, then atomic apply |
