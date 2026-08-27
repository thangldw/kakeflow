# Task 10 report — PWA manual-source projection and runtime proof

## Outcome

- Added one account-independent PWA connector projection from the unlocked encrypted vault: `MANUAL_IMPORT` / `manual-import`, `AVAILABLE`, `CONNECTED`, `MANUAL`, and only `IMPORT_FILE`.
- Derived `pendingReviewCount` from household-scoped `PwaLedgerClient.listCandidates(householdId)`, counting only candidates still in `CANDIDATE` state.
- Added `Sources` as the seventh PWA workflow destination and reused the shared Control Center presentation primitives and pure aggregate model through a manual-only component.
- Kept Configure explicit: the manual source's `IMPORT_INBOX` destination navigates to the existing receipt Import screen.
- Reloaded the local projection at vault load/restore, after staging, and after approval without a new effect, network fetch, account lookup, polling, refresh, retry, disconnect, schedule, OAuth, Keychain, native-path, direct-bank, or native command path.
- Extended the production contract to scan every built JavaScript artifact and chunk name for native connector commands, OAuth scope/mode strings, Keychain material, watched/absolute-path DTO keys, and Tauri chunks.
- Extended the synthetic Playwright journey so measurement starts immediately after the browser context goes offline and remains active through offline reload, unlock, Sources, Import, staging, approval, provenance, archive restore, and the final ledger check. The measured journey has zero non-service-worker HTTP responses and zero failed HTTP requests, while the pending count changes from 0 to 1.
- Fixed the PWA's shared Control Center locale at English to match the dedicated English app shell without importing or persisting the shared locale provider.
- Kept durable stage/post success visible when a later projection refresh fails, with a truthful refresh-specific warning instead of misreporting OCR or posting failure. The UI projection also returns from 1 pending item to 0 after approval.

## TDD evidence

- Baseline: the exact focused suite passed 14/14 before Task 10 test changes.
- RED: the exact focused command reported 3 failed feature tests and 10 passed; the new client test failed because `listConnectorSummaries` did not exist, and both PWA UI tests failed because navigation still contained six buttons. The contract suite's production build also stopped at TypeScript because the test-first API did not exist yet, so its 3 tests were skipped.
- Initial GREEN: `src/platform/pwa/client.test.ts`, `src/pwa/PwaRoot.test.tsx`, and `scripts/pwa-contract.test.ts` passed 16/16 across 3 files.
- Review-fix RED: `src/pwa/PwaRoot.test.tsx` reported 3 failed and 4 passed. The failures proved the Japanese/English mismatch and that projection reload failures could hide a durably staged candidate or posted transaction.
- Final GREEN: the exact focused three-file suite passed 21/21. This includes mutation cases proving the bundle deny patterns recognize a Tauri chunk, a native connector command, and a minified native path key.

## Verification

Authoritative verification commands used Node 22 through `/opt/homebrew/opt/node@22/bin`; date-sensitive Vitest commands used `TZ=Asia/Tokyo`.

- Exact focused suite: 3 files, 21/21 passed.
- `npm run test:functional`: 128 files, 885/885 passed.
- `npm run lint`: passed.
- `npm exec -- tsc -b --pretty false`: passed.
- `npm run build:pwa`: passed; 64 modules transformed and 25 entries precached. Existing OpenCV browser-externalization and large-chunk warnings remain informational.
- `npm exec -- vitest run scripts/pwa-contract.test.ts`: 1 file, 6/6 passed after a fresh production build.
- `npm run test:pwa:e2e`: 1/1 passed after a fresh production build.
- `git diff --check`: passed before commit.
- Focused import scan: no PWA import of `platform/client.ts`, Tauri, Drive/Gmail runtime, watched-folder runtime, or native connector commands.
- The first independent re-review's three Important and three Minor findings were addressed at that checkpoint; the preserved 16/16 count above is explicitly the initial GREEN checkpoint, while its final verification counts were 21/21 focused, 885/885 functional, and 6/6 contract. Later residual review superseded the earlier no-residual conclusion and is recorded below.

## Runtime and product boundaries

- PWA Sources projects only local manual import. Native connectors are not represented as actionable or imported runtime code.
- No account or parser binding capability is projected; the source works for a household with zero ledger accounts.
- Import continues to stage encrypted evidence and a review candidate. It does not post until the existing explicit approval and balanced-entry gate succeeds.
- No provider authorization, credential, scheduler, refresh worker, filesystem path, relay, native IPC, or direct financial-institution capability was added.
- The in-app Browser reached the correct KakeFlow title and production index on two fresh isolated localhost origins, but its controlled tab retained an empty root with no warning/error logs. No rendered Browser claim is made from that path; the repository Playwright production/offline journey is the successful runtime evidence.

## Root-review fix round

### RED evidence

- The new deferred-operation and locale/projection tests initially reported 4 failures and 7 passes across `src/pwa/usePwaClient.test.tsx` and `src/pwa/PwaRoot.test.tsx`: Lock left a late unlock busy, a late restore resolved, opening the PWA changed seeded `kakeflow.locale=vi` to `en`, and a stale deferred load repopulated `Stale household` after Lock.
- The strengthened production contract initially reported 1 failure and 9 passes. A fresh PWA build exposed both `assets/index-*.js: tauri-runtime` and `assets/index-*.js: provider-auth`; the prior filename-only Tauri check and JavaScript-body exclusions had hidden them.
- The first whole-journey request assertion initially expected 39 browser request events and observed 45. Trace inspection identified six local OCR asset reads fulfilled by the controlling service worker. The final test measures the actual boundary: every HTTP response not served by the service worker plus every failed HTTP request over the entire offline journey. Either list being non-empty fails, with no same-origin GET exception.

