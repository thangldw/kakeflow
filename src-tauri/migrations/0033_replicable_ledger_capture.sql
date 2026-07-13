-- Capture complete, state-based ledger aggregates. Multiple row mutations for
-- one transaction are intentionally coalesced by the Rust drain into the last
-- aggregate so a future receiver never observes a half-written journal.
DROP TRIGGER trg_sync_capture_member_insert;
DROP TRIGGER trg_sync_capture_member_update;
DROP TRIGGER trg_sync_capture_account_insert;
DROP TRIGGER trg_sync_capture_account_update;
DROP TRIGGER trg_sync_capture_transaction_insert;
DROP TRIGGER trg_sync_capture_transaction_update;
DROP TRIGGER trg_sync_capture_transaction_delete;
DROP INDEX idx_sync_local_capture_pending;

-- Schema 32 limited entity kinds with a CHECK enum. Use a bounded identifier so
-- later domain capture does not require rebuilding this durable staging table.
ALTER TABLE sync_local_change_capture RENAME TO sync_local_change_capture_v32;

CREATE TABLE sync_local_change_capture (
    capture_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL CHECK (length(trim(entity_kind)) BETWEEN 1 AND 64),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT','DELETE')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    processed_envelope_id TEXT REFERENCES sync_change_envelopes(envelope_id) ON DELETE RESTRICT
) STRICT;

INSERT INTO sync_local_change_capture(
    capture_sequence,household_id,entity_kind,entity_id,operation,
    payload_json,occurred_at,processed_envelope_id
)
SELECT capture_sequence,household_id,entity_kind,entity_id,
       COALESCE((SELECT e.operation FROM sync_change_envelopes e
                 WHERE e.envelope_id=c.processed_envelope_id),operation),
       COALESCE((SELECT e.canonical_payload_json FROM sync_change_envelopes e
                 WHERE e.envelope_id=c.processed_envelope_id),payload_json),
       occurred_at,processed_envelope_id
FROM sync_local_change_capture_v32 c
ORDER BY capture_sequence;

DROP TABLE sync_local_change_capture_v32;

CREATE INDEX idx_sync_local_capture_pending
    ON sync_local_change_capture(capture_sequence)
    WHERE processed_envelope_id IS NULL;

-- One canonical JSON snapshot per transaction. Journal lines and metadata sets
-- have stable ordering so identical ledger state hashes identically.
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
             'id',j.id,
             'transactionId',j.transaction_id,
             'accountId',j.account_id,
             'entrySide',j.entry_side,
             'amountJpy',j.amount_jpy,
             'lineNumber',j.line_number,
             'createdAt',j.created_at
           ))
           FROM (
             SELECT id,transaction_id,account_id,entry_side,amount_jpy,line_number,created_at
             FROM journal_entries
             WHERE transaction_id=t.id
             ORDER BY line_number,id
           ) j
         ),'[]')),
         'labels',json(COALESCE((
           SELECT json_group_array(label)
           FROM (SELECT label FROM transaction_labels
                 WHERE transaction_id=t.id ORDER BY label)
         ),'[]')),
         'tags',json(COALESCE((
           SELECT json_group_array(tag)
           FROM (SELECT tag FROM transaction_tags
                 WHERE transaction_id=t.id ORDER BY tag)
         ),'[]')),
         'sourceLinks',json(COALESCE((
           SELECT json_group_array(json_object(
             'transactionId',s.transaction_id,
             'sourceRecordId',s.source_record_id,
             'candidateId',s.candidate_id
           ))
           FROM (
             SELECT transaction_id,source_record_id,candidate_id
             FROM transaction_sources WHERE transaction_id=t.id
             ORDER BY source_record_id
           ) s
         ),'[]')),
         'externalKeys',json(COALESCE((
           SELECT json_group_array(json_object(
             'householdId',k.household_id,
             'externalSource',k.external_source,
             'externalId',k.external_id,
             'factHash',k.fact_hash,
             'transactionId',k.transaction_id,
             'createdAt',k.created_at
           ))
           FROM (
             SELECT household_id,external_source,external_id,fact_hash,transaction_id,created_at
             FROM transaction_external_keys WHERE transaction_id=t.id
             ORDER BY external_source,external_id
           ) k
         ),'[]'))
       )) AS payload_json
