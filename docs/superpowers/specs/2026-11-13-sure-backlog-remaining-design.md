# Remaining Sure-reference backlog: design notes

Status: proposal. Nothing here is implemented. Each section names the decision that blocks it and the default I would take. Written after delivering the items in `docs/roadmaps/SURE_REFERENCE_GAP_ANALYSIS.md`.

## 1. Transfer pair decisions (implemented, device-local)

Status: implemented on this branch with the default decision (decisions are **not** replicated).

**What was built.**
- Migration `0073_transfer_pair_decisions.sql` (append-only log, 0065 pattern, no sync capture trigger; a migration test asserts that) and `src-tauri/src/transfer_pairs.rs`.
- Two Tauri commands: `transfer_pair_decisions_list` and `transfer_pair_decide` (`REJECT`, `LINK`, `CLEAR`), each a single SQLite transaction.
- `LINK` retypes both legs as `TRANSFER` with `calculation_target = 0` and records their previous values; journal entries are not touched. It refuses unequal amounts, legs sharing a money account, card-linked legs, legs that are already transfers, and cross-household ids. `CLEAR` restores the legs only while they still look exactly as the link left them.
- TypeScript: DTOs, validated parser, client methods, `transferCandidatesFromRows`, and a "possible transfers" strip on the desktop Transactions page (confirm, not a transfer, history with undo).

**Correction to the earlier draft of this section.** The draft proposed accepting a pair by calling the existing transaction update path on each leg. Reading `update_posted_transaction` showed two problems: two separate updates are not atomic, and a card-linked leg refuses a type change. Hence the dedicated atomic command above.

**Accounting semantics to be aware of.** A confirmed pair is two transactions typed `TRANSFER` and excluded from calculations (the existing "calculation target" mechanism), not one merged transfer journal. The legs keep their original journals, so the earlier expense/income account postings still exist and are only excluded from household totals. Merging a pair into a single journal would delete a posted transaction and its evidence lineage, and was deliberately not done.

**Known limits.** Proposals are computed from the rows currently loaded on the Transactions page, so a pair split across pages is not proposed. The strip was checked in a standalone Playwright render in light mode at 1100 px and 375 px; dark mode and the real Tauri window were not viewed. Because decisions are device-local, a pair rejected on one device can be proposed again on another; confirmed links replicate because they are ordinary ledger edits.

**Still open.** Replicating rejections (Stage 2 sync); proposals beyond the loaded page; an explicit "merge into one journal" option.

## 2. Envelope assignment and credit-card payment envelopes

**Done.** Read-only carry-over and unassigned pool (`features/budgets/`).

**Next.** Let the user move money between envelopes and cover overspend. Needs a stored assignment per category and month. The existing `monthly_category_budgets` row already is "assigned", so the cheapest design reuses it and adds a transfer-between-envelopes operation as two budget upserts in one transaction, with an audit row. Credit-card payment envelopes need a per-card pseudo-category funded when card spending is posted; this overlaps card settlement reconciliation and should be specified together with it.

**Decision needed.** Should overspend carry as a red balance (current behaviour) or reset to zero and reduce the pool (YNAB)? Default: keep the signed red carry, matching the ohmzi fork.

## 3. AI assistant (read-only)

**Why a threat model first.** The ledger is encrypted on device; any assistant that sends rows to a model provider changes the trust boundary documented in `docs/ARCHITECTURE.md` and `docs/SECURITY.md`.

**Proposed constraints.** Off by default; per-session explicit consent; read-only tools (summaries, search, forecast) that return aggregates by default and raw rows only when the user selects them; no credentials, evidence files or free-text memos leave the device without a per-item choice; every call logged locally with the exact payload; a local-model option is the baseline and a provider is an opt-in adapter.

**Decision needed.** Which provider class is acceptable (local only, or a named API)? Default: local only until the owner decides.

**Acceptance.** A test proves that with the feature off no ledger data is passed to the assistant layer; the payload log matches what was sent; revoking consent clears session context.

## 3a. Simulator input pattern (implemented)

`src/ui/YenInput.tsx` and `src/ui/yen.ts`: text input with `inputMode="numeric"`, raw digits while focused, thousands separators after blur, a 円 mark drawn with CSS (so label-based queries still match), invalid text flagged with `aria-invalid` and never passed to the parent, and no silent revert. Applied to the three yen fields of the budgets simulators. Not applied to the what-if scenario panel on the forecast: its fields start empty, already say (円) in the label, and its tests rely on the text-level validation message.

## 4. Third-party history importers (Mint, YNAB, Monarch, Actual)

These exports mix several accounts in one file. The only account-mapping UI today is the Money Forward institution mapping in `ImportPage`. Build a generic "source account to destination account" mapping step first (reusing the MF mapping contract in `importMapper.ts`); each importer then becomes a small fail-closed adapter like the OFX and QIF ones (date order proven from the file, whole-yen JPY only, unknown columns blocked). Default: build only on demonstrated demand; the target cohort is Japanese households.

## 5. Bank feeds

Belongs to roadmap Stage 3 (connector SDK). Requirements before any feed: candidates only (never auto-posted), per-connector freshness and incident state, credential isolation outside the PWA vault, replay fixtures and duplicate detection against `import_deduplication`. Not started.