### Implementation boundaries

- Split the shared Control Center into one pure presentational/behavior component with an injected copy contract and a desktop-only localized wrapper. The PWA reuses the pure component with minimal English copy, so its dependency graph does not import `i18n.tsx`, generated catalogs, desktop runtime detection, Tauri, provider authorization, watched-folder, relay, or native path modules.
- Kept the desktop locale behavior in the wrapper and made the PWA copy non-persisting. A seeded Vietnamese shared preference remains `vi` while the PWA renders English.
- Added generation fences to vault restore/unlock installation and all PWA projection loads. Lock synchronously invalidates pending work, clears state, and closes any client that resolves late; stale household, account, transaction, candidate, or connector data cannot repopulate the locked view.
- The bundle contract now scans every production JavaScript filename and body, including the entry and generic/minified chunks, for Tauri internals, native commands, provider authorization/scopes, system-browser copy, Keychain material, and native absolute/watched-path DTO keys. Seven mutation rows prove the detector independently of generated chunk names.
- Encryption, durable receipt staging, explicit approval, balanced posting, evidence provenance, and account-independent manual import behavior are unchanged.

### Final verification

- Fix-focused UI/session suite: 3 files, 28/28 passed.
- Release-focused client/UI/contract suite: 5 files, 46/46 passed under Node 22. An accidental Node 26 invocation failed before meaningful UI assertions because that runtime did not expose jsdom `localStorage`; the identical command was rerun under the project verification runtime.
- Full functional suite: 129 files, 893/893 passed.
- Strict PWA contract: 1 file, 10/10 passed after a fresh build.
- Offline Playwright journey: 1/1 passed at that checkpoint; zero non-service-worker HTTP responses and zero failed HTTP requests across Sources, Import, synthetic staging, and Sources. The residual round below supersedes this narrower measurement interval.
- `npm run lint`: passed.
- `npm exec -- tsc -b --pretty false`: passed.
- `npm run build:pwa`: passed; 60 modules transformed, 25 entries precached, 69,562.86 KiB total precache. Existing OpenCV browser-externalization and large-chunk warnings remain informational.
- `npm run build`: passed; 1,780 desktop modules transformed. Existing OpenCV browser-externalization and large-chunk warnings remain informational.
- Fresh production artifact scan found no forbidden native/provider string or chunk-name match in any JavaScript artifact.

## Residual artifact and whole-journey fix round

### RED evidence

- Direct inspection of the fresh PWA artifact found provider and native-only catalog retained in `assets/PwaRoot-*.js`: `GOOGLE_DRIVE`, `Google Drive`, `GMAIL`, `Gmail`, `WATCHED_FOLDER`, refresh/retry/disconnect capability branches, refresh-all/disconnect labels, and account-binding copy.
- After adding filename/body mutation coverage, the strict contract reported 1 failure and 14 passes. The production finding contained both `provider-catalog` and `unused-connector-catalog` for the generated `PwaRoot` chunk.
- A second tightened cycle rejected the unreachable `DISCONNECTED` state retained by the generic state helper: the strict contract again reported 1 failure and 14 passes, now with only `unused-connector-catalog`.
- The offline guard probe passed 1/1 by issuing an unprecached fetch after service-worker control and browser-offline activation, observing the `requestfailed`, and proving the same assertion used by the real journey throws with the probe URL.

### Implementation boundaries

- Extracted catalog-free shared Control Center frame, list, card, and detail primitives. The full localized desktop Control Center composes these primitives without changing its public props, refresh/disconnect/binding behavior, focus restoration, localization, or accessibility semantics.
- Added a separate manual-only Control Center component that composes the same presentation primitives and shared aggregate model. The PWA imports only this manual module, direct English copy, the shared primitives, and the pure model; no runtime flag leaves desktop branches available for bundling.
- Expanded the contract across every JavaScript filename and body to reject provider labels/enums, including provider-bearing chunk names, plus unused refresh, retry, disconnect, disconnected-state, account-binding, refresh-all, disconnect, binding-editor, and refresh-progress catalog. Twelve independent mutation rows now pressure-test the deny detector.
- Moved offline measurement to immediately after `context.setOffline(true)` and kept it active through offline reload/unlock, Sources, Import, synthetic receipt staging, the second Sources projection, explicit approval/posting, provenance, encrypted archive download/restore, and the final ledger assertion. Any non-service-worker HTTP response or failed HTTP request fails without origin or method exceptions.
- Encrypted vault persistence, candidate staging, explicit approval, balanced posting, evidence provenance, locale isolation, and late-operation Lock fences are unchanged.

### Final verification

- Combined release-focused client/session/PWA/desktop-model/contract suite: 6 files, 56/56 passed.
- PWA/full-Control-Center focused UI suite: 2 files, 26/26 passed.
- Desktop Control Center/model focused suite: 2 files, 22/22 passed.
- Full functional suite: 129 files, 898/898 passed.
- Strict PWA contract: 1 file, 15/15 passed after a fresh production build.
- Offline Playwright suite: 2/2 passed, including the whole-journey zero-network assertion and the unprecached-fetch guard probe.
- `npm run lint`: passed.
- `npm exec -- tsc -b --pretty false`: passed.
- `npm run build:pwa`: passed; 61 modules transformed and 25 entries / 69,553.82 KiB precached. Existing OpenCV browser-externalization and large-chunk warnings remain informational.
- `npm run build`: passed; 1,781 desktop modules transformed. Existing OpenCV browser-externalization and large-chunk warnings remain informational.
- Fresh PWA artifact scan found no provider label/enum, refresh/retry/disconnect, binding, progress, native, Tauri, OAuth, Keychain, or path DTO match in any JavaScript artifact or chunk name.
