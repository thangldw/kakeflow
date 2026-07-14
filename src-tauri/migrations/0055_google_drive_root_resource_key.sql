-- Resource keys are required to resolve some link-shared Drive folders. Keep
-- the opaque, URL-safe key with the selected root; it is metadata rather than
-- an OAuth credential and is bounded to the parser's accepted representation.
ALTER TABLE google_drive_connections
ADD COLUMN root_resource_key TEXT CHECK (
    root_resource_key IS NULL OR (
        root_folder_id IS NOT NULL
        AND length(root_resource_key) BETWEEN 1 AND 256
        AND root_resource_key NOT GLOB '*[^0-9A-Za-z_-]*'
    )
);
