-- Evidence identifiers are only unique within the installation that produced
-- them. Preserve that origin on every alias and card-statement source edge so
-- two family devices may legitimately use the same local identifier.

-- V3 remains byte-compatible with stored V1/V2 deliveries while admitting the
-- evidence-bearing KFF3 artifact. Inbound bytes are retained through explicit
-- review until apply or discard, so a restart cannot lose downloaded evidence
-- between relay receipt, staging, and the user's final decision.
ALTER TABLE family_delivery_deliveries RENAME TO family_delivery_deliveries_0048;
CREATE TABLE family_delivery_deliveries (
    delivery_id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES family_delivery_connections(household_id) ON DELETE CASCADE,
    audience_key TEXT NOT NULL,
    artifact_id TEXT NOT NULL CHECK (length(trim(artifact_id)) BETWEEN 1 AND 128),
    package_sha256 TEXT NOT NULL CHECK (
        length(package_sha256)=64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    origin_device_id TEXT NOT NULL CHECK (length(trim(origin_device_id)) BETWEEN 1 AND 128),
    visibility TEXT NOT NULL CHECK (visibility IN ('SHARED','PERSONAL')),
    member_id TEXT,
    item_count INTEGER NOT NULL CHECK (item_count >= 0),
    excluded_count INTEGER NOT NULL CHECK (excluded_count >= 0),
    package_bytes BLOB CHECK (package_bytes IS NULL OR length(package_bytes) BETWEEN 1 AND 67108864),
    state TEXT NOT NULL CHECK (state IN ('SENDING','RELAY_ACCEPTED','FAILED_RETRYABLE')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    accepted_at TEXT,
    artifact_schema TEXT NOT NULL CHECK (artifact_schema IN (
      'FAMILY_AUDIENCE_PARTITION_V1','FAMILY_AUDIENCE_PARTITION_V2',
      'FAMILY_AUDIENCE_PARTITION_V3'
    )),
    FOREIGN KEY(household_id,audience_key)
        REFERENCES family_delivery_partition_state(household_id,audience_key) ON DELETE CASCADE,
    UNIQUE(household_id,artifact_id),
    CHECK ((visibility='SHARED' AND member_id IS NULL)
        OR (visibility='PERSONAL' AND member_id IS NOT NULL)),
    CHECK ((state='RELAY_ACCEPTED' AND accepted_at IS NOT NULL AND package_bytes IS NULL)
        OR (state!='RELAY_ACCEPTED' AND accepted_at IS NULL AND package_bytes IS NOT NULL))
) STRICT;
INSERT INTO family_delivery_deliveries(
  delivery_id,household_id,audience_key,artifact_id,package_sha256,origin_device_id,
  visibility,member_id,item_count,excluded_count,package_bytes,state,created_at,
  accepted_at,artifact_schema
)
SELECT delivery_id,household_id,audience_key,artifact_id,package_sha256,origin_device_id,
       visibility,member_id,item_count,excluded_count,package_bytes,state,created_at,
       accepted_at,artifact_schema
FROM family_delivery_deliveries_0048;
DROP TABLE family_delivery_deliveries_0048;
CREATE INDEX idx_family_delivery_retry
    ON family_delivery_deliveries(household_id,audience_key,state,created_at);

ALTER TABLE family_delivery_inbound RENAME TO family_delivery_inbound_0048;
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
      'FAMILY_AUDIENCE_PARTITION_V1','FAMILY_AUDIENCE_PARTITION_V2',
      'FAMILY_AUDIENCE_PARTITION_V3'
    )),
    state TEXT NOT NULL CHECK (state IN (
      'AVAILABLE','DOWNLOADING','WAITING_FOR_REVIEW','READY_TO_APPLY','APPLIED','DUPLICATE',
      'REJECTED_INVALID','AUDIENCE_DENIED','FAILED_RETRYABLE'
    )),
    received_before_revocation INTEGER NOT NULL DEFAULT 0 CHECK (received_before_revocation IN (0,1)),
    staged_snapshot_set_id TEXT REFERENCES family_snapshot_sets(snapshot_set_id) ON DELETE SET NULL,
    registered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    pending_package_bytes BLOB CHECK (
      pending_package_bytes IS NULL OR length(pending_package_bytes) BETWEEN 1 AND 67108864
    ),
    UNIQUE(household_id,sequence),
    CHECK ((visibility='SHARED' AND member_id IS NULL AND member_key='' AND member_name IS NULL)
      OR (visibility='PERSONAL' AND member_id IS NOT NULL AND member_key=member_id AND member_name IS NOT NULL)),
    FOREIGN KEY(household_id,sender_member_id)
      REFERENCES household_members(household_id,id) ON DELETE RESTRICT
) STRICT;
INSERT INTO family_delivery_inbound(
  artifact_id,household_id,sequence,package_sha256,created_at,origin_device_id,
  sender_membership_id,sender_member_id,sender_member_name,visibility,member_id,
  member_key,member_name,byte_size,artifact_schema,state,received_before_revocation,
  staged_snapshot_set_id,registered_at,pending_package_bytes
)
SELECT artifact_id,household_id,sequence,package_sha256,created_at,origin_device_id,
       sender_membership_id,sender_member_id,sender_member_name,visibility,member_id,
       member_key,member_name,byte_size,artifact_schema,state,received_before_revocation,
       staged_snapshot_set_id,registered_at,NULL
