# Changelog

## 0.61.0 — 2026-07-14

- Add a dedicated `monex-us-stock-trade-history-v1` importer with an exact 16-field allowlist derived from the current Monex U.S.-stock Trade History detail screen, detected from normalized fields rather than a filename.
- Make the evidence boundary explicit: Monex does not publish a literal CSV byte schema, so the checked-in parser fixture is labeled synthetic and missing or changed fields fail closed instead of being presented as an official sample.
- Normalize only post-renewal, U.S.-dollar-settled `現物` buy/sell rows with explicit `一般`, `特定`, or `NISA` account semantics, both trade and settlement dates, leading ticker/name identity, and immutable physical-row provenance.
- Preserve exported USD gross, settlement, and fee values independently without recomputing an authoritative amount from quantity × unit price; retain any source settlement difference as a balanced auditable adjustment.
- Block yen-settled, margin/credit, FX, transfer, deposit/withdrawal, position-movement, account-transfer, dividend, sparse, and ambiguous rows rather than coercing them into investment trades.
- Require an explicit existing securities-account selection, keep restart completion-state recovery aware of the dedicated source, and never post Monex activity into the household income/expense ledger.

## 0.60.0 — 2026-07-14

- Replay the exact persisted `KFE1` envelope before deriving the current recipient set, so a lost relay response remains idempotent even after membership keys change.
- Treat only relay HTTP 409 with the exact `RECIPIENT_SET_CHANGED` code as permission to discard a stale encrypted envelope; network, malformed-response, and other ambiguous failures retain the immutable retry bytes.
- Reset only the rejected delivery tuple in one native transaction, preserve its inner family artifact and lineage, and reseal it against the refreshed recipients on the next explicit Send.
- Reconcile mixed upload outcomes independently: accepted publications are acknowledged first, exact stale-recipient rejections are reset, and unrelated retryable deliveries remain cached.
- Recover interrupted native `SENDING` rows as retryable at startup without changing their package or envelope bytes, including the response-loss case where the relay already accepted the publication.
- Add a synchronous send guard plus frontend, native, and relay regressions for double clicks, partial success, key rotation, pre-storage rejection, crash recovery, and byte-identical accepted replay.
- Keep the manual boundary unchanged: this release does not automatically send, download, decrypt, stage, review, or apply family data.

## 0.59.0 — 2026-07-14

- Add an explicit opt-in native schedule for checking family-delivery publication metadata every 15, 30, or 60 minutes while the KakeFlow desktop process is open, plus an immediate check control and persisted status.
- Store the relay token only in macOS Keychain or Windows Credential Manager after opt-in, bind it to the household, endpoint, and authenticated remote principal, and remove it when automatic checks are disabled or family delivery is disconnected.
- Revalidate the relay principal, active household membership, local public encryption identity, and remote member mapping before listing a bounded page set after the durable inbound cursor.
- Register newly visible publications only as `AVAILABLE`; the background worker never prepares or sends outbound data and never downloads, decrypts, stages, reviews, resolves, or applies an inbound artifact.
- Add single-flight schedule leases, restart recovery, bounded retry backoff, network-state recovery, and terminal suspension for expired authorization, revoked membership, or a missing saved credential.
- Keep the claim bounded: checks run only while the application is open and do not provide push/realtime sync, an operating-system daemon, automatic apply, sender signatures, remote erasure, or a production-hosted relay.

## 0.58.0 — 2026-07-14

- Add the binary `KFE1` recipient-encrypted family transport envelope, wrapping unchanged KFF1/KFF2/KFF3 artifacts for active X25519 membership keys with XChaCha20-Poly1305 payload encryption and strict metadata binding.
- Register only the device public identity with the relay; keep the private identity in the operating-system credential store and expose no private key material to the WebView.
- Make the relay store and route opaque ciphertext, verify immutable outer and inner digests plus the canonical recipient-set digest, and preserve legacy plaintext publications for backwards-compatible receipt.
- Persist the exact encrypted envelope before upload so retry after a lost response reuses identical bytes; clear cached ciphertext after relay acceptance while retaining inner lineage metadata.
- Decrypt and verify encrypted inbound artifacts in the native layer before entering the existing non-mutating review workflow; sending, receiving, and decrypting never apply records automatically.
- Keep the claim bounded: this release provides relay-blind recipient encryption, not sender signatures, background synchronization, automatic apply, remote erasure, or a production-hosted relay.

## 0.57.0 — 2026-07-14

- Add `KAKEFLOW_FAMILY_SNAPSHOT_SET` schema v3 with an exact 18-kind contract, carrying card statements/payments plus portfolio snapshots, brokerage events, investment FX rates, market prices, and aggregate asset snapshots while retaining V1/V2 decode and apply compatibility.
- Add the binary `KFF3` family artifact envelope: a canonical digest-bound header, unsigned 64-bit header length, original document bytes, complete raw rows, evidence links, and strict 64 MiB/tamper/count validation.
- Resolve account, transaction, statement, document, and row dependencies through the least-widening audience meet; withhold missing, mixed, mismatched, or oversized evidence graphs without making their kinds authoritative or leaking personal evidence into shared bytes.
- Qualify portable evidence aliases and card source references by origin installation, preserve that origin through forwarding, and allow colliding local IDs from multiple devices without merging unrelated evidence.
- Keep staging non-mutating by persisting pending KFF3 bytes through review; materialize evidence and accepted aggregates together inside one SQLite apply transaction and clean newly written vault blobs after a failed apply.
- Add V3 relay byte preservation, exact included/withheld domain counts, evidence file/record coverage, grouped card/investment review summaries, immutable retry behavior, and reason-specific disclosure in the desktop UI.
- Keep delivery manual and review-gated; v0.57 does not claim background synchronization, automatic apply, E2E relay backup, remote erasure, native mobile delivery, or production-signed Windows artifacts.

## 0.56.0 — 2026-07-14

- Add `KAKEFLOW_FAMILY_SNAPSHOT_SET` schema v2 for the core family graph plus complete monthly-budget, savings-goal, classification-rule, account-group, card-settlement-mapping, dashboard-preference, and delimited-parser-profile aggregates while retaining schema-v1 decode/apply compatibility.
- Resolve every account-dependent aggregate through a least-widening audience meet, keep whole plans/groups atomic, and withhold mixed-member, other-member, or unresolved graphs instead of splitting rows or widening access.
- Bind hash-verified entity-audience relocation lineage into each v2 artifact so a `SHARED`/`PERSONAL(member)` move removes stale partition lineage without allowing a later omission artifact to delete the entity in its new partition.
- Reuse the schema-v4 local change-package canonical payloads and materializers, apply accepted records in dependency order inside one transaction, and conservatively mark family partitions dirty for planning/configuration parent and child changes without echoing incoming applies.
- Add exact V1/V2 relay-schema preservation with byte-identical immutable retries, matching-member PERSONAL routing, revocation/generation enforcement, and rejection of unsupported artifact schemas.
- Add per-audience ledger/planning/config/card/investment counts, evidence counts, reason-specific withheld disclosure, grouped review summaries, and configuration-impact warnings; `COMPLETE` is valid only when no record is withheld.
- Keep card and investment aggregates explicitly withheld as `EVIDENCE_REQUIRED`; v0.56 does not claim evidence-partitioned delivery, automatic/background delivery, automatic apply, remote posting, or remote erasure.

