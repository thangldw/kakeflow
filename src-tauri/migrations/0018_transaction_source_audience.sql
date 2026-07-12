-- Attribution answers who a transaction is assigned to. Audience answers how
-- it is organized for display. Neither tuple is inferred from account ownership
-- and PERSONAL remains a local product label, not an access-control boundary.
ALTER TABLE transactions ADD COLUMN attribution_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD'
    CHECK (attribution_kind IN ('HOUSEHOLD', 'MEMBER'));
ALTER TABLE transactions ADD COLUMN attributed_member_id TEXT
    REFERENCES household_members(id) ON DELETE RESTRICT
    CHECK (
        (attribution_kind = 'HOUSEHOLD' AND attributed_member_id IS NULL)
        OR (attribution_kind = 'MEMBER' AND attributed_member_id IS NOT NULL)
    );
ALTER TABLE transactions ADD COLUMN audience_visibility TEXT NOT NULL DEFAULT 'SHARED'
    CHECK (audience_visibility IN ('SHARED', 'PERSONAL'));
ALTER TABLE transactions ADD COLUMN audience_member_id TEXT
    REFERENCES household_members(id) ON DELETE RESTRICT
    CHECK (
        (audience_visibility = 'SHARED' AND audience_member_id IS NULL)
        OR (audience_visibility = 'PERSONAL' AND audience_member_id IS NOT NULL)
    );

ALTER TABLE transaction_candidates ADD COLUMN attribution_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD'
    CHECK (attribution_kind IN ('HOUSEHOLD', 'MEMBER'));
ALTER TABLE transaction_candidates ADD COLUMN attributed_member_id TEXT
    REFERENCES household_members(id) ON DELETE RESTRICT
    CHECK (
        (attribution_kind = 'HOUSEHOLD' AND attributed_member_id IS NULL)
        OR (attribution_kind = 'MEMBER' AND attributed_member_id IS NOT NULL)
    );
ALTER TABLE transaction_candidates ADD COLUMN audience_visibility TEXT NOT NULL DEFAULT 'SHARED'
    CHECK (audience_visibility IN ('SHARED', 'PERSONAL'));
ALTER TABLE transaction_candidates ADD COLUMN audience_member_id TEXT
    REFERENCES household_members(id) ON DELETE RESTRICT
    CHECK (
        (audience_visibility = 'SHARED' AND audience_member_id IS NULL)
        OR (audience_visibility = 'PERSONAL' AND audience_member_id IS NOT NULL)
    );

ALTER TABLE source_documents ADD COLUMN audience_visibility TEXT NOT NULL DEFAULT 'SHARED'
    CHECK (audience_visibility IN ('SHARED', 'PERSONAL'));
ALTER TABLE source_documents ADD COLUMN audience_member_id TEXT
    REFERENCES household_members(id) ON DELETE RESTRICT
    CHECK (
        (audience_visibility = 'SHARED' AND audience_member_id IS NULL)
        OR (audience_visibility = 'PERSONAL' AND audience_member_id IS NOT NULL)
    );

CREATE INDEX idx_transactions_household_attribution_date
    ON transactions (household_id, attribution_kind, attributed_member_id, occurred_on DESC);
CREATE INDEX idx_transactions_household_audience_date
    ON transactions (household_id, audience_visibility, audience_member_id, occurred_on DESC);
CREATE INDEX idx_candidates_household_attribution_audience
    ON transaction_candidates (
        household_id, attribution_kind, attributed_member_id,
        audience_visibility, audience_member_id, occurred_on DESC
    );
CREATE INDEX idx_source_documents_household_audience
    ON source_documents (household_id, audience_visibility, audience_member_id, imported_at DESC);

CREATE TRIGGER trg_transactions_scope_insert
BEFORE INSERT ON transactions
WHEN (NEW.attributed_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM household_members m
        WHERE m.id = NEW.attributed_member_id AND m.household_id = NEW.household_id
    ))
    OR (NEW.audience_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM household_members m
        WHERE m.id = NEW.audience_member_id AND m.household_id = NEW.household_id
    ))
BEGIN
    SELECT RAISE(ABORT, 'transaction member scope must belong to the same household');
END;

CREATE TRIGGER trg_transactions_scope_update
BEFORE UPDATE OF household_id, attribution_kind, attributed_member_id,
                 audience_visibility, audience_member_id ON transactions
WHEN (NEW.attributed_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM household_members m
        WHERE m.id = NEW.attributed_member_id AND m.household_id = NEW.household_id
    ))
    OR (NEW.audience_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM household_members m
        WHERE m.id = NEW.audience_member_id AND m.household_id = NEW.household_id
    ))
BEGIN
    SELECT RAISE(ABORT, 'transaction member scope must belong to the same household');
END;

CREATE TRIGGER trg_candidates_scope_insert
BEFORE INSERT ON transaction_candidates
WHEN (NEW.attributed_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM household_members m
        WHERE m.id = NEW.attributed_member_id AND m.household_id = NEW.household_id
    ))
    OR (NEW.audience_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM household_members m
        WHERE m.id = NEW.audience_member_id AND m.household_id = NEW.household_id
    ))
BEGIN
    SELECT RAISE(ABORT, 'candidate member scope must belong to the same household');
END;

CREATE TRIGGER trg_candidates_scope_update
BEFORE UPDATE OF household_id, attribution_kind, attributed_member_id,
                 audience_visibility, audience_member_id ON transaction_candidates
WHEN (NEW.attributed_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM household_members m
        WHERE m.id = NEW.attributed_member_id AND m.household_id = NEW.household_id
    ))
    OR (NEW.audience_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM household_members m
        WHERE m.id = NEW.audience_member_id AND m.household_id = NEW.household_id
    ))
BEGIN
    SELECT RAISE(ABORT, 'candidate member scope must belong to the same household');
END;

CREATE TRIGGER trg_source_documents_audience_insert
BEFORE INSERT ON source_documents
WHEN NEW.audience_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM household_members m
    WHERE m.id = NEW.audience_member_id AND m.household_id = NEW.household_id
)
BEGIN
    SELECT RAISE(ABORT, 'source audience member must belong to the same household');
END;

CREATE TRIGGER trg_source_documents_audience_update
BEFORE UPDATE OF household_id, audience_visibility, audience_member_id ON source_documents
WHEN NEW.audience_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM household_members m
    WHERE m.id = NEW.audience_member_id AND m.household_id = NEW.household_id
)
BEGIN
    SELECT RAISE(ABORT, 'source audience member must belong to the same household');
END;
