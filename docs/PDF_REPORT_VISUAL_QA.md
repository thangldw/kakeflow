# PDF report visual QA

KakeFlow 1.0.0 releases five PDF families: monthly review, annual review, investment performance, portfolio snapshot, and transaction ledger. All five are required for release acceptance.

Each fixture must expose selected scope/period and exercise Japanese text, long labels, positive/negative/zero/null values, multiple categories, and pagination. Investment fixtures include multiple native currencies, realized/corporate allocations, uncovered/skipped/unallocated exceptions, and evidence. Portfolio fixtures identify the exact selected snapshot and nullable source values.

## Workflow

1. Generate PDFs from fixed synthetic DTO fixtures.
2. Validate deterministic bytes, expected text, counts, scope, and limits.
3. Render every page with Poppler at a fixed DPI.
4. Inspect at 100% for clipping, overlap, broken glyphs, wrapping, repeated headers, page numbers, semantic sign, null/disclosure treatment, and consistent margins.
5. Record one manifest and signed PASS/FAIL checklist.

Example:

```bash
node scripts/pdf-report-visual-qa.mjs \
  --require monthly \
  --require annual \
  --require investment-performance \
  --require portfolio-snapshot \
  --require transaction-ledger
```

Automated text or page-count checks do not replace page-by-page review. Temporary renders belong under ignored output; only deliberate audit evidence is committed.