## 0.55.0 — 2026-07-14

- Add a separate `MOBILE_RECEIPT_CAPTURE_V1` capsule and relay channel with independent storage, sequence, cursor, immutable retry identity, digest verification, and server-derived `SHARED` or same-member `PERSONAL` recipients.
- Add a responsive reference mobile-browser uploader that keeps its Bearer token in memory, validates JPEG/PNG signatures and dimensions, preserves an exact retry capsule, and makes no native-app, background-upload, or production-hosting claim.
- Add a durable desktop Capture Inbox backed by the encrypted source vault and append-only OCR provenance; original images survive OCR failures and can be inspected uncropped before processing.
- Run receipt OCR only on the desktop and promote a validated result atomically into the existing `REVIEW_REQUIRED` import workflow with `CAMERA_SCAN` provenance and preserved family audience/attribution.
- Reuse an existing source review for duplicate images and keep receipt-to-transaction matching or balanced ledger posting explicit; receiving, previewing, OCR, and promotion never call ledger commit automatically.
- Keep the scope bounded: JPEG/PNG only, one image per capsule, session-only relay token, manual receive check, no native iOS/Android binary, remote OCR, push/background delivery, E2E relay encryption, remote erasure, or automatic posting.

## 0.54.0 — 2026-07-14

- Add a separate `KAKEFLOW_FAMILY_SNAPSHOT_SET` schema-v1 protocol for cross-principal family delivery without changing the byte or deletion semantics of same-principal schema-v4 personal packages.
- Partition the initial confirmed household graph into `SHARED` and publisher-bound `PERSONAL(member)` artifacts for household, member, account, and transaction records; withhold mixed-member, unsupported, and evidence-dependent investment records instead of widening or silently dropping them.
- Strip local source links from family transactions, carry only hashed SHARED account-audience dependencies needed by PERSONAL journals, and require those dependencies to exist with matching scope before review.
- Add partition-keyed revision/entity lineage so omission deletion can affect only an exact previously accepted source and audience head whose local payload is still unchanged.
- Add a separately operated relay-v2 reference service with authenticated household creation, invite preview/redeem/revoke, membership generations, server-derived SHARED/PERSONAL recipients, immutable publications, restart-safe storage, and current-membership checks on list and direct download.
- Add the desktop Family Delivery workspace with session-only Bearer tokens, explicit audience/recipient previews, withheld-data disclosure, durable cursors and retry bytes, invite and revocation flows, and a dedicated partial-snapshot review/resolve/apply/discard boundary.
- Keep delivery claims bounded: no remote action writes the ledger automatically; there is no E2E encryption, background/realtime delivery, evidence or investment transport, remote erasure, production signing/notarization, or Windows installer artifact in this release.

## 0.53.0 — 2026-07-14

- Add an optional authenticated personal desktop relay for manually moving schema-v4 local change packages between installations using the same remote principal derived from a Bearer token.
- Add explicit connect, disconnect, send, receive-check, download, digest-validation, and stage controls while retaining the existing conflict/deletion review and atomic apply boundary; no relay operation applies ledger data automatically.
- Snapshot pending local envelopes into an immutable retryable delivery, acknowledge only the envelopes accepted by the relay, and leave changes captured after that snapshot pending for the next send.
- Persist relay endpoint, server-derived principal, delivery receipts, and bounded inbound metadata without persisting the session Bearer token; validate artifact identity, origin, household, digest, size, and package semantics before staging.
- Include a dependency-free Node reference relay with principal-isolated immutable storage, ordered listing, idempotent retry, digest verification, a 64 MiB limit, restart-safe index/bytes, and an explicit configurable WebView CORS allowlist; require deployment behind a TLS reverse proxy because the service itself speaks plain HTTP.
- Keep the boundary explicit: whole-household packages are same-principal-only, stored bytes are not end-to-end encrypted, and there is no cross-member audience enforcement, automatic/background sync, source/evidence or pending-review transport, mobile capture, or cloud-backup claim.

## 0.52.0 — 2026-07-14

- Add the dedicated `rakuten-securities-domestic-trade-history-v1` adapter for Rakuten Securities domestic-stock trade-history CSV exports, grounded in the provider's published trade and settlement semantics.
- Limit the supported contract to explicit domestic spot and odd-lot purchases and sales; reject credit/margin rows, `現引`, `現渡`, and every unsupported transaction type instead of creating incorrect investment legs.
- Require the exact twelve-field family for trade date, combined security, account, trade category, side, quantity, unit price, commission, tax, other expenses, tax label, and settlement amount; retain extra source columns in exact physical-row evidence.
- Normalize accepted rows into balanced `BUY` or `SELL` investment events, preserve settlement mismatches as `ADJUSTED` events with an auditable adjustment and warning, and exclude brokerage activity from household-expense metrics.
- Require an explicit active securities-account mapping and `証券取引に保存` action; filename, provider text, and file discovery never select an account or save an event.
- Add only synthetic, fictitious fixtures plus focused detection, parsing, unsupported-row, provenance, mapping, and save coverage; no customer export is checked into the repository.

## 0.51.0 — 2026-07-14

- Add the dedicated `sbi-securities-trade-history-v1` adapter for SBI Securities domestic and foreign `約定履歴` CSV exports, grounded in SBI's published field semantics rather than generic brokerage-column guessing.
- Limit the supported contract to spot stock purchases and sales; reject margin, margin settlement, delivery/receipt, derivatives, and other unsupported product or transaction rows instead of assigning incorrect investment legs.
- Preserve trade and settlement dates, parsed security code/ticker, name and market, custody/account classification, quantity, unit price, currency, settlement amount, and exact physical-row evidence; foreign product/order fields remain available in the immutable raw row.
- Normalize accepted rows into balanced `BUY` or `SELL` investment events, retain source-settlement mismatches as explicit auditable adjustments with warnings, and keep brokerage activity outside household-expense metrics.
- Require an explicit active securities-account mapping and `証券取引に保存` action; filename, provider text, and file discovery never select an account or save an event.
- Add only synthetic, fictitious domestic and foreign fixtures plus focused detection, parsing, rejection, provenance, mapping, and posting coverage; no customer export is checked into the repository.

