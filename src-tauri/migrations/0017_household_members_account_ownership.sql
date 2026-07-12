-- Stable household people are domain identities. They deliberately contain no
-- device, login, or cloud-provider identifier so a later sync identity can be
-- mapped without changing financial ownership records.
CREATE TABLE household_members (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    relationship_label TEXT CHECK (
        relationship_label IS NULL OR length(trim(relationship_label)) > 0
    ),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (household_id, id),
    UNIQUE (household_id, sort_order)
) STRICT;

CREATE INDEX idx_household_members_household_status_order
    ON household_members (household_id, status, sort_order, id);

-- Each existing household receives a stable local primary profile. The current
-- household id limit (48 bytes) keeps the generated id below the 64-byte member
-- id boundary enforced by the repository.
INSERT INTO household_members
    (id, household_id, display_name, relationship_label, status, sort_order)
SELECT id || '-member-primary', id, 'Primary member', NULL, 'ACTIVE', 0
FROM households;

CREATE TRIGGER trg_household_primary_member_insert
AFTER INSERT ON households
BEGIN
    INSERT INTO household_members
        (id, household_id, display_name, relationship_label, status, sort_order)
    VALUES (
        NEW.id || '-member-primary', NEW.id, 'Primary member', NULL, 'ACTIVE', 0
    );
END;

ALTER TABLE accounts ADD COLUMN owner_member_id TEXT
    REFERENCES household_members(id) ON DELETE RESTRICT;

ALTER TABLE accounts ADD COLUMN ownership_kind TEXT NOT NULL DEFAULT 'HOUSEHOLD'
    CHECK (ownership_kind IN ('HOUSEHOLD', 'MEMBER'))
    CHECK (
        (ownership_kind = 'HOUSEHOLD' AND owner_member_id IS NULL)
        OR (ownership_kind = 'MEMBER' AND owner_member_id IS NOT NULL)
    );

-- PERSONAL is a product organization label for this local-first release. It is
-- not an authorization boundary. A member-owned account may still be SHARED.
ALTER TABLE accounts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'SHARED'
    CHECK (visibility IN ('SHARED', 'PERSONAL'))
    CHECK (visibility = 'SHARED' OR ownership_kind = 'MEMBER');

CREATE INDEX idx_accounts_household_owner_visibility
    ON accounts (household_id, ownership_kind, owner_member_id, visibility)
    WHERE is_archived = 0;

CREATE TRIGGER trg_accounts_owner_insert
BEFORE INSERT ON accounts
WHEN NEW.owner_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM household_members m
    WHERE m.id = NEW.owner_member_id
      AND m.household_id = NEW.household_id
      AND m.status = 'ACTIVE'
)
BEGIN
    SELECT RAISE(ABORT, 'account owner must be an active member of the same household');
END;

CREATE TRIGGER trg_accounts_owner_update
BEFORE UPDATE OF household_id, owner_member_id, ownership_kind, visibility ON accounts
WHEN NEW.owner_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM household_members m
    WHERE m.id = NEW.owner_member_id
      AND m.household_id = NEW.household_id
      AND m.status = 'ACTIVE'
)
BEGIN
    SELECT RAISE(ABORT, 'account owner must be an active member of the same household');
END;

CREATE TRIGGER trg_household_member_household_immutable
BEFORE UPDATE OF household_id ON household_members
WHEN NEW.household_id != OLD.household_id
BEGIN
    SELECT RAISE(ABORT, 'household member cannot move between households');
END;

-- Member identities are archival records. Direct deletion is disallowed while
-- the household exists, but the household's own ON DELETE CASCADE remains valid
-- because the parent row has already left `households` when the cascade fires.
CREATE TRIGGER trg_household_member_delete_requires_household_delete
BEFORE DELETE ON household_members
WHEN EXISTS (SELECT 1 FROM households h WHERE h.id = OLD.household_id)
BEGIN
    SELECT RAISE(ABORT, 'household member must be archived instead of deleted');
END;

CREATE TRIGGER trg_household_member_archive_owner
BEFORE UPDATE OF status ON household_members
WHEN OLD.status = 'ACTIVE' AND NEW.status = 'ARCHIVED' AND EXISTS (
    SELECT 1 FROM accounts a WHERE a.owner_member_id = OLD.id
)
BEGIN
    SELECT RAISE(ABORT, 'account owner cannot be archived');
END;

CREATE TRIGGER trg_household_member_archive_last_active
BEFORE UPDATE OF status ON household_members
WHEN OLD.status = 'ACTIVE' AND NEW.status = 'ARCHIVED' AND (
    SELECT count(*) FROM household_members m
    WHERE m.household_id = OLD.household_id AND m.status = 'ACTIVE'
) <= 1
BEGIN
    SELECT RAISE(ABORT, 'household must retain an active member');
END;
