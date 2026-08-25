-- Durable connector refresh coordination stores only public connector
-- identities and bounded operational metadata. Provider cursors, credentials,
-- paths, raw responses, and imported content stay in their owning stores.
CREATE TABLE connector_refresh_batches (
    batch_id TEXT PRIMARY KEY NOT NULL CHECK(
      length(batch_id) BETWEEN 1 AND 64 AND batch_id=trim(batch_id)
      AND batch_id NOT GLOB '*[^0-9A-Za-z_-]*'
    ),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE
      CHECK(length(household_id) BETWEEN 1 AND 128),
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','COMPLETE','PARTIAL','FAILED')),
    total_count INTEGER NOT NULL CHECK(total_count BETWEEN 0 AND 10000),
    terminal_count INTEGER NOT NULL DEFAULT 0 CHECK(terminal_count BETWEEN 0 AND 10000),
    succeeded_count INTEGER NOT NULL DEFAULT 0 CHECK(succeeded_count BETWEEN 0 AND 10000),
    no_changes_count INTEGER NOT NULL DEFAULT 0 CHECK(no_changes_count BETWEEN 0 AND 10000),
    skipped_manual_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_manual_count BETWEEN 0 AND 10000),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_count BETWEEN 0 AND 10000),
    changed_count INTEGER NOT NULL DEFAULT 0 CHECK(changed_count BETWEEN 0 AND 9007199254740991),
    created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      CHECK(length(created_at) BETWEEN 20 AND 32 AND substr(created_at,-1)='Z' AND datetime(created_at) IS NOT NULL),
    updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      CHECK(length(updated_at) BETWEEN 20 AND 32 AND substr(updated_at,-1)='Z' AND datetime(updated_at) IS NOT NULL),
    completed_at TEXT CHECK(
      completed_at IS NULL OR (length(completed_at) BETWEEN 20 AND 32
      AND substr(completed_at,-1)='Z' AND datetime(completed_at) IS NOT NULL)
    ),
    UNIQUE(batch_id,household_id),
    CHECK(updated_at>=created_at),
    CHECK(completed_at IS NULL OR completed_at>=created_at),
    CHECK(terminal_count=succeeded_count+no_changes_count+skipped_manual_count+failed_count),
    CHECK(terminal_count<=total_count),
    CHECK(
      (status='ACTIVE' AND completed_at IS NULL AND terminal_count<total_count)
      OR (status!='ACTIVE' AND completed_at IS NOT NULL AND terminal_count=total_count)
    ),
    CHECK(status!='COMPLETE' OR failed_count=0),
    CHECK(status!='PARTIAL' OR (failed_count>0 AND succeeded_count+no_changes_count>0)),
    CHECK(status!='FAILED' OR (failed_count>0 AND succeeded_count+no_changes_count=0))
) STRICT;

CREATE UNIQUE INDEX idx_connector_refresh_one_active_household
  ON connector_refresh_batches(household_id) WHERE status='ACTIVE';
CREATE INDEX idx_connector_refresh_retention
  ON connector_refresh_batches(household_id,completed_at DESC,batch_id DESC)
  WHERE status!='ACTIVE';

