CREATE TABLE recurring_series_preferences (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    normalized_payee TEXT NOT NULL
        CHECK (length(trim(normalized_payee)) BETWEEN 1 AND 512),
    decision TEXT NOT NULL CHECK (decision IN ('CONFIRMED', 'IGNORED')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (household_id, normalized_payee)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_recurring_series_preferences_household_decision
    ON recurring_series_preferences (household_id, decision, normalized_payee);

