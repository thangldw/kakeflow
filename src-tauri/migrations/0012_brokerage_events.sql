CREATE TABLE brokerage_events (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
    source_row INTEGER NOT NULL CHECK (source_row > 0),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'BUY', 'SELL', 'DIVIDEND', 'FEE', 'TAX', 'DEPOSIT', 'WITHDRAWAL'
    )),
    trade_date TEXT CHECK (trade_date IS NULL OR trade_date GLOB '????-??-??'),
    settlement_date TEXT CHECK (settlement_date IS NULL OR settlement_date GLOB '????-??-??'),
    instrument_code TEXT NOT NULL,
    instrument_name TEXT NOT NULL,
    brokerage_account_type TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (length(currency) = 3),
    quantity REAL CHECK (quantity IS NULL OR quantity >= 0),
    unit_price REAL CHECK (unit_price IS NULL OR unit_price >= 0),
    gross_amount REAL NOT NULL CHECK (gross_amount >= 0),
    fee_amount REAL NOT NULL CHECK (fee_amount >= 0),
    tax_amount REAL NOT NULL CHECK (tax_amount >= 0),
    settlement_amount REAL NOT NULL CHECK (settlement_amount >= 0),
    reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('BALANCED', 'ADJUSTED')),
    reconciliation_difference REAL NOT NULL,
    affects_household_expense INTEGER NOT NULL DEFAULT 0 CHECK (affects_household_expense = 0),
    raw_transaction_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_document_id, source_row)
) STRICT;

CREATE TABLE brokerage_event_legs (
    id TEXT PRIMARY KEY NOT NULL,
    brokerage_event_id TEXT NOT NULL REFERENCES brokerage_events(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL CHECK (line_number > 0),
    leg_kind TEXT NOT NULL CHECK (leg_kind IN (
        'SECURITY', 'CASH', 'INVESTMENT_INCOME', 'INVESTMENT_EXPENSE',
        'INVESTMENT_TAX', 'TRANSFER', 'ADJUSTMENT'
    )),
    signed_amount REAL NOT NULL,
    currency TEXT NOT NULL CHECK (length(currency) = 3),
    instrument_code TEXT,
    instrument_name TEXT,
    signed_quantity REAL,
    description TEXT NOT NULL,
    UNIQUE (brokerage_event_id, line_number)
) STRICT;

CREATE INDEX idx_brokerage_events_household_date
    ON brokerage_events (household_id, trade_date DESC, settlement_date DESC);
CREATE INDEX idx_brokerage_events_account_date
    ON brokerage_events (account_id, trade_date DESC, settlement_date DESC);
CREATE INDEX idx_brokerage_event_legs_event
    ON brokerage_event_legs (brokerage_event_id, line_number);
