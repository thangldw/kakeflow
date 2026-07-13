-- Package schema 3 adds the five authoritative investment aggregates. Raw
-- evidence is still hydrated separately; portable source references preserve
-- the origin identifiers when a destination resolves them to local aliases.

DROP TRIGGER trg_applied_change_package_matches_stage;

CREATE TABLE change_packages_v3 (
    package_id TEXT PRIMARY KEY NOT NULL
        CHECK (length(trim(package_id)) BETWEEN 1 AND 128),
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version IN (1,2,3)),
    target_household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    source_installation_id TEXT NOT NULL
        CHECK (length(trim(source_installation_id)) BETWEEN 1 AND 128),
    source_principal_id TEXT NOT NULL
        CHECK (length(trim(source_principal_id)) BETWEEN 1 AND 128),
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    snapshot_sha256 TEXT NOT NULL CHECK (
        length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    manifest_json TEXT NOT NULL CHECK (
        json_valid(manifest_json) AND json_type(manifest_json) = 'object'
    ),
    package_sha256 TEXT NOT NULL CHECK (
        length(package_sha256) = 64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    state TEXT NOT NULL DEFAULT 'STAGED' CHECK (state IN (
        'STAGED','REVIEW_REQUIRED','READY','APPLIED','REJECTED'
    )),
    record_count INTEGER NOT NULL CHECK (record_count >= 0),
    create_count INTEGER NOT NULL DEFAULT 0 CHECK (create_count >= 0),
    update_count INTEGER NOT NULL DEFAULT 0 CHECK (update_count >= 0),
    unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
    delete_count INTEGER NOT NULL DEFAULT 0 CHECK (delete_count >= 0),
    conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
    staged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    source_created_at TEXT NOT NULL,
    reviewed_at TEXT,
    applied_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (create_count + update_count + unchanged_count + delete_count + conflict_count
           = record_count),
    CHECK (
        (state IN ('STAGED','REVIEW_REQUIRED') AND applied_at IS NULL)
        OR (state = 'READY' AND reviewed_at IS NOT NULL AND applied_at IS NULL)
        OR (state = 'APPLIED' AND reviewed_at IS NOT NULL AND applied_at IS NOT NULL)
        OR (state = 'REJECTED' AND reviewed_at IS NOT NULL AND applied_at IS NULL)
    ),
    CHECK (reviewed_at IS NULL OR reviewed_at >= staged_at),
    CHECK (applied_at IS NULL OR applied_at >= staged_at),
    CHECK (updated_at >= staged_at)
) STRICT;

CREATE TABLE change_package_records_v3 (
    package_id TEXT NOT NULL REFERENCES change_packages_v3(package_id) ON DELETE CASCADE,
    record_order INTEGER NOT NULL CHECK (record_order >= 0),
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'HOUSEHOLD','HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION',
        'MONTHLY_BUDGET_PLAN','SAVINGS_GOAL','CLASSIFICATION_RULE',
        'ACCOUNT_GROUP','CARD_SETTLEMENT_MAPPING','DASHBOARD_PREFERENCES',
        'DELIMITED_PARSER_PROFILE','CARD_STATEMENT','CARD_PAYMENT',
        'PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE',
        'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
    )),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT','DELETE')),
    canonical_payload_json TEXT NOT NULL CHECK (
        json_valid(canonical_payload_json) AND json_type(canonical_payload_json) = 'object'
    ),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    review_state TEXT NOT NULL CHECK (review_state IN (
        'CREATE','UPDATE','UNCHANGED','DELETE','CONFLICT'
    )),
    resolution TEXT NOT NULL DEFAULT 'PENDING' CHECK (resolution IN (
        'PENDING','APPLY_INCOMING','KEEP_LOCAL','SKIP'
    )),
    current_payload_sha256 TEXT CHECK (
        current_payload_sha256 IS NULL OR (
            length(current_payload_sha256) = 64
            AND current_payload_sha256 NOT GLOB '*[^0-9a-f]*'
        )
    ),
    conflict_reason TEXT CHECK (
        conflict_reason IS NULL OR length(trim(conflict_reason)) BETWEEN 1 AND 240
    ),
    PRIMARY KEY (package_id,record_order),
    UNIQUE (package_id,entity_kind,entity_id),
    CHECK ((review_state='CONFLICT' AND conflict_reason IS NOT NULL)
           OR (review_state!='CONFLICT' AND conflict_reason IS NULL))
) STRICT, WITHOUT ROWID;

