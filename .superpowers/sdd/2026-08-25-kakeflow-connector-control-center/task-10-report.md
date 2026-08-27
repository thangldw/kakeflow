# Task 10 report — PWA manual-source projection and runtime proof

## Outcome

- Added one account-independent PWA connector projection from the unlocked encrypted vault: `MANUAL_IMPORT` / `manual-import`, `AVAILABLE`, `CONNECTED`, `MANUAL`, and only `IMPORT_FILE`.
- Derived `pendingReviewCount` from household-scoped `PwaLedgerClient.listCandidates(householdId)`, counting only candidates still in `CANDIDATE` state.
- Added `Sources` as the seventh PWA workflow destination and reused the shared presentational `ConnectorControlCenter` and its pure aggregate/filter/state model.
- Kept Configure explicit: the manual source's `IMPORT_INBOX` destination navigates to the existing receipt Import screen.
- Reloaded the local projection at vault load/restore, after staging, and after approval without a new effect, network fetch, account lookup, polling, refresh, retry, disconnect, schedule, OAuth, Keychain, native-path, direct-bank, or native command path.
- Extended the production contract to scan every built JavaScript artifact and chunk name for native connector commands, OAuth scope/mode strings, Keychain material, watched/absolute-path DTO keys, and Tauri chunks.
- Extended the synthetic Playwright journey so receipt staging occurs after service-worker control and offline unlock; both Sources visits issue exactly zero additional requests and the pending count changes from 0 to 1.
- Fixed the PWA's shared Control Center locale at English to match the dedicated English app shell, without a visible Japanese intermediate render.
- Kept durable stage/post success visible when a later projection refresh fails, with a truthful refresh-specific warning instead of misreporting OCR or posting failure. The UI projection also returns from 1 pending item to 0 after approval.

## TDD evidence

- Baseline: the exact focused suite passed 14/14 before Task 10 test changes.
- RED: the exact focused command reported 3 failed feature tests and 10 passed; the new client test failed because `listConnectorSummaries` did not exist, and both PWA UI tests failed because navigation still contained six buttons. The contract suite's production build also stopped at TypeScript because the test-first API did not exist yet, so its 3 tests were skipped.
- Initial GREEN: `src/platform/pwa/client.test.ts`, `src/pwa/PwaRoot.test.tsx`, and `scripts/pwa-contract.test.ts` passed 16/16 across 3 files.
- Review-fix RED: `src/pwa/PwaRoot.test.tsx` reported 3 failed and 4 passed. The failures proved the Japanese/English mismatch and that projection reload failures could hide a durably staged candidate or posted transaction.
- Final GREEN: the exact focused three-file suite passed 21/21. This includes mutation cases proving the bundle deny patterns recognize a Tauri chunk, a native connector command, and a minified native path key.

## Verification

All commands used Node 22 through `/opt/homebrew/opt/node@22/bin`; date-sensitive Vitest commands used `TZ=Asia/Tokyo`.

- Exact focused suite: 3 files, 21/21 passed.
- `npm run test:functional`: 128 files, 885/885 passed.
- `npm run lint`: passed.
- `npm exec -- tsc -b --pretty false`: passed.
- `npm run build:pwa`: passed; 64 modules transformed and 25 entries precached. Existing OpenCV browser-externalization and large-chunk warnings remain informational.
- `npm exec -- vitest run scripts/pwa-contract.test.ts`: 1 file, 6/6 passed after a fresh production build.
- `npm run test:pwa:e2e`: 1/1 passed after a fresh production build.
- `git diff --check`: passed before commit.
- Focused import scan: no PWA import of `platform/client.ts`, Tauri, Drive/Gmail runtime, watched-folder runtime, or native connector commands.
- Independent re-review found no Critical or Important residual. Its three Important and three Minor findings were addressed; the preserved 16/16 count above is explicitly the initial GREEN checkpoint, while the final verification counts are 21/21 focused, 885/885 functional, and 6/6 contract.

## Runtime and product boundaries

- PWA Sources projects only local manual import. Native connectors are not represented as actionable or imported runtime code.
- No account or parser binding capability is projected; the source works for a household with zero ledger accounts.
- Import continues to stage encrypted evidence and a review candidate. It does not post until the existing explicit approval and balanced-entry gate succeeds.
- No provider authorization, credential, scheduler, refresh worker, filesystem path, relay, native IPC, or direct financial-institution capability was added.
- The in-app Browser reached the correct KakeFlow title and production index on two fresh isolated localhost origins, but its controlled tab retained an empty root with no warning/error logs. No rendered Browser claim is made from that path; the repository Playwright production/offline journey is the successful runtime evidence.
