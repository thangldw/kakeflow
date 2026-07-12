ALTER TABLE brokerage_events ADD COLUMN merger_cash_amount REAL CHECK (
    merger_cash_amount IS NULL OR (merger_cash_amount > 0 AND merger_cash_amount <= 1.0e18)
);
ALTER TABLE brokerage_events ADD COLUMN merger_cash_currency TEXT CHECK (
    merger_cash_currency IS NULL OR (
        length(merger_cash_currency) = 3
        AND merger_cash_currency GLOB '[A-Z][A-Z][A-Z]'
    )
);
ALTER TABLE brokerage_events ADD COLUMN merger_stock_cost_basis_ratio REAL CHECK (
    merger_stock_cost_basis_ratio IS NULL OR (
        merger_stock_cost_basis_ratio > 0 AND merger_stock_cost_basis_ratio <= 1
    )
);
ALTER TABLE brokerage_events ADD COLUMN source_to_target_fx_rate REAL CHECK (
    source_to_target_fx_rate IS NULL OR (
        source_to_target_fx_rate > 0 AND source_to_target_fx_rate <= 1.0e12
    )
);
ALTER TABLE brokerage_events ADD COLUMN source_to_cash_fx_rate REAL CHECK (
    source_to_cash_fx_rate IS NULL OR (
        source_to_cash_fx_rate > 0 AND source_to_cash_fx_rate <= 1.0e12
    )
);

UPDATE brokerage_events
SET target_currency = COALESCE(target_currency, currency),
    merger_stock_cost_basis_ratio = 1
WHERE event_type = 'MERGER';

DROP VIEW investment_trade_events_v1;
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
    e.cash_in_lieu_amount, e.cash_in_lieu_quantity,
    e.merger_cash_amount, e.merger_cash_currency,
    e.merger_stock_cost_basis_ratio, e.source_to_target_fx_rate,
    e.source_to_cash_fx_rate
FROM brokerage_events e
JOIN accounts a ON a.id = e.account_id
WHERE e.event_type IN (
    'BUY', 'SELL', 'DIVIDEND', 'FEE', 'TAX', 'SPLIT', 'REVERSE_SPLIT',
    'MERGER', 'SPIN_OFF', 'RIGHTS_SUBSCRIPTION', 'CASH_IN_LIEU'
)
  AND COALESCE(e.trade_date, e.settlement_date) IS NOT NULL;
