-- Core writes are captured in the same SQLite transaction as their domain
-- mutation. The local sync foundation later converts each durable capture into
-- an immutable envelope; no network transport is involved.
CREATE TABLE sync_local_change_capture (
    capture_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN ('HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION')),
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT','DELETE')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    processed_envelope_id TEXT REFERENCES sync_change_envelopes(envelope_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_sync_local_capture_pending
    ON sync_local_change_capture(capture_sequence)
    WHERE processed_envelope_id IS NULL;

CREATE TRIGGER trg_sync_capture_member_insert AFTER INSERT ON household_members BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'HOUSEHOLD_MEMBER',NEW.id,'UPSERT',json(json_object(
    'displayName',NEW.display_name,'householdId',NEW.household_id,'id',NEW.id,
    'relationshipLabel',NEW.relationship_label,'sortOrder',NEW.sort_order,
    'status',NEW.status,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_capture_member_update AFTER UPDATE ON household_members BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'HOUSEHOLD_MEMBER',NEW.id,'UPSERT',json(json_object(
    'displayName',NEW.display_name,'householdId',NEW.household_id,'id',NEW.id,
    'relationshipLabel',NEW.relationship_label,'sortOrder',NEW.sort_order,
    'status',NEW.status,'updatedAt',NEW.updated_at)));
END;

CREATE TRIGGER trg_sync_capture_account_insert AFTER INSERT ON accounts BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'ACCOUNT',NEW.id,'UPSERT',json(json_object(
    'accountKind',NEW.account_kind,'accountSubtype',NEW.account_subtype,
    'householdId',NEW.household_id,'id',NEW.id,'isArchived',NEW.is_archived,
    'name',NEW.name,'ownerMemberId',NEW.owner_member_id,
    'ownershipKind',NEW.ownership_kind,'updatedAt',NEW.updated_at,
    'visibility',NEW.visibility)));
END;
CREATE TRIGGER trg_sync_capture_account_update AFTER UPDATE ON accounts BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'ACCOUNT',NEW.id,'UPSERT',json(json_object(
    'accountKind',NEW.account_kind,'accountSubtype',NEW.account_subtype,
    'householdId',NEW.household_id,'id',NEW.id,'isArchived',NEW.is_archived,
    'name',NEW.name,'ownerMemberId',NEW.owner_member_id,
    'ownershipKind',NEW.ownership_kind,'updatedAt',NEW.updated_at,
    'visibility',NEW.visibility)));
END;

CREATE TRIGGER trg_sync_capture_transaction_insert AFTER INSERT ON transactions BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'TRANSACTION',NEW.id,'UPSERT',json(json_object(
    'calculationTarget',NEW.calculation_target,'description',NEW.description,
    'householdId',NEW.household_id,'id',NEW.id,'occurredOn',NEW.occurred_on,
    'payee',NEW.payee,'postedOn',NEW.posted_on,'status',NEW.status,
    'transactionType',NEW.transaction_type,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_capture_transaction_update AFTER UPDATE ON transactions BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'TRANSACTION',NEW.id,'UPSERT',json(json_object(
    'calculationTarget',NEW.calculation_target,'description',NEW.description,
    'householdId',NEW.household_id,'id',NEW.id,'occurredOn',NEW.occurred_on,
    'payee',NEW.payee,'postedOn',NEW.posted_on,'status',NEW.status,
    'transactionType',NEW.transaction_type,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_capture_transaction_delete BEFORE DELETE ON transactions BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'TRANSACTION',OLD.id,'DELETE',json(json_object(
    'householdId',OLD.household_id,'id',OLD.id)));
END;

