# Pending import recovery

Manual, receipt, connector, and folder imports already staged as `REVIEW_REQUIRED` remain available after application or workspace restart.

## Discovery

`pending_review_list` is household-scoped and returns safe run/document IDs, adapter/version, timestamps, source metadata, counts, and completion state. It excludes posted, failed, and rolled-back runs; returns an error above 200 items; and never exposes vault paths, source payloads, SHA-256, or audience data.

Completion states:

- `CANDIDATE_REVIEW`: candidates still need decisions.
- `SOURCE_READY`: domain facts exist and the zero-candidate run can be finalized.
- `SOURCE_RESUME_REQUIRED`: specialized facts were not saved; roll back and re-import.

The UI reloads the existing native preview and never reparses bytes during recovery.

## Behavior

Recovered items are labeled `RECOVERED` and retain normal mapping, evidence, approval, commit, and rollback. Recovery selects, classifies, reconciles, and posts nothing automatically.

Views deduplicate by `runId`, so manual and folder discovery cannot show the same run twice. Partial preview failures are disclosed without hiding successful recoveries. Household changes cancel stale async results and clear prior-household state.

Cross-device movement uses [Pending import handoff](PENDING_IMPORT_HANDOFF.md); recovery itself is same-device only.
