-- Device-local audit of the user's decisions about own-account transfer pairs.
-- The current state of a pair is its newest row (highest rowid): REJECTED hides
-- the pair from proposals, LINKED records that both legs were retyped as a
-- transfer (with their previous values so the link can be undone), CLEARED
-- returns the pair to the proposable state. Rows are append-only. The table is
-- intentionally NOT captured for sync or family delivery: the retyped
-- transactions replicate through the ledger, the decision log does not.

CREATE TABLE transfer_pair_decisions (
    id TEXT PRIMARY KEY NOT NULL
        CHECK (length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'),
    household_id TEXT NOT NULL
        CHECK (length(trim(household_id)) BETWEEN 1 AND 128),
    out_transaction_id TEXT NOT NULL
        CHECK (length(trim(out_transaction_id)) BETWEEN 1 AND 128),
    in_transaction_id TEXT NOT NULL
        CHECK (length(trim(in_transaction_id)) BETWEEN 1 AND 128),
    pair_key TEXT NOT NULL
        CHECK (length(pair_key) BETWEEN 3 AND 257),
    decision TEXT NOT NULL
        CHECK (decision IN ('REJECTED','LINKED','CLEARED')),
    previous_out_type TEXT,
    previous_out_calculation_target INTEGER
        CHECK (previous_out_calculation_target IS NULL OR previous_out_calculation_target IN (0,1)),
    previous_in_type TEXT,
    previous_in_calculation_target INTEGER
        CHECK (previous_in_calculation_target IS NULL OR previous_in_calculation_target IN (0,1)),
    decided_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        CHECK (decided_at GLOB '????-??-??T??:??:??*Z'),
    CHECK (out_transaction_id <> in_transaction_id),
    CHECK (decision <> 'LINKED' OR (
        previous_out_type IS NOT NULL AND previous_out_calculation_target IS NOT NULL
        AND previous_in_type IS NOT NULL AND previous_in_calculation_target IS NOT NULL))
) STRICT;

CREATE INDEX idx_transfer_pair_decisions_household_pair
    ON transfer_pair_decisions(household_id, pair_key);

CREATE TRIGGER transfer_pair_decisions_immutable_update
BEFORE UPDATE ON transfer_pair_decisions
BEGIN
    SELECT RAISE(ABORT, 'transfer pair decision audit is immutable');
END;

CREATE TRIGGER transfer_pair_decisions_immutable_delete
BEFORE DELETE ON transfer_pair_decisions
BEGIN
    SELECT RAISE(ABORT, 'transfer pair decision audit is immutable');
END;