CREATE TABLE applied_change_packages_v3 (
    package_id TEXT PRIMARY KEY NOT NULL
        REFERENCES change_packages_v3(package_id) ON DELETE CASCADE,
    source_installation_id TEXT NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    snapshot_sha256 TEXT NOT NULL CHECK (
        length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (source_installation_id,household_id,source_revision)
) STRICT;

CREATE TABLE sync_replica_entity_heads_v3 (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'HOUSEHOLD','HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION',
        'MONTHLY_BUDGET_PLAN','SAVINGS_GOAL','CLASSIFICATION_RULE',
        'ACCOUNT_GROUP','CARD_SETTLEMENT_MAPPING','DASHBOARD_PREFERENCES',
        'DELIMITED_PARSER_PROFILE','CARD_STATEMENT','CARD_PAYMENT',
        'PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE',
        'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
    )),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    source_installation_id TEXT NOT NULL
        CHECK (length(trim(source_installation_id)) BETWEEN 1 AND 128),
    package_id TEXT NOT NULL REFERENCES change_packages_v3(package_id) ON DELETE CASCADE,
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT','DELETE')),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id,entity_kind,entity_id)
) STRICT, WITHOUT ROWID;

INSERT INTO change_packages_v3 SELECT * FROM change_packages;
INSERT INTO change_package_records_v3 SELECT * FROM change_package_records;
INSERT INTO applied_change_packages_v3 SELECT * FROM applied_change_packages;
INSERT INTO sync_replica_entity_heads_v3 SELECT * FROM sync_replica_entity_heads;

DROP TABLE change_package_records;
DROP TABLE applied_change_packages;
DROP TABLE sync_replica_entity_heads;
DROP TABLE change_packages;

ALTER TABLE change_packages_v3 RENAME TO change_packages;
ALTER TABLE change_package_records_v3 RENAME TO change_package_records;
ALTER TABLE applied_change_packages_v3 RENAME TO applied_change_packages;
ALTER TABLE sync_replica_entity_heads_v3 RENAME TO sync_replica_entity_heads;

CREATE UNIQUE INDEX idx_change_packages_one_active_target
    ON change_packages(target_household_id)
    WHERE state IN ('STAGED','REVIEW_REQUIRED','READY');
CREATE INDEX idx_change_packages_source_revision
    ON change_packages(source_installation_id,target_household_id,source_revision);
CREATE INDEX idx_change_package_records_review
    ON change_package_records(package_id,review_state,record_order);
CREATE INDEX idx_sync_replica_heads_source
    ON sync_replica_entity_heads(
        source_installation_id,household_id,source_revision,entity_kind,entity_id
    );

CREATE TRIGGER trg_change_package_record_kind_matches_schema_insert
BEFORE INSERT ON change_package_records
WHEN (
  (NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT')
   AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) < 2)
  OR
  (NEW.entity_kind IN (
     'PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE',
     'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
   ) AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) < 3)
)
BEGIN
    SELECT RAISE(ABORT,'record kind requires a newer package schema');
END;

CREATE TRIGGER trg_change_package_record_kind_matches_schema_update
BEFORE UPDATE OF package_id,entity_kind ON change_package_records
WHEN (
  (NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT')
   AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) < 2)
  OR
  (NEW.entity_kind IN (
     'PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE',
     'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
   ) AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) < 3)
)
BEGIN
    SELECT RAISE(ABORT,'record kind requires a newer package schema');
END;

CREATE TRIGGER trg_change_package_schema_downgrade_guard
BEFORE UPDATE OF schema_version ON change_packages
WHEN EXISTS(
  SELECT 1 FROM change_package_records r
  WHERE r.package_id=NEW.package_id AND (
    (NEW.schema_version < 2 AND r.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT'))
    OR (NEW.schema_version < 3 AND r.entity_kind IN (
      'PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE',
      'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
    ))
  )
) OR EXISTS(
  SELECT 1 FROM sync_replica_entity_heads h
  WHERE h.package_id=NEW.package_id AND (
    (NEW.schema_version < 2 AND h.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT'))
    OR (NEW.schema_version < 3 AND h.entity_kind IN (
      'PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE',
      'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
    ))
  )
)
BEGIN
    SELECT RAISE(ABORT,'package schema downgrade would invalidate staged lineage');
END;

CREATE TRIGGER trg_replica_entity_head_matches_schema_insert
BEFORE INSERT ON sync_replica_entity_heads
WHEN (
  (NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT')
   AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) < 2)
  OR
  (NEW.entity_kind IN (
     'PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE',
     'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
   ) AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) < 3)
)
BEGIN
    SELECT RAISE(ABORT,'replica lineage requires a newer package schema');