FROM transactions t;

-- Schema-32 core envelopes were never transmitted and were incomplete. Re-open
-- their captures with schema-33 payloads, then remove only those obsolete local
-- outbox artifacts. A final bootstrap below covers rows that predated schema 32.
UPDATE sync_local_change_capture
SET processed_envelope_id=NULL,
    operation=CASE WHEN EXISTS(
      SELECT 1 FROM household_members m WHERE m.id=sync_local_change_capture.entity_id
    ) THEN 'UPSERT' ELSE 'DELETE' END,
    payload_json=COALESCE((
      SELECT json(json_object(
        'recordKind','HOUSEHOLD_MEMBER','displayName',m.display_name,
        'householdId',m.household_id,'id',m.id,'relationshipLabel',m.relationship_label,
        'sortOrder',m.sort_order,'status',m.status,'createdAt',m.created_at,'updatedAt',m.updated_at
      )) FROM household_members m WHERE m.id=sync_local_change_capture.entity_id
    ),json(json_object(
      'recordKind','HOUSEHOLD_MEMBER','householdId',sync_local_change_capture.household_id,
      'id',sync_local_change_capture.entity_id
    )))
WHERE entity_kind='HOUSEHOLD_MEMBER'
  AND json_extract(payload_json,'$.recordKind') IS NULL;

UPDATE sync_local_change_capture
SET processed_envelope_id=NULL,
    operation=CASE WHEN EXISTS(
      SELECT 1 FROM accounts a WHERE a.id=sync_local_change_capture.entity_id
    ) THEN 'UPSERT' ELSE 'DELETE' END,
    payload_json=COALESCE((
      SELECT json(json_object(
        'recordKind','ACCOUNT','accountKind',a.account_kind,'accountSubtype',a.account_subtype,
        'householdId',a.household_id,'id',a.id,'name',a.name,'currency',a.currency,
        'institutionName',a.institution_name,'maskedIdentifier',a.masked_identifier,
        'isArchived',a.is_archived,'ownerMemberId',a.owner_member_id,
        'ownershipKind',a.ownership_kind,'visibility',a.visibility,
        'createdAt',a.created_at,'updatedAt',a.updated_at
      )) FROM accounts a WHERE a.id=sync_local_change_capture.entity_id
    ),json(json_object(
      'recordKind','ACCOUNT','householdId',sync_local_change_capture.household_id,
      'id',sync_local_change_capture.entity_id
    )))
WHERE entity_kind='ACCOUNT'
  AND json_extract(payload_json,'$.recordKind') IS NULL;

UPDATE sync_local_change_capture
SET processed_envelope_id=NULL,
    operation=CASE WHEN EXISTS(
      SELECT 1 FROM transactions t WHERE t.id=sync_local_change_capture.entity_id
    ) THEN 'UPSERT' ELSE 'DELETE' END,
    payload_json=COALESCE((
      SELECT p.payload_json FROM sync_transaction_aggregate_payloads p
      WHERE p.transaction_id=sync_local_change_capture.entity_id
    ),json(json_object(
      'recordKind','TRANSACTION_AGGREGATE',
      'householdId',sync_local_change_capture.household_id,
      'id',sync_local_change_capture.entity_id
    )))
WHERE entity_kind='TRANSACTION'
  AND json_extract(payload_json,'$.recordKind') IS NULL;

DELETE FROM sync_change_envelopes
WHERE entity_kind IN ('HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION')
  AND json_extract(canonical_payload_json,'$.recordKind') IS NULL;

-- Seed complete dependency state in replay order. Pending duplicates are safe:
-- the drain coalesces every entity to its latest snapshot.
INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT h.id,'HOUSEHOLD',h.id,'UPSERT',json(json_object(
  'recordKind','HOUSEHOLD','id',h.id,'name',h.name,'baseCurrency',h.base_currency,
  'createdAt',h.created_at,'updatedAt',h.updated_at
)) FROM households h ORDER BY h.id;

INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT m.household_id,'HOUSEHOLD_MEMBER',m.id,'UPSERT',json(json_object(
  'recordKind','HOUSEHOLD_MEMBER','displayName',m.display_name,
  'householdId',m.household_id,'id',m.id,'relationshipLabel',m.relationship_label,
  'sortOrder',m.sort_order,'status',m.status,'createdAt',m.created_at,'updatedAt',m.updated_at
)) FROM household_members m ORDER BY m.household_id,m.sort_order,m.id;

INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT a.household_id,'ACCOUNT',a.id,'UPSERT',json(json_object(
  'recordKind','ACCOUNT','accountKind',a.account_kind,'accountSubtype',a.account_subtype,
  'householdId',a.household_id,'id',a.id,'name',a.name,'currency',a.currency,
  'institutionName',a.institution_name,'maskedIdentifier',a.masked_identifier,
  'isArchived',a.is_archived,'ownerMemberId',a.owner_member_id,
  'ownershipKind',a.ownership_kind,'visibility',a.visibility,
  'createdAt',a.created_at,'updatedAt',a.updated_at
)) FROM accounts a ORDER BY a.household_id,a.id;

INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT p.household_id,'TRANSACTION',p.transaction_id,'UPSERT',p.payload_json
FROM sync_transaction_aggregate_payloads p ORDER BY p.household_id,p.transaction_id;

CREATE TRIGGER trg_sync_capture_household_insert AFTER INSERT ON households BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.id,'HOUSEHOLD',NEW.id,'UPSERT',json(json_object(
    'recordKind','HOUSEHOLD','id',NEW.id,'name',NEW.name,
    'baseCurrency',NEW.base_currency,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_capture_household_update AFTER UPDATE ON households BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.id,'HOUSEHOLD',NEW.id,'UPSERT',json(json_object(
    'recordKind','HOUSEHOLD','id',NEW.id,'name',NEW.name,
    'baseCurrency',NEW.base_currency,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at)));
END;

CREATE TRIGGER trg_sync_capture_member_insert AFTER INSERT ON household_members BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'HOUSEHOLD_MEMBER',NEW.id,'UPSERT',json(json_object(
    'recordKind','HOUSEHOLD_MEMBER','displayName',NEW.display_name,
    'householdId',NEW.household_id,'id',NEW.id,'relationshipLabel',NEW.relationship_label,
    'sortOrder',NEW.sort_order,'status',NEW.status,'createdAt',NEW.created_at,
    'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_capture_member_update AFTER UPDATE ON household_members BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'HOUSEHOLD_MEMBER',NEW.id,'UPSERT',json(json_object(
    'recordKind','HOUSEHOLD_MEMBER','displayName',NEW.display_name,
    'householdId',NEW.household_id,'id',NEW.id,'relationshipLabel',NEW.relationship_label,
    'sortOrder',NEW.sort_order,'status',NEW.status,'createdAt',NEW.created_at,
    'updatedAt',NEW.updated_at)));
END;

