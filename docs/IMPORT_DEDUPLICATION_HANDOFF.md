# Import deduplication and overlapping-export handoff

Status: native overlap protection and review workflow implemented; adapter-specific identity rollout continues
Decision date: 2026-07-16

## Implementation checkpoint — 2026-07-16

Implemented in migration `0066_import_deduplication.sql` and the shared native import workflow:

- file coverage by household, mapped account, adapter/version and effective date range;
- exact-date, exact-account, exact-currency/direction/amount heuristic comparison against posted transactions and candidates in other active review runs;
- NFKC/case/punctuation-normalized payee comparison with persisted reason codes;
- explicit `Likely duplicate` and `Possible duplicate` review states with side-by-side source context;
- persisted `Link as additional evidence`, `Keep both`, and `Exclude source row` decisions;
- commit-time fingerprint, target-state and household revalidation inside the existing immediate transaction;
- durable keep-both exceptions and database-backed overlap/review indexes;
- automatic evidence linking remains limited to exact source replay or an identical durable provider identity.

Still intentionally pending:

- adapter-by-adapter durable/stable identity declarations beyond the existing Money Forward external ID contract;
- provider-specific ±1 day posting/settlement drift rules (generic matching remains exact-date only);
- a dedicated source-conflict recovery screen—the native durable-ID conflict remains atomically blocking;
- specialized transfer/card-payment routing metadata where an adapter does not yet emit transaction semantics before staging;
- the complete concurrency, rollback/re-import and every-ingress acceptance matrix listed at the end of this document.

## Goal

Importing the same source repeatedly, or importing exports whose date ranges overlap, must not silently create duplicate ledger transactions. At the same time, KakeFlow must not collapse two legitimate purchases merely because their dates and amounts are equal.

This design applies to manual upload, watched folders, iCloud/Google Drive, Gmail attachments, ZIP members, receipt promotion, and recovered pending imports. Every entry path must converge on the same native deduplication boundary.

## Current gap

KakeFlow already reuses an existing import when the household and whole-file SHA-256 match. It also has stable cross-export identity for Money Forward rows that contain an external transaction ID. These protections do not cover a regenerated file with different bytes or most bank, card, wallet, and custom CSV exports whose date ranges overlap.

Date-range overlap is not itself proof of duplication. It is only a signal to run row-level comparison.

## Required model

Use a layered decision model, in this order:

1. **Exact source replay**
   - Identity: `(household_id, content_sha256)`.
   - Action: reopen/reuse the canonical import; never create a second run or ledger event.
   - Renaming an otherwise identical file must not change the result.

2. **Stable provider event identity**
   - Identity must be scoped by household, provider/adapter, mapped source account, and provider event ID unless the provider contract guarantees IDs are household-global.
   - Store a canonical fact hash covering the provider facts that define the event.
   - Same identity + same fact hash: attach the new source row as additional evidence to the existing transaction; do not create another transaction.
   - Same identity + changed fact hash: block the import atomically and show a source-conflict review. Never silently overwrite posted facts.

3. **Adapter-specific stable row identity**
   - Use only when the adapter contract provides sufficient stable evidence, such as an account-scoped transaction number, immutable timestamp plus provider ID, or another documented durable key.
   - Running balance, export row number, filename, and export sequence must not be treated as durable identity unless that provider explicitly guarantees it.
   - Same stable identity follows the same evidence-link/conflict behavior as provider event identity.

4. **Heuristic duplicate suggestion**
   - Used when no durable identity exists.
   - Query both posted transactions and candidates in other active review runs for the same household and mapped account.
   - Require exact currency, direction, and absolute amount before considering a match.
   - Compare effective date/time, normalized payee/description, transaction type, and available balance/reference evidence.
   - Produce a review suggestion only. Heuristic matches must never be auto-merged, auto-excluded, or auto-posted.

## Candidate comparison

Normalize comparison fields deterministically:

- Unicode NFKC, case folding where applicable, whitespace/punctuation normalization, and bounded provider-specific noise removal for payee/description;
- ISO local date/time using the adapter's declared timezone semantics;
- integer minor units, currency, and explicit `IN`/`OUT` direction;
- mapped source account, provider/adapter, and proposed transaction type;
- provider reference, authorization code, running balance, or statement line evidence when available.

The default search window is:

- exact date for sources that provide only a date;
- up to ±1 day only for documented posting/settlement date drift;
- a wider window only inside a specialized reconciliation flow, never in generic deduplication.

Do not compare candidates across different mapped accounts as automatic duplicates. They may be transfer legs. Cross-account similarities must be routed to transfer/card-payment reconciliation instead.

### Suggested confidence bands

- **Confirmed replay:** durable identity and identical fact hash. Automatic evidence link is allowed.
- **Likely duplicate:** same account, currency, direction, amount and effective date/time, plus strong normalized text or stable secondary evidence. Requires user confirmation.
- **Possible duplicate:** same account, currency, direction and amount within the allowed date window, but weak/missing text. Requires individual review.
- **Not duplicate:** incompatible account, currency, direction, amount, transaction semantics, or an explicit user decision to keep both.

The score and its reason fields must be persisted or reproducibly recomputed; the UI must not display an unexplained confidence label.

## Overlapping export workflow

For each parsed file, calculate its minimum and maximum effective transaction dates. Before staging:

