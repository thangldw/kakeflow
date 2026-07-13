# Transaction labels and tags

KakeFlow keeps accounting categories, workflow labels, and user tags separate.
Changing labels or tags never changes a journal entry, account balance, budget
category, card reconciliation, or calculation-target state.

## Labels

Labels are a controlled vocabulary for reliable filters and workflows:

- `SUBSCRIPTION`
- `RECURRING`
- `TAX_DEDUCTIBLE`
- `REIMBURSABLE`
- `UNUSUAL`
- `SHARED_EXPENSE`
- `PRIVATE_EXPENSE`

## Tags

Tags are household-defined text values for dimensions such as a trip, child,
project, or event. KakeFlow trims and validates tags, removes duplicates, and
keeps their assignment household-scoped.

## Bulk changes

The transaction ledger supports an explicit selection of posted transactions.
A bulk operation states which labels and tags to add and which to remove. The
native ledger revalidates every selected transaction against the household and
applies the whole operation atomically. A stale, missing, cross-household, or
oversized selection is rejected without partial changes.

Bulk metadata changes are organizational only. They do not rewrite imported
source evidence and do not invoke category rules automatically.
