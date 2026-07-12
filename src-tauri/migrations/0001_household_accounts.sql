CREATE TABLE households (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    base_currency TEXT NOT NULL DEFAULT 'JPY' CHECK (base_currency = 'JPY'),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    account_kind TEXT NOT NULL CHECK (account_kind IN (
        'ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'
    )),
    account_subtype TEXT NOT NULL CHECK (account_subtype IN (
        'BANK', 'CASH', 'WALLET', 'SECURITIES', 'CREDIT_CARD', 'RECEIVABLE', 'OTHER'
    )),
    currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
    institution_name TEXT,
    masked_identifier TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (household_id, name)
) STRICT;

CREATE INDEX idx_accounts_household_kind
    ON accounts (household_id, account_kind, account_subtype)
    WHERE is_archived = 0;
