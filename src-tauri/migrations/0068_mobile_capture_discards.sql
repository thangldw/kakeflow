CREATE TABLE mobile_capture_discards (
    household_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    discarded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(household_id, artifact_id),
    FOREIGN KEY(household_id, artifact_id)
      REFERENCES mobile_capture_receipts(household_id, artifact_id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;
