# Synthetic Japanese household demo data

This directory contains deterministic, fictional data for development, tests, screenshots, and visual QA. No name, employer, account identifier, or transaction represents a real person.

## Scenario

The Tanaka household contains two working adults and two children across the rolling year from August 2025 through July 2026.

- Gross household income is JPY 14 million. Payroll tax and social-insurance deductions are explicit expenses.
- Household cash management uses an SMBC account.
- A monthly JPY 150,000 mortgage debit is split into JPY 120,000 principal and JPY 30,000 interest. Only interest affects accrual expense; the full debit affects cash flow.
- Investment market value is JPY 20 million: 60% stocks and funds, 20% gold and silver, and 20% J-REIT exposure.
- Daily payments cover Rakuten Card, PayPay Card, PayPay QR/balance, and bank transactions.
- Card statements are reconciled with their SMBC settlements so payment does not duplicate purchase expense.

The dataset also includes budgets, goals, account groups, labels, tags, portfolio positions, market prices, card statements, and 12 months of realistic household activity.

The supermarket series contains 96 purchases across eight merchants. Ordinary monthly totals vary by approximately 10–15%, with seasonal increases in December and July. The verifier treats coverage, transaction count, and seasonal bounds as data-quality invariants.

## Files

| File | Purpose |
| --- | --- |
| `jp-middle-class-family-2026.sql` | Deterministic data-only SQL dump |
| `build-demo-household-db.mjs` | Creates a fresh SQLite database, applies migrations, loads the dump, and validates invariants |
| `verify-demo-household-dump.mjs` | Builds and validates a temporary database, then removes it |

## Build a development database

```bash
node scripts/demo-data/build-demo-household-db.mjs \
  tmp/demo-tanaka-family.sqlite --force
```

Verify the fixture without retaining a database:

```bash
node scripts/demo-data/verify-demo-household-dump.mjs
```

The generated database is plaintext SQLite and must be used only for development or QA. It is not a replacement for the SQLCipher database created by the desktop application.

Load the SQL into a fresh, fully migrated database. Deterministic identifiers make the dump intentionally non-idempotent.