## 0.50.0 — 2026-07-14

- Extend local change packages to schema v4 while retaining the same bounded eighteen-kind household snapshot and the existing explicit review/apply workflow.
- Carry the complete dashboard-preference aggregate: active template, theme, density, and the independent widget order and hidden-widget set for all five Home templates.
- Validate an exact five-template layout graph with exhaustive unique widget orders, template-eligible hidden widgets, at least one visible eligible panel, and deterministic canonical hashes.
- Apply accepted dashboard preferences and all five layouts atomically, preserve conflict rechecks and idempotent receipts, and suppress incoming changes from echoing into the local outbox.
- Keep schema-v1, schema-v2, and schema-v3 packages readable; legacy dashboard payloads update template, theme, and density without erasing destination layouts introduced in later versions.
- Keep layout transport local-file-only and presentation-only: it adds no server, login, remote synchronization, access-control claim, or effect on ledger calculations.
- Cover two-database layout round trips, layout-only conflicts, malformed and incomplete graphs, legacy schema preservation, omission defaults, migration capture, restore validation, idempotency, and no-echo behavior.

## 0.49.0 — 2026-07-13

- Add a separate passphrase-protected `.kakeflow-review` format for copying one candidate-bearing `REVIEW_REQUIRED` run between desktop installations without changing the source review.
- Carry exact source bytes, immutable source rows, candidate/evidence relationships, staged card statements, and dependency descriptors while excluding approvals, posting drafts, confirmed facts, receipt-only imports, and investment/source-only workflows.
- Require an explicit destination mapping for every account and family member; validate active household membership plus account kind, subtype, and currency without inferring identity from names.
- Apply the mapped graph atomically as a normal Import Inbox review, preserve source and candidate audience/attribution, and never create a transaction or journal entry before the existing approval boundary.
- Record immutable origin receipts and entity aliases for exact-package idempotency, reject equivocation and same-source collisions, and remove newly written vault objects when database apply fails.
- Keep paths and temporary plaintext outside the webview through native save/select dialogs and opaque staged package IDs; disclose that handoff is local-file copy rather than cloud sync.
- Cover basic and member/card/evidence round trips, wrong-passphrase and tamper rejection, missing mappings, no-posting behavior, idempotency/equivocation, terminal collisions, unsupported sources, and rollback cleanup.

## 0.48.0 — 2026-07-13

- Persist an independent widget order and hidden-widget set for every Home dashboard template instead of reusing one layout across all views.
- Keep template switching presentation-only: it restores that template's saved layout without resetting or overwriting layouts customized elsewhere.
- Migrate the v0.47 active layout without loss and seed deterministic defaults for the other four templates.
- Validate all five layouts atomically in SQLite, Rust, and the IPC client, including exhaustive unique order, template-eligible hidden widgets, and at least one visible panel.
- Preserve household-scoped theme, density, accounting-basis behavior, keyboard controls, DOM reading order, and device-local change-package compatibility.
- Cover independent customization, switching, reset/last-visible behavior, legacy migration, restore validation, malformed contracts, and household isolation.

## 0.47.0 — 2026-07-13

- Recover every household-scoped `REVIEW_REQUIRED` import after restart, including manual uploads that are not represented by the watched-folder Inbox.
- Add a bounded-complete native pending-review query with deterministic newest-first order, safe source metadata/counts, exact-one-document validation, tenant isolation, and an explicit error above 200 runs instead of silent truncation.
- Hydrate the existing immutable preview for each recovered run, deduplicate it against watched-folder recovery by canonical run ID, and never approve or post a candidate automatically.
- Keep the last valid recovered reviews visible when refresh fails, expose retry/refresh state, and remove committed, rolled-back, or receipt-linked runs from the workspace coherently.
- Restore previews independently so one stale or failed run cannot hide other valid reviews; block duplicate commit/rollback clicks synchronously and keep missing-account reviews rollbackable instead of crashing.
- Distinguish safe zero-candidate completion from interrupted investment-domain imports, and never mark portfolio, brokerage, or aggregate-asset data complete until its household/document-scoped facts exist.
- Cover strict IPC validation, backend ordering/isolation/overflow/malformed and mixed-household graphs, manual restart recovery and posting, partial failure retention, zero-candidate safety, and dual-discovery deduplication.

## 0.46.0 — 2026-07-13

- Add a compact Home layout editor with mouse drag-and-drop plus explicit keyboard move controls; DOM order always follows the saved visual order.
- Let each household hide and restore eligible Home widgets while enforcing that at least one remains visible, including runtime fallback for a malformed or template-filtered state.
- Preserve the existing accounting basis, KPI definitions, drill-downs, template eligibility, and full-width panel semantics while users personalize presentation.
- Persist exhaustive widget order and hidden-widget state in SQLite with strict API and database constraints, deterministic legacy defaults, and rollback on save failure; v0.46 keeps layout device-local so older change-package hashes remain stable.
- Cover platform validation, migration/round-trip constraints, household restoration, widget ordering, hidden panels, accessible announcements, and the last-visible guard.

## 0.45.0 — 2026-07-13

- Accept Money Forward ME household-ledger exports containing up to 50 normalized `保有金融機関` values instead of requiring one institution per file.
- Require a separate explicit active Asset/Liability account mapping for every source institution, disable staging until the mapping is complete, and never infer or auto-create an account.
- Apply each mapping at the candidate boundary while preserving Money Forward transfer, calculation-target, category, memo, source-row, stable-ID deduplication, and atomic posting semantics.
- Validate missing and unknown mapping keys before staging, retain deterministic first-appearance institution order, and cover UTF-8, CP932, Unicode-normalized duplicates, and the 50-institution bound.

## 0.44.0 — 2026-07-13

- Add a strict headerless `smbc-vpass-statement-v1` adapter for the official eleven-position Vpass CSV field order, gated by an SMBC/三井住友 product marker and isolated from Amazon Mastercard.
- Use the current billed amount rather than original usage amount, preserve explicit FX evidence and physical source rows, and treat negative billed rows as refunds.
- Require an explicit statement total and block total mismatches, ambiguous refund signs, invalid detail fields, and installment/revolving/deferred-payment rows that the current ledger cannot represent safely.
- Reuse one centralized adapter-to-account contract for validation and selector rendering; Vpass requires an explicit active `LIABILITY / CREDIT_CARD` account and never infers it from issuer, filename, or account name.

## 0.43.0 — 2026-07-13

