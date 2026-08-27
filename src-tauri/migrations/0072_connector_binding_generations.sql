CREATE TABLE connector_binding_generations (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE
      CHECK(length(household_id) BETWEEN 1 AND 128),
    connector_kind TEXT NOT NULL CHECK(connector_kind IN (
      'GOOGLE_DRIVE','GMAIL','WATCHED_FOLDER','MANUAL_IMPORT'
    )),
    connection_key TEXT NOT NULL CHECK(
      length(connection_key) BETWEEN 1 AND 128 AND connection_key=trim(connection_key)
    ),
    generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
    updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(household_id,connector_kind,connection_key),
    CHECK(connector_kind!='MANUAL_IMPORT' OR connection_key='manual-import')
) STRICT, WITHOUT ROWID;

INSERT INTO connector_binding_generations
  (household_id,connector_kind,connection_key,generation,updated_at)
SELECT household_id,connector_kind,connection_key,version,updated_at
FROM connector_bindings;

CREATE TRIGGER trg_connector_binding_generation_insert
AFTER INSERT ON connector_bindings BEGIN
  INSERT INTO connector_binding_generations
    (household_id,connector_kind,connection_key,generation)
  VALUES(NEW.household_id,NEW.connector_kind,NEW.connection_key,1)
  ON CONFLICT(household_id,connector_kind,connection_key) DO UPDATE SET
    generation=generation+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

CREATE TRIGGER trg_connector_binding_generation_update
AFTER UPDATE ON connector_bindings BEGIN
  UPDATE connector_binding_generations
  SET generation=generation+1,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE household_id=NEW.household_id AND connector_kind=NEW.connector_kind
    AND connection_key=NEW.connection_key;
END;

CREATE TRIGGER trg_connector_binding_generation_delete
AFTER DELETE ON connector_bindings BEGIN
  UPDATE connector_binding_generations
  SET generation=generation+1,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE household_id=OLD.household_id AND connector_kind=OLD.connector_kind
    AND connection_key=OLD.connection_key;
END;
