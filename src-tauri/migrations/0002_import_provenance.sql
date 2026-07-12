CREATE TABLE import_runs (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN (
        'DISCOVERED', 'EXTRACTING', 'REVIEW_REQUIRED', 'POSTED', 'FAILED', 'ROLLED_BACK'
    )),
    adapter_id TEXT,
    adapter_version TEXT,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at TEXT,
    CHECK (completed_at IS NULL OR completed_at >= started_at)
) STRICT;

CREATE TABLE source_documents (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    import_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN (
        'LOCAL_FOLDER', 'MANUAL_UPLOAD', 'CAMERA_SCAN', 'OTHER'
    )),
    original_filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    storage_path TEXT NOT NULL,
    source_modified_at TEXT,
    imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (household_id, sha256)
) STRICT;

CREATE TABLE source_records (
    id TEXT PRIMARY KEY NOT NULL,
    source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL CHECK (row_number > 0),
    record_hash TEXT NOT NULL CHECK (length(record_hash) = 64),
    raw_payload_json TEXT NOT NULL CHECK (json_valid(raw_payload_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_document_id, row_number),
    UNIQUE (source_document_id, record_hash)
) STRICT;

CREATE INDEX idx_import_runs_household_status
    ON import_runs (household_id, status, started_at DESC);
CREATE INDEX idx_source_documents_import_run
    ON source_documents (import_run_id);
CREATE INDEX idx_source_records_document
    ON source_records (source_document_id, row_number);
