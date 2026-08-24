# KakeFlow Phase 2 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the known dependency advisory, isolate and evidence Poppler QA on CI, pin Actions, clean test warnings and stale dependency PRs, and preserve an honest release boundary.

**Architecture:** Keep runtime behavior unchanged. Dependency work is lockfile-first, Poppler becomes its own fail-closed CI contract with persistent artifacts, workflow references become verified immutable SHAs, and residual Linux-only `glib` risk is documented instead of falsely suppressed.

**Tech Stack:** Node 22, npm, Vitest, GitHub Actions, Poppler, Rust 1.97, Tauri 2.

**Spec:** `docs/superpowers/specs/2026-08-24-kakeflow-phase2-hardening-design.md`

## Global Constraints

- `npm audit --omit=dev` and full `npm audit` must both finish with zero vulnerabilities.
- Do not force a second `glib` major line or dismiss GHSA-wrw7-89jp-8q8g as fixed/not-used.
- Functional frontend tests retain their normal timeout; Poppler receives a dedicated 90-second timeout.
- CI Poppler execution must fail rather than skip when binaries are missing.
- Every GitHub Action reference is a verified 40-character SHA with a tag comment.
- Node 22, Rust 1.97, updater/signature/checksum contracts, and release disclosure remain unchanged unless a verified release change requires an update.
- Remote Dependabot changes happen only after local gates pass.

---

### Task 1: JavaScript advisory and Rust residual-risk record

**Files:**
- Modify: `package-lock.json`
- Modify: `docs/SECURITY.md`

**Interfaces:**
- Consumes: existing `postcss@8.5.23` range `nanoid ^3.3.16`.
- Produces: lockfile resolution `nanoid >=3.3.18`; tri-lingual `glib` assessment naming the exact Linux path and release boundary.

- [ ] **Step 1: Capture the failing complete-tree audit**

Run:

```bash
npm audit
```

Expected: exit non-zero with GHSA-2v37-7h3g-55p8 on `nanoid@3.3.16`.

- [ ] **Step 2: Refresh only the allowed transitive resolution**

Run:

```bash
npm update nanoid --package-lock-only
npm ci
```

Expected: `package.json` unchanged and `package-lock.json` selects `nanoid@3.3.18` or newer within the 3.x line.

- [ ] **Step 3: Verify both audit boundaries**

Run:

```bash
npm audit
npm audit --omit=dev
npm ls nanoid postcss vite --all
```

Expected: both audits exit 0; the dependency path remains `vite -> postcss -> nanoid` with a patched Nano ID.

- [ ] **Step 4: Add the explicit `glib` assessment**

Add equivalent English, Vietnamese, and Japanese subsections to `docs/SECURITY.md` containing:

```text
GHSA-wrw7-89jp-8q8g; glib 0.18.5; tauri -> webkit2gtk/gtk -> glib;
Linux GUI target only; absent from the current macOS release graph; no direct
KakeFlow VariantStrIter call; re-evaluate before any Linux release and whenever
Tauri migrates to a patched GTK/glib graph.
```

- [ ] **Step 5: Re-prove the target paths**

Run:

```bash
cargo tree --manifest-path src-tauri/Cargo.toml -i glib --target x86_64-unknown-linux-gnu
cargo tree --manifest-path src-tauri/Cargo.toml -i glib --target aarch64-apple-darwin
rg -n "VariantStrIter|use glib|glib::" src-tauri/src
```

Expected: Linux prints the Tauri/GTK path; macOS prints nothing; source search has no direct use.

- [ ] **Step 6: Commit**

```bash
git add package-lock.json docs/SECURITY.md
git commit -m "fix: remove Nano ID advisory and document glib risk"
```

### Task 2: Immutable workflow pins contract

**Files:**
- Create: `scripts/github-actions-pins.test.ts`
- Modify: `.github/workflows/quality.yml`

**Interfaces:**
- Consumes: workflow `uses:` values.
- Produces: semantic validation that every external Action uses `owner/repo@<40 hex SHA>`; pinned checkout/setup-node/upload-artifact references.

