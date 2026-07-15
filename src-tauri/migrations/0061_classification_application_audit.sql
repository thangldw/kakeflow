-- Preserve the rule revision and workflow boundary that produced each
-- classification application. Existing applications predate revision capture,
-- so their rule_updated_at remains unknown while their source is explicit.
ALTER TABLE classification_rule_applications
    ADD COLUMN rule_updated_at TEXT;

ALTER TABLE classification_rule_applications
    ADD COLUMN application_source TEXT NOT NULL DEFAULT 'POST_TRANSACTION'
        CHECK (application_source IN ('POST_TRANSACTION', 'IMPORT_REVIEW'));

