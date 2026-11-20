-- A list of things bought with a warranty: what it is, when it was bought, how long the warranty runs, and the
-- computed last day. Device-local, like payment reminders: not captured for sync, and never touches the ledger.

CREATE TABLE warranties (
    id TEXT PRIMARY KEY NOT NULL
        CHECK (length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    item TEXT NOT NULL CHECK (length(trim(item)) BETWEEN 1 AND 120),
    store TEXT NOT NULL DEFAULT '' CHECK (length(store) <= 120),
    purchased_on TEXT NOT NULL CHECK (purchased_on GLOB '????-??-??'),
    warranty_months INTEGER NOT NULL
        CHECK (typeof(warranty_months) = 'integer' AND warranty_months BETWEEN 1 AND 120),
    expires_on TEXT NOT NULL CHECK (expires_on GLOB '????-??-??'),
    amount_jpy INTEGER
        CHECK (amount_jpy IS NULL OR (typeof(amount_jpy) = 'integer' AND amount_jpy BETWEEN 0 AND 100000000000)),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_warranties_household_expiry ON warranties (household_id, expires_on);
