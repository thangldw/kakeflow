# Import review classification rules

Household classification rules can suggest category, labels, and tags for an Import Inbox draft. A suggestion is neither approval nor posting.

```text
immutable candidate
  -> editable review draft
  -> deterministic suggestion
  -> explicit Apply suggestion
  -> separate approval
  -> atomic native revalidation and commit
```

## Eligibility

The run/candidate must remain `REVIEW_REQUIRED` in the active household. Initial support covers `EXPENSE`, `CARD_PURCHASE`, and `REFUND` drafts with complete account mapping and exactly one expense leg. Income, transfer, card payment, fee, interest, adjustment, source-only, investment, statement, evidence-only, and multi-expense receipt splits are excluded.

## Deterministic suggestion

Only enabled same-household rules participate. Normalized payee and description use the same semantics as posted-transaction rule preview. Lowest numeric priority wins; rule ID breaks ties.

The bundle records rule ID, exact `updatedAt`, matched inputs, category account, labels, and tags. The user must apply the complete bundle explicitly. Applying it updates only the local draft and clears candidate approval.

## Commit revalidation

The native transaction requires the same reviewable candidate, enabled rule revision, matching text, eligible type/shape, and same-household category on the correct debit/credit side. Stale state fails the complete import; KakeFlow never partially applies category without labels/tags or substitutes another rule revision.

Successful commit records `IMPORT_REVIEW` classification provenance alongside unchanged source lineage. Manual edits to payee, description, type, mapping, journal, category, or calculation target invalidate the rule token; the user must apply a fresh suggestion.

This feature does not provide ML classification, background approval, rule chaining, category creation, receipt splitting, or retroactive mutation.
