-- Audience-partitioned family snapshots are deliberately separate from the
-- schema-v1..v4 full-current-state change-package format.  A family snapshot
-- can only authoritatively remove records previously accepted from the same
-- source installation and the same SHARED/PERSONAL(member) partition.

CREATE TABLE family_snapshot_revisions (
    household_id TEXT PRIMARY KEY NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT, WITHOUT ROWID;

INSERT INTO family_snapshot_revisions(household_id)
SELECT id FROM households ORDER BY id;

CREATE TRIGGER trg_family_snapshot_revision_household_insert
AFTER INSERT ON households
BEGIN
    INSERT INTO family_snapshot_revisions(household_id) VALUES(NEW.id);
END;

CREATE TABLE family_snapshot_sets (
    snapshot_set_id TEXT PRIMARY KEY NOT NULL
        CHECK (length(trim(snapshot_set_id)) BETWEEN 1 AND 128),
    target_household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    source_installation_id TEXT NOT NULL
        CHECK (length(trim(source_installation_id)) BETWEEN 1 AND 128),
    source_principal_id TEXT NOT NULL
        CHECK (length(trim(source_principal_id)) BETWEEN 1 AND 128),
    publisher_member_id TEXT NOT NULL
        CHECK (length(trim(publisher_member_id)) BETWEEN 1 AND 128),
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    set_sha256 TEXT NOT NULL CHECK (
        length(set_sha256)=64 AND set_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    manifest_json TEXT NOT NULL CHECK (
        json_valid(manifest_json) AND json_type(manifest_json)='object'
    ),
    state TEXT NOT NULL CHECK (state IN ('REVIEW_REQUIRED','READY','APPLIED','REJECTED')),
    record_count INTEGER NOT NULL CHECK (record_count >= 0),
    conflict_count INTEGER NOT NULL CHECK (conflict_count >= 0),
    delete_count INTEGER NOT NULL CHECK (delete_count >= 0),
    source_created_at TEXT NOT NULL,
    staged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    reviewed_at TEXT,
    applied_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (conflict_count + delete_count <= record_count),
    CHECK (
        (state='REVIEW_REQUIRED' AND reviewed_at IS NULL AND applied_at IS NULL) OR
        (state='READY' AND reviewed_at IS NOT NULL AND applied_at IS NULL) OR
        (state='APPLIED' AND reviewed_at IS NOT NULL AND applied_at IS NOT NULL) OR
        (state='REJECTED' AND reviewed_at IS NOT NULL AND applied_at IS NULL)
    )
) STRICT;

CREATE UNIQUE INDEX idx_family_snapshot_one_active_target
    ON family_snapshot_sets(target_household_id)
    WHERE state IN ('REVIEW_REQUIRED','READY');

CREATE INDEX idx_family_snapshot_source_revision
    ON family_snapshot_sets(source_installation_id,target_household_id,source_revision);

CREATE TABLE family_snapshot_partitions (
    snapshot_set_id TEXT NOT NULL REFERENCES family_snapshot_sets(snapshot_set_id) ON DELETE CASCADE,
    partition_order INTEGER NOT NULL CHECK (partition_order BETWEEN 0 AND 1),
    visibility TEXT NOT NULL CHECK (visibility IN ('SHARED','PERSONAL')),
    member_id TEXT,
    member_key TEXT NOT NULL,
    package_id TEXT NOT NULL CHECK (length(trim(package_id)) BETWEEN 1 AND 128),
    snapshot_sha256 TEXT NOT NULL CHECK (
        length(snapshot_sha256)=64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    package_sha256 TEXT NOT NULL CHECK (
        length(package_sha256)=64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    authoritative_kinds_json TEXT NOT NULL CHECK (
        json_valid(authoritative_kinds_json) AND json_type(authoritative_kinds_json)='array'
    ),
    record_count INTEGER NOT NULL CHECK (record_count >= 0),
    PRIMARY KEY(snapshot_set_id,partition_order),
    UNIQUE(snapshot_set_id,visibility,member_key),
    UNIQUE(package_id),
    CHECK (
        (visibility='SHARED' AND member_id IS NULL AND member_key='') OR
        (visibility='PERSONAL' AND member_id IS NOT NULL AND member_key=member_id)
    ),
    CHECK (
        (partition_order=0 AND visibility IN ('SHARED','PERSONAL')) OR
        (partition_order=1 AND visibility='PERSONAL')
    )
) STRICT, WITHOUT ROWID;

CREATE TABLE family_snapshot_records (
    snapshot_set_id TEXT NOT NULL,
    partition_order INTEGER NOT NULL,
    record_order INTEGER NOT NULL CHECK (record_order >= 0),
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'HOUSEHOLD','HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION'
    )),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT','DELETE')),
    canonical_payload_json TEXT NOT NULL CHECK (
        json_valid(canonical_payload_json) AND json_type(canonical_payload_json)='object'
    ),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    review_state TEXT NOT NULL CHECK (review_state IN (
        'CREATE','UPDATE','UNCHANGED','DELETE','CONFLICT'
    )),
    resolution TEXT NOT NULL CHECK (resolution IN (
        'PENDING','APPLY_INCOMING','KEEP_LOCAL','SKIP'
    )),
    current_payload_sha256 TEXT CHECK (
        current_payload_sha256 IS NULL OR (
            length(current_payload_sha256)=64
            AND current_payload_sha256 NOT GLOB '*[^0-9a-f]*'
        )
    ),
    conflict_reason TEXT,
    PRIMARY KEY(snapshot_set_id,partition_order,record_order),
    UNIQUE(snapshot_set_id,entity_kind,entity_id),
    FOREIGN KEY(snapshot_set_id,partition_order)
        REFERENCES family_snapshot_partitions(snapshot_set_id,partition_order) ON DELETE CASCADE,
    CHECK (
        (review_state='CONFLICT' AND conflict_reason IS NOT NULL) OR
        (review_state!='CONFLICT' AND conflict_reason IS NULL)
    )
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_family_snapshot_records_review
    ON family_snapshot_records(snapshot_set_id,review_state,partition_order,record_order);

CREATE TABLE family_applied_partitions (
    package_id TEXT PRIMARY KEY NOT NULL,
    snapshot_set_id TEXT NOT NULL REFERENCES family_snapshot_sets(snapshot_set_id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    source_installation_id TEXT NOT NULL,
    visibility TEXT NOT NULL CHECK (visibility IN ('SHARED','PERSONAL')),
    member_id TEXT,
    member_key TEXT NOT NULL,
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    snapshot_sha256 TEXT NOT NULL CHECK (
        length(snapshot_sha256)=64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(source_installation_id,household_id,visibility,member_key,source_revision),
    CHECK (
        (visibility='SHARED' AND member_id IS NULL AND member_key='') OR
        (visibility='PERSONAL' AND member_id IS NOT NULL AND member_key=member_id)
    )
) STRICT;

CREATE TABLE family_replica_entity_heads (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    visibility TEXT NOT NULL CHECK (visibility IN ('SHARED','PERSONAL')),
    member_id TEXT,
    member_key TEXT NOT NULL,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'HOUSEHOLD','HOUSEHOLD_MEMBER','ACCOUNT','TRANSACTION'
    )),
    entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 128),
    source_installation_id TEXT NOT NULL,
    package_id TEXT NOT NULL REFERENCES family_applied_partitions(package_id) ON DELETE CASCADE,
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    operation TEXT NOT NULL CHECK (operation IN ('UPSERT','DELETE')),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(household_id,visibility,member_key,entity_kind,entity_id),
    CHECK (
        (visibility='SHARED' AND member_id IS NULL AND member_key='') OR
        (visibility='PERSONAL' AND member_id IS NOT NULL AND member_key=member_id)
    )
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_family_replica_heads_source_partition
    ON family_replica_entity_heads(
        source_installation_id,household_id,visibility,member_key,source_revision
    );