- Add a visible `このファイルを読み取る` recovery action for unsupported CSV/TSV files even when the household has no saved parser profile.
- Build mappings from the selected file's actual first-twelve-row header candidates, clear stale mappings when the header changes, and support signed or separate debit/credit JPY amount modes.
- Show a bounded local sample plus live candidate, excluded-row, and error counts before saving; duplicate/missing mappings, invalid rows, and decoding errors block continuation.
- Require an explicit active Asset/Liability destination account, save the household parser profile, apply it to the existing in-memory source, and return to a ready-to-stage preview without creating an import early; `取込開始` remains an explicit boundary before pending review.
- Preserve cancel and save-failure state, support Escape dismissal, keep built-in adapters preferred, and retain the existing explicit posting boundary.

## 0.42.0 — 2026-07-13

- Add a dedicated, strict `jcb-myjcb-statement-v1` adapter for an explicit v1 header contract, including reordered columns and CP932/UTF-8 decoding through the existing import boundary.
- Preserve exact physical source-row provenance while parsing JPY billed amounts, refunds, cardholder/payment labels, and explicit original-currency amount/rate fields.
- Exclude metadata and statement-total rows from card purchases, block invalid dates, ambiguous positive refund markers, and total mismatches before staging, without silently changing source values.
- Require an explicit active credit-card liability account before staging; issuer or filename text never selects an account or posts a transaction.
- Add a synthetic, fictitious JCB fixture plus detection, parsing, mapping, provenance, account-selection, refund, FX, and malformed-layout coverage.

## 0.41.0 — 2026-07-13

- Extend local change-package schema v3 to exactly 18 aggregate kinds with portfolio snapshots/positions/snapshot FX, brokerage events/legs, dated investment FX, market prices, and Money Forward aggregate asset history while retaining schema-v1/v2 compatibility.
- Keep derived FIFO holdings, realized performance, valuation, and chart marts out of the package and recompute them from the transferred confirmed facts.
- Add evidence-capsule schema v2 with evidence-first source hydration for the five investment aggregates, exact document/row dependencies, idempotent pending portable references, and atomic conflict rollback.
- Preserve the original evidence installation across A → B → C forwarding, so a package created on B still resolves source facts originally hydrated from A.
- Reconstruct whole investment aggregates with deterministic child order, validate brokerage semantics and account scope, require explicit review for conflicts/deletions, and verify exact canonical hashes after atomic apply.
- Guide the desktop workflow as 原本カプセル first and 変更パッケージ second, with distinct Japanese labels for 資産残高, 証券取引, 投資用為替レート, 市場価格, and 総資産履歴.

## 0.40.0 — 2026-07-13

- Add a separate passphrase-protected confirmed-evidence capsule carrying original CSV, PDF, and receipt-image bytes plus every immutable source row behind posted transactions and card statements.
- Authenticate the capsule manifest and vault objects, enforce document/record/byte budgets, validate exact household and ledger/card dependencies, and publish database aliases atomically only after all source bytes are verified.
- Reuse source documents by household SHA-256, reject portable-ID/content collisions, make repeated imports idempotent, and clean newly written unreferenced vault objects after a failed database apply.
- Preserve origin document and record identities across A → B → C forwarding while keeping portable transaction/card source references dormant, so evidence hydration does not change canonical aggregate hashes or echo a local change.
- Resolve hydrated aliases in transaction detail, raw-row pagination, image preview, and PDF preview while retaining the immutable original payload and source audience controls.
- Add a dedicated Settings workflow with explicit confirmed-only scope, pending-Inbox exclusion, imported/reused counts, and native `.kakeflow-evidence` save/select dialogs.

## 0.39.0 — 2026-07-13

- Extend local change-package schema v2 to exactly 13 aggregate kinds with complete card statements and card payments while retaining schema-v1 compatibility.
- Reconstruct statement periods, due dates, amounts, derived reconciliation states, deterministic ordered lines, unconfirmed suggestions, and confirmed bank-payment links.
- Preserve statement source identifiers as portable references without treating a same-ID local document as proof of the same source bytes.
- Apply transactions, statements, and payments in dependency order; delete in reverse order; validate the complete resulting card graph and roll back inconsistent mixed conflict choices.
- Keep schema-v1 packages scoped to their original 11 kinds so an older package never implies deletion of card reconciliation data.
- Show card statements and card-settlement records with clear labels in the no-default review workflow; network transport remains outside this release.

## 0.38.0 — 2026-07-13

- Add native save/select workflows for full-current-state local change packages covering exactly 11 household, ledger, planning, and configuration aggregate kinds.
- Validate canonical payload, snapshot, package, kind-count, identity, duplicate-key, source-installation, revision, and applied-lineage invariants before review.
- Stage package review durably with explicit add/update/unchanged/delete/conflict counts; require a no-default keep-local or use-package decision for every conflict and deletion.
- Recompare destination aggregate hashes immediately before apply, materialize accepted changes in dependency order, and roll back the whole package on any failed relation or write.
- Preserve source-record and candidate identifiers through portable transaction evidence links until the original source graph is available locally.
- Record accepted source revision/entity heads, reject stale or equivocated revisions, make repeated apply idempotent, and suppress incoming apply writes from the local capture/outbox.
- Keep the workflow in Settings and label it `端末内のみ`; no file is sent over a network and this release does not claim cloud sync or automatic multi-device delivery.

## 0.37.0 — 2026-07-13

- Capture one deterministic household monthly-budget plan plus complete savings-goal, dashboard-preference, and versioned parser-profile records.
- Capture classification rules with sorted labels/tags and account groups with ordered members as parent aggregates, coalescing child replacements into the final pending state.
- Capture explicit card-to-bank settlement mappings without treating card statements, due dates, or payment links as detached configuration.
- Seed existing planning and configuration state after its household/account dependencies and prove all seven aggregate contracts by replaying them into a second production-schema database.
- Extend schema-34 restore validation across payload types, enum domains, household/account relations, deterministic arrays, processed-envelope equality, and delete tombstones.
- Keep source/import evidence, card-statement and payment graphs, investments, device-local folder state, incoming apply, conflict handling, and remote transport outside this release.

## 0.36.0 — 2026-07-13

- Capture a canonical transaction as one complete deterministic aggregate containing its full scope-aware header, ordered journal entries, sorted labels/tags, source references, and provider external keys.
- Coalesce intermediate same-transaction captures into the final pending state before creating one immutable envelope, avoiding header-only or one-sided journal replay states.
- Prove the aggregate contract by reconstructing a posted transaction in a second SQLite database and verifying balanced debit/credit totals plus unchanged metadata and references.
- Complete household, member, and account scalar payloads, add household capture and explicit account/transaction delete semantics, and preserve schema-32 capture lineage during migration.
- Strengthen schema-33 restore checks for canonical processed payloads, replay-candidate shape, journal types, line uniqueness, account household scope, and balance.
- Replace principal/envelope-first UI copy with household-friendly device-history language, preserve archived current bindings visibly, and add semantic member creation and archive confirmation.
- Keep source documents/blobs, incoming apply, conflict handling, and remote transport outside this release's explicit boundary.

