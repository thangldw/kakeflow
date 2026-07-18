# Portable confirmed-evidence bundles

A passphrase-protected `.kakeflow-evidence` capsule transports immutable evidence behind posted transactions, card statements, and confirmed investment facts. It never transports pending candidates or posts transactions.

Included sources are those reachable from posted transaction rows, confirmed statements, explicitly linked receipts, portfolio snapshots, brokerage events, investment FX/market prices, and aggregate asset history. Failed, pending, rolled-back, OCR-cache, and watched-folder state are excluded.

The capsule preserves origin installation and portable run/document/row/link IDs. Import authenticates manifest, sizes, hashes, household references, and confirmed dependencies before publication. Existing content-addressed vault objects are reused; aliases map portable identity without changing change-package hashes or creating outbox echo.

Wrong passphrase, truncation, missing/unexpected object, digest mismatch, oversized graph, dependency mismatch, or alias collision fails before live publication. Database writes are atomic and orphaned new vault objects are cleaned after failure.

Workflow: export with a 12+ character passphrase, import on destination, then stage/review/apply the matching local change package. This is explicit file transfer, not background cloud synchronization.
