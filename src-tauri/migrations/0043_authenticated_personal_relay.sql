CREATE TABLE relay_connections (
    household_id TEXT PRIMARY KEY NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL CHECK (length(trim(endpoint)) BETWEEN 8 AND 2048),
    remote_principal_id TEXT NOT NULL CHECK (length(trim(remote_principal_id)) BETWEEN 1 AND 128),
    state TEXT NOT NULL CHECK (state IN ('CONNECTED', 'DEGRADED', 'DISCONNECTED')),
    connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE relay_deliveries (
    delivery_id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES relay_connections(household_id) ON DELETE CASCADE,
    artifact_id TEXT NOT NULL,
    package_sha256 TEXT NOT NULL CHECK (length(package_sha256) = 64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'),
    snapshot_sequence INTEGER NOT NULL CHECK (snapshot_sequence >= 0),
    package_bytes BLOB CHECK (package_bytes IS NULL OR length(package_bytes) BETWEEN 1 AND 67108864),
    state TEXT NOT NULL CHECK (state IN ('READY', 'SENDING', 'ACCEPTED', 'FAILED_RETRYABLE')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    accepted_at TEXT,
    UNIQUE (household_id, artifact_id),
    CHECK ((state = 'ACCEPTED' AND accepted_at IS NOT NULL AND package_bytes IS NULL)
        OR (state != 'ACCEPTED' AND accepted_at IS NULL AND package_bytes IS NOT NULL))
) STRICT;

CREATE TABLE relay_delivery_envelopes (
    delivery_id TEXT NOT NULL REFERENCES relay_deliveries(delivery_id) ON DELETE CASCADE,
    envelope_id TEXT NOT NULL REFERENCES sync_change_envelopes(envelope_id) ON DELETE RESTRICT,
    PRIMARY KEY (delivery_id, envelope_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE relay_inbound_artifacts (
    artifact_id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES relay_connections(household_id) ON DELETE CASCADE,
    package_sha256 TEXT NOT NULL CHECK (length(package_sha256) = 64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'),
    origin_device_id TEXT NOT NULL CHECK (length(trim(origin_device_id)) BETWEEN 1 AND 128),
    created_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('AVAILABLE', 'WAITING_FOR_REVIEW', 'DUPLICATE', 'REJECTED_INVALID', 'FAILED_RETRYABLE')),
    registered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    staged_package_id TEXT,
    UNIQUE (household_id, artifact_id)
) STRICT;

CREATE INDEX idx_relay_delivery_household_state ON relay_deliveries(household_id, state, created_at);
CREATE INDEX idx_relay_inbound_household_state ON relay_inbound_artifacts(household_id, state, created_at);