END;

CREATE TRIGGER trg_replica_entity_head_matches_schema_update
BEFORE UPDATE OF package_id,entity_kind ON sync_replica_entity_heads
WHEN (
  (NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT')
   AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) < 2)
  OR
  (NEW.entity_kind IN (
     'PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE',
     'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
   ) AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) < 3)
)
BEGIN
    SELECT RAISE(ABORT,'replica lineage requires a newer package schema');
END;

CREATE TRIGGER trg_applied_change_package_matches_stage
BEFORE INSERT ON applied_change_packages
WHEN NOT EXISTS (
    SELECT 1 FROM change_packages p
    WHERE p.package_id=NEW.package_id
      AND p.source_installation_id=NEW.source_installation_id
      AND p.target_household_id=NEW.household_id
      AND p.source_revision=NEW.source_revision
      AND p.snapshot_sha256=NEW.snapshot_sha256
)
BEGIN
    SELECT RAISE(ABORT,'applied package receipt does not match staged package');
END;

CREATE TABLE investment_portable_source_refs (
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE',
        'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
    )),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    source_document_id TEXT NOT NULL
        CHECK (length(trim(source_document_id)) BETWEEN 1 AND 128),
    source_row INTEGER CHECK (source_row IS NULL OR source_row > 0),
    PRIMARY KEY (entity_kind,entity_id),
    CHECK (
      (entity_kind='PORTFOLIO_SNAPSHOT' AND source_row IS NULL)
      OR (entity_kind IN (
            'BROKERAGE_EVENT','INVESTMENT_FX_RATE',
            'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
          ) AND source_row IS NOT NULL)
    )
) STRICT, WITHOUT ROWID;

-- Evidence import intentionally seeds these rows before the matching aggregate
-- exists. Once seeded, the portable origin is an immutable conflict boundary.
CREATE TRIGGER trg_investment_portable_source_ref_immutable
BEFORE UPDATE ON investment_portable_source_refs
BEGIN
  SELECT RAISE(ABORT,'investment portable source reference is immutable');
END;

CREATE VIEW sync_portfolio_snapshot_payloads AS
SELECT s.household_id,
       s.id AS snapshot_id,
       json(json_object(
         'recordKind','PORTFOLIO_SNAPSHOT',
         'id',s.id,
         'householdId',s.household_id,
         'accountId',s.account_id,
         'sourceOriginInstallationId',COALESCE(
           r.origin_installation_id,
           (SELECT c.device_id FROM local_sync_contexts c WHERE c.household_id=s.household_id)
         ),
         'sourceDocumentId',COALESCE(r.source_document_id,s.source_document_id),
         'asOf',s.as_of,
         'marketValueJpy',s.market_value_jpy,
         'cashValueJpy',s.cash_value_jpy,
         'unrealizedPnlJpy',s.unrealized_pnl_jpy,
         'realizedPnlJpy',s.realized_pnl_jpy,
         'createdAt',s.created_at,
         'assetClasses',json(COALESCE((
           SELECT json_group_array(json_object(
             'id',c.id,
             'portfolioSnapshotId',c.portfolio_snapshot_id,
             'name',c.name,
             'marketValueJpy',c.market_value_jpy,
             'unrealizedPnlJpy',c.unrealized_pnl_jpy,
             'sourceRow',c.source_row
           )) FROM (
             SELECT id,portfolio_snapshot_id,name,market_value_jpy,
                    unrealized_pnl_jpy,source_row
             FROM portfolio_asset_classes
             WHERE portfolio_snapshot_id=s.id
             ORDER BY name,id
           ) c
         ),'[]')),
         'positions',json(COALESCE((
           SELECT json_group_array(json_object(
             'id',p.id,
             'portfolioSnapshotId',p.portfolio_snapshot_id,
             'productType',p.product_type,
             'accountType',p.account_type,
             'instrumentCode',p.instrument_code,
             'instrumentName',p.instrument_name,
             'quantity',p.quantity,
             'averageCost',p.average_cost,
             'marketPrice',p.market_price,
             'marketValueJpy',p.market_value_jpy,
             'unrealizedPnlJpy',p.unrealized_pnl_jpy,
             'realizedPnlJpy',p.realized_pnl_jpy,
             'currency',p.currency,
             'sourceRow',p.source_row
           )) FROM (
             SELECT id,portfolio_snapshot_id,product_type,account_type,
                    instrument_code,instrument_name,quantity,average_cost,
                    market_price,market_value_jpy,unrealized_pnl_jpy,
                    realized_pnl_jpy,currency,source_row
             FROM position_snapshots
             WHERE portfolio_snapshot_id=s.id
             ORDER BY source_row,id
           ) p
         ),'[]')),
         'fxRates',json(COALESCE((
           SELECT json_group_array(json_object(
             'id',f.id,
             'portfolioSnapshotId',f.portfolio_snapshot_id,
             'baseCurrency',f.base_currency,
             'quoteCurrency',f.quote_currency,
             'rate',f.rate,
             'sourceRow',f.source_row
           )) FROM (
             SELECT id,portfolio_snapshot_id,base_currency,quote_currency,rate,source_row
             FROM portfolio_fx_rates
             WHERE portfolio_snapshot_id=s.id
             ORDER BY base_currency,quote_currency,id
           ) f
         ),'[]'))
       )) AS payload_json
