-- Local identity and append-only change-envelope foundations for a future
-- optional sync transport. Nothing in this migration is an authorization
-- boundary and no row is transmitted by the v0.34 application.
CREATE TABLE sync_devices (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    platform TEXT NOT NULL CHECK (platform IN ('MACOS', 'WINDOWS', 'OTHER')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE sync_principals (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE household_principal_bindings (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    principal_id TEXT NOT NULL REFERENCES sync_principals(id) ON DELETE RESTRICT,
    member_id TEXT REFERENCES household_members(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (household_id, principal_id),
    FOREIGN KEY (household_id, member_id)
        REFERENCES household_members(household_id, id) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

-- This selection is device-local. Portable restore clears it before the
-- restored database is activated, while retaining logical origin history.
CREATE TABLE local_sync_contexts (
    household_id TEXT PRIMARY KEY NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES sync_devices(id) ON DELETE RESTRICT,
    principal_id TEXT NOT NULL REFERENCES sync_principals(id) ON DELETE RESTRICT,
    selected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (household_id, principal_id)
        REFERENCES household_principal_bindings(household_id, principal_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE sync_device_sequences (
    device_id TEXT PRIMARY KEY NOT NULL REFERENCES sync_devices(id) ON DELETE RESTRICT,
    next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence >= 1)
) STRICT;

CREATE TABLE sync_change_envelopes (
    envelope_id TEXT PRIMARY KEY NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    origin_device_id TEXT NOT NULL REFERENCES sync_devices(id) ON DELETE RESTRICT,
    origin_principal_id TEXT NOT NULL REFERENCES sync_principals(id) ON DELETE RESTRICT,
    origin_sequence INTEGER NOT NULL CHECK (origin_sequence >= 1),
    mutation_id TEXT NOT NULL CHECK (length(trim(mutation_id)) BETWEEN 1 AND 128),
    entity_kind TEXT NOT NULL CHECK (length(trim(entity_kind)) BETWEEN 1 AND 64),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT', 'DELETE')),
    canonical_payload_json TEXT NOT NULL CHECK (json_valid(canonical_payload_json)),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (origin_device_id, origin_sequence),
    UNIQUE (origin_device_id, mutation_id),
    FOREIGN KEY (household_id, origin_principal_id)
        REFERENCES household_principal_bindings(household_id, principal_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE sync_outbox (
    envelope_id TEXT PRIMARY KEY NOT NULL
        REFERENCES sync_change_envelopes(envelope_id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'ACKNOWLEDGED')),
    queued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    acknowledged_at TEXT CHECK (
        (state = 'PENDING' AND acknowledged_at IS NULL)
        OR (state = 'ACKNOWLEDGED' AND acknowledged_at IS NOT NULL)
    )
) STRICT;

CREATE INDEX idx_sync_outbox_pending
    ON sync_outbox(state, queued_at, envelope_id);
CREATE INDEX idx_sync_envelopes_household_sequence
    ON sync_change_envelopes(household_id, origin_device_id, origin_sequence);

CREATE TRIGGER trg_sync_context_requires_active_binding
BEFORE INSERT ON local_sync_contexts
WHEN NOT EXISTS (
    SELECT 1 FROM household_principal_bindings b
    JOIN sync_principals p ON p.id = b.principal_id
    JOIN sync_devices d ON d.id = NEW.device_id
    WHERE b.household_id = NEW.household_id
      AND b.principal_id = NEW.principal_id
      AND b.status = 'ACTIVE' AND p.status = 'ACTIVE' AND d.status = 'ACTIVE'
)
BEGIN
    SELECT RAISE(ABORT, 'local sync context requires active identities');
END;

CREATE TRIGGER trg_sync_context_update_requires_active_binding
BEFORE UPDATE ON local_sync_contexts
WHEN NOT EXISTS (
    SELECT 1 FROM household_principal_bindings b
    JOIN sync_principals p ON p.id = b.principal_id
    JOIN sync_devices d ON d.id = NEW.device_id
    WHERE b.household_id = NEW.household_id
      AND b.principal_id = NEW.principal_id
      AND b.status = 'ACTIVE' AND p.status = 'ACTIVE' AND d.status = 'ACTIVE'
)
BEGIN
    SELECT RAISE(ABORT, 'local sync context requires active identities');
END;

