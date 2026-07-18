# Transaction labels and tags

Accounting categories, controlled labels, and household tags are separate. Metadata changes never alter journals, balances, budgets, reconciliation, or calculation target.

Controlled labels are `SUBSCRIPTION`, `RECURRING`, `TAX_DEDUCTIBLE`, `REIMBURSABLE`, `UNUSUAL`, `SHARED_EXPENSE`, and `PRIVATE_EXPENSE`.

Tags are trimmed, validated, deduplicated household text for trips, children, projects, or events.

Bulk operations explicitly add/remove labels and tags from selected posted transactions. Native code revalidates household ownership and size, then applies atomically. Stale, missing, cross-household, or oversized selection produces no partial changes. Source evidence and category rules are untouched.
