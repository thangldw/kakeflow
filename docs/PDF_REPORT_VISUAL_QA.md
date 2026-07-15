# PDF report visual QA

## Release acceptance scope

KakeFlow v0.73 implements four PDF exports: the source-backed Monthly Household
Review, Annual Household Review, Investment Performance report, and one
explicit Portfolio Snapshot. Therefore the v0.73 PDF release gate requires
exactly the `monthly`, `annual`, `investment-performance`, and
`portfolio-snapshot` fixture reports.

The post-v1.0 development line also implements `transaction-ledger`. It is an
accepted visual-QA report type but does not retroactively change the historical
v0.73 required set. A later release advertising it must explicitly add
`transaction-ledger` to that release's `--require` list.

Each PDF must be generated from the fixed synthetic household fixture used by
its report contract test. The selected household, reporting period, accounting
basis where defined, account scope, and source coverage must be visible in the
report. The Portfolio Snapshot instead displays its exact selected snapshot
identity and `asOf` time. Each PDF is an export of its already validated DTO and
must not perform a second financial calculation.

The fixtures should exercise Japanese text, a long merchant or category name,
positive and negative amounts, zero, a nullable value, at least two categories,
and enough rows to cross a page boundary. The annual fixture must cover all 12
ordered calendar months and include at least one partial-coverage month. If a
report supports empty-state export, that is a separate test and is not a
substitute for the populated visual fixture.

The investment fixture must include at least two native currencies, one realized
allocation with buy and sell evidence, one corporate-action allocation, one
uncovered sale, one skipped event, and one corporate-action event without a
matching allocation. This makes currency isolation, exception disclosure, and
available-versus-unavailable lineage observable rather than theoretical.

The portfolio fixture must identify one selected snapshot, account, source
document, and source-provided `asOf` time. It must include multiple position
currencies, explicit source FX rows quoted in JPY, at least one nullable
position measure, an asset-class row, and positive source row numbers. The
fixture must make it possible to prove that the PDF reports the selected
point-in-time snapshot without choosing a latest snapshot or current quote.

## Reproducible render command

Generate the historical four fixture PDFs, plus the optional development-line
ledger fixture when reviewing that increment, from their Rust contract tests
in a clean checkout:

```sh
KAKEFLOW_MONTHLY_REVIEW_PDF_FIXTURE="$PWD/tmp/pdfs/monthly-review.pdf" \
  cargo test --manifest-path src-tauri/Cargo.toml \
  monthly_review_pdf::tests::pdf_is_deterministic_extractable_japanese_and_complete \
  --lib -- --exact

KAKEFLOW_ANNUAL_PDF_FIXTURE="$PWD/tmp/pdfs/annual-review.pdf" \
  cargo test --manifest-path src-tauri/Cargo.toml \
  annual_review_pdf --lib

KAKEFLOW_INVESTMENT_PERFORMANCE_PDF_FIXTURE="$PWD/tmp/pdfs/investment-performance.pdf" \
  cargo test --manifest-path src-tauri/Cargo.toml \
  investment_performance_pdf --lib

KAKEFLOW_PORTFOLIO_SNAPSHOT_PDF_FIXTURE="$PWD/tmp/pdfs/portfolio-snapshot.pdf" \
  cargo test --manifest-path src-tauri/Cargo.toml \
  portfolio_snapshot_pdf --lib

KAKEFLOW_TRANSACTION_LEDGER_PDF_FIXTURE="$PWD/tmp/pdfs/transaction-ledger.pdf" \
  cargo test --manifest-path src-tauri/Cargo.toml \
  transaction_ledger_pdf::tests::pdf_uses_exact_canonical_scope_and_is_deterministic \
  --lib -- --exact
```

Then render and validate it:

```sh
node scripts/pdf-report-visual-qa.mjs \
  --output tmp/pdfs/v073-report-qa \
  monthly="$PWD/tmp/pdfs/monthly-review.pdf" \
  annual="$PWD/tmp/pdfs/annual-review.pdf" \
  investment-performance="$PWD/tmp/pdfs/investment-performance.pdf" \
  portfolio-snapshot="$PWD/tmp/pdfs/portfolio-snapshot.pdf"

# Increment-level ledger review (not the historical v0.73 four-report gate)
node scripts/pdf-report-visual-qa.mjs \
  --require transaction-ledger \
  --output tmp/pdfs/transaction-ledger-qa \
  transaction-ledger="$PWD/tmp/pdfs/transaction-ledger.pdf"
```

Use `--replace` only when intentionally regenerating the same review directory.
The command requires Poppler's `pdfinfo` and `pdftoppm`. The Codex bundled PDF
runtime provides both commands; local macOS environments can install Poppler
with `brew install poppler`.

The release command may state the required set explicitly, but doing so does not
change the v0.73 acceptance scope:

```sh
node scripts/pdf-report-visual-qa.mjs \
  --require monthly,annual,investment-performance,portfolio-snapshot \
  --output tmp/pdfs/v073-report-qa \
  monthly=/absolute/path/monthly-review.pdf \
  annual=/absolute/path/annual-review.pdf \
  investment-performance=/absolute/path/investment-performance.pdf \
  portfolio-snapshot=/absolute/path/portfolio-snapshot.pdf
```

The names supplied to `--require` and the named PDF arguments must match
exactly. A subset is useful for local diagnosis, but it is not complete v0.73
release evidence.

The workflow calls `pdfinfo -box` for structural evidence and renders every page
with:

```sh
pdftoppm -png -r 144 -cropbox INPUT.pdf OUTPUT_PREFIX
```

It normalizes page names, records input and PNG SHA-256 hashes and dimensions in
`manifest.json`, and writes `VISUAL_REVIEW.md`. The manifest deliberately says
`visualReview: required`: successful rendering is not proof that the layout is
correct.