## 0.35.0 — 2026-07-13

- Capture household-member, account, and canonical transaction writes in the same SQLite commit as each domain mutation.
- Drain durable captures in monotonic order into the existing canonical envelope and local outbox contract.
- Preserve capture-to-envelope lineage and validate household, entity, and envelope relations during schema 32 restore activation.
- Keep planning, import workflow, investment snapshots, documents, derived analytics, and all remote transport outside this milestone's explicit coverage.
- Continue to label the outbox as device-only; this release does not send or synchronize data.

## 0.34.0 — 2026-07-13

- Add stable local device origins and logical principals without treating either as a login or authorization identity.
- Add an explicit local-principal-to-household-member mapping in Family Space; never infer it from account ownership or display names.
- Add canonical schema-v1 change envelopes with per-device sequence, idempotent mutation IDs, deterministic IDs, canonical JSON payloads, SHA-256 digests, and a separate local outbox.
- Show device, principal, change-log, and restore-validation status in Settings with an explicit `端末内のみ` boundary.
- Validate sync-foundation relations during portable restore and clear only the active device-local context while preserving logical identity and origin history.
- Keep remote transport, cloud synchronization, login, conflict resolution, audience enforcement, and mobile capture outside this release.

## 0.33.0 — 2026-07-13

- Expand packaged-WebView smoke from Home-only evidence to all ten top-level workspaces, including Settings.
- Verify canonical navigation order, exact page heading, visible heading/main region, active navigation, rendered text, viewport, IPC, migrations, integrity, and persisted onboarding data.
- Preserve partial route evidence after every successful page so packaged failures identify the last verified workspace.
- Mirror independent canonical workspace expectations in JavaScript, Node, and Rust validators and extend the process timeout for slower packaged WebViews.

## 0.32.0 — 2026-07-13

- Promote the existing source-backed Action Center to Home with the three highest-priority actions and an exact total count.
- Apply one deterministic priority, due-date, and stable-ID order in both Home and the full Forecast workspace.
- Route every action kind through an exhaustive workspace map and open “view all” directly on Reports → Forecast & Actions.
- Query actions independently from dashboard metrics, retain the last valid same-scope snapshot on refresh failure, and provide explicit loading, retry, stale, empty, and browser-preview states.
- Use the selected month's final day as the visible action baseline and disclose that import review remains household-wide under account/member filters.
- Refresh Home actions after import, card, budget, and savings-goal mutations without creating a second alert model.

## 0.31.0 — 2026-07-13

- Require a destination account for every generic Japanese bank, PayPay, Rakuten Card, and Amazon Mastercard file before staging.
- Filter each per-file selector to the compatible canonical account type: bank asset, wallet asset, or credit-card liability.
- Remove household-ID defaults and issuer-name matching from import routing; filenames and account names are never treated as authoritative mappings.
- Keep selections independent across previews and discard them when the household changes or the corresponding preview leaves the Inbox.

## 0.30.0 — 2026-07-13

- Add a source-backed Home data-quality panel with latest successful import, canonical source filename/type, original-document and source-row totals, distinct source channels, review backlog, and failed-import count.
- Select freshness only from same-household source documents attached to `POSTED` import runs, with deterministic timestamp-and-ID tie-breaking and atomic TypeScript validation of nullable provenance.
- Link the quality summary directly to Import Inbox and avoid claiming complete account coverage when the available facts only establish import/source coverage.
- Disable no-op dashboard preference controls in browser preview and label their desktop-only persistence explicitly.
- Add semantic “increase” text to demo KPI trends and a screen-reader numeric table for the six-month trend chart.
- Capture and preserve a screenshot-grounded UX/accessibility audit of the Overview-to-Card flow; use its highest-impact findings to shape this release.

## 0.29.0 — 2026-07-13

- Add household-scoped set, correction, and explicit clearing of a credit-card statement's payment due date from the Cards workspace.
- Require a canonical real `YYYY-MM-DD` date on or after the statement period end; never infer the date from issuer names, transaction descriptions, or other statements.
- Add a direct due-date action to missing-date coverage warnings and label every displayed value as user-confirmed.
- Refresh statement cards, bank coverage, forecast, and Action Center data after a successful change while retaining the entered draft and showing a clear validation message after failure.
- Preserve statement amounts and lines, confirmed payment links, reconciliation status, source evidence, transactions, and balanced journal entries across date edits.

## 0.28.0 — 2026-07-13

- Add bounded manual ZIP upload and drop for official Yucho Direct bulk exports while leaving watched-folder ZIP behavior unchanged.
- Expand each distinct CSV payload into a normal import preview with deterministic ordering, `archive.zip › entry.csv` source provenance, explicit bank-account mapping, review, and explicit posting.
- Reject an archive atomically when it is malformed, split/multidisk, ZIP64, encrypted, path-bearing, directory-bearing, ambiguously named, inconsistently described, CRC-invalid, or uses an unsupported compression method.
- Bound archive processing to 25 MB compressed, 20 entries, 10 MB per entry, and 50 MB total expanded data; expanded CSV children also count against the existing 20-preview batch limit.
- Ignore non-CSV entries only after the archive passes validation and disclose them once in the preview rather than silently treating them as financial data.
- Collapse byte-identical CSV entries to one content-addressed preview with a visible canonical-name mapping, and reject unflagged non-ASCII legacy filenames instead of decoding Japanese names inconsistently.

## 0.27.0 — 2026-07-13

- Add a dedicated `yucho-direct-ledger-v1` adapter for the official Yucho Direct personal-account CSV, detected ahead of the generic Japanese bank format.
- Find the exact seven-column header after the account-information preamble, normalize full-width header punctuation, and parse official `YYYYMMDD` transaction dates.
- Map deposits, withdrawals, detail fields, and signed current/loan balances into the canonical bank candidate while requiring the user to select the destination account explicitly.
- Validate row width, real calendar dates, positive integer JPY amounts, mutually exclusive debit/credit columns, duplicate export sequences, signed balances, and oldest-first running-balance continuity.
- Keep `入出金明細ID` only in immutable raw provenance because Yucho defines it as a sequence assigned during CSV export, not a durable bank transaction identifier.
- Treat `カード` conservatively as an unknown bank event because it can represent an ATM cash-card transaction; never infer a credit-card settlement from that label.

