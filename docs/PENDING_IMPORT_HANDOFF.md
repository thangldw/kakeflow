# Pending import handoff

KakeFlow can move one unconfirmed, candidate-bearing Import Inbox review between desktop installations using a local `.kakeflow-review` file. The handoff is deliberately separate from confirmed evidence capsules and local change packages: it carries mutable review inputs, not approved ledger facts.

## Scope and boundary

The source run must still be `REVIEW_REQUIRED` with at least one transaction candidate. Receipt-only imports, portfolio snapshots, brokerage imports, Money Forward aggregate asset history, completed imports, and source-only workflows are rejected.

Export copies the review. It does not pause, delete, approve, or otherwise change the source run. Applying a package on the destination creates a normal `REVIEW_REQUIRED` run. Candidate decisions and approval state are not transported, and no transaction or journal entry is posted automatically.

```text
Source Import Inbox review
  -> passphrase-protected local file
  -> verify source bytes and immutable review graph
  -> explicitly map every account and member
  -> destination Import Inbox review
  -> normal user approval and posting boundary
```

KakeFlow does not upload, sync, email, or remotely transport this file. The user chooses the save location and the destination file with native desktop dialogs.

## Portable graph

Schema v1 contains exactly one source document and its original bytes, immutable source rows, normalized candidates, candidate-to-row evidence edges, staged card statements and statement lines, plus descriptors for every referenced account and family member.

It excludes:

- candidate approvals and posting drafts;
- generated destination transaction or journal identifiers;
- confirmed ledger facts and receipt-only evidence;
- investment snapshots, positions, brokerage events, prices, FX marts, and derived analytics.

The manifest and source object are authenticated by the passphrase-protected archive. Import enforces bounded source, manifest, row, candidate, and statement counts before the graph can reach the live database.

## Explicit destination mapping

The destination never matches an account or member by display name. Every referenced account must be mapped to an active account in the selected household with the same account kind, subtype, and currency. Every referenced member must be mapped to an active member in that household.

The mapping is applied to source audience, candidate audience, candidate attribution, candidate accounts, and staged card accounts before the import transaction begins. Missing or incompatible mappings block apply.

## Idempotency and conflict behavior

An immutable receipt records the origin installation, portable run, manifest digest, and generated local identifiers. Applying the exact package again reopens the existing local review instead of creating another copy. Reusing an origin/run identity with different content is rejected as equivocation.

If the same source digest already belongs to another local pending run, apply reports a conflict. If it belongs to a posted, rolled-back, or failed import, apply reports a terminal collision. Database writes are atomic; a newly written vault object is removed when the database transaction fails.

## Relationship to other portable formats

| Format | Data boundary | Destination effect |
| --- | --- | --- |
| `.kakeflow-review` | One unconfirmed candidate review | Creates or reopens `REVIEW_REQUIRED`; never posts |
| `.kakeflow-evidence` | Confirmed immutable source evidence | Hydrates source bytes/rows behind confirmed facts |
| Local change package | Confirmed household aggregate state | Explicit conflict review, then atomic aggregate apply |

Optional remote transport, authenticated remote-principal mapping, backend-derived audience enforcement, and mobile receipt capture remain separate roadmap work.
