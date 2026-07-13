CREATE TABLE dashboard_preferences (
    household_id TEXT PRIMARY KEY NOT NULL
        REFERENCES households(id) ON DELETE CASCADE,
    dashboard_template TEXT NOT NULL CHECK (dashboard_template IN (
        'FINANCIAL_OVERVIEW',
        'HOUSEHOLD_LEDGER',
        'ASSETS_LIABILITIES',
        'CARD_RECONCILIATION'
    )),
    theme TEXT NOT NULL CHECK (theme IN ('SYSTEM', 'LIGHT', 'DARK')),
    density TEXT NOT NULL CHECK (density IN ('COMFORTABLE', 'COMPACT')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
