CREATE TABLE connector_bindings (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE
      CHECK(length(household_id) BETWEEN 1 AND 128),
    connector_kind TEXT NOT NULL CHECK(connector_kind IN (
      'GOOGLE_DRIVE','GMAIL','WATCHED_FOLDER','MANUAL_IMPORT'
    )),
    connection_key TEXT NOT NULL CHECK(
      length(connection_key) BETWEEN 1 AND 128 AND connection_key=trim(connection_key)
    ),
    parser_profile_id TEXT CHECK(
      parser_profile_id IS NULL OR length(parser_profile_id) BETWEEN 1 AND 64
    ),
    parser_profile_version INTEGER CHECK(
      parser_profile_version IS NULL OR parser_profile_version BETWEEN 1 AND 9007199254740991
    ),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
    created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(household_id,connector_kind,connection_key),
    CHECK((parser_profile_id IS NULL)=(parser_profile_version IS NULL)),
    CHECK(updated_at>=created_at),
    CHECK(connector_kind!='MANUAL_IMPORT' OR connection_key='manual-import')
) STRICT, WITHOUT ROWID;

CREATE TABLE connector_binding_accounts (
    household_id TEXT NOT NULL CHECK(length(household_id) BETWEEN 1 AND 128),
    connector_kind TEXT NOT NULL CHECK(connector_kind IN (
      'GOOGLE_DRIVE','GMAIL','WATCHED_FOLDER','MANUAL_IMPORT'
    )),
    connection_key TEXT NOT NULL CHECK(length(connection_key) BETWEEN 1 AND 128),
    account_id TEXT NOT NULL CHECK(length(account_id) BETWEEN 1 AND 64),
    PRIMARY KEY(household_id,connector_kind,connection_key,account_id),
    FOREIGN KEY(household_id,connector_kind,connection_key)
      REFERENCES connector_bindings(household_id,connector_kind,connection_key)
      ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_connector_binding_accounts_account
  ON connector_binding_accounts(household_id,account_id,connector_kind,connection_key);

CREATE TRIGGER trg_connector_bindings_scope_insert
BEFORE INSERT ON connector_bindings BEGIN
  SELECT CASE
    WHEN NEW.connector_kind='GOOGLE_DRIVE' AND NOT EXISTS(
      SELECT 1 FROM google_drive_connections c
      WHERE c.id=NEW.connection_key AND c.household_id=NEW.household_id
    ) THEN RAISE(ABORT,'connector binding drive scope mismatch')
    WHEN NEW.connector_kind='GMAIL' AND NOT EXISTS(
      SELECT 1 FROM gmail_connections c
      WHERE c.id=NEW.connection_key AND c.household_id=NEW.household_id
    ) THEN RAISE(ABORT,'connector binding gmail scope mismatch')
    WHEN NEW.connector_kind='WATCHED_FOLDER' AND NOT EXISTS(
      SELECT 1 FROM watched_folders f
      WHERE f.id=NEW.connection_key AND f.household_id=NEW.household_id
    ) THEN RAISE(ABORT,'connector binding folder scope mismatch')
    WHEN NEW.connector_kind='MANUAL_IMPORT' AND NOT EXISTS(
      SELECT 1 FROM households h WHERE h.id=NEW.household_id
    ) THEN RAISE(ABORT,'connector binding household scope mismatch')
  END;
  SELECT CASE WHEN NEW.parser_profile_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM delimited_parser_profiles p
    WHERE p.id=NEW.parser_profile_id AND p.household_id=NEW.household_id
      AND p.version=NEW.parser_profile_version AND p.is_enabled=1
  ) THEN RAISE(ABORT,'connector binding parser scope mismatch') END;
END;

