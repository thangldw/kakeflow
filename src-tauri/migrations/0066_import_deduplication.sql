CREATE TABLE import_source_coverage (
    import_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    adapter_id TEXT,
    adapter_version TEXT,
    min_effective_date TEXT NOT NULL CHECK (min_effective_date GLOB '????-??-??'),
    max_effective_date TEXT NOT NULL CHECK (max_effective_date GLOB '????-??-??'),
    confirmed_replay_count INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_replay_count >= 0),
    CHECK (min_effective_date <= max_effective_date),
    PRIMARY KEY (import_run_id, account_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_import_source_coverage_overlap
    ON import_source_coverage (household_id, account_id, min_effective_date, max_effective_date);

CREATE TABLE import_duplicate_reviews (
    candidate_id TEXT PRIMARY KEY REFERENCES transaction_candidates(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    candidate_fingerprint TEXT NOT NULL CHECK (length(candidate_fingerprint) = 64 AND candidate_fingerprint NOT GLOB '*[^0-9a-f]*'),
    matched_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    matched_candidate_id TEXT REFERENCES transaction_candidates(id) ON DELETE SET NULL,
    confidence TEXT NOT NULL CHECK (confidence IN ('LIKELY', 'POSSIBLE')),
    reason_codes_json TEXT NOT NULL CHECK (json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array'),
    decision TEXT NOT NULL DEFAULT 'UNRESOLVED' CHECK (decision IN ('UNRESOLVED', 'LINK', 'KEEP_BOTH', 'EXCLUDE')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    decided_at TEXT,
    CHECK ((matched_transaction_id IS NOT NULL) != (matched_candidate_id IS NOT NULL)),
    CHECK (decision != 'LINK' OR matched_transaction_id IS NOT NULL)
) STRICT;

CREATE INDEX idx_import_duplicate_reviews_household_decision
    ON import_duplicate_reviews (household_id, decision, confidence);
CREATE INDEX idx_import_duplicate_reviews_matched_candidate
    ON import_duplicate_reviews (matched_candidate_id) WHERE matched_candidate_id IS NOT NULL;

CREATE TABLE import_keep_both_exceptions (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    candidate_fingerprint TEXT NOT NULL CHECK (length(candidate_fingerprint) = 64 AND candidate_fingerprint NOT GLOB '*[^0-9a-f]*'),
    matched_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (household_id, candidate_fingerprint, matched_transaction_id)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER trg_import_duplicate_review_scope_insert
BEFORE INSERT ON import_duplicate_reviews
WHEN NOT EXISTS (
  SELECT 1 FROM transaction_candidates c
  WHERE c.id=NEW.candidate_id AND c.household_id=NEW.household_id
)
OR (NEW.matched_transaction_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM transactions t
  WHERE t.id=NEW.matched_transaction_id AND t.household_id=NEW.household_id AND t.status='POSTED'
))
OR (NEW.matched_candidate_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM transaction_candidates c
  WHERE c.id=NEW.matched_candidate_id AND c.household_id=NEW.household_id
))
BEGIN
  SELECT RAISE(ABORT, 'duplicate review outside household');
END;

CREATE TRIGGER trg_import_duplicate_review_scope_update
BEFORE UPDATE OF matched_transaction_id, matched_candidate_id, household_id ON import_duplicate_reviews
WHEN NOT EXISTS (
  SELECT 1 FROM transaction_candidates c
  WHERE c.id=NEW.candidate_id AND c.household_id=NEW.household_id
)
OR (NEW.matched_transaction_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM transactions t
  WHERE t.id=NEW.matched_transaction_id AND t.household_id=NEW.household_id AND t.status='POSTED'
))
OR (NEW.matched_candidate_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM transaction_candidates c
  WHERE c.id=NEW.matched_candidate_id AND c.household_id=NEW.household_id
))
BEGIN
  SELECT RAISE(ABORT, 'duplicate review outside household');
END;
