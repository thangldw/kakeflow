-- Durable desktop state for the audience-partitioned /v2 family relay.
-- Relay credentials remain session-only in the WebView; this schema stores
-- only routing metadata, immutable artifact bytes, and review lineage.

CREATE TABLE family_delivery_connections (
    household_id TEXT PRIMARY KEY NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL CHECK (length(trim(endpoint)) BETWEEN 8 AND 2048),
    remote_principal_id TEXT NOT NULL CHECK (length(trim(remote_principal_id)) BETWEEN 1 AND 128),
    local_member_id TEXT NOT NULL,
    local_member_name TEXT NOT NULL CHECK (length(trim(local_member_name)) BETWEEN 1 AND 256),
    state TEXT NOT NULL CHECK (state IN (
        'CONNECTED','AUTH_EXPIRED','NETWORK_UNAVAILABLE','MEMBERSHIP_REVOKED','DISCONNECTED'
    )),
    inbound_cursor INTEGER NOT NULL DEFAULT 0 CHECK (inbound_cursor >= 0),
    connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY(household_id,local_member_id)
        REFERENCES household_members(household_id,id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE family_delivery_memberships (
    household_id TEXT NOT NULL REFERENCES family_delivery_connections(household_id) ON DELETE CASCADE,
    member_id TEXT NOT NULL,
    member_name TEXT NOT NULL CHECK (length(trim(member_name)) BETWEEN 1 AND 256),
    state TEXT NOT NULL CHECK (state IN ('UNLINKED','INVITED','ACTIVE','REVOKED','ARCHIVED_BLOCKED')),
    remote_membership_id TEXT,
    invite_id TEXT,
    invite_expires_at TEXT,
    device_count INTEGER NOT NULL CHECK (device_count >= 0),
    last_delivery_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(household_id,member_id),
    FOREIGN KEY(household_id,member_id)
        REFERENCES household_members(household_id,id) ON DELETE CASCADE,
    CHECK ((state='INVITED' AND invite_id IS NOT NULL AND invite_expires_at IS NOT NULL)
        OR (state!='INVITED' AND invite_id IS NULL AND invite_expires_at IS NULL)),
    CHECK (remote_membership_id IS NULL OR length(trim(remote_membership_id)) BETWEEN 1 AND 128)
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX idx_family_delivery_remote_membership
    ON family_delivery_memberships(household_id,remote_membership_id)
    WHERE remote_membership_id IS NOT NULL AND state='ACTIVE';

CREATE TABLE family_delivery_remote_membership_ids (
    household_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    remote_membership_id TEXT NOT NULL CHECK (length(trim(remote_membership_id)) BETWEEN 1 AND 128),
    PRIMARY KEY(household_id,remote_membership_id),
    FOREIGN KEY(household_id,member_id)
        REFERENCES family_delivery_memberships(household_id,member_id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE family_delivery_partition_state (
    household_id TEXT NOT NULL REFERENCES family_delivery_connections(household_id) ON DELETE CASCADE,
    audience_key TEXT NOT NULL CHECK (length(trim(audience_key)) BETWEEN 1 AND 256),
    visibility TEXT NOT NULL CHECK (visibility IN ('SHARED','PERSONAL')),
    member_id TEXT,
    member_key TEXT NOT NULL,
    dirty INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),
    last_accepted_digest TEXT CHECK (last_accepted_digest IS NULL OR (
        length(last_accepted_digest)=64 AND last_accepted_digest NOT GLOB '*[^0-9a-f]*'
    )),
    last_accepted_at TEXT,
    PRIMARY KEY(household_id,audience_key),
    CHECK ((visibility='SHARED' AND member_id IS NULL AND member_key='' AND audience_key='SHARED')
        OR (visibility='PERSONAL' AND member_id IS NOT NULL AND member_key=member_id
            AND audience_key='PERSONAL:' || member_id))
) STRICT, WITHOUT ROWID;

CREATE TABLE family_delivery_deliveries (
    delivery_id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES family_delivery_connections(household_id) ON DELETE CASCADE,
    audience_key TEXT NOT NULL,
    artifact_id TEXT NOT NULL CHECK (length(trim(artifact_id)) BETWEEN 1 AND 128),
    package_sha256 TEXT NOT NULL CHECK (
        length(package_sha256)=64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    origin_device_id TEXT NOT NULL CHECK (length(trim(origin_device_id)) BETWEEN 1 AND 128),
    visibility TEXT NOT NULL CHECK (visibility IN ('SHARED','PERSONAL')),
    member_id TEXT,
    item_count INTEGER NOT NULL CHECK (item_count >= 0),
    excluded_count INTEGER NOT NULL CHECK (excluded_count >= 0),
    package_bytes BLOB CHECK (package_bytes IS NULL OR length(package_bytes) BETWEEN 1 AND 67108864),
    state TEXT NOT NULL CHECK (state IN ('SENDING','RELAY_ACCEPTED','FAILED_RETRYABLE')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    accepted_at TEXT,
    FOREIGN KEY(household_id,audience_key)
        REFERENCES family_delivery_partition_state(household_id,audience_key) ON DELETE CASCADE,
    UNIQUE(household_id,artifact_id),
    CHECK ((visibility='SHARED' AND member_id IS NULL)
        OR (visibility='PERSONAL' AND member_id IS NOT NULL)),
    CHECK ((state='RELAY_ACCEPTED' AND accepted_at IS NOT NULL AND package_bytes IS NULL)
        OR (state!='RELAY_ACCEPTED' AND accepted_at IS NULL AND package_bytes IS NOT NULL))
) STRICT;

CREATE INDEX idx_family_delivery_retry
    ON family_delivery_deliveries(household_id,audience_key,state,created_at);

CREATE TABLE family_delivery_inbound (
    artifact_id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES family_delivery_connections(household_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    package_sha256 TEXT NOT NULL CHECK (
        length(package_sha256)=64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL,
    origin_device_id TEXT NOT NULL CHECK (length(trim(origin_device_id)) BETWEEN 1 AND 128),
    sender_membership_id TEXT NOT NULL CHECK (length(trim(sender_membership_id)) BETWEEN 1 AND 128),
    sender_member_id TEXT NOT NULL,
    sender_member_name TEXT NOT NULL CHECK (length(trim(sender_member_name)) BETWEEN 1 AND 256),
    visibility TEXT NOT NULL CHECK (visibility IN ('SHARED','PERSONAL')),
    member_id TEXT,
    member_key TEXT NOT NULL,
    member_name TEXT,
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 67108864),
    artifact_schema TEXT NOT NULL CHECK (artifact_schema='FAMILY_AUDIENCE_PARTITION_V1'),
    state TEXT NOT NULL CHECK (state IN (
        'AVAILABLE','DOWNLOADING','WAITING_FOR_REVIEW','READY_TO_APPLY','APPLIED','DUPLICATE',
        'REJECTED_INVALID','AUDIENCE_DENIED','FAILED_RETRYABLE'
    )),
    received_before_revocation INTEGER NOT NULL DEFAULT 0 CHECK (received_before_revocation IN (0,1)),
    staged_snapshot_set_id TEXT REFERENCES family_snapshot_sets(snapshot_set_id) ON DELETE SET NULL,
    registered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(household_id,sequence),
    CHECK ((visibility='SHARED' AND member_id IS NULL AND member_key='' AND member_name IS NULL)
        OR (visibility='PERSONAL' AND member_id IS NOT NULL AND member_key=member_id AND member_name IS NOT NULL)),
    FOREIGN KEY(household_id,sender_member_id)
        REFERENCES household_members(household_id,id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_family_delivery_inbound_state
    ON family_delivery_inbound(household_id,state,sequence);

-- Conservatively mark both current partitions dirty for any local ledger graph
-- mutation. Incoming applies hold sync_apply_guard, so they do not echo.
CREATE TRIGGER trg_family_delivery_household_dirty AFTER UPDATE ON households
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=NEW.id)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.id;
END;
CREATE TRIGGER trg_family_delivery_member_dirty_insert AFTER INSERT ON household_members
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=NEW.household_id)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id;
END;
CREATE TRIGGER trg_family_delivery_member_dirty_update AFTER UPDATE ON household_members
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=NEW.household_id)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id;
END;
CREATE TRIGGER trg_family_delivery_account_dirty_insert AFTER INSERT ON accounts
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=NEW.household_id)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id;
END;
CREATE TRIGGER trg_family_delivery_account_dirty_update AFTER UPDATE ON accounts
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=NEW.household_id)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id;
END;
CREATE TRIGGER trg_family_delivery_account_dirty_delete AFTER DELETE ON accounts
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=OLD.household_id)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=OLD.household_id;
END;
CREATE TRIGGER trg_family_delivery_transaction_dirty_insert AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=NEW.household_id)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id;
END;
CREATE TRIGGER trg_family_delivery_transaction_dirty_update AFTER UPDATE ON transactions
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=NEW.household_id)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=NEW.household_id;
END;
CREATE TRIGGER trg_family_delivery_transaction_dirty_delete AFTER DELETE ON transactions
WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=OLD.household_id)
BEGIN
  UPDATE family_delivery_partition_state SET dirty=1 WHERE household_id=OLD.household_id;
