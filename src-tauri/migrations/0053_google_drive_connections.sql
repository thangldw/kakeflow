-- Google Drive grants are device-local. SQLite stores only bounded remote
-- metadata and change-cursor coordination; refresh tokens live in the native
-- credential store.
CREATE TABLE google_drive_connections (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 128),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    google_account_id TEXT CHECK (google_account_id IS NULL OR length(trim(google_account_id)) BETWEEN 1 AND 256),
    account_email TEXT CHECK (account_email IS NULL OR length(trim(account_email)) BETWEEN 3 AND 320),
    client_id_fingerprint TEXT NOT NULL CHECK (
        length(client_id_fingerprint)=64 AND client_id_fingerprint NOT GLOB '*[^0-9a-f]*'
    ),
    oauth_scope TEXT NOT NULL DEFAULT 'https://www.googleapis.com/auth/drive.readonly'
        CHECK (oauth_scope='https://www.googleapis.com/auth/drive.readonly'),
    drive_id TEXT CHECK (drive_id IS NULL OR length(trim(drive_id)) BETWEEN 1 AND 256),
    root_folder_id TEXT CHECK (root_folder_id IS NULL OR length(trim(root_folder_id)) BETWEEN 1 AND 256),
    root_folder_name TEXT CHECK (root_folder_name IS NULL OR length(trim(root_folder_name)) BETWEEN 1 AND 255),
    status TEXT NOT NULL DEFAULT 'AUTHORIZING' CHECK (
        status IN ('AUTHORIZING','SELECTING_FOLDER','CONNECTED','AUTH_REQUIRED','DISCONNECTED')
    ),
    start_page_token TEXT CHECK (start_page_token IS NULL OR length(start_page_token) BETWEEN 1 AND 4096),
    change_page_token TEXT CHECK (change_page_token IS NULL OR length(change_page_token) BETWEEN 1 AND 4096),
    last_full_scan_at TEXT,
    last_change_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(household_id,google_account_id,root_folder_id),
    CHECK (updated_at>=created_at),
    CHECK ((root_folder_id IS NULL)=(root_folder_name IS NULL)),
    CHECK (status NOT IN ('SELECTING_FOLDER','CONNECTED') OR google_account_id IS NOT NULL),
    CHECK (status!='CONNECTED' OR root_folder_id IS NOT NULL),
    CHECK (change_page_token IS NULL OR start_page_token IS NOT NULL),
    CHECK (status!='CONNECTED' OR change_page_token IS NOT NULL)
) STRICT;

CREATE INDEX idx_google_drive_connections_household
    ON google_drive_connections(household_id,status,updated_at DESC,id);

CREATE TABLE google_drive_nodes (
    connection_id TEXT NOT NULL REFERENCES google_drive_connections(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL CHECK (length(trim(file_id)) BETWEEN 1 AND 256),
    parent_file_id TEXT CHECK (parent_file_id IS NULL OR length(trim(parent_file_id)) BETWEEN 1 AND 256),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 255),
    mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) BETWEEN 1 AND 127),
    modified_time TEXT,
    -- Keep oversized remote files visible so the inbox can classify them as
    -- TOO_LARGE without attempting a download. Actual byte intake is capped
    -- by the downloader, not by metadata discovery.
    byte_size INTEGER CHECK (byte_size IS NULL OR byte_size BETWEEN 0 AND 9007199254740991),
    md5_checksum TEXT CHECK (
        md5_checksum IS NULL OR (length(md5_checksum)=32 AND md5_checksum NOT GLOB '*[^0-9a-f]*')
    ),
    drive_version TEXT CHECK (drive_version IS NULL OR length(drive_version) BETWEEN 1 AND 128),
    generation_fingerprint TEXT NOT NULL CHECK (
        length(generation_fingerprint)=64 AND generation_fingerprint NOT GLOB '*[^0-9a-f]*'
    ),
    is_folder INTEGER NOT NULL CHECK (is_folder IN (0,1)),
    can_download INTEGER NOT NULL DEFAULT 0 CHECK (can_download IN (0,1)),
    is_in_selected_tree INTEGER NOT NULL DEFAULT 1 CHECK (is_in_selected_tree IN (0,1)),
    is_trashed INTEGER NOT NULL DEFAULT 0 CHECK (is_trashed IN (0,1)),
    discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(connection_id,file_id),
    CHECK (updated_at>=discovered_at),
    CHECK ((mime_type='application/vnd.google-apps.folder')=is_folder),
    CHECK (is_folder=0 OR (byte_size IS NULL AND md5_checksum IS NULL AND can_download=0))
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_google_drive_nodes_parent
    ON google_drive_nodes(connection_id,parent_file_id,is_trashed,name,file_id);
CREATE INDEX idx_google_drive_nodes_generation
    ON google_drive_nodes(connection_id,generation_fingerprint,file_id);

CREATE TABLE google_drive_sync_schedules (
    connection_id TEXT PRIMARY KEY NOT NULL REFERENCES google_drive_connections(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
    interval_minutes INTEGER NOT NULL DEFAULT 30 CHECK (interval_minutes IN (15,30,60)),
    next_due_at TEXT,
    lease_token TEXT CHECK (lease_token IS NULL OR (
        length(lease_token)=64 AND lease_token NOT GLOB '*[^0-9a-f]*'
    )),
    lease_expires_at TEXT,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_result TEXT NOT NULL DEFAULT 'NEVER' CHECK (last_result IN (
        'NEVER','RUNNING','NO_CHANGES','DISCOVERED','FAILED_RETRYABLE',
        'LEASE_EXPIRED','TERMINAL_SUSPENDED','DISABLED'
    )),
    last_discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (last_discovered_count>=0),
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures BETWEEN 0 AND 10),
    suspended_until TEXT,
    suspension_reason TEXT CHECK (suspension_reason IS NULL OR suspension_reason IN (
        'RETRY_BACKOFF','AUTH_EXPIRED','MISSING_CREDENTIAL','CURSOR_INVALID'
    )),
    last_error_code TEXT CHECK (last_error_code IS NULL OR length(trim(last_error_code)) BETWEEN 1 AND 64),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK ((enabled=0 AND next_due_at IS NULL AND lease_token IS NULL
            AND lease_expires_at IS NULL AND suspended_until IS NULL)
        OR (enabled=1 AND next_due_at IS NOT NULL)),
    CHECK ((lease_token IS NULL AND lease_expires_at IS NULL)
        OR (enabled=1 AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((last_result='RUNNING' AND lease_token IS NOT NULL)
        OR (last_result!='RUNNING' AND lease_token IS NULL)),
    CHECK ((suspension_reason IS NULL AND suspended_until IS NULL)
        OR (suspension_reason='RETRY_BACKOFF' AND suspended_until IS NOT NULL)
        OR (suspension_reason IN ('AUTH_EXPIRED','MISSING_CREDENTIAL','CURSOR_INVALID')
            AND enabled=1 AND suspended_until IS NULL AND last_result='TERMINAL_SUSPENDED'))
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_google_drive_schedule_due
    ON google_drive_sync_schedules(enabled,next_due_at,connection_id)
    WHERE enabled=1 AND lease_token IS NULL;

CREATE INDEX idx_google_drive_schedule_expired_lease
    ON google_drive_sync_schedules(lease_expires_at,connection_id)
    WHERE lease_token IS NOT NULL;