FROM portfolio_snapshots s
LEFT JOIN investment_portable_source_refs r
  ON r.entity_kind='PORTFOLIO_SNAPSHOT' AND r.entity_id=s.id
 AND r.household_id=s.household_id;

CREATE VIEW sync_brokerage_event_payloads AS
SELECT e.household_id,
       e.id AS event_id,
       json(json_object(
         'recordKind','BROKERAGE_EVENT',
         'id',e.id,
         'householdId',e.household_id,
         'accountId',e.account_id,
         'sourceOriginInstallationId',COALESCE(
           r.origin_installation_id,
           (SELECT c.device_id FROM local_sync_contexts c WHERE c.household_id=e.household_id)
         ),
         'sourceDocumentId',COALESCE(r.source_document_id,e.source_document_id),
         'sourceRow',COALESCE(r.source_row,e.source_row),
         'eventType',e.event_type,
         'tradeDate',e.trade_date,
         'settlementDate',e.settlement_date,
         'instrumentCode',e.instrument_code,
         'instrumentName',e.instrument_name,
         'brokerageAccountType',e.brokerage_account_type,
         'currency',e.currency,
         'quantity',e.quantity,
         'unitPrice',e.unit_price,
         'grossAmount',e.gross_amount,
         'feeAmount',e.fee_amount,
         'taxAmount',e.tax_amount,
         'settlementAmount',e.settlement_amount,
         'reconciliationStatus',e.reconciliation_status,
         'reconciliationDifference',e.reconciliation_difference,
         'affectsHouseholdExpense',e.affects_household_expense,
         'rawTransactionType',e.raw_transaction_type,
         'corporateActionRatio',e.corporate_action_ratio,
         'targetInstrumentCode',e.target_instrument_code,
         'targetInstrumentName',e.target_instrument_name,
         'targetCurrency',e.target_currency,
         'costBasisAllocationRatio',e.cost_basis_allocation_ratio,
         'subscriptionAmount',e.subscription_amount,
         'cashInLieuAmount',e.cash_in_lieu_amount,
         'cashInLieuQuantity',e.cash_in_lieu_quantity,
         'mergerCashAmount',e.merger_cash_amount,
         'mergerCashCurrency',e.merger_cash_currency,
         'mergerStockCostBasisRatio',e.merger_stock_cost_basis_ratio,
         'sourceToTargetFxRate',e.source_to_target_fx_rate,
         'sourceToCashFxRate',e.source_to_cash_fx_rate,
         'createdAt',e.created_at,
         'legs',json(COALESCE((
           SELECT json_group_array(json_object(
             'id',l.id,
             'brokerageEventId',l.brokerage_event_id,
             'lineNumber',l.line_number,
             'legKind',l.leg_kind,
             'signedAmount',l.signed_amount,
             'currency',l.currency,
             'instrumentCode',l.instrument_code,
             'instrumentName',l.instrument_name,
             'signedQuantity',l.signed_quantity,
             'description',l.description
           )) FROM (
             SELECT id,brokerage_event_id,line_number,leg_kind,signed_amount,
                    currency,instrument_code,instrument_name,signed_quantity,description
             FROM brokerage_event_legs
             WHERE brokerage_event_id=e.id
             ORDER BY line_number,id
           ) l
         ),'[]'))
       )) AS payload_json