- [ ] **Step 1: Write the failing workflow contract**

Create a Vitest test that loads every YAML file under `.github/workflows`, extracts non-comment `uses:` scalar values, and asserts:

```ts
expect(action).toMatch(/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/u)
```

Normalize `owner/repo@sha` and `owner/repo/path@sha`; ignore local `./` actions and Docker references. The failure message includes workflow path and mutable reference.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx -y node@22 node_modules/vitest/vitest.mjs run scripts/github-actions-pins.test.ts
```

Expected: FAIL on `actions/checkout@v5` and `actions/setup-node@v5`.

- [ ] **Step 3: Pin verified releases**

Use these verified commits:

```yaml
actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
```

Add `persist-credentials: false` to checkout steps.

- [ ] **Step 4: Verify GREEN**

Run the targeted test and `npm run lint`. Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/quality.yml scripts/github-actions-pins.test.ts
git commit -m "ci: pin GitHub Actions by immutable SHA"
```

### Task 3: Dedicated Poppler runner and durable artifacts

**Files:**
- Modify: `package.json`
- Modify: `scripts/pdf-report-visual-qa.test.ts`
- Modify: `.github/workflows/quality.yml`
- Test: `scripts/pdf-report-visual-qa.test.ts`

**Interfaces:**
- Consumes: `KAKEFLOW_REQUIRE_POPPLER`, `KAKEFLOW_PDF_QA_OUTPUT`.
- Produces: `artifacts/pdf-report-visual-qa/manifest.json`, `VISUAL_REVIEW.md`, and report PNGs.

- [ ] **Step 1: Add a failing policy test**

Extract and export:

```ts
export function pdfQaExecutionPolicy(available: boolean, required: boolean): 'run' | 'skip' | 'fail' {
  if (available) return 'run'
  return required ? 'fail' : 'skip'
}
```

Add literal assertions for all three outcomes before implementing it.

- [ ] **Step 2: Verify RED then implement the policy**

Run the test and confirm the missing export fails. Implement the function and rerun until green.

- [ ] **Step 3: Make output persistence explicit**

When `KAKEFLOW_PDF_QA_OUTPUT` is set, resolve it from the repository root, remove it before the run, write QA output there, and do not delete it in test cleanup. Otherwise retain the temporary local behavior. When `KAKEFLOW_REQUIRE_POPPLER=1` and binaries are absent, throw `Poppler is required for PDF visual QA`.

Remove the per-test 20-second override; the dedicated command supplies the timeout.

- [ ] **Step 4: Split package scripts**

Add:

```json
"test:functional": "vitest run --exclude scripts/pdf-report-visual-qa.test.ts",
"test:pdf-visual": "vitest run scripts/pdf-report-visual-qa.test.ts --testTimeout=90000"
```

- [ ] **Step 5: Verify the dedicated artifact locally**

Run:

```bash
KAKEFLOW_REQUIRE_POPPLER=1 KAKEFLOW_PDF_QA_OUTPUT=artifacts/pdf-report-visual-qa npm run test:pdf-visual
test -s artifacts/pdf-report-visual-qa/manifest.json
test -s artifacts/pdf-report-visual-qa/VISUAL_REVIEW.md
find artifacts/pdf-report-visual-qa -name 'page-*.png' -type f | grep .
```

Expected: three commands exit 0 and four report directories contain page PNGs.

- [ ] **Step 6: Add the dedicated CI job**

The job installs `poppler-utils`, verifies both executables, runs the dedicated command with the two environment variables, and uploads two artifacts:

```yaml
name: pdf-visual-qa-machine
path: artifacts/pdf-report-visual-qa/manifest.json
if-no-files-found: error
```

and:

```yaml
name: pdf-visual-qa-human-review
path: |
  artifacts/pdf-report-visual-qa/VISUAL_REVIEW.md
  artifacts/pdf-report-visual-qa/**/*.png
if-no-files-found: error
```

