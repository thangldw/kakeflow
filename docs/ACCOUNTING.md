# Accounting and metrics

KakeFlow uses balanced double-entry postings. Confirmed postings—not OCR output or raw imported rows—drive dashboards and reports.

## Calculation targets

- Expenses and income count when their posting is confirmed and included.
- Transfers move value between asset accounts and do not count as income or expense.
- Card purchases recognize expense and increase card liability.
- Card settlement decreases cash and card liability without creating another expense.
- Refunds and adjustments keep their original sign and can be corrected during review.
- Excluded records remain auditable but do not affect household totals.

![Card purchase and settlement](assets/infographics/card-reconciliation.svg)

## Reviewable corrections

Source files are immutable. When a card statement total differs from its detail rows, KakeFlow may allow the import to continue with a warning. The user can correct the staged refund or adjustment row, account mapping, category, or posting split. The edited posting and the unchanged original remain linked.

## Reports

Monthly, annual, ledger, and portfolio exports reuse the selected household, account group, attribution scope, period, and calculation-target filters. Exports must not run a broader hidden query.
