-- Family snapshot schema v2 adds the complete planning/configuration graph.
-- Existing schema-v1 manifests and lineage remain readable.

ALTER TABLE family_snapshot_sets ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1
  CHECK(schema_version IN (1,2));

ALTER TABLE family_snapshot_records RENAME TO family_snapshot_records_v1;
CREATE TABLE family_snapshot_records (
    snapshot_set_id TEXT NOT NULL,
    partition_order INTEGER NOT NULL,
    record_order INTEGER NOT NULL CHECK (record_order >= 0),
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'HOUSEHOLD','HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION',
        'MONTHLY_BUDGET_PLAN','SAVINGS_GOAL','CLASSIFICATION_RULE','ACCOUNT_GROUP',
        'CARD_SETTLEMENT_MAPPING','DASHBOARD_PREFERENCES','DELIMITED_PARSER_PROFILE'
    )),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT','DELETE')),
    canonical_payload_json TEXT NOT NULL CHECK (
        json_valid(canonical_payload_json) AND json_type(canonical_payload_json)='object'
    ),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    review_state TEXT NOT NULL CHECK (review_state IN (
        'CREATE','UPDATE','UNCHANGED','DELETE','CONFLICT'
    )),
    resolution TEXT NOT NULL CHECK (resolution IN (
        'PENDING','APPLY_INCOMING','KEEP_LOCAL','SKIP'
    )),
    current_payload_sha256 TEXT CHECK (
        current_payload_sha256 IS NULL OR (
            length(current_payload_sha256)=64
            AND current_payload_sha256 NOT GLOB '*[^0-9a-f]*'
        )
    ),
    conflict_reason TEXT,
    PRIMARY KEY(snapshot_set_id,partition_order,record_order),
    UNIQUE(snapshot_set_id,entity_kind,entity_id),
    FOREIGN KEY(snapshot_set_id,partition_order)
        REFERENCES family_snapshot_partitions(snapshot_set_id,partition_order) ON DELETE CASCADE,
    CHECK ((review_state='CONFLICT' AND conflict_reason IS NOT NULL)
        OR (review_state!='CONFLICT' AND conflict_reason IS NULL))
) STRICT, WITHOUT ROWID;
INSERT INTO family_snapshot_records SELECT * FROM family_snapshot_records_v1;
DROP TABLE family_snapshot_records_v1;
CREATE INDEX idx_family_snapshot_records_review
    ON family_snapshot_records(snapshot_set_id,review_state,partition_order,record_order);

ALTER TABLE family_replica_entity_heads RENAME TO family_replica_entity_heads_v1;
CREATE TABLE family_replica_entity_heads (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    visibility TEXT NOT NULL CHECK (visibility IN ('SHARED','PERSONAL')),
    member_id TEXT,
    member_key TEXT NOT NULL,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'HOUSEHOLD','HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION',
        'MONTHLY_BUDGET_PLAN','SAVINGS_GOAL','CLASSIFICATION_RULE','ACCOUNT_GROUP',
        'CARD_SETTLEMENT_MAPPING','DASHBOARD_PREFERENCES','DELIMITED_PARSER_PROFILE'
    )),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    source_installation_id TEXT NOT NULL,
    package_id TEXT NOT NULL REFERENCES family_applied_partitions(package_id) ON DELETE CASCADE,
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT','DELETE')),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(household_id,visibility,member_key,entity_kind,entity_id),
    CHECK ((visibility='SHARED' AND member_id IS NULL AND member_key='')
        OR (visibility='PERSONAL' AND member_id IS NOT NULL AND member_key=member_id))
) STRICT, WITHOUT ROWID;
INSERT INTO family_replica_entity_heads SELECT * FROM family_replica_entity_heads_v1;
DROP TABLE family_replica_entity_heads_v1;
CREATE INDEX idx_family_replica_heads_source_partition ON family_replica_entity_heads(
  source_installation_id,household_id,visibility,member_key,source_revision
);

ALTER TABLE family_delivery_deliveries ADD COLUMN artifact_schema TEXT NOT NULL
  DEFAULT 'FAMILY_AUDIENCE_PARTITION_V1'
  CHECK(artifact_schema IN ('FAMILY_AUDIENCE_PARTITION_V1','FAMILY_AUDIENCE_PARTITION_V2'));

