-- A journal of big decisions (a purchase, a move, a subscription): what was decided and why, what was expected,
-- and when to look back. The outcome is written later, at review time. Device-local, like payment reminders:
-- not captured for sync, and never touches the ledger.

CREATE TABLE decision_journal (
    id TEXT PRIMARY KEY NOT NULL
        CHECK (length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    decided_on TEXT NOT NULL CHECK (decided_on GLOB '????-??-??'),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    amount_jpy INTEGER
        CHECK (amount_jpy IS NULL OR (typeof(amount_jpy) = 'integer' AND amount_jpy BETWEEN 0 AND 100000000000)),
    reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
    expectation TEXT NOT NULL DEFAULT '' CHECK (length(expectation) <= 1000),
    review_on TEXT NOT NULL CHECK (review_on GLOB '????-??-??'),
    outcome TEXT CHECK (outcome IS NULL OR length(trim(outcome)) BETWEEN 1 AND 1000),
    reviewed_at TEXT CHECK (reviewed_at IS NULL OR reviewed_at GLOB '????-??-??T??:??:??*Z'),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK ((outcome IS NULL) = (reviewed_at IS NULL))
) STRICT;

CREATE INDEX idx_decision_journal_household_review
    ON decision_journal (household_id, reviewed_at, review_on);
