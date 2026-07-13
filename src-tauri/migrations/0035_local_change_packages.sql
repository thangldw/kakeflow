-- Durable, local-only staging for authoritative current-state change packages.
-- A package is reviewable before any domain row is changed. Remote transport,
-- authentication, and merge resolution remain outside this schema.
CREATE TABLE local_change_package_revisions (
    household_id TEXT PRIMARY KEY NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT, WITHOUT ROWID;

INSERT INTO local_change_package_revisions(household_id)
SELECT id FROM households ORDER BY id;

CREATE TRIGGER trg_local_change_package_revision_household_insert
AFTER INSERT ON households
BEGIN
    INSERT INTO local_change_package_revisions(household_id) VALUES(NEW.id);
END;

CREATE TABLE change_packages (
    package_id TEXT PRIMARY KEY NOT NULL
        CHECK (length(trim(package_id)) BETWEEN 1 AND 128),
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    target_household_id TEXT NOT NULL
        REFERENCES households(id) ON DELETE CASCADE,
    source_installation_id TEXT NOT NULL
        CHECK (length(trim(source_installation_id)) BETWEEN 1 AND 128),
    source_principal_id TEXT NOT NULL
        CHECK (length(trim(source_principal_id)) BETWEEN 1 AND 128),
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    snapshot_sha256 TEXT NOT NULL CHECK (
        length(snapshot_sha256) = 64
        AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    manifest_json TEXT NOT NULL CHECK (
        json_valid(manifest_json) AND json_type(manifest_json) = 'object'
    ),
    package_sha256 TEXT NOT NULL CHECK (
        length(package_sha256) = 64
        AND package_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    state TEXT NOT NULL DEFAULT 'STAGED' CHECK (state IN (
        'STAGED', 'REVIEW_REQUIRED', 'READY', 'APPLIED', 'REJECTED'
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
    CHECK (
        create_count + update_count + unchanged_count + delete_count + conflict_count
        = record_count
    ),
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

-- Only one package may occupy the actionable review slot for a household.
-- Applied and rejected packages remain durable lineage records.
CREATE UNIQUE INDEX idx_change_packages_one_active_target
    ON change_packages(target_household_id)
    WHERE state IN ('STAGED','REVIEW_REQUIRED','READY');
CREATE INDEX idx_change_packages_source_revision
    ON change_packages(source_installation_id,target_household_id,source_revision);

CREATE TABLE change_package_records (
    package_id TEXT NOT NULL
        REFERENCES change_packages(package_id) ON DELETE CASCADE,
    record_order INTEGER NOT NULL CHECK (record_order >= 0),
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'HOUSEHOLD', 'HOUSEHOLD_MEMBER', 'ACCOUNT', 'TRANSACTION',
        'MONTHLY_BUDGET_PLAN', 'SAVINGS_GOAL', 'CLASSIFICATION_RULE',
        'ACCOUNT_GROUP', 'CARD_SETTLEMENT_MAPPING', 'DASHBOARD_PREFERENCES',
        'DELIMITED_PARSER_PROFILE'
    )),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT','DELETE')),
    canonical_payload_json TEXT NOT NULL CHECK (
        json_valid(canonical_payload_json) AND json_type(canonical_payload_json) = 'object'
    ),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    review_state TEXT NOT NULL CHECK (review_state IN (
        'CREATE', 'UPDATE', 'UNCHANGED', 'DELETE', 'CONFLICT'
    )),
    resolution TEXT NOT NULL DEFAULT 'PENDING' CHECK (resolution IN (
        'PENDING', 'APPLY_INCOMING', 'KEEP_LOCAL', 'SKIP'
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
    PRIMARY KEY (package_id, record_order),
    UNIQUE (package_id, entity_kind, entity_id),
    CHECK (
        (review_state = 'CONFLICT' AND conflict_reason IS NOT NULL)
        OR (review_state != 'CONFLICT' AND conflict_reason IS NULL)
    )
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_change_package_records_review
    ON change_package_records(package_id,review_state,record_order);

-- A receipt is inserted in the same transaction as an atomic package apply.
-- The lineage revision uniqueness prevents two different snapshots from being
-- accepted as the same source revision.
CREATE TABLE applied_change_packages (
    package_id TEXT PRIMARY KEY NOT NULL
        REFERENCES change_packages(package_id) ON DELETE CASCADE,
    source_installation_id TEXT NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    snapshot_sha256 TEXT NOT NULL CHECK (
        length(snapshot_sha256) = 64
        AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (source_installation_id,household_id,source_revision)
) STRICT;

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

-- The last accepted source state for each entity is the safe baseline for
-- omission deletes and for detecting destination-local divergence.
CREATE TABLE sync_replica_entity_heads (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'HOUSEHOLD', 'HOUSEHOLD_MEMBER', 'ACCOUNT', 'TRANSACTION',
        'MONTHLY_BUDGET_PLAN', 'SAVINGS_GOAL', 'CLASSIFICATION_RULE',
        'ACCOUNT_GROUP', 'CARD_SETTLEMENT_MAPPING', 'DASHBOARD_PREFERENCES',
        'DELIMITED_PARSER_PROFILE'
    )),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    source_installation_id TEXT NOT NULL
        CHECK (length(trim(source_installation_id)) BETWEEN 1 AND 128),
    package_id TEXT NOT NULL REFERENCES change_packages(package_id) ON DELETE CASCADE,
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT','DELETE')),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id,entity_kind,entity_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_sync_replica_heads_source
    ON sync_replica_entity_heads(
        source_installation_id,household_id,source_revision,entity_kind,entity_id
    );

-- This guard exists only for the duration of an incoming apply transaction.
-- It intentionally has no foreign key: a HOUSEHOLD upsert may be the first
-- domain write in the transaction.
CREATE TABLE sync_apply_guard (
    household_id TEXT PRIMARY KEY NOT NULL
        CHECK (length(trim(household_id)) BETWEEN 1 AND 128),
    package_id TEXT NOT NULL CHECK (length(trim(package_id)) BETWEEN 1 AND 128),
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT, WITHOUT ROWID;

CREATE TRIGGER trg_sync_capture_ignore_incoming_apply
BEFORE INSERT ON sync_local_change_capture
WHEN EXISTS (
    SELECT 1 FROM sync_apply_guard g WHERE g.household_id=NEW.household_id
)
BEGIN
    SELECT RAISE(IGNORE);
END;

CREATE TRIGGER trg_sync_apply_guard_household_cleanup
AFTER DELETE ON households
BEGIN
    DELETE FROM sync_apply_guard WHERE household_id=OLD.id;
END;

-- Portable links preserve transaction provenance identifiers until the source
-- document/record graph is transported. They deliberately reference only the
-- transaction, so they cannot pretend the missing source row exists locally.
CREATE TABLE transaction_portable_source_links (
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    source_record_id TEXT NOT NULL
        CHECK (length(trim(source_record_id)) BETWEEN 1 AND 128),
    candidate_id TEXT CHECK (
        candidate_id IS NULL OR length(trim(candidate_id)) BETWEEN 1 AND 128
    ),
    PRIMARY KEY (transaction_id,source_record_id)
) STRICT, WITHOUT ROWID;

DROP VIEW sync_transaction_aggregate_payloads;
CREATE VIEW sync_transaction_aggregate_payloads AS
SELECT t.household_id,
       t.id AS transaction_id,
       json(json_object(
         'recordKind','TRANSACTION_AGGREGATE',
         'id',t.id,
         'householdId',t.household_id,
         'occurredOn',t.occurred_on,
         'postedOn',t.posted_on,
         'transactionType',t.transaction_type,
         'payee',t.payee,
         'description',t.description,
         'status',t.status,
         'calculationTarget',t.calculation_target,
         'attributionKind',t.attribution_kind,
         'attributedMemberId',t.attributed_member_id,
         'audienceVisibility',t.audience_visibility,
         'audienceMemberId',t.audience_member_id,
         'createdAt',t.created_at,
         'updatedAt',t.updated_at,
         'journalEntries',json(COALESCE((
           SELECT json_group_array(json_object(
             'id',j.id,'transactionId',j.transaction_id,'accountId',j.account_id,
             'entrySide',j.entry_side,'amountJpy',j.amount_jpy,
             'lineNumber',j.line_number,'createdAt',j.created_at
           )) FROM (
             SELECT id,transaction_id,account_id,entry_side,amount_jpy,line_number,created_at
             FROM journal_entries WHERE transaction_id=t.id ORDER BY line_number,id
           ) j
         ),'[]')),
         'labels',json(COALESCE((
           SELECT json_group_array(label) FROM (
             SELECT label FROM transaction_labels WHERE transaction_id=t.id ORDER BY label
           )
         ),'[]')),
         'tags',json(COALESCE((
           SELECT json_group_array(tag) FROM (
             SELECT tag FROM transaction_tags WHERE transaction_id=t.id ORDER BY tag
           )
         ),'[]')),
         'sourceLinks',json(COALESCE((
           SELECT json_group_array(json_object(
             'transactionId',s.transaction_id,
             'sourceRecordId',s.source_record_id,
             'candidateId',s.candidate_id
           )) FROM (
             SELECT transaction_id,source_record_id,candidate_id
             FROM transaction_sources WHERE transaction_id=t.id
             UNION ALL
             SELECT p.transaction_id,p.source_record_id,p.candidate_id
             FROM transaction_portable_source_links p
             WHERE p.transaction_id=t.id AND NOT EXISTS (
               SELECT 1 FROM transaction_sources actual
               WHERE actual.transaction_id=p.transaction_id
                 AND actual.source_record_id=p.source_record_id
             )
             ORDER BY source_record_id
           ) s
         ),'[]')),
         'externalKeys',json(COALESCE((
           SELECT json_group_array(json_object(
             'householdId',k.household_id,'externalSource',k.external_source,
             'externalId',k.external_id,'factHash',k.fact_hash,
             'transactionId',k.transaction_id,'createdAt',k.created_at
           )) FROM (
             SELECT household_id,external_source,external_id,fact_hash,transaction_id,created_at
             FROM transaction_external_keys WHERE transaction_id=t.id
             ORDER BY external_source,external_id
           ) k
         ),'[]'))
       )) AS payload_json
FROM transactions t;

CREATE TRIGGER trg_sync_capture_portable_source_insert
AFTER INSERT ON transaction_portable_source_links
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;

CREATE TRIGGER trg_sync_capture_portable_source_update
AFTER UPDATE ON transaction_portable_source_links
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads
  WHERE transaction_id=OLD.transaction_id AND OLD.transaction_id!=NEW.transaction_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;

CREATE TRIGGER trg_sync_capture_portable_source_delete
AFTER DELETE ON transaction_portable_source_links
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads p
  WHERE transaction_id=OLD.transaction_id
    AND EXISTS(SELECT 1 FROM households h WHERE h.id=p.household_id);
END;
