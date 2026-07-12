CREATE TABLE transactions (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    occurred_on TEXT NOT NULL CHECK (occurred_on GLOB '????-??-??'),
    posted_on TEXT CHECK (posted_on IS NULL OR posted_on GLOB '????-??-??'),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'EXPENSE', 'INCOME', 'TRANSFER', 'CARD_PURCHASE', 'CARD_PAYMENT',
        'REFUND', 'FEE', 'INTEREST', 'ADJUSTMENT'
    )),
    payee TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('DRAFT', 'POSTED', 'VOID')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE transaction_sources (
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
    candidate_id TEXT REFERENCES transaction_candidates(id) ON DELETE SET NULL,
    PRIMARY KEY (transaction_id, source_record_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE journal_entries (
    id TEXT PRIMARY KEY NOT NULL,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    entry_side TEXT NOT NULL CHECK (entry_side IN ('DEBIT', 'CREDIT')),
    amount_jpy INTEGER NOT NULL CHECK (typeof(amount_jpy) = 'integer' AND amount_jpy > 0),
    line_number INTEGER NOT NULL CHECK (line_number > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (transaction_id, line_number)
) STRICT;

CREATE INDEX idx_transactions_household_date
    ON transactions (household_id, occurred_on DESC);
CREATE INDEX idx_transactions_type_date
    ON transactions (transaction_type, occurred_on DESC);
CREATE INDEX idx_transaction_sources_record
    ON transaction_sources (source_record_id);
CREATE INDEX idx_journal_entries_transaction
    ON journal_entries (transaction_id, line_number);
CREATE INDEX idx_journal_entries_account
    ON journal_entries (account_id, transaction_id);
