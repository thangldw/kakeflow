# Local change packages

Local change packages are passphrase-protected, user-moved current-state snapshots for confirmed household aggregates. They are not cloud synchronization.

Schema evolution:

- V1: household, members, accounts, transactions, and planning/configuration.
- V2: card statements and confirmed payment relationships.
- V3: portfolio, brokerage, investment FX/market prices, and aggregate asset history with evidence aliases.
- V4: complete dashboard layouts.
- V5: complete explicit recurring-series preferences.

Selecting a package only stages review. New/unchanged entities can be prepared, while differing same-ID facts and omission deletes require explicit whole-aggregate choices. Households/members are never omission-deleted and no field-level merge occurs.

Before Apply, destination state and evidence dependencies are re-read. Accepted upserts/deletes execute in dependency order within one transaction, write receipt/head lineage, and suppress incoming-write echo. Stale or inconsistent graphs roll back completely; exact reapply is idempotent.

Older schemas cannot delete or reset aggregates they do not contain. Evidence capsule hydration precedes investment package apply. File transport through external storage remains an explicit user action.
