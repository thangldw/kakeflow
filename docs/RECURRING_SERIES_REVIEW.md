# Recurring series review

KakeFlow derives recurring series from confirmed household-ledger history and
lets the user review whether each detected payee should participate in recurring
analytics. This review changes an analytical preference only. It never edits a
transaction, journal entry, source document, category, label, tag, cadence, or
amount.

## Series identity

A preference is identified by the pair:

```text
household ID + normalized payee
```

The normalized payee is the detector's canonical identity, not the current
display spelling. Normalization trims and lowercases text, replaces each run of
ASCII digits with `#`, retains alphanumeric characters, and collapses other
separators to one space. Consequently display variants that normalize to the
same value share one household preference.

The preference is household-wide. Selecting an account group or member scope
does not create another decision for the same normalized payee. Those scopes
still control which ledger observations are analyzed; they do not redefine the
series identity.

## Review states

| State | Meaning | Analytical effect |
| --- | --- | --- |
| `AUTO_DETECTED` | The detector currently finds a stable pattern and no explicit preference row exists. | Included under the existing detector confidence and coverage rules. |
| `CONFIRMED` | The user explicitly confirmed the detected normalized payee. | Included; cadence, amount, dates, and confidence remain detector-derived. |
| `IGNORED` | The user explicitly excluded the detected normalized payee from recurring consumers. | Remains visible in review, but is excluded from forecast, recurring Action Center items, and fixed-cost review. |

`AUTO_DETECTED` is a derived default, not a stored approval. The local database
stores only an explicit `CONFIRMED` or `IGNORED` decision together with its
integer version. Restoring either explicit state deletes that preference and
returns the series to the derived `AUTO_DETECTED` state.

An ignored series is not hidden from the recurring review while the detector
still observes it. The UI retains its detected cadence, typical amount,
confidence, last-seen date, and reasons with an `IGNORED` status so the decision
can be understood and restored. If the detector no longer finds a stable
pattern, the preference does not invent a synthetic series or stale cadence;
the stored decision applies again if that normalized payee is detected later.

## Optimistic writes

Every write is scoped to the exact household and normalized payee. The client
submits the state and version it reviewed:

- `AUTO_DETECTED -> CONFIRMED` or `AUTO_DETECTED -> IGNORED` inserts version 1
  only when no preference already exists;
- `CONFIRMED <-> IGNORED` updates only the exact expected version and increments
  it; and
- Restore deletes only the exact expected version, revealing
  `AUTO_DETECTED` again.

A missing, duplicate, stale, cross-household, invalid-state, or invalid-version
write fails without changing the existing preference. The UI keeps the series
visible, reports the failed update, and requires a retry after the current state
has been reloaded rather than overwriting a newer decision.

## Consumer boundary

`AUTO_DETECTED` and `CONFIRMED` series remain eligible for the existing
explainable consumers. An `IGNORED` series is filtered by normalized payee from:

- recurring expense assumptions in the three-month cash/savings forecast;
- recurring-price-change items in the Home Action Center; and
- fixed-cost review rows, segment totals, annualized totals, and recurring
  coverage counts.

The ignored decision does not exclude the underlying posted transactions from
ordinary expense totals, budgets, calendar, transaction search, category or
merchant reports, account balances, or source evidence. It also does not turn a
transaction's calculation target off. Only the recurring analytical projection
changes.

Confirmation is not a manual financial assumption. It does not force a series
to remain recurring when current evidence no longer satisfies the detector, and
it does not raise confidence or override stale-series rules.

## No manual cadence or amount

This slice has no form or persistence field for cadence, expected date, typical
amount, latest amount, annualized amount, confidence, or price-change rate. Each
is recomputed from eligible confirmed ledger observations using the existing
bounded detector. A user can confirm, ignore, or restore the series only.

## Portability boundary

Schema-v5 [local change packages](LOCAL_CHANGE_PACKAGES.md) can carry the
complete explicit preference set as one required household aggregate. The user
must export or send, stage, review, and explicitly Apply that package; no
preference moves merely because another installation exists. Schema-v1 through
schema-v4 packages do not cover this aggregate and cannot clear local recurring
decisions.

Only the normalized payee and `CONFIRMED`/`IGNORED` decision are transported.
The optimistic integer version and local timestamps are not portable facts.
After Apply, the receiving installation owns fresh local concurrency tokens,
while a transported empty preference list returns every local series to the
derived `AUTO_DETECTED` state.

This local-package path remains separate from audience-partitioned family
delivery. Recurring preferences are not added to `SHARED` or
`PERSONAL(member)` family artifacts in this slice. The optional same-principal
desktop relay may transport a local package through its existing explicit
review boundary, but it does not convert that package into family replication.

This capability adds no server, provider call, remote identity, access-control,
or background synchronization claim.
