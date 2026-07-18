# KakeFlow

KakeFlow is a local-first household finance desktop app for Japan. It imports user-provided bank, card, wallet, brokerage, PDF, spreadsheet, email, and receipt data into an auditable double-entry ledger—only after review.

[Product page](https://thangldw.github.io/apps/kakeflow/) · [Downloads](https://github.com/thangldw/kakeflow-releases/releases/latest) · [Release notes](RELEASE_NOTES.md) · [Documentation](docs/README.md)

Version 1.0.0 is the current stable desktop milestone.

![KakeFlow local-first pipeline](docs/assets/infographics/data-pipeline.svg)

## Why KakeFlow

- Local encrypted storage for the ledger, evidence, credentials, and reports.
- Immutable source evidence and row-level lineage for every confirmed import.
- Review-first posting: OCR, connectors, rules, and family delivery never write automatically.
- Correct card accounting: purchases create expenses; later bank debits settle liabilities.
- Japanese financial-source adapters that fail closed on ambiguous records.
- Portfolio snapshots and FIFO investment performance without invented FX totals.
- Japanese, English, and Vietnamese UI catalogs with automated coverage checks.

## Supported workflows

| Area | Current scope |
| --- | --- |
| Import | CSV, TSV, Excel, statement PDF, scanned PDF, receipt image, ZIP, EML, Gmail, Google Drive, watched folders |
| Review | Account mapping, duplicates, category rules, split postings, refunds and manual corrections |
| Cards | Statement identity, settlement account, due date, bank-payment matching, coverage |
| Investments | Brokerage trades, asset snapshots, native-currency positions, FIFO realized performance |
| Reports | Monthly and annual review, ledger export, portfolio export, PDF visual QA |
| Family | Audience-partitioned encrypted artifacts, conflict review, atomic apply |

## Run locally

Requirements: Node.js 20.19+ or 22.12+, Rust 1.97, and the platform dependencies required by Tauri 2.

```bash
npm ci
npm run dev
```

For the desktop app:

```bash
npm run desktop:dev
```

## Verify a change

```bash
npm run lint
npm test -- --run
npm run build
cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test
```

See [development](docs/DEVELOPMENT.md) for repository structure and [release](docs/RELEASE.md) for packaging and publication.

## Safety boundary

KakeFlow does not initiate payments, connect directly to financial-account APIs, or treat extracted data as confirmed accounting. Unsupported or incomplete source semantics remain blocked for review. Google connectors are local test-user integrations until provider qualification is complete.

## License

See [LICENSE](LICENSE).