FROM brokerage_events e
LEFT JOIN investment_portable_source_refs r
  ON r.entity_kind='BROKERAGE_EVENT' AND r.entity_id=e.id
 AND r.household_id=e.household_id;

CREATE VIEW sync_investment_fx_rate_payloads AS
SELECT f.household_id,
       f.id AS rate_id,
       json(json_object(
         'recordKind','INVESTMENT_FX_RATE',
         'id',f.id,
         'householdId',f.household_id,
         'sourceOriginInstallationId',CASE WHEN COALESCE(r.source_document_id,f.source_document_id) IS NULL
           THEN NULL ELSE COALESCE(
             r.origin_installation_id,
             (SELECT c.device_id FROM local_sync_contexts c WHERE c.household_id=f.household_id)
           ) END,
         'rateDate',f.rate_date,
         'baseCurrency',f.base_currency,
         'quoteCurrency',f.quote_currency,
         'rate',f.rate,
         'sourceKind',f.source_kind,
         'provider',f.provider,
         'sourceDocumentId',COALESCE(r.source_document_id,f.source_document_id),
         'sourceRow',COALESCE(r.source_row,f.source_row),
         'observedAt',f.observed_at,
         'createdAt',f.created_at
       )) AS payload_json
FROM investment_fx_rates f
LEFT JOIN investment_portable_source_refs r
  ON r.entity_kind='INVESTMENT_FX_RATE' AND r.entity_id=f.id
 AND r.household_id=f.household_id;

CREATE VIEW sync_investment_market_price_payloads AS
SELECT p.household_id,
       p.id AS price_id,
       json(json_object(
         'recordKind','INVESTMENT_MARKET_PRICE',
         'id',p.id,
         'householdId',p.household_id,
         'sourceOriginInstallationId',CASE WHEN COALESCE(r.source_document_id,p.source_document_id) IS NULL
           THEN NULL ELSE COALESCE(
             r.origin_installation_id,
             (SELECT c.device_id FROM local_sync_contexts c WHERE c.household_id=p.household_id)
           ) END,
         'priceDate',p.price_date,
         'instrumentCode',p.instrument_code,
         'instrumentName',p.instrument_name,
         'currency',p.currency,
         'unitPrice',p.unit_price,
         'sourceKind',p.source_kind,
         'provider',p.provider,
         'sourceDocumentId',COALESCE(r.source_document_id,p.source_document_id),
         'sourceRow',COALESCE(r.source_row,p.source_row),
         'observedAt',p.observed_at,
         'createdAt',p.created_at
       )) AS payload_json
FROM investment_market_prices p
LEFT JOIN investment_portable_source_refs r
  ON r.entity_kind='INVESTMENT_MARKET_PRICE' AND r.entity_id=p.id
 AND r.household_id=p.household_id;

CREATE VIEW sync_aggregate_asset_snapshot_payloads AS
SELECT s.household_id,
       s.id AS snapshot_id,
       json(json_object(
         'recordKind','AGGREGATE_ASSET_SNAPSHOT',
         'id',s.id,
         'householdId',s.household_id,
         'sourceOriginInstallationId',COALESCE(
           r.origin_installation_id,
           (SELECT c.device_id FROM local_sync_contexts c WHERE c.household_id=s.household_id)
         ),
         'sourceDocumentId',COALESCE(r.source_document_id,s.source_document_id),
         'sourceRow',COALESCE(r.source_row,s.source_row),
         'asOf',s.as_of,
         'totalAssetsJpy',s.total_assets_jpy,
         'createdAt',s.created_at,
         'components',json(COALESCE((
           SELECT json_group_array(json_object(
             'aggregateAssetSnapshotId',c.aggregate_asset_snapshot_id,
             'assetClass',c.asset_class,
             'officialHeader',c.official_header,
             'valueJpy',c.value_jpy
           )) FROM (
             SELECT aggregate_asset_snapshot_id,asset_class,official_header,value_jpy
             FROM aggregate_asset_components
             WHERE aggregate_asset_snapshot_id=s.id
             ORDER BY asset_class
           ) c
         ),'[]'))
       )) AS payload_json
