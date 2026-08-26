# Task 9 report — Refresh progress, retry, and disconnect UI

## Outcome

- Added strict field-by-field refresh start/progress DTO parsing with closed batch/item states, scoped household and batch IDs, deterministic unique kind/key ordering, bounded counts, aggregate consistency, state-specific timestamps/error shapes, and rejection of provider-only material.
- Added exact native `connector_refresh_one`, `connector_refresh_all`, and `connector_refresh_batch_get` client calls. Browser-runtime methods fail locally and never invoke native commands.
- Added capability- and runtime-projected per-connector refresh/retry/disconnect actions plus Refresh all. Manual import and runtime-unsupported sources expose none of those mutations; Configure still delegates to the existing destination routing.
- Polls immediately and then every 500 ms only while a batch is `ACTIVE`. Generation-scoped cancellation stops stale work on household change or unmount, and terminal progress triggers a parallel authoritative reload of summaries, bindings, accounts, and parser profiles.
- Renders deterministic polite progress, explicit COMPLETE/PARTIAL/FAILED summaries, per-item retryable versus needs-action outcomes, and changed counts without rendering connection keys or provider error codes. One failed item remains a local batch outcome rather than a global UI failure.
- Added explicit disconnect confirmation and delegated Drive, Gmail, and watched-folder removal to their existing typed commands. Successful disconnect reloads the Control Center; no evidence or ledger mutation was added.
- Restores focus to the initiating action, or Configure when the initiating action disappears. Responsive wrapping, minimum-width containment, long-label wrapping, and a stacked 760 px layout target the 390 px card/action boundary without changing provider settings surfaces.
- Manually reviewed the exact English and Vietnamese strings for all new actions, progress states, confirmations, and errors.

## TDD evidence

- Baseline: the exact three-file focused suite passed 173/173 tests before Task 9 tests were added.
- RED: after test-first edits, the same command reported 3 failing files, 16 failed and 171 passed (187 total). Failures were the absent refresh client contract, actions/progress, polling lifecycle, reload, focus, and typed disconnect delegation.
- GREEN: client contract tests passed 38/38; component tests passed 17/17; the exact three-file focused suite passed 187/187.

## Test coverage

- Valid exact command names and argument envelopes for individual refresh, Refresh all, and batch progress.
- Unknown fields/enums, scope mismatches, invalid timestamps/counts/terminal semantics, aggregate mismatches, duplicate or out-of-order identities, impossible item shapes, unsafe public errors, and provider path material reject before use.
- Native commands remain unreachable in the web runtime.
- ACTIVE progress ordering, polite live-region semantics, changed-count copy, same-connector disablement, Refresh-all disablement, terminal COMPLETE/PARTIAL/FAILED copy, retryable/needs-action distinction, and no global alert for item failures.
- Individual 500 ms polling, immediate terminal stop, household-change cleanup, unmount cleanup, terminal summary/binding reload, and focus restoration.
- Explicit confirmation and exact Drive/Gmail/watched-folder typed disconnect commands, followed by authoritative reload.
- Manual and runtime-unsupported sources retain Configure but expose no refresh, retry, disconnect, or Refresh-all action.

## Verification

All commands used Node 22 through `/opt/homebrew/opt/node@22/bin`.

- `npm exec -- vitest run src/platform/client.test.ts src/features/connectors/ConnectorControlCenter.test.tsx src/App.desktop.test.tsx`: 3 files, 187/187 passed.
- `npm run test:functional`: 128 files, 874/874 passed.
- `npm exec -- vitest run scripts/i18n-catalog-contract.test.ts src/i18n.test.tsx`: 2 files, 5/5 passed.
- `npm exec -- tsc -b --pretty false`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; existing OpenCV browser-externalization and large-chunk warnings remain informational.
- `npm run build:pwa`: passed with the same existing warnings and generated the PWA service worker.
- `git diff --check`: passed.

## Concerns and boundaries

- `npm run i18n:generate` remains externally blocked by Google Translate HTTP 429 because the repository has unrelated untranslated source literals. The exact Task 9 EN/VI entries were manually reviewed, and the catalog/i18n contract passes 5/5.
- No backend refresh, provider, persistence, evidence, ledger, OAuth, Keychain, or schedule semantics were changed.
- Rendered native Browser QA remains controller-owned, matching Tasks 4 and 6. The component and integration contracts cover responsive structure and the web/native command boundary; no external rendered viewport claim is made here.
