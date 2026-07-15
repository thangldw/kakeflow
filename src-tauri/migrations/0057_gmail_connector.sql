-- Gmail grants and raw RFC 822 bytes remain device-local. SQLite contains
-- only bounded account/message metadata, cursor coordination and immutable
-- evidence lineage.
CREATE TABLE gmail_connections (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 128),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    google_account_id TEXT CHECK(google_account_id IS NULL OR length(trim(google_account_id)) BETWEEN 1 AND 256),
    account_email TEXT CHECK(account_email IS NULL OR length(trim(account_email)) BETWEEN 3 AND 320),
    client_id_fingerprint TEXT NOT NULL CHECK(length(client_id_fingerprint)=64 AND client_id_fingerprint NOT GLOB '*[^0-9a-f]*'),
    gmail_query TEXT NOT NULL DEFAULT 'has:attachment' CHECK(length(trim(gmail_query)) BETWEEN 1 AND 1024),
    label_id TEXT CHECK(label_id IS NULL OR length(trim(label_id)) BETWEEN 1 AND 256),
    label_name TEXT CHECK(label_name IS NULL OR length(trim(label_name)) BETWEEN 1 AND 255),
    oauth_scope TEXT NOT NULL DEFAULT 'https://www.googleapis.com/auth/gmail.readonly'
      CHECK(oauth_scope='https://www.googleapis.com/auth/gmail.readonly'),
    status TEXT NOT NULL DEFAULT 'AUTHORIZING'
      CHECK(status IN ('AUTHORIZING','CONNECTED','AUTH_REQUIRED','DISCONNECTED')),
    start_history_id TEXT CHECK(start_history_id IS NULL OR (length(start_history_id) BETWEEN 1 AND 64 AND start_history_id NOT GLOB '*[^0-9]*')),
    history_id TEXT CHECK(history_id IS NULL OR (length(history_id) BETWEEN 1 AND 64 AND history_id NOT GLOB '*[^0-9]*')),
    last_full_scan_at TEXT,
    last_change_at TEXT,
    created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(household_id,google_account_id),
    CHECK(updated_at>=created_at),
    CHECK((label_id IS NULL)=(label_name IS NULL)),
    CHECK(status!='CONNECTED' OR (google_account_id IS NOT NULL AND history_id IS NOT NULL AND label_id IS NOT NULL)),
    CHECK(history_id IS NULL OR start_history_id IS NOT NULL)
) STRICT;

CREATE INDEX idx_gmail_connections_household
  ON gmail_connections(household_id,status,updated_at DESC,id);

