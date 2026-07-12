CREATE UNIQUE INDEX idx_accounts_household_id
    ON accounts (household_id, id);

CREATE TABLE account_groups (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    group_kind TEXT NOT NULL CHECK (group_kind IN (
        'FAMILY', 'PERSONAL', 'DAILY_SPENDING', 'INVESTMENT',
        'BUSINESS', 'TAX', 'EDUCATION', 'CUSTOM'
    )),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (household_id, id),
    UNIQUE (household_id, name),
    UNIQUE (household_id, sort_order)
) STRICT;

CREATE TABLE account_group_members (
    household_id TEXT NOT NULL,
    account_group_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    PRIMARY KEY (account_group_id, account_id),
    UNIQUE (account_group_id, sort_order),
    FOREIGN KEY (household_id, account_group_id)
        REFERENCES account_groups(household_id, id) ON DELETE CASCADE,
    FOREIGN KEY (household_id, account_id)
        REFERENCES accounts(household_id, id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_account_groups_household_order
    ON account_groups (household_id, sort_order, id);
CREATE INDEX idx_account_group_members_account
    ON account_group_members (household_id, account_id, account_group_id);
