# KakeFlow Phase 2 hardening design

**Status:** Approved in chat on 2026-08-24; implementation is pending written-spec review.

**Goal:** Remove applicable dependency risk, make PDF visual QA observable on CI, harden workflow supply-chain controls, clean test noise, and publish only evidence that the release boundary supports.

**Out of scope:** PWA implementation, Certification Library evidence, new financial features, connector expansion, and publishing a release before the branch is merged and every release gate is green.

## Verified baseline

The baseline is `main` at `4cb6121` and release `v1.2.0`.

- Node contract: `^20.19.0 || >=22.12.0`; CI and local functional verification use Node 22.
- `npm audit --omit=dev` reports zero vulnerabilities.
- Full `npm audit` reports one high-severity development-tree advisory: `nanoid@3.3.16` through `vite@6.4.3 -> postcss@8.5.23`; `nanoid@3.3.18` fixes the affected 3.x range.
- GitHub reports one open medium Rust alert: `glib@0.18.5`, GHSA-wrw7-89jp-8q8g.
- The Linux graph reaches `glib` through `tauri -> webkit2gtk/gtk`; the macOS target graph contains no `glib`, and the KakeFlow source does not import `glib` directly.
- The latest compatible Tauri graph still selects the GTK 3 bindings on `glib 0.18`; the patched `glib` line begins at `0.20` and cannot be selected independently.
- Frontend baseline is `749` passing tests plus one Poppler visual-QA timeout at 20 seconds. The remaining 112 test files pass.
- Rust build succeeds with Rust 1.97. The release gate retains the established `643`-test no-regression floor and records the fresh count from the implementation branch.
- The visual-QA script already creates `manifest.json`, `VISUAL_REVIEW.md`, and page PNGs, but its test writes them under a temporary directory and removes them.
- The quality workflow uses mutable `actions/checkout@v5` and `actions/setup-node@v5` references and does not install Poppler.
- Thirteen Dependabot pull requests are open, including safe patch updates, incompatible runtime updates, and major-version changes.
- One desktop localization test emits React `act(...)` warnings from asynchronous settings panels.
- Public copy correctly says that the macOS artifact is ad-hoc signed and not notarized.

## Dependency and advisory policy

### JavaScript

Refresh only the lockfile resolution allowed by the existing PostCSS range so `nanoid` resolves to at least `3.3.18`. Do not add a direct `nanoid` dependency or a root override unless the normal lockfile resolver cannot select the patched version. Both production-only and complete-tree audits must report zero vulnerabilities after the change.

### Rust `glib`

Do not force `glib >=0.20` into the GTK 3 graph: two `glib` major lines would not repair the vulnerable upstream consumer and could create ABI/type incompatibility. Record the same accepted residual-risk facts in the English, Vietnamese, and Japanese sections of `docs/SECURITY.md`:

- advisory and vulnerable version;
- complete affected path `tauri -> webkit2gtk/gtk -> glib`;
- Linux-only target applicability;
- absence from the current macOS release target and absence of direct KakeFlow calls to `VariantStrIter`;
- impact: upstream iterator unsoundness could affect a future Linux GUI runtime if the vulnerable API is reached;
- treatment: monitor Tauri/GTK migration, update when a compatible patched graph exists, and re-evaluate before shipping Linux artifacts;
- review date: every dependency hardening pass and before any Linux release.

The GitHub alert may remain open while upstream is incompatible. It must not be dismissed as fixed or not-used while Linux builds still contain the dependency. The explicit assessment satisfies the “no unexplained applicable medium/high alert” gate without misrepresenting the dependency graph.

## Dedicated Poppler CI

Keep pure parsing and PNG-header tests in the frontend functional suite. Exclude the external Poppler render case from that job and expose it through a dedicated package script and CI job.

The dedicated job must:

1. run on Ubuntu with Node 22;
2. install `poppler-utils` and verify both `pdfinfo` and `pdftoppm` are executable;
3. set a required-Poppler environment flag so missing binaries fail rather than skip;
4. run only the visual render contract with a dedicated 90-second test timeout;
5. write deterministic output below `artifacts/pdf-report-visual-qa/` instead of a temporary directory;
6. upload `manifest.json` as the machine artifact;
7. upload `VISUAL_REVIEW.md` and every rendered PNG as the human-review artifact;
8. fail on missing artifact files.

The functional suite must retain its normal timeout and must not inherit the Poppler timeout. Local developers without Poppler may skip only the external render case; CI may not skip it.

## Workflow supply-chain controls

Every `uses:` entry must reference a full immutable commit SHA with a human-readable release tag comment. Use verified upstream tag commits consistent with Maintainer Defense. Checkout must disable persisted credentials. The Poppler artifact uploads use the same pinned `actions/upload-artifact` release for both machine and human outputs.

Dependabot remains enabled for GitHub Actions so new releases are visible, but Dependabot pull requests must update both the SHA and tag comment. A workflow contract test rejects mutable tags and short SHAs.

## Dependabot cleanup

Rebase and test safe patch/minor updates against this branch. Integrate compatible updates that reduce open maintenance work without changing the Node 22 or Rust 1.97 contracts. Close pull requests that are:

- superseded by the hardening branch;
- incompatible with the declared runtime, such as a Node 26 type baseline;
- major upgrades with no Phase 2 requirement and a failing or unverified behavior gate.

Each closure receives a concise reason and a link to the superseding hardening work when available. Remote PR changes occur only after the local dependency, frontend, Rust, and build gates pass.

## React warning cleanup

Limit changes to test synchronization and cleanup around the existing localization/settings test. Await the settings-panel asynchronous effects or unmount only after they settle. Do not change component runtime behavior merely to silence a test warning. The targeted test must pass with no `act(...)` warning before the full frontend suite is rerun.

## Demo and release evidence

Produce a captioned MP4 lasting 85-95 seconds from deterministic synthetic data. It must show, in order:

1. a synthetic Japanese receipt;
2. the local OCR candidate;
3. comparison against source evidence;
4. explicit user approval;
5. a balanced ledger entry with zero debit-credit difference;
6. navigation from the posted entry back to provenance.

The demo must not require an account, network connector, real receipt, real name, real account number, or private database. Store the storyboard, generation/capture command, SHA-256 checksum, and public media artifact together so the video is reproducible and auditable.

Before release preparation, inspect the signing identities and notarization credentials available to the release process. If a Developer ID Application identity and notarization credentials are both available, add a separate signed/notarized release path and verify Gatekeeper. Otherwise retain ad-hoc signing, keep the current disclosure in every language, and do not describe the DMG as a frictionless production installer.

`v1.2.1` is eligible only because dependency, CI, test, or release behavior changed materially. Eligibility does not authorize publication from the feature branch. Tagging and publishing happen after merge, fresh release verification, and explicit release execution.

## Acceptance gates

- Node 22 complete-tree `npm audit`: zero vulnerabilities.
- `npm audit --omit=dev`: zero vulnerabilities.
- No unexplained applicable high or medium dependency alert.
- At least 749 frontend tests pass with no functional regression; Poppler is counted separately and is not skipped on CI.
- At least 643 Rust tests pass with no regression.
- Lint, TypeScript build, version contract, update-channel contract, updater signature contract, release signature contract, and checksum contract pass.
- GitHub Actions use immutable full SHAs only.
- Machine and human Poppler artifacts exist on the dedicated CI run.
- Targeted and full frontend runs emit no known React `act(...)` warning.
- The 85-95 second demo uses only synthetic data and requires no account.
- Release copy matches the actual signing/notarization state.
