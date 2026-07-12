ALTER TABLE card_statements ADD COLUMN source_document_id TEXT
    REFERENCES source_documents(id) ON DELETE RESTRICT;

INSERT OR IGNORE INTO accounts (id, household_id, name, account_kind, account_subtype)
SELECT id || '-rakuten-card', id, 'Rakuten Card', 'LIABILITY', 'CREDIT_CARD' FROM households;
INSERT OR IGNORE INTO accounts (id, household_id, name, account_kind, account_subtype)
SELECT id || '-amazon-card', id, 'Amazon Mastercard', 'LIABILITY', 'CREDIT_CARD' FROM households;

CREATE UNIQUE INDEX idx_card_statements_source_document
    ON card_statements (source_document_id)
    WHERE source_document_id IS NOT NULL;

CREATE TABLE staged_card_statements (
    id TEXT PRIMARY KEY NOT NULL,
    import_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    card_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    issuer TEXT NOT NULL,
    period_start TEXT NOT NULL CHECK (period_start GLOB '????-??-??'),
    period_end TEXT NOT NULL CHECK (period_end GLOB '????-??-??'),
    payment_due_on TEXT CHECK (payment_due_on IS NULL OR payment_due_on GLOB '????-??-??'),
    statement_amount_jpy INTEGER NOT NULL CHECK (
        typeof(statement_amount_jpy) = 'integer' AND statement_amount_jpy >= 0
    ),
    CHECK (period_end >= period_start),
    UNIQUE (import_run_id, card_account_id)
) STRICT;

CREATE TABLE staged_card_statement_candidates (
    statement_id TEXT NOT NULL REFERENCES staged_card_statements(id) ON DELETE CASCADE,
    candidate_id TEXT NOT NULL REFERENCES transaction_candidates(id) ON DELETE CASCADE,
    statement_line_number INTEGER NOT NULL CHECK (statement_line_number > 0),
    billed_amount_jpy INTEGER NOT NULL CHECK (
        typeof(billed_amount_jpy) = 'integer' AND billed_amount_jpy != 0
    ),
    PRIMARY KEY (statement_id, candidate_id),
    UNIQUE (statement_id, statement_line_number)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_staged_card_statements_run
    ON staged_card_statements (import_run_id);
CREATE INDEX idx_staged_card_candidates_candidate
    ON staged_card_statement_candidates (candidate_id);