CREATE TRIGGER trg_connector_bindings_scope_update
BEFORE UPDATE ON connector_bindings BEGIN
  SELECT CASE WHEN NEW.household_id!=OLD.household_id
      OR NEW.connector_kind!=OLD.connector_kind OR NEW.connection_key!=OLD.connection_key
    THEN RAISE(ABORT,'connector binding identity is immutable') END;
  SELECT CASE WHEN NEW.version!=OLD.version+1
    THEN RAISE(ABORT,'connector binding version mismatch') END;
  SELECT CASE
    WHEN NEW.connector_kind='GOOGLE_DRIVE' AND NOT EXISTS(
      SELECT 1 FROM google_drive_connections c
      WHERE c.id=NEW.connection_key AND c.household_id=NEW.household_id
    ) THEN RAISE(ABORT,'connector binding drive scope mismatch')
    WHEN NEW.connector_kind='GMAIL' AND NOT EXISTS(
      SELECT 1 FROM gmail_connections c
      WHERE c.id=NEW.connection_key AND c.household_id=NEW.household_id
    ) THEN RAISE(ABORT,'connector binding gmail scope mismatch')
    WHEN NEW.connector_kind='WATCHED_FOLDER' AND NOT EXISTS(
      SELECT 1 FROM watched_folders f
      WHERE f.id=NEW.connection_key AND f.household_id=NEW.household_id
    ) THEN RAISE(ABORT,'connector binding folder scope mismatch')
    WHEN NEW.connector_kind='MANUAL_IMPORT' AND NOT EXISTS(
      SELECT 1 FROM households h WHERE h.id=NEW.household_id
    ) THEN RAISE(ABORT,'connector binding household scope mismatch')
  END;
  SELECT CASE WHEN NEW.parser_profile_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM delimited_parser_profiles p
    WHERE p.id=NEW.parser_profile_id AND p.household_id=NEW.household_id
      AND p.version=NEW.parser_profile_version AND p.is_enabled=1
  ) THEN RAISE(ABORT,'connector binding parser scope mismatch') END;
END;

CREATE TRIGGER trg_connector_binding_accounts_scope_insert
BEFORE INSERT ON connector_binding_accounts BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM accounts a
    WHERE a.id=NEW.account_id AND a.household_id=NEW.household_id AND a.is_archived=0
  ) THEN RAISE(ABORT,'connector binding account scope mismatch') END;
  SELECT CASE WHEN (
    SELECT count(*) FROM connector_binding_accounts a
    WHERE a.household_id=NEW.household_id AND a.connector_kind=NEW.connector_kind
      AND a.connection_key=NEW.connection_key
  )>=256 THEN RAISE(ABORT,'connector binding account limit exceeded') END;
END;

CREATE TRIGGER trg_connector_binding_accounts_scope_update
BEFORE UPDATE ON connector_binding_accounts BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM accounts a
    WHERE a.id=NEW.account_id AND a.household_id=NEW.household_id AND a.is_archived=0
  ) THEN RAISE(ABORT,'connector binding account scope mismatch') END;
END;

CREATE TRIGGER trg_connector_binding_drive_disconnect
AFTER UPDATE OF status ON google_drive_connections
WHEN NEW.status='DISCONNECTED' BEGIN
  DELETE FROM connector_bindings
   WHERE household_id=NEW.household_id AND connector_kind='GOOGLE_DRIVE'
     AND connection_key=NEW.id;
END;

CREATE TRIGGER trg_connector_binding_drive_remove
AFTER DELETE ON google_drive_connections BEGIN
  DELETE FROM connector_bindings
   WHERE household_id=OLD.household_id AND connector_kind='GOOGLE_DRIVE'
     AND connection_key=OLD.id;
END;

CREATE TRIGGER trg_connector_binding_gmail_disconnect
AFTER UPDATE OF status ON gmail_connections
WHEN NEW.status='DISCONNECTED' BEGIN
  DELETE FROM connector_bindings
   WHERE household_id=NEW.household_id AND connector_kind='GMAIL'
     AND connection_key=NEW.id;
END;

CREATE TRIGGER trg_connector_binding_gmail_remove
AFTER DELETE ON gmail_connections BEGIN
  DELETE FROM connector_bindings
   WHERE household_id=OLD.household_id AND connector_kind='GMAIL'
     AND connection_key=OLD.id;
END;

CREATE TRIGGER trg_connector_binding_folder_remove
AFTER DELETE ON watched_folders BEGIN
  DELETE FROM connector_bindings
   WHERE household_id=OLD.household_id AND connector_kind='WATCHED_FOLDER'
     AND connection_key=OLD.id;
END;