FROM family_delivery_inbound_0048;
DROP TABLE family_delivery_inbound_0048;
CREATE INDEX idx_family_delivery_inbound_state
  ON family_delivery_inbound(household_id,state,sequence);

CREATE TABLE evidence_import_run_aliases_0048 (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    portable_import_run_id TEXT NOT NULL
        CHECK (length(trim(portable_import_run_id)) BETWEEN 1 AND 128),
    local_import_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id, origin_installation_id, portable_import_run_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE evidence_source_document_aliases_0048 (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    portable_document_id TEXT NOT NULL
        CHECK (length(trim(portable_document_id)) BETWEEN 1 AND 128),
    portable_import_run_id TEXT NOT NULL
        CHECK (length(trim(portable_import_run_id)) BETWEEN 1 AND 128),
    local_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
    content_sha256 TEXT NOT NULL CHECK (
        length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id, origin_installation_id, portable_document_id),
    FOREIGN KEY (household_id, origin_installation_id, portable_import_run_id)
        REFERENCES evidence_import_run_aliases_0048(
            household_id, origin_installation_id, portable_import_run_id
        ) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE TABLE evidence_source_record_aliases_0048 (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    portable_document_id TEXT NOT NULL
        CHECK (length(trim(portable_document_id)) BETWEEN 1 AND 128),
    portable_record_id TEXT NOT NULL
        CHECK (length(trim(portable_record_id)) BETWEEN 1 AND 128),
    local_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
    record_hash TEXT NOT NULL CHECK (
        length(record_hash) = 64 AND record_hash NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id, origin_installation_id, portable_record_id),
    FOREIGN KEY (household_id, origin_installation_id, portable_document_id)
        REFERENCES evidence_source_document_aliases_0048(
            household_id, origin_installation_id, portable_document_id
        ) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE TABLE confirmed_receipt_evidence_0048 (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    portable_candidate_id TEXT NOT NULL
        CHECK (length(trim(portable_candidate_id)) BETWEEN 1 AND 128),
    linked_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id, origin_installation_id, portable_candidate_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE confirmed_receipt_evidence_records_0048 (
    household_id TEXT NOT NULL,
    origin_installation_id TEXT NOT NULL,
    portable_candidate_id TEXT NOT NULL,
    portable_record_id TEXT NOT NULL,
    evidence_role TEXT NOT NULL CHECK (evidence_role IN (
        'PRIMARY','FUNDING_LEG','REWARD_LEG','CONTINUATION','SUPPORTING'
    )),
    PRIMARY KEY (
        household_id, origin_installation_id,
        portable_candidate_id, portable_record_id
    ),
    FOREIGN KEY (household_id, origin_installation_id, portable_candidate_id)
        REFERENCES confirmed_receipt_evidence_0048(
            household_id, origin_installation_id, portable_candidate_id
        ) ON DELETE CASCADE,
    FOREIGN KEY (household_id, origin_installation_id, portable_record_id)
        REFERENCES evidence_source_record_aliases_0048(
            household_id, origin_installation_id, portable_record_id
        ) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

INSERT INTO evidence_import_run_aliases_0048 SELECT * FROM evidence_import_run_aliases;
INSERT INTO evidence_source_document_aliases_0048 SELECT * FROM evidence_source_document_aliases;
INSERT INTO evidence_source_record_aliases_0048 SELECT * FROM evidence_source_record_aliases;
INSERT INTO confirmed_receipt_evidence_0048 SELECT * FROM confirmed_receipt_evidence;
INSERT INTO confirmed_receipt_evidence_records_0048 SELECT * FROM confirmed_receipt_evidence_records;

DROP TABLE confirmed_receipt_evidence_records;
DROP TABLE confirmed_receipt_evidence;
DROP TABLE evidence_source_record_aliases;
DROP TABLE evidence_source_document_aliases;
DROP TABLE evidence_import_run_aliases;

ALTER TABLE evidence_import_run_aliases_0048 RENAME TO evidence_import_run_aliases;
ALTER TABLE evidence_source_document_aliases_0048 RENAME TO evidence_source_document_aliases;
ALTER TABLE evidence_source_record_aliases_0048 RENAME TO evidence_source_record_aliases;
ALTER TABLE confirmed_receipt_evidence_0048 RENAME TO confirmed_receipt_evidence;
ALTER TABLE confirmed_receipt_evidence_records_0048 RENAME TO confirmed_receipt_evidence_records;

CREATE INDEX idx_evidence_import_run_aliases_local
    ON evidence_import_run_aliases(household_id, local_import_run_id);
CREATE INDEX idx_evidence_source_document_aliases_local
    ON evidence_source_document_aliases(household_id, local_document_id);
CREATE INDEX idx_evidence_source_document_aliases_hash
    ON evidence_source_document_aliases(household_id, content_sha256);
CREATE INDEX idx_evidence_source_record_aliases_local
    ON evidence_source_record_aliases(household_id, local_record_id);
CREATE INDEX idx_evidence_source_record_aliases_document
    ON evidence_source_record_aliases(
        household_id, origin_installation_id, portable_document_id, portable_record_id
    );
CREATE INDEX idx_confirmed_receipt_evidence_transaction
    ON confirmed_receipt_evidence(household_id, transaction_id, linked_at);
CREATE INDEX idx_confirmed_receipt_evidence_records_source
    ON confirmed_receipt_evidence_records(
        household_id, origin_installation_id, portable_record_id
    );

CREATE TRIGGER trg_evidence_import_run_alias_scope_insert
BEFORE INSERT ON evidence_import_run_aliases
WHEN NOT EXISTS (
    SELECT 1 FROM import_runs run
    WHERE run.id=NEW.local_import_run_id AND run.household_id=NEW.household_id
)
BEGIN SELECT RAISE(ABORT,'evidence import-run alias scope mismatch'); END;
CREATE TRIGGER trg_evidence_import_run_alias_immutable
BEFORE UPDATE ON evidence_import_run_aliases
BEGIN SELECT RAISE(ABORT,'evidence import-run aliases are immutable'); END;

CREATE TRIGGER trg_evidence_source_document_alias_scope_insert
BEFORE INSERT ON evidence_source_document_aliases
WHEN NOT EXISTS (
    SELECT 1 FROM evidence_import_run_aliases run_alias
    JOIN source_documents document ON document.id=NEW.local_document_id
    WHERE run_alias.household_id=NEW.household_id
      AND run_alias.origin_installation_id=NEW.origin_installation_id
      AND run_alias.portable_import_run_id=NEW.portable_import_run_id
      AND document.household_id=NEW.household_id
      AND document.sha256=NEW.content_sha256
)
BEGIN SELECT RAISE(ABORT,'evidence source-document alias mismatch'); END;
CREATE TRIGGER trg_evidence_source_document_alias_immutable
BEFORE UPDATE ON evidence_source_document_aliases
BEGIN SELECT RAISE(ABORT,'evidence source-document aliases are immutable'); END;

CREATE TRIGGER trg_evidence_source_record_alias_scope_insert
BEFORE INSERT ON evidence_source_record_aliases
WHEN NOT EXISTS (
    SELECT 1 FROM evidence_source_document_aliases document_alias
    JOIN source_records record ON record.id=NEW.local_record_id
    WHERE document_alias.household_id=NEW.household_id
      AND document_alias.origin_installation_id=NEW.origin_installation_id
      AND document_alias.portable_document_id=NEW.portable_document_id
      AND record.source_document_id=document_alias.local_document_id
      AND record.record_hash=NEW.record_hash
)
BEGIN SELECT RAISE(ABORT,'evidence source-record alias mismatch'); END;
CREATE TRIGGER trg_evidence_source_record_alias_immutable
BEFORE UPDATE ON evidence_source_record_aliases
BEGIN SELECT RAISE(ABORT,'evidence source-record aliases are immutable'); END;

CREATE TRIGGER trg_confirmed_receipt_evidence_scope_insert
BEFORE INSERT ON confirmed_receipt_evidence
WHEN NOT EXISTS (
    SELECT 1 FROM transactions transaction_row
    WHERE transaction_row.id=NEW.transaction_id
      AND transaction_row.household_id=NEW.household_id
      AND transaction_row.status='POSTED'
      AND transaction_row.transaction_type IN ('EXPENSE','CARD_PURCHASE')
)
BEGIN SELECT RAISE(ABORT,'confirmed receipt evidence transaction mismatch'); END;
CREATE TRIGGER trg_confirmed_receipt_evidence_immutable
BEFORE UPDATE ON confirmed_receipt_evidence
BEGIN SELECT RAISE(ABORT,'confirmed receipt evidence is immutable'); END;
CREATE TRIGGER trg_confirmed_receipt_evidence_record_immutable
BEFORE UPDATE ON confirmed_receipt_evidence_records
BEGIN SELECT RAISE(ABORT,'confirmed receipt evidence records are immutable'); END;

-- Card source references now carry the same origin-qualified identity as
-- investment source references and evidence aliases.
DROP TRIGGER trg_sync_capture_card_statement_insert;
DROP TRIGGER trg_sync_capture_card_statement_update;
DROP TRIGGER trg_sync_capture_card_statement_delete;
DROP TRIGGER trg_sync_capture_card_statement_line_insert;
DROP TRIGGER trg_sync_capture_card_statement_line_update;
DROP TRIGGER trg_sync_capture_card_statement_line_delete;
DROP TRIGGER trg_sync_capture_card_statement_portable_ref_insert;
DROP TRIGGER trg_sync_capture_card_statement_portable_ref_update;
DROP TRIGGER trg_sync_capture_card_statement_portable_ref_delete;
DROP VIEW sync_card_statement_aggregate_payloads;

CREATE TABLE card_statement_portable_source_refs_0048 (
    statement_id TEXT PRIMARY KEY NOT NULL
        REFERENCES card_statements(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    source_document_id TEXT NOT NULL
        CHECK (length(trim(source_document_id)) BETWEEN 1 AND 128)
) STRICT, WITHOUT ROWID;

INSERT INTO card_statement_portable_source_refs_0048(
    statement_id,household_id,origin_installation_id,source_document_id
)
SELECT p.statement_id,s.household_id,
       COALESCE(
         (SELECT a.origin_installation_id
          FROM evidence_source_document_aliases a
          WHERE a.household_id=s.household_id
            AND a.portable_document_id=p.source_document_id
          ORDER BY a.origin_installation_id LIMIT 1),
         (SELECT h.source_installation_id FROM sync_replica_entity_heads h
          WHERE h.household_id=s.household_id
            AND h.entity_kind='CARD_STATEMENT' AND h.entity_id=s.id),
         (SELECT c.device_id FROM local_sync_contexts c
          WHERE c.household_id=s.household_id)
       ),p.source_document_id
FROM card_statement_portable_source_refs p
JOIN card_statements s ON s.id=p.statement_id;

DROP TABLE card_statement_portable_source_refs;
ALTER TABLE card_statement_portable_source_refs_0048
    RENAME TO card_statement_portable_source_refs;

CREATE INDEX idx_card_statement_portable_source_origin
    ON card_statement_portable_source_refs(
        household_id,origin_installation_id,source_document_id
    );
CREATE TRIGGER trg_card_statement_portable_source_scope_insert
BEFORE INSERT ON card_statement_portable_source_refs
WHEN NOT EXISTS (
    SELECT 1 FROM card_statements s
    WHERE s.id=NEW.statement_id AND s.household_id=NEW.household_id
)
BEGIN SELECT RAISE(ABORT,'card statement portable source scope mismatch'); END;
CREATE TRIGGER trg_card_statement_portable_source_immutable
BEFORE UPDATE ON card_statement_portable_source_refs
BEGIN SELECT RAISE(ABORT,'card statement portable source is immutable'); END;

CREATE VIEW sync_card_statement_aggregate_payloads AS
SELECT s.household_id,
       s.id AS statement_id,
       json(json_object(
         'recordKind','CARD_STATEMENT','id',s.id,'householdId',s.household_id,
         'cardAccountId',s.card_account_id,'periodStart',s.period_start,
         'periodEnd',s.period_end,'paymentDueOn',s.payment_due_on,
         'statementAmountJpy',s.statement_amount_jpy,
         'reconciliationStatus',s.reconciliation_status,
         'sourceOriginInstallationId',CASE
           WHEN COALESCE(s.source_document_id,p.source_document_id) IS NULL THEN NULL
           ELSE COALESCE(p.origin_installation_id,
             (SELECT c.device_id FROM local_sync_contexts c
              WHERE c.household_id=s.household_id)) END,
         'sourceDocumentId',COALESCE(p.source_document_id,s.source_document_id),
         'createdAt',s.created_at,
         'lines',json(COALESCE((
           SELECT json_group_array(json_object(
             'statementId',line.statement_id,'transactionId',line.transaction_id,
             'statementLineNumber',line.statement_line_number,
             'billedAmountJpy',line.billed_amount_jpy
           )) FROM (
             SELECT statement_id,transaction_id,statement_line_number,billed_amount_jpy
             FROM card_statement_transactions WHERE statement_id=s.id
             ORDER BY statement_line_number,transaction_id
           ) line
         ),'[]'))
       )) AS payload_json
FROM card_statements s
LEFT JOIN card_statement_portable_source_refs p ON p.statement_id=s.id;

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

-- SQLite cannot widen an ALTER TABLE ADD COLUMN check constraint in place.
-- Keep the parent table and all of its foreign-key children intact, while
-- updating the stored CREATE statement to admit the evidence-bearing v3
-- family snapshot format. RESET forces the connection to reload the schema.
PRAGMA writable_schema=ON;
UPDATE sqlite_schema
SET sql=replace(
  sql,
  'CHECK(schema_version IN (1,2))',
  'CHECK(schema_version IN (1,2,3))'
)
WHERE type='table'
  AND name='family_snapshot_sets'
  AND instr(sql,'CHECK(schema_version IN (1,2))') > 0;
PRAGMA writable_schema=RESET;

-- Fail the migration instead of silently leaving a v2-only database when an
-- older or unexpectedly formatted schema is encountered.
CREATE TABLE migration_0048_family_schema_assert (
  accepted INTEGER NOT NULL CHECK(accepted=1)
) STRICT;
INSERT INTO migration_0048_family_schema_assert(accepted)
SELECT CASE WHEN instr(
  (SELECT sql FROM sqlite_schema WHERE type='table' AND name='family_snapshot_sets'),
  'CHECK(schema_version IN (1,2,3))'
) > 0 THEN 1 ELSE 0 END;
DROP TABLE migration_0048_family_schema_assert;
