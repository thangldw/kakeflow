CREATE TABLE portfolio_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
    as_of TEXT NOT NULL,
    market_value_jpy INTEGER NOT NULL CHECK (market_value_jpy >= 0),
    cash_value_jpy INTEGER NOT NULL DEFAULT 0 CHECK (cash_value_jpy >= 0),
    unrealized_pnl_jpy INTEGER,
    realized_pnl_jpy INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (household_id, account_id, as_of),
    UNIQUE (household_id, source_document_id)
) STRICT;

CREATE TABLE portfolio_asset_classes (
    id TEXT PRIMARY KEY NOT NULL,
    portfolio_snapshot_id TEXT NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    market_value_jpy INTEGER NOT NULL CHECK (market_value_jpy >= 0),
    unrealized_pnl_jpy INTEGER,
    source_row INTEGER NOT NULL CHECK (source_row > 0),
    UNIQUE (portfolio_snapshot_id, name)
) STRICT;

CREATE TABLE position_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    portfolio_snapshot_id TEXT NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
    product_type TEXT NOT NULL,
    account_type TEXT NOT NULL,
    instrument_code TEXT NOT NULL,
    instrument_name TEXT NOT NULL CHECK (length(trim(instrument_name)) > 0),
    quantity REAL,
    average_cost REAL,
    market_price REAL,
    market_value_jpy INTEGER,
    unrealized_pnl_jpy INTEGER,
    realized_pnl_jpy INTEGER,
    currency TEXT NOT NULL CHECK (length(currency) = 3),
    source_row INTEGER NOT NULL CHECK (source_row > 0),
    CHECK (quantity IS NULL OR quantity >= 0),
    CHECK (average_cost IS NULL OR average_cost >= 0),
    CHECK (market_price IS NULL OR market_price >= 0)
) STRICT;

CREATE TABLE portfolio_fx_rates (
    id TEXT PRIMARY KEY NOT NULL,
    portfolio_snapshot_id TEXT NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
    base_currency TEXT NOT NULL CHECK (length(base_currency) = 3),
    quote_currency TEXT NOT NULL DEFAULT 'JPY' CHECK (quote_currency = 'JPY'),
    rate REAL NOT NULL CHECK (rate > 0),
    source_row INTEGER NOT NULL CHECK (source_row > 0),
    UNIQUE (portfolio_snapshot_id, base_currency, quote_currency)
) STRICT;

CREATE INDEX idx_portfolio_snapshots_household_as_of
    ON portfolio_snapshots (household_id, as_of DESC);
CREATE INDEX idx_position_snapshots_portfolio
    ON position_snapshots (portfolio_snapshot_id, market_value_jpy DESC);
CREATE INDEX idx_portfolio_fx_rates_portfolio
    ON portfolio_fx_rates (portfolio_snapshot_id, base_currency);
