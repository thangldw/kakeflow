-- Corporate actions with explicit cost-allocation inputs. Rebuild the event
-- table because SQLite cannot extend its event_type CHECK in place.
CREATE TABLE brokerage_events_v3 (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
    source_row INTEGER NOT NULL CHECK (source_row > 0),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'BUY', 'SELL', 'DIVIDEND', 'FEE', 'TAX', 'DEPOSIT', 'WITHDRAWAL',
        'SPLIT', 'REVERSE_SPLIT', 'MERGER', 'SPIN_OFF',
        'RIGHTS_SUBSCRIPTION', 'CASH_IN_LIEU'
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
    corporate_action_ratio REAL CHECK (corporate_action_ratio IS NULL OR corporate_action_ratio > 0),
    target_instrument_code TEXT,
    target_instrument_name TEXT,
    target_currency TEXT CHECK (target_currency IS NULL OR length(target_currency) = 3),
    cost_basis_allocation_ratio REAL CHECK (
        cost_basis_allocation_ratio IS NULL OR
        (cost_basis_allocation_ratio >= 0 AND cost_basis_allocation_ratio <= 1)
    ),
    subscription_amount REAL CHECK (subscription_amount IS NULL OR subscription_amount > 0),
    cash_in_lieu_amount REAL CHECK (cash_in_lieu_amount IS NULL OR cash_in_lieu_amount > 0),
    cash_in_lieu_quantity REAL CHECK (cash_in_lieu_quantity IS NULL OR cash_in_lieu_quantity > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_document_id, source_row)
) STRICT;

INSERT INTO brokerage_events_v3 (
    id, household_id, account_id, source_document_id, source_row, event_type,
    trade_date, settlement_date, instrument_code, instrument_name,
    brokerage_account_type, currency, quantity, unit_price, gross_amount,
    fee_amount, tax_amount, settlement_amount, reconciliation_status,
    reconciliation_difference, affects_household_expense, raw_transaction_type,
    corporate_action_ratio, target_instrument_code, target_instrument_name,
    target_currency, created_at
)
SELECT id, household_id, account_id, source_document_id, source_row, event_type,
       trade_date, settlement_date, instrument_code, instrument_name,
       brokerage_account_type, currency, quantity, unit_price, gross_amount,
       fee_amount, tax_amount, settlement_amount, reconciliation_status,
       reconciliation_difference, affects_household_expense, raw_transaction_type,
       corporate_action_ratio, target_instrument_code, target_instrument_name,
       target_currency, created_at
FROM brokerage_events;

CREATE TABLE brokerage_event_legs_v3 (
    id TEXT PRIMARY KEY NOT NULL,
    brokerage_event_id TEXT NOT NULL REFERENCES brokerage_events_v3(id) ON DELETE CASCADE,
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
INSERT INTO brokerage_event_legs_v3 SELECT * FROM brokerage_event_legs;

DROP VIEW investment_trade_events_v1;
DROP TABLE brokerage_event_legs;
DROP TABLE brokerage_events;
ALTER TABLE brokerage_events_v3 RENAME TO brokerage_events;
ALTER TABLE brokerage_event_legs_v3 RENAME TO brokerage_event_legs;

CREATE INDEX idx_brokerage_events_household_date
    ON brokerage_events (household_id, trade_date DESC, settlement_date DESC);
CREATE INDEX idx_brokerage_events_account_date
    ON brokerage_events (account_id, trade_date DESC, settlement_date DESC);
CREATE INDEX idx_brokerage_event_legs_event
    ON brokerage_event_legs (brokerage_event_id, line_number);
CREATE INDEX idx_brokerage_events_cost_basis
    ON brokerage_events (
        household_id, account_id, currency, instrument_code,
        trade_date, settlement_date, source_row
    );

CREATE VIEW investment_trade_events_v1 AS
SELECT
    e.id AS event_id, e.household_id, e.account_id, a.name AS account_name,
    e.source_document_id, e.source_row, e.event_type,
    COALESCE(e.trade_date, e.settlement_date) AS event_date,
    e.instrument_code, e.instrument_name, e.currency, e.quantity,
    e.gross_amount, e.fee_amount, e.tax_amount, e.settlement_amount,
    e.corporate_action_ratio, e.target_instrument_code,
    e.target_instrument_name, e.target_currency,
    e.cost_basis_allocation_ratio, e.subscription_amount,
    e.cash_in_lieu_amount, e.cash_in_lieu_quantity
FROM brokerage_events e
JOIN accounts a ON a.id = e.account_id
WHERE e.event_type IN (
    'BUY', 'SELL', 'DIVIDEND', 'FEE', 'TAX', 'SPLIT', 'REVERSE_SPLIT',
    'MERGER', 'SPIN_OFF', 'RIGHTS_SUBSCRIPTION', 'CASH_IN_LIEU'
)
  AND COALESCE(e.trade_date, e.settlement_date) IS NOT NULL;