FROM aggregate_asset_snapshots s
LEFT JOIN investment_portable_source_refs r
  ON r.entity_kind='AGGREGATE_ASSET_SNAPSHOT' AND r.entity_id=s.id
 AND r.household_id=s.household_id;

CREATE TRIGGER trg_sync_capture_portfolio_snapshot_insert
AFTER INSERT ON portfolio_snapshots
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads WHERE snapshot_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_portfolio_snapshot_update
AFTER UPDATE ON portfolio_snapshots
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT OLD.household_id,'PORTFOLIO_SNAPSHOT',OLD.id,'DELETE',json(json_object(
    'recordKind','PORTFOLIO_SNAPSHOT','id',OLD.id,'householdId',OLD.household_id
  )) WHERE OLD.id!=NEW.id OR OLD.household_id!=NEW.household_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads WHERE snapshot_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_portfolio_snapshot_delete
AFTER DELETE ON portfolio_snapshots
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'PORTFOLIO_SNAPSHOT',OLD.id,'DELETE',json(json_object(
    'recordKind','PORTFOLIO_SNAPSHOT','id',OLD.id,'householdId',OLD.household_id
  )));
END;

CREATE TRIGGER trg_sync_capture_portfolio_asset_class_insert
AFTER INSERT ON portfolio_asset_classes
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads WHERE snapshot_id=NEW.portfolio_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_portfolio_asset_class_update
AFTER UPDATE ON portfolio_asset_classes
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads
  WHERE snapshot_id=OLD.portfolio_snapshot_id
    AND OLD.portfolio_snapshot_id!=NEW.portfolio_snapshot_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads WHERE snapshot_id=NEW.portfolio_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_portfolio_asset_class_delete
AFTER DELETE ON portfolio_asset_classes
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads WHERE snapshot_id=OLD.portfolio_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_position_snapshot_insert
AFTER INSERT ON position_snapshots
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads WHERE snapshot_id=NEW.portfolio_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_position_snapshot_update
AFTER UPDATE ON position_snapshots
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads
  WHERE snapshot_id=OLD.portfolio_snapshot_id
    AND OLD.portfolio_snapshot_id!=NEW.portfolio_snapshot_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads WHERE snapshot_id=NEW.portfolio_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_position_snapshot_delete
AFTER DELETE ON position_snapshots
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads WHERE snapshot_id=OLD.portfolio_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_portfolio_fx_rate_insert
AFTER INSERT ON portfolio_fx_rates
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads WHERE snapshot_id=NEW.portfolio_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_portfolio_fx_rate_update
AFTER UPDATE ON portfolio_fx_rates
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads
  WHERE snapshot_id=OLD.portfolio_snapshot_id
    AND OLD.portfolio_snapshot_id!=NEW.portfolio_snapshot_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads WHERE snapshot_id=NEW.portfolio_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_portfolio_fx_rate_delete
AFTER DELETE ON portfolio_fx_rates
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'PORTFOLIO_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads WHERE snapshot_id=OLD.portfolio_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_brokerage_event_insert
AFTER INSERT ON brokerage_events
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'BROKERAGE_EVENT',event_id,'UPSERT',payload_json
  FROM sync_brokerage_event_payloads WHERE event_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_brokerage_event_update
AFTER UPDATE ON brokerage_events
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT OLD.household_id,'BROKERAGE_EVENT',OLD.id,'DELETE',json(json_object(
    'recordKind','BROKERAGE_EVENT','id',OLD.id,'householdId',OLD.household_id
  )) WHERE OLD.id!=NEW.id OR OLD.household_id!=NEW.household_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'BROKERAGE_EVENT',event_id,'UPSERT',payload_json
  FROM sync_brokerage_event_payloads WHERE event_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_brokerage_event_delete
AFTER DELETE ON brokerage_events
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'BROKERAGE_EVENT',OLD.id,'DELETE',json(json_object(
    'recordKind','BROKERAGE_EVENT','id',OLD.id,'householdId',OLD.household_id
  )));
END;

