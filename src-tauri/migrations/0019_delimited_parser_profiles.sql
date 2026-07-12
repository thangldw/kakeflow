CREATE TABLE delimited_parser_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    delimiter TEXT NOT NULL CHECK (delimiter IN ('AUTO', 'COMMA', 'TAB', 'SEMICOLON')),
    encoding TEXT NOT NULL CHECK (encoding IN ('AUTO', 'UTF8', 'CP932')),
    header_row INTEGER NOT NULL CHECK (header_row BETWEEN 1 AND 1000),
    date_column TEXT NOT NULL CHECK (length(trim(date_column)) BETWEEN 1 AND 120),
    date_format TEXT NOT NULL CHECK (date_format IN (
        'AUTO', 'YYYY_MM_DD', 'YYYYMMDD', 'MM_DD_YYYY', 'DD_MM_YYYY'
    )),
    description_column TEXT CHECK (
        description_column IS NULL OR length(trim(description_column)) BETWEEN 1 AND 120
    ),
    payee_column TEXT CHECK (
        payee_column IS NULL OR length(trim(payee_column)) BETWEEN 1 AND 120
    ),
    amount_mode TEXT NOT NULL CHECK (amount_mode IN ('SIGNED', 'DEBIT_CREDIT')),
    signed_positive_direction TEXT CHECK (signed_positive_direction IN ('IN', 'OUT')),
    signed_amount_column TEXT CHECK (
        signed_amount_column IS NULL OR length(trim(signed_amount_column)) BETWEEN 1 AND 120
    ),
    debit_column TEXT CHECK (
        debit_column IS NULL OR length(trim(debit_column)) BETWEEN 1 AND 120
    ),
    credit_column TEXT CHECK (
        credit_column IS NULL OR length(trim(credit_column)) BETWEEN 1 AND 120
    ),
    external_id_column TEXT CHECK (
        external_id_column IS NULL OR length(trim(external_id_column)) BETWEEN 1 AND 120
    ),
    account_hint_column TEXT CHECK (
        account_hint_column IS NULL OR length(trim(account_hint_column)) BETWEEN 1 AND 120
    ),
    is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
    priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 10000),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (description_column IS NOT NULL OR payee_column IS NOT NULL),
    CHECK (
        (amount_mode = 'SIGNED' AND signed_positive_direction IS NOT NULL
            AND signed_amount_column IS NOT NULL
            AND debit_column IS NULL AND credit_column IS NULL)
        OR
        (amount_mode = 'DEBIT_CREDIT' AND signed_positive_direction IS NULL
            AND signed_amount_column IS NULL
            AND debit_column IS NOT NULL AND credit_column IS NOT NULL)
    ),
    CHECK (updated_at >= created_at),
    UNIQUE (household_id, id),
    UNIQUE (household_id, name)
) STRICT;

CREATE INDEX idx_delimited_parser_profiles_household_order
    ON delimited_parser_profiles (household_id, is_enabled DESC, priority, name, id);
