-- Replicate the two authoritative reconciliation aggregates introduced by the
-- card domain. Package schema 1 remains valid for its original eleven kinds;
-- schema 2 adds CARD_STATEMENT and CARD_PAYMENT without rewriting old lineage.

DROP TRIGGER trg_applied_change_package_matches_stage;

CREATE TABLE change_packages_v2 (
    package_id TEXT PRIMARY KEY NOT NULL
        CHECK (length(trim(package_id)) BETWEEN 1 AND 128),
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version IN (1,2)),
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

CREATE TABLE change_package_records_v2 (
    package_id TEXT NOT NULL REFERENCES change_packages_v2(package_id) ON DELETE CASCADE,
    record_order INTEGER NOT NULL CHECK (record_order >= 0),
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'HOUSEHOLD','HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION',
        'MONTHLY_BUDGET_PLAN','SAVINGS_GOAL','CLASSIFICATION_RULE',
        'ACCOUNT_GROUP','CARD_SETTLEMENT_MAPPING','DASHBOARD_PREFERENCES',
        'DELIMITED_PARSER_PROFILE','CARD_STATEMENT','CARD_PAYMENT'
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

CREATE TABLE applied_change_packages_v2 (
    package_id TEXT PRIMARY KEY NOT NULL
        REFERENCES change_packages_v2(package_id) ON DELETE CASCADE,
    source_installation_id TEXT NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    snapshot_sha256 TEXT NOT NULL CHECK (
        length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (source_installation_id,household_id,source_revision)
) STRICT;

CREATE TABLE sync_replica_entity_heads_v2 (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'HOUSEHOLD','HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION',
        'MONTHLY_BUDGET_PLAN','SAVINGS_GOAL','CLASSIFICATION_RULE',
        'ACCOUNT_GROUP','CARD_SETTLEMENT_MAPPING','DASHBOARD_PREFERENCES',
        'DELIMITED_PARSER_PROFILE','CARD_STATEMENT','CARD_PAYMENT'
    )),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    source_installation_id TEXT NOT NULL
        CHECK (length(trim(source_installation_id)) BETWEEN 1 AND 128),
    package_id TEXT NOT NULL REFERENCES change_packages_v2(package_id) ON DELETE CASCADE,
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT','DELETE')),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id,entity_kind,entity_id)
) STRICT, WITHOUT ROWID;

INSERT INTO change_packages_v2 SELECT * FROM change_packages;
INSERT INTO change_package_records_v2 SELECT * FROM change_package_records;
INSERT INTO applied_change_packages_v2 SELECT * FROM applied_change_packages;
INSERT INTO sync_replica_entity_heads_v2 SELECT * FROM sync_replica_entity_heads;

DROP TABLE change_package_records;
DROP TABLE applied_change_packages;
DROP TABLE sync_replica_entity_heads;
DROP TABLE change_packages;

ALTER TABLE change_packages_v2 RENAME TO change_packages;
ALTER TABLE change_package_records_v2 RENAME TO change_package_records;
ALTER TABLE applied_change_packages_v2 RENAME TO applied_change_packages;
ALTER TABLE sync_replica_entity_heads_v2 RENAME TO sync_replica_entity_heads;

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
WHEN NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT')
 AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) != 2
BEGIN
    SELECT RAISE(ABORT,'card reconciliation records require package schema 2');
END;

CREATE TRIGGER trg_change_package_record_kind_matches_schema_update
BEFORE UPDATE OF package_id,entity_kind ON change_package_records
WHEN NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT')
 AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) != 2
BEGIN
    SELECT RAISE(ABORT,'card reconciliation records require package schema 2');
END;