Change the frontend job to `npm run test:functional`.

- [ ] **Step 7: Verify functional isolation and workflow pins**

Run `npm run test:functional`, the pin contract, lint, and build. Expected: functional run has 749 or more passes and does not execute the external render case.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json scripts/pdf-report-visual-qa.test.ts .github/workflows/quality.yml
git commit -m "ci: run Poppler visual QA with review artifacts"
```

### Task 4: React test synchronization

**Files:**
- Modify: `src/App.desktop.test.tsx`

**Interfaces:**
- Consumes: asynchronous settings-panel effects in the Vietnamese localization test.
- Produces: the same user assertions with no post-test `act(...)` warning.

- [ ] **Step 1: Capture the warning as RED evidence**

Run the single test under Node 22 and save stderr. Expected: test passes but stderr contains `not wrapped in act`.

- [ ] **Step 2: Await the observable settings state**

After returning to Japanese settings, use `await waitFor` on the existing mocked platform calls or visible connector state that proves all mounted settings effects settled. Do not add sleeps or production branches.

- [ ] **Step 3: Verify warning-free output**

Rerun the targeted test, assert exit 0, and search captured stderr for `not wrapped in act`. Then run the complete desktop test file.

- [ ] **Step 4: Commit**

```bash
git add src/App.desktop.test.tsx
git commit -m "test: settle asynchronous settings effects"
```

### Task 5: Local hardening gate and Dependabot cleanup

**Files:**
- Modify only compatible dependency manifests/locks selected by verified PR review.
- Remote: open Dependabot PRs in `thangldw/kakeflow`.

**Interfaces:**
- Consumes: 13 open Dependabot PRs and local gate results.
- Produces: compatible updates integrated or updated; obsolete/incompatible PRs closed with evidence.

- [ ] **Step 1: Run the complete local hardening gate**

Run Node 22 audits, lint, functional tests, Poppler tests, production build, version/update/OCR contracts, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` with Rust 1.97.

- [ ] **Step 2: Classify every open PR**

For each PR record: dependency, current/target versions, major/minor/patch, runtime-contract effect, current CI result, and whether the hardening branch supersedes it.

- [ ] **Step 3: Integrate only verified compatible updates**

Use normal manifest constraints and lockfile updates. Rerun the complete gate after the final combined dependency set.

- [ ] **Step 4: Update or close stale PRs**

Close superseded and incompatible PRs with a concise factual reason. Do not merge a red or unverified major upgrade. Leave a link to the replacement branch/PR only after it exists.

- [ ] **Step 5: Commit any compatible dependency batch**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: refresh compatible dependencies"
```

Skip the commit if the branch already contains every accepted update.

### Task 6: Release-boundary evidence

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/kakeflow-page.js`
- Modify: `docs/demo/KakeFlow-90-second-storyboard.md`
- Create: `docs/assets/demo/kakeflow-receipt-to-provenance.mp4`
- Create: `docs/assets/demo/kakeflow-receipt-to-provenance.mp4.sha256`

**Interfaces:**
- Consumes: the PWA end-to-end synthetic flow from the PWA plan.
- Produces: 85-95 second account-free evidence and accurate signing/notarization disclosure.

- [ ] **Step 1: Inspect signing availability without exposing secrets**

Run `security find-identity -v -p codesigning` and check only the presence of notarization variable names, never values. If Developer ID plus notarization credentials are incomplete, retain ad-hoc release copy.

- [ ] **Step 2: Capture the deterministic PWA flow**

Use the PWA plan's capture script. Verify the video duration with `ffprobe`, inspect representative frames, and compute SHA-256.

- [ ] **Step 3: Update public evidence copy**

Link the demo, state that all data are synthetic, and retain ad-hoc/not-notarized wording unless Gatekeeper evidence exists.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md docs/kakeflow-page.js docs/demo docs/assets/demo
git commit -m "docs: publish synthetic receipt provenance demo"
```
