CREATE TABLE monthly_category_budgets (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    month TEXT NOT NULL CHECK (
        length(month) = 7
        AND month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
    ),
    category_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    budget_jpy INTEGER NOT NULL CHECK (
        typeof(budget_jpy) = 'integer' AND budget_jpy >= 0
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (household_id, month, category_account_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_monthly_category_budgets_household_month
    ON monthly_category_budgets (household_id, month, category_account_id);

CREATE TABLE savings_goals (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    target_jpy INTEGER NOT NULL CHECK (
        typeof(target_jpy) = 'integer' AND target_jpy > 0
    ),
    saved_jpy INTEGER NOT NULL DEFAULT 0 CHECK (
        typeof(saved_jpy) = 'integer' AND saved_jpy >= 0
    ),
    target_date TEXT NOT NULL CHECK (
        length(target_date) = 10
        AND target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
        status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_savings_goals_household_status_date
    ON savings_goals (household_id, status, target_date, id);