CREATE TABLE gmail_sync_schedules (
    connection_id TEXT PRIMARY KEY NOT NULL REFERENCES gmail_connections(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    interval_minutes INTEGER NOT NULL DEFAULT 30 CHECK(interval_minutes IN (15,30,60)),
    next_due_at TEXT,
    lease_token TEXT CHECK(lease_token IS NULL OR (length(lease_token)=64 AND lease_token NOT GLOB '*[^0-9a-f]*')),
    lease_expires_at TEXT,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_result TEXT NOT NULL DEFAULT 'NEVER' CHECK(last_result IN (
      'NEVER','RUNNING','NO_CHANGES','DISCOVERED','FAILED_RETRYABLE','LEASE_EXPIRED','TERMINAL_SUSPENDED','DISABLED'
    )),
    last_discovered_count INTEGER NOT NULL DEFAULT 0 CHECK(last_discovered_count>=0),
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_failures BETWEEN 0 AND 10),
    suspended_until TEXT,
    suspension_reason TEXT CHECK(suspension_reason IS NULL OR suspension_reason IN (
      'RETRY_BACKOFF','AUTH_EXPIRED','MISSING_CREDENTIAL','HISTORY_EXPIRED'
    )),
    last_error_code TEXT CHECK(last_error_code IS NULL OR length(trim(last_error_code)) BETWEEN 1 AND 64),
    updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK((enabled=0 AND next_due_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND suspended_until IS NULL)
      OR (enabled=1 AND next_due_at IS NOT NULL)),
    CHECK((lease_token IS NULL AND lease_expires_at IS NULL) OR (enabled=1 AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK((last_result='RUNNING' AND lease_token IS NOT NULL) OR (last_result!='RUNNING' AND lease_token IS NULL)),
    CHECK((suspension_reason IS NULL AND suspended_until IS NULL)
      OR (suspension_reason='RETRY_BACKOFF' AND suspended_until IS NOT NULL)
      OR (suspension_reason IN ('AUTH_EXPIRED','MISSING_CREDENTIAL','HISTORY_EXPIRED')
          AND enabled=1 AND suspended_until IS NULL AND last_result='TERMINAL_SUSPENDED'))
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_gmail_schedule_due ON gmail_sync_schedules(enabled,next_due_at,connection_id)
  WHERE enabled=1 AND lease_token IS NULL;

-- One row represents one immutable raw-message generation. Message bodies and
-- attachments are never stored here; content_sha256 points at vault evidence.
CREATE TABLE gmail_inbox (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=64 AND id NOT GLOB '*[^0-9a-f]*'),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES gmail_connections(id) ON DELETE CASCADE,
    provider_message_id TEXT NOT NULL CHECK(length(trim(provider_message_id)) BETWEEN 1 AND 256),
    generation_fingerprint TEXT NOT NULL CHECK(length(generation_fingerprint)=64 AND generation_fingerprint NOT GLOB '*[^0-9a-f]*'),
    thread_id TEXT CHECK(thread_id IS NULL OR length(trim(thread_id)) BETWEEN 1 AND 256),
    message_history_id TEXT NOT NULL CHECK(length(message_history_id) BETWEEN 1 AND 64 AND message_history_id NOT GLOB '*[^0-9]*'),
    internal_date_ms INTEGER NOT NULL CHECK(internal_date_ms BETWEEN 0 AND 9007199254740991),
    estimated_byte_size INTEGER CHECK(estimated_byte_size IS NULL OR estimated_byte_size BETWEEN 0 AND 52428800),
    rfc822_message_id TEXT CHECK(rfc822_message_id IS NULL OR length(trim(rfc822_message_id)) BETWEEN 1 AND 998),
    file_name TEXT NOT NULL CHECK(length(trim(file_name)) BETWEEN 1 AND 255),
    media_type TEXT NOT NULL DEFAULT 'message/rfc822' CHECK(media_type='message/rfc822'),
    content_sha256 TEXT CHECK(content_sha256 IS NULL OR (length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*')),
    state TEXT NOT NULL CHECK(state IN (
      'DISCOVERED','PROCESSING','READY','NEEDS_MAPPING','STAGED','FAILED','IGNORED','REMOVED','TOO_LARGE','UNSUPPORTED'
    )),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
    lease_token TEXT CHECK(lease_token IS NULL OR (length(lease_token)=64 AND lease_token NOT GLOB '*[^0-9a-f]*')),
    lease_expires_at TEXT,
    processing_origin_state TEXT CHECK(processing_origin_state IS NULL OR processing_origin_state IN ('DISCOVERED','READY','NEEDS_MAPPING')),
    import_run_id TEXT REFERENCES import_runs(id) ON DELETE RESTRICT,
    last_error_code TEXT CHECK(last_error_code IS NULL OR length(trim(last_error_code)) BETWEEN 1 AND 64),
    discovered_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(connection_id,provider_message_id,generation_fingerprint),
    CHECK(updated_at>=discovered_at),
    CHECK((state='PROCESSING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND processing_origin_state IS NOT NULL)
      OR (state!='PROCESSING' AND lease_token IS NULL AND lease_expires_at IS NULL AND processing_origin_state IS NULL)),
    CHECK((state='STAGED')=(import_run_id IS NOT NULL)),
    CHECK((state='FAILED')=(last_error_code IS NOT NULL)),
    CHECK(content_sha256 IS NULL OR state IN ('PROCESSING','READY','NEEDS_MAPPING','STAGED','IGNORED','FAILED'))
) STRICT;

CREATE INDEX idx_gmail_inbox_household_state ON gmail_inbox(household_id,state,updated_at DESC,id);
CREATE INDEX idx_gmail_inbox_connection_message ON gmail_inbox(connection_id,provider_message_id,updated_at DESC,id);
CREATE INDEX idx_gmail_inbox_expired_lease ON gmail_inbox(lease_expires_at,id) WHERE state='PROCESSING';

CREATE TRIGGER trg_gmail_inbox_scope_insert BEFORE INSERT ON gmail_inbox BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gmail_connections c WHERE c.id=NEW.connection_id AND c.household_id=NEW.household_id)
    THEN RAISE(ABORT,'gmail inbox scope mismatch') END;
  SELECT CASE WHEN NEW.import_run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM import_runs r WHERE r.id=NEW.import_run_id AND r.household_id=NEW.household_id)
    THEN RAISE(ABORT,'gmail inbox import scope mismatch') END;
END;

CREATE TRIGGER trg_gmail_inbox_identity_immutable BEFORE UPDATE ON gmail_inbox BEGIN
  SELECT CASE WHEN NEW.id!=OLD.id OR NEW.household_id!=OLD.household_id OR NEW.connection_id!=OLD.connection_id
    OR NEW.provider_message_id!=OLD.provider_message_id OR NEW.generation_fingerprint!=OLD.generation_fingerprint
    OR NEW.message_history_id!=OLD.message_history_id OR NEW.internal_date_ms!=OLD.internal_date_ms
    OR NEW.discovered_at!=OLD.discovered_at THEN RAISE(ABORT,'gmail inbox identity is immutable') END;
END;

CREATE TABLE gmail_source_links (
    inbox_id TEXT NOT NULL REFERENCES gmail_inbox(id) ON DELETE CASCADE,
    source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
    evidence_role TEXT NOT NULL DEFAULT 'ORIGINAL' CHECK(evidence_role='ORIGINAL'),
    linked_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(inbox_id,source_document_id), UNIQUE(source_document_id)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER trg_gmail_source_link_scope BEFORE INSERT ON gmail_source_links BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM gmail_inbox i JOIN source_documents d ON d.id=NEW.source_document_id
    WHERE i.id=NEW.inbox_id AND i.household_id=d.household_id AND d.source_type='GMAIL'
      AND i.state='STAGED' AND i.import_run_id=d.import_run_id AND i.content_sha256=d.sha256
  ) THEN RAISE(ABORT,'gmail source link scope mismatch') END;
END;
CREATE TRIGGER trg_gmail_source_link_immutable BEFORE UPDATE ON gmail_source_links BEGIN
  SELECT RAISE(ABORT,'gmail source link is immutable');
END;

-- Extend the canonical source enum for staged raw EML evidence.
PRAGMA writable_schema=ON;
UPDATE sqlite_schema SET sql=replace(sql,
  '''ICLOUD_PICKER'', ''GOOGLE_DRIVE'', ''MANUAL_UPLOAD''',
  '''ICLOUD_PICKER'', ''GOOGLE_DRIVE'', ''GMAIL'', ''MANUAL_UPLOAD''')
WHERE type='table' AND name='source_documents'
  AND instr(sql, '''ICLOUD_PICKER'', ''GOOGLE_DRIVE'', ''MANUAL_UPLOAD''')>0;
PRAGMA writable_schema=RESET;

CREATE TEMP TABLE assert_gmail_source_type(valid INTEGER NOT NULL CHECK(valid=1));
INSERT INTO assert_gmail_source_type(valid)
SELECT instr(sql, '''GMAIL''')>0 FROM sqlite_schema WHERE type='table' AND name='source_documents';
DROP TABLE assert_gmail_source_type;
