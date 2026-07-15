# SBI Securities import-flow audit

## Audit scope

This combined UX/accessibility audit covers the browser-visible entry into Import Inbox and the Inbox landing state used before a desktop file is parsed. The user goal is to import an SBI Securities trade-history CSV into the correct securities account without posting or guessing an account automatically.

## Step 1 — Home entry (healthy)

![Home entry](01-home-entry.jpg)

The primary `ファイルを取り込む` action and the persistent `インポート` navigation item make the workflow easy to discover. The browser-preview disclosure is visible before the user starts and avoids implying that browser-only sample data will be saved. The selected navigation item has a clear visible focus/selection treatment.

## Step 2 — Import Inbox landing state (healthy with one important requirement)

![Import Inbox](02-import-inbox.jpg)

The screen states the review-before-ledger model, exposes accepted file families at both the button and drop target, and separates imported, review-pending, failed, and source-row counts. Recent files show provider, record count, and workflow state without presenting pending candidates as confirmed transactions.

The destination securities account is not visible in this landing state. For SBI Securities files, the file preview must therefore require an explicit compatible `ASSET / SECURITIES` account selection before staging. A filename, merchant string, or the first available securities account is not enough evidence for account ownership.

## Highest-impact implementation decisions

1. Keep SBI recognition provider-specific and conservative; unsupported margin or derivative labels should be review-blocking issues rather than coerced spot trades.
2. Require a destination securities account for each SBI preview, especially when a household has multiple brokerage accounts.
3. Preserve immutable row provenance and show reconciliation warnings before the existing explicit review step; importing the file must never auto-post investment facts.

## Accessibility observations and evidence limits

The captured states expose labeled navigation, file controls, month input, headings, and status text in the accessibility tree. Selected navigation is not conveyed by color alone. Screenshot evidence cannot verify full keyboard order, file-picker behavior, screen-reader announcements after parsing, or contrast ratios. The browser preview also cannot exercise the native account selector or OS file dialog, so those behaviors remain covered by component/integration and packaged-app tests rather than this visual audit.
