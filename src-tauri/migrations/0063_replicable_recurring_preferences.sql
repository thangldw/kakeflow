-- Package schema 5 adds one authoritative recurring-series preference
-- aggregate per household. Local optimistic versions are deliberately excluded
-- from the portable payload and are advanced by the materializer.

DROP TRIGGER trg_applied_change_package_matches_stage;

CREATE TABLE change_packages_v5 (
    package_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(package_id)) BETWEEN 1 AND 128),
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version IN (1,2,3,4,5)),
    target_household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    source_installation_id TEXT NOT NULL CHECK(length(trim(source_installation_id)) BETWEEN 1 AND 128),
    source_principal_id TEXT NOT NULL CHECK(length(trim(source_principal_id)) BETWEEN 1 AND 128),
    source_revision INTEGER NOT NULL CHECK(source_revision >= 1),
    snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
    manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND json_type(manifest_json)='object'),
    package_sha256 TEXT NOT NULL CHECK(length(package_sha256)=64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'),
    state TEXT NOT NULL DEFAULT 'STAGED' CHECK(state IN ('STAGED','REVIEW_REQUIRED','READY','APPLIED','REJECTED')),
    record_count INTEGER NOT NULL CHECK(record_count >= 0),
    create_count INTEGER NOT NULL DEFAULT 0 CHECK(create_count >= 0),
    update_count INTEGER NOT NULL DEFAULT 0 CHECK(update_count >= 0),
    unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK(unchanged_count >= 0),
    delete_count INTEGER NOT NULL DEFAULT 0 CHECK(delete_count >= 0),
    conflict_count INTEGER NOT NULL DEFAULT 0 CHECK(conflict_count >= 0),
    staged_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    source_created_at TEXT NOT NULL,
    reviewed_at TEXT,
    applied_at TEXT,
    updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK(create_count+update_count+unchanged_count+delete_count+conflict_count=record_count),
    CHECK((state IN ('STAGED','REVIEW_REQUIRED') AND applied_at IS NULL)
       OR (state='READY' AND reviewed_at IS NOT NULL AND applied_at IS NULL)
       OR (state='APPLIED' AND reviewed_at IS NOT NULL AND applied_at IS NOT NULL)
       OR (state='REJECTED' AND reviewed_at IS NOT NULL AND applied_at IS NULL)),
    CHECK(reviewed_at IS NULL OR reviewed_at >= staged_at),
    CHECK(applied_at IS NULL OR applied_at >= staged_at),
    CHECK(updated_at >= staged_at)
) STRICT;

CREATE TABLE change_package_records_v5 (
    package_id TEXT NOT NULL REFERENCES change_packages_v5(package_id) ON DELETE CASCADE,
    record_order INTEGER NOT NULL CHECK(record_order >= 0),
    entity_kind TEXT NOT NULL CHECK(entity_kind IN (
      'HOUSEHOLD','HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION','MONTHLY_BUDGET_PLAN',
      'SAVINGS_GOAL','CLASSIFICATION_RULE','ACCOUNT_GROUP','CARD_SETTLEMENT_MAPPING',
      'DASHBOARD_PREFERENCES','DELIMITED_PARSER_PROFILE','CARD_STATEMENT','CARD_PAYMENT',
      'PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE',
      'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT','RECURRING_SERIES_PREFERENCES')),
    entity_id TEXT NOT NULL CHECK(length(trim(entity_id)) BETWEEN 1 AND 128),
    operation TEXT NOT NULL CHECK(operation IN ('UPSERT','DELETE')),
    canonical_payload_json TEXT NOT NULL CHECK(json_valid(canonical_payload_json) AND json_type(canonical_payload_json)='object'),
    payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
    review_state TEXT NOT NULL CHECK(review_state IN ('CREATE','UPDATE','UNCHANGED','DELETE','CONFLICT')),
    resolution TEXT NOT NULL DEFAULT 'PENDING' CHECK(resolution IN ('PENDING','APPLY_INCOMING','KEEP_LOCAL','SKIP')),
    current_payload_sha256 TEXT CHECK(current_payload_sha256 IS NULL OR (length(current_payload_sha256)=64 AND current_payload_sha256 NOT GLOB '*[^0-9a-f]*')),
    conflict_reason TEXT CHECK(conflict_reason IS NULL OR length(trim(conflict_reason)) BETWEEN 1 AND 240),
    PRIMARY KEY(package_id,record_order),
    UNIQUE(package_id,entity_kind,entity_id),
    CHECK((review_state='CONFLICT' AND conflict_reason IS NOT NULL) OR (review_state!='CONFLICT' AND conflict_reason IS NULL))
) STRICT, WITHOUT ROWID;

