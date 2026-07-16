# Japanese four-person household demo dump

This directory contains deterministic, entirely synthetic demo data for
KakeFlow. Names, employers, account identifiers and transactions are fictional.

## Household profile

- `田中 健太` — father, salary JPY 8.4m/year, primary owner of a MUFG salary
  account and the Rakuten Securities stock portfolio.
- `田中 美咲` — mother, salary JPY 5.6m/year, owner of a MUFG salary account,
  PayPay Card and the SBI Securities gold/silver portfolio.
- `田中 悠真` — son, second year of junior high school.
- `田中 陽菜` — daughter, fifth year of elementary school.
- Gross household income: JPY 14m across the rolling year from August 2025
  through July 2026. Payroll tax and social-insurance deductions are explicit
  expense transactions. Both salaries are deposited into MUFG accounts.
- Household cash management uses an SMBC account. The housing loan produces one
  JPY 150k SMBC debit per month, split into JPY 120k principal and JPY 30k
  interest. Only interest affects accrual household expense; the complete JPY
  150k affects cash flow.
- Investment market value: JPY 20m — JPY 12m stocks/funds (60%), JPY 4m gold and
  silver (20%), and JPY 4m Mizuho Securities J-REIT exposure (20%). The
  owner-occupied home is a separate non-investment asset.

The daily-payment mix includes Rakuten Card, PayPay Card and PayPay QR/balance.
The latest Rakuten and PayPay card statements are reconciled against their
matching SMBC bank debits, so settlement does not duplicate household expense.

The dump also includes 12 months of salaries, payroll deductions, mortgage
payments, utilities, education, groceries, dining, travel, budgets, savings
goals, account groups, labels/tags, portfolio positions, market prices, two card
statements and fully reconciled bank payments. Card payments do not create a
second expense.

The twelve-month supermarket series contains 96 purchases across Life,
Ito-Yokado, Coop Mirai, Aeon, Gyomu Super, OK, Seiyu and Seijo Ishii. Payments
rotate between PayPay QR/balance, Rakuten Card, PayPay Card and the household
SMBC account. Ordinary month-to-month supermarket totals vary by roughly
10-15%; December and July increase by approximately 20%. The verifier treats
these seasonal bounds, month coverage and transaction count as data-quality
invariants.

## Files

- `jp-middle-class-family-2026.sql` — data-only SQL for a database already
  migrated through schema 65.
- `build-demo-household-db.mjs` — creates a fresh plaintext development SQLite
  database, applies every repository migration, loads the dump and validates
  the financial invariants.
- `verify-demo-household-dump.mjs` — builds and validates a temporary database,
  then removes it.

## Build a development database

```bash
node scripts/demo-data/build-demo-household-db.mjs \
  tmp/demo-tanaka-family.sqlite --force
```

Verify the dump without keeping a database:

```bash
node scripts/demo-data/verify-demo-household-dump.mjs
```

The generated database is plaintext SQLite for development and visual QA. It is
not a replacement for the desktop application's SQLCipher database. To load the
SQL into another database, use a fresh migrated copy because the deterministic
IDs intentionally make the dump non-idempotent.
