# Sure reference gap analysis

Reviewed 2026-11-13 against [we-promise/sure](https://github.com/we-promise/sure) (upstream), its [ohmzi/sure](https://github.com/ohmzi/sure) fork, and the [sure.am](https://sure.am/) feature page.

**Licence boundary.** Sure is AGPLv3 and KakeFlow is MIT. Only product ideas and public file-format specifications are used; no Sure source is copied. Sure is also a server-hosted Rails/Postgres application, so its sync, multi-user and hosted-provider architecture does not transfer to KakeFlow's local-first ledger.

## Delivered

| Sure idea | KakeFlow result |
| --- | --- |
| OFX/QFX and QIF imports (upstream `qif_import`, fork statement import) | `ofx-bank-statement-v1` and `qif-bank-v1` adapters. Explicit destination account, JPY whole-yen only, OFX `FITID` as durable identity, QIF date order proven from the whole file, all ambiguity blocked for review. |

## Already present in KakeFlow (verified by code search, depth not benchmarked)

Envelope/budget surfaces, receipt-to-transaction matching, recurring series, classification rules, tags/merchants, splits, net worth, goals, investment lots/performance, price-change and anomaly signals, duplicate review.

## Candidate backlog, ranked by fit with the local-first constraint

1. **Transfer auto-matching with rejection memory** (Sure `transfer_match`, `rejected_transfer`): pair opposite-signed candidates across accounts, remember dismissed pairs.
2. **Statement control-total proof for every statement adapter** (ohmzi fork): require parsed rows to sum to the printed statement total before a statement becomes postable.
3. **Zero-based budgeting layer** (Ready-to-Assign, signed carry, credit-card payment envelopes): measure the current envelope implementation first; extend rather than duplicate.
4. **Scenario simulation / what-if projections** (Sure roadmap, "Exploring"): pure TypeScript model over existing forecast read models.
5. **Local, opt-in AI assistant / MCP read-only tools** over the encrypted ledger: only after a threat model for sending ledger data to any model provider.
6. **Third-party history importers** (Mint, YNAB, Monarch, Actual): low value for the Japan cohort; build only on demand.
7. **Bank-feed connectors** (SimpleFIN, Plaid and similar): belongs to roadmap Stage 3 connector SDK; candidates only, never auto-posted.
8. **Structural debt**: split `App.tsx` (4,027 lines), `platform/client.ts` (2,868) and `platform/types.ts` (1,399) behind existing tests before adding large UI features.