## 0.26.0 — 2026-07-13

- Add a fifth persisted `CASH_FLOW` Home preset with cash-specific inflow, outflow, net-flow, and month-end asset labels.
- Add a dedicated six-month cash-flow trend derived from posted asset-account deltas under the same household, account-group, member-attribution, date, and calculation-target scopes as the headline totals.
- Count a credit-card purchase on the accrual timeline and its later bank settlement once on the cash timeline, including when purchase and settlement fall in different months.
- Keep the existing accrual trend and expense-category composition unchanged; the Cash Flow preset does not present either as cash movement or invent cash categories.
- Query Home KPIs, trend, and recent activity consistently in cash basis for the Cash Flow preset, refetch in accrual basis when leaving it, and prevent delayed responses from an old basis or household from replacing the active view.
- Preserve existing dashboard preferences while extending their constrained domain through a versioned SQLite migration and restore validation.

## 0.25.0 — 2026-07-13

- Add four household-scoped Home focus presets: Financial Overview, Household Ledger, Assets & Liabilities, and Card Reconciliation.
- Reorder and emphasize only existing, source-backed KPIs and widgets; changing a preset never changes accounting basis, ledger rows, dashboard queries, or card-settlement semantics.
- Add app-wide `System`, `Light`, and `Dark` appearance plus `Comfortable` and `Compact` density with responsive desktop layouts.
- Persist preferences in SQLite per household, return deterministic defaults without writing, and restore each household's independent selection when switching.
- Protect asynchronous preference loading and saving from stale household responses, and validate every enum, household relation, timestamp, IPC response, migration, and restored database state.

## 0.24.0 — 2026-07-13

- Add a durable, household-scoped Folder Inbox that persists metadata and processing state in SQLite without storing file bytes or absolute watched-folder paths in the queue.
- Reconcile native filesystem events, polling fallback, and manual scans idempotently by watched folder, relative path, and file generation; mark disappeared generations removed instead of silently forgetting them.
- Hydrate bounded preview batches from every application page, restore `READY` and `NEEDS_MAPPING` previews after restart without spending retry attempts, and expose an app-wide actionable badge.
- Require an explicit import start and review decision before posting; the queue becomes `STAGED` only after the canonical import run exists and never commits a transaction automatically.
- Recover stale leases, cap fresh parsing attempts, support retry/ignore controls, and permit a staged retry only after the linked canonical import run has been rolled back.
- Reject changed file metadata after reading, stale leases, cross-household links, malformed relative paths, invalid restore state, and contradictory queue-state metadata.

## 0.23.0 — 2026-07-13

- Reconcile one credit-card statement with multiple explicitly confirmed bank debits and show each payment leg once.
- Derive statement status and paid, outstanding, and overpaid totals strictly from confirmed links.
- Surface bounded same-card settlement candidates while requiring an explicit user confirmation for every link.
- Keep confirmation household-scoped, atomic, idempotent, immutable after confirmation, and limited to posted card-payment journals within 120 days after the statement period.
- Preserve card purchases as the expense facts and leave journals, source evidence, balances, budgets, and payment initiation untouched.
- Normalize legacy reconciliation state and validate cumulative links and derived status during restore.

## 0.22.0 — 2026-07-13

- Add seven controlled workflow labels and household-defined tags without changing accounting categories, journals, balances, budgets, or card reconciliation.
- Show sorted labels and tags on transaction rows and details, with exact label/tag filters in the persisted ledger query.
- Add explicit current-page and per-row selection plus atomic bulk add/remove for up to 200 posted transactions.
- Reject duplicate IDs, conflicting add/remove operations, invalid tags, non-posted rows, and cross-household batches without partial metadata changes.
- Keep bulk operations idempotent and report only transactions whose metadata actually changed.

## 0.21.0 — 2026-07-13

- Add receipt-match suggestions for offline OCR candidates against existing posted expenses and card purchases, requiring an exact expense amount and a transaction date within three days.
- Rank up to ten eligible suggestions by date proximity and explainable merchant-name similarity while showing the amount, date difference, similarity, and reasons in the Import Inbox.
- Require the user to select and confirm a suggested transaction; KakeFlow never links a receipt automatically.
- Attach every receipt source row to the selected transaction as supporting evidence and resolve the receipt candidate without creating another transaction or journal entry.
- Keep confirmation household-scoped, atomic, idempotent, and revalidated against the current posted transaction so stale, cross-household, or changed targets are rejected.
- Preserve the original posting, account balances, dashboard totals, and card reconciliation when evidence is linked, preventing the receipt and imported card/bank record from becoming duplicate expenses.

## 0.20.0 — 2026-07-13

- Add a dedicated adapter for Money Forward ME's documented ten-column household-ledger CSV export, including reordered columns, quoted fields, UTF-8/CP932 decoding, strict calendar dates, and signed integer JPY amounts.
- Preserve calculation-target, transfer, financial-institution, major/minor category, memo, external ID, and named source fields through immutable evidence, staging, review, and posting.
- Require one explicit KakeFlow Asset/Liability account for the exported institution and reject multi-institution files instead of silently assigning every row to one account.
- Force Money Forward transfers to remain calculation-excluded `TRANSFER` transactions and reject any transfer journal that touches income or expense accounts.
- Persist provider external IDs with a canonical source-fact hash, reuse identical overlapping-export rows as supporting evidence, and reject changed facts under the same ID atomically.
- Show Money Forward institution, taxonomy, source ID, calculation-target state, and transfer defaults in the Import Inbox review before ledger posting.

## 0.19.0 — 2026-07-13

- Add persisted, explicit credit-card-to-bank settlement mappings with strict same-household, active-account, and account-type validation; KakeFlow never infers a payment bank from transaction text.
- Project every dated outstanding statement cumulatively against the mapped bank's actual posted balance, including transactions excluded from household analytics, across multiple cards sharing one bank account.
- Respect the requested as-of date when counting confirmed card payments, include old overdue obligations, and cap the bounded projection query without silently truncating debts.
- Separate unmapped statements and statements missing a payment due date from the chronological projection so incomplete data remains visible instead of producing false confidence.
- Add covered, shortfall, and overdue states plus current, step-by-step projected, ending, and maximum-shortfall balances to the Cards workspace.
- Add household-wide Action Center warnings for bank-balance shortfalls, missing card-to-bank mappings, and missing statement due dates.
- Protect mappings with database triggers, restore validation, and account-archive checks while keeping the entire feature read-only with no payment initiation.

## 0.18.0 — 2026-07-13

