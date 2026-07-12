CREATE TABLE transaction_candidates (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
    occurred_on TEXT NOT NULL CHECK (occurred_on GLOB '????-??-??'),
    posted_on TEXT CHECK (posted_on IS NULL OR posted_on GLOB '????-??-??'),
    amount_jpy INTEGER NOT NULL CHECK (typeof(amount_jpy) = 'integer' AND amount_jpy >= 0),
    direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
    description_raw TEXT,
    merchant_raw TEXT,
    external_transaction_id TEXT,
    extraction_confidence_bps INTEGER CHECK (
        extraction_confidence_bps IS NULL OR extraction_confidence_bps BETWEEN 0 AND 10000
    ),
    normalization_confidence_bps INTEGER CHECK (
        normalization_confidence_bps IS NULL OR normalization_confidence_bps BETWEEN 0 AND 10000
    ),
    review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (review_status IN (
        'PENDING', 'READY', 'DUPLICATE', 'EXCLUDED', 'POSTED'
    )),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- A normalized business event may be assembled from multiple source rows, and a
-- source row may support multiple candidate legs (for example split PayPay funding).
CREATE TABLE candidate_sources (
    candidate_id TEXT NOT NULL REFERENCES transaction_candidates(id) ON DELETE CASCADE,
    source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
    evidence_role TEXT NOT NULL DEFAULT 'PRIMARY' CHECK (evidence_role IN (
        'PRIMARY', 'FUNDING_LEG', 'REWARD_LEG', 'CONTINUATION', 'SUPPORTING'
    )),
    PRIMARY KEY (candidate_id, source_record_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_candidates_household_review
    ON transaction_candidates (household_id, review_status, occurred_on DESC);
CREATE INDEX idx_candidates_account_date_amount
    ON transaction_candidates (account_id, occurred_on, amount_jpy);
CREATE INDEX idx_candidates_external_id
    ON transaction_candidates (external_transaction_id)
    WHERE external_transaction_id IS NOT NULL;
CREATE INDEX idx_candidate_sources_record
    ON candidate_sources (source_record_id);
