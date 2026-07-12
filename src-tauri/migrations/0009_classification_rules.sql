CREATE TABLE classification_rules (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    priority INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000000),
    is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
    merchant_contains TEXT,
    description_contains TEXT,
    category_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (
        (merchant_contains IS NOT NULL AND length(trim(merchant_contains)) > 0)
        OR (description_contains IS NOT NULL AND length(trim(description_contains)) > 0)
    )
) STRICT;

CREATE INDEX idx_classification_rules_household_order
    ON classification_rules (household_id, is_enabled DESC, priority ASC, id ASC);

CREATE TABLE classification_rule_labels (
    rule_id TEXT NOT NULL REFERENCES classification_rules(id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (length(trim(label)) > 0),
    PRIMARY KEY (rule_id, label)
) STRICT, WITHOUT ROWID;

CREATE TABLE classification_rule_tags (
    rule_id TEXT NOT NULL REFERENCES classification_rules(id) ON DELETE CASCADE,
    tag TEXT NOT NULL CHECK (length(trim(tag)) > 0),
    PRIMARY KEY (rule_id, tag)
) STRICT, WITHOUT ROWID;

CREATE TABLE transaction_labels (
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (length(trim(label)) > 0),
    PRIMARY KEY (transaction_id, label)
) STRICT, WITHOUT ROWID;

CREATE TABLE transaction_tags (
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tag TEXT NOT NULL CHECK (length(trim(tag)) > 0),
    PRIMARY KEY (transaction_id, tag)
) STRICT, WITHOUT ROWID;

CREATE TABLE classification_rule_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    rule_id TEXT REFERENCES classification_rules(id) ON DELETE SET NULL,
    previous_category_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    applied_category_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_classification_rule_applications_transaction
    ON classification_rule_applications (household_id, transaction_id, applied_at DESC);