END;
CREATE TRIGGER trg_family_delivery_journal_dirty_insert AFTER INSERT ON journal_entries BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
    WHERE household_id=(SELECT household_id FROM transactions WHERE id=NEW.transaction_id)
      AND NOT EXISTS (SELECT 1 FROM sync_apply_guard g
        WHERE g.household_id=(SELECT household_id FROM transactions WHERE id=NEW.transaction_id));
END;
CREATE TRIGGER trg_family_delivery_journal_dirty_update AFTER UPDATE ON journal_entries BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
    WHERE household_id=(SELECT household_id FROM transactions WHERE id=NEW.transaction_id)
      AND NOT EXISTS (SELECT 1 FROM sync_apply_guard g
        WHERE g.household_id=(SELECT household_id FROM transactions WHERE id=NEW.transaction_id));
END;
CREATE TRIGGER trg_family_delivery_journal_dirty_delete AFTER DELETE ON journal_entries BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
    WHERE household_id=(SELECT household_id FROM transactions WHERE id=OLD.transaction_id)
      AND NOT EXISTS (SELECT 1 FROM sync_apply_guard g
        WHERE g.household_id=(SELECT household_id FROM transactions WHERE id=OLD.transaction_id));
END;
CREATE TRIGGER trg_family_delivery_label_dirty_insert AFTER INSERT ON transaction_labels BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
    WHERE household_id=(SELECT household_id FROM transactions WHERE id=NEW.transaction_id)
      AND NOT EXISTS (SELECT 1 FROM sync_apply_guard g
        WHERE g.household_id=(SELECT household_id FROM transactions WHERE id=NEW.transaction_id));