CREATE TRIGGER trg_sync_capture_brokerage_event_leg_insert
AFTER INSERT ON brokerage_event_legs
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'BROKERAGE_EVENT',event_id,'UPSERT',payload_json
  FROM sync_brokerage_event_payloads WHERE event_id=NEW.brokerage_event_id;
END;

CREATE TRIGGER trg_sync_capture_brokerage_event_leg_update
AFTER UPDATE ON brokerage_event_legs
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'BROKERAGE_EVENT',event_id,'UPSERT',payload_json
  FROM sync_brokerage_event_payloads
  WHERE event_id=OLD.brokerage_event_id
    AND OLD.brokerage_event_id!=NEW.brokerage_event_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'BROKERAGE_EVENT',event_id,'UPSERT',payload_json
  FROM sync_brokerage_event_payloads WHERE event_id=NEW.brokerage_event_id;
END;

CREATE TRIGGER trg_sync_capture_brokerage_event_leg_delete
AFTER DELETE ON brokerage_event_legs
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'BROKERAGE_EVENT',event_id,'UPSERT',payload_json
  FROM sync_brokerage_event_payloads WHERE event_id=OLD.brokerage_event_id;
END;

CREATE TRIGGER trg_sync_capture_investment_fx_rate_insert
AFTER INSERT ON investment_fx_rates
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'INVESTMENT_FX_RATE',rate_id,'UPSERT',payload_json
  FROM sync_investment_fx_rate_payloads WHERE rate_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_investment_fx_rate_update
AFTER UPDATE ON investment_fx_rates
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT OLD.household_id,'INVESTMENT_FX_RATE',OLD.id,'DELETE',json(json_object(
    'recordKind','INVESTMENT_FX_RATE','id',OLD.id,'householdId',OLD.household_id
  )) WHERE OLD.id!=NEW.id OR OLD.household_id!=NEW.household_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'INVESTMENT_FX_RATE',rate_id,'UPSERT',payload_json
  FROM sync_investment_fx_rate_payloads WHERE rate_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_investment_fx_rate_delete
AFTER DELETE ON investment_fx_rates
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'INVESTMENT_FX_RATE',OLD.id,'DELETE',json(json_object(
    'recordKind','INVESTMENT_FX_RATE','id',OLD.id,'householdId',OLD.household_id
  )));
END;

CREATE TRIGGER trg_sync_capture_investment_market_price_insert
AFTER INSERT ON investment_market_prices
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'INVESTMENT_MARKET_PRICE',price_id,'UPSERT',payload_json
  FROM sync_investment_market_price_payloads WHERE price_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_investment_market_price_update
AFTER UPDATE ON investment_market_prices
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT OLD.household_id,'INVESTMENT_MARKET_PRICE',OLD.id,'DELETE',json(json_object(
    'recordKind','INVESTMENT_MARKET_PRICE','id',OLD.id,'householdId',OLD.household_id
  )) WHERE OLD.id!=NEW.id OR OLD.household_id!=NEW.household_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'INVESTMENT_MARKET_PRICE',price_id,'UPSERT',payload_json
  FROM sync_investment_market_price_payloads WHERE price_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_investment_market_price_delete
AFTER DELETE ON investment_market_prices
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'INVESTMENT_MARKET_PRICE',OLD.id,'DELETE',json(json_object(
    'recordKind','INVESTMENT_MARKET_PRICE','id',OLD.id,'householdId',OLD.household_id
  )));
END;

CREATE TRIGGER trg_sync_capture_aggregate_asset_snapshot_insert
AFTER INSERT ON aggregate_asset_snapshots
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'AGGREGATE_ASSET_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_aggregate_asset_snapshot_payloads WHERE snapshot_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_aggregate_asset_snapshot_update
AFTER UPDATE ON aggregate_asset_snapshots
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT OLD.household_id,'AGGREGATE_ASSET_SNAPSHOT',OLD.id,'DELETE',json(json_object(
    'recordKind','AGGREGATE_ASSET_SNAPSHOT','id',OLD.id,'householdId',OLD.household_id
  )) WHERE OLD.id!=NEW.id OR OLD.household_id!=NEW.household_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'AGGREGATE_ASSET_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_aggregate_asset_snapshot_payloads WHERE snapshot_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_aggregate_asset_snapshot_delete
