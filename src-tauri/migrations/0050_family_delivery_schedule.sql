-- Persist the user's opt-in schedule for discovering inbound family artifacts.
-- Relay tokens are opt-in OS credentials and are never stored in SQLite; this
-- row only coordinates when a connected household may perform its next poll.

CREATE TABLE family_delivery_schedules (
    household_id TEXT PRIMARY KEY NOT NULL
        REFERENCES family_delivery_connections(household_id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
    interval_minutes INTEGER NOT NULL DEFAULT 30
        CHECK (interval_minutes IN (15,30,60)),
    next_due_at TEXT,
    lease_token TEXT CHECK (lease_token IS NULL OR (
        length(lease_token)=64 AND lease_token NOT GLOB '*[^0-9a-f]*'
    )),
    lease_expires_at TEXT,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_result TEXT NOT NULL DEFAULT 'NEVER' CHECK (last_result IN (
        'NEVER','RUNNING','NO_CHANGES','DISCOVERED','FAILED_RETRYABLE',
        'LEASE_EXPIRED','TERMINAL_SUSPENDED','DISABLED'
    )),
    last_discovered_count INTEGER NOT NULL DEFAULT 0
        CHECK (last_discovered_count >= 0),
    consecutive_failures INTEGER NOT NULL DEFAULT 0
        CHECK (consecutive_failures BETWEEN 0 AND 10),
    suspended_until TEXT,
    suspension_reason TEXT CHECK (suspension_reason IS NULL OR suspension_reason IN (
        'RETRY_BACKOFF','AUTH_EXPIRED','MEMBERSHIP_REVOKED','MISSING_CREDENTIAL'
    )),
    last_error_code TEXT CHECK (
        last_error_code IS NULL OR length(trim(last_error_code)) BETWEEN 1 AND 64
    ),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK ((enabled=0 AND next_due_at IS NULL AND lease_token IS NULL
            AND lease_expires_at IS NULL AND suspended_until IS NULL)
        OR (enabled=1 AND next_due_at IS NOT NULL)),
    CHECK ((lease_token IS NULL AND lease_expires_at IS NULL)
        OR (enabled=1 AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((last_result='RUNNING' AND lease_token IS NOT NULL)
        OR (last_result!='RUNNING' AND lease_token IS NULL)),
    CHECK ((suspension_reason IS NULL AND suspended_until IS NULL)
        OR (suspension_reason='RETRY_BACKOFF' AND suspended_until IS NOT NULL)
        OR (suspension_reason IN ('AUTH_EXPIRED','MEMBERSHIP_REVOKED','MISSING_CREDENTIAL')
            AND enabled=1 AND suspended_until IS NULL AND last_result='TERMINAL_SUSPENDED'))
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_family_delivery_schedule_due
    ON family_delivery_schedules(enabled,next_due_at,household_id)
    WHERE enabled=1 AND lease_token IS NULL;

CREATE INDEX idx_family_delivery_schedule_expired_lease
    ON family_delivery_schedules(lease_expires_at,household_id)
    WHERE lease_token IS NOT NULL;
