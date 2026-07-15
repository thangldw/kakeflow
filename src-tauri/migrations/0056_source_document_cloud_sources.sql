-- SQLite cannot drop or replace an inline CHECK constraint with ALTER TABLE.
-- This bounded schema-text update widens only the known source_type enum while
-- preserving the table, its rows, foreign keys, indexes, and triggers.
PRAGMA writable_schema=ON;

UPDATE sqlite_schema
SET sql=replace(
    sql,
    '''LOCAL_FOLDER'', ''MANUAL_UPLOAD'', ''CAMERA_SCAN'', ''OTHER''',
    '''LOCAL_FOLDER'', ''ICLOUD_PICKER'', ''GOOGLE_DRIVE'', ''MANUAL_UPLOAD'', ''CAMERA_SCAN'', ''OTHER'''
)
WHERE type='table' AND name='source_documents'
  AND instr(sql, '''LOCAL_FOLDER'', ''MANUAL_UPLOAD'', ''CAMERA_SCAN'', ''OTHER''')>0;

-- Hydrated READY/NEEDS_MAPPING records must retain their immutable vault hash
-- while a short staging lease moves them through PROCESSING.
UPDATE sqlite_schema
SET sql=replace(
    sql,
    'content_sha256 IS NULL OR state IN (''READY'',''NEEDS_MAPPING'',''STAGED'',''IGNORED'',''FAILED'')',
    'content_sha256 IS NULL OR state IN (''PROCESSING'',''READY'',''NEEDS_MAPPING'',''STAGED'',''IGNORED'',''FAILED'')'
)
WHERE type='table' AND name='google_drive_inbox'
  AND instr(sql, 'content_sha256 IS NULL OR state IN (''READY'',''NEEDS_MAPPING'',''STAGED'',''IGNORED'',''FAILED'')')>0;

PRAGMA writable_schema=RESET;

CREATE TEMP TABLE assert_source_document_cloud_sources (
    valid INTEGER NOT NULL CHECK(valid=1)
);
INSERT INTO assert_source_document_cloud_sources(valid)
SELECT instr(sql, '''ICLOUD_PICKER''')>0 AND instr(sql, '''GOOGLE_DRIVE''')>0
FROM sqlite_schema WHERE type='table' AND name='source_documents';
DROP TABLE assert_source_document_cloud_sources;

CREATE TEMP TABLE assert_google_drive_hydrated_processing (
    valid INTEGER NOT NULL CHECK(valid=1)
);
INSERT INTO assert_google_drive_hydrated_processing(valid)
SELECT instr(sql, '''PROCESSING'',''READY'',''NEEDS_MAPPING'',''STAGED''')>0
FROM sqlite_schema WHERE type='table' AND name='google_drive_inbox';
DROP TABLE assert_google_drive_hydrated_processing;
