-- User-confirmed payment reminders (a bill's deadline, optionally with its amount), usually suggested from the
-- text of a scanned bill. Device-local: reminders are NOT captured for sync or family delivery, so each device
-- keeps its own list. They never touch the ledger; paying the bill is a normal transaction.

CREATE TABLE payment_reminders (
    id TEXT PRIMARY KEY NOT NULL
        CHECK (length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    due_on TEXT NOT NULL CHECK (due_on GLOB '????-??-??'),
    label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 200),
    amount_jpy INTEGER
        CHECK (amount_jpy IS NULL OR (typeof(amount_jpy) = 'integer' AND amount_jpy BETWEEN 0 AND 100000000000)),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    done_at TEXT CHECK (done_at IS NULL OR done_at GLOB '????-??-??T??:??:??*Z'),
    CHECK ((status = 'DONE') = (done_at IS NOT NULL))
) STRICT;

CREATE INDEX idx_payment_reminders_household_due
    ON payment_reminders (household_id, status, due_on);
