# Family delivery of recurring preferences

Family schema v4 (`KFF4`) adds one complete `RECURRING_SERIES_PREFERENCES` aggregate to the `SHARED` partition.

The ordered payload contains only normalized payees and explicit `CONFIRMED`/`IGNORED` decisions. It excludes detected cadence, amount, dates, confidence, local optimistic versions, and timestamps. An empty list is authoritative; schemas v1–v3 have no authority over this aggregate.

The aggregate is validated as unique, canonical, deterministically ordered, household-scoped, and whole-state. It never appears in `PERSONAL(member)` because preferences are household-wide and normalized payees would otherwise leak across partitions.

Review compares the complete local and incoming sets. The user keeps local or accepts incoming as one aggregate; no row-level merge or automatic Apply occurs. After Apply, the destination creates fresh local concurrency versions while analytics recompute cadence/amount from its own confirmed ledger.
