# PDF report visual QA

## Release acceptance scope

KakeFlow v0.71 implements two PDF exports: the source-backed Monthly Household
Review and Annual Household Review. Therefore the v0.71 PDF release gate
requires exactly the `monthly` and `annual` fixture reports. It must not claim
investment-performance or portfolio-snapshot PDF coverage.

Each PDF must be generated from the fixed synthetic household fixture used by
its report contract test. The selected household, reporting period, accounting
basis, account scope, and source coverage must be visible in the report. Each
PDF is an export of its already validated review DTO and must not perform a
second financial calculation.

The fixtures should exercise Japanese text, a long merchant or category name,
positive and negative amounts, zero, a nullable value, at least two categories,
and enough rows to cross a page boundary. The annual fixture must cover all 12
ordered calendar months and include at least one partial-coverage month. If a
report supports empty-state export, that is a separate test and is not a
substitute for the populated visual fixture.

## Reproducible render command

Generate the monthly and annual fixture PDFs from their Rust contract tests in
a clean checkout:

```sh
KAKEFLOW_MONTHLY_REVIEW_PDF_FIXTURE="$PWD/tmp/pdfs/monthly-review.pdf" \
  cargo test --manifest-path src-tauri/Cargo.toml \
  monthly_review_pdf::tests::pdf_is_deterministic_extractable_japanese_and_complete \
  --lib -- --exact

KAKEFLOW_ANNUAL_PDF_FIXTURE="$PWD/tmp/pdfs/annual-review.pdf" \
  cargo test --manifest-path src-tauri/Cargo.toml \
  annual_review_pdf --lib
```

Then render and validate it:

```sh
node scripts/pdf-report-visual-qa.mjs \
  --output tmp/pdfs/v071-report-qa \
  monthly="$PWD/tmp/pdfs/monthly-review.pdf" \
  annual="$PWD/tmp/pdfs/annual-review.pdf"
```

Use `--replace` only when intentionally regenerating the same review directory.
The command requires Poppler's `pdfinfo` and `pdftoppm`. The Codex bundled PDF
runtime provides both commands; local macOS environments can install Poppler
with `brew install poppler`.

The harness also recognizes `investment-performance` and `portfolio-snapshot`
as reserved future report types, but they are not v0.71 gates. A later release
can opt in only after the corresponding PDF export and contract tests exist:

```sh
node scripts/pdf-report-visual-qa.mjs \
  --require monthly,annual,investment-performance \
  --output tmp/pdfs/future-report-qa \
  monthly=/absolute/path/monthly-review.pdf \
  annual=/absolute/path/annual-review.pdf \
  investment-performance=/absolute/path/investment-performance.pdf
```

The names supplied to `--require` and the named PDF arguments must match
exactly, preventing a future release from accidentally omitting a promised
report or treating an unreleased report as current coverage.

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

- The current required report set is present exactly once. For v0.71 that set is
  exactly `monthly,annual`; future sets must be selected explicitly with
  `--require`.
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

- every fixture PDF in the explicitly required report set (monthly and annual
  review PDFs for v0.71);
- `manifest.json`;
- every normalized PNG page;
- the completed `VISUAL_REVIEW.md`;
- the test command and commit SHA used to generate the reports.

The QA directory is intermediate evidence under `tmp/pdfs/` and must not be
committed. A release note may claim visually verified PDF reports only after the
automated manifest is `automated-pass`, the checklist is signed `PASS`, report
contract tests pass, and the packaged app/DMG gates for that release pass.