AFTER DELETE ON aggregate_asset_snapshots
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'AGGREGATE_ASSET_SNAPSHOT',OLD.id,'DELETE',json(json_object(
    'recordKind','AGGREGATE_ASSET_SNAPSHOT','id',OLD.id,'householdId',OLD.household_id
  )));
END;

CREATE TRIGGER trg_sync_capture_aggregate_asset_component_insert
AFTER INSERT ON aggregate_asset_components
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'AGGREGATE_ASSET_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_aggregate_asset_snapshot_payloads
  WHERE snapshot_id=NEW.aggregate_asset_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_aggregate_asset_component_update
AFTER UPDATE ON aggregate_asset_components
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'AGGREGATE_ASSET_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_aggregate_asset_snapshot_payloads
  WHERE snapshot_id=OLD.aggregate_asset_snapshot_id
    AND OLD.aggregate_asset_snapshot_id!=NEW.aggregate_asset_snapshot_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'AGGREGATE_ASSET_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_aggregate_asset_snapshot_payloads
  WHERE snapshot_id=NEW.aggregate_asset_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_aggregate_asset_component_delete
AFTER DELETE ON aggregate_asset_components
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'AGGREGATE_ASSET_SNAPSHOT',snapshot_id,'UPSERT',payload_json
  FROM sync_aggregate_asset_snapshot_payloads
  WHERE snapshot_id=OLD.aggregate_asset_snapshot_id;
END;

CREATE TRIGGER trg_sync_capture_investment_portable_source_ref_insert
AFTER INSERT ON investment_portable_source_refs
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,NEW.entity_kind,NEW.entity_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads
  WHERE NEW.entity_kind='PORTFOLIO_SNAPSHOT' AND snapshot_id=NEW.entity_id
  UNION ALL SELECT household_id,NEW.entity_kind,NEW.entity_id,'UPSERT',payload_json
  FROM sync_brokerage_event_payloads
  WHERE NEW.entity_kind='BROKERAGE_EVENT' AND event_id=NEW.entity_id
  UNION ALL SELECT household_id,NEW.entity_kind,NEW.entity_id,'UPSERT',payload_json
  FROM sync_investment_fx_rate_payloads
  WHERE NEW.entity_kind='INVESTMENT_FX_RATE' AND rate_id=NEW.entity_id
  UNION ALL SELECT household_id,NEW.entity_kind,NEW.entity_id,'UPSERT',payload_json
  FROM sync_investment_market_price_payloads
  WHERE NEW.entity_kind='INVESTMENT_MARKET_PRICE' AND price_id=NEW.entity_id
  UNION ALL SELECT household_id,NEW.entity_kind,NEW.entity_id,'UPSERT',payload_json
  FROM sync_aggregate_asset_snapshot_payloads
  WHERE NEW.entity_kind='AGGREGATE_ASSET_SNAPSHOT' AND snapshot_id=NEW.entity_id;
END;

CREATE TRIGGER trg_sync_capture_investment_portable_source_ref_delete
AFTER DELETE ON investment_portable_source_refs
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,OLD.entity_kind,OLD.entity_id,'UPSERT',payload_json
  FROM sync_portfolio_snapshot_payloads
  WHERE OLD.entity_kind='PORTFOLIO_SNAPSHOT' AND snapshot_id=OLD.entity_id
  UNION ALL SELECT household_id,OLD.entity_kind,OLD.entity_id,'UPSERT',payload_json
  FROM sync_brokerage_event_payloads
  WHERE OLD.entity_kind='BROKERAGE_EVENT' AND event_id=OLD.entity_id
  UNION ALL SELECT household_id,OLD.entity_kind,OLD.entity_id,'UPSERT',payload_json
  FROM sync_investment_fx_rate_payloads
  WHERE OLD.entity_kind='INVESTMENT_FX_RATE' AND rate_id=OLD.entity_id
  UNION ALL SELECT household_id,OLD.entity_kind,OLD.entity_id,'UPSERT',payload_json
  FROM sync_investment_market_price_payloads
  WHERE OLD.entity_kind='INVESTMENT_MARKET_PRICE' AND price_id=OLD.entity_id
  UNION ALL SELECT household_id,OLD.entity_kind,OLD.entity_id,'UPSERT',payload_json
  FROM sync_aggregate_asset_snapshot_payloads
  WHERE OLD.entity_kind='AGGREGATE_ASSET_SNAPSHOT' AND snapshot_id=OLD.entity_id;
END;