1. Detect whether that interval overlaps any previously imported or currently pending source for the same mapped account.
2. If there is no overlap, continue through normal review; durable identity checks still apply.
3. If there is overlap, compare every row in the overlapping interval using the layered model above.
4. Present a file-level summary before approval, for example:
   - `38 rows: 25 new · 10 confirmed replays · 2 likely duplicates · 1 conflict`;
   - `Overlaps previously imported data: 2026-07-01 → 2026-07-31`.
5. A file with unresolved likely/possible duplicates or conflicts cannot use bulk approval.

Rows outside the overlapping interval remain ordinary new candidates. A new export containing old rows plus new rows should link old evidence and stage only genuinely new candidates.

## Review UI

Each affected candidate must show one of these explicit states:

- `Already imported` — canonical transaction link and source evidence; read-only, no new posting.
- `Likely duplicate` / `Possible duplicate` — side-by-side comparison with date/time, amount, account, payee, description, source filename/row, and match reasons.
- `Source conflict` — same durable identity but changed facts; blocking error.
- `Keep both confirmed` — user explicitly states that both are legitimate transactions.

Available review actions:

- **Link as additional evidence**: attach the new source record to the existing transaction and create no ledger entry.
- **Keep as separate transaction**: requires explicit confirmation and stores a household-scoped non-duplicate exception for that candidate pair/identity so refresh and commit do not repeatedly warn.
- **Exclude source row**: retains immutable provenance and the exclusion decision.
- **Open existing transaction**: inspect the canonical ledger event before deciding.

Do not use color alone. Show the reason, such as `same account + amount + date + normalized payee`, and retain both sources in the audit trail.

## Native persistence and commit safety

Implement durable identities in native storage rather than React-only state. A suitable model is an identity table keyed by household, identity kind, provider/adapter, account scope, and identity value, with fact hash and canonical transaction ID. Exact schema naming may follow repository conventions.

Also persist:

- duplicate suggestions or enough canonical facts to reproduce them;
- evidence-link decisions;
- explicit keep-both exceptions;
- conflicts and their resolution audit data;
- file coverage (`min_effective_date`, `max_effective_date`, mapped account, adapter version).

At final commit, inside the existing immediate/atomic transaction:

1. Re-read the candidate, mapping, matched transaction, identity record, and user decision.
2. Recompute/revalidate identity and canonical fact hash.
3. Check for another import committed since preview.
4. Apply evidence links, exclusions, keep-both exceptions, and new postings atomically.
5. If any match became stale or conflicting, fail the entire commit and return to review.

Database uniqueness must prevent two concurrent commits from claiming the same durable event identity. React preview state alone is not a correctness boundary.

Rollback must remove only evidence/identity links created by that import when they are no longer referenced. It must not delete the pre-existing canonical transaction. Re-import after rollback must produce the same deterministic review outcome.

## Transaction-type boundaries

- A card purchase and the later bank card payment are not duplicates; route them to card reconciliation.
- Two sides of an account transfer are not duplicates; route them to transfer matching and keep them calculation-excluded where required.
- Refunds must remain distinct from the original expense unless a dedicated refund link is created.
- A receipt matching a card/bank transaction should become evidence for that transaction, not another expense.
- Investment trades, balance snapshots, aggregate asset history, and market prices retain their specialized identity rules and must not be forced through the generic household-transaction heuristic.

## Adapter requirements

Every adapter must declare one of:

- `durable_external_identity` with its scope and canonical fact fields;
- `stable_row_identity` with documented provider guarantees; or
- `heuristic_only`.

Do not claim cross-export deduplication for adapters that omit or discard a provider transaction ID. If an external ID is present in parsed data, it must not be silently dropped before the native workflow; extend the supported source tuple deliberately and test its account scoping.

## Acceptance tests

At minimum, cover:

1. Same bytes, same filename: one canonical import.
2. Same bytes, renamed file: one canonical import.
3. Regenerated file containing identical durable IDs and facts: zero new postings, additional evidence linked.
4. Same durable ID with changed amount/date/payee: blocking conflict and atomic rollback.
5. Two overlapping exports with 20 old rows and 5 new rows: only 5 new candidates/postings.
6. Same date and amount but two legitimate purchases: never auto-merge; `Keep both` survives refresh and commit.
7. Duplicate candidate already waiting in another import run: warning/linking occurs before either run can double-post.
8. Concurrent commits for the same durable identity: at most one new transaction.
9. Card purchase versus bank settlement and transfer legs: routed to reconciliation, not generic duplicate removal.
10. Receipt matching an existing transaction: evidence link only.
11. Mapping the same file to different accounts: no accidental cross-account automatic merge.
12. Rollback and re-import: deterministic result without deleting the earlier canonical transaction.
13. Changed adapter version/normalization: no silent identity drift; require revalidation or conflict review.
14. ZIP, watched folder, Google Drive, Gmail, and manual upload all reach the same native deduplication behavior.

## Delivery order

1. Native identity schema, account-scoped provider IDs, commit-time uniqueness, and exact replay tests.
2. Cross-run match query and overlap coverage metadata.
3. Import Inbox comparison UI and explicit decisions.
4. Adapter declarations and provider-specific identities, starting with the highest-volume bank/card/wallet formats.
5. Heuristic matching, explanations, keep-both exceptions, and concurrency/rollback test matrix.

Do not market overlapping-export protection as complete until the native boundary, cross-run comparison, explicit UI decisions, and acceptance tests are all present.
