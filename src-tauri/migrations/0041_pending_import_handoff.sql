-- A pending-import handoff is an immutable receipt for one mutable review run.
-- Package contents remain outside SQLite until the user explicitly applies the
-- fully verified, passphrase-protected archive.
CREATE TABLE pending_import_receipts (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    portable_run_id TEXT NOT NULL
        CHECK (length(trim(portable_run_id)) BETWEEN 1 AND 255),
    package_id TEXT NOT NULL
        CHECK (length(package_id) = 64 AND package_id NOT GLOB '*[^0-9a-f]*'),
    manifest_sha256 TEXT NOT NULL
        CHECK (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
    local_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE RESTRICT,
    local_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id, origin_installation_id, portable_run_id),
    UNIQUE (household_id, package_id),
    UNIQUE (household_id, origin_installation_id, manifest_sha256)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER trg_pending_import_receipt_scope_insert
BEFORE INSERT ON pending_import_receipts
WHEN NOT EXISTS (
    SELECT 1 FROM import_runs run
    JOIN source_documents document ON document.id = NEW.local_document_id
    WHERE run.id = NEW.local_run_id
      AND run.household_id = NEW.household_id
      AND document.import_run_id = run.id
      AND document.household_id = run.household_id
)
BEGIN
    SELECT RAISE(ABORT,'pending import receipt scope mismatch');
END;

CREATE TRIGGER trg_pending_import_receipt_immutable
BEFORE UPDATE ON pending_import_receipts
BEGIN
    SELECT RAISE(ABORT,'pending import receipts are immutable');
END;

CREATE TABLE pending_import_entity_aliases (
    household_id TEXT NOT NULL,
    origin_installation_id TEXT NOT NULL,
    portable_run_id TEXT NOT NULL,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'IMPORT_RUN','SOURCE_DOCUMENT','SOURCE_RECORD','CANDIDATE','CARD_STATEMENT'
    )),
    portable_entity_id TEXT NOT NULL
        CHECK (length(trim(portable_entity_id)) BETWEEN 1 AND 255),
    local_entity_id TEXT NOT NULL
        CHECK (length(trim(local_entity_id)) BETWEEN 1 AND 255),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (
        household_id, origin_installation_id, portable_run_id,
        entity_kind, portable_entity_id
    ),
    UNIQUE (entity_kind, local_entity_id),
    FOREIGN KEY (household_id, origin_installation_id, portable_run_id)
        REFERENCES pending_import_receipts(
            household_id, origin_installation_id, portable_run_id
        ) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE TRIGGER trg_pending_import_alias_immutable
BEFORE UPDATE ON pending_import_entity_aliases
BEGIN
    SELECT RAISE(ABORT,'pending import aliases are immutable');
END;
