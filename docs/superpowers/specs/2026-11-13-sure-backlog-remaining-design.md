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

## 2. Envelope assignment and credit-card payment envelopes (partly implemented)

**Done.** Read-only carry-over and unassigned pool (`features/budgets/`), and covering an overspent envelope: Rust `move_monthly_budget` (command `budget_move`) moves assigned budget between two expense categories of one month in one SQLite transaction; the source can give up at most `min(budget, max(0, budget - actual))`, so a move never creates a new overspend; the target row is created when missing. The panel offers "不足を補う" with the source defaulting to the category with the most left. Budgets already replicate through the existing `monthly_category_budgets` capture, so no new table or audit log was added.

**Decision taken (default).** Overspend stays a red signed carry (ohmzi fork behaviour), not reset to zero.

**Known limits.** The source cap ignores carry-over from earlier months (it is the month-level remainder), so a category whose positive balance is mostly carry-in cannot lend it. Moves are within one month only. Assigning from the unassigned pool is still done with the existing budget field. The cover form was rendered in a standalone Playwright preview, not in the Tauri window.

**Not done.** Credit-card payment envelopes (a per-card pseudo-category funded when card spending is posted). They overlap card settlement reconciliation and should be specified together with it.

## 3. AI assistant (read-only): deferred to the future

Owner decision (2026-11-14): look for a very small model that is genuinely effective; if there is none, defer. Outcome: **deferred**, because effectiveness for this app is not established. Findings (sources checked 2026-11-14):

- **Candidate: FunctionGemma 270M** (Google, 2025-12-18; a Gemma 3 270M tuned for function calling). Designed to turn natural language into calls over a fixed action set, to run offline on edge devices, and to be fine-tuned ("molded, not just prompted"). Google reports 58% on its Mobile Actions evaluation before fine-tuning and 85% after, on a held-out set. Runtimes listed by Google include llama.cpp, Ollama, LiteRT-LM and ONNX; weights are open for "responsible commercial use" under the Gemma terms (not reviewed here). Sources: [Google blog](https://blog.google/technology/developers/functiongemma/), [Gemma docs](https://ai.google.dev/gemma/docs/functiongemma).
- **Comparison data is weak.** A third-party model card reports BFCL v4 of 54.08 (thinking) and 29.17 (non-thinking) for Qwen3-0.6B against 27.03 for FunctionGemma, with the two winning different subtests; it is vendor-reported and uses its own setup ([card](https://huggingface.co/MultiverseComputingCAI/LittleLamb-ToolCalling/blob/main/README.md)). A search for an independent benchmark of sub-1B models on tool calling and JSON-schema adherence found none.
- **Not evidenced at all:** Japanese and Vietnamese quality (Google says only "multilingual inputs" and lists no languages), memory and download size, and accuracy on ledger-style queries. The 58% to 85% figures come from a different domain (phone actions).

**Why not now.** Using it would mean fine-tuning on our own tool schema in three languages, building the evaluation, shipping a native runtime (a llama.cpp sidecar or similar; the PWA has no equivalent) and distributing a model file, all before knowing it works for Japanese ledger questions.

**Spike to run later (go/no-go).** (1) Fix a read-only tool set of at most eight tools (search transactions, totals by category, forecast, budget remainder and similar). (2) Write 100 to 150 labelled queries across ja, en and vi with the expected tool and arguments, including negatives that must be refused. (3) Measure FunctionGemma zero-shot and one small fine-tune through an existing runtime. (4) Go only if tool and argument accuracy is high enough that a wrong call is rare, answers are composed by deterministic code from the tool result (the model only routes, it never writes numbers), and the model file and runtime are acceptable for a local-first desktop app.

**Constraints that stay in force when it is built.** Off by default; per-session explicit consent; read-only tools returning aggregates unless the user selects rows; no credentials, evidence files or free-text memos leave the device; every call logged locally with the exact payload; local-only (no provider) unless the owner decides otherwise.

**Acceptance (future).** A test proves that with the feature off nothing reaches the assistant layer; the payload log matches what was sent; revoking consent clears session context.

## 3a. Simulator input pattern (implemented)

`src/ui/YenInput.tsx` and `src/ui/yen.ts`: text input with `inputMode="numeric"`, raw digits while focused, thousands separators after blur, a 円 mark drawn with CSS (so label-based queries still match), invalid text flagged with `aria-invalid` and never passed to the parent, and no silent revert. Applied to the three yen fields of the budgets simulators. Not applied to the what-if scenario panel on the forecast: its fields start empty, already say (円) in the label, and its tests rely on the text-level validation message.

## 4. Third-party history importers (Mint, YNAB, Monarch, Actual): will not do

Owner decision (2026-11-14): not needed. Removed from the backlog.

## 5. Bank feeds: will not do

Owner decision (2026-11-14): not needed. Removed from the backlog. (The roadmap's Stage 3 connector SDK is unaffected; this only records that no bank-feed work is planned from the Sure reference.)
