-- Family snapshot schema v4 adds the authoritative recurring-series review
-- aggregate and a distinct KFF4/V4 delivery contract. Widen the released
-- family tables in place so every V1-V3 row, KFE1 retry cache, index, and
-- consistency trigger remains byte-for-byte intact.

PRAGMA writable_schema=ON;

UPDATE sqlite_schema
SET sql=replace(
  sql,
  'CHECK(schema_version IN (1,2,3))',
  'CHECK(schema_version IN (1,2,3,4))'
)
WHERE type='table' AND name='family_snapshot_sets'
  AND instr(sql, 'CHECK(schema_version IN (1,2,3))')>0;

UPDATE sqlite_schema
SET sql=replace(
  sql,
  '''DELIMITED_PARSER_PROFILE''',
  '''DELIMITED_PARSER_PROFILE'',''CARD_STATEMENT'',''CARD_PAYMENT'',''PORTFOLIO_SNAPSHOT'',''BROKERAGE_EVENT'',''INVESTMENT_FX_RATE'',''INVESTMENT_MARKET_PRICE'',''AGGREGATE_ASSET_SNAPSHOT'',''RECURRING_SERIES_PREFERENCES'''
)
WHERE type='table' AND name IN (
  'family_snapshot_records',
  'family_replica_entity_heads',
  'family_delivery_outbound_entity_heads'
) AND instr(sql, '''RECURRING_SERIES_PREFERENCES''')=0;

UPDATE sqlite_schema
SET sql=replace(
  sql,
  '''FAMILY_AUDIENCE_PARTITION_V3''',
  '''FAMILY_AUDIENCE_PARTITION_V3'',''FAMILY_AUDIENCE_PARTITION_V4'''
)
WHERE type='table' AND name IN (
  'family_delivery_deliveries',
  'family_delivery_inbound'
) AND instr(sql, '''FAMILY_AUDIENCE_PARTITION_V4''')=0;

PRAGMA writable_schema=RESET;

CREATE TEMP TABLE assert_family_schema_v4(
  valid INTEGER NOT NULL CHECK(valid=1)
);
INSERT INTO assert_family_schema_v4(valid)
SELECT instr(sql, 'schema_version IN (1,2,3,4)')>0
FROM sqlite_schema WHERE type='table' AND name='family_snapshot_sets';
INSERT INTO assert_family_schema_v4(valid)
SELECT instr(sql, '''CARD_STATEMENT''')>0
   AND instr(sql, '''RECURRING_SERIES_PREFERENCES''')>0
FROM sqlite_schema
WHERE type='table' AND name IN (
  'family_snapshot_records',
  'family_replica_entity_heads',
  'family_delivery_outbound_entity_heads'
);
INSERT INTO assert_family_schema_v4(valid)
SELECT instr(sql, '''FAMILY_AUDIENCE_PARTITION_V4''')>0
FROM sqlite_schema
WHERE type='table' AND name IN (
  'family_delivery_deliveries',
  'family_delivery_inbound'
);
DROP TABLE assert_family_schema_v4;

-- Fail closed if a caller tries to persist a newer record under an older
-- family manifest. The Rust validator enforces the same exact version map.
CREATE TRIGGER trg_family_snapshot_record_kind_matches_schema_insert
BEFORE INSERT ON family_snapshot_records
WHEN (NEW.entity_kind IN (
        'MONTHLY_BUDGET_PLAN','SAVINGS_GOAL','CLASSIFICATION_RULE','ACCOUNT_GROUP',
        'CARD_SETTLEMENT_MAPPING','DASHBOARD_PREFERENCES','DELIMITED_PARSER_PROFILE'
      ) AND (SELECT schema_version FROM family_snapshot_sets
             WHERE snapshot_set_id=NEW.snapshot_set_id)<2)
 OR (NEW.entity_kind IN (
        'CARD_STATEMENT','CARD_PAYMENT','PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT',
        'INVESTMENT_FX_RATE','INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
      ) AND (SELECT schema_version FROM family_snapshot_sets
             WHERE snapshot_set_id=NEW.snapshot_set_id)<3)
 OR (NEW.entity_kind='RECURRING_SERIES_PREFERENCES'
      AND (SELECT schema_version FROM family_snapshot_sets
           WHERE snapshot_set_id=NEW.snapshot_set_id)<4)
BEGIN SELECT RAISE(ABORT,'family record requires a matching snapshot schema'); END;

CREATE TRIGGER trg_family_snapshot_record_kind_matches_schema_update
BEFORE UPDATE OF snapshot_set_id,entity_kind ON family_snapshot_records
WHEN (NEW.entity_kind IN (
        'MONTHLY_BUDGET_PLAN','SAVINGS_GOAL','CLASSIFICATION_RULE','ACCOUNT_GROUP',
        'CARD_SETTLEMENT_MAPPING','DASHBOARD_PREFERENCES','DELIMITED_PARSER_PROFILE'
      ) AND (SELECT schema_version FROM family_snapshot_sets
             WHERE snapshot_set_id=NEW.snapshot_set_id)<2)
 OR (NEW.entity_kind IN (
        'CARD_STATEMENT','CARD_PAYMENT','PORTFOLIO_SNAPSHOT','BROKERAGE_EVENT',
        'INVESTMENT_FX_RATE','INVESTMENT_MARKET_PRICE','AGGREGATE_ASSET_SNAPSHOT'
      ) AND (SELECT schema_version FROM family_snapshot_sets
             WHERE snapshot_set_id=NEW.snapshot_set_id)<3)
 OR (NEW.entity_kind='RECURRING_SERIES_PREFERENCES'
      AND (SELECT schema_version FROM family_snapshot_sets
           WHERE snapshot_set_id=NEW.snapshot_set_id)<4)
BEGIN SELECT RAISE(ABORT,'family record requires a matching snapshot schema'); END;

-- A preference aggregate is household-wide. Only SHARED becomes dirty; the
-- PERSONAL partition neither carries nor claims authority for normalized
-- payees. Explicit family/change-package apply is guarded against echo.
CREATE TRIGGER trg_family_delivery_recurring_preference_dirty_insert
AFTER INSERT ON recurring_series_preferences
WHEN NOT EXISTS (
  SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id
)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
  WHERE household_id=NEW.household_id AND audience_key='SHARED';
END;

CREATE TRIGGER trg_family_delivery_recurring_preference_dirty_update
AFTER UPDATE ON recurring_series_preferences
WHEN NOT EXISTS (
  SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id
)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
  WHERE household_id=NEW.household_id AND audience_key='SHARED';
END;

CREATE TRIGGER trg_family_delivery_recurring_preference_dirty_delete
AFTER DELETE ON recurring_series_preferences
WHEN NOT EXISTS (
  SELECT 1 FROM sync_apply_guard WHERE household_id=OLD.household_id
)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
  WHERE household_id=OLD.household_id AND audience_key='SHARED';
END;
