# Money Forward ME replacement roadmap

**North star:** KakeFlow becomes a trustworthy Japanese household-finance system that can replace Money Forward ME for a defined user cohort while keeping an authoritative local ledger, explicit review, and portable provenance.

This is a direction, not a current parity claim. As of 2026-08-24, Money Forward advertises 2,437 supported services, automated balance/history refresh, automatic categorization, receipt capture, budgets, calendar/reporting, household sharing, and advanced investment views. Sources: [feature overview](https://moneyforward.com/features), [course capability matrix](https://moneyforward.com/me/courses), and [official support overview](https://support.me.moneyforward.com/hc/ja/sections/900001520563-%E6%A9%9F%E8%83%BD%E6%A6%82%E8%A6%81).

## Replacement definition

KakeFlow may claim replacement for a cohort only when that cohort can migrate its history, connect or import every institution it relies on, reconcile updates without duplicate or missing ledger facts, perform its routine household and investment workflows, recover its data, and operate through documented support/reliability boundaries. Feature screenshots alone do not establish replacement.

## Sequenced capability stages

### Stage 1: trustworthy local core

Deliver native/PWA invariant parity, encrypted local persistence, receipt and file import, explicit approval, balanced double-entry posting, evidence lineage, ledger read models, offline operation, and portable encrypted backup.

Exit evidence: the PWA foundation acceptance gates and the public synthetic receipt-to-provenance demo.

### Stage 2: encrypted multi-device household

Add device identity, end-to-end encrypted event replication, conflict detection, member/audience policies, revocation, recovery, and share-board projections. The relay transports ciphertext and never becomes the ledger of record.

Exit evidence: deterministic convergence tests, revoked-device tests, recovery drills, and two-device household journeys.

### Stage 3: connector platform

Build a versioned connector SDK and isolated connector workers for OAuth/API tokens, consent scopes, polling/webhooks, rate limits, credential rotation, backoff, institution outages, schema drift, and source snapshots. Normalize connector facts into candidates; never post them automatically.

The delivered Connector Control Center is the internal control-plane foundation for the existing manual, watched-folder, Gmail, and Google Drive import sources: a redacted registry, fail-closed account bindings, bounded durable refresh batches, and delegated source actions. It is not the future connector SDK, direct institution connectivity, institution coverage, or evidence of Money Forward or Rakuten parity.

Prioritize institutions from the target cohort rather than chasing the advertised 2,437-service count. Publish per-connector freshness, known gaps, reconciliation coverage, and incident state.

Exit evidence: migration/cohort coverage, replay fixtures, duplicate/missing-fact detection, outage drills, and connector-level SLOs.

### Stage 4: automation and decision support

Add recurring-expense/subscription detection, category suggestions, configurable notifications, cash/card settlement reconciliation, weekly/monthly reports, financial calendar, goals, portfolio analytics, dividends, liabilities, and explainable forecasts. Suggestions remain reversible and provenance-bearing.

Exit evidence: benchmarked accuracy/coverage with failure slices, not aggregate-only claims.

### Stage 5: migration and operational replacement

Provide Money Forward CSV/history import with explicit loss reports, account/category mapping, opening-balance reconciliation, parallel-run comparison, backup/restore guarantees, support playbooks, status reporting, and release/service reliability evidence.

Exit evidence: a target cohort completes a documented parallel run and can retire Money Forward without losing required history, institution coverage, daily workflows, or recovery capability.

## Architectural constraints established now

- The local ledger remains authoritative; connectors and sync are ingress/transport boundaries.
- Native and PWA posting rules come from one shared domain core.
- Every automated fact remains a candidate until explicit user approval permits posting.
- Institution-specific raw evidence is retained with normalized lineage.
- Connector secrets never enter the PWA vault unless a future threat model explicitly permits a narrowly scoped token.
- Product claims name the supported cohort and verified coverage; they do not imply universal Money Forward parity.