- Add a persisted per-transaction calculation target with a legacy-safe included default and strict boolean storage.
- Keep excluded posted transactions visible in the ledger, journal, source evidence, actual account/net-worth balances, card statements, payments, and reconciliation while removing them from household analytical totals.
- Apply the calculation target consistently to dashboard income/expense/trends/categories, budget actuals, financial calendar and reports, recurring/anomaly/fixed-cost analysis, forecast history, and transaction-derived Action Center actuals.
- Add `ALL`, `INCLUDED`, and `EXCLUDED` ledger filters that compose with accounting basis, account-group scope, family attribution, search, date range, and pagination.
- Add visible `計算対象` / `集計対象外` badges and an editable `家計の集計に含める` control with an explicit no-balance-change disclosure.
- Allow a flag-only update on card-linked transactions while preserving every journal, statement, payment, and source relation; unrelated edits remain reconciliation-protected.
- Export both included and excluded transactions with an explicit `calculation_target` column instead of silently dropping source facts.

## 0.17.0 — 2026-07-13

- Add an Annual Household Review with equal-window year-over-year income, expense, savings, savings-rate, category, merchant, budget, reconciliation, and data-quality views.
- Mark all twelve calendar points as `COMPLETE`, `PARTIAL`, or `FUTURE`; exclude incomplete months from annual KPIs and compare a current year only with the same completed prior-year months.
- Add deterministic, scoped annual-review CSV generation and native save with UTF-8 BOM, explicit month status, source period, account group, and attribution scope.
- Add a dedicated `money-forward-me-asset-trend-v1` adapter for the officially documented Money Forward ME asset-history columns, including optional and reordered asset-class columns.
- Persist aggregate asset history by household/date with immutable source-document and source-row provenance, atomic 1–1,200 row imports, overlapping-export reuse, conflict rollback, and date-range queries.
- Display total-asset trend, latest change, and asset-class composition in Investments while explicitly keeping the external aggregate out of accounts, ledger, cash flow, and net-worth calculations.
- Allow zero-decision finalization only for non-transaction import runs with zero reviewable candidates, fixing completion of portfolio, brokerage, and aggregate-asset imports without weakening transaction review.

## 0.16.0 — 2026-07-13

- Add a dedicated fixed-cost review inside Reports, derived only from confirmed household expenses and card purchases.
- Compare the latest three complete months with the preceding three while excluding the partial current month and always returning an explicit six-month series.
- Detect weekly, biweekly, monthly, quarterly, and annual payment cadence over a bounded 36-month history, exclude stale series, and annualize each payee by its observed cadence.
- Classify housing, insurance, electricity, gas, water, internet, mobile, and subscription segments using category-first evidence while preventing short English keywords from matching inside unrelated words.
- Allow cadence-stable utilities to vary in amount with lower confidence; require stable amounts for generic recurring costs and disclose every reason in the drill-down.
- Apply the global account-group and household/member attribution scopes without double-counting split journal entries.
- Report source coverage and limitations explicitly and never invent a market-price comparison or potential-savings estimate.

## 0.15.0 — 2026-07-13

- Add explicit source terms for all-stock and mixed cash/stock mergers, including target and cash currencies, stock cost-basis allocation, and source-to-target/source-to-cash FX rates.
- Represent cross-currency security and cash legs by their actual currency, require each currency bucket to balance independently, and attribute brokerage cash movement to the cash leg's currency.
- Transform every matching FIFO source lot into target shares while preserving acquisition/source provenance; allocate cash proceeds pro rata by surrendered quantity and calculate realized P&L per lot.
- Convert stock and cash cost-basis portions only with explicit source-row rates; missing, unnecessary, non-finite, or out-of-range rates reject import or leave the performance action skipped without consuming source lots.
- Add `MERGER_STOCK` and `MERGER_CASH` audit allocations with source document/row, source basis/currency, conversion rate, output basis/currency, cash proceeds, and realized result.
- Extend Japanese/English brokerage aliases and investment reports for merger consideration while keeping non-cash stock allocations visually distinct from cash proceeds.

## 0.14.0 — 2026-07-13

- Add household-scoped, versioned CSV/TSV parser profiles with create, update, enable/disable, priority, and optimistic delete/update behavior.
- Map saved header rows to transaction date, description/payee, signed amount or separate debit/credit columns, external transaction ID, and an optional account hint.
- Support explicit UTF-8/UTF-8 BOM/CP932 decoding, comma/tab/semicolon detection, multiple date layouts, and configurable positive-value direction for one-column card or bank amounts.
- Preview real matched headers, candidates, excluded rows, encoding, delimiter, and row-level issues before starting an import; any error blocks staging rather than silently omitting rows.
- Preserve source-row/raw-field provenance and external transaction IDs, select an Asset/Liability target account explicitly, and keep every custom candidate in the existing review/approval workflow.
- Retain bounded bytes for unsupported CSV/TSV files so a saved profile can be applied locally without uploading or rereading the original file.

## 0.13.0 — 2026-07-13

- Add one persisted tagged attribution scope—whole household, household-common activity, or one member—to the desktop workspace.
- Apply attribution and account-group scopes together to transaction lists, dashboard activity metrics, financial calendar, monthly/yearly reports, recurring and anomaly analysis, forecasts, Action Center actuals, and transaction CSV export.
- Validate member scopes against the active household while preserving archived members for historical reporting and rejecting cross-household scope widening.
- Keep balance facts such as net worth, opening cash, investment valuation, portfolio export, goals, and import status household-wide, with explicit UI and forecast disclosures instead of misleading partial totals.
- Select card statements by linked transaction attribution when available, retain unlinked household obligations, and never allocate a full settlement amount to a member without evidence.
- Keep audience labels independent from analytical attribution and from authentication or access control.

## 0.12.0 — 2026-07-13

- Add explicit, independent household/member attribution and shared/personal audience tuples to transactions, import candidates, and source documents without deriving them from account ownership or account groups.
- Backfill existing records to household-attributed/shared and preserve archived-member references as historical facts while rejecting cross-household tuples.
- Carry attribution and audience through manual entry, import preview/posting, posted-transaction edits, transaction rows, details, and evidence projections.
- Add separate transaction controls and text badges for family attribution and local display classification; the assigned member and personal audience member may intentionally differ.
- Add a source-document audience editor that changes only the original document label and never cascades into linked transaction metadata.
- Validate scope tuples during restore and at the native IPC boundary, while keeping all existing analytics totals unchanged until a complete attribution-reporting contract is implemented.

## 0.11.0 — 2026-07-13

