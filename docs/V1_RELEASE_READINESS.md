# KakeFlow v1 release readiness

This document records the locally verifiable product work and the provider,
credential, platform, and distribution evidence used to bound `v1.0.0`.

## Locally verifiable product gates

The following must be complete on the v1 release commit:

- the canonical ledger, card-payment reconciliation, portfolio, reporting,
  source viewer, rules, tags, family scopes, and durable local Inbox regression
  suites pass;
- Google Drive and Gmail remain read-only, review-gated ingestion channels and
  do not auto-post ledger transactions;
- the strict personal-bank CSV contract and every released provider adapter
  retain immutable physical-row provenance and explicit account mapping;
- macOS and Windows packages verify the checksum-pinned PaddleOCR PP-OCRv5
  models and ONNX Runtime Web assets; legacy Tesseract runtime/language
  manifests remain verified during the compatibility window;
- the release version matches in `package.json`, Cargo, Tauri, release notes,
  website links, and artifact names; and
- the [update channel contract](UPDATE_CHANNEL.md) remains explicitly disabled
  unless its signing, endpoint, configuration, and platform evidence gates are
  all satisfied atomically; and
- the manual release gates in [MANUAL_GITHUB_RELEASE.md](MANUAL_GITHUB_RELEASE.md)
  pass without relying on a GitHub-hosted runner.

Focused tests run with each capability increment. Full non-security audit,
packaging, version bump, tag, and public release run only for a substantial
product milestone such as v1.1 or v1.2, never for every incremental commit.
`npm run check:versions` enforces the release-version contract across both lock
files, the first changelog entry, README stable marker, project-page production
CTAs, and the exact DMG/NSIS artifact naming rules; roadmap and historical prose
are not interpreted as current-release metadata.
`npm run check:update-channel` proves that the current disabled build does not
generate updater artifacts, configure the plugin, install its dependencies, or
grant updater permissions. It does not prove a production updater.

## Platform evidence gates

These gates require the operating system that will receive the artifact:

| Platform | Required evidence |
|---|---|
| macOS | pinned OCR verification; packaged WebView smoke; read-only DMG validation; bundle signature-structure verification; SHA-256 |
| Windows | pinned OCR verification on Windows; NSIS install; installed-app WebView smoke; product-version/resource checks; silent uninstall; SHA-256 |

A helper or manifest test on macOS is not Windows runtime evidence. A Windows
artifact must not be published until the Windows evidence exists.

## External availability gates

The codebase cannot manufacture the following evidence:

- Google Drive consent/provider qualification and packaged real-account
  validation;
- Gmail restricted-scope consent/provider qualification and packaged
  real-account validation;
Paid Apple Developer ID/notarization, Windows Authenticode/Azure Artifact
Signing, Store distribution, and a signed automatic-update channel are outside
the funded product scope. Public artifacts are distributed through GitHub as an
ad-hoc-signed macOS DMG and, only after native installer evidence passes, an
unsigned Windows installer. Their Gatekeeper and SmartScreen limitations must
be disclosed and are not release blockers.

Until a gate is satisfied, the release must show the connector or distribution
channel as unavailable or qualified only for local/test-user use. File-first
ingestion remains functional and must not be presented as live aggregation.
Direct bank, card, brokerage, and financial-aggregation APIs are not a deferred
availability gate: they are permanently outside product scope for legal and
licensing reasons.

## Separate product tracks

Native iOS/Android capture, app-closed mobile background delivery, broader
automatic multi-device coordination, and additional institution adapters remain
real roadmap work. Each requires its own explicit source contract, lifecycle,
review boundary, fixtures, and platform evidence. They are not silently implied
by the desktop browser-capture reference client, the generic CSV rescue mapper,
or the current explicit family-delivery protocol.

## Release decision

`v1.0.0` advertises only the macOS Apple Silicon artifact after its local gates
pass. External integrations that are not yet qualified remain feature-gated and
explicitly disclosed; they are not evidence for a production-available
connector. Windows remains unadvertised until its native platform gates pass.
