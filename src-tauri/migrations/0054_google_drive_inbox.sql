-- Remote generations enter a durable review-gated inbox. Downloaded bytes are
-- linked to normal immutable source documents only after explicit staging.
CREATE TABLE google_drive_inbox (
    id TEXT PRIMARY KEY NOT NULL CHECK (
        length(id)=64 AND id NOT GLOB '*[^0-9a-f]*'
    ),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES google_drive_connections(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL CHECK (length(trim(file_id)) BETWEEN 1 AND 256),
    generation_fingerprint TEXT NOT NULL CHECK (
        length(generation_fingerprint)=64 AND generation_fingerprint NOT GLOB '*[^0-9a-f]*'
    ),
    file_name TEXT NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 255),
    media_type TEXT NOT NULL CHECK (length(trim(media_type)) BETWEEN 1 AND 127),
    remote_byte_size INTEGER CHECK (remote_byte_size IS NULL OR remote_byte_size BETWEEN 0 AND 9007199254740991),
    remote_modified_at TEXT,
    remote_md5_checksum TEXT CHECK (
        remote_md5_checksum IS NULL OR (
            length(remote_md5_checksum)=32 AND remote_md5_checksum NOT GLOB '*[^0-9a-f]*'
        )
    ),
    drive_version TEXT CHECK (drive_version IS NULL OR length(drive_version) BETWEEN 1 AND 128),
    content_sha256 TEXT CHECK (
        content_sha256 IS NULL OR (
            length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'
        )
    ),
    state TEXT NOT NULL CHECK (state IN (
        'DISCOVERED','PROCESSING','READY','NEEDS_MAPPING','STAGED',
        'FAILED','IGNORED','REMOVED','TOO_LARGE','UNSUPPORTED'
    )),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
    lease_token TEXT CHECK (lease_token IS NULL OR (
        length(lease_token)=64 AND lease_token NOT GLOB '*[^0-9a-f]*'
    )),
    lease_expires_at TEXT,
    processing_origin_state TEXT CHECK (
        processing_origin_state IS NULL OR processing_origin_state IN ('DISCOVERED','READY','NEEDS_MAPPING')
    ),
    import_run_id TEXT REFERENCES import_runs(id) ON DELETE RESTRICT,
    last_error_code TEXT CHECK (last_error_code IS NULL OR length(trim(last_error_code)) BETWEEN 1 AND 64),
    discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(connection_id,file_id,generation_fingerprint),
    CHECK (updated_at>=discovered_at),
    CHECK ((state='PROCESSING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
            AND processing_origin_state IS NOT NULL)
        OR (state!='PROCESSING' AND lease_token IS NULL AND lease_expires_at IS NULL
            AND processing_origin_state IS NULL)),
    CHECK ((state='STAGED')=(import_run_id IS NOT NULL)),
    CHECK ((state='FAILED')=(last_error_code IS NOT NULL)),
    CHECK (content_sha256 IS NULL OR state IN ('READY','NEEDS_MAPPING','STAGED','IGNORED','FAILED'))
) STRICT;

CREATE INDEX idx_google_drive_inbox_household_state
    ON google_drive_inbox(household_id,state,updated_at DESC,id);
CREATE INDEX idx_google_drive_inbox_connection_file
    ON google_drive_inbox(connection_id,file_id,updated_at DESC,id);
CREATE INDEX idx_google_drive_inbox_expired_lease
    ON google_drive_inbox(lease_expires_at,id) WHERE state='PROCESSING';

CREATE TRIGGER trg_google_drive_inbox_scope_insert
BEFORE INSERT ON google_drive_inbox BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM google_drive_connections c
    WHERE c.id=NEW.connection_id AND c.household_id=NEW.household_id
  ) THEN RAISE(ABORT,'google drive inbox scope mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM google_drive_nodes n
    WHERE n.connection_id=NEW.connection_id AND n.file_id=NEW.file_id
      AND n.generation_fingerprint=NEW.generation_fingerprint AND n.is_folder=0
  ) THEN RAISE(ABORT,'google drive inbox node mismatch') END;
  SELECT CASE WHEN NEW.import_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM import_runs r WHERE r.id=NEW.import_run_id AND r.household_id=NEW.household_id
  ) THEN RAISE(ABORT,'google drive inbox import scope mismatch') END;
END;

CREATE TRIGGER trg_google_drive_inbox_scope_update
BEFORE UPDATE ON google_drive_inbox BEGIN
  SELECT CASE WHEN NEW.id!=OLD.id OR NEW.household_id!=OLD.household_id
    OR NEW.connection_id!=OLD.connection_id OR NEW.file_id!=OLD.file_id
    OR NEW.generation_fingerprint!=OLD.generation_fingerprint
    OR NEW.discovered_at!=OLD.discovered_at
  THEN RAISE(ABORT,'google drive inbox identity is immutable') END;
  SELECT CASE WHEN NEW.import_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM import_runs r WHERE r.id=NEW.import_run_id AND r.household_id=NEW.household_id
  ) THEN RAISE(ABORT,'google drive inbox import scope mismatch') END;
END;

CREATE TABLE google_drive_source_links (
    inbox_id TEXT NOT NULL REFERENCES google_drive_inbox(id) ON DELETE CASCADE,
    source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
    evidence_role TEXT NOT NULL DEFAULT 'ORIGINAL' CHECK (evidence_role='ORIGINAL'),
    linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(inbox_id,source_document_id),
    UNIQUE(source_document_id)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER trg_google_drive_source_link_scope
BEFORE INSERT ON google_drive_source_links BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM google_drive_inbox i
    JOIN source_documents d ON d.id=NEW.source_document_id
    WHERE i.id=NEW.inbox_id AND i.household_id=d.household_id
      AND i.state='STAGED' AND i.import_run_id=d.import_run_id
      AND i.content_sha256=d.sha256
  ) THEN RAISE(ABORT,'google drive source link scope mismatch') END;
END;

CREATE TRIGGER trg_google_drive_source_link_immutable
BEFORE UPDATE ON google_drive_source_links BEGIN
  SELECT RAISE(ABORT,'google drive source link is immutable');
END;
