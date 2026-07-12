CREATE TABLE card_statements (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    card_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    period_start TEXT NOT NULL CHECK (period_start GLOB '????-??-??'),
    period_end TEXT NOT NULL CHECK (period_end GLOB '????-??-??'),
    payment_due_on TEXT CHECK (payment_due_on IS NULL OR payment_due_on GLOB '????-??-??'),
    statement_amount_jpy INTEGER NOT NULL CHECK (
        typeof(statement_amount_jpy) = 'integer' AND statement_amount_jpy >= 0
    ),
    reconciliation_status TEXT NOT NULL DEFAULT 'UNMATCHED' CHECK (reconciliation_status IN (
        'UNMATCHED', 'POSSIBLE_MATCH', 'FULLY_RECONCILED', 'PARTIALLY_RECONCILED',
        'OVERPAID', 'UNDERPAID', 'MANUAL_OVERRIDE'
    )),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (period_end >= period_start),
    UNIQUE (card_account_id, period_start, period_end)
) STRICT;

CREATE TABLE card_statement_transactions (
    statement_id TEXT NOT NULL REFERENCES card_statements(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    statement_line_number INTEGER NOT NULL CHECK (statement_line_number > 0),
    billed_amount_jpy INTEGER NOT NULL CHECK (
        typeof(billed_amount_jpy) = 'integer' AND billed_amount_jpy != 0
    ),
    PRIMARY KEY (statement_id, transaction_id),
    UNIQUE (statement_id, statement_line_number)
) STRICT, WITHOUT ROWID;

CREATE TABLE card_payments (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    statement_id TEXT REFERENCES card_statements(id) ON DELETE SET NULL,
    bank_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    card_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    payment_amount_jpy INTEGER NOT NULL CHECK (
        typeof(payment_amount_jpy) = 'integer' AND payment_amount_jpy > 0
    ),
    payment_on TEXT NOT NULL CHECK (payment_on GLOB '????-??-??'),
    match_score_bps INTEGER CHECK (match_score_bps IS NULL OR match_score_bps BETWEEN 0 AND 10000),
    reconciliation_status TEXT NOT NULL DEFAULT 'UNMATCHED' CHECK (reconciliation_status IN (
        'UNMATCHED', 'POSSIBLE_MATCH', 'FULLY_RECONCILED', 'PARTIALLY_RECONCILED',
        'OVERPAID', 'UNDERPAID', 'MANUAL_OVERRIDE'
    )),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (bank_transaction_id)
) STRICT;

CREATE INDEX idx_card_statements_household_due
    ON card_statements (household_id, payment_due_on, reconciliation_status);
CREATE INDEX idx_card_statements_account_period
    ON card_statements (card_account_id, period_end DESC);
CREATE INDEX idx_card_statement_transactions_transaction
    ON card_statement_transactions (transaction_id);
CREATE INDEX idx_card_payments_statement
    ON card_payments (statement_id);
CREATE INDEX idx_card_payments_account_date
    ON card_payments (card_account_id, payment_on DESC);
