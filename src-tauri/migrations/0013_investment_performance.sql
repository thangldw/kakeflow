-- Stable, source-aware read model used by the FIFO cost-basis engine.
-- Values stay in their native currency; this view deliberately performs no FX conversion.
CREATE VIEW investment_trade_events_v1 AS
SELECT
    e.id AS event_id,
    e.household_id,
    e.account_id,
    a.name AS account_name,
    e.source_document_id,
    e.source_row,
    e.event_type,
    COALESCE(e.trade_date, e.settlement_date) AS event_date,
    e.instrument_code,
    e.instrument_name,
    e.currency,
    e.quantity,
    e.gross_amount,
    e.fee_amount,
    e.tax_amount,
    e.settlement_amount
FROM brokerage_events e
JOIN accounts a ON a.id = e.account_id
WHERE e.event_type IN ('BUY', 'SELL', 'DIVIDEND', 'FEE', 'TAX')
  AND COALESCE(e.trade_date, e.settlement_date) IS NOT NULL;

CREATE INDEX idx_brokerage_events_cost_basis
    ON brokerage_events (
        household_id,
        account_id,
        currency,
        instrument_code,
        trade_date,
        settlement_date,
        source_row
    );