-- Last relay-accepted outbound membership of each entity. This is the only
-- basis for emitting a cross-partition relocation marker, preventing a shared
-- artifact from exposing identifiers for never-shared personal records.
CREATE TABLE family_delivery_outbound_entity_heads (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL CHECK(visibility IN ('SHARED','PERSONAL')),
  member_id TEXT,
  member_key TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN (
    'HOUSEHOLD','HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION','MONTHLY_BUDGET_PLAN',
    'SAVINGS_GOAL','CLASSIFICATION_RULE','ACCOUNT_GROUP','CARD_SETTLEMENT_MAPPING',
    'DASHBOARD_PREFERENCES','DELIMITED_PARSER_PROFILE'
  )),
  entity_id TEXT NOT NULL CHECK(length(trim(entity_id)) BETWEEN 1 AND 128),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  accepted_at TEXT NOT NULL,
  PRIMARY KEY(household_id,visibility,member_key,entity_kind,entity_id),
  CHECK((visibility='SHARED' AND member_id IS NULL AND member_key='') OR
        (visibility='PERSONAL' AND member_id IS NOT NULL AND member_key=member_id))
) STRICT, WITHOUT ROWID;

CREATE TABLE family_delivery_outbound_lineage_state (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  audience_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('LEGACY_UNKNOWN','V2_TRACKED')),
  updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(household_id,audience_key),
  FOREIGN KEY(household_id,audience_key)
    REFERENCES family_delivery_partition_state(household_id,audience_key) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

-- V1 accepted artifacts no longer have package bytes, so their entity set
-- cannot be reconstructed. Disable omission authority for exactly those
-- audiences until one complete V2 baseline is relay-accepted.
INSERT INTO family_delivery_outbound_lineage_state(household_id,audience_key,state)
SELECT p.household_id,p.audience_key,
       CASE WHEN EXISTS(
         SELECT 1 FROM family_delivery_deliveries d
         WHERE d.household_id=p.household_id AND d.audience_key=p.audience_key
           AND d.state='RELAY_ACCEPTED'
           AND d.artifact_schema='FAMILY_AUDIENCE_PARTITION_V1'
       ) THEN 'LEGACY_UNKNOWN' ELSE 'V2_TRACKED' END
FROM family_delivery_partition_state p;