CREATE TABLE applied_change_packages_v5 (
    package_id TEXT PRIMARY KEY NOT NULL REFERENCES change_packages_v5(package_id) ON DELETE CASCADE,
    source_installation_id TEXT NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    source_revision INTEGER NOT NULL CHECK(source_revision >= 1),
    snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
    applied_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(source_installation_id,household_id,source_revision)
) STRICT;

CREATE TABLE sync_replica_entity_heads_v5 (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL CHECK(entity_kind IN (
      'HOUSEHOLD','HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION','MONTHLY_BUDGET_PLAN',
      'SAVINGS_GOAL','CLASSIFICATION_RULE','ACCOUNT_GROUP','CARD_SETTLEMENT_MAPPING',
      'DASHBOARD_PREFERENCES','DELIMITED_PARSER_PROFILE','CARD_STATEMENT','CARD_PAYMENT',
      'PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE',
      'INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT','RECURRING_SERIES_PREFERENCES')),
    entity_id TEXT NOT NULL CHECK(length(trim(entity_id)) BETWEEN 1 AND 128),
    source_installation_id TEXT NOT NULL CHECK(length(trim(source_installation_id)) BETWEEN 1 AND 128),
    package_id TEXT NOT NULL REFERENCES change_packages_v5(package_id) ON DELETE CASCADE,
    source_revision INTEGER NOT NULL CHECK(source_revision >= 1),
    operation TEXT NOT NULL CHECK(operation IN ('UPSERT','DELETE')),
    payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
    updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(household_id,entity_kind,entity_id)
) STRICT, WITHOUT ROWID;

INSERT INTO change_packages_v5 SELECT * FROM change_packages;
INSERT INTO change_package_records_v5 SELECT * FROM change_package_records;
INSERT INTO applied_change_packages_v5 SELECT * FROM applied_change_packages;
INSERT INTO sync_replica_entity_heads_v5 SELECT * FROM sync_replica_entity_heads;
DROP TABLE change_package_records;
DROP TABLE applied_change_packages;
DROP TABLE sync_replica_entity_heads;
DROP TABLE change_packages;
ALTER TABLE change_packages_v5 RENAME TO change_packages;
ALTER TABLE change_package_records_v5 RENAME TO change_package_records;
ALTER TABLE applied_change_packages_v5 RENAME TO applied_change_packages;
ALTER TABLE sync_replica_entity_heads_v5 RENAME TO sync_replica_entity_heads;

CREATE UNIQUE INDEX idx_change_packages_one_active_target ON change_packages(target_household_id)
  WHERE state IN ('STAGED','REVIEW_REQUIRED','READY');
CREATE INDEX idx_change_packages_source_revision ON change_packages(source_installation_id,target_household_id,source_revision);
CREATE INDEX idx_change_package_records_review ON change_package_records(package_id,review_state,record_order);
CREATE INDEX idx_sync_replica_heads_source ON sync_replica_entity_heads(source_installation_id,household_id,source_revision,entity_kind,entity_id);

