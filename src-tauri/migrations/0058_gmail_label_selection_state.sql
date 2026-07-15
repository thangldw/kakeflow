-- OAuth credentials must be persisted before users can list and select a
-- Gmail label. Widen the already-released 0057 state machine without
-- rebuilding device-local connector rows.
PRAGMA writable_schema=ON;

UPDATE sqlite_schema
SET sql=replace(
  sql,
  'status IN (''AUTHORIZING'',''CONNECTED'',''AUTH_REQUIRED'',''DISCONNECTED'')',
  'status IN (''AUTHORIZING'',''SELECTING_LABEL'',''CONNECTED'',''AUTH_REQUIRED'',''DISCONNECTED'')'
)
WHERE type='table' AND name='gmail_connections'
  AND instr(sql, 'status IN (''AUTHORIZING'',''CONNECTED'',''AUTH_REQUIRED'',''DISCONNECTED'')')>0;

UPDATE sqlite_schema
SET sql=replace(
  sql,
  'CHECK(status!=''CONNECTED'' OR (google_account_id IS NOT NULL AND history_id IS NOT NULL AND label_id IS NOT NULL))',
  'CHECK(status NOT IN (''SELECTING_LABEL'',''CONNECTED'') OR (google_account_id IS NOT NULL AND history_id IS NOT NULL)), CHECK(status!=''CONNECTED'' OR label_id IS NOT NULL)'
)
WHERE type='table' AND name='gmail_connections'
  AND instr(sql, 'CHECK(status!=''CONNECTED'' OR (google_account_id IS NOT NULL AND history_id IS NOT NULL AND label_id IS NOT NULL))')>0;

PRAGMA writable_schema=RESET;

CREATE TEMP TABLE assert_gmail_label_selection_state(
  valid INTEGER NOT NULL CHECK(valid=1)
);
INSERT INTO assert_gmail_label_selection_state(valid)
SELECT instr(sql, '''SELECTING_LABEL''')>0
   AND instr(sql, 'status NOT IN (''SELECTING_LABEL'',''CONNECTED'')')>0
   AND instr(sql, 'status!=''CONNECTED'' OR label_id IS NOT NULL')>0
FROM sqlite_schema WHERE type='table' AND name='gmail_connections';
DROP TABLE assert_gmail_label_selection_state;
