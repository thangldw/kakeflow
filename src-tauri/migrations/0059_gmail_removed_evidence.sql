-- A hydrated Gmail message may leave the selected label before review. Its
-- content-addressed raw EML remains valid immutable evidence, so REMOVED rows
-- retain the vault checksum and can return directly to READY when re-added.
PRAGMA writable_schema=ON;

UPDATE sqlite_schema
SET sql=replace(
  sql,
  'content_sha256 IS NULL OR state IN (''PROCESSING'',''READY'',''NEEDS_MAPPING'',''STAGED'',''IGNORED'',''FAILED'')',
  'content_sha256 IS NULL OR state IN (''PROCESSING'',''READY'',''NEEDS_MAPPING'',''STAGED'',''IGNORED'',''FAILED'',''REMOVED'')'
)
WHERE type='table' AND name='gmail_inbox'
  AND instr(sql, 'content_sha256 IS NULL OR state IN (''PROCESSING'',''READY'',''NEEDS_MAPPING'',''STAGED'',''IGNORED'',''FAILED'')')>0;

PRAGMA writable_schema=RESET;

CREATE TEMP TABLE assert_gmail_removed_evidence_hash(
  valid INTEGER NOT NULL CHECK(valid=1)
);
INSERT INTO assert_gmail_removed_evidence_hash(valid)
SELECT instr(sql, '''FAILED'',''REMOVED''')>0
FROM sqlite_schema WHERE type='table' AND name='gmail_inbox';
DROP TABLE assert_gmail_removed_evidence_hash;
