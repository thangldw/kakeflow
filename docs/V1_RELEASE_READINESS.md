# KakeFlow v1 release readiness

This document separates locally verifiable product work from provider,
credential, platform, and distribution evidence. It is a release checklist, not
a claim that `main` or the current `v0.90.0` binary is already v1.

## Locally verifiable product gates

The following must be complete on the v1 release commit:

- the canonical ledger, card-payment reconciliation, portfolio, reporting,
  source viewer, rules, tags, family scopes, and durable local Inbox regression
  suites pass;
- Google Drive and Gmail remain read-only, review-gated ingestion channels and
  do not auto-post ledger transactions;
- the strict personal-bank CSV contract and every released provider adapter
  retain immutable physical-row provenance and explicit account mapping;
- macOS and Windows OCR resource manifests pin the runtime, language data, and
  file hashes used by their corresponding packages;
- the release version matches in `package.json`, Cargo, Tauri, release notes,
  website links, and artifact names; and
- the [update channel contract](UPDATE_CHANNEL.md) remains explicitly disabled
  unless its signing, endpoint, configuration, and platform evidence gates are
  all satisfied atomically; and
- the manual release gates in [MANUAL_GITHUB_RELEASE.md](MANUAL_GITHUB_RELEASE.md)
  pass without relying on a GitHub-hosted runner.

Focused tests run with each capability increment. Full audit, packaging, version
bump, tag, and public release run only once for the v1 release candidate.
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
- Apple Developer ID signing/notarization credentials;
- Windows Authenticode credentials and reputation;
- a production update signing key and hosted update endpoint; and
- a commercial/legal contract, sandbox, and exact API contract for any Japanese
  bank/card aggregation provider.

Until a gate is satisfied, the release must show the connector or distribution
channel as unavailable or qualified only for local/test-user use. File-first
ingestion remains functional and must not be presented as live aggregation.

## Separate product tracks

Native iOS/Android capture, app-closed mobile background delivery, broader
automatic multi-device coordination, and additional institution adapters remain
real roadmap work. Each requires its own explicit source contract, lifecycle,
review boundary, fixtures, and platform evidence. They are not silently implied
by the desktop browser-capture reference client, the generic CSV rescue mapper,
or the current explicit family-delivery protocol.

## Release decision

Create `v1.0.0` only when all locally verifiable gates and every platform gate
for each advertised binary have passed. External integrations that are not yet
qualified must remain feature-gated and explicitly disclosed; they cannot be
used as evidence for a production-available connector.
