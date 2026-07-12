ALTER TABLE transaction_candidates ADD COLUMN external_source TEXT
    CHECK (external_source IS NULL OR external_source = 'MONEY_FORWARD_ME');
ALTER TABLE transaction_candidates ADD COLUMN external_fact_hash TEXT
    CHECK (external_fact_hash IS NULL OR (length(external_fact_hash) = 64 AND external_fact_hash NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE transaction_candidates ADD COLUMN calculation_target INTEGER NOT NULL DEFAULT 1
    CHECK (calculation_target IN (0, 1));
ALTER TABLE transaction_candidates ADD COLUMN suggested_transaction_type TEXT
    CHECK (suggested_transaction_type IS NULL OR suggested_transaction_type = 'TRANSFER');
ALTER TABLE transaction_candidates ADD COLUMN institution_raw TEXT;
ALTER TABLE transaction_candidates ADD COLUMN category_major_raw TEXT;
ALTER TABLE transaction_candidates ADD COLUMN category_minor_raw TEXT;
ALTER TABLE transaction_candidates ADD COLUMN memo_raw TEXT;

CREATE TABLE transaction_external_keys (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    external_source TEXT NOT NULL CHECK (external_source = 'MONEY_FORWARD_ME'),
    external_id TEXT NOT NULL,
    fact_hash TEXT NOT NULL CHECK (length(fact_hash) = 64 AND fact_hash NOT GLOB '*[^0-9a-f]*'),
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (household_id, external_source, external_id),
    UNIQUE (transaction_id, external_source, external_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_transaction_external_keys_transaction ON transaction_external_keys (transaction_id);

CREATE TRIGGER trg_money_forward_candidate_insert
BEFORE INSERT ON transaction_candidates
WHEN (NEW.external_source IS NULL AND NEW.external_fact_hash IS NOT NULL)
  OR (NEW.external_source IS NOT NULL AND (NEW.external_transaction_id IS NULL OR NEW.external_fact_hash IS NULL))
  OR (NEW.suggested_transaction_type = 'TRANSFER' AND NEW.calculation_target != 0)
BEGIN
  SELECT RAISE(ABORT, 'invalid imported external semantics');
END;

CREATE TRIGGER trg_money_forward_candidate_update
BEFORE UPDATE OF external_source, external_transaction_id, external_fact_hash, calculation_target, suggested_transaction_type ON transaction_candidates
WHEN (NEW.external_source IS NULL AND NEW.external_fact_hash IS NOT NULL)
  OR (NEW.external_source IS NOT NULL AND (NEW.external_transaction_id IS NULL OR NEW.external_fact_hash IS NULL))
  OR (NEW.suggested_transaction_type = 'TRANSFER' AND NEW.calculation_target != 0)
BEGIN
  SELECT RAISE(ABORT, 'invalid imported external semantics');
END;

CREATE TRIGGER trg_transaction_external_key_scope_insert
BEFORE INSERT ON transaction_external_keys
WHEN NOT EXISTS (
  SELECT 1 FROM transactions t
  WHERE t.id=NEW.transaction_id AND t.household_id=NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'external transaction key outside household');
END;

CREATE TRIGGER trg_transaction_external_key_scope_update
BEFORE UPDATE ON transaction_external_keys
WHEN NOT EXISTS (
  SELECT 1 FROM transactions t
  WHERE t.id=NEW.transaction_id AND t.household_id=NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'external transaction key outside household');
END;
