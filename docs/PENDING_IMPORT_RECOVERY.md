# Pending import recovery

KakeFlow 0.47 makes the review boundary durable. A manual upload, receipt extraction, or watched-folder file already staged as `REVIEW_REQUIRED` remains available in Import Inbox after the application or workspace restarts.

## Native discovery contract

`pending_review_list` is scoped to one existing household and returns only `REVIEW_REQUIRED` runs. Each run contains its run/document identifiers, adapter/version, start timestamp, safe source type/name/media metadata, optional source modification time, record/candidate counts, and a completion state.

The query:

- sorts by start time descending and run ID ascending;
- requires exactly one source document for every recoverable run;
- never returns SHA-256 values, vault/storage paths, raw source payloads, or audience data;
- returns an error above 200 pending runs rather than silently truncating the Inbox;
- excludes posted, failed, and rolled-back runs.

Completion states distinguish ordinary candidate review from zero-candidate source workflows:

- `CANDIDATE_REVIEW`: each ledger candidate still requires an explicit decision;
- `SOURCE_READY`: the source has no ledger candidates and any adapter-specific investment facts are already present, so the user may explicitly finalize it;
- `SOURCE_RESUME_REQUIRED`: a portfolio, brokerage, or aggregate-asset import stopped before its domain facts were saved. KakeFlow does not mark it complete; the user can safely roll it back and re-import the original file.

The UI then obtains each existing preview through the same native preview command used immediately after staging. It does not parse or recreate source data during recovery.

## Review behavior

Recovered reviews are marked `RECOVERED` and disclose that they were restored after restart. They retain the same candidate, account, evidence, and explicit approval workflow as a newly staged import. No candidate is selected, approved, classified, reconciled, or posted merely because it was recovered.

Manual and watched-folder discovery can point to the same canonical run. Import Inbox keys deduplication by `runId`, so that review appears once. A successful commit or rollback removes it locally and refreshes native discovery. Receipt evidence linked to an existing transaction refreshes or removes the review without creating a duplicate expense.

If discovery fails, the current same-household recovered list remains visible and an explicit retry is shown. If one preview fails, other successful previews are still restored and the partial failure is disclosed. Household changes cancel stale asynchronous results and clear the previous household's review state.

## Boundary

This release restores reviews on the same device and database. It does not transport mutable candidates to another device. Cross-device pending-import handoff remains a separate versioned format because confirmed evidence capsules and local change packages intentionally contain confirmed facts, not mutable Inbox decisions.
