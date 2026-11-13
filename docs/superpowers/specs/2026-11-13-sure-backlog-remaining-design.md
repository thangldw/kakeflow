# Remaining Sure-reference backlog: design notes

Status: proposal. Nothing here is implemented. Each section names the decision that blocks it and the default I would take. Written after delivering the items in `docs/roadmaps/SURE_REFERENCE_GAP_ANALYSIS.md`.

## 1. Transfer pair decisions (persistence, review UI, accept)

**Goal.** Let the user accept or dismiss own-account transfer proposals from `proposeTransferPairs`, and never be shown a dismissed pair again.

**Non-goals.** Automatic linking; cross-household pairs; matching card payments (already handled by card reconciliation).

**Precedent in the repo.** `0065_card_payment_link_corrections.sql` is the closest analogue: a `STRICT` table with id/household checks, a unique key, an index and immutable update/delete triggers, registered in the migration list in `src-tauri/src/persistence.rs` and covered by tests there. Planning and rule tables are captured for sync (`0034_replicable_planning_capture.sql`, `0047_family_planning_configuration.sql`), so a new table must choose between replicated and device-local.

**Proposed design.**
- Table `transfer_pair_decisions(id, household_id, out_transaction_id, in_transaction_id, decision CHECK IN ('REJECTED','LINKED'), decided_at, UNIQUE(household_id, pair_key))`, where `pair_key` is `rejectionKey(out, in)` from `src/domain/transferMatching.ts`. Append-only with the 0065 immutability triggers; an "undo" is a new row, not an update.
- Commands: list decisions for a household; record a decision. DTO parser in `src/platform/parsers.ts`; client methods; PWA parity in `src/platform/pwa` (event type for the same record).
- Proposals are computed in TypeScript from the already loaded transaction rows, then filtered by `rejectedKeys`.
- Accept = set both legs to `TRANSFER` and `calculationTarget=false` through the existing transaction update path (Rust already requires an imported transfer to be excluded from calculations), then record `LINKED`. This must be verified against `update_transaction` before relying on it.
- UI: a "possible transfers" strip on the Transactions page with Accept / Not a transfer; ambiguous legs are listed without a suggested partner.

**Decision needed.** Replicate decisions across devices? Default: **no** for the first version (device-local, not added to the sync capture lists), because a wrongly replicated "rejected" row hides a pair on every device and the change touches family-delivery contracts. Revisit with Stage 2 sync.

**Acceptance.** Dismissed pair never reappears after restart; accepting leaves household income/expense totals unchanged apart from removing both legs; undo restores them; a pair across two households is never proposed; migration test mirrors the 0065 tests; PWA and desktop agree on proposals for the same fixture.

## 2. Envelope assignment and credit-card payment envelopes

**Done.** Read-only carry-over and unassigned pool (`features/budgets/`).

**Next.** Let the user move money between envelopes and cover overspend. Needs a stored assignment per category and month. The existing `monthly_category_budgets` row already is "assigned", so the cheapest design reuses it and adds a transfer-between-envelopes operation as two budget upserts in one transaction, with an audit row. Credit-card payment envelopes need a per-card pseudo-category funded when card spending is posted; this overlaps card settlement reconciliation and should be specified together with it.

**Decision needed.** Should overspend carry as a red balance (current behaviour) or reset to zero and reduce the pool (YNAB)? Default: keep the signed red carry, matching the ohmzi fork.

## 3. AI assistant (read-only)

**Why a threat model first.** The ledger is encrypted on device; any assistant that sends rows to a model provider changes the trust boundary documented in `docs/ARCHITECTURE.md` and `docs/SECURITY.md`.

**Proposed constraints.** Off by default; per-session explicit consent; read-only tools (summaries, search, forecast) that return aggregates by default and raw rows only when the user selects them; no credentials, evidence files or free-text memos leave the device without a per-item choice; every call logged locally with the exact payload; a local-model option is the baseline and a provider is an opt-in adapter.

**Decision needed.** Which provider class is acceptable (local only, or a named API)? Default: local only until the owner decides.

**Acceptance.** A test proves that with the feature off no ledger data is passed to the assistant layer; the payload log matches what was sent; revoking consent clears session context.

## 3a. Simulator input pattern

Money inputs in the budgets simulators and the scenario panel are plain numbers. Proposal: text input with `inputMode="numeric"`, thousand separators on blur, a visible yen suffix outside the label (so label-based tests keep working), and the existing integer validation. Needs a shared `YenInput` component; do it once for all four forms.

## 4. Third-party history importers (Mint, YNAB, Monarch, Actual)

These exports mix several accounts in one file. The only account-mapping UI today is the Money Forward institution mapping in `ImportPage`. Build a generic "source account to destination account" mapping step first (reusing the MF mapping contract in `importMapper.ts`); each importer then becomes a small fail-closed adapter like the OFX and QIF ones (date order proven from the file, whole-yen JPY only, unknown columns blocked). Default: build only on demonstrated demand; the target cohort is Japanese households.

## 5. Bank feeds

Belongs to roadmap Stage 3 (connector SDK). Requirements before any feed: candidates only (never auto-posted), per-connector freshness and incident state, credential isolation outside the PWA vault, replay fixtures and duplicate detection against `import_deduplication`. Not started.
