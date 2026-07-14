-- Mobile receipt captures are immutable source evidence waiting for desktop-local
-- OCR. They are deliberately separate from confirmed evidence and family
-- current-state snapshots and can only become a normal REVIEW_REQUIRED import.
ALTER TABLE family_delivery_connections
    ADD COLUMN capture_inbound_cursor INTEGER NOT NULL DEFAULT 0
    CHECK (capture_inbound_cursor >= 0);

CREATE TABLE mobile_capture_receipts (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    artifact_id TEXT NOT NULL CHECK (length(trim(artifact_id)) BETWEEN 1 AND 128),
    sender_membership_id TEXT NOT NULL CHECK (length(trim(sender_membership_id)) BETWEEN 1 AND 128),
    origin_device_id TEXT NOT NULL CHECK (length(trim(origin_device_id)) BETWEEN 1 AND 128),
    capture_id TEXT NOT NULL CHECK (length(trim(capture_id)) BETWEEN 1 AND 128),
    capsule_sha256 TEXT NOT NULL CHECK (length(capsule_sha256)=64 AND capsule_sha256 NOT GLOB '*[^0-9a-f]*'),
    source_sha256 TEXT NOT NULL CHECK (length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
    source_media_type TEXT NOT NULL CHECK (source_media_type IN ('image/png','image/jpeg')),
    source_byte_size INTEGER NOT NULL CHECK (source_byte_size BETWEEN 1 AND 20971520),
    original_filename TEXT NOT NULL CHECK (length(trim(original_filename)) BETWEEN 1 AND 255),
    captured_at TEXT,
    audience_visibility TEXT NOT NULL CHECK (audience_visibility IN ('SHARED','PERSONAL')),
    audience_member_id TEXT,
    storage_path TEXT NOT NULL CHECK (storage_path='vault://' || source_sha256),
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(household_id,artifact_id),
    UNIQUE(household_id,sender_membership_id,capture_id),
    CHECK ((audience_visibility='SHARED' AND audience_member_id IS NULL) OR
           (audience_visibility='PERSONAL' AND audience_member_id IS NOT NULL))
) STRICT, WITHOUT ROWID;

CREATE TRIGGER trg_mobile_capture_receipt_immutable
BEFORE UPDATE ON mobile_capture_receipts BEGIN
  SELECT RAISE(ABORT,'mobile capture receipt is immutable');
END;

CREATE TABLE mobile_capture_inbox (
    household_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
      'RECEIVED','OCR_READY','OCR_REVIEW_REQUIRED','PROMOTED','DUPLICATE','REJECTED_INVALID','FAILED_RETRYABLE'
    )),
    latest_extraction_id TEXT,
    local_run_id TEXT REFERENCES import_runs(id) ON DELETE RESTRICT,
    local_document_id TEXT REFERENCES source_documents(id) ON DELETE RESTRICT,
    last_error_code TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(household_id,artifact_id),
    FOREIGN KEY(household_id,artifact_id)
      REFERENCES mobile_capture_receipts(household_id,artifact_id) ON DELETE CASCADE,
    CHECK ((state IN ('PROMOTED','DUPLICATE')) = (local_run_id IS NOT NULL AND local_document_id IS NOT NULL)),
    CHECK ((state='FAILED_RETRYABLE') = (last_error_code IS NOT NULL))
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_mobile_capture_inbox_state
  ON mobile_capture_inbox(household_id,state,updated_at,artifact_id);

CREATE TABLE mobile_capture_extractions (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
    household_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 1000),
    engine_id TEXT NOT NULL CHECK (length(trim(engine_id)) BETWEEN 1 AND 128),
    engine_version TEXT NOT NULL CHECK (length(trim(engine_version)) BETWEEN 1 AND 128),
    extracted_payload_json TEXT NOT NULL CHECK (json_valid(extracted_payload_json) AND json_type(extracted_payload_json)='object'),
    payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(household_id,artifact_id,attempt_number),
    UNIQUE(household_id,artifact_id,payload_sha256),
    FOREIGN KEY(household_id,artifact_id)
      REFERENCES mobile_capture_receipts(household_id,artifact_id) ON DELETE CASCADE
) STRICT;

CREATE TRIGGER trg_mobile_capture_extraction_immutable
BEFORE UPDATE ON mobile_capture_extractions BEGIN
  SELECT RAISE(ABORT,'mobile capture extraction is immutable');
END;

CREATE TRIGGER trg_mobile_capture_inbox_extraction_scope
BEFORE UPDATE OF latest_extraction_id ON mobile_capture_inbox
WHEN NEW.latest_extraction_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM mobile_capture_extractions e
  WHERE e.id=NEW.latest_extraction_id AND e.household_id=NEW.household_id AND e.artifact_id=NEW.artifact_id
) BEGIN
  SELECT RAISE(ABORT,'mobile capture extraction scope mismatch');
END;

CREATE TRIGGER trg_mobile_capture_inbox_import_scope
BEFORE UPDATE OF local_run_id,local_document_id ON mobile_capture_inbox
WHEN NEW.local_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM import_runs r JOIN source_documents d ON d.import_run_id=r.id
  JOIN mobile_capture_receipts c ON c.household_id=NEW.household_id AND c.artifact_id=NEW.artifact_id
  WHERE r.id=NEW.local_run_id AND r.household_id=NEW.household_id
    AND d.id=NEW.local_document_id AND d.household_id=NEW.household_id AND d.sha256=c.source_sha256
) BEGIN
  SELECT RAISE(ABORT,'mobile capture import scope mismatch');
END;
