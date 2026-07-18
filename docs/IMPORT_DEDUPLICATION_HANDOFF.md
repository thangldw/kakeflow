# Import deduplication and overlapping exports

KakeFlow prevents exact replay and surfaces possible duplicates without collapsing legitimate same-date/same-amount transactions. Manual upload, folders, iCloud, Drive, Gmail, ZIP, receipt promotion, and recovered reviews converge on the same native boundary.

## Decision layers

1. **Exact source replay:** `(household, SHA-256)` reopens the canonical import.
2. **Durable provider identity:** same scoped identity and fact hash attaches evidence; changed facts create a blocking conflict.
3. **Stable adapter row identity:** used only when the provider contract guarantees the key.
4. **Heuristic suggestion:** same account, currency, direction, amount, and allowed date window produces a user decision, never an automatic merge.

Export row number, running balance, filename, and local sequence are not durable identities unless a provider explicitly guarantees them.

## Comparison and explanations

Comparison normalizes Unicode, case, whitespace/punctuation, local date/time, integer minor units, direction, mapped account, adapter, transaction type, and available references. Generic date-only matching uses exact date; broader drift is adapter-specific.

Confidence states are:

- `Already imported`: durable replay with read-only canonical link.
- `Likely duplicate`: strong text or secondary evidence plus exact core facts.
- `Possible duplicate`: exact core facts with weak text.
- `Source conflict`: same durable identity with changed facts; blocking.
- `Keep both confirmed`: explicit durable user exception.

Every state displays reasons and both source contexts. Color is never the sole signal.

## Overlapping ranges

The native workflow stores source coverage by household, mapped account, adapter/version, and effective date range. Overlap triggers row comparison, not automatic exclusion. Rows outside the overlap remain ordinary candidates. Unresolved likely/possible matches and conflicts disable bulk approval.

## Review actions

- Link as additional evidence.
- Keep as a separate transaction.
- Exclude the source row while retaining provenance.
- Open the existing transaction.

Decisions, keep-both exceptions, match reasons, and coverage persist across refresh and recovery.

## Commit safety

Inside the atomic native commit, KakeFlow re-reads candidates, mappings, targets, identities, hashes, and decisions; checks concurrent imports; then applies evidence links, exclusions, exceptions, and postings together. Stale or conflicting state fails the entire commit. Database uniqueness prevents concurrent claims of the same durable event.

Rollback removes only links owned by that run and never deletes a pre-existing canonical transaction.

## Semantic boundaries

Card purchases versus settlements, transfer legs, refunds, receipt evidence, investment trades, snapshots, aggregate history, and market prices use their specialized reconciliation or identity rules. They are not forced through generic duplicate removal.

Each adapter declares `durable_external_identity`, `stable_row_identity`, or `heuristic_only`, with scope and fact fields covered by tests.