END;
CREATE TRIGGER trg_family_delivery_label_dirty_delete AFTER DELETE ON transaction_labels BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
    WHERE household_id=(SELECT household_id FROM transactions WHERE id=OLD.transaction_id)
      AND NOT EXISTS (SELECT 1 FROM sync_apply_guard g
        WHERE g.household_id=(SELECT household_id FROM transactions WHERE id=OLD.transaction_id));
END;
CREATE TRIGGER trg_family_delivery_tag_dirty_insert AFTER INSERT ON transaction_tags BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
    WHERE household_id=(SELECT household_id FROM transactions WHERE id=NEW.transaction_id)
      AND NOT EXISTS (SELECT 1 FROM sync_apply_guard g
        WHERE g.household_id=(SELECT household_id FROM transactions WHERE id=NEW.transaction_id));
END;
CREATE TRIGGER trg_family_delivery_tag_dirty_delete AFTER DELETE ON transaction_tags BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
    WHERE household_id=(SELECT household_id FROM transactions WHERE id=OLD.transaction_id)
      AND NOT EXISTS (SELECT 1 FROM sync_apply_guard g
        WHERE g.household_id=(SELECT household_id FROM transactions WHERE id=OLD.transaction_id));
END;
CREATE TRIGGER trg_family_delivery_external_key_dirty_insert AFTER INSERT ON transaction_external_keys BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
    WHERE household_id=NEW.household_id
      AND NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=NEW.household_id);
END;
CREATE TRIGGER trg_family_delivery_external_key_dirty_update AFTER UPDATE ON transaction_external_keys BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
    WHERE household_id=NEW.household_id
      AND NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=NEW.household_id);
END;
CREATE TRIGGER trg_family_delivery_external_key_dirty_delete AFTER DELETE ON transaction_external_keys BEGIN
  UPDATE family_delivery_partition_state SET dirty=1
    WHERE household_id=OLD.household_id
      AND NOT EXISTS (SELECT 1 FROM sync_apply_guard g WHERE g.household_id=OLD.household_id);
END;
