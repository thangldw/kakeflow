# Import review classification rules

The development line after `v1.0.0` can surface household classification rules while a transaction
candidate is being reviewed in Import Inbox. A match is a suggestion for the
current review draft, not an approval decision and not a posted transaction.

```text
immutable candidate
  -> editable review draft
  -> rule suggestions
  -> user selects Apply suggestion
  -> category + exact rule token copied into the draft
  -> user separately approves the candidate
  -> atomic native revalidation and import commit
  -> category journal + rule labels / tags posted together
```

Opening, recovering, or refreshing an import never applies a rule. Applying a
suggestion never changes the candidate's review status, creates a transaction,
or writes journal entries. The existing explicit approval and balanced import
commit remain separate actions.

## Eligible review drafts

The initial contract is deliberately narrower than the set of transaction
types accepted by the ledger. A suggestion is eligible only when all of the
following are true:

- the import run and candidate belong to the active household and remain in
  `REVIEW_REQUIRED`;
- the draft type is `EXPENSE`, `CARD_PURCHASE`, or `REFUND`;
- account mapping is complete and the draft has exactly one expense journal
  leg that can receive the rule's category.

For an expense or card purchase, the category leg must be a debit. For a refund,
it must be a credit. `INCOME`, `TRANSFER`, `CARD_PAYMENT`, `FEE`, `INTEREST`,
and `ADJUSTMENT` are not eligible in this first contract. Neither are source-only
imports, investment events, card statements, receipt item splits with multiple
expense legs, or candidates already linked only as evidence. These cases keep
their existing explicit review workflows; the rule engine does not guess a
category shape for them.

## Suggestion order and contents

Only enabled rules in the same household participate. Matching uses the same
normalized, case-insensitive merchant/payee and description semantics as the
posted-transaction rule preview. Results are deterministic: lower numeric
priority wins, then rule ID breaks a tie. The UI may disclose other matching
rules, but it must identify one winner and must not silently combine outputs
from several rules.

Each suggestion carries the exact values that were reviewed:

- rule ID and the rule's exact `updatedAt` revision;
- matched merchant/payee and description inputs;
- expense category account ID and display name; and
- the normalized labels and tags proposed by that rule.

The category, labels, and tags form one suggestion bundle. Previewing the
bundle is read-only. The user must choose **Apply suggestion** before the
category and exact rule-revision token are copied into the review draft. Labels
and tags remain part of that token and are materialized only by the later native
commit after it has re-read the exact rule.

## Exact revalidation on Apply

Apply updates only the in-memory review draft and clears any candidate approval.
The single-candidate action first obtains a fresh native rule preview and
refuses to apply it if payee or description changed while that preview was in
flight. A bounded Apply-all action uses the currently loaded deterministic
suggestions only for untouched eligible drafts. Neither action writes the
ledger.

The later native import commit re-reads the import run, candidate, rule,
category account, labels, and tags inside the existing atomic import
transaction. A rule-backed decision succeeds only if:

1. the run and candidate are still reviewable in the same household;
2. the rule still exists, is enabled, and has the exact submitted `updatedAt`;
3. the rule still matches the submitted merchant/payee and description;
4. the decision still has an eligible transaction type and exactly one expense
   leg; and
5. that leg uses the rule's same-household expense category on the correct
   debit or credit side.

If any check is stale, the whole import commit fails. It does not apply the
category while omitting labels or tags, partially post one candidate, fall
through to a lower-priority rule, or use a newer rule version that the user did
not apply. The review remains available so the user can refresh the suggestion
or continue with a manual classification.

The local Apply action is separate from the later import commit transaction.
The commit revalidates the complete posting decision and either publishes the
entire balanced import decision set or publishes none of it.

## Provenance and manual edits

The review decision retains the rule ID and exact `updatedAt`; a successful
commit writes one classification-application audit record for the resulting
category, labels, and tags:

```text
source:   IMPORT_REVIEW
category: classification rule / rule ID / rule updatedAt
labels:   exact labels re-read from that rule revision
tags:     exact tags re-read from that rule revision
```

This provenance explains why a value was proposed; it does not claim that a
rule approved or posted the transaction. Source-document and source-record
lineage remain unchanged.

A manual edit to payee, description, transaction type, account mapping, journal
legs, category, or calculation-target state invalidates the active rule token
and clears approval. The edited decision remains usable as a manual decision,
but a later commit will not apply rule labels or tags or write
`IMPORT_REVIEW` rule provenance. Undoing text in the UI does not resurrect an
old token; the user must explicitly apply a suggestion again.

## Non-claims

Review-time classification does not provide machine-learning classification,
background approval, automatic posting, automatic transaction-type inference,
rule chaining, category creation, receipt splitting, or retroactive mutation of
posted transactions. Existing posted-transaction rule application remains a
separate explicit action with its own optimistic-concurrency check.