CREATE TABLE connector_refresh_batch_items (
    batch_id TEXT NOT NULL REFERENCES connector_refresh_batches(batch_id) ON DELETE CASCADE,
    item_id TEXT NOT NULL CHECK(
      length(item_id) BETWEEN 1 AND 64 AND item_id=trim(item_id)
      AND item_id NOT GLOB '*[^0-9A-Za-z_-]*'
    ),
    connector_kind TEXT NOT NULL CHECK(connector_kind IN (
      'GOOGLE_DRIVE','GMAIL','WATCHED_FOLDER','MANUAL_IMPORT'
    )),
    connection_key TEXT NOT NULL CHECK(
      length(connection_key) BETWEEN 1 AND 128 AND connection_key=trim(connection_key)
      AND connection_key NOT GLOB '*[^!-~]*' AND instr(connection_key,'/')=0
    ),
    status TEXT NOT NULL CHECK(status IN (
      'PENDING','RUNNING','SUCCEEDED','NO_CHANGES','SKIPPED_MANUAL',
      'FAILED_RETRYABLE','NEEDS_ACTION'
    )),
    attempt_generation INTEGER NOT NULL DEFAULT 0
      CHECK(attempt_generation BETWEEN 0 AND 9007199254740991),
    lease_token TEXT CHECK(
      lease_token IS NULL OR (length(lease_token)=64 AND lease_token NOT GLOB '*[^0-9a-f]*')
    ),
    lease_expires_at TEXT CHECK(
      lease_expires_at IS NULL OR (length(lease_expires_at) BETWEEN 20 AND 32
      AND substr(lease_expires_at,-1)='Z' AND datetime(lease_expires_at) IS NOT NULL)
    ),
    changed_count INTEGER NOT NULL DEFAULT 0 CHECK(changed_count BETWEEN 0 AND 9007199254740991),
    last_error_code TEXT CHECK(
      last_error_code IS NULL OR (length(last_error_code) BETWEEN 1 AND 64
      AND last_error_code NOT GLOB '*[^A-Z0-9_]*')
    ),
    created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      CHECK(length(created_at) BETWEEN 20 AND 32 AND substr(created_at,-1)='Z' AND datetime(created_at) IS NOT NULL),
    updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      CHECK(length(updated_at) BETWEEN 20 AND 32 AND substr(updated_at,-1)='Z' AND datetime(updated_at) IS NOT NULL),
    started_at TEXT CHECK(
      started_at IS NULL OR (length(started_at) BETWEEN 20 AND 32
      AND substr(started_at,-1)='Z' AND datetime(started_at) IS NOT NULL)
    ),
    completed_at TEXT CHECK(
      completed_at IS NULL OR (length(completed_at) BETWEEN 20 AND 32
      AND substr(completed_at,-1)='Z' AND datetime(completed_at) IS NOT NULL)
    ),
    PRIMARY KEY(batch_id,item_id),
    UNIQUE(batch_id,connector_kind,connection_key),
    CHECK(updated_at>=created_at),
    CHECK(connector_kind!='MANUAL_IMPORT' OR connection_key='manual-import'),
    CHECK((status='RUNNING')=(lease_token IS NOT NULL)),
    CHECK((status='RUNNING')=(lease_expires_at IS NOT NULL)),
    CHECK(status!='RUNNING' OR attempt_generation>0),
    CHECK((status IN ('SUCCEEDED','NO_CHANGES','SKIPPED_MANUAL','FAILED_RETRYABLE','NEEDS_ACTION'))=(completed_at IS NOT NULL)),
    CHECK((status IN ('FAILED_RETRYABLE','NEEDS_ACTION'))=(last_error_code IS NOT NULL)),
    CHECK(status='SUCCEEDED' OR changed_count=0),
    CHECK(status!='SUCCEEDED' OR changed_count>0),
    CHECK(status NOT IN ('SUCCEEDED','NO_CHANGES','FAILED_RETRYABLE','NEEDS_ACTION') OR attempt_generation>0),
    CHECK(status!='RUNNING' OR started_at IS NOT NULL),
    CHECK(status!='SKIPPED_MANUAL' OR (connector_kind='MANUAL_IMPORT' AND attempt_generation=0))
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_connector_refresh_claim
  ON connector_refresh_batch_items(batch_id,status,connector_kind,connection_key,item_id);
CREATE INDEX idx_connector_refresh_expired
  ON connector_refresh_batch_items(lease_expires_at,batch_id,item_id)
  WHERE status='RUNNING';

CREATE TRIGGER trg_connector_refresh_batch_identity_immutable
BEFORE UPDATE ON connector_refresh_batches BEGIN
  SELECT CASE WHEN NEW.batch_id!=OLD.batch_id OR NEW.household_id!=OLD.household_id
      OR NEW.created_at!=OLD.created_at
    THEN RAISE(ABORT,'connector refresh batch identity is immutable') END;
END;

CREATE TRIGGER trg_connector_refresh_item_identity_immutable
BEFORE UPDATE ON connector_refresh_batch_items BEGIN
  SELECT CASE WHEN NEW.batch_id!=OLD.batch_id OR NEW.item_id!=OLD.item_id
      OR NEW.connector_kind!=OLD.connector_kind OR NEW.connection_key!=OLD.connection_key
      OR NEW.created_at!=OLD.created_at
    THEN RAISE(ABORT,'connector refresh item identity is immutable') END;
END;

CREATE TABLE connector_runtime_observations (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE
      CHECK(length(household_id) BETWEEN 1 AND 128),
    connector_kind TEXT NOT NULL CHECK(connector_kind IN (
      'GOOGLE_DRIVE','GMAIL','WATCHED_FOLDER','MANUAL_IMPORT'
    )),
    connection_key TEXT NOT NULL CHECK(
      length(connection_key) BETWEEN 1 AND 128 AND connection_key=trim(connection_key)
      AND connection_key NOT GLOB '*[^!-~]*' AND instr(connection_key,'/')=0
    ),
    last_attempt_at TEXT CHECK(
      last_attempt_at IS NULL OR (length(last_attempt_at) BETWEEN 20 AND 32
      AND substr(last_attempt_at,-1)='Z' AND datetime(last_attempt_at) IS NOT NULL)
    ),
    last_success_at TEXT CHECK(
      last_success_at IS NULL OR (length(last_success_at) BETWEEN 20 AND 32
      AND substr(last_success_at,-1)='Z' AND datetime(last_success_at) IS NOT NULL)
    ),
    freshness_deadline_at TEXT CHECK(
      freshness_deadline_at IS NULL OR (length(freshness_deadline_at) BETWEEN 20 AND 32
      AND substr(freshness_deadline_at,-1)='Z' AND datetime(freshness_deadline_at) IS NOT NULL)
    ),
    next_due_at TEXT CHECK(
      next_due_at IS NULL OR (length(next_due_at) BETWEEN 20 AND 32
      AND substr(next_due_at,-1)='Z' AND datetime(next_due_at) IS NOT NULL)
    ),
    pending_review_count INTEGER NOT NULL DEFAULT 0
      CHECK(pending_review_count BETWEEN 0 AND 9007199254740991),
    consecutive_failures INTEGER NOT NULL DEFAULT 0
      CHECK(consecutive_failures BETWEEN 0 AND 10000),
    last_error_code TEXT CHECK(
      last_error_code IS NULL OR (length(last_error_code) BETWEEN 1 AND 64
      AND last_error_code NOT GLOB '*[^A-Z0-9_]*')
    ),
    updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      CHECK(length(updated_at) BETWEEN 20 AND 32 AND substr(updated_at,-1)='Z' AND datetime(updated_at) IS NOT NULL),
    PRIMARY KEY(household_id,connector_kind,connection_key),
    CHECK(connector_kind!='MANUAL_IMPORT' OR connection_key='manual-import'),
    CHECK(last_success_at IS NULL OR last_attempt_at IS NULL OR last_success_at<=last_attempt_at)
) STRICT, WITHOUT ROWID;
