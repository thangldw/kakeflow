-- Aggregate asset history is an imported reporting series. It deliberately has
-- no account or ledger foreign key and must not participate in net-worth sums.
CREATE TABLE aggregate_asset_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
    source_row INTEGER NOT NULL CHECK (source_row > 0),
    as_of TEXT NOT NULL CHECK (length(as_of) = 10),
    total_assets_jpy INTEGER NOT NULL CHECK (total_assets_jpy BETWEEN 0 AND 9000000000000000),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (household_id, source_document_id, source_row),
    UNIQUE (household_id, as_of)
) STRICT;

CREATE TABLE aggregate_asset_components (
    aggregate_asset_snapshot_id TEXT NOT NULL REFERENCES aggregate_asset_snapshots(id) ON DELETE CASCADE,
    asset_class TEXT NOT NULL CHECK (asset_class IN (
        'DEPOSITS_CASH_CRYPTO', 'LISTED_STOCKS', 'INVESTMENT_TRUSTS', 'BONDS', 'FX',
        'INSURANCE', 'REAL_ESTATE', 'PENSIONS', 'POINTS', 'OTHER_ASSETS'
    )),
    official_header TEXT NOT NULL,
    value_jpy INTEGER NOT NULL CHECK (value_jpy BETWEEN 0 AND 9000000000000000),
    PRIMARY KEY (aggregate_asset_snapshot_id, asset_class),
    CHECK (
        (asset_class = 'DEPOSITS_CASH_CRYPTO' AND official_header = '預金・現金・暗号資産(円)') OR
        (asset_class = 'LISTED_STOCKS' AND official_header = '株式(現物)(円)') OR
        (asset_class = 'INVESTMENT_TRUSTS' AND official_header = '投資信託(円)') OR
        (asset_class = 'BONDS' AND official_header = '債券(円)') OR
        (asset_class = 'FX' AND official_header = 'FX(円)') OR
        (asset_class = 'INSURANCE' AND official_header = '保険(円)') OR
        (asset_class = 'REAL_ESTATE' AND official_header = '不動産(円)') OR
        (asset_class = 'PENSIONS' AND official_header = '年金(円)') OR
        (asset_class = 'POINTS' AND official_header = 'ポイント(円)') OR
        (asset_class = 'OTHER_ASSETS' AND official_header = 'その他の資産(円)')
    )
) STRICT, WITHOUT ROWID;

-- Enforce tenant ownership even for writes that bypass the Rust service.
CREATE TRIGGER aggregate_asset_snapshot_source_owner_insert
BEFORE INSERT ON aggregate_asset_snapshots
WHEN NOT EXISTS (
    SELECT 1 FROM source_documents document
    JOIN source_records record ON record.source_document_id = document.id
    WHERE document.id = NEW.source_document_id
      AND document.household_id = NEW.household_id
      AND record.row_number = NEW.source_row
)
BEGIN
    SELECT RAISE(ABORT, 'aggregate asset source ownership mismatch');
END;

CREATE TRIGGER aggregate_asset_snapshot_source_owner_update
BEFORE UPDATE OF household_id, source_document_id, source_row ON aggregate_asset_snapshots
WHEN NOT EXISTS (
    SELECT 1 FROM source_documents document
    JOIN source_records record ON record.source_document_id = document.id
    WHERE document.id = NEW.source_document_id
      AND document.household_id = NEW.household_id
      AND record.row_number = NEW.source_row
)
BEGIN
    SELECT RAISE(ABORT, 'aggregate asset source ownership mismatch');
END;

CREATE INDEX idx_aggregate_asset_snapshots_household_as_of
    ON aggregate_asset_snapshots (household_id, as_of DESC, id);
