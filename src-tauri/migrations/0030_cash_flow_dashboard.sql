CREATE TABLE dashboard_preferences_v2 (
    household_id TEXT PRIMARY KEY NOT NULL
        REFERENCES households(id) ON DELETE CASCADE,
    dashboard_template TEXT NOT NULL CHECK (dashboard_template IN (
        'FINANCIAL_OVERVIEW',
        'HOUSEHOLD_LEDGER',
        'ASSETS_LIABILITIES',
        'CARD_RECONCILIATION',
        'CASH_FLOW'
    )),
    theme TEXT NOT NULL CHECK (theme IN ('SYSTEM', 'LIGHT', 'DARK')),
    density TEXT NOT NULL CHECK (density IN ('COMFORTABLE', 'COMPACT')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

INSERT INTO dashboard_preferences_v2 (
    household_id, dashboard_template, theme, density, created_at, updated_at
)
SELECT household_id, dashboard_template, theme, density, created_at, updated_at
FROM dashboard_preferences;

DROP TABLE dashboard_preferences;
ALTER TABLE dashboard_preferences_v2 RENAME TO dashboard_preferences;
