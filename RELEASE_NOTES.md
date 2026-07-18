# KakeFlow 1.0.0

KakeFlow 1.0.0 is the first stable release of the local-first household finance desktop app.

## Highlights

- One review inbox for financial files, PDFs, scans, receipts, email attachments, Drive, and watched folders.
- Auditable double-entry accounting with immutable source documents and row lineage.
- Card purchases and later bank settlements remain linked without double-counting expense.
- Refund and adjustment differences in Rakuten Card PDFs can be reviewed and corrected manually.
- Japanese brokerage transactions and `assetbalance(all)` snapshots import through strict adapters.
- Expanded Japanese household categories and complete Japanese, English, and Vietnamese UI coverage.
- Portfolio, monthly, annual, ledger, XLSX, CSV, and PDF reporting.
- Encrypted family delivery that requires validation, review, and explicit apply.

## Distribution

Release artifacts and checksums are published at [thangldw/kakeflow-releases](https://github.com/thangldw/kakeflow-releases/releases/tag/v1.0.0). The source release is published at [thangldw/kakeflow](https://github.com/thangldw/kakeflow/releases/tag/v1.0.0).

macOS builds are ad-hoc signed unless a release explicitly states otherwise. Verify the checksum attached to the release before installation. Windows availability is listed per artifact on the download release.

## Known limits

- Google Drive and Gmail are test-user integrations pending provider qualification.
- Automatic updates are disabled unless a verified update channel is configured.
- KakeFlow does not initiate bank transfers, card payments, or brokerage orders.
- Unsupported or ambiguous source rows remain in review instead of being repaired silently.

See [release operations](docs/RELEASE.md) and [security](docs/SECURITY.md).