CREATE TRIGGER trg_sync_capture_account_insert AFTER INSERT ON accounts BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'ACCOUNT',NEW.id,'UPSERT',json(json_object(
    'recordKind','ACCOUNT','accountKind',NEW.account_kind,'accountSubtype',NEW.account_subtype,
    'householdId',NEW.household_id,'id',NEW.id,'name',NEW.name,'currency',NEW.currency,
    'institutionName',NEW.institution_name,'maskedIdentifier',NEW.masked_identifier,
    'isArchived',NEW.is_archived,'ownerMemberId',NEW.owner_member_id,
    'ownershipKind',NEW.ownership_kind,'visibility',NEW.visibility,
    'createdAt',NEW.created_at,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_capture_account_update AFTER UPDATE ON accounts BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'ACCOUNT',NEW.id,'UPSERT',json(json_object(
    'recordKind','ACCOUNT','accountKind',NEW.account_kind,'accountSubtype',NEW.account_subtype,
    'householdId',NEW.household_id,'id',NEW.id,'name',NEW.name,'currency',NEW.currency,
    'institutionName',NEW.institution_name,'maskedIdentifier',NEW.masked_identifier,
    'isArchived',NEW.is_archived,'ownerMemberId',NEW.owner_member_id,
    'ownershipKind',NEW.ownership_kind,'visibility',NEW.visibility,
    'createdAt',NEW.created_at,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_account_household_immutable
BEFORE UPDATE OF household_id ON accounts
WHEN NEW.household_id!=OLD.household_id BEGIN
  SELECT RAISE(ABORT,'account cannot move between households');
END;
CREATE TRIGGER trg_sync_capture_account_delete BEFORE DELETE ON accounts BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'ACCOUNT',OLD.id,'DELETE',json(json_object(
    'recordKind','ACCOUNT','householdId',OLD.household_id,'id',OLD.id)));
END;

CREATE TRIGGER trg_sync_capture_transaction_insert AFTER INSERT ON transactions BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.id;
END;
CREATE TRIGGER trg_sync_capture_transaction_update AFTER UPDATE ON transactions BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.id;
END;
CREATE TRIGGER trg_sync_transaction_household_immutable
BEFORE UPDATE OF household_id ON transactions
WHEN NEW.household_id!=OLD.household_id BEGIN
  SELECT RAISE(ABORT,'transaction cannot move between households');
END;
CREATE TRIGGER trg_sync_capture_transaction_delete AFTER DELETE ON transactions BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'TRANSACTION',OLD.id,'DELETE',json(json_object(
    'recordKind','TRANSACTION_AGGREGATE','householdId',OLD.household_id,'id',OLD.id)));
END;

CREATE TRIGGER trg_sync_capture_journal_insert AFTER INSERT ON journal_entries BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;
CREATE TRIGGER trg_sync_capture_journal_update AFTER UPDATE ON journal_entries BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads
  WHERE transaction_id=OLD.transaction_id AND OLD.transaction_id!=NEW.transaction_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;
CREATE TRIGGER trg_sync_capture_journal_delete AFTER DELETE ON journal_entries BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=OLD.transaction_id;
END;

CREATE TRIGGER trg_sync_capture_label_insert AFTER INSERT ON transaction_labels BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;
CREATE TRIGGER trg_sync_capture_label_delete AFTER DELETE ON transaction_labels BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=OLD.transaction_id;
END;
CREATE TRIGGER trg_sync_capture_label_update AFTER UPDATE ON transaction_labels BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads
  WHERE transaction_id=OLD.transaction_id AND OLD.transaction_id!=NEW.transaction_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;
CREATE TRIGGER trg_sync_capture_tag_insert AFTER INSERT ON transaction_tags BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;
CREATE TRIGGER trg_sync_capture_tag_delete AFTER DELETE ON transaction_tags BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=OLD.transaction_id;
END;
CREATE TRIGGER trg_sync_capture_tag_update AFTER UPDATE ON transaction_tags BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads
  WHERE transaction_id=OLD.transaction_id AND OLD.transaction_id!=NEW.transaction_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;

CREATE TRIGGER trg_sync_capture_transaction_source_insert AFTER INSERT ON transaction_sources BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;
CREATE TRIGGER trg_sync_capture_transaction_source_update AFTER UPDATE ON transaction_sources BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads
  WHERE transaction_id=OLD.transaction_id AND OLD.transaction_id!=NEW.transaction_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;
CREATE TRIGGER trg_sync_capture_transaction_source_delete AFTER DELETE ON transaction_sources BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=OLD.transaction_id;
END;

CREATE TRIGGER trg_sync_capture_external_key_insert AFTER INSERT ON transaction_external_keys BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;
CREATE TRIGGER trg_sync_capture_external_key_update AFTER UPDATE ON transaction_external_keys BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads
  WHERE transaction_id=OLD.transaction_id AND OLD.transaction_id!=NEW.transaction_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=NEW.transaction_id;
END;
CREATE TRIGGER trg_sync_capture_external_key_delete AFTER DELETE ON transaction_external_keys BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'TRANSACTION',transaction_id,'UPSERT',payload_json
  FROM sync_transaction_aggregate_payloads WHERE transaction_id=OLD.transaction_id;
END;