CREATE TRIGGER trg_change_package_schema_downgrade_guard
BEFORE UPDATE OF schema_version ON change_packages
WHEN NEW.schema_version=1 AND (
  EXISTS(SELECT 1 FROM change_package_records r
         WHERE r.package_id=NEW.package_id
           AND r.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT'))
  OR EXISTS(SELECT 1 FROM sync_replica_entity_heads h
            WHERE h.package_id=NEW.package_id
              AND h.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT'))
)
BEGIN
    SELECT RAISE(ABORT,'package schema 2 is required by card reconciliation lineage');
END;

CREATE TRIGGER trg_replica_card_head_matches_schema_insert
BEFORE INSERT ON sync_replica_entity_heads
WHEN NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT')
 AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) != 2
BEGIN
    SELECT RAISE(ABORT,'card reconciliation lineage requires package schema 2');
END;

CREATE TRIGGER trg_replica_card_head_matches_schema_update
BEFORE UPDATE OF package_id,entity_kind ON sync_replica_entity_heads
WHEN NEW.entity_kind IN ('CARD_STATEMENT','CARD_PAYMENT')
 AND (SELECT schema_version FROM change_packages WHERE package_id=NEW.package_id) != 2
BEGIN
    SELECT RAISE(ABORT,'card reconciliation lineage requires package schema 2');
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

-- A destination can retain the source-document identifier even when the raw
-- provenance graph is not part of the package. If an actual local document is
-- linked, it is authoritative and the portable identifier remains dormant.
CREATE TABLE card_statement_portable_source_refs (
    statement_id TEXT PRIMARY KEY NOT NULL
        REFERENCES card_statements(id) ON DELETE CASCADE,
    source_document_id TEXT NOT NULL
        CHECK (length(trim(source_document_id)) BETWEEN 1 AND 128)
) STRICT, WITHOUT ROWID;

CREATE VIEW sync_card_statement_aggregate_payloads AS
SELECT s.household_id,
       s.id AS statement_id,
       json(json_object(
         'recordKind','CARD_STATEMENT',
         'id',s.id,
         'householdId',s.household_id,
         'cardAccountId',s.card_account_id,
         'periodStart',s.period_start,
         'periodEnd',s.period_end,
         'paymentDueOn',s.payment_due_on,
         'statementAmountJpy',s.statement_amount_jpy,
         'reconciliationStatus',s.reconciliation_status,
         'sourceDocumentId',COALESCE(s.source_document_id,p.source_document_id),
         'createdAt',s.created_at,
         'lines',json(COALESCE((
           SELECT json_group_array(json_object(
             'statementId',line.statement_id,
             'transactionId',line.transaction_id,
             'statementLineNumber',line.statement_line_number,
             'billedAmountJpy',line.billed_amount_jpy
           ))
           FROM (
             SELECT statement_id,transaction_id,statement_line_number,billed_amount_jpy
             FROM card_statement_transactions
             WHERE statement_id=s.id
             ORDER BY statement_line_number,transaction_id
           ) line
         ),'[]'))
       )) AS payload_json
FROM card_statements s
LEFT JOIN card_statement_portable_source_refs p ON p.statement_id=s.id;

CREATE VIEW sync_card_payment_payloads AS
SELECT p.household_id,
       p.id AS payment_id,
       json(json_object(
         'recordKind','CARD_PAYMENT',
         'id',p.id,
         'householdId',p.household_id,
         'statementId',p.statement_id,
         'bankTransactionId',p.bank_transaction_id,
         'cardAccountId',p.card_account_id,
         'paymentAmountJpy',p.payment_amount_jpy,
         'paymentOn',p.payment_on,
         'matchScoreBps',p.match_score_bps,
         'reconciliationStatus',p.reconciliation_status,
         'createdAt',p.created_at,
         'confirmedAt',p.confirmed_at
       )) AS payload_json
FROM card_payments p;

CREATE TRIGGER trg_sync_capture_card_statement_insert
AFTER INSERT ON card_statements
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_STATEMENT',statement_id,'UPSERT',payload_json
  FROM sync_card_statement_aggregate_payloads WHERE statement_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_card_statement_update
AFTER UPDATE ON card_statements
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT OLD.household_id,'CARD_STATEMENT',OLD.id,'DELETE',json(json_object(
    'recordKind','CARD_STATEMENT','id',OLD.id,'householdId',OLD.household_id
  )) WHERE OLD.id!=NEW.id OR OLD.household_id!=NEW.household_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_STATEMENT',statement_id,'UPSERT',payload_json
  FROM sync_card_statement_aggregate_payloads WHERE statement_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_card_statement_delete
AFTER DELETE ON card_statements
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'CARD_STATEMENT',OLD.id,'DELETE',json(json_object(
    'recordKind','CARD_STATEMENT','id',OLD.id,'householdId',OLD.household_id
  )));
