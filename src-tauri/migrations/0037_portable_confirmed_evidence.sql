-- Portable evidence capsules hydrate immutable provenance into the local vault
-- and source graph. These aliases retain the capsule's origin identifiers when
-- a local identifier must differ or an existing content-addressed row is reused.
-- Local change-package schemas remain unchanged by this migration.

CREATE TABLE evidence_bundle_receipts (
    bundle_id TEXT PRIMARY KEY NOT NULL
        CHECK (length(trim(bundle_id)) BETWEEN 1 AND 128),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    manifest_sha256 TEXT NOT NULL CHECK (
        length(manifest_sha256) = 64
        AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (household_id, origin_installation_id, manifest_sha256)
) STRICT;

CREATE INDEX idx_evidence_bundle_receipts_origin
    ON evidence_bundle_receipts(
        household_id, origin_installation_id, imported_at DESC, bundle_id
    );

CREATE TRIGGER trg_evidence_bundle_receipt_immutable
BEFORE UPDATE ON evidence_bundle_receipts
BEGIN
    SELECT RAISE(ABORT,'evidence bundle receipts are immutable');
END;

CREATE TABLE evidence_import_run_aliases (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    portable_import_run_id TEXT NOT NULL
        CHECK (length(trim(portable_import_run_id)) BETWEEN 1 AND 128),
    local_import_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id, origin_installation_id, portable_import_run_id),
    UNIQUE (household_id, portable_import_run_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_evidence_import_run_aliases_local
    ON evidence_import_run_aliases(household_id, local_import_run_id);

CREATE TRIGGER trg_evidence_import_run_alias_scope_insert
BEFORE INSERT ON evidence_import_run_aliases
WHEN NOT EXISTS (
    SELECT 1 FROM import_runs run
    WHERE run.id = NEW.local_import_run_id
      AND run.household_id = NEW.household_id
)
BEGIN
    SELECT RAISE(ABORT,'evidence import-run alias scope mismatch');
END;

CREATE TRIGGER trg_evidence_import_run_alias_immutable
BEFORE UPDATE ON evidence_import_run_aliases
BEGIN
    SELECT RAISE(ABORT,'evidence import-run aliases are immutable');
END;

CREATE TABLE evidence_source_document_aliases (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    portable_document_id TEXT NOT NULL
        CHECK (length(trim(portable_document_id)) BETWEEN 1 AND 128),
    portable_import_run_id TEXT NOT NULL
        CHECK (length(trim(portable_import_run_id)) BETWEEN 1 AND 128),
    local_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
    content_sha256 TEXT NOT NULL CHECK (
        length(content_sha256) = 64
        AND content_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id, origin_installation_id, portable_document_id),
    UNIQUE (household_id, portable_document_id),
    FOREIGN KEY (household_id, origin_installation_id, portable_import_run_id)
        REFERENCES evidence_import_run_aliases(
            household_id, origin_installation_id, portable_import_run_id
        ) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_evidence_source_document_aliases_local
    ON evidence_source_document_aliases(household_id, local_document_id);

CREATE INDEX idx_evidence_source_document_aliases_hash
    ON evidence_source_document_aliases(household_id, content_sha256);

CREATE TRIGGER trg_evidence_source_document_alias_scope_insert
BEFORE INSERT ON evidence_source_document_aliases
WHEN NOT EXISTS (
    SELECT 1
    FROM evidence_import_run_aliases run_alias
    JOIN source_documents document
      ON document.id = NEW.local_document_id
    WHERE run_alias.household_id = NEW.household_id
      AND run_alias.origin_installation_id = NEW.origin_installation_id
      AND run_alias.portable_import_run_id = NEW.portable_import_run_id
      AND document.household_id = NEW.household_id
      AND document.sha256 = NEW.content_sha256
)
BEGIN
    SELECT RAISE(ABORT,'evidence source-document alias mismatch');
END;

CREATE TRIGGER trg_evidence_source_document_alias_immutable
BEFORE UPDATE ON evidence_source_document_aliases
BEGIN
    SELECT RAISE(ABORT,'evidence source-document aliases are immutable');
END;

CREATE TABLE evidence_source_record_aliases (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    portable_document_id TEXT NOT NULL
        CHECK (length(trim(portable_document_id)) BETWEEN 1 AND 128),
    portable_record_id TEXT NOT NULL
        CHECK (length(trim(portable_record_id)) BETWEEN 1 AND 128),
    local_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
    record_hash TEXT NOT NULL CHECK (
        length(record_hash) = 64
        AND record_hash NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id, origin_installation_id, portable_record_id),
    UNIQUE (household_id, portable_record_id),
    FOREIGN KEY (household_id, origin_installation_id, portable_document_id)
        REFERENCES evidence_source_document_aliases(
            household_id, origin_installation_id, portable_document_id
        ) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_evidence_source_record_aliases_local
    ON evidence_source_record_aliases(household_id, local_record_id);

CREATE INDEX idx_evidence_source_record_aliases_document
    ON evidence_source_record_aliases(
        household_id, origin_installation_id, portable_document_id, portable_record_id
    );

CREATE TRIGGER trg_evidence_source_record_alias_scope_insert
BEFORE INSERT ON evidence_source_record_aliases
WHEN NOT EXISTS (
    SELECT 1
    FROM evidence_source_document_aliases document_alias
    JOIN source_records record
      ON record.id = NEW.local_record_id
    WHERE document_alias.household_id = NEW.household_id
      AND document_alias.origin_installation_id = NEW.origin_installation_id
      AND document_alias.portable_document_id = NEW.portable_document_id
      AND record.source_document_id = document_alias.local_document_id
      AND record.record_hash = NEW.record_hash
)
BEGIN
    SELECT RAISE(ABORT,'evidence source-record alias mismatch');
END;

CREATE TRIGGER trg_evidence_source_record_alias_immutable
BEFORE UPDATE ON evidence_source_record_aliases
BEGIN
    SELECT RAISE(ABORT,'evidence source-record aliases are immutable');
END;

-- Receipt candidates that remain pending are deliberately absent. Once a user
-- confirms a receipt as evidence for an existing posted purchase, this compact
-- relation preserves the decision without recreating a mutable candidate.
CREATE TABLE confirmed_receipt_evidence (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    origin_installation_id TEXT NOT NULL
        CHECK (length(trim(origin_installation_id)) BETWEEN 1 AND 128),
    portable_candidate_id TEXT NOT NULL
        CHECK (length(trim(portable_candidate_id)) BETWEEN 1 AND 128),
    linked_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id, origin_installation_id, portable_candidate_id),
    UNIQUE (household_id, portable_candidate_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_confirmed_receipt_evidence_transaction
    ON confirmed_receipt_evidence(household_id, transaction_id, linked_at);

CREATE TRIGGER trg_confirmed_receipt_evidence_scope_insert
BEFORE INSERT ON confirmed_receipt_evidence
WHEN NOT EXISTS (
    SELECT 1 FROM transactions transaction_row
    WHERE transaction_row.id = NEW.transaction_id
      AND transaction_row.household_id = NEW.household_id
      AND transaction_row.status = 'POSTED'
      AND transaction_row.transaction_type IN ('EXPENSE','CARD_PURCHASE')
)
BEGIN
    SELECT RAISE(ABORT,'confirmed receipt evidence transaction mismatch');
END;

CREATE TRIGGER trg_confirmed_receipt_evidence_immutable
BEFORE UPDATE ON confirmed_receipt_evidence
BEGIN
    SELECT RAISE(ABORT,'confirmed receipt evidence is immutable');
END;

CREATE TABLE confirmed_receipt_evidence_records (
    household_id TEXT NOT NULL,
    origin_installation_id TEXT NOT NULL,
    portable_candidate_id TEXT NOT NULL,
    portable_record_id TEXT NOT NULL,
    evidence_role TEXT NOT NULL CHECK (evidence_role IN (
        'PRIMARY','FUNDING_LEG','REWARD_LEG','CONTINUATION','SUPPORTING'
    )),
    PRIMARY KEY (
        household_id, origin_installation_id,
        portable_candidate_id, portable_record_id
    ),
    FOREIGN KEY (household_id, origin_installation_id, portable_candidate_id)
        REFERENCES confirmed_receipt_evidence(
            household_id, origin_installation_id, portable_candidate_id
        ) ON DELETE CASCADE,
    FOREIGN KEY (household_id, origin_installation_id, portable_record_id)
        REFERENCES evidence_source_record_aliases(
            household_id, origin_installation_id, portable_record_id
        ) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_confirmed_receipt_evidence_records_source
    ON confirmed_receipt_evidence_records(
        household_id, origin_installation_id, portable_record_id
    );

CREATE TRIGGER trg_confirmed_receipt_evidence_record_immutable
BEFORE UPDATE ON confirmed_receipt_evidence_records
BEGIN
    SELECT RAISE(ABORT,'confirmed receipt evidence records are immutable');
END;
