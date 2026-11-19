-- Adds MERGED to the transfer pair decision log and a snapshot column so a merge
-- can be undone exactly. SQLite cannot alter a CHECK constraint, so the table is
-- rebuilt with its rows copied in rowid order (rowid order is the history order).
-- The log stays append-only and device-local (no sync capture).

CREATE TABLE transfer_pair_decisions_v2 (
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
        CHECK (decision IN ('REJECTED','LINKED','MERGED','CLEARED')),
    previous_out_type TEXT,
    previous_out_calculation_target INTEGER
        CHECK (previous_out_calculation_target IS NULL OR previous_out_calculation_target IN (0,1)),
    previous_in_type TEXT,
    previous_in_calculation_target INTEGER
        CHECK (previous_in_calculation_target IS NULL OR previous_in_calculation_target IN (0,1)),
    decided_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        CHECK (decided_at GLOB '????-??-??T??:??:??*Z'),
    snapshot_json TEXT
        CHECK (snapshot_json IS NULL OR (json_valid(snapshot_json) AND length(snapshot_json) <= 100000)),
    CHECK (out_transaction_id <> in_transaction_id),
    CHECK (decision <> 'LINKED' OR (
        previous_out_type IS NOT NULL AND previous_out_calculation_target IS NOT NULL
        AND previous_in_type IS NOT NULL AND previous_in_calculation_target IS NOT NULL)),
    CHECK (decision <> 'MERGED' OR snapshot_json IS NOT NULL)
) STRICT;

INSERT INTO transfer_pair_decisions_v2(
    id, household_id, out_transaction_id, in_transaction_id, pair_key, decision,
    previous_out_type, previous_out_calculation_target,
    previous_in_type, previous_in_calculation_target, decided_at, snapshot_json)
SELECT id, household_id, out_transaction_id, in_transaction_id, pair_key, decision,
       previous_out_type, previous_out_calculation_target,
       previous_in_type, previous_in_calculation_target, decided_at, NULL
FROM transfer_pair_decisions ORDER BY rowid;

DROP TABLE transfer_pair_decisions;
ALTER TABLE transfer_pair_decisions_v2 RENAME TO transfer_pair_decisions;

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
