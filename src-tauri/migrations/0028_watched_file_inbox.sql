CREATE TABLE watched_file_inbox (
    id TEXT PRIMARY KEY NOT NULL CHECK (
        length(id) = 64 AND id NOT GLOB '*[^0-9a-f]*'
    ),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    watched_folder_id TEXT NOT NULL REFERENCES watched_folders(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL CHECK (
        length(relative_path) BETWEEN 1 AND 4096
        AND substr(relative_path, 1, 1) != '/'
        AND substr(relative_path, -1, 1) != '/'
        AND instr(relative_path, '\\') = 0
        AND instr(relative_path, char(0)) = 0
        AND relative_path NOT IN ('.', '..')
        AND relative_path NOT LIKE './%'
        AND relative_path NOT LIKE '../%'
        AND relative_path NOT LIKE '%/./%'
        AND relative_path NOT LIKE '%/../%'
        AND relative_path NOT LIKE '%/.'
        AND relative_path NOT LIKE '%/..'
        AND relative_path NOT LIKE '%//%'
    ),
    file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
    media_type TEXT NOT NULL CHECK (length(media_type) BETWEEN 1 AND 127),
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 0 AND 52428800),
    modified_unix_ms INTEGER CHECK (modified_unix_ms IS NULL OR modified_unix_ms >= 0),
    fingerprint TEXT NOT NULL CHECK (
        length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'
    ),
    state TEXT NOT NULL CHECK (state IN (
        'DISCOVERED', 'PROCESSING', 'READY', 'NEEDS_MAPPING',
        'STAGED', 'FAILED', 'IGNORED', 'REMOVED'
    )),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
    lease_token TEXT CHECK (
        lease_token IS NULL OR (
            length(lease_token) = 64 AND lease_token NOT GLOB '*[^0-9a-f]*'
        )
    ),
    lease_expires_at TEXT,
    processing_origin_state TEXT CHECK (
        processing_origin_state IS NULL
        OR processing_origin_state IN ('DISCOVERED', 'READY', 'NEEDS_MAPPING')
    ),
    import_run_id TEXT REFERENCES import_runs(id) ON DELETE RESTRICT,
    last_error_code TEXT CHECK (
        last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 64
    ),
    discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (updated_at >= discovered_at),
    CHECK (
        (state = 'PROCESSING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
            AND processing_origin_state IS NOT NULL)
        OR (state != 'PROCESSING' AND lease_token IS NULL AND lease_expires_at IS NULL
            AND processing_origin_state IS NULL)
    ),
    CHECK ((state = 'STAGED') = (import_run_id IS NOT NULL)),
    CHECK ((state = 'FAILED') = (last_error_code IS NOT NULL)),
    UNIQUE (watched_folder_id, relative_path, fingerprint)
) STRICT;

CREATE INDEX idx_watched_file_inbox_household_state
    ON watched_file_inbox (household_id, state, updated_at DESC, id);

CREATE INDEX idx_watched_file_inbox_current_path
    ON watched_file_inbox (watched_folder_id, relative_path, updated_at DESC, id);

CREATE INDEX idx_watched_file_inbox_expired_lease
    ON watched_file_inbox (lease_expires_at, id)
    WHERE state = 'PROCESSING';

CREATE TRIGGER watched_file_inbox_scope_insert
BEFORE INSERT ON watched_file_inbox
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM watched_folders wf
        WHERE wf.id = NEW.watched_folder_id
          AND wf.household_id = NEW.household_id
          AND wf.is_enabled = 1
    ) THEN RAISE(ABORT, 'watched file folder scope mismatch') END;
    SELECT CASE WHEN NEW.import_run_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM import_runs ir
        WHERE ir.id = NEW.import_run_id AND ir.household_id = NEW.household_id
    ) THEN RAISE(ABORT, 'watched file import scope mismatch') END;
END;

CREATE TRIGGER watched_file_inbox_scope_update
BEFORE UPDATE ON watched_file_inbox
BEGIN
    SELECT CASE WHEN NEW.id != OLD.id
        OR NEW.household_id != OLD.household_id
        OR NEW.watched_folder_id != OLD.watched_folder_id
        OR NEW.relative_path != OLD.relative_path
        OR NEW.fingerprint != OLD.fingerprint
        OR NEW.discovered_at != OLD.discovered_at
    THEN RAISE(ABORT, 'watched file identity is immutable') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM watched_folders wf
        WHERE wf.id = NEW.watched_folder_id
          AND wf.household_id = NEW.household_id
          AND wf.is_enabled = 1
    ) THEN RAISE(ABORT, 'watched file folder scope mismatch') END;
    SELECT CASE WHEN NEW.import_run_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM import_runs ir
        WHERE ir.id = NEW.import_run_id AND ir.household_id = NEW.household_id
    ) THEN RAISE(ABORT, 'watched file import scope mismatch') END;
END;
