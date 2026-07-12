CREATE TABLE watched_folders (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (
        length(trim(label)) > 0 AND length(label) <= 80
    ),
    canonical_path TEXT NOT NULL CHECK (
        length(canonical_path) > 0 AND length(canonical_path) <= 4096
    ),
    is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (household_id, canonical_path)
) STRICT;

CREATE INDEX idx_watched_folders_household
    ON watched_folders (household_id, created_at, id)
    WHERE is_enabled = 1;
