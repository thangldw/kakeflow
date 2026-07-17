# KakeFlow

KakeFlow is a local-first household finance workspace for macOS and Windows. It turns user-provided bank, card, wallet, brokerage, PDF, spreadsheet, and receipt data into an auditable household ledger and a separate investment portfolio.

[Project page](https://thangldw.github.io/kakeflow/) · [Latest release](https://github.com/thangldw/kakeflow-releases/releases/latest) · [Changelog](CHANGELOG.md)

## Release status

Version 1.0.0 is the current stable desktop milestone.

- macOS Apple Silicon is the supported public binary. It is ad-hoc signed and not notarized.
- Windows is supported as a source-build target until native installer evidence is available.
- Google Drive and Gmail connectors are limited to locally configured test users pending provider qualification.
- Imports, OCR, connector discovery, and family delivery never post ledger entries automatically.
- KakeFlow does not connect directly to banking, card, brokerage, or financial-aggregation APIs.

See [release notes](RELEASE_NOTES.md), [release readiness](docs/V1_RELEASE_READINESS.md), and [packaged-app testing](docs/PACKAGED_APP_TESTING.md) for the verified scope and known limits.

## What KakeFlow does

- Maintains a double-entry household ledger with immutable source evidence.
- Separates credit-card purchases from later liability settlement, preventing double-counted spending.
- Imports supported Japanese bank, card, wallet, brokerage, email, folder, and receipt sources through fail-closed adapters.
- Requires explicit review before candidates become confirmed ledger entries.
- Reconciles card statements, bank payments, and source coverage.
- Produces monthly, annual, transaction-ledger, portfolio, and investment-performance reports.
- Tracks portfolio snapshots and FIFO investment performance without inventing cross-currency totals.
- Shares reviewed household data through audience-partitioned, encrypted family artifacts.
- Stores the application database, evidence, credentials, and generated reports locally.

## Product tour

![KakeFlow household overview](docs/assets/screenshots/kakeflow-overview.png)

| Searchable transaction ledger | Import and review inbox |
| --- | --- |
| ![KakeFlow transaction ledger](docs/assets/screenshots/kakeflow-transactions.png) | ![KakeFlow import inbox](docs/assets/screenshots/kakeflow-import-inbox.png) |

## Data flow

![KakeFlow local-first data pipeline](docs/assets/infographics/data-pipeline.svg)

```text
User-controlled source
  -> immutable source document
  -> format detection and extraction
  -> normalized review candidate
  -> deduplication and reconciliation
  -> explicit user approval
  -> double-entry ledger
  -> analytics and reports
```

KakeFlow treats source documents, extracted business events, and ledger entries as separate records. Every supported import preserves enough document and row lineage to explain a confirmed number later.

Credit-card accounting follows the same rule:

![KakeFlow credit-card reconciliation](docs/assets/infographics/card-reconciliation.svg)

A purchase records the expense and card liability. The later bank debit settles the liability and is not counted as a second expense.

## Run locally

Requirements:

- Node.js 20.19 or newer in the 20.x line, or Node.js 22.12+
- Rust 1.97 for the desktop application
- macOS or Windows for the supported desktop targets

Install dependencies and start the web development server:

```bash
npm ci
npm run dev
```

Start the Tauri desktop application:

```bash
npm run desktop:dev
```

On first desktop launch, KakeFlow creates a random database master key and stores it in macOS Keychain or Windows Credential Manager.

## Quality checks

Run the frontend gates:

```bash
npm run lint
npm run build
npm test
```

Run the native gates:

```bash
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Build the unsigned desktop executable without an installer:

```bash
npm run desktop:build
```

`npm run desktop:smoke` runs the release-readiness sequence without launching the application or opening a user database. Release-specific procedures are documented in [Manual GitHub release](docs/MANUAL_GITHUB_RELEASE.md), [macOS signing and notarization](docs/MACOS_SIGNING_NOTARIZATION.md), and [Update channel](docs/UPDATE_CHANNEL.md).

## Repository map

| Path | Purpose |
| --- | --- |
| `src/` | React UI, import adapters, review workflows, and typed IPC clients |
| `src-tauri/` | Tauri shell, SQLCipher persistence, migrations, evidence vault, OCR, reports, backup, and restore |
| `relay-service/` | Reference authenticated relay and mobile-capture uploader |
| `scripts/` | Build, release, smoke-test, OCR, and demo-data utilities |
| `docs/` | Product contracts, source-format specifications, operations, and audit records |
| `design_handoff_kakeflow_v2/` | Versioned product-design handoff and visual reference set |
| `packaging/` | Platform packaging and OCR dependency configuration |

The React layer previews imports and presents application state. Rust owns encrypted persistence, filesystem access, native credentials, report generation, OCR orchestration, and the security-sensitive IPC boundary.

## Documentation guide

Start with these documents:

- [Metric contract](docs/METRICS.md): definitions and accounting boundaries.
- [Calculation targets](docs/CALCULATION_TARGETS.md): expense, income, transfer, and exclusion semantics.
- [Import classification rules](docs/IMPORT_REVIEW_CLASSIFICATION_RULES.md): review and posting behavior.
- [Card reconciliation](docs/CARD_PAYMENT_RECONCILIATION.md): purchase and settlement matching.
- [Investment performance](docs/INVESTMENT_PERFORMANCE.md): FIFO and currency rules.
- [Local sync foundation](docs/LOCAL_SYNC_FOUNDATION.md): local artifact and replication model.
- [Family Space](docs/FAMILY_SPACE.md): explicit family review and apply boundaries.
- [Localization](docs/LOCALIZATION.md): English, Japanese, and Vietnamese UI support.
- [V1 release readiness](docs/V1_RELEASE_READINESS.md): tested release boundary.
- [KakeFlow v2 handoff](design_handoff_kakeflow_v2/README.md): information architecture and visual contract.

Source-specific import contracts live under `docs/*_IMPORT.md`. Export specifications use `*_CSV.md`, `*_XLSX.md`, or `*_PDF.md`. Historical visual evidence is retained under `docs/audits/` and is not the current product specification.

## Design principles

1. Source data remains immutable evidence.
2. No import becomes a transaction without explicit review.
3. Confirmed ledger data, not raw extraction output, drives metrics.
4. Transfers and liability settlements do not inflate income or spending.
5. Missing, ambiguous, or unsupported source semantics fail closed.
6. Currency-specific values remain separate unless a source-backed conversion exists.
7. Every displayed or exported number should be traceable to its source and scope.
8. Local-first behavior must remain understandable without a hosted KakeFlow account.

## Distribution and security boundary

KakeFlow currently distributes through GitHub Releases. It does not claim notarized macOS distribution, a production Windows installer, a hosted identity service, automatic cloud synchronization, or production-qualified Google connectors.

The reference relay stores opaque immutable artifacts for testing personal and family delivery. It is not a hosted KakeFlow service. Deployments must provide TLS termination, request limits, durable storage, secret management, monitoring, backup, and their own operating controls. See [relay-service/README.md](relay-service/README.md).

## License

See [LICENSE](LICENSE).