## Automated gates

All gates fail closed; failed runs remove their staging directory and never
publish partial QA evidence.

- The current required report set is present exactly once. For v0.73 that set is
  exactly `monthly,annual,investment-performance,portfolio-snapshot`.
- Every input is a regular, non-empty `%PDF-` file no larger than 32 MiB.
- `pdfinfo` succeeds, reports PDF version, reports 1-40 pages, and reports a
  page size between 200 and 2,000 points on each axis.
- Reports are not encrypted.
- `pdftoppm` renders every reported page at 144 DPI using the crop box.
- Rendered page numbering is contiguous and the PNG count exactly matches the
  `pdfinfo` page count.
- Every render is a valid PNG and no page exceeds 25 million pixels.
- A report's total rendered area does not exceed 200 million pixels.
- The completed manifest records the PDF hash, byte size, page count, page size,
  PDF version, available producer metadata, and each rendered page's hash, byte
  size, width, and height.
- Unit tests validate `pdfinfo` parsing, structural bounds, PNG inspection, and
  a real Poppler render of a deterministic one-page fixture when Poppler is
  available.

These checks complement, rather than replace, `npm run test:packaged` and
`npm run test:dmg`. The packaged-app smoke proves native boot, IPC, migrations,
and top-level DOM interaction. The DMG smoke proves mounted bundle integrity.
Neither existing harness inspects PDF pixels.

## Mandatory visual inspection

A release reviewer opens every generated PNG at 100% zoom and completes the
generated checklist. Acceptance requires all of the following:

- Japanese glyphs are legible and there are no tofu boxes, replacement glyphs,
  mojibake, or unexpected fallback-font changes.
- Text, chart labels, legends, tables, totals, headers, footers, and page numbers
  are neither clipped nor overlapping.
- Typography, spacing, margins, colors, hierarchy, and alignment remain
  consistent across every page in the required report set.
- Negative, zero, blank, JPY, date, percentage, and any foreign-currency values
  that are present are visually distinct and retain the DTO semantics.
- Long labels wrap or truncate only where the design explicitly discloses it.
- Multi-page tables repeat the necessary header and do not lose, duplicate, or
  obscure rows at page transitions.
- Report title, household, period, accounting basis, scope, source coverage, and
  generation context are readable.
- Charts and tables agree with the fixed fixture assertions; a visually polished
  but numerically different report fails.
- The annual 12-month chart preserves January-December order, labels all months
  legibly, and uses the same scale and color semantics for the entire year.
- A partial-coverage month is visibly distinguishable from a complete month and
  is never presented as a zero-activity or fully covered month.
- Investment totals remain grouped and labeled by native currency. The PDF must
  not add JPY, USD, or any other unlike currencies into a consolidated amount.
- The investment report does not invent a consolidated return, ROI, TWR, IRR,
  unrealized return, current valuation, FX conversion, or forecast from the
  event-only DTO.
- Uncovered sales, skipped event IDs, and corporate-action event IDs without an
  allocation remain visible in an exceptions section rather than disappearing
  from a visually clean summary.
- Realized and corporate-action rows show every source document ID and source
  row available in the DTO. When skipped or unmatched event lineage is absent
  from the DTO, the PDF says that it is unavailable; it does not display zero,
  a guessed row, or provenance copied from another event.
- The Portfolio Snapshot title and summary display the exact selected snapshot
  ID, account ID/name, source document ID, and source-provided `asOf` time. The
  PDF must not silently select the latest snapshot for an account.
- Position native currencies remain attached to their source quantities, costs,
  and prices. Source FX observations remain a separate table with explicit base
  currency, `JPY` quote currency, rate, and source row; they are not silently
  applied to fill or convert a position value.
- Nullable position quantity, average cost, market price, JPY market value, and
  realized/unrealized P&L remain blank or explicitly unavailable. Blank never
  becomes zero and no missing value is derived from other columns.
- Asset-class, position, and FX rows retain `sourceDocumentId + sourceRow`
  lineage, with each source row shown as a positive integer.
- A point-in-time Portfolio Snapshot PDF does not infer performance, return,
  ROI, TWR, IRR, multi-snapshot trend, latest quote, or a current/live valuation
  beyond the source values stored at the selected `asOf` time.

The reviewer records name, date, and `PASS` in `VISUAL_REVIEW.md`. An unchecked
or unsigned checklist is not release evidence.

## Japanese font acceptance

The report generator owns deterministic Japanese font embedding. It must use a
pinned redistributable font file from the packaged application resources and
must not depend on a font discovered from the host operating system.

`pdfinfo` and `pdftoppm` prove that Poppler can parse and render the artifact;
they do not by themselves prove that the intended font is embedded. Until a
pinned `pdffonts` binary or an equivalent native font-object assertion becomes
part of the toolchain, acceptance requires both:

1. a generator-level test that rejects a missing or changed pinned font
   resource and verifies the PDF contains the expected embedded font object;
2. the page-by-page PNG inspection for correct Japanese glyphs.

Do not claim deterministic font embedding from a successful `pdftoppm` command
alone.

## Release evidence

Archive these files with the locally verified release evidence:

- every fixture PDF in the explicitly required report set (monthly, annual,
  investment-performance, and portfolio-snapshot PDFs for v0.73);
- `manifest.json`;
- every normalized PNG page;
- the completed `VISUAL_REVIEW.md`;
- the test command and commit SHA used to generate the reports.

The QA directory is intermediate evidence under `tmp/pdfs/` and must not be
committed. A release note may claim visually verified PDF reports only after the
automated manifest is `automated-pass`, the checklist is signed `PASS`, report
contract tests pass, and the packaged app/DMG gates for that release pass.