END;

CREATE TRIGGER trg_sync_capture_card_statement_line_insert
AFTER INSERT ON card_statement_transactions
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_STATEMENT',statement_id,'UPSERT',payload_json
  FROM sync_card_statement_aggregate_payloads WHERE statement_id=NEW.statement_id;
END;

CREATE TRIGGER trg_sync_capture_card_statement_line_update
AFTER UPDATE ON card_statement_transactions
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_STATEMENT',statement_id,'UPSERT',payload_json
  FROM sync_card_statement_aggregate_payloads
  WHERE statement_id=OLD.statement_id AND OLD.statement_id!=NEW.statement_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_STATEMENT',statement_id,'UPSERT',payload_json
  FROM sync_card_statement_aggregate_payloads WHERE statement_id=NEW.statement_id;
END;

CREATE TRIGGER trg_sync_capture_card_statement_line_delete
AFTER DELETE ON card_statement_transactions
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_STATEMENT',statement_id,'UPSERT',payload_json
  FROM sync_card_statement_aggregate_payloads WHERE statement_id=OLD.statement_id;
END;

CREATE TRIGGER trg_sync_capture_card_statement_portable_ref_insert
AFTER INSERT ON card_statement_portable_source_refs
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_STATEMENT',statement_id,'UPSERT',payload_json
  FROM sync_card_statement_aggregate_payloads WHERE statement_id=NEW.statement_id;
END;

CREATE TRIGGER trg_sync_capture_card_statement_portable_ref_update
AFTER UPDATE ON card_statement_portable_source_refs
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_STATEMENT',statement_id,'UPSERT',payload_json
  FROM sync_card_statement_aggregate_payloads
  WHERE statement_id=OLD.statement_id AND OLD.statement_id!=NEW.statement_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_STATEMENT',statement_id,'UPSERT',payload_json
  FROM sync_card_statement_aggregate_payloads WHERE statement_id=NEW.statement_id;
END;

CREATE TRIGGER trg_sync_capture_card_statement_portable_ref_delete
AFTER DELETE ON card_statement_portable_source_refs
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_STATEMENT',statement_id,'UPSERT',payload_json
  FROM sync_card_statement_aggregate_payloads WHERE statement_id=OLD.statement_id;
END;

CREATE TRIGGER trg_sync_capture_card_payment_insert
AFTER INSERT ON card_payments
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_PAYMENT',payment_id,'UPSERT',payload_json
  FROM sync_card_payment_payloads WHERE payment_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_card_payment_update
AFTER UPDATE ON card_payments
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT OLD.household_id,'CARD_PAYMENT',OLD.id,'DELETE',json(json_object(
    'recordKind','CARD_PAYMENT','id',OLD.id,'householdId',OLD.household_id
  )) WHERE OLD.id!=NEW.id OR OLD.household_id!=NEW.household_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CARD_PAYMENT',payment_id,'UPSERT',payload_json
  FROM sync_card_payment_payloads WHERE payment_id=NEW.id;
END;

CREATE TRIGGER trg_sync_capture_card_payment_delete
AFTER DELETE ON card_payments
BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'CARD_PAYMENT',OLD.id,'DELETE',json(json_object(
    'recordKind','CARD_PAYMENT','id',OLD.id,'householdId',OLD.household_id
  )));
END;

-- Seed one complete aggregate per existing entity. The drain takes only the
-- newest unprocessed capture for each (household,kind,id), so this is safe on
-- an upgraded installation with historical child-row captures.
INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT household_id,'CARD_STATEMENT',statement_id,'UPSERT',payload_json
FROM sync_card_statement_aggregate_payloads ORDER BY household_id,statement_id;

INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT household_id,'CARD_PAYMENT',payment_id,'UPSERT',payload_json
FROM sync_card_payment_payloads ORDER BY household_id,payment_id;