- Add stable household-member records with ordered active/archive lifecycle and an automatically created primary local member for existing and new households.
- Add a dedicated Family Space for member management and clearly state that personal classification is local organization, not authentication or access control.
- Classify accounts independently by household/member ownership and shared/personal visibility; member-owned shared accounts remain supported.
- Create accounts with ownership atomically and reject personal household accounts, foreign or archived owners, last-active-member archive, and archive of a member who still owns accounts.
- Preserve member and ownership data in the encrypted database/backup and validate cross-household ownership and active-member invariants during restore.
- Replace hard-coded person-like avatars with neutral initials derived from the active household name.

## 0.10.0 — 2026-07-13

- Add a saved account-scope selector to Overview, Transactions, and Reports, restore the selection per household, and reset it safely when the household changes or the group is deleted.
- Apply one canonical any-journal-entry membership rule to dashboard KPIs and trends, ledger pagination, financial calendar, monthly/yearly reports, recurring/anomaly analysis, forecasts, and account-derived Action Center items.
- Reject missing or cross-household groups instead of silently returning whole-household data; an omitted group preserves the previous all-account result.
- Keep household-level import and goal actions visible inside scoped reports because those records have no account association.
- Default CSV export to the active analytical scope and display the selected group beside scoped results.

## 0.9.0 — 2026-07-13

- Import Monex U.S. stock transaction-history CSV columns and preserve the source row, currency, ticker, and transaction semantics.
- Allocate spin-off cost basis from an explicit source-provided ratio, create rights-subscription lots from confirmed terms, and treat cash in lieu as an auditable FIFO disposal with realized P&L.
- Explain corporate-action allocations in the annual investment report down to the action and originating purchase source rows; incomplete terms are rejected instead of guessed.
- Unlock supported password-protected PDFs for the current extraction or page-render request, with explicit required, invalid, and unsupported-password states and no persisted password.
- Mount the produced macOS DMG read-only and validate its versioned app bundle, executable, resources, signature structure, and clean detach separately from the packaged-WebView smoke test.
- Harden packaged-app smoke cleanup so a timed-out child is terminated and reaped before temporary data is removed, and suppress macOS crash-history restoration prompts inside the isolated smoke process.

## 0.8.0 — 2026-07-13

- Add immutable dated investment market-price observations with provider, document, row, and observation provenance.
- Reuse prices from `assetbalance(all)_*.csv` snapshots and value FIFO holdings at the latest confirmed price on or before the selected date without using future or wrong-currency quotes.
- Add market value, unrealized P&L, missing-price disclosure, annual realized P&L, dividend, fee, tax, and source-row reports by currency.
- Render authenticated PDF source pages locally and place `PDF_POINTS` extraction regions over the actual page image.
- Normalize full-width Japanese receipt text, `令和`/`平成` dates, and additional electronic-money payment methods.
- Exercise onboarding and the resulting Home screen inside the real packaged WebView, verify the UI-created household in SQLCipher, and upload machine-readable interaction evidence from macOS and Windows CI.

## 0.7.0 — 2026-07-13

- Replace folder-only polling with recursive native filesystem notifications, burst debouncing, duplicate suppression, and a bounded polling fallback.
- Add split, reverse-split, and same-currency share-for-share merger events that preserve FIFO lot cost, acquisition date, and source provenance without creating artificial gains.
- Add immutable dated FX observations and JPY investment reporting with direct/inverse-rate provenance; missing rates fail visibly instead of producing partial or invented totals.
- Reuse provenance-bearing FX rates imported with securities portfolio snapshots.
- Display authenticated receipt images locally with interactive OCR bounding-box overlays, zoom, selection, and source-row drill-down.
- Expand Japanese receipt extraction for quantities, unit prices, subtotals, change, payment methods, and included/excluded tax modes.

## 0.6.0 — 2026-07-13

- Add a process-wide background folder discovery supervisor that detects created, modified, and removed supported files even when Import Inbox is closed.
- Emit debounced, household-scoped change events without exposing absolute paths or automatically posting financial data.
- Add FIFO investment cost basis, open lots, holdings, realized allocations, uncovered-sale warnings, and auditable source event/row lineage.
- Report realized P&L, dividends, fees, and taxes per currency without inventing FX conversion or combining currencies.
- Integrate background discovery status and investment performance into the desktop workspace.
- Add a packaged-app smoke harness that launches the real macOS/Windows bundle in isolated app data, validates the main window, WebView IPC, SQLCipher integrity, and migrations, then exits and cleans up.

## 0.5.0 — 2026-07-13

- Add a deterministic three-month household cash and savings forecast with visible assumptions, recurring costs, and known card payments.
- Add an Action Center for import failures/review, card mismatches and due payments, budget overruns, goal deadlines, anomalies, and recurring price changes.
- Add Japanese brokerage transaction ingestion and persistence for buys, sells, dividends, fees, taxes, deposits, and withdrawals without inflating household expenses.
- Add brokerage currency totals, cash movement, source-row idempotence, balanced investment legs, and transaction history in the investment workspace.
- Add page-aware PDF evidence and OCR word bounding boxes with confidence and provenance.
- Upgrade receipt evidence with item rows, Japanese 8%/10% taxes, coupons, points, and source line/region references.
- Add responsive forecast, action, and evidence viewers with desktop integration tests.
- Make Windows release builds select the compatible Strawberry Perl toolchain for vendored OpenSSL.

## 0.4.0 — 2026-07-13

- Add a 42-day financial calendar with accrual/cash views, no-spend days, card closing dates, payment due dates, and settlement events.
- Add monthly and yearly household reports with period comparisons, savings rate, budget/goal progress, spending drivers, reconciliation status, and data-quality context.
- Detect recurring payments and subscriptions, predict the next occurrence, and explain price changes from confirmed household history.
- Detect unusual expenses using robust household/payee baselines without sending financial data to an external model.
- Add reusable ordered account groups for family, personal, daily-spending, investment, business, tax, education, and custom scopes.
- Export confirmed transaction ledgers and portfolio snapshots as scoped, date-bounded UTF-8 BOM CSV files.
- Add strict native IPC validation, a new account-group migration, responsive report views, and desktop integration tests.

## 0.3.0 — 2026-07-13

- Parse and persist Japanese securities `assetbalance(all)_*.csv` snapshots separately from household transactions.
- Add investment asset allocation, positions, market value, cash, P&L, FX-rate, and snapshot-history views.
- Automatically discover and preview changed files in registered sync folders every 60 seconds.
- Add immutable source-record drill-down from transaction evidence.
- Add persisted, prioritized classification rules for merchant/description matching, categories, labels, and tags.
- Add safe rule preview/application with optimistic concurrency.
- Expand native schema migrations and platform validation for the new modules.

## 0.2.0 — 2026-07-12

- First runnable local-first desktop MVP for macOS and Windows.
- Added ledger dashboards, manual and file imports, budgets, goals, source provenance, backup/restore, and credit-card reconciliation.
