-- Append-only market-price observations. Prices stay in their native currency;
-- valuation deliberately does not infer FX rates or carry a future quote back.
CREATE TABLE investment_market_prices (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    price_date TEXT NOT NULL CHECK (price_date GLOB '????-??-??'),
    instrument_code TEXT NOT NULL CHECK (length(trim(instrument_code)) > 0),
    instrument_name TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (length(currency) = 3),
    unit_price REAL NOT NULL CHECK (unit_price > 0),
    source_kind TEXT NOT NULL CHECK (source_kind IN (
        'BROKERAGE_STATEMENT', 'PORTFOLIO_SNAPSHOT', 'MANUAL',
        'EXCHANGE_CLOSE', 'OFFICIAL_REFERENCE'
    )),
    provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
    source_document_id TEXT REFERENCES source_documents(id) ON DELETE RESTRICT,
    source_row INTEGER CHECK (source_row IS NULL OR source_row > 0),
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK ((source_document_id IS NULL) = (source_row IS NULL)),
    UNIQUE (
        household_id, price_date, instrument_code, currency, provider,
        source_document_id, source_row
    )
) STRICT;

CREATE INDEX idx_investment_market_prices_lookup
    ON investment_market_prices (
        household_id, instrument_code, currency, price_date DESC, id DESC
    );
