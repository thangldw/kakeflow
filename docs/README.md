# KakeFlow documentation

This directory documents the current product contract. Historical screenshots, dated audits, duplicate handoffs, and feature-by-feature progress notes were removed; Git history remains the archive.

| Document | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Components, trust boundaries, data ownership |
| [Accounting](ACCOUNTING.md) | Ledger, metrics, cards, reports |
| [Imports](IMPORTS.md) | Source formats and review lifecycle |
| [Investments](INVESTMENTS.md) | Snapshots, transactions, valuation, FIFO |
| [Family sync](FAMILY_SYNC.md) | Relay, audience partitions, review and apply |
| [Localization](LOCALIZATION.md) | Japanese, English, Vietnamese catalog contract |
| [Development](DEVELOPMENT.md) | Setup, checks, repository structure |
| [Release](RELEASE.md) | Versioning, builds, checksums, GitHub publication |
| [Security](SECURITY.md) | Local storage, credentials, evidence, reporting |

The TypeScript and Rust tests are the executable specification. If documentation and verified behavior differ, update both in the same change.
