ALTER TABLE watched_folders
ADD COLUMN source_type TEXT NOT NULL DEFAULT 'LOCAL_FOLDER'
CHECK (source_type IN ('LOCAL_FOLDER', 'ICLOUD_PICKER'));

ALTER TABLE watched_folders
ADD COLUMN provider TEXT NOT NULL DEFAULT 'LOCAL'
CHECK (
    provider IN ('LOCAL', 'ICLOUD')
    AND (
        (source_type = 'LOCAL_FOLDER' AND provider = 'LOCAL')
        OR (source_type = 'ICLOUD_PICKER' AND provider = 'ICLOUD')
    )
);