ALTER TABLE family_delivery_inbound RENAME TO family_delivery_inbound_v1;
CREATE TABLE family_delivery_inbound (
    artifact_id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES family_delivery_connections(household_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    package_sha256 TEXT NOT NULL CHECK (length(package_sha256)=64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'),
    created_at TEXT NOT NULL,
    origin_device_id TEXT NOT NULL CHECK (length(trim(origin_device_id)) BETWEEN 1 AND 128),
    sender_membership_id TEXT NOT NULL CHECK (length(trim(sender_membership_id)) BETWEEN 1 AND 128),
    sender_member_id TEXT NOT NULL,
    sender_member_name TEXT NOT NULL CHECK (length(trim(sender_member_name)) BETWEEN 1 AND 256),
    visibility TEXT NOT NULL CHECK (visibility IN ('SHARED','PERSONAL')),
    member_id TEXT,
    member_key TEXT NOT NULL,
    member_name TEXT,
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 67108864),
    artifact_schema TEXT NOT NULL CHECK (artifact_schema IN (
      'FAMILY_AUDIENCE_PARTITION_V1','FAMILY_AUDIENCE_PARTITION_V2'
    )),
    state TEXT NOT NULL CHECK (state IN (
      'AVAILABLE','DOWNLOADING','WAITING_FOR_REVIEW','READY_TO_APPLY','APPLIED','DUPLICATE',
      'REJECTED_INVALID','AUDIENCE_DENIED','FAILED_RETRYABLE'
    )),
    received_before_revocation INTEGER NOT NULL DEFAULT 0 CHECK (received_before_revocation IN (0,1)),
    staged_snapshot_set_id TEXT REFERENCES family_snapshot_sets(snapshot_set_id) ON DELETE SET NULL,
    registered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(household_id,sequence),
    CHECK ((visibility='SHARED' AND member_id IS NULL AND member_key='' AND member_name IS NULL)
      OR (visibility='PERSONAL' AND member_id IS NOT NULL AND member_key=member_id AND member_name IS NOT NULL)),
    FOREIGN KEY(household_id,sender_member_id)
      REFERENCES household_members(household_id,id) ON DELETE RESTRICT
) STRICT;
INSERT INTO family_delivery_inbound SELECT * FROM family_delivery_inbound_v1;
DROP TABLE family_delivery_inbound_v1;
CREATE INDEX idx_family_delivery_inbound_state
  ON family_delivery_inbound(household_id,state,sequence);

-- All local planning/configuration edits conservatively dirty both audience
-- partitions. Export computes the exact least-widening partition afterwards.
CREATE TRIGGER trg_family_delivery_budget_dirty_insert AFTER INSERT ON monthly_category_budgets
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_budget_dirty_update AFTER UPDATE ON monthly_category_budgets
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_budget_dirty_delete AFTER DELETE ON monthly_category_budgets
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=OLD.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=OLD.household_id; END;

CREATE TRIGGER trg_family_delivery_goal_dirty_insert AFTER INSERT ON savings_goals
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_goal_dirty_update AFTER UPDATE ON savings_goals
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_goal_dirty_delete AFTER DELETE ON savings_goals
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=OLD.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=OLD.household_id; END;

CREATE TRIGGER trg_family_delivery_rule_dirty_insert AFTER INSERT ON classification_rules
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_rule_dirty_update AFTER UPDATE ON classification_rules
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_rule_dirty_delete AFTER DELETE ON classification_rules
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=OLD.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=OLD.household_id; END;
CREATE TRIGGER trg_family_delivery_rule_label_dirty_insert AFTER INSERT ON classification_rule_labels BEGIN
 UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=(SELECT household_id FROM classification_rules WHERE id=NEW.rule_id)
 AND NOT EXISTS(SELECT 1 FROM sync_apply_guard WHERE household_id=(SELECT household_id FROM classification_rules WHERE id=NEW.rule_id)); END;
CREATE TRIGGER trg_family_delivery_rule_label_dirty_delete AFTER DELETE ON classification_rule_labels BEGIN
 UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=(SELECT household_id FROM classification_rules WHERE id=OLD.rule_id)
 AND NOT EXISTS(SELECT 1 FROM sync_apply_guard WHERE household_id=(SELECT household_id FROM classification_rules WHERE id=OLD.rule_id)); END;
CREATE TRIGGER trg_family_delivery_rule_tag_dirty_insert AFTER INSERT ON classification_rule_tags BEGIN
 UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=(SELECT household_id FROM classification_rules WHERE id=NEW.rule_id)
 AND NOT EXISTS(SELECT 1 FROM sync_apply_guard WHERE household_id=(SELECT household_id FROM classification_rules WHERE id=NEW.rule_id)); END;
CREATE TRIGGER trg_family_delivery_rule_tag_dirty_delete AFTER DELETE ON classification_rule_tags BEGIN
 UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=(SELECT household_id FROM classification_rules WHERE id=OLD.rule_id)
 AND NOT EXISTS(SELECT 1 FROM sync_apply_guard WHERE household_id=(SELECT household_id FROM classification_rules WHERE id=OLD.rule_id)); END;

CREATE TRIGGER trg_family_delivery_group_dirty_insert AFTER INSERT ON account_groups
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_group_dirty_update AFTER UPDATE ON account_groups
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_group_dirty_delete AFTER DELETE ON account_groups
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=OLD.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=OLD.household_id; END;
CREATE TRIGGER trg_family_delivery_group_member_dirty_insert AFTER INSERT ON account_group_members
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_group_member_dirty_update AFTER UPDATE ON account_group_members
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_group_member_dirty_delete AFTER DELETE ON account_group_members
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=OLD.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=OLD.household_id; END;

CREATE TRIGGER trg_family_delivery_mapping_dirty_insert AFTER INSERT ON card_settlement_bank_mappings
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_mapping_dirty_update AFTER UPDATE ON card_settlement_bank_mappings
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_mapping_dirty_delete AFTER DELETE ON card_settlement_bank_mappings
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=OLD.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=OLD.household_id; END;

CREATE TRIGGER trg_family_delivery_dashboard_dirty_insert AFTER INSERT ON dashboard_preferences
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_dashboard_dirty_update AFTER UPDATE ON dashboard_preferences
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_dashboard_dirty_delete AFTER DELETE ON dashboard_preferences
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=OLD.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=OLD.household_id; END;
CREATE TRIGGER trg_family_delivery_layout_dirty_insert AFTER INSERT ON dashboard_template_layouts
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_layout_dirty_update AFTER UPDATE ON dashboard_template_layouts
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_layout_dirty_delete AFTER DELETE ON dashboard_template_layouts
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=OLD.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=OLD.household_id; END;

CREATE TRIGGER trg_family_delivery_parser_dirty_insert AFTER INSERT ON delimited_parser_profiles
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_parser_dirty_update AFTER UPDATE ON delimited_parser_profiles
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=NEW.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id; END;
CREATE TRIGGER trg_family_delivery_parser_dirty_delete AFTER DELETE ON delimited_parser_profiles
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard WHERE household_id=OLD.household_id)
BEGIN UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=OLD.household_id; END;
