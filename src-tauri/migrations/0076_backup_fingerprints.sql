-- The SHA-256 and size of each backup file at the moment it was written, so a later check can tell, without the
-- passphrase, whether the file is still there and byte-for-byte unchanged. Device-local (not synced): it
-- describes files on this machine. Only the newest few are kept; the path is the user's own choice.

CREATE TABLE backup_fingerprints (
    path TEXT PRIMARY KEY NOT NULL CHECK (length(path) BETWEEN 1 AND 4096),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    byte_size INTEGER NOT NULL CHECK (typeof(byte_size) = 'integer' AND byte_size >= 0),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