CREATE TRIGGER trg_change_package_record_kind_matches_schema_insert BEFORE INSERT ON change_package_records
WHEN (NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT') AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<2)
 OR (NEW.entity_kind IN ('PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE','INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT') AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<3)
 OR (NEW.entity_kind='RECURRING_SERIES_PREFERENCES' AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<5)
 OR (NEW.entity_kind='DASHBOARD_PREFERENCES' AND (
    ((SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<4 AND json_type(NEW.canonical_payload_json,'$.templateLayouts') IS NOT NULL)
    OR ((SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)>=4 AND COALESCE(json_type(NEW.canonical_payload_json,'$.templateLayouts'),'')!='array')))
BEGIN SELECT RAISE(ABORT,'record payload requires a matching package schema'); END;

CREATE TRIGGER trg_change_package_record_kind_matches_schema_update BEFORE UPDATE OF package_id,entity_kind,canonical_payload_json ON change_package_records
WHEN (NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT') AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<2)
 OR (NEW.entity_kind IN ('PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE','INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT') AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<3)
 OR (NEW.entity_kind='RECURRING_SERIES_PREFERENCES' AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<5)
 OR (NEW.entity_kind='DASHBOARD_PREFERENCES' AND (
    ((SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<4 AND json_type(NEW.canonical_payload_json,'$.templateLayouts') IS NOT NULL)
    OR ((SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)>=4 AND COALESCE(json_type(NEW.canonical_payload_json,'$.templateLayouts'),'')!='array')))
BEGIN SELECT RAISE(ABORT,'record payload requires a matching package schema'); END;

CREATE TRIGGER trg_change_package_schema_downgrade_guard BEFORE UPDATE OF schema_version ON change_packages
WHEN EXISTS(SELECT 1 FROM change_package_records r WHERE r.package_id=NEW.package_id AND (
  (NEW.schema_version<2 AND r.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT')) OR
  (NEW.schema_version<3 AND r.entity_kind IN ('PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE','INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT')) OR
  (NEW.schema_version<5 AND r.entity_kind='RECURRING_SERIES_PREFERENCES') OR
  (NEW.schema_version<4 AND r.entity_kind='DASHBOARD_PREFERENCES' AND json_type(r.canonical_payload_json,'$.templateLayouts')='array') OR
  (NEW.schema_version>=4 AND r.entity_kind='DASHBOARD_PREFERENCES' AND COALESCE(json_type(r.canonical_payload_json,'$.templateLayouts'),'')!='array')))
 OR EXISTS(SELECT 1 FROM sync_replica_entity_heads h WHERE h.package_id=NEW.package_id AND (
   (NEW.schema_version<2 AND h.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT')) OR
   (NEW.schema_version<3 AND h.entity_kind IN ('PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE','INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT')) OR
   (NEW.schema_version<5 AND h.entity_kind='RECURRING_SERIES_PREFERENCES')))
BEGIN SELECT RAISE(ABORT,'package schema change would invalidate staged lineage'); END;

CREATE TRIGGER trg_replica_entity_head_matches_schema_insert BEFORE INSERT ON sync_replica_entity_heads
WHEN (NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT') AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<2)
 OR (NEW.entity_kind IN ('PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE','INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT') AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<3)
 OR (NEW.entity_kind='RECURRING_SERIES_PREFERENCES' AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<5)
BEGIN SELECT RAISE(ABORT,'replica lineage requires a newer package schema'); END;
CREATE TRIGGER trg_replica_entity_head_matches_schema_update BEFORE UPDATE OF package_id,entity_kind ON sync_replica_entity_heads
WHEN (NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT') AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<2)
 OR (NEW.entity_kind IN ('PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT','INVESTMENT_FX_RATE','INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT') AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<3)
 OR (NEW.entity_kind='RECURRING_SERIES_PREFERENCES' AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id)<5)
BEGIN SELECT RAISE(ABORT,'replica lineage requires a newer package schema'); END;

CREATE TRIGGER trg_applied_change_package_matches_stage BEFORE INSERT ON applied_change_packages
WHEN NOT EXISTS(SELECT 1 FROM change_packages p WHERE p.package_id=NEW.package_id AND p.source_installation_id=NEW.source_installation_id AND p.target_household_id=NEW.household_id AND p.source_revision=NEW.source_revision AND p.snapshot_sha256=NEW.snapshot_sha256)
BEGIN SELECT RAISE(ABORT,'applied package receipt does not match staged package'); END;

CREATE VIEW sync_recurring_series_preferences_payloads AS
SELECT h.id AS household_id,
 json(json_object(
   'recordKind','RECURRING_SERIES_PREFERENCES',
   'householdId',h.id,
   'preferences',json(COALESCE((
     SELECT json_group_array(json_object(
       'normalizedPayee',p.normalized_payee,
       'decision',p.decision
     )) FROM (
       SELECT normalized_payee,decision
       FROM recurring_series_preferences
       WHERE household_id=h.id ORDER BY normalized_payee
     ) p
   ),'[]'))
 )) AS payload_json
FROM households h;

CREATE TRIGGER trg_sync_recurring_preference_identity_immutable
BEFORE UPDATE OF household_id,normalized_payee ON recurring_series_preferences
WHEN NEW.household_id!=OLD.household_id OR NEW.normalized_payee!=OLD.normalized_payee
BEGIN SELECT RAISE(ABORT,'recurring preference identity is immutable'); END;

CREATE TRIGGER trg_sync_capture_recurring_preference_insert AFTER INSERT ON recurring_series_preferences BEGIN
 INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
 SELECT household_id,'RECURRING_SERIES_PREFERENCES',household_id,'UPSERT',payload_json
 FROM sync_recurring_series_preferences_payloads WHERE household_id=NEW.household_id;
END;
CREATE TRIGGER trg_sync_capture_recurring_preference_update AFTER UPDATE ON recurring_series_preferences BEGIN
 INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
 SELECT household_id,'RECURRING_SERIES_PREFERENCES',household_id,'UPSERT',payload_json
 FROM sync_recurring_series_preferences_payloads WHERE household_id=NEW.household_id;
END;
CREATE TRIGGER trg_sync_capture_recurring_preference_delete AFTER DELETE ON recurring_series_preferences
WHEN EXISTS(SELECT 1 FROM households WHERE id=OLD.household_id) BEGIN
 INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
 SELECT household_id,'RECURRING_SERIES_PREFERENCES',household_id,'UPSERT',payload_json
 FROM sync_recurring_series_preferences_payloads WHERE household_id=OLD.household_id;
END;

INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT household_id,'RECURRING_SERIES_PREFERENCES',household_id,'UPSERT',payload_json
FROM sync_recurring_series_preferences_payloads;
