# Demo household fixture

This directory contains deterministic, fictional Japanese household data for development, tests, screenshots, and visual QA. It contains no real person, employer, account, or transaction.

The scenario covers August 2025 through July 2026 and includes two adults, two children, payroll deductions, a split mortgage posting, bank and card accounts, wallet payments, reconciled card settlements, budgets, goals, labels, account groups, portfolio positions, and market prices.

## Files

| File | Purpose |
| --- | --- |
| `jp-middle-class-family-2026.sql` | Deterministic data-only SQL dump |
| `build-demo-household-db.mjs` | Apply migrations, load the dump, verify invariants |
| `verify-demo-household-dump.mjs` | Build and verify a temporary database |

```bash
node scripts/demo-data/build-demo-household-db.mjs tmp/demo-tanaka-family.sqlite --force
node scripts/demo-data/verify-demo-household-dump.mjs
```

The generated database is plaintext SQLite for development only. It is not the SQLCipher database used by the desktop app. Load the dump into a fresh migrated database; deterministic identifiers make it intentionally non-idempotent.
